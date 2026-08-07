import { asyncHandler } from './middleware.js';
import { computeLocked } from '../services/gates.js';
import { createEntity, patchEntity } from '../services/entityOps.js';

/** Groups membership rows by projectId (Map projectId -> rows). */
export function groupMembers(members) {
  const byProject = new Map();
  for (const m of members) {
    const list = byProject.get(m.projectId);
    if (list) list.push(m);
    else byProject.set(m.projectId, [m]);
  }
  return byProject;
}

/**
 * Loads everything the read-side policy needs in one place: the project list
 * plus membership rows grouped by project (classification is membership-based
 * and enterprise access needs member/owner/sponsor checks — E04/E01).
 */
export async function loadProjectAccess(repo) {
  const [projects, members] = await Promise.all([
    repo.list('project'),
    repo.listProjectMembers(),
  ]);
  return { projects, membersByProject: groupMembers(members) };
}

/** Wire decoration: derived `pmId` (the single PM member, or null). */
export function withPm(project, members = []) {
  return { ...project, pmId: members.find((m) => m.role === 'PM')?.userId ?? null };
}

export function withPmAll(projects, membersByProject) {
  return projects.map((p) => withPm(p, membersByProject.get(p.id) ?? []));
}

/** Single-project variant fetching its own members. */
export async function withPmOne(repo, project) {
  return withPm(project, await repo.listProjectMembers(project.id));
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
