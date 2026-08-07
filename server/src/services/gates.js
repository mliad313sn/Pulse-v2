/**
 * Governance gates (contract invariants 2-3), mirrored from the DB triggers
 * so they also apply against the in-memory repository.
 */
import { dependencyLocked, invalidLifecycleTransition, securityGate } from '../errors.js';

const ADVANCING_STATUSES = ['in_progress', 'done'];

/**
 * E04 lifecycle stages, in canonical order. For THIS slice the stage is data +
 * validation only: a PATCH may move exactly ONE stage forward or backward —
 * no skipping. The real G0-G5 gate engine (entry criteria, approvals, Steering
 * privilege) lands in E05 and will replace/extend this guard.
 */
export const LIFECYCLE_STAGES = [
  'IDEA', 'INITIATION', 'PLANNING', 'EXECUTION', 'DEPLOYMENT', 'RUN', 'CLOSED',
];

/** Throws 400 INVALID_LIFECYCLE_TRANSITION on any multi-step stage move. */
export function assertLifecycleStep(from, to) {
  const i = LIFECYCLE_STAGES.indexOf(from);
  const j = LIFECYCLE_STAGES.indexOf(to);
  if (i === -1 || j === -1) return; // out-of-enum values are caught by assertEnums (400 VALIDATION)
  if (Math.abs(j - i) !== 1) throw invalidLifecycleTransition(from, to);
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
