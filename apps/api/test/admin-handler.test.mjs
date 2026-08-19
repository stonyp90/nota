import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const notaryAuth = require('../src/notary-auth.js');

const TODAY = '2026-08-14';
const START = 1_700_000_000_000;

function make(adminConfig = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true, ...adminConfig },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call };
}

const parse = (res) => JSON.parse(res.body);

async function login(h) {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  const verified = parse(await h.call('POST', '/admin/auth/verify', { body: { token } }));
  return verified.session;
}

test('POST /admin/auth/request returns only ok + a devLink — never a session or token', async () => {
  const h = make();
  const res = await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.equal(body.session, undefined);
  assert.equal(body.token, undefined); // a bare email can NEVER yield a credential
});

test('a non-allowlisted email gets the same 200 with no devLink (no enumeration)', async () => {
  const h = make();
  const body = parse(await h.call('POST', '/admin/auth/request', { body: { email: 'stranger@example.com' } }));
  assert.deepEqual(body, { ok: true });
});

test('full magic-link flow: request → verify → me → overview', async () => {
  const h = make();
  const session = await login(h);
  assert.ok(session);

  const me = parse(await h.call('GET', '/admin/me', { bearer: session }));
  assert.equal(me.email, 'ops@nota.ca');
  assert.equal(me.role, 'super_admin');

  const ov = await h.call('GET', '/admin/metrics/overview', { bearer: session });
  assert.equal(ov.statusCode, 200);
  const data = parse(ov);
  assert.ok(data.kpis && data.gauge && data.series);
  assert.equal(ov.headers['cache-control'], 'no-store');
});

test('a magic link is single-use: replaying verify returns 401', async () => {
  const h = make();
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  assert.equal((await h.call('POST', '/admin/auth/verify', { body: { token } })).statusCode, 200);
  assert.equal((await h.call('POST', '/admin/auth/verify', { body: { token } })).statusCode, 401);
});

test('a valid NOTARY token is rejected on an admin route (surfaces do not share credentials)', async () => {
  const h = make();
  const notaryToken = notaryAuth.signToken('N123', START + 1e9, notaryAuth.SCOPES.SESSION);
  const res = await h.call('GET', '/admin/metrics/overview', { bearer: notaryToken });
  assert.equal(res.statusCode, 401);
});

test('overview without a bearer is 401', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/metrics/overview')).statusCode, 401);
});

test('logout revokes the session: the same token is 401 afterward', async () => {
  const h = make();
  const session = await login(h);
  assert.equal((await h.call('GET', '/admin/me', { bearer: session })).statusCode, 200);
  await h.call('POST', '/admin/auth/logout', { bearer: session });
  assert.equal((await h.call('GET', '/admin/me', { bearer: session })).statusCode, 401);
});

test('the request endpoint is rate-limited to 429 after the cap', async () => {
  const h = make({ rlMax: 2, rlWindowSec: 900 });
  await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  const third = await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  assert.equal(third.statusCode, 429);
});

test('this Lambda answers nothing outside /admin/* — a public route is 404', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/bids', { query: { month: '2026-08' } })).statusCode, 404);
  assert.equal((await h.call('GET', '/')).statusCode, 404);
});

test('OPTIONS preflight returns 204 with the locked admin origin', async () => {
  const h = make();
  const res = await h.call('OPTIONS', '/admin/metrics/overview');
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://admin.nota.ca');
});

test('every admin response carries x-robots-tag noindex (the API origin is reachable directly, bypassing the CDN header policy)', async () => {
  const h = make();
  const session = await login(h);
  // Success, error, preflight, and out-of-surface 404 — all must refuse indexing.
  for (const res of [
    await h.call('GET', '/admin/me', { bearer: session }),
    await h.call('GET', '/admin/metrics/overview'), // 401
    await h.call('OPTIONS', '/admin/metrics/overview'), // 204
    await h.call('GET', '/'), // 404
  ]) {
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  }
});
