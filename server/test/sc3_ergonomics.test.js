/**
 * SC3 (API side) — Ergonomics: one request updates a task status; one request
 * with only the minimal fields logs a roadblock, with sensible defaults.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

describe('SC3 — single-request ergonomics with defaults', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('task status update is exactly one PATCH request', async () => {
    const res = await srv.api('PATCH', `/api/tasks/${SEED.erpTask}`, {
      user: USERS.ibrahima,
      body: { version: 1, status: 'in_progress' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'in_progress');
    assert.equal(res.body.version, 2);
  });

  it('roadblock creation is one POST with just projectId + description; defaults fill the rest', async () => {
    const res = await srv.api('POST', '/api/roadblocks', {
      user: USERS.awa,
      body: { projectId: SEED.project1, description: 'Dust storm halted cabling work' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.severity, 'medium'); // default
    assert.equal(res.body.status, 'open'); // default
    assert.equal(res.body.reportedBy, USERS.awa); // defaults to the acting user
    assert.equal(res.body.taskId, null);
    assert.equal(res.body.version, 1);
    assert.ok(res.body.id);
  });

  it('rejects a roadblock missing its minimal fields with 400 VALIDATION', async () => {
    const res = await srv.api('POST', '/api/roadblocks', {
      user: USERS.awa,
      body: { projectId: SEED.project1 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');
  });
});
