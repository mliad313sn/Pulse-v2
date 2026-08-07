/**
 * E04 — Project codes PRJ-YYYY-NNN: server-generated, sequential per year,
 * concurrency-safe (parallel creates never collide), immutable via PATCH.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('E04 — project code generation', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const year = new Date().getUTCFullYear();

  it('seed projects carry the backfilled codes PRJ-2026-001..003', async () => {
    const res = await srv.api('GET', '/api/projects', { user: USERS.troy });
    const byId = Object.fromEntries(res.body.map((p) => [p.id, p.code]));
    assert.equal(byId[SEED.project1], 'PRJ-2026-001');
    assert.equal(byId[SEED.project2], 'PRJ-2026-002');
    assert.equal(byId[SEED.project3], 'PRJ-2026-003');
  });

  it('a new project gets the next sequential server-generated code (PRJ-YYYY-004)', async () => {
    const res = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: { name: 'Code Check', division: 'infra' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.code, `PRJ-${year}-004`);
    assert.match(res.body.code, /^PRJ-\d{4}-\d{3,}$/);
  });

  it('10 parallel creates against one server yield 10 DISTINCT sequential codes', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      srv.api('POST', '/api/projects', {
        user: USERS.moussa,
        body: { name: `Burst ${i}`, division: 'infra' },
      })));
    for (const r of results) assert.equal(r.status, 201);
    const codes = results.map((r) => r.body.code);
    assert.equal(new Set(codes).size, 10, `codes must be unique: ${codes}`);
    const seqs = codes.map((c) => Number(c.split('-')[2])).sort((a, b) => a - b);
    // Contiguous run right after the sequential create above (004): 005..014.
    assert.deepEqual(seqs, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (const c of codes) assert.match(c, new RegExp(`^PRJ-${year}-\\d{3,}$`));
  });

  it('client-supplied code on create -> 400 VALIDATION', async () => {
    const res = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Forged code', division: 'ops', code: 'PRJ-1999-999' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');
  });

  it('PATCH attempts on code -> 400 VALIDATION; echoing the identical code is tolerated', async () => {
    const current = await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy });
    const res = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: current.body.version, code: 'PRJ-2026-999' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');

    // unchanged on the server
    const check = await srv.api('GET', `/api/projects/${SEED.project1}`, { user: USERS.troy });
    assert.equal(check.body.code, 'PRJ-2026-001');

    // full-object echo with the SAME code is not an attempt to change it
    const echo = await srv.api('PATCH', `/api/projects/${SEED.project1}`, {
      user: USERS.troy,
      body: { version: check.body.version, code: check.body.code, description: 'echo patch ok' },
    });
    assert.equal(echo.status, 200);
    assert.equal(echo.body.code, 'PRJ-2026-001');
    assert.equal(echo.body.description, 'echo patch ok');
  });

  it('sync updates cannot change the code either (rejected VALIDATION)', async () => {
    const current = await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.moussa });
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.moussa,
      body: {
        clientId: 'code-forger',
        operations: [{
          opId: 'op-1', entity: 'project', entityId: SEED.project2, op: 'update',
          baseVersion: current.body.version, clientUpdatedAt: new Date().toISOString(),
          fields: { code: 'PRJ-2020-001' },
        }],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].result, 'rejected');
    assert.equal(res.body.results[0].error, 'VALIDATION');
  });
});
