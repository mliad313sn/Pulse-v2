"use client";

import Link from "next/link";
import { useApp } from "@/lib/store";
import { cn, divisionMeta } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { ProjectStatusBadge, SecurityGateBadge, TagChip } from "./Badges";
import { ChevronRightIcon } from "./Icons";

export default function ProjectCard({ project, showTags = false }: { project: Project; showTags?: boolean }) {
  const { tasks } = useApp();
  const div = divisionMeta(project.division);
  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const done = projectTasks.filter((t) => t.status === "done").length;
  const pct = projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0;

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
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {div.label}
            {project.site ? ` · ${project.site}` : ""}
          </p>
        </div>
        <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ProjectStatusBadge status={project.overallStatus} />
        <SecurityGateBadge status={project.securityGateStatus} />
        {showTags && project.strategicTag && <TagChip tag={project.strategicTag} tone="indigo" />}
        {showTags && project.cgeitTag && <TagChip tag={project.cgeitTag} tone="violet" />}
        {showTags && (project.riskTags ?? []).map((t) => <TagChip key={t} tag={t} tone="rose" />)}
      </div>

      {projectTasks.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {done}/{projectTasks.length} tasks done
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
