# Test Matrix

Command contract (§109 target): `npm test` per package today; root scripts to be added in E00 completion.

| Area | Suite | State |
|---|---|---|
| v1 SC1–SC5 (legacy blueprint) | server/test/sc*.test.js | GREEN (30 tests) — kept as regression until superseded |
| OCC unit | server/test/occ.test.js | GREEN |
| Audit immutability | server/test/audit.test.js | GREEN |
| Auth lifecycle (login/lockout/change/logout/revoke) | server/test/auth.test.js | THIS SLICE |
| Permission matrix (base roles × ops, negative-heavy) | server/test/permissions.test.js | THIS SLICE |
| Confidentiality zero-leak (list/get/search/counts/export) | server/test/classification.test.js | THIS SLICE |
| Entra adapter (fake flow) | server/test/entra.test.js | THIS SLICE |
| Gate engine, lifecycle | — | E05 |
| Progress/RAG | — | E08/E10 |
| Offline ordered replay + halt | — | E25 rework |
| Export leakage | — | E23 |
| E2E journeys RA-01…RA-20 | — | per epic |
