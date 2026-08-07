import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { withLocked, withLockedOne, preferUserSite, mountEntityCrud } from './helpers.js';
import { readableProjectIds, assertReadProject } from '../services/policy.js';
import { notFound } from '../errors.js';

export function tasksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [tasks, projects] = await Promise.all([repo.list('task', filter), repo.list('project')]);
    // ADR-005: tasks of concealed projects are absent from every list.
    const visible = readableProjectIds(req.user, projects);
    const scoped = tasks.filter((t) => visible.has(t.projectId));
    res.json(preferUserSite(await withLocked(repo, scoped, { projects }), req.user));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const task = await repo.get('task', req.params.id);
    if (!task) throw notFound(`task ${req.params.id} not found`);
    const project = await repo.get('project', task.projectId);
    // ADR-005 concealment: same 404 as a missing task id.
    assertReadProject(req.user, project, 'task', req.params.id);
    res.json(await withLockedOne(repo, task));
  }));

  mountEntityCrud(router, 'task', { decorate: withLockedOne });

  return router;
}
