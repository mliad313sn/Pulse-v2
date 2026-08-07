# CLAUDE.md — Enterprise PPM Platform (Pulse-v2)

## What this repo is
Building the Enterprise PPM Platform per `PROJECT_MASTER_PLAN.md` (authoritative spec), executed
by the `/goal` skill (`.claude/skills/goal/SKILL.md`). Baseline: OpsPM360 v1 (docs/BLUEPRINT.md),
a working offline-first PM demo being evolved toward the master plan.

## Resume protocol (read first, in order)
1. docs/execution/STATUS.md — where execution stands + active slice
2. docs/execution/REQUIREMENT_TRACEABILITY.md — epic states
3. docs/execution/DECISIONS.md — ADRs (do not relitigate without cause)
4. docs/execution/OPEN_ISSUES.md — known debt

## Layout
- server/ — Express API (ESM JS + JSDoc). services/=domain modules, repo/=Pg+Memory repositories
  (same interface; MemoryRepo powers the zero-dep test suite), routes/, reporter/.
- web/ — Next.js 15 + TS PWA. lib/store.tsx=offline-first state, lib/db.ts=IndexedDB, components/.
- db/init/ — PostgreSQL schema+seed (applied by docker compose; keep MemoryRepo fixtures in sync).
- docs/execution/ — execution memory (keep updated every slice).

## Rules
- Verify with `cd server && npm test` and `cd web && npm run build` before any commit.
- Governance invariants (SKILL §9) are non-negotiable; negative tests required for authz changes.
- Keep MemoryRepo and Postgres behavior identical (business rules live in services/, DB triggers
  are the backstop).
- Commit per coherent slice to branch `claude/opspm360-orchestration-k0rm6c`; push after commit.
- UTC everywhere server-side.
