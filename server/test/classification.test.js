/**
 * E03 — Classification concealment (ADR-005): confidential projects are
 * invisible (uniform 404, absent from lists/bootstrap/exports/audit) to
 * everyone but ADMIN/owner; restricted projects are division-scoped.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, USERS } from './helpers.js';
import { buildDeckData } from '../src/reporter/deck.js';

const CONF_NAME = 'Blackbird Vault Migration';
const RESTR_NAME = 'Falcon BI Modernization';

/**
 * Raw-buffer text scan for the (uncompressed) pdf export: pdfkit writes text
 * runs as hex strings, split by kerning adjustments — decode every <hex> run
 * and concatenate, then search alongside the raw latin1 view.
 */
function pdfContainsText(buffer, needle) {
  const raw = buffer.toString('latin1');
  const decodedHex = (raw.match(/<([0-9a-fA-F]+)>/g) ?? [])
    .map((m) => Buffer.from(m.slice(1, -1), 'hex').toString('latin1'))
    .join('');
  return raw.includes(needle) || decodedHex.includes(needle);
}

describe('E03 — classification concealment', () => {
  let srv;
  let conf; // confidential project (division infra, owner moussa)
  let confTask;
  let confRoadblock;
  let restr; // restricted project (division bizapps, owner fatou)
  let restrTask;

  before(async () => {
    srv = await startServer();
    // Seed via the ADMIN API (troy). Owner is set explicitly per case.
    const p1 = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: {
        name: CONF_NAME, division: 'infra', site: 'saly',
        classification: 'confidential', ownerId: USERS.moussa,
        riskTags: ['firewall_change'], // routes an approval under the confidential project
      },
    });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.classification, 'confidential');
    conf = p1.body;

    const t1 = await srv.api('POST', '/api/tasks', {
      user: USERS.troy,
      body: { projectId: conf.id, title: 'Blackbird secure enclave build-out' },
    });
    assert.equal(t1.status, 201);
    confTask = t1.body;

    const r1 = await srv.api('POST', '/api/roadblocks', {
      user: USERS.troy,
      body: { projectId: conf.id, description: 'Blackbird HSM delivery delayed' },
    });
    assert.equal(r1.status, 201);
    confRoadblock = r1.body;

    const p2 = await srv.api('POST', '/api/projects', {
      user: USERS.troy,
      body: { name: RESTR_NAME, division: 'bizapps', classification: 'restricted', ownerId: USERS.fatou },
    });
    assert.equal(p2.status, 201);
    restr = p2.body;

    const t2 = await srv.api('POST', '/api/tasks', {
      user: USERS.troy,
      body: { projectId: restr.id, title: 'Falcon data mart schema' },
    });
    restrTask = t2.body;
    await srv.api('POST', '/api/roadblocks', {
      user: USERS.troy,
      body: { projectId: restr.id, description: 'Falcon budget signoff pending' },
    });
  });
  after(async () => { await srv.close(); });

  // awa (ops CONTRIBUTOR) is unrelated to both projects.
  const OUTSIDER = USERS.awa;

  it('confidential: absent from GET /api/projects for an unrelated CONTRIBUTOR; visible to owner and ADMIN', async () => {
    const outsider = await srv.api('GET', '/api/projects', { user: OUTSIDER });
    assert.ok(!outsider.body.some((p) => p.id === conf.id));
    assert.ok(!JSON.stringify(outsider.body).includes(CONF_NAME));

    const owner = await srv.api('GET', '/api/projects', { user: USERS.moussa });
    assert.ok(owner.body.some((p) => p.id === conf.id), 'owner sees the confidential project');

    const admin = await srv.api('GET', '/api/projects', { user: USERS.troy });
    assert.ok(admin.body.some((p) => p.id === conf.id), 'ADMIN sees the confidential project');
  });

  it('confidential: GET /api/projects/:id -> 404 with the EXACT shape of a truly absent id', async () => {
    const hidden = await srv.api('GET', `/api/projects/${conf.id}`, { user: OUTSIDER });
    const ghostId = randomUUID();
    const ghost = await srv.api('GET', `/api/projects/${ghostId}`, { user: OUTSIDER });
    assert.equal(hidden.status, 404);
    assert.equal(ghost.status, 404);
    assert.deepEqual(hidden.body, { error: 'NOT_FOUND', message: `project ${conf.id} not found` });
    assert.deepEqual(ghost.body, { error: 'NOT_FOUND', message: `project ${ghostId} not found` });
    assert.deepEqual(Object.keys(hidden.body).sort(), Object.keys(ghost.body).sort(), 'identical envelope shape');

    const tasks = await srv.api('GET', `/api/projects/${conf.id}/tasks`, { user: OUTSIDER });
    assert.equal(tasks.status, 404);
  });

  it('confidential: tasks and roadblocks are hidden from lists and 404 on direct GET/PATCH', async () => {
    const tasks = await srv.api('GET', '/api/tasks', { user: OUTSIDER });
    assert.ok(!tasks.body.some((t) => t.id === confTask.id));

    const one = await srv.api('GET', `/api/tasks/${confTask.id}`, { user: OUTSIDER });
    assert.equal(one.status, 404);
    assert.deepEqual(one.body, { error: 'NOT_FOUND', message: `task ${confTask.id} not found` });

    const rbs = await srv.api('GET', '/api/roadblocks', { user: OUTSIDER });
    assert.ok(!rbs.body.some((r) => r.id === confRoadblock.id));

    // writes conceal identically (404, not 403)
    const patch = await srv.api('PATCH', `/api/tasks/${confTask.id}`, {
      user: OUTSIDER, body: { version: 1, description: 'probe' },
    });
    assert.equal(patch.status, 404);
    assert.equal(patch.body.error, 'NOT_FOUND');

    // creating under a hidden project looks exactly like an unknown projectId
    const createHidden = await srv.api('POST', '/api/tasks', {
      user: OUTSIDER, body: { projectId: conf.id, title: 'probe' },
    });
    const createGhost = await srv.api('POST', '/api/tasks', {
      user: OUTSIDER, body: { projectId: randomUUID(), title: 'probe' },
    });
    assert.equal(createHidden.status, 400);
    assert.equal(createGhost.status, 400);
    assert.equal(createHidden.body.error, createGhost.body.error);
  });

  it('confidential: absent from bootstrap, approvals queue and audit-by-entity', async () => {
    const boot = await srv.api('GET', '/api/bootstrap', { user: OUTSIDER });
    const blob = JSON.stringify(boot.body);
    assert.ok(!blob.includes(conf.id), 'project id absent from bootstrap');
    assert.ok(!blob.includes(CONF_NAME), 'project name absent from bootstrap');
    assert.ok(!boot.body.tasks.some((t) => t.id === confTask.id));
    assert.ok(!boot.body.roadblocks.some((r) => r.id === confRoadblock.id));
    assert.ok(!boot.body.approvals.some((a) => a.projectId === conf.id));

    // the firewall_change approval exists for the owner...
    const forOwner = await srv.api('GET', '/api/approvals', { user: USERS.moussa });
    assert.ok(forOwner.body.some((a) => a.projectId === conf.id));
    // ...but not for the outsider
    const forOutsider = await srv.api('GET', '/api/approvals', { user: OUTSIDER });
    assert.ok(!forOutsider.body.some((a) => a.projectId === conf.id));

    const audit = await srv.api('GET', `/api/audit?entityId=${conf.id}`, { user: OUTSIDER });
    assert.equal(audit.status, 200);
    assert.deepEqual(audit.body, [], 'audit-by-entity reveals nothing');
    const fullAudit = await srv.api('GET', '/api/audit', { user: OUTSIDER });
    assert.ok(!JSON.stringify(fullAudit.body).includes(CONF_NAME));
  });

  it('confidential: sync updates against hidden entities reject exactly like missing ids', async () => {
    const res = await srv.api('POST', '/api/sync', {
      user: OUTSIDER,
      body: {
        clientId: 'outsider-device',
        operations: [{
          opId: randomUUID(), entity: 'task', entityId: confTask.id, op: 'update',
          baseVersion: 1, clientUpdatedAt: new Date().toISOString(), fields: { status: 'in_progress' },
        }],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].result, 'rejected');
    assert.equal(res.body.results[0].error, 'NOT_FOUND');
    assert.equal(res.body.results[0].serverState, null, 'no server state leaks');
  });

  it('executive deck: reporter takes the requesting user — confidential excluded for outsiders, included for owner/ADMIN', async () => {
    const [outsiderUser, ownerUser, adminUser] = await Promise.all([
      srv.repo.getUser(OUTSIDER), srv.repo.getUser(USERS.moussa), srv.repo.getUser(USERS.troy),
    ]);

    const outsiderData = await buildDeckData(srv.repo, outsiderUser);
    const outsiderBlob = JSON.stringify(outsiderData);
    assert.ok(!outsiderBlob.includes(CONF_NAME));
    assert.ok(!outsiderBlob.includes(conf.id));
    assert.ok(!outsiderBlob.includes(RESTR_NAME), 'restricted also hidden from other-division deck');

    const ownerData = await buildDeckData(srv.repo, ownerUser);
    assert.ok(JSON.stringify(ownerData).includes(CONF_NAME), 'owner deck includes it');
    const adminData = await buildDeckData(srv.repo, adminUser);
    assert.ok(JSON.stringify(adminData).includes(CONF_NAME), 'ADMIN deck includes it');

    // raw binary scans: pdf content streams are uncompressed -> positive
    // control on the ADMIN export proves the scan can see names at all.
    const adminPdf = await srv.api('GET', '/api/reports/executive-deck?format=pdf', {
      user: USERS.troy, binary: true,
    });
    assert.ok(pdfContainsText(adminPdf.buffer, CONF_NAME), 'positive control: name visible in ADMIN pdf bytes');

    const outsiderPdf = await srv.api('GET', '/api/reports/executive-deck?format=pdf', {
      user: OUTSIDER, binary: true,
    });
    assert.ok(!pdfContainsText(outsiderPdf.buffer, CONF_NAME), 'name absent from outsider pdf bytes');

    const outsiderPptx = await srv.api('GET', '/api/reports/executive-deck?format=pptx', {
      user: OUTSIDER, binary: true,
    });
    assert.ok(!outsiderPptx.buffer.toString('latin1').includes(CONF_NAME), 'name absent from outsider pptx bytes');
  });

  it('restricted: visible to same-division colleague and owner, concealed (404) from other divisions', async () => {
    // ibrahima is bizapps — same division as the restricted project
    const colleague = await srv.api('GET', '/api/projects', { user: USERS.ibrahima });
    assert.ok(colleague.body.some((p) => p.id === restr.id), 'same-division colleague sees it');
    const colleagueTask = await srv.api('GET', `/api/tasks/${restrTask.id}`, { user: USERS.ibrahima });
    assert.equal(colleagueTask.status, 200);

    // fatou owns it from another division
    const owner = await srv.api('GET', `/api/projects/${restr.id}`, { user: USERS.fatou });
    assert.equal(owner.status, 200);

    // awa (ops) gets uniform 404s
    const outsiderList = await srv.api('GET', '/api/projects', { user: OUTSIDER });
    assert.ok(!outsiderList.body.some((p) => p.id === restr.id));
    const outsiderGet = await srv.api('GET', `/api/projects/${restr.id}`, { user: OUTSIDER });
    assert.equal(outsiderGet.status, 404);
    assert.deepEqual(outsiderGet.body, { error: 'NOT_FOUND', message: `project ${restr.id} not found` });
    const boot = await srv.api('GET', '/api/bootstrap', { user: OUTSIDER });
    assert.ok(!JSON.stringify(boot.body).includes(RESTR_NAME));
  });

  it('E04 membership upgrade: ANY project member may read a confidential project; sponsor too', async () => {
    // ibrahima (bizapps CONTRIBUTOR) is unrelated to the confidential infra
    // project — concealed...
    const beforeGet = await srv.api('GET', `/api/projects/${conf.id}`, { user: USERS.ibrahima });
    assert.equal(beforeGet.status, 404);

    // ...until the owner (moussa) adds him as an SME member.
    const add = await srv.api('POST', `/api/projects/${conf.id}/members`, {
      user: USERS.troy, body: { userId: USERS.ibrahima, role: 'SME' },
    });
    assert.equal(add.status, 201);

    const afterGet = await srv.api('GET', `/api/projects/${conf.id}`, { user: USERS.ibrahima });
    assert.equal(afterGet.status, 200);
    assert.equal(afterGet.body.name, CONF_NAME);
    const list = await srv.api('GET', '/api/projects', { user: USERS.ibrahima });
    assert.ok(list.body.some((p) => p.id === conf.id));
    const memberTask = await srv.api('GET', `/api/tasks/${confTask.id}`, { user: USERS.ibrahima });
    assert.equal(memberTask.status, 200);

    // membership does not weaken concealment for the still-unrelated outsider
    const stillHidden = await srv.api('GET', `/api/projects/${conf.id}`, { user: OUTSIDER });
    assert.equal(stillHidden.status, 404);
    const outsiderBoot = await srv.api('GET', '/api/bootstrap', { user: OUTSIDER });
    assert.ok(!JSON.stringify(outsiderBoot.body).includes(CONF_NAME));

    // sponsorId also grants confidential read (fatou is otherwise unrelated to conf)
    const cur = await srv.api('GET', `/api/projects/${conf.id}`, { user: USERS.troy });
    const setSponsor = await srv.api('PATCH', `/api/projects/${conf.id}`, {
      user: USERS.troy, body: { version: cur.body.version, sponsorId: USERS.fatou },
    });
    assert.equal(setSponsor.status, 200);
    const asSponsor = await srv.api('GET', `/api/projects/${conf.id}`, { user: USERS.fatou });
    assert.equal(asSponsor.status, 200);

    // cleanup: drop the membership so later assertions stay meaningful
    const del = await srv.api('DELETE', `/api/projects/${conf.id}/members/${USERS.ibrahima}/SME`, {
      user: USERS.troy,
    });
    assert.equal(del.status, 204);
    const goneAgain = await srv.api('GET', `/api/projects/${conf.id}`, { user: USERS.ibrahima });
    assert.equal(goneAgain.status, 404);
  });

  it('the VIEWER (management division) sees internal projects but not confidential/restricted ones', async () => {
    const res = await srv.api('GET', '/api/projects', { user: USERS.aissatou });
    assert.equal(res.status, 200);
    assert.ok(res.body.some((p) => p.classification === 'internal'));
    assert.ok(!res.body.some((p) => p.id === conf.id));
    assert.ok(!res.body.some((p) => p.id === restr.id));
  });
});
