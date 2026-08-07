# Test Matrix

Command contract (§109 target): `npm test` per package today; root scripts to be added in E00 completion.

**Current totals: server 138/138 GREEN (25 suites). Web: typed production build clean; browser smokes green (auth flows + Admin Center + project codes/members). Slice-2 suites: org 7, portfolio 5, projectCodes 6 (incl. real-Postgres parallel allocation), members 9, enterpriseAccess 6, lifecycle 5.**

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
| Progress/RAG | — | E08/E10 |
| Offline ordered replay + halt | — | E25 rework |
| Export leakage | — | E23 |
| E2E journeys RA-01…RA-20 | — | per epic |
