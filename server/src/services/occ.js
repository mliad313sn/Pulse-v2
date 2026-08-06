/**
 * Optimistic Concurrency Control (OCC) with Last-Write-Wins fallback.
 * Mirrors the offline-sync contract:
 *   - baseVersion === server.version  -> apply, version+1                -> 'applied'
 *   - baseVersion  <  server.version  -> LWW on clientUpdatedAt vs server updatedAt:
 *       client newer -> apply fields, version = server.version + 1      -> 'lww_applied'
 *       server newer -> do not apply                                    -> 'conflict_manual'
 *   - baseVersion  >  server.version  -> impossible under normal flow   -> 'conflict_manual'
 *
 * With `strict: true` (direct/online PATCH) the LWW fallback is disabled:
 * ANY mismatched baseVersion is a 'conflict_manual' outcome.
 *
 * Pure function: never mutates `current`.
 */
import { nowIso } from './time.js';

export function applyUpdate(current, { baseVersion, clientUpdatedAt, fields }, { strict = false } = {}) {
  const ts = nowIso();
  const applied = () => ({
    outcome: null,
    next: { ...current, ...fields, version: current.version + 1, updatedAt: ts },
  });

  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) {
    return { outcome: 'conflict_manual', next: current };
  }

  if (baseVersion === current.version) {
    return { ...applied(), outcome: 'applied' };
  }

  if (!strict && baseVersion < current.version) {
    const clientTs = clientUpdatedAt ? Date.parse(clientUpdatedAt) : NaN;
    const serverTs = current.updatedAt ? Date.parse(current.updatedAt) : 0;
    if (Number.isFinite(clientTs) && clientTs > serverTs) {
      return { ...applied(), outcome: 'lww_applied' };
    }
    return { outcome: 'conflict_manual', next: current };
  }

  // Strict mismatch, or baseVersion ahead of the server -> manual merge.
  return { outcome: 'conflict_manual', next: current };
}
