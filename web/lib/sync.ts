// Outbox flushing over POST /api/sync — Wave 3 halt-on-failure contract:
//   { clientId, operations: [{ opId, seq, entity, entityId, op, baseVersion,
//     clientUpdatedAt, fields }] }
// → { results: [{ opId, result: 'applied'|'blocked'|'held', error?, message?,
//     serverState? }], haltedAt, serverTime }
// The server applies ops in `seq` order and STOPS at the first failure. The
// failed op is moved into the persisted `blocked` store here, and NOTHING is
// sent again until it is resolved (merge / retry / discard on the queue page).

import * as idb from "./db";
import { api } from "./api";
import { safeLocalGet, safeLocalSet, uuid } from "./utils";
import type { BlockedOp, ConflictEntry, QueuedOp, SyncOp, SyncResponse, SyncResult } from "./types";

const CLIENT_ID_KEY = "opspm360:clientId";
/** meta-store key of the persisted strictly-increasing seq counter. */
const SEQ_META_KEY = "outboxSeq";

export function getClientId(): string {
  if (typeof window === "undefined") return "server";
  let id = safeLocalGet(CLIENT_ID_KEY);
  if (!id) {
    id = uuid();
    safeLocalSet(CLIENT_ID_KEY, id);
  }
  return id;
}

// ---- seq counter (persisted in the meta store, serialized in-process) -------

let seqChain: Promise<unknown> = Promise.resolve();

/** Serialize counter read-increment-writes so parallel enqueues never collide. */
function nextSeq(): Promise<number> {
  const run = async () => {
    const current = (await idb.getMeta<number>(SEQ_META_KEY)) ?? 0;
    const next = current + 1;
    await idb.setMeta(SEQ_META_KEY, next);
    return next;
  };
  const p = seqChain.then(run, run);
  seqChain = p.catch(() => undefined);
  return p;
}

const bySeq = (a: { seq: number }, b: { seq: number }) => a.seq - b.seq;

// ---- outbox -----------------------------------------------------------------

/** Enqueue an operation into the outbox; assigns the next persisted seq. */
export async function enqueueOp(op: Omit<SyncOp, "seq">): Promise<QueuedOp> {
  const seq = await nextSeq();
  const row: QueuedOp = { ...op, seq, queuedAt: Date.now() };
  await idb.put("outbox", row);
  return row;
}

/**
 * Re-insert a previously blocked op KEEPING its original opId + seq (merge
 * rewrite or as-is retry) so it goes first when the queue resumes.
 */
export async function requeueOp(op: QueuedOp): Promise<void> {
  await idb.put("outbox", op);
}

export function outboxCount(): Promise<number> {
  return idb.count("outbox");
}

/** All waiting (held/queued) ops in send order. */
export async function getQueuedOps(): Promise<QueuedOp[]> {
  return (await idb.getAll<QueuedOp>("outbox")).sort(bySeq);
}

/** Blocked ops (the halt-on-failure model implies 0 or 1; read defensively). */
export async function getBlockedOps(): Promise<BlockedOp[]> {
  return (await idb.getAll<BlockedOp>("blocked")).sort(bySeq);
}

export async function removeBlockedOp(opId: string): Promise<void> {
  await idb.del("blocked", opId);
}

// ---- one-shot boot migration (pre-v6 local state) ---------------------------

/**
 * 1. Pre-seq outbox rows get a seq assigned in queuedAt order.
 * 2. Legacy `conflicts` rows (old LWW-era manual merges) become blocked ops —
 *    under the new contract every stale edit is a human decision, so parking
 *    them as blocked preserves the pending intent instead of dropping it.
 */
