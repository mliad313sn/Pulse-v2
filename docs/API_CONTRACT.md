# OpsPM360 — API Contract (v3 — org admin, portfolios, project membership, enterprise access)

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
`security_reviewer`, `steering`), **isActive**, **mustChangePassword**,
**enterpriseAccess** (bool, default `true` — see Enterprise access below), createdAt.

- **VIEWER is hard read-only**: every mutating verb on every business endpoint → `403 FORBIDDEN`.
- Approval decisions require the **`security_reviewer` privilege** (not a base role — an ADMIN without it is denied).
- Project create requires `ADMIN` or `DIVISION_LEAD`.

### Project roles (E04)
`ProjectMember`: **{projectId, userId, role}** with role ∈
`PM|SPONSOR|WORKSTREAM_LEAD|CONTRIBUTOR|SME|FINANCE_CONTROLLER|SECURITY_REVIEWER|SITE_LEAD|AUDITOR|APPROVER|INFORMED`.

- Exactly **one PM per project** (may be none). POSTing a new member with role
  `PM` atomically swaps the incumbent out; both mutations are audited.
- **VIEWER users can never be `PM` or `WORKSTREAM_LEAD`** → `400 VALIDATION` (plan invariant 2).
- The PM gains project-scoped write authority (see Write policy).

### Write policy (E04 — replaces the v1 "any writer writes anything" model)
- **Manage-level** (`canManageProjectWork`): ADMIN, the project's **PM member**,
  or a **DIVISION_LEAD of the project's division** → project PATCH (except
  ADMIN-only classification), member management, and all task/roadblock writes.
- **Everyone else** (plain CONTRIBUTOR, DIVISION_LEAD of another division) may
  write a task/roadblock only when personally involved: task **assignee**,
  roadblock **reporter**, project **owner/sponsor**, or a **contributing
  member** (any project role except `INFORMED`/`AUDITOR`).
  Creating a task requires membership/ownership/management (self-assignment
  does not qualify); creating a roadblock is open to any writer who can READ
  the project (they become its reporter — 1-click field logging), but only
  managers may set `reportedBy` to someone else.
- Denials are `403 FORBIDDEN` (the project's existence is already known);
  unreadable projects still conceal with `404`.

## Admin user management (`ADMIN` only — everyone else 403)

| Endpoint | Behavior |
|---|---|
| `GET /api/users` | full directory incl. baseRole, privileges, isActive |
| `POST /api/users` `{name,email,division,site?,baseRole,privileges?}` | `201 {user, temporaryPassword}` — password generated server-side, `mustChangePassword=true`; the temp password is returned ONCE and never logged/audited |
| `PATCH /api/users/:id` `{baseRole?,privileges?,isActive?,division?,site?,enterpriseAccess?}` | `200 {user}`; deactivating (`isActive:false`) revokes all the user's sessions |
| `POST /api/users/:id/reset-password` | `200 {temporaryPassword}` — revokes sessions, sets `mustChangePassword` |
| `POST /api/users/:id/unlock` | `204` — clears the failure lockout |

## Classification & concealment (ADR-005, membership-based since E04)

`Project.classification`: `internal` (default) \| `restricted` \| `confidential`.

- **confidential** → readable by ADMIN, the owner, the sponsor, or **ANY
  project member**.
- **restricted** → the above OR users of the same division.
- **internal** → any active authenticated user.
- Unauthorized projects are **concealed**: direct GET/PATCH → the SAME
  `404 NOT_FOUND` as a truly absent id (never 403); absent from
  `GET /api/projects`, `/api/tasks` (their tasks hidden), `/api/roadblocks`,
  `/api/approvals`, `/api/bootstrap`, `/api/audit`, sync results, and the
  executive deck (built per requesting user).
- Only **ADMIN** may set/change `classification` (PATCH by others → `403`);
  non-ADMIN creators get it forced to `internal`.

## Enterprise access (E01, plan §8.2)

`User.enterpriseAccess` (bool, default `true`; ADMIN-editable via
`PATCH /api/users/:id`). When **false**, EVERY read path (projects, tasks,
roadblocks, approvals, bootstrap, audit, sync, executive deck) is additionally
filtered to projects that are:
- on the user's site (`project.site === user.site` **or** `project.sites[]`
  contains it), **or**
