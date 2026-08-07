"use client";

// Milestones section on the project page — list + add/edit dialog + status
// quick-advance. Governance mutations are ONLINE-ONLY (like approvals).
// The GO_LIVE type gets a flag icon accent (see MilestoneTypeBadge).

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useProjectMembers } from "@/lib/orgData";
import {
  canManageProject,
  cn,
  fmtDate,
  isMilestoneSlipped,
  MILESTONE_NEXT,
  MILESTONE_TYPE_META,
  MILESTONE_TYPES,
} from "@/lib/utils";
import type { Milestone, MilestoneType, Project, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextInput } from "./Dialog";
import EmptyState from "./EmptyState";
import { CountPill, MilestoneStatusBadge, MilestoneTypeBadge } from "./Badges";
import { PlusIcon } from "./Icons";

interface MilestoneFormState {
  title: string;
  type: MilestoneType;
  ownerId: string;
  baselineDue: string;
  forecastDue: string;
  weight: string;
}

/** ISO datetime → yyyy-mm-dd for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function MilestoneDialog({
  project,
  users,
  editing,
  onClose,
}: {
  project: Project;
  users: User[];
  editing: Milestone | null;
  onClose: () => void;
}) {
  const { online, createMilestone, updateMilestone } = useApp();
  const [form, setForm] = useState<MilestoneFormState>({
    title: editing?.title ?? "",
    type: editing?.type ?? "STANDARD",
    ownerId: editing?.ownerId ?? "",
    baselineDue: toDateInput(editing?.baselineDue),
    forecastDue: toDateInput(editing?.forecastDue),
    weight: String(editing?.weight ?? 1),
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const owners = useMemo(
    () => [...users].filter((u) => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const title = form.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }
    const weight = Number(form.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Weight must be a positive number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const outcome = editing
      ? await updateMilestone(editing.id, {
          title,
          type: form.type,
          ownerId: form.ownerId || null,
          baselineDue: form.baselineDue || null,
          forecastDue: form.forecastDue || null,
          weight,
        })
      : await createMilestone({
          projectId: project.id,
          title,
          type: form.type,
          ownerId: form.ownerId || null,
          baselineDue: form.baselineDue || null,
          forecastDue: form.forecastDue || null,
          weight,
        });
    if (outcome.ok) {
      onClose();
    } else {
      // The store already toasts the specific server message.
      setError(editing ? "Milestone was not updated." : "Milestone was not created.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={editing ? "Edit milestone" : "New milestone"}
      subtitle={project.name}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Title" htmlFor="ms-title">
          <TextInput
            id="ms-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            autoFocus
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="ms-type">
            <Select
              id="ms-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as MilestoneType })}
            >
              {MILESTONE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MILESTONE_TYPE_META[t].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ms-owner">
            <Select
              id="ms-owner"
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Baseline due" htmlFor="ms-baseline" hint="Committed date — the fixed reference.">
            <TextInput
              id="ms-baseline"
              type="date"
              value={form.baselineDue}
              onChange={(e) => setForm({ ...form, baselineDue: e.target.value })}
            />
          </Field>
          <Field label="Forecast due" htmlFor="ms-forecast" hint="Current expectation — slips show amber.">
            <TextInput
              id="ms-forecast"
              type="date"
              value={form.forecastDue}
              onChange={(e) => setForm({ ...form, forecastDue: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Weight" htmlFor="ms-weight" hint="Relative contribution to the derived project progress.">
          <TextInput
            id="ms-weight"
            type="number"
            min={1}
            step={1}
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
            required
          />
        </Field>
        <FormError error={error} />
        <DialogActions
          submitLabel={editing ? "Save milestone" : "Add milestone"}
          submitting={submitting}
          disabled={!online}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Managing milestones" />
      </form>
    </Dialog>
  );
}

export default function Milestones({ project }: { project: Project }) {
  const { user, users, milestones, online, canWrite, updateMilestone } = useApp();
  const { members } = useProjectMembers(project.id);
  const [dialog, setDialog] = useState<{ editing: Milestone | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = canWrite && canManageProject(user, project, members);

  const list = useMemo(
    () =>
      milestones
        .filter((m) => m.projectId === project.id)
        .sort(
          (a, b) =>
            (a.baselineDue || "9999").localeCompare(b.baselineDue || "9999") ||
            a.title.localeCompare(b.title),
        ),
    [milestones, project.id],
  );
  const openCount = list.filter((m) => m.status !== "DONE" && m.status !== "CANCELLED").length;

  const advance = async (m: Milestone) => {
    const next = MILESTONE_NEXT[m.status];
    if (!next) return;
    setBusy(m.id);
    await updateMilestone(m.id, { status: next.next });
    setBusy(null);
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Milestones
          {openCount > 0 && <CountPill>{openCount} open</CountPill>}
        </h2>
        {canManage && (
          <button
            type="button"
            disabled={!online}
            onClick={() => setDialog({ editing: null })}
            title={online ? "Add a milestone" : "Managing milestones needs a live connection"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <PlusIcon className="h-4 w-4" />
            Add milestone
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState size="sm">
          No milestones yet — project progress stays unmeasured until the first one is added.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {list.map((m) => {
            const owner = m.ownerId ? users.find((u) => u.id === m.ownerId) : null;
            const slipped = isMilestoneSlipped(m);
            const next = MILESTONE_NEXT[m.status];
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800",
                  m.status === "CANCELLED" && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 font-medium leading-snug">{m.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MilestoneTypeBadge type={m.type} />
                    <MilestoneStatusBadge status={m.status} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{owner ? `Owner: ${owner.name}` : "Unowned"}</span>
                    <span>
                      Baseline{" "}
                      <span className="font-medium text-slate-500 dark:text-slate-300">
                        {fmtDate(m.baselineDue)}
                      </span>
                    </span>
                    <span className={cn(slipped && "font-semibold text-amber-600 dark:text-amber-400")}>
                      Forecast{" "}
                      <span className={cn("font-medium", slipped ? "" : "text-slate-500 dark:text-slate-300")}>
                        {fmtDate(m.forecastDue)}
                      </span>
                      {slipped && " · slipped"}
                    </span>
                    {m.actualCompleted && <span>Completed {fmtDate(m.actualCompleted)}</span>}
                    <span>Weight {m.weight}</span>
                  </span>
                  {canManage && (
                    <span className="flex items-center gap-1.5">
                      {next && (
                        <button
                          type="button"
                          disabled={!online || busy === m.id}
                          onClick={() => void advance(m)}
                          title={online ? undefined : "Milestone changes need a live connection"}
                          className="min-h-[36px] rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                        >
                          {next.label}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!online}
                        onClick={() => setDialog({ editing: m })}
                        className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                      >
                        Edit
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <MilestoneDialog
          project={project}
          users={users}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
