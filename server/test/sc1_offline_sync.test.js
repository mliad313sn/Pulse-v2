/**
 * SC1 — Resilience & offline sync: a batch containing a task update and a
 * roadblock created offline both apply through POST /api/sync with OCC;
 * stale-but-newer edits LWW-apply; stale-and-older edits flag manual conflict
 * with the server state attached.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('SC1 — offline sync via POST /api/sync', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const newRoadblockId = randomUUID();

  it('applies an offline task update AND an offline roadblock create in one batch', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [
          {
            opId: randomUUID(),
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 1,
            clientUpdatedAt: new Date().toISOString(),
            fields: { status: 'in_progress' },
          },
          {
            opId: randomUUID(),
            entity: 'roadblock',
            entityId: newRoadblockId,
            op: 'create',
            clientUpdatedAt: new Date().toISOString(),
            fields: {
              projectId: SEED.project3,
              description: 'Generator outage at Sabodala blocked staging window',
            },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 2);
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied']);
    assert.ok(res.body.serverTime);

    // Task really updated + version incremented 1 -> 2
    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.status, 'in_progress');
    assert.equal(task.body.version, 2);

    // Roadblock exists with the client-chosen UUID and defaulted fields
    const rbs = await srv.api('GET', `/api/roadblocks?projectId=${SEED.project3}`, { user: USERS.ibrahima });
    const created = rbs.body.find((r) => r.id === newRoadblockId);
    assert.ok(created, 'offline-created roadblock present');
    assert.equal(created.severity, 'medium');
    assert.equal(created.status, 'open');
    assert.equal(created.version, 1);
  });

  it('stale baseVersion with NEWER clientUpdatedAt -> lww_applied, version = server+1', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [{
          opId: randomUUID(),
          entity: 'task',
          entityId: SEED.erpTask,
          op: 'update',
          baseVersion: 1, // server is at 2 now
          clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(), // newer than server
          fields: { priority: 'high' },
        }],
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].result, 'lww_applied');

    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.priority, 'high');
    assert.equal(task.body.version, 3); // server 2 + 1
  });

  it('stale baseVersion with OLDER clientUpdatedAt -> conflict_manual with serverState', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [{
          opId: randomUUID(),
          entity: 'task',
          entityId: SEED.erpTask,
          op: 'update',
          baseVersion: 1,
          clientUpdatedAt: '2020-01-01T00:00:00.000Z', // server is newer
          fields: { priority: 'low' },
        }],
      },
    });

    assert.equal(res.status, 200);
    const result = res.body.results[0];
    assert.equal(result.result, 'conflict_manual');
    assert.ok(result.serverState, 'serverState returned for manual merge');
    assert.equal(result.serverState.id, SEED.erpTask);
    assert.equal(result.serverState.version, 3);
    assert.equal(result.serverState.priority, 'high'); // untouched by the losing write

    // and the server entity was NOT modified
    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.priority, 'high');
    assert.equal(task.body.version, 3);
  });

  it('records every operation into the sync queue with its result', async () => {
    const queue = await srv.repo.listSyncQueue();
    assert.equal(queue.length, 4);
    assert.ok(queue.every((q) => q.processedAt !== null));
    assert.deepEqual(
      queue.map((q) => q.result),
      ['applied', 'applied', 'lww_applied', 'conflict_manual'],
    );
    assert.equal(queue[0].clientId, 'device-tablet-01');
  });
});
