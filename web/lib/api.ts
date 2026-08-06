// Thin fetch wrapper conforming to the API contract:
// - base URL from NEXT_PUBLIC_API_URL (default http://localhost:4000)
// - every request carries x-user-id
// - error envelope { error, message, detail } surfaced as ApiError

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export const USER_ID_KEY = "opspm360:userId";

export function currentUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}

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

interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  userId?: string | null;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const userId = opts.userId ?? currentUserId();
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (userId) headers["x-user-id"] = userId;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error */
    }
    const detail = payload.detail as Record<string, unknown> | undefined;
    const serverState =
      (payload.serverState as Record<string, unknown> | undefined) ??
      (detail?.serverState as Record<string, unknown> | undefined) ??
      null;
    throw new ApiError(
      res.status,
      (payload.error as string) || `HTTP_${res.status}`,
      (payload.message as string) || res.statusText,
      payload.detail,
      serverState,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Binary download (executive deck). Returns a Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const userId = currentUserId();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: userId ? { "x-user-id": userId } : {},
  });
  if (!res.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await res.json()) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status,
      (payload.error as string) || `HTTP_${res.status}`,
      (payload.message as string) || res.statusText,
      payload.detail,
    );
  }
  return res.blob();
}
