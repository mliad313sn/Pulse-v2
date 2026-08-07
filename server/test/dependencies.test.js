/**
 * E07 core — Typed task dependencies (plan §20): typed edges (FS/SS/FF/SF,
 * lagDays), duplicate 409 / bad payload 400, self-dependency, cycle rejection
 * (direct + transitive, across types, unit-tested DFS), cross-project 400,
 * FS locking (derived `locked` + 423 detail with blocking predecessor ids),
 * SS/FF/SF never lock, delete unlocks, authz + concealment.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';
import { findCyclePath } from '../src/services/dependencies.js';

describe('E07 — typed task dependencies + cycle prevention', () => {
  let srv;
  const task = {}; // name -> created task row (all on project1)

  before(async () => {
    srv = await startServer();
    for (const name of ['a', 'b', 'c', 'd', 'p', 's', 'p2', 's2']) {
      const res = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: `dep-graph task ${name}` },
      });
      assert.equal(res.status, 201);
      task[name] = res.body;
    }
  });
  after(async () => { await srv.close(); });

  const mkDep = (body, user = USERS.troy) =>
    srv.api('POST', '/api/dependencies', { user, body });

  describe('findCyclePath (pure DFS unit tests)', () => {
    it('detects a direct cycle', () => {
      const edges = [{ predecessorId: 'A', successorId: 'B' }];
      assert.ok(findCyclePath(edges, 'B', 'A')); // adding B->A closes A->B->A
      assert.equal(findCyclePath(edges, 'A', 'B'), null); // duplicate edge is not a cycle
    });

    it('detects a transitive cycle across any edge types', () => {
      const edges = [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'C' },
        { predecessorId: 'C', successorId: 'D' },
      ];
      const path = findCyclePath(edges, 'D', 'A'); // D->A + A..D chain
      assert.deepEqual(path, ['A', 'B', 'C', 'D']);
      assert.equal(findCyclePath(edges, 'A', 'D'), null);
    });

    it('flags self-dependency', () => {
      assert.ok(findCyclePath([], 'A', 'A'));
    });
  });

  describe('creation + validation', () => {
    it('creates an FS edge by default with lagDays 0', async () => {
      const res = await mkDep({ predecessorId: task.a.id, successorId: task.b.id });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.projectId, SEED.project1);
      assert.equal(res.body.predecessorId, task.a.id);
      assert.equal(res.body.successorId, task.b.id);
      assert.equal(res.body.type, 'FS');
      assert.equal(res.body.lagDays, 0);
      assert.ok(res.body.id);
    });

    it('creates typed edges (SS with lag) — same pair, different type is allowed', async () => {
      const ss = await mkDep({ predecessorId: task.a.id, successorId: task.b.id, type: 'SS', lagDays: 2 });
      assert.equal(ss.status, 201, JSON.stringify(ss.body));
      assert.equal(ss.body.type, 'SS');
      assert.equal(ss.body.lagDays, 2);

      const ff = await mkDep({ predecessorId: task.b.id, successorId: task.c.id, type: 'FF', lagDays: -1 });
      assert.equal(ff.status, 201);
      assert.equal(ff.body.lagDays, -1); // negative lag = lead
    });

    it('duplicate (predecessor, successor, type) -> 409 DUPLICATE', async () => {
      const dup = await mkDep({ predecessorId: task.a.id, successorId: task.b.id, type: 'FS' });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error, 'DUPLICATE');
    });

    it('bad type / non-integer lagDays / missing or unknown tasks -> 400', async () => {
      assert.equal((await mkDep({ predecessorId: task.a.id, successorId: task.c.id, type: 'XX' })).status, 400);
      assert.equal((await mkDep({ predecessorId: task.a.id, successorId: task.c.id, lagDays: 1.5 })).status, 400);
      assert.equal((await mkDep({ successorId: task.c.id })).status, 400);
      const unknown = await mkDep({ predecessorId: '99999999-0000-0000-0000-000000000000', successorId: task.c.id });
      assert.equal(unknown.status, 400);
      assert.equal(unknown.body.detail.field, 'predecessorId');
    });

    it('self-dependency -> 400', async () => {
      const res = await mkDep({ predecessorId: task.a.id, successorId: task.a.id });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'VALIDATION');
    });

    it('cross-project dependency -> 400', async () => {
      const res = await mkDep({ predecessorId: task.a.id, successorId: SEED.erpTask });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /same project/);
    });

    it('direct cycle -> 400 VALIDATION "dependency cycle"', async () => {
      const res = await mkDep({ predecessorId: task.b.id, successorId: task.a.id });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /dependency cycle/);
    });

    it('transitive cycle (across edge types) -> 400 with the offending path', async () => {
      // Existing: a->b (FS+SS), b->c (FF). Adding c->a closes a cycle THROUGH
      // mixed types.
      const res = await mkDep({ predecessorId: task.c.id, successorId: task.a.id, type: 'SF' });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /dependency cycle/);
      assert.deepEqual(res.body.detail.path, [task.a.id, task.b.id, task.c.id]);

      // The non-cyclic direction still works.
      const ok = await mkDep({ predecessorId: task.c.id, successorId: task.d.id });
      assert.equal(ok.status, 201);
    });
  });

  describe('authz + concealment', () => {
    it('writes require manage-level authority: contributor/owner 403, VIEWER 403', async () => {
      // Awa owns project1 but ownership is not manage-level for dependencies.
      const asOwner = await mkDep({ predecessorId: task.p.id, successorId: task.s.id }, USERS.awa);
      assert.equal(asOwner.status, 403);

      const asViewer = await mkDep({ predecessorId: task.p.id, successorId: task.s.id }, USERS.aissatou);
      assert.equal(asViewer.status, 403);
    });

    it('GET /api/projects/:id/dependencies lists the project edges; DELETE unknown id 404', async () => {
      const list = await srv.api('GET', `/api/projects/${SEED.project1}/dependencies`, { user: USERS.awa });
      assert.equal(list.status, 200);
      assert.ok(list.body.length >= 4);
      assert.ok(list.body.every((d) => d.projectId === SEED.project1));

      const missing = await srv.api('DELETE', '/api/dependencies/99999999-0000-0000-0000-000000000000', { user: USERS.troy });
      assert.equal(missing.status, 404);
    });

    it('dependencies of confidential projects are concealed (list, direct, delete)', async () => {
      const p1 = (await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy })).body;
      await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
        user: USERS.troy, body: { version: p1.version, classification: 'confidential' },
      });

      const edge = (await srv.api('GET', `/api/projects/${SEED.project1}/dependencies`, { user: USERS.troy })).body[0];

      const list = await srv.api('GET', '/api/dependencies', { user: USERS.ibrahima });
      assert.ok(!list.body.some((d) => d.projectId === SEED.project1));

      const scoped = await srv.api('GET', `/api/projects/${SEED.project1}/dependencies`, { user: USERS.ibrahima });
      assert.equal(scoped.status, 404);

      const del = await srv.api('DELETE', `/api/dependencies/${edge.id}`, { user: USERS.ibrahima });
      assert.equal(del.status, 404); // concealed — same as missing id

      // Creating an edge between concealed tasks leaks nothing either.
      const create = await mkDep({ predecessorId: task.a.id, successorId: task.c.id }, USERS.ibrahima);
      assert.equal(create.status, 400);
      assert.match(create.body.message, /Unknown predecessorId/);

      const p1b = (await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy })).body;
      await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
        user: USERS.troy, body: { version: p1b.version, classification: 'internal' },
      });
    });
  });

  describe('FS locking (back-compat with dependencyLock semantics)', () => {
    it('an FS predecessor that is not done locks the successor: derived locked + 423 detail', async () => {
      const edge = await mkDep({ predecessorId: task.p.id, successorId: task.s.id, type: 'FS' });
      assert.equal(edge.status, 201);

      const got = await srv.api('GET', `/api/tasks/${task.s.id}`, { user: USERS.troy });
      assert.equal(got.body.locked, true);

      const advance = await srv.api('PATCH', `/api/tasks/${task.s.id}`, {
        user: USERS.troy, body: { version: got.body.version, status: 'in_progress' },
      });
      assert.equal(advance.status, 423);
      assert.equal(advance.body.error, 'DEPENDENCY_LOCKED');
      assert.deepEqual(advance.body.detail.blockingPredecessorIds, [task.p.id]);

      // Completing the predecessor unlocks the successor.
      const p = (await srv.api('GET', `/api/tasks/${task.p.id}`, { user: USERS.troy })).body;
      const done = await srv.api('PATCH', `/api/tasks/${task.p.id}`, {
        user: USERS.troy, body: { version: p.version, status: 'done' },
      });
      assert.equal(done.status, 200);

      const after = await srv.api('GET', `/api/tasks/${task.s.id}`, { user: USERS.troy });
      assert.equal(after.body.locked, false);
      const advance2 = await srv.api('PATCH', `/api/tasks/${task.s.id}`, {
        user: USERS.troy, body: { version: after.body.version, status: 'in_progress' },
      });
      assert.equal(advance2.status, 200);
    });

    it('SS/FF/SF edges do NOT lock (scheduling semantics only)', async () => {
      const ss = await mkDep({ predecessorId: task.p2.id, successorId: task.s2.id, type: 'SS' });
      assert.equal(ss.status, 201);

      const got = await srv.api('GET', `/api/tasks/${task.s2.id}`, { user: USERS.troy });
      assert.equal(got.body.locked, false);
      const advance = await srv.api('PATCH', `/api/tasks/${task.s2.id}`, {
        user: USERS.troy, body: { version: got.body.version, status: 'in_progress' },
      });
      assert.equal(advance.status, 200);
      // reset for the next test
      await srv.api('PATCH', `/api/tasks/${task.s2.id}`, {
        user: USERS.troy, body: { version: advance.body.version, status: 'todo' },
      });
    });

    it('deleting the FS edge unlocks the successor', async () => {
      const edge = await mkDep({ predecessorId: task.p2.id, successorId: task.s2.id, type: 'FS' });
      assert.equal(edge.status, 201);

      const locked = await srv.api('GET', `/api/tasks/${task.s2.id}`, { user: USERS.troy });
      assert.equal(locked.body.locked, true);
      const blocked = await srv.api('PATCH', `/api/tasks/${task.s2.id}`, {
        user: USERS.troy, body: { version: locked.body.version, status: 'in_progress' },
      });
      assert.equal(blocked.status, 423);

      const del = await srv.api('DELETE', `/api/dependencies/${edge.body.id}`, { user: USERS.troy });
      assert.equal(del.status, 204);

      const unlocked = await srv.api('GET', `/api/tasks/${task.s2.id}`, { user: USERS.troy });
      assert.equal(unlocked.body.locked, false);
      const advance = await srv.api('PATCH', `/api/tasks/${task.s2.id}`, {
        user: USERS.troy, body: { version: unlocked.body.version, status: 'in_progress' },
      });
      assert.equal(advance.status, 200);
    });

    it('FS locking also applies through offline sync (blocked with DEPENDENCY_LOCKED)', async () => {
      const edge = await mkDep({ predecessorId: task.a.id, successorId: task.d.id, type: 'FS' });
      assert.equal(edge.status, 201);
      const d = (await srv.api('GET', `/api/tasks/${task.d.id}`, { user: USERS.troy })).body;
      const res = await srv.api('POST', '/api/sync', {
        user: USERS.troy,
        body: {
          clientId: 'test-device',
          operations: [{
            opId: 'op-dep-1', seq: 1, entity: 'task', entityId: task.d.id, op: 'update',
            baseVersion: d.version, clientUpdatedAt: new Date().toISOString(),
            fields: { status: 'done' },
          }],
        },
      });
      assert.equal(res.body.results[0].result, 'blocked');
      assert.equal(res.body.results[0].error, 'DEPENDENCY_LOCKED');
      assert.equal(res.body.haltedAt, 'op-dep-1');
    });
  });
});
