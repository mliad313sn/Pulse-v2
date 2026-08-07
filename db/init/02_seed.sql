-- ============================================================================
-- OpsPM360 — Demo seed data (Sabodala / Saly mining context)
-- ============================================================================

-- Base roles per ADR-004 mapping (group_manager->ADMIN, division_lead->DIVISION_LEAD,
-- site_manager/member->CONTRIBUTOR, security_reviewer->CONTRIBUTOR + privilege).
INSERT INTO users (id, name, email, division, site, base_role, privileges) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Awa Ndiaye',     'awa.ndiaye@opspm360.local',     'ops',        'sabodala', 'CONTRIBUTOR',   '{}'),
    ('00000000-0000-0000-0000-000000000002', 'Moussa Diallo',  'moussa.diallo@opspm360.local',  'infra',      'saly',     'DIVISION_LEAD', '{}'),
    ('00000000-0000-0000-0000-000000000003', 'Hamady Soumare', 'hamady.soumare@opspm360.local', 'infosec',    'hq',       'CONTRIBUTOR',   '{security_reviewer}'),
    ('00000000-0000-0000-0000-000000000004', 'Troy Coordinator','troy@opspm360.local',          'management', 'hq',       'ADMIN',         '{}'),
    ('00000000-0000-0000-0000-000000000005', 'Fatou Sarr',     'fatou.sarr@opspm360.local',     'data',       'hq',       'DIVISION_LEAD', '{}'),
    ('00000000-0000-0000-0000-000000000006', 'Ibrahima Ba',    'ibrahima.ba@opspm360.local',    'bizapps',    'hq',       'CONTRIBUTOR',   '{}'),
    ('00000000-0000-0000-0000-000000000007', 'Aminata Fall',   'aminata.fall@opspm360.local',   'ea',         'hq',       'DIVISION_LEAD', '{}'),
    ('00000000-0000-0000-0000-000000000008', 'Aissatou Diop',  'viewer@opspm360.local',         'management', 'hq',       'VIEWER',        '{}');

-- ----------------------------------------------------------------------------
-- DEV credentials (bcrypt cost 10). DEV/DEMO ONLY — never ship these.
-- Each seed user's password is  Dev!<firstname>2026 :
--   troy@opspm360.local            Dev!Troy2026
--   moussa.diallo@opspm360.local   Dev!Moussa2026
--   fatou.sarr@opspm360.local      Dev!Fatou2026
--   aminata.fall@opspm360.local    Dev!Aminata2026
--   awa.ndiaye@opspm360.local      Dev!Awa2026
--   ibrahima.ba@opspm360.local     Dev!Ibrahima2026
--   hamady.soumare@opspm360.local  Dev!Hamady2026
--   viewer@opspm360.local          Dev!Aissatou2026
-- (Also documented in server/README.md. MemoryRepo embeds the SAME hashes.)
-- ----------------------------------------------------------------------------
INSERT INTO user_credentials (user_id, password_hash) VALUES
    ('00000000-0000-0000-0000-000000000001', '$2b$10$VdbJjev4Wfz5o6CvSSF1sOfJoM/L5Q5Iib2EQxr3TaGmFYYG/qA1u'),
    ('00000000-0000-0000-0000-000000000002', '$2b$10$KNfGt2/C4p90.1xmt73/7.8nb7a9Vz9f58Mp9ei62420w/W1stitG'),
    ('00000000-0000-0000-0000-000000000003', '$2b$10$BDaHTWpwHXuz.U/W.YSaW./EoE3QK6Hjta.q8rgY3N3/jU3QghLnW'),
    ('00000000-0000-0000-0000-000000000004', '$2b$10$KihyVGlZQaiqH8Bihf26COg78gAiWd1vtAjHWWADb9V.zx6Pp28Wy'),
    ('00000000-0000-0000-0000-000000000005', '$2b$10$RkzH32eVTcosljPXTTndSOl1S8VqFV.JIVIy5zq2wgg/7CPqQ2pj6'),
    ('00000000-0000-0000-0000-000000000006', '$2b$10$Pa07A7RaIHeKIWustQ83cuxH5lMhTZ1WylYls0ggzu6tG415WIM3S'),
    ('00000000-0000-0000-0000-000000000007', '$2b$10$gA8k1kzBqRJPQUh.tZvd3uoBy2XLL3eeA8i.WGedvn8qJG07hadIO'),
    ('00000000-0000-0000-0000-000000000008', '$2b$10$60lEYqbFOashKXtg0YavEO/RpGgYqbKHkiHf3/oUkH7LvWi8N3jra');

-- Project codes are server-generated PRJ-YYYY-NNN; the seed backfills the
-- 2026 sequence so the next created project becomes PRJ-2026-004.
INSERT INTO project_code_sequences (year, last_value) VALUES (2026, 3);

-- Project 1: Ops site prep at Saly (prerequisite for Infra rollout)
INSERT INTO projects (id, code, name, description, division, site, cgeit_tag, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000001',
     'PRJ-2026-001',
     'Saly Site Readiness',
     'Physical site preparation: cabling paths, server room environmentals, power.',
     'ops', 'saly', 'resource_optimization', 'active',
     '00000000-0000-0000-0000-000000000001');

-- Project 2: Infra network deployment at Saly (network-altering -> InfoSec gate fires)
INSERT INTO projects (id, code, name, description, division, site, cgeit_tag, strategic_tag, risk_tags, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000002',
     'PRJ-2026-002',
     'Saly Core Network Deployment',
     'New core switching and WAN uplink for Saly site.',
     'infra', 'saly', 'risk_optimization', 'EA-BLUEPRINT-NET-2026',
     ARRAY['network_alteration'], 'active',
     '00000000-0000-0000-0000-000000000002');

-- Project 3: ERP module rollout (Business Apps)
INSERT INTO projects (id, code, name, description, division, site, cgeit_tag, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000003',
     'PRJ-2026-003',
     'ERP Maintenance Module Rollout',
     'Deploy ERP maintenance planning module once operational bandwidth allows.',
     'bizapps', 'sabodala', 'value_delivery', 'active',
     '00000000-0000-0000-0000-000000000006');

-- Ops prerequisite task
INSERT INTO tasks (id, project_id, title, division, site, assignee_id, status, priority) VALUES
    ('20000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'Complete server room site prep (power + cooling)',
     'ops', 'saly',
     '00000000-0000-0000-0000-000000000001',
     'in_progress', 'high');

-- Infra task locked behind the Ops prerequisite (dependency handshake)
INSERT INTO tasks (id, project_id, title, division, site, assignee_id, status, priority, dependency_lock) VALUES
    ('20000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000002',
     'Install core switches and bring up WAN uplink',
     'infra', 'saly',
     '00000000-0000-0000-0000-000000000002',
     'todo', 'critical',
     '20000000-0000-0000-0000-000000000001');

INSERT INTO tasks (id, project_id, title, division, site, assignee_id, status, priority) VALUES
    ('20000000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000003',
     'Validate ERP module in staging',
     'bizapps', 'hq',
     '00000000-0000-0000-0000-000000000006',
     'todo', 'normal');

INSERT INTO roadblocks (project_id, task_id, description, severity, status, reported_by) VALUES
    ('10000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000001',
     'Cooling unit delivery delayed at customs',
     'high', 'open',
     '00000000-0000-0000-0000-000000000001');
