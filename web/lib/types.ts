// Contract types — mirrors docs/API_CONTRACT.md exactly (camelCase over the wire).

export type Division =
  | "ops"
  | "infra"
  | "ea"
  | "infosec"
  | "data"
  | "bizapps"
  | "management"
  | (string & {});

export type ProjectStatus = "draft" | "active" | "at_risk" | "on_hold" | "complete";
export type SecurityGateStatus = "not_required" | "pending" | "approved" | "rejected";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high" | "critical";
export type RoadblockSeverity = "low" | "medium" | "high" | "critical";
export type RoadblockStatus = "open" | "mitigating" | "resolved";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface User {
  id: string;
  name: string;
  role: string;
  division: Division;
  site?: string | null;
  email?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  division: Division;
  site?: string | null;
  cgeitTag?: string | null;
  strategicTag?: string | null;
  riskTags: string[];
  overallStatus: ProjectStatus;
  securityGateStatus: SecurityGateStatus;
  ownerId?: string | null;
  version: number;
  updatedAt: string;
  createdAt?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  division?: Division | null;
  site?: string | null;
  assigneeId?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dependencyLock?: string | null;
  riskTags?: string[];
  slaDueAt?: string | null;
  version: number;
  updatedAt: string;
  createdAt?: string;
  /** Server-derived: prerequisite not done OR project security gate pending. */
  locked?: boolean;
}

/** Target for the "Log Roadblock" sheet — a project, optionally scoped to a task. */
export interface RoadblockTarget {
  projectId: string;
  task?: Task | null;
}

export interface Roadblock {
  id: string;
  projectId: string;
  taskId?: string | null;
  description: string;
  severity: RoadblockSeverity;
  status: RoadblockStatus;
  reportedBy?: string | null;
  version: number;
  updatedAt: string;
  createdAt?: string;
}

export interface SecurityApproval {
  id: string;
  projectId: string;
  taskId?: string | null;
  riskTag?: string | null;
  status: ApprovalStatus;
  requestedAt?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  notes?: string | null;
}

export interface Bootstrap {
  user: User;
  projects: Project[];
  tasks: Task[];
  roadblocks: Roadblock[];
  approvals: SecurityApproval[];
  serverTime: string;
}

export type SyncEntity = "task" | "project" | "roadblock";

/** Outbox operation — exact wire shape of an item in POST /api/sync `operations`. */
export interface SyncOp {
  opId: string;
  entity: SyncEntity;
  entityId: string;
  op: "update" | "create";
  baseVersion: number;
  clientUpdatedAt: string;
  fields: Record<string, unknown>;
}

/** Outbox row = wire op + local ordering metadata. */
export interface QueuedOp extends SyncOp {
  queuedAt: number;
}

export type SyncResultKind = "applied" | "lww_applied" | "conflict_manual" | "rejected";

export interface SyncResult {
  opId: string;
  result: SyncResultKind;
  entity: SyncEntity;
  entityId: string;
  serverState?: Record<string, unknown> | null;
  error?: string | null;
}

export interface ConflictEntry {
  opId: string;
  entity: SyncEntity;
  entityId: string;
  fields: Record<string, unknown>;
  clientUpdatedAt: string;
  serverState: Record<string, unknown>;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  entityId?: string;
  entity?: string;
  action?: string;
  actorId?: string;
  at?: string;
  createdAt?: string;
  detail?: unknown;
  [key: string]: unknown;
}
