"use client";

// InfoSec — pending approvals queue first, then gated projects.

import { useApp } from "@/lib/store";
import ApprovalsQueue from "@/components/ApprovalsQueue";
import ProjectCard from "@/components/ProjectCard";

export default function InfosecDashboard() {
  const { projects } = useApp();
  const gated = projects.filter((p) => p.securityGateStatus !== "not_required");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Security review</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Network-altering work routes here for approval before it can progress.
        </p>
      </div>

      <ApprovalsQueue canDecide />

      {gated.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Projects with security gates
          </h2>
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
