/**
 * Typed API errors mapped 1:1 to the contract's error table.
 * The error middleware serializes these as { error, message, detail }.
 */
export class ApiError extends Error {
  constructor(status, code, message, detail = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const authRequired = () =>
  new ApiError(401, 'AUTH_REQUIRED', 'Missing, invalid or expired session');

/** Uniform login failure — identical for unknown email and wrong password (no enumeration). */
export const authFailed = () =>
  new ApiError(401, 'AUTH_FAILED', 'Invalid email or password');

export const accountLocked = (retryAfterSeconds) =>
  new ApiError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failures', { retryAfterSeconds });

export const accountDisabled = () =>
  new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');

export const rateLimited = () =>
  new ApiError(429, 'RATE_LIMITED', 'Too many attempts, slow down');

export const passwordChangeRequired = () =>
  new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required before using the API');

export const notConfigured = (message = 'This provider is not configured') =>
  new ApiError(501, 'NOT_CONFIGURED', message);

export const forbidden = (message = 'Role not allowed for this operation') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Entity not found') =>
  new ApiError(404, 'NOT_FOUND', message);

export const validation = (message = 'Bad payload', detail = undefined) =>
  new ApiError(400, 'VALIDATION', message, detail);

export const versionConflict = (serverState) =>
  new ApiError(409, 'VERSION_CONFLICT', 'Version mismatch: entity was modified concurrently', { serverState });

/** E05: gate request refused because entry requirements are unmet (422). */
export const gateRequirementsNotMet = (missing) =>
  new ApiError(422, 'GATE_REQUIREMENTS_NOT_MET',
    'Gate requirements are not met', { missing });

/** E05: G2 (PLANNING -> EXECUTION) decisions demand the steering privilege — even from ADMIN. */
export const steeringApprovalRequired = () =>
  new ApiError(403, 'STEERING_APPROVAL_REQUIRED',
    'PLANNING -> EXECUTION requires an authorized Steering Committee approver (steering privilege)');

/** E05: only one PENDING gate request may exist per project. */
export const gateRequestPending = (pendingRequestId) =>
  new ApiError(409, 'GATE_REQUEST_PENDING',
    'A gate request is already pending for this project', { pendingRequestId });

export const dependencyLocked = (detail = undefined) =>
  new ApiError(423, 'DEPENDENCY_LOCKED', 'Prerequisite task is not complete', detail);

export const securityGate = (detail = undefined) =>
  new ApiError(423, 'SECURITY_GATE', 'Project awaits InfoSec approval', detail);
