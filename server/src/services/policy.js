/**
 * Authorization policy — the single authority for "who may do what" (E03 core,
 * upgraded by E01/E04: project membership, enterprise access, org admin).
 *
 * Identity model (ADR-004): base roles ADMIN | DIVISION_LEAD | CONTRIBUTOR |
 * VIEWER plus privilege modifiers ('security_reviewer', 'steering').
 *
 * Project roles (E04, plan §8): membership rows {projectId, userId, role}.
 * Exactly one PM per project; the PM gains project-scoped write authority.
 *
 * Classification (ADR-005, upgraded to MEMBERSHIP-BASED):
 *   confidential -> ADMIN, owner, sponsor, or ANY project member;
 *   restricted   -> the above OR same division;
 *   internal     -> any active authenticated user.
 * Unauthorized confidential/restricted objects are CONCEALED: uniform 404
 * (same shape as a truly absent id) and filtered out of every list, count,
 * bootstrap, export and audit-by-entity read path.
 *
 * Enterprise access (E01, plan §8.2): a user with enterpriseAccess=false is
 * ADDITIONALLY restricted, on every read path and regardless of
 * classification, to projects on their own site (primary `site` match or
 * `sites[]` containing it) OR projects where they are member/owner/sponsor.
 * Concealment semantics are identical to classification (uniform 404).
 *
 * Operational writes (E04 — replaces the v1 "any writer writes anything"
 * model):
 *   canManageProjectWork: ADMIN, the project's PM member, or a DIVISION_LEAD
 *   of the project's division -> full writes on the project, its tasks and
 *   roadblocks (classification changes stay ADMIN-only).
 *   Everyone else (plain CONTRIBUTOR, DIVISION_LEAD of another division):
 *   tasks/roadblocks only when personally involved — task assignee, roadblock
 *   reporter, project owner, or a contributing project member (any role
 *   except INFORMED and AUDITOR). Creating a roadblock is open to any writer
 *   who can READ the project (they become its reporter — 1-click field
 *   logging); creating a task requires membership/ownership/management.
 *   VIEWER stays hard read-only at the API boundary.
 *
 * All functions are pure over (user, entity, members) and unit-testable.
 */
import { forbidden, notFound } from '../errors.js';

export const BASE_ROLES = ['ADMIN', 'DIVISION_LEAD', 'CONTRIBUTOR', 'VIEWER'];
export const PRIVILEGES = ['security_reviewer', 'steering'];
export const CLASSIFICATIONS = ['internal', 'restricted', 'confidential'];

/** Project roles (plan §8). */
export const PROJECT_ROLES = [
  'PM', 'SPONSOR', 'WORKSTREAM_LEAD', 'CONTRIBUTOR', 'SME', 'FINANCE_CONTROLLER',
  'SECURITY_REVIEWER', 'SITE_LEAD', 'AUDITOR', 'APPROVER', 'INFORMED',
];
/** Membership roles that do NOT grant operational write access. */
export const NON_CONTRIBUTING_ROLES = ['INFORMED', 'AUDITOR'];
/** Roles a VIEWER base-role user may never hold (plan invariant 2). */
export const LEAD_ROLES = ['PM', 'WORKSTREAM_LEAD'];

export const isAdmin = (user) => user?.baseRole === 'ADMIN';

export const hasPrivilege = (user, privilege) =>
  Array.isArray(user?.privileges) && user.privileges.includes(privilege);

/** Any mutation anywhere requires an active non-VIEWER account. */
export const canWrite = (user) =>
  user?.isActive === true && user?.baseRole !== 'VIEWER';

export const canCreateProject = (user) =>
  canWrite(user) && (user.baseRole === 'ADMIN' || user.baseRole === 'DIVISION_LEAD');

/** Approval decisions require the security_reviewer privilege (not a base role). */
export const canDecideApproval = (user) =>
  canWrite(user) && hasPrivilege(user, 'security_reviewer');

export const canManageUsers = (user) => isAdmin(user);

/** Only ADMIN may set or change a project's classification. */
export const canSetClassification = (user) => isAdmin(user);

/** Org structures (sites/divisions) and strategic pillars: ADMIN only. */
export const canManageOrg = (user) => canWrite(user) && isAdmin(user);

/** Portfolios and programs: ADMIN or DIVISION_LEAD (same as project create). */
export const canManagePortfolio = (user) => canCreateProject(user);

// ---- membership helpers ----------------------------------------------------

export const isMemberOf = (user, members = []) =>
  Array.isArray(members) && members.some((m) => m.userId === user?.id);

export const isPmOf = (user, members = []) =>
  Array.isArray(members) && members.some((m) => m.userId === user?.id && m.role === 'PM');

/** Member in any role that grants operational writes (not INFORMED/AUDITOR). */
export const isContributingMember = (user, members = []) =>
  Array.isArray(members) &&
  members.some((m) => m.userId === user?.id && !NON_CONTRIBUTING_ROLES.includes(m.role));

const isOwnerOrSponsor = (user, project) =>
  project?.ownerId === user?.id || project?.sponsorId === user?.id;

// ---- read access -----------------------------------------------------------

