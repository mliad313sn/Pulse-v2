# OpsPM360 — Web (Next.js PWA)

Offline-first frontend for OpsPM360. Conforms to `docs/API_CONTRACT.md` (camelCase entities, OCC versioning, `POST /api/sync` offline protocol, 423 gate handling).

## Run

```bash
cd web
npm install
npm run dev          # http://localhost:3000 (dev)

npm run build        # production build
npm start            # serve production build on :3000
```

The service worker only registers in the production build (`npm run build && npm start`).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of the OpsPM360 API server |

Example: `NEXT_PUBLIC_API_URL=http://10.0.0.5:4000 npm run build` (it is inlined at build time).

## How it works

- **Login**: real authentication — `POST /api/auth/login` with email + password. The server sets an HttpOnly `ppm_session` cookie; the client never stores tokens and every request uses `credentials: 'include'`. `GET /api/auth/me` validates the session on boot; a 401 while online returns to the login screen, while offline the cached workspace stays available read-only until reconnect revalidates. Forced password changes (`mustChangePassword` / `403 PASSWORD_CHANGE_REQUIRED`) block the app with a change-password screen. Logout clears IndexedDB and localStorage caches.
- **Roles**: `baseRole` (ADMIN/DIVISION_LEAD/CONTRIBUTOR/VIEWER) + `privileges` (`security_reviewer`, `steering`). VIEWER sees a "Read-only" pill and no write affordances; approval decisions require `security_reviewer`. Restricted/confidential projects carry a classification badge.
- **Bootstrap**: after login, `GET /api/bootstrap` is cached wholesale into IndexedDB (`lib/db.ts` — stores: projects, tasks, roadblocks, approvals, users, outbox, blocked, meta, …).
- **Reads**: always render from IndexedDB first, then refresh from the network when online.
- **Writes**: optimistic to IndexedDB. Online writes go straight to `PATCH`/`POST` (OCC `version` in body); offline or failed writes are queued in the outbox with the contract's sync op shape (each op carries a strictly-increasing persisted `seq`) and flushed in order through `POST /api/sync` on reconnect (online event + 20s retry + after mutations).
- **Sync queue**: the server applies ops in order and halts at the first failure — that op moves into the persisted `blocked` store, a rose "Sync blocked — action needed" banner appears, and NOTHING else syncs until it is resolved at `/conflicts` (Sync queue page): per-field merge for version conflicts, retry/discard for other reasons. Discards are explicit, online-only, and audited via `POST /api/sync/discard`. Held ops stay listed read-only under "Waiting".
- **Gates**: `423 DEPENDENCY_LOCKED` / `SECURITY_GATE` show friendly toasts naming the prerequisite or gate (via sync they block the queue instead). Locked tasks are dimmed with a padlock and cannot be moved to in-progress/done.
- **Dashboards** adapt to the user's division: ops (Zen Mode), infra (dependency timeline), infosec (approvals queue), management (portfolio matrix + PPTX/PDF deck export), ea/data/bizapps (tagged portfolio).

## Pages

| Route | Purpose |
|---|---|
| `/` | Login screen (no session) or role-adaptive dashboard |
| `/projects/[id]` | Kanban (drag-and-drop + touch fallback), roadblocks, audit peek |
| `/approvals` | InfoSec approval queue (approve/reject with notes) |
| `/conflicts` | Sync queue (blocked-op resolution + waiting list) |

The app renders fully without the API server: cached data (or clean empty states) — never a crash.
