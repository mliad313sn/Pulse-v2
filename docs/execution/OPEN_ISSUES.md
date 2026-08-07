# Open Issues / Tech Debt

1. **Server TS migration** (ADR-001): server/ is JS+JSDoc; migrate to strict TS before Wave 2 ends.
2. **LWW removal** (ADR-003): v1 sync LWW path violates plan §57/§58; replace in E25/E26 slice.
3. **No CI pipeline** (E00): add GitHub Actions running lint/typecheck/tests/build per §85.
4. **No lint/format config**: add eslint+prettier config to both packages (E00).
5. **Pagination**: v1 list endpoints return full tables; §79 requires pagination — retrofit in E04.
6. **security_risk_tags duplicated** SQL/JS (documented); fold into gate-engine config in E05.
7. **Web has no automated tests**: add Vitest unit tests for lib/ and Playwright E2E as journeys land.
