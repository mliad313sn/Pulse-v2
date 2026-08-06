import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked, preferUserSite } from './helpers.js';
import { createEntity, patchEntity } from '../services/entityOps.js';
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
    const [decorated] = await withLocked(repo, [task]);
    res.json(decorated);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const created = await repo.transaction(req.user.id, (tx) =>
      createEntity(tx, req.user, 'task', req.body),
    );
    const [decorated] = await withLocked(repo, [created]);
    res.status(201).json(decorated);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const updated = await repo.transaction(req.user.id, (tx) =>
      patchEntity(tx, req.user, 'task', req.params.id, req.body),
    );
    const [decorated] = await withLocked(repo, [updated]);
    res.json(decorated);
  }));

  return router;
}
