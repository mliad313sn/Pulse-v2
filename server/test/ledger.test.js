/**
 * E05 — Approval ledger (plan §14, invariant 11): every gate decision appends
 * an immutable entry {projectVersion, authorityType, decision, ...}. There is
 * NO mutation route for ledger entries anywhere in the API, and the repository
 * itself is push-only (frozen entries, no update/delete methods) — mirroring
 * the trg_approval_ledger_immutable DB trigger.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS } from './helpers.js';

describe('E05 — approval ledger', () => {
  let srv;
  let project;

  before(async () => {
    srv = await startServer();
    const res = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: {
        name: 'Saly Backup Refresh',
        division: 'infra',
        site: 'saly',
        description: 'Replace ageing backup appliances at Saly',
        sponsorId: USERS.fatou,
      },
    });
    assert.equal(res.status, 201);
    project = res.body;
  });
  after(async () => { await srv.close(); });

  const requestGate = (body = {}, user = USERS.troy) =>
    srv.api('POST', `/api/projects/${project.id}/gates/request`, { user, body });
  const decide = (id, decision, user, note) =>
    srv.api('POST', `/api/gate-requests/${id}/decision`, { user, body: { decision, note } });
  const ledger = (user = USERS.troy) =>
    srv.api('GET', `/api/projects/${project.id}/ledger`, { user });

  it('starts empty; a REJECTED then an APPROVED decision append chronological entries', async () => {
    assert.deepEqual((await ledger()).body, []);

    const req1 = await requestGate({ note: 'try 1' });
    assert.equal(req1.status, 201);
    const rejected = await decide(req1.body.id, 'REJECTED', USERS.moussa, 'sponsor unavailable');
    assert.equal(rejected.status, 200);

    const req2 = await requestGate({ note: 'try 2' });
    assert.equal(req2.status, 201);
    const approved = await decide(req2.body.id, 'APPROVED', USERS.aminata, 'go');
    assert.equal(approved.status, 200);

    const rows = (await ledger()).body;
    assert.equal(rows.length, 2);

    const [first, second] = rows;
    // Chronological order: the rejection came first.
    assert.equal(first.decision, 'REJECTED');
    assert.equal(second.decision, 'APPROVED');
    assert.ok(Date.parse(first.decidedAt) <= Date.parse(second.decidedAt));

    // Full logical record (plan §14).
    assert.equal(first.projectId, project.id);
    assert.equal(first.gate, 'G0');
    assert.equal(first.fromStage, 'IDEA');
    assert.equal(first.toStage, 'INITIATION');
    assert.equal(first.requestedBy, USERS.troy);
    assert.ok(first.requestedAt);
    assert.equal(first.decidedBy, USERS.moussa);
    assert.equal(first.authorityType, 'DIVISION_LEAD');
    assert.equal(first.note, 'sponsor unavailable');
    assert.equal(typeof first.projectVersion, 'number');

    assert.equal(second.decidedBy, USERS.aminata);
    assert.equal(second.authorityType, 'STEERING');
    // projectVersion is the pre-transition version of the project.
    assert.ok(second.projectVersion >= first.projectVersion);
  });

  it('ledger reads are concealment-scoped like the project itself', async () => {
    // Ibrahima can read this internal project -> ledger works.
    const ok = await ledger(USERS.ibrahima);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.length, 2);

    // Unknown project id -> uniform 404.
    const missing = await srv.api('GET', '/api/projects/99999999-0000-0000-0000-000000000000/ledger', {
      user: USERS.troy,
    });
    assert.equal(missing.status, 404);
  });

  it('no mutation route exists for ledger entries or decided requests', async () => {
    const entry = (await ledger()).body[0];
    for (const [method, path] of [
      ['PATCH', `/api/projects/${project.id}/ledger/${entry.id}`],
      ['DELETE', `/api/projects/${project.id}/ledger/${entry.id}`],
      ['PATCH', `/api/ledger/${entry.id}`],
      ['DELETE', `/api/ledger/${entry.id}`],
      ['PATCH', `/api/gate-requests/${entry.id}`],
      ['DELETE', `/api/gate-requests/${entry.id}`],
    ]) {
      const res = await srv.api(method, path, { user: USERS.troy, body: { note: 'tamper' } });
      assert.equal(res.status, 404, `${method} ${path} must not exist`);
      assert.equal(res.body.error, 'NOT_FOUND');
    }
  });

  it('repo-level guard: the ledger is push-only and entries are frozen', async () => {
    const repo = srv.repo;
    // No update/delete surface exists for the ledger at all.
    assert.equal(repo.updateLedger, undefined);
    assert.equal(repo.deleteLedger, undefined);
    // The generic entity CRUD does not know a 'ledger' kind either.
    await assert.rejects(() => repo.update('ledger', { id: 'x' }), /unknown entity kind/);

    // Internal entries are deep-frozen (mutation attempts throw in strict mode).
    const internal = repo._ledger;
    assert.ok(internal.length >= 2);
    assert.ok(Object.isFrozen(internal[0]));
    assert.throws(() => { 'use strict'; internal[0].decision = 'TAMPERED'; });

    // And reads hand out copies, so callers cannot reach internal state.
    const rows = await repo.listLedger({ projectId: project.id });
    rows[0].decision = 'TAMPERED';
    const again = await repo.listLedger({ projectId: project.id });
    assert.notEqual(again[0].decision, 'TAMPERED');
  });

  it('a decided gate request cannot be re-decided (single logical record per request)', async () => {
    const rows = (await ledger()).body;
    const decidedRequests = await srv.api('GET', '/api/gate-requests', { user: USERS.troy });
    const done = decidedRequests.body.find((r) => r.projectId === project.id && r.status === 'APPROVED');
    assert.ok(done);
    const redecide = await decide(done.id, 'REJECTED', USERS.moussa);
    assert.equal(redecide.status, 400);
    assert.match(redecide.body.message, /only PENDING/);
    assert.equal((await ledger()).body.length, rows.length, 'no extra ledger entry appended');
  });
});
