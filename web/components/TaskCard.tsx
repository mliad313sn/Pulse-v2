"use client";

import Link from "next/link";
import { useState, type HTMLAttributes } from "react";
import { useApp } from "@/lib/store";
import { canManageProject, cn, fmtDate, relativeDue, slaClass, slaState } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { LockBadge, StatusBadge } from "./Badges";
import StatusButtons from "./StatusButtons";
import LogRoadblockButton from "./LogRoadblockButton";
import TaskEditDialog from "./TaskEditDialog";
import { ClockIcon, PencilIcon } from "./Icons";

interface Props {
  task: Task;
  /** zen: status buttons always visible (1-tap update). expand: tap card to reveal buttons (2 taps). */
  mode?: "zen" | "expand";
  /** list: standalone card with project link + status badge. board: compact kanban card. */
  variant?: "list" | "board";
  /** board only: highlighted as the tap-to-move candidate. */
  selected?: boolean;
  /** board only: toggle this card as the move candidate. */
  onSelect?: () => void;
  /** board only: drag props (draggable, onDragStart) layered onto the card. */
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}

export default function TaskCard({
  task,
  mode = "expand",
  variant = "list",
  selected = false,
  onSelect,
  dragProps,
}: Props) {
  const { user, projects, lockedMessage, openRoadblock, canWrite } = useApp();
  const [expanded, setExpanded] = useState(mode === "zen");
  const [editOpen, setEditOpen] = useState(false);
  const board = variant === "board";
  const parentProject = projects.find((p) => p.id === task.projectId) ?? null;
  const project = board ? null : parentProject;
  const sla = slaState(task);
  const locked = Boolean(task.locked);
  // Planning-field edits: managers only (ADMIN / DIVISION_LEAD / project PM).
  const canEditPlan = canWrite && canManageProject(user, parentProject);

  return (
    <div
      {...dragProps}
      onClick={() => {
        if (board) {
          onSelect?.();
          setExpanded((v) => !v);
        } else if (mode === "expand") {
          setExpanded((v) => !v);
        }
      }}
      title={
        locked
          ? lockedMessage(task)
          : board && canWrite
            ? "Drag to a column, or tap then tap a column's Move here button"
            : undefined
      }
      className={cn(
        "rounded-2xl border border-slate-200 bg-white transition dark:border-slate-700 dark:bg-slate-800",
        board
          ? cn(
              "select-none p-3.5 hover:border-slate-300 dark:hover:border-slate-500",
              canWrite && "cursor-grab active:cursor-grabbing",
            )
          : "p-4",
        !board && mode === "expand" && "cursor-pointer hover:border-slate-300 dark:hover:border-slate-500",
        locked && "opacity-60",
        board && selected && "move-selected",
        slaClass(sla),
      )}
    >
      <div className={cn("flex items-start justify-between", board ? "gap-2" : "gap-3")}>
        {board ? (
          <p className="text-sm font-medium leading-snug">{task.title}</p>
        ) : (
          <div className="min-w-0">
            <p className="font-medium leading-snug">{task.title}</p>
            {project && (
              <Link
                href={`/projects/${project.id}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5 block truncate text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {project.name}
              </Link>
            )}
          </div>
        )}
        {board ? (
          locked && <LockBadge reason={lockedMessage(task)} />
        ) : (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge status={task.status} />
            {locked && <LockBadge reason={lockedMessage(task)} />}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-y-1 text-xs text-slate-500 dark:text-slate-400",
          board ? "mt-1.5 gap-x-3" : "mt-2 gap-x-4",
        )}
      >
        {task.slaDueAt && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              sla === "overdue" && "font-semibold text-rose-600 dark:text-rose-400",
              sla === "warn" && "font-semibold text-amber-600 dark:text-amber-400",
            )}
          >
            <ClockIcon className="h-3.5 w-3.5" />
            {board
              ? `${fmtDate(task.slaDueAt)} · ${relativeDue(task.slaDueAt)}`
              : `SLA ${fmtDate(task.slaDueAt)} (${relativeDue(task.slaDueAt)})`}
          </span>
        )}
        {task.priority && task.priority !== "normal" && (
          <span className="uppercase tracking-wide">{task.priority}</span>
        )}
        {task.site && <span>{task.site}</span>}
      </div>

      {expanded && canWrite && (
        <div className={cn(board ? "mt-3 space-y-2" : "mt-4 space-y-3")} onClick={(e) => e.stopPropagation()}>
          <StatusButtons task={task} onDone={board ? () => setExpanded(false) : undefined} />
          <LogRoadblockButton onClick={() => openRoadblock({ projectId: task.projectId, task })} />
          {canEditPlan && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit plan
            </button>
          )}
        </div>
      )}

      {editOpen && (
        <span onClick={(e) => e.stopPropagation()}>
          <TaskEditDialog task={task} onClose={() => setEditOpen(false)} />
        </span>
      )}
    </div>
  );
}
