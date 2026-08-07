import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, preferUserSite, mountEntityCrud } from './helpers.js';
import {
  assertReadProject, canManageProjectWork, canWriteRoadblock, readableProjectIds,
} from '../services/policy.js';
import { createEntity } from '../services/entityOps.js';
import { forbidden, notFound, validation } from '../errors.js';
import { nowIso } from '../services/time.js';

export function roadblocksRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.projectId ? { projectId: req.query.projectId } : {};
    const [roadblocks, { projects, membersByProject }] = await Promise.all([
      repo.list('roadblock', filter),
      loadProjectAccess(repo),
    ]);
    // ADR-005 + E01 enterprise access: roadblocks of concealed projects are
    // absent from every list.
    const visible = readableProjectIds(req.user, projects, membersByProject);
    const scoped = roadblocks.filter((r) => visible.has(r.projectId));
    const siteByProject = new Map(projects.map((p) => [p.id, p.site]));
    res.json(preferUserSite(scoped, req.user, (r) => siteByProject.get(r.projectId)));
  }));

  /** Loads roadblock + project + members with ADR-005 concealment (uniform 404). */
  async function loadRoadblock(repo, user, id) {
    const roadblock = await repo.get('roadblock', id);
    if (!roadblock) throw notFound(`roadblock ${id} not found`);
    const project = await repo.get('project', roadblock.projectId);
    const members = project ? await repo.listProjectMembers(project.id) : [];
    assertReadProject(user, project, 'roadblock', id, members);
    return { roadblock, project, members };
  }

  /**
   * POST /api/roadblocks/:id/escalate — one-click escalation (E11, plan §27).
   * Any roadblock writer may escalate. Sets escalated/escalatedAt (server
   * managed — never PATCHable), bumps the version, audits ESCALATED.
   * A RESOLVED/VERIFIED roadblock cannot be escalated (400) unless reopened
   * first (plan §27 rule). Idempotent: an already-escalated roadblock returns
   * 200 unchanged (no duplicate audit).
   * TODO(E19): fan the ESCALATED audit event out through the notification
   * engine (admins as configured, engaged division leads, owner, PM).
   */
  router.post('/:id/escalate', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { roadblock, project, members } = await loadRoadblock(repo, req.user, req.params.id);
    if (!canWriteRoadblock(req.user, project, roadblock, members)) {
      throw forbidden('Escalating a roadblock requires project management authority, membership, ownership, or being the reporter');
    }
    if (roadblock.status === 'RESOLVED' || roadblock.status === 'VERIFIED') {
      throw validation('A RESOLVED/VERIFIED roadblock cannot be escalated; reopen it first (status RAISED with a reopenReason)', {
        field: 'status', status: roadblock.status,
      });
    }
    if (roadblock.escalated) {
      res.json(roadblock);
      return;
    }
    const updated = await repo.transaction(req.user.id, async (tx) => {
      const written = await tx.update('roadblock', {
        ...roadblock,
        escalated: true,
        escalatedAt: nowIso(),
        version: roadblock.version + 1,
        updatedAt: nowIso(),
      });
      await tx.appendAudit({
        entityType: 'roadblocks',
        entityId: roadblock.id,
        action: 'ESCALATED',
        actorId: req.user.id,
        newData: { severity: roadblock.severity, status: roadblock.status, escalatedAt: written.escalatedAt },
      });
      return written;
    });
    res.json(updated);
  }));

  /**
   * POST /api/roadblocks/:id/capa {issue?, ownerId?, ...capa fields} —
   * convert a roadblock into a CAPA (§29). Allowed for manage-level authority
   * or the roadblock's owner. The created CAPA is prefilled with sourceType
   * ROADBLOCK + sourceId + the roadblock's projectId (never overridable), and
   * issue defaults to the roadblock description, ownerId to the caller.
   */
  router.post('/:id/capa', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { roadblock, project, members } = await loadRoadblock(repo, req.user, req.params.id);
    if (!canManageProjectWork(req.user, project, members) && roadblock.ownerId !== req.user.id) {
      throw forbidden('Converting a roadblock to a CAPA requires project management authority or being the roadblock owner');
    }
    const payload = {
      issue: roadblock.description,
      ownerId: req.user.id,
      ...(req.body ?? {}),
      // Source linkage is authoritative — the route, not the client, sets it.
      sourceType: 'ROADBLOCK',
      sourceId: roadblock.id,
      projectId: roadblock.projectId,
    };
    const created = await repo.transaction(req.user.id, (tx) =>
      createEntity(tx, req.user, 'capa', payload));
    res.status(201).json(created);
  }));

  mountEntityCrud(router, 'roadblock');

  return router;
}
