import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked } from './helpers.js';
import { createEntity, patchEntity } from '../services/entityOps.js';
import { forbidden, notFound } from '../errors.js';

const CREATOR_ROLES = ['division_lead', 'group_manager'];

export function projectsRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await req.app.locals.repo.list('project'));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const project = await req.app.locals.repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    res.json(project);
  }));

  router.get('/:id/tasks', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const tasks = await repo.list('task', { projectId: req.params.id });
    res.json(await withLocked(repo, tasks));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    if (!CREATOR_ROLES.includes(req.user.role)) {
      throw forbidden('Creating projects requires division_lead or group_manager role');
    }
    const repo = req.app.locals.repo;
    const payload = { ownerId: req.user.id, ...req.body };
    const created = await repo.transaction(req.user.id, (tx) =>
      createEntity(tx, req.user, 'project', payload),
    );
    res.status(201).json(created);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const updated = await repo.transaction(req.user.id, (tx) =>
      patchEntity(tx, req.user, 'project', req.params.id, req.body),
    );
    res.json(updated);
  }));

  return router;
}
