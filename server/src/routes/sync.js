import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { processSyncBatch, recordSyncDiscard } from '../services/syncProcessor.js';

/** POST /api/sync — offline batch upload (ordered command log, halt-on-first-failure). */
export function syncRouter() {
  const router = Router();
  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    res.json(await processSyncBatch(repo, req.user, req.body));
  }));
  // POST /api/sync/discard — explicit, audited server-side record of a human
  // discarding a queued offline op (plan §57). 204 on success.
  router.post('/discard', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    await recordSyncDiscard(repo, req.user, req.body);
    res.status(204).end();
  }));
  return router;
}
