/**
 * E10 — RAG / health engine: pure signal matrix (schedule, roadblocks,
 * overdueWork, freshness — thresholds, exemptions, worst-wins, explanations),
 * the manual override endpoints (reason length, authz, audit, MANUAL badge),
 * change-based rag_snapshots (plan §133) and the decorated `rag` block on
 * list/get/bootstrap.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeRag } from '../src/services/rag.js';
import { startServer, USERS, SEED } from './helpers.js';

// ---------------------------------------------------------------------------
// Pure engine matrix (hand-built fixtures, fixed clock)
// ---------------------------------------------------------------------------
const NOW = new Date('2026-08-07T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();
const dateAgo = (n) => daysAgo(n).slice(0, 10);

const project = (over = {}) => ({
  id: 'p-test', createdAt: daysAgo(5), updatedAt: daysAgo(5),
  operatingStatus: 'IN_PROGRESS', lifecycleStage: 'EXECUTION', ragOverride: null, ...over,
});
const ms = (over = {}) => ({
  status: 'NOT_STARTED', baselineDue: null, forecastDue: null, updatedAt: daysAgo(1), ...over,
});
const task = (over = {}) => ({ status: 'todo', plannedFinish: null, updatedAt: daysAgo(1), ...over });
const rb = (over = {}) => ({ severity: 'medium', status: 'open', updatedAt: daysAgo(1), ...over });
const freshUpdate = () => ({ createdAt: daysAgo(1) });

/** computeRag with a fresh update + healthy defaults, overridable per input. */
const rag = (over = {}) =>
  computeRag({ project: project(), updates: [freshUpdate()], now: NOW, ...over });
const signal = (result, key) => result.signals.find((s) => s.key === key);

