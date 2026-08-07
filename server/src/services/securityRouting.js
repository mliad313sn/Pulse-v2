/**
 * InfoSec routing (contract invariant 4), mirrored from the DB trigger
 * route_security_review so it also works against the MemoryRepo.
 *
 * After any project/task create/update carrying a network risk tag:
 *   - ensure a pending SecurityApproval exists (dedupe on project+task+tag
 *     while a pending/approved row exists), and
 *   - flip the project's securityGateStatus to 'pending'.
 */
import { randomUUID } from 'node:crypto';
import { notFound, validation } from '../errors.js';
import { assertCan, canReadProject } from './policy.js';
import { nowIso } from './time.js';

// db/init/01_schema.sql:security_risk_tags is the DB-side source of this list; both must change together.
export const SECURITY_RISK_TAGS = ['network_alteration', 'firewall_change', 'external_exposure'];

/** Set the project's securityGateStatus (with version bump) if it differs. */
async function setProjectGate(repo, projectId, gate) {
  const project = await repo.get('project', projectId);
  if (project && project.securityGateStatus !== gate) {
    await repo.update('project', {
      ...project,
      securityGateStatus: gate,
      version: project.version + 1,
      updatedAt: nowIso(),
    });
  }
}

/**
 * @param repo repository (already actor-scoped / inside a transaction)
 * @param {'project'|'task'|'roadblock'} kind
 * @param entity the freshly written entity (camelCase)
 */
export async function ensureSecurityRouting(repo, kind, entity) {
  if (kind !== 'project' && kind !== 'task') return;
  const riskyTags = (entity.riskTags ?? []).filter((t) => SECURITY_RISK_TAGS.includes(t));
  if (riskyTags.length === 0) return;

  const projectId = kind === 'project' ? entity.id : entity.projectId;
  const taskId = kind === 'task' ? entity.id : null;

  const approvals = await repo.list('approval', { projectId });
  let createdAny = false;
  for (const tag of riskyTags) {
    const exists = approvals.some(
      (a) =>
        (a.taskId ?? null) === taskId &&
        a.riskTag === tag &&
        (a.status === 'pending' || a.status === 'approved'),
    );
    if (!exists) {
      await repo.insert('approval', {
        id: randomUUID(),
        projectId,
        taskId,
        riskTag: tag,
        status: 'pending',
        requestedAt: nowIso(),
        reviewedBy: null,
        reviewedAt: null,
        notes: null,
      });
      createdAny = true;
    }
  }

  if (createdAny) {
    await setProjectGate(repo, projectId, 'pending');
  }
}

/**
 * Gate recomputation rule: any pending -> pending; else any rejected -> rejected;
 * else (approvals exist) -> approved; no approvals at all -> not_required.
 */
export function recomputeGateStatus(approvals) {
  if (!approvals || approvals.length === 0) return 'not_required';
  if (approvals.some((a) => a.status === 'pending')) return 'pending';
  if (approvals.some((a) => a.status === 'rejected')) return 'rejected';
  return 'approved';
}

/**
 * Approval decision — security_reviewer only. Recomputes the project gate.
 * Returns { approval, project }.
 */
export async function applyApprovalDecision(repo, reviewer, approvalId, { decision, notes } = {}) {
  assertCan(reviewer, 'approval:decide');
  if (decision !== 'approved' && decision !== 'rejected') {
    throw validation("decision must be 'approved' or 'rejected'");
  }

  const approval = await repo.get('approval', approvalId);
  if (!approval) throw notFound(`SecurityApproval ${approvalId} not found`);
  // Concealment (ADR-005): approvals under projects the reviewer may not read
  // are indistinguishable from missing ones (interim scope — until E04
  // membership, confidential projects are reviewable only by ADMIN/owner
  // holders of the privilege).
  const project = await repo.get('project', approval.projectId);
  if (project && !canReadProject(reviewer, project)) {
    throw notFound(`SecurityApproval ${approvalId} not found`);
  }
  if (approval.status !== 'pending') {
    throw validation(`Approval already ${approval.status}; only pending approvals can be decided`);
  }

  const decided = {
    ...approval,
    status: decision,
    reviewedBy: reviewer.id,
    reviewedAt: nowIso(),
    notes: notes ?? approval.notes ?? null,
  };
  await repo.update('approval', decided);

  const all = await repo.list('approval', { projectId: approval.projectId });
  await setProjectGate(repo, approval.projectId, recomputeGateStatus(all));

  return { approval: decided, project: await repo.get('project', approval.projectId) };
}
