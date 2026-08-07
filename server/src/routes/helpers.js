import { randomUUID } from 'node:crypto';
import { asyncHandler } from './middleware.js';
import { computeLocked } from '../services/gates.js';
import { computeProgress } from '../services/progress.js';
import { computeRag } from '../services/rag.js';
import { createEntity, patchEntity } from '../services/entityOps.js';

/** Groups membership rows by projectId (Map projectId -> rows). */
export function groupMembers(members) {
  return groupByProject(members);
}

/** Groups any projectId-bearing rows into a Map projectId -> rows. */
export function groupByProject(rows) {
  const byProject = new Map();
  for (const r of rows) {
    const list = byProject.get(r.projectId);
    if (list) list.push(r);
    else byProject.set(r.projectId, [r]);
  }
  return byProject;
}

/**
 * Loads everything the read-side policy + wire decoration need in one place:
 * the project list, membership rows grouped by project (classification is
 * membership-based and enterprise access needs member/owner/sponsor checks —
 * E04/E01), and milestones grouped by project (derived `progress` — E08).
 *
 * `{ rag: true }` additionally loads the RAG inputs (tasks, roadblocks,
 * actions, project updates) grouped per project — everything computeRag needs,
 * in ONE pass per request (no N+1). Routes that only filter by readability
 * keep the cheap 3-list load.
 */
export async function loadProjectAccess(repo, { rag = false } = {}) {
  const [projects, members, milestones, tasks, roadblocks, actions, updates] = await Promise.all([
    repo.list('project'),
    repo.listProjectMembers(),
    repo.list('milestone'),
    ...(rag ? [repo.list('task'), repo.list('roadblock'), repo.list('action'), repo.list('projectUpdate')] : []),
  ]);
  const access = {
    projects,
    membersByProject: groupMembers(members),
    milestonesByProject: groupByProject(milestones),
  };
  if (rag) {
    access.tasks = tasks;
    access.roadblocks = roadblocks;
    access.actions = actions;
    access.updates = updates;
    access.tasksByProject = groupByProject(tasks);
    access.roadblocksByProject = groupByProject(roadblocks);
    // General actions (projectId null) group under the null key and simply
    // never match a project id — they are personal, not project health.
    access.actionsByProject = groupByProject(actions);
    access.updatesByProject = groupByProject(updates);
  }
  return access;
}

/** Newest-first copy by createdAt; ties keep the later-inserted row first. */
export function newestFirst(rows) {
  return [...rows]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .reverse();
}

/**
 * E10 RAG trend (plan §133): lazily append a snapshot when the effective or
 * computed color differs from the project's LAST snapshot. Running at read
 * time (decoration) guarantees a snapshot exists before anyone sees a new
 * color, for both repos, without hooking every write path. History is never
 * backfilled — the first snapshot is simply the first observed state.
 */
export async function ensureRagSnapshot(repo, projectId, rag, last) {
  if (last && last.color === rag.color && last.computedColor === rag.computedColor) return;
  await repo.appendRagSnapshot({
    id: randomUUID(),
    projectId,
    color: rag.color,
    computedColor: rag.computedColor,
    isManual: rag.manual != null,
    capturedAt: new Date().toISOString(),
  });
}

/**
 * Decorates wire projects with the derived `rag` block (E10). Requires the
 * grouped maps from loadProjectAccess(repo, {rag: true}) — everything is
 * O(one pass): the per-project maps and the snapshot list are built once.
 */
export async function withRagAll(repo, projects, access, now = new Date()) {
  const lastSnapshotByProject = new Map();
  for (const s of await repo.listRagSnapshots()) lastSnapshotByProject.set(s.projectId, s);
  const out = [];
  for (const p of projects) {
    const rag = computeRag({
      project: p,
      milestones: access.milestonesByProject.get(p.id) ?? [],
      roadblocks: access.roadblocksByProject.get(p.id) ?? [],
      tasks: access.tasksByProject.get(p.id) ?? [],
      actions: access.actionsByProject?.get(p.id) ?? [],
      updates: access.updatesByProject.get(p.id) ?? [],
      now,
    });
    await ensureRagSnapshot(repo, p.id, rag, lastSnapshotByProject.get(p.id));
    out.push({ ...p, rag });
  }
  return out;
}

