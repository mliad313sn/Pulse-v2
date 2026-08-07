/**
 * Shared entity create/patch logic used by both the REST routes and the
 * offline sync processor, so business rules live in exactly one place.
 *
 * E04 additions:
 *   - project codes PRJ-YYYY-NNN: server-generated inside the create
 *     transaction via the concurrency-safe per-year sequence
 *     (repo.nextProjectCodeSeq -> project_code_sequences w/ SELECT..FOR UPDATE
 *     on Postgres); immutable afterwards (PATCH attempts -> 400 VALIDATION).
 *   - lifecycleStage single-step guard (gate engine proper lands in E05).
 *   - membership-based write policy (canWriteTask/canWriteRoadblock/
 *     canManageProjectWork) replacing the v1 any-writer-writes-anything model.
 */
import { randomUUID } from 'node:crypto';
import { forbidden, notFound, validation, versionConflict } from '../errors.js';
import { assertCanAdvance, assertLifecycleStep, LIFECYCLE_STAGES } from './gates.js';
import { applyUpdate } from './occ.js';
import {
  CLASSIFICATIONS, canManageProjectWork, canReadProject, canSetClassification,
  canWriteRoadblock, canWriteTask,
} from './policy.js';
import { ensureSecurityRouting } from './securityRouting.js';
import { nowIso } from './time.js';

export const OPERATING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

