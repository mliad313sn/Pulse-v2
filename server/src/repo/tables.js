/** Entity kind -> storage table name, shared by every repo implementation. */
export const TABLES = {
  project: 'projects',
  task: 'tasks',
  roadblock: 'roadblocks',
  approval: 'security_approvals',
  pillar: 'strategic_pillars',
  portfolio: 'portfolios',
  program: 'programs',
  member: 'project_members',
  milestone: 'milestones',
  gateRequest: 'gate_requests',
  workstream: 'workstreams',
  dependency: 'task_dependencies',
};
