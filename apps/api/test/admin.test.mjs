import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdmin, permissionsFor } = require('../src/admin.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { signAdminToken, SCOPES, ROLES } = require('../src/admin-auth.js');

const START = 1_700_000_000_000;

function make(config = {}) {
  const repo = createMemoryRepo();
  const sent = [];
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async (m) => sent.push(m) },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: {
      allowlist: ['ops@nota.ca'],
      baseUrl: 'https://admin.nota.ca',
      devEcho: true,
      ...config,
    },
  });
  return { repo, admin, sent, clock };
}

function tokenFromLink(link) {
  return decodeURIComponent(link.split('token=')[1]);
}

async function signIn(h) {
  const req = await h.admin.requestLogin({ email: 'ops@nota.ca', ip: '1.2.3.4' });
  const res = await h.admin.verifyMagic({ token: tokenFromLink(req.devLink), ip: '1.2.3.4' });
  return res.session;
}

test('requestLogin never enumerates: a non-allowlisted address gets the same ok, sends nothing, mints no challenge', async () => {
  const h = make();
  const res = await h.admin.requestLogin({ email: 'stranger@example.com', ip: '9.9.9.9' });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.sent.length, 0);
  const audit = await h.repo.queryAuditByDay(new Date(START).toISOString().slice(0, 10));
  assert.ok(audit.some((a) => a.action === 'login_requested_unknown'));
});

test('requestLogin for an allowlisted admin emails a single-use link and returns a devLink in dev', async () => {
  const h = make();
  const res = await h.admin.requestLogin({ email: 'OPS@nota.ca', ip: '1.2.3.4' });
  assert.equal(res.ok, true);
  assert.ok(res.devLink.startsWith('https://admin.nota.ca/#/auth?token='));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, 'ops@nota.ca');
});

test('verifyMagic redeems the link once, bootstraps a super_admin, and issues a working session', async () => {
  const h = make();
  const req = await h.admin.requestLogin({ email: 'ops@nota.ca' });
  const token = tokenFromLink(req.devLink);

  const res = await h.admin.verifyMagic({ token });
  assert.equal(res.ok, true);
  assert.equal(res.role, ROLES.SUPER_ADMIN);

  const who = await h.admin.me(res.session);
  assert.equal(who.email, 'ops@nota.ca');
  assert.deepEqual(who.permissions, permissionsFor(ROLES.SUPER_ADMIN));

  // Single-use: replaying the SAME magic link is rejected.
  const replay = await h.admin.verifyMagic({ token });
  assert.equal(replay.ok, false);
});

test('a validly-signed session token with no server-side session record is rejected (token alone is not enough)', async () => {
  const h = make();
  // Forge a session token that passes the HMAC (dev fallback secret) but points
  // at a session that was never created.
  const forged = signAdminToken({ sub: 'Adeadbeef', sid: 'ghost', role: ROLES.SUPER_ADMIN, scope: SCOPES.SESSION, exp: START + 1e9 });
  assert.equal(await h.admin.requireAdmin(forged), null);
  assert.equal(await h.admin.me(forged), null);
});

test('logout revokes the session so the same token immediately stops working', async () => {
  const h = make();
  const session = await signIn(h);
  assert.ok(await h.admin.requireAdmin(session));
  await h.admin.logout(session);
  assert.equal(await h.admin.requireAdmin(session), null);
});

test('an idle session past the inactivity TTL is rejected even before its absolute expiry', async () => {
  const h = make({ sessionIdleTtlMs: 1000, sessionAbsoluteTtlMs: 60 * 60 * 1000 });
  const session = await signIn(h);
  h.clock.ms += 1001; // idle beyond the inactivity window
  assert.equal(await h.admin.requireAdmin(session), null);
});

test('a session past its absolute cap is rejected however active', async () => {
  const h = make({ sessionIdleTtlMs: 60 * 60 * 1000, sessionAbsoluteTtlMs: 2000 });
  const session = await signIn(h);
  h.clock.ms += 1500;
  assert.ok(await h.admin.requireAdmin(session)); // still inside the cap, slides lastSeen
  h.clock.ms += 600; // now past the 2000ms absolute cap
  assert.equal(await h.admin.requireAdmin(session), null);
});

test('refresh keeps an active admin signed in and extends the window', async () => {
  const h = make({ sessionIdleTtlMs: 5000, sessionAbsoluteTtlMs: 10_000 });
  const session = await signIn(h);
  h.clock.ms += 4000;
  const r = await h.admin.refresh(session);
  assert.equal(r.ok, true);
  assert.ok(await h.admin.requireAdmin(r.session));
});

test('requestLogin is rate-limited per IP', async () => {
  const h = make({ rlMax: 2, rlWindowSec: 900 });
  assert.equal((await h.admin.requestLogin({ email: 'ops@nota.ca', ip: '5.5.5.5' })).throttled, undefined);
  assert.equal((await h.admin.requestLogin({ email: 'ops@nota.ca', ip: '5.5.5.5' })).throttled, undefined);
  assert.equal((await h.admin.requestLogin({ email: 'ops@nota.ca', ip: '5.5.5.5' })).throttled, true);
});

test('an existing analyst is not silently promoted to super_admin on login', async () => {
  const h = make();
  const { adminIdForEmail } = require('../src/admin-auth.js');
  await h.repo.putAdmin({ id: adminIdForEmail('ops@nota.ca'), email: 'ops@nota.ca', role: ROLES.ANALYST, createdAt: 'x' });
  const session = await signIn(h);
  const who = await h.admin.me(session);
  assert.equal(who.role, ROLES.ANALYST);
  assert.deepEqual(who.permissions, ['analytics:read']);
});
