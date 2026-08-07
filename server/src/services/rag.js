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
 *   2. roadblocks  — any open (status != resolved) severity 'critical' -> RED;
 *                    else any open 'high' -> AMBER; else GREEN.
 *                    (ADR-006: v2 severities map critical->CRITICAL, high->MAJOR.)
 *   3. overdueWork — tasks not done/cancelled with plannedFinish < today:
 *                    0 -> GREEN, 1-3 -> AMBER, >=4 -> RED.
 *                    (ADR-006: stands in for the plan's overdue ACTIONS until
 *                    E09 lands; the signal key 'overdueWork' stays stable.)
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

function roadblocksSignal(roadblocks) {
  const signal = { key: 'roadblocks', label: 'Roadblocks' };
  const open = roadblocks.filter((r) => r.status !== 'resolved');
  const critical = open.filter((r) => r.severity === 'critical').length;
  if (critical > 0) {
    return { ...signal, color: 'RED', explanation: `${plural(critical, 'critical roadblock')} open` };
  }
  const high = open.filter((r) => r.severity === 'high').length;
  if (high > 0) {
    return { ...signal, color: 'AMBER', explanation: `${plural(high, 'high-severity roadblock')} open` };
  }
  return { ...signal, color: 'GREEN', explanation: 'No open critical or high-severity roadblocks' };
}

function overdueWorkSignal(tasks, today) {
  const signal = { key: 'overdueWork', label: 'Overdue work' };
  const overdue = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
      && t.plannedFinish != null && t.plannedFinish < today,
  ).length;
  if (overdue === 0) {
    return { ...signal, color: 'GREEN', explanation: 'No open tasks past their planned finish' };
  }
  return {
    ...signal,
    color: overdue >= 4 ? 'RED' : 'AMBER',
    explanation: `${plural(overdue, 'open task')} past planned finish`,
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
 *          tasks?: object[], updates?: object[], now?: Date}} input
 * @returns {{color: 'GREEN'|'AMBER'|'RED', computedColor: 'GREEN'|'AMBER'|'RED',
 *           manual: null|{color:string, reason:string, byId:string, at:string},
 *           signals: Array<{key:string, color:string, label:string, explanation:string}>,
 *           explanation: string}}
 */
export function computeRag({
  project, milestones = [], roadblocks = [], tasks = [], updates = [], now = new Date(),
}) {
  const today = now.toISOString().slice(0, 10);

  const signals = [
    scheduleSignal(milestones, today),
    roadblocksSignal(roadblocks),
    overdueWorkSignal(tasks, today),
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
