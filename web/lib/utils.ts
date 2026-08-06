import type { Division, ProjectStatus, RoadblockSeverity, Task, TaskStatus, User } from "./types";

/** Tiny classnames helper. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A locked task may not advance into in_progress/done (governance gate). */
export function isGatedTransition(task: Pick<Task, "locked">, nextStatus: TaskStatus): boolean {
  return Boolean(task.locked) && (nextStatus === "in_progress" || nextStatus === "done");
}

/** Mirrors the server rule: only security reviewers may resolve approvals. */
export function canDecideApprovals(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "security_reviewer";
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