/** Enterprise-access scope (plan §8.2) — applies on top of classification. */
function inEnterpriseScope(user, project, members) {
  if (user.enterpriseAccess !== false) return true;
  if (isOwnerOrSponsor(user, project) || isMemberOf(user, members)) return true;
  if (!user.site) return false;
  return project.site === user.site || (project.sites ?? []).includes(user.site);
}

/**
 * Classification + enterprise-access read filter.
 * @param members the project's membership rows (E04).
 * @returns {boolean} whether `user` may know `project` exists.
 */
export function canReadProject(user, project, members = []) {
  if (!user || user.isActive === false || !project) return false;
  if (!inEnterpriseScope(user, project, members)) return false;
  const cls = project.classification ?? 'internal';
  if (cls === 'confidential') {
    return isAdmin(user) || isOwnerOrSponsor(user, project) || isMemberOf(user, members);
  }
  if (cls === 'restricted') {
    return isAdmin(user) || isOwnerOrSponsor(user, project)
      || isMemberOf(user, members) || project.division === user.division;
  }
  return true; // internal
}

/**
 * Concealment: throws the SAME 404 shape a truly absent project id produces
 * (never 403 — existence must not leak). `kind`/`id` shape the message so it
 * is byte-identical to the missing-entity message of the calling route.
 */
export function assertReadProject(user, project, kind = 'project', id = project?.id, members = []) {
  if (!canReadProject(user, project, members)) throw notFound(`${kind} ${id} not found`);
}

/**
 * Filters a project list down to what `user` may see (lists/counts/exports).
 * @param membersByProject Map projectId -> membership rows (E04); an empty
 *        map is safe but disables membership-based grants.
 */
export function filterReadableProjects(user, projects, membersByProject = new Map()) {
  return projects.filter((p) => canReadProject(user, p, membersByProject.get(p.id) ?? []));
}

/** Set of readable project ids — for filtering child collections. */
export function readableProjectIds(user, projects, membersByProject = new Map()) {
  return new Set(filterReadableProjects(user, projects, membersByProject).map((p) => p.id));
}

// ---- operational writes (E04) ----------------------------------------------

/**
 * Full project-scoped write authority: project PATCH (minus ADMIN-only
 * classification), member management, and any task/roadblock write.
 */
export function canManageProjectWork(user, project, members = []) {
  if (!canWrite(user) || !project) return false;
  if (isAdmin(user)) return true;
  if (user.baseRole === 'DIVISION_LEAD' && user.division === project.division) return true;
  return isPmOf(user, members);
}

/**
 * Task write for non-managers: personally involved or a contributing member.
 * `task` is null for creates (then membership/ownership is required — a
 * non-member cannot smuggle write access by self-assigning a new task).
 */
export function canWriteTask(user, project, task, members = []) {
  if (!canWrite(user)) return false;
  if (canManageProjectWork(user, project, members)) return true;
  if (isOwnerOrSponsor(user, project) || isContributingMember(user, members)) return true;
  return task != null && task.assigneeId === user.id;
}

/**
 * Milestone write (E08): manage-level authority OR the milestone's owner.
 * Creates (`milestone` null) require manage-level authority — a contributor
 * cannot mint a milestone and grant themselves write access by self-owning it.
 */
export function canWriteMilestone(user, project, milestone, members = []) {
  if (!canWrite(user)) return false;
  if (canManageProjectWork(user, project, members)) return true;
  return milestone != null && milestone.ownerId === user.id;
}

/**
 * Workstream write (E07): manage-level authority OR the workstream's lead.
 * Creates (`workstream` null) require manage-level authority — a contributor
 * cannot mint a workstream and grant themselves write access by self-leading.
 */
export function canWriteWorkstream(user, project, workstream, members = []) {
  if (!canWrite(user)) return false;
  if (canManageProjectWork(user, project, members)) return true;
  return workstream != null && workstream.leadId === user.id;
}

/**
 * Roadblock write for non-managers. Creates (`roadblock` null) are open to any
 * writer who can read the project — they become the reporter (field logging).
 */
export function canWriteRoadblock(user, project, roadblock, members = []) {
  if (!canWrite(user)) return false;
  if (canManageProjectWork(user, project, members)) return true;
  if (isOwnerOrSponsor(user, project) || isContributingMember(user, members)) return true;
  return roadblock == null || roadblock.reportedBy === user.id;
}

const POLICIES = {
  'project:create': {
    can: canCreateProject,
    message: 'Creating projects requires the ADMIN or DIVISION_LEAD base role',
  },
  'approval:decide': {
    can: canDecideApproval,
    message: "Only holders of the 'security_reviewer' privilege may resolve security approvals",
  },
  'user:manage': {
    can: canManageUsers,
    message: 'User management requires the ADMIN base role',
  },
  'classification:set': {
    can: canSetClassification,
    message: 'Only ADMIN may set or change a project classification',
  },
  'org:manage': {
    can: canManageOrg,
    message: 'Managing sites, divisions and strategic pillars requires the ADMIN base role',
  },
  'portfolio:manage': {
    can: canManagePortfolio,
    message: 'Managing portfolios and programs requires the ADMIN or DIVISION_LEAD base role',
  },
};

/** Throws the contract's 403 FORBIDDEN when `user` may not perform `action`. */
export function assertCan(user, action) {
  const policy = POLICIES[action];
  if (!policy) throw new Error(`Unknown policy action: ${action}`);
  if (!policy.can(user)) throw forbidden(policy.message);
}
