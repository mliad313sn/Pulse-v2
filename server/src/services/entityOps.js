/**
 * Shared entity create/patch logic used by both the REST routes and the
 * offline sync processor, so business rules live in exactly one place.
 */
import { randomUUID } from 'node:crypto';
import { notFound, validation, versionConflict } from '../errors.js';
import { assertCanAdvance } from './gates.js';
import { applyUpdate } from './occ.js';
import { ensureSecurityRouting } from './securityRouting.js';
import { nowIso } from './time.js';

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
    parentRef: 'projectId',
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
    parentRef: 'projectId',
    actorDefaults: { reportedBy: 'id' },
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

/** Keep only the fields `def` declares writable. Shared with the sync processor. */
export function pickWritable(def, payload) {
  const out = {};
  for (const key of def.writable) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

/** Throws 400 VALIDATION on any out-of-enum value. Shared with the sync processor. */
export function assertEnums(def, fields) {
  for (const [key, allowed] of Object.entries(def.enums)) {
    if (fields[key] !== undefined && fields[key] !== null && !allowed.includes(fields[key])) {
      throw validation(`Invalid value for ${key}: ${fields[key]}`, { field: key, allowed });
    }
  }
}

/**
 * Create a project/task/roadblock. Fills defaults, validates, writes, runs
 * security routing, and returns the created entity.
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

  if (def.parentRef) {
    const parent = await repo.get('project', fields[def.parentRef]);
    if (!parent) {
      throw validation(`Unknown ${def.parentRef}: ${fields[def.parentRef]}`, { field: def.parentRef });
    }
  }
  for (const [field, actorProp] of Object.entries(def.actorDefaults ?? {})) {
    if (fields[field] === undefined) fields[field] = actor?.[actorProp] ?? null;
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

  const written = await repo.insert(kind, row);
  await ensureSecurityRouting(repo, kind, written);
  // Security routing may bump the project's own gate/version, so projects need
  // a fresh read; tasks/roadblocks are returned exactly as written.
  return kind === 'project' ? repo.get(kind, written.id) : written;
}

/**
 * Direct (online) PATCH — strict OCC per contract invariant 1:
 * body must carry `version` (base version); mismatch -> 409 with serverState.
 * Task status transitions run the governance gates (423s).
 * Returns the updated entity.
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

  const { outcome, next } = applyUpdate(current, { baseVersion: body.version, fields }, { strict: true });
  if (outcome !== 'applied') {
    throw versionConflict(current);
  }

  await runTaskGates(repo, kind, current, fields);

  const written = await repo.update(kind, next);
  await ensureSecurityRouting(repo, kind, written);
  // See createEntity: only projects can be mutated again by security routing.
  return kind === 'project' ? repo.get(kind, id) : written;
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
