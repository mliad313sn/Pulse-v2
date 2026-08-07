import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked } from './helpers.js';
import { filterReadableProjects, readableProjectIds } from '../services/policy.js';
import { publicUser } from '../services/auth.js';

/** GET /api/bootstrap — everything the client caches into IndexedDB. */
export function bootstrapRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const [projects, tasks, roadblocks, approvals] = await Promise.all([
      repo.list('project'),
      repo.list('task'),
      repo.list('roadblock'),
      repo.list('approval'),
    ]);
    // ADR-005: concealed projects (and their children) never reach the client cache.
    const visibleProjects = filterReadableProjects(req.user, projects);
    const visible = readableProjectIds(req.user, projects);
    const visibleTasks = tasks.filter((t) => visible.has(t.projectId));
    res.json({
      user: publicUser(req.user),
      projects: visibleProjects,
      tasks: await withLocked(repo, visibleTasks, { tasks, projects }),
      roadblocks: roadblocks.filter((r) => visible.has(r.projectId)),
      approvals: approvals.filter((a) => visible.has(a.projectId)),
      serverTime: new Date().toISOString(),
    });
  }));
  return router;
}
