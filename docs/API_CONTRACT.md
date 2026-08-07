# OpsPM360 — API Contract (v4 — gate engine G0–G5, approval ledger, milestones, computed progress)

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
| `GET /api/users` | read-only directory for ANY authenticated user (people pickers); credential fields stripped |
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

## Project codes & lifecycle (E04/E05)

- `Project.code`: server-generated `PRJ-YYYY-NNN` (year of creation, sequence
  zero-padded to ≥3 digits), **unique and immutable**. Allocation is
  concurrency-safe (`project_code_sequences` row-locked inside the create
  transaction — never max()+1). Supplying `code` on create, or PATCHing it to
  a different value → `400 VALIDATION` (echoing the identical value is
  tolerated). Seed projects carry `PRJ-2026-001..003`.
- `Project.lifecycleStage`: `IDEA|INITIATION|PLANNING|EXECUTION|DEPLOYMENT|RUN|CLOSED`
  (default `IDEA`). **Gate-governed since E05** (replaces the v3 one-step
  guard): direct PATCH/sync writes of `lifecycleStage` → `400 VALIDATION`
  ("use the gate process", `detail {from, to}`) with ONE exception — **ADMIN
  may move exactly one stage backward** (controlled correction; audited as
  `LIFECYCLE_CORRECTION` on top of the regular UPDATE row). Forward movement
  happens ONLY through gate requests + authorized decisions (below).
- `Project.operatingStatus`: `NOT_STARTED|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED`
  (default `NOT_STARTED`), enum-validated with transition rules (plan §12.2):
  - → `ON_HOLD` requires `holdReason` (in the same payload or already set),
    else `400 VALIDATION {field: "holdReason"}`;
  - → `CANCELLED` requires `cancelReason` likewise, and is **TERMINAL**: any
    later operating-status change → `400 VALIDATION`. Other fields stay
    editable on a cancelled project.

## Gate engine G0–G5 (E05, plan §13 — invariants 8-10)

Stage → gate: `IDEA`→G0, `INITIATION`→G1, `PLANNING`→G2, `EXECUTION`→G3,
`DEPLOYMENT`→G4, `RUN`→G5, `CLOSED`→none. Requirements (each evaluated
server-side at request time; wire shape `{key, label, satisfied, detail?}`):

| Gate | Transition | Requirement keys |
|---|---|---|
| G0 | IDEA→INITIATION | `title`, `description`, `sponsor`, `owner` |
| G1 | INITIATION→PLANNING | `description`, `sponsor`, `pm` (PM member exists), `targetDate`, `site` (site or sites[]), `division` |
| G2 | PLANNING→EXECUTION | `milestones` (≥1 non-cancelled), `team` (PM + ≥1 more member), `baseline` (startDate+targetDate), `acceptanceCriteria` — **steering approver required** |
| G3 | EXECUTION→DEPLOYMENT | `deploymentPlan`, `criticalRoadblocks` (no open critical roadblocks — severity `critical` & status ≠ `resolved`) |
| G4 | DEPLOYMENT→RUN | `goLive` (a GO_LIVE milestone with status DONE), `supportOwner` |
| G5 | RUN→CLOSED | `actualEndDate`, `closureSummary`, `openWork` (no open — todo/in_progress/blocked — tasks and no unresolved roadblocks, OR an explicit `dispositionNote` in the request) |

| Endpoint | Behavior |
|---|---|
| `GET /api/projects/:id/gates` | `200 {stage, nextStage, gate (G0..G5\|null), requirements[], steeringRequired, pendingRequest?}` — any reader (VIEWER included); concealed → 404 |
| `POST /api/projects/:id/gates/request` `{note?, dispositionNote?}` | `201` gateRequest — requester must have manage-level authority (403 otherwise); `422 GATE_REQUIREMENTS_NOT_MET` with `detail.missing[]` while unmet; `409 GATE_REQUEST_PENDING` if one is already open (partial unique index backstop); CLOSED project → `400` |
| `GET /api/gate-requests?status=PENDING` | requests of readable projects only |
| `POST /api/gate-requests/:id/decision` `{decision: 'APPROVED'\|'REJECTED', note?}` | `200 {gateRequest, project, ledgerEntry}` — see approver rules; APPROVED applies the lifecycle transition + appends the ledger entry in **one transaction**; REJECTED appends the ledger entry, stage unchanged; decided requests cannot be re-decided (`400`); stale request (stage moved since) → `400` |

