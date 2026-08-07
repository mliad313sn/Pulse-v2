import type { ReactNode } from "react";
import {
  CAPA_STATUS_META,
  CAPA_STATUSES,
  cn,
  LIFECYCLE_META,
  LIFECYCLE_STAGES,
  MILESTONE_STATUS_META,
  MILESTONE_TYPE_META,
  OPERATING_STATUS_META,
  PROJECT_STATUS_META,
  RISK_STATUS_META,
  riskScoreTone,
  ROADBLOCK_STATUS_META,
  SEVERITY_META,
  STATUS_META,
  titleCaseTag,
  WORKSTREAM_STATUS_META,
} from "@/lib/utils";
import type {
  CapaStatus,
  GateDecision,
  LifecycleStage,
  MilestoneStatus,
  MilestoneType,
  OperatingStatus,
  ProjectClassification,
  ProjectStatus,
  RiskStatus,
  RoadblockSeverity,
  RoadblockStatus,
  SecurityGateStatus,
  TaskStatus,
  WorkstreamStatus,
} from "@/lib/types";
import { EyeOffIcon, FlagIcon, FlameIcon, LockIcon, ScaleIcon, ShieldCheckIcon, ShieldIcon } from "./Icons";

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

/** 5-state roadblock lifecycle pill (Wave 4). */
export function RoadblockStatusBadge({ status }: { status: RoadblockStatus }) {
  const meta = ROADBLOCK_STATUS_META[status] ?? ROADBLOCK_STATUS_META.RAISED;
  return (
    <Pill className={cn("gap-1.5", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Pill>
  );
}

/** Flame badge for escalated roadblocks. */
export function EscalatedBadge({ escalatedAt }: { escalatedAt?: string | null }) {
  return (
    <Pill
      title={escalatedAt ? `Escalated ${escalatedAt.slice(0, 10)}` : "Escalated to leadership"}
      className="gap-1 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
    >
      <FlameIcon className="h-3.5 w-3.5" />
      Escalated
    </Pill>
  );
}

export function RiskStatusBadge({ status }: { status: RiskStatus }) {
  const meta = RISK_STATUS_META[status] ?? RISK_STATUS_META.OPEN;
  return (
    <Pill className={cn("gap-1.5", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Pill>
  );
}

/** P×I score pill on the 1-25 color scale (≥15 rose, ≥8 amber, else slate). */
export function RiskScorePill({
  score,
  title,
  className,
}: {
  score: number | null | undefined;
  title?: string;
  className?: string;
}) {
  return (
    <Pill title={title} className={cn("font-bold tabular-nums", riskScoreTone(score), className)}>
      {typeof score === "number" ? score : "—"}
    </Pill>
  );
}

/** 6-state CAPA stepper chip — dots with the current state highlighted (like LifecycleChip). */
export function CapaStatusChip({ status }: { status: CapaStatus }) {
  const meta = CAPA_STATUS_META[status] ?? CAPA_STATUS_META.OPEN;
  const idx = CAPA_STATUSES.indexOf(status);
  return (
    <Pill
      title={`CAPA state ${idx + 1} of ${CAPA_STATUSES.length}: ${meta.label}`}
      className="gap-2 border border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
    >
      <span className="flex items-center gap-[3px]">
        {CAPA_STATUSES.map((s, i) => (
          <span
            key={s}
            className={cn(
              "rounded-full",
              i === idx ? cn("h-2 w-2", meta.dot) : "h-1.5 w-1.5",
              i < idx && "bg-slate-400 dark:bg-slate-500",
              i > idx && "bg-slate-200 dark:bg-slate-700",
            )}
          />
        ))}
      </span>
      {meta.label}
    </Pill>
  );
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

/** Mono chip for the server-generated project code (PRJ-YYYY-NNN). */
export function ProjectCodeChip({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <Pill
      title="Project code"
      className="border border-slate-300 bg-slate-50 font-mono text-[11px] tracking-tight text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
    >
      {code}
    </Pill>
  );
}

/** 7-stage lifecycle chip — stepper-style dots with the current stage highlighted. */
export function LifecycleChip({ stage }: { stage?: LifecycleStage | null }) {
  if (!stage || !LIFECYCLE_META[stage]) return null;
  const meta = LIFECYCLE_META[stage];
  const idx = LIFECYCLE_STAGES.indexOf(stage);
  return (
    <Pill
      title={`Lifecycle stage ${idx + 1} of ${LIFECYCLE_STAGES.length}: ${meta.label}`}
      className="gap-2 border border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
    >
      <span className="flex items-center gap-[3px]">
        {LIFECYCLE_STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              "rounded-full",
              i === idx ? cn("h-2 w-2", meta.dot) : "h-1.5 w-1.5",
              i < idx && "bg-slate-400 dark:bg-slate-500",
              i > idx && "bg-slate-200 dark:bg-slate-700",
            )}
          />
        ))}
      </span>
      {meta.label}
    </Pill>
  );
}

export function OperatingStatusBadge({ status }: { status?: OperatingStatus | null }) {
  if (!status || !OPERATING_STATUS_META[status]) return null;
  const meta = OPERATING_STATUS_META[status];
  return (
    <Pill title="Operating status" className={meta.badge}>
      {meta.label}
    </Pill>
  );
}

/** Milestone type chip — GO_LIVE gets a flag icon accent. */
export function MilestoneTypeBadge({ type }: { type: MilestoneType }) {
  const meta = MILESTONE_TYPE_META[type] ?? MILESTONE_TYPE_META.STANDARD;
  return (
    <Pill title="Milestone type" className={cn("gap-1", meta.badge)}>
      {type === "GO_LIVE" && <FlagIcon className="h-3.5 w-3.5" />}
      {meta.label}
    </Pill>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  const meta = MILESTONE_STATUS_META[status] ?? MILESTONE_STATUS_META.NOT_STARTED;
  return (
    <Pill className={cn("gap-1.5", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Pill>
  );
}

export function WorkstreamStatusBadge({ status }: { status: WorkstreamStatus }) {
  const meta = WORKSTREAM_STATUS_META[status] ?? WORKSTREAM_STATUS_META.NOT_STARTED;
  return (
    <Pill className={cn("gap-1.5", meta.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Pill>
  );
}

/** APPROVED (emerald) / REJECTED (rose) pill for the gate ledger + banners. */
export function GateDecisionPill({ decision }: { decision: GateDecision }) {
  const approved = decision === "APPROVED";
  return (
    <Pill
      className={
        approved
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
      }
    >
      {approved ? "Approved" : "Rejected"}
    </Pill>
  );
}

/** Steering Committee privilege chip (gate decisions requiring steering authority). */
export function SteeringPill({ className }: { className?: string }) {
  return (
    <Pill
      title="Steering Committee authority required"
      className={cn("gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300", className)}
    >
      <ScaleIcon className="h-3.5 w-3.5" />
      Steering
    </Pill>
  );
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
