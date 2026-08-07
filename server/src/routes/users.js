/**
 * Admin user management (E02/E03) — ADMIN base role only, else 403.
 * Temporary passwords are returned exactly once in the HTTP response and are
 * never logged nor written to the audit ledger.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { assertCan, BASE_ROLES, PRIVILEGES } from '../services/policy.js';
import {
  auditAuthEvent, generateTemporaryPassword, hashPassword, publicUser,
} from '../services/auth.js';
import { notFound, validation } from '../errors.js';
import { nowIso } from '../services/time.js';

function assertBaseRole(baseRole) {
  if (!BASE_ROLES.includes(baseRole)) {
    throw validation(`baseRole must be one of ${BASE_ROLES.join(', ')}`, { field: 'baseRole', allowed: BASE_ROLES });
  }
}

function assertPrivileges(privileges) {
  if (!Array.isArray(privileges) || privileges.some((p) => !PRIVILEGES.includes(p))) {
    throw validation(`privileges must be an array drawn from ${PRIVILEGES.join(', ')}`, { field: 'privileges', allowed: PRIVILEGES });
  }
}

async function loadUserOr404(repo, id) {
  const user = await repo.getUser(id);
  if (!user) throw notFound(`user ${id} not found`);
  return user;
}

export function usersRouter() {
  const router = Router();

  // Every user-management endpoint is ADMIN-only.
  router.use((req, res, next) => {
    try {
      assertCan(req.user, 'user:manage');
      next();
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/users — full directory incl. baseRole, privileges, isActive. */
  router.get('/', asyncHandler(async (req, res) => {
    const users = await req.app.locals.repo.listUsers();
    res.json(users.map(publicUser));
  }));

  /** POST /api/users — create with a generated temporary password. */
  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { name, email, division, site = null, baseRole, privileges = [] } = req.body ?? {};
    for (const [field, value] of Object.entries({ name, email, division, baseRole })) {
      if (typeof value !== 'string' || !value.trim()) {
        throw validation(`Missing required field: ${field}`, { field });
      }
    }
    assertBaseRole(baseRole);
    assertPrivileges(privileges);
    const divisions = await repo.listDivisions();
    if (!divisions.some((d) => d.code === division)) {
      throw validation(`Unknown division: ${division}`, { field: 'division' });
    }
    if (await repo.getUserByEmail(email.trim().toLowerCase())) {
      throw validation('A user with this email already exists', { field: 'email' });
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = {
      id: randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      division,
      site,
      baseRole,
      privileges,
      isActive: true,
      mustChangePassword: true, // forced change on first login
      createdAt: nowIso(),
    };
    const created = await repo.transaction(req.user.id, async (tx) => {
      const row = await tx.insertUser(user);
      await tx.upsertCredential({
        userId: user.id,
        passwordHash: await hashPassword(temporaryPassword),
        failedCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
        updatedAt: nowIso(),
      });
      await auditAuthEvent(tx, { action: 'USER_CREATED', userId: user.id, actorId: req.user.id });
      return row;
    });
    res.status(201).json({ user: publicUser(created), temporaryPassword });
  }));

  /** PATCH /api/users/:id — role/privileges/activation/org fields. */
  router.patch('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const body = req.body ?? {};
    const updated = await repo.transaction(req.user.id, async (tx) => {
      const user = await loadUserOr404(tx, req.params.id);
      const next = { ...user };
      if (body.baseRole !== undefined) {
        assertBaseRole(body.baseRole);
        next.baseRole = body.baseRole;
      }
      if (body.privileges !== undefined) {
        assertPrivileges(body.privileges);
        next.privileges = body.privileges;
      }
      if (body.division !== undefined) {
        const divisions = await tx.listDivisions();
        if (!divisions.some((d) => d.code === body.division)) {
          throw validation(`Unknown division: ${body.division}`, { field: 'division' });
        }
        next.division = body.division;
      }
      if (body.site !== undefined) next.site = body.site;
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') throw validation('isActive must be a boolean', { field: 'isActive' });
        next.isActive = body.isActive;
      }
      if (body.enterpriseAccess !== undefined) {
        // E01/plan §8.2: FALSE narrows every read to own-site or membered projects.
        if (typeof body.enterpriseAccess !== 'boolean') {
          throw validation('enterpriseAccess must be a boolean', { field: 'enterpriseAccess' });
        }
        next.enterpriseAccess = body.enterpriseAccess;
      }

      const row = await tx.updateUser(next);
      if (body.baseRole !== undefined && body.baseRole !== user.baseRole) {
        await auditAuthEvent(tx, {
          action: 'ROLE_CHANGE', userId: user.id, actorId: req.user.id,
          detail: { from: user.baseRole, to: body.baseRole },
        });
      }
      if (body.isActive === false && user.isActive !== false) {
        // Deactivation revokes every session immediately.
        await tx.deleteUserSessions(user.id);
        await auditAuthEvent(tx, { action: 'DEACTIVATED', userId: user.id, actorId: req.user.id });
      }
      return row;
    });
    res.json({ user: publicUser(updated) });
  }));

  /** POST /api/users/:id/reset-password — new temp password, revokes sessions. */
  router.post('/:id/reset-password', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const temporaryPassword = generateTemporaryPassword();
    await repo.transaction(req.user.id, async (tx) => {
      const user = await loadUserOr404(tx, req.params.id);
      await tx.upsertCredential({
        userId: user.id,
        passwordHash: await hashPassword(temporaryPassword),
        failedCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
        updatedAt: nowIso(),
      });
      await tx.updateUser({ ...user, mustChangePassword: true });
      await tx.deleteUserSessions(user.id);
      // Audited WITHOUT the password (never logged/audited in plaintext).
      await auditAuthEvent(tx, { action: 'PASSWORD_RESET', userId: user.id, actorId: req.user.id });
    });
    res.json({ temporaryPassword });
  }));

  /** POST /api/users/:id/unlock — clears the failure lockout. */
  router.post('/:id/unlock', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    await repo.transaction(req.user.id, async (tx) => {
      const user = await loadUserOr404(tx, req.params.id);
      const cred = await tx.getCredential(user.id);
      if (cred) {
        await tx.upsertCredential({
          ...cred, failedCount: 0, firstFailedAt: null, lockedUntil: null, updatedAt: nowIso(),
        });
      }
      await auditAuthEvent(tx, { action: 'UNLOCK', userId: user.id, actorId: req.user.id });
    });
    res.status(204).end();
  }));

  return router;
}
