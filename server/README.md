# OpsPM360 — Server

Node.js/Express backend for OpsPM360 (see `../docs/API_CONTRACT.md`, `../docs/BLUEPRINT.md`).

## Run modes

The repository layer is injected at startup:

- **In-memory (default)** — no database needed. Seeded with the demo fixtures
  from `../db/init/02_seed.sql` (same UUIDs), including the effects the DB
  triggers would have applied (project 2's pending InfoSec gate).
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

| Var            | Default | Purpose                                   |
|----------------|---------|-------------------------------------------|
| `PORT`         | `4000`  | HTTP listen port                          |
| `DATABASE_URL` | unset   | When set, use PostgreSQL instead of memory |

## API

- Contract: `../docs/API_CONTRACT.md` (base URL `http://localhost:4000/api`)
- Swagger UI: `GET /api/docs` · raw spec: `GET /api/openapi.yaml`
- Auth (demo-grade): send `x-user-id: <uuid>` (pick one from `GET /api/users`,
  e.g. `00000000-0000-0000-0000-000000000001` for Awa Ndiaye).

## Tests

Node's built-in test runner against the in-memory repository (no database,
no network beyond a loopback ephemeral port):

```bash
npm test           # = node --test "test/*.test.js"
```

(Note: the glob form is used because this Node build does not expand a bare
directory argument to `--test`.)

Test files are named by the blueprint success conditions (SC1–SC5) plus unit
suites for OCC and the immutable audit ledger.
