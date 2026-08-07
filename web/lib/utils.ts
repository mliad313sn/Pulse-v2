import type {
  DependencyType,
  Division,
  LifecycleStage,
  Milestone,
  MilestoneStatus,
  MilestoneType,
  OperatingStatus,
  Project,
  ProjectMember,
  ProjectProgress,
  ProjectRole,
  ProjectStatus,
  RoadblockSeverity,
  Task,
  TaskStatus,
  User,
  WorkstreamStatus,
} from "./types";

/** Tiny classnames helper. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A locked task may not advance into in_progress/done (governance gate). */
export function isGatedTransition(task: Pick<Task, "locked">, nextStatus: TaskStatus): boolean {
  return Boolean(task.locked) && (nextStatus === "in_progress" || nextStatus === "done");
}

/** Mirrors the server rule: only the security_reviewer privilege may resolve approvals. */
export function canDecideApprovals(user: Pick<User, "privileges"> | null | undefined): boolean {
  return (user?.privileges ?? []).includes("security_reviewer");
}

/** VIEWER is hard read-only (server enforces; this only hides/disables affordances). */
export function canWriteUser(user: Pick<User, "baseRole"> | null | undefined): boolean {
  return Boolean(user) && user!.baseRole !== "VIEWER";
}

/** Project create is ADMIN or DIVISION_LEAD (server enforces; hides the button otherwise). */
export function canCreateProject(user: Pick<User, "baseRole"> | null | undefined): boolean {
  return user?.baseRole === "ADMIN" || user?.baseRole === "DIVISION_LEAD";
}

/** Member-management affordances: ADMIN, DIVISION_LEAD, or the project's PM (server enforces). */
export function canManageProject(
  user: Pick<User, "id" | "baseRole"> | null | undefined,
  project: Pick<Project, "pmId"> | null | undefined,
  members: ProjectMember[] = [],
): boolean {
  if (!user) return false;
  if (user.baseRole === "ADMIN" || user.baseRole === "DIVISION_LEAD") return true;
  if (project?.pmId && project.pmId === user.id) return true;
  return members.some((m) => m.role === "PM" && m.userId === user.id);
}

const BASE_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  DIVISION_LEAD: "Division Lead",
  CONTRIBUTOR: "Contributor",
  VIEWER: "Viewer",
};

export function baseRoleLabel(role: string | null | undefined): string {
  return BASE_ROLE_LABELS[role ?? ""] ?? (role || "");
}

// Safe localStorage wrappers — no-ops when storage is unavailable (SSR, private mode).