/** Single-project variant of withRagAll, fetching only that project's inputs. */
export async function withRagOne(repo, project, now = new Date()) {
  const [milestones, roadblocks, tasks, actions, updates, snapshots] = await Promise.all([
    repo.list('milestone', { projectId: project.id }),
    repo.list('roadblock', { projectId: project.id }),
    repo.list('task', { projectId: project.id }),
    repo.list('action', { projectId: project.id }),
    repo.list('projectUpdate', { projectId: project.id }),
    repo.listRagSnapshots({ projectId: project.id }),
  ]);
  const rag = computeRag({ project, milestones, roadblocks, tasks, actions, updates, now });
  await ensureRagSnapshot(repo, project.id, rag, snapshots[snapshots.length - 1]);
  return { ...project, rag };
}

/**
 * Wire decoration: derived `pmId` (the single PM member, or null) and the
 * COMPUTED `progress` block (plan §23, invariant 15 — never writable; the
 * field is not in ENTITY_DEFS.project.writable so PATCH/sync ignore it).
 */
export function withPm(project, members = [], milestones = []) {
  return {
    ...project,
    pmId: members.find((m) => m.role === 'PM')?.userId ?? null,
    progress: computeProgress(milestones),
  };
}

export function withPmAll(projects, membersByProject, milestonesByProject = new Map()) {
  return projects.map((p) =>
    withPm(p, membersByProject.get(p.id) ?? [], milestonesByProject.get(p.id) ?? []));
}

/** Single-project variant fetching its own members + milestones. */
export async function withPmOne(repo, project) {
  const [members, milestones] = await Promise.all([
    repo.listProjectMembers(project.id),
    repo.list('milestone', { projectId: project.id }),
  ]);
  return withPm(project, members, milestones);
}

/**
 * Decorate tasks with the derived `locked` flag (dependencyLock + FS typed
 * dependencies + security gate — E07).
 * `preloaded` lets callers that already fetched the full task/project/
 * dependency lists (e.g. bootstrap) avoid a second round of repo.list calls.
 */
export async function withLocked(repo, tasks, preloaded = {}) {
  const [allTasks, projects, dependencies] = await Promise.all([
    preloaded.tasks ?? repo.list('task'),
    preloaded.projects ?? repo.list('project'),
    preloaded.dependencies ?? repo.list('dependency'),
  ]);
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const depsByProject = groupByProject(dependencies);
  return tasks.map((t) => ({
    ...t,
    locked: computeLocked(t, tasksById, projectsById.get(t.projectId), depsByProject.get(t.projectId) ?? []),
  }));
}

/**
 * Single-task variant of withLocked: fetches only what computeLocked needs —
 * the project's dependency edges, the predecessor tasks and the parent project.
 */
export async function withLockedOne(repo, task) {
  const [project, projectDeps] = await Promise.all([
    repo.get('project', task.projectId),
    repo.list('dependency', { projectId: task.projectId }),
  ]);
  const predIds = new Set(
    projectDeps.filter((d) => d.successorId === task.id && d.type === 'FS').map((d) => d.predecessorId),
  );
  if (task.dependencyLock) predIds.add(task.dependencyLock);
  const tasksById = new Map();
  for (const id of predIds) tasksById.set(id, await repo.get('task', id));
  return { ...task, locked: computeLocked(task, tasksById, project, projectDeps) };
}

/**
 * Mounts the shared POST / and PATCH /:id handlers for an entity kind.
 * Options:
 *   canCreate(user)      — pre-create role check (throws typed errors)
 *   buildPayload(req)    — create payload from the request (default req.body)
 *   decorate(repo, row)  — response decoration (default identity)
 */
export function mountEntityCrud(router, kind, { canCreate, buildPayload, decorate } = {}) {
  router.post('/', asyncHandler(async (req, res) => {
    if (canCreate) canCreate(req.user);
    const repo = req.app.locals.repo;
    const payload = buildPayload ? buildPayload(req) : req.body;
    const created = await repo.transaction(req.user.id, (tx) =>
      createEntity(tx, req.user, kind, payload),
    );
    res.status(201).json(decorate ? await decorate(repo, created) : created);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const updated = await repo.transaction(req.user.id, (tx) =>
      patchEntity(tx, req.user, kind, req.params.id, req.body),
    );
    res.json(decorate ? await decorate(repo, updated) : updated);
  }));
}

/**
 * Presentation-level scoping (not a hard wall): for site-focused users
 * (ops division), order their own site's rows first.
 */
export function preferUserSite(rows, user, siteOf = (r) => r.site) {
  if (!user?.site) return rows;
  if (user.division !== 'ops') return rows;
  return [...rows].sort(
    (a, b) => (siteOf(a) === user.site ? 0 : 1) - (siteOf(b) === user.site ? 0 : 1),
  );
}
