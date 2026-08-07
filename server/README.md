# OpsPM360 — Server

Node.js/Express backend for the Enterprise PPM Platform (see `../docs/API_CONTRACT.md`).

## Run modes

The repository layer is injected at startup:

- **In-memory (default)** — no database needed. Seeded with the demo fixtures
  from `../db/init/02_seed.sql` (same UUIDs and bcrypt hashes), including the
  effects the DB triggers would have applied (project 2's pending InfoSec gate).
- **PostgreSQL** — set `DATABASE_URL`. The DB from `../db/init/*.sql` provides
  trigger-level enforcement (gates, security routing, immutable audit); the
  service layer mirrors the same rules for friendly typed errors.

```bash
npm install
npm start          # http://localhost:4000/api (in-memory)
DATABASE_URL=postgres://user:pass@localhost:5432/opspm360 npm start
npm run dev        # --watch mode
```

## Environment variables

| Var                    | Default | Purpose                                              |
|------------------------|---------|------------------------------------------------------|
| `PORT`                 | `4000`  | HTTP listen port                                     |
| `DATABASE_URL`         | unset   | When set, use PostgreSQL instead of memory           |
| `SESSION_TTL_HOURS`    | `72`    | Session lifetime                                     |
| `PASSWORD_MIN_LENGTH`  | `10`    | Minimum accepted password length                     |
| `AZURE_TENANT_ID`      | unset   | Entra ID SSO (all four required to enable it)        |
| `AZURE_CLIENT_ID`      | unset   | Entra ID SSO                                         |
| `AZURE_CLIENT_SECRET`  | unset   | Entra ID SSO                                         |
| `AZURE_REDIRECT_URI`   | unset   | Entra ID SSO callback, e.g. `http://localhost:4000/api/auth/entra/callback` |

Without the `AZURE_*` vars, `GET /api/auth/entra/login` answers
`501 NOT_CONFIGURED` (local email/password login always works).

## Auth

Session-based (ADR-002): `POST /api/auth/login {email, password}` sets the
HttpOnly `ppm_session` cookie; `Authorization: Bearer <token>` (the same
token value) is accepted too. See the auth section of
`../docs/API_CONTRACT.md` for the full lifecycle (lockout, rate limit,
change-password, admin user management).

### Dev credentials (seed — DEV/DEMO ONLY)

Every seed user's password is `Dev!<firstname>2026`:

| User            | Email                           | Password           | Base role      | Privileges          |
|-----------------|---------------------------------|--------------------|----------------|---------------------|
| Troy Coordinator| `troy@opspm360.local`           | `Dev!Troy2026`     | ADMIN          | —                   |
| Moussa Diallo   | `moussa.diallo@opspm360.local`  | `Dev!Moussa2026`   | DIVISION_LEAD  | —                   |
| Fatou Sarr      | `fatou.sarr@opspm360.local`     | `Dev!Fatou2026`    | DIVISION_LEAD  | —                   |
| Aminata Fall    | `aminata.fall@opspm360.local`   | `Dev!Aminata2026`  | DIVISION_LEAD  | —                   |
| Awa Ndiaye      | `awa.ndiaye@opspm360.local`     | `Dev!Awa2026`      | CONTRIBUTOR    | —                   |
| Ibrahima Ba     | `ibrahima.ba@opspm360.local`    | `Dev!Ibrahima2026` | CONTRIBUTOR    | —                   |
| Hamady Soumare  | `hamady.soumare@opspm360.local` | `Dev!Hamady2026`   | CONTRIBUTOR    | `security_reviewer` |
| Aissatou Diop   | `viewer@opspm360.local`         | `Dev!Aissatou2026` | VIEWER         | —                   |

Login attempts lock after 5 failures in 15 min (15-min lock; admin
`POST /api/users/:id/unlock` clears it). Login is rate-limited to
10/min per IP+email (in-memory — use Redis for multi-instance prod).

## API

- Contract: `../docs/API_CONTRACT.md` (base URL `http://localhost:4000/api`)
- Swagger UI: `GET /api/docs` · raw spec: `GET /api/openapi.yaml`

## Tests

Node's built-in test runner against the in-memory repository (no database,
no network beyond a loopback ephemeral port). Tests authenticate through the
REAL `/api/auth/login` with the seeded dev credentials — there is no
header/test identity backdoor (ADR-002).

```bash
npm test           # = node --test "test/*.test.js"
```

(Note: the glob form is used because this Node build does not expand a bare
directory argument to `--test`.)

Suites: blueprint success conditions (SC1–SC5), OCC + audit units, plus
`auth` (session lifecycle), `permissions` (role × operation matrix),
`classification` (ADR-005 concealment incl. deck exports) and `entra`
(SSO adapter with the fake provider).
