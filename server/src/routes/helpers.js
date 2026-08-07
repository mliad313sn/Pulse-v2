import { asyncHandler } from './middleware.js';
import { computeLocked } from '../services/gates.js';
import { computeProgress } from '../services/progress.js';
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
 */
export async function loadProjectAccess(repo) {
  const [projects, members, milestones] = await Promise.all([
    repo.list('project'),
    repo.listProjectMembers(),
    repo.list('milestone'),
  ]);
  return {
    projects,
    membersByProject: groupMembers(members),
    milestonesByProject: groupByProject(milestones),
  };
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
 * Decorate tasks with the derived `locked` flag.
 * `preloaded` lets callers that already fetched the full task/project lists
 * (e.g. bootstrap) avoid a second round of repo.list calls.
 */
export async function withLocked(repo, tasks, preloaded = {}) {
  const [allTasks, projects] = await Promise.all([
    preloaded.tasks ?? repo.list('task'),
    preloaded.projects ?? repo.list('project'),
  ]);
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  return tasks.map((t) => ({
    ...t,
    locked: computeLocked(t, tasksById, projectsById.get(t.projectId)),
  }));
}

/**
 * Single-task variant of withLocked: fetches only what computeLocked needs —
 * the prerequisite task (if any) and the parent project.
 */
export async function withLockedOne(repo, task) {
  const [dep, project] = await Promise.all([
    task.dependencyLock ? repo.get('task', task.dependencyLock) : null,
    repo.get('project', task.projectId),
  ]);
  const tasksById = new Map(dep ? [[dep.id, dep]] : []);
  return { ...task, locked: computeLocked(task, tasksById, project) };
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
