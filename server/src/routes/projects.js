import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked, mountEntityCrud } from './helpers.js';
import { assertCan } from '../services/policy.js';
import { notFound } from '../errors.js';

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
    res.json(await withLocked(repo, tasks, { projects: [project] }));
  }));

  mountEntityCrud(router, 'project', {
    canCreate: (user) => assertCan(user, 'project:create'),
    buildPayload: (req) => ({ ownerId: req.user.id, ...req.body }),
  });

  return router;
}
