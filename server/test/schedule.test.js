/**
 * E07 core — Critical path (plan §20/§184): pure computeSchedule unit tests on
 * a hand-computed 6-task graph (FS chains, FS+lag, an SS edge, fallback
 * 1-day durations, planned-start floors) plus the
 * GET /api/projects/:id/schedule endpoint round-trip.
 *
 * Hand computation (day 0 = 2026-01-05, dates inclusive):
 *   A dur5 (01-05..01-09)                 ES 0  EF 4   LS 0  LF 4   slack 0
 *   B dur1 (no dates)      A -FS0->B      ES 5  EF 5   LS 6  LF 6   slack 1
 *   C dur2 (01-10..01-11)  A -FS0->C      ES 5  EF 6   LS 5  LF 6   slack 0
 *   D dur3 (01-12..01-14)  B/C -FS0->D    ES 7  EF 9   LS 7  LF 9   slack 0
 *   E dur2 (01-08..01-09)  D -SS1->E      ES 8  EF 9   LS 8  LF 9   slack 0
 *     (E's own plannedStart day 3 is overridden by the SS constraint)
 *   F dur1 (no dates)      E -FS1->F,     ES 11 EF 11  LS 11 LF 11  slack 0
 *                          D -FS0->F
 *   critical path: A -> C -> D -> E -> F (B has 1 day of slack).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS } from './helpers.js';
import { computeSchedule } from '../src/services/schedule.js';

const t = (id, plannedStart = null, plannedFinish = null) => ({ id, plannedStart, plannedFinish });
const e = (predecessorId, successorId, type = 'FS', lagDays = 0) =>
  ({ predecessorId, successorId, type, lagDays });

describe('E07 — computeSchedule (pure CPM)', () => {
  it('computes the hand-checked 6-task graph (FS chains, FS+lag, SS edge)', () => {
    const tasks = [
      t('A', '2026-01-05', '2026-01-09'), // dur 5
      t('B'), //                             dur 1 (fallback)
      t('C', '2026-01-10', '2026-01-11'), // dur 2
      t('D', '2026-01-12', '2026-01-14'), // dur 3
      t('E', '2026-01-08', '2026-01-09'), // dur 2 — SS pushes past its plannedStart
      t('F'), //                             dur 1 (fallback)
    ];
    const deps = [
      e('A', 'B'),
      e('A', 'C'),
      e('B', 'D'),
      e('C', 'D'),
      e('D', 'E', 'SS', 1),
      e('E', 'F', 'FS', 1),
      e('D', 'F'),
    ];

    const { tasks: rows, criticalPath } = computeSchedule(tasks, deps);
    const by = Object.fromEntries(rows.map((r) => [r.taskId, r]));

    assert.deepEqual(by.A, {
      taskId: 'A', earliestStart: '2026-01-05', earliestFinish: '2026-01-09',
      latestStart: '2026-01-05', latestFinish: '2026-01-09', slackDays: 0, critical: true,
    });
    assert.deepEqual(by.B, {
      taskId: 'B', earliestStart: '2026-01-10', earliestFinish: '2026-01-10',
      latestStart: '2026-01-11', latestFinish: '2026-01-11', slackDays: 1, critical: false,
    });
    assert.deepEqual(by.C, {
      taskId: 'C', earliestStart: '2026-01-10', earliestFinish: '2026-01-11',
      latestStart: '2026-01-10', latestFinish: '2026-01-11', slackDays: 0, critical: true,
    });
    assert.deepEqual(by.D, {
      taskId: 'D', earliestStart: '2026-01-12', earliestFinish: '2026-01-14',
      latestStart: '2026-01-12', latestFinish: '2026-01-14', slackDays: 0, critical: true,
    });
    // SS + lag 1: E starts the day after D starts — NOT after D finishes.
    assert.deepEqual(by.E, {
      taskId: 'E', earliestStart: '2026-01-13', earliestFinish: '2026-01-14',
      latestStart: '2026-01-13', latestFinish: '2026-01-14', slackDays: 0, critical: true,
    });
    // FS + lag 1 off E (day 9 finish): F starts day 11, not day 10.
    assert.deepEqual(by.F, {
      taskId: 'F', earliestStart: '2026-01-16', earliestFinish: '2026-01-16',
      latestStart: '2026-01-16', latestFinish: '2026-01-16', slackDays: 0, critical: true,
    });

    assert.deepEqual(criticalPath, ['A', 'C', 'D', 'E', 'F']);
  });

  it('lag on FS shifts the successor start by lag days after the predecessor finish', () => {
    const { tasks: rows } = computeSchedule(
      [t('A', '2026-03-02', '2026-03-03'), t('B')],
      [e('A', 'B', 'FS', 3)],
    );
    const b = rows.find((r) => r.taskId === 'B');
    // A finishes 03-03; +1 day (FS) +3 lag -> 03-07.
    assert.equal(b.earliestStart, '2026-03-07');
    assert.equal(b.earliestFinish, '2026-03-07');
  });

  it('unlinked tasks anchor at the earliest plannedStart and carry slack to project end', () => {
    const { tasks: rows, criticalPath } = computeSchedule(
      [t('LONG', '2026-05-04', '2026-05-08'), t('FREE')],
      [],
    );
    const free = rows.find((r) => r.taskId === 'FREE');
    assert.equal(free.earliestStart, '2026-05-04'); // anchor day 0
    assert.equal(free.slackDays, 4); // may slip to the project end (05-08)
    assert.equal(free.critical, false);
    assert.deepEqual(criticalPath, ['LONG']);
  });

  it('handles an empty task set', () => {
    assert.deepEqual(computeSchedule([], []), { tasks: [], criticalPath: [] });
  });
});

describe('E07 — GET /api/projects/:id/schedule', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  it('returns the computed schedule + critical path for a project (readable by VIEWER)', async () => {
    const project = (await srv.api('POST', '/api/projects', {
      user: USERS.troy, body: { name: 'Schedule smoke', division: 'management' },
    })).body;

    const mkTask = async (fields) => (await srv.api('POST', '/api/tasks', {
      user: USERS.troy, body: { projectId: project.id, ...fields },
    })).body;
    const t1 = await mkTask({ title: 'T1', plannedStart: '2026-02-02', plannedFinish: '2026-02-03' });
    const t2 = await mkTask({ title: 'T2' });
    const t3 = await mkTask({ title: 'T3' });

    const mkDep = (body) => srv.api('POST', '/api/dependencies', { user: USERS.troy, body });
    assert.equal((await mkDep({ predecessorId: t1.id, successorId: t2.id, type: 'FS', lagDays: 1 })).status, 201);
    assert.equal((await mkDep({ predecessorId: t1.id, successorId: t3.id, type: 'SS' })).status, 201);

    const res = await srv.api('GET', `/api/projects/${project.id}/schedule`, { user: USERS.aissatou });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const by = Object.fromEntries(res.body.tasks.map((r) => [r.taskId, r]));

    // T1 dur 2 anchored 02-02; T2 = FS+1 -> starts 02-05; T3 SS -> starts 02-02.
    assert.deepEqual(by[t1.id], {
      taskId: t1.id, earliestStart: '2026-02-02', earliestFinish: '2026-02-03',
      latestStart: '2026-02-02', latestFinish: '2026-02-03', slackDays: 0, critical: true,
    });
    assert.deepEqual(by[t2.id], {
      taskId: t2.id, earliestStart: '2026-02-05', earliestFinish: '2026-02-05',
      latestStart: '2026-02-05', latestFinish: '2026-02-05', slackDays: 0, critical: true,
    });
    assert.equal(by[t3.id].earliestStart, '2026-02-02');
    assert.equal(by[t3.id].slackDays, 3);
    assert.equal(by[t3.id].critical, false);

    assert.deepEqual(res.body.criticalPath, [t1.id, t2.id]);
  });

  it('404 for unknown projects', async () => {
    const res = await srv.api('GET', '/api/projects/99999999-0000-0000-0000-000000000000/schedule', { user: USERS.troy });
    assert.equal(res.status, 404);
  });
});
