/**
 * E13 core — Project updates (plan §32): append-only POST + GET, writer
 * policy (manage-level / owner-sponsor / contributing member; INFORMED and
 * VIEWER excluded), validation (mood enum, text <=400), concealment, the
 * bootstrap cap (latest 20 per project) and audit.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, SEED } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('E13 — project updates (append-only)', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const post = (user, body) => srv.api('POST', '/api/updates', { user, body });

  describe('create + read', () => {
    it('a manager can post; response carries author, mood and createdAt', async () => {
      const res = await post(USERS.moussa, {
        projectId: SEED.project2,
        mood: 'CONCERN',
        text: 'WAN uplink hardware delayed by two weeks.',
        supportRequired: 'Expedite customs clearance',
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.projectId, SEED.project2);
      assert.equal(res.body.authorId, USERS.moussa);
      assert.equal(res.body.mood, 'CONCERN');
      assert.equal(res.body.supportRequired, 'Expedite customs clearance');
      assert.equal(res.body.accomplishment, null);
      assert.ok(res.body.id);
      assert.ok(res.body.createdAt);
    });

    it('GET /api/projects/:id/updates returns newest first', async () => {
      await sleep(10);
      const second = await post(USERS.moussa, {
        projectId: SEED.project2, mood: 'POSITIVE', text: 'Hardware arrived early after all.',
      });
      assert.equal(second.status, 201);

      const list = await srv.api('GET', `/api/projects/${SEED.project2}/updates`, { user: USERS.awa });
      assert.equal(list.status, 200);
      assert.ok(list.body.length >= 2);
      assert.equal(list.body[0].id, second.body.id, 'newest first');
      const sorted = [...list.body.map((u) => u.createdAt)].sort().reverse();
      assert.deepEqual(list.body.map((u) => u.createdAt), sorted);
    });

    it('the seed update for project1 is present (frontend has data out of the box)', async () => {
      const list = await srv.api('GET', `/api/projects/${SEED.project1}/updates`, { user: USERS.awa });
      assert.equal(list.status, 200);
      assert.ok(list.body.some((u) => u.id === '50000000-0000-0000-0000-000000000001'));
    });

    it('every POST is audited (INSERT on project_updates)', async () => {
      const created = await post(USERS.troy, {
        projectId: SEED.project3, mood: 'NEUTRAL', text: 'Kickoff scheduled.',
      });
      assert.equal(created.status, 201);
      const audit = await srv.api('GET', `/api/audit?entityId=${created.body.id}`, { user: USERS.troy });
      assert.equal(audit.status, 200);
      assert.ok(audit.body.some(
        (e) => e.entityType === 'project_updates' && e.action === 'INSERT' && e.actorId === USERS.troy,
      ));
    });
  });

  describe('validation (400)', () => {
    const cases = [
      [{ mood: 'NEUTRAL', text: 'x' }, /projectId/],
      [{ projectId: SEED.project2, text: 'missing mood' }, /mood/],
      [{ projectId: SEED.project2, mood: 'ANGRY', text: 'x' }, /mood/],
      [{ projectId: SEED.project2, mood: 'NEUTRAL' }, /text/],
      [{ projectId: SEED.project2, mood: 'NEUTRAL', text: '   ' }, /text/],
      [{ projectId: SEED.project2, mood: 'NEUTRAL', text: 'y'.repeat(401) }, /400 characters/],
      [{ projectId: SEED.project2, mood: 'NEUTRAL', text: 'ok', nextStep: 42 }, /nextStep/],
    ];
    it('missing/oversized/malformed fields are refused', async () => {
      for (const [body, re] of cases) {
        const res = await post(USERS.moussa, body);
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.equal(res.body.error, 'VALIDATION');
        assert.match(res.body.message, re);
      }
    });

    it('exactly 400 characters is accepted', async () => {
      const res = await post(USERS.moussa, {
        projectId: SEED.project2, mood: 'NEUTRAL', text: 'z'.repeat(400),
      });
      assert.equal(res.status, 201);
    });
  });

  describe('writer policy', () => {
    it('VIEWER -> 403 (hard read-only)', async () => {
      const res = await post(USERS.aissatou, {
        projectId: SEED.project1, mood: 'POSITIVE', text: 'viewer cannot post',
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'FORBIDDEN');
    });

    it('an uninvolved contributor -> 403; the project owner may post', async () => {
      // Awa (ops CONTRIBUTOR) has no involvement with project3 (bizapps).
      const denied = await post(USERS.awa, {
        projectId: SEED.project3, mood: 'NEUTRAL', text: 'not my project',
      });
      assert.equal(denied.status, 403);

      // Ibrahima owns project3.
      const owner = await post(USERS.ibrahima, {
        projectId: SEED.project3, mood: 'POSITIVE', text: 'Staging validation started.',
      });
      assert.equal(owner.status, 201);
      assert.equal(owner.body.authorId, USERS.ibrahima);
    });

    it('INFORMED membership does NOT grant posting; CONTRIBUTOR membership does', async () => {
      const informed = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
        user: USERS.troy, body: { userId: USERS.awa, role: 'INFORMED' },
      });
      assert.equal(informed.status, 201);
      const denied = await post(USERS.awa, {
        projectId: SEED.project3, mood: 'NEUTRAL', text: 'informed only',
      });
      assert.equal(denied.status, 403);

      const contrib = await srv.api('POST', `/api/projects/${SEED.project3}/members`, {
        user: USERS.troy, body: { userId: USERS.awa, role: 'CONTRIBUTOR' },
      });
      assert.equal(contrib.status, 201);
      const ok = await post(USERS.awa, {
        projectId: SEED.project3, mood: 'NEUTRAL', text: 'now contributing',
      });
      assert.equal(ok.status, 201);
    });
  });

  describe('append-only surface', () => {
    it('no PATCH/DELETE route exists for updates', async () => {
      const list = await srv.api('GET', `/api/projects/${SEED.project2}/updates`, { user: USERS.troy });
      const target = list.body[0];
      const patch = await srv.api('PATCH', `/api/updates/${target.id}`, {
        user: USERS.troy, body: { text: 'rewrite history' },
      });
      assert.equal(patch.status, 404);
      const del = await srv.api('DELETE', `/api/updates/${target.id}`, { user: USERS.troy });
      assert.equal(del.status, 404);
      // The row is untouched.
      const again = await srv.api('GET', `/api/projects/${SEED.project2}/updates`, { user: USERS.troy });
      assert.deepEqual(again.body.find((u) => u.id === target.id), target);
    });

    it('updates are NOT a sync entity (online-only)', async () => {
      const res = await srv.api('POST', '/api/sync', {
        user: USERS.moussa,
        body: {
          clientId: 'upd-device',
          operations: [{
            opId: 'u1', entity: 'projectUpdate', op: 'create',
            fields: { projectId: SEED.project2, mood: 'NEUTRAL', text: 'offline pulse' },
          }],
        },
      });
      assert.equal(res.status, 200); // batch envelope; the op itself is rejected
      assert.equal(res.body.results[0].result, 'rejected');
      assert.equal(res.body.results[0].error, 'VALIDATION');
    });
  });

  describe('concealment (ADR-005)', () => {
    let confidential;
    before(async () => {
      const proj = await srv.api('POST', '/api/projects', {
        user: USERS.troy,
        body: { name: 'Covert Uplink', division: 'infra', classification: 'confidential' },
      });
      assert.equal(proj.status, 201);
      confidential = proj.body;
      const upd = await post(USERS.troy, {
        projectId: confidential.id, mood: 'CRITICAL', text: 'covert status',
      });
      assert.equal(upd.status, 201);
    });

    it('listing and posting against a concealed project look like an unknown id', async () => {
      const listing = await srv.api('GET', `/api/projects/${confidential.id}/updates`, { user: USERS.ibrahima });
      assert.equal(listing.status, 404);
      assert.equal(listing.body.error, 'NOT_FOUND');

      const create = await post(USERS.ibrahima, {
        projectId: confidential.id, mood: 'NEUTRAL', text: 'probe',
      });
      assert.equal(create.status, 400);
      assert.match(create.body.message, /Unknown projectId/);
    });

    it('bootstrap excludes updates of concealed projects', async () => {
      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.ibrahima });
      assert.equal(boot.status, 200);
      assert.ok(Array.isArray(boot.body.updates));
      assert.ok(!boot.body.updates.some((u) => u.projectId === confidential.id));
      assert.ok(!JSON.stringify(boot.body).includes('covert status'));
    });
  });

  describe('bootstrap cap', () => {
    it('bootstrap carries at most the latest 20 updates per project', async () => {
      for (let i = 0; i < 25; i += 1) {
        const res = await post(USERS.ibrahima, {
          projectId: SEED.project3, mood: 'NEUTRAL', text: `pulse ${i}`,
        });
        assert.equal(res.status, 201);
      }
      const boot = await srv.api('GET', '/api/bootstrap', { user: USERS.ibrahima });
      const forProject3 = boot.body.updates.filter((u) => u.projectId === SEED.project3);
      assert.equal(forProject3.length, 20);
      assert.ok(forProject3.some((u) => u.text === 'pulse 24'), 'newest kept');
      assert.ok(!forProject3.some((u) => u.text === 'pulse 0'), 'oldest dropped');
      // Full history stays available on the per-project endpoint.
      const full = await srv.api('GET', `/api/projects/${SEED.project3}/updates`, { user: USERS.ibrahima });
      assert.ok(full.body.length > 20);
    });
  });
});
