/**
 * §29 — CAPA: the full forward-only NO-SKIP transition matrix, closure
 * requirements (VERIFICATION needs corrective+preventive, CLOSED needs
 * verifier+effectivenessResult with server-stamped verifiedAt),
 * convert-from-roadblock (POST /api/roadblocks/:id/capa) with prefilled
 * source linkage, write policy (owner/verifier/manage), and general-vs-
 * project visibility.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('§29 — CAPA', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const post = (user, body) => srv.api('POST', '/api/capas', { user, body });
  const patch = (id, user, body) => srv.api('PATCH', `/api/capas/${id}`, { user, body });

  it('create: defaults (MANUAL, OPEN, nulls) for a self-owned general CAPA', async () => {
    const res = await post(USERS.ibrahima, { issue: 'Recurring staging outages', ownerId: USERS.ibrahima });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.projectId, null);
    assert.equal(res.body.sourceType, 'MANUAL');
    assert.equal(res.body.sourceId, null);
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.rootCause, null);
    assert.equal(res.body.verifierId, null);
    assert.equal(res.body.verifiedAt, null);
    assert.equal(res.body.effectivenessResult, null);
    assert.equal(res.body.version, 1);
  });

  it('create authz: general for someone else needs ADMIN; project-linked needs manage or self-owned; VIEWER 403', async () => {
    const denied = await post(USERS.awa, { issue: 'x', ownerId: USERS.ibrahima });
    assert.equal(denied.status, 403);

    const adminAssign = await post(USERS.troy, { issue: 'org-wide patch discipline', ownerId: USERS.moussa });
    assert.equal(adminAssign.status, 201);

    // awa can READ project3 but is not manage-level there: self-owned is the
    // only create she gets; assigning another owner is refused.
    const selfOwned = await post(USERS.awa, { issue: 'my own gap', ownerId: USERS.awa, projectId: SEED.project3 });
    assert.equal(selfOwned.status, 201);
    const otherOwned = await post(USERS.awa, { issue: 'x', ownerId: USERS.ibrahima, projectId: SEED.project3 });
    assert.equal(otherOwned.status, 403);

    const viewer = await post(USERS.aissatou, { issue: 'x', ownerId: USERS.aissatou });
    assert.equal(viewer.status, 403);

    const missing = await post(USERS.troy, { ownerId: USERS.troy });
    assert.equal(missing.status, 400, 'issue is required');
    const badSource = await post(USERS.troy, { issue: 'x', ownerId: USERS.troy, sourceType: 'GUESS' });
    assert.equal(badSource.status, 400);
  });

  describe('transition matrix (forward-only, NO skips)', () => {
    it('walks OPEN -> ANALYSIS -> ACTION_PLANNED -> IMPLEMENTATION -> VERIFICATION -> CLOSED with the closure requirements', async () => {
      const capa = (await post(USERS.troy, {
        issue: 'Cooling failures recur every quarter', ownerId: USERS.troy, projectId: SEED.project1,
      })).body;

      const analysis = await patch(capa.id, USERS.troy, { version: 1, status: 'ANALYSIS', rootCause: 'No preventive maintenance schedule' });
      assert.equal(analysis.status, 200);

      const planned = await patch(capa.id, USERS.troy, { version: 2, status: 'ACTION_PLANNED', immediateCorrection: 'Portable cooling deployed' });
      assert.equal(planned.status, 200);

      const implementing = await patch(capa.id, USERS.troy, { version: 3, status: 'IMPLEMENTATION' });
      assert.equal(implementing.status, 200);

      // VERIFICATION without corrective+preventive actions -> 400.
      const noActions = await patch(capa.id, USERS.troy, { version: 4, status: 'VERIFICATION' });
      assert.equal(noActions.status, 400);
      assert.equal(noActions.body.error, 'VALIDATION');
      assert.match(noActions.body.message, /correctiveAction and preventiveAction/);

      const verification = await patch(capa.id, USERS.troy, {
        version: 4, status: 'VERIFICATION',
        correctiveAction: 'Quarterly PM contract signed',
        preventiveAction: 'Sensor alerts wired to the ops dashboard',
      });
      assert.equal(verification.status, 200);

      // CLOSED without verifier + effectivenessResult -> 400.
      const noClosure = await patch(capa.id, USERS.troy, { version: 5, status: 'CLOSED' });
      assert.equal(noClosure.status, 400);
      assert.match(noClosure.body.message, /verifierId and an effectivenessResult/);

      const closed = await patch(capa.id, USERS.troy, {
        version: 5, status: 'CLOSED', verifierId: USERS.hamady,
        effectivenessResult: 'No repeat failure across two full quarters',
      });
      assert.equal(closed.status, 200);
      assert.equal(closed.body.status, 'CLOSED');
      assert.ok(closed.body.verifiedAt, 'verifiedAt is stamped server-side on close');

      // verifiedAt is server-managed: a client value on earlier writes is ignored.
      assert.equal(analysis.body.verifiedAt, null);
    });

    it('every skip and every backward move is refused (full illegal matrix)', async () => {
      const STATUSES = ['OPEN', 'ANALYSIS', 'ACTION_PLANNED', 'IMPLEMENTATION', 'VERIFICATION', 'CLOSED'];
      const capa = (await post(USERS.troy, { issue: 'matrix fixture', ownerId: USERS.troy })).body;
      // From OPEN, everything except ANALYSIS (the +1 step) must 400.
      for (const to of STATUSES) {
        if (to === 'OPEN' || to === 'ANALYSIS') continue;
        const res = await patch(capa.id, USERS.troy, { version: 1, status: to });
        assert.equal(res.status, 400, `OPEN -> ${to} must be refused`);
        assert.equal(res.body.error, 'VALIDATION');
        assert.match(res.body.message, /exactly one stage forward/);
      }
      // Move to ANALYSIS, then every backward move (and the repeat skips) 400.
      const analysis = await patch(capa.id, USERS.troy, { version: 1, status: 'ANALYSIS' });
      assert.equal(analysis.status, 200);
      const backward = await patch(capa.id, USERS.troy, { version: 2, status: 'OPEN' });
      assert.equal(backward.status, 400, 'no reopen path exists for CAPAs');
      const skip = await patch(capa.id, USERS.troy, { version: 2, status: 'IMPLEMENTATION' });
      assert.equal(skip.status, 400);

      // The verified state (server state) is untouched by all refused moves.
      const list = await srv.api('GET', '/api/capas', { user: USERS.troy });
      assert.equal(list.body.find((c) => c.id === capa.id).status, 'ANALYSIS');
    });
  });

  describe('convert-from-roadblock (POST /api/roadblocks/:id/capa)', () => {
    it('manage-level converts: sourceType/sourceId/projectId prefilled, issue defaults to the description', async () => {
      const res = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/capa`, {
        user: USERS.troy, body: { rootCause: 'Customs paperwork filed late' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.sourceType, 'ROADBLOCK');
      assert.equal(res.body.sourceId, SEED.roadblock1);
      assert.equal(res.body.projectId, SEED.project1);
      assert.equal(res.body.issue, 'Cooling unit delivery delayed at customs');
      assert.equal(res.body.ownerId, USERS.troy, 'owner defaults to the caller');
      assert.equal(res.body.rootCause, 'Customs paperwork filed late');
      assert.equal(res.body.status, 'OPEN');
    });

    it('the source linkage is authoritative: client attempts to spoof sourceType/sourceId/projectId are overridden', async () => {
      const res = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/capa`, {
        user: USERS.troy,
        body: { issue: 'custom issue text', sourceType: 'AUDIT', sourceId: SEED.project2, projectId: SEED.project2 },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.issue, 'custom issue text', 'issue IS overridable');
      assert.equal(res.body.sourceType, 'ROADBLOCK');
      assert.equal(res.body.sourceId, SEED.roadblock1);
      assert.equal(res.body.projectId, SEED.project1);
    });

    it('allowed for the roadblock OWNER; denied for uninvolved users and VIEWER; concealed -> 404', async () => {
      // Assign the seed roadblock to ibrahima; he is NOT manage on project1.
      const rb = (await srv.api('GET', '/api/roadblocks', { user: USERS.troy }))
        .body.find((r) => r.id === SEED.roadblock1);
      const assign = await srv.api('PATCH', `/api/roadblocks/${SEED.roadblock1}`, {
        user: USERS.troy, body: { version: rb.version, ownerId: USERS.ibrahima },
      });
      assert.equal(assign.status, 200);

      const asOwner = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/capa`, {
        user: USERS.ibrahima, body: {},
      });
      assert.equal(asOwner.status, 201);
      assert.equal(asOwner.body.ownerId, USERS.ibrahima);

      // awa is the REPORTER but not the owner and not manage-level -> 403.
      const reporter = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/capa`, {
        user: USERS.awa, body: {},
      });
      assert.equal(reporter.status, 403);

      const viewer = await srv.api('POST', `/api/roadblocks/${SEED.roadblock1}/capa`, {
        user: USERS.aissatou, body: {},
      });
      assert.equal(viewer.status, 403);

      // Roadblock of a concealed project: uniform 404.
      const proj = await srv.api('POST', '/api/projects', {
        user: USERS.troy,
        body: { name: 'Covert CAPA Source', division: 'management', classification: 'confidential' },
      });
      const confRb = await srv.api('POST', '/api/roadblocks', {
        user: USERS.troy, body: { projectId: proj.body.id, description: 'hidden blocker' },
      });
      const concealed = await srv.api('POST', `/api/roadblocks/${confRb.body.id}/capa`, {
        user: USERS.awa, body: {},
      });
      assert.equal(concealed.status, 404);
      assert.equal(concealed.body.error, 'NOT_FOUND');
    });
  });

  it('write policy: owner and verifier may update; uninvolved reader 403 (project) / concealed 404 (general)', async () => {
    const capa = (await post(USERS.troy, {
      issue: 'writer matrix fixture', ownerId: USERS.ibrahima, verifierId: USERS.hamady, projectId: SEED.project3,
    })).body;

    const byOwner = await patch(capa.id, USERS.ibrahima, { version: 1, rootCause: 'set by owner' });
    assert.equal(byOwner.status, 200);
    const byVerifier = await patch(capa.id, USERS.hamady, { version: 2, immediateCorrection: 'set by verifier' });
    assert.equal(byVerifier.status, 200);
    // awa reads project3 but holds no CAPA role -> 403 (existence known).
    const denied = await patch(capa.id, USERS.awa, { version: 3, rootCause: 'nope' });
    assert.equal(denied.status, 403);

    // General CAPA of another user: concealed 404 for outsiders, visible to
    // owner/verifier/ADMIN in the list.
    const general = (await post(USERS.troy, { issue: 'troy private capa', ownerId: USERS.troy })).body;
    const hidden = await patch(general.id, USERS.awa, { version: 1, rootCause: 'x' });
    assert.equal(hidden.status, 404);
    const asAwa = await srv.api('GET', '/api/capas', { user: USERS.awa });
    assert.ok(!asAwa.body.some((c) => c.id === general.id));
    const asTroy = await srv.api('GET', '/api/capas', { user: USERS.troy });
    assert.ok(asTroy.body.some((c) => c.id === general.id));
  });

  it('GET /api/capas?projectId= filters; bootstrap carries capas; mutations are audited', async () => {
    const scoped = await srv.api('GET', `/api/capas?projectId=${SEED.project1}`, { user: USERS.troy });
    assert.ok(scoped.body.length >= 2);
    assert.ok(scoped.body.every((c) => c.projectId === SEED.project1));

    const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.troy });
    assert.ok(Array.isArray(boot.body.capas));
    assert.ok(boot.body.capas.some((c) => c.projectId === SEED.project1));

    const capa = scoped.body[0];
    const audit = await srv.api('GET', `/api/audit?entityId=${capa.id}`, { user: USERS.troy });
    assert.ok(audit.body.length >= 1);
    assert.equal(audit.body[0].entityType, 'capas');
    assert.equal(audit.body[0].action, 'INSERT');
  });
});
