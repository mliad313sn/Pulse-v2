/**
 * E10 — RAG / health engine (plan §24-§26, adapted per ADR-006).
 *
 * Pure computation over already-loaded rows: no repository access, no clock
 * reads (callers pass `now`), identical for MemoryRepo and Postgres data.
 *
 * Four core signals; the WORST active signal wins (plan §24):
 *   1. schedule    — active (not DONE/CANCELLED) milestones that are SLIPPED
 *                    or overdue (forecastDue ?? baselineDue < today):
 *                    none -> GREEN; <=20% of active -> AMBER; >20% -> RED.
 *   2. roadblocks  — open = status NOT IN (RESOLVED, VERIFIED) (E11 lifecycle
 *                    per ADR-007). Any open severity 'critical' -> RED; else
 *                    any open 'high' OR any ESCALATED open roadblock of ANY
 *                    severity -> AMBER (plan §27: escalation is a health
 *                    event by itself). (ADR-006 severity mapping:
 *                    critical->CRITICAL, high->MAJOR.)
 *   3. overdueWork — OPEN actions (E09) with dueDate < today:
 *                    0 -> GREEN, 1-3 -> AMBER, >=4 -> RED.
 *                    (ADR-006 planned this swap: the key 'overdueWork' is
 *                    unchanged; the overdue-TASK stand-in is removed. DONE and
 *                    CANCELLED actions never count — CANCELLED is not
 *                    completion, it is simply out of play.)
 *   4. freshness   — latest ProjectUpdate age: <=21d -> GREEN; >21d -> AMBER;
 *                    RED when ADDITIONALLY there has been no meaningful
 *                    activity (latest update createdAt / task / milestone /
 *                    roadblock updatedAt; project createdAt as the fallback
 *                    when none exist) for >30d. Projects with operatingStatus
 *                    ON_HOLD/COMPLETED/CANCELLED or lifecycleStage RUN/CLOSED
 *                    are EXEMPT (GREEN, "freshness not tracked in this state");
 *                    projects <21d old without updates are GREEN
 *                    ("recently created").
 *
 * Manual override (plan §25): when project.ragOverride is set, the effective
 * `color` is the override color, `manual` carries {color, reason, byId, at}
 * and `computedColor` still reports what the engine derived.
 *
 * Every signal carries a human-sentence `explanation` (plan §117) so each
 * health card can say WHY.
 */

export const RAG_COLORS = ['GREEN', 'AMBER', 'RED'];

const RANK = { GREEN: 0, AMBER: 1, RED: 2 };
const DAY_MS = 24 * 3600 * 1000;

const FRESHNESS_EXEMPT_OPERATING = new Set(['ON_HOLD', 'COMPLETED', 'CANCELLED']);
const FRESHNESS_EXEMPT_STAGES = new Set(['RUN', 'CLOSED']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whole days elapsed since `iso` at instant `now` (never negative). */
const daysSince = (iso, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));

function scheduleSignal(milestones, today) {
  const signal = { key: 'schedule', label: 'Schedule' };
  const active = milestones.filter((m) => m.status !== 'DONE' && m.status !== 'CANCELLED');
  if (active.length === 0) {
    return { ...signal, color: 'GREEN', explanation: 'No active milestones to track' };
  }
  const late = active.filter((m) => {
    if (m.status === 'SLIPPED') return true;
    const due = m.forecastDue ?? m.baselineDue;
    return due != null && due < today;
  });
  if (late.length === 0) {
    return {
      ...signal,
      color: 'GREEN',
      explanation: `None of the ${plural(active.length, 'active milestone')} are slipped or overdue`,
    };
  }
  return {
    ...signal,
    color: late.length / active.length > 0.2 ? 'RED' : 'AMBER',
    explanation: `${late.length} of ${active.length} active milestones are slipped or overdue`,
  };
}

/** E11 lifecycle: a roadblock is open unless RESOLVED or VERIFIED. */
export const isOpenRoadblock = (r) => r.status !== 'RESOLVED' && r.status !== 'VERIFIED';

function roadblocksSignal(roadblocks) {
  const signal = { key: 'roadblocks', label: 'Roadblocks' };
  const open = roadblocks.filter(isOpenRoadblock);
  const critical = open.filter((r) => r.severity === 'critical').length;
  if (critical > 0) {
    return { ...signal, color: 'RED', explanation: `${plural(critical, 'critical roadblock')} open` };
  }
  // Escalated open roadblocks of ANY severity are at least AMBER (plan §27).
  const high = open.filter((r) => r.severity === 'high').length;
  const escalated = open.filter((r) => r.escalated === true).length;
  if (high > 0 || escalated > 0) {
    const parts = [];
    if (high > 0) parts.push(`${plural(high, 'high-severity roadblock')} open`);
    if (escalated > 0) parts.push(`${plural(escalated, 'escalated roadblock')} open`);
    return { ...signal, color: 'AMBER', explanation: parts.join('; ') };
  }
  return { ...signal, color: 'GREEN', explanation: 'No open critical, high-severity, or escalated roadblocks' };
}

