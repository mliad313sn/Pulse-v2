"use client";

// Central offline-first app store.
// - Reads render from IndexedDB first (instant), then refresh over the network.
// - Mutations apply optimistically to IndexedDB + state. When online they go
//   straight to PATCH/POST (OCC); when offline (or on network failure) they are
//   queued in the outbox and flushed through POST /api/sync.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as idb from "./db";
import { api, ApiError, USER_ID_KEY } from "./api";
import { enqueueOp, flushOutbox, outboxCount } from "./sync";
import { isGatedTransition, safeLocalGet, safeLocalRemove, safeLocalSet, uuid } from "./utils";
import { useToast } from "@/components/Toast";
import type {
  Bootstrap,
  ConflictEntry,
  Project,
  QueuedOp,
  Roadblock,
  RoadblockSeverity,
  RoadblockTarget,
  SecurityApproval,
  SyncEntity,
  Task,
  User,
} from "./types";

type EntityListKey = "projects" | "tasks" | "roadblocks";

// Doubles as the API path segment (`/api/${ENTITY_TO_LIST[entity]}/…`).
const ENTITY_TO_LIST: Record<SyncEntity, EntityListKey> = {
  project: "projects",
  task: "tasks",
  roadblock: "roadblocks",
};

export interface AppState {
  ready: boolean;
  user: User | null;
  users: User[];
  usersLoading: boolean;
  projects: Project[];
  tasks: Task[];
  roadblocks: Roadblock[];
  approvals: SecurityApproval[];
  conflicts: ConflictEntry[];
  online: boolean;
  syncing: boolean;
  outboxCount: number;
  refreshedAt: string | null;
  bootLoading: boolean;
  /** Target of the globally-rendered RoadblockSheet (null = closed). */
  roadblockTarget: RoadblockTarget | null;
}

/** Why a task is locked: pending security gate, or an unfinished prerequisite. */
export type LockedReason = { kind: "gate" | "dependency"; prereq?: Task };

export interface MutateOutcome {
  ok: boolean;
  queued?: boolean;
  code?: string;
}

interface AppActions {
  login: (user: User) => Promise<void>;
  logout: () => void;
  loadUsers: () => Promise<void>;
  moveTask: (taskId: string, status: Task["status"]) => Promise<MutateOutcome>;
  updateRoadblock: (id: string, fields: Partial<Roadblock>) => Promise<MutateOutcome>;
  createRoadblock: (input: {
    projectId: string;
    taskId?: string | null;
    description: string;
    severity: RoadblockSeverity;
  }) => Promise<MutateOutcome>;
  decideApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    notes?: string,
  ) => Promise<MutateOutcome>;
  resolveConflict: (opId: string, resolution: "server" | Record<string, unknown>) => Promise<void>;
  lockedReason: (task: Task) => LockedReason | null;
  lockedMessage: (task: Task) => string;
  openRoadblock: (target: RoadblockTarget) => void;
  closeRoadblock: () => void;
}

const INITIAL_STATE: AppState = {
  ready: false,
  user: null,
  users: [],
  usersLoading: false,
  projects: [],
  tasks: [],
  roadblocks: [],
  approvals: [],
  conflicts: [],
  online: true,
  syncing: false,
  outboxCount: 0,
  refreshedAt: null,
  bootLoading: false,
  roadblockTarget: null,
};

const AppCtx = createContext<(AppState & AppActions) | null>(null);

