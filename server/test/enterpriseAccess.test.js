/**
 * E01 §8.2 — Enterprise access: with enterpriseAccess=false, EVERY read is
 * additionally filtered to projects on the user's site or projects where the
 * user is member/owner/sponsor. Concealment semantics match classification
 * (uniform 404, absent from lists/counts/bootstrap/audit/deck). Default (ON)
 * behavior is unchanged.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';
import { buildDeckData } from '../src/reporter/deck.js';

describe('E01 — enterprise access scoping', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  // awa: ops CONTRIBUTOR, site=sabodala, owner of project1 (site saly).
  // project2 (Saly Core Network, site saly): not hers, not her site -> concealed when OFF.
  // project3 (site sabodala): her site -> stays visible.

  it('default ON: awa sees all internal projects (unchanged v1 behavior)', async () => {
    const me = await srv.api('GET', '/api/auth/me', { user: USERS.awa });
    assert.equal(me.body.user.enterpriseAccess, true);
    const list = await srv.api('GET', '/api/projects', { user: USERS.awa });
    assert.deepEqual(
      list.body.map((p) => p.id).sort(),
      [SEED.project1, SEED.project2, SEED.project3].sort(),
    );
  });

  it('only ADMIN may toggle enterpriseAccess', async () => {
    const denied = await srv.api('PATCH', `/api/users/${USERS.awa}`, {
      user: USERS.moussa, body: { enterpriseAccess: false },
    });
    assert.equal(denied.status, 403);

    const res = await srv.api('PATCH', `/api/users/${USERS.awa}`, {
      user: USERS.troy, body: { enterpriseAccess: false },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.enterpriseAccess, false);
  });

  it('OFF: cross-site project concealed from list, direct GET (uniform 404), tasks and approvals', async () => {
    const list = await srv.api('GET', '/api/projects', { user: USERS.awa });
    assert.deepEqual(
      list.body.map((p) => p.id).sort(),
      [SEED.project1, SEED.project3].sort(),
      'own project (owner grant) + own-site project remain; cross-site gone',
    );

    const direct = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.awa });
    assert.equal(direct.status, 404);
    assert.deepEqual(direct.body, {
      error: 'NOT_FOUND', message: `project ${SEED.project2} not found`,
    }, 'identical envelope to a truly absent id');

    const tasks = await srv.api('GET', '/api/tasks', { user: USERS.awa });
    assert.ok(!tasks.body.some((t) => t.projectId === SEED.project2));
    const oneTask = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.awa });
    assert.equal(oneTask.status, 404);

    const approvals = await srv.api('GET', '/api/approvals', { user: USERS.awa });
    assert.ok(!approvals.body.some((a) => a.projectId === SEED.project2));

    // writes conceal identically
    const patch = await srv.api('PATCH', `/api/tasks/${SEED.infraTask}`, {
      user: USERS.awa, body: { version: 1, description: 'probe' },
    });
    assert.equal(patch.status, 404);
  });

  it('OFF: absent from bootstrap, audit and the executive deck', async () => {
    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.awa });
    const blob = JSON.stringify(boot.body);
    assert.ok(!blob.includes(SEED.project2), 'project id absent from bootstrap');
    assert.ok(!blob.includes('Saly Core Network'), 'project name absent from bootstrap');
    assert.ok(boot.body.projects.some((p) => p.id === SEED.project1), 'own project still there');
    assert.ok(boot.body.projects.some((p) => p.id === SEED.project3), 'own-site project still there');

    const audit = await srv.api('GET', `/api/audit?entityId=${SEED.project2}`, { user: USERS.awa });
    assert.deepEqual(audit.body, []);

    const awaUser = await srv.repo.getUser(USERS.awa);
    const deck = await buildDeckData(srv.repo, awaUser);
    const deckBlob = JSON.stringify(deck);
    assert.ok(!deckBlob.includes('Saly Core Network'), 'deck excludes cross-site project');
    assert.ok(deckBlob.includes('Saly Site Readiness'), 'own project still in deck');
  });

  it('OFF + membership: adding the user as a member restores visibility', async () => {
    const add = await srv.api('POST', `/api/projects/${SEED.project2}/members`, {
      user: USERS.moussa, body: { userId: USERS.awa, role: 'SME' },
    });
    assert.equal(add.status, 201);

    const direct = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.awa });
    assert.equal(direct.status, 200);
    const list = await srv.api('GET', '/api/projects', { user: USERS.awa });
    assert.ok(list.body.some((p) => p.id === SEED.project2));

    // remove again -> concealed again
    const del = await srv.api('DELETE',
      `/api/projects/${SEED.project2}/members/${USERS.awa}/SME`, { user: USERS.moussa });
    assert.equal(del.status, 204);
    const gone = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.awa });
    assert.equal(gone.status, 404);
  });

  it('turning enterpriseAccess back ON restores the default scope', async () => {
    await srv.api('PATCH', `/api/users/${USERS.awa}`, {
      user: USERS.troy, body: { enterpriseAccess: true },
    });
    const list = await srv.api('GET', '/api/projects', { user: USERS.awa });
    assert.ok(list.body.some((p) => p.id === SEED.project2));
  });
});
