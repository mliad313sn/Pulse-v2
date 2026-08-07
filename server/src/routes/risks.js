import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, mountEntityCrud } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

/**
 * E11 — Risks (plan §28): future uncertainty, separate from roadblocks.
 *   GET  /api/risks (?projectId=)  — classification/enterprise-filtered
 *   POST /api/risks                — task-like involvement policy
 *   PATCH /api/risks/:id           — involvement OR the risk owner; OCC
 * inherentScore/residualScore are DERIVED (probability*impact) and never
 * writable. Risks are ONLINE-ONLY (not in the offline sync entity set —
 * ADR-007). Concealment matches tasks.
 */
export function risksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [risks, { projects, membersByProject }] = await Promise.all([
      repo.list('risk', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(risks.filter((r) => visible.has(r.projectId)));
  }));

  mountEntityCrud(router, 'risk');

  return router;
}
