/**
 * E22 — Aggregation endpoints (plan §44-§46):
 *   GET /api/my-work            — personal workspace (My Work)
 *   GET /api/kpis               — Portfolio Wall KPI banner (filterable)
 *   GET /api/sites/:code/lens   — one site's authorized world
 *
 * SECURITY (plan §77): authorization is applied BEFORE any counting or
 * grouping. Every list and every total derives from the caller's readable
 * project scope (filterReadableProjects — classification + enterprise
 * access); a concealed project can never move a number, appear in a drill
 * list, or shift a bucket. General (projectId-null) actions/CAPAs follow
 * their own owner/creator(/verifier)/ADMIN visibility.
 *
 * CLOCK: all date windows are computed server-side in UTC from `now`. The
 * optional `?now=` query parameter (ISO date `YYYY-MM-DD` or datetime)
 * overrides the clock FOR THAT REQUEST ONLY — a deterministic test /
 * diagnostics hook. It changes no stored data and leaks nothing: the
 * authorization scope is identical regardless of `now`.
 */
import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import {
  loadProjectAccess, withLocked, withPmAll, withRagAll,
} from './helpers.js';
import {
  canReadAction, filterReadableProjects, hasPrivilege,
} from '../services/policy.js';
import { decideAuthorityType } from '../services/gateEngine.js';
import { isOpenRoadblock, RAG_COLORS } from '../services/rag.js';
import { LIFECYCLE_STAGES } from '../services/gates.js';
import { gateRequestWire } from './gates.js';
import { notFound, validation } from '../errors.js';

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const plusDays = (now, n) => isoDay(new Date(now.getTime() + n * DAY_MS));

/** Effective due date of a milestone (forecast wins over baseline). */
const milestoneDue = (m) => m.forecastDue ?? m.baselineDue ?? null;
/** Active = still in play (not DONE, not CANCELLED). */
const isActiveMilestone = (m) => m.status !== 'DONE' && m.status !== 'CANCELLED';

/**
 * Per-request clock: `?now=` (ISO date or datetime, UTC) overrides the server
 * clock for date-window computations — deterministic tests and "what would my
 * week look like on date X" diagnostics. Garbage → 400 VALIDATION.
 */
export function resolveNow(req) {
  const raw = req.query.now;
  if (raw === undefined) return new Date();
  if (typeof raw !== 'string') throw validation('now must be a single ISO date or datetime', { field: 'now' });
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw validation('now must be an ISO date (YYYY-MM-DD) or datetime', { field: 'now' });
  }
  return parsed;
}

/** Bucket ref (plan §44): a minimal pointer the UI can resolve locally. */
const ref = (kind, id, title, projectId, due) => ({ kind, id, title, projectId, due });

/** Ascending by due date, then kind, then id — deterministic bucket order. */
const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)
  || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);

/**
 * GET /api/my-work — everything the session user personally owes or oversees,
 * computed over their readable scope (plan §44).
 */
