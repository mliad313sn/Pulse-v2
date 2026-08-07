/**
 * Governance gates (contract invariants 2-3), mirrored from the DB triggers
 * so they also apply against the in-memory repository.
 */
import { dependencyLocked, securityGate, validation } from '../errors.js';

const ADVANCING_STATUSES = ['in_progress', 'done'];

/** Lifecycle stages, in canonical order (plan §12.1 — no skips). */
export const LIFECYCLE_STAGES = [
  'IDEA', 'INITIATION', 'PLANNING', 'EXECUTION', 'DEPLOYMENT', 'RUN', 'CLOSED',
];

/**
 * E05: direct writes of lifecycleStage are FORBIDDEN — forward movement goes
 * through the gate process (POST /api/projects/:id/gates/request + approval).
 * The single exception is a controlled correction: ADMIN may step exactly ONE
 * stage backward (audited as LIFECYCLE_CORRECTION by the caller).
 * Out-of-enum values are caught earlier by assertEnums (plain 400 VALIDATION).
 */
export function assertLifecycleChange(actor, from, to) {
  const i = LIFECYCLE_STAGES.indexOf(from);
  const j = LIFECYCLE_STAGES.indexOf(to);
  if (i === -1 || j === -1) return;
  if (j - i === -1 && actor?.baseRole === 'ADMIN') return; // ADMIN one-step-backward correction
  throw validation(
    `lifecycleStage cannot be set directly — use the gate process (${from} -> ${to}); `
      + 'only ADMIN may move one stage backward as a controlled correction',
    { from, to },
  );
}

function lookupTask(tasksById, id) {
  if (!tasksById || id == null) return undefined;
  if (typeof tasksById.get === 'function') return tasksById.get(id);
  return tasksById[id];
}

/**
 * E07: predecessor ids that block `task` from advancing.
 * Two sources, identical semantics ("blocked until predecessor is done"):
 *   - the v1 single-prereq `dependencyLock` field (back-compat), and
 *   - typed FS dependency edges targeting the task.
 * SS/FF/SF edges NEVER lock — they are scheduling semantics only (critical
 * path / Gantt), per plan §20.
 * A missing predecessor row counts as blocking (fail-safe).
 */
export function blockingPredecessors(task, tasksById, dependencies = []) {
  const blocking = [];
  if (task.dependencyLock) {
    const dep = lookupTask(tasksById, task.dependencyLock);
    if (!dep || dep.status !== 'done') blocking.push(task.dependencyLock);
  }
  for (const edge of dependencies) {
    if (edge.successorId !== task.id || edge.type !== 'FS') continue;
    if (blocking.includes(edge.predecessorId)) continue;
    const pred = lookupTask(tasksById, edge.predecessorId);
    if (!pred || pred.status !== 'done') blocking.push(edge.predecessorId);
  }
  return blocking;
}

/**
 * Derived `locked` flag: prerequisite (dependencyLock OR any FS predecessor)
 * not done, OR project security gate pending.
 * `dependencies` are the typed dependency rows to consider (any superset of
 * the task's own incoming edges is fine — non-matching rows are ignored).
 */
export function computeLocked(task, tasksById, project, dependencies = []) {
  const depBlocked = blockingPredecessors(task, tasksById, dependencies).length > 0;
  const gateBlocked = project?.securityGateStatus === 'pending';
  return depBlocked || gateBlocked;
}

/**
 * Throws DEPENDENCY_LOCKED / SECURITY_GATE (both HTTP 423) when a task may not
 * move to `newStatus`. Mirrors trg_task_gates: only transitions INTO
 * in_progress/done (and only actual status changes) are gated.
 * DEPENDENCY_LOCKED detail carries `blockingPredecessorIds` (dependencyLock +
 * unfinished FS predecessors); the v1 prerequisite fields stay for back-compat
 * when the dependencyLock itself blocks.
 */
export function assertCanAdvance(task, newStatus, tasksById, project, dependencies = []) {
  if (!ADVANCING_STATUSES.includes(newStatus) || newStatus === task.status) return;

  const blocking = blockingPredecessors(task, tasksById, dependencies);
  if (blocking.length > 0) {
    const detail = { taskId: task.id, blockingPredecessorIds: blocking };
    if (task.dependencyLock && blocking.includes(task.dependencyLock)) {
      const dep = lookupTask(tasksById, task.dependencyLock);
      detail.prerequisiteTaskId = task.dependencyLock;
      detail.prerequisiteStatus = dep ? dep.status : 'missing';
    }
    throw dependencyLocked(detail);
  }

  if (project?.securityGateStatus === 'pending') {
    throw securityGate({ taskId: task.id, projectId: project.id });
  }
}
