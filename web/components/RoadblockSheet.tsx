"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import { cn, SEVERITIES, SEVERITY_META } from "@/lib/utils";
import type { RoadblockSeverity } from "@/lib/types";
import { XIcon } from "./Icons";

/**
 * SC3: "Log Roadblock" bottom sheet — rendered once in the app shell.
 * Any component opens it via openRoadblock() from useApp().
 * Opening it is interaction 1, the description arrives prefilled + focused,
 * severity chips are one optional tap, Save is the final tap — 2-3 interactions total.
 */
export default function RoadblockSheet() {
  const { createRoadblock, projects, online, roadblockTarget: target, closeRoadblock: onClose } = useApp();
  const { push: toast } = useToast();
  const [severity, setSeverity] = useState<RoadblockSeverity>("medium");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const project = useMemo(
    () => (target ? projects.find((p) => p.id === target.projectId) : null),
    [target, projects],
  );

  useEffect(() => {
    if (!target) return;
    setSeverity("medium");
    setDescription(target.task ? `Roadblock on "${target.task.title}": ` : "Roadblock: ");
    const t = window.setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [target]);

  if (!target) return null;

  const save = async () => {
    if (!description.trim() || saving) return;
    setSaving(true);
    const res = await createRoadblock({
      projectId: target.projectId,
      taskId: target.task?.id ?? null,
      description: description.trim(),
      severity,
    });
    setSaving(false);
    if (res.ok) {
      toast(
        res.queued ? "Roadblock saved offline — will sync when back online." : "Roadblock logged.",
        res.queued ? "info" : "success",
      );
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="sheet-enter relative w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-slate-800 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Log a roadblock</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {project ? project.name : "Project"}
              {target.task ? ` · ${target.task.title}` : ""}
              {!online && " · offline — will queue"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What is blocking the work?"
          className="w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {SEVERITIES.map((s) => {
            const meta = SEVERITY_META[s];
            const active = severity === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={cn(
                  "min-h-[44px] rounded-xl border px-4 text-sm font-medium transition",
                  active ? meta.selected : cn("bg-transparent", meta.chip),
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!description.trim() || saving}
          className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-rose-600 text-base font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save roadblock"}
        </button>
      </div>
    </div>
  );
}
