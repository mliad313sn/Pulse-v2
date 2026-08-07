import type { ReactNode } from "react";
import { cn, PROJECT_STATUS_META, SEVERITY_META, STATUS_META, titleCaseTag } from "@/lib/utils";
import type { ProjectClassification, ProjectStatus, RoadblockSeverity, SecurityGateStatus, TaskStatus } from "@/lib/types";
import { EyeOffIcon, LockIcon, ShieldCheckIcon, ShieldIcon } from "./Icons";

/** Base rounded pill shell shared by every badge. */
export function Pill({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}
    >
      {children}
    </span>
  );
}

/** Rose bold count pill (open roadblocks, pending approvals). */
export function CountPill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <Pill className={cn("gap-1.5", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Pill>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const meta = PROJECT_STATUS_META[status] ?? PROJECT_STATUS_META.draft;
  return <Pill className={meta.badge}>{meta.label}</Pill>;
}

export function SeverityBadge({ severity }: { severity: RoadblockSeverity }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.medium;
  return <Pill className={cn("border", meta.chip)}>{meta.label}</Pill>;
}

export function LockBadge({ reason }: { reason: string }) {
  return (
    <Pill
      title={reason}
      className="gap-1 bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
    >
      <LockIcon className="h-3.5 w-3.5" />
      Locked
    </Pill>
  );
}

export function SecurityGateBadge({ status }: { status: SecurityGateStatus }) {
  if (status === "not_required") return null;
  if (status === "approved") {
    return (
      <Pill
        title="Security gate approved by InfoSec"
        className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
      >
        <ShieldCheckIcon className="h-3.5 w-3.5" />
        Gate approved
      </Pill>
    );
  }
  const rejected = status === "rejected";
  return (
    <Pill
      title={rejected ? "Security gate rejected by InfoSec" : "Awaiting InfoSec security approval"}
      className={cn(
        "gap-1",
        rejected
          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
      )}
    >
      <ShieldIcon className="h-3.5 w-3.5" />
      {rejected ? "Gate rejected" : "Security gate"}
    </Pill>
  );
}

/** Small badge for restricted/confidential projects (internal renders nothing). */
export function ClassificationBadge({ classification }: { classification?: ProjectClassification | null }) {
  if (classification === "restricted") {
    return (
      <Pill
        title="Restricted — visible only to authorized project members"
        className="gap-1 bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
      >
        <EyeOffIcon className="h-3.5 w-3.5" />
        Restricted
      </Pill>
    );
  }
  if (classification === "confidential") {
    return (
      <Pill
        title="Confidential — strictly need-to-know"
        className="gap-1 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
      >
        <LockIcon className="h-3.5 w-3.5" />
        Confidential
      </Pill>
    );
  }
  return null;
}

export function TagChip({ tag, tone = "indigo" }: { tag: string; tone?: "indigo" | "violet" | "rose" | "cyan" }) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  };
  return <Pill className={tones[tone]}>{titleCaseTag(tag)}</Pill>;
}
