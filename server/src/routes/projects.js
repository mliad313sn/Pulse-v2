import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import {
  loadProjectAccess, mountEntityCrud, withLocked, withPm, withPmAll, withPmOne,
} from './helpers.js';
import {
  LEAD_ROLES, PROJECT_ROLES, assertCan, assertReadProject, canManageProjectWork,
  filterReadableProjects,
} from '../services/policy.js';
import { forbidden, notFound, validation } from '../errors.js';

export function projectsRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const { projects, membersByProject } = await loadProjectAccess(req.app.locals.repo);
    const visible = filterReadableProjects(req.user, projects, membersByProject);
    res.json(withPmAll(visible, membersByProject));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const members = await repo.listProjectMembers(project.id);
    // ADR-005 concealment: unreadable -> same 404 as a missing id.
    assertReadProject(req.user, project, 'project', req.params.id, members);
    res.json(withPm(project, members));
  }));

  router.get('/:id/tasks', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const members = await repo.listProjectMembers(project.id);
    assertReadProject(req.user, project, 'project', req.params.id, members);
    const tasks = await repo.list('task', { projectId: req.params.id });
    res.json(await withLocked(repo, tasks, { projects: [project] }));
  }));

  // ---- project membership (E04) --------------------------------------------

  /** Loads project + members with concealment; returns both. */
  async function loadForMembers(repo, user, id) {
    const project = await repo.get('project', id);
    if (!project) throw notFound(`project ${id} not found`);
    const members = await repo.listProjectMembers(id);
    assertReadProject(user, project, 'project', id, members);
    return { project, members };
  }

  const memberWire = (m) => ({ projectId: m.projectId, userId: m.userId, role: m.role });

  router.get('/:id/members', asyncHandler(async (req, res) => {
    const { members } = await loadForMembers(req.app.locals.repo, req.user, req.params.id);
    res.json(members.map(memberWire));
  }));

  /**
   * POST /api/projects/:id/members {userId, role}
   * Managed by ADMIN, the project's PM, or a DIVISION_LEAD of its division.
   * Exactly one PM: posting role PM atomically swaps the current PM out
   * (both membership mutations are audited). VIEWER users can never be PM or
   * WORKSTREAM_LEAD (plan invariant 2 -> 400 VALIDATION).
   */
  router.post('/:id/members', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { project, members } = await loadForMembers(repo, req.user, req.params.id);
    if (!canManageProjectWork(req.user, project, members)) {
      throw forbidden('Managing project members requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
    }

    const { userId, role } = req.body ?? {};
    if (typeof userId !== 'string' || !userId) {
      throw validation('userId is required', { field: 'userId' });
    }
    if (!PROJECT_ROLES.includes(role)) {
      throw validation(`role must be one of ${PROJECT_ROLES.join(', ')}`, { field: 'role', allowed: PROJECT_ROLES });
    }
    const target = await repo.getUser(userId);
    if (!target) throw validation(`Unknown userId: ${userId}`, { field: 'userId' });
    if (target.baseRole === 'VIEWER' && LEAD_ROLES.includes(role)) {
      // Plan invariant 2: read-only accounts never lead work.
      throw validation('VIEWER users cannot be assigned PM or WORKSTREAM_LEAD', { field: 'role' });
    }
    if (members.some((m) => m.userId === userId && m.role === role)) {
      throw validation('User already holds this role on the project', { field: 'role' });
    }

    const created = await repo.transaction(req.user.id, async (tx) => {
      if (role === 'PM') {
        // Atomic PM swap: remove the incumbent (audited DELETE) in the same
        // transaction as the new assignment (audited INSERT).
        const incumbent = members.find((m) => m.role === 'PM');
        if (incumbent) await tx.deleteProjectMember(project.id, incumbent.userId, 'PM');
      }
      return tx.insertProjectMember({ projectId: project.id, userId, role });
    });
    res.status(201).json(memberWire(created));
  }));

  router.delete('/:id/members/:userId/:role', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { project, members } = await loadForMembers(repo, req.user, req.params.id);
    if (!canManageProjectWork(req.user, project, members)) {
      throw forbidden('Managing project members requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
    }
    const { userId, role } = req.params;
    const removed = await repo.transaction(req.user.id, (tx) =>
      tx.deleteProjectMember(project.id, userId, role));
    if (!removed) throw notFound(`membership ${userId}/${role} not found on project ${project.id}`);
    res.status(204).end();
  }));

  mountEntityCrud(router, 'project', {
    canCreate: (user) => assertCan(user, 'project:create'),
    buildPayload: (req) => ({ ownerId: req.user.id, ...req.body }),
    decorate: (repo, row) => withPmOne(repo, row),
  });

  return router;
}
