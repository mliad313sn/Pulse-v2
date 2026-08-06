/**
 * SC5 — Executive extraction: the deck endpoint returns real PPTX/PDF binaries
 * with correct headers, and the underlying data function groups active
 * projects by division with blockers and next actions.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';
import { buildDeckData } from '../src/reporter/deck.js';

describe('SC5 — executive deck extraction', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('format=pptx returns a real PowerPoint (zip magic, >10kB, correct headers)', async () => {
    const res = await srv.api('GET', '/api/reports/executive-deck?format=pptx', {
      user: USERS.troy,
      binary: true,
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    assert.match(
      res.headers.get('content-disposition'),
      /attachment; filename="opspm360-executive-deck\.pptx"/,
    );
    assert.ok(res.buffer.length > 10 * 1024, `pptx too small: ${res.buffer.length} bytes`);
    assert.equal(res.buffer.subarray(0, 2).toString('latin1'), 'PK'); // zip magic
  });

  it('format=pdf returns a real PDF (%PDF header, correct headers)', async () => {
    const res = await srv.api('GET', '/api/reports/executive-deck?format=pdf', {
      user: USERS.troy,
      binary: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(
      res.headers.get('content-disposition'),
      /attachment; filename="opspm360-executive-deck\.pdf"/,
    );
    assert.equal(res.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(res.buffer.length > 1024);
  });

  it('bad format -> 400 VALIDATION', async () => {
    const res = await srv.api('GET', '/api/reports/executive-deck?format=docx', { user: USERS.troy });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION');
  });

  it('deck data groups active projects by division with blockers + next actions + gate flags', async () => {
    const data = await buildDeckData(srv.repo);
    assert.equal(data.title, 'OpsPM360 Executive Review');
    const codes = data.divisions.map((d) => d.code);
    assert.deepEqual(codes, ['ops', 'infra', 'bizapps']); // divisions with active projects only

    const ops = data.divisions.find((d) => d.code === 'ops');
    const readiness = ops.projects.find((p) => p.id === SEED.project1);
    assert.equal(readiness.openRoadblockCount, 1);
    assert.equal(readiness.blockers[0].description, 'Cooling unit delivery delayed at customs');
    assert.equal(readiness.blockers[0].severity, 'high');
    assert.ok(readiness.nextActions.some((t) => t.id === SEED.opsTask));

    const infra = data.divisions.find((d) => d.code === 'infra');
    const network = infra.projects.find((p) => p.id === SEED.project2);
    assert.equal(network.securityGateStatus, 'pending'); // gate flag surfaces
    const infraNext = network.nextActions.find((t) => t.id === SEED.infraTask);
    assert.ok(infraNext, 'non-done tasks appear as next actions');
    assert.equal(infraNext.locked, true); // dependency + gate both pending
  });
});
