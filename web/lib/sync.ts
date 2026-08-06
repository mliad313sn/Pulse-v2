// Outbox flushing over POST /api/sync — exact contract shape:
// { clientId, operations: [{ opId, entity, entityId, op, baseVersion, clientUpdatedAt, fields }] }

import * as idb from "./db";
import { api } from "./api";
import type { QueuedOp, SyncOp, SyncResult } from "./types";

const CLIENT_ID_KEY = "opspm360:clientId";

export function getClientId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous-device";
  }
}

/** Enqueue an operation into the outbox (IndexedDB). */
export async function enqueueOp(op: SyncOp): Promise<void> {
  const row: QueuedOp = { ...op, queuedAt: Date.now() };
  await idb.put("outbox", row);
}

export function outboxCount(): Promise<number> {
  return idb.count("outbox");
}

export interface FlushHandlers {
  onApplied?: (result: SyncResult, op: QueuedOp | undefined) => void | Promise<void>;
  onConflict?: (op: QueuedOp, result: SyncResult) => void | Promise<void>;
  onRejected?: (op: QueuedOp | undefined, result: SyncResult) => void | Promise<void>;
}

export interface FlushSummary {
  flushed: number;
  applied: number;
  conflicts: number;
  rejected: number;
}

/**
 * Send every queued operation to POST /api/sync and dispatch results.
 * Throws on network failure (outbox is preserved for retry).
 */
export async function flushOutbox(handlers: FlushHandlers = {}): Promise<FlushSummary> {
  const rows = (await idb.getAll<QueuedOp>("outbox")).sort((a, b) => a.queuedAt - b.queuedAt);
  const summary: FlushSummary = { flushed: 0, applied: 0, conflicts: 0, rejected: 0 };
  if (rows.length === 0) return summary;

  const operations: SyncOp[] = rows.map(({ queuedAt: _q, ...op }) => op);
  const res = await api<{ results: SyncResult[]; serverTime: string }>("/api/sync", {
    method: "POST",
    body: { clientId: getClientId(), operations },
  });

  for (const result of res.results ?? []) {
    const op = rows.find((r) => r.opId === result.opId);
    await idb.del("outbox", result.opId);
    summary.flushed += 1;
    if (result.result === "applied" || result.result === "lww_applied") {
      summary.applied += 1;
      await handlers.onApplied?.(result, op);
    } else if (result.result === "conflict_manual") {
      summary.conflicts += 1;
      if (op) await handlers.onConflict?.(op, result);
    } else {
      summary.rejected += 1;
      await handlers.onRejected?.(op, result);
    }
  }
  return summary;
}
