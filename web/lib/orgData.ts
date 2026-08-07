"use client";

// Lazy fetch + IndexedDB caches for the portfolio hierarchy (pillars, portfolios,
// programs), project members, and the org tree (sites/divisions).
//
// These entities are NOT part of /api/bootstrap: each page that needs them
// lazy-fetches on mount, rendering the IndexedDB cache first (consistent with
// the central store's offline-first reads). All admin/portfolio MUTATIONS are
// ONLINE-ONLY (like approval decisions) — they never touch the outbox.

import { useCallback, useEffect, useState } from "react";
import * as idb from "./db";
import { api, ApiError } from "./api";
import { useApp } from "./store";
import type {
  OrgDivision,
  OrgSite,
  OrgTree,
  Portfolio,
  Program,
  ProjectMember,
  StrategicPillar,
} from "./types";

// ---- tolerant response unwrapping ------------------------------------------

/** Accept both bare arrays and `{ <key>: [...] }` envelopes from the API. */
export function asArray<T>(res: unknown, key: string): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object") {
    const inner = (res as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

/** Accept both a bare entity and a `{ <key>: {...} }` envelope. */
export function asEntity<T>(res: unknown, key: string): T | null {
  if (!res || typeof res !== "object") return null;
  const inner = (res as Record<string, unknown>)[key];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as T;
  return Array.isArray(res) ? null : (res as T);
}

/** Human-friendly message for admin/portfolio API failures. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.code === "FORBIDDEN") return "Your role is not allowed to do that.";
    if (e.code === "VALIDATION") return e.message || "The server rejected the input — check the fields.";
    if (e.code === "GATE_REQUEST_PENDING") {
      return "A gate request is already pending for this project.";
    }
    return e.message || `Request failed (${e.code}).`;
  }
  return fallback;
}

// ---- generic cached list hook ----------------------------------------------

export interface CachedList<T> {
  items: T[];
  loading: boolean;
  /** Re-fetch from the network (no-op while offline — cache stays). */
  reload: () => Promise<void>;
}

type ListStore = "pillars" | "portfolios" | "programs";

function useCachedList<T extends { id: string }>(
  store: ListStore,
  path: string,
  envelopeKey: string,
): CachedList<T> {
  const { user, online } = useApp();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !online) return;
    try {
      const res = await api<unknown>(path);
      const list = asArray<T>(res, envelopeKey).filter((x) => x && typeof x.id === "string");
      await idb.replaceAll(store, list);
      setItems(list);
    } catch {
      // network/API failure — keep whatever the cache had
    }
  }, [user, online, path, envelopeKey, store]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idb.getAll<T>(store);
      if (!cancelled) {
        setItems(cached);
        setLoading(false);
      }
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, store]);

  return { items, loading, reload };
}

export function usePillars(): CachedList<StrategicPillar> {
  return useCachedList<StrategicPillar>("pillars", "/api/pillars", "pillars");
}

export function usePortfolios(): CachedList<Portfolio> {
  return useCachedList<Portfolio>("portfolios", "/api/portfolios", "portfolios");
}

export function usePrograms(): CachedList<Program> {
  return useCachedList<Program>("programs", "/api/programs", "programs");
}

// ---- project members --------------------------------------------------------

/** Cached member row — composite identity flattened into a single IDB key. */
export type CachedMember = ProjectMember & { mid: string };

export function memberKey(m: ProjectMember): string {
  return `${m.projectId}:${m.userId}:${m.role}`;
}

export interface MembersApi {
  members: ProjectMember[];
  loading: boolean;
  reload: () => Promise<void>;
  /** ONLINE-ONLY. Throws ApiError on failure. */
  addMember: (userId: string, role: ProjectMember["role"]) => Promise<void>;
  /** ONLINE-ONLY. Throws ApiError on failure. */
  removeMember: (userId: string, role: ProjectMember["role"]) => Promise<void>;
}

