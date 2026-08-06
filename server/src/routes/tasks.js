import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked, withLockedOne, preferUserSite, mountEntityCrud } from './helpers.js';
import { notFound } from '../errors.js';

export function tasksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const tasks = await repo.list('task', filter);
    res.json(preferUserSite(await withLocked(repo, tasks), req.user));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const task = await repo.get('task', req.params.id);
    if (!task) throw notFound(`task ${req.params.id} not found`);
    res.json(await withLockedOne(repo, task));
  }));

  mountEntityCrud(router, 'task', { decorate: withLockedOne });

  return router;
}
