import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from './middleware.js';
import { forbidden, validation } from '../errors.js';
import { canPostProjectUpdate, canReadProject } from '../services/policy.js';
import { nowIso } from '../services/time.js';

/** E13 project-update moods (plan §32). */
export const UPDATE_MOODS = ['POSITIVE', 'NEUTRAL', 'CONCERN', 'CRITICAL'];
export const UPDATE_TEXT_MAX = 400;

/**
 * E13 core — Project updates (plan §32): the ~20-second status pulse feeding
 * the RAG freshness signal (E10).
 *
 * APPEND-ONLY BY DESIGN: only POST exists here (reads live under
 * GET /api/projects/:id/updates). There is deliberately NO PATCH or DELETE
 * route — plan §32 says editing history creates a REVISION, which arrives
 * with the full E13 slice; until then updates are immutable
 * (trg_project_updates_append_only is the Postgres backstop).
 *
 * Writers: manage-level authority, the project owner/sponsor, or any
 * contributing member (INFORMED/AUDITOR excluded); VIEWER 403 (middleware).
 * The author is ALWAYS the session user — no posting on someone's behalf.
 *
 * ONLINE-ONLY: 'projectUpdate' is intentionally NOT in the offline sync
 * entity set — a status pulse is only meaningful when fresh, and append-only
 * rows have no OCC version for the sync protocol to reason about.
 */
export function updatesRouter() {
  const router = Router();

  router.post('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const { projectId, mood, text, accomplishment, nextStep, supportRequired } = req.body ?? {};

    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw validation('Missing required field: projectId', { field: 'projectId' });
    }
    const project = await repo.get('project', projectId);
    const members = project ? await repo.listProjectMembers(project.id) : [];
    // Concealment (ADR-005): an unreadable parent project is indistinguishable
    // from an unknown id.
    if (!project || !canReadProject(req.user, project, members)) {
      throw validation(`Unknown projectId: ${projectId}`, { field: 'projectId' });
    }
    if (!UPDATE_MOODS.includes(mood)) {
      throw validation(`mood must be one of ${UPDATE_MOODS.join(', ')}`, { field: 'mood', allowed: UPDATE_MOODS });
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw validation('Missing required field: text', { field: 'text' });
    }
    if (text.length > UPDATE_TEXT_MAX) {
      throw validation(`text must be at most ${UPDATE_TEXT_MAX} characters`, { field: 'text' });
    }
    for (const [key, value] of Object.entries({ accomplishment, nextStep, supportRequired })) {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw validation(`${key} must be a string`, { field: key });
      }
    }
    if (!canPostProjectUpdate(req.user, project, members)) {
      throw forbidden('Posting a project update requires manage-level authority, project ownership/sponsorship, or contributing membership');
    }

    const row = {
      id: randomUUID(),
      projectId: project.id,
      authorId: req.user.id, // always the session user
      mood,
      text,
      accomplishment: accomplishment ?? null,
      nextStep: nextStep ?? null,
      supportRequired: supportRequired ?? null,
      createdAt: nowIso(),
    };
    const created = await repo.transaction(req.user.id, (tx) => tx.insert('projectUpdate', row));
    res.status(201).json(created);
  }));

  return router;
}
