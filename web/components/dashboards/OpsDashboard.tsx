"use client";

// Zen Mode — mobile-first single column for site managers.
// SC3: status update = tap card's always-visible status button (1 tap).
//      Roadblock = tap "Log Roadblock" (1) -> prefilled sheet -> Save (2-3 taps).

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import TaskCard from "@/components/TaskCard";
import { AlertIcon, ChevronDownIcon } from "@/components/Icons";
import { SkeletonList } from "@/components/Skeleton";
import type { RoadblockTarget } from "@/components/RoadblockSheet";
import { slaState } from "@/lib/utils";

export default function OpsDashboard({ onRoadblock }: { onRoadblock: (t: RoadblockTarget) => void }) {
  const { user, tasks, projects, bootLoading } = useApp();
  const [showDone, setShowDone] = useState(false);

  const myTasks = useMemo(() => {
    const site = user?.site;
    const scoped = site ? tasks.filter((t) => t.site === site || t.assigneeId === user?.id) : tasks;
    const rank = (t: (typeof tasks)[number]) => (slaState(t) === "overdue" ? 0 : slaState(t) === "warn" ? 1 : 2);
    return [...scoped].sort((a, b) => rank(a) - rank(b) || (a.slaDueAt || "9999").localeCompare(b.slaDueAt || "9999"));
  }, [tasks, user]);

  const open = myTasks.filter((t) => t.status !== "done");
  const done = myTasks.filter((t) => t.status === "done");

  const defaultProject =
    projects.find((p) => p.site === user?.site && p.overallStatus === "active") ??
    projects.find((p) => p.site === user?.site) ??
    projects[0];

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">My site tasks</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Zen Mode{user?.site ? ` · ${user.site}` : ""} · {open.length} open
        </p>
      </div>

      <button
        type="button"
        disabled={!defaultProject}
        onClick={() => defaultProject && onRoadblock({ projectId: defaultProject.id })}
        className="mb-6 flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-rose-600 text-base font-semibold text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-500 disabled:opacity-50"
      >
        <AlertIcon className="h-5 w-5" />
        Log Roadblock
      </button>

      {bootLoading && myTasks.length === 0 ? (
        <SkeletonList count={4} />
      ) : open.length === 0 && done.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-600 dark:text-slate-400">
          No tasks for your site yet.
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((task) => (
            <TaskCard key={task.id} task={task} mode="zen" onRoadblock={onRoadblock} />
          ))}

          {done.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ChevronDownIcon className={showDone ? "h-4 w-4 rotate-180 transition" : "h-4 w-4 transition"} />
                {showDone ? "Hide" : "Show"} {done.length} completed
              </button>
              {showDone && (
                <div className="mt-3 space-y-3">
                  {done.map((task) => (
                    <TaskCard key={task.id} task={task} mode="zen" onRoadblock={onRoadblock} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
