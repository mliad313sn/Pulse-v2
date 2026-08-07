/**
 * E22 — GET /api/my-work (plan §44): per-list membership rules (open actions
 * owned by me, my unfinished tasks with `locked`, my open milestones, my open
 * roadblocks as owner/reporter, my open CAPAs as owner/verifier,
 * security_reviewer-only approvals, decidable-not-own pending gate requests,
 * PM-managed projects), the server-computed date buckets under a fixed clock
 * (`?now=` test hook), and §77 concealment (a project turning confidential
 * drops its rows from my-work without a trace).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

// Fixed clock for deterministic buckets (?now= hook): today = 2026-08-07 UTC.
const NOW = '2026-08-07';
const D = {
  overdue: '2026-08-06', // today - 1
  today: '2026-08-07', // dueThisWeek lower bound (inclusive)
  weekEnd: '2026-08-14', // today + 7 (inclusive)
  upStart: '2026-08-15', // today + 8 (inclusive)
  upEnd: '2026-09-06', // today + 30 (inclusive)
  beyond: '2026-09-07', // today + 31 -> in no bucket
};

describe('E22 — GET /api/my-work', () => {
  let srv;
  const ids = {}; // created fixture ids

  const myWork = (user, query = `?now=${NOW}`) =>
    srv.api('GET', `/api/my-work${query}`, { user });

  before(async () => {
    srv = await startServer();
    const { api } = srv;
    const created = async (p) => {
      const res = await p;
      assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
      return res.body;
    };

    // Memberships: moussa PM of project2, ibrahima PM of project3.
    await created(api('POST', `/api/projects/${SEED.project2}/members`, {
      user: USERS.troy, body: { userId: USERS.moussa, role: 'PM' },
    }));
    await created(api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'PM' },
    }));

    // Pending G0 gate request on project3, requested by its PM ibrahima.
    const p3 = (await api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
    await created(api('PATCH', `/api/projects/${SEED.project3}`, {
      user: USERS.troy, body: { sponsorId: USERS.troy, version: p3.version },
    }));
    ids.gateRequest = (await created(api('POST', `/api/projects/${SEED.project3}/gates/request`, {
      user: USERS.ibrahima, body: { note: 'ready for initiation' },
    }))).id;

    // Milestones on project1 (all created by ADMIN troy).
    const milestone = (body) => created(api('POST', '/api/milestones', {
      user: USERS.troy, body: { projectId: SEED.project1, ...body },
    }));
    ids.msOwn = (await milestone({ title: 'Cooling install', ownerId: USERS.awa, baselineDue: '2026-08-20' })).id;
    ids.msForecast = (await milestone({
      title: 'Power redundancy check', ownerId: USERS.awa, status: 'IN_PROGRESS',
      baselineDue: '2026-09-20', forecastDue: '2026-08-10',
    })).id;
    ids.msDone = (await milestone({ title: 'Cabling done', ownerId: USERS.awa, status: 'DONE' })).id;
    ids.msOther = (await milestone({ title: 'Someone else owns this', ownerId: USERS.troy, baselineDue: '2026-08-10' })).id;

    // Actions (all general, owned by awa unless noted).
    const action = (user, body) => created(api('POST', '/api/actions', { user, body }));
    ids.aOverdue = (await action(USERS.awa, { title: 'overdue', ownerId: USERS.awa, dueDate: D.overdue })).id;
    ids.aToday = (await action(USERS.awa, { title: 'due today', ownerId: USERS.awa, dueDate: D.today })).id;
    ids.aWeekEnd = (await action(USERS.awa, { title: 'week boundary', ownerId: USERS.awa, dueDate: D.weekEnd })).id;
    ids.aUp8 = (await action(USERS.awa, { title: 'upcoming start', ownerId: USERS.awa, dueDate: D.upStart })).id;
    ids.aUp30 = (await action(USERS.awa, { title: 'upcoming end', ownerId: USERS.awa, dueDate: D.upEnd })).id;
    ids.aBeyond = (await action(USERS.awa, { title: 'beyond horizon', ownerId: USERS.awa, dueDate: D.beyond })).id;
    ids.aNoDue = (await action(USERS.awa, { title: 'no due date', ownerId: USERS.awa })).id;
    const done = await action(USERS.awa, { title: 'already done', ownerId: USERS.awa, dueDate: D.overdue });
    await created(api('PATCH', `/api/actions/${done.id}`, {
      user: USERS.awa, body: { status: 'DONE', version: done.version },
    }));
    ids.aDone = done.id;
    ids.aOther = (await action(USERS.troy, { title: "moussa's action", ownerId: USERS.moussa })).id;

    // Roadblock1 (reported by awa) gains an owner: moussa (implicit ASSIGNED).
    const rb = (await api('GET', '/api/roadblocks', { user: USERS.troy })).body
      .find((r) => r.id === SEED.roadblock1);
    await created(api('PATCH', `/api/roadblocks/${SEED.roadblock1}`, {
      user: USERS.troy, body: { ownerId: USERS.moussa, version: rb.version },
    }));

    // CAPAs: one open general owned by awa (with a due date), one where hamady
    // is only the verifier, one driven all the way to CLOSED (excluded).
    const capa = (user, body) => created(api('POST', '/api/capas', { user, body }));
    ids.capAwa = (await capa(USERS.awa, { issue: 'Recurring customs delays', ownerId: USERS.awa, dueDate: D.overdue })).id;
    ids.capVerifier = (await capa(USERS.troy, {
      issue: 'Access review gaps', ownerId: USERS.troy, verifierId: USERS.hamady,
    })).id;
    let closed = await capa(USERS.awa, {
      issue: 'One-off mislabel', ownerId: USERS.awa, verifierId: USERS.troy,
      correctiveAction: 'relabel', preventiveAction: 'checklist', effectivenessResult: 'effective',
    });
    for (const status of ['ANALYSIS', 'ACTION_PLANNED', 'IMPLEMENTATION', 'VERIFICATION', 'CLOSED']) {
      closed = await created(api('PATCH', `/api/capas/${closed.id}`, {
        user: USERS.awa, body: { status, version: closed.version },
      }));
    }
    assert.equal(closed.status, 'CLOSED');
    ids.capClosed = closed.id;
  });
  after(async () => { await srv.close(); });

  describe('per-list membership rules', () => {
    it('actions: OPEN actions I own — DONE and other-owned excluded', async () => {
      const res = await myWork(USERS.awa);
      assert.equal(res.status, 200);
      const got = new Set(res.body.actions.map((a) => a.id));
      assert.deepEqual(got, new Set([
        ids.aOverdue, ids.aToday, ids.aWeekEnd, ids.aUp8, ids.aUp30, ids.aBeyond, ids.aNoDue,
      ]));
      assert.ok(res.body.actions.every((a) => a.status === 'OPEN' && a.ownerId === USERS.awa));
    });

    it('tasks: assigned to me and not done, with the derived locked flag', async () => {
      const awa = await myWork(USERS.awa);
      const awaTask = awa.body.tasks.find((t) => t.id === SEED.opsTask);
      assert.ok(awaTask, 'awa should see her in_progress task');
      assert.equal(awaTask.locked, false);

      const moussa = await myWork(USERS.moussa);
      const locked = moussa.body.tasks.find((t) => t.id === SEED.infraTask);
      assert.ok(locked, 'moussa should see his dependency-locked task');
      assert.equal(locked.locked, true);
      // Nobody's list contains a task assigned to someone else.
      assert.ok(!moussa.body.tasks.some((t) => t.id === SEED.opsTask));
    });

    it('milestones: mine and still open (NOT_STARTED/IN_PROGRESS/SLIPPED)', async () => {
      const res = await myWork(USERS.awa);
      assert.deepEqual(
        new Set(res.body.milestones.map((m) => m.id)),
        new Set([ids.msOwn, ids.msForecast]),
      ); // msDone (DONE) and msOther (troy's) excluded
    });

    it('roadblocks: open ones I own OR reported', async () => {
      const reporter = await myWork(USERS.awa);
      assert.ok(reporter.body.roadblocks.some((r) => r.id === SEED.roadblock1));
      const owner = await myWork(USERS.moussa);
      assert.ok(owner.body.roadblocks.some((r) => r.id === SEED.roadblock1));
      const uninvolved = await myWork(USERS.ibrahima);
      assert.ok(!uninvolved.body.roadblocks.some((r) => r.id === SEED.roadblock1));
    });

    it('capas: not-CLOSED ones where I am owner or verifier', async () => {
      const awa = await myWork(USERS.awa);
      const got = awa.body.capas.map((c) => c.id);
      assert.ok(got.includes(ids.capAwa));
      assert.ok(!got.includes(ids.capClosed), 'CLOSED capa excluded');
      assert.ok(!got.includes(ids.capVerifier));

      const verifier = await myWork(USERS.hamady);
      assert.ok(verifier.body.capas.some((c) => c.id === ids.capVerifier));
    });

    it('approvals: pending queue ONLY for security_reviewer holders', async () => {
      const reviewer = await myWork(USERS.hamady);
      assert.deepEqual(reviewer.body.approvals.map((a) => a.id), [SEED.approval1]);
      // ADMIN without the privilege gets [] — the privilege, not the role, decides.
      const admin = await myWork(USERS.troy);
      assert.deepEqual(admin.body.approvals, []);
      const contributor = await myWork(USERS.awa);
      assert.deepEqual(contributor.body.approvals, []);
    });

    it('gateRequests: PENDING ones I may decide, never my own, project-decorated', async () => {
      // troy (ADMIN) and aminata (steering) hold G0 authority.
      for (const user of [USERS.troy, USERS.aminata]) {
        const res = await myWork(user);
        assert.equal(res.body.gateRequests.length, 1, JSON.stringify(res.body.gateRequests));
        const gr = res.body.gateRequests[0];
        assert.equal(gr.id, ids.gateRequest);
        assert.equal(gr.gate, 'G0');
        assert.equal(gr.projectName, 'ERP Maintenance Module Rollout');
        assert.equal(gr.projectCode, 'PRJ-2026-003');
      }
      // The requester never decides their own request.
      assert.deepEqual((await myWork(USERS.ibrahima)).body.gateRequests, []);
      // DIVISION_LEAD of ANOTHER division has no authority over project3 (bizapps).
      assert.deepEqual((await myWork(USERS.fatou)).body.gateRequests, []);
      // Plain contributor: no authority.
      assert.deepEqual((await myWork(USERS.awa)).body.gateRequests, []);
    });

    it('managed: projects where I am the PM member, wire-decorated', async () => {
      const res = await myWork(USERS.moussa);
      assert.equal(res.body.managed.length, 1);
      const p = res.body.managed[0];
      assert.equal(p.id, SEED.project2);
      assert.equal(p.pmId, USERS.moussa);
      assert.ok(p.rag && ['GREEN', 'AMBER', 'RED'].includes(p.rag.color));
      assert.ok(p.progress && 'percent' in p.progress);
      // Owning a project is not managing it: awa owns project1 but is not PM.
      assert.deepEqual((await myWork(USERS.awa)).body.managed, []);
    });

    it('VIEWER gets a working (read-only) my-work with empty decision queues', async () => {
      const res = await myWork(USERS.aissatou);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.approvals, []);
      assert.deepEqual(res.body.gateRequests, []);
      assert.deepEqual(res.body.managed, []);
    });
  });

  describe('date buckets (fixed ?now clock, UTC, inclusive boundaries)', () => {
    it('overdue < today; dueThisWeek today..+7d; upcoming +8..+30d; no-due excluded', async () => {
      const res = await myWork(USERS.awa);
      const { overdue, dueThisWeek, upcoming } = res.body.buckets;

      assert.deepEqual(overdue, [
        { kind: 'action', id: ids.aOverdue, title: 'overdue', projectId: null, due: D.overdue },
        { kind: 'capa', id: ids.capAwa, title: 'Recurring customs delays', projectId: null, due: D.overdue },
      ]);
      assert.deepEqual(dueThisWeek, [
        { kind: 'action', id: ids.aToday, title: 'due today', projectId: null, due: D.today },
        { kind: 'milestone', id: ids.msForecast, title: 'Power redundancy check', projectId: SEED.project1, due: '2026-08-10' },
        { kind: 'action', id: ids.aWeekEnd, title: 'week boundary', projectId: null, due: D.weekEnd },
      ]);
      assert.deepEqual(upcoming, [
        { kind: 'action', id: ids.aUp8, title: 'upcoming start', projectId: null, due: D.upStart },
        { kind: 'milestone', id: ids.msOwn, title: 'Cooling install', projectId: SEED.project1, due: '2026-08-20' },
        { kind: 'action', id: ids.aUp30, title: 'upcoming end', projectId: null, due: D.upEnd },
      ]);
      // aBeyond (+31d) and aNoDue are in the actions list but in NO bucket.
      const bucketed = [...overdue, ...dueThisWeek, ...upcoming].map((x) => x.id);
      assert.ok(!bucketed.includes(ids.aBeyond));
      assert.ok(!bucketed.includes(ids.aNoDue));
    });

    it('?now= is optional (defaults to the server clock) and validated', async () => {
      const live = await myWork(USERS.awa, '');
      assert.equal(live.status, 200);
      const bad = await myWork(USERS.awa, '?now=not-a-date');
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error, 'VALIDATION');
      assert.equal(bad.body.detail.field, 'now');
    });
  });

  describe('§77 concealment (runs last — it flips project3 confidential)', () => {
    it('a project turning confidential silently drops its rows from my-work', async () => {
      // troy assigns awa a task on project3, due within the week.
      const task = await srv.api('POST', '/api/tasks', {
        user: USERS.troy,
        body: {
          projectId: SEED.project3, title: 'ERP data validation support',
          assigneeId: USERS.awa, plannedFinish: '2026-08-10',
        },
      });
      assert.equal(task.status, 201, JSON.stringify(task.body));

      const beforeRes = await myWork(USERS.awa);
      assert.ok(beforeRes.body.tasks.some((t) => t.id === task.body.id));
      assert.ok(beforeRes.body.buckets.dueThisWeek.some((x) => x.id === task.body.id));

      const p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      const patched = await srv.api('PATCH', `/api/projects/${SEED.project3}`, {
        user: USERS.troy, body: { classification: 'confidential', version: p3.version },
      });
      assert.equal(patched.status, 200);

      // awa is not a member of project3: the task vanishes from every list
      // AND from the buckets — concealment moves the numbers, invisibly.
      const afterRes = await myWork(USERS.awa);
      assert.ok(!afterRes.body.tasks.some((t) => t.id === task.body.id));
      assert.ok(!afterRes.body.buckets.dueThisWeek.some((x) => x.id === task.body.id));

      // ibrahima (PM member + owner) keeps seeing his project3 world.
      const pm = await myWork(USERS.ibrahima);
      assert.ok(pm.body.managed.some((p) => p.id === SEED.project3));
    });
  });
});
