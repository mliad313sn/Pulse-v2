# Test Matrix

Command contract (§109 target): `npm test` per package today; root scripts to be added in E00 completion.

**Current totals: server 216/216 GREEN (52 suites). Web: typed production build clean; browser smokes green (auth flows + Admin Center + project codes/members). Slice-2 suites: org 7, portfolio 5, projectCodes 6 (incl. real-Postgres parallel allocation), members 9, enterpriseAccess 6, lifecycle 5. Slice-4 (E07) suites: workstreams 12, dependencies 18, schedule 6.**

| Area | Suite | State |
|---|---|---|
| v1 SC1–SC5 (legacy blueprint) | server/test/sc*.test.js | GREEN — adapted to session auth, assertions unchanged |
| OCC unit | server/test/occ.test.js | GREEN |
| Audit immutability | server/test/audit.test.js | GREEN |
| Auth lifecycle (login/lockout/change/logout/revoke) | server/test/auth.test.js | GREEN (13) |
| Permission matrix (base roles × ops, negative-heavy) | server/test/permissions.test.js | GREEN (9, incl. VIEWER loop over 12 write endpoints) |
| Confidentiality zero-leak (list/get/bootstrap/audit/deck) | server/test/classification.test.js | GREEN (8, incl. uniform-404 shape equality + deck scan) |
| Entra adapter (fake flow) | server/test/entra.test.js | GREEN (7) |
| Gate engine, lifecycle, ledger immutability | gates/ledger/lifecycle/milestones suites | GREEN |
| Workstreams (CRUD/authz/lead/sync/concealment + task scheduling fields) | server/test/workstreams.test.js | GREEN (12) |
| Typed dependencies (types/lag, dup 409, self/cross-project/cycle 400, FS locking + 423 detail, delete unlocks, DFS unit) | server/test/dependencies.test.js | GREEN (18) |
| Critical path (hand-computed 6-task CPM w/ FS+lag+SS, endpoint round-trip) | server/test/schedule.test.js | GREEN (6) |
| E07 DB backstops (FS gate, cycle/mismatch/unique/self triggers, audit) | scratch-Postgres smoke (schema+seed apply + trigger drills + PgRepo API round-trip) | GREEN (manual, this slice) |
| Progress/RAG | milestones + rag/updates suites | GREEN |
| Offline ordered replay + halt | — | E25 rework |
| Export leakage | — | E23 |
| E2E journeys RA-01…RA-20 | — | per epic |
