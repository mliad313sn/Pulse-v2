"use client";

// Wave 4 actions — quick-add UX (plan §19).
// <MyActions /> — "My actions" panel at the top of every role dashboard.
// <ProjectActions /> — "Actions" section on the project room (bound to a project).
// Actions ride the offline outbox: Done + quick-add work offline (1 tap / Enter).

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useApp } from "@/lib/store";
import { useToast } from "./Toast";
import EmptyState from "./EmptyState";
import { CountPill, Pill } from "./Badges";
import { CheckIcon, ChevronDownIcon, ClockIcon } from "./Icons";
import { SkeletonList } from "./Skeleton";
import {
  ACTION_PRIORITY_META,
  cn,
  fmtDate,
  INPUT_CLASS,
  isActionOverdue,
  isToday,
} from "@/lib/utils";
import type { Action } from "@/lib/types";

/** Overdue first (overdue rose date), then earliest due, then newest. */
function byUrgency(a: Action, b: Action): number {
  const ao = isActionOverdue(a) ? 0 : 1;
  const bo = isActionOverdue(b) ? 0 : 1;
  if (ao !== bo) return ao - bo;
  const ad = a.dueDate || "9999";
  const bd = b.dueDate || "9999";
  if (ad !== bd) return ad.localeCompare(bd);
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

function DoneButton({ action, disabled }: { action: Action; disabled?: boolean }) {
  const { updateAction } = useApp();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const done = action.status === "DONE";

  const toggle = async () => {
    if (busy || done) return;
    setBusy(true);
    const res = await updateAction(action.id, { status: "DONE" });
    setBusy(false);
    if (res.ok && res.queued) toast("Marked done offline — will sync when back online.", "info");
  };

  return (
    <button
      type="button"
      disabled={disabled || busy || done}
      onClick={() => void toggle()}
      aria-label={done ? "Done" : `Mark "${action.title}" done`}
      title={done ? "Done" : "Mark done"}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition",
        done
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500 dark:border-slate-500",
        (disabled || busy) && "cursor-not-allowed opacity-50",
      )}
    >
      <CheckIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function ActionRow({
  action,
  showProject,
  showOwner,
}: {
  action: Action;
  showProject: boolean;
  showOwner?: boolean;
}) {
  const { projects, users, canWrite, pendingSyncKeys } = useApp();
  const project = action.projectId ? projects.find((p) => p.id === action.projectId) : null;
  const owner = showOwner ? users.find((u) => u.id === action.ownerId) : null;
  const overdue = isActionOverdue(action);
  const done = action.status === "DONE";
  const pending = pendingSyncKeys.has(`action:${action.id}`);

  return (
    <li
      className={cn(
        "flex min-h-[48px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800",
        done && "opacity-60",
      )}
    >
      {canWrite ? (
        <DoneButton action={action} />
      ) : (
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent dark:border-slate-500",
          )}
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium leading-snug", done && "line-through")}>
          {action.title}
        </span>
        {(owner || action.priority !== "normal") && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
            {owner && <span>{owner.name}</span>}
            {action.priority !== "normal" && (
              <span className="uppercase tracking-wide">{ACTION_PRIORITY_META[action.priority].label}</span>
            )}
          </span>
        )}
      </span>
      {showProject && project && (
        <Link href={`/projects/${project.id}`} onClick={(e) => e.stopPropagation()} className="max-w-[10rem] shrink-0">
          <Pill className="w-full border border-indigo-200 text-indigo-600 dark:border-indigo-800 dark:text-indigo-300">
            <span className="truncate">{project.name}</span>
          </Pill>
        </Link>
      )}
      {pending && (
        <span
          title="Change waiting to sync"
          aria-label="Change waiting to sync"
          className="inline-flex shrink-0 items-center text-indigo-400 dark:text-indigo-300"
        >
          <ClockIcon className="h-3.5 w-3.5" />
        </span>
      )}
      {action.dueDate && (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            overdue ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-400",
          )}
          title={overdue ? "Overdue" : "Due date"}
        >
          {fmtDate(action.dueDate)}
        </span>
      )}
    </li>
  );
}

