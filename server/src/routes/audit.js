import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess } from './helpers.js';
import { readableProjectIds } from '../services/policy.js';

/** projectId of an audit entry's subject, tolerant of camelCase (memory)
 *  and snake_case (pg trigger) payloads. */
function auditProjectId(entry) {
  const data = entry.newData ?? entry.oldData ?? {};
  return data.projectId ?? data.project_id ?? null;
}

const PROJECT_SCOPED_TYPES = new Set([
  'tasks', 'roadblocks', 'security_approvals', 'project_members', 'project_updates',
]);

/** GET /api/audit?entityId= — read-only audit trail. */
export function auditRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = {};
    if (req.query.entityId) filter.entityId = req.query.entityId;
    if (req.query.entityType) filter.entityType = req.query.entityType;
    const [entries, { projects, membersByProject }] = await Promise.all([
      repo.listAudit(filter),
      loadProjectAccess(repo),
    ]);
    // ADR-005 + E01 enterprise access: audit rows about concealed projects
    // (or their children) are filtered out — audit-by-entity must not confirm
    // existence.
    const visible = readableProjectIds(req.user, projects, membersByProject);
    const existing = new Set(projects.map((p) => p.id));
    res.json(entries.filter((e) => {
      if (e.entityType === 'projects') {
        return !existing.has(e.entityId) || visible.has(e.entityId);
      }
      if (PROJECT_SCOPED_TYPES.has(e.entityType)) {
        const pid = auditProjectId(e);
        return pid == null || !existing.has(pid) || visible.has(pid);
      }
      return true;
    }));
  }));
  return router;
}
