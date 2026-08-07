/**
 * Shared test helpers: boots the express app (MemoryRepo) on an ephemeral
 * port and exposes a tiny fetch-based client. Contains no tests itself.
 *
 * Identity (ADR-002): tests authenticate through the REAL /api/auth/login
 * with the seeded dev credentials — there is no header/test backdoor.
 * `api(..., { user: <uuid> })` transparently logs that seed user in once
 * (cached per server) and sends `Authorization: Bearer <token>`.
 */
import http from 'node:http';
import { createApp } from '../src/app.js';
import { MemoryRepo } from '../src/repo/memoryRepo.js';

export const USERS = {
  awa: '00000000-0000-0000-0000-000000000001', // ops CONTRIBUTOR
  moussa: '00000000-0000-0000-0000-000000000002', // infra DIVISION_LEAD
  hamady: '00000000-0000-0000-0000-000000000003', // infosec CONTRIBUTOR + security_reviewer privilege
  troy: '00000000-0000-0000-0000-000000000004', // management ADMIN
  fatou: '00000000-0000-0000-0000-000000000005', // data DIVISION_LEAD
  ibrahima: '00000000-0000-0000-0000-000000000006', // bizapps CONTRIBUTOR
  aminata: '00000000-0000-0000-0000-000000000007', // ea DIVISION_LEAD
  aissatou: '00000000-0000-0000-0000-000000000008', // management VIEWER
};

/** Seeded dev credentials (db/init/02_seed.sql + MemoryRepo fixtures). */
export const CREDENTIALS = {
  [USERS.awa]: { email: 'awa.ndiaye@opspm360.local', password: 'Dev!Awa2026' },
  [USERS.moussa]: { email: 'moussa.diallo@opspm360.local', password: 'Dev!Moussa2026' },
  [USERS.hamady]: { email: 'hamady.soumare@opspm360.local', password: 'Dev!Hamady2026' },
  [USERS.troy]: { email: 'troy@opspm360.local', password: 'Dev!Troy2026' },
  [USERS.fatou]: { email: 'fatou.sarr@opspm360.local', password: 'Dev!Fatou2026' },
  [USERS.ibrahima]: { email: 'ibrahima.ba@opspm360.local', password: 'Dev!Ibrahima2026' },
  [USERS.aminata]: { email: 'aminata.fall@opspm360.local', password: 'Dev!Aminata2026' },
  [USERS.aissatou]: { email: 'viewer@opspm360.local', password: 'Dev!Aissatou2026' },
};

export const PASSWORD_BY_EMAIL = Object.fromEntries(
  Object.values(CREDENTIALS).map((c) => [c.email, c.password]),
);

export const SEED = {
  project1: '10000000-0000-0000-0000-000000000001', // Saly Site Readiness (ops)
  project2: '10000000-0000-0000-0000-000000000002', // Saly Core Network Deployment (infra, gate pending)
  project3: '10000000-0000-0000-0000-000000000003', // ERP Maintenance Module Rollout (bizapps)
  opsTask: '20000000-0000-0000-0000-000000000001', // prerequisite (in_progress)
  infraTask: '20000000-0000-0000-0000-000000000002', // dependency-locked behind opsTask
  erpTask: '20000000-0000-0000-0000-000000000003', // free task (todo)
  roadblock1: '30000000-0000-0000-0000-000000000001',
  approval1: '40000000-0000-0000-0000-000000000001', // pending network_alteration on project2
};

export async function startServer({ authProvider } = {}) {
  const repo = new MemoryRepo();
  const app = createApp(authProvider ? { repo, authProvider } : { repo });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const tokenCache = new Map(); // userId -> bearer token

  /**
   * Logs in through the real endpoint with seeded dev passwords.
   * Returns the session token (also usable as a ppm_session cookie value).
   */
  async function loginAs(email, password = PASSWORD_BY_EMAIL[email]) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`loginAs(${email}) failed: ${res.status} ${text}`);
    }
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ppm_session='));
    await res.text();
    return decodeURIComponent(setCookie.split(';')[0].slice('ppm_session='.length));
  }

  async function tokenFor(userId) {
    if (!tokenCache.has(userId)) {
      const cred = CREDENTIALS[userId];
      if (!cred) throw new Error(`No seeded credentials for user id ${userId}`);
      tokenCache.set(userId, await loginAs(cred.email, cred.password));
    }
    return tokenCache.get(userId);
  }

  /**
   * api('PATCH', '/api/tasks/x', { user: USERS.awa, body: {...} })
   * -> { status, headers, body (json) | buffer }
   * `user` (seed uuid) authenticates via the real login (cached session);
   * `token` sends an explicit Bearer token instead.
   */
  async function api(method, path, { user, token, body, headers: extraHeaders, binary = false } = {}) {
    const headers = { ...extraHeaders };
    if (token) headers.authorization = `Bearer ${token}`;
    else if (user) headers.authorization = `Bearer ${await tokenFor(user)}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      redirect: 'manual',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (binary) {
      return {
        status: res.status,
        headers: res.headers,
        buffer: Buffer.from(await res.arrayBuffer()),
      };
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, headers: res.headers, body: json, text };
  }

  return {
    base,
    repo,
    api,
    loginAs,
    tokenFor,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Clears project2's seeded pending InfoSec gate by approving it as Hamady. */
export async function approveSeededGate(api) {
  const res = await api('POST', `/api/approvals/${SEED.approval1}/decision`, {
    user: USERS.hamady,
    body: { decision: 'approved', notes: 'test setup' },
  });
  if (res.status !== 200) {
    throw new Error(`approveSeededGate failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
