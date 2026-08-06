"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { cn, STATUS_META, TASK_STATUSES } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/types";
import TaskCard from "./TaskCard";
import EmptyState from "./EmptyState";

export default function Kanban({ projectId }: { projectId: string }) {
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
                <TaskCard
                  key={task.id}
                  task={task}
                  variant="board"
                  selected={moveCandidate === task.id}
                  onSelect={() => setMoveCandidate((cur) => (cur === task.id ? null : task.id))}
                  dragProps={{
                    draggable: true,
                    onDragStart: (e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                    },
                  }}
                />
              ))}
              {byStatus[status].length === 0 && <EmptyState size="xs">Drop tasks here</EmptyState>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
