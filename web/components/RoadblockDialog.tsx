"use client";

// Wave 4 roadblock detail/edit dialog — 5-state forward-only lifecycle.
// Edit: owner, due date, impact, resolution approach (offline-capable — outbox).
// Resolve requires a resolutionNote; Verify is authz-gated; Reopen needs a
// ≥10-char reason; Escalate is one-click + confirm, ONLINE-ONLY, and hidden
// once resolved/verified (the reopen hint shows instead).

import { useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import {
  canManageProject,
  cn,
  fmtDateTime,
  isRoadblockClosed,
  ROADBLOCK_NEXT,
  ROADBLOCK_REOPEN_MIN,
  ROADBLOCK_STATUS_META,
} from "@/lib/utils";
import type { Project, Roadblock } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import { EscalatedBadge, RoadblockStatusBadge, SeverityBadge } from "./Badges";
import { FlameIcon } from "./Icons";

/** ISO datetime → yyyy-mm-dd for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

type Mode = "edit" | "resolve" | "reopen";

export default function RoadblockDialog({
  roadblock,
  project,
  onClose,
}: {
  roadblock: Roadblock;
  project: Project;
  onClose: () => void;
}) {
  const { user, users, online, canWrite, updateRoadblock, escalateRoadblock, convertRoadblockToCapa } = useApp();
  const { push: toast } = useToast();
  const [mode, setMode] = useState<Mode>("edit");
  const [ownerId, setOwnerId] = useState(roadblock.ownerId ?? "");
  const [dueDate, setDueDate] = useState(toDateInput(roadblock.dueDate));
  const [impact, setImpact] = useState(roadblock.impact ?? "");
  const [resolutionApproach, setResolutionApproach] = useState(roadblock.resolutionApproach ?? "");
  const [resolutionNote, setResolutionNote] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [confirmEscalate, setConfirmEscalate] = useState(false);
  const [converting, setConverting] = useState(false);

  const closed = isRoadblockClosed(roadblock.status);
  // Verify authz: managers of the project (ADMIN / DIVISION_LEAD / PM) — server enforces.
  const canVerify = canWrite && canManageProject(user, project);
  const next = ROADBLOCK_NEXT[roadblock.status];
  const owners = [...users].filter((u) => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name));

  const finish = (queued?: boolean, message = "Roadblock updated.") => {
    toast(queued ? "Change saved offline — will sync when back online." : message, queued ? "info" : "success");
    onClose();
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await updateRoadblock(roadblock.id, {
      ownerId: ownerId || null,
      dueDate: dueDate || null,
      impact: impact.trim() || null,
      resolutionApproach: resolutionApproach.trim() || null,
    });
    setBusy(false);
    if (res.ok) finish(res.queued);
    else setError(res.message || "The change was not saved.");
  };

  const advance = async () => {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    const res = await updateRoadblock(roadblock.id, { status: next.next });
    setBusy(false);
    if (res.ok) finish(res.queued, `Roadblock ${ROADBLOCK_STATUS_META[next.next].label.toLowerCase()}.`);
    else setError(res.message || "The status change was refused.");
  };

  const resolve = async (e: FormEvent) => {
    e.preventDefault();
    const note = resolutionNote.trim();
    if (!note) {
      setError("A resolution note is required to mark this resolved.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateRoadblock(roadblock.id, { status: "RESOLVED", resolutionNote: note });
    setBusy(false);
    if (res.ok) finish(res.queued, "Roadblock resolved.");
    else setError(res.message || "The roadblock was not resolved.");
  };

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await updateRoadblock(roadblock.id, { status: "VERIFIED" });
    setBusy(false);
    if (res.ok) finish(res.queued, "Resolution verified.");
    else setError(res.message || "Verification was refused.");
  };

  const reopen = async (e: FormEvent) => {
    e.preventDefault();
    const reason = reopenReason.trim();
    if (reason.length < ROADBLOCK_REOPEN_MIN) {
      setError(`The reopen reason must be at least ${ROADBLOCK_REOPEN_MIN} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateRoadblock(roadblock.id, { status: "RAISED", reopenReason: reason });
    setBusy(false);
    if (res.ok) finish(res.queued, "Roadblock reopened.");
    else setError(res.message || "The roadblock was not reopened.");
  };

  const escalate = async () => {
    if (escalating) return;
    setEscalating(true);
    setError(null);
    const res = await escalateRoadblock(roadblock.id);
    setEscalating(false);
    setConfirmEscalate(false);
    if (res.ok) onClose();
    else if (res.message) setError(res.message);
  };

  const convert = async () => {
    if (converting) return;
    setConverting(true);
    setError(null);
    const res = await convertRoadblockToCapa(roadblock.id);
    setConverting(false);
    if (res.ok) onClose();
    else if (res.message) setError(res.message);
  };

  const reporter = users.find((u) => u.id === roadblock.reportedBy);

  return (
    <Dialog
      title="Roadblock"
      subtitle={
        <>
          {project.name} · {reporter ? `reported by ${reporter.name} · ` : ""}
          {fmtDateTime(roadblock.createdAt || roadblock.updatedAt)}
        </>
      }
      onClose={onClose}
    >
      <p className="mb-3 leading-snug">{roadblock.description}</p>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={roadblock.severity} />
        <RoadblockStatusBadge status={roadblock.status} />
        {roadblock.escalated && <EscalatedBadge escalatedAt={roadblock.escalatedAt} />}
      </div>

      {roadblock.resolutionNote && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
          <span className="font-semibold">Resolution: </span>
          {roadblock.resolutionNote}
        </p>
      )}
      {roadblock.reopenReason && !closed && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <span className="font-semibold">Reopened: </span>
          {roadblock.reopenReason}
        </p>
      )}

      {!canWrite ? (
        <FormError error={error} />
      ) : mode === "resolve" ? (
        <form onSubmit={(e) => void resolve(e)} noValidate className="space-y-4">
          <Field
            label="Resolution note"
            htmlFor="rb-resolution"
            hint="Required — what fixed it, so the resolution can be verified."
          >
            <TextArea
              id="rb-resolution"
              rows={3}
              autoFocus
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="What was done to clear this roadblock?"
            />
          </Field>
          <FormError error={error} />
          <DialogActions
            submitLabel="Mark resolved"
            submitting={busy}
            disabled={!resolutionNote.trim()}
            onCancel={() => {
              setMode("edit");
              setError(null);
            }}
          />
        </form>
      ) : mode === "reopen" ? (
        <form onSubmit={(e) => void reopen(e)} noValidate className="space-y-4">
          <Field
            label="Reopen reason"
            htmlFor="rb-reopen"
            hint={`At least ${ROADBLOCK_REOPEN_MIN} characters — why the resolution did not hold. (${reopenReason.trim().length}/${ROADBLOCK_REOPEN_MIN})`}
          >
            <TextArea
              id="rb-reopen"
              rows={3}
              autoFocus
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Why is this roadblock back?"
            />
          </Field>
          <FormError error={error} />
          <DialogActions
            submitLabel="Reopen roadblock"
            submitting={busy}
            disabled={reopenReason.trim().length < ROADBLOCK_REOPEN_MIN}
            onCancel={() => {
              setMode("edit");
              setError(null);
            }}
            danger
          />
        </form>
      ) : (
        <form onSubmit={(e) => void saveEdit(e)} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" htmlFor="rb-owner">
              <Select id="rb-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Unassigned</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="rb-due">
              <TextInput id="rb-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Impact" htmlFor="rb-impact" hint="What this blocks and who feels it.">
            <TextArea
              id="rb-impact"
              rows={2}
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="e.g. Site go-live slips a week while access is blocked"
            />
          </Field>
          <Field label="Resolution approach" htmlFor="rb-approach" hint="How the owner plans to clear it.">
            <TextArea
              id="rb-approach"
              rows={2}
              value={resolutionApproach}
              onChange={(e) => setResolutionApproach(e.target.value)}
              placeholder="e.g. Raise firewall change with InfoSec, fallback to VPN"
            />
          </Field>

          <FormError error={error} />

          {/* Lifecycle actions — forward-only. */}
          <div className="flex flex-wrap gap-2">
            {next && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance()}
                className="flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-600 transition hover:border-slate-400 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
              >
                {next.label}
              </button>
            )}
            {!closed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode("resolve");
                  setError(null);
                }}
                className="flex min-h-[40px] items-center rounded-xl border border-emerald-300 px-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                Resolve…
              </button>
            )}
            {roadblock.status === "RESOLVED" && canVerify && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void verify()}
                className="flex min-h-[40px] items-center rounded-xl border border-teal-300 px-3 text-sm font-medium text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40"
              >
                Verify resolution
              </button>
            )}
            {closed && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("reopen");
                    setError(null);
                  }}
                  className="flex min-h-[40px] items-center rounded-xl border border-amber-300 px-3 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                >
                  Reopen…
                </button>
                <button
                  type="button"
                  disabled={converting || !online}
                  onClick={() => void convert()}
                  title={online ? "Create a CAPA prefilled from this roadblock" : "Converting to a CAPA needs a live connection"}
                  className="flex min-h-[40px] items-center rounded-xl border border-violet-300 px-3 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/40"
                >
                  {converting ? "Converting…" : "Convert to CAPA"}
                </button>
              </>
            )}
            {/* One-click escalation — ONLINE-ONLY; escalating a resolved/verified
                roadblock is a 400, so the button hides and the reopen hint shows. */}
            {!closed && !roadblock.escalated && (
              confirmEscalate ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={escalating || !online}
                    onClick={() => void escalate()}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:opacity-50"
                  >
                    <FlameIcon className="h-4 w-4" />
                    {escalating ? "Escalating…" : "Confirm escalation"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEscalate(false)}
                    className="flex min-h-[40px] items-center rounded-xl px-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/60"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => setConfirmEscalate(true)}
                  title={online ? "Escalate to leadership — one click, audited" : "Escalating needs a live connection"}
                  className={cn(
                    "flex min-h-[40px] items-center gap-1.5 rounded-xl border border-orange-300 px-3 text-sm font-medium text-orange-700 transition hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/40",
                    !online && "cursor-not-allowed opacity-50",
                  )}
                >
                  <FlameIcon className="h-4 w-4" />
                  Escalate
                </button>
              )
            )}
          </div>
          {closed && (
            <p className="text-xs text-slate-400">
              This roadblock is {ROADBLOCK_STATUS_META[roadblock.status].label.toLowerCase()} — it can no longer be
              escalated. Reopen it first if the problem is back.
            </p>
          )}
          <OfflineHint show={!online} what="Escalating or converting to a CAPA" />

          <DialogActions submitLabel="Save changes" submitting={busy} onCancel={onClose} />
        </form>
      )}
    </Dialog>
  );
}
