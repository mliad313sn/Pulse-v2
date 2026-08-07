"use client";

// Newest-first project updates feed. Renders the cached rows (hydrated from
// bootstrap) instantly, then refreshes the full list live when online.

import { useEffect, useMemo, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import type { ProjectUpdate, UpdateMood } from "@/lib/types";
import { cn, isUpdateStale, relativeAgo, UPDATE_MOOD_META } from "@/lib/utils";
import EmptyState from "./EmptyState";
import { AlertIcon, AlertOctagonIcon, ArrowUpIcon, MinusIcon } from "./Icons";

const MOOD_ICONS: Record<UpdateMood, (props: { className?: string }) => ReactNode> = {
  POSITIVE: ArrowUpIcon,
  NEUTRAL: MinusIcon,
  CONCERN: AlertIcon,
  CRITICAL: AlertOctagonIcon,
};

function ExtraField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="font-medium text-slate-500 dark:text-slate-400">{label}: </span>
      <span className="text-slate-700 dark:text-slate-200">{value}</span>
    </p>
  );
}

export default function UpdatesFeed({ projectId }: { projectId: string }) {
  const { updates, users, online, fetchProjectUpdates } = useApp();

  // Refresh the full feed live on mount / reconnect (bootstrap only carries ~20).
  useEffect(() => {
    void fetchProjectUpdates(projectId);
  }, [projectId, online, fetchProjectUpdates]);

  const feed = useMemo(
    () =>
      updates
        .filter((u) => u.projectId === projectId)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [updates, projectId],
  );

  if (feed.length === 0) {
    return <EmptyState size="sm">No updates posted yet — be the first to share where this project stands.</EmptyState>;
  }

  return (
    <ol className="space-y-3">
      {feed.map((u: ProjectUpdate) => {
        const meta = UPDATE_MOOD_META[u.mood] ?? UPDATE_MOOD_META.NEUTRAL;
        const Icon = MOOD_ICONS[u.mood] ?? MinusIcon;
        const author = users.find((x) => x.id === u.authorId);
        const stale = isUpdateStale(u.createdAt);
        return (
          <li
            key={u.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  meta.badge,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </span>
              <span
                className={cn("text-xs", stale ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}
                title={u.createdAt ? new Date(u.createdAt).toLocaleString() : undefined}
              >
                {author ? `${author.name} · ` : ""}
                {relativeAgo(u.createdAt)}
              </span>
            </div>
            <p className="mt-2 leading-snug">{u.text}</p>
            {(u.accomplishment || u.nextStep || u.supportRequired) && (
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-700/60">
                <ExtraField label="Accomplishment" value={u.accomplishment} />
                <ExtraField label="Next step" value={u.nextStep} />
                <ExtraField label="Support required" value={u.supportRequired} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
