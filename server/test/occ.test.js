import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdate } from '../src/services/occ.js';

const base = () => ({
  id: 'e1',
  status: 'todo',
  priority: 'normal',
  version: 3,
  updatedAt: '2026-08-01T12:00:00.000Z',
});

describe('OCC applyUpdate matrix (strict-only — ADR-003 executed, no LWW)', () => {
  it('baseVersion === version -> applied, version+1, fields merged', () => {
    const current = base();
    const { outcome, next } = applyUpdate(current, {
      baseVersion: 3,
      fields: { status: 'done' },
    });
    assert.equal(outcome, 'applied');
    assert.equal(next.version, 4);
    assert.equal(next.status, 'done');
    assert.equal(next.priority, 'normal');
    // never mutates the input
    assert.equal(current.version, 3);
    assert.equal(current.status, 'todo');
  });

  it('stale baseVersion -> conflict, unchanged — even with a NEWER client timestamp (the LWW branch is gone)', () => {
    const current = base();
    const { outcome, next } = applyUpdate(current, {
      baseVersion: 1,
      // Formerly the lww_applied case; clientUpdatedAt no longer exists in the
      // OCC contract and any extra property is simply ignored.
      clientUpdatedAt: '2026-08-02T09:00:00.000Z',
      fields: { priority: 'high' },
    });
    assert.equal(outcome, 'conflict');
    assert.deepEqual(next, current);
  });

  it('stale baseVersion + older client timestamp -> conflict, unchanged', () => {
    const current = base();
    const { outcome, next } = applyUpdate(current, {
      baseVersion: 1,
      clientUpdatedAt: '2026-07-01T09:00:00.000Z',
      fields: { priority: 'low' },
    });
    assert.equal(outcome, 'conflict');
    assert.deepEqual(next, current);
  });

  it('stale baseVersion one behind -> conflict (no timestamp can rescue it)', () => {
    const { outcome } = applyUpdate(base(), {
      baseVersion: 2,
      clientUpdatedAt: '2026-08-01T12:00:00.000Z',
      fields: { priority: 'low' },
    });
    assert.equal(outcome, 'conflict');
  });

  it('baseVersion ahead of server -> conflict', () => {
    const { outcome } = applyUpdate(base(), {
      baseVersion: 9,
      fields: { status: 'done' },
    });
    assert.equal(outcome, 'conflict');
  });

  it('non-integer / missing baseVersion -> conflict', () => {
    assert.equal(applyUpdate(base(), { baseVersion: '3', fields: {} }).outcome, 'conflict');
    assert.equal(applyUpdate(base(), { baseVersion: 3.5, fields: {} }).outcome, 'conflict');
    assert.equal(applyUpdate(base(), { fields: {} }).outcome, 'conflict');
  });
});
