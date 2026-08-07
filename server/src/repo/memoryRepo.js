/**
 * In-memory repository — fixtures mirror db/init/02_seed.sql (same UUIDs),
 * INCLUDING the effects the DB triggers would have applied at seed time
 * (project 2 carries 'network_alteration' -> pending approval + gate pending
 * + version bump). Deep-clones on read and write so callers can never alias
 * internal state. Audit is an immutable push-only ledger.
 */
import { randomUUID } from 'node:crypto';
import { createAuditLedger } from '../services/audit.js';
import { TABLES } from './tables.js';

const clone = (v) => (v == null ? v : structuredClone(v));

/** Recursively freeze (approval-ledger immutability backstop, invariant 11). */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const DIVISIONS = [
  { code: 'ops', name: 'Operations', description: 'Day-to-day site management' },
  { code: 'infra', name: 'Infrastructure', description: 'Networks and systems deployment' },
  { code: 'ea', name: 'Enterprise Architecture', description: 'Future design and strategic blueprint' },
  { code: 'infosec', name: 'Information Security', description: 'Cyber defense and governance' },
  { code: 'data', name: 'Data Insight', description: 'Business intelligence' },
  { code: 'bizapps', name: 'Business Apps', description: 'ERP integration' },
  { code: 'management', name: 'Group IT Management', description: 'Executive oversight' },
];

export const SITES = [
  { code: 'sabodala', name: 'Sabodala Mine Site', description: null },
  { code: 'saly', name: 'Saly Site', description: null },
  { code: 'hq', name: 'Group IT HQ', description: null },
];

