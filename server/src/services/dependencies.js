/**
 * E07 — Typed task dependencies (plan §20).
 *
 * `TaskDependency {id, projectId, predecessorId, successorId, type, lagDays}`
 * rows are IMMUTABLE (create/delete only, no OCC version — change = delete +
 * re-create, both audited).
 *
 * Semantics:
 *   - FS additionally LOCKS the successor (cannot advance while the
 *     predecessor is not done) — enforced by services/gates.js and the DB
 *     trigger trg_task_gates.
 *   - SS / FF / SF are SCHEDULING-ONLY edges (critical path, Gantt); they
 *     never lock task progression.
 *
 * Invariants enforced here (the DB trigger trg_dependency_rules is the
 * backstop):
 *   - both tasks exist and share the SAME project (400 VALIDATION; tasks of
 *     unreadable projects are indistinguishable from unknown ids);
 *   - no self-dependency (400);
 *   - no duplicate (predecessorId, successorId, type) edge (409 DUPLICATE);
 *   - the per-project dependency graph stays ACYCLIC across ALL edge types:
 *     an edge whose successor can already reach its predecessor is refused
 *     (400 VALIDATION 'dependency cycle', detail.path) — DFS below.
 *   - writes require manage-level authority (canManageProjectWork).
 */
import { randomUUID } from 'node:crypto';
import { duplicate, forbidden, notFound, validation } from '../errors.js';
import { canManageProjectWork, canReadProject } from './policy.js';
import { nowIso } from './time.js';

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'];

/**
 * Pure cycle check over directed edges {predecessorId, successorId} (type is
 * irrelevant: EVERY dependency type participates in the precedence graph, so
 * a cycle through an SS edge is just as unschedulable as one through FS).
 *
 * Adding predecessor -> successor closes a cycle iff `successorId` can
 * already reach `predecessorId` along existing edges. Iterative DFS; returns
 * the offending path [successorId, ..., predecessorId] or null.
 */
export function findCyclePath(edges, predecessorId, successorId) {
  if (predecessorId === successorId) return [predecessorId, successorId];
  const outgoing = new Map(); // node -> [successor ids]
  for (const e of edges) {
    const list = outgoing.get(e.predecessorId);
    if (list) list.push(e.successorId);
    else outgoing.set(e.predecessorId, [e.successorId]);
  }
  const stack = [[successorId, [successorId]]];
  const visited = new Set();
  while (stack.length > 0) {
    const [node, path] = stack.pop();
    if (node === predecessorId) return path;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of outgoing.get(node) ?? []) {
      stack.push([next, [...path, next]]);
    }
  }
  return null;
}

/** Loads a task treating tasks of unreadable projects as unknown ids. */
async function loadVisibleTask(repo, actor, field, taskId) {
  if (typeof taskId !== 'string' || !taskId) {
    throw validation(`${field} is required`, { field });
  }
  const task = await repo.get('task', taskId);
  if (!task) throw validation(`Unknown ${field}: ${taskId}`, { field });
  const project = await repo.get('project', task.projectId);
  const members = project ? await repo.listProjectMembers(project.id) : [];
  // Concealment (ADR-005): a task of an unreadable project must yield the
  // SAME error as a truly unknown id.
  if (!project || !canReadProject(actor, project, members)) {
    throw validation(`Unknown ${field}: ${taskId}`, { field });
  }
  return { task, project, members };
}

/**
 * Creates a typed dependency edge. `repo` must already be transaction/actor
 * scoped. Returns the created row.
 */
export async function createDependency(repo, actor, payload = {}) {
  const { predecessorId, successorId } = payload;
  const type = payload.type === undefined ? 'FS' : payload.type;
  const lagDays = payload.lagDays === undefined ? 0 : payload.lagDays;

  if (!DEPENDENCY_TYPES.includes(type)) {
    throw validation(`type must be one of ${DEPENDENCY_TYPES.join(', ')}`, { field: 'type', allowed: DEPENDENCY_TYPES });
  }
  if (!Number.isInteger(lagDays)) {
    throw validation('lagDays must be an integer (negative = lead)', { field: 'lagDays' });
  }
  if (predecessorId != null && predecessorId === successorId) {
    throw validation('A task cannot depend on itself', { field: 'successorId' });
  }

  const pred = await loadVisibleTask(repo, actor, 'predecessorId', predecessorId);
  const succ = await loadVisibleTask(repo, actor, 'successorId', successorId);
  if (pred.task.projectId !== succ.task.projectId) {
    throw validation('predecessor and successor must belong to the same project', {
      field: 'successorId',
    });
  }
  const { project, members } = pred;
  if (!canManageProjectWork(actor, project, members)) {
    throw forbidden('Managing task dependencies requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
  }

  const existing = await repo.list('dependency', { projectId: project.id });
  if (existing.some((d) => d.predecessorId === predecessorId
      && d.successorId === successorId && d.type === type)) {
    throw duplicate('This dependency edge already exists', { predecessorId, successorId, type });
  }
  const cycle = findCyclePath(existing, predecessorId, successorId);
  if (cycle) {
    throw validation('Creating this dependency would close a dependency cycle', {
      field: 'successorId', path: cycle,
    });
  }

  return repo.insert('dependency', {
    id: randomUUID(),
    projectId: project.id,
    predecessorId,
    successorId,
    type,
    lagDays,
    createdAt: nowIso(),
  });
}

/**
 * Deletes a dependency edge (unlocking any FS-locked successor). Concealment:
 * edges of unreadable projects 404 exactly like missing ids.
 */
export async function deleteDependency(repo, actor, id) {
  const edge = await repo.get('dependency', id);
  if (!edge) throw notFound(`dependency ${id} not found`);
  const project = await repo.get('project', edge.projectId);
  const members = project ? await repo.listProjectMembers(project.id) : [];
  if (!project || !canReadProject(actor, project, members)) {
    throw notFound(`dependency ${id} not found`);
  }
  if (!canManageProjectWork(actor, project, members)) {
    throw forbidden('Managing task dependencies requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
  }
  await repo.delete('dependency', id);
}
