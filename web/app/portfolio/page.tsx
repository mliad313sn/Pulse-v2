"use client";

// Portfolio Wall — enterprise KPI banner + drillable project grid (plan §45).
// KPIs are a LIVE, ONLINE-ONLY read (GET /api/kpis) and recalculate SERVER-SIDE
// under the active filters. Clicking a KPI tile applies it as the active drill:
// its id-list filters the cached project grid below (non-project drills map to
// projects via their projectId in the local cache).

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { useLiveView } from "@/lib/liveViews";
import { useOrgTree } from "@/lib/orgData";
import { useToast } from "@/components/Toast";
import ProjectCard from "@/components/ProjectCard";
import EmptyState from "@/components/EmptyState";
import { PageHeader, SectionHeader } from "@/components/Headings";
import { Skeleton } from "@/components/Skeleton";
import { RagGlyph } from "@/components/RagBadge";
import { CloudOffIcon } from "@/components/Icons";
import {
  cn,
  DIVISION_META,
  INPUT_CLASS,
  LIFECYCLE_META,
  LIFECYCLE_STAGES,
  RAG_COLORS,
  RAG_META,
} from "@/lib/utils";
import type { KpiKey, KpisResponse, Project, RagColor } from "@/lib/types";

// ---- KPI tile config --------------------------------------------------------

interface TileDef {
  key: KpiKey;
  label: string;
  rag?: RagColor;
  /** Count accent when the value is non-zero. */
  accent?: string;
}

const KPI_TILES: TileDef[] = [
  { key: "projects", label: "Projects" },
  { key: "green", label: "Green", rag: "GREEN", accent: "text-emerald-600 dark:text-emerald-400" },
  { key: "amber", label: "Amber", rag: "AMBER", accent: "text-amber-600 dark:text-amber-400" },
  { key: "red", label: "Red", rag: "RED", accent: "text-rose-600 dark:text-rose-400" },
  { key: "onHold", label: "On hold", accent: "text-amber-600 dark:text-amber-400" },
  { key: "upcomingGoLives", label: "Upcoming go-lives", accent: "text-indigo-600 dark:text-indigo-400" },
  { key: "overdueMilestones", label: "Overdue milestones", accent: "text-rose-600 dark:text-rose-400" },
  { key: "criticalRoadblocks", label: "Critical roadblocks", accent: "text-rose-600 dark:text-rose-400" },
  { key: "overdueActions", label: "Overdue actions", accent: "text-rose-600 dark:text-rose-400" },
  { key: "gatesWaiting", label: "Gates waiting", accent: "text-amber-600 dark:text-amber-400" },
];

interface Filters {
  site: string;
  division: string;
  ragColor: string;
  lifecycleStage: string;
}

const NO_FILTERS: Filters = { site: "", division: "", ragColor: "", lifecycleStage: "" };

function kpisPath(f: Filters): string {
  const params = new URLSearchParams();
  if (f.site) params.set("site", f.site);
  if (f.division) params.set("division", f.division);
  if (f.ragColor) params.set("ragColor", f.ragColor);
  if (f.lifecycleStage) params.set("lifecycleStage", f.lifecycleStage);
  const qs = params.toString();
  return `/api/kpis${qs ? `?${qs}` : ""}`;
}

