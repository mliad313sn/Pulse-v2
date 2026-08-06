/**
 * Audit ledger: every mutation writes an audit entry with actor attribution,
 * the audit endpoint filters by entityId, and the in-memory ledger is
 * immutable (push-only).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';
import { createAuditLedger } from '../src/services/audit.js';

describe('audit trail for mutations', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('INSERT + UPDATE entries are written with actor attribution', async () => {
    const created = await srv.api('POST', '/api/roadblocks', {
      user: USERS.awa,
      body: { projectId: SEED.project1, description: 'Access road flooded' },
    });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const patched = await srv.api('PATCH', `/api/roadblocks/${id}`, {
      user: USERS.awa,
      body: { version: 1, status: 'mitigating' },
    });
    assert.equal(patched.status, 200);

    const audit = await srv.api('GET', `/api/audit?entityId=${id}`, { user: USERS.troy });
    assert.equal(audit.status, 200);
    assert.deepEqual(audit.body.map((e) => e.action), ['INSERT', 'UPDATE']);
    assert.ok(audit.body.every((e) => e.actorId === USERS.awa));
    assert.ok(audit.body.every((e) => e.entityType === 'roadblocks'));
    assert.equal(audit.body[0].oldData, null);
    assert.equal(audit.body[0].newData.description, 'Access road flooded');
    assert.equal(audit.body[1].oldData.status, 'open');
    assert.equal(audit.body[1].newData.status, 'mitigating');
  });

  it('task PATCH and approval decisions are audited too', async () => {
    await srv.api('PATCH', `/api/tasks/${SEED.erpTask}`, {
      user: USERS.ibrahima,
      body: { version: 1, status: 'in_progress' },
    });
    const taskAudit = await srv.api('GET', `/api/audit?entityId=${SEED.erpTask}`, { user: USERS.troy });
    assert.equal(taskAudit.body.length, 1);
    assert.equal(taskAudit.body[0].action, 'UPDATE');
    assert.equal(taskAudit.body[0].actorId, USERS.ibrahima);

    await srv.api('POST', `/api/approvals/${SEED.approval1}/decision`, {
      user: USERS.hamady,
      body: { decision: 'approved' },
    });
    const approvalAudit = await srv.api('GET', `/api/audit?entityId=${SEED.approval1}`, { user: USERS.troy });
    assert.equal(approvalAudit.body.length, 1);
    assert.equal(approvalAudit.body[0].actorId, USERS.hamady);
    // the gate recompute on the project is audited as well
    const projectAudit = await srv.api('GET', `/api/audit?entityId=${SEED.project2}`, { user: USERS.troy });
    assert.ok(projectAudit.body.some((e) => e.newData.securityGateStatus === 'approved'));
  });
});

describe('audit ledger immutability (in-memory mirror of trg_audit_immutable)', () => {
  it('entries and query results are frozen; mutation attempts throw', () => {
    const ledger = createAuditLedger();
    ledger.append({ entityType: 'tasks', entityId: 't1', action: 'INSERT', actorId: 'u1', newData: { a: 1 } });

    const entries = ledger.query();
    assert.equal(entries.length, 1);
    assert.ok(Object.isFrozen(ledger));
    assert.ok(Object.isFrozen(entries));
    assert.ok(Object.isFrozen(entries[0]));

    assert.throws(() => entries.push({ action: 'FORGED' }), TypeError);
    assert.throws(() => { entries[0].action = 'TAMPERED'; }, TypeError);
    assert.throws(() => { entries[0].newData.a = 999; }, TypeError);
    assert.throws(() => { delete entries[0].actorId; }, TypeError);

    // the ledger exposes no update/delete surface at all
    assert.equal(typeof ledger.update, 'undefined');
    assert.equal(typeof ledger.delete, 'undefined');
    assert.equal(typeof ledger.clear, 'undefined');

    // and the original entry is intact
    assert.equal(ledger.query()[0].action, 'INSERT');
    assert.equal(ledger.query()[0].newData.a, 1);
  });

  it('the repo audit list returned over HTTP is a copy — external pushes cannot poison it', async () => {
    const srv2 = await startServer();
    try {
      await srv2.api('POST', '/api/roadblocks', {
        user: USERS.awa,
        body: { projectId: SEED.project1, description: 'x' },
      });
      const before = (await srv2.api('GET', '/api/audit', { user: USERS.troy })).body.length;
      assert.ok(before >= 1);
      const again = (await srv2.api('GET', '/api/audit', { user: USERS.troy })).body.length;
      assert.equal(again, before);
    } finally {
      await srv2.close();
    }
  });
});
