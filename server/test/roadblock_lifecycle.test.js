/**
 * E11 — Roadblock lifecycle (plan §27, ADR-007):
 *   RAISED -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> VERIFIED, forward-only
 *   (skips allowed), with the ONE backward move being the explicit REOPEN
 *   (status RAISED + reopenReason >=10 chars from RESOLVED/VERIFIED).
 * Covers: every legal/illegal transition, the implicit ownerId->ASSIGNED move,
 * RESOLVED's resolutionNote requirement, VERIFIED authz (manage-level or
 * reporter only), escalation rules + ESCALATED audit + idempotency +
 * server-managed escalated fields, sync halting on an illegal transition, and
 * the RAG rule that an escalated open roadblock of any severity is >= AMBER.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS, SEED } from './helpers.js';

describe('E11 — roadblock lifecycle', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const patch = (id, user, body) => srv.api('PATCH', `/api/roadblocks/${id}`, { user, body });
  const get = async (id) => {
    const list = await srv.api('GET', '/api/roadblocks', { user: USERS.troy });
    return list.body.find((r) => r.id === id);
  };

  /** Creates a fresh roadblock on project1 reported by `user`. */
  async function raise(user = USERS.ibrahima, over = {}) {
    const res = await srv.api('POST', '/api/roadblocks', {
      user,
      body: { projectId: SEED.project1, description: 'lifecycle fixture', severity: 'low', ...over },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  }

  it('new roadblocks default to RAISED with the E11 fields nulled and escalated=false', async () => {
    const rb = await raise();
    assert.equal(rb.status, 'RAISED');
    assert.equal(rb.ownerId, null);
    assert.equal(rb.dueDate, null);
    assert.equal(rb.impact, null);
    assert.equal(rb.resolutionApproach, null);
    assert.equal(rb.resolutionNote, null);
    assert.equal(rb.escalated, false);
    assert.equal(rb.escalatedAt, null);
    assert.equal(rb.reopenReason, null);
  });

  it('walks the full ladder: implicit ASSIGNED on assignment, IN_PROGRESS, RESOLVED (note required), VERIFIED', async () => {
    const rb = await raise(USERS.ibrahima); // ibrahima = reporter (not manage on project1)

    // Assignment while RAISED implicitly moves to ASSIGNED (no explicit status).
    const assigned = await patch(rb.id, USERS.ibrahima, { version: rb.version, ownerId: USERS.awa });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.status, 'ASSIGNED');
    assert.equal(assigned.body.ownerId, USERS.awa);

    const inProgress = await patch(rb.id, USERS.awa, {
      version: assigned.body.version, status: 'IN_PROGRESS', resolutionApproach: 'Broker engaged to fast-track customs',
    });
    assert.equal(inProgress.status, 200);
    assert.equal(inProgress.body.status, 'IN_PROGRESS');

    // Backward move -> 400 VALIDATION (only REOPEN may go back, and only to RAISED).
    const backward = await patch(rb.id, USERS.awa, { version: inProgress.body.version, status: 'ASSIGNED' });
    assert.equal(backward.status, 400);
    assert.equal(backward.body.error, 'VALIDATION');
    assert.match(backward.body.message, /forward/);

    // RESOLVED without a resolutionNote -> 400 naming the field.
    const noNote = await patch(rb.id, USERS.awa, { version: inProgress.body.version, status: 'RESOLVED' });
    assert.equal(noNote.status, 400);
    assert.equal(noNote.body.error, 'VALIDATION');
    assert.equal(noNote.body.detail.field, 'resolutionNote');

    const resolved = await patch(rb.id, USERS.awa, {
      version: inProgress.body.version, status: 'RESOLVED', resolutionNote: 'Unit cleared customs and installed',
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, 'RESOLVED');

    // RESOLVED -> IN_PROGRESS is backward -> 400 (the reopen path is RAISED-only).
    const badBack = await patch(rb.id, USERS.awa, { version: resolved.body.version, status: 'IN_PROGRESS' });
    assert.equal(badBack.status, 400);
    assert.equal(badBack.body.error, 'VALIDATION');

    // VERIFIED by the project owner (awa): NOT manage-level, NOT the reporter -> 403.
    const ownerVerify = await patch(rb.id, USERS.awa, { version: resolved.body.version, status: 'VERIFIED' });
    assert.equal(ownerVerify.status, 403);
    assert.equal(ownerVerify.body.error, 'FORBIDDEN');

    // VERIFIED by the reporter -> 200 (independent verification grant).
    const verified = await patch(rb.id, USERS.ibrahima, { version: resolved.body.version, status: 'VERIFIED' });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, 'VERIFIED');
  });

  it('forward skips are legal: RAISED -> RESOLVED in one move (note still required); manage-level may VERIFY', async () => {
    const rb = await raise(USERS.awa);
    const resolved = await patch(rb.id, USERS.awa, {
      version: rb.version, status: 'RESOLVED', resolutionNote: 'Fixed on the spot by the site electrician',
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, 'RESOLVED');

    const verified = await patch(rb.id, USERS.troy, { version: resolved.body.version, status: 'VERIFIED' });
    assert.equal(verified.status, 200, 'ADMIN (manage-level) verifies');
  });

  it('REOPEN: only from RESOLVED/VERIFIED, only with a >=10 char reopenReason', async () => {
    const rb = await raise(USERS.awa);
    const resolved = await patch(rb.id, USERS.awa, {
      version: rb.version, status: 'RESOLVED', resolutionNote: 'Thought the replacement part fixed it',
    });
    assert.equal(resolved.status, 200);

    const noReason = await patch(rb.id, USERS.awa, { version: resolved.body.version, status: 'RAISED' });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.detail.field, 'reopenReason');

    const shortReason = await patch(rb.id, USERS.awa, {
      version: resolved.body.version, status: 'RAISED', reopenReason: 'too short',
    });
    assert.equal(shortReason.status, 400);
    assert.equal(shortReason.body.detail.field, 'reopenReason');

    const reopened = await patch(rb.id, USERS.awa, {
      version: resolved.body.version, status: 'RAISED', reopenReason: 'Failure recurred after 48 hours of load',
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.status, 'RAISED');
    assert.equal(reopened.body.reopenReason, 'Failure recurred after 48 hours of load');
  });

  describe('escalation (POST /api/roadblocks/:id/escalate)', () => {
    it('a writer escalates: escalated/escalatedAt set, version bumped, ESCALATED audited; idempotent replay', async () => {
      const rb = await raise(USERS.ibrahima, { projectId: SEED.project3, severity: 'low' });
      const res = await srv.api('POST', `/api/roadblocks/${rb.id}/escalate`, { user: USERS.ibrahima });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.escalated, true);
      assert.ok(res.body.escalatedAt);
      assert.equal(res.body.version, rb.version + 1);

      // TODO(E19) is the notification; TODAY the audit event is the record.
      const audit = await srv.api('GET', `/api/audit?entityId=${rb.id}`, { user: USERS.troy });
      const escalations = audit.body.filter((e) => e.action === 'ESCALATED');
      assert.equal(escalations.length, 1);
      assert.equal(escalations[0].actorId, USERS.ibrahima);
      assert.equal(escalations[0].newData.severity, 'low');

      // Idempotent: same state back, no version bump, no second audit row.
      const again = await srv.api('POST', `/api/roadblocks/${rb.id}/escalate`, { user: USERS.ibrahima });
      assert.equal(again.status, 200);
      assert.equal(again.body.version, res.body.version);
      const audit2 = await srv.api('GET', `/api/audit?entityId=${rb.id}`, { user: USERS.troy });
      assert.equal(audit2.body.filter((e) => e.action === 'ESCALATED').length, 1);

      // RAG (plan §27): an escalated OPEN roadblock of ANY severity -> at
      // least AMBER, and the explanation says so.
      const p3 = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      const sig = p3.rag.signals.find((s) => s.key === 'roadblocks');
      assert.equal(sig.color, 'AMBER');
      assert.match(sig.explanation, /escalated roadblock/);

      // Deck data: the per-project escalated count surfaces for executives.
      const { buildDeckData } = await import('../src/reporter/deck.js');
      const troy = await srv.repo.getUser(USERS.troy);
      const deck = await buildDeckData(srv.repo, troy);
      const erp = deck.divisions.find((d) => d.code === 'bizapps').projects.find((p) => p.id === SEED.project3);
      assert.equal(erp.escalatedRoadblockCount, 1);
      assert.equal(erp.openRoadblockCount, 1);

      // Resolving clears it from the RAG signal (escalated but no longer open).
      const resolved = await patch(rb.id, USERS.ibrahima, {
        version: res.body.version, status: 'RESOLVED', resolutionNote: 'Escalation shook the vendor loose',
      });
      assert.equal(resolved.status, 200);
      const p3After = (await srv.api('GET', `/api/projects/${SEED.project3}`, { user: USERS.troy })).body;
      assert.equal(p3After.rag.signals.find((s) => s.key === 'roadblocks').color, 'GREEN');
    });

    it('escalating a RESOLVED/VERIFIED roadblock -> 400 unless reopened first (plan §27)', async () => {
      const rb = await raise(USERS.awa);
      const resolved = await patch(rb.id, USERS.awa, {
        version: rb.version, status: 'RESOLVED', resolutionNote: 'Resolved before anyone escalated',
      });
      assert.equal(resolved.status, 200);

      const refused = await srv.api('POST', `/api/roadblocks/${rb.id}/escalate`, { user: USERS.awa });
      assert.equal(refused.status, 400);
      assert.equal(refused.body.error, 'VALIDATION');
      assert.match(refused.body.message, /reopen/i);

      // Reopen, then escalation is legal again.
      const reopened = await patch(rb.id, USERS.awa, {
        version: resolved.body.version, status: 'RAISED', reopenReason: 'Not actually fixed: leak returned overnight',
      });
      assert.equal(reopened.status, 200);
      const ok = await srv.api('POST', `/api/roadblocks/${rb.id}/escalate`, { user: USERS.awa });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.escalated, true);
    });

    it('VIEWER cannot escalate (403); uninvolved writers cannot escalate someone else\'s roadblock', async () => {
      const viewer = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/escalate`, { user: USERS.aissatou });
      assert.equal(viewer.status, 403);

      // fatou (data DIVISION_LEAD) is uninvolved in project1 and not the
      // reporter -> roadblock write policy denies.
      const uninvolved = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/escalate`, { user: USERS.fatou });
      assert.equal(uninvolved.status, 403);
      assert.equal(uninvolved.body.error, 'FORBIDDEN');
    });

    it('escalated/escalatedAt are server-managed: PATCH attempts are silently ignored', async () => {
      const rb = await raise(USERS.awa);
      const res = await patch(rb.id, USERS.awa, {
        version: rb.version, escalated: true, escalatedAt: '2026-01-01T00:00:00Z', impact: 'Cabling crew idle',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.impact, 'Cabling crew idle', 'writable field applied');
      assert.equal(res.body.escalated, false, 'escalated not writable');
      assert.equal(res.body.escalatedAt, null);
    });
  });

  it('offline sync respects the same transition rules: an illegal move blocks and HALTS the batch', async () => {
    const rb = await raise(USERS.ibrahima, { projectId: SEED.project3 });
    const resolved = await patch(rb.id, USERS.ibrahima, {
      version: rb.version, status: 'RESOLVED', resolutionNote: 'Resolved online before the sync lands',
    });
    assert.equal(resolved.status, 200);

    const opIllegal = randomUUID();
    const opHeld = randomUUID();
    const res = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'lifecycle-device',
        operations: [
          {
            opId: opIllegal, seq: 1, entity: 'roadblock', entityId: rb.id, op: 'update',
            baseVersion: resolved.body.version,
            fields: { status: 'IN_PROGRESS' }, // backward from RESOLVED: illegal offline too
          },
          {
            opId: opHeld, seq: 2, entity: 'roadblock', entityId: rb.id, op: 'update',
            baseVersion: resolved.body.version, fields: { impact: 'never applied' },
          },
        ],
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.result), ['blocked', 'held']);
    assert.equal(res.body.results[0].error, 'VALIDATION');
    assert.match(res.body.results[0].message, /forward/);
    assert.equal(res.body.haltedAt, opIllegal);

    const after = await get(rb.id);
    assert.equal(after.status, 'RESOLVED', 'illegal sync op did not apply');
    assert.equal(after.impact, null, 'held op untouched');

    // The legal fix replays fine: reopen with a reason through sync.
    const fix = await srv.api('POST', '/api/sync', {
      user: USERS.ibrahima,
      body: {
        clientId: 'lifecycle-device',
        operations: [{
          opId: opIllegal, seq: 1, entity: 'roadblock', entityId: rb.id, op: 'update',
          baseVersion: resolved.body.version,
          fields: { status: 'RAISED', reopenReason: 'Generator failed again during night shift' },
        }],
      },
    });
    assert.equal(fix.body.results[0].result, 'applied');
    assert.equal((await get(rb.id)).status, 'RAISED');
  });

  it('gate engine treats only RESOLVED/VERIFIED as closed (G3 critical check tracks the new enum)', async () => {
    // An ASSIGNED critical roadblock still blocks G3-style "open critical" logic.
    const rb = await raise(USERS.moussa, {
      projectId: SEED.project2, severity: 'critical', description: 'Critical: core switch DOA',
    });
    const assigned = await patch(rb.id, USERS.moussa, { version: rb.version, ownerId: USERS.moussa });
    assert.equal(assigned.body.status, 'ASSIGNED');
    const p2 = (await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.troy })).body;
    assert.equal(p2.rag.signals.find((s) => s.key === 'roadblocks').color, 'RED');

    const verifiedPath = await patch(rb.id, USERS.moussa, {
      version: assigned.body.version, status: 'RESOLVED', resolutionNote: 'Replacement switch installed',
    });
    assert.equal(verifiedPath.status, 200);
    const p2After = (await srv.api('GET', `/api/projects/${SEED.project2}`, { user: USERS.troy })).body;
    assert.equal(p2After.rag.signals.find((s) => s.key === 'roadblocks').color, 'GREEN');
  });
});
