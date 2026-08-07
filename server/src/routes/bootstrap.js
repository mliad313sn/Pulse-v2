import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, withLocked, withPmAll } from './helpers.js';
import { filterReadableProjects, readableProjectIds } from '../services/policy.js';
import { publicUser } from '../services/auth.js';
import { dependencyWire } from './dependencies.js';

/** GET /api/bootstrap — everything the client caches into IndexedDB. */
export function bootstrapRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const [{ projects, membersByProject, milestonesByProject }, tasks, roadblocks, approvals, pillars, portfolios, programs, workstreams, dependencies] =
      await Promise.all([
        loadProjectAccess(repo),
        repo.list('task'),
        repo.list('roadblock'),
        repo.list('approval'),
        repo.list('pillar'),
        repo.list('portfolio'),
        repo.list('program'),
        repo.list('workstream'),
        repo.list('dependency'),
      ]);
    // ADR-005 + E01 enterprise access: concealed projects (and their children)
    // never reach the client cache.
    const visibleProjects = filterReadableProjects(req.user, projects, membersByProject);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    const visibleTasks = tasks.filter((t) => visible.has(t.projectId));
    const milestones = [...milestonesByProject.entries()]
      .filter(([pid]) => visible.has(pid))
      .flatMap(([, rows]) => rows);
    const directory = (await repo.listUsers()).map(publicUser);
    res.json({
      user: publicUser(req.user),
      users: directory,
      projects: withPmAll(visibleProjects, membersByProject, milestonesByProject),
      tasks: await withLocked(repo, visibleTasks, { tasks, projects, dependencies }),
      roadblocks: roadblocks.filter((r) => visible.has(r.projectId)),
      approvals: approvals.filter((a) => visible.has(a.projectId)),
      milestones,
      workstreams: workstreams.filter((w) => visible.has(w.projectId)),
      dependencies: dependencies.filter((d) => visible.has(d.projectId)).map(dependencyWire),
      pillars,
      portfolios,
      programs,
      serverTime: new Date().toISOString(),
    });
  }));
  return router;
}