export function myWorkRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const me = req.user;
    const now = resolveNow(req);
    const [access, capas, pendingGateRequests, pendingApprovals, dependencies] = await Promise.all([
      loadProjectAccess(repo, { rag: true }),
      repo.list('capa'),
      repo.list('gateRequest', { status: 'PENDING' }),
      repo.list('approval', { status: 'pending' }),
      repo.list('dependency'),
    ]);
    const {
      projects, membersByProject, milestonesByProject, tasks, roadblocks, actions,
    } = access;

    // §77: the readable scope is computed FIRST; every list below derives
    // from it. Concealed projects cannot contribute a single row.
    const readable = filterReadableProjects(me, projects, membersByProject);
    const visible = new Set(readable.map((p) => p.id));
    const projectsById = new Map(readable.map((p) => [p.id, p]));

    // My open actions: project-linked ones only within readable scope;
    // general (projectId null) actions are mine by definition (I own them).
    const myActions = actions.filter((a) => a.status === 'OPEN' && a.ownerId === me.id
      && (a.projectId == null || visible.has(a.projectId)));

    // My tasks: assigned to me, not done — with the derived `locked` flag.
    const myTasks = await withLocked(
      repo,
      tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && visible.has(t.projectId)),
      { tasks, projects, dependencies },
    );

    const OPEN_MILESTONE_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'SLIPPED']);
    const myMilestones = [...milestonesByProject.entries()]
      .filter(([pid]) => visible.has(pid))
      .flatMap(([, rows]) => rows)
      .filter((m) => m.ownerId === me.id && OPEN_MILESTONE_STATUSES.has(m.status));

    const myRoadblocks = roadblocks.filter((r) => isOpenRoadblock(r)
      && (r.ownerId === me.id || r.reportedBy === me.id) && visible.has(r.projectId));

    // My CAPAs: owner or verifier, not CLOSED. General CAPAs where I am
    // owner/verifier are visible to me by the §29 visibility rule.
    const myCapas = capas.filter((c) => c.status !== 'CLOSED'
      && (c.ownerId === me.id || c.verifierId === me.id)
      && (c.projectId == null || visible.has(c.projectId)));

    // Pending InfoSec approvals — only for security_reviewer holders (the
    // only users who can act on them); scope-filtered like /api/approvals.
    const approvals = hasPrivilege(me, 'security_reviewer')
      ? pendingApprovals.filter((a) => visible.has(a.projectId))
      : [];

    // PENDING gate requests I am AUTHORIZED to decide (gate engine authority
    // rules, invariants 4+10) excluding my own requests (self-decision is
    // forbidden). Decorated with projectName/projectCode for the inbox UI.
    const gateRequests = pendingGateRequests
      .filter((r) => visible.has(r.projectId) && r.requestedBy !== me.id)
      .filter((r) => {
        try {
          decideAuthorityType(me, projectsById.get(r.projectId), r.gate);
          return true;
        } catch {
          return false;
        }
      })
      .map((r) => {
        const p = projectsById.get(r.projectId);
        return { ...gateRequestWire(r), projectName: p.name, projectCode: p.code };
      });

    // Projects I manage (PM member), fully wire-decorated (pmId/progress/rag).
    const managedRaw = readable.filter((p) =>
      (membersByProject.get(p.id) ?? []).some((m) => m.userId === me.id && m.role === 'PM'));
    const managed = await withRagAll(
      repo, withPmAll(managedRaw, membersByProject, milestonesByProject), access, now);

    // Date buckets (UTC, inclusive): overdue < today; dueThisWeek today..+7d;
    // upcoming +8d..+30d. Items without a due date are excluded. Due dates:
    // action/roadblock/capa dueDate; milestone forecastDue ?? baselineDue;
    // task plannedFinish ?? slaDueAt's date. Titles: roadblocks use their
    // description, CAPAs their issue.
    const today = isoDay(now);
    const weekEnd = plusDays(now, 7);
    const upcomingStart = plusDays(now, 8);
    const upcomingEnd = plusDays(now, 30);
    const refs = [
      ...myActions.map((a) => ref('action', a.id, a.title, a.projectId, a.dueDate ?? null)),
      ...myTasks.map((t) => ref('task', t.id, t.title, t.projectId,
        t.plannedFinish ?? (t.slaDueAt ? t.slaDueAt.slice(0, 10) : null))),
      ...myMilestones.map((m) => ref('milestone', m.id, m.title, m.projectId, milestoneDue(m))),
      ...myRoadblocks.map((r) => ref('roadblock', r.id, r.description, r.projectId, r.dueDate ?? null)),
      ...myCapas.map((c) => ref('capa', c.id, c.issue, c.projectId, c.dueDate ?? null)),
    ].filter((x) => x.due != null);

    res.json({
      actions: myActions,
      tasks: myTasks,
      milestones: myMilestones,
      roadblocks: myRoadblocks,
      capas: myCapas,
      approvals,
      gateRequests,
      managed,
      buckets: {
        overdue: refs.filter((x) => x.due < today).sort(byDue),
        dueThisWeek: refs.filter((x) => x.due >= today && x.due <= weekEnd).sort(byDue),
        upcoming: refs.filter((x) => x.due >= upcomingStart && x.due <= upcomingEnd).sort(byDue),
      },
    });
  }));
  return router;
}

/**
 * GET /api/kpis — Portfolio Wall banner (plan §45). Optional filters
 * (site, division, ragColor, lifecycleStage, portfolioId) are ANDed and
 * validated against known codes (400 on unknown). All totals and drill
 * lists are computed over the caller's READABLE projects only, after
 * filters — never over raw data (§77).
 */
