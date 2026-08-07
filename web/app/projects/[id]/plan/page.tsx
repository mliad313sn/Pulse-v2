"use client";

// Plan — read-only Gantt timeline for a project (Wave 3):
// task bars grouped by workstream, milestone diamonds, week gridlines with
// month labels, a today line, critical-path tint from the LIVE /schedule
// endpoint (online-only), and a per-task dependency manager dialog.
// Bars render from the bootstrap caches, so offline still shows the plan —
// just without the critical-path tint (with a hint).

import { use, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api";
import { useProjectMembers } from "@/lib/orgData";
import {
  canManageProject,
  cn,
  DEPENDENCY_TYPE_LABELS,
  DEPENDENCY_TYPES,
  fmtDate,
} from "@/lib/utils";
import { PageHeader } from "@/components/Headings";
import EmptyState from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextInput } from "@/components/Dialog";
import { Pill, ProjectCodeChip } from "@/components/Badges";
import { CloudOffIcon, DotsIcon, LockIcon, XIcon } from "@/components/Icons";
import type {
  DependencyType,
  Milestone,
  Project,
  ScheduleResponse,
  ScheduleTask,
  Task,
  TaskDependency,
  Workstream,
} from "@/lib/types";

// ---- chart geometry ---------------------------------------------------------

const DAY_W = 22; // px per day
const LABEL_W = 240; // px sticky label column
const ROW_H = 40; // px per task row
const MS_DAY = 86400000;

/** ISO (datetime or date) → whole-day number (UTC), or null. */
function parseDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(t) ? null : Math.floor(t / MS_DAY);
}

