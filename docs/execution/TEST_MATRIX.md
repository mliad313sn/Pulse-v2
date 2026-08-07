# Test Matrix

Command contract (§109 target): `npm test` per package today; root scripts to be added in E00 completion.

**Current totals: server 67/67 GREEN (13 suites). Web: typed production build clean; browser auth smoke green (login/concealment/viewer read-only).**

| Area | Suite | State |
|---|---|---|
| v1 SC1–SC5 (legacy blueprint) | server/test/sc*.test.js | GREEN — adapted to session auth, assertions unchanged |
| OCC unit | server/test/occ.test.js | GREEN |
| Audit immutability | server/test/audit.test.js | GREEN |
| Auth lifecycle (login/lockout/change/logout/revoke) | server/test/auth.test.js | GREEN (13) |
| Permission matrix (base roles × ops, negative-heavy) | server/test/permissions.test.js | GREEN (9, incl. VIEWER loop over 12 write endpoints) |
| Confidentiality zero-leak (list/get/bootstrap/audit/deck) | server/test/classification.test.js | GREEN (8, incl. uniform-404 shape equality + deck scan) |
| Entra adapter (fake flow) | server/test/entra.test.js | GREEN (7) |
| Gate engine, lifecycle | — | E05 |
| Progress/RAG | — | E08/E10 |
| Offline ordered replay + halt | — | E25 rework |
| Export leakage | — | E23 |
| E2E journeys RA-01…RA-20 | — | per epic |
