"use client";

// Derived, read-only progress bar for a project — driven by the server-computed
// `project.progress` rollup (milestone weights). Falls back to a client-side
// computation from cached milestones only when a stale cache predates the field.
// NEVER editable.

import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { cn, computeProgress } from "@/lib/utils";
import type { Project } from "@/lib/types";

export default function ProjectProgress({ project, className }: { project: Project; className?: string }) {
  const { milestones } = useApp();

  const progress = useMemo(() => {
    if (project.progress && typeof project.progress === "object") return project.progress;
    // Stale-cache fallback — same formula the server uses.
    return computeProgress(milestones.filter((m) => m.projectId === project.id));
  }, [project.progress, project.id, milestones]);

  const percent = progress.percent;
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div className={cn("mt-4", className)} title={progress.explanation || undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Progress
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {percent == null ? "—" : `${clamped}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent == null ? undefined : clamped}
        aria-label="Project progress (derived from milestone weights)"
        className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            clamped >= 100 ? "bg-emerald-500" : "bg-indigo-500",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        {percent == null ? "No milestones yet" : progress.explanation}
      </p>
    </div>
  );
}
