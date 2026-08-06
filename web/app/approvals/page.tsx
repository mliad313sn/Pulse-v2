"use client";

// InfoSec approvals queue — decisions restricted to security reviewers.

import { useApp } from "@/lib/store";
import ApprovalsQueue from "@/components/ApprovalsQueue";
import { PageHeader } from "@/components/Headings";
import { canDecideApprovals } from "@/lib/utils";

export default function ApprovalsPage() {
  const { user } = useApp();
  if (!user) return null;

  const canDecide = canDecideApprovals(user);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Security approvals"
        subtitle={
          canDecide
            ? "Approve or reject network-altering work. Decisions update project security gates instantly."
            : "Read-only view — only InfoSec security reviewers can resolve approvals."
        }
      />
      <ApprovalsQueue canDecide={canDecide} />
    </div>
  );
}
