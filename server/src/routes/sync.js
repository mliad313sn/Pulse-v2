import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { processSyncBatch } from '../services/syncProcessor.js';

/** POST /api/sync — offline batch upload. */
export function syncRouter() {
  const router = Router();
  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    res.json(await processSyncBatch(repo, req.user, req.body));
  }));
  return router;
}
