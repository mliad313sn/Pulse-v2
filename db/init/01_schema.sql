-- ============================================================================
-- OpsPM360 — PostgreSQL Schema
-- Phase 1: Data Architecture (AGENT_DBA + AGENT_GOVERNANCE)
--
-- Paradigms:
--   * Row-level versioning for Optimistic Concurrency Control (OCC)
--   * JSONB sync queue for offline-first payload ingestion
--   * Immutable audit ledger (CGEIT compliance)
--   * Security routing: network-altering work auto-routes to InfoSec
--   * Dependency locking enforced at the database layer (Infra <-> Ops)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Reference data: the 7 IT divisions
-- ----------------------------------------------------------------------------
CREATE TABLE divisions (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT
);

INSERT INTO divisions (code, name, description) VALUES
    ('ops',        'Operations',              'Day-to-day site management'),
    ('infra',      'Infrastructure',          'Networks and systems deployment'),
    ('ea',         'Enterprise Architecture', 'Future design and strategic blueprint'),
    ('infosec',    'Information Security',    'Cyber defense and governance'),
    ('data',       'Data Insight',            'Business intelligence'),
    ('bizapps',    'Business Apps',           'ERP integration'),
    ('management', 'Group IT Management',     'Executive oversight');

CREATE TABLE sites (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT
);

INSERT INTO sites (code, name) VALUES
    ('sabodala', 'Sabodala Mine Site'),
    ('saly',     'Saly Site'),
    ('hq',       'Group IT HQ');

-- Risk tags that auto-route work to InfoSec (see route_security_review()).
-- Mirrored in server/src/services/securityRouting.js:SECURITY_RISK_TAGS —
-- both must change together.
CREATE TABLE security_risk_tags (
    code TEXT PRIMARY KEY
);

INSERT INTO security_risk_tags (code) VALUES
    ('network_alteration'),
    ('firewall_change'),
    ('external_exposure');

-- ----------------------------------------------------------------------------
-- Users — plan base roles (ADR-004) + privilege modifiers.
--   base_role:  ADMIN | DIVISION_LEAD | CONTRIBUTOR | VIEWER
--   privileges: capability modifiers ('security_reviewer', 'steering')
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    email                TEXT UNIQUE NOT NULL,
    division             TEXT NOT NULL REFERENCES divisions(code),
    site                 TEXT REFERENCES sites(code),
    base_role            TEXT NOT NULL DEFAULT 'CONTRIBUTOR'
                         CHECK (base_role IN ('ADMIN', 'DIVISION_LEAD', 'CONTRIBUTOR', 'VIEWER')),
    privileges           TEXT[] NOT NULL DEFAULT '{}',
    is_active            BOOLEAN NOT NULL DEFAULT true,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    -- E01/plan §8.2: when FALSE every read is additionally scoped to projects
    -- on the user's site or projects where the user is member/owner/sponsor.
    enterprise_access    BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Local credentials (E02). bcrypt hash at rest; never exposed over the API.
