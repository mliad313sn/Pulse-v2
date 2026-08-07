/**
 * E08 core — Milestones: CRUD + authz (manage-level or owner; VIEWER 403),
 * OCC, weight validation, classification concealment, and the COMPUTED
 * project progress (plan §23, invariant 15) including weights, cancelled
 * exclusion and the explanation string.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('E08 — milestones + computed progress', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const getProject = async (id, user = USERS.troy) =>
    (await srv.api('GET', `/api/projects/${id}`, { user })).body;

  describe('progress (computed, never writable)', () => {
    it('a project without milestones has percent null and "No milestones yet"', async () => {
      const p = await getProject(SEED.project3);
      assert.deepEqual(p.progress, {
        percent: null, completedWeight: 0, activeWeight: 0, explanation: 'No milestones yet',
      });
    });

    it('weighted math: DONE weights / non-CANCELLED weights, cancelled excluded, explained', async () => {
      // project3 (bizapps): Troy is ADMIN -> manage-level.
      const mk = async (fields) => {
        const res = await srv.api('POST', '/api/milestones', {
          user: USERS.troy,
          body: { projectId: SEED.project3, ...fields },
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return res.body;
      };
      await mk({ title: 'Design done', weight: 2, status: 'DONE' });
      await mk({ title: 'Staging validated', weight: 3 }); // NOT_STARTED
      const toCancel = await mk({ title: 'Legacy migration', weight: 5 });
      await mk({ title: 'Go live', type: 'GO_LIVE', weight: 4, status: 'IN_PROGRESS' });

      // Cancel one (weight 5 must leave numerator AND denominator).
      const cancel = await srv.api('PATCH', `/api/milestones/${toCancel.id}`, {
        user: USERS.troy,
        body: { version: toCancel.version, status: 'CANCELLED' },
      });
      assert.equal(cancel.status, 200);

      const p = await getProject(SEED.project3);
      // active weights: 2 + 3 + 4 = 9; done: 2 -> 22%
      assert.equal(p.progress.completedWeight, 2);
      assert.equal(p.progress.activeWeight, 9);
      assert.equal(p.progress.percent, 22);
      assert.match(p.progress.explanation, /2 of 9 weighted/);
      assert.match(p.progress.explanation, /1\/3 active milestones DONE/);
      assert.match(p.progress.explanation, /1 cancelled excluded/);
    });

    it('progress cannot be written: PATCH/POST silently ignore the field', async () => {
      const p = await getProject(SEED.project3);
      const res = await srv.api('PATCH', `/api/projects/${SEED.project3}`, {
        user: USERS.troy,
        body: { version: p.version, progress: { percent: 100 }, description: 'try to cheat' },
      });
      assert.equal(res.status, 200);
      assert.notEqual(res.body.progress.percent, 100);

      const create = await srv.api('POST', '/api/projects', {
        user: USERS.troy,
        body: { name: 'No manual progress', division: 'data', progress: { percent: 90 } },
      });
      assert.equal(create.status, 201);
      assert.equal(create.body.progress.percent, null);
    });
  });

  describe('endpoints + authz', () => {
    it('GET /api/projects/:id/milestones and GET /api/milestones?projectId= agree', async () => {
      const viaProject = await srv.api('GET', `/api/projects/${SEED.project3}/milestones`, { user: USERS.awa });
      const viaList = await srv.api('GET', `/api/milestones?projectId=${SEED.project3}`, { user: USERS.awa });
      assert.equal(viaProject.status, 200);
      assert.equal(viaList.status, 200);
      assert.deepEqual(viaProject.body.map((m) => m.id).sort(), viaList.body.map((m) => m.id).sort());
      assert.ok(viaProject.body.length >= 4);
    });

    it('bootstrap includes visible milestones', async () => {
      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.troy });
      assert.equal(boot.status, 200);
      assert.ok(Array.isArray(boot.body.milestones));
      assert.ok(boot.body.milestones.some((m) => m.projectId === SEED.project3));
    });

    it('VIEWER writes -> 403; reads work', async () => {
      const read = await srv.api('GET', '/api/milestones', { user: USERS.aissatou });
      assert.equal(read.status, 200);
      const write = await srv.api('POST', '/api/milestones', {
        user: USERS.aissatou,
        body: { projectId: SEED.project3, title: 'viewer milestone' },
      });
      assert.equal(write.status, 403);
      assert.equal(write.body.error, 'FORBIDDEN');
    });

    it('creation requires manage-level authority (contributor 403, division lead of division 201)', async () => {
      // Awa (ops CONTRIBUTOR) is not a manager of project3 (bizapps).
      const denied = await srv.api('POST', '/api/milestones', {
        user: USERS.awa,
        body: { projectId: SEED.project3, title: 'not mine' },
      });
      assert.equal(denied.status, 403);

      // Moussa (infra DIVISION_LEAD) manages project2 (infra).
      const ok = await srv.api('POST', '/api/milestones', {
        user: USERS.moussa,
        body: { projectId: SEED.project2, title: 'Core switch cutover', ownerId: USERS.awa, weight: 2 },
      });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.ownerId, USERS.awa);
      assert.equal(ok.body.weight, 2);
      assert.equal(ok.body.version, 1);
    });

    it('the milestone owner may update it; other non-managers may not', async () => {
      const ms = (await srv.api('GET', `/api/milestones?projectId=${SEED.project2}`, { user: USERS.troy }))
        .body.find((m) => m.ownerId === USERS.awa);
      assert.ok(ms);

      // Owner (Awa, non-manager of project2) can update.
      const owner = await srv.api('PATCH', `/api/milestones/${ms.id}`, {
        user: USERS.awa,
        body: { version: ms.version, status: 'IN_PROGRESS' },
      });
      assert.equal(owner.status, 200);
      assert.equal(owner.body.status, 'IN_PROGRESS');

      // Ibrahima (bizapps CONTRIBUTOR, unrelated) cannot.
      const outsider = await srv.api('PATCH', `/api/milestones/${ms.id}`, {
        user: USERS.ibrahima,
        body: { version: owner.body.version, status: 'DONE' },
      });
      assert.equal(outsider.status, 403);
    });

    it('validation: unknown projectId/ownerId, bad type/status/weight/date -> 400', async () => {
      const cases = [
        [{ title: 'x' }, /projectId/],
        [{ projectId: '99999999-0000-0000-0000-000000000000', title: 'x' }, /projectId/],
        [{ projectId: SEED.project3, title: 'x', ownerId: '99999999-0000-0000-0000-000000000001' }, /ownerId/i],
        [{ projectId: SEED.project3, title: 'x', type: 'PARTY' }, /type/],
        [{ projectId: SEED.project3, title: 'x', status: 'MAYBE' }, /status/],
        [{ projectId: SEED.project3, title: 'x', weight: 0 }, /weight/],
        [{ projectId: SEED.project3, title: 'x', weight: 1.5 }, /weight/],
        [{ projectId: SEED.project3, title: 'x', baselineDue: 'tomorrow' }, /baselineDue/],
      ];
      for (const [body, re] of cases) {
        const res = await srv.api('POST', '/api/milestones', { user: USERS.troy, body });
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.equal(res.body.error, 'VALIDATION');
        assert.match(res.body.message, re);
      }
    });

    it('OCC: PATCH without version -> 400; stale version -> 409 with serverState', async () => {
      const created = await srv.api('POST', '/api/milestones', {
        user: USERS.troy,
        body: { projectId: SEED.project3, title: 'OCC probe', baselineDue: '2026-09-30' },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.baselineDue, '2026-09-30');

      const noVersion = await srv.api('PATCH', `/api/milestones/${created.body.id}`, {
        user: USERS.troy, body: { status: 'DONE' },
      });
      assert.equal(noVersion.status, 400);

      const ok = await srv.api('PATCH', `/api/milestones/${created.body.id}`, {
        user: USERS.troy, body: { version: 1, status: 'IN_PROGRESS' },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.version, 2);

      const stale = await srv.api('PATCH', `/api/milestones/${created.body.id}`, {
        user: USERS.troy, body: { version: 1, status: 'DONE' },
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error, 'VERSION_CONFLICT');
      assert.equal(stale.body.detail.serverState.version, 2);
    });

    it('offline sync can create and update milestones (same rules)', async () => {
      const res = await srv.api('POST', '/api/sync', {
        user: USERS.moussa,
        body: {
          clientId: 'ms-device',
          operations: [
            {
              opId: 'ms-create', seq: 1, entity: 'milestone', op: 'create',
              entityId: '77777777-0000-0000-0000-000000000001',
              fields: { projectId: SEED.project2, title: 'WAN failover drill', weight: 2 },
            },
            {
              opId: 'ms-update', seq: 2, entity: 'milestone', op: 'update',
              entityId: '77777777-0000-0000-0000-000000000001',
              baseVersion: 1, clientUpdatedAt: new Date().toISOString(),
              fields: { status: 'IN_PROGRESS' },
            },
          ],
        },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied']);
    });
  });

  describe('classification concealment (like tasks)', () => {
    let confidential;
    let hiddenMs;

    before(async () => {
      const proj = await srv.api('POST', '/api/projects', {
        user: USERS.troy,
        body: { name: 'Covert Radio Upgrade', division: 'infra', classification: 'confidential' },
      });
      assert.equal(proj.status, 201);
      confidential = proj.body;
      const ms = await srv.api('POST', '/api/milestones', {
        user: USERS.troy,
        body: { projectId: confidential.id, title: 'Covert milestone' },
      });
      assert.equal(ms.status, 201);
      hiddenMs = ms.body;
    });

    it('absent from lists/bootstrap for outsiders; visible to ADMIN', async () => {
      const list = await srv.api('GET', '/api/milestones', { user: USERS.ibrahima });
      assert.ok(!list.body.some((m) => m.id === hiddenMs.id));
      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.ibrahima });
      assert.ok(!JSON.stringify(boot.body).includes(hiddenMs.id));

      const admin = await srv.api('GET', '/api/milestones', { user: USERS.troy });
      assert.ok(admin.body.some((m) => m.id === hiddenMs.id));
    });

    it('per-project listing and PATCH conceal with the uniform 404', async () => {
      const listing = await srv.api('GET', `/api/projects/${confidential.id}/milestones`, { user: USERS.ibrahima });
      assert.equal(listing.status, 404);
      assert.equal(listing.body.error, 'NOT_FOUND');

      const patch = await srv.api('PATCH', `/api/milestones/${hiddenMs.id}`, {
        user: USERS.ibrahima,
        body: { version: hiddenMs.version, status: 'DONE' },
      });
      assert.equal(patch.status, 404); // not 403 — existence must not leak
      assert.equal(patch.body.error, 'NOT_FOUND');

      // Creating a milestone under a concealed project looks like an unknown projectId.
      const create = await srv.api('POST', '/api/milestones', {
        user: USERS.ibrahima,
        body: { projectId: confidential.id, title: 'probe' },
      });
      assert.equal(create.status, 400);
      assert.match(create.body.message, /Unknown projectId/);
    });
  });
});
