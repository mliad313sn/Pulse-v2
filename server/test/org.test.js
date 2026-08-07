/**
 * E01 — Org structure administration: sites/divisions GET open to every
 * authenticated user, POST/PATCH ADMIN-only, code immutability once
 * referenced, and the /api/org/tree Admin Center overview.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS } from './helpers.js';

describe('E01 — org admin (sites, divisions, org tree)', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('GET /api/sites and /api/divisions work for every authenticated user (incl. VIEWER)', async () => {
    for (const uid of [USERS.awa, USERS.aissatou]) {
      const sites = await srv.api('GET', '/api/sites', { user: uid });
      assert.equal(sites.status, 200);
      assert.deepEqual(sites.body.map((s) => s.code).sort(), ['hq', 'sabodala', 'saly']);
      assert.ok(sites.body.every((s) => 'name' in s && 'description' in s));

      const divisions = await srv.api('GET', '/api/divisions', { user: uid });
      assert.equal(divisions.status, 200);
      assert.equal(divisions.body.length, 7);
      assert.ok(divisions.body.some((d) => d.code === 'infra' && d.name === 'Infrastructure'));
    }
    const anon = await srv.api('GET', '/api/sites', {});
    assert.equal(anon.status, 401);
  });

  it('POST /api/sites: ADMIN creates; non-admin roles -> 403; duplicate/invalid code -> 400', async () => {
    for (const uid of [USERS.moussa, USERS.awa]) { // DIVISION_LEAD, CONTRIBUTOR
      const res = await srv.api('POST', '/api/sites', {
        user: uid, body: { code: 'dakar', name: 'Dakar Office' },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'FORBIDDEN');
    }
    const created = await srv.api('POST', '/api/sites', {
      user: USERS.troy, body: { code: 'dakar', name: 'Dakar Office', description: 'Regional hub' },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { code: 'dakar', name: 'Dakar Office', description: 'Regional hub' });

    const dup = await srv.api('POST', '/api/sites', {
      user: USERS.troy, body: { code: 'dakar', name: 'Again' },
    });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.error, 'VALIDATION');

    const badCode = await srv.api('POST', '/api/sites', {
      user: USERS.troy, body: { code: 'Bad Code!', name: 'X' },
    });
    assert.equal(badCode.status, 400);
  });

  it('PATCH site: name/description editable by ADMIN; non-admin 403; unknown 404', async () => {
    const res = await srv.api('PATCH', '/api/sites/dakar', {
      user: USERS.troy, body: { name: 'Dakar Regional Office' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Dakar Regional Office');
    assert.equal(res.body.description, 'Regional hub'); // untouched

    const asLead = await srv.api('PATCH', '/api/sites/dakar', {
      user: USERS.moussa, body: { name: 'Nope' },
    });
    assert.equal(asLead.status, 403);

    const missing = await srv.api('PATCH', '/api/sites/ghost', {
      user: USERS.troy, body: { name: 'X' },
    });
    assert.equal(missing.status, 404);
  });

  it('site/division code is immutable once referenced; unreferenced codes may be renamed', async () => {
    // saly is referenced by users/projects -> rename refused
    const refused = await srv.api('PATCH', '/api/sites/saly', {
      user: USERS.troy, body: { code: 'saly2' },
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'VALIDATION');

    // freshly created, unreferenced -> rename allowed
    const renamed = await srv.api('PATCH', '/api/sites/dakar', {
      user: USERS.troy, body: { code: 'dkr' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.code, 'dkr');
    const list = await srv.api('GET', '/api/sites', { user: USERS.troy });
    assert.ok(list.body.some((s) => s.code === 'dkr'));
    assert.ok(!list.body.some((s) => s.code === 'dakar'));

    // referenced division code rename refused as well
    const div = await srv.api('PATCH', '/api/divisions/infra', {
      user: USERS.troy, body: { code: 'infrastructure' },
    });
    assert.equal(div.status, 400);
    // ...but its description stays editable
    const desc = await srv.api('PATCH', '/api/divisions/infra', {
      user: USERS.troy, body: { description: 'Networks, systems and site deployment' },
    });
    assert.equal(desc.status, 200);
    assert.equal(desc.body.description, 'Networks, systems and site deployment');
    assert.equal(desc.body.code, 'infra');
  });

  it('POST /api/divisions: ADMIN only; new division usable afterwards', async () => {
    const denied = await srv.api('POST', '/api/divisions', {
      user: USERS.fatou, body: { code: 'pmo', name: 'Portfolio Management Office' },
    });
    assert.equal(denied.status, 403);

    const created = await srv.api('POST', '/api/divisions', {
      user: USERS.troy, body: { code: 'pmo', name: 'Portfolio Management Office' },
    });
    assert.equal(created.status, 201);

    // the new division is immediately valid for user management
    const user = await srv.api('POST', '/api/users', {
      user: USERS.troy,
      body: { name: 'PMO Person', email: 'pmo.person@opspm360.local', division: 'pmo', baseRole: 'CONTRIBUTOR' },
    });
    assert.equal(user.status, 201);
  });

  it('GET /api/org/tree returns sites + divisions with users-per-division counts', async () => {
    const res = await srv.api('GET', '/api/org/tree', { user: USERS.aissatou }); // any user may read
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sites) && res.body.sites.length >= 3);
    const byCode = Object.fromEntries(res.body.divisions.map((d) => [d.code, d]));
    assert.equal(byCode.management.userCount, 2); // troy + aissatou
    assert.equal(byCode.infra.userCount, 1); // moussa
    assert.equal(byCode.pmo.userCount, 1); // created above
    assert.ok(byCode.ops.name === 'Operations');
  });

  it('VIEWER cannot mutate org structures (hard read-only wall)', async () => {
    const res = await srv.api('POST', '/api/sites', {
      user: USERS.aissatou, body: { code: 'v', name: 'V' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  });
});
