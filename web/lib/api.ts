// Thin fetch wrapper conforming to the API contract:
// - base URL from NEXT_PUBLIC_API_URL (default http://localhost:4000)
// - session cookie auth (ppm_session, HttpOnly) — every request sends credentials
//   and the client NEVER stores tokens
// - error envelope { error, message, detail } surfaced as ApiError
// - 401 AUTH_REQUIRED / 403 PASSWORD_CHANGE_REQUIRED handled in ONE place: the
//   store registers an auth-signal handler that transitions the session state.

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: unknown;
  serverState?: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    detail?: unknown,
    serverState?: Record<string, unknown> | null,
  ) {
    super(message || code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.serverState = serverState;
  }
}

export type AuthSignal = "unauthenticated" | "password-change";

let authSignalHandler: ((signal: AuthSignal) => void) | null = null;

/** The store registers here — single place any 401/forced-change is routed through. */
export function setAuthSignalHandler(handler: ((signal: AuthSignal) => void) | null): void {
  authSignalHandler = handler;
}

interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

/** Parse the error envelope ({ error, message, detail }), emit auth signals, throw ApiError. */
async function throwApiError(res: Response): Promise<never> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error */
  }
  const code = (payload.error as string) || `HTTP_${res.status}`;
  const detail = payload.detail as Record<string, unknown> | undefined;
  const serverState =
    (payload.serverState as Record<string, unknown> | undefined) ??
    (detail?.serverState as Record<string, unknown> | undefined) ??
    null;

  // Session-level signals (any endpoint may return these). AUTH_FAILED (bad
  // credentials on login) is intentionally NOT a signal.
  if (res.status === 401 && code === "AUTH_REQUIRED") authSignalHandler?.("unauthenticated");
  if (res.status === 403 && code === "PASSWORD_CHANGE_REQUIRED") authSignalHandler?.("password-change");

  throw new ApiError(res.status, code, (payload.message as string) || res.statusText, payload.detail, serverState);
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) return throwApiError(res);

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Binary download (executive deck). Returns a Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) return throwApiError(res);
  return res.blob();
}