export default function PortfolioWallPage() {
  const { user, online, projects, milestones, roadblocks, actions } = useApp();
  const { tree } = useOrgTree();
  const { push: toast } = useToast();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [drill, setDrill] = useState<KpiKey | null>(null);
  const { data, loading, error, reload } = useLiveView<KpisResponse>(user ? kpisPath(filters) : null);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setDrill(null); // a new scope invalidates the previous drill
  };

  // ---- drill resolution: KPI id-list -> cached projects ---------------------

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const resolveDrill = useMemo(() => {
    const milestoneProject = new Map(milestones.map((m) => [m.id, m.projectId]));
    const roadblockProject = new Map(roadblocks.map((r) => [r.id, r.projectId]));
    const actionProject = new Map(actions.map((a) => [a.id, a.projectId ?? null]));
    return (ids: string[]) => {
      const projectIds: string[] = [];
      const seen = new Set<string>();
      let general = 0;
      let uncached = 0;
      for (const id of ids) {
        let pid: string | null | undefined;
        if (byId.has(id)) pid = id;
        else if (milestoneProject.has(id)) pid = milestoneProject.get(id);
        else if (roadblockProject.has(id)) pid = roadblockProject.get(id);
        else if (actionProject.has(id)) {
          pid = actionProject.get(id);
          if (pid === null) {
            general += 1;
            continue;
          }
        }
        if (!pid) {
          uncached += 1;
          continue;
        }
        if (!seen.has(pid)) {
          seen.add(pid);
          projectIds.push(pid);
        }
      }
      return { projectIds, general, uncached };
    };
  }, [byId, milestones, roadblocks, actions]);

  // Client-side mirror of the server scope — grid fallback when live data (or a
  // drill list) is unavailable, and the offline cached view.
  const clientFiltered = useMemo(
    () =>
      projects.filter((p) => {
        if (filters.site && p.site !== filters.site && !(p.sites ?? []).includes(filters.site)) return false;
        if (filters.division && p.division !== filters.division) return false;
        if (filters.ragColor && p.rag?.color !== filters.ragColor) return false;
        if (filters.lifecycleStage && p.lifecycleStage !== filters.lifecycleStage) return false;
        return true;
      }),
    [projects, filters],
  );

  const { gridProjects, uncachedNote } = useMemo((): {
    gridProjects: Project[];
    uncachedNote: string | null;
  } => {
    const activeIds = drill ? data?.drill?.[drill] : data?.drill?.projects;
    if (!activeIds) {
      return { gridProjects: sortProjects(clientFiltered), uncachedNote: null };
    }
    const { projectIds, uncached } = resolveDrill(activeIds);
    const cached = projectIds.map((id) => byId.get(id)).filter((p): p is Project => Boolean(p));
    const missing = uncached + (projectIds.length - cached.length);
    return {
      gridProjects: sortProjects(cached),
      uncachedNote:
        missing > 0
          ? `${missing} item${missing === 1 ? " is" : "s are"} not cached locally — totals above stay authoritative.`
          : null,
    };
  }, [drill, data, resolveDrill, byId, clientFiltered]);

  if (!user) return null;

  const onTileClick = (key: KpiKey) => {
    if (drill === key) {
      setDrill(null);
      return;
    }
    setDrill(key);
    if (key === "overdueActions") {
      const ids = data?.drill?.overdueActions ?? [];
      const { general } = resolveDrill(ids);
      if (general > 0) {
        toast(
          `${general} general action${general === 1 ? " has" : "s have"} no project — they are counted above but cannot appear in the project grid.`,
          "info",
        );
      }
    }
  };

  const drillLabel = drill ? KPI_TILES.find((t) => t.key === drill)?.label : null;
  const sites = tree.sites;

  return (
    <div>
      <PageHeader
        title="Portfolio Wall"
        subtitle="Enterprise KPIs recalculated live under the active filters — click a tile to drill into the projects behind it."
      />

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select
          value={filters.site}
          onChange={(e) => setFilter("site", e.target.value)}
          aria-label="Filter by site"
          className={cn(INPUT_CLASS, "h-10 w-auto rounded-xl text-sm")}
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={filters.division}
          onChange={(e) => setFilter("division", e.target.value)}
          aria-label="Filter by division"
          className={cn(INPUT_CLASS, "h-10 w-auto rounded-xl text-sm")}
        >
          <option value="">All divisions</option>
          {Object.entries(DIVISION_META).map(([id, meta]) => (
            <option key={id} value={id}>
              {meta.label}
            </option>
          ))}
        </select>
        <select
          value={filters.ragColor}
          onChange={(e) => setFilter("ragColor", e.target.value)}
          aria-label="Filter by RAG health"
          className={cn(INPUT_CLASS, "h-10 w-auto rounded-xl text-sm")}
        >
          <option value="">Any RAG</option>
          {RAG_COLORS.map((c) => (
            <option key={c} value={c}>
              {RAG_META[c].label}
            </option>
          ))}
        </select>
        <select
          value={filters.lifecycleStage}
          onChange={(e) => setFilter("lifecycleStage", e.target.value)}
          aria-label="Filter by lifecycle stage"
          className={cn(INPUT_CLASS, "h-10 w-auto rounded-xl text-sm")}
        >
          <option value="">Any stage</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s} value={s}>
              {LIFECYCLE_META[s].label}
            </option>
          ))}
        </select>
        {(filters.site || filters.division || filters.ragColor || filters.lifecycleStage) && (
          <button
            type="button"
            onClick={() => {
              setFilters(NO_FILTERS);
              setDrill(null);
            }}
            className="rounded-xl px-3 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* KPI banner */}
      {!online && !data ? (
        <EmptyState size="md" className="mb-6">
          <span className="inline-flex items-center gap-2">
            <CloudOffIcon className="h-4 w-4" />
            You are offline — live KPIs need a connection. Showing the cached project grid below.
          </span>
        </EmptyState>
      ) : error && !data ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          <span>Could not load KPIs: {error}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-xl border border-rose-300 px-3 py-1.5 font-semibold transition hover:bg-rose-100 dark:border-rose-700 dark:hover:bg-rose-900/40"
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        data && (
          <div
            className={cn("mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", loading && "opacity-60")}
            aria-busy={loading}
          >
            {KPI_TILES.map((tile) => {
              const value = data.totals[tile.key] ?? 0;
              const active = drill === tile.key;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => onTileClick(tile.key)}
                  aria-pressed={active}
                  title={active ? "Clear drill" : `Drill into ${tile.label.toLowerCase()}`}
                  className={cn(
                    "rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500",
                    active && "border-indigo-500 ring-2 ring-indigo-300 dark:border-indigo-500 dark:ring-indigo-700",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-2 text-3xl font-bold tabular-nums",
                      value > 0 && tile.accent ? tile.accent : "text-slate-800 dark:text-slate-100",
                    )}
                  >
                    {tile.rag && <RagGlyph color={tile.rag} className="h-4 w-4" />}
                    {value}
                  </span>
                  <span className="mt-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* Project grid (drilled / filtered) */}
      <section>
        <SectionHeader>
          {drillLabel ? `Drill: ${drillLabel} · ${gridProjects.length} project${gridProjects.length === 1 ? "" : "s"}` : `Projects · ${gridProjects.length}`}
          {drill && (
            <button
              type="button"
              onClick={() => setDrill(null)}
              className="ml-3 rounded-full border border-indigo-300 px-2.5 py-0.5 text-xs font-semibold normal-case tracking-normal text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              Clear drill
            </button>
          )}
        </SectionHeader>
        {uncachedNote && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{uncachedNote}</p>}
        {gridProjects.length === 0 ? (
          <EmptyState>
            {drill
              ? "No cached projects behind this KPI — the totals above stay authoritative."
              : projects.length === 0
                ? "No projects cached yet — connect once to load the portfolio."
                : "No projects match the active filters."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gridProjects.map((p) => (
              <ProjectCard key={p.id} project={p} showTags />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));
}
