import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, mountEntityCrud } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

/**
 * E08 core — Milestones.
 *   GET  /api/milestones (?projectId=)  — classification/enterprise-filtered
 *   POST /api/milestones                — manage-level authority on the project
 *   PATCH /api/milestones/:id           — manage-level OR the milestone owner; OCC
 * Concealment matches tasks: milestones of unreadable projects are absent from
 * lists and 404 on direct writes.
 */
export function milestonesRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [milestones, { projects, membersByProject }] = await Promise.all([
      repo.list('milestone', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(milestones.filter((m) => visible.has(m.projectId)));
  }));

  mountEntityCrud(router, 'milestone');

  return router;
}
