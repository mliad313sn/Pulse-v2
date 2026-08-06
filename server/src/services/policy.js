/**
 * Role policy — the single authority for "who may do what".
 * Route handlers and services call assertCan(user, action) instead of
 * hand-rolling role checks.
 */
import { forbidden } from '../errors.js';

const POLICIES = {
  'project:create': {
    roles: ['division_lead', 'group_manager'],
    message: 'Creating projects requires division_lead or group_manager role',
  },
  'approval:decide': {
    roles: ['security_reviewer'],
    message: 'Only InfoSec (security_reviewer role) may resolve security approvals',
  },
};

/** Throws the contract's 403 FORBIDDEN when `user` may not perform `action`. */
export function assertCan(user, action) {
  const policy = POLICIES[action];
  if (!policy) throw new Error(`Unknown policy action: ${action}`);
  if (!policy.roles.includes(user?.role)) throw forbidden(policy.message);
}
