-- ============================================================================
-- OpsPM360 — Demo seed data (Sabodala / Saly mining context)
-- ============================================================================

INSERT INTO users (id, name, email, division, site, role) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Awa Ndiaye',     'awa.ndiaye@opspm360.local',     'ops',        'sabodala', 'site_manager'),
    ('00000000-0000-0000-0000-000000000002', 'Moussa Diallo',  'moussa.diallo@opspm360.local',  'infra',      'saly',     'division_lead'),
    ('00000000-0000-0000-0000-000000000003', 'Hamady Soumare', 'hamady.soumare@opspm360.local', 'infosec',    'hq',       'security_reviewer'),
    ('00000000-0000-0000-0000-000000000004', 'Troy Coordinator','troy@opspm360.local',          'management', 'hq',       'group_manager'),
    ('00000000-0000-0000-0000-000000000005', 'Fatou Sarr',     'fatou.sarr@opspm360.local',     'data',       'hq',       'division_lead'),
    ('00000000-0000-0000-0000-000000000006', 'Ibrahima Ba',    'ibrahima.ba@opspm360.local',    'bizapps',    'hq',       'member'),
    ('00000000-0000-0000-0000-000000000007', 'Aminata Fall',   'aminata.fall@opspm360.local',   'ea',         'hq',       'division_lead');

-- Project 1: Ops site prep at Saly (prerequisite for Infra rollout)
INSERT INTO projects (id, name, description, division, site, cgeit_tag, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000001',
     'Saly Site Readiness',
     'Physical site preparation: cabling paths, server room environmentals, power.',
     'ops', 'saly', 'resource_optimization', 'active',
     '00000000-0000-0000-0000-000000000001');

-- Project 2: Infra network deployment at Saly (network-altering -> InfoSec gate fires)
INSERT INTO projects (id, name, description, division, site, cgeit_tag, strategic_tag, risk_tags, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000002',
     'Saly Core Network Deployment',
     'New core switching and WAN uplink for Saly site.',
     'infra', 'saly', 'risk_optimization', 'EA-BLUEPRINT-NET-2026',
     ARRAY['network_alteration'], 'active',
     '00000000-0000-0000-0000-000000000002');

-- Project 3: ERP module rollout (Business Apps)
INSERT INTO projects (id, name, description, division, site, cgeit_tag, overall_status, owner_id) VALUES
    ('10000000-0000-0000-0000-000000000003',
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
