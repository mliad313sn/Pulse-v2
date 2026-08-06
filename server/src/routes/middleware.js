import { ApiError, unauthenticated } from '../errors.js';

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Resolves x-user-id -> req.user, else 401 UNAUTHENTICATED. */
export const authMiddleware = asyncHandler(async (req, res, next) => {
  const userId = req.get('x-user-id');
  if (!userId) throw unauthenticated();
  const user = await req.app.locals.repo.getUser(userId);
  if (!user) throw unauthenticated();
  req.user = user;
  next();
});

/** Maps typed errors to the contract envelope { error, message, detail }. */
// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, next) {
  if (err instanceof ApiError) {
    const body = { error: err.code, message: err.message };
    if (err.detail !== undefined) body.detail = err.detail;
    res.status(err.status).json(body);
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'VALIDATION', message: 'Malformed JSON body' });
    return;
  }
  console.error('[opspm360] unhandled error:', err);
  res.status(500).json({ error: 'INTERNAL', message: 'Unexpected server error' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}
