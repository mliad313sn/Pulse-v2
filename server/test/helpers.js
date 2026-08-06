/**
 * Shared test helpers: boots the express app (MemoryRepo) on an ephemeral
 * port and exposes a tiny fetch-based client. Contains no tests itself.
 */
import http from 'node:http';
import { createApp } from '../src/app.js';
import { MemoryRepo } from '../src/repo/memoryRepo.js';

export const USERS = {
  awa: '00000000-0000-0000-0000-000000000001', // ops site_manager
  moussa: '00000000-0000-0000-0000-000000000002', // infra division_lead
  hamady: '00000000-0000-0000-0000-000000000003', // infosec security_reviewer
  troy: '00000000-0000-0000-0000-000000000004', // management group_manager
  ibrahima: '00000000-0000-0000-0000-000000000006', // bizapps member
};

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

export async function startServer() {
  const repo = new MemoryRepo();
  const app = createApp({ repo });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /**
   * api('PATCH', '/api/tasks/x', { user: USERS.awa, body: {...} })
   * -> { status, headers, body (json) | buffer }
   */
  async function api(method, path, { user, body, binary = false } = {}) {
    const headers = {};
    if (user) headers['x-user-id'] = user;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
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