export function safeLocalGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function safeLocalRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; badge: string; column: string }
> = {
  todo: {
    label: "To do",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200",
    column: "border-slate-300 dark:border-slate-600",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    column: "border-blue-300 dark:border-blue-700",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
    column: "border-amber-300 dark:border-amber-700",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    column: "border-emerald-300 dark:border-emerald-700",
  },
};

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; badge: string }> = {
  draft: { label: "Draft", badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300" },
  active: { label: "Active", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" },
  at_risk: { label: "At risk", badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300" },
  on_hold: { label: "On hold", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300" },
  complete: { label: "Complete", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" },
};

/** Ordered 7-stage lifecycle (drives the stepper-style chip on project pages). */
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  "IDEA",
  "INITIATION",
  "PLANNING",
  "EXECUTION",
  "DEPLOYMENT",
  "RUN",
  "CLOSED",
];

export const LIFECYCLE_META: Record<LifecycleStage, { label: string; dot: string }> = {
  IDEA: { label: "Idea", dot: "bg-slate-400" },
  INITIATION: { label: "Initiation", dot: "bg-cyan-500" },
  PLANNING: { label: "Planning", dot: "bg-indigo-500" },
  EXECUTION: { label: "Execution", dot: "bg-blue-500" },
  DEPLOYMENT: { label: "Deployment", dot: "bg-violet-500" },
  RUN: { label: "Run", dot: "bg-emerald-500" },
  CLOSED: { label: "Closed", dot: "bg-slate-500" },
};

export const OPERATING_STATUS_META: Record<OperatingStatus, { label: string; badge: string }> = {
  NOT_STARTED: {
    label: "Not started",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
  },
  IN_PROGRESS: {
    label: "In progress",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  },
  ON_HOLD: {
    label: "On hold",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  },
  COMPLETED: {
    label: "Completed",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  },
};

/** Mirrors the server rule: only the steering privilege may decide steering gates. */
export function hasSteering(user: Pick<User, "privileges"> | null | undefined): boolean {
  return (user?.privileges ?? []).includes("steering");
}

// ---- Milestones (Wave 2 governance) -----------------------------------------

export const MILESTONE_TYPES: MilestoneType[] = [
  "STANDARD",
  "SECURITY_GATE",
  "SITE_READINESS",
  "UAT",
  "GO_LIVE",
  "GOVERNANCE_GATE",
  "OPERATIONAL_HANDOVER",
];

export const MILESTONE_TYPE_META: Record<MilestoneType, { label: string; badge: string }> = {
  STANDARD: {
    label: "Standard",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
  },
  SECURITY_GATE: {
    label: "Security Gate",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  },
  SITE_READINESS: {
    label: "Site Readiness",
    badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  },
  UAT: {
    label: "UAT",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  },
  GO_LIVE: {
    label: "Go-Live",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  },
  GOVERNANCE_GATE: {
    label: "Governance Gate",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  },
  OPERATIONAL_HANDOVER: {
    label: "Ops Handover",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  },
};

export const MILESTONE_STATUS_META: Record<MilestoneStatus, { label: string; badge: string; dot: string }> = {
  NOT_STARTED: {
    label: "Not started",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  IN_PROGRESS: {
    label: "In progress",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  DONE: {
    label: "Done",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  SLIPPED: {
    label: "Slipped",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

/** Quick-advance transitions for the milestone list (server enforces rules). */
export const MILESTONE_NEXT: Partial<Record<MilestoneStatus, { label: string; next: MilestoneStatus }>> = {
  NOT_STARTED: { label: "Start", next: "IN_PROGRESS" },
  IN_PROGRESS: { label: "Mark done", next: "DONE" },
  SLIPPED: { label: "Mark done", next: "DONE" },
};

/** Slipped = flagged by status, or forecast now later than the baseline commitment. */
export function isMilestoneSlipped(
  m: Pick<Milestone, "status" | "baselineDue" | "forecastDue">,
): boolean {
  if (m.status === "SLIPPED") return true;
  if (m.status === "DONE" || m.status === "CANCELLED") return false;
  if (!m.baselineDue || !m.forecastDue) return false;
  const base = Date.parse(m.baselineDue);
  const forecast = Date.parse(m.forecastDue);
  return !Number.isNaN(base) && !Number.isNaN(forecast) && forecast > base;
}

/**
 * Client fallback for stale caches missing the server-derived `progress`.
 * Mirrors the server formula: completedWeight / activeWeight (CANCELLED excluded).
 */
export function computeProgress(milestones: Milestone[]): ProjectProgress {
  const active = milestones.filter((m) => m.status !== "CANCELLED");
  const activeWeight = active.reduce((sum, m) => sum + (m.weight || 0), 0);
  const completedWeight = active
    .filter((m) => m.status === "DONE")
    .reduce((sum, m) => sum + (m.weight || 0), 0);
  if (active.length === 0 || activeWeight <= 0) {
    return { percent: null, completedWeight: 0, activeWeight: 0, explanation: "No milestones yet" };
  }
  const percent = Math.round((completedWeight / activeWeight) * 100);
  return {
    percent,
    completedWeight,
    activeWeight,
    explanation: `${completedWeight} of ${activeWeight} weight completed across ${active.length} milestone${active.length === 1 ? "" : "s"}`,
  };
}

// ---- Workstreams + dependencies (Wave 3 planning) ---------------------------

export const WORKSTREAM_STATUSES: WorkstreamStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "DONE",
  "ON_HOLD",
];

export const WORKSTREAM_STATUS_META: Record<
  WorkstreamStatus,
  { label: string; badge: string; dot: string }
> = {
  NOT_STARTED: {
    label: "Not started",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  IN_PROGRESS: {
    label: "In progress",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  DONE: {
    label: "Done",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  ON_HOLD: {
    label: "On hold",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
    dot: "bg-amber-500",
  },
};

export const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: "Finish → Start",
  SS: "Start → Start",
  FF: "Finish → Finish",
  SF: "Start → Finish",
};

/** Project member roles in display order (PM/SPONSOR first). */
export const PROJECT_ROLES: ProjectRole[] = [
  "PM",
  "SPONSOR",
  "WORKSTREAM_LEAD",
  "CONTRIBUTOR",
  "SME",
  "FINANCE_CONTROLLER",
  "SECURITY_REVIEWER",
  "SITE_LEAD",
  "AUDITOR",
  "APPROVER",
  "INFORMED",
];

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  PM: "Project Manager",
  SPONSOR: "Sponsor",
  WORKSTREAM_LEAD: "Workstream Lead",
  CONTRIBUTOR: "Contributor",
  SME: "SME",
  FINANCE_CONTROLLER: "Finance Controller",
  SECURITY_REVIEWER: "Security Reviewer",
  SITE_LEAD: "Site Lead",
  AUDITOR: "Auditor",
  APPROVER: "Approver",
  INFORMED: "Informed",
};

export function projectRoleLabel(role: string | null | undefined): string {
  return PROJECT_ROLE_LABELS[role as ProjectRole] ?? titleCaseTag(String(role ?? ""));
}

/** Shared text-input styling for dialogs/forms (matches ChangePasswordScreen). */
export const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-indigo-900";

export const SEVERITIES: RoadblockSeverity[] = ["low", "medium", "high", "critical"];

export const SEVERITY_META: Record<RoadblockSeverity, { label: string; chip: string; selected: string }> = {
  low: {
    label: "Low",
    chip: "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300",
    selected: "bg-slate-600 border-slate-600 text-white",
  },
  medium: {
    label: "Medium",
    chip: "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400",
    selected: "bg-amber-500 border-amber-500 text-white",
  },
  high: {
    label: "High",
    chip: "border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400",
    selected: "bg-orange-500 border-orange-500 text-white",
  },
  critical: {
    label: "Critical",
    chip: "border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-400",
    selected: "bg-rose-600 border-rose-600 text-white",
  },
};

export const DIVISION_META: Record<string, { label: string; short: string; accent: string }> = {
  ops: { label: "Operations", short: "OPS", accent: "bg-emerald-500" },
  infra: { label: "Infrastructure", short: "INF", accent: "bg-blue-500" },
  ea: { label: "Enterprise Architecture", short: "EA", accent: "bg-indigo-500" },
  infosec: { label: "Information Security", short: "SEC", accent: "bg-rose-500" },
  data: { label: "Data Insight", short: "DAT", accent: "bg-cyan-500" },
  bizapps: { label: "Business Apps", short: "APP", accent: "bg-violet-500" },
  management: { label: "Group IT Management", short: "MGT", accent: "bg-amber-500" },
};

export function divisionMeta(division: Division | null | undefined) {
  return DIVISION_META[division || ""] || { label: division || "Unknown", short: "?", accent: "bg-slate-500" };
}

export type SlaState = "warn" | "overdue" | null;

/** amber pulsing within 48h of slaDueAt (and not done); red when overdue. */
export function slaState(task: Pick<Task, "slaDueAt" | "status">): SlaState {
  if (!task.slaDueAt || task.status === "done") return null;
  const due = Date.parse(task.slaDueAt);
  if (Number.isNaN(due)) return null;
  const now = Date.now();
  if (due < now) return "overdue";
  if (due - now <= 48 * 3600 * 1000) return "warn";
  return null;
}

export function slaClass(state: SlaState): string {
  if (state === "warn") return "sla-warn";
  if (state === "overdue") return "sla-overdue";
  return "";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDue(iso: string | null | undefined): string {
  if (!iso) return "";
  const due = Date.parse(iso);
  if (Number.isNaN(due)) return "";
  const diff = due - Date.now();
  const abs = Math.abs(diff);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const span = hours < 48 ? `${hours}h` : `${days}d`;
  return diff < 0 ? `overdue by ${span}` : `due in ${span}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function titleCaseTag(tag: string): string {
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
