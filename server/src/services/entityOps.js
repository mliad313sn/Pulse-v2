/**
 * Shared entity create/patch logic used by both the REST routes and the
 * offline sync processor, so business rules live in exactly one place.
 *
 * E04 additions:
 *   - project codes PRJ-YYYY-NNN: server-generated inside the create
 *     transaction via the concurrency-safe per-year sequence
 *     (repo.nextProjectCodeSeq -> project_code_sequences w/ SELECT..FOR UPDATE
 *     on Postgres); immutable afterwards (PATCH attempts -> 400 VALIDATION).
 * E05/E08 additions:
 *   - lifecycleStage is gate-governed (services/gateEngine.js); direct writes
 *     are refused except the audited ADMIN one-step-backward correction.
 *   - operatingStatus transition rules (CANCELLED terminal + reason fields).
 *   - milestones (weighted, typed) feeding the COMPUTED project progress.
 *   - membership-based write policy (canWriteTask/canWriteRoadblock/
 *     canManageProjectWork) replacing the v1 any-writer-writes-anything model.
 */
import { randomUUID } from 'node:crypto';
import { forbidden, notFound, validation, versionConflict } from '../errors.js';
import { assertCanAdvance, assertLifecycleChange, LIFECYCLE_STAGES } from './gates.js';
import { applyUpdate } from './occ.js';
import {
  CLASSIFICATIONS, canManageProjectWork, canReadProject, canSetClassification,
  canWriteMilestone, canWriteRoadblock, canWriteTask,
} from './policy.js';
import { ensureSecurityRouting } from './securityRouting.js';
import { nowIso } from './time.js';

export const OPERATING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

export const MILESTONE_TYPES = [
  'STANDARD', 'SECURITY_GATE', 'SITE_READINESS', 'UAT', 'GO_LIVE',
  'GOVERNANCE_GATE', 'OPERATIONAL_HANDOVER',
];
export const MILESTONE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SLIPPED', 'CANCELLED'];

export const ENTITY_DEFS = {
  project: {
    required: ['name', 'division'],
    writable: [
      'name', 'description', 'division', 'site', 'cgeitTag', 'strategicTag',
      'riskTags', 'classification', 'overallStatus', 'ownerId',
      'portfolioId', 'programId', 'sponsorId', 'lifecycleStage',
      'operatingStatus', 'engagedDivisions', 'sites',
      // E05 governance fields (all nullable; per-manage-level write policy).
      'startDate', 'targetDate', 'actualEndDate', 'acceptanceCriteria',
      'deploymentPlan', 'supportOwnerId', 'closureSummary', 'cancelReason', 'holdReason',
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
      startDate: null,
      targetDate: null,
      actualEndDate: null,
      acceptanceCriteria: null,
      deploymentPlan: null,
      supportOwnerId: null,
      closureSummary: null,
      cancelReason: null,
      holdReason: null,
    }),
    enums: {
      cgeitTag: ['strategic_alignment', 'value_delivery', 'risk_optimization', 'resource_optimization', 'performance_measurement'],
      classification: CLASSIFICATIONS,
      overallStatus: ['draft', 'active', 'at_risk', 'on_hold', 'complete'],
      lifecycleStage: LIFECYCLE_STAGES,
      operatingStatus: OPERATING_STATUSES,
    },
    dateFields: ['startDate', 'targetDate', 'actualEndDate'],
    userRefs: ['supportOwnerId'],
  },
  milestone: {
    required: ['projectId', 'title'],
    parentRef: 'projectId',
    writable: [
      'projectId', 'title', 'description', 'type', 'status', 'ownerId',
      'baselineDue', 'forecastDue', 'actualCompleted', 'weight',
    ],
    defaults: () => ({
      description: null,
      type: 'STANDARD',
      status: 'NOT_STARTED',
      ownerId: null,
      baselineDue: null,
      forecastDue: null,
      actualCompleted: null,
      weight: 1,
    }),
    enums: {
      type: MILESTONE_TYPES,
      status: MILESTONE_STATUSES,
    },
    dateFields: ['baselineDue', 'forecastDue', 'actualCompleted'],
    userRefs: ['ownerId'],
    intFields: { weight: 1 }, // integer >= 1 (progress weighting, plan §23)
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural field rules beyond enums (shared by create/PATCH/sync):
 *   - def.intFields  {field: min} -> integer >= min (e.g. milestone weight >= 1);
 *   - def.dateFields [field]      -> null or ISO date 'YYYY-MM-DD' (matches the
 *     DATE columns in Postgres so both repos round-trip identically).
 */
export function assertFieldRules(def, fields) {
  for (const [key, min] of Object.entries(def.intFields ?? {})) {
    const v = fields[key];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < min) {
      throw validation(`${key} must be an integer >= ${min}`, { field: key });
    }
  }
  for (const key of def.dateFields ?? []) {
    const v = fields[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !DATE_RE.test(v)) {
      throw validation(`${key} must be an ISO date (YYYY-MM-DD)`, { field: key });
    }
  }
}

