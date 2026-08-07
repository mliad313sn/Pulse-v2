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
 * Derived `locked` flag: prerequisite not done OR project security gate pending.
 */
export function computeLocked(task, tasksById, project) {
  let depBlocked = false;
  if (task.dependencyLock) {
    const dep = lookupTask(tasksById, task.dependencyLock);
    depBlocked = !dep || dep.status !== 'done';
  }
  const gateBlocked = project?.securityGateStatus === 'pending';
  return depBlocked || gateBlocked;
}

/**
 * Throws DEPENDENCY_LOCKED / SECURITY_GATE (both HTTP 423) when a task may not
 * move to `newStatus`. Mirrors trg_task_gates: only transitions INTO
 * in_progress/done (and only actual status changes) are gated.
 */
export function assertCanAdvance(task, newStatus, tasksById, project) {
  if (!ADVANCING_STATUSES.includes(newStatus) || newStatus === task.status) return;

  if (task.dependencyLock) {
    const dep = lookupTask(tasksById, task.dependencyLock);
    if (!dep || dep.status !== 'done') {
      throw dependencyLocked({
        taskId: task.id,
        prerequisiteTaskId: task.dependencyLock,
        prerequisiteStatus: dep ? dep.status : 'missing',
      });
    }
  }

  if (project?.securityGateStatus === 'pending') {
    throw securityGate({ taskId: task.id, projectId: project.id });
  }
}
