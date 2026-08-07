/**
 * Local authentication service (E02): bcrypt credentials, opaque session
 * tokens (SHA-256 at rest), failure lockout and login rate limiting.
 *
 * Security invariants:
 *   - Passwords and session tokens are NEVER logged or written to the audit
 *     ledger; audit events carry ids/metadata only.
 *   - Login failure is uniform (401 AUTH_FAILED) for unknown email and wrong
 *     password — no account enumeration. A dummy bcrypt compare runs for
 *     unknown emails to level response timing.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  accountDisabled, accountLocked, authFailed, authRequired, validation,
} from '../errors.js';
import { nowIso } from './time.js';

export const SESSION_COOKIE = 'ppm_session';
const BCRYPT_COST = 10;
// Hash of an unguessable throwaway value — only used to equalize timing.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);

export const sessionTtlHours = () => Number(process.env.SESSION_TTL_HOURS ?? 72);
export const passwordMinLength = () => Number(process.env.PASSWORD_MIN_LENGTH ?? 10);

// Lockout policy: 5 failures within 15 minutes -> locked for 15 minutes.
const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash ?? DUMMY_HASH);

export const hashToken = (token) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** ~16-char base64url temporary password (satisfies the min-length policy). */
export const generateTemporaryPassword = () => randomBytes(12).toString('base64url');

/** Public (wire) view of a user — never includes credential material. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    division: user.division,
    site: user.site,
    baseRole: user.baseRole,
    privileges: user.privileges ?? [],
    isActive: user.isActive !== false,
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt,
  };
}

/**
 * In-memory sliding-window rate limiter (per app instance).
 * NOTE: per-process only — for a multi-instance production deployment this
 * must be backed by a shared store (e.g. Redis) instead.
 */
export function createRateLimiter({ max = 10, windowMs = 60_000 } = {}) {
  const buckets = new Map(); // key -> [timestamps]
  return {
    allow(key) {
      const now = Date.now();
      const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      if (hits.length >= max) {
        buckets.set(key, hits);
        return false;
      }
      hits.push(now);
      buckets.set(key, hits);
      return true;
    },
  };
}

/** Creates a session row + client token. Returns { token, session }. */
export async function createSession(repo, userId) {
  const token = randomBytes(32).toString('base64url'); // 32 random bytes, base64url
  const now = new Date();
  const session = await repo.insertSession({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlHours() * 3600_000).toISOString(),
    lastSeenAt: now.toISOString(),
  });
  return { token, session };
}

/** Extracts the session token from cookie ppm_session or Authorization: Bearer. */
export function extractToken(req) {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const cookieHeader = req.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/**
 * Resolves a request's token to { user, session }.
 * Throws 401 AUTH_REQUIRED for missing/unknown/expired tokens (expired
 * sessions are reaped) and for sessions of deactivated users.
 */
export async function resolveSession(repo, req) {
  const token = extractToken(req);
  if (!token) throw authRequired();
  const session = await repo.getSessionByTokenHash(hashToken(token));
  if (!session) throw authRequired();
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await repo.deleteSession(session.id);
    throw authRequired();
  }
  const user = await repo.getUser(session.userId);
  if (!user || user.isActive === false) {
    await repo.deleteSession(session.id);
    throw authRequired();
  }
  await repo.touchSession(session.id, nowIso());
  return { user, session };
}

/** Audit an auth-lifecycle event (never any secret material). */
export function auditAuthEvent(repo, { action, userId, actorId = userId, detail = null }) {
  return repo.appendAudit({
    entityType: 'auth',
    entityId: userId ?? null,
    action,
    actorId: actorId ?? null,
    newData: detail,
  });
}

/**
 * Full login flow (rate limiting is handled by the route, which owns the
 * per-IP key). Returns { user, session, token } on success; throws the
 * contract's typed errors otherwise.
 */
export async function login(repo, email, password) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw validation('email and password are required');
  }
  const user = await repo.getUserByEmail(email.trim().toLowerCase());
  const cred = user ? await repo.getCredential(user.id) : null;
  if (!user || !cred) {
    await verifyPassword(password, null); // timing-leveling dummy compare
    throw authFailed();
  }
  if (user.isActive === false) throw accountDisabled();

  const now = Date.now();
  if (cred.lockedUntil && new Date(cred.lockedUntil).getTime() > now) {
    throw accountLocked(Math.ceil((new Date(cred.lockedUntil).getTime() - now) / 1000));
  }

  const ok = await verifyPassword(password, cred.passwordHash);
  if (!ok) {
    const windowStart = cred.firstFailedAt ? new Date(cred.firstFailedAt).getTime() : 0;
    const inWindow = now - windowStart < LOCKOUT_WINDOW_MS;
    const failedCount = (inWindow ? cred.failedCount : 0) + 1;
    const firstFailedAt = inWindow && cred.firstFailedAt ? cred.firstFailedAt : new Date(now).toISOString();
    const locked = failedCount >= LOCKOUT_MAX_FAILURES;
    await repo.upsertCredential({
      ...cred,
      failedCount,
      firstFailedAt,
      lockedUntil: locked ? new Date(now + LOCKOUT_DURATION_MS).toISOString() : null,
      updatedAt: nowIso(),
    });
    if (locked) {
      await auditAuthEvent(repo, { action: 'LOCKOUT', userId: user.id, detail: { failedCount } });
      throw accountLocked(Math.ceil(LOCKOUT_DURATION_MS / 1000));
    }
    throw authFailed();
  }

  // Success — clear any failure tracking.
  if (cred.failedCount || cred.lockedUntil || cred.firstFailedAt) {
    await repo.upsertCredential({
      ...cred, failedCount: 0, firstFailedAt: null, lockedUntil: null, updatedAt: nowIso(),
    });
  }
  const { token, session } = await createSession(repo, user.id);
  await auditAuthEvent(repo, { action: 'LOGIN', userId: user.id });
  return { user, session, token };
}

/** Validates a candidate new password against policy; throws 400 VALIDATION. */
export function assertPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < passwordMinLength()) {
    throw validation(`Password must be at least ${passwordMinLength()} characters`);
  }
}