- projects where the user is a **member, owner, or sponsor**.

Concealment semantics are identical to classification: uniform `404`, absent
from all lists/counts/exports. Portfolio structures (pillars/portfolios/
programs) and org reference data are metadata and stay readable.

## Org administration (E01)

| Endpoint | Behavior |
|---|---|
| `GET /api/sites` · `GET /api/divisions` | `200 [{code, name, description}]` — any authenticated user |
| `POST /api/sites` · `POST /api/divisions` `{code, name, description?}` | `201` — **ADMIN only**; code must be a lowercase slug, unique → else `400` |
| `PATCH /api/sites/:code` · `PATCH /api/divisions/:code` `{code?, name?, description?}` | `200` — **ADMIN only**. name/description always editable; `code` rename allowed ONLY while unreferenced by any user/project/task → else `400 VALIDATION` |
| `GET /api/org/tree` | `200 {sites, divisions}` where each division carries `userCount` — any authenticated user (Admin Center overview) |

## Portfolio foundations (E04)

`StrategicPillar`: id, name, description (+ createdAt/updatedAt).
`Portfolio`: id, title, description, pillarId?, ownerId?, dateFrom?, dateTo? (ISO dates `YYYY-MM-DD`).
`Program`: id, title, objective?, **portfolioId** (required), ownerId?.

| Endpoint | Behavior |
|---|---|
| `GET /api/pillars` / `GET /api/pillars/:id` | any authenticated user |
| `POST /api/pillars` · `PATCH /api/pillars/:id` | **ADMIN only**; no DELETE |
| `GET /api/portfolios` / `:id` · `GET /api/programs` / `:id` (`?portfolioId=` filter) | any authenticated user |
| `POST`/`PATCH` portfolios & programs | **ADMIN or DIVISION_LEAD**; unknown pillarId/portfolioId/ownerId → `400 VALIDATION` |

PATCH on these structures is partial (no OCC `version` — they are
admin-managed reference data, not collaborative core objects); every mutation
is audited. No delete endpoints exist.

## Project membership endpoints (E04)

| Endpoint | Behavior |
|---|---|
| `GET /api/projects/:id/members` | `200 [{projectId, userId, role}]` — anyone who can read the project (else concealed 404) |
| `POST /api/projects/:id/members` `{userId, role}` | `201 {projectId, userId, role}` — **ADMIN, the project PM, or DIVISION_LEAD of the project's division**; role `PM` swaps the incumbent atomically (both audited); VIEWER as PM/WORKSTREAM_LEAD, unknown user, bad role, duplicate → `400 VALIDATION`; unauthorized manager → `403` |
| `DELETE /api/projects/:id/members/:userId/:role` | `204`; missing membership → `404` |

## Project codes & lifecycle (E04)

- `Project.code`: server-generated `PRJ-YYYY-NNN` (year of creation, sequence
  zero-padded to ≥3 digits), **unique and immutable**. Allocation is
  concurrency-safe (`project_code_sequences` row-locked inside the create
  transaction — never max()+1). Supplying `code` on create, or PATCHing it to
  a different value → `400 VALIDATION` (echoing the identical value is
  tolerated). Seed projects carry `PRJ-2026-001..003`.
- `Project.lifecycleStage`: `IDEA|INITIATION|PLANNING|EXECUTION|DEPLOYMENT|RUN|CLOSED`
  (default `IDEA`). THIS slice is data + validation only: a PATCH (or sync
  update) may move the stage exactly ONE step forward or backward — skips →
  `400 INVALID_LIFECYCLE_TRANSITION` with `detail {from, to}`. The G0–G5 gate
  engine lands in E05.
