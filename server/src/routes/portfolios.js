/**
 * E04 — Portfolio foundations: strategic pillars, portfolios, programs.
 *   GET (list) — any authenticated user.
 *   POST/PATCH — pillars: ADMIN; portfolios/programs: ADMIN or DIVISION_LEAD.
 *   No DELETE (structures are referenced by projects; archival comes later).
 * These are admin-managed reference structures, not collaborative core
 * objects: PATCH is partial (no OCC version), every mutation is audited.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { assertCan } from '../services/policy.js';
import { notFound, validation } from '../errors.js';
import { nowIso } from '../services/time.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFS = {
  pillar: {
    action: 'org:manage',
    required: ['name'],
    writable: ['name', 'description'],
    label: 'StrategicPillar',
  },
  portfolio: {
    action: 'portfolio:manage',
    required: ['title'],
    writable: ['title', 'description', 'pillarId', 'ownerId', 'dateFrom', 'dateTo'],
    label: 'Portfolio',
  },
  program: {
    action: 'portfolio:manage',
    required: ['title', 'portfolioId'],
    writable: ['title', 'objective', 'portfolioId', 'ownerId'],
    label: 'Program',
  },
};

async function validateRefs(repo, kind, fields) {
  if (kind === 'portfolio') {
    if (fields.pillarId != null && !(await repo.get('pillar', fields.pillarId))) {
      throw validation(`Unknown pillarId: ${fields.pillarId}`, { field: 'pillarId' });
    }
    for (const f of ['dateFrom', 'dateTo']) {
      if (fields[f] != null && (typeof fields[f] !== 'string' || !ISO_DATE_RE.test(fields[f]))) {
        throw validation(`${f} must be an ISO date (YYYY-MM-DD)`, { field: f });
      }
    }
  }
  if (kind === 'program' && fields.portfolioId != null
      && !(await repo.get('portfolio', fields.portfolioId))) {
    throw validation(`Unknown portfolioId: ${fields.portfolioId}`, { field: 'portfolioId' });
  }
  if (fields.ownerId != null && !(await repo.getUser(fields.ownerId))) {
    throw validation(`Unknown ownerId: ${fields.ownerId}`, { field: 'ownerId' });
  }
}

function structureRouter(kind) {
  const def = DEFS[kind];
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const filter = kind === 'program' && req.query.portfolioId
      ? { portfolioId: req.query.portfolioId }
      : {};
    res.json(await req.app.locals.repo.list(kind, filter));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await req.app.locals.repo.get(kind, req.params.id);
    if (!row) throw notFound(`${def.label} ${req.params.id} not found`);
    res.json(row);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    assertCan(req.user, def.action);
    const repo = req.app.locals.repo;
    const body = req.body ?? {};
    const fields = {};
    for (const key of def.writable) {
      if (body[key] !== undefined) fields[key] = body[key];
    }
    for (const key of def.required) {
      if (typeof fields[key] !== 'string' || !fields[key].trim()) {
        throw validation(`Missing required field: ${key}`, { field: key });
      }
    }
    await validateRefs(repo, kind, fields);
    const ts = nowIso();
    const row = {
      id: randomUUID(),
      // nullable optional fields default to null so the wire shape is stable
      ...Object.fromEntries(def.writable.map((k) => [k, null])),
      ...fields,
      createdAt: ts,
      updatedAt: ts,
    };
    const created = await repo.transaction(req.user.id, (tx) => tx.insert(kind, row));
    res.status(201).json(created);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    assertCan(req.user, def.action);
    const repo = req.app.locals.repo;
    const body = req.body ?? {};
    const updated = await repo.transaction(req.user.id, async (tx) => {
      const current = await tx.get(kind, req.params.id);
      if (!current) throw notFound(`${def.label} ${req.params.id} not found`);
      const fields = {};
      for (const key of def.writable) {
        if (body[key] !== undefined) fields[key] = body[key];
      }
      if (Object.keys(fields).length === 0) throw validation('No writable fields in payload');
      for (const key of def.required) {
        if (fields[key] !== undefined && (typeof fields[key] !== 'string' || !fields[key].trim())) {
          throw validation(`${key} cannot be emptied`, { field: key });
        }
      }
      await validateRefs(tx, kind, fields);
      return tx.update(kind, { ...current, ...fields, updatedAt: nowIso() });
    });
    res.json(updated);
  }));

  return router;
}

export const pillarsRouter = () => structureRouter('pillar');
export const portfoliosRouter = () => structureRouter('portfolio');
export const programsRouter = () => structureRouter('program');
