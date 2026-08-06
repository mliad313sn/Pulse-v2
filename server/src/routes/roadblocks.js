import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { preferUserSite } from './helpers.js';
import { createEntity, patchEntity } from '../services/entityOps.js';

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

  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const created = await repo.transaction(req.user.id, (tx) =>
      createEntity(tx, req.user, 'roadblock', req.body),
    );
    res.status(201).json(created);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const updated = await repo.transaction(req.user.id, (tx) =>
      patchEntity(tx, req.user, 'roadblock', req.params.id, req.body),
    );
    res.json(updated);
  }));

  return router;
}
