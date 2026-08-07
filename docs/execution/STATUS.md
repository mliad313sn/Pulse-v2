# Execution Status

Updated: 2026-08-07 (session: goal bootstrap + Wave 1 identity slice)

## Where we are

- **Baseline**: OpsPM360 v1 complete and green (30 server tests, prod web build, docker-compose).
  It satisfies the OLD blueprint (docs/BLUEPRINT.md), not the master plan.
- **Master plan adopted**: `PROJECT_MASTER_PLAN.md` + `.claude/skills/goal/SKILL.md` are now in-repo
  and authoritative. Traceability initialized (all 31 epics mapped, mostly NOT_STARTED/PARTIAL).
- **Current wave**: Wave 1 (E00–E04), starting with the identity/access vertical (E02+E03 core)
  because every later epic depends on real users, sessions, base roles, and the policy engine.

## Active slice: Identity & Access Foundation (E02 + E03 core)

Scope of this slice:
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

## Next slices (in order)
1. E01: org hierarchy completion (organization/service tiers, memberships, admin CRUD APIs + Admin Center shell).
2. E04: pillars/portfolios/programs + PRJ-YYYY-NNN codes (tx-safe) + PM project role + Project Room shell.
3. E05: lifecycle stages + gate engine G0–G5 + approval ledger + Steering privilege + War Room.
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