describe('E10 — computeRag (pure engine)', () => {
  describe('schedule signal', () => {
    it('no milestones -> GREEN', () => {
      const r = rag({ milestones: [] });
      assert.equal(signal(r, 'schedule').color, 'GREEN');
      assert.equal(r.color, 'GREEN');
    });

    it('1 of 5 active slipped (20%) -> AMBER with a counting explanation', () => {
      const r = rag({ milestones: [ms({ status: 'SLIPPED' }), ms(), ms(), ms(), ms()] });
      const s = signal(r, 'schedule');
      assert.equal(s.color, 'AMBER');
      assert.equal(s.explanation, '1 of 5 active milestones are slipped or overdue');
      assert.equal(r.color, 'AMBER');
    });

    it('2 of 5 active late (40%) -> RED', () => {
      const r = rag({
        milestones: [ms({ status: 'SLIPPED' }), ms({ baselineDue: dateAgo(3) }), ms(), ms(), ms()],
      });
      assert.equal(signal(r, 'schedule').color, 'RED');
      assert.equal(r.color, 'RED');
    });

    it('forecastDue overrides baselineDue for overdue detection', () => {
      const pushedOut = rag({
        milestones: [ms({ baselineDue: dateAgo(3), forecastDue: '2027-01-01' })],
      });
      assert.equal(signal(pushedOut, 'schedule').color, 'GREEN');
      const forecastLate = rag({ milestones: [ms({ forecastDue: dateAgo(1) })] });
      assert.equal(signal(forecastLate, 'schedule').color, 'RED'); // 1 of 1 > 20%
    });

    it('DONE and CANCELLED milestones are not active (even when dated in the past)', () => {
      const r = rag({
        milestones: [
          ms({ status: 'DONE', baselineDue: dateAgo(10) }),
          ms({ status: 'CANCELLED', baselineDue: dateAgo(10) }),
          ms(),
        ],
      });
      assert.equal(signal(r, 'schedule').color, 'GREEN');
    });
  });

  describe('roadblocks signal', () => {
    it('open critical -> RED; open high -> AMBER; resolved -> GREEN', () => {
      const red = rag({ roadblocks: [rb({ severity: 'critical' })] });
      assert.equal(signal(red, 'roadblocks').color, 'RED');
      assert.match(signal(red, 'roadblocks').explanation, /critical roadblock/);

      const amber = rag({ roadblocks: [rb({ severity: 'high', status: 'mitigating' })] });
      assert.equal(signal(amber, 'roadblocks').color, 'AMBER');

      const green = rag({
        roadblocks: [rb({ severity: 'critical', status: 'resolved' }), rb({ severity: 'medium' })],
      });
      assert.equal(signal(green, 'roadblocks').color, 'GREEN');
    });
  });

  describe('overdueWork signal', () => {
    const overdueTask = () => task({ plannedFinish: dateAgo(2) });
    it('0 -> GREEN, 1-3 -> AMBER, >=4 -> RED; done tasks excluded', () => {
      assert.equal(signal(rag({ tasks: [task()] }), 'overdueWork').color, 'GREEN');
      assert.equal(signal(rag({ tasks: [overdueTask()] }), 'overdueWork').color, 'AMBER');
      assert.equal(
        signal(rag({ tasks: [overdueTask(), overdueTask(), overdueTask()] }), 'overdueWork').color,
        'AMBER',
      );
      const red = rag({ tasks: [overdueTask(), overdueTask(), overdueTask(), overdueTask()] });
      assert.equal(signal(red, 'overdueWork').color, 'RED');
      assert.equal(signal(red, 'overdueWork').explanation, '4 open tasks past planned finish');
      const done = rag({ tasks: [task({ status: 'done', plannedFinish: dateAgo(9) })] });
      assert.equal(signal(done, 'overdueWork').color, 'GREEN');
    });
  });

  describe('freshness signal', () => {
    it('update <=21 days old -> GREEN', () => {
      const r = rag({ updates: [{ createdAt: daysAgo(20) }] });
      assert.equal(signal(r, 'freshness').color, 'GREEN');
    });

    it('update >21 days old with recent other activity -> AMBER', () => {
      const r = rag({ updates: [{ createdAt: daysAgo(25) }], tasks: [task({ updatedAt: daysAgo(2) })] });
      const s = signal(r, 'freshness');
      assert.equal(s.color, 'AMBER');
      assert.match(s.explanation, /No project update for 25 days/);
    });

    it('update >21 days old AND total silence >30 days -> RED', () => {
      const r = rag({ updates: [{ createdAt: daysAgo(35) }], tasks: [], milestones: [], roadblocks: [] });
      const s = signal(r, 'freshness');
      assert.equal(s.color, 'RED');
      assert.match(s.explanation, /no meaningful activity for 35 days/);
    });

    it('new project (<21d, no updates) -> GREEN "recently created"', () => {
      const r = rag({ project: project({ createdAt: daysAgo(5) }), updates: [] });
      const s = signal(r, 'freshness');
      assert.equal(s.color, 'GREEN');
      assert.equal(s.explanation, 'recently created');
    });

    it('old project with no updates: AMBER while active, RED once silent >30d', () => {
      const amber = rag({
        project: project({ createdAt: daysAgo(25) }), updates: [], tasks: [task({ updatedAt: daysAgo(2) })],
      });
      assert.equal(signal(amber, 'freshness').color, 'AMBER');

      const red = rag({ project: project({ createdAt: daysAgo(40) }), updates: [], tasks: [] });
      assert.equal(signal(red, 'freshness').color, 'RED');
    });

    it('ON_HOLD/COMPLETED/CANCELLED and RUN/CLOSED are exempt', () => {
      for (const over of [
        { operatingStatus: 'ON_HOLD' }, { operatingStatus: 'COMPLETED' },
        { operatingStatus: 'CANCELLED' }, { lifecycleStage: 'RUN' }, { lifecycleStage: 'CLOSED' },
      ]) {
        const r = rag({ project: project(over), updates: [{ createdAt: daysAgo(90) }] });
        const s = signal(r, 'freshness');
        assert.equal(s.color, 'GREEN', JSON.stringify(over));
        assert.equal(s.explanation, 'freshness not tracked in this state');
      }
    });
  });

  describe('worst-wins + explanations', () => {
    it('the worst active signal wins and drives the top-level explanation', () => {
      const r = rag({
        milestones: [ms({ status: 'SLIPPED' }), ms(), ms(), ms(), ms()], // AMBER
        roadblocks: [rb({ severity: 'critical' })], // RED
      });
      assert.equal(r.color, 'RED');
      assert.equal(r.computedColor, 'RED');
      assert.match(r.explanation, /^RED — /);
      assert.match(r.explanation, /critical roadblock/);
    });

    it('all green -> GREEN with a summary explanation', () => {
      const r = rag({});
      assert.equal(r.color, 'GREEN');
      assert.equal(r.manual, null);
      assert.equal(r.explanation, 'All health signals are green');
    });

    it('every signal always carries key, label, color and a non-empty explanation', () => {
      const r = rag({
        milestones: [ms({ status: 'SLIPPED' })],
        roadblocks: [rb({ severity: 'high' })],
        tasks: [task({ plannedFinish: dateAgo(1) })],
        updates: [{ createdAt: daysAgo(25) }],
      });
      assert.deepEqual(r.signals.map((s) => s.key), ['schedule', 'roadblocks', 'overdueWork', 'freshness']);
      for (const s of r.signals) {
        assert.ok(s.label.length > 0);
        assert.ok(['GREEN', 'AMBER', 'RED'].includes(s.color));
        assert.ok(typeof s.explanation === 'string' && s.explanation.length > 0, s.key);
      }
    });

    it('manual override: color = override, computedColor kept, manual block set', () => {
      const override = { color: 'GREEN', reason: 'Vendor credit fully covers the slippage impact.', byId: 'u1', at: daysAgo(0) };
      const r = rag({
        project: project({ ragOverride: override }),
        roadblocks: [rb({ severity: 'critical' })],
      });
      assert.equal(r.color, 'GREEN');
      assert.equal(r.computedColor, 'RED');
      assert.deepEqual(r.manual, override);
      assert.match(r.explanation, /Manually set to GREEN/);
    });
  });
});

