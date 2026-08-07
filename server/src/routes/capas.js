import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, mountEntityCrud } from './helpers.js';
import { isAdmin, readableProjectIds } from '../services/policy.js';

/**
 * §29 — CAPA (Corrective and Preventive Action).
 *   GET  /api/capas (?projectId=)  — visibility-filtered
 *   POST /api/capas                — manage-level or self-owned
 *   PATCH /api/capas/:id           — owner/verifier/manage; OCC
 * Lifecycle OPEN -> ANALYSIS -> ACTION_PLANNED -> IMPLEMENTATION ->
 * VERIFICATION -> CLOSED is forward-only with NO skips; VERIFICATION needs
 * correctiveAction+preventiveAction, CLOSED needs verifierId+
 * effectivenessResult (verifiedAt is stamped server-side). CAPAs are
 * ONLINE-ONLY (not in the offline sync entity set — ADR-007).
 * Project-linked CAPAs follow project concealment; general ones (projectId
 * null) are visible to owner/verifier/ADMIN only.
 */
export function capasRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [capas, { projects, membersByProject }] = await Promise.all([
      repo.list('capa', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(capas.filter((c) => (c.projectId != null
      ? visible.has(c.projectId)
      : isAdmin(req.user) || c.ownerId === req.user.id || c.verifierId === req.user.id)));
  }));

  mountEntityCrud(router, 'capa');

  return router;
}
