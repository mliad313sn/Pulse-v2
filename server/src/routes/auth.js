/**
 * Auth endpoints (E02). Mounted BEFORE the session middleware; the routes
 * that need an authenticated caller apply it individually so login and the
 * SSO flow stay public, and me/change-password/logout keep working while
 * mustChangePassword=true.
 *
 * Passwords and tokens are never logged nor audited; audit events carry
 * ids/metadata only.
 */
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler, authMiddleware } from './middleware.js';
import {
  SESSION_COOKIE, auditAuthEvent, assertPasswordPolicy, createRateLimiter,
  createSession, hashPassword, login, publicUser, resolveSession, sessionTtlHours,
  verifyPassword,
} from '../services/auth.js';
import { accountDisabled, notConfigured, rateLimited, validation } from '../errors.js';
import { nowIso } from '../services/time.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlHours() * 3600_000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function authRouter({ authProvider } = {}) {
  const router = Router();
  // Login rate limit: 10/min per IP+email key. In-memory, per instance —
  // production multi-instance deployments must back this with Redis.
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });
  const pendingStates = new Map(); // SSO CSRF states: state -> issuedAt

  // ---- local login ---------------------------------------------------------
  router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    const key = `${req.ip}|${String(email ?? '').trim().toLowerCase()}`;
    if (!loginLimiter.allow(key)) throw rateLimited();

    const repo = req.app.locals.repo;
    const { user, token } = await login(repo, email, password);
    setSessionCookie(res, token);
    res.json({ user: publicUser(user), mustChangePassword: user.mustChangePassword === true });
  }));

  // ---- logout (best-effort: always clears the cookie, 204) -----------------
  router.post('/logout', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    try {
      const { user, session } = await resolveSession(repo, req);
      await repo.deleteSession(session.id);
      await auditAuthEvent(repo, { action: 'LOGOUT', userId: user.id });
    } catch {
      // no valid session — logout is idempotent
    }
    clearSessionCookie(res);
    res.status(204).end();
  }));

  // ---- current identity ----------------------------------------------------
  router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  }));

  // ---- change password -----------------------------------------------------
  router.post('/change-password', authMiddleware, asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { currentPassword, newPassword } = req.body ?? {};
    const cred = await repo.getCredential(req.user.id);
    const ok = cred && typeof currentPassword === 'string'
      && await verifyPassword(currentPassword, cred.passwordHash);
    if (!ok) throw validation('Current password is incorrect');
    assertPasswordPolicy(newPassword);

    await repo.upsertCredential({
      ...cred,
      passwordHash: await hashPassword(newPassword),
      failedCount: 0,
      firstFailedAt: null,
      lockedUntil: null,
      updatedAt: nowIso(),
    });
    if (req.user.mustChangePassword) {
      await repo.updateUser({ ...req.user, mustChangePassword: false });
    }
    // Revoke every OTHER session of this user (current one stays valid).
    await repo.deleteUserSessions(req.user.id, { exceptId: req.session.id });
    await auditAuthEvent(repo, { action: 'PASSWORD_CHANGE', userId: req.user.id });
    res.status(204).end();
  }));

  // ---- revoke every session (incl. the current one) ------------------------
  router.post('/revoke-all', authMiddleware, asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    await repo.deleteUserSessions(req.user.id);
    await auditAuthEvent(repo, { action: 'SESSIONS_REVOKED', userId: req.user.id });
    clearSessionCookie(res);
    res.status(204).end();
  }));

  // ---- Entra ID SSO (auth-code flow; BLOCKED_EXTERNAL without a tenant) ----
  router.get('/entra/login', asyncHandler(async (req, res) => {
    if (!authProvider?.configured) {
      throw notConfigured('Entra ID SSO is not configured (set AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI)');
    }
    const state = randomBytes(16).toString('base64url');
    pendingStates.set(state, Date.now());
    res.redirect(302, authProvider.getAuthorizationUrl(state));
  }));

  router.get('/entra/callback', asyncHandler(async (req, res) => {
    if (!authProvider?.configured) {
      throw notConfigured('Entra ID SSO is not configured');
    }
    const { code, state } = req.query;
    const issuedAt = pendingStates.get(state);
    pendingStates.delete(state);
    // purge stale states opportunistically
    for (const [s, t] of pendingStates) if (Date.now() - t > STATE_TTL_MS) pendingStates.delete(s);
    if (!issuedAt || Date.now() - issuedAt > STATE_TTL_MS) {
      throw validation('Invalid or expired SSO state');
    }
    if (typeof code !== 'string' || !code) throw validation('Missing authorization code');

    const external = await authProvider.exchangeCodeForUser(code);
    const repo = req.app.locals.repo;
    const user = external.email ? await repo.getUserByEmail(external.email) : null;
    // SSO identities without a provisioned local account are treated as
    // disabled accounts (no auto-provisioning in this slice).
    if (!user || user.isActive === false) throw accountDisabled();

    const { token } = await createSession(repo, user.id);
    await auditAuthEvent(repo, {
      action: 'LOGIN',
      userId: user.id,
      detail: { provider: authProvider.name, externalId: external.externalId },
    });
    setSessionCookie(res, token);
    res.redirect(302, '/');
  }));

  return router;
}