function dayLabel(day: number, opts: Intl.DateTimeFormatOptions): string {
  return new Date(day * MS_DAY).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

/** Snap a day number back to its Monday. */
function mondayOf(day: number): number {
  const dow = (day + 4) % 7; // 0=Sun … 6=Sat (day 0 = Thu 1970-01-01)
  return day - ((dow + 6) % 7);
}

// ---- live schedule hook (online-only, like governance reads) ----------------

interface ScheduleApi {
  schedule: ScheduleResponse | null;
  loading: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

function isScheduleResponse(res: unknown): res is ScheduleResponse {
  return (
    typeof res === "object" &&
    res !== null &&
    Array.isArray((res as { tasks?: unknown }).tasks)
  );
}

function useSchedule(projectId: string): ScheduleApi {
  const { user, online } = useApp();
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!user || !online) {
      setLoading(false);
      return;
    }
    try {
      const res = await api<unknown>(`/api/projects/${projectId}/schedule`);
      if (isScheduleResponse(res)) {
        setSchedule({ tasks: res.tasks, criticalPath: res.criticalPath ?? [] });
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user, online, projectId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { schedule, loading, failed, reload };
}

// ---- dependency manager dialog ----------------------------------------------

function DependencyDialog({
  project,
  task,
  projectTasks,
  dependencies,
  canManage,
  onChanged,
  onClose,
}: {
  project: Project;
  task: Task;
  projectTasks: Task[];
  dependencies: TaskDependency[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { online, createDependency, deleteDependency } = useApp();
  const [predecessorId, setPredecessorId] = useState("");
  const [type, setType] = useState<DependencyType>("FS");
  const [lagDays, setLagDays] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const incoming = dependencies.filter((d) => d.successorId === task.id);
  const titleOf = (taskId: string) => projectTasks.find((t) => t.id === taskId)?.title ?? "(unknown task)";

  const candidates = useMemo(
    () =>
      projectTasks
        .filter((t) => t.id !== task.id && !incoming.some((d) => d.predecessorId === t.id))
        .sort((a, b) => a.title.localeCompare(b.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectTasks, task.id, dependencies],
  );

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!predecessorId) {
      setError("Pick a predecessor task.");
      return;
    }
    const lag = Number(lagDays);
    if (!Number.isFinite(lag) || !Number.isInteger(lag)) {
      setError("Lag must be a whole number of days.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const outcome = await createDependency({
      projectId: project.id,
      predecessorId,
      successorId: task.id,
      type,
      lagDays: lag,
    });
    setSubmitting(false);
    if (outcome.ok) {
      setPredecessorId("");
      setLagDays("0");
      setType("FS");
      await onChanged();
    } else {
      // 400 VALIDATION for cycles — the server message names the cycle.
      setError(outcome.message || "Dependency was not created.");
    }
  };

  const remove = async (depId: string) => {
    setRemoving(depId);
    setError(null);
    const outcome = await deleteDependency(depId);
    setRemoving(null);
    if (outcome.ok) {
      await onChanged();
    } else {
      setError(outcome.message || "Dependency was not removed.");
    }
  };

  return (
    <Dialog title="Dependencies" subtitle={task.title} onClose={onClose}>
      <div className="space-y-4">
        {incoming.length === 0 ? (
          <EmptyState size="sm">No predecessors — this task can start any time.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {incoming.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{titleOf(d.predecessorId)}</p>
                  <p className="text-xs text-slate-400">
                    {DEPENDENCY_TYPE_LABELS[d.type] ?? d.type} ({d.type})
                    {d.lagDays !== 0 && ` · lag ${d.lagDays > 0 ? "+" : ""}${d.lagDays}d`}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={!online || removing === d.id}
                    onClick={() => void remove(d.id)}
                    title={online ? "Remove dependency" : "Dependency changes need a live connection"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form onSubmit={(e) => void add(e)} noValidate className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <Field label="Predecessor" htmlFor="dep-pred" hint="This task waits on the predecessor per the link type.">
              <Select id="dep-pred" value={predecessorId} onChange={(e) => setPredecessorId(e.target.value)}>
                <option value="">Select a task…</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="dep-type">
                <Select
                  id="dep-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as DependencyType)}
                >
                  {DEPENDENCY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} — {DEPENDENCY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lag (days)" htmlFor="dep-lag">
                <TextInput
                  id="dep-lag"
                  type="number"
                  step={1}
                  value={lagDays}
                  onChange={(e) => setLagDays(e.target.value)}
                />
              </Field>
            </div>
            <FormError error={error} />
            <DialogActions submitLabel="Add dependency" submitting={submitting} disabled={!online} onCancel={onClose} />
            <OfflineHint show={!online} what="Managing dependencies" />
          </form>
        )}
        {!canManage && <FormError error={error} />}
      </div>
    </Dialog>
  );
}

// ---- timeline rows ----------------------------------------------------------

interface Geometry {
  startDay: number;
  totalDays: number;
  chartW: number;
  x: (day: number) => number;
}

function TaskRow({
  task,
  geo,
  sched,
  critical,
  succCount,
  canManage,
  onOpenDeps,
}: {
  task: Task;
  geo: Geometry;
  sched: ScheduleTask | undefined;
  critical: boolean;
  succCount: number;
  canManage: boolean;
  onOpenDeps: () => void;
}) {
  const s = parseDay(task.plannedStart);
  const f = parseDay(task.plannedFinish);
  const hasBar = s !== null && f !== null && f >= s;
  const single = !hasBar ? (s ?? f) : null;

  const tooltip = [
    task.title,
    `Planned ${fmtDate(task.plannedStart)} → ${fmtDate(task.plannedFinish)}`,
    task.estimatedHours != null ? `Estimate ${task.estimatedHours}h` : null,
    sched ? `Slack ${sched.slackDays}d${critical ? " · CRITICAL PATH" : ""}` : null,
    task.locked ? "Locked — prerequisite not done or security gate pending" : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex" style={{ height: ROW_H }}>
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-r border-slate-100 bg-white pl-6 pr-2 dark:border-slate-700/60 dark:bg-slate-800"
        style={{ width: LABEL_W }}
      >
        {task.locked && (
          <LockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm" title={task.title}>
          {task.title}
        </span>
        {succCount > 0 && (
          <span
            title={`${succCount} successor task${succCount === 1 ? "" : "s"} depend${succCount === 1 ? "s" : ""} on this one`}
            className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300"
          >
            → {succCount}
          </span>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onOpenDeps}
            title="Manage dependencies"
            aria-label={`Manage dependencies for ${task.title}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <DotsIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="relative border-b border-slate-100 dark:border-slate-700/60" style={{ width: geo.chartW }}>
        {hasBar && (
          <div
            title={tooltip}
            className={cn(
              "absolute top-1/2 h-5 -translate-y-1/2 rounded-md",
              critical
                ? "bg-rose-500/90 ring-1 ring-rose-600 dark:bg-rose-500/80"
                : "bg-indigo-400/90 ring-1 ring-indigo-500/60 dark:bg-indigo-500/70",
              task.status === "done" && "opacity-50",
            )}
            style={{ left: geo.x(s!) + 1, width: Math.max((f! - s! + 1) * DAY_W - 3, 6) }}
          />
        )}
        {single !== null && (
          <div
            title={tooltip}
            className={cn(
              "absolute top-1/2 h-3 w-3 -translate-y-1/2 rotate-45",
              critical ? "bg-rose-500" : "bg-indigo-400 dark:bg-indigo-500",
            )}
            style={{ left: geo.x(single) + DAY_W / 2 - 6 }}
          />
        )}
        {!hasBar && single === null && (
          <span className="absolute top-1/2 -translate-y-1/2 pl-2 text-[11px] italic text-slate-300 dark:text-slate-600">
            no planned dates
          </span>
        )}
      </div>
    </div>
  );
}

// ---- page -------------------------------------------------------------------

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, projects, tasks, workstreams, dependencies, milestones, online, canWrite, bootLoading } =
    useApp();
  const project = projects.find((p) => p.id === id);
  const { members } = useProjectMembers(id);
  const { schedule, loading: scheduleLoading, failed: scheduleFailed, reload: reloadSchedule } = useSchedule(id);
  const [depTaskId, setDepTaskId] = useState<string | null>(null);

  const canManage = canWrite && canManageProject(user, project ?? null, members);

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === id), [tasks, id]);
  const projectDeps = useMemo(() => dependencies.filter((d) => d.projectId === id), [dependencies, id]);
  const projectMilestones = useMemo(
    () => milestones.filter((m) => m.projectId === id && m.status !== "CANCELLED"),
    [milestones, id],
  );

  const groups = useMemo(() => {
    const ws = workstreams
      .filter((w) => w.projectId === id)
      .sort(
        (a, b) =>
          (a.startDate || "9999").localeCompare(b.startDate || "9999") || a.title.localeCompare(b.title),
      );
    const byStart = (a: Task, b: Task) =>
      (a.plannedStart || "9999").localeCompare(b.plannedStart || "9999") || a.title.localeCompare(b.title);
    const wsIds = new Set(ws.map((w) => w.id));
    const result: Array<{ ws: Workstream | null; tasks: Task[] }> = ws.map((w) => ({
      ws: w,
      tasks: projectTasks.filter((t) => t.workstreamId === w.id).sort(byStart),
    }));
    const unassigned = projectTasks
      .filter((t) => !t.workstreamId || !wsIds.has(t.workstreamId))
      .sort(byStart);
    if (unassigned.length > 0 || result.length === 0) result.push({ ws: null, tasks: unassigned });
    return result;
  }, [workstreams, projectTasks, id]);

  // Schedule lookups (only trusted while online — offline caches could be stale).
  const schedById = useMemo(() => {
    const map = new Map<string, ScheduleTask>();
    if (online && schedule) for (const st of schedule.tasks) map.set(st.taskId, st);
    return map;
  }, [schedule, online]);
  const criticalSet = useMemo(() => {
    const set = new Set<string>();
    if (online && schedule) {
      for (const tid of schedule.criticalPath) set.add(tid);
      for (const st of schedule.tasks) if (st.critical) set.add(st.taskId);
    }
    return set;
  }, [schedule, online]);
  const succCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of projectDeps) map.set(d.predecessorId, (map.get(d.predecessorId) ?? 0) + 1);
    return map;
  }, [projectDeps]);

  // ---- geometry -------------------------------------------------------------

  const today = Math.floor(Date.now() / MS_DAY);
  const geo = useMemo<Geometry>(() => {
    const days: number[] = [today];
    for (const t of projectTasks) {
      const s = parseDay(t.plannedStart);
      const f = parseDay(t.plannedFinish);
      if (s !== null) days.push(s);
      if (f !== null) days.push(f);
    }
    for (const m of projectMilestones) {
      const d = parseDay(m.forecastDue ?? m.baselineDue);
      if (d !== null) days.push(d);
    }
    const startDay = mondayOf(Math.min(...days) - 3);
    const endDay = Math.max(...days) + 10;
    const totalDays = endDay - startDay + 1;
    return {
      startDay,
      totalDays,
      chartW: totalDays * DAY_W,
      x: (day: number) => (day - startDay) * DAY_W,
    };
  }, [projectTasks, projectMilestones, today]);

  const weeks = useMemo(() => {
    const ticks: Array<{ day: number; x: number; label: string; month: string | null }> = [];
    let prevMonth = "";
    for (let d = geo.startDay; d <= geo.startDay + geo.totalDays; d += 7) {
      const month = dayLabel(d, { month: "short", year: "2-digit" });
      ticks.push({
        day: d,
        x: (d - geo.startDay) * DAY_W,
        label: dayLabel(d, { day: "numeric" }),
        month: month !== prevMonth ? month : null,
      });
      prevMonth = month;
    }
    return ticks;
  }, [geo]);

  // ---- guard states ---------------------------------------------------------

  if (!project) {
    return (
      <div className="py-10">
        {bootLoading ? (
          <SkeletonList />
        ) : (
          <EmptyState size="bare">
            <p className="font-medium">Project not found in the local cache.</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              It may not have synced yet — reconnect or head back to the dashboard.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              Back to dashboard
            </Link>
          </EmptyState>
        )}
      </div>
    );
  }

  const depTask = depTaskId ? projectTasks.find((t) => t.id === depTaskId) ?? null : null;
  const totalRows = groups.reduce((n, g) => n + Math.max(g.tasks.length, 1), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start"
        innerClassName="min-w-0"
        title="Plan"
        subtitle={
          <>
            Timeline for{" "}
            <Link
              href={`/projects/${project.id}`}
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {project.name}
            </Link>
            {" — bars follow planned dates; the critical path is computed live."}
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ProjectCodeChip code={project.code} />
            <Link
              href={`/projects/${project.id}`}
              className="flex min-h-[44px] items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
            >
              Back to project
            </Link>
          </div>
        }
      />

      {/* Legend + schedule status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill className="gap-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
          <span className="h-2 w-3 rounded-sm bg-indigo-400 dark:bg-indigo-500" />
          Planned task
        </Pill>
        <Pill className="gap-1.5 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
          <span className="h-2 w-3 rounded-sm bg-rose-500" />
          Critical path
        </Pill>
        <Pill className="gap-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          <span className="h-2 w-2 rotate-45 bg-amber-500" />
          Milestone
        </Pill>
        <Pill className="gap-1.5 bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
          <LockIcon className="h-3 w-3" />
          Locked
        </Pill>
        {!online && (
          <Pill className="gap-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
            <CloudOffIcon className="h-3.5 w-3.5" />
            Offline — cached plan; critical path needs a live connection
          </Pill>
        )}
        {online && scheduleLoading && <span className="text-slate-400">Computing schedule…</span>}
        {online && !scheduleLoading && scheduleFailed && (
          <span className="text-amber-600 dark:text-amber-400">
            Schedule unavailable — bars shown without critical-path analysis.
          </span>
        )}
      </div>

      {projectTasks.length === 0 ? (
        bootLoading ? (
          <SkeletonList />
        ) : (
          <EmptyState>
            No tasks in this project yet — the timeline will appear once tasks with planned dates exist.
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div style={{ width: LABEL_W + geo.chartW }}>
            {/* header: month + week labels */}
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              <div
                className="sticky left-0 z-20 flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                style={{ width: LABEL_W }}
              >
                Workstream / task
              </div>
              <div className="relative h-12" style={{ width: geo.chartW }}>
                {weeks.map((w) => (
                  <div key={w.day} className="absolute bottom-0 top-0" style={{ left: w.x }}>
                    {w.month && (
                      <span className="absolute left-1 top-0.5 whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-300">
                        {w.month}
                      </span>
                    )}
                    <span className="absolute bottom-1 left-1 text-[10px] text-slate-400">{w.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* body */}
            <div className="relative">
              {/* gridlines + today line (behind the rows) */}
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-0"
                style={{ left: LABEL_W, width: geo.chartW }}
              >
                {weeks.map((w) => (
                  <div
                    key={w.day}
                    className="absolute bottom-0 top-0 w-px bg-slate-100 dark:bg-slate-700/50"
                    style={{ left: w.x }}
                  />
                ))}
                {today >= geo.startDay && today <= geo.startDay + geo.totalDays && (
                  <div
                    title="Today"
                    className="absolute bottom-0 top-0 w-0.5 bg-indigo-500/80"
                    style={{ left: (today - geo.startDay) * DAY_W + DAY_W / 2 }}
                  />
                )}
              </div>

              {/* milestones row */}
              {projectMilestones.length > 0 && (
                <div className="relative z-10 flex" style={{ height: ROW_H }}>
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-slate-100 bg-slate-50 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/95 dark:text-slate-400"
                    style={{ width: LABEL_W }}
                  >
                    Milestones
                  </div>
                  <div
                    className="relative border-b border-slate-100 bg-slate-50/60 dark:border-slate-700/60 dark:bg-slate-900/30"
                    style={{ width: geo.chartW }}
                  >
                    {projectMilestones.map((m: Milestone) => {
                      const d = parseDay(m.forecastDue ?? m.baselineDue);
                      if (d === null) return null;
                      return (
                        <div
                          key={m.id}
                          title={`${m.title}\n${m.forecastDue ? "Forecast" : "Baseline"} ${fmtDate(m.forecastDue ?? m.baselineDue)}${m.status === "DONE" ? "\nDone" : ""}`}
                          className={cn(
                            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-45 border",
                            m.status === "DONE"
                              ? "border-emerald-600 bg-emerald-500"
                              : "border-amber-600 bg-amber-400",
                          )}
                          style={{ left: geo.x(d) + DAY_W / 2 - 7 }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* workstream groups */}
              {groups.map((g) => (
                <div key={g.ws?.id ?? "unassigned"} className="relative z-10">
                  <div className="flex" style={{ height: 32 }}>
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-b border-r border-slate-100 bg-slate-50 px-3 dark:border-slate-700/60 dark:bg-slate-800/95"
                      style={{ width: LABEL_W }}
                    >
                      <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {g.ws ? g.ws.title : "Unassigned"}
                      </span>
                      <span className="text-[10px] text-slate-400">{g.tasks.length}</span>
                    </div>
                    <div
                      className="relative border-b border-slate-100 bg-slate-50/60 dark:border-slate-700/60 dark:bg-slate-900/30"
                      style={{ width: geo.chartW }}
                    >
                      {(() => {
                        // Thin span band for the workstream's own start→end dates.
                        const s = parseDay(g.ws?.startDate);
                        const f = parseDay(g.ws?.endDate);
                        if (g.ws && s !== null && f !== null && f >= s) {
                          return (
                            <div
                              title={`${g.ws.title}: ${fmtDate(g.ws.startDate)} → ${fmtDate(g.ws.endDate)}`}
                              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-300 dark:bg-slate-600"
                              style={{ left: geo.x(s) + 1, width: (f - s + 1) * DAY_W - 3 }}
                            />
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  {g.tasks.length === 0 ? (
                    <div className="flex" style={{ height: ROW_H }}>
                      <div
                        className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-slate-100 bg-white pl-6 pr-2 text-xs italic text-slate-300 dark:border-slate-700/60 dark:bg-slate-800 dark:text-slate-600"
                        style={{ width: LABEL_W }}
                      >
                        No tasks yet
                      </div>
                      <div className="border-b border-slate-100 dark:border-slate-700/60" style={{ width: geo.chartW }} />
                    </div>
                  ) : (
                    g.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        geo={geo}
                        sched={schedById.get(t.id)}
                        critical={criticalSet.has(t.id)}
                        succCount={succCounts.get(t.id) ?? 0}
                        canManage={canManage}
                        onOpenDeps={() => setDepTaskId(t.id)}
                      />
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {projectTasks.length > 0 && (
        <p className="text-xs text-slate-400">
          {totalRows} row{totalRows === 1 ? "" : "s"} · {projectDeps.length} dependenc
          {projectDeps.length === 1 ? "y" : "ies"} · hover a bar for planned dates and slack
          {canManage ? " · use a row's … button to manage its dependencies" : ""}.
        </p>
      )}

      {depTask && (
        <DependencyDialog
          project={project}
          task={depTask}
          projectTasks={projectTasks}
          dependencies={projectDeps}
          canManage={canManage}
          onChanged={reloadSchedule}
          onClose={() => setDepTaskId(null)}
        />
      )}
    </div>
  );
}
