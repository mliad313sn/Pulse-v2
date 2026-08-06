"use client";

// EA / Data / BizApps — portfolio list with strategic & CGEIT tags visible.

import { useApp } from "@/lib/store";
import ProjectCard from "@/components/ProjectCard";
import { SkeletonList } from "@/components/Skeleton";
import { divisionMeta } from "@/lib/utils";

export default function PortfolioDashboard() {
  const { projects, user, bootLoading } = useApp();
  const meta = divisionMeta(user?.division);

  const mine = projects.filter((p) => p.division === user?.division);
  const others = projects.filter((p) => p.division !== user?.division);

  if (bootLoading && projects.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Portfolio</h1>
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {meta.label} view · strategic and CGEIT tags shown on every project.
        </p>
      </div>

      {mine.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {meta.label} projects
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((p) => (
              <ProjectCard key={p.id} project={p} showTags />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {mine.length > 0 ? "Rest of portfolio" : "All projects"}
        </h2>
        {others.length === 0 && mine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-600 dark:text-slate-400">
            No projects cached yet — connect once to load the portfolio.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map((p) => (
              <ProjectCard key={p.id} project={p} showTags />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