/** Single-row quick add: text input + optional due date, Enter submits. */
function QuickAdd({ projectId }: { projectId?: string | null }) {
  const { createAction, online } = useApp();
  const { push: toast } = useToast();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const res = await createAction({ title: t, dueDate: dueDate || null, projectId: projectId ?? null });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setDueDate("");
      if (res.queued) toast("Action saved offline — will sync when back online.", "info");
      inputRef.current?.focus();
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={projectId ? "Add an action for this project… (Enter to save)" : "Add an action… (Enter to save)"}
        aria-label="New action title"
        className={cn(INPUT_CLASS, "h-10 min-w-0 flex-1 basis-48 rounded-xl text-sm")}
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        aria-label="Due date (optional)"
        title="Due date (optional)"
        className={cn(INPUT_CLASS, "h-10 w-auto shrink-0 rounded-xl text-sm")}
      />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="flex h-10 shrink-0 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add"}
      </button>
      {!online && (
        <span className="basis-full text-xs text-slate-400">Offline — new actions queue and sync later.</span>
      )}
    </form>
  );
}

/** Collapsed "Show N completed today" block. */
function CompletedToday({
  actions,
  showProject,
  showOwner,
}: {
  actions: Action[];
  showProject: boolean;
  showOwner?: boolean;
}) {
  const [show, setShow] = useState(false);
  if (actions.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <ChevronDownIcon className={cn("h-4 w-4 transition", show && "rotate-180")} />
        {show ? "Hide" : "Show"} {actions.length} completed today
      </button>
      {show && (
        <ul className="mt-2 space-y-2">
          {actions.map((a) => (
            <ActionRow key={a.id} action={a} showProject={showProject} showOwner={showOwner} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "My actions" panel — sits at the top of every role dashboard, above project
 * lists. OPEN actions owned by me, overdue-first; quick-add creates a
 * self-owned MANUAL action (general — no project binding from a dashboard).
 */
export function MyActions() {
  const { user, actions, canWrite, bootLoading } = useApp();

  const mine = useMemo(
    () => actions.filter((a) => a.ownerId === user?.id),
    [actions, user],
  );
  const open = useMemo(() => mine.filter((a) => a.status === "OPEN").sort(byUrgency), [mine]);
  const doneToday = useMemo(
    () =>
      mine
        .filter((a) => a.status === "DONE" && isToday(a.updatedAt))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [mine],
  );

  if (!user) return null;

  return (
    <section className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          My actions
          {open.length > 0 && <CountPill>{open.length} open</CountPill>}
        </h2>
      </div>

      {canWrite && (
        <div className="mb-3">
          <QuickAdd />
        </div>
      )}

      {bootLoading && actions.length === 0 ? (
        <SkeletonList count={2} />
      ) : open.length === 0 ? (
        <EmptyState size="sm">
          {doneToday.length > 0 ? "All clear — nothing open." : "No open actions — add one above to track it."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {open.map((a) => (
            <ActionRow key={a.id} action={a} showProject />
          ))}
        </ul>
      )}

      <CompletedToday actions={doneToday} showProject />
    </section>
  );
}

/** "Actions" section on the project room — list + quick-add bound to the project. */
export function ProjectActions({ projectId }: { projectId: string }) {
  const { actions, canWrite, bootLoading } = useApp();

  const list = useMemo(
    () => actions.filter((a) => a.projectId === projectId),
    [actions, projectId],
  );
  const open = useMemo(() => list.filter((a) => a.status === "OPEN").sort(byUrgency), [list]);
  const doneToday = useMemo(
    () =>
      list
        .filter((a) => a.status === "DONE" && isToday(a.updatedAt))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [list],
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Actions
          {open.length > 0 && <CountPill>{open.length} open</CountPill>}
        </h2>
      </div>

      {canWrite && (
        <div className="mb-3">
          <QuickAdd projectId={projectId} />
        </div>
      )}

      {bootLoading && actions.length === 0 ? (
        <SkeletonList count={2} />
      ) : open.length === 0 ? (
        <EmptyState size="sm">No open actions for this project.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {open.map((a) => (
            <ActionRow key={a.id} action={a} showProject={false} showOwner />
          ))}
        </ul>
      )}

      <CompletedToday actions={doneToday} showProject={false} showOwner />
    </section>
  );
}
