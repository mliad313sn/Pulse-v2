/**
 * SC1 — Resilience & offline sync, per the ADR-003-executed contract
 * (plan §57/§58, invariants 18-20):
 *   - the batch is an ORDERED command log (client-assigned integer seq);
 *   - a version-match update / idempotent create -> 'applied';
 *   - the FIRST failing op -> 'blocked' (ANY stale baseVersion is a
 *     VERSION_CONFLICT — LWW is gone) with serverState for human comparison;
 *   - every later op -> 'held' (untouched, not validated, stays queued);
 *   - the client fixes and resends -> applied; duplicate replays of applied
 *     ops are idempotent no-ops;
 *   - concealed projects block as NOT_FOUND with NO serverState;
 *   - discarding a queued op is an explicit, audited act (POST /api/sync/discard).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('SC1 — offline sync via POST /api/sync (ordered, halt-on-first-failure)', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const newRoadblockId = randomUUID();
  // Stable opIds so later tests can replay them verbatim.
  const opTaskUpdate = randomUUID();
  const opRoadblockCreate = randomUUID();
  const opStale = randomUUID();
  const opHeld = randomUUID();

  it('applies an ordered batch: task update AND roadblock create; haltedAt null', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [
          {
            opId: opTaskUpdate,
            seq: 1,
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 1,
            clientUpdatedAt: new Date().toISOString(),
            fields: { status: 'in_progress' },
          },
          {
            opId: opRoadblockCreate,
            seq: 2,
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
    assert.equal(res.body.haltedAt, null);
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
    assert.equal(created.status, 'RAISED');
    assert.equal(created.version, 1);
  });

  it('ANY stale baseVersion -> blocked VERSION_CONFLICT (no LWW ever, however "new" the client edit); later ops held and NOT applied', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [
          {
            opId: randomUUID(),
            seq: 1,
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 2,
            fields: { priority: 'high' },
          },
          {
            opId: opStale,
            seq: 2,
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 1, // stale — server is at 3 after op seq 1
            // A FUTURE client timestamp must be irrelevant: the LWW branch is gone.
            clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
            fields: { priority: 'low' },
          },
          {
            opId: opHeld,
            seq: 3,
            entity: 'roadblock',
            entityId: newRoadblockId,
            op: 'update',
            baseVersion: 1,
            fields: { status: 'IN_PROGRESS' },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'blocked', 'held']);
    assert.equal(res.body.haltedAt, opStale, 'haltedAt names the blocked op');

    const blocked = res.body.results[1];
    assert.equal(blocked.error, 'VERSION_CONFLICT');
    assert.ok(blocked.message, 'blocked rows carry a human message');
    assert.ok(blocked.serverState, 'serverState returned for human comparison');
    assert.equal(blocked.serverState.id, SEED.erpTask);
    assert.equal(blocked.serverState.version, 3);
    assert.equal(blocked.serverState.priority, 'high'); // untouched by the losing write

    const held = res.body.results[2];
    assert.equal(held.error, null);
    assert.equal(held.serverState, null);

    // The stale write did NOT apply, and the held op was NOT even attempted.
    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.priority, 'high');
    assert.equal(task.body.version, 3);
    const rbs = await srv.api('GET', `/api/roadblocks?projectId=${SEED.project3}`, { user: USERS.ibrahima });
    const rb = rbs.body.find((r) => r.id === newRoadblockId);
    assert.equal(rb.status, 'RAISED', 'held op left the roadblock untouched');
    assert.equal(rb.version, 1);

    // The halt was audited ONCE — actor is the syncing user, source 'sync'.
    const halts = (await srv.repo.listAudit({ entityType: 'sync' }))
      .filter((e) => e.action === 'SYNC_HALTED');
    assert.equal(halts.length, 1);
    assert.equal(halts[0].actorId, USERS.ibrahima);
    assert.equal(halts[0].newData.clientId, 'device-tablet-01');
    assert.equal(halts[0].newData.opId, opStale);
    assert.equal(halts[0].newData.error, 'VERSION_CONFLICT');
    assert.equal(halts[0].newData.source, 'sync');
  });

  it('resume: the client fixes baseVersion and resends the blocked + held ops -> applied', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [
          {
            opId: opStale, // same opId: a blocked op stays retryable
            seq: 1,
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 3, // corrected against the current server version
            fields: { priority: 'low' },
          },
          {
            opId: opHeld,
            seq: 2,
            entity: 'roadblock',
            entityId: newRoadblockId,
            op: 'update',
            baseVersion: 1,
            fields: { status: 'IN_PROGRESS' },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied']);
    assert.equal(res.body.haltedAt, null);

    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.priority, 'low');
    assert.equal(task.body.version, 4);
    const rbs = await srv.api('GET', `/api/roadblocks?projectId=${SEED.project3}`, { user: USERS.ibrahima });
    const rb = rbs.body.find((r) => r.id === newRoadblockId);
    assert.equal(rb.status, 'IN_PROGRESS');
    assert.equal(rb.version, 2);
  });

  it('duplicate replay of already-applied ops (create AND update) is an idempotent no-op "applied"', async () => {
    // The exact first batch again (network-loss replay): same opIds, now-stale versions.
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'device-tablet-01',
        operations: [
          {
            opId: opTaskUpdate,
            seq: 1,
            entity: 'task',
            entityId: SEED.erpTask,
            op: 'update',
            baseVersion: 1,
            fields: { status: 'in_progress' },
          },
          {
            opId: opRoadblockCreate,
            seq: 2,
            entity: 'roadblock',
            entityId: newRoadblockId,
            op: 'create',
            fields: {
              projectId: SEED.project3,
              description: 'Generator outage at Sabodala blocked staging window',
            },
          },
        ],
      },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied']);
    assert.equal(res.body.haltedAt, null);

    // Nothing actually changed: no double-apply, no version bump, no conflict.
    const task = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.ibrahima });
    assert.equal(task.body.version, 4);
    assert.equal(task.body.priority, 'low');
    const rbs = await srv.api('GET', `/api/roadblocks?projectId=${SEED.project3}`, { user: USERS.ibrahima });
    const rb = rbs.body.find((r) => r.id === newRoadblockId);
    assert.equal(rb.version, 2);
    assert.equal(rb.status, 'IN_PROGRESS');
  });

  it('concealed project -> blocked NOT_FOUND with NO serverState (ADR-005)', async () => {
    const proj = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Covert Sync Target', division: 'management', classification: 'confidential' },
    });
    assert.equal(proj.status, 201);
    const confTask = await srv.api('POST', '/api/tasks', {
      user: USERS.troy,
      body: { projectId: proj.body.id, title: 'hidden work' },
    });
    assert.equal(confTask.status, 201);

    const opId = randomUUID();
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.awa, // ops CONTRIBUTOR: cannot read the confidential project
      body: {
        clientId: 'outsider-device',
        operations: [{
          opId,
          seq: 1,
          entity: 'task',
          entityId: confTask.body.id,
          op: 'update',
          baseVersion: 1,
          fields: { status: 'in_progress' },
        }],
      },
    });

    assert.equal(res.status, 200);
    const row = res.body.results[0];
    assert.equal(row.result, 'blocked');
    assert.equal(row.error, 'NOT_FOUND');
    assert.equal(row.serverState, null, 'concealment: no server state leaks');
    assert.equal(res.body.haltedAt, opId);
  });

  it('POST /api/sync/discard records an explicit, audited SYNC_DISCARDED event (204)', async () => {
    const opId = randomUUID();
    const res = await srv.api('POST', '/api/sync/discard', {
      user: USERS.ibrahima,
      body: {
        opId,
        entity: 'task',
        entityId: SEED.erpTask,
        reason: 'edit superseded by the office change; abandoning my offline copy',
      },
    });
    assert.equal(res.status, 204);

    const discards = (await srv.repo.listAudit({ entityType: 'sync' }))
      .filter((e) => e.action === 'SYNC_DISCARDED');
    assert.equal(discards.length, 1);
    assert.equal(discards[0].actorId, USERS.ibrahima);
    assert.equal(discards[0].newData.opId, opId);
    assert.equal(discards[0].newData.entity, 'task');
    assert.equal(discards[0].newData.entityId, SEED.erpTask);
    assert.equal(discards[0].newData.projectId, SEED.project3);
    assert.match(discards[0].newData.reason, /superseded/);
    assert.equal(discards[0].newData.source, 'sync');

    // Bad payloads are refused.
    const noOpId = await srv.api('POST', '/api/sync/discard', {
      user: USERS.ibrahima, body: { entity: 'task', entityId: SEED.erpTask },
    });
    assert.equal(noOpId.status, 400);
    assert.equal(noOpId.body.error, 'VALIDATION');
  });

  it('records every operation into the sync queue with its outcome', async () => {
    const queue = await srv.repo.listSyncQueue();
    assert.equal(queue.length, 10);
    assert.ok(queue.every((q) => q.processedAt !== null));
    assert.deepEqual(
      queue.map((q) => q.result),
      [
        'applied', 'applied', // batch 1
        'applied', 'blocked', 'held', // stale batch
        'applied', 'applied', // resume batch
        'applied', 'applied', // idempotent replay batch
        'blocked', // concealed target
      ],
    );
    assert.equal(queue[0].clientId, 'device-tablet-01');
    assert.equal(queue[0].payload.seq, 1);
  });
});
