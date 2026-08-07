/**
 * Optimistic Concurrency Control (OCC) — strict version matching, the ONLY
 * behavior since ADR-003 was executed (E25/E26 offline rework):
 *   - baseVersion === server.version -> apply fields, version+1 -> 'applied'
 *   - ANY other baseVersion (stale, ahead, missing, non-integer) -> 'conflict'
 *
 * There is deliberately NO Last-Write-Wins fallback and no mode flag: plan
 * §57/§58 + invariants 18-20 forbid machine-invented merges — every conflict
 * goes to human resolution with the current server state attached by the
 * caller (409 VERSION_CONFLICT online; 'blocked' in the sync protocol).
 *
 * Pure function: never mutates `current`.
 */
import { nowIso } from './time.js';

export function applyUpdate(current, { baseVersion, fields }) {
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)
      || baseVersion !== current.version) {
    return { outcome: 'conflict', next: current };
  }
  return {
    outcome: 'applied',
    next: { ...current, ...fields, version: current.version + 1, updatedAt: nowIso() },
  };
}