/** def.userRefs: fields that must reference an existing user (400 otherwise). */
export async function assertUserRefs(repo, def, fields) {
  for (const key of def.userRefs ?? []) {
    if (fields[key] != null && !(await repo.getUser(fields[key]))) {
      throw validation(`Unknown ${key}: ${fields[key]}`, { field: key });
    }
  }
}

/**
 * Operating-status transition rules (plan §12.2), shared by create/PATCH/sync.
 *   - CANCELLED is TERMINAL: once there, operatingStatus can never change again;
 *   - moving to CANCELLED requires a cancelReason (in this payload or already set);
 *   - moving to ON_HOLD requires a holdReason likewise.
 * `current` is null for creates (defaults NOT_STARTED unless the payload says otherwise).
 */
export function assertOperatingStatusChange(current, fields) {
  const next = fields.operatingStatus;
  if (next === undefined || next === current?.operatingStatus) return;
  if (current?.operatingStatus === 'CANCELLED') {
    throw validation('operatingStatus CANCELLED is terminal: no further operating-status changes', {
      field: 'operatingStatus',
    });
  }
  if (next === 'CANCELLED' && !(fields.cancelReason ?? current?.cancelReason)) {
    throw validation('cancelReason is required when moving operatingStatus to CANCELLED', {
      field: 'cancelReason',
    });
  }
  if (next === 'ON_HOLD' && !(fields.holdReason ?? current?.holdReason)) {
    throw validation('holdReason is required when moving operatingStatus to ON_HOLD', {
      field: 'holdReason',
    });
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
    return;
  }
  if (kind === 'milestone') {
    if (!canWriteMilestone(actor, project, current, members)) {
      throw forbidden('Milestone writes require project management authority or being the milestone owner');
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
  assertFieldRules(def, fields);
  await assertUserRefs(repo, def, fields);

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
    // Creating straight into CANCELLED/ON_HOLD still demands the reason fields.
    assertOperatingStatusChange(null, fields);
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
 * lifecycleStage is gate-governed (E05): direct writes are 400 VALIDATION
 * except the audited ADMIN one-step-backward correction.
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
  await assertUpdateBusinessRules(repo, actor, kind, current, fields);
  if (Object.keys(fields).length === 0) {
    throw validation('No writable fields in payload');
  }

  const { outcome, next } = applyUpdate(current, { baseVersion: body.version, fields }, { strict: true });
  if (outcome !== 'applied') {
    throw versionConflict(current);
  }

  await runTaskGates(repo, kind, current, fields);

  const written = await repo.update(kind, next);
  await recordLifecycleCorrection(repo, actor, kind, current, written);
  await ensureSecurityRouting(repo, kind, written);
  // See createEntity: only projects can be mutated again by security routing.
  return kind === 'project' ? repo.get(kind, id) : written;
}

/**
 * Business rules every UPDATE path (direct PATCH and offline sync) must run:
 * enums, structural field rules, user references, ADMIN-only classification,
 * the E05 lifecycle guard (gate process only, except ADMIN backward step),
 * operating-status transition rules, and project reference validation.
 */
export async function assertUpdateBusinessRules(repo, actor, kind, current, fields) {
  const def = ENTITY_DEFS[kind];
  assertEnums(def, fields);
  assertFieldRules(def, fields);
  await assertUserRefs(repo, def, fields);
  if (kind !== 'project') return;

  // Only ADMIN may change a project's classification (403 otherwise).
  if (fields.classification !== undefined
      && fields.classification !== current.classification && !canSetClassification(actor)) {
    throw forbidden('Only ADMIN may set or change a project classification');
  }
  if (fields.lifecycleStage !== undefined && fields.lifecycleStage !== current.lifecycleStage) {
    assertLifecycleChange(actor, current.lifecycleStage, fields.lifecycleStage);
  }
  assertOperatingStatusChange(current, fields);
  await assertProjectRefs(repo, fields);
}

/**
 * The one legal direct lifecycle write is the ADMIN one-step-backward
 * correction (E05). Beyond the regular UPDATE audit row, record an explicit
 * LIFECYCLE_CORRECTION entry so corrections are separately traceable.
 * Shared by PATCH and sync updates.
 */
export async function recordLifecycleCorrection(repo, actor, kind, before, after) {
  if (kind !== 'project' || !after || before.lifecycleStage === after.lifecycleStage) return;
  await repo.appendAudit({
    entityType: 'projects',
    entityId: before.id,
    action: 'LIFECYCLE_CORRECTION',
    actorId: actor?.id ?? null,
    newData: { from: before.lifecycleStage, to: after.lifecycleStage },
  });
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
