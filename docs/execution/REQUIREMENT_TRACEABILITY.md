# Requirement Traceability — Enterprise PPM Platform

Authoritative source: `PROJECT_MASTER_PLAN.md` (§104 epics, §108 release journeys).
States: `NOT_STARTED` · `IN_PROGRESS` · `PARTIAL` (some plan requirements met by existing code, gap listed) · `BLOCKED_EXTERNAL` · `COMPLETE`.

Legacy baseline: the repo contains **OpsPM360 v1** (blueprint in `docs/BLUEPRINT.md`) — a working
demo-grade offline-first PM tool (30 passing tests, SC1–SC5). It is the starting point, NOT credit
for master-plan completion. Where v1 partially covers an epic it is marked PARTIAL with the gap.

| Epic | Scope (short) | State | Implementation | Tests | Gap / notes |
|---|---|---|---|---|---|
| E00 Foundation | workspace, strict TS, env validation, CI, health, seed | PARTIAL | server/, web/, docker-compose, /api/health | server 30 | No CI, no env validation, no worker app, server is JS (ADR-001), no lint config |
| E01 Org & Users | group/site/division/service hierarchy, memberships, admin CRUD | PARTIAL (admin CRUD done) | routes/org.js, routes/users.js, Admin Center UI (web/app/admin) | org.test.js (7) GREEN | Remaining: Group/Service tiers, multi-membership records (single primary site/division today) |
| E02 Auth & Sessions | local auth, lockout, reset, sessions, Entra adapter | **COMPLETE** (local) / BLOCKED_EXTERNAL (real Entra tenant) | server/src/services/auth.js, routes/auth.js, routes/users.js, authProviders/ | auth.test.js (13), entra.test.js (7) GREEN | Real AZURE_* credentials pending — adapter+fake tested |
| E03 Authorization & Classification | base roles, modifiers, policy engine, confidentiality, permission matrix | PARTIAL (core done) | services/policy.js (rewritten), middleware (viewer write-block, concealment in all read paths) | permissions.test.js (9), classification.test.js (8) GREEN | Remaining: enterprise-access OFF modifier, project roles/membership (E04), Steering gate use (E05), full matrix modifiers |
| E04 Portfolio/Program/Project | pillars, portfolios, programs, project codes, Project Room | PARTIAL (core done) | pillars/portfolios/programs entities+APIs, tx-safe PRJ-YYYY-NNN codes, project_members (single-PM, viewer-PM ban), enterprise-access scoping, lifecycle/operating-status fields, creation+members UI | portfolio 5, projectCodes 6, members 9, enterpriseAccess 6, lifecycle 5 — GREEN (verified on real Postgres incl. parallel code allocation) | Remaining: full Project Room 20-tab shell, search scope hardening, program aggregate health |
| E05 Lifecycle & Governance | 7-stage lifecycle, gate engine, Steering, approval ledger, War Room | **COMPLETE (core)** | services/gateEngine.js, routes (gates/ledger), War Room UI (/projects/[id]/governance), EditProjectDialog | gates 10+, ledger, lifecycle 7 — GREEN; UI walk ground-truth verified | Remaining: configurable gate requirements (admin-editable), change-control linkage (E06) |
| E06 Change/Baseline | change requests, baselines | NOT_STARTED | — | — | |
| E07 Workstreams/Tasks/Gantt | dependencies (FS/SS/FF/SF), Gantt, critical path | PARTIAL (server core DONE) | workstreams + typed deps (cycle-free, FS locks) + task scheduling fields + CPM schedule endpoint; dependency_lock kept for back-compat | workstreams/dependencies/schedule suites (36) + SC2 | Web Gantt read view pending (parallel frontend slice); drag-to-reschedule/baselines deferred (E06) |
| E08 Milestones/Progress/Readiness | milestone types, weighted progress, readiness templates | PARTIAL (milestones+progress done) | milestones entity (7 types, OCC, audit), computed weighted progress w/ explanation (invariant 15) | milestones.test.js GREEN | Remaining: readiness templates + auto-checklists, task-milestone linkage |
| E09 Actions | quick-add actions, source links | NOT_STARTED | — | — | v1 roadblocks ≠ actions |
| E10 Health/RAG | 4 computed signals, worst-wins, override, freshness | **COMPLETE (core)** | services/rag.js (pure, clock-injected), rag-override endpoints, rag_snapshots trend, RagBadge/RagExplain UI | rag.test.js + updates.test.js GREEN; browser cycle verified | ADR-006 adaptations (overdue tasks stand in for E09 actions); no override expiry policy yet |
| E11 Risk/Roadblock/CAPA | risk register, roadblock lifecycle, CAPA workflow | PARTIAL | v1 roadblocks (3-state) | v1 | Plan lifecycle RAISED→…→VERIFIED, risks, CAPA missing |
| E12 Deliverable/RACI | deliverables, RACI + quality checks | NOT_STARTED | — | — | |
| E13 Updates/Decisions | project updates, exec commentary, decision register | PARTIAL (updates core done) | project_updates append-only (DB trigger), 20-second composer + feed UI, freshness feed into RAG | updates.test.js GREEN | Remaining: revisions (§32), executive commentary, decision register |
| E14 Meetings | types, auto-agenda, minutes versions | NOT_STARTED | — | — | |
| E15 Realtime Meeting Mode | WebSocket follow-presenter | NOT_STARTED | — | — | |
| E16 Resources/Time | capacity, allocation, overload, time entries | NOT_STARTED | — | — | |
| E17 Finance | budget/forecast/actuals, field-level security | NOT_STARTED | — | — | |
| E18 Benefits | benefit definitions, measurements | NOT_STARTED | — | — | |
| E19 Notifications | in-app hub, dedupe, mandatory alerts | NOT_STARTED | — | — | |
| E20 Email/Teams | adapters + local sink/fake | NOT_STARTED | — | — | Real SMTP/Teams = BLOCKED_EXTERNAL when reached |
| E21 Scheduling/Workers | durable jobs, reminders, idempotency | NOT_STARTED | — | — | |
| E22 Dashboards/Analytics | Portfolio Wall, Site Lens, My Work, Exec Center | PARTIAL | v1 role dashboards | smoke | Plan KPIs/drilldowns/My Work missing |
| E23 Exports | PPTX/PDF/XLSX, filter+authz parity, leakage tests | PARTIAL | v1 exec deck (pptx/pdf) | v1 SC5 | No XLSX, no filter parity, no leakage tests, no scheduled dispatch |
| E24 Search/Documents | global search, attachments | NOT_STARTED | — | — | |
| E25 Offline | ordered replay, halt-on-refusal, human retry/discard | **COMPLETE (core)** | seq-ordered command log, halt at first refusal (applied/blocked/held), SYNC_HALTED audit, audited explicit discard, Sync Queue UI w/ per-field human merge | sc1 rewrite (7) + sync_halt (5) GREEN; live browser halt-and-resolve walk | Remaining: admin notification on halt (E19), offline auth-change simulation tests broadened |
| E26 Concurrency | version conflict UX, no silent overwrite | **COMPLETE (core)** | strict OCC only (LWW deleted), 409+serverState online, blocked+serverState offline, comparison/reapply UX | occ + sc1 suites GREEN; browser walk | Invariants 18-20 now fully enforced |
| E27 Backup/Recovery/Ops | backup+restore rehearsal, runbooks | NOT_STARTED | — | — | |
| E28 i18n/A11y/Responsive | EN/FR, WCAG AA, axe smoke | NOT_STARTED | — | — | |
| E29 Security Hardening | threat model, security suite | NOT_STARTED | — | — | |
| E30 Release Qualification | full traceability + RA-01…RA-20 | NOT_STARTED | — | — | |

## Release acceptance journeys (§108)
RA-18 (offline halt/resolution): core PROVEN via live browser walk (conflict -> halt -> held untouched -> human merge -> drain). RA-17 (no silent overwrite): PROVEN. RA-09 (RAG signals + override): core PROVEN (engine matrix tests + live browser override cycle w/ MANUAL badge). RA-02 (lifecycle w/ gates): CORE PROVEN for G0 via automated UI walk + API tests for G0-G5 requirements/steering. RA-05 (steering separation): test-proven (ADMIN w/o steering denied G2). RA-08 (computed progress): test-proven. RA-17 partial (409 path), RA-18 pending rework. Others NOT_STARTED.

## Cross-cutting invariants (skill §9)
Tracked in TEST_MATRIX.md as they gain enforcement + negative tests.
