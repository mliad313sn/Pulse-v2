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

// ---- RAG health (Wave 3) ----------------------------------------------------

export type RagColor = "GREEN" | "AMBER" | "RED";

/** One contributing signal in the server-side RAG computation. */
export interface RagSignal {
  key: string;
  color: RagColor;
  label: string;
  explanation: string;
}

/** Manual RAG override (manage-level users; server records who/when/why). */
export interface RagManual {
  color: RagColor;
  reason: string;
  byId: string;
  at: string;
}

/** Derived, read-only RAG health rollup on every project payload. */
export interface ProjectRag {
  /** Effective color (manual override wins over computed). */
  color: RagColor;
  computedColor: RagColor;
  manual: RagManual | null;
  signals: RagSignal[];
  explanation: string;
}

/** One row of GET /api/projects/:id/rag-history (newest first). */
export interface RagHistoryEntry {
  color: RagColor;
  computedColor: RagColor;
  isManual: boolean;
  capturedAt: string;
}

// ---- Project updates (Wave 3 — append-only, ONLINE-ONLY) --------------------

export type UpdateMood = "POSITIVE" | "NEUTRAL" | "CONCERN" | "CRITICAL";

export interface ProjectUpdate {
  id: string;
  projectId: string;
  authorId: string;
  mood: UpdateMood;
  /** One sentence, max 400 chars. */
  text: string;
  accomplishment?: string | null;
  nextStep?: string | null;
  supportRequired?: string | null;
  createdAt: string;
}

/** Derived, read-only rollup computed server-side from milestone weights. */
export interface ProjectProgress {
  /** null when the project has no active milestones. */
  percent: number | null;
  completedWeight: number;
  activeWeight: number;
  explanation: string;
}

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
  // ---- Wave 2 governance fields ----
  startDate?: string | null;
  targetDate?: string | null;
  actualEndDate?: string | null;
  acceptanceCriteria?: string | null;
  deploymentPlan?: string | null;
  supportOwnerId?: string | null;
  closureSummary?: string | null;
  cancelReason?: string | null;
  holdReason?: string | null;
  /** Derived server-side from milestones — never editable client-side. */
  progress?: ProjectProgress;
  /** Derived server-side RAG health — never editable client-side (optional only for stale caches). */
  rag?: ProjectRag;
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
  // ---- Wave 3 planning fields ----
  workstreamId?: string | null;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  estimatedHours?: number | null;
  version: number;
  updatedAt: string;
  createdAt?: string;
  /** Server-derived: prerequisite not done OR project security gate pending. */
  locked?: boolean;
}

// ---- Workstreams + dependencies + schedule (Wave 3) -------------------------

export type WorkstreamStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "ON_HOLD";

export interface Workstream {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  leadId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status: WorkstreamStatus;
  version: number;
  updatedAt: string;
  createdAt?: string;
}

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface TaskDependency {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

/** One row of GET /api/projects/:id/schedule (CPM output, server-computed). */
export interface ScheduleTask {
  taskId: string;
  earliestStart: string;
  earliestFinish: string;
  latestStart: string;
  latestFinish: string;
  slackDays: number;
  critical: boolean;
}

export interface ScheduleResponse {
  tasks: ScheduleTask[];
  criticalPath: string[];
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

// ---- Milestones (Wave 2 governance) ----------------------------------------

export type MilestoneType =
  | "STANDARD"
  | "SECURITY_GATE"
  | "SITE_READINESS"
  | "UAT"
  | "GO_LIVE"
  | "GOVERNANCE_GATE"
  | "OPERATIONAL_HANDOVER";

export type MilestoneStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DONE"
  | "SLIPPED"
  | "CANCELLED";

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  type: MilestoneType;
  status: MilestoneStatus;
  ownerId?: string | null;
  baselineDue?: string | null;
  forecastDue?: string | null;
  actualCompleted?: string | null;
  weight: number;
  version: number;
  updatedAt: string;
  createdAt?: string;
}

// ---- Stage gates (Wave 2 governance) ----------------------------------------

export type GateId = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";

export interface GateRequirement {
  key: string;
  label: string;
  satisfied: boolean;
  detail?: string | null;
}

export type GateDecision = "APPROVED" | "REJECTED";

/** A pending (or decided) request to pass a stage gate. Shape kept tolerant. */
export interface GateRequest {
  id: string;
  projectId?: string;
  gate?: GateId | null;
  fromStage?: LifecycleStage;
  toStage?: LifecycleStage;
  status?: string;
  note?: string | null;
  dispositionNote?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  [key: string]: unknown;
}

/** GET /api/projects/:id/gates */
export interface GateStatus {
  stage: LifecycleStage;
  nextStage: LifecycleStage | null;
  gate: GateId | null;
  requirements: GateRequirement[];
  steeringRequired: boolean;
  pendingRequest?: GateRequest | null;
}

/** GET /api/projects/:id/ledger — immutable approval record. */
export interface LedgerEntry {
  id: string;
  gate: GateId | null;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  decision: GateDecision;
  decidedBy?: string | null;
  decidedAt?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  authorityType?: string | null;
  note?: string | null;
}

export interface Bootstrap {
  user: User;
  projects: Project[];
  tasks: Task[];
  roadblocks: Roadblock[];
  approvals: SecurityApproval[];
  milestones?: Milestone[];
  workstreams?: Workstream[];
  dependencies?: TaskDependency[];
  /** Latest ~20 updates per project. */
  updates?: ProjectUpdate[];
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
