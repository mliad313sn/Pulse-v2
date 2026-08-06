import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateSize = "xs" | "sm" | "md" | "lg" | "bare";

// Sizes match the placeholder blocks previously hand-rolled across the app:
// xs = kanban column, sm/md/lg = increasingly padded notices, bare = self-styled content.
const SIZE_CLASSES: Record<EmptyStateSize, string> = {
  xs: "rounded-xl p-4 text-xs text-slate-400",
  sm: "rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400",
  md: "rounded-2xl p-8 text-slate-500 dark:text-slate-400",
  lg: "rounded-2xl p-10 text-slate-500 dark:text-slate-400",
  bare: "rounded-2xl p-10",
};

/** Dashed placeholder block shown when a list or queue has nothing to display. */
export default function EmptyState({
  size = "lg",
  className,
  children,
}: {
  size?: EmptyStateSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border border-dashed border-slate-300 text-center dark:border-slate-600",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {children}
    </div>
  );
}
