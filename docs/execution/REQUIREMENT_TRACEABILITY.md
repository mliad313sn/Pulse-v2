# Requirement Traceability — Enterprise PPM Platform

Authoritative source: `PROJECT_MASTER_PLAN.md` (§104 epics, §108 release journeys).
States: `NOT_STARTED` · `IN_PROGRESS` · `PARTIAL` (some plan requirements met by existing code, gap listed) · `BLOCKED_EXTERNAL` · `COMPLETE`.

Legacy baseline: the repo contains **OpsPM360 v1** (blueprint in `docs/BLUEPRINT.md`) — a working
demo-grade offline-first PM tool (30 passing tests, SC1–SC5). It is the starting point, NOT credit
for master-plan completion. Where v1 partially covers an epic it is marked PARTIAL with the gap.

| Epic | Scope (short) | State | Implementation | Tests | Gap / notes |
|---|---|---|---|---|---|
| E00 Foundation | workspace, strict TS, env validation, CI, health, seed | PARTIAL | server/, web/, docker-compose, /api/health | server 30 | No CI, no env validation, no worker app, server is JS (ADR-001), no lint config |
| E01 Org & Users | group/site/division/service hierarchy, memberships, admin CRUD | PARTIAL | db divisions/sites/users | — | No Organization/Service tiers, no memberships, no admin CRUD UI/API, no deactivation |
| E02 Auth & Sessions | local auth, lockout, reset, sessions, Entra adapter | **IN_PROGRESS** (this session) | see STATUS.md | pending | Entra adapter = contract + fake only (BLOCKED_EXTERNAL for real tenant) |
| E03 Authorization & Classification | base roles, modifiers, policy engine, confidentiality, permission matrix | **IN_PROGRESS** (this session) | services/policy.js (v1 seed) | pending | v1 roles ≠ plan base roles; no classification, no enterprise-access flag, no matrix tests |
| E04 Portfolio/Program/Project | pillars, portfolios, programs, project codes, Project Room | PARTIAL | projects table (flat) | v1 | No hierarchy, no PRJ-codes, no Project Room tabs, no PM role |
| E05 Lifecycle & Governance | 7-stage lifecycle, gate engine, Steering, approval ledger, War Room | PARTIAL | v1 InfoSec gate only | v1 SC4 | Full gate engine (G0–G5), ledger, War Room all missing |
| E06 Change/Baseline | change requests, baselines | NOT_STARTED | — | — | |
| E07 Workstreams/Tasks/Gantt | dependencies (FS/SS/FF/SF), Gantt, critical path | PARTIAL | tasks.dependency_lock (single-prereq) | v1 SC2 | No workstreams, no typed deps, no Gantt, no critical path |
| E08 Milestones/Progress/Readiness | milestone types, weighted progress, readiness templates | NOT_STARTED | — | — | |
| E09 Actions | quick-add actions, source links | NOT_STARTED | — | — | v1 roadblocks ≠ actions |
| E10 Health/RAG | 4 computed signals, worst-wins, override, freshness | NOT_STARTED | — | — | v1 has ad-hoc status colors only |
| E11 Risk/Roadblock/CAPA | risk register, roadblock lifecycle, CAPA workflow | PARTIAL | v1 roadblocks (3-state) | v1 | Plan lifecycle RAISED→…→VERIFIED, risks, CAPA missing |
| E12 Deliverable/RACI | deliverables, RACI + quality checks | NOT_STARTED | — | — | |
| E13 Updates/Decisions | project updates, exec commentary, decision register | NOT_STARTED | — | — | |
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
| E25 Offline | ordered replay, halt-on-refusal, human retry/discard | PARTIAL | v1 outbox+sync | v1 SC1 | Plan requires ordered halt-on-first-refusal (v1 uses LWW — must be REPLACED, plan forbids auto-merge for core objects) |
| E26 Concurrency | version conflict UX, no silent overwrite | PARTIAL | v1 OCC + merge screen | v1 | LWW fallback violates plan §58 for core objects — replace with strict conflict |
| E27 Backup/Recovery/Ops | backup+restore rehearsal, runbooks | NOT_STARTED | — | — | |
| E28 i18n/A11y/Responsive | EN/FR, WCAG AA, axe smoke | NOT_STARTED | — | — | |
| E29 Security Hardening | threat model, security suite | NOT_STARTED | — | — | |
| E30 Release Qualification | full traceability + RA-01…RA-20 | NOT_STARTED | — | — | |

## Release acceptance journeys (§108)
RA-01…RA-20: **all NOT_STARTED** except partial precursors: RA-17 (v1 409 conflict path), RA-18 (v1 sync — must be reworked to halt-on-refusal).

## Cross-cutting invariants (skill §9)
Tracked in TEST_MATRIX.md as they gain enforcement + negative tests.
