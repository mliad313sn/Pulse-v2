/**
 * SC2 — Dependency locking: the Infra deployment task stays un-actionable
 * (423 DEPENDENCY_LOCKED) until the Ops site-prep prerequisite is done, then
 * advances; the derived `locked` flag flips accordingly.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, approveSeededGate, USERS, SEED } from './helpers.js';

describe('SC2 — dependency lock on the Infra <-> Ops handshake', () => {
  let srv;
  before(async () => {
    srv = await startServer();
    // Project 2 also carries a seeded pending InfoSec gate; approve it first so
    // this suite isolates DEPENDENCY_LOCKED (SC4 covers the security gate).
    await approveSeededGate(srv.api);
  });
  after(async () => { await srv.close(); });

  it('starts locked: derived flag true while prerequisite is in_progress', async () => {
    const res = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(res.status, 200);
    assert.equal(res.body.locked, true);
    assert.equal(res.body.dependencyLock, SEED.opsTask);
  });

  it('PATCH to in_progress -> 423 DEPENDENCY_LOCKED while prerequisite incomplete', async () => {
    const res = await srv.api('PATCH', `/api/tasks/${SEED.infraTask}`, {
      user: USERS.moussa,
      body: { version: 1, status: 'in_progress' },
    });
    assert.equal(res.status, 423);
    assert.equal(res.body.error, 'DEPENDENCY_LOCKED');
    assert.equal(res.body.detail.prerequisiteTaskId, SEED.opsTask);

    // status untouched
    const check = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(check.body.status, 'todo');
    assert.equal(check.body.version, 1);
  });

  it('completing the Ops prerequisite unlocks the Infra task', async () => {
    const done = await srv.api('PATCH', `/api/tasks/${SEED.opsTask}`, {
      user: USERS.awa,
      body: { version: 1, status: 'done' },
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'done');

    // derived locked flag flips false in GET
    const infra = await srv.api('GET', `/api/tasks/${SEED.infraTask}`, { user: USERS.moussa });
    assert.equal(infra.body.locked, false);

    // and the advance now succeeds
    const advance = await srv.api('PATCH', `/api/tasks/${SEED.infraTask}`, {
      user: USERS.moussa,
      body: { version: 1, status: 'in_progress' },
    });
    assert.equal(advance.status, 200);
    assert.equal(advance.body.status, 'in_progress');
    assert.equal(advance.body.version, 2);
    assert.equal(advance.body.locked, false);
  });
});
