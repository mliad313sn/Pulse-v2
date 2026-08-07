/**
 * E05 — Gate engine (plan §13). Replaces the E04 one-step lifecycle guard.
 *
 * Data-driven gate definitions: each gate declares its requirement checks as
 * pure functions over a gate context {project, members, milestones, tasks,
 * roadblocks} (+ per-request options such as the G5 dispositionNote).
 * `evaluateGate` is pure and unit-testable; `loadGateContext` gathers the
 * inputs from a repository.
 *
 * Flow (invariants 8-10):
 *   GET  /api/projects/:id/gates          -> requirement checklist (War Room)
 *   POST /api/projects/:id/gates/request  -> 422 GATE_REQUIREMENTS_NOT_MET
 *                                            until every requirement is satisfied
 *   POST /api/gate-requests/:id/decision  -> APPROVED applies the transition +
 *                                            appends an immutable approval_ledger
 *                                            entry in ONE transaction.
 * G2 (PLANNING -> EXECUTION) decisions require the 'steering' privilege —
 * an ADMIN without it is denied (invariant 4).
 */
import { forbidden, steeringApprovalRequired } from '../errors.js';
import { LIFECYCLE_STAGES } from './gates.js';
import { canWrite, hasPrivilege, isAdmin } from './policy.js';

const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'];

const has = (v) => v !== undefined && v !== null && v !== '';

/** Requirement factory: field present on the project. */
const projectField = (key, label, field = key) => ({
  key,
  label,
  check: ({ project }) =>
    (has(project[field])
      ? { satisfied: true }
      : { satisfied: false, detail: `${field} is not set` }),
});

/**
 * Gate definitions G0..G5, in lifecycle order. GATES[i] moves
 * LIFECYCLE_STAGES[i] -> LIFECYCLE_STAGES[i+1].
 */
export const GATES = [
  {
    gate: 'G0',
    fromStage: 'IDEA',
    toStage: 'INITIATION',
    steeringRequired: false,
    requirements: [
      projectField('title', 'Title', 'name'),
      projectField('description', 'Problem / opportunity description'),
      projectField('sponsor', 'Sponsor', 'sponsorId'),
      projectField('owner', 'Preliminary owner', 'ownerId'),
    ],
  },
  {
    gate: 'G1',
    fromStage: 'INITIATION',
    toStage: 'PLANNING',
    steeringRequired: false,
    requirements: [
      projectField('description', 'Description and scope'),
      projectField('sponsor', 'Sponsor', 'sponsorId'),
      {
        key: 'pm',
        label: 'Project Manager assigned',
        check: ({ members }) =>
          (members.some((m) => m.role === 'PM')
            ? { satisfied: true }
            : { satisfied: false, detail: 'no member holds the PM role' }),
      },
      projectField('targetDate', 'Target date'),
      {
        key: 'site',
        label: 'Site(s) identified',
        check: ({ project }) =>
          (has(project.site) || (project.sites ?? []).length > 0
            ? { satisfied: true }
            : { satisfied: false, detail: 'neither site nor sites[] is set' }),
      },
      projectField('division', 'Division'),
    ],
  },
  {
    gate: 'G2',
    fromStage: 'PLANNING',
    toStage: 'EXECUTION',
    steeringRequired: true, // invariant 10: Steering Committee approver
    requirements: [
      {
        key: 'milestones',
        label: 'At least one milestone planned',
        check: ({ milestones }) =>
          (milestones.some((m) => m.status !== 'CANCELLED')
            ? { satisfied: true }
            : { satisfied: false, detail: 'no non-cancelled milestone exists' }),
      },
      {
        key: 'team',
        label: 'Project team (PM plus at least one more member)',
        check: ({ members }) => {
          const hasPm = members.some((m) => m.role === 'PM');
          if (hasPm && members.length >= 2) return { satisfied: true };
          return {
            satisfied: false,
            detail: hasPm ? 'only the PM is on the team' : 'no PM member exists',
          };
        },
      },
      {
        key: 'baseline',
        label: 'Baseline dates (start + target)',
        check: ({ project }) => {
          const missing = ['startDate', 'targetDate'].filter((f) => !has(project[f]));
          return missing.length === 0
            ? { satisfied: true }
            : { satisfied: false, detail: `missing ${missing.join(', ')}` };
        },
      },
      projectField('acceptanceCriteria', 'Acceptance criteria'),
      // RACI does not exist yet (E12) — deliberately skipped per plan §13's
      // "data-driven / configurable" allowance; add here when E12 lands.
    ],
  },
  {
    gate: 'G3',
    fromStage: 'EXECUTION',
    toStage: 'DEPLOYMENT',
    steeringRequired: false,
    requirements: [
      projectField('deploymentPlan', 'Deployment plan'),
      {
        key: 'criticalRoadblocks',
        label: 'No open critical roadblocks',
        check: ({ roadblocks }) => {
          const open = roadblocks.filter(
            (r) => r.severity === 'critical' && r.status !== 'resolved',
          );
          return open.length === 0
            ? { satisfied: true }
            : { satisfied: false, detail: `${open.length} open critical roadblock(s): ${open.map((r) => r.id).join(', ')}` };
        },
      },
    ],
  },
  {
    gate: 'G4',
    fromStage: 'DEPLOYMENT',
    toStage: 'RUN',
    steeringRequired: false,
    requirements: [
      {
        key: 'goLive',
        label: 'GO_LIVE milestone completed',
        check: ({ milestones }) =>
          (milestones.some((m) => m.type === 'GO_LIVE' && m.status === 'DONE')
            ? { satisfied: true }
            : { satisfied: false, detail: 'no GO_LIVE milestone with status DONE' }),
      },
      projectField('supportOwner', 'Support owner', 'supportOwnerId'),
    ],
  },
  {
    gate: 'G5',
    fromStage: 'RUN',
    toStage: 'CLOSED',
    steeringRequired: false,
    requirements: [
      projectField('actualEndDate', 'Actual end date'),
      projectField('closureSummary', 'Closure summary'),
      {
        key: 'openWork',
        label: 'Outstanding work dispositioned',
        check: ({ tasks, roadblocks }, { dispositionNote } = {}) => {
          const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
          const openRoadblocks = roadblocks.filter((r) => r.status !== 'resolved');
          if (openTasks.length === 0 && openRoadblocks.length === 0) return { satisfied: true };
          if (has(dispositionNote)) {
            return {
              satisfied: true,
              detail: `${openTasks.length} open task(s) and ${openRoadblocks.length} unresolved roadblock(s) explicitly dispositioned`,
            };
          }
          return {
            satisfied: false,
            detail: `${openTasks.length} open task(s) and ${openRoadblocks.length} unresolved roadblock(s); `
              + 'close them or provide an explicit dispositionNote in the gate request',
          };
        },
      },
    ],
  },
];

