"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { cn, divisionMeta, isUpdateStale, relativeAgo } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { ClassificationBadge, ProjectStatusBadge, SecurityGateBadge, TagChip } from "./Badges";
import RagBadge from "./RagBadge";
import { ChevronRightIcon } from "./Icons";

export default function ProjectCard({ project, showTags = false }: { project: Project; showTags?: boolean }) {
  const { tasks, updates } = useApp();
  const div = divisionMeta(project.division);
  const { total, done } = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const t of tasks) {
      if (t.projectId !== project.id) continue;
      total += 1;
      if (t.status === "done") done += 1;
    }
    return { total, done };
  }, [tasks, project.id]);
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Freshness cue: latest cached update for this project (amber when stale >21d).
  const latestUpdateAt = useMemo(() => {
    let latest: string | null = null;
    for (const u of updates) {
      if (u.projectId !== project.id || !u.createdAt) continue;
      if (!latest || u.createdAt > latest) latest = u.createdAt;
    }
    return latest;
  }, [updates, project.id]);
  const stale = isUpdateStale(latestUpdateAt);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", div.accent)} title={div.label} />
            <h3 className="truncate font-semibold">{project.name}</h3>
            <RagBadge rag={project.rag} size="sm" className="shrink-0" />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {div.label}
            {project.site ? ` · ${project.site}` : ""}
            <span className={cn("ml-2 text-xs", stale ? "font-medium text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500")}>
              {latestUpdateAt ? `Updated ${relativeAgo(latestUpdateAt)}` : "No update yet"}
            </span>
          </p>
        </div>
        <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ProjectStatusBadge status={project.overallStatus} />
        <ClassificationBadge classification={project.classification} />
        <SecurityGateBadge status={project.securityGateStatus} />
        {showTags && project.strategicTag && <TagChip tag={project.strategicTag} tone="indigo" />}
        {showTags && project.cgeitTag && <TagChip tag={project.cgeitTag} tone="violet" />}
        {showTags && (project.riskTags ?? []).map((t) => <TagChip key={t} tag={t} tone="rose" />)}
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {done}/{total} tasks done
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </Link>
  );
}
