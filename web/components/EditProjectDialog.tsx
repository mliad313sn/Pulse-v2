"use client";

// Edit project details — the fields the stage-gate checklist inspects
// (sponsor, dates, acceptance criteria, deployment plan, support owner,
// closure summary) plus name/description.
//
// ONLINE-ONLY direct PATCH /api/projects/:id with OCC (version): a 409 pulls
// the server's canonical state into the form and keeps the dialog open so the
// user can re-apply their edit on top of the refreshed values.

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import { api, ApiError } from "@/lib/api";
import { apiErrorMessage, asEntity } from "@/lib/orgData";
import { canManageProject, cn, divisionMeta } from "@/lib/utils";
import type { Project, ProjectMember, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import { SectionHeader } from "./Headings";
import { PencilIcon } from "./Icons";

// ---- form model -------------------------------------------------------------

interface FormValues {
  name: string;
  description: string;
  sponsorId: string;
  startDate: string;
  targetDate: string;
  actualEndDate: string;
  acceptanceCriteria: string;
  deploymentPlan: string;
  supportOwnerId: string;
  closureSummary: string;
}

/** ISO timestamp or date → the YYYY-MM-DD a `<input type="date">` needs. */
function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function initForm(p: Project): FormValues {
  return {
    name: p.name ?? "",
    description: p.description ?? "",
    sponsorId: p.sponsorId ?? "",
    startDate: dateOnly(p.startDate),
    targetDate: dateOnly(p.targetDate),
    actualEndDate: dateOnly(p.actualEndDate),
    acceptanceCriteria: p.acceptanceCriteria ?? "",
    deploymentPlan: p.deploymentPlan ?? "",
    supportOwnerId: p.supportOwnerId ?? "",
    closureSummary: p.closureSummary ?? "",
  };
}

/** Wire value per field: trimmed text / date / id — cleared fields become null. */
function wireValue(key: keyof FormValues, raw: string): unknown {
  if (key === "name") return raw.trim();
  if (key === "sponsorId" || key === "supportOwnerId") return raw || null;
  if (key === "startDate" || key === "targetDate" || key === "actualEndDate") return raw || null;
  return raw.trim() || null; // free-text fields
}

/** ONLY the fields whose value differs from the base snapshot (OCC-friendly). */
function changedFields(base: Project, form: FormValues): Record<string, unknown> {
  const orig = initForm(base);
  const fields: Record<string, unknown> = {};
  (Object.keys(form) as Array<keyof FormValues>).forEach((key) => {
    const next = wireValue(key, form[key]);
    const prev = wireValue(key, orig[key]);
    if (next !== prev) fields[key] = next;
  });
  return fields;
}

function looksLikeProject(value: unknown): value is Project {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}

// ---- user select ------------------------------------------------------------

function UserSelect({
  id,
  value,
  users,
  onChange,
}: {
  id: string;
  value: string;
  users: User[];
  onChange: (value: string) => void;
}) {
  const options = useMemo(() => {
    const active = users.filter((u) => u.isActive !== false);
    // Keep a currently-assigned but now-inactive user selectable/visible.
    if (value && !active.some((u) => u.id === value)) {
      const current = users.find((u) => u.id === value);
      if (current) active.push(current);
    }
    return active.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, value]);

  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} · {divisionMeta(u.division).label}
          {u.isActive === false ? " (inactive)" : ""}
        </option>
      ))}
    </Select>
  );
}

// ---- dialog -----------------------------------------------------------------

