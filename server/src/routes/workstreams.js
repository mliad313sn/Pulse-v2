import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, mountEntityCrud } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

/**
 * E07 core — Workstreams (plan §17).
 *   GET  /api/workstreams (?projectId=)  — classification/enterprise-filtered
 *   POST /api/workstreams                — manage-level authority on the project
 *   PATCH /api/workstreams/:id           — manage-level OR the workstream lead; OCC
 * Concealment matches milestones: workstreams of unreadable projects are
 * absent from lists and 404 on direct writes.
 */
export function workstreamsRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [workstreams, { projects, membersByProject }] = await Promise.all([
      repo.list('workstream', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(workstreams.filter((w) => visible.has(w.projectId)));
  }));

  mountEntityCrud(router, 'workstream');

  return router;
}
