import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import {
  loadProjectAccess, mountEntityCrud, newestFirst, withLocked, withPmAll, withPmOne,
  withRagAll, withRagOne,
} from './helpers.js';
import {
  LEAD_ROLES, PROJECT_ROLES, assertCan, assertReadProject, canManageProjectWork,
  filterReadableProjects,
} from '../services/policy.js';
import { RAG_COLORS } from '../services/rag.js';
import {
  evaluateGate, gateForStage, loadGateContext, nextStage,
} from '../services/gateEngine.js';
import { gateRequestWire } from './gates.js';
import { dependencyWire } from './dependencies.js';
import { computeSchedule } from '../services/schedule.js';
import {
  forbidden, gateRequestPending, gateRequirementsNotMet, notFound,
  ragOverrideReasonTooShort, validation,
} from '../errors.js';
import { nowIso } from '../services/time.js';
import { randomUUID } from 'node:crypto';

export function projectsRouter() {
  const router = Router();

  /** Full project wire decoration: pmId + progress (E08) + rag (E10). */
  async function decorateProject(repo, project) {
    return withRagOne(repo, await withPmOne(repo, project));
  }

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const access = await loadProjectAccess(repo, { rag: true });
    const visible = filterReadableProjects(req.user, access.projects, access.membersByProject);
    res.json(await withRagAll(
      repo, withPmAll(visible, access.membersByProject, access.milestonesByProject), access));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const members = await repo.listProjectMembers(project.id);
    // ADR-005 concealment: unreadable -> same 404 as a missing id.
    assertReadProject(req.user, project, 'project', req.params.id, members);
    res.json(await decorateProject(repo, project));
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

  // ---- milestones (E08 core) -----------------------------------------------

  router.get('/:id/milestones', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const members = await repo.listProjectMembers(project.id);
    assertReadProject(req.user, project, 'project', req.params.id, members);
    res.json(await repo.list('milestone', { projectId: project.id }));
  }));

  // ---- workstreams + dependencies + schedule (E07 core) --------------------

  /** Loads project with concealment; returns it. */
  async function loadReadableProject(repo, user, id) {
    const project = await repo.get('project', id);
    if (!project) throw notFound(`project ${id} not found`);
    const members = await repo.listProjectMembers(project.id);
    assertReadProject(user, project, 'project', id, members);
    return project;
  }

  router.get('/:id/workstreams', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    res.json(await repo.list('workstream', { projectId: project.id }));
  }));

  // ---- actions (E09) + risks (E11) -----------------------------------------

  /** GET /api/projects/:id/actions — the project's actions; any reader. */
  router.get('/:id/actions', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    res.json(await repo.list('action', { projectId: project.id }));
  }));

  /** GET /api/projects/:id/risks — the project's risk register; any reader. */
  router.get('/:id/risks', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    res.json(await repo.list('risk', { projectId: project.id }));
  }));

  router.get('/:id/dependencies', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    res.json((await repo.list('dependency', { projectId: project.id })).map(dependencyWire));
  }));

  /**
   * GET /api/projects/:id/schedule — CPM forward/backward pass over the
   * project's tasks + typed dependencies (services/schedule.js). Any reader.
   */
  router.get('/:id/schedule', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    const [tasks, dependencies] = await Promise.all([
      repo.list('task', { projectId: project.id }),
      repo.list('dependency', { projectId: project.id }),
    ]);
    res.json(computeSchedule(tasks, dependencies));
  }));

  // ---- project updates (E13 core) + RAG (E10) ------------------------------

  /** GET /api/projects/:id/updates — newest first; any reader (concealed 404). */
  router.get('/:id/updates', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    res.json(newestFirst(await repo.list('projectUpdate', { projectId: project.id })));
  }));

  /** GET /api/projects/:id/rag-history — snapshots, newest first (plan §133). */
  router.get('/:id/rag-history', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadReadableProject(repo, req.user, req.params.id);
    // Decoration lazily appends the snapshot on color change; run it here so
    // the history always includes the CURRENT state before answering.
    await withRagOne(repo, project);
    res.json((await repo.listRagSnapshots({ projectId: project.id })).reverse());
  }));

  /** Loads project + members with concealment and demands manage-level authority. */
  async function loadForRagOverride(repo, user, id) {
    const project = await repo.get('project', id);
    if (!project) throw notFound(`project ${id} not found`);
    const members = await repo.listProjectMembers(project.id);
    assertReadProject(user, project, 'project', id, members);
    if (!canManageProjectWork(user, project, members)) {
      throw forbidden('Managing the RAG override requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
    }
    return project;
  }

  /**
   * POST /api/projects/:id/rag-override {color, reason} — manual RAG override
   * (plan §25). Manage-level only; reason must trim to >=30 chars
   * (400 RAG_OVERRIDE_REASON_TOO_SHORT). Audited with the computed color at
   * override time. Returns the decorated project (rag.manual set).
   */
  router.post('/:id/rag-override', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadForRagOverride(repo, req.user, req.params.id);
    const { color, reason } = req.body ?? {};
    if (!RAG_COLORS.includes(color)) {
      throw validation(`color must be one of ${RAG_COLORS.join(', ')}`, { field: 'color', allowed: RAG_COLORS });
    }
    if (typeof reason !== 'string' || reason.trim().length < 30) {
      throw ragOverrideReasonTooShort();
    }

    // Compute the pre-override color for the permanent audit record (plan §25).
    const before = await withRagOne(repo, project);
    const override = { color, reason: reason.trim(), byId: req.user.id, at: nowIso() };
    const updated = await repo.transaction(req.user.id, async (tx) => {
      const written = await tx.update('project', {
        ...project, ragOverride: override, version: project.version + 1, updatedAt: nowIso(),
      });
      await tx.appendAudit({
        entityType: 'projects',
        entityId: project.id,
        action: 'RAG_OVERRIDE_SET',
        actorId: req.user.id,
        newData: {
          color, reason: override.reason,
          computedColorBefore: before.rag.computedColor, effectiveColorAfter: color,
        },
      });
      return written;
    });
    res.json(await decorateProject(repo, updated));
  }));

  /**
   * DELETE /api/projects/:id/rag-override — clears the override (manage-level,
   * audited, idempotent). Returns the decorated project (rag.manual null).
   */
  router.delete('/:id/rag-override', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await loadForRagOverride(repo, req.user, req.params.id);
    if (project.ragOverride == null) {
      res.json(await decorateProject(repo, project));
      return;
    }
    const cleared = project.ragOverride;
    // Clearing does not change the COMPUTED color — capture it up front.
    const before = await withRagOne(repo, project);
    const updated = await repo.transaction(req.user.id, async (tx) => {
      const written = await tx.update('project', {
        ...project, ragOverride: null, version: project.version + 1, updatedAt: nowIso(),
      });
      await tx.appendAudit({
        entityType: 'projects',
        entityId: project.id,
        action: 'RAG_OVERRIDE_CLEARED',
        actorId: req.user.id,
        newData: {
          cleared,
          effectiveColorBefore: cleared.color, computedColorAfter: before.rag.computedColor,
        },
      });
      return written;
    });
    res.json(await decorateProject(repo, updated));
  }));

  // ---- gate engine (E05) ---------------------------------------------------

  /** Loads project (+concealment check) and the full gate context. */
  async function loadForGates(repo, user, id) {
    const project = await repo.get('project', id);
    if (!project) throw notFound(`project ${id} not found`);
    const ctx = await loadGateContext(repo, project);
    assertReadProject(user, project, 'project', id, ctx.members);
    return ctx;
  }

  /**
   * GET /api/projects/:id/gates — the War Room checklist: current stage, the
   * next gate's requirement evaluation, and any pending gate request.
   */
  router.get('/:id/gates', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const ctx = await loadForGates(repo, req.user, req.params.id);
    const { project } = ctx;
    const gateDef = gateForStage(project.lifecycleStage);
    const pending = (await repo.list('gateRequest', { projectId: project.id, status: 'PENDING' }))[0];

    const out = {
      stage: project.lifecycleStage,
      nextStage: nextStage(project.lifecycleStage),
      gate: gateDef?.gate ?? null,
      requirements: [],
      steeringRequired: gateDef?.steeringRequired ?? false,
    };
    if (gateDef) {
      const evaluation = evaluateGate(gateDef, ctx);
      out.requirements = evaluation.requirements;
    }
    if (pending) out.pendingRequest = gateRequestWire(pending);
    res.json(out);
  }));

  /**
   * POST /api/projects/:id/gates/request {note?, dispositionNote?}
   * Requester needs manage-level authority. 422 GATE_REQUIREMENTS_NOT_MET
   * while requirements are unmet; 409 GATE_REQUEST_PENDING if one is open.
   */
  router.post('/:id/gates/request', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const ctx = await loadForGates(repo, req.user, req.params.id);
    const { project, members } = ctx;
    if (!canManageProjectWork(req.user, project, members)) {
      throw forbidden('Requesting a gate requires ADMIN, the project PM, or a DIVISION_LEAD of its division');
    }
    const gateDef = gateForStage(project.lifecycleStage);
    if (!gateDef) {
      throw validation(`Project is ${project.lifecycleStage}: no further gate exists`);
    }
    const { note, dispositionNote } = req.body ?? {};
    const pending = (await repo.list('gateRequest', { projectId: project.id, status: 'PENDING' }))[0];
    if (pending) throw gateRequestPending(pending.id);

    const evaluation = evaluateGate(gateDef, ctx, { dispositionNote });
    if (!evaluation.satisfied) {
      throw gateRequirementsNotMet(evaluation.missing);
    }

    const row = {
      id: randomUUID(),
      projectId: project.id,
      gate: gateDef.gate,
      fromStage: gateDef.fromStage,
      toStage: gateDef.toStage,
      requestedBy: req.user.id,
      requestedAt: nowIso(),
      note: note ?? null,
      dispositionNote: dispositionNote ?? null,
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    };
    const created = await repo.transaction(req.user.id, (tx) => tx.insert('gateRequest', row));
    res.status(201).json(gateRequestWire(created));
  }));

  // ---- approval ledger (E05, invariant 11) ---------------------------------

  /** GET /api/projects/:id/ledger — chronological, read-only. No mutation routes exist. */
  router.get('/:id/ledger', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const project = await repo.get('project', req.params.id);
    if (!project) throw notFound(`project ${req.params.id} not found`);
    const members = await repo.listProjectMembers(project.id);
    assertReadProject(req.user, project, 'project', req.params.id, members);
    res.json(await repo.listLedger({ projectId: project.id }));
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
    decorate: (repo, row) => decorateProject(repo, row),
  });

  return router;
}
