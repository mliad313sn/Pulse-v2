"use client";

// EA / Data / BizApps — portfolio list with strategic & CGEIT tags visible.

import { useApp } from "@/lib/store";
import ProjectCard from "@/components/ProjectCard";
import EmptyState from "@/components/EmptyState";
import { PageHeader, SectionHeader } from "@/components/Headings";
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
        <PageHeader title="Portfolio" />
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Portfolio"
        subtitle={`${meta.label} view · strategic and CGEIT tags shown on every project.`}
      />

      {mine.length > 0 && (
        <section className="mb-10">
          <SectionHeader>{meta.label} projects</SectionHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((p) => (
              <ProjectCard key={p.id} project={p} showTags />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader>{mine.length > 0 ? "Rest of portfolio" : "All projects"}</SectionHeader>
        {others.length === 0 && mine.length === 0 ? (
          <EmptyState>No projects cached yet — connect once to load the portfolio.</EmptyState>
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
