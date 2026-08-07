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