function seedFixtures() {
  const t0 = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // "yesterday"
  const u = (n) => `00000000-0000-0000-0000-00000000000${n}`;

  const base = {
    privileges: [], isActive: true, mustChangePassword: false,
    enterpriseAccess: true, createdAt: t0,
  };
  // Base roles per ADR-004 mapping — keep in sync with db/init/02_seed.sql.
  const users = [
    { id: u(1), name: 'Awa Ndiaye', email: 'awa.ndiaye@opspm360.local', division: 'ops', site: 'sabodala', baseRole: 'CONTRIBUTOR', ...base },
    { id: u(2), name: 'Moussa Diallo', email: 'moussa.diallo@opspm360.local', division: 'infra', site: 'saly', baseRole: 'DIVISION_LEAD', ...base },
    { id: u(3), name: 'Hamady Soumare', email: 'hamady.soumare@opspm360.local', division: 'infosec', site: 'hq', baseRole: 'CONTRIBUTOR', ...base, privileges: ['security_reviewer'] },
    { id: u(4), name: 'Troy Coordinator', email: 'troy@opspm360.local', division: 'management', site: 'hq', baseRole: 'ADMIN', ...base },
    { id: u(5), name: 'Fatou Sarr', email: 'fatou.sarr@opspm360.local', division: 'data', site: 'hq', baseRole: 'DIVISION_LEAD', ...base },
    { id: u(6), name: 'Ibrahima Ba', email: 'ibrahima.ba@opspm360.local', division: 'bizapps', site: 'hq', baseRole: 'CONTRIBUTOR', ...base },
    // E05 invariant 4: Aminata holds 'steering'; Troy stays ADMIN WITHOUT it.
    { id: u(7), name: 'Aminata Fall', email: 'aminata.fall@opspm360.local', division: 'ea', site: 'hq', baseRole: 'DIVISION_LEAD', ...base, privileges: ['steering'] },
    { id: u(8), name: 'Aissatou Diop', email: 'viewer@opspm360.local', division: 'management', site: 'hq', baseRole: 'VIEWER', ...base },
  ];

  // Same bcrypt hashes as db/init/02_seed.sql (dev passwords "Dev!<firstname>2026";
  // see the SQL comment / server/README.md). Precomputed so seeding stays fast.
  const credentials = [
    { userId: u(1), passwordHash: '$2b$10$VdbJjev4Wfz5o6CvSSF1sOfJoM/L5Q5Iib2EQxr3TaGmFYYG/qA1u' }, // Dev!Awa2026
    { userId: u(2), passwordHash: '$2b$10$KNfGt2/C4p90.1xmt73/7.8nb7a9Vz9f58Mp9ei62420w/W1stitG' }, // Dev!Moussa2026
    { userId: u(3), passwordHash: '$2b$10$BDaHTWpwHXuz.U/W.YSaW./EoE3QK6Hjta.q8rgY3N3/jU3QghLnW' }, // Dev!Hamady2026
    { userId: u(4), passwordHash: '$2b$10$KihyVGlZQaiqH8Bihf26COg78gAiWd1vtAjHWWADb9V.zx6Pp28Wy' }, // Dev!Troy2026
    { userId: u(5), passwordHash: '$2b$10$RkzH32eVTcosljPXTTndSOl1S8VqFV.JIVIy5zq2wgg/7CPqQ2pj6' }, // Dev!Fatou2026
    { userId: u(6), passwordHash: '$2b$10$Pa07A7RaIHeKIWustQ83cuxH5lMhTZ1WylYls0ggzu6tG415WIM3S' }, // Dev!Ibrahima2026
    { userId: u(7), passwordHash: '$2b$10$gA8k1kzBqRJPQUh.tZvd3uoBy2XLL3eeA8i.WGedvn8qJG07hadIO' }, // Dev!Aminata2026
    { userId: u(8), passwordHash: '$2b$10$60lEYqbFOashKXtg0YavEO/RpGgYqbKHkiHf3/oUkH7LvWi8N3jra' }, // Dev!Aissatou2026
  ].map((c) => ({ ...c, failedCount: 0, firstFailedAt: null, lockedUntil: null, updatedAt: t0 }));

  // E04 project fields shared by every seed row (mirrors the SQL defaults).
  const projBase = {
    portfolioId: null, programId: null, sponsorId: null,
    lifecycleStage: 'IDEA', operatingStatus: 'NOT_STARTED',
    engagedDivisions: [], sites: [],
    // E05 governance fields (mirror the SQL column defaults).
    startDate: null, targetDate: null, actualEndDate: null,
    acceptanceCriteria: null, deploymentPlan: null, supportOwnerId: null,
    closureSummary: null, cancelReason: null, holdReason: null,
    // E10: manual RAG override {color, reason, byId, at} | null (server-managed).
    ragOverride: null,
  };
  const projects = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      code: 'PRJ-2026-001',
      name: 'Saly Site Readiness',
      description: 'Physical site preparation: cabling paths, server room environmentals, power.',
      division: 'ops', site: 'saly', cgeitTag: 'resource_optimization', strategicTag: null,
      riskTags: [], classification: 'internal', overallStatus: 'active', securityGateStatus: 'not_required',
      ownerId: u(1), ...projBase, version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      // DB trigger route_security_review fired at seed time:
      // gate -> pending, version 1 -> 2, pending approval created below.
      id: '10000000-0000-0000-0000-000000000002',
      code: 'PRJ-2026-002',
      name: 'Saly Core Network Deployment',
      description: 'New core switching and WAN uplink for Saly site.',
      division: 'infra', site: 'saly', cgeitTag: 'risk_optimization', strategicTag: 'EA-BLUEPRINT-NET-2026',
      riskTags: ['network_alteration'], classification: 'internal', overallStatus: 'active', securityGateStatus: 'pending',
      ownerId: u(2), ...projBase, version: 2, updatedAt: t0, createdAt: t0,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      code: 'PRJ-2026-003',
      name: 'ERP Maintenance Module Rollout',
      description: 'Deploy ERP maintenance planning module once operational bandwidth allows.',
      division: 'bizapps', site: 'sabodala', cgeitTag: 'value_delivery', strategicTag: null,
      riskTags: [], classification: 'internal', overallStatus: 'active', securityGateStatus: 'not_required',
      ownerId: u(6), ...projBase, version: 1, updatedAt: t0, createdAt: t0,
    },
  ];

  const tasks = [
    {
      id: '20000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000001',
      title: 'Complete server room site prep (power + cooling)',
      description: null, division: 'ops', site: 'saly', assigneeId: u(1),
      status: 'in_progress', priority: 'high', dependencyLock: null,
      workstreamId: null, plannedStart: null, plannedFinish: null, estimatedHours: null,
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      id: '20000000-0000-0000-0000-000000000002',
      projectId: '10000000-0000-0000-0000-000000000002',
      title: 'Install core switches and bring up WAN uplink',
      description: null, division: 'infra', site: 'saly', assigneeId: u(2),
      status: 'todo', priority: 'critical',
      dependencyLock: '20000000-0000-0000-0000-000000000001',
      workstreamId: null, plannedStart: null, plannedFinish: null, estimatedHours: null,
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      id: '20000000-0000-0000-0000-000000000003',
      projectId: '10000000-0000-0000-0000-000000000003',
      title: 'Validate ERP module in staging',
      description: null, division: 'bizapps', site: 'hq', assigneeId: u(6),
      status: 'todo', priority: 'normal', dependencyLock: null,
      workstreamId: null, plannedStart: null, plannedFinish: null, estimatedHours: null,
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
  ];

  const roadblocks = [
    {
      // E11 lifecycle enum migration (ADR-007): the seed row's old status
      // 'open' maps to 'RAISED' (open->RAISED, mitigating->IN_PROGRESS,
      // resolved->RESOLVED). Keep in sync with db/init/02_seed.sql.
      id: '30000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000001',
      taskId: '20000000-0000-0000-0000-000000000001',
      description: 'Cooling unit delivery delayed at customs',
      severity: 'high', status: 'RAISED', reportedBy: u(1),
      ownerId: null, dueDate: null, impact: null,
      resolutionApproach: null, resolutionNote: null,
      escalated: false, escalatedAt: null, reopenReason: null,
      version: 1, updatedAt: t0, createdAt: t0,
    },
  ];

  // E13: one seed project update (mirrors db/init/02_seed.sql) so the RAG
  // freshness signal and the updates UI have real data out of the box.
  const updates = [
    {
      id: '50000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000001',
      authorId: u(1),
      mood: 'NEUTRAL',
      text: 'Server room prep on track; cooling unit still held at customs.',
      accomplishment: 'Cabling paths completed',
      nextStep: 'Install cooling unit once customs clears',
      supportRequired: null,
      createdAt: t0,
    },
  ];

  const approvals = [
    {
      id: '40000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000002',
      taskId: null,
      riskTag: 'network_alteration',
      status: 'pending',
      requestedAt: t0, reviewedBy: null, reviewedAt: null, notes: null,
    },
  ];

  return { users, credentials, projects, tasks, roadblocks, approvals, updates };
}

