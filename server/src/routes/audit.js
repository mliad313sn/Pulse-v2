import { Router } from 'express';
import { asyncHandler } from './middleware.js';

/** GET /api/audit?entityId= — read-only audit trail. */
export function auditRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.entityId) filter.entityId = req.query.entityId;
    if (req.query.entityType) filter.entityType = req.query.entityType;
    res.json(await req.app.locals.repo.listAudit(filter));
  }));
  return router;
}