// ---------------------------------------------------------------------------
// API: decoration, override endpoints, snapshots
// ---------------------------------------------------------------------------
describe('E10 — RAG over the API', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const LONG_REASON = 'Mitigation plan agreed with the vendor and steering on 2026-08-07.';

  it('every project in list/get/bootstrap carries the derived rag block', async () => {
    const list = await srv.api('GET', '/api/projects', { user: USERS.troy });
    assert.equal(list.status, 200);
    for (const p of list.body) {
      assert.ok(p.rag, `project ${p.id} missing rag`);
      assert.ok(['GREEN', 'AMBER', 'RED'].includes(p.rag.color));
      assert.equal(p.rag.color, p.rag.computedColor);
      assert.equal(p.rag.manual, null);
      assert.equal(p.rag.signals.length, 4);
      assert.ok(p.rag.explanation.length > 0);
    }
    // Seed ground truth: project1 has an open HIGH roadblock and a fresh
    // update -> AMBER via the roadblocks signal.
    const p1 = list.body.find((p) => p.id === SEED.project1);
    assert.equal(p1.rag.color, 'AMBER');
    assert.equal(p1.rag.signals.find((s) => s.key === 'roadblocks').color, 'AMBER');
    assert.equal(p1.rag.signals.find((s) => s.key === 'freshness').color, 'GREEN');

    const single = await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy });
    assert.ok(single.body.rag);
    assert.equal(single.body.rag.color, 'GREEN'); // fresh seed project, no blockers

    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.troy });
    assert.ok(boot.body.projects.every((p) => p.rag && p.rag.signals.length === 4));
  });

  it('rag is derived: it cannot be written via PATCH', async () => {
    const p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
    const res = await srv.api('PATCH', `/api/projects/${SEED.project3}`, {
      user: USERS.troy,
      body: { version: p3.version, rag: { color: 'RED' }, description: 'no rag smuggling' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.rag.color, 'GREEN');
  });

  it('snapshots append only when the color changes (lazy, at read time)', async () => {
    // The list read above already captured the initial GREEN snapshot.
    const first = await srv.api('GET', `/api/projects/${SEED.project3}/rag-history`, { user: USERS.troy });
    assert.equal(first.status, 200);
    assert.equal(first.body.length, 1);
    assert.equal(first.body[0].color, 'GREEN');
    assert.equal(first.body[0].isManual, false);

    // Re-reading without any input change appends nothing.
    await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy });
    const second = await srv.api('GET', `/api/projects/${SEED.project3}/rag-history`, { user: USERS.troy });
    assert.equal(second.body.length, 1);
  });

  it('a critical roadblock flips the project RED with an explanation, and snapshots it', async () => {
    const created = await srv.api('POST', '/api/roadblocks', {
      user: USERS.ibrahima,
      body: { projectId: SEED.project3, description: 'ERP vendor bankrupt', severity: 'critical' },
    });
    assert.equal(created.status, 201);

    const p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
    assert.equal(p3.rag.color, 'RED');
    assert.match(p3.rag.explanation, /critical roadblock/);

    const history = await srv.api('GET', `/api/projects/${SEED.project3}/rag-history`, { user: USERS.troy });
    assert.equal(history.body.length, 2);
    assert.equal(history.body[0].color, 'RED', 'newest first');
    assert.equal(history.body[1].color, 'GREEN');
  });

  describe('manual override (plan §25)', () => {
    it('reason shorter than 30 chars (after trim) -> 400 RAG_OVERRIDE_REASON_TOO_SHORT', async () => {
      for (const reason of [undefined, 'too short', `   ${'x'.repeat(29)}   `]) {
        const res = await srv.api('POST', `/api/projects/${SEED.project3}/rag-override`, {
          user: USERS.troy, body: { color: 'GREEN', reason },
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'RAG_OVERRIDE_REASON_TOO_SHORT');
      }
    });

    it('bad color -> 400 VALIDATION; non-manager -> 403; VIEWER -> 403', async () => {
      const badColor = await srv.api('POST', `/api/projects/${SEED.project3}/rag-override`, {
        user: USERS.troy, body: { color: 'BLUE', reason: LONG_REASON },
      });
      assert.equal(badColor.status, 400);
      assert.equal(badColor.body.error, 'VALIDATION');

      // Awa can read project3 (internal) but has no manage authority on it.
      const nonManager = await srv.api('POST', `/api/projects/${SEED.project3}/rag-override`, {
        user: USERS.awa, body: { color: 'GREEN', reason: LONG_REASON },
      });
      assert.equal(nonManager.status, 403);

      const viewer = await srv.api('POST', `/api/projects/${SEED.project3}/rag-override`, {
        user: USERS.aissatou, body: { color: 'GREEN', reason: LONG_REASON },
      });
      assert.equal(viewer.status, 403);
    });

    it('set: effective color = override, computedColor kept, MANUAL badge fields, audited', async () => {
      const res = await srv.api('POST', `/api/projects/${SEED.project3}/rag-override`, {
        user: USERS.troy, body: { color: 'GREEN', reason: LONG_REASON },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.rag.color, 'GREEN');
      assert.equal(res.body.rag.computedColor, 'RED'); // critical roadblock still open
      assert.equal(res.body.rag.manual.color, 'GREEN');
      assert.equal(res.body.rag.manual.reason, LONG_REASON);
      assert.equal(res.body.rag.manual.byId, USERS.troy);
      assert.ok(res.body.rag.manual.at);

      // Persisted: a later read agrees.
      const again = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.moussa })).body;
      assert.equal(again.rag.color, 'GREEN');
      assert.ok(again.rag.manual);

      // Audit permanently retains reason + before/after computed color.
      const audit = await srv.api('GET', `/api/audit?entityId=${SEED.project3}`, { user: USERS.troy });
      const entry = audit.body.find((e) => e.action === 'RAG_OVERRIDE_SET');
      assert.ok(entry, 'RAG_OVERRIDE_SET audit entry exists');
      assert.equal(entry.actorId, USERS.troy);
      assert.equal(entry.newData.reason, LONG_REASON);
      assert.equal(entry.newData.computedColorBefore, 'RED');
      assert.equal(entry.newData.effectiveColorAfter, 'GREEN');
    });

    it('the override change is snapshotted with isManual=true', async () => {
      const history = await srv.api('GET', `/api/projects/${SEED.project3}/rag-history`, { user: USERS.troy });
      assert.equal(history.body[0].color, 'GREEN');
      assert.equal(history.body[0].computedColor, 'RED');
      assert.equal(history.body[0].isManual, true);
    });

    it('clear: non-manager 403; manager clears (audited) and the computed color returns', async () => {
      const denied = await srv.api('DELETE', `/api/projects/${SEED.project3}/rag-override`, { user: USERS.awa });
      assert.equal(denied.status, 403);

      const res = await srv.api('DELETE', `/api/projects/${SEED.project3}/rag-override`, { user: USERS.troy });
      assert.equal(res.status, 200);
      assert.equal(res.body.rag.manual, null);
      assert.equal(res.body.rag.color, 'RED');

      const audit = await srv.api('GET', `/api/audit?entityId=${SEED.project3}`, { user: USERS.troy });
      const entry = audit.body.find((e) => e.action === 'RAG_OVERRIDE_CLEARED');
      assert.ok(entry);
      assert.equal(entry.newData.cleared.reason, LONG_REASON);

      const history = await srv.api('GET', `/api/projects/${SEED.project3}/rag-history`, { user: USERS.troy });
      assert.equal(history.body[0].isManual, false);
      assert.equal(history.body[0].color, 'RED');
    });
  });

  it('rag-history conceals unreadable projects with the uniform 404', async () => {
    const proj = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Covert Health', division: 'infra', classification: 'confidential' },
    });
    assert.equal(proj.status, 201);
    const res = await srv.api('GET', `/api/projects/${proj.body.id}/rag-history`, { user: USERS.ibrahima });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  it('the executive deck data carries rag + latest update text', async () => {
    const { buildDeckData } = await import('../src/reporter/deck.js');
    const troy = await srv.repo.getUser(USERS.troy);
    const data = await buildDeckData(srv.repo, troy);
    const ops = data.divisions.find((d) => d.code === 'ops');
    const readiness = ops.projects.find((p) => p.id === SEED.project1);
    assert.equal(readiness.rag.color, 'AMBER'); // open high roadblock
    assert.match(readiness.rag.explanation, /high-severity roadblock/);
    assert.equal(readiness.rag.manual, false);
    assert.match(readiness.latestUpdate.text, /cooling unit/i);

    const bizapps = data.divisions.find((d) => d.code === 'bizapps');
    const erp = bizapps.projects.find((p) => p.id === SEED.project3);
    assert.equal(erp.rag.color, 'RED'); // critical roadblock from the earlier test
  });
});
