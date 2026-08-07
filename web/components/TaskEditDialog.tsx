"use client";

// Small task planning editor (Wave 3) — opened from an expanded TaskCard by
// managers. Edits workstream assignment + planned dates + estimated hours.
// ONLINE-ONLY (planning mutation); task STATUS moves stay on the offline path.

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import type { Task } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextInput } from "./Dialog";

export default function TaskEditDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { online, projects, workstreams, updateTaskPlan } = useApp();
  const project = projects.find((p) => p.id === task.projectId);
  const [form, setForm] = useState({
    workstreamId: task.workstreamId ?? "",
    plannedStart: task.plannedStart ? task.plannedStart.slice(0, 10) : "",
    plannedFinish: task.plannedFinish ? task.plannedFinish.slice(0, 10) : "",
    estimatedHours: task.estimatedHours != null ? String(task.estimatedHours) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const projectWorkstreams = useMemo(
    () =>
      workstreams
        .filter((w) => w.projectId === task.projectId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [workstreams, task.projectId],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (form.plannedStart && form.plannedFinish && form.plannedFinish < form.plannedStart) {
      setError("Planned finish cannot be before the planned start.");
      return;
    }
    let estimatedHours: number | null = null;
    if (form.estimatedHours.trim() !== "") {
      estimatedHours = Number(form.estimatedHours);
      if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
        setError("Estimated hours must be a non-negative number.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const outcome = await updateTaskPlan(task.id, {
      workstreamId: form.workstreamId || null,
      plannedStart: form.plannedStart || null,
      plannedFinish: form.plannedFinish || null,
      estimatedHours,
    });
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.message || "Task plan was not updated.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog title="Edit task plan" subtitle={project ? `${task.title} · ${project.name}` : task.title} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field
          label="Workstream"
          htmlFor="tp-ws"
          hint={projectWorkstreams.length === 0 ? "This project has no workstreams yet." : undefined}
        >
          <Select
            id="tp-ws"
            value={form.workstreamId}
            onChange={(e) => setForm({ ...form, workstreamId: e.target.value })}
          >
            <option value="">Unassigned</option>
            {projectWorkstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Planned start" htmlFor="tp-start">
            <TextInput
              id="tp-start"
              type="date"
              value={form.plannedStart}
              onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
            />
          </Field>
          <Field label="Planned finish" htmlFor="tp-finish">
            <TextInput
              id="tp-finish"
              type="date"
              value={form.plannedFinish}
              onChange={(e) => setForm({ ...form, plannedFinish: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Estimated hours" htmlFor="tp-hours" hint="Effort estimate — feeds capacity planning.">
          <TextInput
            id="tp-hours"
            type="number"
            min={0}
            step={0.5}
            value={form.estimatedHours}
            onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })}
          />
        </Field>
        <FormError error={error} />
        <DialogActions submitLabel="Save plan" submitting={submitting} disabled={!online} onCancel={onClose} />
        <OfflineHint show={!online} what="Editing the task plan" />
      </form>
    </Dialog>
  );
}
