"use client";

// My Work — the daily home for contributors/PMs (plan §44): everything assigned
// to me across the portfolio, bucketed by due date. The list itself is a LIVE,
// ONLINE-ONLY read (GET /api/my-work); while offline the page falls back to
// locally-cached actions/tasks (both offline-capable entities) plus an offline
// hint for the server-derived rest.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { useLiveView } from "@/lib/liveViews";
import { MyActions } from "@/components/Actions";
import TaskCard from "@/components/TaskCard";
import ProjectCard from "@/components/ProjectCard";
import EmptyState from "@/components/EmptyState";
import { PageHeader, SectionHeader } from "@/components/Headings";
import { SkeletonList } from "@/components/Skeleton";
import {
  CapaStatusChip,
  CountPill,
  EscalatedBadge,
  MilestoneStatusBadge,
  MilestoneTypeBadge,
  Pill,
  ProjectCodeChip,
  RoadblockStatusBadge,
  SeverityBadge,
} from "@/components/Badges";
import {
  AlertIcon,
  AlertOctagonIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudOffIcon,
  DotsIcon,
  FlagIcon,
  GanttIcon,
  ScaleIcon,
  ShieldIcon,
} from "@/components/Icons";
import { cn, fmtDate, slaState, titleCaseTag } from "@/lib/utils";
import type {
  Action,
  Milestone,
  MyWorkBuckets,
  MyWorkResponse,
  Task,
  WorkBucketRef,
  WorkItemKind,
} from "@/lib/types";

// ---- bucket helpers ---------------------------------------------------------

type BucketKey = keyof MyWorkBuckets;

const BUCKET_META: Record<
  BucketKey,
  { label: string; tile: string; activeRing: string; count: string }
> = {
  overdue: {
    label: "Overdue",
    tile: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300",
    activeRing: "ring-2 ring-rose-400 dark:ring-rose-600",
    count: "text-rose-600 dark:text-rose-400",
  },
  dueThisWeek: {
    label: "Due this week",
    tile: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300",
    activeRing: "ring-2 ring-amber-400 dark:ring-amber-600",
    count: "text-amber-600 dark:text-amber-400",
  },
  upcoming: {
    label: "Upcoming",
    tile: "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
    activeRing: "ring-2 ring-slate-400 dark:ring-slate-500",
    count: "text-slate-600 dark:text-slate-300",
  },
};

const BUCKET_KEYS: BucketKey[] = ["overdue", "dueThisWeek", "upcoming"];

function KindIcon({ kind, className }: { kind: WorkItemKind; className?: string }) {
  const cls = className ?? "h-4 w-4";
  switch (kind) {
    case "action":
      return <CheckIcon className={cls} />;
    case "task":
      return <GanttIcon className={cls} />;
    case "milestone":
      return <FlagIcon className={cls} />;
    case "roadblock":
      return <AlertIcon className={cls} />;
    case "capa":
      return <AlertOctagonIcon className={cls} />;
    default:
      return <DotsIcon className={cls} />;
  }
}

/**
 * Offline fallback: derive due-date buckets from the locally-cached
 * offline-capable entities (my open actions + my open tasks).
 */
function localBuckets(actions: Action[], tasks: Task[], userId: string): MyWorkBuckets {
  const buckets: MyWorkBuckets = { overdue: [], dueThisWeek: [], upcoming: [] };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = today.getTime() + 7 * 86_400_000;
  const push = (ref: WorkBucketRef) => {
    const due = Date.parse(ref.due);
    if (Number.isNaN(due)) return;
    if (due < today.getTime()) buckets.overdue.push(ref);
    else if (due <= weekEnd) buckets.dueThisWeek.push(ref);
    else buckets.upcoming.push(ref);
  };
  for (const a of actions) {
    if (a.ownerId !== userId || a.status !== "OPEN" || !a.dueDate) continue;
    push({ kind: "action", id: a.id, title: a.title, projectId: a.projectId ?? null, due: a.dueDate });
  }
  for (const t of tasks) {
    if (t.assigneeId !== userId || t.status === "done" || !t.slaDueAt) continue;
    push({ kind: "task", id: t.id, title: t.title, projectId: t.projectId, due: t.slaDueAt });
  }
  const byDue = (x: WorkBucketRef, y: WorkBucketRef) => x.due.localeCompare(y.due);
  buckets.overdue.sort(byDue);
  buckets.dueThisWeek.sort(byDue);
  buckets.upcoming.sort(byDue);
  return buckets;
}

// ---- bucket UI --------------------------------------------------------------