export class MemoryRepo {
  constructor() {
    this.kind = 'memory';
    this.audit = createAuditLedger();
    this._actor = null;
    const seed = seedFixtures();
    this._users = seed.users;
    this._credentials = seed.credentials;
    this._sessions = [];
    this._store = {
      project: seed.projects,
      task: seed.tasks,
      roadblock: seed.roadblocks,
      approval: seed.approvals,
      pillar: [],
      portfolio: [],
      program: [],
      milestone: [],
      gateRequest: [],
      workstream: [],
      dependency: [],
      // E13 project updates are APPEND-ONLY: only insert() is ever called for
      // this kind (no PATCH/DELETE routes exist; trg_project_updates_append_only
      // is the Postgres backstop).
      projectUpdate: seed.updates,
      // E09/E11: actions ride offline sync; risks + capas are online-only
      // (ADR-007). No seed rows — mirror db/init/02_seed.sql.
      action: [],
      risk: [],
      capa: [],
    };
    // E10 RAG snapshots (plan §133) — derived trend history, append-only and
    // deliberately NOT audited (like the approval ledger, it IS a record).
    this._ragSnapshots = [];
    // E05 approval ledger — push-only (invariant 11). There is deliberately
    // NO update/delete method for it anywhere on this repository; entries are
    // deep-frozen on append (mirrors trg_approval_ledger_immutable).
    this._ledger = [];
    this._members = []; // project membership rows (E04)
    // Reference data is per-instance state (admin CRUD mutates it).
    this._divisions = clone(DIVISIONS);
    this._sites = clone(SITES);
    // Per-year PRJ-YYYY-NNN counters, derived from the seeded project codes so
    // the next create in 2026 yields PRJ-2026-004 (mirrors project_code_sequences).
    this._codeSeq = new Map();
    for (const p of seed.projects) {
      const m = /^PRJ-(\d{4})-(\d+)$/.exec(p.code ?? '');
      if (m) {
        const year = Number(m[1]);
        this._codeSeq.set(year, Math.max(this._codeSeq.get(year) ?? 0, Number(m[2])));
      }
    }
    this._syncQueue = [];
    this._syncById = new Map();
    this._syncSeq = 0;
  }

