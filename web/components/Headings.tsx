import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Uppercase slate section heading used above dashboard sections. */
export function SectionHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2
      className={cn(
        "mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
        className,
      )}
    >
      {children}
    </h2>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional right-aligned slot (buttons). Switches the wrapper to a flex row. */
  action?: ReactNode;
  className?: string;
  titleClassName?: string;
  /** Extra classes for the title+subtitle block when an action is present. */
  innerClassName?: string;
}

/** Page title (h1) with optional subtitle and action slot. */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
  titleClassName,
  innerClassName,
}: PageHeaderProps) {
  const heading = (
    <>
      <h1 className={cn("text-2xl font-bold tracking-tight", titleClassName)}>{title}</h1>
      {subtitle != null && <p className="mt-1 text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </>
  );

  if (!action) return <div className={cn("mb-6", className)}>{heading}</div>;

  return (
    <div className={cn("flex flex-wrap justify-between gap-4", className)}>
      <div className={innerClassName}>{heading}</div>
      {action}
    </div>
  );
}