`GateRequest`: {id, projectId, gate, fromStage, toStage, requestedBy,
requestedAt, note, dispositionNote, status (`PENDING|APPROVED|REJECTED`),
decidedBy, decidedAt, decisionNote}.

**Approver rules** (server-enforced, invariant 4 + 10):
- **G2** requires `privileges` to include `steering` — an **ADMIN without
  steering is DENIED** `403 STEERING_APPROVAL_REQUIRED`. Recorded authority:
  `STEERING`.
- Other gates: a steering holder (`STEERING`), ADMIN (`ADMIN`), or a
  DIVISION_LEAD of the project's division (`DIVISION_LEAD`); anyone else
  `403 FORBIDDEN`.
- The **requester can never decide their own request** → `403 FORBIDDEN`.
- Seed: Aminata Fall holds `steering`; Troy (ADMIN) does NOT — the separation
  is proven by tests.

## Approval ledger (E05, plan §14 — invariant 11)

`LedgerEntry`: {id, projectId, gate, fromStage, toStage, **projectVersion**
(the project's version at decision time, pre-transition), requestedBy,
requestedAt, decidedBy, decidedAt, authorityType
(`STEERING|ADMIN|DIVISION_LEAD`), decision (`APPROVED|REJECTED`), note,
createdAt}.

- `GET /api/projects/:id/ledger` → chronological entries (concealed → 404).
- **IMMUTABLE**: no update/delete endpoint exists anywhere; the DB trigger
  `trg_approval_ledger_immutable` forbids UPDATE/DELETE (like `audit_logs`);
  the MemoryRepo ledger is push-only with frozen entries.

## Milestones (E08 core)

`Milestone`: id, projectId, title, description?, type
(`STANDARD|SECURITY_GATE|SITE_READINESS|UAT|GO_LIVE|GOVERNANCE_GATE|OPERATIONAL_HANDOVER`,
default `STANDARD`), status (`NOT_STARTED|IN_PROGRESS|DONE|SLIPPED|CANCELLED`,
default `NOT_STARTED`), ownerId?, baselineDue?, forecastDue?,
actualCompleted? (all ISO dates `YYYY-MM-DD`), **weight** (integer ≥ 1,
default 1), version, updatedAt, createdAt.

| Endpoint | Behavior |
|---|---|
| `GET /api/projects/:id/milestones` | project's milestones (concealed → 404) |
| `GET /api/milestones` (`?projectId=`) | classification + enterprise-access filtered |
| `POST /api/milestones` | create — **manage-level authority** on the project (ADMIN/PM/division lead); VIEWER and non-managers 403; unknown projectId/ownerId, bad enum/weight/date → 400 |
| `PATCH /api/milestones/:id` | manage-level **OR the milestone owner**; OCC `version` required (400/409); concealed project → uniform 404 |

Milestones ride the offline sync protocol (`entity: "milestone"`) with the
same write policy, and appear in `GET /api/bootstrap` (concealment-filtered).

## Computed progress (E08, plan §23 — invariant 15)

Projects carry a derived, **never-writable** wire field:

```json
"progress": { "percent": 22, "completedWeight": 2, "activeWeight": 9,
              "explanation": "2 of 9 weighted milestone points complete (1/3 active milestones DONE; 1 cancelled excluded)" }
```

`percent = sum(weight of DONE non-CANCELLED) / sum(weight of non-CANCELLED) * 100`
(rounded to integer). CANCELLED milestones leave numerator AND denominator.
No milestones → `{percent: null, completedWeight: 0, activeWeight: 0,
explanation: "No milestones yet"}`; all cancelled → percent null. Attempts to
write `progress` are silently ignored (not a writable field). Appears on every
project read (list, detail, bootstrap, deck data).

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
| 422  | `GATE_REQUIREMENTS_NOT_MET` | gate request while requirements unmet (`detail.missing[]`) |
| 403  | `STEERING_APPROVAL_REQUIRED` | G2 decision without the `steering` privilege (even ADMIN) |
| 409  | `GATE_REQUEST_PENDING` | a gate request is already pending (`detail.pendingRequestId`) |
| 400  | `VALIDATION`         | bad payload (incl. immutable `code`, VIEWER-as-PM, unknown refs, direct `lifecycleStage` writes, missing cancel/hold reason) |

## Entities (JSON, camelCase over the wire)
`Project`: id, **code** (PRJ-YYYY-NNN, immutable), name, description,
division, site (primary), **sites[]** (additional site codes),
**engagedDivisions[]**, cgeitTag, strategicTag,
riskTags[], classification (`internal|restricted|confidential`),
overallStatus (`draft|active|at_risk|on_hold|complete`),
**lifecycleStage** (gate-governed), **operatingStatus** (transition rules),
securityGateStatus (`not_required|pending|approved|rejected`), ownerId,
**portfolioId?**, **programId?**, **sponsorId?**,
**startDate?**, **targetDate?**, **actualEndDate?** (ISO dates `YYYY-MM-DD`),
**acceptanceCriteria?**, **deploymentPlan?**, **supportOwnerId?**,
**closureSummary?**, **cancelReason?**, **holdReason?** (all nullable;
writable per manage-level policy; unknown supportOwnerId → 400),
**pmId** (derived — the single PM member's userId, or null),
**progress** (derived — see Computed progress; never writable),
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
| `GET /api/bootstrap` | `{ user, projects, tasks, roadblocks, approvals, milestones, pillars, portfolios, programs, serverTime }` — everything the client caches into IndexedDB (concealed projects and their children excluded; projects carry `pmId` + `progress`) |
| `GET /api/projects` / `GET /api/projects/:id` | classification + enterprise-access filtered; concealed → uniform 404; projects carry derived `pmId` |
| `POST /api/projects` | create (ADMIN or DIVISION_LEAD); body = Project fields minus server-managed (`code` is generated); non-ADMIN classification forced `internal`; unknown portfolioId/programId/sponsorId/engagedDivisions/sites → 400 |
| `PATCH /api/projects/:id` | body must include `version` (the base version); OCC applies; requires manage-level authority (ADMIN/PM/division lead — else 403); classification change ADMIN-only (403); `code` immutable (400); lifecycleStage gate-governed (400 VALIDATION except ADMIN one-step-backward); operatingStatus transition rules (see Project codes & lifecycle) |
| `GET /api/projects/:id/tasks` · `GET /api/tasks` | tasks incl. derived `locked`; tasks of concealed projects hidden |
| `GET /api/projects/:id/members` · `POST /api/projects/:id/members` · `DELETE /api/projects/:id/members/:userId/:role` | see Project membership endpoints |
| `GET /api/projects/:id/milestones` · `GET/POST /api/milestones` · `PATCH /api/milestones/:id` | see Milestones (E08 core) |
| `GET /api/projects/:id/gates` · `POST /api/projects/:id/gates/request` · `GET /api/gate-requests` · `POST /api/gate-requests/:id/decision` | see Gate engine (E05) |
| `GET /api/projects/:id/ledger` | see Approval ledger (immutable, read-only) |
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
    "entity": "task" | "project" | "roadblock" | "milestone",
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
  immutable project codes; gate-governed lifecycle transitions with
  `steering`-only G2 decisions and the immutable approval ledger;
  manage-or-owner milestone writes; computed (never-writable) progress;
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
8. `lifecycleStage` moves ONLY through the gate engine (G0–G5 requirements checked server-side at request time; approvals authority-checked; skips impossible). The single direct write is the audited ADMIN one-step-backward correction.
9. G2 (PLANNING→EXECUTION) decisions require the `steering` privilege — independent of ADMIN.
10. `approval_ledger` rows are immutable (no mutation endpoints; DB trigger forbids UPDATE/DELETE; MemoryRepo push-only).
11. At most one PENDING gate request per project (partial unique index backstop).
12. `operatingStatus` CANCELLED is terminal and requires `cancelReason`; ON_HOLD requires `holdReason`.
13. Project `progress` is computed from milestone weights — no write path exists.
