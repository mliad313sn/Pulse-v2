import { Router } from 'express';
import { asyncHandler } from './middleware.js';

/** GET /api/users — demo user directory (public: powers the role switcher). */
export function usersRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    res.json(await req.app.locals.repo.listUsers());
  }));
  return router;
}
