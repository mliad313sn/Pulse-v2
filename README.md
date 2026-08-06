# OpsPM360 — Enterprise IT Ops/Infra Project Portfolio Management

Offline-first project orchestration for a multi-site mining IT organization
(Sabodala, Saly, HQ) spanning 7 IT divisions: Operations, Infrastructure,
Enterprise Architecture, Information Security, Data Insight, Business Apps,
and Group IT Management.

Built to the [Detailed Blueprint](docs/BLUEPRINT.md) with the shared
[API Contract](docs/API_CONTRACT.md).

## Key paradigms

| Paradigm | Implementation |
|---|---|
| **Offline-first sync** | IndexedDB outbox on the client → JSONB `sync_queue` on the server → Optimistic Concurrency Control (`version` + `updated_at`), Last-Write-Wins fallback, manual-merge escalation |
| **Governance (CGEIT)** | Immutable `audit_logs` ledger (trigger-enforced), CGEIT tags on every project, role-based access |
| **Security routing** | `network_alteration` / `firewall_change` / `external_exposure` risk tags auto-open InfoSec approvals and gate task progression |
| **Dependency handshake** | Infra tasks lock behind Ops prerequisites — enforced in the API *and* by DB trigger |
| **Zero-training UX** | Role-adaptive dashboards, ≤3-tap task updates, 1-click roadblock logging, drag-and-drop Kanban, dark/light mode |
| **Executive extraction** | One-click PPTX/PDF deck grouped by division: statuses, blockers, next actions |

## Repository layout

```
db/init/        PostgreSQL schema + seed (auto-applied by docker compose)
server/         Node.js/Express API, sync engine, reporting, OpenAPI docs
web/            Next.js PWA (React + Tailwind), IndexedDB offline layer
docs/           Blueprint, API contract
docker-compose.yml
```

## Quick start (full stack)

```bash
docker compose up --build
# web:      http://localhost:3000
# api:      http://localhost:4000/api/health
# api docs: http://localhost:4000/api/docs   (Swagger UI)
# db:       postgres://opspm360:opspm360_dev@localhost:5432/opspm360
```

## Development without Docker

```bash
# API — runs against an in-memory repository when DATABASE_URL is unset
cd server && npm install && npm start          # http://localhost:4000

# Web
cd web && npm install && npm run dev           # http://localhost:3000
```

## Validation gates (SC1–SC5)

`cd server && npm test` exercises the success conditions from the blueprint:

- **SC1** Offline sync + OCC resolution (applied / LWW / manual-merge paths)
- **SC2** Dependency locking (Infra blocked until Ops prerequisite completes)
- **SC3** Ergonomics (single-request task update & roadblock creation)
- **SC4** Security routing (InfoSec gate lifecycle, reviewer-only decisions)
- **SC5** Executive deck extraction (valid PPTX + PDF, grouped by division)

## Data Insight / BI access

The schema ships a read-only `bi_reader` role granting `SELECT` on all tables
for ingestion into corporate BI dashboards.
