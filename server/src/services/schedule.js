/**
 * E07 — Critical-path schedule computation (plan §20, §184).
 *
 * computeSchedule(tasks, dependencies) is a PURE function: classic CPM
 * forward/backward pass over the (acyclic) typed-dependency graph.
 *
 * Date model (documented rules):
 *   - Working unit is the calendar DAY (no working-calendar/weekend logic —
 *     deliberate v1 simplification). Dates are ISO 'YYYY-MM-DD', UTC.
 *   - A task's DURATION comes from its planned dates when BOTH are present:
 *     duration = plannedFinish - plannedStart + 1 (dates are INCLUSIVE: a task
 *     planned 2026-01-05..2026-01-05 lasts 1 day; an inverted range clamps to
 *     1). When either date is missing the FALLBACK DURATION is 1 day.
 *   - The project ANCHOR (day 0) is the earliest plannedStart across the
 *     task set; when NO task has a plannedStart, today's UTC date is used.
 *   - plannedStart acts as a START-NO-EARLIER-THAN constraint: a task never
 *     starts before its own plannedStart, and never before its dependency
 *     constraints allow. Tasks without predecessors and without plannedStart
 *     start at the anchor.
 *
 * Edge constraints (lagDays L may be negative = lead), with start/finish as
 * inclusive day indices (finish = start + duration - 1):
 *   - FS: successor.start  >= predecessor.finish + 1 + L
 *   - SS: successor.start  >= predecessor.start + L
 *   - FF: successor.finish >= predecessor.finish + L
 *   - SF: successor.finish >= predecessor.start + L
 *
 * Backward pass mirrors these; latestFinish of sink tasks = project end
 * (max earliestFinish). slackDays = latestStart - earliestStart; a task is
 * CRITICAL when slackDays === 0.
 *
 * Cycle safety: edges are guaranteed acyclic at creation time (service DFS +
 * DB trigger). Defensively, any tasks left unordered by the topological sort
 * (i.e. participating in a cycle in corrupt data) are appended and processed
 * with whatever constraints resolved — the function never throws on them.
 *
 * Returns { tasks: [{taskId, earliestStart, earliestFinish, latestStart,
 * latestFinish, slackDays, critical}], criticalPath: [taskIds] } where
 * criticalPath lists critical tasks in earliestStart (then topological)
 * order.
 */

const DAY_MS = 24 * 3600 * 1000;

const toDay = (iso, anchorMs) => Math.round((Date.parse(`${iso}T00:00:00Z`) - anchorMs) / DAY_MS);
const toIsoDate = (day, anchorMs) => new Date(anchorMs + day * DAY_MS).toISOString().slice(0, 10);

function durationOf(task) {
  if (task.plannedStart && task.plannedFinish) {
    const days = Math.round(
      (Date.parse(`${task.plannedFinish}T00:00:00Z`) - Date.parse(`${task.plannedStart}T00:00:00Z`)) / DAY_MS,
    ) + 1;
    return Math.max(1, days);
  }
  return 1; // fallback duration when planned dates are missing/partial
}

export function computeSchedule(tasks, dependencies) {
  const taskIds = new Set(tasks.map((t) => t.id));
  // Ignore edges pointing outside the task set (defensive).
  const edges = dependencies.filter(
    (d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId),
  );

  // Anchor: earliest plannedStart, else today (UTC midnight).
  const starts = tasks.filter((t) => t.plannedStart).map((t) => Date.parse(`${t.plannedStart}T00:00:00Z`));
  const anchorMs = starts.length > 0
    ? Math.min(...starts)
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  // Topological order (Kahn). Leftovers (cycles in corrupt data) are appended.
  const incoming = new Map(tasks.map((t) => [t.id, 0]));
  const outgoing = new Map(); // predecessorId -> [edges]
  for (const e of edges) {
    incoming.set(e.successorId, incoming.get(e.successorId) + 1);
    const list = outgoing.get(e.predecessorId);
    if (list) list.push(e);
    else outgoing.set(e.predecessorId, [e]);
  }
  const queue = tasks.filter((t) => incoming.get(t.id) === 0).map((t) => t.id);
  const order = [];
  const seen = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    seen.add(id);
    for (const e of outgoing.get(id) ?? []) {
      const left = incoming.get(e.successorId) - 1;
      incoming.set(e.successorId, left);
      if (left === 0) queue.push(e.successorId);
    }
  }
  for (const t of tasks) if (!seen.has(t.id)) order.push(t.id); // defensive

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dur = new Map(tasks.map((t) => [t.id, durationOf(t)]));
  const incomingEdges = new Map(); // successorId -> [edges]
  for (const e of edges) {
    const list = incomingEdges.get(e.successorId);
    if (list) list.push(e);
    else incomingEdges.set(e.successorId, [e]);
  }

  // ---- forward pass: earliest start/finish (inclusive day indices) ---------
  const ES = new Map();
  const EF = new Map();
  for (const id of order) {
    const task = byId.get(id);
    const d = dur.get(id);
    // Own floor: plannedStart when present, else the anchor (day 0).
    let es = task.plannedStart ? toDay(task.plannedStart, anchorMs) : 0;
    for (const e of incomingEdges.get(id) ?? []) {
      const pES = ES.get(e.predecessorId);
      const pEF = EF.get(e.predecessorId);
      if (pES === undefined) continue; // cycle leftover — constraint unresolved
      let bound;
      if (e.type === 'FS') bound = pEF + 1 + e.lagDays;
      else if (e.type === 'SS') bound = pES + e.lagDays;
      else if (e.type === 'FF') bound = pEF + e.lagDays - (d - 1);
      else bound = pES + e.lagDays - (d - 1); // SF
      if (bound > es) es = bound;
    }
    ES.set(id, es);
    EF.set(id, es + d - 1);
  }

  const projectEnd = tasks.length > 0 ? Math.max(...tasks.map((t) => EF.get(t.id))) : 0;

  // ---- backward pass: latest finish/start --------------------------------
  const LS = new Map();
  const LF = new Map();
  for (const id of [...order].reverse()) {
    const d = dur.get(id);
    let lf = projectEnd;
    for (const e of outgoing.get(id) ?? []) {
      const sLS = LS.get(e.successorId);
      const sLF = LF.get(e.successorId);
      if (sLS === undefined) continue; // cycle leftover
      let bound;
      if (e.type === 'FS') bound = sLS - 1 - e.lagDays;
      else if (e.type === 'SS') bound = sLS - e.lagDays + (d - 1);
      else if (e.type === 'FF') bound = sLF - e.lagDays;
      else bound = sLF - e.lagDays + (d - 1); // SF
      if (bound < lf) lf = bound;
    }
    LF.set(id, lf);
    LS.set(id, lf - d + 1);
  }

  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const rows = tasks.map((t) => {
    const slackDays = LS.get(t.id) - ES.get(t.id);
    return {
      taskId: t.id,
      earliestStart: toIsoDate(ES.get(t.id), anchorMs),
      earliestFinish: toIsoDate(EF.get(t.id), anchorMs),
      latestStart: toIsoDate(LS.get(t.id), anchorMs),
      latestFinish: toIsoDate(LF.get(t.id), anchorMs),
      slackDays,
      critical: slackDays === 0,
    };
  });

  const criticalPath = rows
    .filter((r) => r.critical)
    .sort((a, b) => (ES.get(a.taskId) - ES.get(b.taskId))
      || (orderIndex.get(a.taskId) - orderIndex.get(b.taskId)))
    .map((r) => r.taskId);

  return { tasks: rows, criticalPath };
}
