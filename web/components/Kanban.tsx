"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { cn, STATUS_META, TASK_STATUSES, fmtDate, relativeDue, slaClass, slaState } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/types";
import { LockBadge } from "./Badges";
import StatusButtons from "./StatusButtons";
import { AlertIcon, ClockIcon } from "./Icons";
import type { RoadblockTarget } from "./RoadblockSheet";

interface Props {
  projectId: string;
  onRoadblock: (target: RoadblockTarget) => void;
}

function KanbanCard({
  task,
  selected,
  onSelect,
  onRoadblock,
}: {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  onRoadblock: (target: RoadblockTarget) => void;
}) {
  const { lockedMessage } = useApp();
  const [expanded, setExpanded] = useState(false);
  const locked = Boolean(task.locked);
  const sla = slaState(task);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => {
        onSelect();
        setExpanded((v) => !v);
      }}
      title={locked ? lockedMessage(task) : "Drag to a column, or tap then tap a column's Move here button"}
      className={cn(
        "cursor-grab select-none rounded-2xl border border-slate-200 bg-white p-3.5 transition active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800",
        "hover:border-slate-300 dark:hover:border-slate-500",
        locked && "opacity-60",
        selected && "move-selected",
        slaClass(sla),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        {locked && <LockBadge reason={lockedMessage(task)} />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {task.slaDueAt && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              sla === "overdue" && "font-semibold text-rose-600 dark:text-rose-400",
              sla === "warn" && "font-semibold text-amber-600 dark:text-amber-400",
            )}
          >
            <ClockIcon className="h-3 w-3" />
            {fmtDate(task.slaDueAt)} · {relativeDue(task.slaDueAt)}
          </span>
        )}
        {task.priority !== "normal" && <span className="uppercase tracking-wide">{task.priority}</span>}
        {task.site && <span>{task.site}</span>}
      </div>
      {expanded && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <StatusButtons task={task} onDone={() => setExpanded(false)} />
          <button
            type="button"
            onClick={() => onRoadblock({ projectId: task.projectId, task })}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
          >
            <AlertIcon className="h-4 w-4" />
            Log Roadblock
          </button>
        </div>
      )}
    </div>
  );
}

export default function Kanban({ projectId, onRoadblock }: Props) {
  const { tasks, moveTask } = useApp();
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [moveCandidate, setMoveCandidate] = useState<string | null>(null);

  const projectTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === projectId)
        .sort((a, b) => (a.slaDueAt || "9999").localeCompare(b.slaDueAt || "9999")),
    [tasks, projectId],
  );

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    projectTasks.forEach((t) => {
      (map[t.status] ?? map.todo).push(t);
    });
    return map;
  }, [projectTasks]);

  const drop = (taskId: string, status: TaskStatus) => {
    setDragOver(null);
    setMoveCandidate(null);
    void moveTask(taskId, status);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => {
        const meta = STATUS_META[status];
        const candidate = moveCandidate ? projectTasks.find((t) => t.id === moveCandidate) : null;
        const showMoveHere = Boolean(candidate) && candidate!.status !== status;
        return (
          <section
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(status);
            }}
            onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) drop(id, status);
            }}
            className={cn(
              "flex min-h-[10rem] flex-col rounded-2xl border-t-4 bg-slate-100/70 p-3 transition dark:bg-slate-800/40",
              meta.column,
              dragOver === status && "drop-target",
            )}
          >
            <header className="mb-3 flex items-center justify-between px-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                {meta.label}
              </h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                {byStatus[status].length}
              </span>
            </header>

            {showMoveHere && (
              <button
                type="button"
                onClick={() => drop(moveCandidate!, status)}
                className="mb-3 flex min-h-[44px] items-center justify-center rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                Move here
              </button>
            )}

            <div className="flex flex-1 flex-col gap-3">
              {byStatus[status].map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  selected={moveCandidate === task.id}
                  onSelect={() => setMoveCandidate((cur) => (cur === task.id ? null : task.id))}
                  onRoadblock={onRoadblock}
                />
              ))}
              {byStatus[status].length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-600">
                  Drop tasks here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