-- Lockout tracking lives HERE (design choice documented in DECISIONS/ADR-002
-- slice): failed_count/first_failed_at implement the "5 failures within
-- 15 minutes" window; locked_until implements the 15-minute lock.
-- This table is intentionally NOT audited (no secrets in the ledger).
-- ----------------------------------------------------------------------------
CREATE TABLE user_credentials (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash   TEXT NOT NULL,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    first_failed_at TIMESTAMPTZ,
    locked_until    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Server-side sessions (E02). Opaque 32-byte token issued to the client
-- (cookie ppm_session or Authorization: Bearer); only its SHA-256 is stored.
-- ----------------------------------------------------------------------------
CREATE TABLE user_sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT UNIQUE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

-- ----------------------------------------------------------------------------
-- E04 — Portfolio foundations: strategic pillars > portfolios > programs.
-- Admin/lead-managed reference structures (no OCC version — not collaborative
-- core objects; every mutation is still audited).
-- ----------------------------------------------------------------------------
CREATE TABLE strategic_pillars (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portfolios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    description TEXT,
    pillar_id   UUID REFERENCES strategic_pillars(id),
    owner_id    UUID REFERENCES users(id),
    date_from   DATE,
    date_to     DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE programs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    objective    TEXT,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id),
    owner_id     UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_programs_portfolio ON programs(portfolio_id);

-- ----------------------------------------------------------------------------
-- E04 — Concurrency-safe project code allocation (PRJ-YYYY-NNN).
-- The create transaction takes the per-year row lock (SELECT ... FOR UPDATE)
-- and increments last_value — NEVER max()+1 over projects.
-- ----------------------------------------------------------------------------
CREATE TABLE project_code_sequences (
    year       INTEGER PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Projects — OCC via (version, updated_at)
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Server-generated PRJ-YYYY-NNN, immutable after creation (trigger backstop).
    code                 TEXT UNIQUE NOT NULL,
    name                 TEXT NOT NULL,
    description          TEXT,
    division             TEXT NOT NULL REFERENCES divisions(code),
    site                 TEXT REFERENCES sites(code),
    portfolio_id         UUID REFERENCES portfolios(id),
    program_id           UUID REFERENCES programs(id),
    sponsor_id           UUID REFERENCES users(id),
    -- E05: lifecycle transitions go through the gate engine (gate_requests +
    -- approval_ledger); direct stage writes are service-refused except the
    -- ADMIN one-step-backward correction.
    lifecycle_stage      TEXT NOT NULL DEFAULT 'IDEA'
                         CHECK (lifecycle_stage IN ('IDEA', 'INITIATION', 'PLANNING', 'EXECUTION',
                                                    'DEPLOYMENT', 'RUN', 'CLOSED')),
    operating_status     TEXT NOT NULL DEFAULT 'NOT_STARTED'
                         CHECK (operating_status IN ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD',
                                                     'COMPLETED', 'CANCELLED')),
    -- E05 governance fields (all nullable; dates are DATE, wire format YYYY-MM-DD).
    start_date           DATE,
    target_date          DATE,
    actual_end_date      DATE,
    acceptance_criteria  TEXT,
    deployment_plan      TEXT,
    support_owner_id     UUID REFERENCES users(id),
    closure_summary      TEXT,
    cancel_reason        TEXT,   -- required by the service when operating_status -> CANCELLED
    hold_reason          TEXT,   -- required by the service when operating_status -> ON_HOLD
    -- E10 manual RAG override (plan §25): {color, reason, byId, at} | NULL.
    -- Server-managed via POST/DELETE /api/projects/:id/rag-override only —
    -- never a writable PATCH/sync field. The computed RAG itself is derived
    -- at read time (services/rag.js); only the override is stored.
    rag_override         JSONB,
    engaged_divisions    TEXT[] NOT NULL DEFAULT '{}',
    sites                TEXT[] NOT NULL DEFAULT '{}',  -- additional sites; `site` stays primary
    cgeit_tag            TEXT NOT NULL DEFAULT 'value_delivery'
                         CHECK (cgeit_tag IN ('strategic_alignment', 'value_delivery', 'risk_optimization',
                                              'resource_optimization', 'performance_measurement')),
    strategic_tag        TEXT,                          -- EA blueprint mapping
    risk_tags            TEXT[] NOT NULL DEFAULT '{}',  -- e.g. {network_alteration}
    classification       TEXT NOT NULL DEFAULT 'internal'
                         CHECK (classification IN ('internal', 'restricted', 'confidential')),
    overall_status       TEXT NOT NULL DEFAULT 'active'
                         CHECK (overall_status IN ('draft', 'active', 'at_risk', 'on_hold', 'complete')),
    security_gate_status TEXT NOT NULL DEFAULT 'not_required'
                         CHECK (security_gate_status IN ('not_required', 'pending', 'approved', 'rejected')),
    owner_id             UUID REFERENCES users(id),
    version              INTEGER NOT NULL DEFAULT 1,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_division ON projects(division);
CREATE INDEX idx_projects_site ON projects(site);
CREATE INDEX idx_projects_portfolio ON projects(portfolio_id);
CREATE INDEX idx_projects_program ON projects(program_id);

-- Backstop for the service rule: project codes are immutable after creation.
CREATE OR REPLACE FUNCTION forbid_project_code_change() RETURNS trigger AS $$
BEGIN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
        RAISE EXCEPTION 'PROJECT_CODE_IMMUTABLE: project code cannot be changed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_project_code_immutable
    BEFORE UPDATE OF code ON projects
    FOR EACH ROW EXECUTE FUNCTION forbid_project_code_change();

-- ----------------------------------------------------------------------------
-- E04 — Project membership (project roles per plan §8).
--   * At most ONE member with role PM per project (partial unique index).
--   * VIEWER base-role users can never hold PM/WORKSTREAM_LEAD (plan inv. 2).
--   * A PM member gains project-scoped write authority (service policy).
-- ----------------------------------------------------------------------------
CREATE TABLE project_members (
    id         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),  -- surrogate for the audit ledger
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL
               CHECK (role IN ('PM', 'SPONSOR', 'WORKSTREAM_LEAD', 'CONTRIBUTOR', 'SME',
                               'FINANCE_CONTROLLER', 'SECURITY_REVIEWER', 'SITE_LEAD',
                               'AUDITOR', 'APPROVER', 'INFORMED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id, role)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE UNIQUE INDEX uniq_project_members_pm ON project_members(project_id) WHERE role = 'PM';

-- Backstop for plan invariant 2: VIEWER accounts never lead work.
CREATE OR REPLACE FUNCTION forbid_viewer_lead_roles() RETURNS trigger AS $$
BEGIN
    IF NEW.role IN ('PM', 'WORKSTREAM_LEAD') AND EXISTS (
        SELECT 1 FROM users WHERE id = NEW.user_id AND base_role = 'VIEWER'
    ) THEN
        RAISE EXCEPTION 'VIEWER_CANNOT_LEAD: VIEWER users cannot hold PM or WORKSTREAM_LEAD'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_viewer_guard
    BEFORE INSERT OR UPDATE ON project_members
    FOR EACH ROW EXECUTE FUNCTION forbid_viewer_lead_roles();

-- ----------------------------------------------------------------------------
-- E08 (minimal core) — Milestones. Weighted, typed, OCC-versioned like other
-- collaborative entities. Project progress is COMPUTED from these (plan §23,
-- invariant 15) — there is no stored overall percentage anywhere.
-- ----------------------------------------------------------------------------
CREATE TABLE milestones (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT,
    type             TEXT NOT NULL DEFAULT 'STANDARD'
                     CHECK (type IN ('STANDARD', 'SECURITY_GATE', 'SITE_READINESS', 'UAT',
                                     'GO_LIVE', 'GOVERNANCE_GATE', 'OPERATIONAL_HANDOVER')),
    status           TEXT NOT NULL DEFAULT 'NOT_STARTED'
                     CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SLIPPED', 'CANCELLED')),
    owner_id         UUID REFERENCES users(id),
    baseline_due     DATE,
    forecast_due     DATE,
    actual_completed DATE,
    weight           INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
    version          INTEGER NOT NULL DEFAULT 1,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestones_project ON milestones(project_id);
CREATE INDEX idx_milestones_owner ON milestones(owner_id);

-- ----------------------------------------------------------------------------
-- E05 — Gate requests (plan §13). One PENDING request per project at a time
-- (partial unique index backstop; the service checks first for a friendly 409).
-- ----------------------------------------------------------------------------
CREATE TABLE gate_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    gate             TEXT NOT NULL CHECK (gate IN ('G0', 'G1', 'G2', 'G3', 'G4', 'G5')),
    from_stage       TEXT NOT NULL,
    to_stage         TEXT NOT NULL,
    requested_by     UUID NOT NULL REFERENCES users(id),
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    note             TEXT,
    disposition_note TEXT,   -- G5: explicit disposition of outstanding work
    status           TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    decided_by       UUID REFERENCES users(id),
    decided_at       TIMESTAMPTZ,
    decision_note    TEXT
);

CREATE INDEX idx_gate_requests_project ON gate_requests(project_id);
CREATE UNIQUE INDEX uniq_gate_requests_pending ON gate_requests(project_id) WHERE status = 'PENDING';

-- ----------------------------------------------------------------------------
-- E05 — Approval ledger (plan §14, invariant 11). IMMUTABLE logical record of
-- every gate decision: no application update/delete endpoints exist and the
-- trigger below forbids UPDATE/DELETE at the database layer (like audit_logs).
-- ----------------------------------------------------------------------------
CREATE TABLE approval_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    gate            TEXT NOT NULL CHECK (gate IN ('G0', 'G1', 'G2', 'G3', 'G4', 'G5')),
    from_stage      TEXT NOT NULL,
    to_stage        TEXT NOT NULL,
    project_version INTEGER NOT NULL,   -- project version at decision time (pre-transition)
    requested_by    UUID NOT NULL REFERENCES users(id),
    requested_at    TIMESTAMPTZ NOT NULL,
    decided_by      UUID NOT NULL REFERENCES users(id),
    decided_at      TIMESTAMPTZ NOT NULL,
    authority_type  TEXT NOT NULL CHECK (authority_type IN ('STEERING', 'ADMIN', 'DIVISION_LEAD')),
    decision        TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_ledger_project ON approval_ledger(project_id);

CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'approval_ledger is an immutable ledger: % is forbidden', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_approval_ledger_immutable
    BEFORE UPDATE OR DELETE ON approval_ledger
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ----------------------------------------------------------------------------
-- E07 — Workstreams (plan §17). Named streams of work inside a project;
-- OCC-versioned like other collaborative entities. Writes: manage-level
-- authority OR the workstream lead (service policy).
-- ----------------------------------------------------------------------------
CREATE TABLE workstreams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    lead_id     UUID REFERENCES users(id),
    start_date  DATE,
    end_date    DATE,
    status      TEXT NOT NULL DEFAULT 'NOT_STARTED'
                CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'ON_HOLD')),
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workstreams_project ON workstreams(project_id);
CREATE INDEX idx_workstreams_lead ON workstreams(lead_id);

-- ----------------------------------------------------------------------------
-- Tasks — dependency_lock points at the prerequisite task (Infra <-> Ops handshake)
-- E07 additions: workstream membership + scheduling fields (planned dates,
-- estimated hours) feeding the Gantt/critical-path computation (plan §18/§20).
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workstream_id   UUID REFERENCES workstreams(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    division        TEXT REFERENCES divisions(code),
    site            TEXT REFERENCES sites(code),
    assignee_id     UUID REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
    priority        TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    dependency_lock UUID REFERENCES tasks(id),          -- prerequisite task; NULL = unlocked
    planned_start   DATE,
    planned_finish  DATE,
    estimated_hours DOUBLE PRECISION CHECK (estimated_hours >= 0),
    risk_tags       TEXT[] NOT NULL DEFAULT '{}',
    sla_due_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_workstream ON tasks(workstream_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_dependency ON tasks(dependency_lock);

-- The service refuses a task whose workstream belongs to another project; this
-- trigger is the database backstop for the same rule.
CREATE OR REPLACE FUNCTION enforce_task_workstream_project() RETURNS trigger AS $$
BEGIN
    IF NEW.workstream_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM workstreams w WHERE w.id = NEW.workstream_id AND w.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'WORKSTREAM_PROJECT_MISMATCH: workstream % does not belong to project %',
            NEW.workstream_id, NEW.project_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_workstream_project
    BEFORE INSERT OR UPDATE OF workstream_id, project_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION enforce_task_workstream_project();

-- ----------------------------------------------------------------------------
-- E07 — Typed task dependencies (plan §20). Immutable rows (create/delete
-- only, no OCC version). Semantics:
--   * FS additionally LOCKS the successor (it cannot advance while the
--     predecessor is not done) — see enforce_task_gates below;
--   * SS/FF/SF are scheduling-only edges (critical path), they never lock.
-- The dependency graph per project must stay ACYCLIC across ALL edge types —
-- the service runs a DFS before insert; the recursive trigger is the backstop.
-- ----------------------------------------------------------------------------
CREATE TABLE task_dependencies (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    predecessor_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    successor_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type           TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
    lag_days       INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_dependency_no_self CHECK (predecessor_id <> successor_id),
    CONSTRAINT uniq_dependency_edge UNIQUE (predecessor_id, successor_id, type)
);

CREATE INDEX idx_task_dependencies_project ON task_dependencies(project_id);
CREATE INDEX idx_task_dependencies_successor ON task_dependencies(successor_id);

-- Backstops for the service rules: both tasks share the row's project, and the
-- new edge may not close a cycle (any dependency type participates).
CREATE OR REPLACE FUNCTION enforce_dependency_rules() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.predecessor_id AND t.project_id = NEW.project_id)
       OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.successor_id AND t.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'DEPENDENCY_PROJECT_MISMATCH: both tasks must belong to project %', NEW.project_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        WITH RECURSIVE reach(task_id) AS (
            SELECT NEW.successor_id
            UNION
            SELECT d.successor_id
              FROM task_dependencies d
              JOIN reach r ON d.predecessor_id = r.task_id
        )
        SELECT 1 FROM reach WHERE task_id = NEW.predecessor_id
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY_CYCLE: edge % -> % would close a dependency cycle',
            NEW.predecessor_id, NEW.successor_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dependency_rules
    BEFORE INSERT OR UPDATE ON task_dependencies
    FOR EACH ROW EXECUTE FUNCTION enforce_dependency_rules();

-- ----------------------------------------------------------------------------
-- Roadblocks — 1-click field logging from site operators
-- ----------------------------------------------------------------------------
CREATE TABLE roadblocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'medium'
                CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'mitigating', 'resolved')),
    reported_by UUID REFERENCES users(id),
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadblocks_project ON roadblocks(project_id);

