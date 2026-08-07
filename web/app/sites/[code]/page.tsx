"use client";

// Site Lens — everything happening at ONE site: projects, milestones due in the
// next 60 days, open roadblocks, open risks/CAPAs, and the people on the ground.
// A LIVE, ONLINE-ONLY read (GET /api/sites/:code/lens); offline shows the cached
// projects for the site plus an offline hint for the server-derived rest.

import Link from "next/link";
import { use, useMemo } from "react";
import { useApp } from "@/lib/store";
import { useLiveView } from "@/lib/liveViews";
import { useOrgTree } from "@/lib/orgData";
import ProjectCard from "@/components/ProjectCard";
import EmptyState from "@/components/EmptyState";
import { PageHeader, SectionHeader } from "@/components/Headings";
import { SkeletonCard, SkeletonList } from "@/components/Skeleton";
import {
  CapaStatusChip,
  EscalatedBadge,
  MilestoneStatusBadge,
  MilestoneTypeBadge,
  Pill,
  RiskScorePill,
  RiskStatusBadge,
  RoadblockStatusBadge,
  SeverityBadge,
} from "@/components/Badges";
import { CloudOffIcon } from "@/components/Icons";
import { cn, divisionMeta, fmtDate, initials, projectRoleLabel } from "@/lib/utils";
import type { Project, SiteLensResponse } from "@/lib/types";

