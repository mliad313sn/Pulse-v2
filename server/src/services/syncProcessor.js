/**
 * Offline sync batch processor (POST /api/sync).
 * Each operation is recorded into sync_queue, then processed with OCC + LWW,
 * governance gates, and security routing — per the contract.
 */
import { ApiError, validation } from '../errors.js';
import { applyUpdate } from './occ.js';
import { ENTITY_DEFS, assertEnums, createEntity, pickWritable, runTaskGates } from './entityOps.js';
import { ensureSecurityRouting } from './securityRouting.js';

const ENTITIES = ['task', 'project', 'roadblock'];

export async function processSyncBatch(repo, user, body) {
  if (!body || typeof body.clientId !== 'string' || body.clientId.length === 0) {
    throw validation('clientId is required');
  }
  if (!Array.isArray(body.operations)) {
    throw validation('operations must be an array');
  }

  const results = [];
  for (const op of body.operations) {
    const queued = await repo.insertSyncOp({
      clientId: body.clientId,
      payload: {
        clientId: body.clientId,
        opId: op?.opId ?? null,
        entity: op?.entity,
        entityId: op?.entityId ?? null,
        op: op?.op,
        baseVersion: op?.baseVersion ?? null,
        clientUpdatedAt: op?.clientUpdatedAt ?? null,
        fields: op?.fields ?? {},
      },
    });

    let outcome;
    try {
      outcome = await repo.transaction(user.id, (tx) => processOperation(tx, user, op));
    } catch (err) {
      if (err instanceof ApiError) {
        outcome = {
          result: 'rejected',
          entityId: op?.entityId ?? null,
          serverState: err.detail?.serverState ?? null,
          error: err.code,
        };
      } else {
        throw err;
      }
    }

    await repo.markSyncOp(queued.id, {
      result: outcome.result,
      detail: { error: outcome.error ?? null, entityId: outcome.entityId ?? null },
    });

    results.push({
      opId: op?.opId ?? null,
      result: outcome.result,
      entity: op?.entity ?? null,
      entityId: outcome.entityId ?? op?.entityId ?? null,
      serverState: outcome.serverState ?? null,
      error: outcome.error ?? null,
    });
  }

  return { results, serverTime: new Date().toISOString() };
}

async function processOperation(repo, user, op) {
  if (!op || !ENTITIES.includes(op.entity)) {
    throw validation(`operation.entity must be one of ${ENTITIES.join(', ')}`);
  }
  const kind = op.entity;

  if (op.op === 'create') {
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
    if (!current) {
      return { result: 'rejected', entityId: op.entityId ?? null, error: 'NOT_FOUND', serverState: null };
    }

    const def = ENTITY_DEFS[kind];
    const fields = pickWritable(def, op.fields ?? {});
    // Enum violations surface as `rejected` with error VALIDATION via the
    // ApiError handling in processSyncBatch.
    assertEnums(def, fields);

    const { outcome, next } = applyUpdate(current, {
      baseVersion: op.baseVersion,
      clientUpdatedAt: op.clientUpdatedAt,
      fields,
    });

    if (outcome === 'conflict_manual') {
      return { result: 'conflict_manual', entityId: current.id, serverState: current, error: null };
    }

    // Governance gates still apply during sync (423 codes surface as `rejected`).
    await runTaskGates(repo, kind, current, fields);

    await repo.update(kind, next);
    await ensureSecurityRouting(repo, kind, next);
    return { result: outcome, entityId: next.id, error: null };
  }

  throw validation("operation.op must be 'create' or 'update'");
}
