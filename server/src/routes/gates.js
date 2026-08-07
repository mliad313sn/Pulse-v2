import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, withPmOne } from './helpers.js';
import { canReadProject, readableProjectIds } from '../services/policy.js';
import { decideAuthorityType } from '../services/gateEngine.js';
import { forbidden, notFound, validation } from '../errors.js';
import { nowIso } from '../services/time.js';

/** Wire shape of a gate request (shared with the project gates routes). */
export function gateRequestWire(r) {
  return {
    id: r.id,
    projectId: r.projectId,
    gate: r.gate,
    fromStage: r.fromStage,
    toStage: r.toStage,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt,
    note: r.note ?? null,
    dispositionNote: r.dispositionNote ?? null,
    status: r.status,
    decidedBy: r.decidedBy ?? null,
    decidedAt: r.decidedAt ?? null,
    decisionNote: r.decisionNote ?? null,
  };
}

/**
 * E05 — gate request queue + decisions.
 *   GET  /api/gate-requests?status=PENDING     — scoped by project readability
 *   POST /api/gate-requests/:id/decision       — approve/reject (gate engine rules)
 * NO update/delete routes exist for the approval ledger written here.
 */
export function gateRequestsRouter() {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const filter = req.query.status ? { status: req.query.status } : {};
    const [requests, { projects, membersByProject }] = await Promise.all([
      repo.list('gateRequest', filter),
      loadProjectAccess(repo),
    ]);
    // Concealment: requests of unreadable projects are absent.
    const visible = readableProjectIds(req.user, projects, membersByProject);
    res.json(requests.filter((r) => visible.has(r.projectId)).map(gateRequestWire));
  }));

  /**
   * POST /api/gate-requests/:id/decision {decision: 'APPROVED'|'REJECTED', note?}
   * Approver rules (services/gateEngine.decideAuthorityType):
   *   - G2 demands the 'steering' privilege — ADMIN without it is denied
   *     (403 STEERING_APPROVAL_REQUIRED, invariant 4);
   *   - other gates: ADMIN, steering holder, or DIVISION_LEAD of the
   *     project's division;
   *   - the requester can never decide their own request (403).
   * APPROVED applies the lifecycle transition + appends the immutable ledger
   * entry in ONE transaction; REJECTED appends the ledger entry only.
   */
  router.post('/:id/decision', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { decision, note } = req.body ?? {};
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw validation("decision must be 'APPROVED' or 'REJECTED'", { field: 'decision' });
    }

    const result = await repo.transaction(req.user.id, async (tx) => {
      const request = await tx.get('gateRequest', req.params.id);
      if (!request) throw notFound(`gateRequest ${req.params.id} not found`);
      const project = await tx.get('project', request.projectId);
      const members = project ? await tx.listProjectMembers(project.id) : [];
      // Concealment (ADR-005): requests of unreadable projects 404 like missing ids.
      if (!project || !canReadProject(req.user, project, members)) {
        throw notFound(`gateRequest ${req.params.id} not found`);
      }
      if (request.status !== 'PENDING') {
        throw validation(`Gate request already ${request.status}; only PENDING requests can be decided`);
      }
      if (request.requestedBy === req.user.id) {
        throw forbidden('The requester cannot decide their own gate request');
      }
      const authorityType = decideAuthorityType(req.user, project, request.gate);
      if (decision === 'APPROVED' && project.lifecycleStage !== request.fromStage) {
        throw validation(
          `Stale gate request: project is now ${project.lifecycleStage}, expected ${request.fromStage}`,
        );
      }

      const decidedAt = nowIso();
      const decided = await tx.update('gateRequest', {
        ...request,
        status: decision,
        decidedBy: req.user.id,
        decidedAt,
        decisionNote: note ?? null,
      });

      let updatedProject = project;
      if (decision === 'APPROVED') {
        // The ONLY forward lifecycle write in the system (invariants 8-9).
        updatedProject = await tx.update('project', {
          ...project,
          lifecycleStage: request.toStage,
          version: project.version + 1,
          updatedAt: decidedAt,
        });
      }

      const ledgerEntry = await tx.appendLedger({
        projectId: project.id,
        gate: request.gate,
        fromStage: request.fromStage,
        toStage: request.toStage,
        projectVersion: project.version, // pre-transition version (plan §14)
        requestedBy: request.requestedBy,
        requestedAt: request.requestedAt,
        decidedBy: req.user.id,
        decidedAt,
        authorityType,
        decision,
        note: note ?? null,
      });

      return { gateRequest: gateRequestWire(decided), project: updatedProject, ledgerEntry };
    });

    res.json({ ...result, project: await withPmOne(repo, result.project) });
  }));

  return router;
}
