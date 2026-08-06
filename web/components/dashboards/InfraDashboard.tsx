"use client";

// Infrastructure — dependency-centric timeline.
// SC2: locked tasks are dimmed, carry a padlock, and name the prerequisite blocking them.

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/lib/store";
import TaskCard from "@/components/TaskCard";
import { LockIcon } from "@/components/Icons";
import { StatusBadge } from "@/components/Badges";
import { SkeletonList } from "@/components/Skeleton";
import { cn, fmtDate, relativeDue, slaClass, slaState } from "@/lib/utils";
import type { RoadblockTarget } from "@/components/RoadblockSheet";

export default function InfraDashboard({ onRoadblock }: { onRoadblock: (t: RoadblockTarget) => void }) {
  const { tasks, projects, bootLoading, lockedMessage } = useApp();

  const infraTasks = useMemo(() => {
    const scoped = tasks.filter((t) => t.division === "infra" || projects.find((p) => p.id === t.projectId)?.division === "infra");
    const pool = scoped.length > 0 ? scoped : tasks;
    return [...pool].sort((a, b) => (a.slaDueAt || "9999").localeCompare(b.slaDueAt || "9999"));
  }, [tasks, projects]);

  const locked = infraTasks.filter((t) => t.locked && t.status !== "done");
  const ready = infraTasks.filter((t) => !t.locked && t.status !== "done");

  if (bootLoading && tasks.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Dependency timeline</h1>
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dependency timeline</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {locked.length} locked behind prerequisites · {ready.length} ready to progress
        </p>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <LockIcon className="h-4 w-4" />
          Locked — waiting on prerequisites
        </h2>
        {locked.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            Nothing is blocked right now.
          </div>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6 dark:border-slate-700">
            {locked.map((task) => {
              const prereq = task.dependencyLock ? tasks.find((t) => t.id === task.dependencyLock) : null;
              const project = projects.find((p) => p.id === task.projectId);
              const gate = project?.securityGateStatus === "pending";
              const sla = slaState(task);
              return (
                <li key={task.id} className="relative">
                  <span className="absolute -left-[31px] top-4 h-3 w-3 rounded-full border-2 border-white bg-slate-400 dark:border-slate-900" />
                  <div
                    title={lockedMessage(task)}
                    className={cn(
                      "rounded-2xl border border-slate-200 bg-white p-4 opacity-75 dark:border-slate-700 dark:bg-slate-800",
                      slaClass(sla),
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <LockIcon className="h-4 w-4 shrink-0 text-slate-400" />
                          {task.title}
                        </p>
                        {project && (
                          <Link
                            href={`/projects/${project.id}`}
                            className="mt-0.5 block truncate text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {project.name}
                          </Link>
                        )}
                      </div>
                      <StatusBadge status={task.status} />
                    </div>
                    <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                      {gate && !prereq
                        ? "Blocked by pending InfoSec security gate."
                        : prereq
                          ? `Blocked by prerequisite: "${prereq.title}" (${prereq.status.replace("_", " ")})`
                          : lockedMessage(task)}
                    </p>
                    {task.slaDueAt && (
                      <p className="mt-1.5 text-xs text-slate-400">
                        SLA {fmtDate(task.slaDueAt)} · {relativeDue(task.slaDueAt)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Ready to progress
        </h2>
        <div className="space-y-3">
          {ready.map((task) => (
            <TaskCard key={task.id} task={task} onRoadblock={onRoadblock} />
          ))}
          {ready.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
              No unblocked tasks pending.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
