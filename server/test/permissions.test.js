/**
 * E03 — Permission matrix (negative-heavy): base role x operation, the
 * security_reviewer PRIVILEGE (not role) for approval decisions, VIEWER
 * hard read-only across every mutating endpoint, and ADMIN-only
 * classification changes.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('E03 — permission matrix', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const ROLES = [
    ['ADMIN', () => USERS.troy],
    ['DIVISION_LEAD', () => USERS.moussa],
    ['CONTRIBUTOR', () => USERS.ibrahima],
    ['VIEWER', () => USERS.aissatou],
  ];

  it('read projects: every base role (incl. VIEWER) may list internal projects', async () => {
    for (const [role, uid] of ROLES) {
      const res = await srv.api('GET', '/api/projects', { user: uid() });
      assert.equal(res.status, 200, `${role} can list projects`);
      assert.ok(res.body.some((p) => p.id === SEED.project1), `${role} sees internal seed project`);
    }
  });

  it('create project: ADMIN + DIVISION_LEAD allowed; CONTRIBUTOR + VIEWER -> 403', async () => {
    const expected = { ADMIN: 201, DIVISION_LEAD: 201, CONTRIBUTOR: 403, VIEWER: 403 };
    for (const [role, uid] of ROLES) {
      const res = await srv.api('POST', '/api/projects', {
        user: uid(),
        body: { name: `Matrix ${role} project`, division: 'infra' },
      });
      assert.equal(res.status, expected[role], `create project as ${role}`);
      if (res.status === 403) assert.equal(res.body.error, 'FORBIDDEN');
    }
  });

  it('patch task: ADMIN, DIVISION_LEAD (own division), CONTRIBUTOR (assignee) allowed; VIEWER -> 403', async () => {
    // E04 write model: DIVISION_LEAD authority is scoped to the project's own
    // division and a plain CONTRIBUTOR must be personally involved, so each
    // role targets a task it legitimately holds the capability for.
    const CASES = [
      ['ADMIN', USERS.troy, SEED.erpTask, 200],
      ['DIVISION_LEAD', USERS.moussa, SEED.infraTask, 200], // moussa leads infra; infraTask is infra
      ['CONTRIBUTOR', USERS.ibrahima, SEED.erpTask, 200], // ibrahima is the assignee
      ['VIEWER', USERS.aissatou, SEED.erpTask, 403],
    ];
    for (const [role, uid, taskId, expected] of CASES) {
      const current = await srv.api('GET', `/api/tasks/${taskId}`, { user: USERS.troy });
      const res = await srv.api('PATCH', `/api/tasks/${taskId}`, {
        user: uid,
        body: { version: current.body.version, description: `touched by ${role}` },
      });
      assert.equal(res.status, expected, `patch task as ${role}`);
    }
  });

  it('E04 tightening: uninvolved CONTRIBUTOR and cross-division DIVISION_LEAD get 403 on task writes', async () => {
    const current = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.troy });
    for (const [who, uid] of [['unrelated ops CONTRIBUTOR', USERS.awa], ['cross-division DIVISION_LEAD', USERS.fatou]]) {
      const res = await srv.api('PATCH', `/api/tasks/${SEED.erpTask}`, {
        user: uid,
        body: { version: current.body.version, description: 'should be denied' },
      });
      assert.equal(res.status, 403, `${who} denied`);
      assert.equal(res.body.error, 'FORBIDDEN');

      const create = await srv.api('POST', '/api/tasks', {
        user: uid,
        body: { projectId: SEED.project3, title: 'smuggled task', assigneeId: uid },
      });
      assert.equal(create.status, 403, `${who} denied task create (even self-assigned)`);
    }
  });

  it('create roadblock: all writers allowed; VIEWER -> 403', async () => {
    for (const [role, uid] of ROLES) {
      const res = await srv.api('POST', '/api/roadblocks', {
        user: uid(),
        body: { projectId: SEED.project1, description: `roadblock by ${role}` },
      });
      const expected = role === 'VIEWER' ? 403 : 201;
      assert.equal(res.status, expected, `create roadblock as ${role}`);
    }
  });

  it("decide approval: ONLY the security_reviewer privilege — ADMIN without it is denied, CONTRIBUTOR with it is allowed", async () => {
    // troy is ADMIN but has NO security_reviewer privilege -> 403
    for (const [who, uid] of [['ADMIN', USERS.troy], ['DIVISION_LEAD', USERS.moussa], ['CONTRIBUTOR', USERS.ibrahima], ['VIEWER', USERS.aissatou]]) {
      const res = await srv.api('POST', `/api/approvals/${SEED.approval1}/decision`, {
        user: uid, body: { decision: 'approved' },
      });
      assert.equal(res.status, 403, `${who} without the privilege denied`);
      assert.equal(res.body.error, 'FORBIDDEN');
    }
    // hamady is a plain CONTRIBUTOR holding the privilege -> allowed
    const ok = await srv.api('POST', `/api/approvals/${SEED.approval1}/decision`, {
      user: USERS.hamady, body: { decision: 'approved', notes: 'matrix check' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.approval.reviewedBy, USERS.hamady);
  });

  it('user management (create/patch): ADMIN only, everyone else -> 403', async () => {
    for (const [role, uid] of ROLES) {
      const create = await srv.api('POST', '/api/users', {
        user: uid(),
        body: { name: `X ${role}`, email: `x.${role.toLowerCase()}@opspm360.local`, division: 'ops', baseRole: 'VIEWER' },
      });
      const patch = await srv.api('PATCH', `/api/users/${USERS.awa}`, {
        user: uid(), body: { site: 'hq' },
      });
      const list = await srv.api('GET', '/api/users', { user: uid() });
      if (role === 'ADMIN') {
        assert.equal(create.status, 201);
        assert.equal(patch.status, 200);
        assert.equal(list.status, 200);
        assert.ok(list.body.every((u) => u.baseRole && u.privileges !== undefined && u.isActive !== undefined));
        assert.ok(!JSON.stringify(list.body).toLowerCase().includes('passwordhash'));
      } else {
        assert.equal(create.status, 403, `create user as ${role}`);
        assert.equal(patch.status, 403, `patch user as ${role}`);
        // Read-only directory is open to every authenticated role (people
        // pickers need it); credential fields must never appear.
        assert.equal(list.status, 200, `list users as ${role}`);
        assert.ok(!JSON.stringify(list.body).toLowerCase().includes('passwordhash'));
      }
    }
    // undo the admin's site change
    await srv.api('PATCH', `/api/users/${USERS.awa}`, { user: USERS.troy, body: { site: 'sabodala' } });
  });

  it('set classification: ADMIN may change it; owner DIVISION_LEAD, CONTRIBUTOR, VIEWER -> 403', async () => {
    for (const [role, uid] of [['DIVISION_LEAD (owner)', () => USERS.moussa], ['CONTRIBUTOR', () => USERS.ibrahima], ['VIEWER', () => USERS.aissatou]]) {
      const current = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.troy });
      const res = await srv.api('PATCH', `/api/projects/${SEED.project2}`, {
        user: uid(),
        body: { version: current.body.version, classification: 'restricted' },
      });
      assert.equal(res.status, 403, `classification change as ${role}`);
      assert.equal(res.body.error, 'FORBIDDEN');
    }
    const current = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.troy });
    const admin = await srv.api('PATCH', `/api/projects/${SEED.project2}`, {
      user: USERS.troy,
      body: { version: current.body.version, classification: 'restricted' },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.classification, 'restricted');
    // revert for the rest of the suite
    const now = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.troy });
    await srv.api('PATCH', `/api/projects/${SEED.project2}`, {
      user: USERS.troy, body: { version: now.body.version, classification: 'internal' },
    });
  });

  it('non-ADMIN creating a project with a classification gets it FORCED to internal', async () => {
    const asLead = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: { name: 'Lead tries confidential', division: 'infra', classification: 'confidential' },
    });
    assert.equal(asLead.status, 201);
    assert.equal(asLead.body.classification, 'internal', 'forced to internal for non-ADMIN');

    const asAdmin = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Admin sets confidential', division: 'management', classification: 'confidential' },
    });
    assert.equal(asAdmin.status, 201);
    assert.equal(asAdmin.body.classification, 'confidential');
  });

  it('VIEWER gets 403 FORBIDDEN on EVERY mutating endpoint', async () => {
    const writes = [
      ['POST', '/api/projects', { name: 'v', division: 'ops' }],
      ['PATCH', `/api/projects/${SEED.project1}`, { version: 1, name: 'v' }],
      ['POST', '/api/tasks', { projectId: SEED.project1, title: 'v' }],
      ['PATCH', `/api/tasks/${SEED.erpTask}`, { version: 1, description: 'v' }],
      ['POST', '/api/roadblocks', { projectId: SEED.project1, description: 'v' }],
      ['PATCH', `/api/roadblocks/${SEED.roadblock1}`, { version: 1, status: 'IN_PROGRESS' }],
      ['POST', `/api/approvals/${SEED.approval1}/decision`, { decision: 'approved' }],
      ['POST', '/api/sync', { clientId: 'viewer-device', operations: [] }],
      ['POST', '/api/users', { name: 'v', email: 'v@opspm360.local', division: 'ops', baseRole: 'VIEWER' }],
      ['PATCH', `/api/users/${USERS.awa}`, { site: 'hq' }],
      ['POST', `/api/users/${USERS.awa}/reset-password`, {}],
      ['POST', `/api/users/${USERS.awa}/unlock`, {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await srv.api(method, path, { user: USERS.aissatou, body });
      assert.equal(res.status, 403, `VIEWER ${method} ${path}`);
      assert.equal(res.body.error, 'FORBIDDEN', `VIEWER ${method} ${path} envelope`);
    }
    // ...while reads still work for the VIEWER
    for (const path of ['/api/projects', '/api/tasks', '/api/roadblocks', '/api/approvals', '/api/bootstrap', '/api/audit']) {
      const res = await srv.api('GET', path, { user: USERS.aissatou });
      assert.equal(res.status, 200, `VIEWER GET ${path}`);
    }
  });

  it('deactivated users cannot act even with a fresh-looking token (sessions are revoked)', async () => {
    // create a throwaway user, log in, deactivate, assert the session is dead
    const created = await srv.api('POST', '/api/users', {
      user: USERS.troy,
      body: { name: 'Temp One', email: `temp.${randomUUID()}@opspm360.local`, division: 'ops', baseRole: 'CONTRIBUTOR' },
    });
    const token = await srv.loginAs(created.body.user.email, created.body.temporaryPassword);
    await srv.api('PATCH', `/api/users/${created.body.user.id}`, {
      user: USERS.troy, body: { isActive: false },
    });
    const res = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(res.status, 401);
  });
});
