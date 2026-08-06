"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { cn, fmtDate, relativeDue, slaClass, slaState } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { LockBadge, StatusBadge } from "./Badges";
import StatusButtons from "./StatusButtons";
import { AlertIcon, ClockIcon } from "./Icons";
import type { RoadblockTarget } from "./RoadblockSheet";

interface Props {
  task: Task;
  /** zen: status buttons always visible (1-tap update). expand: tap card to reveal buttons (2 taps). */
  mode?: "zen" | "expand";
  showProject?: boolean;
  onRoadblock: (target: RoadblockTarget) => void;
}

export default function TaskCard({ task, mode = "expand", showProject = true, onRoadblock }: Props) {
  const { projects, lockedMessage } = useApp();
  const [expanded, setExpanded] = useState(mode === "zen");
  const project = projects.find((p) => p.id === task.projectId);
  const sla = slaState(task);
  const locked = Boolean(task.locked);

  return (
    <div
      onClick={() => mode === "expand" && setExpanded((v) => !v)}
      title={locked ? lockedMessage(task) : undefined}
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-4 transition dark:border-slate-700 dark:bg-slate-800",
        mode === "expand" && "cursor-pointer hover:border-slate-300 dark:hover:border-slate-500",
        locked && "opacity-60",
        slaClass(sla),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{task.title}</p>
          {showProject && project && (
            <Link
              href={`/projects/${project.id}`}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {project.name}
            </Link>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={task.status} />
          {locked && <LockBadge reason={lockedMessage(task)} />}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {task.slaDueAt && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              sla === "overdue" && "font-semibold text-rose-600 dark:text-rose-400",
              sla === "warn" && "font-semibold text-amber-600 dark:text-amber-400",
            )}
          >
            <ClockIcon className="h-3.5 w-3.5" />
            SLA {fmtDate(task.slaDueAt)} ({relativeDue(task.slaDueAt)})
          </span>
        )}
        {task.priority && task.priority !== "normal" && (
          <span className="uppercase tracking-wide">{task.priority}</span>
        )}
        {task.site && <span>{task.site}</span>}
      </div>

      {expanded && (
        <div className="mt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
          <StatusButtons task={task} />
          <button
            type="button"
            onClick={() => onRoadblock({ projectId: task.projectId, task })}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
          >
            <AlertIcon className="h-4 w-4" />
            Log Roadblock
          </button>
        </div>
      )}
    </div>
  );
}
