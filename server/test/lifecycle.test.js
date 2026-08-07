/**
 * E04 — Lifecycle stage guard (data + validation only until the E05 gate
 * engine): a PATCH may move lifecycleStage exactly ONE stage forward or
 * backward; skips -> 400 INVALID_LIFECYCLE_TRANSITION.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('E04 — lifecycle stage transitions', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const getVersion = async (id) =>
    (await srv.api('GET', `/api/projects/${id}`, { user: USERS.troy })).body.version;

  it('skipping a stage -> 400 INVALID_LIFECYCLE_TRANSITION and the project is untouched', async () => {
    const res = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'PLANNING' }, // IDEA -> PLANNING skips INITIATION
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INVALID_LIFECYCLE_TRANSITION');
    assert.deepEqual(res.body.detail, { from: 'IDEA', to: 'PLANNING' });

    const check = await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy });
    assert.equal(check.body.lifecycleStage, 'IDEA');
  });

  it('single steps forward move IDEA -> INITIATION -> PLANNING; one step back returns', async () => {
    const fwd1 = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'INITIATION' },
    });
    assert.equal(fwd1.status, 200);
    assert.equal(fwd1.body.lifecycleStage, 'INITIATION');

    const fwd2 = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'PLANNING' },
    });
    assert.equal(fwd2.status, 200);

    const back = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'INITIATION' },
    });
    assert.equal(back.status, 200);
    assert.equal(back.body.lifecycleStage, 'INITIATION');

    const bigBack = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'RUN' },
    });
    assert.equal(bigBack.status, 400);
    assert.equal(bigBack.body.error, 'INVALID_LIFECYCLE_TRANSITION');
  });

  it('out-of-enum stage -> plain 400 VALIDATION; same-stage echo is a no-op field', async () => {
    const bad = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), lifecycleStage: 'LIMBO' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'VALIDATION');

    const echo = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: {
        version: await getVersion(SEED.project1),
        lifecycleStage: 'INITIATION', // unchanged
        description: 'echoing the current stage is fine',
      },
    });
    assert.equal(echo.status, 200);
  });

  it('the guard also applies to offline sync updates', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.troy,
      body: {
        clientId: 'lifecycle-device',
        operations: [{
          opId: 'op-skip', entity: 'project', entityId: SEED.project1, op: 'update',
          baseVersion: await getVersion(SEED.project1),
          clientUpdatedAt: new Date().toISOString(),
          fields: { lifecycleStage: 'DEPLOYMENT' }, // INITIATION -> DEPLOYMENT skips
        }],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].result, 'rejected');
    assert.equal(res.body.results[0].error, 'INVALID_LIFECYCLE_TRANSITION');
  });

  it('operatingStatus is free-moving (validated enum only)', async () => {
    const ok = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), operatingStatus: 'ON_HOLD' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.operatingStatus, 'ON_HOLD');

    const bad = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: await getVersion(SEED.project1), operatingStatus: 'PAUSED' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'VALIDATION');
  });
});
