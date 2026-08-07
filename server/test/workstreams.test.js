/**
 * E07 core — Workstreams (plan §17): CRUD + authz (manage-level create;
 * lead-or-manage patch; VIEWER 403), OCC, enum/date validation, concealment,
 * bootstrap + sync integration, and the new task scheduling fields
 * (workstreamId same-project rule, plannedStart/plannedFinish, estimatedHours).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('E07 — workstreams + task scheduling fields', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  describe('CRUD + validation', () => {
    it('creates a workstream with defaults (status NOT_STARTED, nullable fields)', async () => {
      const res = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'Site prep' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.projectId, SEED.project1);
      assert.equal(res.body.title, 'Site prep');
      assert.equal(res.body.status, 'NOT_STARTED');
      assert.equal(res.body.description, null);
      assert.equal(res.body.leadId, null);
      assert.equal(res.body.startDate, null);
      assert.equal(res.body.endDate, null);
      assert.equal(res.body.version, 1);
      assert.ok(res.body.id && res.body.createdAt && res.body.updatedAt);
    });

    it('accepts full payloads (lead, dates, status) and validates them', async () => {
      const ok = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: {
          projectId: SEED.project1, title: 'Cabling', description: 'Racks + paths',
          leadId: USERS.awa, startDate: '2026-08-01', endDate: '2026-09-15',
          status: 'IN_PROGRESS',
        },
      });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(ok.body.leadId, USERS.awa);
      assert.equal(ok.body.startDate, '2026-08-01');

      const badStatus = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'x', status: 'DOING' },
      });
      assert.equal(badStatus.status, 400);
      assert.equal(badStatus.body.error, 'VALIDATION');

      const badDate = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'x', startDate: 'next week' },
      });
      assert.equal(badDate.status, 400);

      const badLead = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'x', leadId: '99999999-0000-0000-0000-000000000000' },
      });
      assert.equal(badLead.status, 400);

      const noProject = await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { title: 'orphan' },
      });
      assert.equal(noProject.status, 400);
    });

    it('GET /api/projects/:id/workstreams and GET /api/workstreams?projectId= agree', async () => {
      const viaProject = await srv.api('GET', `/api/projects/${SEED.project1}/workstreams`, { user: USERS.awa });
      const viaList = await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.awa });
      assert.equal(viaProject.status, 200);
      assert.equal(viaList.status, 200);
      assert.deepEqual(viaProject.body, viaList.body);
      assert.ok(viaProject.body.length >= 2);
    });

    it('PATCH applies OCC: version required, mismatch 409 with serverState', async () => {
      const created = (await srv.api('POST', '/api/workstreams', {
        user: USERS.troy, body: { projectId: SEED.project1, title: 'OCC ws' },
      })).body;

      const noVersion = await srv.api('PATCH', `/api/workstreams/${created.id}`, {
        user: USERS.troy, body: { title: 'no version' },
      });
      assert.equal(noVersion.status, 400);

      const ok = await srv.api('PATCH', `/api/workstreams/${created.id}`, {
        user: USERS.troy, body: { version: created.version, status: 'IN_PROGRESS' },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.version, 2);

      const stale = await srv.api('PATCH', `/api/workstreams/${created.id}`, {
        user: USERS.troy, body: { version: created.version, status: 'DONE' },
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error, 'VERSION_CONFLICT');
      assert.equal(stale.body.detail.serverState.version, 2);
    });
  });

  describe('write policy (manage-level or lead)', () => {
    it('creation requires manage-level authority: plain contributor 403, VIEWER 403', async () => {
      // Ibrahima (bizapps CONTRIBUTOR) owns project3 — ownership is NOT manage-level for workstreams.
      const contributor = await srv.api('POST', '/api/workstreams', {
        user: USERS.awa, body: { projectId: SEED.project3, title: 'nope' },
      });
      assert.equal(contributor.status, 403);

      const viewer = await srv.api('POST', '/api/workstreams', {
        user: USERS.aissatou, body: { projectId: SEED.project1, title: 'nope' },
      });
      assert.equal(viewer.status, 403);
    });

    it('the workstream lead may PATCH without manage-level authority; others 403', async () => {
      // Awa is ops CONTRIBUTOR, not a manager of bizapps project3.
      const ws = (await srv.api('POST', '/api/workstreams', {
        user: USERS.troy,
        body: { projectId: SEED.project3, title: 'Led by Awa', leadId: USERS.awa },
      })).body;

      const asLead = await srv.api('PATCH', `/api/workstreams/${ws.id}`, {
        user: USERS.awa, body: { version: ws.version, status: 'IN_PROGRESS' },
      });
      assert.equal(asLead.status, 200, JSON.stringify(asLead.body));

      // Ibrahima is a contributor (project owner) but neither manager nor lead.
      const asOther = await srv.api('PATCH', `/api/workstreams/${ws.id}`, {
        user: USERS.ibrahima, body: { version: asLead.body.version, status: 'DONE' },
      });
      assert.equal(asOther.status, 403);

      // Division lead of the project's division HAS manage-level authority.
      const asDivisionLead = await srv.api('PATCH', `/api/workstreams/${ws.id}`, {
        user: USERS.moussa, body: { version: asLead.body.version, status: 'DONE' },
      });
      assert.equal(asDivisionLead.status, 403); // moussa is infra, project3 is bizapps

      const asAdmin = await srv.api('PATCH', `/api/workstreams/${ws.id}`, {
        user: USERS.troy, body: { version: asLead.body.version, status: 'DONE' },
      });
      assert.equal(asAdmin.status, 200);
    });
  });

  describe('concealment + bootstrap + sync', () => {
    it('workstreams of confidential projects are hidden from lists and 404 on writes', async () => {
      // Make project1 confidential (ADMIN-only); Awa is its owner -> still readable
      // for her, but NOT for Ibrahima (bizapps, no membership).
      const p1 = (await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy })).body;
      const hide = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
        user: USERS.troy, body: { version: p1.version, classification: 'confidential' },
      });
      assert.equal(hide.status, 200);

      const ws = (await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.troy })).body[0];

      const list = await srv.api('GET', '/api/workstreams', { user: USERS.ibrahima });
      assert.equal(list.status, 200);
      assert.ok(!list.body.some((w) => w.projectId === SEED.project1));

      const direct = await srv.api('GET', `/api/projects/${SEED.project1}/workstreams`, { user: USERS.ibrahima });
      assert.equal(direct.status, 404);

      const patch = await srv.api('PATCH', `/api/workstreams/${ws.id}`, {
        user: USERS.ibrahima, body: { version: ws.version, title: 'sneak' },
      });
      assert.equal(patch.status, 404); // concealed, not 403

      const create = await srv.api('POST', '/api/workstreams', {
        user: USERS.ibrahima, body: { projectId: SEED.project1, title: 'sneak' },
      });
      assert.equal(create.status, 400); // unknown projectId — no existence leak

      // restore
      const p1b = (await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy })).body;
      await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
        user: USERS.troy, body: { version: p1b.version, classification: 'internal' },
      });
    });

    it('bootstrap carries workstreams (concealment-filtered) and dependencies keys', async () => {
      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.awa });
      assert.equal(boot.status, 200);
      assert.ok(Array.isArray(boot.body.workstreams));
      assert.ok(Array.isArray(boot.body.dependencies));
      assert.ok(boot.body.workstreams.some((w) => w.projectId === SEED.project1));
    });

    it('workstreams ride the offline sync protocol (create + update)', async () => {
      const wsId = '77777777-0000-0000-0000-000000000001';
      const create = await srv.api('POST', '/api/sync', {
        user: USERS.troy,
        body: {
          clientId: 'test-device',
          operations: [{
            opId: 'op-ws-1', entity: 'workstream', entityId: wsId, op: 'create',
            fields: { projectId: SEED.project1, title: 'Synced stream' },
          }],
        },
      });
      assert.equal(create.status, 200);
      assert.equal(create.body.results[0].result, 'applied');

      const update = await srv.api('POST', '/api/sync', {
        user: USERS.troy,
        body: {
          clientId: 'test-device',
          operations: [{
            opId: 'op-ws-2', entity: 'workstream', entityId: wsId, op: 'update',
            baseVersion: 1, clientUpdatedAt: new Date().toISOString(),
            fields: { status: 'IN_PROGRESS' },
          }],
        },
      });
      assert.equal(update.body.results[0].result, 'applied');

      const fetched = await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.troy });
      const row = fetched.body.find((w) => w.id === wsId);
      assert.equal(row.status, 'IN_PROGRESS');
      assert.equal(row.version, 2);
    });
  });

  describe('task scheduling fields (E07 additions)', () => {
    it('tasks accept workstreamId, plannedStart/plannedFinish, estimatedHours', async () => {
      const ws = (await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.troy })).body[0];
      const res = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: {
          projectId: SEED.project1, title: 'Scheduled task', workstreamId: ws.id,
          plannedStart: '2026-08-10', plannedFinish: '2026-08-14', estimatedHours: 12.5,
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.workstreamId, ws.id);
      assert.equal(res.body.plannedStart, '2026-08-10');
      assert.equal(res.body.plannedFinish, '2026-08-14');
      assert.equal(res.body.estimatedHours, 12.5);
    });

    it('workstreamId must belong to the SAME project -> 400 (create and PATCH)', async () => {
      // Workstream on project1, task on project2.
      const ws = (await srv.api('GET', `/api/workstreams?projectId=${SEED.project1}`, { user: USERS.troy })).body[0];
      const create = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project2, title: 'cross-project ws', workstreamId: ws.id },
      });
      assert.equal(create.status, 400);
      assert.equal(create.body.error, 'VALIDATION');
      assert.equal(create.body.detail.field, 'workstreamId');

      const task = (await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.troy })).body;
      const patch = await srv.api('PATCH', `/api/tasks/${SEED.infraTask}`, {
        user: USERS.troy, body: { version: task.version, workstreamId: ws.id },
      });
      assert.equal(patch.status, 400);
      assert.equal(patch.body.detail.field, 'workstreamId');
    });

    it('estimatedHours must be a number >= 0; planned dates must be ISO dates', async () => {
      const negative = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'bad hours', estimatedHours: -1 },
      });
      assert.equal(negative.status, 400);

      const notNumber = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'bad hours', estimatedHours: 'ten' },
      });
      assert.equal(notNumber.status, 400);

      const badDate = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project1, title: 'bad date', plannedFinish: '14/08/2026' },
      });
      assert.equal(badDate.status, 400);
    });
  });
});
