import { cn, PROJECT_STATUS_META, SEVERITY_META, STATUS_META, titleCaseTag } from "@/lib/utils";
import type { ProjectStatus, RoadblockSeverity, SecurityGateStatus, TaskStatus } from "@/lib/types";
import { LockIcon, ShieldCheckIcon, ShieldIcon } from "./Icons";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const meta = PROJECT_STATUS_META[status] ?? PROJECT_STATUS_META.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", meta.badge)}>
      {meta.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: RoadblockSeverity }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.medium;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.chip)}>
      {meta.label}
    </span>
  );
}

export function LockBadge({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
    >
      <LockIcon className="h-3.5 w-3.5" />
      Locked
    </span>
  );
}

export function SecurityGateBadge({ status }: { status: SecurityGateStatus }) {
  if (status === "not_required") return null;
  if (status === "approved") {
    return (
      <span
        title="Security gate approved by InfoSec"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
      >
        <ShieldCheckIcon className="h-3.5 w-3.5" />
        Gate approved
      </span>
    );
  }
  const rejected = status === "rejected";
  return (
    <span
      title={rejected ? "Security gate rejected by InfoSec" : "Awaiting InfoSec security approval"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        rejected
          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
      )}
    >
      <ShieldIcon className="h-3.5 w-3.5" />
      {rejected ? "Gate rejected" : "Security gate"}
    </span>
  );
}

export function TagChip({ tag, tone = "indigo" }: { tag: string; tone?: "indigo" | "violet" | "rose" | "cyan" }) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {titleCaseTag(tag)}
    </span>
  );
}
