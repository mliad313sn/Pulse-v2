import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { preferUserSite, mountEntityCrud } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

export function roadblocksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [roadblocks, projects] = await Promise.all([
      repo.list('roadblock', filter),
      repo.list('project'),
    ]);
    // ADR-005: roadblocks of concealed projects are absent from every list.
    const visible = readableProjectIds(req.user, projects);
    const scoped = roadblocks.filter((r) => visible.has(r.projectId));
    const siteByProject = new Map(projects.map((p) => [p.id, p.site]));
    res.json(preferUserSite(scoped, req.user, (r) => siteByProject.get(r.projectId)));
  }));

  mountEntityCrud(router, 'roadblock');

  return router;
}
