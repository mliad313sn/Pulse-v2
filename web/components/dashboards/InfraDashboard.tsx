"use client";

// Infrastructure — dependency-centric timeline.
// SC2: locked tasks are dimmed, carry a padlock, and name the prerequisite blocking them.

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/lib/store";
import TaskCard from "@/components/TaskCard";
import EmptyState from "@/components/EmptyState";
import NewProjectButton from "@/components/NewProjectButton";
import { PageHeader, SectionHeader } from "@/components/Headings";
import { LockIcon } from "@/components/Icons";
import { StatusBadge } from "@/components/Badges";
import { SkeletonList } from "@/components/Skeleton";
import { cn, fmtDate, relativeDue, slaClass, slaState } from "@/lib/utils";

export default function InfraDashboard() {
  const { tasks, projects, bootLoading, lockedMessage, lockedReason } = useApp();

  const { locked, ready, projectsById } = useMemo(() => {
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const scoped = tasks.filter(
      (t) => t.division === "infra" || projectsById.get(t.projectId)?.division === "infra",
    );
    const pool = scoped.length > 0 ? scoped : tasks;
    const infraTasks = [...pool].sort((a, b) => (a.slaDueAt || "9999").localeCompare(b.slaDueAt || "9999"));
    return {
      projectsById,
      locked: infraTasks.filter((t) => t.locked && t.status !== "done"),
      ready: infraTasks.filter((t) => !t.locked && t.status !== "done"),
    };
  }, [tasks, projects]);

  if (bootLoading && tasks.length === 0) {
    return (
      <div>
        <PageHeader title="Dependency timeline" />
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        className="mb-6 items-end"
        title="Dependency timeline"
        subtitle={`${locked.length} locked behind prerequisites · ${ready.length} ready to progress`}
        action={<NewProjectButton />}
      />

      <section className="mb-10">
        <SectionHeader className="flex items-center gap-2">
          <LockIcon className="h-4 w-4" />
          Locked — waiting on prerequisites
        </SectionHeader>
        {locked.length === 0 ? (
          <EmptyState size="sm">Nothing is blocked right now.</EmptyState>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6 dark:border-slate-700">
            {locked.map((task) => {
              const reason = lockedReason(task);
              const prereq = reason?.kind === "dependency" ? reason.prereq : undefined;
              const project = projectsById.get(task.projectId);
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
                      {reason?.kind === "gate"
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
        <SectionHeader>Ready to progress</SectionHeader>
        <div className="space-y-3">
          {ready.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
          {ready.length === 0 && <EmptyState size="sm">No unblocked tasks pending.</EmptyState>}
        </div>
      </section>
    </div>
  );
}
