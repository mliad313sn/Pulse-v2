"use client";

// Wave 4 risks — project-room register. ONLINE-ONLY writes (never queued).
// P×I inherent score on a 1-25 color scale (≥15 rose, ≥8 amber, else slate),
// with an optional residual pair after treatment.

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import {
  cn,
  fmtDate,
  RISK_CATEGORIES,
  RISK_CATEGORY_META,
  RISK_STATUSES,
  RISK_STATUS_META,
  riskScoreTone,
} from "@/lib/utils";
import type { Project, Risk, RiskCategory, RiskStatus, User } from "@/lib/types";
import { Dialog, DialogActions, Field, FormError, OfflineHint, Select, TextArea, TextInput } from "./Dialog";
import EmptyState from "./EmptyState";
import { CountPill, Pill, RiskScorePill, RiskStatusBadge } from "./Badges";
import { PlusIcon } from "./Icons";
import { SkeletonList } from "./Skeleton";

const SCALE = [1, 2, 3, 4, 5];

/** ISO datetime → yyyy-mm-dd for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function ScoreSelect({
  id,
  label,
  value,
  onChange,
  allowEmpty,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">—</option>}
        {SCALE.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ScorePreview({ p, i, label }: { p: string; i: string; label: string }) {
  const score = p && i ? Number(p) * Number(i) : null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-600">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums",
          riskScoreTone(score),
        )}
      >
        {score ?? "—"}
      </span>
      {score !== null && (
        <span className="text-xs text-slate-400">
          {p} × {i} of 25
        </span>
      )}
    </div>
  );
}

function RiskDialog({
  project,
  users,
  editing,
  onClose,
}: {
  project: Project;
  users: User[];
  editing: Risk | null;
  onClose: () => void;
}) {
  const { online, createRisk, updateRisk } = useApp();
  const [description, setDescription] = useState(editing?.description ?? "");
  const [category, setCategory] = useState<RiskCategory>(editing?.category ?? "technical");
  const [probability, setProbability] = useState(String(editing?.probability ?? 3));
  const [impact, setImpact] = useState(String(editing?.impact ?? 3));
  const [residualProbability, setResidualProbability] = useState(
    editing?.residualProbability != null ? String(editing.residualProbability) : "",
  );
  const [residualImpact, setResidualImpact] = useState(
    editing?.residualImpact != null ? String(editing.residualImpact) : "",
  );
  const [treatment, setTreatment] = useState(editing?.treatment ?? "");
  const [ownerId, setOwnerId] = useState(editing?.ownerId ?? "");
  const [targetDate, setTargetDate] = useState(toDateInput(editing?.targetDate));
  const [status, setStatus] = useState<RiskStatus>(editing?.status ?? "OPEN");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const owners = useMemo(
    () => [...users].filter((u) => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const desc = description.trim();
    if (!desc) {
      setError("A risk description is required.");
      return;
    }
    if ((residualProbability === "") !== (residualImpact === "")) {
      setError("Residual probability and impact go together — set both or neither.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const shared = {
      description: desc,
      category,
      probability: Number(probability),
      impact: Number(impact),
      treatment: treatment.trim() || null,
      ownerId: ownerId || null,
      targetDate: targetDate || null,
      residualProbability: residualProbability ? Number(residualProbability) : null,
      residualImpact: residualImpact ? Number(residualImpact) : null,
      status,
    };
    const outcome = editing
      ? await updateRisk(editing.id, shared)
      : await createRisk({ projectId: project.id, ...shared });
    if (outcome.ok) {
      onClose();
    } else {
      setError(outcome.message || (editing ? "The risk was not updated." : "The risk was not created."));
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={editing ? "Edit risk" : "New risk"} subtitle={project.name} onClose={onClose} wide>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field label="Description" htmlFor="risk-desc">
          <TextArea
            id="risk-desc"
            rows={2}
            autoFocus={!editing}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What could go wrong, and why?"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="risk-cat">
            <Select id="risk-cat" value={category} onChange={(e) => setCategory(e.target.value as RiskCategory)}>
              {RISK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {RISK_CATEGORY_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="risk-status">
            <Select id="risk-status" value={status} onChange={(e) => setStatus(e.target.value as RiskStatus)}>
              {RISK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RISK_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid items-end gap-4 sm:grid-cols-3">
          <ScoreSelect id="risk-prob" label="Probability (1-5)" value={probability} onChange={setProbability} />
          <ScoreSelect id="risk-impact" label="Impact (1-5)" value={impact} onChange={setImpact} />
          <ScorePreview p={probability} i={impact} label="Inherent" />
        </div>
        <Field label="Treatment" htmlFor="risk-treatment" hint="How the risk is avoided, reduced, transferred or accepted.">
          <TextArea
            id="risk-treatment"
            rows={2}
            value={treatment}
            onChange={(e) => setTreatment(e.target.value)}
            placeholder="Mitigation / treatment plan"
          />
        </Field>
        <div className="grid items-end gap-4 sm:grid-cols-3">
          <ScoreSelect
            id="risk-res-prob"
            label="Residual probability"
            value={residualProbability}
            onChange={setResidualProbability}
            allowEmpty
          />
          <ScoreSelect
            id="risk-res-impact"
            label="Residual impact"
            value={residualImpact}
            onChange={setResidualImpact}
            allowEmpty
          />
          <ScorePreview p={residualProbability} i={residualImpact} label="Residual" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" htmlFor="risk-owner">
            <Select id="risk-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date" htmlFor="risk-target" hint="When the treatment should be in effect.">
            <TextInput id="risk-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        <FormError error={error} />
        <DialogActions
          submitLabel={editing ? "Save risk" : "Add risk"}
          submitting={submitting}
          disabled={!online}
          onCancel={onClose}
        />
        <OfflineHint show={!online} what="Managing risks" />
      </form>
    </Dialog>
  );
}

export default function Risks({ project }: { project: Project }) {
  const { users, risks, online, canWrite, bootLoading } = useApp();
  const [dialog, setDialog] = useState<{ editing: Risk | null } | null>(null);

  const list = useMemo(
    () =>
      risks
        .filter((r) => r.projectId === project.id)
        .sort(
          (a, b) =>
            (a.status === "CLOSED" ? 1 : 0) - (b.status === "CLOSED" ? 1 : 0) ||
            (b.inherentScore ?? b.probability * b.impact) - (a.inherentScore ?? a.probability * a.impact),
        ),
    [risks, project.id],
  );
  const openCount = list.filter((r) => r.status !== "CLOSED").length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Risks
          {openCount > 0 && <CountPill>{openCount} open</CountPill>}
        </h2>
        {canWrite && (
          <button
            type="button"
            disabled={!online}
            onClick={() => setDialog({ editing: null })}
            title={online ? "Add a risk" : "Managing risks needs a live connection"}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <PlusIcon className="h-4 w-4" />
            Add risk
          </button>
        )}
      </div>

      {bootLoading && risks.length === 0 ? (
        <SkeletonList count={2} />
      ) : list.length === 0 ? (
        <EmptyState size="sm">
          No risks registered for this project.
          {!online && " Risks are online-only — reconnect to add one."}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {list.map((risk) => {
            const owner = risk.ownerId ? users.find((u) => u.id === risk.ownerId) : null;
            const cat = RISK_CATEGORY_META[risk.category] ?? RISK_CATEGORY_META.other;
            const inherent = risk.inherentScore ?? risk.probability * risk.impact;
            return (
              <div
                key={risk.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800",
                  risk.status === "CLOSED" && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-medium leading-snug">{risk.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>{owner ? `Owner: ${owner.name}` : "Unowned"}</span>
                    {risk.targetDate && <span>Target {fmtDate(risk.targetDate)}</span>}
                  </div>
                </div>
                <Pill className={cat.chip}>{cat.label}</Pill>
                <span className="flex items-center gap-1.5" title={`Inherent ${risk.probability} × ${risk.impact}`}>
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">P×I</span>
                  <RiskScorePill score={inherent} title={`Inherent score (${risk.probability} × ${risk.impact})`} />
                  {typeof risk.residualScore === "number" && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">→</span>
                      <RiskScorePill score={risk.residualScore} title="Residual score after treatment" />
                    </>
                  )}
                </span>
                <RiskStatusBadge status={risk.status} />
                {canWrite && (
                  <button
                    type="button"
                    disabled={!online}
                    onClick={() => setDialog({ editing: risk })}
                    title={online ? undefined : "Risk changes need a live connection"}
                    className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                  >
                    Edit
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <RiskDialog project={project} users={users} editing={dialog.editing} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