export function useProjectMembers(projectId: string): MembersApi {
  const { user, online } = useApp();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);

  const cacheReplace = useCallback(
    async (list: ProjectMember[]) => {
      // Replace only THIS project's rows in the shared members store.
      const all = await idb.getAll<CachedMember>("members");
      const stale = all.filter((m) => m.projectId === projectId).map((m) => m.mid);
      await idb.bulkDel("members", stale);
      for (const m of list) await idb.put("members", { ...m, mid: memberKey(m) });
    },
    [projectId],
  );

  const reload = useCallback(async () => {
    if (!user || !online) return;
    try {
      const res = await api<unknown>(`/api/projects/${projectId}/members`);
      const list = asArray<ProjectMember>(res, "members").filter(
        (m) => m && typeof m.userId === "string" && typeof m.role === "string",
      );
      const withProject = list.map((m) => ({ ...m, projectId: m.projectId || projectId }));
      await cacheReplace(withProject);
      setMembers(withProject);
    } catch {
      // keep cache
    }
  }, [user, online, projectId, cacheReplace]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await idb.getAll<CachedMember>("members");
      if (!cancelled) {
        setMembers(all.filter((m) => m.projectId === projectId));
        setLoading(false);
      }
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reload]);

  const addMember = useCallback(
    async (userId: string, role: ProjectMember["role"]) => {
      await api(`/api/projects/${projectId}/members`, { method: "POST", body: { userId, role } });
      await reload();
    },
    [projectId, reload],
  );

  const removeMember = useCallback(
    async (userId: string, role: ProjectMember["role"]) => {
      await api(`/api/projects/${projectId}/members/${userId}/${role}`, { method: "DELETE" });
      await reload();
    },
    [projectId, reload],
  );

  return { members, loading, reload, addMember, removeMember };
}

// ---- org tree (sites + divisions) ------------------------------------------

const ORG_TREE_META_KEY = "orgTree";

/** Flatten whatever shape /api/org/tree returns into { divisions, sites }. */
export function normalizeOrgTree(res: unknown): OrgTree {
  const empty: OrgTree = { divisions: [], sites: [] };
  if (!res || typeof res !== "object") return empty;
  const root = ((res as Record<string, unknown>).tree ?? res) as Record<string, unknown>;

  const normUnit = (raw: unknown): { id: string; name: string; rest: Record<string, unknown> } | null => {
    if (typeof raw === "string") return { id: raw, name: raw, rest: {} };
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const id = (o.id ?? o.code ?? o.key ?? o.name) as string | undefined;
      const name = (o.name ?? o.title ?? id) as string | undefined;
      if (typeof id === "string" && typeof name === "string") return { id, name, rest: o };
    }
    return null;
  };

  const divisions: OrgDivision[] = [];
  const sites: OrgSite[] = [];
  const seenSites = new Set<string>();
  const pushSite = (s: OrgSite) => {
    if (!seenSites.has(s.id)) {
      seenSites.add(s.id);
      sites.push(s);
    }
  };

  for (const raw of asArray<unknown>(root.divisions ?? root, "divisions")) {
    const u = normUnit(raw);
    if (!u) continue;
    const nested: OrgSite[] = [];
    for (const sRaw of asArray<unknown>(u.rest.sites, "sites")) {
      const su = normUnit(sRaw);
      if (!su) continue;
      const site: OrgSite = { ...su.rest, id: su.id, name: su.name, divisionId: u.id };
      nested.push(site);
      pushSite(site);
    }
    divisions.push({ ...u.rest, id: u.id, name: u.name, sites: nested });
  }
  for (const raw of asArray<unknown>(root.sites, "sites")) {
    const u = normUnit(raw);
    if (u) pushSite({ ...u.rest, id: u.id, name: u.name });
  }
  return { divisions, sites };
}

export interface OrgTreeApi {
  tree: OrgTree;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useOrgTree(): OrgTreeApi {
  const { user, online } = useApp();
  const [tree, setTree] = useState<OrgTree>({ divisions: [], sites: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !online) return;
    try {
      const res = await api<unknown>("/api/org/tree");
      const next = normalizeOrgTree(res);
      await idb.setMeta(ORG_TREE_META_KEY, next);
      setTree(next);
    } catch {
      // keep cache
    }
  }, [user, online]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idb.getMeta<OrgTree>(ORG_TREE_META_KEY);
      if (!cancelled) {
        if (cached) setTree(cached);
        setLoading(false);
      }
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { tree, loading, reload };
}
