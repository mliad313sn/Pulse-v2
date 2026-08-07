/**
 * E11 — Risks (plan §28): derived inherent/residual scores (incl. the
 * residual-null rule), 1-5 bounds validation (400), the task-like write
 * policy, project scoping/concealment, and online-only status.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('E11 — risks', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const post = (user, body) => srv.api('POST', '/api/risks', { user, body });
  const patch = (id, user, body) => srv.api('PATCH', `/api/risks/${id}`, { user, body });

  it('create: defaults + inherentScore derived (p*i); residualScore null until BOTH residuals set', async () => {
    const res = await post(USERS.ibrahima, {
      projectId: SEED.project3, description: 'ERP vendor may miss the licence renewal window',
      probability: 4, impact: 3,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.category, 'other');
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.probability, 4);
    assert.equal(res.body.impact, 3);
    assert.equal(res.body.inherentScore, 12);
    assert.equal(res.body.residualProbability, null);
    assert.equal(res.body.residualImpact, null);
    assert.equal(res.body.residualScore, null);
    assert.equal(res.body.version, 1);
  });

  it('residual-null rule: ONE residual set -> score stays null; both -> derived; clearing one -> null again', async () => {
    const created = await post(USERS.ibrahima, {
      projectId: SEED.project3, description: 'residual math fixture',
      probability: 5, impact: 5, residualProbability: 2,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.inherentScore, 25);
    assert.equal(created.body.residualScore, null, 'one residual alone derives nothing');

    const both = await patch(created.body.id, USERS.ibrahima, { version: 1, residualImpact: 3 });
    assert.equal(both.status, 200);
    assert.equal(both.body.residualScore, 6);

    const cleared = await patch(created.body.id, USERS.ibrahima, { version: 2, residualImpact: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.residualScore, null);
  });

  it('scores are recomputed when probability/impact change and are NOT client-writable', async () => {
    const created = await post(USERS.ibrahima, {
      projectId: SEED.project3, description: 'score recompute fixture', probability: 2, impact: 2,
    });
    assert.equal(created.body.inherentScore, 4);

    const rescored = await patch(created.body.id, USERS.ibrahima, {
      version: 1, probability: 5, inherentScore: 999, residualScore: 999,
    });
    assert.equal(rescored.status, 200);
    assert.equal(rescored.body.inherentScore, 10, 'derived from 5*2 — the smuggled 999 is ignored');
    assert.equal(rescored.body.residualScore, null);
  });

  it('bounds: probability/impact/residuals outside 1-5 (or non-integer) -> 400; missing p/i -> 400', async () => {
    const base = { projectId: SEED.project3, description: 'bounds fixture' };
    const cases = [
      { ...base, probability: 0, impact: 3 },
      { ...base, probability: 6, impact: 3 },
      { ...base, probability: 2.5, impact: 3 },
      { ...base, probability: 3, impact: 0 },
      { ...base, probability: 3, impact: 3, residualProbability: 9 },
      { ...base, probability: 3, impact: 3, residualImpact: 0 },
      { ...base, impact: 3 }, // probability missing
      { ...base, probability: 3 }, // impact missing
      { ...base, probability: 3, impact: 3, category: 'meteorological' },
      { ...base, probability: 3, impact: 3, status: 'DONE' },
      { ...base, probability: 3, impact: 3, targetDate: '07/08/2026' },
    ];
    for (const body of cases) {
      const res = await post(USERS.troy, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error, 'VALIDATION');
    }
  });

  it('write policy: uninvolved contributor 403 on create; risk owner may update own risk; VIEWER 403', async () => {
    // awa is uninvolved in project3 (task-like involvement required).
    const denied = await post(USERS.awa, {
      projectId: SEED.project3, description: 'smuggled risk', probability: 1, impact: 1,
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'FORBIDDEN');

    const viewer = await post(USERS.aissatou, {
      projectId: SEED.project3, description: 'viewer risk', probability: 1, impact: 1,
    });
    assert.equal(viewer.status, 403);

    // Manage-level creates a risk OWNED by awa; awa (uninvolved otherwise)
    // may then update it as the risk owner.
    const owned = await post(USERS.troy, {
      projectId: SEED.project1, description: 'dust ingress in server room',
      probability: 3, impact: 4, ownerId: USERS.awa, category: 'technical',
    });
    assert.equal(owned.status, 201);
    const update = await patch(owned.body.id, USERS.awa, { version: 1, treatment: 'Install positive-pressure filtration', status: 'MITIGATING' });
    assert.equal(update.status, 200);
    assert.equal(update.body.status, 'MITIGATING');

    // But a different uninvolved user (fatou leads 'data', not 'ops') is denied.
    const denied2 = await patch(owned.body.id, USERS.fatou, { version: 2, status: 'CLOSED' });
    assert.equal(denied2.status, 403);
  });

  it('GET /api/projects/:id/risks + GET /api/risks?projectId= agree; concealment filters lists and 404s writes', async () => {
    const viaProject = await srv.api('GET', `/api/projects/${SEED.project3}/risks`, { user: USERS.troy });
    assert.equal(viaProject.status, 200);
    assert.ok(viaProject.body.length >= 3);
    const viaQuery = await srv.api('GET', `/api/risks?projectId=${SEED.project3}`, { user: USERS.troy });
    assert.deepEqual(viaQuery.body.map((r) => r.id).sort(), viaProject.body.map((r) => r.id).sort());

    const proj = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Covert Risk Register', division: 'management', classification: 'confidential' },
    });
    const confRisk = await post(USERS.troy, {
      projectId: proj.body.id, description: 'concealed risk', probability: 1, impact: 1,
    });
    assert.equal(confRisk.status, 201);

    const list = await srv.api('GET', '/api/risks', { user: USERS.awa });
    assert.ok(!list.body.some((r) => r.id === confRisk.body.id));
    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.awa });
    assert.ok(!boot.body.risks.some((r) => r.id === confRisk.body.id));
    const write = await patch(confRisk.body.id, USERS.awa, { version: 1, status: 'MITIGATING' });
    assert.equal(write.status, 404, 'uniform concealment 404');
    const listing = await srv.api('GET', `/api/projects/${proj.body.id}/risks`, { user: USERS.awa });
    assert.equal(listing.status, 404);

    // Creating against a concealed project is indistinguishable from unknown.
    const create = await post(USERS.awa, {
      projectId: proj.body.id, description: 'x', probability: 1, impact: 1,
    });
    assert.equal(create.status, 400);
    assert.match(create.body.message, /Unknown projectId/);
  });

  it('OCC: version required (400) and stale version -> 409 with serverState; risks are audited', async () => {
    const created = await post(USERS.troy, {
      projectId: SEED.project3, description: 'occ fixture', probability: 1, impact: 1,
    });
    const noVersion = await patch(created.body.id, USERS.troy, { status: 'MITIGATING' });
    assert.equal(noVersion.status, 400);
    const stale = await patch(created.body.id, USERS.troy, { version: 5, status: 'MITIGATING' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.detail.serverState.id, created.body.id);

    const audit = await srv.api('GET', `/api/audit?entityId=${created.body.id}`, { user: USERS.troy });
    assert.deepEqual(audit.body.map((e) => e.action), ['INSERT']);
    assert.equal(audit.body[0].entityType, 'risks');
  });
});
