/**
 * Offline sync batch processor (POST /api/sync) — ADR-003 executed (E25/E26).
 *
 * The client queue is an ordered command log (plan §57, SKILL §15): every
 * operation carries a client-assigned integer `seq` and the batch is processed
 * STRICTLY in ascending seq order (missing/duplicate seq -> the whole batch is
 * a 400 VALIDATION). Per-operation outcomes:
 *   - 'applied' — version-match update or idempotent create (replays of an
 *     already-applied opId are no-op 'applied');
 *   - 'blocked' — the FIRST op that fails for ANY reason: stale version
 *     (NO Last-Write-Wins, ever — any baseVersion mismatch is a conflict),
 *     gate violation, validation, authorization change, missing target.
 *     The result row carries {error, message, serverState?}. serverState is
 *     attached for VERSION_CONFLICT (the current entity, so the human can
 *     compare/reapply); concealment rules still apply — concealed projects
 *     block as NOT_FOUND with NO serverState, indistinguishable from a truly
 *     missing id;
 *   - 'held' — every op after the blocked one: untouched, NOT validated,
 *     returned so the client keeps them queued for the next replay.
 *
 * Processing stops at the first blocked op (invariant 19); the machine never
 * invents a merge (invariant 20). On halt, ONE audit event SYNC_HALTED
 * {clientId, opId, error} is written — per §172 the actor is the syncing user
 * (a real human replaying their own queue), flagged source 'sync' rather than
 * a fabricated SYSTEM user.
 * TODO(E19): notify admins of halted syncs through the notification engine —
 * the SYNC_HALTED audit event is the hook point; notification proper arrives
 * with the E19 epic.
 *
 * Every op is recorded in sync_queue with its outcome
 * ('applied' | 'blocked' | 'held').
 */
import { ApiError, validation, versionConflict } from '../errors.js';
import { applyUpdate } from './occ.js';
import {
  ENTITY_DEFS, assertImmutableFields, assertOperationalWrite,
  assertUpdateBusinessRules, createEntity, pickWritable,
  recordLifecycleCorrection, runTaskGates,
} from './entityOps.js';
import { assertCan, canReadAction, canReadProject } from './policy.js';
import { ensureSecurityRouting } from './securityRouting.js';

// E09: actions ride the offline sync protocol (field-level accountability
// edits from site tablets). Risks and CAPAs are deliberately ONLINE-ONLY
// (ADR-007): they are deliberate desk-side governance artifacts with
// transition rules that want fresh server state — a sync op naming them is
// refused like any unknown entity.
const ENTITIES = ['task', 'project', 'roadblock', 'milestone', 'workstream', 'action'];

export async function processSyncBatch(repo, user, body) {
  if (!body || typeof body.clientId !== 'string' || body.clientId.length === 0) {
    throw validation('clientId is required');
  }
  if (!Array.isArray(body.operations)) {
    throw validation('operations must be an array');
  }

  // The queue is an ORDERED command log: every op must carry a unique integer
  // seq. A batch that cannot be ordered is refused wholesale (400) — nothing
  // is queued or applied.
  const seen = new Set();
  for (const op of body.operations) {
    if (!Number.isInteger(op?.seq)) {
      throw validation('every operation must carry an integer seq (client-assigned ordering)');
    }
    if (seen.has(op.seq)) {
      throw validation(`duplicate operation seq: ${op.seq}`);
    }
    seen.add(op.seq);
  }
  const ordered = [...body.operations].sort((a, b) => a.seq - b.seq);

  const results = [];
  let haltedAt = null;
  let halted = false;

  for (const op of ordered) {
    const queued = await repo.insertSyncOp({
      clientId: body.clientId,
      payload: {
        clientId: body.clientId,
        opId: op?.opId ?? null,
        seq: op.seq,
        entity: op?.entity,
        entityId: op?.entityId ?? null,
        op: op?.op,
        baseVersion: op?.baseVersion ?? null,
        clientUpdatedAt: op?.clientUpdatedAt ?? null,
        fields: op?.fields ?? {},
      },
    });

    // Everything after the first blocked op is held: untouched, not validated.
    if (halted) {
      await repo.markSyncOp(queued.id, {
        result: 'held',
        detail: { error: null, entityId: op?.entityId ?? null },
      });
      results.push({
        opId: op?.opId ?? null,
        seq: op.seq,
        result: 'held',
        entity: op?.entity ?? null,
        entityId: op?.entityId ?? null,
        serverState: null,
        error: null,
        message: null,
      });
      continue;
    }

    let outcome;
    // Duplicate replay of an already-applied op (same clientId + opId) is a
    // no-op 'applied' — the command log is idempotent under replay (SKILL §15).
    const replayed = typeof op?.opId === 'string' && op.opId.length > 0
      ? await repo.findAppliedSyncOp(body.clientId, op.opId)
      : null;
    if (replayed && replayed.id !== queued.id) {
      outcome = {
        result: 'applied',
        entityId: op?.entityId ?? replayed.detail?.entityId ?? null,
        error: null,
      };
    } else {
      try {
        outcome = await repo.transaction(user.id, (tx) => processOperation(tx, user, op));
      } catch (err) {
        if (err instanceof ApiError) {
          outcome = {
            result: 'blocked',
            entityId: op?.entityId ?? null,
            serverState: err.detail?.serverState ?? null,
            error: err.code,
            message: err.message,
          };
        } else {
          throw err;
        }
      }
    }

    await repo.markSyncOp(queued.id, {
      result: outcome.result,
      detail: { error: outcome.error ?? null, entityId: outcome.entityId ?? null },
    });

    if (outcome.result === 'blocked') {
      halted = true;
      haltedAt = op?.opId ?? null;
      // ONE audit event per halted batch. Actor = the syncing user (§172),
      // flagged source 'sync'. E19 will hang admin notification off this.
      await repo.appendAudit({
        entityType: 'sync',
        entityId: null,
        action: 'SYNC_HALTED',
        actorId: user.id,
        newData: {
          clientId: body.clientId,
          opId: op?.opId ?? null,
          error: outcome.error,
          source: 'sync',
        },
      });
    }

    results.push({
      opId: op?.opId ?? null,
      seq: op.seq,
      result: outcome.result,
      entity: op?.entity ?? null,
      entityId: outcome.entityId ?? op?.entityId ?? null,
      serverState: outcome.serverState ?? null,
      error: outcome.error ?? null,
      message: outcome.message ?? null,
    });
  }

  return { results, haltedAt, serverTime: new Date().toISOString() };
}

