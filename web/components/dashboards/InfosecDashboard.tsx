"use client";

// InfoSec — pending approvals queue first, then gated projects.

import { useApp } from "@/lib/store";
import ApprovalsQueue from "@/components/ApprovalsQueue";
import ProjectCard from "@/components/ProjectCard";
import { PageHeader, SectionHeader } from "@/components/Headings";

export default function InfosecDashboard() {
  const { projects, canDecide } = useApp();
  const gated = projects.filter((p) => p.securityGateStatus !== "not_required");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Security review"
        subtitle="Network-altering work routes here for approval before it can progress."
      />

      <ApprovalsQueue canDecide={canDecide} />

      {gated.length > 0 && (
        <section className="mt-10">
          <SectionHeader>Projects with security gates</SectionHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {gated.map((p) => (
              <ProjectCard key={p.id} project={p} showTags />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
