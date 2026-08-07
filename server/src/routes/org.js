/**
 * E01 — Org structure administration.
 *   GET  /api/sites, /api/divisions        — any authenticated user
 *   POST/PATCH                              — ADMIN only
 *   GET  /api/org/tree                      — sites + divisions with per-division user counts
 * Codes are immutable once referenced by users/projects/tasks; name and
 * description stay editable.
 */
import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { assertCan } from '../services/policy.js';
import { notFound, validation } from '../errors.js';

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function assertCodeName({ code, name }, { requireCode = true, requireName = true } = {}) {
  if (requireCode && (typeof code !== 'string' || !CODE_RE.test(code))) {
    throw validation('code must be a short lowercase slug (a-z, 0-9, -, _)', { field: 'code' });
  }
  if (requireName && (typeof name !== 'string' || !name.trim())) {
    throw validation('name is required', { field: 'name' });
  }
}

/** Whether any user/project/task references the given site or division code. */
async function isReferenced(repo, kind, code) {
  const [users, projects, tasks] = await Promise.all([
    repo.listUsers(), repo.list('project'), repo.list('task'),
  ]);
  if (kind === 'site') {
    return users.some((u) => u.site === code)
      || projects.some((p) => p.site === code || (p.sites ?? []).includes(code))
      || tasks.some((t) => t.site === code);
  }
  return users.some((u) => u.division === code)
    || projects.some((p) => p.division === code || (p.engagedDivisions ?? []).includes(code))
    || tasks.some((t) => t.division === code);
}

/** Shared GET/POST/PATCH factory for the two reference collections. */
function refRouter(kind, { list, insert, update }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await list(req.app.locals.repo));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    assertCan(req.user, 'org:manage');
    const repo = req.app.locals.repo;
    const { code, name, description = null } = req.body ?? {};
    assertCodeName({ code, name });
    if ((await list(repo)).some((r) => r.code === code)) {
      throw validation(`A ${kind} with code '${code}' already exists`, { field: 'code' });
    }
    const created = await repo.transaction(req.user.id, (tx) =>
      insert(tx, { code, name: name.trim(), description }));
    res.status(201).json(created);
  }));

  router.patch('/:code', asyncHandler(async (req, res) => {
    assertCan(req.user, 'org:manage');
    const repo = req.app.locals.repo;
    const body = req.body ?? {};
    const rows = await list(repo);
    const current = rows.find((r) => r.code === req.params.code);
    if (!current) throw notFound(`${kind} ${req.params.code} not found`);

    const next = { ...current };
    if (body.code !== undefined && body.code !== current.code) {
      assertCodeName(body, { requireName: false });
      if (rows.some((r) => r.code === body.code)) {
        throw validation(`A ${kind} with code '${body.code}' already exists`, { field: 'code' });
      }
      // Code is immutable once referenced (FK backstop in Postgres).
      if (await isReferenced(repo, kind, current.code)) {
        throw validation(`${kind} code '${current.code}' is referenced and cannot be renamed`, { field: 'code' });
      }
      next.code = body.code;
    }
    if (body.name !== undefined) {
      assertCodeName(body, { requireCode: false });
      next.name = body.name.trim();
    }
    if (body.description !== undefined) next.description = body.description;

    const updated = await repo.transaction(req.user.id, (tx) =>
      update(tx, current.code, next));
    res.json(updated);
  }));

  return router;
}

export const sitesRouter = () => refRouter('site', {
  list: (repo) => repo.listSites(),
  insert: (repo, row) => repo.insertSite(row),
  update: (repo, code, row) => repo.updateSite(code, row),
});

export const divisionsRouter = () => refRouter('division', {
  list: (repo) => repo.listDivisions(),
  insert: (repo, row) => repo.insertDivision(row),
  update: (repo, code, row) => repo.updateDivision(code, row),
});

/** GET /api/org/tree — Admin Center overview. */
export function orgRouter() {
  const router = Router();
  router.get('/tree', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const [sites, divisions, users] = await Promise.all([
      repo.listSites(), repo.listDivisions(), repo.listUsers(),
    ]);
    const counts = new Map();
    for (const u of users) counts.set(u.division, (counts.get(u.division) ?? 0) + 1);
    res.json({
      sites,
      divisions: divisions.map((d) => ({ ...d, userCount: counts.get(d.code) ?? 0 })),
    });
  }));
  return router;
}
