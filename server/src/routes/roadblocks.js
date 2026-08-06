import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { preferUserSite, mountEntityCrud } from './helpers.js';

export function roadblocksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const roadblocks = await repo.list('roadblock', filter);
    const projects = await repo.list('project');
    const siteByProject = new Map(projects.map((p) => [p.id, p.site]));
    res.json(preferUserSite(roadblocks, req.user, (r) => siteByProject.get(r.projectId)));
  }));

  mountEntityCrud(router, 'roadblock');

  return router;
}
