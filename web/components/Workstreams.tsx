"use client";

// Workstreams section on the project page — cards (title, lead, status, dates,
// task count) + add/edit dialog. Planning mutations are ONLINE-ONLY (like
// milestones) — they never touch the offline outbox.

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useProjectMembers } from "@/lib/orgData";
import {
  canManageProject,
  cn,
  fmtDate,
  WORKSTREAM_STATUS_META,
  WORKSTREAM_STATUSES,
} from "@/lib/utils";
import type { Project, User, Workstream, WorkstreamStatus } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import EmptyState from "./EmptyState";
import { CountPill, WorkstreamStatusBadge } from "./Badges";
import { PlusIcon } from "./Icons";

interface WorkstreamFormState {
  title: string;
  description: string;
  leadId: string;
  startDate: string;
  endDate: string;
  status: WorkstreamStatus;
}

/** ISO datetime → yyyy-mm-dd for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function WorkstreamDialog({
  project,
  users,
  editing,
  onClose,
}: {
  project: Project;
  users: User[];
  editing: Workstream | null;
  onClose: () => void;
}) {
  const { online, createWorkstream, updateWorkstream } = useApp();
  const [form, setForm] = useState<WorkstreamFormState>({
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    leadId: editing?.leadId ?? "",
    startDate: toDateInput(editing?.startDate),
    endDate: toDateInput(editing?.endDate),
    status: editing?.status ?? "NOT_STARTED",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const leads = useMemo(
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
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setError("End date cannot be before the start date.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const fields = {
      title,
      description: form.description.trim() || null,
      leadId: form.leadId || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: form.status,
    };
    const outcome = editing
      ? await updateWorkstream(editing.id, fields)
      : await createWorkstream({ projectId: project.id, ...fields });
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.message || (editing ? "Workstream was not updated." : "Workstream was not created."));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={editing ? "Edit workstream" : "New workstream"}
      subtitle={project.name}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Title" htmlFor="ws-title">
          <TextInput
            id="ws-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            autoFocus
            required
          />
        </Field>
        <Field label="Description" htmlFor="ws-desc">
          <TextArea
            id="ws-desc"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead" htmlFor="ws-lead">
            <Select
              id="ws-lead"
              value={form.leadId}
              onChange={(e) => setForm({ ...form, leadId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {leads.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="ws-status">
            <Select
              id="ws-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as WorkstreamStatus })}
            >
              {WORKSTREAM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {WORKSTREAM_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="ws-start">
            <TextInput
              id="ws-start"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="End date" htmlFor="ws-end">
            <TextInput
              id="ws-end"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>
        <FormError error={error} />
        <DialogActions
          submitLabel={editing ? "Save workstream" : "Add workstream"}
          submitting={submitting}
          disabled={!online}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Managing workstreams" />
      </form>
    </Dialog>
  );
}

export default function Workstreams({ project }: { project: Project }) {
  const { user, users, tasks, workstreams, online, canWrite } = useApp();
  const { members } = useProjectMembers(project.id);
  const [dialog, setDialog] = useState<{ editing: Workstream | null } | null>(null);

  const canManage = canWrite && canManageProject(user, project, members);

  const list = useMemo(
    () =>
      workstreams
        .filter((w) => w.projectId === project.id)
        .sort(
          (a, b) =>
            (a.startDate || "9999").localeCompare(b.startDate || "9999") ||
            a.title.localeCompare(b.title),
        ),
    [workstreams, project.id],
  );
  const activeCount = list.filter((w) => w.status === "IN_PROGRESS").length;

  const taskCount = (wsId: string) =>
    tasks.filter((t) => t.projectId === project.id && t.workstreamId === wsId).length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Workstreams
          {activeCount > 0 && (
            <CountPill className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              {activeCount} active
            </CountPill>
          )}
        </h2>
        {canManage && (
          <button
            type="button"
            disabled={!online}
            onClick={() => setDialog({ editing: null })}
            title={online ? "Add a workstream" : "Managing workstreams needs a live connection"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <PlusIcon className="h-4 w-4" />
            Add workstream
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState size="sm">
          No workstreams yet — group this project&apos;s tasks into delivery tracks to plan the timeline.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((w) => {
            const lead = w.leadId ? users.find((u) => u.id === w.leadId) : null;
            const count = taskCount(w.id);
            return (
              <div
                key={w.id}
                className={cn(
                  "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800",
                  w.status === "DONE" && "opacity-70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{w.title}</p>
                    {w.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                        {w.description}
                      </p>
                    )}
                  </div>
                  <WorkstreamStatusBadge status={w.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{lead ? `Lead: ${lead.name}` : "No lead"}</span>
                    <span>
                      {fmtDate(w.startDate)} → {fmtDate(w.endDate)}
                    </span>
                    <span>
                      {count} task{count === 1 ? "" : "s"}
                    </span>
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      disabled={!online}
                      onClick={() => setDialog({ editing: w })}
                      title={online ? undefined : "Workstream changes need a live connection"}
                      className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <WorkstreamDialog
          project={project}
          users={users}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
