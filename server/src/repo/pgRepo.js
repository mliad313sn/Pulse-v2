/**
 * PostgreSQL repository — same interface as MemoryRepo over a pg Pool.
 * Transactions set `opspm360.actor_id` (SET LOCAL semantics via set_config)
 * so the DB audit triggers attribute mutations to the acting user.
 * The DB triggers remain the backstop for gates/routing/audit; the service
 * layer runs the same checks first to produce friendly typed errors.
 */
import pg from 'pg';
import { dependencyLocked, forbidden, securityGate } from '../errors.js';
import { TABLES } from './tables.js';

const { Pool } = pg;

// camelCase (wire/service) -> snake_case (db) per entity kind.
const COLUMNS = {
  project: {
    id: 'id', name: 'name', description: 'description', division: 'division', site: 'site',
    cgeitTag: 'cgeit_tag', strategicTag: 'strategic_tag', riskTags: 'risk_tags',
    overallStatus: 'overall_status', securityGateStatus: 'security_gate_status',
    ownerId: 'owner_id', version: 'version', updatedAt: 'updated_at', createdAt: 'created_at',
  },
  task: {
    id: 'id', projectId: 'project_id', title: 'title', description: 'description',
    division: 'division', site: 'site', assigneeId: 'assignee_id', status: 'status',
    priority: 'priority', dependencyLock: 'dependency_lock', riskTags: 'risk_tags',
    slaDueAt: 'sla_due_at', version: 'version', updatedAt: 'updated_at', createdAt: 'created_at',
  },
  roadblock: {
    id: 'id', projectId: 'project_id', taskId: 'task_id', description: 'description',
    severity: 'severity', status: 'status', reportedBy: 'reported_by',
    version: 'version', updatedAt: 'updated_at', createdAt: 'created_at',
  },
  approval: {
    id: 'id', projectId: 'project_id', taskId: 'task_id', riskTag: 'risk_tag', status: 'status',
    requestedAt: 'requested_at', reviewedBy: 'reviewed_by', reviewedAt: 'reviewed_at', notes: 'notes',
  },
};

const toIso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

function mapRow(kind, row) {
  if (!row) return null;
  const out = {};
  for (const [camel, snake] of Object.entries(COLUMNS[kind])) {
    let v = row[snake];
    if (v instanceof Date) v = v.toISOString();
    out[camel] = v === undefined ? null : v;
  }
  return out;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email,
    division: row.division, site: row.site, role: row.role,
    createdAt: toIso(row.created_at),
  };
}

/** Translate DB trigger exceptions into the contract's typed errors. */
function translateDbError(err) {
  const msg = String(err?.message ?? '');
  if (msg.includes('DEPENDENCY_LOCKED')) return dependencyLocked();
  if (msg.includes('SECURITY_GATE')) return securityGate();
  if (msg.includes('immutable ledger')) return forbidden('audit_logs is an immutable ledger');
  return err;
}

class PgQueries {
  constructor(queryable) {
    this.kind = 'pg';
    this._q = queryable; // has .query(text, params)
  }

  async _query(text, params) {
    try {
      return await this._q.query(text, params);
    } catch (err) {
      throw translateDbError(err);
    }
  }

  // ---- reference data ------------------------------------------------------
  async listDivisions() {
    const { rows } = await this._query('SELECT code, name FROM divisions ORDER BY code');
    return rows;
  }

  // ---- users ---------------------------------------------------------------
  async listUsers() {
    const { rows } = await this._query('SELECT * FROM users ORDER BY name');
    return rows.map(mapUser);
  }

  async getUser(id) {
    const { rows } = await this._query('SELECT * FROM users WHERE id = $1', [id]);
    return mapUser(rows[0] ?? null);
  }

  // ---- generic entity CRUD -------------------------------------------------
  async list(kind, filter = {}) {
    const table = TABLES[kind];
    const cols = COLUMNS[kind];
    const where = [];
    const params = [];
    if (filter.projectId !== undefined) {
      params.push(filter.projectId);
      where.push(`${cols.projectId} = $${params.length}`);
    }
    if (filter.status !== undefined) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const sql = `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${cols.createdAt ?? cols.requestedAt}`;
    const { rows } = await this._query(sql, params);
    return rows.map((r) => mapRow(kind, r));
  }

  async get(kind, id) {
    if (id == null) return null;
    const { rows } = await this._query(`SELECT * FROM ${TABLES[kind]} WHERE id = $1`, [id]);
    return mapRow(kind, rows[0] ?? null);
  }

  async insert(kind, obj) {
    const cols = COLUMNS[kind];
    const names = [];
    const params = [];
    for (const [camel, snake] of Object.entries(cols)) {
      if (obj[camel] === undefined) continue;
      params.push(obj[camel]);
      names.push(snake);
    }
    const placeholders = params.map((_, i) => `$${i + 1}`);
    const { rows } = await this._query(
      `INSERT INTO ${TABLES[kind]} (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      params,
    );
    return mapRow(kind, rows[0]);
  }

  async update(kind, obj) {
    const cols = COLUMNS[kind];
    const sets = [];
    const params = [];
    for (const [camel, snake] of Object.entries(cols)) {
      if (camel === 'id' || camel === 'createdAt') continue;
      if (obj[camel] === undefined) continue;
      params.push(obj[camel]);
      sets.push(`${snake} = $${params.length}`);
    }
    params.push(obj.id);
    const { rows } = await this._query(
      `UPDATE ${TABLES[kind]} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return mapRow(kind, rows[0] ?? null);
  }

  // ---- audit (written by DB triggers; read-only here) ----------------------
  async listAudit(filter = {}) {
    const where = [];
    const params = [];
    if (filter.entityId != null) {
      params.push(filter.entityId);
      where.push(`entity_id = $${params.length}`);
    }
    if (filter.entityType != null) {
      params.push(filter.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    const sql = `SELECT * FROM audit_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    const { rows } = await this._query(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actorId: r.actor_id,
      cgeitTag: r.cgeit_tag,
      oldData: r.old_data,
      newData: r.new_data,
      createdAt: toIso(r.created_at),
    }));
  }

  // ---- sync queue ----------------------------------------------------------
  async insertSyncOp({ clientId, payload }) {
    const { rows } = await this._query(
      'INSERT INTO sync_queue (client_id, payload) VALUES ($1, $2) RETURNING id, received_at',
      [clientId, JSON.stringify(payload)],
    );
    return { id: Number(rows[0].id), clientId, payload, receivedAt: toIso(rows[0].received_at) };
  }

  async markSyncOp(id, { result, detail }) {
    await this._query(
      'UPDATE sync_queue SET processed_at = now(), result = $2, detail = $3 WHERE id = $1',
      [id, result, JSON.stringify(detail ?? null)],
    );
  }
}

class PgTxRepo extends PgQueries {
  // Same query surface, bound to a single client inside BEGIN/COMMIT.
  // Nested transaction calls reuse the same client (savepoint-free flattening).
  async transaction(_actorId, fn) {
    return fn(this);
  }
}

export class PgRepo extends PgQueries {
  constructor(connectionString) {
    const pool = new Pool({ connectionString });
    super(pool);
    this.pool = pool;
  }

  /**
   * Run `fn(txRepo)` inside a transaction with the acting user attributed for
   * the DB audit triggers via `SET LOCAL opspm360.actor_id`.
   */
  async transaction(actorId, fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('opspm360.actor_id', $1, true)", [actorId ?? '']);
      const result = await fn(new PgTxRepo(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw translateDbError(err);
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
