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

export const unauthenticated = () =>
  new ApiError(401, 'UNAUTHENTICATED', 'Missing or unknown x-user-id header');

export const forbidden = (message = 'Role not allowed for this operation') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Entity not found') =>
  new ApiError(404, 'NOT_FOUND', message);

export const validation = (message = 'Bad payload', detail = undefined) =>
  new ApiError(400, 'VALIDATION', message, detail);

export const versionConflict = (serverState) =>
  new ApiError(409, 'VERSION_CONFLICT', 'Version mismatch: entity was modified concurrently', { serverState });

export const dependencyLocked = (detail = undefined) =>
  new ApiError(423, 'DEPENDENCY_LOCKED', 'Prerequisite task is not complete', detail);

export const securityGate = (detail = undefined) =>
  new ApiError(423, 'SECURITY_GATE', 'Project awaits InfoSec approval', detail);
