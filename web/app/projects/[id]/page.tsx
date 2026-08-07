"use client";

// Project detail — Kanban board (drag-and-drop + touch fallback), roadblocks, audit peek.

import { use, useMemo } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import Kanban from "@/components/Kanban";
import AuditPeek from "@/components/AuditPeek";
import EmptyState from "@/components/EmptyState";
import ProjectMembers from "@/components/ProjectMembers";
import EditProjectButton from "@/components/EditProjectDialog";
import ProjectProgress from "@/components/ProjectProgress";
import Milestones from "@/components/Milestones";
import { PageHeader } from "@/components/Headings";
import LogRoadblockButton from "@/components/LogRoadblockButton";
import {
  ClassificationBadge,
  CountPill,
  LifecycleChip,
  OperatingStatusBadge,
  Pill,
  ProjectCodeChip,
  ProjectStatusBadge,
  SecurityGateBadge,
  SeverityBadge,
  TagChip,
} from "@/components/Badges";
import { PlusIcon, ScaleIcon } from "@/components/Icons";
import { SkeletonBoard } from "@/components/Skeleton";
import { divisionMeta, fmtDateTime, cn } from "@/lib/utils";
import type { RoadblockStatus } from "@/lib/types";

const RB_NEXT: Record<RoadblockStatus, { label: string; next: RoadblockStatus } | null> = {
  open: { label: "Start mitigating", next: "mitigating" },
  mitigating: { label: "Mark resolved", next: "resolved" },
  resolved: null,
};

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, roadblocks, users, updateRoadblock, bootLoading, openRoadblock, canWrite } = useApp();

  const project = projects.find((p) => p.id === id);
  const projectRoadblocks = useMemo(
    () =>
      roadblocks
        .filter((r) => r.projectId === id)
        .sort((a, b) => (b.createdAt || b.updatedAt || "").localeCompare(a.createdAt || a.updatedAt || "")),
    [roadblocks, id],
  );

  if (!project) {
    return (
      <div className="py-10">
        {bootLoading ? (
          <SkeletonBoard />
        ) : (
          <EmptyState size="bare">
            <p className="font-medium">Project not found in the local cache.</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              It may not have synced yet — reconnect or head back to the dashboard.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              Back to dashboard
            </Link>
          </EmptyState>
        )}
      </div>
    );
  }

  const div = divisionMeta(project.division);
  const openRbs = projectRoadblocks.filter((r) => r.status !== "resolved");
  const pm = project.pmId ? users.find((u) => u.id === project.pmId) : null;
  const sponsor = project.sponsorId ? users.find((u) => u.id === project.sponsorId) : null;

  return (
    <div className="space-y-8">
      <header>
        <PageHeader
          className="items-start"
          innerClassName="min-w-0"
          titleClassName="flex items-center gap-2.5"
          title={
            <>
              <span className={cn("h-3 w-3 shrink-0 rounded-full", div.accent)} title={div.label} />
              {project.name}
            </>
          }
          subtitle={
            <>
              {div.label}
              {project.site ? ` · ${project.site}` : ""}
              {project.description ? ` — ${project.description}` : ""}
            </>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <EditProjectButton project={project} />
              <Link
                href={`/projects/${project.id}/governance`}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-indigo-300 px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                <ScaleIcon className="h-4 w-4" />
                Governance
              </Link>
              {canWrite && (
                <LogRoadblockButton variant="solid" onClick={() => openRoadblock({ projectId: project.id })} />
              )}
            </div>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ProjectCodeChip code={project.code} />
          <LifecycleChip stage={project.lifecycleStage} />
          <OperatingStatusBadge status={project.operatingStatus} />
          <ProjectStatusBadge status={project.overallStatus} />
          <ClassificationBadge classification={project.classification} />
          <SecurityGateBadge status={project.securityGateStatus} />
          {project.strategicTag && <TagChip tag={project.strategicTag} tone="indigo" />}
          {project.cgeitTag && <TagChip tag={project.cgeitTag} tone="violet" />}
          {(project.riskTags ?? []).map((t) => (
            <TagChip key={t} tag={t} tone="rose" />
          ))}
        </div>
        {(pm || sponsor) && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {pm && (
              <span>
                PM: <span className="font-medium text-slate-700 dark:text-slate-200">{pm.name}</span>
              </span>
            )}
            {pm && sponsor && <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>}
            {sponsor && (
              <span>
                Sponsor: <span className="font-medium text-slate-700 dark:text-slate-200">{sponsor.name}</span>
              </span>
            )}
          </p>
        )}
        <ProjectProgress project={project} />
      </header>

      <Kanban projectId={project.id} />

      <Milestones project={project} />

      <ProjectMembers project={project} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Roadblocks
            {openRbs.length > 0 && <CountPill>{openRbs.length} open</CountPill>}
          </h2>
          {canWrite && (
            <button
              type="button"
              onClick={() => openRoadblock({ projectId: project.id })}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
            >
              <PlusIcon className="h-4 w-4" />
              New
            </button>
          )}
        </div>
        {projectRoadblocks.length === 0 ? (
          <EmptyState size="sm">No roadblocks logged for this project.</EmptyState>
        ) : (
          <div className="space-y-3">
            {projectRoadblocks.map((rb) => {
              const reporter = users.find((u) => u.id === rb.reportedBy);
              const action = RB_NEXT[rb.status];
              return (
                <div
                  key={rb.id}
                  className={cn(
                    "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800",
                    rb.status === "resolved" && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 leading-snug">{rb.description}</p>
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={rb.severity} />
                      <Pill className="bg-slate-100 capitalize text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {rb.status}
                      </Pill>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>
                      {reporter ? `Reported by ${reporter.name} · ` : ""}
                      {fmtDateTime(rb.createdAt || rb.updatedAt)}
                    </span>
                    {action && canWrite && (
                      <button
                        type="button"
                        onClick={() => void updateRoadblock(rb.id, { status: action.next })}
                        className="min-h-[36px] rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
                      >
                        {action.label}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AuditPeek entityId={project.id} />
    </div>
  );
}
