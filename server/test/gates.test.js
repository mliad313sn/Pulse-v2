/**
 * E05 — Gate engine (plan §13, invariants 4, 8-10): a fresh project is walked
 * IDEA -> CLOSED through every gate, fixing each missing requirement on the
 * way; 422 GATE_REQUIREMENTS_NOT_MET carries the missing list; G2 proves the
 * steering separation (Troy the ADMIN is denied, Aminata with the steering
 * privilege approves); self-decisions are denied; only one PENDING request per
 * project; REJECTED keeps the stage; direct stage PATCHes stay blocked.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS } from './helpers.js';

describe('E05 — gate engine walk IDEA -> CLOSED', () => {
  let srv;
  let project; // the walked project
  before(async () => {
    srv = await startServer();
    const res = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: 'Sabodala OT Network Segmentation', division: 'infra', site: 'sabodala' },
    });
    assert.equal(res.status, 201);
    project = res.body;
  });
  after(async () => { await srv.close(); });

  const refresh = async () => {
    project = (await srv.api('GET', `/api/projects/${project.id}`, { user: USERS.troy })).body;
    return project;
  };
  const patchProject = async (fields, user = USERS.troy) => {
    const res = await srv.api('PATCH', `/api/projects/${project.id}`, {
      user, body: { version: (await refresh()).version, ...fields },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const gates = async (user = USERS.troy) =>
    (await srv.api('GET', `/api/projects/${project.id}/gates`, { user })).body;
  const requestGate = (body = {}, user = USERS.troy) =>
    srv.api('POST', `/api/projects/${project.id}/gates/request`, { user, body });
  const decide = (id, decision, user, note) =>
    srv.api('POST', `/api/gate-requests/${id}/decision`, { user, body: { decision, note } });
  const missingKeys = (res) => res.body.detail.missing.map((m) => m.key);

  it('G0: 422 lists the missing requirements; fixing them allows the request', async () => {
    const g = await gates();
    assert.equal(g.stage, 'IDEA');
    assert.equal(g.gate, 'G0');
    assert.equal(g.nextStage, 'INITIATION');
    assert.equal(g.steeringRequired, false);
    assert.ok(g.requirements.find((r) => r.key === 'title').satisfied);
    assert.ok(!g.requirements.find((r) => r.key === 'description').satisfied);

    const refused = await requestGate();
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error, 'GATE_REQUIREMENTS_NOT_MET');
    assert.deepEqual(missingKeys(refused).sort(), ['description', 'sponsor']);

    await patchProject({
      description: 'Segment OT from IT at the Sabodala plant network',
      sponsorId: USERS.fatou,
    });
    const ok = await requestGate({ note: 'ready for initiation' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.gate, 'G0');
    assert.equal(ok.body.status, 'PENDING');
    assert.equal(ok.body.fromStage, 'IDEA');
    assert.equal(ok.body.toStage, 'INITIATION');
    assert.equal(ok.body.requestedBy, USERS.troy);
  });

  it('only one PENDING request per project (409), and it shows in GET /gates and the queue', async () => {
    const dup = await requestGate();
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'GATE_REQUEST_PENDING');

    const g = await gates();
    assert.equal(g.pendingRequest.gate, 'G0');

    const queue = await srv.api('GET', '/api/gate-requests?status=PENDING', { user: USERS.troy });
    assert.ok(queue.body.some((r) => r.projectId === project.id));
  });

  it('the requester cannot decide their own request; a DIVISION_LEAD of the division can', async () => {
    const pending = (await gates()).pendingRequest;
    const self = await decide(pending.id, 'APPROVED', USERS.troy);
    assert.equal(self.status, 403);
    assert.equal(self.body.error, 'FORBIDDEN');

    // Awa (CONTRIBUTOR) holds no deciding authority at all.
    const contributor = await decide(pending.id, 'APPROVED', USERS.awa);
    assert.equal(contributor.status, 403);

    const ok = await decide(pending.id, 'APPROVED', USERS.moussa, 'initiation approved');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.gateRequest.status, 'APPROVED');
    assert.equal(ok.body.project.lifecycleStage, 'INITIATION');
    assert.equal(ok.body.ledgerEntry.authorityType, 'DIVISION_LEAD');
    assert.equal((await refresh()).lifecycleStage, 'INITIATION');
  });

  it('G1: PM + target date get demanded, then a steering holder may approve a non-G2 gate', async () => {
    const refused = await requestGate();
    assert.equal(refused.status, 422);
    assert.deepEqual(missingKeys(refused).sort(), ['pm', 'targetDate']);

    const pm = await srv.api('POST', `/api/projects/${project.id}/members`, {
      user: USERS.troy, body: { userId: USERS.moussa, role: 'PM' },
    });
    assert.equal(pm.status, 201);
    await patchProject({ targetDate: '2026-12-15' });

    const ok = await requestGate();
    assert.equal(ok.status, 201);

    // Fatou (DIVISION_LEAD of another division, no steering) may NOT decide.
    const wrongDivision = await decide(ok.body.id, 'APPROVED', USERS.fatou);
    assert.equal(wrongDivision.status, 403);
    assert.equal(wrongDivision.body.error, 'FORBIDDEN');

    const approved = await decide(ok.body.id, 'APPROVED', USERS.aminata);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ledgerEntry.authorityType, 'STEERING');
    assert.equal((await refresh()).lifecycleStage, 'PLANNING');
  });

  it('G2: requirements include milestones/team/baseline/acceptance; steering separation holds', async () => {
    const g = await gates();
    assert.equal(g.gate, 'G2');
    assert.equal(g.steeringRequired, true);

    const refused = await requestGate({}, USERS.moussa); // the PM requests
    assert.equal(refused.status, 422);
    assert.deepEqual(missingKeys(refused).sort(), ['acceptanceCriteria', 'baseline', 'milestones', 'team']);

    const ms = await srv.api('POST', '/api/milestones', {
      user: USERS.moussa,
      body: { projectId: project.id, title: 'OT firewall staged', weight: 2, baselineDue: '2026-10-01' },
    });
    assert.equal(ms.status, 201);
    await srv.api('POST', `/api/projects/${project.id}/members`, {
      user: USERS.troy, body: { userId: USERS.awa, role: 'CONTRIBUTOR' },
    });
    await patchProject({
      startDate: '2026-08-15',
      acceptanceCriteria: 'OT VLANs reachable only through the inspected firewall path',
    });

    const ok = await requestGate({}, USERS.moussa);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    // Invariant 4: an ADMIN WITHOUT the steering privilege is DENIED on G2.
    const adminDenied = await decide(ok.body.id, 'APPROVED', USERS.troy);
    assert.equal(adminDenied.status, 403);
    assert.equal(adminDenied.body.error, 'STEERING_APPROVAL_REQUIRED');
    assert.equal((await refresh()).lifecycleStage, 'PLANNING', 'stage unchanged after denial');

    const approved = await decide(ok.body.id, 'APPROVED', USERS.aminata, 'steering sign-off');
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ledgerEntry.authorityType, 'STEERING');
    assert.equal((await refresh()).lifecycleStage, 'EXECUTION');
  });

  it('G3: deployment plan + no open critical roadblocks; REJECTED keeps the stage', async () => {
    const refused = await requestGate();
    assert.equal(refused.status, 422);
    assert.deepEqual(missingKeys(refused), ['deploymentPlan']);
    await patchProject({ deploymentPlan: 'Cutover plan v3 with rollback to flat VLAN' });

    const rb = await srv.api('POST', '/api/roadblocks', {
      user: USERS.moussa,
      body: { projectId: project.id, description: 'Vendor firmware bug bricks HA pair', severity: 'critical' },
    });
    assert.equal(rb.status, 201);
    const blocked = await requestGate();
    assert.equal(blocked.status, 422);
    assert.deepEqual(missingKeys(blocked), ['criticalRoadblocks']);
    assert.match(blocked.body.detail.missing[0].detail, new RegExp(rb.body.id));

    const resolve = await srv.api('PATCH', `/api/roadblocks/${rb.body.id}`, {
      user: USERS.moussa, body: { version: rb.body.version, status: 'resolved' },
    });
    assert.equal(resolve.status, 200);

    const req1 = await requestGate({ note: 'first attempt' });
    assert.equal(req1.status, 201);
    const rejected = await decide(req1.body.id, 'REJECTED', USERS.aminata, 'wait for the freeze window');
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.gateRequest.status, 'REJECTED');
    assert.equal(rejected.body.ledgerEntry.decision, 'REJECTED');
    assert.equal((await refresh()).lifecycleStage, 'EXECUTION', 'REJECTED leaves the stage unchanged');

    // A new request is allowed after the rejection; ADMIN authority on non-G2.
    const req2 = await requestGate({}, USERS.moussa); // the PM re-requests
    assert.equal(req2.status, 201);
    const approved = await decide(req2.body.id, 'APPROVED', USERS.troy);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ledgerEntry.authorityType, 'ADMIN');
    assert.equal((await refresh()).lifecycleStage, 'DEPLOYMENT');
  });

  it('G4: GO_LIVE milestone DONE + support owner', async () => {
    const refused = await requestGate();
    assert.equal(refused.status, 422);
    assert.deepEqual(missingKeys(refused).sort(), ['goLive', 'supportOwner']);

    const goLive = await srv.api('POST', '/api/milestones', {
      user: USERS.moussa,
      body: { projectId: project.id, title: 'OT segmentation live', type: 'GO_LIVE', weight: 3 },
    });
    assert.equal(goLive.status, 201);
    const stillRefused = await requestGate();
    assert.equal(stillRefused.status, 422, 'GO_LIVE must be DONE, not merely planned');

    await srv.api('PATCH', `/api/milestones/${goLive.body.id}`, {
      user: USERS.moussa,
      body: { version: goLive.body.version, status: 'DONE', actualCompleted: '2026-11-20' },
    });
    await patchProject({ supportOwnerId: USERS.awa });

    const ok = await requestGate();
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const approved = await decide(ok.body.id, 'APPROVED', USERS.moussa);
    assert.equal(approved.status, 200);
    assert.equal((await refresh()).lifecycleStage, 'RUN');
  });

  it('G5: closure fields + open work needs an explicit dispositionNote', async () => {
    await patchProject({
      actualEndDate: '2026-11-30',
      closureSummary: 'Segmentation delivered; OT reachable only via inspected path',
    });
    const openTask = await srv.api('POST', '/api/tasks', {
      user: USERS.moussa,
      body: { projectId: project.id, title: 'Post-cutover punch list' },
    });
    assert.equal(openTask.status, 201);

    const refused = await requestGate();
    assert.equal(refused.status, 422);
    assert.deepEqual(missingKeys(refused), ['openWork']);
    assert.match(refused.body.detail.missing[0].detail, /1 open task/);

    const ok = await requestGate({ dispositionNote: 'Punch list transferred to the RUN backlog' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.dispositionNote, 'Punch list transferred to the RUN backlog');
    const approved = await decide(ok.body.id, 'APPROVED', USERS.aminata);
    assert.equal(approved.status, 200);
    assert.equal((await refresh()).lifecycleStage, 'CLOSED');
  });

  it('CLOSED is the end: no next gate, and further requests are refused', async () => {
    const g = await gates();
    assert.equal(g.stage, 'CLOSED');
    assert.equal(g.gate, null);
    assert.equal(g.nextStage, null);
    assert.deepEqual(g.requirements, []);

    const res = await requestGate();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');
  });

  it('authz edges: VIEWER reads gates but cannot request; non-managers cannot request', async () => {
    const viewerRead = await gates(USERS.aissatou);
    assert.equal(viewerRead.stage, 'CLOSED');

    const viewerReq = await requestGate({}, USERS.aissatou);
    assert.equal(viewerReq.status, 403);

    // Awa is a contributing member but NOT manage-level.
    const memberReq = await requestGate({}, USERS.awa);
    assert.equal(memberReq.status, 403);
  });

  it('direct forward stage PATCH stays blocked for everyone; decision payloads are validated', async () => {
    const patch = await srv.api('PATCH', `/api/projects/${project.id}`, {
      user: USERS.troy,
      body: { version: (await refresh()).version, lifecycleStage: 'IDEA' }, // CLOSED -> IDEA jump
    });
    assert.equal(patch.status, 400);
    assert.match(patch.body.message, /gate process/);

    const badDecision = await srv.api('POST', '/api/gate-requests/does-not-exist/decision', {
      user: USERS.troy, body: { decision: 'MAYBE' },
    });
    assert.equal(badDecision.status, 400);

    const missing = await srv.api('POST', '/api/gate-requests/99999999-0000-0000-0000-000000000000/decision', {
      user: USERS.troy, body: { decision: 'APPROVED' },
    });
    assert.equal(missing.status, 404);
  });
});
