"use client";

// Group IT Management — portfolio matrix (divisions x status health) + executive deck export.

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { apiBlob } from "@/lib/api";
import { cn, divisionMeta, DIVISION_META, PROJECT_STATUS_META } from "@/lib/utils";
import type { Project, ProjectStatus } from "@/lib/types";
import ProjectCard from "@/components/ProjectCard";
import { DownloadIcon } from "@/components/Icons";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";

const STATUS_ORDER: ProjectStatus[] = ["active", "at_risk", "on_hold", "draft", "complete"];

function healthTone(byStatus: Record<ProjectStatus, number>): string {
  if (byStatus.at_risk > 0) return "bg-rose-500";
  if (byStatus.on_hold > 0) return "bg-amber-500";
  if (byStatus.active > 0) return "bg-emerald-500";
  return "bg-slate-400";
}

export default function ManagementDashboard() {
  const { projects, tasks, roadblocks, online, bootLoading } = useApp();
  const { push: toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const matrix = useMemo(() => {
    const divisions = Object.keys(DIVISION_META);
    return divisions
      .map((division) => {
        const divProjects = projects.filter((p) => p.division === division);
        const byStatus = STATUS_ORDER.reduce(
          (acc, s) => ({ ...acc, [s]: divProjects.filter((p) => p.overallStatus === s).length }),
          {} as Record<ProjectStatus, number>,
        );
        const projectIds = new Set(divProjects.map((p) => p.id));
        const blockedTasks = tasks.filter((t) => projectIds.has(t.projectId) && t.status === "blocked").length;
        const openRoadblocks = roadblocks.filter((r) => projectIds.has(r.projectId) && r.status !== "resolved").length;
        return { division, projects: divProjects, byStatus, blockedTasks, openRoadblocks };
      })
      .filter((row) => row.projects.length > 0 || ["ops", "infra", "infosec"].includes(row.division));
  }, [projects, tasks, roadblocks]);

  const exportDeck = async (format: "pptx" | "pdf") => {
    if (!online) {
      toast("Deck export needs a live connection to the reporting engine.", "warning");
      return;
    }
    setDownloading(format);
    try {
      const blob = await apiBlob(`/api/reports/executive-deck?format=${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opspm360-executive-deck.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`Executive deck (${format.toUpperCase()}) downloaded.`, "success");
    } catch {
      toast("Deck export failed — is the server running?", "error");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Portfolio health</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            All divisions · {projects.length} projects · {roadblocks.filter((r) => r.status !== "resolved").length} open
            roadblocks
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void exportDeck("pptx")}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <DownloadIcon className="h-4 w-4" />
            {downloading === "pptx" ? "Building…" : "Executive Deck (PPTX)"}
          </button>
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void exportDeck("pdf")}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-indigo-300 px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
          >
            <DownloadIcon className="h-4 w-4" />
            {downloading === "pdf" ? "Building…" : "PDF"}
          </button>
        </div>
      </div>

      {bootLoading && projects.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matrix.map((row) => {
            const meta = divisionMeta(row.division);
            return (
              <div
                key={row.division}
                className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <span className={cn("h-2.5 w-2.5 rounded-full", meta.accent)} />
                    {meta.label}
                  </h3>
                  <span
                    title="Division health"
                    className={cn("h-3 w-3 rounded-full", healthTone(row.byStatus))}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {STATUS_ORDER.filter((s) => row.byStatus[s] > 0).map((s) => (
                    <span
                      key={s}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        PROJECT_STATUS_META[s].badge,
                      )}
                    >
                      {row.byStatus[s]} {PROJECT_STATUS_META[s].label.toLowerCase()}
                    </span>
                  ))}
                  {row.projects.length === 0 && (
                    <span className="text-xs text-slate-400">No projects yet</span>
                  )}
                </div>
                <div className="mt-4 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span>{row.blockedTasks} blocked tasks</span>
                  <span>{row.openRoadblocks} roadblocks</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          All projects
        </h2>
        {bootLoading && projects.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...projects]
              .sort((a: Project, b: Project) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name))
              .map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
