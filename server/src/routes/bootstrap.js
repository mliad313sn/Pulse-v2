import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { loadProjectAccess, newestFirst, withLocked, withPmAll, withRagAll } from './helpers.js';
import { filterReadableProjects, readableProjectIds } from '../services/policy.js';
import { publicUser } from '../services/auth.js';
import { dependencyWire } from './dependencies.js';

/** Latest N per project, newest first (bootstrap payload cap for updates). */
export const BOOTSTRAP_UPDATES_PER_PROJECT = 20;

/** GET /api/bootstrap — everything the client caches into IndexedDB. */
export function bootstrapRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const [access, approvals, pillars, portfolios, programs, workstreams, dependencies] =
      await Promise.all([
        loadProjectAccess(repo, { rag: true }), // projects/members/milestones + RAG inputs
        repo.list('approval'),
        repo.list('pillar'),
        repo.list('portfolio'),
        repo.list('program'),
        repo.list('workstream'),
        repo.list('dependency'),
      ]);
    const { projects, membersByProject, milestonesByProject, tasks, roadblocks } = access;
    // ADR-005 + E01 enterprise access: concealed projects (and their children)
    // never reach the client cache.
    const visibleProjects = filterReadableProjects(req.user, projects, membersByProject);
    const visible = readableProjectIds(req.user, projects, membersByProject);
    const visibleTasks = tasks.filter((t) => visible.has(t.projectId));
    const milestones = [...milestonesByProject.entries()]
      .filter(([pid]) => visible.has(pid))
      .flatMap(([, rows]) => rows);
    // E13: updates are capped at the latest 20 per project (newest first) —
    // the full history stays behind GET /api/projects/:id/updates. Updates are
    // NOT part of the offline sync entity set (online-only, append-only).
    const updates = [...access.updatesByProject.entries()]
      .filter(([pid]) => visible.has(pid))
      .flatMap(([, rows]) => newestFirst(rows).slice(0, BOOTSTRAP_UPDATES_PER_PROJECT));
    const directory = (await repo.listUsers()).map(publicUser);
    res.json({
      user: publicUser(req.user),
      users: directory,
      // E10: every project carries the derived `rag` block (+ pmId/progress).
      projects: await withRagAll(
        repo, withPmAll(visibleProjects, membersByProject, milestonesByProject), access),
      tasks: await withLocked(repo, visibleTasks, { tasks, projects, dependencies }),
      roadblocks: roadblocks.filter((r) => visible.has(r.projectId)),
      approvals: approvals.filter((a) => visible.has(a.projectId)),
      milestones,
      workstreams: workstreams.filter((w) => visible.has(w.projectId)),
      dependencies: dependencies.filter((d) => visible.has(d.projectId)).map(dependencyWire),
      updates,
      pillars,
      portfolios,
      programs,
      serverTime: new Date().toISOString(),
    });
  }));
  return router;
}