export function kpisRouter() {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const now = resolveNow(req);
    const [access, sites, divisions, portfolios, pendingGateRequests] = await Promise.all([
      loadProjectAccess(repo, { rag: true }),
      repo.listSites(),
      repo.listDivisions(),
      repo.list('portfolio'),
      repo.list('gateRequest', { status: 'PENDING' }),
    ]);

    // ---- filter validation (unknown code → 400 VALIDATION) -----------------
    const filters = {};
    const readFilter = (name, isValid, describe) => {
      const raw = req.query[name];
      if (raw === undefined) return;
      if (typeof raw !== 'string' || !isValid(raw)) {
        throw validation(`Unknown ${name} '${raw}': expected ${describe}`, { field: name });
      }
      filters[name] = raw;
    };
    readFilter('site', (v) => sites.some((s) => s.code === v), 'a known site code');
    readFilter('division', (v) => divisions.some((d) => d.code === v), 'a known division code');
    readFilter('ragColor', (v) => RAG_COLORS.includes(v), RAG_COLORS.join('|'));
    readFilter('lifecycleStage', (v) => LIFECYCLE_STAGES.includes(v), LIFECYCLE_STAGES.join('|'));
    readFilter('portfolioId', (v) => portfolios.some((p) => p.id === v), 'a known portfolio id');
    const unfiltered = Object.keys(filters).length === 0;

    // ---- authorization FIRST, then filters (§77) ---------------------------
    const readable = filterReadableProjects(req.user, access.projects, access.membersByProject);
    let scoped = readable;
    if (filters.site) {
      scoped = scoped.filter((p) => p.site === filters.site || (p.sites ?? []).includes(filters.site));
    }
    if (filters.division) scoped = scoped.filter((p) => p.division === filters.division);
    if (filters.lifecycleStage) scoped = scoped.filter((p) => p.lifecycleStage === filters.lifecycleStage);
    if (filters.portfolioId) scoped = scoped.filter((p) => p.portfolioId === filters.portfolioId);
    // RAG needs decoration; the ragColor filter applies to the EFFECTIVE color
    // (manual override wins) — same color the wall's project cards show.
    let decorated = await withRagAll(repo, scoped, access, now);
    if (filters.ragColor) decorated = decorated.filter((p) => p.rag.color === filters.ragColor);

    const inScope = new Set(decorated.map((p) => p.id));
    const today = isoDay(now);
    const goLiveHorizon = plusDays(now, 30);

    const scopedMilestones = [...access.milestonesByProject.entries()]
      .filter(([pid]) => inScope.has(pid))
      .flatMap(([, rows]) => rows);

    // Go-lives: GO_LIVE milestones still in play, due today..+30d. A GO_LIVE
    // already past due lands in overdueMilestones instead, not here.
    const upcomingGoLives = scopedMilestones
      .filter((m) => m.type === 'GO_LIVE' && isActiveMilestone(m))
      .filter((m) => {
        const due = milestoneDue(m);
        return due != null && due >= today && due <= goLiveHorizon;
      })
      .map((m) => ({ projectId: m.projectId, milestoneId: m.id, due: milestoneDue(m) }));

    const overdueMilestones = scopedMilestones
      .filter((m) => isActiveMilestone(m))
      .filter((m) => {
        const due = milestoneDue(m);
        return due != null && due < today;
      })
      .map((m) => ({ projectId: m.projectId, milestoneId: m.id, due: milestoneDue(m) }));

    const criticalRoadblocks = access.roadblocks
      .filter((r) => inScope.has(r.projectId) && r.severity === 'critical' && isOpenRoadblock(r))
      .map((r) => ({ projectId: r.projectId, roadblockId: r.id }));

    // Overdue actions: OPEN past due. Project-linked ones count only when
    // their project is in scope. GENERAL (projectId-null) actions have no
    // site/division/portfolio, so they are counted ONLY on a fully
    // unfiltered call, and only those the caller may read anyway
    // (owner/creator/ADMIN) — deliberately simple; see the API contract.
    const overdueActions = access.actions
      .filter((a) => a.status === 'OPEN' && a.dueDate != null && a.dueDate < today)
      .filter((a) => (a.projectId != null
        ? inScope.has(a.projectId)
        : unfiltered && canReadAction(req.user, a, null)))
      .map((a) => ({ projectId: a.projectId ?? null, actionId: a.id }));

    const gatesWaiting = pendingGateRequests
      .filter((g) => inScope.has(g.projectId))
      .map((g) => ({ projectId: g.projectId, gateRequestId: g.id, gate: g.gate }));

    const byColor = (color) => decorated.filter((p) => p.rag.color === color).map((p) => p.id);
    const onHold = decorated.filter((p) => p.operatingStatus === 'ON_HOLD').map((p) => p.id);
    const drill = {
      green: byColor('GREEN'),
      amber: byColor('AMBER'),
      red: byColor('RED'),
      onHold,
      upcomingGoLives,
      overdueMilestones,
      criticalRoadblocks,
      overdueActions,
      gatesWaiting,
    };
    res.json({
      scope: filters, // the applied filters, echoed (absent = not applied)
      totals: {
        projects: decorated.length,
        green: drill.green.length,
        amber: drill.amber.length,
        red: drill.red.length,
        onHold: onHold.length,
        upcomingGoLives: upcomingGoLives.length,
        overdueMilestones: overdueMilestones.length,
        criticalRoadblocks: criticalRoadblocks.length,
        overdueActions: overdueActions.length,
        gatesWaiting: gatesWaiting.length,
      },
      drill,
    });
  }));
  return router;
}

