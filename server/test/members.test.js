/**
 * E04 — Project membership: PM uniqueness with atomic swap (both sides
 * audited), VIEWER-as-PM/WORKSTREAM_LEAD rejected (plan invariant 2), the PM
 * gaining project-scoped write authority, and membership-management authz
 * (ADMIN / PM / DIVISION_LEAD of the project's division).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('E04 — project members', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  // project3: bizapps, site sabodala, owner ibrahima. fatou is a data-division
  // lead — NO authority over project3 until she becomes its PM.

  it('membership management requires ADMIN, the PM, or the division lead — others 403', async () => {
    const denied = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.awa, // unrelated ops CONTRIBUTOR
      body: { userId: USERS.awa, role: 'CONTRIBUTOR' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'FORBIDDEN');

    const crossLead = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.fatou, // cross-division DIVISION_LEAD
      body: { userId: USERS.fatou, role: 'PM' },
    });
    assert.equal(crossLead.status, 403);
  });

  it('ADMIN assigns a PM; GET lists it; validation walls hold', async () => {
    const bad = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'CHIEF_VIBES' },
    });
    assert.equal(bad.status, 400);

    const ghost = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: randomUUID(), role: 'PM' },
    });
    assert.equal(ghost.status, 400);

    const created = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'PM' },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { projectId: SEED.project3, userId: USERS.ibrahima, role: 'PM' });

    const list = await srv.api('GET', `/api/projects/${SEED.project3}/members`, { user: USERS.awa });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [{ projectId: SEED.project3, userId: USERS.ibrahima, role: 'PM' }]);

    // duplicate exact membership -> 400
    const dup = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'PM' },
    });
    assert.equal(dup.status, 400);

    // derived pmId surfaces on the project wire shape
    const project = await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy });
    assert.equal(project.body.pmId, USERS.ibrahima);
  });

  it('VIEWER users can NEVER be added as PM or WORKSTREAM_LEAD (400 VALIDATION)', async () => {
    for (const role of ['PM', 'WORKSTREAM_LEAD']) {
      const res = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
        user: USERS.troy, body: { userId: USERS.aissatou, role },
      });
      assert.equal(res.status, 400, `viewer as ${role}`);
      assert.equal(res.body.error, 'VALIDATION');
    }
    // ...but a passive role is fine
    const informed = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.aissatou, role: 'INFORMED' },
    });
    assert.equal(informed.status, 201);
  });

  it('posting a new PM atomically SWAPS the old one out (exactly one PM), auditing both sides', async () => {
    const swap = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: USERS.fatou, role: 'PM' },
    });
    assert.equal(swap.status, 201);

    const list = await srv.api('GET', `/api/projects/${SEED.project3}/members`, { user: USERS.troy });
    const pms = list.body.filter((m) => m.role === 'PM');
    assert.equal(pms.length, 1, 'exactly one PM after the swap');
    assert.equal(pms[0].userId, USERS.fatou);

    const project = await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy });
    assert.equal(project.body.pmId, USERS.fatou);

    // both membership mutations hit the audit ledger
    const audit = await srv.api('GET', '/api/audit?entityType=project_members', { user: USERS.troy });
    const actions = audit.body.map((e) => e.action);
    assert.ok(actions.includes('DELETE'), 'old PM removal audited');
    const inserts = audit.body.filter((e) => e.action === 'INSERT' && e.newData.role === 'PM');
    assert.ok(inserts.some((e) => e.newData.userId === USERS.fatou), 'new PM insert audited');
    const deletes = audit.body.filter((e) => e.action === 'DELETE');
    assert.ok(deletes.some((e) => e.oldData.userId === USERS.ibrahima && e.oldData.role === 'PM'));
  });

  it('the PM gains write authority on the project and its tasks; and may manage members', async () => {
    // fatou (cross-division lead) was denied before becoming PM — now allowed.
    const task = await srv.api('POST', '/api/tasks', {
      user: USERS.fatou,
      body: { projectId: SEED.project3, title: 'PM plans the rollout' },
    });
    assert.equal(task.status, 201);

    const patch = await srv.api('PATCH', `/api/tasks/${task.body.id}`, {
      user: USERS.fatou, body: { version: 1, priority: 'high' },
    });
    assert.equal(patch.status, 200);

    const project = await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.fatou });
    const projPatch = await srv.api('PATCH', `/api/projects/${SEED.project3}`, {
      user: USERS.fatou,
      body: { version: project.body.version, operatingStatus: 'IN_PROGRESS' },
    });
    assert.equal(projPatch.status, 200);
    assert.equal(projPatch.body.operatingStatus, 'IN_PROGRESS');

    // the PM may add members too
    const add = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.fatou, body: { userId: USERS.awa, role: 'CONTRIBUTOR' },
    });
    assert.equal(add.status, 201);
  });

  it('a contributing member may write tasks; INFORMED/AUDITOR members may not', async () => {
    // awa is now a CONTRIBUTOR member (added above)
    const asMember = await srv.api('POST', '/api/tasks', {
      user: USERS.awa,
      body: { projectId: SEED.project3, title: 'Member logs a task' },
    });
    assert.equal(asMember.status, 201);

    // aissatou is an INFORMED member but also VIEWER; use a fresh INFORMED
    // non-viewer to prove the role (not the base role) is what blocks writes.
    const created = await srv.api('POST', '/api/users', {
      user: USERS.troy,
      body: { name: 'Informed Ines', email: 'ines@opspm360.local', division: 'ops', baseRole: 'CONTRIBUTOR' },
    });
    const informed = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
      user: USERS.troy, body: { userId: created.body.user.id, role: 'INFORMED' },
    });
    assert.equal(informed.status, 201);
    const token = await srv.loginAs(created.body.user.email, created.body.temporaryPassword);
    await fetch(`${srv.base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: created.body.temporaryPassword, newPassword: 'Dev!Ines2026x' }),
    });
    const res = await srv.api('POST', '/api/tasks', {
      token,
      body: { projectId: SEED.project3, title: 'Informed tries to write' },
    });
    assert.equal(res.status, 403, 'INFORMED membership grants no write');
  });

  it('non-member contributor stays denied on task writes', async () => {
    // moussa's division (infra) does not own project3 and he is not a member;
    // DIVISION_LEAD authority does not cross divisions.
    const erp = await srv.api('GET', `/api/tasks/${SEED.erpTask}`, { user: USERS.troy });
    const denied = await srv.api('PATCH', `/api/tasks/${SEED.erpTask}`, {
      user: USERS.moussa,
      body: { version: erp.body.version, description: 'cross-division denied' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'FORBIDDEN');
  });

  it('DELETE removes a membership (204); unknown membership -> 404', async () => {
    const del = await srv.api('DELETE',
      `/api/projects/${SEED.project3}/members/${USERS.awa}/CONTRIBUTOR`, { user: USERS.fatou });
    assert.equal(del.status, 204);

    const list = await srv.api('GET', `/api/projects/${SEED.project3}/members`, { user: USERS.troy });
    assert.ok(!list.body.some((m) => m.userId === USERS.awa && m.role === 'CONTRIBUTOR'));

    const again = await srv.api('DELETE',
      `/api/projects/${SEED.project3}/members/${USERS.awa}/CONTRIBUTOR`, { user: USERS.fatou });
    assert.equal(again.status, 404);
  });

  it('DIVISION_LEAD of the project division may manage members without being one', async () => {
    // project2 is infra; moussa is the infra DIVISION_LEAD.
    const res = await srv.api('POST', `/api/projects/${SEED.project2}/members`, {
      user: USERS.moussa, body: { userId: USERS.awa, role: 'SME' },
    });
    assert.equal(res.status, 201);
  });
});