-- ----------------------------------------------------------------------------
-- E13 — Project updates (plan §32): the fast "~20 second" status pulse and the
-- source of the RAG freshness signal. APPEND-ONLY: the API exposes POST + GET
-- only (no PATCH/DELETE — revisions arrive with the full E13 slice) and the
-- trigger below is the database backstop. No OCC version (rows never change).
-- ----------------------------------------------------------------------------
CREATE TABLE project_updates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id),
    author_id        UUID NOT NULL REFERENCES users(id),
    mood             TEXT NOT NULL CHECK (mood IN ('POSITIVE', 'NEUTRAL', 'CONCERN', 'CRITICAL')),
    text             TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 400),
    accomplishment   TEXT,
    next_step        TEXT,
    support_required TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_updates_project ON project_updates(project_id, created_at);

CREATE OR REPLACE FUNCTION forbid_project_update_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PROJECT_UPDATE_APPEND_ONLY: project updates are append-only: % is forbidden', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_project_updates_append_only
    BEFORE UPDATE OR DELETE ON project_updates
    FOR EACH ROW EXECUTE FUNCTION forbid_project_update_mutation();

-- ----------------------------------------------------------------------------
-- E10 — RAG trend snapshots (plan §133). A row is appended (lazily, at read
-- time) whenever a project's effective or computed RAG color differs from its
-- last snapshot — never backfilled/fabricated. Like the approval ledger this
-- IS a historical record: append-only and not audited.
-- ----------------------------------------------------------------------------
CREATE TABLE rag_snapshots (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    color          TEXT NOT NULL CHECK (color IN ('GREEN', 'AMBER', 'RED')),
    computed_color TEXT NOT NULL CHECK (computed_color IN ('GREEN', 'AMBER', 'RED')),
    is_manual      BOOLEAN NOT NULL DEFAULT false,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rag_snapshots_project ON rag_snapshots(project_id, captured_at);

-- ----------------------------------------------------------------------------
-- Security approvals — InfoSec review pool (routing target for risk tags)
-- ----------------------------------------------------------------------------
CREATE TABLE security_approvals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id      UUID REFERENCES tasks(id) ON DELETE CASCADE,
    risk_tag     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by  UUID REFERENCES users(id),
    reviewed_at  TIMESTAMPTZ,
    notes        TEXT
);

