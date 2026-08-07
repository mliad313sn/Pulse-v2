# Execution Status

Updated: 2026-08-07 (Wave 1 complete; Wave 2 governance slice COMPLETE; Wave 3 E07-core
server slice COMPLETE and verified)

## Where we are

- **Baseline**: OpsPM360 v1 complete and green (30 server tests, prod web build, docker-compose).
  It satisfies the OLD blueprint (docs/BLUEPRINT.md), not the master plan.
- **Master plan adopted**: `PROJECT_MASTER_PLAN.md` + `.claude/skills/goal/SKILL.md` are now in-repo
  and authoritative. Traceability initialized (all 31 epics mapped, mostly NOT_STARTED/PARTIAL).
- **Current wave**: Wave 1 (E00–E04), starting with the identity/access vertical (E02+E03 core)
  because every later epic depends on real users, sessions, base roles, and the policy engine.

## Completed slice: Identity & Access Foundation (E02 + E03 core) — DONE

Verified: server 67/67 tests (13 suites) · web typed build clean · live E2E smoke
(login cookie flow, confidential concealment for unauthorized user, VIEWER 403 on
writes + read-only UI, lockout at 5th failure). Contract: docs/API_CONTRACT.md v2.
Seed dev credentials in server/README.md (Dev!<Firstname>2026).

Scope delivered:
1. Schema migration `db/init/` → users gain base_role (ADMIN/DIVISION_LEAD/CONTRIBUTOR/VIEWER),
   is_active, must_change_password; new user_credentials, user_sessions, login_attempts;
   projects gain classification (internal/restricted/confidential).
2. Local auth: bcrypt hashing, POST /api/auth/login|logout|change-password, session token cookie
   + bearer support, 5-failures→15-min lockout, login rate limit, no password logging.
3. Session middleware replaces x-user-id header auth (x-user-id retained ONLY for tests via
   explicit test hook, never in production paths).
4. Policy engine: canReadProject/canWrite*/canDecideApprovals/... unit-testable, VIEWER hard
   read-only at API boundary, confidential projects concealed (404 semantics, absent from lists,
   counts, search, bootstrap, exports).
5. Entra ID adapter: interface + config contract + fake for tests → real tenant = BLOCKED_EXTERNAL.
6. Permission matrix tests (negative-heavy) + auth lifecycle tests.
7. Web: login page (email+password), session handling, role-aware nav, password-change screen.

## Completed slice 2: E01 admin CRUD + E04 portfolio foundations — DONE
Verified: 107/107 server tests (19 suites) · real-Postgres smoke (schema/seed apply, 6 parallel
creates → sequential PRJ codes, triggers fire) · typed web build · browser smoke (Admin Center,
project creation w/ code, members, viewer-PM rejection). Contract: docs/API_CONTRACT.md v3.
Delivered: org admin CRUD + org tree; pillars/portfolios/programs; tx-safe PRJ-YYYY-NNN codes;
project_members with single-PM constraint + viewer-PM ban; project-scoped write authority
(canManageProjectWork); membership-based classification; enterprise-access OFF site scoping;
lifecycle stage fields with one-step guard (gate engine placeholder); Admin Center UI; project
creation + members UI; lifecycle/status/code chips.

## Completed slice 3: E05 Governance + E08 milestones core — DONE
Verified: 138/138 server tests (25 suites) · real-Postgres smoke (ledger immutability trigger,
pending-uniqueness index) · typed web build · browser gate walk ground-truth verified (edit
project → G0 checklist green → request → approve by second user → stage INITIATION + ledger row).
Delivered: gate engine G0–G5 (pure evaluators, 422 missing lists), gate requests + decisions
(steering-only G2, ADMIN-without-steering denied, self-decision ban, transactional approve),
immutable approval_ledger (DB trigger + push-only repos), direct lifecycleStage writes blocked
(ADMIN one-step-backward correction audited), ON_HOLD/CANCELLED reasons, milestones entity
(7 types, weights, OCC) + computed explained progress, War Room UI (stepper/checklist/request/
decide/ledger/status), Edit Project dialog covering all gate-evidence fields, user directory
opened read-only to all authenticated roles (people pickers) + users in bootstrap.

## Completed slice 4: E07 core (server) — workstreams, typed dependencies, critical path — DONE
Verified: 174/174 server tests (37 suites) · scratch-Postgres smoke (schema+seed apply;
FS-gate / cycle / project-mismatch / unique / self-dep triggers all fire; PgRepo API
round-trip incl. estimatedHours numeric + DATE round-trip) · live MemoryRepo curl smoke
(workstream create -> FS dep w/ lag -> locked successor -> cycle 400 -> schedule/critical
path -> bootstrap keys). Contract: docs/API_CONTRACT.md v5 + openapi 1.3.0.
Delivered (server/db only — web Gantt view is the parallel frontend slice):
workstreams entity (OCC, audit, sync, bootstrap; manage-or-lead writes; VIEWER 403);
task fields workstreamId (same-project rule + DB trigger), plannedStart/plannedFinish,
estimatedHours; task_dependencies table (FS/SS/FF/SF + lagDays, unique edge, self-dep
CHECK, recursive cycle trigger) + POST/DELETE endpoints (manage-only, dup 409 DUPLICATE,
cycle 400 via service DFS) + GET per project; FS predecessors extend gates.computeLocked/
assertCanAdvance + DB trg_task_gates (423 detail.blockingPredecessorIds; SS/FF/SF are
scheduling-only and never lock); services/schedule.js pure CPM forward/backward pass
(documented duration/anchor/lag rules) + GET /api/projects/:id/schedule -> {tasks[],
criticalPath[]}; generic repo.delete added to both repos (audited).

## Next slices (in order)
1. E07 web: Gantt read view (parallel frontend agent; server contract v5 is frozen).
2. E10: computed RAG (4 signals, worst-wins, explanation) + freshness + manual override w/ reason.
3. E25/E26 rework per ADR-003: strict conflicts (drop LWW), ordered halt-on-refusal offline queue.
4. E09 Actions + E11 roadblock lifecycle upgrade (RAISED→…→VERIFIED) + risks + CAPA.
5. E22 My Work + Portfolio Wall KPI banner (drill-down).
4. E26/E25 rework: strict conflict (drop LWW for core objects), ordered halt-on-refusal offline queue.
5. E07/E08: workstreams, typed dependencies, milestones, weighted progress.

## Known plan-vs-v1 conflicts (must be reworked, recorded in DECISIONS.md)
- v1 LWW auto-merge violates §58/§57 (no silent/auto conflict resolution for core objects).
- v1 role list (member/site_manager/…) replaced by plan base roles + project roles.
- v1 persona-picker auth replaced by real login.

## How to verify current state
```
cd server && npm test         # 30/30 green before this slice; must stay green + new suites
cd web && npm run build       # must stay clean
docker compose up --build     # full stack
```