export function EditProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  /** Fired after a successful save (e.g. reload the gate checklist). */
  onSaved?: () => void;
}) {
  const { users, online, upsertProject } = useApp();
  const { push: toast } = useToast();

  // Base snapshot = what the form was initialised from; carries the OCC version.
  const [base, setBase] = useState<Project>(project);
  const [form, setForm] = useState<FormValues>(() => initForm(project));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof FormValues) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (!online) {
      setError("Editing a project needs a live connection.");
      return;
    }
    const fields = changedFields(base, form);
    if (Object.keys(fields).length === 0) {
      toast("No changes to save.");
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<unknown>(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { ...fields, version: base.version },
      });
      const updated = asEntity<Project>(res, "project");
      if (updated && looksLikeProject(updated)) {
        upsertProject(updated);
      } else {
        upsertProject({
          ...base,
          ...(fields as Partial<Project>),
          version: base.version + 1,
          updatedAt: new Date().toISOString(),
        });
      }
      toast("Project updated.", "success");
      onSaved?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // OCC conflict — adopt the server's canonical state and let the user retry.
        if (looksLikeProject(err.serverState)) {
          const server = err.serverState as unknown as Project;
          upsertProject(server);
          setBase(server);
          setForm(initForm(server));
        }
        setError("This project was updated elsewhere — the form has been refreshed with the latest values.");
      } else if (err instanceof ApiError) {
        setError(apiErrorMessage(err, "The server rejected the change."));
      } else {
        setError("Cannot reach the server — changes not saved.");
      }
      setSubmitting(false);
    }
  };

  const subHeader = (children: ReactNode) => (
    <SectionHeader className="mb-0 mt-1 text-xs">{children}</SectionHeader>
  );

  return (
    <Dialog title="Edit project" subtitle={project.name} onClose={onClose} wide>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        {subHeader("Basics")}
        <Field label="Name" htmlFor="ep-name">
          <TextInput
            id="ep-name"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Description" htmlFor="ep-desc">
          <TextArea
            id="ep-desc"
            rows={2}
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            placeholder="What is this project about? (optional)"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sponsor" htmlFor="ep-sponsor" hint="Required by gate G1.">
            <UserSelect id="ep-sponsor" value={form.sponsorId} users={users} onChange={set("sponsorId")} />
          </Field>
          <Field label="Start date" htmlFor="ep-start" hint="Set when execution begins.">
            <TextInput
              id="ep-start"
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate")(e.target.value)}
            />
          </Field>
        </div>

        {subHeader("Governance evidence")}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target date" htmlFor="ep-target" hint="Planned completion — required by gate G2.">
            <TextInput
              id="ep-target"
              type="date"
              value={form.targetDate}
              onChange={(e) => set("targetDate")(e.target.value)}
            />
          </Field>
          <Field label="Support owner" htmlFor="ep-support" hint="Who runs it after go-live.">
            <UserSelect id="ep-support" value={form.supportOwnerId} users={users} onChange={set("supportOwnerId")} />
          </Field>
        </div>
        <Field label="Acceptance criteria" htmlFor="ep-acceptance" hint="How the outcome will be judged done.">
          <TextArea
            id="ep-acceptance"
            rows={3}
            value={form.acceptanceCriteria}
            onChange={(e) => set("acceptanceCriteria")(e.target.value)}
          />
        </Field>
        <Field label="Deployment plan" htmlFor="ep-deploy" hint="Rollout, comms and fallback approach.">
          <TextArea
            id="ep-deploy"
            rows={3}
            value={form.deploymentPlan}
            onChange={(e) => set("deploymentPlan")(e.target.value)}
          />
        </Field>

        {subHeader("Closure")}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Actual end date" htmlFor="ep-end">
            <TextInput
              id="ep-end"
              type="date"
              value={form.actualEndDate}
              onChange={(e) => set("actualEndDate")(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Closure summary" htmlFor="ep-closure" hint="Outcomes and lessons — required to close at G5.">
          <TextArea
            id="ep-closure"
            rows={3}
            value={form.closureSummary}
            onChange={(e) => set("closureSummary")(e.target.value)}
          />
        </Field>

        <FormError error={error} />
        <DialogActions
          submitLabel="Save changes"
          submitting={submitting}
          disabled={!online || !form.name.trim()}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Editing a project" />
      </form>
    </Dialog>
  );
}

// ---- trigger button ---------------------------------------------------------

/**
 * "Edit project" affordance. Renders nothing unless the user can manage the
 * project (ADMIN / DIVISION_LEAD / the project's PM — server enforces anyway).
 */
export default function EditProjectButton({
  project,
  members = [],
  variant = "header",
  onSaved,
  className,
}: {
  project: Project;
  /** Pass when already loaded (governance page) so PM-via-membership is honoured. */
  members?: ProjectMember[];
  /** "header" = bordered header button; "link" = compact link-button. */
  variant?: "header" | "link";
  onSaved?: () => void;
  className?: string;
}) {
  const { user, online } = useApp();
  const [open, setOpen] = useState(false);

  if (!canManageProject(user, project, members)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? "Edit project details" : "Editing a project needs a live connection"}
        className={cn(
          variant === "header"
            ? "flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
            : "flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40",
          className,
        )}
      >
        <PencilIcon className={variant === "header" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {variant === "header" ? "Edit project" : "Edit project details"}
      </button>
      {open && (
        <EditProjectDialog project={project} onClose={() => setOpen(false)} onSaved={onSaved} />
      )}
    </>
  );
}
