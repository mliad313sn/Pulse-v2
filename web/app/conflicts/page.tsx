"use client";

// Sync queue — the offline outbox made visible. The server applies queued ops
// in seq order and HALTS at the first failure: that op lands here as "Blocked"
// and nothing else syncs until the user merges / retries / discards it.
// "Waiting" lists the held ops read-only, in send order.

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { fmtDateTime, titleCaseTag } from "@/lib/utils";
import { AlertIcon, ClockIcon, MergeIcon } from "@/components/Icons";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/Headings";
import { Dialog, DialogActions, Field, OfflineHint, TextArea } from "@/components/Dialog";
import type { BlockedOp, QueuedOp, SyncEntity } from "@/lib/types";

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function useEntityLabel(entity: SyncEntity, entityId: string): string {
  const { tasks, projects, roadblocks } = useApp();
  return useMemo(() => {
    if (entity === "task") return tasks.find((t) => t.id === entityId)?.title ?? "Task";
    if (entity === "project") return projects.find((p) => p.id === entityId)?.name ?? "Project";
    const rb = roadblocks.find((r) => r.id === entityId);
    return rb ? `Roadblock: ${rb.description.slice(0, 60)}` : "Roadblock";
  }, [entity, entityId, tasks, projects, roadblocks]);
}

function reasonText(entry: BlockedOp): string {
  if (entry.message) return entry.message;
  switch (entry.error) {
    case "VERSION_CONFLICT":
      return "This change collided with a newer server version.";
    case "SECURITY_GATE":
      return "Security gate: the project is awaiting InfoSec approval, so this change was refused.";
    case "DEPENDENCY_LOCKED":
      return "Dependency lock: a prerequisite task is not done yet.";
    case "VALIDATION":
      return "The server rejected this change as invalid.";
    case "NOT_FOUND":
      return "The server no longer knows this record — it may have been deleted.";
    case "FORBIDDEN":
      return "Your role is not allowed to make this change.";
    default:
      return `The server refused this change${entry.error ? ` (${entry.error})` : ""}.`;
  }
}

const SECONDARY_BTN =
  "flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300";

function DiscardDialog({
  entry,
  label,
  onClose,
}: {
  entry: BlockedOp;
  label: string;
  onClose: () => void;
}) {
  const { discardBlocked, online } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      title="Discard queued change?"
      subtitle={
        <>
          The pending change to <strong>{label}</strong> will be dropped and recorded in the server
          audit log. Your local copy reverts to the server&apos;s version.
        </>
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setBusy(true);
            const res = await discardBlocked(entry.opId, reason.trim() || undefined);
            setBusy(false);
            if (res.ok) onClose();
          })();
        }}
      >
        <Field label="Reason (optional)" htmlFor="discard-reason" hint="Stored with the server-side audit entry.">
          <TextArea
            id="discard-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this change being dropped?"
          />
        </Field>
        <OfflineHint show={!online} what="Discarding a queued change" />
        <DialogActions submitLabel="Discard change" submitting={busy} disabled={!online} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

/** Blocked VERSION_CONFLICT — side-by-side per-field merge (mine vs server). */
function ConflictMerge({ entry, label }: { entry: BlockedOp; label: string }) {
  const { resolveBlockedMerge, discardBlocked, online } = useApp();
  const [choices, setChoices] = useState<Record<string, "local" | "server">>(() =>
    Object.fromEntries(Object.keys(entry.fields).map((f) => [f, "local"])),
  );
  const [busy, setBusy] = useState(false);

  const serverState = entry.serverState ?? {};
  const fields = Object.keys(entry.fields);
  const anyLocal = fields.some((f) => choices[f] === "local");

  const apply = async () => {
    setBusy(true);
    if (anyLocal) {
      const localFields = Object.fromEntries(
        fields.filter((f) => choices[f] === "local").map((f) => [f, entry.fields[f]]),
      );
      await resolveBlockedMerge(entry.opId, localFields);
    } else {
      // Nothing kept from the local edit — same as accepting the server (audited discard).
      await discardBlocked(entry.opId, "Accepted server version");
    }
    setBusy(false);
  };

  const acceptServer = async () => {
    setBusy(true);
    await discardBlocked(entry.opId, "Accepted server version");
    setBusy(false);
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-4 font-medium">Field</th>
              <th className="pb-2 pr-4 font-medium">Your change (queued)</th>
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
                    <span className="break-all">{fmtValue(serverState[field])}</span>
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
          disabled={busy || (!anyLocal && !online)}
          onClick={() => void apply()}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {anyLocal ? "Apply selection" : "Confirm server values"}
        </button>
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => void acceptServer()}
          className={SECONDARY_BTN}
          title={online ? undefined : "Accepting the server version records an audited discard — it needs a live connection."}
        >
          Accept server
        </button>
      </div>
      <OfflineHint show={!online} what="Accepting the server version (an audited discard)" />
      <p className="mt-2 text-xs text-slate-400">
        Applying a selection re-queues this change on the latest server version, then sync resumes.
      </p>
    </>
  );
}