- `Project.operatingStatus`: `NOT_STARTED|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED`
  (default `NOT_STARTED`), freely movable (enum-validated).

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
| 400  | `INVALID_LIFECYCLE_TRANSITION` | lifecycleStage moved more than one step (`detail {from, to}`) |
| 400  | `VALIDATION`         | bad payload (incl. immutable `code`, VIEWER-as-PM, unknown refs) |

## Entities (JSON, camelCase over the wire)
`Project`: id, **code** (PRJ-YYYY-NNN, immutable), name, description,
division, site (primary), **sites[]** (additional site codes),
**engagedDivisions[]**, cgeitTag, strategicTag,
riskTags[], classification (`internal|restricted|confidential`),
overallStatus (`draft|active|at_risk|on_hold|complete`),
**lifecycleStage**, **operatingStatus**,
securityGateStatus (`not_required|pending|approved|rejected`), ownerId,
**portfolioId?**, **programId?**, **sponsorId?**,
**pmId** (derived — the single PM member's userId, or null),
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
| `GET /api/bootstrap` | `{ user, projects, tasks, roadblocks, approvals, pillars, portfolios, programs, serverTime }` — everything the client caches into IndexedDB (concealed projects and their children excluded; projects carry `pmId`) |
| `GET /api/projects` / `GET /api/projects/:id` | classification + enterprise-access filtered; concealed → uniform 404; projects carry derived `pmId` |
| `POST /api/projects` | create (ADMIN or DIVISION_LEAD); body = Project fields minus server-managed (`code` is generated); non-ADMIN classification forced `internal`; unknown portfolioId/programId/sponsorId/engagedDivisions/sites → 400 |
| `PATCH /api/projects/:id` | body must include `version` (the base version); OCC applies; requires manage-level authority (ADMIN/PM/division lead — else 403); classification change ADMIN-only (403); `code` immutable (400); lifecycleStage single-step (400 INVALID_LIFECYCLE_TRANSITION) |
| `GET /api/projects/:id/tasks` · `GET /api/tasks` | tasks incl. derived `locked`; tasks of concealed projects hidden |
| `GET /api/projects/:id/members` · `POST /api/projects/:id/members` · `DELETE /api/projects/:id/members/:userId/:role` | see Project membership endpoints |
| `POST /api/tasks` | create — manage-level, contributing member, or project owner/sponsor (else 403; VIEWER always 403) |
| `PATCH /api/tasks/:id` | body must include `version`; E04 write policy (403) + OCC + gate checks (409/423) |
| `GET /api/roadblocks` · `POST /api/roadblocks` | POST body: projectId, taskId?, description, severity? — any writer who can read the project (becomes reporter) |
| `PATCH /api/roadblocks/:id` | E04 write policy (reporter/owner/member/manage) + OCC as above |
| `GET /api/sites` · `/api/divisions` · `/api/org/tree` · `/api/pillars` · `/api/portfolios` · `/api/programs` (+ POST/PATCH) | see Org administration & Portfolio foundations |
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
  management, org/pillar admin and classification changes; ADMIN/DIVISION_LEAD
  project + portfolio/program create; E04 membership-based write policy on
  projects/tasks/roadblocks; one-PM-per-project with no VIEWER leads;
  immutable project codes; single-step lifecycle transitions;
  `security_reviewer`-privilege approval decisions; classification AND
  enterprise-access concealment on every read path.
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
6. At most one `PM` member per project (partial unique index); VIEWER users never hold PM/WORKSTREAM_LEAD (trigger backstop).
7. Project `code` is immutable after creation (trigger backstop) and allocated race-free per year.
8. `lifecycleStage` moves one step at a time (service-enforced; E05 replaces this with the real gate engine).
