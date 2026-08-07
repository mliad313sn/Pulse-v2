"use client";

// Group IT Management — portfolio matrix (divisions x status health) + executive deck export.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { apiBlob } from "@/lib/api";
import { MyActions } from "@/components/Actions";
import { cn, divisionMeta, DIVISION_META, isRoadblockClosed, PROJECT_STATUS_META, RAG_COLORS } from "@/lib/utils";
import type { Project, ProjectStatus, RagColor } from "@/lib/types";
import ProjectCard from "@/components/ProjectCard";
import NewProjectButton from "@/components/NewProjectButton";
import { RagCountPill } from "@/components/RagBadge";
import { Pill } from "@/components/Badges";
import { PageHeader, SectionHeader } from "@/components/Headings";
import { ChevronRightIcon, DownloadIcon } from "@/components/Icons";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";

const STATUS_ORDER: ProjectStatus[] = ["active", "at_risk", "on_hold", "draft", "complete"];

// Rows shown even when a division has no projects yet.
const ALWAYS_SHOWN = ["ops", "infra", "infosec"];

interface MatrixRow {
  division: string;
  projects: Project[];
  byStatus: Record<ProjectStatus, number>;
  byRag: Record<RagColor, number>;
  blockedTasks: number;
  openRoadblocks: number;
}

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
    const rows = new Map<string, MatrixRow>(
      divisions.map((division) => [
        division,
        {
          division,
          projects: [],
          byStatus: Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ProjectStatus, number>,
          byRag: Object.fromEntries(RAG_COLORS.map((c) => [c, 0])) as Record<RagColor, number>,
          blockedTasks: 0,
          openRoadblocks: 0,
        },
      ]),
    );
    // Single pass per collection, joined through a projectId -> division map.
    const projectDivision = new Map<string, string>();
    for (const p of projects) {
      projectDivision.set(p.id, p.division);
      const row = rows.get(p.division);
      if (!row) continue;
      row.projects.push(p);
      row.byStatus[p.overallStatus] += 1;
      if (p.rag && row.byRag[p.rag.color] !== undefined) row.byRag[p.rag.color] += 1;
    }
    for (const t of tasks) {
      if (t.status !== "blocked") continue;
      const row = rows.get(projectDivision.get(t.projectId) ?? "");
      if (row) row.blockedTasks += 1;
    }
    for (const r of roadblocks) {
      if (isRoadblockClosed(r.status)) continue;
      const row = rows.get(projectDivision.get(r.projectId) ?? "");
      if (row) row.openRoadblocks += 1;
    }
    return divisions
      .map((division) => rows.get(division)!)
      .filter((row) => row.projects.length > 0 || ALWAYS_SHOWN.includes(row.division));
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
      <PageHeader
        className="mb-6 items-end"
        title="Portfolio health"
        subtitle={
          <>
            All divisions · {projects.length} projects · {roadblocks.filter((r) => !isRoadblockClosed(r.status)).length} open
            roadblocks
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portfolio"
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
            >
              Portfolio Wall
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
            <NewProjectButton />
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
        }
      />

      <MyActions />

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
                {(row.byRag.GREEN > 0 || row.byRag.AMBER > 0 || row.byRag.RED > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {RAG_COLORS.map((c) => (
                      <RagCountPill key={c} color={c} count={row.byRag[c]} />
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {STATUS_ORDER.filter((s) => row.byStatus[s] > 0).map((s) => (
                    <Pill key={s} className={cn("gap-1", PROJECT_STATUS_META[s].badge)}>
                      {row.byStatus[s]} {PROJECT_STATUS_META[s].label.toLowerCase()}
                    </Pill>
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
        <SectionHeader>All projects</SectionHeader>
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