function StatTile({ value, label, accent }: { value: number | string; label: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <span
        className={cn(
          "block text-3xl font-bold tabular-nums",
          accent ?? "text-slate-800 dark:text-slate-100",
        )}
      >
        {value}
      </span>
      <span className="mt-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

function LensProjectChip({ projectId, projects }: { projectId?: string | null; projects: Project[] }) {
  const project = projectId ? projects.find((p) => p.id === projectId) : null;
  if (!project) return null;
  return (
    <Link href={`/projects/${project.id}`} className="max-w-[11rem] shrink-0">
      <Pill className="w-full border border-indigo-200 text-indigo-600 transition hover:border-indigo-400 dark:border-indigo-800 dark:text-indigo-300">
        <span className="truncate">{project.name}</span>
      </Pill>
    </Link>
  );
}

export default function SiteLensPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { user, online, projects } = useApp();
  const { tree } = useOrgTree();
  const { data, loading, error, reload } = useLiveView<SiteLensResponse>(
    user ? `/api/sites/${encodeURIComponent(code)}/lens` : null,
  );

  // Cached projects for this site — the offline fallback grid, and the join
  // target for chips (store copies keep task-progress bars live).
  const cachedSiteProjects = useMemo(
    () => projects.filter((p) => p.site === code || (p.sites ?? []).includes(code)),
    [projects, code],
  );

  const lensProjects = useMemo(
    () => (data ? data.projects.map((p) => projects.find((c) => c.id === p.id) ?? p) : cachedSiteProjects),
    [data, projects, cachedSiteProjects],
  );

  // All projects (cache + lens) for chip lookups on lens entity rows.
  const chipProjects = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p]));
    for (const p of data?.projects ?? []) if (!map.has(p.id)) map.set(p.id, p);
    return [...map.values()];
  }, [projects, data]);

  if (!user) return null;

  const siteName = data?.site?.name ?? tree.sites.find((s) => s.id === code)?.name ?? code;
  const initialLoading = loading && !data;
  const liveUnavailable = !data && (!online || Boolean(error));

  return (
    <div>
      <PageHeader
        title={siteName}
        subtitle={
          <>
            Site Lens · <span className="font-mono text-sm">{code}</span>
            {!online ? " · offline" : ""}
          </>
        }
      />

      {online && error && !data && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          <span>Could not load the site lens: {error}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-xl border border-rose-300 px-3 py-1.5 font-semibold transition hover:bg-rose-100 dark:border-rose-700 dark:hover:bg-rose-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI-ish row */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={initialLoading ? "…" : lensProjects.length} label="Projects" />
        <StatTile
          value={initialLoading || !data ? "—" : data.openRoadblocks.length}
          label="Open roadblocks"
          accent={data && data.openRoadblocks.length > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
        />
        <StatTile
          value={initialLoading || !data ? "—" : data.risksOpen.length}
          label="Risks open"
          accent={data && data.risksOpen.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        <StatTile
          value={initialLoading || !data ? "—" : data.capasOpen.length}
          label="CAPAs open"
          accent={data && data.capasOpen.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
      </div>

      {/* Projects */}
      <section className="mb-8">
        <SectionHeader>Projects</SectionHeader>
        {initialLoading && lensProjects.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : lensProjects.length === 0 ? (
          <EmptyState size="sm">No projects at this site.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lensProjects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>

      {/* Server-derived sections — live only. */}
      {liveUnavailable ? (
        <EmptyState size="md">
          <span className="inline-flex items-center gap-2">
            <CloudOffIcon className="h-4 w-4" />
            {online
              ? "Milestones, roadblocks, risks, CAPAs and people could not be loaded — retry above."
              : "You are offline — milestones, roadblocks, risks, CAPAs and people need a live connection. Cached projects are shown above."}
          </span>
        </EmptyState>
      ) : initialLoading ? (
        <SkeletonList count={3} />
      ) : (
        data && (
          <>
            <section className="mb-8">
              <SectionHeader>Milestones due in the next 60 days</SectionHeader>
              {data.milestonesDue.length === 0 ? (
                <EmptyState size="sm">No milestones due at this site in the next 60 days.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.milestonesDue.map((m) => (
                    <li
                      key={m.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
                      <MilestoneTypeBadge type={m.type} />
                      <MilestoneStatusBadge status={m.status} />
                      <LensProjectChip projectId={m.projectId} projects={chipProjects} />
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {fmtDate(m.forecastDue ?? m.baselineDue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <SectionHeader>Open roadblocks</SectionHeader>
              {data.openRoadblocks.length === 0 ? (
                <EmptyState size="sm">No open roadblocks at this site.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.openRoadblocks.map((r) => (
                    <li
                      key={r.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.description}</span>
                      <RoadblockStatusBadge status={r.status} />
                      <SeverityBadge severity={r.severity} />
                      {r.escalated && <EscalatedBadge escalatedAt={r.escalatedAt} />}
                      <LensProjectChip projectId={r.projectId} projects={chipProjects} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <SectionHeader>Open risks</SectionHeader>
              {data.risksOpen.length === 0 ? (
                <EmptyState size="sm">No open risks at this site.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.risksOpen.map((r) => (
                    <li
                      key={r.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.description}</span>
                      <RiskScorePill score={r.inherentScore} title="Inherent P×I score" />
                      <RiskStatusBadge status={r.status} />
                      <LensProjectChip projectId={r.projectId} projects={chipProjects} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <SectionHeader>Open CAPAs</SectionHeader>
              {data.capasOpen.length === 0 ? (
                <EmptyState size="sm">No open CAPAs at this site.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.capasOpen.map((c) => (
                    <li
                      key={c.id}
                      className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.issue}</span>
                      <CapaStatusChip status={c.status} />
                      <LensProjectChip projectId={c.projectId} projects={chipProjects} />
                      {c.dueDate && (
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDate(c.dueDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionHeader>People</SectionHeader>
              {data.people.length === 0 ? (
                <EmptyState size="sm">No people registered at this site.</EmptyState>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.people.map((person) => {
                    const div = divisionMeta(person.division ?? null);
                    return (
                      <span
                        key={person.id}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white",
                            div.accent,
                          )}
                        >
                          {initials(person.name)}
                        </span>
                        <span className="font-medium">{person.name}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {div.label}
                          {person.role ? ` · ${projectRoleLabel(person.role)}` : ""}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