/**
 * GET /api/sites/:code/lens — one site's complete AUTHORIZED world (plan §46
 * basic): the caller's readable projects touching the site (primary `site`
 * match or `sites[]` contains), their near-term milestones (60d), open
 * roadblocks, open risk/CAPA counts, and the people based at the site.
 * Unknown site → 404. Mounted on /api/sites AFTER the org router (whose
 * routes never match GET /:code/lens).
 */
export function siteLensRouter() {
  const router = Router();
  router.get('/:code/lens', asyncHandler(async (req, res) => {
    const repo = req.app.locals.repo;
    const now = resolveNow(req);
    const { code } = req.params;
    const site = (await repo.listSites()).find((s) => s.code === code);
    if (!site) throw notFound(`site ${code} not found`);

    const [access, risks, capas, users] = await Promise.all([
      loadProjectAccess(repo, { rag: true }),
      repo.list('risk'),
      repo.list('capa'),
      repo.listUsers(),
    ]);
    // §77: readable scope first — a concealed project on this site contributes
    // nothing to the lens (no project, no milestone, no count).
    const readable = filterReadableProjects(req.user, access.projects, access.membersByProject);
    const touching = readable.filter((p) => p.site === code || (p.sites ?? []).includes(code));
    const inScope = new Set(touching.map((p) => p.id));

    const projects = await withRagAll(
      repo, withPmAll(touching, access.membersByProject, access.milestonesByProject), access, now);

    const today = isoDay(now);
    const horizon = plusDays(now, 60);
    const milestonesDue = [...access.milestonesByProject.entries()]
      .filter(([pid]) => inScope.has(pid))
      .flatMap(([, rows]) => rows)
      .filter((m) => isActiveMilestone(m))
      .filter((m) => {
        const due = milestoneDue(m);
        return due != null && due >= today && due <= horizon;
      })
      .sort((a, b) => (milestoneDue(a) < milestoneDue(b) ? -1 : milestoneDue(a) > milestoneDue(b) ? 1 : 0));

    const openRoadblocks = access.roadblocks
      .filter((r) => inScope.has(r.projectId) && isOpenRoadblock(r));

    // Counts (§46 basic): open = not CLOSED. General (projectId-null) CAPAs
    // belong to no site and never count here.
    const risksOpen = risks.filter((r) => inScope.has(r.projectId) && r.status !== 'CLOSED').length;
    const capasOpen = capas.filter(
      (c) => c.projectId != null && inScope.has(c.projectId) && c.status !== 'CLOSED').length;

    // People: ACTIVE users whose primary site is this one (directory data —
    // readable by any authenticated user, like GET /api/users).
    const people = users
      .filter((u) => u.isActive !== false && u.site === code)
      .map((u) => ({ id: u.id, name: u.name, division: u.division, baseRole: u.baseRole }));

    res.json({
      site: { code: site.code, name: site.name },
      projects,
      milestonesDue,
      openRoadblocks,
      risksOpen,
      capasOpen,
      people,
    });
  }));
  return router;
}