export const ENTITY_DEFS = {
  project: {
    required: ['name', 'division'],
    writable: [
      'name', 'description', 'division', 'site', 'cgeitTag', 'strategicTag',
      'riskTags', 'classification', 'overallStatus', 'ownerId',
      'portfolioId', 'programId', 'sponsorId', 'lifecycleStage',
      'operatingStatus', 'engagedDivisions', 'sites',
    ],
    // Server-managed fields a client may never write (PATCH attempt -> 400).
    immutable: ['code'],
    defaults: () => ({
      description: null,
      site: null,
      cgeitTag: 'value_delivery',
      strategicTag: null,
      riskTags: [],
      classification: 'internal',
      overallStatus: 'active',
      securityGateStatus: 'not_required',
      ownerId: null,
      portfolioId: null,
      programId: null,
      sponsorId: null,
      lifecycleStage: 'IDEA',
      operatingStatus: 'NOT_STARTED',
      engagedDivisions: [],
      sites: [],
    }),
    enums: {
      cgeitTag: ['strategic_alignment', 'value_delivery', 'risk_optimization', 'resource_optimization', 'performance_measurement'],
      classification: CLASSIFICATIONS,
      overallStatus: ['draft', 'active', 'at_risk', 'on_hold', 'complete'],
      lifecycleStage: LIFECYCLE_STAGES,
      operatingStatus: OPERATING_STATUSES,
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
 * Immutable-field guard (project `code`): any attempt to set a different
 * value -> 400 VALIDATION. Echoing back the identical current value is
 * tolerated so clients may PATCH with full objects. Shared with sync.
 */
export function assertImmutableFields(def, current, payload) {
  for (const key of def.immutable ?? []) {
    if (payload?.[key] === undefined) continue;
    if (current == null || payload[key] !== current[key]) {
      throw validation(`${key} is server-generated and immutable`, { field: key });
    }
  }
}

/** PRJ-YYYY-NNN — zero-padded to at least 3 digits. */
export function formatProjectCode(year, seq) {
  return `PRJ-${year}-${String(seq).padStart(3, '0')}`;
}

/**
 * Validates project reference fields (400 VALIDATION on unknown ids/codes).
 * Applied on create and patch (and sync updates) for the fields present.
 */
export async function assertProjectRefs(repo, fields) {
  if (fields.portfolioId != null && !(await repo.get('portfolio', fields.portfolioId))) {
    throw validation(`Unknown portfolioId: ${fields.portfolioId}`, { field: 'portfolioId' });
  }
  if (fields.programId != null && !(await repo.get('program', fields.programId))) {
    throw validation(`Unknown programId: ${fields.programId}`, { field: 'programId' });
  }
  if (fields.sponsorId != null && !(await repo.getUser(fields.sponsorId))) {
    throw validation(`Unknown sponsorId: ${fields.sponsorId}`, { field: 'sponsorId' });
  }
  if (fields.engagedDivisions !== undefined && fields.engagedDivisions !== null) {
    if (!Array.isArray(fields.engagedDivisions) || fields.engagedDivisions.some((d) => typeof d !== 'string')) {
      throw validation('engagedDivisions must be an array of division codes', { field: 'engagedDivisions' });
    }
    const known = new Set((await repo.listDivisions()).map((d) => d.code));
    const bad = fields.engagedDivisions.find((d) => !known.has(d));
    if (bad) throw validation(`Unknown division in engagedDivisions: ${bad}`, { field: 'engagedDivisions' });
  }
  if (fields.sites !== undefined && fields.sites !== null) {
    if (!Array.isArray(fields.sites) || fields.sites.some((s) => typeof s !== 'string')) {
      throw validation('sites must be an array of site codes', { field: 'sites' });
    }
    const known = new Set((await repo.listSites()).map((s) => s.code));
    const bad = fields.sites.find((s) => !known.has(s));
    if (bad) throw validation(`Unknown site in sites: ${bad}`, { field: 'sites' });
  }
}

/**
 * Operational write policy (E04) shared by PATCH and sync updates.
 * `current` is null for creates. Throws 403 FORBIDDEN — callers must have
 * already passed the concealment (read) check, so existence is known.
 */
export function assertOperationalWrite(actor, kind, current, project, members) {
  if (kind === 'project') {
    if (!canManageProjectWork(actor, project, members)) {
      throw forbidden('Project updates require ADMIN, the project PM, or a DIVISION_LEAD of its division');
    }
    return;
  }
  if (kind === 'task') {
    if (!canWriteTask(actor, project, current, members)) {
      throw forbidden('Task writes require project management authority, membership, ownership, or being the assignee');
    }
    return;
  }
  if (kind === 'roadblock') {
    if (!canWriteRoadblock(actor, project, current, members)) {
      throw forbidden('Roadblock updates require project management authority, membership, ownership, or being the reporter');
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

  assertImmutableFields(def, null, payload ?? {});
  const fields = pickWritable(def, payload ?? {});
  for (const key of def.required) {
    if (fields[key] === undefined || fields[key] === null || fields[key] === '') {
      throw validation(`Missing required field: ${key}`, { field: key });
    }
  }
  assertEnums(def, fields);

  if (def.parentRef) {
    const parent = await repo.get('project', fields[def.parentRef]);
    const members = parent ? await repo.listProjectMembers(parent.id) : [];
    // Concealment (ADR-005): a parent project the actor may not read yields
    // the SAME error as a truly unknown id — existence must not leak.
    if (!parent || !canReadProject(actor, parent, members)) {
      throw validation(`Unknown ${def.parentRef}: ${fields[def.parentRef]}`, { field: def.parentRef });
    }
    // E04 write policy (create): null `current` — self-assignment does not
    // grant task creation; roadblock creation stays open (reporter grant).
    assertOperationalWrite(actor, kind, null, parent, members);
    // A non-manager may only report roadblocks as themselves.
    if (kind === 'roadblock' && fields.reportedBy !== undefined
        && fields.reportedBy !== actor?.id && !canManageProjectWork(actor, parent, members)) {
      throw forbidden('Only project managers may report a roadblock on behalf of someone else');
    }
  }

  // Classification: only ADMIN may set it at create; anyone else gets the
  // forced default 'internal' (ADR-005).
  if (kind === 'project' && fields.classification !== undefined && !canSetClassification(actor)) {
    delete fields.classification;
  }
  if (kind === 'project') {
    await assertProjectRefs(repo, fields);
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

  if (kind === 'project') {
    // Concurrency-safe code allocation inside the create transaction.
    const year = new Date().getUTCFullYear();
    row.code = formatProjectCode(year, await repo.nextProjectCodeSeq(year));
  }

  const written = await repo.insert(kind, row);
  await ensureSecurityRouting(repo, kind, written);
  // Security routing may bump the project's own gate/version, so projects need
  // a fresh read; tasks/roadblocks are returned exactly as written.
  return kind === 'project' ? repo.get(kind, written.id) : written;
}

/**
 * Direct (online) PATCH — strict OCC per contract invariant 1:
 * body must carry `version` (base version); mismatch -> 409 with serverState.
 * Task status transitions run the governance gates (423s); project
 * lifecycleStage moves one step at a time (400 INVALID_LIFECYCLE_TRANSITION).
 * Returns the updated entity.
 */
export async function patchEntity(repo, actor, kind, id, body) {
  const def = ENTITY_DEFS[kind];
  if (!def) throw validation(`Unknown entity kind: ${kind}`);

  const current = await repo.get(kind, id);
  if (!current) throw notFound(`${kind} ${id} not found`);

  // Concealment (ADR-005): writes against entities of unreadable projects
  // 404 exactly like a missing id.
  const scopeProject = kind === 'project' ? current : await repo.get('project', current.projectId);
  const members = scopeProject ? await repo.listProjectMembers(scopeProject.id) : [];
  if (scopeProject && !canReadProject(actor, scopeProject, members)) {
    throw notFound(`${kind} ${id} not found`);
  }

  // E04 membership-based write policy (403 — existence already known).
  assertOperationalWrite(actor, kind, current, scopeProject, members);

  if (typeof body?.version !== 'number' || !Number.isInteger(body.version)) {
    throw validation('Body must include the integer base `version` for OCC');
  }

  assertImmutableFields(def, current, body ?? {});
  const fields = pickWritable(def, body);
  assertEnums(def, fields);

  // Only ADMIN may change a project's classification (403 otherwise).
  if (kind === 'project' && fields.classification !== undefined
      && fields.classification !== current.classification && !canSetClassification(actor)) {
    throw forbidden('Only ADMIN may set or change a project classification');
  }
  if (Object.keys(fields).length === 0) {
    throw validation('No writable fields in payload');
  }
  if (kind === 'project') {
    if (fields.lifecycleStage !== undefined && fields.lifecycleStage !== current.lifecycleStage) {
      assertLifecycleStep(current.lifecycleStage, fields.lifecycleStage);
    }
    await assertProjectRefs(repo, fields);
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