/** The gate leaving `stage`, or null when stage is CLOSED/unknown. */
export function gateForStage(stage) {
  return GATES.find((g) => g.fromStage === stage) ?? null;
}

/** The next lifecycle stage after `stage`, or null at the end. */
export function nextStage(stage) {
  const i = LIFECYCLE_STAGES.indexOf(stage);
  return i === -1 || i === LIFECYCLE_STAGES.length - 1 ? null : LIFECYCLE_STAGES[i + 1];
}

/**
 * Pure gate evaluation.
 * @param gateDef one of GATES
 * @param ctx {project, members, milestones, tasks, roadblocks}
 * @param options {dispositionNote?} per-request evaluation inputs (G5)
 * @returns {{gate, fromStage, toStage, steeringRequired, requirements, missing, satisfied}}
 *          requirements[]: {key, label, satisfied, detail?}
 */
export function evaluateGate(gateDef, ctx, options = {}) {
  const requirements = gateDef.requirements.map((r) => {
    const { satisfied, detail } = r.check(ctx, options);
    const out = { key: r.key, label: r.label, satisfied };
    if (detail !== undefined) out.detail = detail;
    return out;
  });
  const missing = requirements.filter((r) => !r.satisfied);
  return {
    gate: gateDef.gate,
    fromStage: gateDef.fromStage,
    toStage: gateDef.toStage,
    steeringRequired: gateDef.steeringRequired,
    requirements,
    missing,
    satisfied: missing.length === 0,
  };
}

/** Gathers everything gate evaluation needs for one project. */
export async function loadGateContext(repo, project) {
  const [members, milestones, tasks, roadblocks] = await Promise.all([
    repo.listProjectMembers(project.id),
    repo.list('milestone', { projectId: project.id }),
    repo.list('task', { projectId: project.id }),
    repo.list('roadblock', { projectId: project.id }),
  ]);
  return { project, members, milestones, tasks, roadblocks };
}

/**
 * Approver authorization (invariants 4 + 10).
 *   G2: requires the 'steering' privilege — an ADMIN without it is DENIED
 *       (403 STEERING_APPROVAL_REQUIRED).
 *   Other gates: ADMIN, a steering holder, or a DIVISION_LEAD of the
 *       project's division.
 * @returns {'STEERING'|'ADMIN'|'DIVISION_LEAD'} the authority type recorded
 *          in the approval ledger. Throws typed 403s otherwise.
 */
export function decideAuthorityType(user, project, gate) {
  if (!canWrite(user)) throw forbidden('Deciding gate requests requires an active non-VIEWER account');
  const steering = hasPrivilege(user, 'steering');
  if (gate === 'G2') {
    if (!steering) throw steeringApprovalRequired();
    return 'STEERING';
  }
  if (steering) return 'STEERING';
  if (isAdmin(user)) return 'ADMIN';
  if (user.baseRole === 'DIVISION_LEAD' && user.division === project.division) return 'DIVISION_LEAD';
  throw forbidden('Deciding gate requests requires ADMIN, the steering privilege, or a DIVISION_LEAD of the project\'s division');
}