function BucketRow({ item, onGeneralAction }: { item: WorkBucketRef; onGeneralAction: () => void }) {
  const router = useRouter();
  const { projects } = useApp();
  const project = item.projectId ? projects.find((p) => p.id === item.projectId) : null;
  const overdue = Date.parse(item.due) < Date.now();

  const go = () => {
    if (item.projectId) {
      router.push(`/projects/${item.projectId}`);
    } else {
      // General action — no project room; jump to the My Actions panel instead.
      onGeneralAction();
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={go}
        className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500"
      >
        <span className="shrink-0 text-slate-400" title={titleCaseTag(String(item.kind))}>
          <KindIcon kind={item.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
        {project && (
          <Pill className="max-w-[10rem] shrink-0 border border-indigo-200 text-indigo-600 dark:border-indigo-800 dark:text-indigo-300">
            <span className="truncate">{project.name}</span>
          </Pill>
        )}
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            overdue ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-400",
          )}
        >
          {fmtDate(item.due)}
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
      </button>
    </li>
  );
}

// ---- section rows -----------------------------------------------------------

function ProjectChip({ projectId }: { projectId?: string | null }) {
  const { projects } = useApp();
  const project = projectId ? projects.find((p) => p.id === projectId) : null;
  if (!project) return null;
  return (
    <Link href={`/projects/${project.id}`} className="max-w-[11rem] shrink-0">
      <Pill className="w-full border border-indigo-200 text-indigo-600 transition hover:border-indigo-400 dark:border-indigo-800 dark:text-indigo-300">
        <span className="truncate">{project.name}</span>
      </Pill>
    </Link>
  );
}

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const due = milestone.forecastDue ?? milestone.baselineDue;
  return (
    <li className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{milestone.title}</span>
      <MilestoneTypeBadge type={milestone.type} />
      <MilestoneStatusBadge status={milestone.status} />
      <ProjectChip projectId={milestone.projectId} />
      <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDate(due)}</span>
    </li>
  );
}

// ---- page -------------------------------------------------------------------

