// Hand-rolled IndexedDB wrapper (no libraries).
// Stores: projects, tasks, roadblocks, approvals, users, outbox, conflicts
// (legacy), blocked, meta, pillars, portfolios, programs, members, milestones,
// workstreams, dependencies, updates.

const DB_NAME = "opspm360";
// v2: added pillars/portfolios/programs/members (Wave 1 slice 2).
// v3: added milestones (Wave 2 governance).
// v4: added workstreams + dependencies (Wave 3 planning).
// v5: added updates (Wave 3 RAG health + project updates).
// v6: added blocked (Wave 3 offline-queue rework, ADR-003 — halt-on-failure
// sync). The legacy `conflicts` store is kept (empty after the one-shot boot
// migration in lib/sync.ts) so downgrades/old rows never break the upgrade.
// v7: added actions (offline outbox entity) + risks + capas (Wave 4 —
// risks/capas are online-only writes, cached read-only).
// onupgradeneeded only creates stores that are missing, so upgrades from any
// prior version are safe.
const DB_VERSION = 7;

export type StoreName =
  | "projects"
  | "tasks"
  | "roadblocks"
  | "approvals"
  | "users"
  | "outbox"
  | "conflicts"
  | "blocked"
  | "meta"
  | "pillars"
  | "portfolios"
  | "programs"
  | "members"
  | "milestones"
  | "workstreams"
  | "dependencies"
  | "updates"
  | "actions"
  | "risks"
  | "capas";

const STORE_KEYS: Record<StoreName, string> = {
  projects: "id",
  tasks: "id",
  roadblocks: "id",
  approvals: "id",
  users: "id",
  outbox: "opId",
  conflicts: "opId",
  blocked: "opId",
  meta: "key",
  pillars: "id",
  portfolios: "id",
  programs: "id",
  // ProjectMember has a composite identity (projectId+userId+role) — cached rows
  // carry a synthesized `mid` key (see lib/orgData.ts).
  members: "mid",
  milestones: "id",
  workstreams: "id",
  dependencies: "id",
  updates: "id",
  actions: "id",
  risks: "id",
  capas: "id",
};

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIDB(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

export function openDb(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      (Object.keys(STORE_KEYS) as StoreName[]).forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: STORE_KEYS[name] });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        let result: T;
        const req = run(t.objectStore(store));
        if (req) {
          req.onsuccess = () => {
            result = req.result;
          };
        }
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new Error("IndexedDB tx failed"));
        t.onabort = () => reject(t.error ?? new Error("IndexedDB tx aborted"));
      }),
  );
}

/** Run an IndexedDB operation, resolving to `fallback` when IDB is unavailable or fails. */
function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  if (!hasIDB()) return Promise.resolve(fallback);
  return fn().catch(() => fallback);
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return safe<T[]>([], () => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>));
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return safe<T | undefined>(undefined, () =>
    tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  );
}

export function put(store: StoreName, value: unknown): Promise<void> {
  return safe(undefined, () => tx(store, "readwrite", (s) => void s.put(value)));
}

/** Clear a store then write fresh values (used after /api/bootstrap). */
export function replaceAll(store: StoreName, values: unknown[]): Promise<void> {
  return safe(undefined, () =>
    tx(store, "readwrite", (s) => {
      s.clear();
      values.forEach((v) => s.put(v));
    }),
  );
}

export function del(store: StoreName, key: IDBValidKey): Promise<void> {
  return safe(undefined, () => tx(store, "readwrite", (s) => void s.delete(key)));
}

/** Delete many keys in a single transaction. */
export function bulkDel(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return safe(undefined, () =>
    tx(store, "readwrite", (s) => {
      keys.forEach((k) => s.delete(k));
    }),
  );
}

export function count(store: StoreName): Promise<number> {
  return safe(0, () => tx<number>(store, "readonly", (s) => s.count()));
}

// meta helpers ---------------------------------------------------------------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>("meta", key);
  return row?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await put("meta", { key, value });
}

export async function delMeta(key: string): Promise<void> {
  await del("meta", key);
}
