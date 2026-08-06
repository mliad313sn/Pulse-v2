/**
 * Immutable in-memory audit ledger (CGEIT compliance) — mirrors the pg
 * audit_logs table + trg_audit_immutable trigger for the MemoryRepo.
 * Push-only: entries are deep-frozen; query() returns frozen views.
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function createAuditLedger() {
  const entries = [];
  let nextId = 1;

  const ledger = {
    /**
     * @param {{entityType:string, entityId:string|null, action:'INSERT'|'UPDATE'|'DELETE',
     *          actorId:string|null, cgeitTag?:string|null, oldData?:object|null, newData?:object|null}} e
     */
    append(e) {
      const entry = deepFreeze({
        id: nextId++,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        action: e.action,
        actorId: e.actorId ?? null,
        cgeitTag: e.cgeitTag ?? null,
        oldData: e.oldData ?? null,
        newData: e.newData ?? null,
        createdAt: new Date().toISOString(),
      });
      entries.push(entry);
      return entry;
    },

    /** Read-only view; the returned array (and its entries) are frozen. */
    query({ entityId, entityType } = {}) {
      let out = entries;
      if (entityId != null) out = out.filter((e) => e.entityId === entityId);
      if (entityType != null) out = out.filter((e) => e.entityType === entityType);
      return Object.freeze([...out]);
    },

    get size() {
      return entries.length;
    },
  };

  return Object.freeze(ledger);
}