function overdueWorkSignal(actions, today) {
  const signal = { key: 'overdueWork', label: 'Overdue work' };
  // E09: OPEN actions past their due date. DONE actions are complete;
  // CANCELLED actions NEVER count as completed — they are out of play, so
  // neither bucket includes them.
  const overdue = actions.filter(
    (a) => a.status === 'OPEN' && a.dueDate != null && a.dueDate < today,
  ).length;
  if (overdue === 0) {
    return { ...signal, color: 'GREEN', explanation: 'No open actions past their due date' };
  }
  return {
    ...signal,
    color: overdue >= 4 ? 'RED' : 'AMBER',
    explanation: `${plural(overdue, 'open action')} past due date`,
  };
}

function freshnessSignal({ project, milestones, roadblocks, tasks, updates, now }) {
  const signal = { key: 'freshness', label: 'Freshness' };
  if (FRESHNESS_EXEMPT_OPERATING.has(project.operatingStatus)
      || FRESHNESS_EXEMPT_STAGES.has(project.lifecycleStage)) {
    return { ...signal, color: 'GREEN', explanation: 'freshness not tracked in this state' };
  }

  const latestUpdateAt = updates.reduce(
    (max, u) => (max == null || u.createdAt > max ? u.createdAt : max), null);

  if (latestUpdateAt != null && daysSince(latestUpdateAt, now) <= 21) {
    return {
      ...signal,
      color: 'GREEN',
      explanation: `Latest project update is ${plural(daysSince(latestUpdateAt, now), 'day')} old`,
    };
  }
  if (latestUpdateAt == null && daysSince(project.createdAt, now) <= 21) {
    return { ...signal, color: 'GREEN', explanation: 'recently created' };
  }

  // Stale: >21 days without an explicit status update (or none since a
  // creation >21 days ago). "Total silence" upgrade to RED per plan §24/§26.
  const staleDays = daysSince(latestUpdateAt ?? project.createdAt, now);
  const activityTimestamps = [
    latestUpdateAt,
    ...tasks.map((t) => t.updatedAt),
    ...milestones.map((m) => m.updatedAt),
    ...roadblocks.map((r) => r.updatedAt),
  ].filter((ts) => ts != null);
  const lastActivityAt = activityTimestamps.length
    ? activityTimestamps.reduce((max, ts) => (ts > max ? ts : max))
    : project.createdAt;
  const silentDays = daysSince(lastActivityAt, now);

  const noUpdateText = latestUpdateAt == null
    ? `No project update since creation ${plural(staleDays, 'day')} ago`
    : `No project update for ${plural(staleDays, 'day')}`;
  if (silentDays > 30) {
    return {
      ...signal,
      color: 'RED',
      explanation: `${noUpdateText} and no meaningful activity for ${plural(silentDays, 'day')}`,
    };
  }
  return { ...signal, color: 'AMBER', explanation: noUpdateText };
}

/**
 * @param {{project: object, milestones?: object[], roadblocks?: object[],
 *          tasks?: object[], actions?: object[], updates?: object[], now?: Date}} input
 * @returns {{color: 'GREEN'|'AMBER'|'RED', computedColor: 'GREEN'|'AMBER'|'RED',
 *           manual: null|{color:string, reason:string, byId:string, at:string},
 *           signals: Array<{key:string, color:string, label:string, explanation:string}>,
 *           explanation: string}}
 */
export function computeRag({
  project, milestones = [], roadblocks = [], tasks = [], actions = [], updates = [], now = new Date(),
}) {
  const today = now.toISOString().slice(0, 10);

  const signals = [
    scheduleSignal(milestones, today),
    roadblocksSignal(roadblocks),
    overdueWorkSignal(actions, today),
    freshnessSignal({ project, milestones, roadblocks, tasks, updates, now }),
  ];

  // Worst active core signal wins (plan §24).
  const worst = signals.reduce((acc, s) => (RANK[s.color] > RANK[acc.color] ? s : acc));
  const computedColor = worst.color;
  const computedExplanation = computedColor === 'GREEN'
    ? 'All health signals are green'
    : `${computedColor} — ${worst.explanation}`;

  const override = project.ragOverride ?? null;
  if (override) {
    return {
      color: override.color,
      computedColor,
      manual: {
        color: override.color, reason: override.reason, byId: override.byId, at: override.at,
      },
      signals,
      explanation: `Manually set to ${override.color} (computed ${computedColor}): ${override.reason}`,
    };
  }
  return { color: computedColor, computedColor, manual: null, signals, explanation: computedExplanation };
}
