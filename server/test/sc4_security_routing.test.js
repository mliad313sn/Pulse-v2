/**
 * SC4 — Security & governance: a project tagged network_alteration auto-creates
 * a pending InfoSec approval and flips its gate to pending; the gate suspends
 * task progression (423 SECURITY_GATE); only a security_reviewer may decide;
 * approval clears the gate and progression resumes.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS } from './helpers.js';

describe('SC4 — InfoSec routing and approval gate', () => {
  let srv;
  let project;
  let task;
  let approval;

  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('creating a project with network_alteration auto-creates a pending approval and gate=pending', async () => {
    const res = await srv.api('POST', '/api/projects', {
      user: USERS.moussa, // division_lead
      body: {
        name: 'Sabodala Firewall Segmentation',
        division: 'infra',
        site: 'sabodala',
        riskTags: ['network_alteration'],
      },
    });
    assert.equal(res.status, 201);
    project = res.body;
    assert.equal(project.securityGateStatus, 'pending');

    const queue = await srv.api('GET', '/api/approvals?status=pending', { user: USERS.hamady });
    approval = queue.body.find(
      (a) => a.projectId === project.id && a.riskTag === 'network_alteration',
    );
    assert.ok(approval, 'pending approval routed to the InfoSec queue');
    assert.equal(approval.taskId, null);
    assert.equal(approval.status, 'pending');
  });

  it('tasks under the gated project cannot advance -> 423 SECURITY_GATE (and derived locked=true)', async () => {
    const created = await srv.api('POST', '/api/tasks', {
      user: USERS.moussa,
      body: { projectId: project.id, title: 'Reconfigure edge firewall rules' },
    });
    assert.equal(created.status, 201);
    task = created.body;
    assert.equal(task.locked, true); // derived from the pending gate

    const advance = await srv.api('PATCH', `/api/tasks/${task.id}`, {
      user: USERS.moussa,
      body: { version: 1, status: 'in_progress' },
    });
    assert.equal(advance.status, 423);
    assert.equal(advance.body.error, 'SECURITY_GATE');
  });

  it('a non-InfoSec user attempting the decision -> 403 FORBIDDEN', async () => {
    const res = await srv.api('POST', `/api/approvals/${approval.id}/decision`, {
      user: USERS.awa, // ops CONTRIBUTOR without the security_reviewer privilege
      body: { decision: 'approved' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');

    // gate untouched
    const check = await srv.api('GET', `/api/projects/${project.id}`, { user: USERS.awa });
    assert.equal(check.body.securityGateStatus, 'pending');
  });

  it('Hamady (security_reviewer) approves -> gate approved -> task advances', async () => {
    const res = await srv.api('POST', `/api/approvals/${approval.id}/decision`, {
      user: USERS.hamady,
      body: { decision: 'approved', notes: 'Segmentation plan reviewed. OK.' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.approval.status, 'approved');
    assert.equal(res.body.approval.reviewedBy, USERS.hamady);
    assert.equal(res.body.project.securityGateStatus, 'approved');

    const advance = await srv.api('PATCH', `/api/tasks/${task.id}`, {
      user: USERS.moussa,
      body: { version: 1, status: 'in_progress' },
    });
    assert.equal(advance.status, 200);
    assert.equal(advance.body.status, 'in_progress');
    assert.equal(advance.body.locked, false);
  });

  it('adding a risk tag to an existing clean project re-opens the gate (dedupe holds)', async () => {
    const created = await srv.api('POST', '/api/projects', {
      user: USERS.moussa,
      body: { name: 'Saly DMZ Exposure Review', division: 'infra' },
    });
    assert.equal(created.body.securityGateStatus, 'not_required');

    const patched = await srv.api('PATCH', `/api/projects/${created.body.id}`, {
      user: USERS.moussa,
      body: { version: created.body.version, riskTags: ['external_exposure'] },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.securityGateStatus, 'pending');

    // patching again with the same tag must NOT duplicate the approval
    const again = await srv.api('PATCH', `/api/projects/${created.body.id}`, {
      user: USERS.moussa,
      body: { version: patched.body.version, description: 'scope note' },
    });
    assert.equal(again.status, 200);

    const approvals = await srv.api('GET', '/api/approvals', { user: USERS.hamady });
    const forProject = approvals.body.filter((a) => a.projectId === created.body.id);
    assert.equal(forProject.length, 1);
  });
});