/**
 * Processes ONE operation. Success -> {result: 'applied', entityId}; every
 * failure THROWS a typed ApiError which the batch loop turns into the
 * 'blocked' outcome (halting the batch).
 */
async function processOperation(repo, user, op) {
  if (!op || !ENTITIES.includes(op.entity)) {
    throw validation(`operation.entity must be one of ${ENTITIES.join(', ')}`);
  }
  const kind = op.entity;

  if (op.op === 'create') {
    // Same role wall as the REST route: project creation is ADMIN/DIVISION_LEAD.
    if (kind === 'project') assertCan(user, 'project:create');
    if (op.entityId) {
      const existing = await repo.get(kind, op.entityId);
      if (existing) {
        // Idempotent replay of an offline create.
        return { result: 'applied', entityId: existing.id, error: null };
      }
    }
    const created = await createEntity(repo, user, kind, op.fields ?? {}, { id: op.entityId ?? undefined });
    return { result: 'applied', entityId: created.id, error: null };
  }

  if (op.op === 'update') {
    const current = await repo.get(kind, op.entityId);
    // Concealment (ADR-005): entities of unreadable projects block exactly
    // like missing ids — sync results must not leak their existence, so this
    // NOT_FOUND deliberately carries NO serverState.
    const scopeProject = current
      ? (kind === 'project' ? current : await repo.get('project', current.projectId))
      : null;
    const members = scopeProject ? await repo.listProjectMembers(scopeProject.id) : [];
    if (!current || (scopeProject && !canReadProject(user, scopeProject, members))) {
      throw new ApiError(404, 'NOT_FOUND', `${kind} ${op.entityId} not found`);
    }
    // E09: general (projectId null) actions are concealed from everyone but
    // their owner/creator/ADMIN — same uniform NOT_FOUND, no serverState.
    if (kind === 'action' && !canReadAction(user, current, scopeProject, members)) {
      throw new ApiError(404, 'NOT_FOUND', `${kind} ${op.entityId} not found`);
    }

    // E04 membership-based write policy — authorization changes while offline
    // surface as `blocked`/FORBIDDEN.
    assertOperationalWrite(user, kind, current, scopeProject, members);

    const def = ENTITY_DEFS[kind];
    assertImmutableFields(def, current, op.fields ?? {});
    const fields = pickWritable(def, op.fields ?? {});
    // The same business rules as direct PATCH (enums, field rules, ADMIN-only
    // classification, E05 lifecycle guard, operating-status rules, refs) —
    // violations surface as `blocked` with the typed error code.
    await assertUpdateBusinessRules(repo, user, kind, current, fields);

    // Strict OCC — ANY baseVersion mismatch is a conflict (never LWW). The
    // serverState rides the VERSION_CONFLICT error so the human can compare.
    const { outcome, next } = applyUpdate(current, { baseVersion: op.baseVersion, fields });
    if (outcome !== 'applied') {
      throw versionConflict(current);
    }

    // Governance gates still apply during sync (423 codes surface as `blocked`).
    await runTaskGates(repo, kind, current, fields);

    await repo.update(kind, next);
    await recordLifecycleCorrection(repo, user, kind, current, next);
    await ensureSecurityRouting(repo, kind, next);
    return { result: 'applied', entityId: next.id, error: null };
  }

  throw validation("operation.op must be 'create' or 'update'");
}

/**
 * POST /api/sync/discard — the server-side audit trail §57 requires for an
 * EXPLICIT human discard of a queued offline op. The op itself lives
 * client-side (it was never applied here); this records who abandoned what,
 * permanently. Actor = the session user. When the target is resolvable, its
 * project scope is recorded so the audit read path can apply concealment
 * filtering to the entry.
 */
export async function recordSyncDiscard(repo, user, body) {
  if (!body || typeof body.opId !== 'string' || body.opId.length === 0) {
    throw validation('opId is required');
  }
  if (typeof body.entity !== 'string' || body.entity.length === 0) {
    throw validation('entity is required');
  }
  if (typeof body.entityId !== 'string' || body.entityId.length === 0) {
    throw validation('entityId is required');
  }
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    throw validation('reason must be a string');
  }

  let projectId = null;
  if (ENTITIES.includes(body.entity)) {
    const target = await repo.get(body.entity, body.entityId);
    projectId = body.entity === 'project' ? (target?.id ?? null) : (target?.projectId ?? null);
  }

  await repo.appendAudit({
    entityType: 'sync',
    entityId: null,
    action: 'SYNC_DISCARDED',
    actorId: user.id,
    newData: {
      opId: body.opId,
      entity: body.entity,
      entityId: body.entityId,
      projectId,
      reason: body.reason ?? null,
      source: 'sync',
    },
  });
}
