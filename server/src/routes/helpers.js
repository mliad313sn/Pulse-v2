import { computeLocked } from '../services/gates.js';

/** Decorate tasks with the derived `locked` flag. */
export async function withLocked(repo, tasks) {
  const [allTasks, projects] = await Promise.all([repo.list('task'), repo.list('project')]);
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  return tasks.map((t) => ({
    ...t,
    locked: computeLocked(t, tasksById, projectsById.get(t.projectId)),
  }));
}

/**
 * Presentation-level role scoping (not a hard wall): for site-focused users
 * (ops division / site managers), order their own site's rows first.
 */
export function preferUserSite(rows, user, siteOf = (r) => r.site) {
  if (!user?.site) return rows;
  if (user.division !== 'ops' && user.role !== 'site_manager') return rows;
  return [...rows].sort(
    (a, b) => (siteOf(a) === user.site ? 0 : 1) - (siteOf(b) === user.site ? 0 : 1),
  );
}
