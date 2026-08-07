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
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
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
-- Projects — OCC via (version, updated_at)
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL,
    description          TEXT,
    division             TEXT NOT NULL REFERENCES divisions(code),
    site                 TEXT REFERENCES sites(code),
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

-- ----------------------------------------------------------------------------
-- Tasks — dependency_lock points at the prerequisite task (Infra <-> Ops handshake)
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
    risk_tags       TEXT[] NOT NULL DEFAULT '{}',
    sla_due_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_dependency ON tasks(dependency_lock);

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
-- Sync queue — JSONB landing zone for offline payloads
-- payload shape: { clientId, entity, entityId, op, baseVersion, clientUpdatedAt, fields }
-- ----------------------------------------------------------------------------
CREATE TABLE sync_queue (
    id           BIGSERIAL PRIMARY KEY,
    client_id    TEXT NOT NULL,
    payload      JSONB NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    result       TEXT CHECK (result IN ('applied', 'lww_applied', 'conflict_manual', 'rejected')),
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

-- ----------------------------------------------------------------------------
-- GOVERNANCE: security routing
-- Any project/task carrying 'network_alteration' (or other network risk tags)
-- automatically opens a pending InfoSec approval and gates the project.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION route_security_review() RETURNS trigger AS $$
DECLARE
    v_project_id UUID := CASE WHEN TG_TABLE_NAME = 'projects' THEN NEW.id ELSE NEW.project_id END;
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
--   1. Dependency lock: a task cannot advance while its prerequisite is not done.
--   2. Security gate: no task advances while the project awaits InfoSec approval.
-- (The API mirrors these checks to give friendly errors; the DB is the backstop.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_task_gates() RETURNS trigger AS $$
DECLARE
    v_dep_status  TEXT;
    v_gate_status TEXT;
BEGIN
    IF NEW.status IN ('in_progress', 'done') AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.dependency_lock IS NOT NULL THEN
            SELECT status INTO v_dep_status FROM tasks WHERE id = NEW.dependency_lock;
            IF v_dep_status IS DISTINCT FROM 'done' THEN
                RAISE EXCEPTION 'DEPENDENCY_LOCKED: prerequisite task % is not complete', NEW.dependency_lock
                    USING ERRCODE = 'check_violation';
            END IF;
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
