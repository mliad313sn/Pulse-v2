/**
 * E09 — Actions (plan §19): CRUD + authz (general vs project-linked),
 * visibility scoping (general actions are owner/creator/ADMIN-only),
 * CANCELLED-never-counts-as-complete, the action-driven RAG overdueWork
 * signal (matrix over the API), offline sync membership, bootstrap and the
 * deck's openActionCount.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

const DAY = 24 * 3600 * 1000;
const dateAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

describe('E09 — actions', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const post = (user, body) => srv.api('POST', '/api/actions', { user, body });
  const patch = (id, user, body) => srv.api('PATCH', `/api/actions/${id}`, { user, body });

  describe('create + defaults + validation', () => {
    it('a general (no project) self-owned action: any non-VIEWER, defaults filled, createdBy stamped', async () => {
      const res = await post(USERS.awa, { title: 'Confirm carrier quotation by Friday', ownerId: USERS.awa });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.projectId, null);
      assert.equal(res.body.priority, 'normal');
      assert.equal(res.body.status, 'OPEN');
      assert.equal(res.body.sourceType, 'MANUAL');
      assert.equal(res.body.dueDate, null);
      assert.equal(res.body.roadblockId, null);
      assert.equal(res.body.capaId, null);
      assert.equal(res.body.createdBy, USERS.awa);
      assert.equal(res.body.version, 1);
    });

    it('createdBy is server-stamped: a spoofed value is ignored', async () => {
      const res = await post(USERS.awa, {
        title: 'spoof attempt', ownerId: USERS.awa, createdBy: USERS.troy,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.createdBy, USERS.awa);
    });

    it('a general action for SOMEONE ELSE requires ADMIN (403 otherwise)', async () => {
      const denied = await post(USERS.awa, { title: 'do my chores', ownerId: USERS.ibrahima });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, 'FORBIDDEN');

      const admin = await post(USERS.troy, { title: 'Network Lead to confirm quotation', ownerId: USERS.moussa });
      assert.equal(admin.status, 201);
      assert.equal(admin.body.ownerId, USERS.moussa);
      assert.equal(admin.body.createdBy, USERS.troy);
    });

    it('project-linked create needs project involvement (task policy); uninvolved -> 403; VIEWER -> 403', async () => {
      // ibrahima owns project3 -> allowed, and may assign the action to anyone.
      const ok = await post(USERS.ibrahima, {
        title: 'Chase ERP vendor for staging licences', ownerId: USERS.troy, projectId: SEED.project3,
      });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));

      // awa (ops CONTRIBUTOR) is uninvolved in project3 — even self-owned.
      const denied = await post(USERS.awa, {
        title: 'smuggled', ownerId: USERS.awa, projectId: SEED.project3,
      });
      assert.equal(denied.status, 403);

      const viewer = await post(USERS.aissatou, { title: 'viewer', ownerId: USERS.aissatou });
      assert.equal(viewer.status, 403);
    });

    it('validation: missing title/ownerId, bad enums, bad dueDate, unknown owner/roadblock/capa refs -> 400', async () => {
      const cases = [
        { ownerId: USERS.awa }, // no title
        { title: 'no owner' },
        { title: 'x', ownerId: USERS.awa, priority: 'critical' }, // actions have no 'critical'
        { title: 'x', ownerId: USERS.awa, status: 'closed' },
        { title: 'x', ownerId: USERS.awa, sourceType: 'AUDIT' },
        { title: 'x', ownerId: USERS.awa, dueDate: 'not-a-date' },
        { title: 'x', ownerId: randomUUID() },
        { title: 'x', ownerId: USERS.awa, roadblockId: randomUUID() },
        { title: 'x', ownerId: USERS.awa, capaId: randomUUID() },
      ];
      for (const body of cases) {
        const res = await post(USERS.awa, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(res.body.error, 'VALIDATION');
      }
      // Concealed/unknown projectId is indistinguishable (uniform message).
      const unknownProject = await post(USERS.awa, { title: 'x', ownerId: USERS.awa, projectId: randomUUID() });
      assert.equal(unknownProject.status, 400);
      assert.match(unknownProject.body.message, /Unknown projectId/);
    });
  });

  describe('visibility + list endpoints', () => {
    it('general actions are hidden from everyone but owner/creator/ADMIN; ?mine=1 narrows to owned', async () => {
      const mine = await post(USERS.ibrahima, { title: 'general private item', ownerId: USERS.ibrahima });
      assert.equal(mine.status, 201);

      const asOwner = await srv.api('GET', '/api/actions', { user: USERS.ibrahima });
      assert.ok(asOwner.body.some((a) => a.id === mine.body.id), 'owner sees own general action');

      const asOther = await srv.api('GET', '/api/actions', { user: USERS.awa });
      assert.ok(!asOther.body.some((a) => a.id === mine.body.id), 'hidden from unrelated users');

      const asAdmin = await srv.api('GET', '/api/actions', { user: USERS.troy });
      assert.ok(asAdmin.body.some((a) => a.id === mine.body.id), 'ADMIN sees it');

      // The admin-assigned action (owner moussa, creator troy) is visible to
      // its owner AND its creator.
      const asMoussa = await srv.api('GET', '/api/actions?mine=1', { user: USERS.moussa });
      assert.ok(asMoussa.body.every((a) => a.ownerId === USERS.moussa));
      assert.ok(asMoussa.body.some((a) => a.title === 'Network Lead to confirm quotation'));
    });

    it('GET /api/projects/:id/actions lists the project actions (concealed -> 404); ?projectId= filters', async () => {
      const viaProject = await srv.api('GET', `/api/projects/${SEED.project3}/actions`, { user: USERS.troy });
      assert.equal(viaProject.status, 200);
      assert.ok(viaProject.body.length >= 1);
      assert.ok(viaProject.body.every((a) => a.projectId === SEED.project3));

      const viaQuery = await srv.api('GET', `/api/actions?projectId=${SEED.project3}`, { user: USERS.troy });
      assert.deepEqual(viaQuery.body.map((a) => a.id).sort(), viaProject.body.map((a) => a.id).sort());
    });

    it('actions of concealed projects are hidden from lists/bootstrap and 404 on PATCH (ADR-005)', async () => {
      const proj = await srv.api('POST', '/api/projects', {
        user: USERS.troy,
        body: { name: 'Covert Action Target', division: 'management', classification: 'confidential' },
      });
      const confAction = await post(USERS.troy, {
        title: 'hidden work item', ownerId: USERS.troy, projectId: proj.body.id,
      });
      assert.equal(confAction.status, 201);

      const list = await srv.api('GET', '/api/actions', { user: USERS.awa });
      assert.ok(!list.body.some((a) => a.id === confAction.body.id));

      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.awa });
      assert.ok(!boot.body.actions.some((a) => a.id === confAction.body.id));

      const denied = await patch(confAction.body.id, USERS.awa, { version: 1, status: 'DONE' });
      assert.equal(denied.status, 404);
      assert.equal(denied.body.error, 'NOT_FOUND');

      // A general action of someone else conceals the same way (404, not 403).
      const foreignGeneral = await post(USERS.troy, { title: 'troy private', ownerId: USERS.troy });
      const denied2 = await patch(foreignGeneral.body.id, USERS.awa, { version: 1, status: 'DONE' });
      assert.equal(denied2.status, 404);
    });
  });

  describe('updates (OCC + write policy)', () => {
    it('owner and creator may update; uninvolved project reader may not; OCC enforced', async () => {
      const created = await post(USERS.ibrahima, {
        title: 'Validate backup restore', ownerId: USERS.ibrahima, projectId: SEED.project3,
      });
      // Missing version -> 400; stale version -> 409 with serverState.
      const noVersion = await patch(created.body.id, USERS.ibrahima, { status: 'DONE' });
      assert.equal(noVersion.status, 400);
      const stale = await patch(created.body.id, USERS.ibrahima, { version: 99, status: 'DONE' });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error, 'VERSION_CONFLICT');
      assert.ok(stale.body.detail.serverState);

      // awa can READ project3 (internal) but is neither owner/creator nor
      // manage-level -> 403 (existence known).
      const denied = await patch(created.body.id, USERS.awa, { version: 1, status: 'DONE' });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, 'FORBIDDEN');

      const done = await patch(created.body.id, USERS.ibrahima, { version: 1, status: 'DONE', priority: 'high' });
      assert.equal(done.status, 200);
      assert.equal(done.body.status, 'DONE');
      assert.equal(done.body.version, 2);
    });
  });

  describe('RAG overdueWork is action-driven (matrix over the API)', () => {
    it('overdue OPEN actions drive GREEN/AMBER/RED; DONE and CANCELLED never count', async () => {
      const overdue = (n) => post(USERS.ibrahima, {
        title: `overdue #${n}`, ownerId: USERS.ibrahima, projectId: SEED.project3, dueDate: dateAgo(2),
      });

      const p3Before = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      assert.equal(p3Before.rag.signals.find((s) => s.key === 'overdueWork').color, 'GREEN');

      const first = await overdue(1);
      assert.equal(first.status, 201);
      let p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      let sig = p3.rag.signals.find((s) => s.key === 'overdueWork');
      assert.equal(sig.color, 'AMBER');
      assert.equal(sig.explanation, '1 open action past due date');

      const more = [await overdue(2), await overdue(3), await overdue(4)];
      assert.ok(more.every((r) => r.status === 201));
      p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      sig = p3.rag.signals.find((s) => s.key === 'overdueWork');
      assert.equal(sig.color, 'RED');
      assert.equal(sig.explanation, '4 open actions past due date');

      // CANCELLED never counts as completed OR open: cancelling one drops the
      // count to 3 (AMBER) without ever appearing as done work.
      const cancelled = await patch(more[2].body.id, USERS.ibrahima, { version: 1, status: 'CANCELLED' });
      assert.equal(cancelled.status, 200);
      // Completing another drops it to 2.
      await patch(more[1].body.id, USERS.ibrahima, { version: 1, status: 'DONE' });
      p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      sig = p3.rag.signals.find((s) => s.key === 'overdueWork');
      assert.equal(sig.color, 'AMBER');
      assert.equal(sig.explanation, '2 open actions past due date');

      // Overdue TASKS no longer color the signal (ADR-006 stand-in removed).
      const task = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: { projectId: SEED.project3, title: 'late task', plannedFinish: dateAgo(10) },
      });
      assert.equal(task.status, 201);
      p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      assert.equal(p3.rag.signals.find((s) => s.key === 'overdueWork').explanation, '2 open actions past due date');

      // Deck: openActionCount counts OPEN only (2 overdue + any other OPEN
      // project3 actions from earlier tests; DONE/CANCELLED excluded).
      const { buildDeckData } = await import('../src/reporter/deck.js');
      const troy = await srv.repo.getUser(USERS.troy);
      const deck = await buildDeckData(srv.repo, troy);
      const erp = deck.divisions.find((d) => d.code === 'bizapps').projects.find((p) => p.id === SEED.project3);
      const allP3 = await srv.api('GET', `/api/projects/${SEED.project3}/actions`, { user: USERS.troy });
      const expectedOpen = allP3.body.filter((a) => a.status === 'OPEN').length;
      assert.equal(erp.openActionCount, expectedOpen);
      assert.ok(allP3.body.some((a) => a.status === 'CANCELLED'), 'a cancelled action exists');
      assert.ok(erp.openActionCount < allP3.body.length, 'cancelled/done excluded from the open count');
    });
  });

  describe('offline sync membership', () => {
    it('actions ride the sync protocol: offline create + field update apply; general actions of others block NOT_FOUND', async () => {
      const newId = randomUUID();
      const res = await srv.api('POST', '/api/sync', {
        user: USERS.ibrahima,
        body: {
          clientId: 'action-tablet',
          operations: [
            {
              opId: randomUUID(), seq: 1, entity: 'action', entityId: newId, op: 'create',
              fields: {
                title: 'Offline: recheck rack grounding', ownerId: USERS.ibrahima,
                projectId: SEED.project3, dueDate: dateAgo(-7),
              },
            },
            {
              opId: randomUUID(), seq: 2, entity: 'action', entityId: newId, op: 'update',
              baseVersion: 1, fields: { status: 'DONE' },
            },
          ],
        },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.results.map((r) => r.result), ['applied', 'applied']);

      const list = await srv.api('GET', `/api/actions?projectId=${SEED.project3}`, { user: USERS.ibrahima });
      const synced = list.body.find((a) => a.id === newId);
      assert.equal(synced.status, 'DONE');
      assert.equal(synced.version, 2);

      // Someone else's GENERAL action: concealed — blocked NOT_FOUND, NO serverState.
      const foreign = await post(USERS.troy, { title: 'troy only', ownerId: USERS.troy });
      const blocked = await srv.api('POST', '/api/sync', {
        user: USERS.awa,
        body: {
          clientId: 'action-tablet-2',
          operations: [{
            opId: randomUUID(), seq: 1, entity: 'action', entityId: foreign.body.id, op: 'update',
            baseVersion: 1, fields: { status: 'DONE' },
          }],
        },
      });
      assert.equal(blocked.body.results[0].result, 'blocked');
      assert.equal(blocked.body.results[0].error, 'NOT_FOUND');
      assert.equal(blocked.body.results[0].serverState, null);
    });

    it('risks and capas are ONLINE-ONLY: a sync op naming them is blocked as VALIDATION', async () => {
      for (const entity of ['risk', 'capa']) {
        const res = await srv.api('POST', '/api/sync', {
          user: USERS.troy,
          body: {
            clientId: 'online-only-check',
            operations: [{
              opId: randomUUID(), seq: 1, entity, entityId: randomUUID(), op: 'create', fields: {},
            }],
          },
        });
        assert.equal(res.body.results[0].result, 'blocked', entity);
        assert.equal(res.body.results[0].error, 'VALIDATION', entity);
        assert.match(res.body.results[0].message, /entity must be one of/);
      }
    });
  });

  it('bootstrap carries `actions` (own general + visible project actions)', async () => {
    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.ibrahima });
    assert.ok(Array.isArray(boot.body.actions));
    assert.ok(boot.body.actions.some((a) => a.projectId === SEED.project3));
    assert.ok(boot.body.actions.some((a) => a.projectId === null && a.ownerId === USERS.ibrahima));
    // No general actions of OTHER users leak in.
    assert.ok(boot.body.actions.every((a) => a.projectId != null
      || a.ownerId === USERS.ibrahima || a.createdBy === USERS.ibrahima));
  });
});
