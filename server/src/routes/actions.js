import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, mountEntityCrud } from './helpers.js';
import { isAdmin, readableProjectIds } from '../services/policy.js';

/**
 * E09 core — Actions (plan §19): lightweight accountability items.
 *   GET  /api/actions (?projectId= | ?mine=1) — visibility-filtered
 *   POST /api/actions                         — see write policy below
 *   PATCH /api/actions/:id                    — owner/creator/manage; OCC
 *
 * Visibility: project-linked actions follow the project's classification +
 * enterprise-access concealment exactly like tasks; GENERAL actions
 * (projectId null) are visible ONLY to their owner, their creator, and ADMIN.
 * Status semantics: OPEN | DONE | CANCELLED — CANCELLED never counts as
 * completed anywhere (it is excluded from BOTH the open and the done side of
 * every count: RAG overdueWork, deck openActionCount, "My Work").
 */
export function actionsRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [actions, { projects, membersByProject }] = await Promise.all([
      repo.list('action', filter), loadProjectAccess(repo),
    ]);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    let scoped = actions.filter((a) => (a.projectId != null
      ? visible.has(a.projectId)
      : isAdmin(req.user) || a.ownerId === req.user.id || a.createdBy === req.user.id));
    // ?mine=1 — the "My Work" slice: actions the caller owns.
    if (req.query.mine === '1' || req.query.mine === 'true') {
      scoped = scoped.filter((a) => a.ownerId === req.user.id);
    }
    res.json(scoped);
  }));

  mountEntityCrud(router, 'action');

  return router;
}
