/**
 * E02 — Auth lifecycle: login/cookie/me, uniform failures, lockout + admin
 * unlock, deactivation, change-password (session revocation), logout,
 * admin-created users with forced password change, reset-password and the
 * login rate limit.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, CREDENTIALS, USERS } from './helpers.js';

const cred = (id) => CREDENTIALS[id];

describe('E02 — auth lifecycle', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.close(); });

  const login = (email, password) =>
    srv.api('POST', '/api/auth/login', { body: { email, password } });

  it('login ok: sets HttpOnly SameSite=Lax cookie, returns user, /me works via cookie AND bearer', async () => {
    const res = await login(cred(USERS.moussa).email, cred(USERS.moussa).password);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, USERS.moussa);
    assert.equal(res.body.user.baseRole, 'DIVISION_LEAD');
    assert.equal(res.body.mustChangePassword, false);
    assert.ok(!JSON.stringify(res.body).toLowerCase().includes('password_hash'));

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ppm_session='));
    assert.ok(setCookie, 'ppm_session cookie set');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//);
    const token = setCookie.split(';')[0].slice('ppm_session='.length);
    assert.ok(Buffer.from(token, 'base64url').length >= 32, 'token is 32+ random bytes');

    const viaCookie = await srv.api('GET', '/api/auth/me', { headers: { cookie: `ppm_session=${token}` } });
    assert.equal(viaCookie.status, 200);
    assert.equal(viaCookie.body.user.id, USERS.moussa);

    const viaBearer = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(viaBearer.status, 200);
    assert.equal(viaBearer.body.user.email, cred(USERS.moussa).email);
  });

  it('wrong password and unknown email both yield the SAME 401 AUTH_FAILED (no enumeration)', async () => {
    const wrongPw = await login(cred(USERS.moussa).email, 'Nope!Wrong9999');
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPw.body.error, 'AUTH_FAILED');

    const unknown = await login('ghost@opspm360.local', 'Nope!Wrong9999');
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'AUTH_FAILED');
    assert.deepEqual(unknown.body, wrongPw.body, 'identical envelope for both failures');
  });

  it('missing/garbage token -> 401 AUTH_REQUIRED on protected APIs', async () => {
    const anon = await srv.api('GET', '/api/projects');
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error, 'AUTH_REQUIRED');
    const junk = await srv.api('GET', '/api/auth/me', { token: 'not-a-real-token' });
    assert.equal(junk.status, 401);
    assert.equal(junk.body.error, 'AUTH_REQUIRED');
  });

  it('5 failed logins lock the account 15 min (423 + retryAfterSeconds); admin unlock restores', async () => {
    const { email, password } = cred(USERS.fatou);
    for (let i = 1; i <= 4; i++) {
      const res = await login(email, 'Bad!Password1');
      assert.equal(res.status, 401, `failure ${i} still AUTH_FAILED`);
    }
    const fifth = await login(email, 'Bad!Password1');
    assert.equal(fifth.status, 423);
    assert.equal(fifth.body.error, 'ACCOUNT_LOCKED');
    assert.ok(fifth.body.detail.retryAfterSeconds > 0);
    assert.ok(fifth.body.detail.retryAfterSeconds <= 15 * 60);

    // even the CORRECT password is refused while locked
    const whileLocked = await login(email, password);
    assert.equal(whileLocked.status, 423);
    assert.equal(whileLocked.body.error, 'ACCOUNT_LOCKED');

    // admin unlock clears the lock
    const unlock = await srv.api('POST', `/api/users/${USERS.fatou}/unlock`, { user: USERS.troy, body: {} });
    assert.equal(unlock.status, 204);
    const afterUnlock = await login(email, password);
    assert.equal(afterUnlock.status, 200);

    // lockout was audited (metadata only, no password anywhere)
    const audit = await srv.api('GET', `/api/audit?entityId=${USERS.fatou}`, { user: USERS.troy });
    assert.ok(audit.body.some((e) => e.action === 'LOCKOUT'));
    assert.ok(!JSON.stringify(audit.body).includes(password));
  });

  it('deactivated account -> 403 ACCOUNT_DISABLED at login; existing sessions die', async () => {
    const token = await srv.loginAs(cred(USERS.aminata).email);
    const patch = await srv.api('PATCH', `/api/users/${USERS.aminata}`, {
      user: USERS.troy, body: { isActive: false },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.user.isActive, false);

    const res = await login(cred(USERS.aminata).email, cred(USERS.aminata).password);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'ACCOUNT_DISABLED');

    // deactivation revoked her live session too
    const stale = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(stale.status, 401);

    // audited
    const audit = await srv.api('GET', `/api/audit?entityId=${USERS.aminata}`, { user: USERS.troy });
    assert.ok(audit.body.some((e) => e.action === 'DEACTIVATED'));
  });

  it('change-password: wrong current -> 400, short new -> 400, success revokes OTHER sessions only', async () => {
    const { email, password } = cred(USERS.ibrahima);
    const tokenA = await srv.loginAs(email, password);
    const tokenB = await srv.loginAs(email, password);

    const wrongCurrent = await srv.api('POST', '/api/auth/change-password', {
      token: tokenA, body: { currentPassword: 'Wrong!Guess1', newPassword: 'New!Secret2026' },
    });
    assert.equal(wrongCurrent.status, 400);
    assert.equal(wrongCurrent.body.error, 'VALIDATION');

    const tooShort = await srv.api('POST', '/api/auth/change-password', {
      token: tokenA, body: { currentPassword: password, newPassword: 'short' },
    });
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.error, 'VALIDATION');

    const ok = await srv.api('POST', '/api/auth/change-password', {
      token: tokenA, body: { currentPassword: password, newPassword: 'New!Secret2026' },
    });
    assert.equal(ok.status, 204);

    // the OTHER session is revoked, the current one survives
    assert.equal((await srv.api('GET', '/api/auth/me', { token: tokenB })).status, 401);
    assert.equal((await srv.api('GET', '/api/auth/me', { token: tokenA })).status, 200);

    // old password no longer works, new one does
    assert.equal((await login(email, password)).status, 401);
    assert.equal((await login(email, 'New!Secret2026')).status, 200);
  });

  it('logout: 204, clears cookie, session no longer usable', async () => {
    const token = await srv.loginAs(cred(USERS.awa).email);
    const out = await srv.api('POST', '/api/auth/logout', { token });
    assert.equal(out.status, 204);
    const cleared = out.headers.getSetCookie().find((c) => c.startsWith('ppm_session='));
    assert.ok(cleared, 'cookie cleared on logout');

    const after = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(after.status, 401);
    assert.equal(after.body.error, 'AUTH_REQUIRED');
  });

  it('revoke-all kills every session including the current one', async () => {
    const t1 = await srv.loginAs(cred(USERS.awa).email);
    const t2 = await srv.loginAs(cred(USERS.awa).email);
    const res = await srv.api('POST', '/api/auth/revoke-all', { token: t1 });
    assert.equal(res.status, 204);
    assert.equal((await srv.api('GET', '/api/auth/me', { token: t1 })).status, 401);
    assert.equal((await srv.api('GET', '/api/auth/me', { token: t2 })).status, 401);
  });

  it('admin-created user: temporaryPassword returned once, forced change flow blocks the API until changed', async () => {
    const created = await srv.api('POST', '/api/users', {
      user: USERS.troy,
      body: { name: 'Ousmane Kane', email: 'ousmane.kane@opspm360.local', division: 'infra', site: 'saly', baseRole: 'CONTRIBUTOR' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.mustChangePassword, true);
    assert.equal(created.body.user.baseRole, 'CONTRIBUTOR');
    const temp = created.body.temporaryPassword;
    assert.ok(typeof temp === 'string' && temp.length >= 10);

    // the temporary password is never audited in plaintext
    const audit = await srv.api('GET', '/api/audit', { user: USERS.troy });
    assert.ok(!JSON.stringify(audit.body).includes(temp));

    const first = await login('ousmane.kane@opspm360.local', temp);
    assert.equal(first.status, 200);
    assert.equal(first.body.mustChangePassword, true);
    const token = first.headers.getSetCookie().find((c) => c.startsWith('ppm_session='))
      .split(';')[0].slice('ppm_session='.length);

    // every non-auth API call is blocked until the password is changed
    for (const [method, path] of [['GET', '/api/projects'], ['GET', '/api/bootstrap'], ['POST', '/api/roadblocks']]) {
      const blocked = await srv.api(method, path, { token, body: method === 'POST' ? {} : undefined });
      assert.equal(blocked.status, 403, `${method} ${path} blocked`);
      assert.equal(blocked.body.error, 'PASSWORD_CHANGE_REQUIRED');
    }
    // ...but the auth endpoints still work
    assert.equal((await srv.api('GET', '/api/auth/me', { token })).status, 200);

    const change = await srv.api('POST', '/api/auth/change-password', {
      token, body: { currentPassword: temp, newPassword: 'Fresh!Pass2026' },
    });
    assert.equal(change.status, 204);

    const unblocked = await srv.api('GET', '/api/projects', { token });
    assert.equal(unblocked.status, 200);
    const me = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(me.body.user.mustChangePassword, false);
  });

  it('admin reset-password revokes sessions and forces a change on next login', async () => {
    const token = await srv.loginAs(cred(USERS.hamady).email);
    const reset = await srv.api('POST', `/api/users/${USERS.hamady}/reset-password`, {
      user: USERS.troy, body: {},
    });
    assert.equal(reset.status, 200);
    const temp = reset.body.temporaryPassword;
    assert.ok(typeof temp === 'string' && temp.length >= 10);

    // sessions revoked, old password dead
    assert.equal((await srv.api('GET', '/api/auth/me', { token })).status, 401);
    assert.equal((await login(cred(USERS.hamady).email, cred(USERS.hamady).password)).status, 401);

    // temp password logs in with mustChangePassword=true; reset never audited in plaintext
    const relogin = await login(cred(USERS.hamady).email, temp);
    assert.equal(relogin.status, 200);
    assert.equal(relogin.body.mustChangePassword, true);
    const audit = await srv.api('GET', `/api/audit?entityId=${USERS.hamady}`, { user: USERS.troy });
    assert.ok(audit.body.some((e) => e.action === 'PASSWORD_RESET'));
    assert.ok(!JSON.stringify(audit.body).includes(temp));
  });

  it('login rate limit: >10/min for the same IP+email key -> 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login('burst@opspm360.local', 'whatever123');
      assert.equal(res.status, 401, `attempt ${i + 1} within the window`);
    }
    const eleventh = await login('burst@opspm360.local', 'whatever123');
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error, 'RATE_LIMITED');

    // a different email key is unaffected
    const other = await login('other@opspm360.local', 'whatever123');
    assert.equal(other.status, 401);
  });

  it('login/logout are audited without any secret material', async () => {
    const audit = await srv.api('GET', '/api/audit', { user: USERS.troy });
    const actions = new Set(audit.body.map((e) => e.action));
    assert.ok(actions.has('LOGIN'));
    assert.ok(actions.has('LOGOUT'));
    const blob = JSON.stringify(audit.body);
    for (const { password } of Object.values(CREDENTIALS)) {
      assert.ok(!blob.includes(password), 'no seed password in the audit ledger');
    }
    assert.ok(!blob.includes('passwordHash'));
  });
});