export default function MyWorkPage() {
  const { user, online, actions, tasks, projects, bootLoading } = useApp();
  const { data, loading, error, reload } = useLiveView<MyWorkResponse>(user ? "/api/my-work" : null);
  const [activeBucket, setActiveBucket] = useState<BucketKey | null>(null);
  const bucketListRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const scrollToActions = () =>
    actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Live buckets when the fetch succeeded; local cache-derived buckets otherwise.
  const buckets = useMemo<MyWorkBuckets>(() => {
    if (data?.buckets) return data.buckets;
    if (!user) return { overdue: [], dueThisWeek: [], upcoming: [] };
    return localBuckets(actions, tasks, user.id);
  }, [data, actions, tasks, user]);

  // My tasks: live set merged over cached store copies (store copy wins so
  // optimistic status moves render immediately); offline = cache-derived.
  const myTasks = useMemo<Task[]>(() => {
    const source: Task[] = data
      ? data.tasks.map((t) => tasks.find((c) => c.id === t.id) ?? t)
      : tasks.filter((t) => t.assigneeId === user?.id);
    const open = source.filter((t) => t.status !== "done");
    const rank = (t: Task) => (slaState(t) === "overdue" ? 0 : slaState(t) === "warn" ? 1 : 2);
    return open.sort((a, b) => rank(a) - rank(b) || (a.slaDueAt || "9999").localeCompare(b.slaDueAt || "9999"));
  }, [data, tasks, user]);

  // Projects I manage — prefer the cached copy (task progress bars stay live).
  const managed = useMemo(
    () => (data?.managed ?? []).map((p) => projects.find((c) => c.id === p.id) ?? p),
    [data, projects],
  );

  if (!user) return null;

  const selectBucket = (key: BucketKey) => {
    setActiveBucket((prev) => (prev === key ? null : key));
    // Defer so the list exists before scrolling to it.
    window.setTimeout(() => bucketListRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const liveUnavailable = !data && (!online || Boolean(error));
  const initialLoading = loading && !data;

  return (
    <div>
      <PageHeader
        title="My Work"
        subtitle={`Everything assigned to you across the portfolio${online ? "" : " · offline"}`}
      />

      {/* Bucket tiles */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BUCKET_KEYS.map((key) => {
          const meta = BUCKET_META[key];
          const count = buckets[key].length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectBucket(key)}
              aria-pressed={activeBucket === key}
              className={cn(
                "rounded-2xl border p-4 text-left transition",
                meta.tile,
                activeBucket === key && meta.activeRing,
              )}
            >
              <span className={cn("block text-3xl font-bold tabular-nums", meta.count)}>
                {initialLoading ? "…" : count}
              </span>
              <span className="mt-1 block text-sm font-medium">{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active bucket item list */}
      <div ref={bucketListRef}>
        {activeBucket && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                {BUCKET_META[activeBucket].label}
                {buckets[activeBucket].length > 0 && (
                  <CountPill>{buckets[activeBucket].length}</CountPill>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setActiveBucket(null)}
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
              >
                Close
              </button>
            </div>
            {buckets[activeBucket].length === 0 ? (
              <EmptyState size="sm">Nothing {BUCKET_META[activeBucket].label.toLowerCase()} — all clear.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {buckets[activeBucket].map((item) => (
                  <BucketRow key={`${item.kind}:${item.id}`} item={item} onGeneralAction={scrollToActions} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Live-fetch failure (online) — cached sections below still render. */}
      {online && error && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          <span>Could not load your live work queue: {error}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-xl border border-rose-300 px-3 py-1.5 font-semibold transition hover:bg-rose-100 dark:border-rose-700 dark:hover:bg-rose-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {/* My Actions — the existing offline-capable panel, reused as-is. */}
      <div ref={actionsRef} id="my-actions" className="scroll-mt-20">
        <MyActions />
      </div>

      {/* My Tasks */}
      <section className="mb-8">
        <SectionHeader>My tasks</SectionHeader>
        {(initialLoading || bootLoading) && myTasks.length === 0 ? (
          <SkeletonList count={3} />
        ) : myTasks.length === 0 ? (
          <EmptyState size="sm">No open tasks assigned to you.</EmptyState>
        ) : (
          <div className="space-y-3">
            {myTasks.map((t) => (
              <TaskCard key={t.id} task={t} mode="zen" />
            ))}
          </div>
        )}
      </section>

      {/* Server-derived sections — live only. */}
      {liveUnavailable ? (
        <EmptyState size="md" className="mb-8">
          <span className="inline-flex items-center gap-2">
            <CloudOffIcon className="h-4 w-4" />
            {online
              ? "Milestones, roadblocks, CAPAs, approvals and gate requests could not be loaded — retry above."
              : "You are offline — milestones, roadblocks, CAPAs, approvals and gate requests need a live connection. Cached actions and tasks are shown above."}
          </span>
        </EmptyState>
      ) : initialLoading ? (
        <SkeletonList count={3} />
      ) : (
        data && (
          <>
            <section className="mb-8">
              <SectionHeader>My milestones</SectionHeader>
              {data.milestones.length === 0 ? (
                <EmptyState size="sm">No milestones assigned to you.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.milestones.map((m) => (
                    <MilestoneRow key={m.id} milestone={m} />
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <SectionHeader>My roadblocks</SectionHeader>
              {data.roadblocks.length === 0 ? (
                <EmptyState size="sm">No roadblocks assigned to you.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.roadblocks.map((r) => (
                    <li
                      key={r.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.description}</span>
                      <RoadblockStatusBadge status={r.status} />
                      <SeverityBadge severity={r.severity} />
                      {r.escalated && <EscalatedBadge escalatedAt={r.escalatedAt} />}
                      <ProjectChip projectId={r.projectId} />
                      {r.dueDate && (
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDate(r.dueDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <SectionHeader>My CAPAs</SectionHeader>
              {data.capas.length === 0 ? (
                <EmptyState size="sm">No CAPAs owned by or awaiting verification from you.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.capas.map((c) => (
                    <li
                      key={c.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.issue}</span>
                      <CapaStatusChip status={c.status} />
                      <ProjectChip projectId={c.projectId} />
                      {c.dueDate && (
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDate(c.dueDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.approvals.length > 0 && (
              <section className="mb-8">
                <SectionHeader>Approvals to review</SectionHeader>
                <Link
                  href="/approvals"
                  className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 transition hover:border-amber-400 dark:border-amber-900/60 dark:bg-amber-900/20"
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-amber-900 dark:text-amber-300">
                    <ShieldIcon className="h-5 w-5" />
                    {data.approvals.length} security approval{data.approvals.length === 1 ? "" : "s"} waiting for your
                    review
                  </span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-amber-500" />
                </Link>
              </section>
            )}

            {data.gateRequests.length > 0 && (
              <section className="mb-8">
                <SectionHeader>Gate requests awaiting my decision</SectionHeader>
                <ul className="space-y-2">
                  {data.gateRequests.map((g) => (
                    <li
                      key={g.id}
                      className="flex min-h-[56px] flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <ScaleIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {g.projectName ?? "Project"}
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {g.fromStage && g.toStage
                            ? `${titleCaseTag(g.fromStage)} → ${titleCaseTag(g.toStage)}`
                            : "Stage gate approval"}
                          {g.gate ? ` · ${g.gate}` : ""}
                        </span>
                      </span>
                      <ProjectCodeChip code={g.projectCode} />
                      {g.projectId && (
                        <Link
                          href={`/projects/${g.projectId}/governance`}
                          className="flex min-h-[40px] shrink-0 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500"
                        >
                          Review
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mb-8">
              <SectionHeader>Projects I manage</SectionHeader>
              {managed.length === 0 ? (
                <EmptyState size="sm">You are not managing any projects.</EmptyState>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {managed.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
