/**
 * Shared entity create/patch logic used by both the REST routes and the
 * offline sync processor, so business rules live in exactly one place.
 */
import { randomUUID } from 'node:crypto';
import { notFound, validation, versionConflict } from '../errors.js';
import { assertCanAdvance } from './gates.js';
import { ensureSecurityRouting } from './securityRouting.js';

const nowIso = () => new Date().toISOString();

export const ENTITY_DEFS = {
  project: {
    required: ['name', 'division'],
    writable: [
      'name', 'description', 'division', 'site', 'cgeitTag', 'strategicTag',
      'riskTags', 'overallStatus', 'ownerId',
    ],
    defaults: () => ({
      description: null,
      site: null,
      cgeitTag: 'value_delivery',
      strategicTag: null,
      riskTags: [],
      overallStatus: 'active',
      securityGateStatus: 'not_required',
      ownerId: null,
    }),
    enums: {
      cgeitTag: ['strategic_alignment', 'value_delivery', 'risk_optimization', 'resource_optimization', 'performance_measurement'],
      overallStatus: ['draft', 'active', 'at_risk', 'on_hold', 'complete'],
    },
  },
  task: {
    required: ['projectId', 'title'],
    writable: [
      'projectId', 'title', 'description', 'division', 'site', 'assigneeId',
      'status', 'priority', 'dependencyLock', 'riskTags', 'slaDueAt',
    ],
    defaults: () => ({
      description: null,
      division: null,
      site: null,
      assigneeId: null,
      status: 'todo',
      priority: 'normal',
      dependencyLock: null,
      riskTags: [],
      slaDueAt: null,
    }),
    enums: {
      status: ['todo', 'in_progress', 'blocked', 'done'],
      priority: ['low', 'normal', 'high', 'critical'],
    },
  },
  roadblock: {
    required: ['projectId', 'description'],
    writable: ['projectId', 'taskId', 'description', 'severity', 'status', 'reportedBy'],
    defaults: () => ({
      taskId: null,
      severity: 'medium',
      status: 'open',
      reportedBy: null,
    }),
    enums: {
      severity: ['low', 'medium', 'high', 'critical'],
      status: ['open', 'mitigating', 'resolved'],
    },
  },
};

function pickWritable(def, payload) {
  const out = {};
  for (const key of def.writable) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

function assertEnums(def, fields) {
  for (const [key, allowed] of Object.entries(def.enums)) {
    if (fields[key] !== undefined && fields[key] !== null && !allowed.includes(fields[key])) {
      throw validation(`Invalid value for ${key}: ${fields[key]}`, { field: key, allowed });
    }
  }
}

/**
 * Create a project/task/roadblock. Fills defaults, validates, writes, runs
 * security routing, and returns a fresh read of the created entity.
 * options.id lets the sync processor honour client-generated UUIDs.
 */
export async function createEntity(repo, actor, kind, payload, options = {}) {
  const def = ENTITY_DEFS[kind];
  if (!def) throw validation(`Unknown entity kind: ${kind}`);

  const fields = pickWritable(def, payload ?? {});
  for (const key of def.required) {
    if (fields[key] === undefined || fields[key] === null || fields[key] === '') {
      throw validation(`Missing required field: ${key}`, { field: key });
    }
  }
  assertEnums(def, fields);

  if (kind === 'task' || kind === 'roadblock') {
    const project = await repo.get('project', fields.projectId);
    if (!project) throw validation(`Unknown projectId: ${fields.projectId}`, { field: 'projectId' });
  }
  if (kind === 'roadblock' && fields.reportedBy === undefined) {
    fields.reportedBy = actor?.id ?? null;
  }

  const ts = nowIso();
  const row = {
    id: options.id ?? randomUUID(),
    ...def.defaults(),
    ...fields,
    version: 1,
    updatedAt: ts,
    createdAt: ts,
  };

  await repo.insert(kind, row);
  await ensureSecurityRouting(repo, kind, row);
  return repo.get(kind, row.id);
}

/**
 * Direct (online) PATCH — strict OCC per contract invariant 1:
 * body must carry `version` (base version); mismatch -> 409 with serverState.
 * Task status transitions run the governance gates (423s).
 * Returns a fresh read of the updated entity.
 */
export async function patchEntity(repo, actor, kind, id, body) {
  const def = ENTITY_DEFS[kind];
  if (!def) throw validation(`Unknown entity kind: ${kind}`);

  const current = await repo.get(kind, id);
  if (!current) throw notFound(`${kind} ${id} not found`);

  if (typeof body?.version !== 'number' || !Number.isInteger(body.version)) {
    throw validation('Body must include the integer base `version` for OCC');
  }

  const fields = pickWritable(def, body);
  assertEnums(def, fields);
  if (Object.keys(fields).length === 0) {
    throw validation('No writable fields in payload');
  }

  if (body.version !== current.version) {
    throw versionConflict(current);
  }

  await runTaskGates(repo, kind, current, fields);

  const next = { ...current, ...fields, version: current.version + 1, updatedAt: nowIso() };
  await repo.update(kind, next);
  await ensureSecurityRouting(repo, kind, next);
  return repo.get(kind, id);
}

/** Gate checks shared by PATCH and sync updates. Throws 423 typed errors. */
export async function runTaskGates(repo, kind, current, fields) {
  if (kind !== 'task') return;
  const newStatus = fields.status;
  if (!newStatus || newStatus === current.status) return;
  const tasksById = {};
  if (current.dependencyLock) {
    tasksById[current.dependencyLock] = await repo.get('task', current.dependencyLock);
  }
  const project = await repo.get('project', current.projectId);
  assertCanAdvance(current, newStatus, tasksById, project);
}
