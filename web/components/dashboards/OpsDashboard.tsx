"use client";

// Zen Mode — mobile-first single column for site managers.
// SC3: status update = tap card's always-visible status button (1 tap).
//      Roadblock = tap "Log Roadblock" (1) -> prefilled sheet -> Save (2-3 taps).

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { MyActions } from "@/components/Actions";
import TaskCard from "@/components/TaskCard";
import LogRoadblockButton from "@/components/LogRoadblockButton";
import NewProjectButton from "@/components/NewProjectButton";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/Headings";
import { ChevronDownIcon } from "@/components/Icons";
import { SkeletonList } from "@/components/Skeleton";
import { slaState } from "@/lib/utils";

export default function OpsDashboard() {
  const { user, tasks, projects, bootLoading, openRoadblock, canWrite } = useApp();
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
      <PageHeader
        className="mb-6 items-end"
        title="My site tasks"
        subtitle={`Zen Mode${user?.site ? ` · ${user.site}` : ""} · ${open.length} open`}
        action={<NewProjectButton />}
      />

      <MyActions />

      {canWrite && (
        <LogRoadblockButton
          variant="solid"
          size="lg"
          className="mb-6"
          disabled={!defaultProject}
          onClick={() => defaultProject && openRoadblock({ projectId: defaultProject.id })}
        />
      )}

      {bootLoading && myTasks.length === 0 ? (
        <SkeletonList count={4} />
      ) : open.length === 0 && done.length === 0 ? (
        <EmptyState>No tasks for your site yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {open.map((task) => (
            <TaskCard key={task.id} task={task} mode="zen" />
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
                    <TaskCard key={task.id} task={task} mode="zen" />
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