  // ---- transactions / actor attribution -----------------------------------
  async transaction(actorId, fn) {
    const prev = this._actor;
    this._actor = actorId ?? null;
    try {
      return await fn(this);
    } finally {
      this._actor = prev;
    }
  }

  // The ledger deep-freezes its payloads, so aliasing the stored rows here is
  // safe: stored rows are only ever replaced wholesale, never mutated in place.
  _recordAudit(action, kind, oldObj, newObj) {
    this.audit.append({
      entityType: TABLES[kind] ?? kind,
      entityId: (newObj ?? oldObj)?.id ?? null,
      action,
      actorId: this._actor,
      cgeitTag: newObj?.cgeitTag ?? oldObj?.cgeitTag ?? null,
      oldData: oldObj ?? null,
      newData: newObj ?? null,
    });
  }

  // ---- reference data (E01 org admin) --------------------------------------
  async listDivisions() {
    return clone(this._divisions);
  }

  async listSites() {
    return clone(this._sites);
  }

  _upsertRefRow(table, kind, row, { isNew }) {
    const idx = table.findIndex((r) => r.code === row.code);
    if (isNew) {
      if (idx !== -1) throw new Error(`MemoryRepo: duplicate ${kind} code ${row.code}`);
      const stored = clone(row);
      table.push(stored);
      this.audit.append({
        entityType: kind, entityId: null, action: 'INSERT', actorId: this._actor,
        cgeitTag: null, oldData: null, newData: stored,
      });
      return clone(stored);
    }
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing ${kind} ${row.code}`);
    const old = table[idx];
    const stored = clone(row);
    table[idx] = stored;
    this.audit.append({
      entityType: kind, entityId: null, action: 'UPDATE', actorId: this._actor,
      cgeitTag: null, oldData: old, newData: stored,
    });
    return clone(stored);
  }

  async insertSite(site) {
    return this._upsertRefRow(this._sites, 'sites', site, { isNew: true });
  }

  /** Updates the site addressed by `code` (which may itself be renamed to row.code). */
  async updateSite(code, row) {
    const idx = this._sites.findIndex((s) => s.code === code);
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing site ${code}`);
    const old = this._sites[idx];
    const stored = clone(row);
    this._sites[idx] = stored;
    this.audit.append({
      entityType: 'sites', entityId: null, action: 'UPDATE', actorId: this._actor,
      cgeitTag: null, oldData: old, newData: stored,
    });
    return clone(stored);
  }

  async insertDivision(division) {
    return this._upsertRefRow(this._divisions, 'divisions', division, { isNew: true });
  }

  async updateDivision(code, row) {
    const idx = this._divisions.findIndex((d) => d.code === code);
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing division ${code}`);
    const old = this._divisions[idx];
    const stored = clone(row);
    this._divisions[idx] = stored;
    this.audit.append({
      entityType: 'divisions', entityId: null, action: 'UPDATE', actorId: this._actor,
      cgeitTag: null, oldData: old, newData: stored,
    });
    return clone(stored);
  }

  // ---- project codes (E04) -------------------------------------------------
  /**
   * Concurrency-safe per-year sequence (mirrors project_code_sequences with
   * SELECT ... FOR UPDATE in Postgres). The increment is a single synchronous
   * step, so interleaved async creates can never observe the same value.
   */
  async nextProjectCodeSeq(year) {
    const next = (this._codeSeq.get(year) ?? 0) + 1;
    this._codeSeq.set(year, next);
    return next;
  }

  // ---- project membership (E04) --------------------------------------------
  /** All membership rows, or only the given project's when projectId is set. */
  async listProjectMembers(projectId) {
    const rows = projectId === undefined
      ? this._members
      : this._members.filter((m) => m.projectId === projectId);
    return clone(rows);
  }

  async insertProjectMember({ projectId, userId, role }) {
    if (this._members.some((m) => m.projectId === projectId && m.userId === userId && m.role === role)) {
      throw new Error(`MemoryRepo: duplicate project member ${projectId}/${userId}/${role}`);
    }
    const stored = {
      id: randomUUID(), projectId, userId, role, createdAt: new Date().toISOString(),
    };
    this._members.push(stored);
    this._recordAudit('INSERT', 'member', null, stored);
    return clone(stored);
  }

  /** @returns {boolean} whether a row was removed (audited as DELETE). */
  async deleteProjectMember(projectId, userId, role) {
    const idx = this._members.findIndex(
      (m) => m.projectId === projectId && m.userId === userId && m.role === role,
    );
    if (idx === -1) return false;
    const [old] = this._members.splice(idx, 1);
    this._recordAudit('DELETE', 'member', old, null);
    return true;
  }

  // ---- users ---------------------------------------------------------------
  async listUsers() {
    return clone(this._users);
  }

  async getUser(id) {
    return clone(this._users.find((u) => u.id === id) ?? null);
  }

  async getUserByEmail(email) {
    const needle = String(email ?? '').toLowerCase();
    return clone(this._users.find((u) => u.email.toLowerCase() === needle) ?? null);
  }

  async insertUser(user) {
    if (this._users.some((u) => u.id === user.id)) {
      throw new Error(`MemoryRepo: duplicate user id ${user.id}`);
    }
    const stored = clone(user);
    this._users.push(stored);
    this._recordAudit('INSERT', 'users', null, stored);
    return clone(stored);
  }

  async updateUser(user) {
    const idx = this._users.findIndex((u) => u.id === user.id);
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing user ${user.id}`);
    const old = this._users[idx];
    const stored = clone(user);
    this._users[idx] = stored;
    this._recordAudit('UPDATE', 'users', old, stored);
    return clone(stored);
  }

  // ---- credentials (never audited — no secrets in the ledger) --------------
  async getCredential(userId) {
    return clone(this._credentials.find((c) => c.userId === userId) ?? null);
  }

  async upsertCredential(cred) {
    const idx = this._credentials.findIndex((c) => c.userId === cred.userId);
    const stored = clone(cred);
    if (idx === -1) this._credentials.push(stored);
    else this._credentials[idx] = stored;
    return clone(stored);
  }

  // ---- sessions ------------------------------------------------------------
  async insertSession(session) {
    const stored = clone(session);
    this._sessions.push(stored);
    return clone(stored);
  }

  async getSessionByTokenHash(tokenHash) {
    return clone(this._sessions.find((s) => s.tokenHash === tokenHash) ?? null);
  }

  async touchSession(id, lastSeenAt) {
    const s = this._sessions.find((x) => x.id === id);
    if (s) s.lastSeenAt = lastSeenAt;
  }

  async deleteSession(id) {
    this._sessions = this._sessions.filter((s) => s.id !== id);
  }

  /** Deletes all of a user's sessions, optionally keeping one (exceptId). */
  async deleteUserSessions(userId, { exceptId } = {}) {
    this._sessions = this._sessions.filter(
      (s) => s.userId !== userId || s.id === exceptId,
    );
  }

  // ---- explicit audit append (auth lifecycle events; no secrets) -----------
  async appendAudit({ entityType, entityId, action, actorId, newData = null }) {
    this.audit.append({
      entityType, entityId, action, actorId, cgeitTag: null, oldData: null, newData,
    });
  }

  // ---- generic entity CRUD -------------------------------------------------
  _table(kind) {
    const table = this._store[kind];
    if (!table) throw new Error(`MemoryRepo: unknown entity kind '${kind}'`);
    return table;
  }

  async list(kind, filter = {}) {
    let rows = this._table(kind);
    if (filter.projectId !== undefined) rows = rows.filter((r) => r.projectId === filter.projectId);
    if (filter.portfolioId !== undefined) rows = rows.filter((r) => r.portfolioId === filter.portfolioId);
    if (filter.status !== undefined) rows = rows.filter((r) => r.status === filter.status);
    return clone(rows);
  }

  async get(kind, id) {
    if (id == null) return null;
    return clone(this._table(kind).find((r) => r.id === id) ?? null);
  }

  async insert(kind, obj) {
    const table = this._table(kind);
    if (table.some((r) => r.id === obj.id)) {
      throw new Error(`MemoryRepo: duplicate id ${obj.id} for ${kind}`);
    }
    const stored = clone(obj); // single clone: stored, audited (frozen) and returned
    table.push(stored);
    this._recordAudit('INSERT', kind, null, stored);
    return stored;
  }

  async update(kind, obj) {
    const table = this._table(kind);
    const idx = table.findIndex((r) => r.id === obj.id);
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing ${kind} ${obj.id}`);
    const old = table[idx];
    const stored = clone(obj); // single clone: stored, audited (frozen) and returned
    table[idx] = stored;
    this._recordAudit('UPDATE', kind, old, stored);
    return stored;
  }

  /** @returns {boolean} whether a row was removed (audited as DELETE). */
  async delete(kind, id) {
    const table = this._table(kind);
    const idx = table.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    const [old] = table.splice(idx, 1);
    this._recordAudit('DELETE', kind, old, null);
    return true;
  }

  // ---- approval ledger (E05 — push-only, invariant 11) ---------------------
  /**
   * Appends an immutable gate-decision record. Entries are deep-frozen; no
   * update or delete method exists for the ledger on this repository.
   */
  async appendLedger(entry) {
    const stored = deepFreeze({
      id: randomUUID(),
      ...clone(entry),
      createdAt: new Date().toISOString(),
    });
    this._ledger.push(stored);
    return clone(stored);
  }

  /** Chronological (append-order) read view; optional projectId filter. */
  async listLedger(filter = {}) {
    let rows = this._ledger;
    if (filter.projectId !== undefined) rows = rows.filter((e) => e.projectId === filter.projectId);
    return rows.map(clone);
  }

  // ---- RAG snapshots (E10, plan §133 — append-only trend history) ----------
  /** Ascending capture order; optional projectId filter. */
  async listRagSnapshots(filter = {}) {
    let rows = this._ragSnapshots;
    if (filter.projectId !== undefined) rows = rows.filter((s) => s.projectId === filter.projectId);
    return clone(rows);
  }

  /** Append-only; not audited (the snapshot itself is the record). */
  async appendRagSnapshot(snapshot) {
    const stored = clone(snapshot);
    this._ragSnapshots.push(stored);
    return clone(stored);
  }

  // ---- audit ---------------------------------------------------------------
  async listAudit(filter = {}) {
    return this.audit.query(filter);
  }

  // ---- sync queue ----------------------------------------------------------
  async insertSyncOp({ clientId, payload }) {
    const rec = {
      id: ++this._syncSeq,
      clientId,
      payload: clone(payload),
      receivedAt: new Date().toISOString(),
      processedAt: null,
      result: null,
      detail: null,
    };
    this._syncQueue.push(rec);
    this._syncById.set(rec.id, rec);
    return clone(rec);
  }

  async markSyncOp(id, { result, detail }) {
    const rec = this._syncById.get(id);
    if (!rec) return null;
    rec.processedAt = new Date().toISOString();
    rec.result = result;
    rec.detail = clone(detail) ?? null;
    return clone(rec);
  }

  async listSyncQueue() {
    return clone(this._syncQueue);
  }

  /**
   * E25/E26 replay idempotency: the most recent op of this client+opId that
   * already APPLIED (blocked/held attempts stay retryable). Null when none.
   */
  async findAppliedSyncOp(clientId, opId) {
    for (let i = this._syncQueue.length - 1; i >= 0; i--) {
      const rec = this._syncQueue[i];
      if (rec.clientId === clientId && rec.payload?.opId === opId && rec.result === 'applied') {
        return clone(rec);
      }
    }
    return null;
  }
}
