import { ApiError, forbidden, passwordChangeRequired } from '../errors.js';
import { resolveSession } from '../services/auth.js';

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Session auth (ADR-002): resolves cookie ppm_session or Authorization:
 * Bearer to req.user + req.session. Missing/unknown/expired -> 401
 * AUTH_REQUIRED. No header-based identity exists in production paths.
 */
export const authMiddleware = asyncHandler(async (req, res, next) => {
  const { user, session } = await resolveSession(req.app.locals.repo, req);
  req.user = user;
  req.session = session;
  next();
});

/**
 * While mustChangePassword=true every non-auth API call is refused
 * (403 PASSWORD_CHANGE_REQUIRED). The /api/auth/* routes are mounted before
 * this middleware, so me/change-password/logout keep working.
 */
export const requirePasswordChanged = (req, res, next) => {
  if (req.user?.mustChangePassword) return next(passwordChangeRequired());
  next();
};

/**
 * VIEWER is hard read-only at the API boundary: every mutating verb on every
 * business endpoint mounted behind this guard -> 403 FORBIDDEN.
 */
export const forbidViewerWrites = (req, res, next) => {
  const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (!isRead && req.user?.baseRole === 'VIEWER') {
    return next(forbidden('VIEWER accounts are read-only'));
  }
  next();
};

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
