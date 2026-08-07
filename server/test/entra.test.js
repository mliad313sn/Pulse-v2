/**
 * E02 — Entra ID SSO adapter. The real tenant is BLOCKED_EXTERNAL, so the
 * fake provider (same interface) drives the full auth-code flow; the
 * unconfigured real provider must answer 501 NOT_CONFIGURED.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, USERS, CREDENTIALS } from './helpers.js';
import { createFakeEntraProvider } from '../src/services/authProviders/fakeEntra.js';
import { createEntraProvider } from '../src/services/authProviders/entra.js';

describe('E02 — Entra SSO (fake provider)', () => {
  let srv;
  before(async () => {
    srv = await startServer({ authProvider: createFakeEntraProvider() });
  });
  after(async () => { await srv.close(); });

  async function startFlow() {
    const res = await srv.api('GET', '/api/auth/entra/login');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location.startsWith('https://fake.entra.local/authorize'));
    return new URL(location).searchParams.get('state');
  }

  it('completes the code flow for a provisioned user and issues a working session', async () => {
    const state = await startFlow();
    const email = CREDENTIALS[USERS.moussa].email;
    const cb = await srv.api(
      'GET',
      `/api/auth/entra/callback?code=${encodeURIComponent(`code:${email}`)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(cb.status, 302, 'callback redirects into the app');
    const cookie = cb.headers.getSetCookie().find((c) => c.startsWith('ppm_session='));
    assert.ok(cookie, 'session cookie issued');
    const token = cookie.split(';')[0].slice('ppm_session='.length);

    const me = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, USERS.moussa);

    // ...and the session works against business endpoints
    const projects = await srv.api('GET', '/api/projects', { token });
    assert.equal(projects.status, 200);
  });

  it('unknown email -> 403 ACCOUNT_DISABLED (no auto-provisioning)', async () => {
    const state = await startFlow();
    const cb = await srv.api(
      'GET',
      `/api/auth/entra/callback?code=${encodeURIComponent('code:stranger@elsewhere.example')}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(cb.status, 403);
    assert.equal(cb.body.error, 'ACCOUNT_DISABLED');
  });

  it('deactivated local account -> 403 ACCOUNT_DISABLED even with a valid SSO identity', async () => {
    await srv.api('PATCH', `/api/users/${USERS.aminata}`, { user: USERS.troy, body: { isActive: false } });
    const state = await startFlow();
    const cb = await srv.api(
      'GET',
      `/api/auth/entra/callback?code=${encodeURIComponent(`code:${CREDENTIALS[USERS.aminata].email}`)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(cb.status, 403);
    assert.equal(cb.body.error, 'ACCOUNT_DISABLED');
  });

  it('replayed or unknown state -> 400 VALIDATION (CSRF protection)', async () => {
    const state = await startFlow();
    const email = CREDENTIALS[USERS.awa].email;
    const first = await srv.api(
      'GET',
      `/api/auth/entra/callback?code=${encodeURIComponent(`code:${email}`)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(first.status, 302);
    const replay = await srv.api(
      'GET',
      `/api/auth/entra/callback?code=${encodeURIComponent(`code:${email}`)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(replay.status, 400);
    const forged = await srv.api('GET', '/api/auth/entra/callback?code=code:x&state=forged');
    assert.equal(forged.status, 400);
  });
});

describe('E02 — Entra SSO unconfigured (real provider without env)', () => {
  let srv;
  before(async () => {
    // The real provider built from an EMPTY env is unconfigured by design.
    srv = await startServer({ authProvider: createEntraProvider({}) });
  });
  after(async () => { await srv.close(); });

  it('GET /api/auth/entra/login -> 501 NOT_CONFIGURED', async () => {
    const res = await srv.api('GET', '/api/auth/entra/login');
    assert.equal(res.status, 501);
    assert.equal(res.body.error, 'NOT_CONFIGURED');
  });

  it('GET /api/auth/entra/callback -> 501 NOT_CONFIGURED', async () => {
    const res = await srv.api('GET', '/api/auth/entra/callback?code=x&state=y');
    assert.equal(res.status, 501);
    assert.equal(res.body.error, 'NOT_CONFIGURED');
  });

  it('provider reports configured=false without the AZURE_* env vars', () => {
    const provider = createEntraProvider({});
    assert.equal(provider.configured, false);
    const full = createEntraProvider({
      AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's',
      AZURE_REDIRECT_URI: 'http://localhost:4000/api/auth/entra/callback',
    });
    assert.equal(full.configured, true);
    const url = new URL(full.getAuthorizationUrl('mystate'));
    assert.equal(url.hostname, 'login.microsoftonline.com');
    assert.equal(url.searchParams.get('state'), 'mystate');
    assert.equal(url.searchParams.get('client_id'), 'c');
  });
});
