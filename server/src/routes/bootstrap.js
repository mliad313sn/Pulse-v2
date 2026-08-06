import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked } from './helpers.js';

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
    res.json({
      user: req.user,
      projects,
      tasks: await withLocked(repo, tasks),
      roadblocks,
      approvals,
      serverTime: new Date().toISOString(),
    });
  }));
  return router;
}
