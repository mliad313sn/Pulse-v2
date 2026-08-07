"use client";

// War Room — governance view for a project: lifecycle stage stepper, gate
// requirement checklist, gate approval requests/decisions, the immutable
// approval ledger, and the operating status control.
//
// Lifecycle stage changes happen ONLY through gates (no direct stage PATCH).
// All governance mutations are ONLINE-ONLY (like approvals) and the gate
// state + ledger are fetched live — offline shows an EmptyState instead.

import { use, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { useProjectMembers } from "@/lib/orgData";
import {
  decideGateRequest,
  gateErrorMessage,
  missingRequirementLabels,
  requestGateApproval,
  useGates,
  useLedger,
} from "@/lib/governance";
import {
  canManageProject,
  cn,
  fmtDateTime,
  hasSteering,
  LIFECYCLE_META,
  LIFECYCLE_STAGES,
  OPERATING_STATUS_META,
} from "@/lib/utils";
import { PageHeader, SectionHeader } from "@/components/Headings";
import EmptyState from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { Dialog, DialogActions, Field, FormError, Select, TextArea } from "@/components/Dialog";
import {
  GateDecisionPill,
  LifecycleChip,
  OperatingStatusBadge,
  Pill,
  ProjectCodeChip,
  SteeringPill,
} from "@/components/Badges";
import { CheckIcon, ChevronRightIcon, LockIcon, ScaleIcon, XIcon } from "@/components/Icons";
import type { GateStatus, LifecycleStage, OperatingStatus, Project } from "@/lib/types";

// ---- stage stepper ----------------------------------------------------------

function StageStepper({ stage }: { stage: LifecycleStage }) {
  const currentIdx = LIFECYCLE_STAGES.indexOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-y-3">
      {LIFECYCLE_STAGES.map((s, i) => {
        const meta = LIFECYCLE_META[s];
        const done = i < currentIdx;
        const current = i === currentIdx;
        return (
          <li key={s} className="flex items-center">
            {i > 0 && (
              <span
                className={cn(
                  "mx-1.5 h-0.5 w-4 rounded-full sm:w-7",
                  done || current ? "bg-indigo-400 dark:bg-indigo-500" : "bg-slate-200 dark:bg-slate-700",
                )}
              />
            )}
            <span className="flex flex-col items-center gap-1" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                  done &&
                    "border-indigo-500 bg-indigo-500 text-white dark:border-indigo-500 dark:bg-indigo-500",
                  current && cn("border-transparent text-white ring-2 ring-indigo-300 dark:ring-indigo-700", meta.dot),
                  !done && !current && "border-slate-300 text-slate-400 dark:border-slate-600",
                )}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wide",
                  current ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500",
                )}
              >
                {meta.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---- gate requirements + request --------------------------------------------

function GatePanel({
  project,
  gates,
  canManage,
  onChanged,
}: {
  project: Project;
  gates: GateStatus;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const { user, users, online, canWrite, refresh } = useApp();
  const { push: toast } = useToast();
  const [note, setNote] = useState("");
  const [dispositionNote, setDispositionNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missing = gates.requirements.filter((r) => !r.satisfied);
  const pending = gates.pendingRequest ?? null;
  const steering = hasSteering(user);
  // Server enforces the real authority rules — this only shows/hides affordances.
  const canDecideHere = canWrite && (canManage || steering);
  const requestDisabledReason = !online
    ? "Gate requests need a live connection."
    : pending
      ? "A gate request is already pending."
      : missing.length > 0
        ? "All requirements must be satisfied first."
        : null;

  const submitRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("request");
    setError(null);
    try {
      await requestGateApproval(project.id, {
        note: note.trim() || undefined,
        dispositionNote: gates.gate === "G5" ? dispositionNote.trim() || undefined : undefined,
      });
      setNote("");
      setDispositionNote("");
      toast("Gate approval requested.", "success");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === "GATE_REQUIREMENTS_NOT_MET") {
        const labels = missingRequirementLabels(err.detail);
        setError(
          labels.length > 0
            ? `Requirements not met: ${labels.join(", ")}.`
            : "Gate requirements are not met yet.",
        );
        await onChanged(); // checklist drifted — re-sync with the server
      } else {
        setError(gateErrorMessage(err, "Cannot reach the server — request not submitted."));
      }
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    if (!pending?.id || busy) return;
    setBusy(decision);
    setError(null);
    try {
      await decideGateRequest(pending.id, decision, decisionNote.trim() || undefined);
      setDecisionNote("");
      toast(
        decision === "APPROVED" ? "Gate approved — stage advanced." : "Gate request rejected.",
        "success",
      );
      // Approval moves lifecycleStage server-side — re-read the project too.
      await Promise.all([onChanged(), refresh()]);
    } catch (err) {
      setError(gateErrorMessage(err, "Cannot reach the server — decision not recorded."));
    } finally {
      setBusy(null);
    }
  };

  const requester = pending?.requestedBy ? users.find((u) => u.id === pending.requestedBy) : null;

  if (!gates.nextStage || !gates.gate) {
    return (
      <EmptyState size="sm">
        This project is at the final lifecycle stage — there are no further gates.
      </EmptyState>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="border border-indigo-300 bg-indigo-50 font-mono text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
          Gate {gates.gate}
        </Pill>
        <span className="flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300">
          {LIFECYCLE_META[gates.stage]?.label ?? gates.stage}
          <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          {LIFECYCLE_META[gates.nextStage]?.label ?? gates.nextStage}
        </span>
        {gates.steeringRequired && <SteeringPill />}
      </div>

      {/* requirement checklist */}
      <ul className="mt-4 space-y-2">
        {gates.requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-2.5 text-sm">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                r.satisfied
                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400"
                  : "bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-400",
              )}
            >
              {r.satisfied ? <CheckIcon className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
            </span>
            <span className="min-w-0">
              <span className={cn("font-medium", !r.satisfied && "text-rose-700 dark:text-rose-300")}>
                {r.label}
              </span>
              {r.detail && <span className="block text-xs text-slate-400">{r.detail}</span>}
            </span>
          </li>
        ))}
        {gates.requirements.length === 0 && (
          <li className="text-sm text-slate-400">No requirements defined for this gate.</li>
        )}
      </ul>

      {/* pending request banner OR request form */}
      {pending ? (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/30">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Gate approval requested
            {gates.steeringRequired && <SteeringPill className="ml-2 align-middle" />}
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {requester ? `By ${requester.name}` : pending.requestedBy ? `By ${pending.requestedBy}` : "Requested"}
            {pending.requestedAt ? ` · ${fmtDateTime(pending.requestedAt)}` : ""}
          </p>
          {pending.note && (
            <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">“{pending.note}”</p>
          )}
          {pending.dispositionNote && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Disposition: {pending.dispositionNote}
            </p>
          )}
          {canDecideHere && (
            <>
              <input
                type="text"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Decision note (optional)"
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!online || busy !== null}
                  onClick={() => void decide("APPROVED")}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckIcon className="h-4 w-4" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={!online || busy !== null}
                  onClick={() => void decide("REJECTED")}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                >
                  <XIcon className="h-4 w-4" />
                  Reject
                </button>
              </div>
              {gates.steeringRequired && !steering && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <ScaleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This gate requires Steering Committee authority — the server will reject decisions
                  from non-steering members.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      ) : canManage ? (
        <form onSubmit={(e) => void submitRequest(e)} className="mt-5 space-y-3" noValidate>
          <TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Request note (optional)"
          />
          {gates.gate === "G5" && (
            <Field
              label="Disposition note"
              htmlFor="gate-disposition"
              hint="G5 closure — record the final disposition of the project."
            >
              <TextArea
                id="gate-disposition"
                rows={2}
                value={dispositionNote}
                onChange={(e) => setDispositionNote(e.target.value)}
              />
            </Field>
          )}
          <FormError error={error} />
          <button
            type="submit"
            disabled={busy !== null || requestDisabledReason !== null}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "request" ? "Requesting…" : `Request gate ${gates.gate} approval`}
          </button>
          {requestDisabledReason && (
            <div className="text-xs text-slate-400">
              <p>{requestDisabledReason}</p>
              {online && missing.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {missing.map((r) => (
                    <li key={r.key}>{r.label}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      ) : (
        <p className="mt-5 text-xs text-slate-400">
          Only the PM, a division lead, or an admin can request gate approval.
        </p>
      )}
    </div>
  );
}

// ---- operating status control ----------------------------------------------

const OPERATING_CHOICES: OperatingStatus[] = ["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"];

function OperatingStatusControl({ project, canManage }: { project: Project; canManage: boolean }) {
  const { online, upsertProject, refresh } = useApp();
  const { push: toast } = useToast();
  const [reasonFor, setReasonFor] = useState<"ON_HOLD" | "CANCELLED" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = project.operatingStatus ?? "NOT_STARTED";

  const apply = async (status: OperatingStatus, reasonText?: string) => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { operatingStatus: status, version: project.version };
    if (status === "ON_HOLD") body.holdReason = reasonText;
    if (status === "CANCELLED") body.cancelReason = reasonText;
    try {
      const res = await api<unknown>(`/api/projects/${project.id}`, { method: "PATCH", body });
      if (res && typeof res === "object" && typeof (res as { id?: unknown }).id === "string") {
        upsertProject(res as Project);
      } else {
        await refresh();
      }
      toast(`Operating status set to ${OPERATING_STATUS_META[status].label}.`, "success");
      setReasonFor(null);
      setReason("");
      return true;
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message || `Status change rejected (${e.code}).`
          : "Cannot reach the server — status not changed.";
      if (reasonFor) setError(msg);
      else toast(msg, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSelect = (status: OperatingStatus) => {
    if (status === current) return;
    if (status === "ON_HOLD" || status === "CANCELLED") {
      setReason("");
      setError(null);
      setReasonFor(status);
      return;
    }
    void apply(status);
  };

  const submitReason = async (e: FormEvent) => {
    e.preventDefault();
    if (!reasonFor || busy) return;
    if (!reason.trim()) {
      setError(reasonFor === "ON_HOLD" ? "A hold reason is required." : "A cancellation reason is required.");
      return;
    }
    await apply(reasonFor, reason.trim());
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Operating status</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Separate from the lifecycle stage — hold and cancel require a reason.
          </p>
        </div>
        <OperatingStatusBadge status={current} />
      </div>
      {project.operatingStatus === "ON_HOLD" && project.holdReason && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">On hold: {project.holdReason}</p>
      )}
      {project.operatingStatus === "CANCELLED" && project.cancelReason && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">Cancelled: {project.cancelReason}</p>
      )}
      {canManage && (
        <div className="mt-4">
          <Select
            aria-label="Change operating status"
            value={current}
            disabled={!online || busy}
            onChange={(e) => onSelect(e.target.value as OperatingStatus)}
          >
            {current === "NOT_STARTED" && (
              <option value="NOT_STARTED" disabled>
                {OPERATING_STATUS_META.NOT_STARTED.label}
              </option>
            )}
            {OPERATING_CHOICES.map((s) => (
              <option key={s} value={s}>
                {OPERATING_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          {!online && (
            <p className="mt-2 text-xs text-slate-400">Status changes need a live connection.</p>
          )}
        </div>
      )}

      {reasonFor && (
        <Dialog
          title={reasonFor === "ON_HOLD" ? "Put project on hold" : "Cancel project"}
          subtitle={project.name}
          onClose={() => setReasonFor(null)}
        >
          <form onSubmit={(e) => void submitReason(e)} noValidate className="space-y-4">
            <Field
              label={reasonFor === "ON_HOLD" ? "Hold reason" : "Cancellation reason"}
              htmlFor="os-reason"
              hint="Required — recorded on the project for governance."
            >
              <TextArea
                id="os-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <FormError error={error} />
            <DialogActions
              submitLabel={reasonFor === "ON_HOLD" ? "Put on hold" : "Cancel project"}
              submitting={busy}
              disabled={!online}
              onCancel={() => setReasonFor(null)}
              danger={reasonFor === "CANCELLED"}
            />
          </form>
        </Dialog>
      )}
    </div>
  );
}

// ---- page -------------------------------------------------------------------

export default function GovernancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, users, user, online, bootLoading } = useApp();
  const { members } = useProjectMembers(id);
  const { gates, loading: gatesLoading, reload: reloadGates } = useGates(id);
  const { entries: ledger, loading: ledgerLoading, reload: reloadLedger } = useLedger(id);

  const project = projects.find((p) => p.id === id);
  const canManage = useMemo(
    () => canManageProject(user, project, members),
    [user, project, members],
  );

  const onGateChanged = async () => {
    await Promise.all([reloadGates(), reloadLedger()]);
  };

  if (!project) {
    return (
      <div className="py-10">
        {bootLoading ? (
          <SkeletonList count={3} />
        ) : (
          <EmptyState size="bare">
            <p className="font-medium">Project not found in the local cache.</p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              Back to dashboard
            </Link>
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <PageHeader
          className="items-start"
          innerClassName="min-w-0"
          title="War Room"
          subtitle={
            <>
              Governance for <span className="font-medium text-slate-700 dark:text-slate-200">{project.name}</span>
              {" — stage gates, approvals, and the immutable decision ledger."}
            </>
          }
          action={
            <Link
              href={`/projects/${project.id}`}
              className="flex min-h-[44px] items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
            >
              Back to project
            </Link>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ProjectCodeChip code={project.code} />
          <LifecycleChip stage={project.lifecycleStage} />
          <OperatingStatusBadge status={project.operatingStatus} />
        </div>
      </header>

      <section>
        <SectionHeader>Lifecycle stage</SectionHeader>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <StageStepper stage={project.lifecycleStage ?? "IDEA"} />
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
            <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Stage changes happen only through gate approvals below — there is no direct edit.
          </p>
        </div>
      </section>

      <section>
        <SectionHeader>Next gate</SectionHeader>
        {!online ? (
          <EmptyState size="md">
            Gate status needs a live connection — reconnect to see requirements and requests.
          </EmptyState>
        ) : gatesLoading && !gates ? (
          <SkeletonList count={1} />
        ) : gates ? (
          <GatePanel project={project} gates={gates} canManage={canManage} onChanged={onGateChanged} />
        ) : (
          <EmptyState size="md">Gate status is unavailable right now — try again shortly.</EmptyState>
        )}
      </section>

      <section>
        <SectionHeader>Approval ledger</SectionHeader>
        {!online ? (
          <EmptyState size="md">The approval ledger needs a live connection.</EmptyState>
        ) : ledgerLoading && ledger.length === 0 ? (
          <SkeletonList count={2} />
        ) : ledger.length === 0 ? (
          <EmptyState size="md">No gate decisions recorded yet.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                    <th className="px-4 py-3 font-semibold">Gate</th>
                    <th className="px-4 py-3 font-semibold">Transition</th>
                    <th className="px-4 py-3 font-semibold">Decision</th>
                    <th className="px-4 py-3 font-semibold">Authority</th>
                    <th className="px-4 py-3 font-semibold">Decided</th>
                    <th className="px-4 py-3 font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {ledger.map((e) => {
                    const decider = e.decidedBy ? users.find((u) => u.id === e.decidedBy) : null;
                    return (
                      <tr key={e.id}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{e.gate ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {LIFECYCLE_META[e.fromStage]?.label ?? e.fromStage}
                          {" → "}
                          {LIFECYCLE_META[e.toStage]?.label ?? e.toStage}
                        </td>
                        <td className="px-4 py-3">
                          <GateDecisionPill decision={e.decision} />
                        </td>
                        <td className="px-4 py-3">
                          {e.authorityType?.toLowerCase().includes("steering") ? (
                            <SteeringPill />
                          ) : (
                            <span className="text-xs capitalize text-slate-500 dark:text-slate-400">
                              {(e.authorityType || "—").replace(/_/g, " ").toLowerCase()}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {decider?.name ?? e.decidedBy ?? "—"}
                          <span className="block text-slate-400 dark:text-slate-500">
                            {fmtDateTime(e.decidedAt)}
                          </span>
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {e.note || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="flex items-start gap-1.5 border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-700/60">
              <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Immutable record — ledger entries are append-only and cannot be edited or deleted.
            </p>
          </div>
        )}
      </section>

      <section>
        <SectionHeader>Operating status</SectionHeader>
        <OperatingStatusControl project={project} canManage={canManage} />
      </section>
    </div>
  );
}
