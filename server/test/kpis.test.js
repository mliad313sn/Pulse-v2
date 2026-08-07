/**
 * E22 — GET /api/kpis (plan §45): per-KPI rules, drill lists matching totals,
 * filter validation (400 on unknown codes), AND-composed filters, and the
 * §77 aggregation-security proof: a confidential project loaded with red
 * conditions moves NOTHING for a non-member — not one total, not one drill id.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

const NOW = '2026-08-07'; // fixed clock (?now= hook); +30d horizon = 2026-09-06

describe('E22 — GET /api/kpis', () => {
  let srv;
  const ids = {};

  const kpis = (user, query = '') =>
    srv.api('GET', `/api/kpis?now=${NOW}${query}`, { user });

  before(async () => {
    srv = await startServer();
    const { api } = srv;
    const created = async (p) => {
      const res = await p;
      assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
      return res.body;
    };

    // Portfolio, attached to project1 only.
    ids.portfolio = (await created(api('POST', '/api/portfolios', {
      user: USERS.troy, body: { title: 'Site enablement portfolio' },
    }))).id;
    const p1 = (await api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy })).body;
    await created(api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy, body: { portfolioId: ids.portfolio, version: p1.version },
    }));

    // Milestones. project1: upcoming GO_LIVE (+13d), overdue STANDARD, a
    // GO_LIVE beyond the 30d horizon, and a DONE GO_LIVE (never "upcoming").
    const milestone = (body) => created(api('POST', '/api/milestones', { user: USERS.troy, body }));
    ids.msGoLive = (await milestone({ projectId: SEED.project1, title: 'Go-live', type: 'GO_LIVE', baselineDue: '2026-08-20' })).id;
    ids.msOverdue = (await milestone({ projectId: SEED.project1, title: 'Late prep', baselineDue: '2026-08-01' })).id;
    ids.msFarGoLive = (await milestone({ projectId: SEED.project1, title: 'Far go-live', type: 'GO_LIVE', baselineDue: '2026-09-20' })).id;
    ids.msDoneGoLive = (await milestone({ projectId: SEED.project1, title: 'Done go-live', type: 'GO_LIVE', status: 'DONE', baselineDue: '2026-08-10' })).id;
    // project3: an OVERDUE GO_LIVE — counts as overdueMilestone, NOT upcoming.
    ids.msOverdueGoLive = (await milestone({ projectId: SEED.project3, title: 'Slipped go-live', type: 'GO_LIVE', baselineDue: '2026-08-01' })).id;

    // Critical open roadblock on project2 (seed roadblock1 is 'high' — never
    // a criticalRoadblocks entry).
    ids.rbCritical = (await created(api('POST', '/api/roadblocks', {
      user: USERS.moussa,
      body: { projectId: SEED.project2, description: 'Core switch DOA', severity: 'critical' },
    }))).id;

    // Overdue OPEN actions: one project-linked (project3), one GENERAL owned
    // by awa. A DONE past-due action never counts.
    ids.aProject = (await created(api('POST', '/api/actions', {
      user: USERS.ibrahima,
      body: { projectId: SEED.project3, title: 'Chase vendor', ownerId: USERS.ibrahima, dueDate: '2026-08-01' },
    }))).id;
    ids.aGeneral = (await created(api('POST', '/api/actions', {
      user: USERS.awa, body: { title: 'File expense report', ownerId: USERS.awa, dueDate: '2026-08-01' },
    }))).id;
    const doneAction = await created(api('POST', '/api/actions', {
      user: USERS.awa, body: { title: 'done late', ownerId: USERS.awa, dueDate: '2026-08-01' },
    }));
    await created(api('PATCH', `/api/actions/${doneAction.id}`, {
      user: USERS.awa, body: { status: 'DONE', version: doneAction.version },
    }));

    // Pending G0 gate request on project3 (PM ibrahima requests).
    await created(api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'PM' },
    }));
    let p3 = (await api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
    await created(api('PATCH', `/api/projects/${SEED.project3}`, {
      user: USERS.troy, body: { sponsorId: USERS.troy, version: p3.version },
    }));
    ids.gateRequest = (await created(api('POST', `/api/projects/${SEED.project3}/gates/request`, {
      user: USERS.ibrahima, body: {},
    }))).id;

    // project3 goes ON_HOLD (the onHold KPI).
    p3 = (await api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
    await created(api('PATCH', `/api/projects/${SEED.project3}`, {
      user: USERS.troy,
      body: { operatingStatus: 'ON_HOLD', holdReason: 'awaiting ops bandwidth', version: p3.version },
    }));
  });
  after(async () => { await srv.close(); });

  describe('KPI rules + drill lists (unfiltered, ADMIN scope)', () => {
    it('every total matches its drill list; each KPI follows its rule', async () => {
      const res = await kpis(USERS.troy);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { scope, totals, drill } = res.body;
      assert.deepEqual(scope, {}); // no filters applied

      assert.equal(totals.projects, 3);
      assert.equal(totals.green + totals.amber + totals.red, totals.projects);
      for (const kpi of ['green', 'amber', 'red', 'onHold', 'upcomingGoLives',
        'overdueMilestones', 'criticalRoadblocks', 'overdueActions', 'gatesWaiting']) {
        assert.equal(drill[kpi].length, totals[kpi], `drill/total mismatch for ${kpi}`);
      }

      assert.ok(drill.red.includes(SEED.project2), 'open critical roadblock makes project2 RED');
      assert.deepEqual(drill.onHold, [SEED.project3]);
      assert.deepEqual(drill.upcomingGoLives, [
        { projectId: SEED.project1, milestoneId: ids.msGoLive, due: '2026-08-20' },
      ]); // far (+44d), DONE, and overdue GO_LIVEs all excluded
      assert.deepEqual(new Set(drill.overdueMilestones.map((m) => m.milestoneId)),
        new Set([ids.msOverdue, ids.msOverdueGoLive]));
      assert.deepEqual(drill.criticalRoadblocks, [
        { projectId: SEED.project2, roadblockId: ids.rbCritical },
      ]);
      // ADMIN unfiltered: the project-linked overdue action AND the general one.
      assert.deepEqual(new Set(drill.overdueActions.map((a) => a.actionId)),
        new Set([ids.aProject, ids.aGeneral]));
      assert.deepEqual(drill.gatesWaiting, [
        { projectId: SEED.project3, gateRequestId: ids.gateRequest, gate: 'G0' },
      ]);
    });

    it('general overdue actions: only on unfiltered calls, only my own readable ones', async () => {
      // ibrahima cannot read awa's general action -> only the project-linked one.
      const ib = await kpis(USERS.ibrahima);
      assert.deepEqual(ib.body.drill.overdueActions, [{ projectId: SEED.project3, actionId: ids.aProject }]);
      // awa owns the general one and can read project3's.
      const awa = await kpis(USERS.awa);
      assert.deepEqual(new Set(awa.body.drill.overdueActions.map((a) => a.actionId)),
        new Set([ids.aProject, ids.aGeneral]));
      // ANY filter drops generals entirely (site-less items cannot match a scope).
      const filtered = await kpis(USERS.awa, '&lifecycleStage=IDEA');
      assert.ok(!filtered.body.drill.overdueActions.some((a) => a.actionId === ids.aGeneral));
    });
  });

  describe('filters (ANDed, recalculating every KPI)', () => {
    it('?site= matches primary site or sites[]', async () => {
      const res = await kpis(USERS.troy, '&site=saly');
      assert.deepEqual(res.body.scope, { site: 'saly' });
      assert.equal(res.body.totals.projects, 2); // project1 + project2
      assert.equal(res.body.totals.gatesWaiting, 0); // project3 out of scope
      assert.equal(res.body.totals.overdueActions, 0); // p3's out; generals off (filtered)
      assert.equal(res.body.totals.criticalRoadblocks, 1);
      assert.deepEqual(res.body.drill.overdueMilestones.map((m) => m.milestoneId), [ids.msOverdue]);

      // sites[] containment: project3 gains saly as an additional site.
      const p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      await srv.api('PATCH', `/api/projects/${SEED.project3}`, {
        user: USERS.troy, body: { sites: ['saly'], version: p3.version },
      });
      const withSites = await kpis(USERS.troy, '&site=saly');
      assert.equal(withSites.body.totals.projects, 3);
      assert.equal(withSites.body.totals.gatesWaiting, 1);
    });

    it('?division=, ?lifecycleStage=, ?portfolioId=, ?ragColor= and AND composition', async () => {
      const division = await kpis(USERS.troy, '&division=bizapps');
      assert.equal(division.body.totals.projects, 1);
      assert.deepEqual(division.body.drill.onHold, [SEED.project3]);
      assert.equal(division.body.totals.criticalRoadblocks, 0);
      assert.equal(division.body.totals.gatesWaiting, 1);

      const stage = await kpis(USERS.troy, '&lifecycleStage=IDEA');
      assert.equal(stage.body.totals.projects, 3); // nothing has passed a gate

      const portfolio = await kpis(USERS.troy, `&portfolioId=${ids.portfolio}`);
      assert.equal(portfolio.body.totals.projects, 1);
      assert.deepEqual(portfolio.body.drill.criticalRoadblocks, []);

      const red = await kpis(USERS.troy, '&ragColor=RED');
      assert.ok(red.body.drill.red.includes(SEED.project2));
      assert.equal(red.body.totals.red, red.body.totals.projects);
      assert.equal(red.body.totals.green + red.body.totals.amber, 0);

      const combined = await kpis(USERS.troy, '&site=saly&division=infra');
      assert.equal(combined.body.totals.projects, 1);
      assert.deepEqual(combined.body.drill.criticalRoadblocks,
        [{ projectId: SEED.project2, roadblockId: ids.rbCritical }]);
      assert.deepEqual(combined.body.scope, { site: 'saly', division: 'infra' });
    });

    it('unknown filter values -> 400 VALIDATION (incl. bad ?now=)', async () => {
      for (const q of [
        '&site=atlantis', '&division=wizardry', '&ragColor=red', '&ragColor=BLUE',
        '&lifecycleStage=BUILD', `&portfolioId=${randomUUID()}`,
      ]) {
        const res = await kpis(USERS.troy, q);
        assert.equal(res.status, 400, `expected 400 for ${q}`);
        assert.equal(res.body.error, 'VALIDATION');
      }
      const badNow = await srv.api('GET', '/api/kpis?now=whenever', { user: USERS.troy });
      assert.equal(badNow.status, 400);
      assert.equal(badNow.body.detail.field, 'now');
    });
  });

  describe('§77 — authorization BEFORE counting', () => {
    it("a confidential red-condition project moves NOTHING in a non-member's KPIs", async () => {
      const before = await kpis(USERS.ibrahima);
      const beforeSaly = await kpis(USERS.ibrahima, '&site=saly');
      assert.equal(before.status, 200);

      // ADMIN creates a confidential project stuffed with red conditions.
      const { api } = srv;
      const secret = (await api('POST', '/api/projects', {
        user: USERS.troy,
        body: {
          name: 'Black Site Migration', description: 'need to know',
          division: 'infra', site: 'saly', classification: 'confidential',
          ownerId: USERS.troy, sponsorId: USERS.troy,
        },
      })).body;
      assert.equal(secret.classification, 'confidential');
      await api('POST', '/api/roadblocks', {
        user: USERS.troy,
        body: { projectId: secret.id, description: 'catastrophic', severity: 'critical' },
      });
      await api('POST', '/api/milestones', {
        user: USERS.troy,
        body: { projectId: secret.id, title: 'missed cutover', baselineDue: '2026-08-01' },
      });
      await api('POST', '/api/milestones', {
        user: USERS.troy,
        body: { projectId: secret.id, title: 'secret go-live', type: 'GO_LIVE', baselineDue: '2026-08-20' },
      });
      await api('POST', '/api/actions', {
        user: USERS.troy,
        body: { projectId: secret.id, title: 'late secret action', ownerId: USERS.troy, dueDate: '2026-08-01' },
      });
      await api('POST', `/api/projects/${secret.id}/gates/request`, { user: USERS.troy, body: {} });

      // The ADMIN's numbers move (sanity: the conditions are real)...
      const admin = await kpis(USERS.troy);
      assert.equal(admin.body.totals.projects, 4);
      assert.ok(admin.body.drill.red.includes(secret.id));
      assert.ok(admin.body.drill.criticalRoadblocks.some((r) => r.projectId === secret.id));
      assert.ok(admin.body.drill.gatesWaiting.some((g) => g.projectId === secret.id));

      // ...but the non-member's totals AND drill ids are byte-identical.
      const after = await kpis(USERS.ibrahima);
      assert.deepEqual(after.body, before.body);
      const afterSaly = await kpis(USERS.ibrahima, '&site=saly');
      assert.deepEqual(afterSaly.body, beforeSaly.body);
      const flat = JSON.stringify(after.body) + JSON.stringify(afterSaly.body);
      assert.ok(!flat.includes(secret.id), 'concealed id must never appear');
    });

    it('enterpriseAccess=false narrows every total to own-site/own projects', async () => {
      const before = await kpis(USERS.awa);
      assert.equal(before.body.totals.projects, 3); // 3 seed internal; the confidential one is invisible
      await srv.api('PATCH', `/api/users/${USERS.awa}`, {
        user: USERS.troy, body: { enterpriseAccess: false },
      });
      // awa (site sabodala): keeps project1 (owner) and project3 (site
      // sabodala); project2 (saly, uninvolved) vanishes from every number.
      const res = await kpis(USERS.awa);
      assert.equal(res.body.totals.projects, 2);
      assert.equal(res.body.totals.criticalRoadblocks, 0);
      assert.ok(!JSON.stringify(res.body).includes(SEED.project2));
    });
  });
});
