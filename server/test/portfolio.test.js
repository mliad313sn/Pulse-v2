/**
 * E04 — Portfolio foundations: strategic pillars (ADMIN-managed), portfolios
 * and programs (ADMIN or DIVISION_LEAD), reference validation, and project
 * linkage (portfolioId/programId/sponsorId on the project wire shape).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS } from './helpers.js';

describe('E04 — pillars / portfolios / programs', () => {
  let srv;
  let pillar;
  let portfolio;
  let program;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('pillars: POST/PATCH are ADMIN-only; GET open to all users', async () => {
    for (const [who, uid] of [['DIVISION_LEAD', USERS.moussa], ['CONTRIBUTOR', USERS.awa]]) {
      const res = await srv.api('POST', '/api/pillars', {
        user: uid, body: { name: 'Denied Pillar' },
      });
      assert.equal(res.status, 403, `${who} cannot create pillars`);
      assert.equal(res.body.error, 'FORBIDDEN');
    }

    const created = await srv.api('POST', '/api/pillars', {
      user: USERS.troy,
      body: { name: 'Operational Excellence', description: 'Run the mines efficiently' },
    });
    assert.equal(created.status, 201);
    pillar = created.body;
    assert.equal(pillar.name, 'Operational Excellence');
    assert.ok(pillar.id);

    const missingName = await srv.api('POST', '/api/pillars', { user: USERS.troy, body: {} });
    assert.equal(missingName.status, 400);
    assert.equal(missingName.body.error, 'VALIDATION');

    const patched = await srv.api('PATCH', `/api/pillars/${pillar.id}`, {
      user: USERS.troy, body: { description: 'Efficiency and reliability' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.description, 'Efficiency and reliability');

    const patchDenied = await srv.api('PATCH', `/api/pillars/${pillar.id}`, {
      user: USERS.fatou, body: { name: 'Hijacked' },
    });
    assert.equal(patchDenied.status, 403);

    // GET open to everyone, including the VIEWER
    const list = await srv.api('GET', '/api/pillars', { user: USERS.aissatou });
    assert.equal(list.status, 200);
    assert.ok(list.body.some((p) => p.id === pillar.id));
  });

  it('portfolios: ADMIN or DIVISION_LEAD may create/patch; CONTRIBUTOR/VIEWER denied', async () => {
    const asContrib = await srv.api('POST', '/api/portfolios', {
      user: USERS.ibrahima, body: { title: 'Denied' },
    });
    assert.equal(asContrib.status, 403);
    const asViewer = await srv.api('POST', '/api/portfolios', {
      user: USERS.aissatou, body: { title: 'Denied' },
    });
    assert.equal(asViewer.status, 403);

    const created = await srv.api('POST', '/api/portfolios', {
      user: USERS.moussa, // DIVISION_LEAD
      body: {
        title: 'Site Modernization 2026',
        description: 'All site-infrastructure modernization work',
        pillarId: pillar.id,
        ownerId: USERS.moussa,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      },
    });
    assert.equal(created.status, 201);
    portfolio = created.body;
    assert.equal(portfolio.pillarId, pillar.id);
    assert.equal(portfolio.dateFrom, '2026-01-01');

    const badPillar = await srv.api('POST', '/api/portfolios', {
      user: USERS.troy, body: { title: 'X', pillarId: randomUUID() },
    });
    assert.equal(badPillar.status, 400);
    assert.equal(badPillar.body.error, 'VALIDATION');

    const badDate = await srv.api('POST', '/api/portfolios', {
      user: USERS.troy, body: { title: 'X', dateFrom: 'not-a-date' },
    });
    assert.equal(badDate.status, 400);

    const patched = await srv.api('PATCH', `/api/portfolios/${portfolio.id}`, {
      user: USERS.troy, body: { description: 'Updated scope' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.description, 'Updated scope');
    assert.equal(patched.body.title, 'Site Modernization 2026');
  });

  it('programs: require an existing portfolioId; same role wall as portfolios', async () => {
    const missing = await srv.api('POST', '/api/programs', {
      user: USERS.moussa, body: { title: 'No portfolio' },
    });
    assert.equal(missing.status, 400);

    const unknown = await srv.api('POST', '/api/programs', {
      user: USERS.moussa, body: { title: 'Ghost', portfolioId: randomUUID() },
    });
    assert.equal(unknown.status, 400);

    const denied = await srv.api('POST', '/api/programs', {
      user: USERS.awa, body: { title: 'Denied', portfolioId: portfolio.id },
    });
    assert.equal(denied.status, 403);

    const created = await srv.api('POST', '/api/programs', {
      user: USERS.moussa,
      body: {
        title: 'Saly Network Program',
        objective: 'Modern core network for Saly',
        portfolioId: portfolio.id,
        ownerId: USERS.moussa,
      },
    });
    assert.equal(created.status, 201);
    program = created.body;
    assert.equal(program.portfolioId, portfolio.id);

    // filterable by portfolio
    const list = await srv.api('GET', `/api/programs?portfolioId=${portfolio.id}`, { user: USERS.awa });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((p) => p.id), [program.id]);
  });

  it('projects link to portfolio/program/sponsor and expose them on the wire', async () => {
    const created = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: {
        name: 'Saly WAN Upgrade',
        division: 'infra',
        portfolioId: portfolio.id,
        programId: program.id,
        sponsorId: USERS.troy,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.portfolioId, portfolio.id);
    assert.equal(created.body.programId, program.id);
    assert.equal(created.body.sponsorId, USERS.troy);
    assert.equal(created.body.lifecycleStage, 'IDEA'); // default
    assert.equal(created.body.operatingStatus, 'NOT_STARTED'); // default
    assert.deepEqual(created.body.engagedDivisions, []);
    assert.deepEqual(created.body.sites, []);
    assert.equal(created.body.pmId, null); // derived: no PM member yet

    const badRef = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: { name: 'Bad ref', division: 'infra', portfolioId: randomUUID() },
    });
    assert.equal(badRef.status, 400);
    assert.equal(badRef.body.error, 'VALIDATION');

    const badDivisions = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: { name: 'Bad div', division: 'infra', engagedDivisions: ['ghost_division'] },
    });
    assert.equal(badDivisions.status, 400);
  });

  it('bootstrap carries pillars, portfolios and programs for the client cache', async () => {
    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.awa });
    assert.equal(boot.status, 200);
    assert.ok(boot.body.pillars.some((p) => p.id === pillar.id));
    assert.ok(boot.body.portfolios.some((p) => p.id === portfolio.id));
    assert.ok(boot.body.programs.some((p) => p.id === program.id));
  });
});