CREATE INDEX idx_security_approvals_status ON security_approvals(status);

-- ----------------------------------------------------------------------------
-- Sync queue — JSONB landing zone for offline payloads (ordered command log)
-- payload shape: { clientId, opId, seq, entity, entityId, op, baseVersion,
--                  clientUpdatedAt, fields }
-- E25/E26 (ADR-003 executed): outcomes are applied | blocked (first failure —
-- the batch halts) | held (every op after the blocked one, untouched).
-- LWW is gone: any stale baseVersion is a conflict ('blocked' VERSION_CONFLICT).
-- ----------------------------------------------------------------------------
CREATE TABLE sync_queue (
    id           BIGSERIAL PRIMARY KEY,
    client_id    TEXT NOT NULL,
    payload      JSONB NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    result       TEXT CHECK (result IN ('applied', 'blocked', 'held')),
    detail       JSONB
);

CREATE INDEX idx_sync_queue_unprocessed ON sync_queue(processed_at) WHERE processed_at IS NULL;

-- ----------------------------------------------------------------------------
-- Audit logs — IMMUTABLE ledger (CGEIT compliance)
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    action      TEXT NOT NULL,          -- INSERT | UPDATE | DELETE
    actor_id    UUID,
    cgeit_tag   TEXT,
    old_data    JSONB,
    new_data    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is an immutable ledger: % is forbidden', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- Generic audit trigger for tracked tables. The API sets the acting user via
