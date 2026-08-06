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

describe('OCC applyUpdate matrix', () => {
  it('baseVersion === version -> applied, version+1, fields merged', () => {
    const current = base();
    const { outcome, next } = applyUpdate(current, {
      baseVersion: 3,
      clientUpdatedAt: '2026-08-01T13:00:00.000Z',
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

  it('stale baseVersion + newer clientUpdatedAt -> lww_applied with version = server+1', () => {
    const { outcome, next } = applyUpdate(base(), {
      baseVersion: 1,
      clientUpdatedAt: '2026-08-02T09:00:00.000Z', // newer than server updatedAt
      fields: { priority: 'high' },
    });
    assert.equal(outcome, 'lww_applied');
    assert.equal(next.version, 4);
    assert.equal(next.priority, 'high');
  });

  it('stale baseVersion + older clientUpdatedAt -> conflict_manual, unchanged', () => {
    const current = base();
    const { outcome, next } = applyUpdate(current, {
      baseVersion: 1,
      clientUpdatedAt: '2026-07-01T09:00:00.000Z', // older than server updatedAt
      fields: { priority: 'low' },
    });
    assert.equal(outcome, 'conflict_manual');
    assert.deepEqual(next, current);
  });

  it('stale baseVersion + equal clientUpdatedAt -> server wins (conflict_manual)', () => {
    const { outcome } = applyUpdate(base(), {
      baseVersion: 2,
      clientUpdatedAt: '2026-08-01T12:00:00.000Z',
      fields: { priority: 'low' },
    });
    assert.equal(outcome, 'conflict_manual');
  });

  it('stale baseVersion + missing/garbage clientUpdatedAt -> conflict_manual', () => {
    assert.equal(applyUpdate(base(), { baseVersion: 1, fields: {} }).outcome, 'conflict_manual');
    assert.equal(
      applyUpdate(base(), { baseVersion: 1, clientUpdatedAt: 'not-a-date', fields: {} }).outcome,
      'conflict_manual',
    );
  });

  it('baseVersion ahead of server -> conflict_manual', () => {
    const { outcome } = applyUpdate(base(), {
      baseVersion: 9,
      clientUpdatedAt: '2026-08-02T09:00:00.000Z',
      fields: { status: 'done' },
    });
    assert.equal(outcome, 'conflict_manual');
  });

  it('non-integer baseVersion -> conflict_manual', () => {
    assert.equal(applyUpdate(base(), { baseVersion: '3', fields: {} }).outcome, 'conflict_manual');
    assert.equal(applyUpdate(base(), { fields: {} }).outcome, 'conflict_manual');
  });
});
