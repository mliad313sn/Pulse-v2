# OpsPM360 — API Contract (v1)

Shared contract between `server/` (Node.js/Express) and `web/` (Next.js PWA).
Both sides MUST conform to this document. Base URL: `http://localhost:4000/api`.

## Auth (demo-grade)
Every request carries `x-user-id: <uuid>`. The server resolves the user and
derives `division`, `site`, `role`. `GET /api/users` lists selectable demo users.
Missing/unknown header → `401 { error: "UNAUTHENTICATED" }`.

## Error envelope
```json
{ "error": "CODE", "message": "human readable", "detail": { } }
```
| HTTP | error code           | when                                                        |
|------|----------------------|-------------------------------------------------------------|
| 401  | `UNAUTHENTICATED`    | missing/unknown x-user-id                                   |
| 403  | `FORBIDDEN`          | role not allowed (e.g. non-InfoSec resolving approval)      |
| 404  | `NOT_FOUND`          | entity missing                                              |
| 409  | `VERSION_CONFLICT`   | OCC mismatch on direct (online) update                      |
| 423  | `DEPENDENCY_LOCKED`  | task advance blocked by incomplete prerequisite             |
| 423  | `SECURITY_GATE`      | task advance blocked by pending InfoSec approval            |
| 400  | `VALIDATION`         | bad payload                                                 |

## Entities (JSON, camelCase over the wire)
`Project`: id, name, description, division, site, cgeitTag, strategicTag,
riskTags[], overallStatus (`draft|active|at_risk|on_hold|complete`),
securityGateStatus (`not_required|pending|approved|rejected`), ownerId,
version, updatedAt, createdAt.

`Task`: id, projectId, title, description, division, site, assigneeId,
status (`todo|in_progress|blocked|done`), priority (`low|normal|high|critical`),
dependencyLock (taskId|null), riskTags[], slaDueAt, version, updatedAt, createdAt.
Server adds derived field **`locked: boolean`** (prerequisite not done OR project
security gate pending).

`Roadblock`: id, projectId, taskId, description, severity
(`low|medium|high|critical`), status (`open|mitigating|resolved`), reportedBy,
version, updatedAt, createdAt.

`SecurityApproval`: id, projectId, taskId, riskTag, status
(`pending|approved|rejected`), requestedAt, reviewedBy, reviewedAt, notes.

## Endpoints
| Method & path | Notes |
|---|---|
| `GET /api/users` | demo user directory (for the role switcher) |
| `GET /api/bootstrap` | `{ user, projects, tasks, roadblocks, approvals, serverTime }` — everything the client caches into IndexedDB |
| `GET /api/projects` / `GET /api/projects/:id` | list respects role scoping (see below) |
| `POST /api/projects` | create (division_lead+); body = Project fields minus server-managed |
| `PATCH /api/projects/:id` | body must include `version` (the base version); OCC applies |
| `GET /api/projects/:id/tasks` · `GET /api/tasks` | tasks incl. derived `locked` |
| `POST /api/tasks` | create |
| `PATCH /api/tasks/:id` | body must include `version`; OCC + gate checks (409/423) |
| `GET /api/roadblocks` · `POST /api/roadblocks` | POST body: projectId, taskId?, description, severity? |
| `PATCH /api/roadblocks/:id` | OCC as above |
| `GET /api/approvals?status=pending` | InfoSec queue |
| `POST /api/approvals/:id/decision` | body `{ decision: "approved"\|"rejected", notes? }`; security_reviewer only; recomputes project securityGateStatus |
| `GET /api/audit?entityId=` | read-only audit trail |
| `POST /api/sync` | offline batch — see below |
| `GET /api/reports/executive-deck?format=pptx\|pdf` | binary download; groups active projects by division with status, blockers, next actions |
| `GET /api/health` | `{ ok: true }` |

## Offline sync protocol (`POST /api/sync`)
Request:
```json
{ "clientId": "device-uuid", "operations": [ {
    "opId": "client-generated-uuid",
    "entity": "task" | "project" | "roadblock",
    "entityId": "uuid",
    "op": "update" | "create",
    "baseVersion": 3,
    "clientUpdatedAt": "2026-08-06T10:00:00Z",
    "fields": { "status": "done" }
} ] }
```
Server behavior per operation (each is queued into `sync_queue`, then processed):
1. `create` → insert, result `applied`.
2. `update` with `baseVersion === server.version` → apply, `version+1`, result `applied`.
3. `baseVersion < server.version` (concurrent edit) → **Last-Write-Wins** on
   `clientUpdatedAt` vs server `updatedAt`:
   - client newer → apply fields, `version = server.version + 1`, result `lww_applied`.
   - server newer → do NOT apply; result `conflict_manual`; response includes
     `serverState` so the client can offer a manual merge to the project owner.
4. Gate violations (dependency/security) during sync → result `rejected` with
   the same error codes as PATCH.

Response:
```json
{ "results": [ { "opId": "...", "result": "applied|lww_applied|conflict_manual|rejected",
                 "entity": "task", "entityId": "...", "serverState": { }, "error": null } ],
  "serverTime": "..." }
```

## Role scoping (contextual dashboards)
- `ops` / site roles → tasks & roadblocks filtered to their `site` first (tactical Zen Mode).
- `infra` → dependency/timeline view across sites.
- `infosec` → pending approvals queue surfaced first.
- `management` → portfolio health for all divisions + deck export button.
- `data` → read-everything (BI).
- Everyone can read all projects; scoping is presentation-level defaulting, not a hard wall (except approval decisions: security_reviewer only).

## Governance invariants (enforced server-side AND in DB triggers)
1. OCC: every direct PATCH must carry `version`; mismatch → 409 with `serverState`.
2. A task with `dependencyLock` cannot move to `in_progress`/`done` until its prerequisite is `done` → 423 `DEPENDENCY_LOCKED`.
3. A project whose `securityGateStatus === "pending"` blocks all its tasks from advancing → 423 `SECURITY_GATE`.
4. Creating/updating a project or task with risk tag `network_alteration` (or `firewall_change`, `external_exposure`) auto-creates a pending `SecurityApproval` and flips the project gate to `pending` (DB trigger does this; server must re-read after write).
5. Every mutation is audit-logged; audit rows are immutable.