--   SET LOCAL opspm360.actor_id = '<uuid>'
CREATE OR REPLACE FUNCTION write_audit_log() RETURNS trigger AS $$
DECLARE
    v_actor UUID := NULLIF(current_setting('opspm360.actor_id', true), '')::UUID;
    v_old   JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_new   JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    v_id    UUID  := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::UUID
                          ELSE (to_jsonb(NEW)->>'id')::UUID END;
BEGIN
    INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, cgeit_tag, old_data, new_data)
    VALUES (TG_TABLE_NAME, v_id, TG_OP, v_actor,
            COALESCE(v_new->>'cgeit_tag', v_old->>'cgeit_tag'), v_old, v_new);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_users     AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_projects  AFTER INSERT OR UPDATE OR DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_tasks     AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_roadblocks AFTER INSERT OR UPDATE OR DELETE ON roadblocks
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_security  AFTER INSERT OR UPDATE OR DELETE ON security_approvals
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_pillars   AFTER INSERT OR UPDATE OR DELETE ON strategic_pillars
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_portfolios AFTER INSERT OR UPDATE OR DELETE ON portfolios
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_programs  AFTER INSERT OR UPDATE OR DELETE ON programs
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_members   AFTER INSERT OR UPDATE OR DELETE ON project_members
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_milestones AFTER INSERT OR UPDATE OR DELETE ON milestones
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_gate_requests AFTER INSERT OR UPDATE OR DELETE ON gate_requests
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_workstreams AFTER INSERT OR UPDATE OR DELETE ON workstreams
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER trg_audit_task_dependencies AFTER INSERT OR UPDATE OR DELETE ON task_dependencies
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
-- project_updates are append-only, so only INSERT can ever fire.
CREATE TRIGGER trg_audit_project_updates AFTER INSERT ON project_updates
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
-- approval_ledger and rag_snapshots are themselves governance/derived records
-- (like audit_logs) — not audited.

