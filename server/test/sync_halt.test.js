/**
 * E25/E26 — sync halt edge matrix (plan §57, SKILL §15, invariants 18-20):
 *   - seq validation: a batch that cannot be strictly ordered is refused
 *     wholesale (400 VALIDATION; nothing queued, nothing applied);
 *   - gate violations halt the batch (blocked + later ops held);
 *   - business-rule validation failures halt the batch;
 *   - the operations array may arrive out of order — processing and results
 *     follow ascending seq, across entities;
 *   - a halted batch writes exactly ONE SYNC_HALTED audit event.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('sync halt edge matrix (POST /api/sync)', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const syncHalts = async () => (await srv.repo.listAudit({ entityType: 'sync' }))
    .filter((e) => e.action === 'SYNC_HALTED');

  it('missing seq -> the WHOLE batch is 400 VALIDATION; nothing queued or applied', async () => {
    const before_ = (await srv.repo.listSyncQueue()).length;
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'seq-device',
        operations: [
          {
            opId: randomUUID(), entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 1, fields: { description: 'no seq on this op' },
          },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');
    assert.match(res.body.message, /seq/);
    assert.equal((await srv.repo.listSyncQueue()).length, before_, 'nothing recorded');
    const task = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(task.body.version, 1, 'nothing applied');
  });

  it('duplicate seq -> 400 VALIDATION; non-integer seq -> 400 VALIDATION', async () => {
    const dup = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'seq-device',
        operations: [
          {
            opId: randomUUID(), seq: 1, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 1, fields: { description: 'a' },
          },
          {
            opId: randomUUID(), seq: 1, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 2, fields: { description: 'b' },
          },
        ],
      },
    });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.error, 'VALIDATION');
    assert.match(dup.body.message, /seq/);

    const nonInt = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'seq-device',
        operations: [{
          opId: randomUUID(), seq: '1', entity: 'task', entityId: SEED.infraTask, op: 'update',
          baseVersion: 1, fields: { description: 'a' },
        }],
      },
    });
    assert.equal(nonInt.status, 400);
    assert.equal(nonInt.body.error, 'VALIDATION');
  });

  it('gate violation halts: blocked DEPENDENCY_LOCKED, later ops held WITHOUT validation; ONE SYNC_HALTED audit', async () => {
    const opBlocked = randomUUID();
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'gate-device',
        operations: [
          {
            opId: randomUUID(), seq: 1, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 1, fields: { description: 'prep notes from the field' },
          },
          {
            // infraTask is dependency-locked behind opsTask (in_progress) -> 423 code.
            opId: opBlocked, seq: 2, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 2, fields: { status: 'in_progress' },
          },
          {
            // Would ALSO fail (moussa has no write authority on the bizapps
            // project) — but a held op is never validated, so no error surfaces.
            opId: randomUUID(), seq: 3, entity: 'task', entityId: SEED.erpTask, op: 'update',
            baseVersion: 1, fields: { status: 'in_progress' },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'blocked', 'held']);
    assert.equal(res.body.haltedAt, opBlocked);
    assert.equal(res.body.results[1].error, 'DEPENDENCY_LOCKED');
    assert.ok(res.body.results[1].message);
    assert.equal(res.body.results[2].error, null, 'held op carries no error — it was never validated');

    // First op really applied; blocked/held really did not touch anything.
    const infra = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(infra.body.version, 2);
    assert.equal(infra.body.description, 'prep notes from the field');
    assert.equal(infra.body.status, 'todo');
    const erp = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.moussa });
    assert.equal(erp.body.version, 1);
    assert.equal(erp.body.status, 'todo');

    // Exactly ONE audit event for the halted batch.
    const halts = await syncHalts();
    assert.equal(halts.length, 1);
    assert.equal(halts[0].actorId, USERS.moussa);
    assert.deepEqual(
      { clientId: halts[0].newData.clientId, opId: halts[0].newData.opId, error: halts[0].newData.error },
      { clientId: 'gate-device', opId: opBlocked, error: 'DEPENDENCY_LOCKED' },
    );
  });

  it('validation failure halts: blocked VALIDATION, later ops held', async () => {
    const opBad = randomUUID();
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'validation-device',
        operations: [
          {
            opId: opBad, seq: 1, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 2, fields: { status: 'not-a-status' },
          },
          {
            opId: randomUUID(), seq: 2, entity: 'task', entityId: SEED.infraTask, op: 'update',
            baseVersion: 2, fields: { priority: 'high' },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['blocked', 'held']);
    assert.equal(res.body.haltedAt, opBad);
    assert.equal(res.body.results[0].error, 'VALIDATION');

    const infra = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(infra.body.version, 2, 'neither op applied');
    assert.equal(infra.body.priority, 'critical');

    // A second halted batch appends a second (single) SYNC_HALTED event.
    assert.equal((await syncHalts()).length, 2);
  });

  it('multi-entity batch: the operations array may arrive OUT of order — seq governs processing and result order', async () => {
    const wsId = randomUUID();
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.troy,
      body: {
        clientId: 'order-device',
        operations: [
          {
            // Listed FIRST but seq 3: updates the workstream created by seq 1
            // and references the version produced by seq 2 — only strict
            // ascending-seq processing can apply it.
            opId: randomUUID(), seq: 3, entity: 'workstream', entityId: wsId, op: 'update',
            baseVersion: 2, fields: { status: 'DONE' },
          },
          {
            opId: randomUUID(), seq: 2, entity: 'workstream', entityId: wsId, op: 'update',
            baseVersion: 1, fields: { status: 'IN_PROGRESS' },
          },
          {
            opId: randomUUID(), seq: 1, entity: 'workstream', entityId: wsId, op: 'create',
            fields: { projectId: SEED.project1, title: 'Out-of-order stream' },
          },
          {
            opId: randomUUID(), seq: 4, entity: 'roadblock', entityId: randomUUID(), op: 'create',
            fields: { projectId: SEED.project1, description: 'Cross-entity op rides the same ordered log' },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.seq), [1, 2, 3, 4], 'results in seq order');
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied', 'applied', 'applied']);
    assert.equal(res.body.haltedAt, null);

    const ws = (await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.troy }))
      .body.find((w) => w.id === wsId);
    assert.equal(ws.status, 'DONE');
    assert.equal(ws.version, 3);
  });
});
