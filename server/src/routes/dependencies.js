import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';
import { createDependency, deleteDependency } from '../services/dependencies.js';

/** Contract wire shape for a TaskDependency row. */
export const dependencyWire = (d) => ({
  id: d.id,
  projectId: d.projectId,
  predecessorId: d.predecessorId,
  successorId: d.successorId,
  type: d.type,
  lagDays: d.lagDays,
  createdAt: d.createdAt,
});

/**
 * E07 core — Typed task dependencies (plan §20).
 *   GET    /api/dependencies (?projectId=) — classification/enterprise-filtered
 *   POST   /api/dependencies {predecessorId, successorId, type?, lagDays?}
 *   DELETE /api/dependencies/:id
 * Writes require manage-level authority (canManageProjectWork). Immutable
 * rows: change an edge by delete + re-create (both audited).
 */
export function dependenciesRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [dependencies, { projects, membersByProject }] = await Promise.all([
      repo.list('dependency', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(dependencies.filter((d) => visible.has(d.projectId)).map(dependencyWire));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const created = await repo.transaction(req.user.id, (tx) =>
      createDependency(tx, req.user, req.body ?? {}));
    res.status(201).json(dependencyWire(created));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    await repo.transaction(req.user.id, (tx) =>
      deleteDependency(tx, req.user, req.params.id));
    res.status(204).end();
  }));

  return router;
}