-- ----------------------------------------------------------------------------
-- GOVERNANCE: security routing
-- Any project/task carrying 'network_alteration' (or other network risk tags)
-- automatically opens a pending InfoSec approval and gates the project.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION route_security_review() RETURNS trigger AS $$
DECLARE
    -- to_jsonb(NEW) avoids plan-time resolution of NEW.project_id, which does
    -- not exist on the projects row type (the function serves both tables).
    v_project_id UUID := CASE WHEN TG_TABLE_NAME = 'projects' THEN NEW.id
                              ELSE (to_jsonb(NEW)->>'project_id')::UUID END;
    v_task_id    UUID := CASE WHEN TG_TABLE_NAME = 'tasks' THEN NEW.id ELSE NULL END;
    v_tag        TEXT;
BEGIN
    FOREACH v_tag IN ARRAY NEW.risk_tags LOOP
        IF EXISTS (SELECT 1 FROM security_risk_tags WHERE code = v_tag) THEN
            IF NOT EXISTS (
                SELECT 1 FROM security_approvals
                WHERE project_id = v_project_id
                  AND (task_id IS NOT DISTINCT FROM v_task_id)
                  AND risk_tag = v_tag
                  AND status IN ('pending', 'approved')
            ) THEN
                INSERT INTO security_approvals (project_id, task_id, risk_tag)
                VALUES (v_project_id, v_task_id, v_tag);
                UPDATE projects
                   SET security_gate_status = 'pending',
                       version = version + 1,
                       updated_at = now()
                 WHERE id = v_project_id
                   AND security_gate_status IN ('not_required', 'approved', 'rejected');
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_route_security_projects
    AFTER INSERT OR UPDATE OF risk_tags ON projects
    FOR EACH ROW WHEN (array_length(NEW.risk_tags, 1) > 0)
    EXECUTE FUNCTION route_security_review();

