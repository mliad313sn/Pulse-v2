import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { applyApprovalDecision } from '../services/securityRouting.js';
import { loadProjectAccess } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

export function approvalsRouter() {
  const router = Router();

  /** GET /api/approvals?status=pending — InfoSec queue. */
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.status ? { status: req.query.status } : {};
    const [approvals, { projects, membersByProject }] = await Promise.all([
      repo.list('approval', filter),
      loadProjectAccess(repo),
    ]);
    // ADR-005 + E01 enterprise access: approvals of concealed projects are
    // absent from the queue.
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(approvals.filter((a) => visible.has(a.projectId)));
  }));

  /** POST /api/approvals/:id/decision — security_reviewer privilege only. */
  router.post('/:id/decision', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const result = await repo.transaction(req.user.id, (tx) =>
      applyApprovalDecision(tx, req.user, req.params.id, req.body ?? {}),
    );
    res.json(result);
  }));

  return router;
}
