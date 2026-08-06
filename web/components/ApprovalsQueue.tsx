"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { titleCaseTag, fmtDateTime } from "@/lib/utils";
import { CountPill, TagChip } from "./Badges";
import { CheckIcon, ShieldIcon, XIcon } from "./Icons";
import { SkeletonList } from "./Skeleton";
import EmptyState from "./EmptyState";
import { SectionHeader } from "./Headings";

export default function ApprovalsQueue({ canDecide }: { canDecide: boolean }) {
  const { approvals, projects, tasks, decideApproval, online, bootLoading, users } = useApp();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const pending = approvals.filter((a) => a.status === "pending");
  const reviewed = approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.reviewedAt || "").localeCompare(a.reviewedAt || ""))
    .slice(0, 6);

  if (bootLoading && approvals.length === 0) return <SkeletonList count={3} />;

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    await decideApproval(id, decision, notes[id]?.trim() || undefined);
    setBusy(null);
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldIcon className="h-5 w-5 text-rose-500" />
          Pending approvals
          <CountPill>{pending.length}</CountPill>
        </h2>

        {pending.length === 0 ? (
          <EmptyState size="md">Queue is clear — no security approvals waiting.</EmptyState>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => {
              const project = projects.find((p) => p.id === a.projectId);
              const task = a.taskId ? tasks.find((t) => t.id === a.taskId) : null;
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${a.projectId}`}
                        className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {project?.name ?? "Unknown project"}
                      </Link>
                      {task && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Task: {task.title}</p>}
                      <p className="mt-0.5 text-xs text-slate-400">Requested {fmtDateTime(a.requestedAt)}</p>
                    </div>
                    {a.riskTag && <TagChip tag={a.riskTag} tone="rose" />}
                  </div>

                  {canDecide && (
                    <>
                      <input
                        type="text"
                        value={notes[a.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                        placeholder="Review notes (optional)"
                        className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900"
                      />
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!online || busy === a.id}
                          onClick={() => void decide(a.id, "approved")}
                          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckIcon className="h-4 w-4" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={!online || busy === a.id}
                          onClick={() => void decide(a.id, "rejected")}
                          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                        >
                          <XIcon className="h-4 w-4" />
                          Reject
                        </button>
                      </div>
                      {!online && (
                        <p className="mt-2 text-xs text-slate-400">Approval decisions need a live connection.</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section>
          <SectionHeader>Recently reviewed</SectionHeader>
          <div className="space-y-2">
            {reviewed.map((a) => {
              const project = projects.find((p) => p.id === a.projectId);
              const reviewer = users.find((u) => u.id === a.reviewedBy);
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <span className="min-w-0 truncate">
                    {project?.name ?? "Unknown project"}
                    {a.riskTag ? ` · ${titleCaseTag(a.riskTag)}` : ""}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span
                      className={
                        a.status === "approved"
                          ? "font-semibold text-emerald-600 dark:text-emerald-400"
                          : "font-semibold text-rose-600 dark:text-rose-400"
                      }
                    >
                      {a.status}
                    </span>
                    {reviewer && <span>by {reviewer.name}</span>}
                    <span>{fmtDateTime(a.reviewedAt)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
