# OpsPM360 — API Contract (v2 — session auth + classification)

Shared contract between `server/` (Node.js/Express) and `web/` (Next.js PWA).
Both sides MUST conform to this document. Base URL: `http://localhost:4000/api`.

## Auth (server-side sessions — ADR-002)

Identity is a server-side session. The opaque token (32+ random bytes,
base64url; only its SHA-256 stored at rest) is carried either by the
HttpOnly cookie **`ppm_session`** or by **`Authorization: Bearer <token>`**.
Session TTL: `SESSION_TTL_HOURS` env (default 72h).

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/login` `{email, password}` | `200 {user, mustChangePassword}` + `Set-Cookie: ppm_session=<token>; HttpOnly; SameSite=Lax; Path=/`. Errors: `401 AUTH_FAILED` (same for unknown email and wrong password — no enumeration), `423 ACCOUNT_LOCKED` with `detail.retryAfterSeconds`, `403 ACCOUNT_DISABLED`, `429 RATE_LIMITED` |
| `POST /api/auth/logout` | `204` — deletes the session, clears the cookie (idempotent) |
| `GET /api/auth/me` | `200 {user}` \| `401 {error:"AUTH_REQUIRED"}` |
| `POST /api/auth/change-password` `{currentPassword, newPassword}` | `204`; validates current password; min length `PASSWORD_MIN_LENGTH` env (default 10); clears `mustChangePassword`; revokes all OTHER sessions. `400 VALIDATION` on wrong current / weak new |
| `POST /api/auth/revoke-all` | `204` — revokes ALL own sessions incl. the current one |
| `GET /api/auth/entra/login` | `302` to Microsoft Entra ID (SSO); `501 {error:"NOT_CONFIGURED"}` without the `AZURE_*` env vars |
| `GET /api/auth/entra/callback?code&state` | completes SSO, creates a normal session, `302 /`. Unknown/deactivated account → `403 ACCOUNT_DISABLED` |

Rules:
- Any protected endpoint without a valid session → `401 {error:"AUTH_REQUIRED"}` (expired/unknown token identical).
- While `mustChangePassword=true`, EVERY non-auth API call → `403 {error:"PASSWORD_CHANGE_REQUIRED"}` (the `/api/auth/*` endpoints keep working).
- Lockout: 5 failed logins within 15 min → locked 15 min (per user). Admin unlock clears it.
- Login rate limit: max 10/min per IP+email key (in-memory; Redis for multi-instance prod).
- Passwords and tokens are NEVER logged or audited. Auth lifecycle events (login/logout/lockout/reset/role-change/deactivation) ARE audited (metadata only).

## Identity model (ADR-004)

`User`: id, name, email, division, site, **baseRole**
(`ADMIN|DIVISION_LEAD|CONTRIBUTOR|VIEWER`), **privileges** (array; values:
`security_reviewer`, `steering`), **isActive**, **mustChangePassword**, createdAt.

- **VIEWER is hard read-only**: every mutating verb on every business endpoint → `403 FORBIDDEN`.
- Approval decisions require the **`security_reviewer` privilege** (not a base role — an ADMIN without it is denied).
- Project create requires `ADMIN` or `DIVISION_LEAD`.

## Admin user management (`ADMIN` only — everyone else 403)

| Endpoint | Behavior |
|---|---|
| `GET /api/users` | full directory incl. baseRole, privileges, isActive |
| `POST /api/users` `{name,email,division,site?,baseRole,privileges?}` | `201 {user, temporaryPassword}` — password generated server-side, `mustChangePassword=true`; the temp password is returned ONCE and never logged/audited |
| `PATCH /api/users/:id` `{baseRole?,privileges?,isActive?,division?,site?}` | `200 {user}`; deactivating (`isActive:false`) revokes all the user's sessions |
| `POST /api/users/:id/reset-password` | `200 {temporaryPassword}` — revokes sessions, sets `mustChangePassword` |
| `POST /api/users/:id/unlock` | `204` — clears the failure lockout |

## Classification & concealment (ADR-005)

`Project.classification`: `internal` (default) \| `restricted` \| `confidential`.

- **confidential** → readable only by ADMIN or the project owner.
- **restricted** → ADMIN, owner, or users of the same division.
- **internal** → any active authenticated user.
- Unauthorized projects are **concealed**: direct GET/PATCH → the SAME
  `404 NOT_FOUND` as a truly absent id (never 403); absent from
  `GET /api/projects`, `/api/tasks` (their tasks hidden), `/api/roadblocks`,
  `/api/approvals`, `/api/bootstrap`, `/api/audit`, sync results, and the
  executive deck (built per requesting user).
- Only **ADMIN** may set/change `classification` (PATCH by others → `403`);
  non-ADMIN creators get it forced to `internal`.
- Interim scope: until project membership (E04), access derives from
  ownership/division as above.

## Error envelope
```json
{ "error": "CODE", "message": "human readable", "detail": { } }
```
| HTTP | error code           | when                                                        |
|------|----------------------|-------------------------------------------------------------|
| 401  | `AUTH_REQUIRED`      | missing/invalid/expired session                             |
| 401  | `AUTH_FAILED`        | login failed (uniform: unknown email or wrong password)     |
| 423  | `ACCOUNT_LOCKED`     | login lockout; `detail.retryAfterSeconds`                   |
| 403  | `ACCOUNT_DISABLED`   | deactivated account attempting login/SSO                    |
| 429  | `RATE_LIMITED`       | login burst exceeded (10/min per IP+email)                  |
| 403  | `PASSWORD_CHANGE_REQUIRED` | non-auth call while mustChangePassword=true           |
| 501  | `NOT_CONFIGURED`     | SSO endpoints without Entra env configuration               |
| 403  | `FORBIDDEN`          | role/privilege not allowed (incl. every VIEWER write)       |
| 404  | `NOT_FOUND`          | entity missing OR concealed by classification               |
| 409  | `VERSION_CONFLICT`   | OCC mismatch on direct (online) update                      |
| 423  | `DEPENDENCY_LOCKED`  | task advance blocked by incomplete prerequisite             |
| 423  | `SECURITY_GATE`      | task advance blocked by pending InfoSec approval            |
| 400  | `VALIDATION`         | bad payload                                                 |

## Entities (JSON, camelCase over the wire)
`Project`: id, name, description, division, site, cgeitTag, strategicTag,
riskTags[], classification (`internal|restricted|confidential`),
overallStatus (`draft|active|at_risk|on_hold|complete`),
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

## Endpoints (business — all require a session; classification filter applies to every read)
| Method & path | Notes |
|---|---|
| `GET /api/bootstrap` | `{ user, projects, tasks, roadblocks, approvals, serverTime }` — everything the client caches into IndexedDB (concealed projects and their children excluded) |
| `GET /api/projects` / `GET /api/projects/:id` | classification-filtered; concealed → uniform 404 |
| `POST /api/projects` | create (ADMIN or DIVISION_LEAD); body = Project fields minus server-managed; non-ADMIN classification forced `internal` |
| `PATCH /api/projects/:id` | body must include `version` (the base version); OCC applies; classification change is ADMIN-only (403) |
| `GET /api/projects/:id/tasks` · `GET /api/tasks` | tasks incl. derived `locked`; tasks of concealed projects hidden |
| `POST /api/tasks` | create (any writer; VIEWER 403) |
| `PATCH /api/tasks/:id` | body must include `version`; OCC + gate checks (409/423) |
| `GET /api/roadblocks` · `POST /api/roadblocks` | POST body: projectId, taskId?, description, severity? |
| `PATCH /api/roadblocks/:id` | OCC as above |
| `GET /api/approvals?status=pending` | InfoSec queue (classification-filtered) |
| `POST /api/approvals/:id/decision` | body `{ decision: "approved"\|"rejected", notes? }`; requires the `security_reviewer` privilege; recomputes project securityGateStatus |
| `GET /api/audit?entityId=` | read-only audit trail (entries of concealed projects filtered) |
| `POST /api/sync` | offline batch — see below; ops against concealed entities reject as NOT_FOUND |
| `GET /api/reports/executive-deck?format=pptx\|pdf` | binary download; built FOR the requesting user (concealed projects excluded) |
| `GET /api/health` | `{ ok: true }` (public) |

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

## Scoping summary
- **Hard walls** (server-enforced): VIEWER read-only; ADMIN-only user
  management and classification changes; ADMIN/DIVISION_LEAD project create;
  `security_reviewer`-privilege approval decisions; classification
  concealment on every read path.
- **Presentation-level defaulting** (not a wall): `ops`-division users get
  their own site's tasks/roadblocks ordered first (tactical Zen Mode);
  `infosec` surfaces the pending approvals queue; `management` portfolio
  view + deck export.

## Governance invariants (enforced server-side AND in DB triggers)
1. OCC: every direct PATCH must carry `version`; mismatch → 409 with `serverState`.
2. A task with `dependencyLock` cannot move to `in_progress`/`done` until its prerequisite is `done` → 423 `DEPENDENCY_LOCKED`.
3. A project whose `securityGateStatus === "pending"` blocks all its tasks from advancing → 423 `SECURITY_GATE`.
4. Creating/updating a project or task with risk tag `network_alteration` (or `firewall_change`, `external_exposure`) auto-creates a pending `SecurityApproval` and flips the project gate to `pending` (DB trigger does this; server must re-read after write).
5. Every mutation is audit-logged; audit rows are immutable.
