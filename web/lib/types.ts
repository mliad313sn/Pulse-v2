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

export type BaseRole = "ADMIN" | "DIVISION_LEAD" | "CONTRIBUTOR" | "VIEWER";

/** Privilege modifiers layered on top of the base role. */
export type Privilege = "security_reviewer" | "steering" | (string & {});

export interface User {
  id: string;
  name: string;
  baseRole: BaseRole;
  privileges: Privilege[];
  isActive: boolean;
  mustChangePassword?: boolean;
  division: Division;
  site?: string | null;
  email?: string;
  /** Optional only for stale local caches — the server always sends it. */
  enterpriseAccess?: boolean;
}

/** POST /api/users response — the temporary password is shown ONCE, never stored. */
export interface CreateUserResponse {
  user: User;
  temporaryPassword: string;
}

/** POST /api/auth/login response. */
export interface LoginResponse {
  user: User;
  mustChangePassword: boolean;
}

export type ProjectClassification = "internal" | "restricted" | "confidential";

export type LifecycleStage =
  | "IDEA"
  | "INITIATION"
  | "PLANNING"
  | "EXECUTION"
  | "DEPLOYMENT"
  | "RUN"
  | "CLOSED";

export type OperatingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  /** Server-generated PRJ-YYYY-NNN code. Optional only for stale local caches. */
  code?: string;
  division: Division;
  site?: string | null;
  cgeitTag?: string | null;
  strategicTag?: string | null;
  riskTags: string[];
  /** Optional only for stale local caches — the server always sends it. */
  classification?: ProjectClassification;
  overallStatus: ProjectStatus;
  securityGateStatus: SecurityGateStatus;
  ownerId?: string | null;
  portfolioId?: string | null;
  programId?: string | null;
  sponsorId?: string | null;
  pmId?: string | null;
  /** Optional only for stale local caches — the server always sends them. */
  lifecycleStage?: LifecycleStage;
  operatingStatus?: OperatingStatus;
  engagedDivisions?: string[];
  sites?: string[];
  version: number;
  updatedAt: string;
  createdAt?: string;
}

// ---- Portfolio hierarchy (Wave 1 slice 2) ----------------------------------

export interface StrategicPillar {
  id: string;
  name: string;
  description?: string | null;
}

export interface Portfolio {
  id: string;
  title: string;
  description?: string | null;
  pillarId?: string | null;
  ownerId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface Program {
  id: string;
  title: string;
  objective?: string | null;
  portfolioId: string;
  ownerId?: string | null;
}

export type ProjectRole =
  | "PM"
  | "SPONSOR"
  | "WORKSTREAM_LEAD"
  | "CONTRIBUTOR"
  | "SME"
  | "FINANCE_CONTROLLER"
  | "SECURITY_REVIEWER"
  | "SITE_LEAD"
  | "AUDITOR"
  | "APPROVER"
  | "INFORMED";

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectRole;
}

// GET /api/org/tree — sites + divisions for the Admin Center Organization tab.
// Shape kept tolerant: sites may arrive nested under divisions or top-level.

export interface OrgSite {
  id: string;
  name: string;
  divisionId?: string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface OrgDivision {
  id: string;
  name: string;
  sites?: OrgSite[];
  isActive?: boolean;
  [key: string]: unknown;
}

export interface OrgTree {
  divisions: OrgDivision[];
  sites: OrgSite[];
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
