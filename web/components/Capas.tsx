"use client";

// Wave 4 CAPA — collapsible project-room section (below Risks). ONLINE-ONLY
// writes. Cards carry the 6-state stepper chip; resolved roadblocks convert in
// via POST /api/roadblocks/:id/capa (button lives in RoadblockDialog).

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import {
  CAPA_SOURCE_TYPES,
  CAPA_STATUSES,
  CAPA_STATUS_META,
  cn,
  fmtDate,
  titleCaseTag,
} from "@/lib/utils";
import type { Capa, CapaSourceType, CapaStatus, Project, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import EmptyState from "./EmptyState";
import { CapaStatusChip, CountPill, Pill } from "./Badges";
import { ChevronDownIcon, PlusIcon } from "./Icons";
import { SkeletonList } from "./Skeleton";

/** ISO datetime → yyyy-mm-dd for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function CapaDialog({
  project,
  users,
  editing,
  onClose,
}: {
  project: Project;
  users: User[];
  editing: Capa | null;
  onClose: () => void;
}) {
  const { user, online, createCapa, updateCapa } = useApp();
  const [issue, setIssue] = useState(editing?.issue ?? "");
  const [sourceType, setSourceType] = useState<CapaSourceType>(editing?.sourceType ?? "MANUAL");
  const [status, setStatus] = useState<CapaStatus>(editing?.status ?? "OPEN");
  const [rootCause, setRootCause] = useState(editing?.rootCause ?? "");
  const [immediateCorrection, setImmediateCorrection] = useState(editing?.immediateCorrection ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(editing?.correctiveAction ?? "");
  const [preventiveAction, setPreventiveAction] = useState(editing?.preventiveAction ?? "");
  const [ownerId, setOwnerId] = useState(editing?.ownerId ?? user?.id ?? "");
  const [verifierId, setVerifierId] = useState(editing?.verifierId ?? "");
  const [dueDate, setDueDate] = useState(toDateInput(editing?.dueDate));
  const [effectivenessResult, setEffectivenessResult] = useState(editing?.effectivenessResult ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const people = useMemo(
    () => [...users].filter((u) => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const trimmedIssue = issue.trim();
    if (!trimmedIssue) {
      setError("Describe the issue this CAPA addresses.");
      return;
    }
    if (!ownerId) {
      setError("A CAPA needs an owner.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const shared = {
      issue: trimmedIssue,
      rootCause: rootCause.trim() || null,
      immediateCorrection: immediateCorrection.trim() || null,
      correctiveAction: correctiveAction.trim() || null,
      preventiveAction: preventiveAction.trim() || null,
      ownerId,
      verifierId: verifierId || null,
      dueDate: dueDate || null,
      status,
      effectivenessResult: effectivenessResult.trim() || null,
    };
    const outcome = editing
      ? await updateCapa(editing.id, shared)
      : await createCapa({ sourceType, projectId: project.id, ...shared });
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.message || (editing ? "The CAPA was not updated." : "The CAPA was not created."));
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={editing ? "Edit CAPA" : "New CAPA"} subtitle={project.name} onClose={onClose} wide>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Issue" htmlFor="capa-issue" hint="The nonconformity or problem being corrected.">
          <TextArea
            id="capa-issue"
            rows={2}
            autoFocus={!editing}
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="What went wrong?"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source" htmlFor="capa-source">
            <Select
              id="capa-source"
              value={sourceType}
              disabled={Boolean(editing)}
              onChange={(e) => setSourceType(e.target.value as CapaSourceType)}
            >
              {CAPA_SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {titleCaseTag(s.toLowerCase())}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="capa-status">
            <Select id="capa-status" value={status} onChange={(e) => setStatus(e.target.value as CapaStatus)}>
              {CAPA_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CAPA_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Root cause" htmlFor="capa-root">
          <TextArea id="capa-root" rows={2} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </Field>
        <Field label="Immediate correction" htmlFor="capa-correction" hint="The containment fix applied right away.">
          <TextArea
            id="capa-correction"
            rows={2}
            value={immediateCorrection}
            onChange={(e) => setImmediateCorrection(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Corrective action" htmlFor="capa-corrective" hint="Removes the root cause.">
            <TextArea
              id="capa-corrective"
              rows={2}
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
            />
          </Field>
          <Field label="Preventive action" htmlFor="capa-preventive" hint="Stops recurrence elsewhere.">
            <TextArea
              id="capa-preventive"
              rows={2}
              value={preventiveAction}
              onChange={(e) => setPreventiveAction(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner" htmlFor="capa-owner">
            <Select id="capa-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Select…</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Verifier" htmlFor="capa-verifier">
            <Select id="capa-verifier" value={verifierId} onChange={(e) => setVerifierId(e.target.value)}>
              <option value="">Unassigned</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="capa-due">
            <TextInput id="capa-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Effectiveness result"
          htmlFor="capa-effect"
          hint="Verification outcome — filled once effectiveness has been checked."
        >
          <TextArea
            id="capa-effect"
            rows={2}
            value={effectivenessResult}
            onChange={(e) => setEffectivenessResult(e.target.value)}
          />
        </Field>
        <FormError error={error} />
        <DialogActions
          submitLabel={editing ? "Save CAPA" : "Add CAPA"}
          submitting={submitting}
          disabled={!online}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Managing CAPAs" />
      </form>
    </Dialog>
  );
}

export default function Capas({ project }: { project: Project }) {
  const { users, capas, roadblocks, online, canWrite, bootLoading } = useApp();
  const [collapsed, setCollapsed] = useState(true);
  const [dialog, setDialog] = useState<{ editing: Capa | null } | null>(null);

  const list = useMemo(
    () =>
      capas
        .filter((c) => c.projectId === project.id)
        .sort(
          (a, b) =>
            (a.status === "CLOSED" ? 1 : 0) - (b.status === "CLOSED" ? 1 : 0) ||
            (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
        ),
    [capas, project.id],
  );
  const openCount = list.filter((c) => c.status !== "CLOSED").length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex min-h-[44px] items-center gap-2 rounded-xl text-lg font-semibold transition hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          <ChevronDownIcon className={cn("h-4 w-4 transition", !collapsed && "rotate-180")} />
          CAPA
          {openCount > 0 && <CountPill>{openCount} open</CountPill>}
        </button>
        {canWrite && !collapsed && (
          <button
            type="button"
            disabled={!online}
            onClick={() => setDialog({ editing: null })}
            title={online ? "Add a CAPA" : "Managing CAPAs needs a live connection"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <PlusIcon className="h-4 w-4" />
            Add CAPA
          </button>
        )}
      </div>

      {!collapsed &&
        (bootLoading && capas.length === 0 ? (
          <SkeletonList count={2} />
        ) : list.length === 0 ? (
          <EmptyState size="sm">
            No CAPAs for this project. Resolved roadblocks can be converted into one from their detail view.
            {!online && " CAPAs are online-only — reconnect to add one."}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {list.map((capa) => {
              const owner = users.find((u) => u.id === capa.ownerId);
              const verifier = capa.verifierId ? users.find((u) => u.id === capa.verifierId) : null;
              const sourceRoadblock =
                capa.sourceType === "ROADBLOCK" && capa.sourceId
                  ? roadblocks.find((r) => r.id === capa.sourceId)
                  : null;
              return (
                <div
                  key={capa.id}
                  className={cn(
                    "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800",
                    capa.status === "CLOSED" && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 font-medium leading-snug">{capa.issue}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill className="border border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400">
                        {titleCaseTag(capa.sourceType.toLowerCase())}
                      </Pill>
                      <CapaStatusChip status={capa.status} />
                    </div>
                  </div>
                  {sourceRoadblock && (
                    <p className="mt-1.5 truncate text-xs text-slate-400" title={sourceRoadblock.description}>
                      From roadblock: {sourceRoadblock.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{owner ? `Owner: ${owner.name}` : "Unowned"}</span>
                      <span>{verifier ? `Verifier: ${verifier.name}` : "No verifier"}</span>
                      {capa.dueDate && <span>Due {fmtDate(capa.dueDate)}</span>}
                    </span>
                    {canWrite && (
                      <button
                        type="button"
                        disabled={!online}
                        onClick={() => setDialog({ editing: capa })}
                        title={online ? undefined : "CAPA changes need a live connection"}
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
        ))}

      {dialog && (
        <CapaDialog project={project} users={users} editing={dialog.editing} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
