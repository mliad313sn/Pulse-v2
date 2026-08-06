/**
 * In-memory repository — fixtures mirror db/init/02_seed.sql (same UUIDs),
 * INCLUDING the effects the DB triggers would have applied at seed time
 * (project 2 carries 'network_alteration' -> pending approval + gate pending
 * + version bump). Deep-clones on read and write so callers can never alias
 * internal state. Audit is an immutable push-only ledger.
 */
import { createAuditLedger } from '../services/audit.js';

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

export const SITES = [
  { code: 'sabodala', name: 'Sabodala Mine Site' },
  { code: 'saly', name: 'Saly Site' },
  { code: 'hq', name: 'Group IT HQ' },
];

const TABLE_NAMES = {
  project: 'projects',
  task: 'tasks',
  roadblock: 'roadblocks',
  approval: 'security_approvals',
};

function seedFixtures() {
  const t0 = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // "yesterday"
  const u = (n) => `00000000-0000-0000-0000-00000000000${n}`;

  const users = [
    { id: u(1), name: 'Awa Ndiaye', email: 'awa.ndiaye@opspm360.local', division: 'ops', site: 'sabodala', role: 'site_manager', createdAt: t0 },
    { id: u(2), name: 'Moussa Diallo', email: 'moussa.diallo@opspm360.local', division: 'infra', site: 'saly', role: 'division_lead', createdAt: t0 },
    { id: u(3), name: 'Hamady Soumare', email: 'hamady.soumare@opspm360.local', division: 'infosec', site: 'hq', role: 'security_reviewer', createdAt: t0 },
    { id: u(4), name: 'Troy Coordinator', email: 'troy@opspm360.local', division: 'management', site: 'hq', role: 'group_manager', createdAt: t0 },
    { id: u(5), name: 'Fatou Sarr', email: 'fatou.sarr@opspm360.local', division: 'data', site: 'hq', role: 'division_lead', createdAt: t0 },
    { id: u(6), name: 'Ibrahima Ba', email: 'ibrahima.ba@opspm360.local', division: 'bizapps', site: 'hq', role: 'member', createdAt: t0 },
    { id: u(7), name: 'Aminata Fall', email: 'aminata.fall@opspm360.local', division: 'ea', site: 'hq', role: 'division_lead', createdAt: t0 },
  ];

  const projects = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      name: 'Saly Site Readiness',
      description: 'Physical site preparation: cabling paths, server room environmentals, power.',
      division: 'ops', site: 'saly', cgeitTag: 'resource_optimization', strategicTag: null,
      riskTags: [], overallStatus: 'active', securityGateStatus: 'not_required',
      ownerId: u(1), version: 1, updatedAt: t0, createdAt: t0,
    },
    {
      // DB trigger route_security_review fired at seed time:
      // gate -> pending, version 1 -> 2, pending approval created below.
      id: '10000000-0000-0000-0000-000000000002',
      name: 'Saly Core Network Deployment',
      description: 'New core switching and WAN uplink for Saly site.',
      division: 'infra', site: 'saly', cgeitTag: 'risk_optimization', strategicTag: 'EA-BLUEPRINT-NET-2026',
      riskTags: ['network_alteration'], overallStatus: 'active', securityGateStatus: 'pending',
      ownerId: u(2), version: 2, updatedAt: t0, createdAt: t0,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'ERP Maintenance Module Rollout',
      description: 'Deploy ERP maintenance planning module once operational bandwidth allows.',
      division: 'bizapps', site: 'sabodala', cgeitTag: 'value_delivery', strategicTag: null,
      riskTags: [], overallStatus: 'active', securityGateStatus: 'not_required',
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

  return { users, projects, tasks, roadblocks, approvals };
}

export class MemoryRepo {
  constructor() {
    this.kind = 'memory';
    this.audit = createAuditLedger();
    this._actor = null;
    const seed = seedFixtures();
    this._users = seed.users;
    this._store = {
      project: seed.projects,
      task: seed.tasks,
      roadblock: seed.roadblocks,
      approval: seed.approvals,
    };
    this._syncQueue = [];
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

  _recordAudit(action, kind, oldObj, newObj) {
    this.audit.append({
      entityType: TABLE_NAMES[kind] ?? kind,
      entityId: (newObj ?? oldObj)?.id ?? null,
      action,
      actorId: this._actor,
      cgeitTag: newObj?.cgeitTag ?? oldObj?.cgeitTag ?? null,
      oldData: clone(oldObj) ?? null,
      newData: clone(newObj) ?? null,
    });
  }

  // ---- users ---------------------------------------------------------------
  async listUsers() {
    return clone(this._users);
  }

  async getUser(id) {
    return clone(this._users.find((u) => u.id === id) ?? null);
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
    table.push(clone(obj));
    this._recordAudit('INSERT', kind, null, obj);
    return clone(obj);
  }

  async update(kind, obj) {
    const table = this._table(kind);
    const idx = table.findIndex((r) => r.id === obj.id);
    if (idx === -1) throw new Error(`MemoryRepo: cannot update missing ${kind} ${obj.id}`);
    const old = table[idx];
    table[idx] = clone(obj);
    this._recordAudit('UPDATE', kind, old, obj);
    return clone(obj);
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
    return clone(rec);
  }

  async markSyncOp(id, { result, detail }) {
    const rec = this._syncQueue.find((r) => r.id === id);
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
