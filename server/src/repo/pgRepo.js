/**
 * PostgreSQL repository — same interface as MemoryRepo over a pg Pool.
 * Transactions set `opspm360.actor_id` (SET LOCAL semantics via set_config)
 * so the DB audit triggers attribute mutations to the acting user.
 * The DB triggers remain the backstop for gates/routing/audit; the service
 * layer runs the same checks first to produce friendly typed errors.
 */
import pg from 'pg';
import { dependencyLocked, forbidden, securityGate, validation } from '../errors.js';
import { TABLES } from './tables.js';

const { Pool } = pg;

// camelCase (wire/service) -> snake_case (db) per entity kind.
const COLUMNS = {
  project: {
    id: 'id', code: 'code', name: 'name', description: 'description',
    division: 'division', site: 'site',
    cgeitTag: 'cgeit_tag', strategicTag: 'strategic_tag', riskTags: 'risk_tags',
    classification: 'classification',
    overallStatus: 'overall_status', securityGateStatus: 'security_gate_status',
    ownerId: 'owner_id', portfolioId: 'portfolio_id', programId: 'program_id',
    sponsorId: 'sponsor_id', lifecycleStage: 'lifecycle_stage',
    operatingStatus: 'operating_status', engagedDivisions: 'engaged_divisions', sites: 'sites',
    version: 'version', updatedAt: 'updated_at', createdAt: 'created_at',
  },
  pillar: {
    id: 'id', name: 'name', description: 'description',
    updatedAt: 'updated_at', createdAt: 'created_at',
  },
  portfolio: {
    id: 'id', title: 'title', description: 'description', pillarId: 'pillar_id',
    ownerId: 'owner_id', dateFrom: 'date_from', dateTo: 'date_to',
    updatedAt: 'updated_at', createdAt: 'created_at',
  },
  program: {
    id: 'id', title: 'title', objective: 'objective', portfolioId: 'portfolio_id',
    ownerId: 'owner_id', updatedAt: 'updated_at', createdAt: 'created_at',
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

// DATE (not timestamptz) columns — wire format is plain YYYY-MM-DD.
const DATE_ONLY = { portfolio: new Set(['dateFrom', 'dateTo']) };

function mapRow(kind, row) {
  if (!row) return null;
  const dateOnly = DATE_ONLY[kind];
  const out = {};
  for (const [camel, snake] of Object.entries(COLUMNS[kind])) {
    let v = row[snake];
    if (v instanceof Date) v = dateOnly?.has(camel) ? v.toISOString().slice(0, 10) : v.toISOString();
    out[camel] = v === undefined ? null : v;
  }
  return out;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email,
    division: row.division, site: row.site,
    baseRole: row.base_role, privileges: row.privileges ?? [],
    isActive: row.is_active, mustChangePassword: row.must_change_password,
    enterpriseAccess: row.enterprise_access !== false,
    createdAt: toIso(row.created_at),
  };
}

function mapMember(row) {
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, userId: row.user_id, role: row.role,
    createdAt: toIso(row.created_at),
  };
}

