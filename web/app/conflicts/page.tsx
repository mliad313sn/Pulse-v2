"use client";

// Manual merge queue — side-by-side local vs server, pick per-field or accept server.

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { fmtDateTime, titleCaseTag } from "@/lib/utils";
import { MergeIcon } from "@/components/Icons";
import type { ConflictEntry } from "@/lib/types";

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function ConflictCard({ entry }: { entry: ConflictEntry }) {
  const { resolveConflict, tasks, projects, roadblocks } = useApp();
  const [choices, setChoices] = useState<Record<string, "local" | "server">>(() =>
    Object.fromEntries(Object.keys(entry.fields).map((f) => [f, "local"])),
  );
  const [busy, setBusy] = useState(false);

  const label = useMemo(() => {
    if (entry.entity === "task") return tasks.find((t) => t.id === entry.entityId)?.title ?? "Task";
    if (entry.entity === "project") return projects.find((p) => p.id === entry.entityId)?.name ?? "Project";
    const rb = roadblocks.find((r) => r.id === entry.entityId);
    return rb ? `Roadblock: ${rb.description.slice(0, 60)}` : "Roadblock";
  }, [entry, tasks, projects, roadblocks]);

  const fields = Object.keys(entry.fields);
  const anyLocal = fields.some((f) => choices[f] === "local");

  const apply = async () => {
    setBusy(true);
    const localFields = Object.fromEntries(
      fields.filter((f) => choices[f] === "local").map((f) => [f, entry.fields[f]]),
    );
    await resolveConflict(entry.opId, anyLocal ? localFields : "server");
    setBusy(false);
  };

  const acceptServer = async () => {
    setBusy(true);
    await resolveConflict(entry.opId, "server");
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-amber-300 bg-white p-5 dark:border-amber-700 dark:bg-slate-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {label}
          <span className="ml-2 text-xs font-normal uppercase tracking-wide text-slate-400">{entry.entity}</span>
        </h3>
        <span className="text-xs text-slate-400">Your edit: {fmtDateTime(entry.clientUpdatedAt)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-4 font-medium">Field</th>
              <th className="pb-2 pr-4 font-medium">Your change (offline)</th>
              <th className="pb-2 font-medium">Server version (newer)</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2.5 pr-4 font-medium capitalize">{titleCaseTag(field)}</td>
                <td className="py-2.5 pr-4">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 transition has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-slate-600 dark:has-[:checked]:bg-indigo-950/40">
                    <input
                      type="radio"
                      name={`${entry.opId}-${field}`}
                      checked={choices[field] === "local"}
                      onChange={() => setChoices((c) => ({ ...c, [field]: "local" }))}
                      className="accent-indigo-600"
                    />
                    <span className="break-all">{fmtValue(entry.fields[field])}</span>
                  </label>
                </td>
                <td className="py-2.5">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 transition has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-slate-600 dark:has-[:checked]:bg-indigo-950/40">
                    <input
                      type="radio"
                      name={`${entry.opId}-${field}`}
                      checked={choices[field] === "server"}
                      onChange={() => setChoices((c) => ({ ...c, [field]: "server" }))}
                      className="accent-indigo-600"
                    />
                    <span className="break-all">{fmtValue(entry.serverState[field])}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply()}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {anyLocal ? "Apply selection" : "Confirm server values"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void acceptServer()}
          className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
        >
          Accept server
        </button>
      </div>
    </div>
  );
}

export default function ConflictsPage() {
  const { conflicts } = useApp();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <MergeIcon className="h-6 w-6 text-amber-500" />
          Manual merge
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          These offline edits collided with newer server changes. Pick the value to keep for each field.
        </p>
      </div>

      {conflicts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-600 dark:text-slate-400">
          Nothing to merge — all changes are in sync.
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map((entry) => (
            <ConflictCard key={entry.opId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