export async function migrateSyncState(): Promise<void> {
  const rows = await idb.getAll<Partial<QueuedOp> & { opId: string }>("outbox");
  const missing = rows
    .filter((r) => typeof r.seq !== "number")
    .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
  for (const row of missing) {
    await idb.put("outbox", { ...row, seq: await nextSeq() });
  }

  const legacy = await idb.getAll<ConflictEntry>("conflicts");
  for (const c of legacy) {
    const blocked: BlockedOp = {
      opId: c.opId,
      seq: await nextSeq(),
      entity: c.entity,
      entityId: c.entityId,
      op: "update",
      baseVersion:
        typeof c.serverState?.version === "number" ? (c.serverState.version as number) : 1,
      clientUpdatedAt: c.clientUpdatedAt,
      fields: c.fields,
      queuedAt: Date.parse(c.createdAt) || Date.now(),
      error: "VERSION_CONFLICT",
      message: "This offline edit collided with a newer server version.",
      serverState: c.serverState ?? null,
      blockedAt: c.createdAt || new Date().toISOString(),
    };
    await idb.put("blocked", blocked);
  }
  if (legacy.length > 0) await idb.replaceAll("conflicts", []);
}

// ---- flush ------------------------------------------------------------------

export interface FlushHandlers {
  onApplied?: (result: SyncResult, op: QueuedOp) => void | Promise<void>;
  /** The op that halted the queue — already persisted into the `blocked` store. */
  onBlocked?: (op: BlockedOp, result: SyncResult) => void | Promise<void>;
}

export interface FlushSummary {
  flushed: number;
  applied: number;
  blocked: number;
  held: number;
  /** True when the queue is (or became) halted by a blocked op. */
  halted: boolean;
}

/**
 * Send the queued operations (seq order) to POST /api/sync and dispatch
 * results: applied → removed from outbox, blocked → moved to the `blocked`
 * store (queue halts), held → left queued untouched.
 * A pre-existing blocked op halts everything — nothing is sent.
 * Throws on network failure (outbox is preserved for retry).
 */
export async function flushOutbox(handlers: FlushHandlers = {}): Promise<FlushSummary> {
  const summary: FlushSummary = { flushed: 0, applied: 0, blocked: 0, held: 0, halted: false };
  if ((await idb.count("blocked")) > 0) {
    summary.halted = true;
    return summary;
  }
  const rows = await getQueuedOps();
  if (rows.length === 0) return summary;

  const operations: SyncOp[] = rows.map(({ queuedAt: _q, ...op }) => op);
  const res = await api<SyncResponse>("/api/sync", {
    method: "POST",
    body: { clientId: getClientId(), operations },
  });

  const rowsByOpId = new Map(rows.map((r) => [r.opId, r]));
  const applied: Array<{ result: SyncResult; op: QueuedOp }> = [];
  let blockedPair: { result: SyncResult; op: QueuedOp } | null = null;
  for (const result of res.results ?? []) {
    const op = rowsByOpId.get(result.opId);
    if (!op) continue; // unknown opId — ignore defensively
    if (result.result === "applied") {
      applied.push({ result, op });
    } else if (result.result === "blocked") {
      // At most one under halt-on-failure; keep the first defensively.
      if (!blockedPair) blockedPair = { result, op };
    }
    // 'held' (and any op absent from results) stays queued untouched.
  }

  summary.applied = applied.length;
  summary.flushed = applied.length + (blockedPair ? 1 : 0);
  summary.blocked = blockedPair ? 1 : 0;
  summary.held = rows.length - summary.flushed;
  summary.halted = Boolean(blockedPair);

  // Applied ops leave the outbox in one transaction.
  await idb.bulkDel("outbox", applied.map((a) => a.op.opId));
  for (const { result, op } of applied) {
    await handlers.onApplied?.(result, op);
  }

  if (blockedPair) {
    const { result, op } = blockedPair;
    const blockedRow: BlockedOp = {
      ...op,
      error: result.error ?? null,
      message: result.message ?? null,
      serverState: result.serverState ?? null,
      blockedAt: new Date().toISOString(),
    };
    await idb.put("blocked", blockedRow);
    await idb.del("outbox", op.opId);
    await handlers.onBlocked?.(blockedRow, result);
  }

  return summary;
}
