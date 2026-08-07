"use client";

// RAG health explain panel — signal breakdown, computed vs manual line, recent
// history strip (live, online-only) and the manage-level manual override flow.
// a11y: every color is paired with shape + text (plan §167).

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Project, RagColor, RagHistoryEntry } from "@/lib/types";
import {
  canManageProject,
  cn,
  fmtDateTime,
  RAG_COLORS,
  RAG_META,
  RAG_OVERRIDE_REASON_MIN,
} from "@/lib/utils";
import { Dialog, DialogActions, Field, FormError, OfflineHint, TextArea } from "./Dialog";
import RagBadge, { RagGlyph, RagShapeGlyph } from "./RagBadge";

function looksLikeHistoryEntry(v: unknown): v is RagHistoryEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { color?: unknown }).color === "string" &&
    typeof (v as { capturedAt?: unknown }).capturedAt === "string"
  );
}

/** Compact horizontal strip of the last ~12 RAG snapshots (newest first from the API; rendered oldest → newest). */
function RagHistoryStrip({ projectId }: { projectId: string }) {
  const { online } = useApp();
  const [history, setHistory] = useState<RagHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api<unknown>(`/api/projects/${projectId}/rag-history`);
        const list = (Array.isArray(res)
          ? res
          : Array.isArray((res as { history?: unknown })?.history)
            ? (res as { history: unknown[] }).history
            : []
        ).filter(looksLikeHistoryEntry);
        if (!cancelled) setHistory(list.slice(0, 12));
      } catch {
        if (!cancelled) setHistory(null); // fetch failed — hide the strip
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, online]);

  // Online-only feature: hidden offline (and while nothing loaded).
  if (!online || !history || history.length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Recent history
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {[...history].reverse().map((h, i) => {
          const meta = RAG_META[h.color] ?? RAG_META.GREEN;
          return (
            <span
              key={`${h.capturedAt}-${i}`}
              title={`${meta.label}${h.isManual ? " (manual override)" : ""} · ${fmtDateTime(h.capturedAt)}`}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md border",
                h.isManual
                  ? "border-slate-400 border-dashed dark:border-slate-500"
                  : "border-slate-200 dark:border-slate-700",
                "bg-white dark:bg-slate-900",
              )}
            >
              <RagGlyph color={h.color} className="h-3 w-3" />
            </span>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Oldest → newest · dashed border = manual override</p>
    </div>
  );
}

/** Manual override form (manage-level; server enforces + records who/when/why). */
function OverrideForm({
  project,
  onDone,
  onCancel,
}: {
  project: Project;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { setRagOverride, online } = useApp();
  const [color, setColor] = useState<RagColor>(project.rag?.manual?.color ?? project.rag?.color ?? "AMBER");
  const [reason, setReason] = useState(project.rag?.manual?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tooShort = reason.trim().length < RAG_OVERRIDE_REASON_MIN;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await setRagOverride(project.id, color, reason.trim());
    setSubmitting(false);
    if (res.ok) {
      onDone();
    } else {
      setError(res.message || "Override not saved.");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Override color">
        <div className="flex gap-2" role="radiogroup" aria-label="Override color">
          {RAG_COLORS.map((c) => {
            const meta = RAG_META[c];
            const active = color === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setColor(c)}
                className={cn(
                  "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition",
                  active ? meta.selected : meta.chip,
                )}
              >
                <RagShapeGlyph shape={meta.shape} className={cn("h-2.5 w-2.5", active ? "text-white" : meta.shapeClass)} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </Field>
      <Field
        label="Reason"
        htmlFor="rag-override-reason"
        hint={
          <span className={cn("tabular-nums", tooShort && "text-amber-600 dark:text-amber-400")}>
            {reason.trim().length}/{RAG_OVERRIDE_REASON_MIN} characters minimum
            {tooShort ? " — explain why the computed health is wrong" : ""}
          </span>
        }
      >
        <TextArea
          id="rag-override-reason"
          rows={3}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why does the computed RAG not reflect reality? (min 30 characters, recorded in the audit trail)"
        />
      </Field>
      <FormError error={error} />
      <OfflineHint show={!online} what="A RAG override" />
      <DialogActions
        submitLabel="Save override"
        submitting={submitting}
        disabled={!online || tooShort}
        onCancel={onCancel}
      />
    </form>
  );
}

/**
 * RAG explain dialog: signal rows, computed vs manual line, history strip and
 * (manage-level only) Override / Clear override actions.
 */
export default function RagExplain({ project, onClose }: { project: Project; onClose: () => void }) {
  const { user, online, clearRagOverride } = useApp();
  const [mode, setMode] = useState<"view" | "override">("view");
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const rag = project.rag;
  const canManage = canManageProject(user, project);

  const clear = useCallback(async () => {
    setError(null);
    setClearing(true);
    const res = await clearRagOverride(project.id);
    setClearing(false);
    if (!res.ok) setError(res.message || "Could not clear the override.");
  }, [clearRagOverride, project.id]);

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          RAG health
          <RagBadge rag={rag} />
        </span>
      }
      subtitle={project.name}
      onClose={onClose}
    >
      {mode === "override" ? (
        <OverrideForm project={project} onDone={() => setMode("view")} onCancel={() => setMode("view")} />
      ) : !rag ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No RAG data cached for this project yet — reconnect to compute health.
        </p>
      ) : (
        <div className="space-y-5">
          {rag.explanation && <p className="text-sm text-slate-600 dark:text-slate-300">{rag.explanation}</p>}

          {/* Computed vs manual */}
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-slate-500 dark:text-slate-400">Computed:</span>
              <RagGlyph color={rag.computedColor} className="h-2.5 w-2.5" />
              <span className="font-medium">{RAG_META[rag.computedColor]?.label ?? rag.computedColor}</span>
              {rag.manual ? (
                <>
                  <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-500 dark:text-slate-400">Manual override:</span>
                  <RagGlyph color={rag.manual.color} className="h-2.5 w-2.5" />
                  <span className="font-medium">{RAG_META[rag.manual.color]?.label ?? rag.manual.color}</span>
                </>
              ) : (
                <>
                  <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-500 dark:text-slate-400">no manual override</span>
                </>
              )}
            </p>
            {rag.manual && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                “{rag.manual.reason}” — {fmtDateTime(rag.manual.at)}
              </p>
            )}
          </div>

          {/* Signals */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Signals
            </p>
            {rag.signals.length === 0 ? (
              <p className="text-sm text-slate-400">No contributing signals.</p>
            ) : (
              <ul className="space-y-2">
                {rag.signals.map((s) => {
                  const meta = RAG_META[s.color] ?? RAG_META.GREEN;
                  return (
                    <li key={s.key} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          meta.badge,
                        )}
                      >
                        <RagShapeGlyph shape={meta.shape} className={cn("h-2 w-2", meta.shapeClass)} />
                        {meta.label}
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{s.label}</span>
                        {s.explanation && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{s.explanation}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <RagHistoryStrip projectId={project.id} />

          <FormError error={error} />

          {canManage && (
            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
              <button
                type="button"
                disabled={!online}
                onClick={() => setMode("override")}
                className="flex min-h-[44px] items-center rounded-xl border border-indigo-300 px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                {rag.manual ? "Change override" : "Override"}
              </button>
              {rag.manual && (
                <button
                  type="button"
                  disabled={!online || clearing}
                  onClick={() => void clear()}
                  className="flex min-h-[44px] items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/60"
                >
                  {clearing ? "Clearing…" : "Clear override"}
                </button>
              )}
              <OfflineHint show={!online} what="Changing a RAG override" />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Header affordance: the RAG badge as a button that opens the explain dialog. */
export function RagExplainButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  if (!project.rag) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="RAG health — tap for the signal breakdown"
        aria-label={`RAG health: ${RAG_META[project.rag.color]?.label ?? project.rag.color}. Open breakdown`}
        className="rounded-full transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <RagBadge rag={project.rag} />
      </button>
      {open && <RagExplain project={project} onClose={() => setOpen(false)} />}
    </>
  );
}
