/**
 * In-memory repository — fixtures mirror db/init/02_seed.sql (same UUIDs),
 * INCLUDING the effects the DB triggers would have applied at seed time
 * (project 2 carries 'network_alteration' -> pending approval + gate pending
 * + version bump). Deep-clones on read and write so callers can never alias
 * internal state. Audit is an immutable push-only ledger.
 */
import { createAuditLedger } from '../services/audit.js';
import { TABLES } from './tables.js';

const clone = (v) => (v == null ? v : structuredClone(v));

export const DIVISIONS = [
  { code: 'ops', name: 'Operations', description: 'Day-to-day site management' },
  { code: 'infra', name: 'Infrastructure', description: 'Networks and systems deployment' },
  { code: 'ea', name: 'Enterprise Architecture', description: 'Future design and strategic blueprint' },
  { code: 'infosec', name: 'Information Security', description: 'Cyber defense and governance' },
  { code: 'data', name: 'Data Insight', description: 'Business intelligence' },
  { code: 'bizapps', name: 'Business Apps', description: 'ERP integration' },
  { code: 'management', name: 'Group IT Management', description: 'Executive oversight' },
];

function seedFixtures() {
  const t0 = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // "yesterday"
  const u = (n) => `00000000-0000-0000-0000-00000000000${n}`;

  const base = { privileges: [], isActive: true, mustChangePassword: false, createdAt: t0 };
  // Base roles per ADR-004 mapping — keep in sync with db/init/02_seed.sql.
  const users = [
    { id: u(1), name: 'Awa Ndiaye', email: 'awa.ndiaye@opspm360.local', division: 'ops', site: 'sabodala', baseRole: 'CONTRIBUTOR', ...base },
    { id: u(2), name: 'Moussa Diallo', email: 'moussa.diallo@opspm360.local', division: 'infra', site: 'saly', baseRole: 'DIVISION_LEAD', ...base },
    { id: u(3), name: 'Hamady Soumare', email: 'hamady.soumare@opspm360.local', division: 'infosec', site: 'hq', baseRole: 'CONTRIBUTOR', ...base, privileges: ['security_reviewer'] },
    { id: u(4), name: 'Troy Coordinator', email: 'troy@opspm360.local', division: 'management', site: 'hq', baseRole: 'ADMIN', ...base },
    { id: u(5), name: 'Fatou Sarr', email: 'fatou.sarr@opspm360.local', division: 'data', site: 'hq', baseRole: 'DIVISION_LEAD', ...base },
    { id: u(6), name: 'Ibrahima Ba', email: 'ibrahima.ba@opspm360.local', division: 'bizapps', site: 'hq', baseRole: 'CONTRIBUTOR', ...base },
    { id: u(7), name: 'Aminata Fall', email: 'aminata.fall@opspm360.local', division: 'ea', site: 'hq', baseRole: 'DIVISION_LEAD', ...base },
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

  const projects = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      name: 'Saly Site Readiness',
      description: 'Physical site preparation: cabling paths, server room environmentals, power.',
      division: 'ops', site: 'saly', cgeitTag: 'resource_optimization', strategicTag: null,
      riskTags: [], classification: 'internal', overallStatus: 'active', securityGateStatus: 'not_required',
      ownerId: u(1), version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      // DB trigger route_security_review fired at seed time:
      // gate -> pending, version 1 -> 2, pending approval created below.
      id: '10000000-0000-0000-0000-000000000002',
      name: 'Saly Core Network Deployment',
      description: 'New core switching and WAN uplink for Saly site.',
      division: 'infra', site: 'saly', cgeitTag: 'risk_optimization', strategicTag: 'EA-BLUEPRINT-NET-2026',
      riskTags: ['network_alteration'], classification: 'internal', overallStatus: 'active', securityGateStatus: 'pending',
      ownerId: u(2), version: 2, updatedAt: t0, createdAt: t0,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'ERP Maintenance Module Rollout',
      description: 'Deploy ERP maintenance planning module once operational bandwidth allows.',
      division: 'bizapps', site: 'sabodala', cgeitTag: 'value_delivery', strategicTag: null,
      riskTags: [], classification: 'internal', overallStatus: 'active', securityGateStatus: 'not_required',
      ownerId: u(6), version: 1, updatedAt: t0, createdAt: t0,
    },
  ];

  const tasks = [
    {
      id: '20000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000001',
      title: 'Complete server room site prep (power + cooling)',
      description: null, division: 'ops', site: 'saly', assigneeId: u(1),
      status: 'in_progress', priority: 'high', dependencyLock: null,
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      id: '20000000-0000-0000-0000-000000000002',
      projectId: '10000000-0000-0000-0000-000000000002',
      title: 'Install core switches and bring up WAN uplink',
      description: null, division: 'infra', site: 'saly', assigneeId: u(2),
      status: 'todo', priority: 'critical',
      dependencyLock: '20000000-0000-0000-0000-000000000001',
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      id: '20000000-0000-0000-0000-000000000003',
      projectId: '10000000-0000-0000-0000-000000000003',
      title: 'Validate ERP module in staging',
      description: null, division: 'bizapps', site: 'hq', assigneeId: u(6),
      status: 'todo', priority: 'normal', dependencyLock: null,
      riskTags: [], slaDueAt: null, version: 1, updatedAt: t0, createdAt: t0,
    },
  ];

  const roadblocks = [
    {
      id: '30000000-0000-0000-0000-000000000001',
      projectId: '10000000-0000-0000-0000-000000000001',
      taskId: '20000000-0000-0000-0000-000000000001',
      description: 'Cooling unit delivery delayed at customs',
      severity: 'high', status: 'open', reportedBy: u(1),
      version: 1, updatedAt: t0, createdAt: t0,
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

  return { users, credentials, projects, tasks, roadblocks, approvals };
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
    };
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

  // ---- reference data ------------------------------------------------------
  async listDivisions() {
    return clone(DIVISIONS);
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
}
