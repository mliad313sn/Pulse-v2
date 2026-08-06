/**
 * Optimistic Concurrency Control (OCC) with Last-Write-Wins fallback.
 * Mirrors the offline-sync contract:
 *   - baseVersion === server.version  -> apply, version+1                -> 'applied'
 *   - baseVersion  <  server.version  -> LWW on clientUpdatedAt vs server updatedAt:
 *       client newer -> apply fields, version = server.version + 1      -> 'lww_applied'
 *       server newer -> do not apply                                    -> 'conflict_manual'
 *   - baseVersion  >  server.version  -> impossible under normal flow   -> 'conflict_manual'
 *
 * Pure function: never mutates `current`.
 */
export function applyUpdate(current, { baseVersion, clientUpdatedAt, fields }) {
  const nowIso = new Date().toISOString();
  const applied = () => ({
    outcome: null,
    next: { ...current, ...fields, version: current.version + 1, updatedAt: nowIso },
  });

  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) {
    return { outcome: 'conflict_manual', next: current };
  }

  if (baseVersion === current.version) {
    return { ...applied(), outcome: 'applied' };
  }

  if (baseVersion < current.version) {
    const clientTs = clientUpdatedAt ? Date.parse(clientUpdatedAt) : NaN;
    const serverTs = current.updatedAt ? Date.parse(current.updatedAt) : 0;
    if (Number.isFinite(clientTs) && clientTs > serverTs) {
      return { ...applied(), outcome: 'lww_applied' };
    }
    return { outcome: 'conflict_manual', next: current };
  }

  // baseVersion ahead of the server: client state is inconsistent -> manual merge.
  return { outcome: 'conflict_manual', next: current };
}
