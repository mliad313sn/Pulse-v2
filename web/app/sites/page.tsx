"use client";

// Sites index — every site in the org tree with cached project counts; each row
// links to that site's Lens (/sites/:code). The tree itself is the cached
// offline-first org read (lib/orgData); the Lens pages are live views.

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { useOrgTree } from "@/lib/orgData";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/Headings";
import { SkeletonList } from "@/components/Skeleton";
import { Pill } from "@/components/Badges";
import { ChevronRightIcon } from "@/components/Icons";
import { divisionMeta, isRoadblockClosed } from "@/lib/utils";

export default function SitesIndexPage() {
  const { user, projects, roadblocks } = useApp();
  const { tree, loading } = useOrgTree();

  const counts = useMemo(() => {
    const map = new Map<string, { projects: number; roadblocks: number }>();
    const projectSites = new Map<string, string[]>();
    for (const p of projects) {
      const siteIds = new Set<string>([...(p.site ? [p.site] : []), ...(p.sites ?? [])]);
      projectSites.set(p.id, [...siteIds]);
      for (const s of siteIds) {
        const row = map.get(s) ?? { projects: 0, roadblocks: 0 };
        row.projects += 1;
        map.set(s, row);
      }
    }
    for (const r of roadblocks) {
      if (isRoadblockClosed(r.status)) continue;
      for (const s of projectSites.get(r.projectId) ?? []) {
        const row = map.get(s);
        if (row) row.roadblocks += 1;
      }
    }
    return map;
  }, [projects, roadblocks]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Sites"
        subtitle="Every operational site — open a site to see its live lens (projects, milestones, roadblocks, people)."
      />

      {loading && tree.sites.length === 0 ? (
        <SkeletonList count={3} />
      ) : tree.sites.length === 0 ? (
        <EmptyState>No sites cached yet — connect once to load the organization tree.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {tree.sites.map((site) => {
            const c = counts.get(site.id) ?? { projects: 0, roadblocks: 0 };
            const div = site.divisionId ? divisionMeta(site.divisionId) : null;
            return (
              <li key={site.id}>
                <Link
                  href={`/sites/${encodeURIComponent(site.id)}`}
                  className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 transition hover:border-indigo-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{site.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{site.id}</span>
                      {div ? ` · ${div.label}` : ""}
                    </span>
                  </span>
                  <Pill className="shrink-0 border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300">
                    {c.projects} project{c.projects === 1 ? "" : "s"}
                  </Pill>
                  {c.roadblocks > 0 && (
                    <Pill className="shrink-0 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                      {c.roadblocks} roadblock{c.roadblocks === 1 ? "" : "s"}
                    </Pill>
                  )}
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