function mapCredential(row) {
  if (!row) return null;
  return {
    userId: row.user_id, passwordHash: row.password_hash,
    failedCount: row.failed_count, firstFailedAt: toIso(row.first_failed_at),
    lockedUntil: toIso(row.locked_until), updatedAt: toIso(row.updated_at),
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, tokenHash: row.token_hash,
    createdAt: toIso(row.created_at), expiresAt: toIso(row.expires_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

/** Translate DB trigger exceptions into the contract's typed errors. */
function translateDbError(err) {
  const msg = String(err?.message ?? '');
  if (msg.includes('DEPENDENCY_LOCKED')) return dependencyLocked();
  if (msg.includes('SECURITY_GATE')) return securityGate();
  if (msg.includes('PROJECT_CODE_IMMUTABLE')) return validation('Project code is server-generated and immutable');
  if (msg.includes('VIEWER_CANNOT_LEAD')) {
    return validation('VIEWER users cannot be assigned PM or WORKSTREAM_LEAD');
  }
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

  // ---- reference data (E01 org admin) --------------------------------------
  async listDivisions() {
    const { rows } = await this._query('SELECT code, name, description FROM divisions ORDER BY code');
    return rows;
  }

  async listSites() {
    const { rows } = await this._query('SELECT code, name, description FROM sites ORDER BY code');
    return rows;
  }

  async insertSite(site) {
    const { rows } = await this._query(
      'INSERT INTO sites (code, name, description) VALUES ($1, $2, $3) RETURNING code, name, description',
      [site.code, site.name, site.description ?? null],
    );
    return rows[0];
  }

  async updateSite(code, row) {
    const { rows } = await this._query(
      'UPDATE sites SET code = $2, name = $3, description = $4 WHERE code = $1 RETURNING code, name, description',
      [code, row.code, row.name, row.description ?? null],
    );
    return rows[0] ?? null;
  }

  async insertDivision(division) {
    const { rows } = await this._query(
      'INSERT INTO divisions (code, name, description) VALUES ($1, $2, $3) RETURNING code, name, description',
      [division.code, division.name, division.description ?? null],
    );
    return rows[0];
  }

  async updateDivision(code, row) {
    const { rows } = await this._query(
      'UPDATE divisions SET code = $2, name = $3, description = $4 WHERE code = $1 RETURNING code, name, description',
      [code, row.code, row.name, row.description ?? null],
    );
    return rows[0] ?? null;
  }

  // ---- project codes (E04) -------------------------------------------------
  /**
   * Concurrency-safe PRJ-YYYY-NNN allocation: the per-year row is locked with
   * SELECT ... FOR UPDATE inside the surrounding create transaction, then
   * incremented — never max()+1 over projects.
   */
  async nextProjectCodeSeq(year) {
    await this._query(
      'INSERT INTO project_code_sequences (year, last_value) VALUES ($1, 0) ON CONFLICT (year) DO NOTHING',
      [year],
    );
    await this._query('SELECT last_value FROM project_code_sequences WHERE year = $1 FOR UPDATE', [year]);
    const { rows } = await this._query(
      'UPDATE project_code_sequences SET last_value = last_value + 1 WHERE year = $1 RETURNING last_value',
      [year],
    );
    return Number(rows[0].last_value);
  }

  // ---- project membership (E04) --------------------------------------------
  async listProjectMembers(projectId) {
    const sql = projectId === undefined
      ? 'SELECT * FROM project_members ORDER BY created_at, role'
      : 'SELECT * FROM project_members WHERE project_id = $1 ORDER BY created_at, role';
    const { rows } = await this._query(sql, projectId === undefined ? [] : [projectId]);
    return rows.map(mapMember);
  }

  async insertProjectMember({ projectId, userId, role }) {
    const { rows } = await this._query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) RETURNING *',
      [projectId, userId, role],
    );
    return mapMember(rows[0]);
  }

  async deleteProjectMember(projectId, userId, role) {
    const { rowCount } = await this._query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [projectId, userId, role],
    );
    return rowCount > 0;
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

  async getUserByEmail(email) {
    const { rows } = await this._query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    return mapUser(rows[0] ?? null);
  }

  async insertUser(user) {
    const { rows } = await this._query(
      `INSERT INTO users (id, name, email, division, site, base_role, privileges, is_active, must_change_password, enterprise_access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [user.id, user.name, user.email, user.division, user.site ?? null,
       user.baseRole, user.privileges ?? [], user.isActive !== false, user.mustChangePassword === true,
       user.enterpriseAccess !== false],
    );
    return mapUser(rows[0]);
  }

  async updateUser(user) {
    const { rows } = await this._query(
      `UPDATE users SET name = $2, email = $3, division = $4, site = $5,
              base_role = $6, privileges = $7, is_active = $8, must_change_password = $9,
              enterprise_access = $10
       WHERE id = $1 RETURNING *`,
      [user.id, user.name, user.email, user.division, user.site ?? null,
       user.baseRole, user.privileges ?? [], user.isActive !== false, user.mustChangePassword === true,
       user.enterpriseAccess !== false],
    );
    return mapUser(rows[0] ?? null);
  }

  // ---- credentials (never audited/logged) ----------------------------------
  async getCredential(userId) {
    const { rows } = await this._query('SELECT * FROM user_credentials WHERE user_id = $1', [userId]);
    return mapCredential(rows[0] ?? null);
  }

  async upsertCredential(cred) {
    const { rows } = await this._query(
      `INSERT INTO user_credentials (user_id, password_hash, failed_count, first_failed_at, locked_until, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
              failed_count = EXCLUDED.failed_count, first_failed_at = EXCLUDED.first_failed_at,
              locked_until = EXCLUDED.locked_until, updated_at = now()
       RETURNING *`,
      [cred.userId, cred.passwordHash, cred.failedCount ?? 0,
       cred.firstFailedAt ?? null, cred.lockedUntil ?? null],
    );
    return mapCredential(rows[0]);
  }

  // ---- sessions ------------------------------------------------------------
  async insertSession(session) {
    const { rows } = await this._query(
      `INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [session.id, session.userId, session.tokenHash,
       session.createdAt, session.expiresAt, session.lastSeenAt ?? null],
    );
    return mapSession(rows[0]);
  }

  async getSessionByTokenHash(tokenHash) {
    const { rows } = await this._query('SELECT * FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return mapSession(rows[0] ?? null);
  }

  async touchSession(id, lastSeenAt) {
    await this._query('UPDATE user_sessions SET last_seen_at = $2 WHERE id = $1', [id, lastSeenAt]);
  }

  async deleteSession(id) {
    await this._query('DELETE FROM user_sessions WHERE id = $1', [id]);
  }

  async deleteUserSessions(userId, { exceptId } = {}) {
    if (exceptId) {
      await this._query('DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2', [userId, exceptId]);
    } else {
      await this._query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    }
  }

  // ---- explicit audit append (auth lifecycle events; no secrets) -----------
  // audit_logs only forbids UPDATE/DELETE — direct INSERT is allowed.
  async appendAudit({ entityType, entityId, action, actorId, newData = null }) {
    await this._query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, new_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [entityType, entityId ?? null, action, actorId ?? null, newData == null ? null : JSON.stringify(newData)],
    );
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
    if (filter.portfolioId !== undefined) {
      params.push(filter.portfolioId);
      where.push(`${cols.portfolioId} = $${params.length}`);
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
