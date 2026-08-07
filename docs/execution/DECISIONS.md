# Architecture & Execution Decisions

## ADR-001 — Evolve the existing stack rather than rewrite to a NestJS monorepo
Date: 2026-08-07 · Status: accepted

§70 recommends a TS monorepo (Next.js web / NestJS api / worker + packages). The repo already
contains a coherent, tested Express + pg + Next.js implementation with the patterns the plan
actually requires (repository interface, policy module, OCC service, per-entity definition table,
audit, typed error envelope). §70 explicitly allows "an existing coherent repository architecture"
as an alternative path, and SKILL §5 forbids rewrite for aesthetics.

Decision: keep `server/` (Express, ESM JS) + `web/` (Next.js TS) + add `server/src/worker/` for
durable jobs when E21 starts. Preserve module boundaries (services/ ≈ plan §71 modules) so future
extraction stays possible. New server code stays consistent JS-with-JSDoc for now; a TS migration
of server/ is tracked in OPEN_ISSUES (#1) and should be done before the codebase grows past
Wave 2 — earlier is cheaper.

## ADR-002 — Session auth replaces header identity; test-only identity hook
Date: 2026-08-07 · Status: accepted

v1 used a raw `x-user-id` header (demo-grade). Replaced by server-side sessions (opaque token,
hashed at rest, cookie + Authorization: Bearer). The permission matrix tests need cheap identity
switching; production code paths must never trust a bare user id. Mechanism: test bootstrap logs
in via the real /api/auth/login with seeded credentials — no backdoor header in production code.

## ADR-003 — v1 LWW conflict resolution is scheduled for removal (plan conflict)
Date: 2026-08-07 · Status: accepted, not yet executed (E25/E26 slice)

Master plan §57/§58 + invariant 20 forbid machine-invented merges and last-write-wins for core
collaborative objects; v1's sync uses LWW on clientUpdatedAt. When the offline epic is reworked,
the sync processor keeps `applied` (version match) and turns EVERY stale-version write into a
halt/manual-resolution path with ordered replay. Until then the v1 behavior remains but is marked
non-compliant in traceability (do NOT build new features on the LWW path).

## ADR-004 — Base roles migrate v1 roles
Date: 2026-08-07 · Status: accepted

Plan base roles: ADMIN, DIVISION_LEAD, CONTRIBUTOR, VIEWER (+ Steering privilege flag, project
roles later). v1 mapping: group_manager→ADMIN, division_lead→DIVISION_LEAD,
site_manager/member→CONTRIBUTOR, security_reviewer→CONTRIBUTOR + `security_reviewer` privilege
(the InfoSec approval capability becomes a privilege consistent with §8 modifiers until E05
introduces the full project-role model). Seed adds one VIEWER account.

## ADR-005 — Classification concealment via uniform 404
Date: 2026-08-07 · Status: accepted

§9/§80: unauthorized confidential objects return the same NOT_FOUND shape as truly absent ids
(no FORBIDDEN leak), and are filtered before lists/counts/search/bootstrap/exports. RESTRICTED
returns 403 only where existence is already known via authorized listing; otherwise also 404.

## ADR-006 — RAG engine adaptation of plan §24 (severities, overdue stand-in, lazy snapshots)
Date: 2026-08-07 · Status: accepted

Plan §24 defines the four core RAG signals against entities the repo does not fully have yet.
Adaptations made by the E10 slice (`server/src/services/rag.js`, pure and clock-injected):

1. **Roadblock severities**: the plan uses CRITICAL/MAJOR/MINOR; v2 roadblocks carry
   `low|medium|high|critical`. Mapping: `critical`→CRITICAL (open ⇒ RED), `high`→MAJOR
   (open ⇒ AMBER); `medium|low` do not color the signal. The E11 roadblock-lifecycle rework may
   rename the enum; the signal logic stays.
2. **Overdue ACTIONS → overdue tasks**: §24's third signal counts overdue actions, but actions
   arrive with E09. Until then, open tasks with `plannedFinish` in the past stand in
   (0 GREEN / 1–3 AMBER / ≥4 RED). The signal key is deliberately the neutral **`overdueWork`**
   and will keep that key when E09 swaps the underlying rows — no wire/UI break.
3. **Freshness source**: the explicit-status-update age (§26) comes from the new append-only
   `project_updates` (E13 core, shipped in the same slice); "total silence" (RED) additionally
   requires >30 days without meaningful activity, defined as the max of latest update
   `createdAt` and task/milestone/roadblock `updatedAt` (project `createdAt` as last resort).
   Exemptions per §24: operatingStatus ON_HOLD/COMPLETED/CANCELLED, lifecycleStage RUN/CLOSED.
4. **Trend snapshots (§133) are captured lazily at read time**: project decoration compares the
   computed/effective color against the project's last `rag_snapshots` row and appends on
   change. Chosen over write-path hooks because every RAG input (milestones, tasks, roadblocks,
   updates, override, and the passage of time itself — overdue/freshness flips need NO write)
   funnels through the same decoration, and it behaves identically for MemoryRepo and Postgres.
   Consequence: a color change is recorded when first OBSERVED, not when the underlying write
   happened — acceptable for trend charting; §133's "no fabricated history" holds (the first
   snapshot is the first observation, never backfilled).
5. **Manual override storage**: a single `projects.rag_override` JSONB ({color, reason, byId,
   at}) rather than columns — it is an atomic, optional, server-managed blob with no relational
   queries against its parts; both repos stay identical. Reason must trim to ≥30 chars
   (§25) → new error code `RAG_OVERRIDE_REASON_TOO_SHORT`; set/clear are manage-level, bump the
   project version, and audit reason + before/after color permanently. No expiry policy yet
   (§25 allows one): the override persists until explicitly cleared — revisit with E14
   (executive commentary) if a time-boxed override is wanted.
6. **Project updates are online-only and append-only for now**: POST + GET only; no
   PATCH/DELETE routes, DB trigger backstop, not in the offline sync entity set (append-only
   rows carry no OCC version; ADR-003's sync rework should decide how/if they ride offline).
   Revisions per §32 arrive with the full E13 epic.
