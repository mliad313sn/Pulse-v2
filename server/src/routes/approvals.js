import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { applyApprovalDecision } from '../services/securityRouting.js';

export function approvalsRouter() {
  const router = Router();

  /** GET /api/approvals?status=pending — InfoSec queue. */
  router.get('/', asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    res.json(await req.app.locals.repo.list('approval', filter));
  }));

  /** POST /api/approvals/:id/decision — security_reviewer only. */
  router.post('/:id/decision', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const result = await repo.transaction(req.user.id, (tx) =>
      applyApprovalDecision(tx, req.user, req.params.id, req.body ?? {}),
    );
    res.json(result);
  }));

  return router;
}