CREATE TRIGGER trg_route_security_tasks
    AFTER INSERT OR UPDATE OF risk_tags ON tasks
    FOR EACH ROW WHEN (array_length(NEW.risk_tags, 1) > 0)
    EXECUTE FUNCTION route_security_review();

-- ----------------------------------------------------------------------------
-- GOVERNANCE: hard gates on task progression
--   1. Dependency lock (v1 single-prereq): a task cannot advance while its
--      prerequisite is not done.
--   1b. E07 typed dependencies: an FS predecessor that is not done locks the
--       successor the same way. SS/FF/SF never lock (scheduling-only).
--   2. Security gate: no task advances while the project awaits InfoSec approval.
-- (The API mirrors these checks to give friendly errors; the DB is the backstop.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_task_gates() RETURNS trigger AS $$
DECLARE
    v_dep_status  TEXT;
    v_gate_status TEXT;
    v_fs_blocker  UUID;
BEGIN
    IF NEW.status IN ('in_progress', 'done') AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.dependency_lock IS NOT NULL THEN
            SELECT status INTO v_dep_status FROM tasks WHERE id = NEW.dependency_lock;
            IF v_dep_status IS DISTINCT FROM 'done' THEN
                RAISE EXCEPTION 'DEPENDENCY_LOCKED: prerequisite task % is not complete', NEW.dependency_lock
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        SELECT d.predecessor_id INTO v_fs_blocker
          FROM task_dependencies d
          JOIN tasks p ON p.id = d.predecessor_id
         WHERE d.successor_id = NEW.id AND d.type = 'FS' AND p.status <> 'done'
         LIMIT 1;
        IF v_fs_blocker IS NOT NULL THEN
            RAISE EXCEPTION 'DEPENDENCY_LOCKED: FS predecessor task % is not complete', v_fs_blocker
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT security_gate_status INTO v_gate_status FROM projects WHERE id = NEW.project_id;
        IF v_gate_status = 'pending' THEN
            RAISE EXCEPTION 'SECURITY_GATE: project awaits InfoSec approval'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_gates
    BEFORE UPDATE OF status ON tasks
    FOR EACH ROW EXECUTE FUNCTION enforce_task_gates();

-- ----------------------------------------------------------------------------
-- Read-only role for Data Insight / corporate BI ingestion
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_reader') THEN
        CREATE ROLE bi_reader NOLOGIN;
    END IF;
END $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_reader;
-- Never expose credential/session material to BI ingestion.
REVOKE SELECT ON user_credentials, user_sessions FROM bi_reader;