export function useApp(): AppState & AppActions {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

function looksLikeEntity(value: unknown): value is { id: string; version: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { push: toast } = useToast();
  const flushingRef = useRef(false);

  const patch = useCallback((partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    // Resolve once against stateRef and eagerly mirror the snapshot so async
    // callers (login -> refresh) that run before React commits still observe it.
    const next = {
      ...stateRef.current,
      ...(typeof partial === "function" ? partial(stateRef.current) : partial),
    };
    stateRef.current = next;
    setState(next);
  }, []);

  // ---- local entity helpers -------------------------------------------------

  const setEntity = useCallback(
    (listKey: EntityListKey, item: Project | Task | Roadblock) => {
      patch((prev) => ({ [listKey]: upsert(prev[listKey] as { id: string }[], item) }) as Partial<AppState>);
      void idb.put(listKey, item);
    },
    [patch],
  );

  const removeEntity = useCallback(
    (listKey: EntityListKey, id: string) => {
      patch((prev) => ({ [listKey]: (prev[listKey] as { id: string }[]).filter((x) => x.id !== id) }) as Partial<AppState>);
      void idb.del(listKey, id);
    },
    [patch],
  );

  // Single source of truth for WHY a task is locked (gate takes precedence).
  const lockedReason = useCallback((task: Task): LockedReason | null => {
    const s = stateRef.current;
    const project = s.projects.find((p) => p.id === task.projectId);
    if (project?.securityGateStatus === "pending") return { kind: "gate" };
    if (task.dependencyLock) {
      return { kind: "dependency", prereq: s.tasks.find((t) => t.id === task.dependencyLock) };
    }
    return null;
  }, []);

  const lockedMessage = useCallback(
    (task: Task): string => {
      const reason = lockedReason(task);
      if (reason?.kind === "gate") {
        return "Security gate: this project is awaiting InfoSec approval before its tasks can advance.";
      }
      if (reason?.kind === "dependency") {
        return reason.prereq
          ? `Locked: prerequisite "${reason.prereq.title}" must be marked done first.`
          : "Locked: a prerequisite task must be completed first.";
      }
      return "This task is locked by a governance gate.";
    },
    [lockedReason],
  );

  const openRoadblock = useCallback(
    (target: RoadblockTarget) => patch({ roadblockTarget: target }),
    [patch],
  );

  const closeRoadblock = useCallback(() => patch({ roadblockTarget: null }), [patch]);

  const friendlyError = useCallback(
    (code: string | null | undefined, entity: SyncEntity, entityId: string): string => {
      if (code === "DEPENDENCY_LOCKED") {
        const task = stateRef.current.tasks.find((t) => t.id === entityId);
        if (task?.dependencyLock) {
          const prereq = stateRef.current.tasks.find((t) => t.id === task.dependencyLock);
          if (prereq) return `Dependency lock: finish "${prereq.title}" before this task can advance.`;
        }
        return "Dependency lock: a prerequisite task is not done yet.";
      }
      if (code === "SECURITY_GATE") {
        return "Security gate: waiting on InfoSec approval for this project.";
      }
      if (code === "VERSION_CONFLICT") return "Someone else updated this first — refreshed to the latest version.";
      if (code === "FORBIDDEN") return "Your role is not allowed to do that.";
      if (code === "UNAUTHENTICATED") return "Session not recognized — pick your user again.";
      return `Change to ${entity} was rejected${code ? ` (${code})` : ""}.`;
    },
    [],
  );

  // ---- sync / flush ---------------------------------------------------------

  const refreshOutboxCount = useCallback(async () => {
    const n = await outboxCount();
    // Skip the patch when unchanged so idle polls don't re-render every consumer.
    if (stateRef.current.outboxCount !== n) patch({ outboxCount: n });
  }, [patch]);

  const flush = useCallback(async () => {
    const s = stateRef.current;
    if (!s.online || flushingRef.current || !s.user) return;
    const n = await outboxCount();
    if (stateRef.current.outboxCount !== n) patch({ outboxCount: n });
    if (n === 0) return;
    flushingRef.current = true;
    patch({ syncing: true });
    try {
      await flushOutbox({
        onApplied: (result, op) => {
          const listKey = ENTITY_TO_LIST[result.entity];
          if (looksLikeEntity(result.serverState)) {
            setEntity(listKey, result.serverState as unknown as Task);
          } else if (op) {
            const current = (stateRef.current[listKey] as { id: string; version: number }[]).find(
              (x) => x.id === result.entityId,
            );
            if (current) {
              const bumped = { ...current, version: (op.op === "create" ? 1 : op.baseVersion + 1) };
              setEntity(listKey, bumped as unknown as Task);
            }
          }
        },
        onConflict: async (op: QueuedOp, result) => {
          const entry: ConflictEntry = {
            opId: op.opId,
            entity: op.entity,
            entityId: op.entityId,
            fields: op.fields,
            clientUpdatedAt: op.clientUpdatedAt,
            serverState: (result.serverState ?? {}) as Record<string, unknown>,
            createdAt: new Date().toISOString(),
          };
          await idb.put("conflicts", entry);
          patch((prev) => ({ conflicts: [...prev.conflicts.filter((c) => c.opId !== entry.opId), entry] }));
          // Show canonical server state until the user merges.
          if (looksLikeEntity(result.serverState)) {
            setEntity(ENTITY_TO_LIST[op.entity], result.serverState as unknown as Task);
          }
          toast("A change conflicts with a newer server version — manual merge needed.", "warning");
        },
        onRejected: (op, result) => {
          if (looksLikeEntity(result.serverState)) {
            setEntity(ENTITY_TO_LIST[result.entity], result.serverState as unknown as Task);
          }
          toast(friendlyError(result.error, result.entity, result.entityId), "warning");
        },
      });
    } catch {
      // network failed mid-flush — outbox preserved, retry later
    } finally {
      flushingRef.current = false;
      const remaining = await outboxCount();
      patch({ syncing: false, outboxCount: remaining });
    }
  }, [patch, setEntity, toast, friendlyError]);

  // ---- bootstrap / refresh --------------------------------------------------

  const refresh = useCallback(async () => {
    const s = stateRef.current;
    if (!s.user || !s.online) return;
    try {
      const boot = await api<Bootstrap>("/api/bootstrap");
      // Rebase: keep optimistic fields for still-queued offline ops on top of fresh data.
      const queued = await idb.getAll<QueuedOp>("outbox");
      const rebase = <T extends { id: string }>(list: T[], entity: SyncEntity): T[] => {
        const ops = queued.filter((o) => o.entity === entity);
        if (ops.length === 0) return list;
        // Fold queued ops into per-entity field patches once, then merge in one pass.
        const fieldsById = new Map<string, Record<string, unknown>>();
        const createIds: string[] = [];
        for (const op of ops) {
          fieldsById.set(op.entityId, { ...fieldsById.get(op.entityId), ...op.fields });
          if (op.op === "create") createIds.push(op.entityId);
        }
        const present = new Set(list.map((x) => x.id));
        const next = list.map((item) =>
          fieldsById.has(item.id) ? ({ ...item, ...fieldsById.get(item.id) } as T) : item,
        );
        for (const id of createIds) {
          if (!present.has(id)) next.push({ id, version: 1, ...fieldsById.get(id) } as unknown as T);
        }
        return next;
      };
      const projects = rebase(boot.projects ?? [], "project");
      const tasks = rebase(boot.tasks ?? [], "task");
      const roadblocks = rebase(boot.roadblocks ?? [], "roadblock");
      const approvals = boot.approvals ?? [];
      await Promise.all([
        idb.replaceAll("projects", projects),
        idb.replaceAll("tasks", tasks),
        idb.replaceAll("roadblocks", roadblocks),
        idb.replaceAll("approvals", approvals),
        idb.setMeta("refreshedAt", boot.serverTime),
        boot.user ? idb.setMeta("currentUser", boot.user) : Promise.resolve(),
      ]);
      patch({
        projects,
        tasks,
        roadblocks,
        approvals,
        refreshedAt: boot.serverTime ?? new Date().toISOString(),
        user: boot.user ?? s.user,
        bootLoading: false,
      });
    } catch (e) {
      patch({ bootLoading: false });
      if (e instanceof ApiError && e.status === 401) {
        toast("Session not recognized — pick your user again.", "warning");
      }
      // network failure: stay on cache silently (offline-first)
    }
  }, [patch, toast]);

  const loadUsers = useCallback(async () => {
    patch({ usersLoading: true });
    try {
      const users = await api<User[]>("/api/users");
      await idb.replaceAll("users", users);
      patch({ users, usersLoading: false });
    } catch {
      patch({ usersLoading: false });
    }
  }, [patch]);

  const login = useCallback(
    async (user: User) => {
      safeLocalSet(USER_ID_KEY, user.id);
      await idb.setMeta("currentUser", user);
      patch({ user, bootLoading: true });
      await refresh();
      await flush();
    },
    [patch, refresh, flush],
  );

  const logout = useCallback(() => {
    safeLocalRemove(USER_ID_KEY);
    void idb.delMeta("currentUser");
    patch({ user: null });
    void loadUsers();
  }, [patch, loadUsers]);

  // ---- mutations ------------------------------------------------------------

  const mutateEntity = useCallback(
    async (entity: SyncEntity, entityId: string, fields: Record<string, unknown>): Promise<MutateOutcome> => {
      const listKey = ENTITY_TO_LIST[entity];
      const s = stateRef.current;
      const current = (s[listKey] as Array<Project | Task | Roadblock>).find((x) => x.id === entityId);
      if (!current) return { ok: false, code: "NOT_FOUND" };
      const baseVersion = current.version ?? 1;
      const optimistic = { ...current, ...fields, updatedAt: new Date().toISOString() };
      setEntity(listKey, optimistic as Task);

      const queueIt = async (): Promise<MutateOutcome> => {
        await enqueueOp({
          opId: uuid(),
          entity,
          entityId,
          op: "update",
          baseVersion,
          clientUpdatedAt: new Date().toISOString(),
          fields,
        });
        await refreshOutboxCount();
        return { ok: true, queued: true };
      };

      if (!stateRef.current.online) return queueIt();

      try {
        const res = await api<unknown>(`/api/${ENTITY_TO_LIST[entity]}/${entityId}`, {
          method: "PATCH",
          body: { ...fields, version: baseVersion },
        });
        if (looksLikeEntity(res)) {
          setEntity(listKey, res as unknown as Task);
        } else {
          setEntity(listKey, { ...optimistic, version: baseVersion + 1 } as Task);
        }
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 423) {
            setEntity(listKey, current as Task); // revert
            toast(friendlyError(e.code, entity, entityId), "warning");
            return { ok: false, code: e.code };
          }
          if (e.status === 409) {
            if (looksLikeEntity(e.serverState)) {
              setEntity(listKey, e.serverState as unknown as Task);
            } else {
              setEntity(listKey, current as Task);
            }
            toast(friendlyError("VERSION_CONFLICT", entity, entityId), "warning");
            return { ok: false, code: e.code };
          }
          if (e.status >= 400 && e.status < 500) {
            setEntity(listKey, current as Task);
            toast(e.message || `Request failed (${e.code})`, "error");
            return { ok: false, code: e.code };
          }
        }
        // Network/server unreachable → keep optimistic state and queue for sync.
        return queueIt();
      }
    },
    [setEntity, toast, friendlyError, refreshOutboxCount],
  );

  const moveTask = useCallback(
    async (taskId: string, status: Task["status"]): Promise<MutateOutcome> => {
      const task = stateRef.current.tasks.find((t) => t.id === taskId);
      if (!task) return { ok: false, code: "NOT_FOUND" };
      if (task.status === status) return { ok: true };
      if (isGatedTransition(task, status)) {
        toast(lockedMessage(task), "warning");
        return { ok: false, code: "LOCKED" };
      }
      return mutateEntity("task", taskId, { status });
    },
    [mutateEntity, toast, lockedMessage],
  );

  const updateRoadblock = useCallback(
    (id: string, fields: Partial<Roadblock>) => mutateEntity("roadblock", id, fields as Record<string, unknown>),
    [mutateEntity],
  );

  const createRoadblock = useCallback(
    async (input: {
      projectId: string;
      taskId?: string | null;
      description: string;
      severity: RoadblockSeverity;
    }): Promise<MutateOutcome> => {
      const s = stateRef.current;
      const now = new Date().toISOString();
      const id = uuid();
      const local: Roadblock = {
        id,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        description: input.description,
        severity: input.severity,
        status: "open",
        reportedBy: s.user?.id ?? null,
        version: 1,
        updatedAt: now,
        createdAt: now,
      };
      setEntity("roadblocks", local);

      const queueIt = async (): Promise<MutateOutcome> => {
        await enqueueOp({
          opId: uuid(),
          entity: "roadblock",
          entityId: id,
          op: "create",
          baseVersion: 0,
          clientUpdatedAt: now,
          fields: {
            projectId: input.projectId,
            taskId: input.taskId ?? null,
            description: input.description,
            severity: input.severity,
            status: "open",
            reportedBy: s.user?.id ?? null,
          },
        });
        await refreshOutboxCount();
        return { ok: true, queued: true };
      };

      if (!s.online) return queueIt();

      try {
        const res = await api<unknown>("/api/roadblocks", {
          method: "POST",
          body: {
            projectId: input.projectId,
            taskId: input.taskId ?? undefined,
            description: input.description,
            severity: input.severity,
          },
        });
        if (looksLikeEntity(res) && (res as { id: string }).id !== id) {
          removeEntity("roadblocks", id);
          setEntity("roadblocks", res as unknown as Roadblock);
        } else if (looksLikeEntity(res)) {
          setEntity("roadblocks", res as unknown as Roadblock);
        }
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          removeEntity("roadblocks", id);
          toast(e.message || "Could not log roadblock.", "error");
          return { ok: false, code: e.code };
        }
        return queueIt();
      }
    },
    [setEntity, removeEntity, toast, refreshOutboxCount],
  );

  const decideApproval = useCallback(
    async (
      approvalId: string,
      decision: "approved" | "rejected",
      notes?: string,
    ): Promise<MutateOutcome> => {
      const s = stateRef.current;
      if (!s.online) {
        toast("Approval decisions need a live connection to InfoSec systems.", "warning");
        return { ok: false, code: "OFFLINE" };
      }
      const current = s.approvals.find((a) => a.id === approvalId);
      if (!current) return { ok: false, code: "NOT_FOUND" };
      const optimistic: SecurityApproval = {
        ...current,
        status: decision,
        notes: notes ?? current.notes,
        reviewedBy: s.user?.id ?? null,
        reviewedAt: new Date().toISOString(),
      };
      patch((prev) => ({ approvals: upsert(prev.approvals, optimistic) }));
      void idb.put("approvals", optimistic);
      try {
        await api(`/api/approvals/${approvalId}/decision`, {
          method: "POST",
          body: { decision, notes: notes || undefined },
        });
        // Decision recomputes project securityGateStatus server-side — re-read.
        await refresh();
        toast(decision === "approved" ? "Approved — gate updated." : "Rejected — gate updated.", "success");
        return { ok: true };
      } catch (e) {
        patch((prev) => ({ approvals: upsert(prev.approvals, current) }));
        void idb.put("approvals", current);
        if (e instanceof ApiError) {
          toast(
            e.status === 403 ? "Only InfoSec security reviewers can resolve approvals." : e.message,
            "error",
          );
          return { ok: false, code: e.code };
        }
        toast("Network error — approval not recorded.", "error");
        return { ok: false, code: "NETWORK" };
      }
    },
    [patch, refresh, toast],
  );

  const resolveConflict = useCallback(
    async (opId: string, resolution: "server" | Record<string, unknown>) => {
      const entry = stateRef.current.conflicts.find((c) => c.opId === opId);
      if (!entry) return;
      const listKey = ENTITY_TO_LIST[entry.entity];
      if (resolution === "server") {
        if (looksLikeEntity(entry.serverState)) {
          setEntity(listKey, entry.serverState as unknown as Task);
        }
      } else {
        const serverVersion =
          typeof entry.serverState.version === "number" ? (entry.serverState.version as number) : 1;
        const merged = { ...entry.serverState, ...resolution, updatedAt: new Date().toISOString() };
        if (looksLikeEntity(merged)) setEntity(listKey, merged as unknown as Task);
        await enqueueOp({
          opId: uuid(),
          entity: entry.entity,
          entityId: entry.entityId,
          op: "update",
          baseVersion: serverVersion,
          clientUpdatedAt: new Date().toISOString(),
          fields: resolution,
        });
      }
      await idb.del("conflicts", opId);
      patch((prev) => ({ conflicts: prev.conflicts.filter((c) => c.opId !== opId) }));
      await refreshOutboxCount();
      if (resolution !== "server") await flush();
      toast("Merge resolved.", "success");
    },
    [patch, setEntity, flush, refreshOutboxCount, toast],
  );

  // ---- boot & connectivity --------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const online = typeof navigator !== "undefined" ? navigator.onLine : true;
      const [users, projects, tasks, roadblocks, approvals, conflicts, queuedCount, cachedUser, refreshedAt] =
        await Promise.all([
          idb.getAll<User>("users"),
          idb.getAll<Project>("projects"),
          idb.getAll<Task>("tasks"),
          idb.getAll<Roadblock>("roadblocks"),
          idb.getAll<SecurityApproval>("approvals"),
          idb.getAll<ConflictEntry>("conflicts"),
          outboxCount(),
          idb.getMeta<User>("currentUser"),
          idb.getMeta<string>("refreshedAt"),
        ]);
      if (cancelled) return;
      const storedId = safeLocalGet(USER_ID_KEY);
      const user: User | null = storedId
        ? users.find((u) => u.id === storedId) ?? cachedUser ?? null
        : null;
      patch({
        ready: true,
        online,
        users,
        projects,
        tasks,
        roadblocks,
        approvals,
        conflicts,
        outboxCount: queuedCount,
        user,
        refreshedAt: refreshedAt ?? null,
        bootLoading: Boolean(user) && projects.length === 0,
      });
      if (online) {
        if (user) {
          await flush();
          await refresh();
        }
        if (!user || users.length === 0) await loadUsers();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const goOnline = () => {
      patch({ online: true });
      void (async () => {
        await flush();
        await refresh();
      })();
    };
    const goOffline = () => patch({ online: false });
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      if (s.online && s.outboxCount > 0 && !s.syncing) void flush();
    }, 20000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(interval);
    };
  }, [patch, flush, refresh]);

  const value = useMemo<AppState & AppActions>(
    () => ({
      ...state,
      login,
      logout,
      loadUsers,
      moveTask,
      updateRoadblock,
      createRoadblock,
      decideApproval,
      resolveConflict,
      lockedReason,
      lockedMessage,
      openRoadblock,
      closeRoadblock,
    }),
    [
      state,
      login,
      logout,
      loadUsers,
      moveTask,
      updateRoadblock,
      createRoadblock,
      decideApproval,
      resolveConflict,
      lockedReason,
      lockedMessage,
      openRoadblock,
      closeRoadblock,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
