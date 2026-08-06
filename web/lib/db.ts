// Hand-rolled IndexedDB wrapper (no libraries).
// Stores: projects, tasks, roadblocks, approvals, users, outbox, conflicts, meta.

const DB_NAME = "opspm360";
const DB_VERSION = 1;

export type StoreName =
  | "projects"
  | "tasks"
  | "roadblocks"
  | "approvals"
  | "users"
  | "outbox"
  | "conflicts"
  | "meta";

const STORE_KEYS: Record<StoreName, string> = {
  projects: "id",
  tasks: "id",
  roadblocks: "id",
  approvals: "id",
  users: "id",
  outbox: "opId",
  conflicts: "opId",
  meta: "key",
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

export async function getAll<T>(store: StoreName): Promise<T[]> {
  if (!hasIDB()) return [];
  try {
    return await tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
  } catch {
    return [];
  }
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  if (!hasIDB()) return undefined;
  try {
    return await tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
  } catch {
    return undefined;
  }
}

export async function put(store: StoreName, value: unknown): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx(store, "readwrite", (s) => void s.put(value));
  } catch {
    /* best-effort cache */
  }
}

export async function bulkPut(store: StoreName, values: unknown[]): Promise<void> {
  if (!hasIDB() || values.length === 0) return;
  try {
    await tx(store, "readwrite", (s) => {
      values.forEach((v) => s.put(v));
    });
  } catch {
    /* best-effort cache */
  }
}

/** Clear a store then write fresh values (used after /api/bootstrap). */
export async function replaceAll(store: StoreName, values: unknown[]): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx(store, "readwrite", (s) => {
      s.clear();
      values.forEach((v) => s.put(v));
    });
  } catch {
    /* best-effort cache */
  }
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx(store, "readwrite", (s) => void s.delete(key));
  } catch {
    /* best-effort */
  }
}

export async function clear(store: StoreName): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx(store, "readwrite", (s) => void s.clear());
  } catch {
    /* best-effort */
  }
}

export async function count(store: StoreName): Promise<number> {
  if (!hasIDB()) return 0;
  try {
    return await tx<number>(store, "readonly", (s) => s.count());
  } catch {
    return 0;
  }
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
