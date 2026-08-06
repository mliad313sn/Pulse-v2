"use client";

import { useApp } from "@/lib/store";
import { cn, STATUS_META, TASK_STATUSES } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/types";
import { LockIcon } from "./Icons";

const ACTIVE_STYLES: Record<TaskStatus, string> = {
  todo: "bg-slate-600 text-white border-slate-600",
  in_progress: "bg-blue-600 text-white border-blue-600",
  blocked: "bg-amber-500 text-white border-amber-500",
  done: "bg-emerald-600 text-white border-emerald-600",
};

/** Quick one-tap status switcher. Every target is >= 44px tall (touch friendly). */
export default function StatusButtons({ task, onDone }: { task: Task; onDone?: () => void }) {
  const { moveTask, lockedMessage } = useApp();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TASK_STATUSES.map((status) => {
        const meta = STATUS_META[status];
        const isCurrent = task.status === status;
        const gated = Boolean(task.locked) && (status === "in_progress" || status === "done");
        return (
          <button
            key={status}
            type="button"
            disabled={isCurrent}
            title={gated ? lockedMessage(task) : `Set status: ${meta.label}`}
            onClick={(e) => {
              e.stopPropagation();
              void moveTask(task.id, status).then((r) => {
                if (r.ok && onDone) onDone();
              });
            }}
            className={cn(
              "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition",
              isCurrent
                ? ACTIVE_STYLES[status]
                : gated
                  ? "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-400",
            )}
          >
            {gated && !isCurrent && <LockIcon className="h-3.5 w-3.5" />}
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
