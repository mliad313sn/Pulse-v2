"use client";

// InfoSec approvals queue — decisions restricted to security reviewers.

import { useApp } from "@/lib/store";
import ApprovalsQueue from "@/components/ApprovalsQueue";

export default function ApprovalsPage() {
  const { user } = useApp();
  if (!user) return null;

  const canDecide = user.division === "infosec" || user.role === "security_reviewer";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Security approvals</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {canDecide
            ? "Approve or reject network-altering work. Decisions update project security gates instantly."
            : "Read-only view — only InfoSec security reviewers can resolve approvals."}
        </p>
      </div>
      <ApprovalsQueue canDecide={canDecide} />
    </div>
  );
}