/** Blocked for a non-conflict reason (gate violation, validation, not found…). */
function BlockedReason({ entry, label }: { entry: BlockedOp; label: string }) {
  const { retryBlocked, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const retry = async () => {
    setBusy(true);
    await retryBlocked(entry.opId);
    setBusy(false);
  };

  return (
    <>
      <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
        {reasonText(entry)}
      </p>
      <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        Queued change:{" "}
        {Object.keys(entry.fields).map((f, i) => (
          <span key={f}>
            {i > 0 && ", "}
            <span className="font-medium capitalize text-slate-700 dark:text-slate-200">{titleCaseTag(f)}</span>
            {" → "}
            {fmtValue(entry.fields[f])}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          title="Send it again as-is — useful once the gate/approval situation has changed."
        >
          Retry
        </button>
        <button type="button" disabled={busy} onClick={() => setDiscardOpen(true)} className={SECONDARY_BTN}>
          Discard…
        </button>
      </div>
      <OfflineHint show={!online} what="Discarding a queued change" />
      {discardOpen && <DiscardDialog entry={entry} label={label} onClose={() => setDiscardOpen(false)} />}
    </>
  );
}

function BlockedCard({ entry }: { entry: BlockedOp }) {
  const label = useEntityLabel(entry.entity, entry.entityId);
  const isConflict = entry.error === "VERSION_CONFLICT" && entry.serverState != null;

  return (
    <div className="rounded-2xl border border-rose-300 bg-white p-5 dark:border-rose-700 dark:bg-slate-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {label}
          <span className="ml-2 text-xs font-normal uppercase tracking-wide text-slate-400">{entry.entity}</span>
        </h3>
        <span className="text-xs text-slate-400">
          #{entry.seq} · your edit {fmtDateTime(entry.clientUpdatedAt)}
        </span>
      </div>
      {isConflict ? <ConflictMerge entry={entry} label={label} /> : <BlockedReason entry={entry} label={label} />}
    </div>
  );
}

function WaitingRow({ op }: { op: QueuedOp }) {
  const label = useEntityLabel(op.entity, op.entityId);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800">
      <span className="font-mono text-xs text-slate-400">#{op.seq}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">
          {op.entity} · {op.op}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
          {Object.keys(op.fields).map(titleCaseTag).join(", ") || "No field changes"}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <ClockIcon className="h-3.5 w-3.5" />
        {fmtDateTime(new Date(op.queuedAt).toISOString())}
      </span>
    </li>
  );
}

export default function SyncQueuePage() {
  const { blocked, queuedOps } = useApp();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titleClassName="flex items-center gap-2"
        title={
          <>
            <MergeIcon className="h-6 w-6 text-indigo-500" />
            Sync queue
          </>
        }
        subtitle="Offline changes sync to the server in order. If the server refuses one, the queue halts until you decide what to do with it."
      />

      {blocked.length === 0 && queuedOps.length === 0 ? (
        <EmptyState>Queue is empty — all changes are in sync.</EmptyState>
      ) : (
        <div className="space-y-8">
          {blocked.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                <AlertIcon className="h-4 w-4" />
                Blocked — action needed
              </h2>
              <div className="space-y-4">
                {blocked.map((entry) => (
                  <BlockedCard key={entry.opId} entry={entry} />
                ))}
              </div>
            </section>
          )}

          {queuedOps.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Waiting ({queuedOps.length})
              </h2>
              {blocked.length > 0 && (
                <p className="mb-3 text-xs text-slate-400">
                  These changes are held in order and will sync automatically once the blocked change
                  above is resolved.
                </p>
              )}
              <ul className="space-y-2">
                {queuedOps.map((op) => (
                  <WaitingRow key={op.opId} op={op} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
