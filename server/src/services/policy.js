/**
 * Authorization policy — the single authority for "who may do what" (E03 core).
 *
 * Identity model (ADR-004): base roles ADMIN | DIVISION_LEAD | CONTRIBUTOR |
 * VIEWER plus privilege modifiers ('security_reviewer', 'steering').
 *
 * Classification (ADR-005, INTERIM until project membership lands in E04):
 * project read access is derived from ownership/division only —
 *   confidential -> ADMIN or owner; restricted -> ADMIN, owner or same
 *   division; internal -> any active authenticated user.
 * Unauthorized confidential/restricted objects are CONCEALED: uniform 404
 * (same shape as a truly absent id) and filtered out of every list, count,
 * bootstrap, export and audit-by-entity read path. When E04 introduces
 * project membership these functions gain a membership check — call sites
 * stay unchanged.
 *
 * All functions are pure over (user, entity) and unit-testable.
 */
import { forbidden, notFound } from '../errors.js';

export const BASE_ROLES = ['ADMIN', 'DIVISION_LEAD', 'CONTRIBUTOR', 'VIEWER'];
export const PRIVILEGES = ['security_reviewer', 'steering'];
export const CLASSIFICATIONS = ['internal', 'restricted', 'confidential'];

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

/**
 * Classification read filter (interim scope — see module docblock).
 * @returns {boolean} whether `user` may know `project` exists.
 */
export function canReadProject(user, project) {
  if (!user || user.isActive === false || !project) return false;
  const cls = project.classification ?? 'internal';
  if (cls === 'confidential') {
    return isAdmin(user) || project.ownerId === user.id;
  }
  if (cls === 'restricted') {
    return isAdmin(user) || project.ownerId === user.id || project.division === user.division;
  }
  return true; // internal
}

/**
 * Concealment: throws the SAME 404 shape a truly absent project id produces
 * (never 403 — existence must not leak). `kind`/`id` shape the message so it
 * is byte-identical to the missing-entity message of the calling route.
 */
export function assertReadProject(user, project, kind = 'project', id = project?.id) {
  if (!canReadProject(user, project)) throw notFound(`${kind} ${id} not found`);
}

/** Filters a project list down to what `user` may see (lists/counts/exports). */
export function filterReadableProjects(user, projects) {
  return projects.filter((p) => canReadProject(user, p));
}

/** Set of readable project ids — for filtering child collections. */
export function readableProjectIds(user, projects) {
  return new Set(filterReadableProjects(user, projects).map((p) => p.id));
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
};

/** Throws the contract's 403 FORBIDDEN when `user` may not perform `action`. */
export function assertCan(user, action) {
  const policy = POLICIES[action];
  if (!policy) throw new Error(`Unknown policy action: ${action}`);
  if (!policy.can(user)) throw forbidden(policy.message);
}
