import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Contract tests for the ADMIN surface (apps/api/src/admin-handler.js against
// apps/api/admin-openapi.yaml). Same idea as contract-public: drive the real
// in-memory admin app, validate each response body against the documented
// schema for its status. Harness mirrors admin-handler.test.mjs.

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../../src/admin-handler.js');
const { createAdmin } = require('../../src/admin.js');
const { createAnalytics } = require('../../src/analytics.js');
const { createMemoryRepo } = require('../../src/repo-memory.js');
const { loadContract, specPath } = require('./openapi-contract.js');

const contract = loadContract(specPath('admin-openapi.yaml'));

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
  const call = (method, routePath, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path: routePath,
      query: query || {},
      headers: bearer
        ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' }
        : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call };
}

const parse = (res) => JSON.parse(res.body);

async function login(h) {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

function assertValid(routePath, method, status, body, { allowNoSchema = false } = {}) {
  const v = contract.validatorForResponse(routePath, method, status);
  if (v.error) {
    if (allowNoSchema && v.error === 'no-json-schema') return;
    assert.fail(`no JSON schema in admin-openapi.yaml for ${method} ${routePath} -> ${status} (${v.error})`);
  }
  const ok = v.validate(body);
  assert.ok(
    ok,
    `${method} ${routePath} -> ${status} body drifted from its admin-openapi schema:\n` +
      JSON.stringify(v.validate.errors, null, 2) + '\nbody: ' + JSON.stringify(body),
  );
}

// --- Auth request (200) + verify (200 SessionGrant) --------------------------

test('POST /admin/auth/request + /verify — 200 ack and SessionGrant shapes validate', async () => {
  const h = make();
  const req = await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } });
  assert.equal(req.statusCode, 200, req.body);
  const reqBody = parse(req);
  assert.equal(reqBody.ok, true);
  assertValid('/admin/auth/request', 'POST', 200, reqBody);

  const token = decodeURIComponent(reqBody.devLink.split('token=')[1]);
  const ver = await h.call('POST', '/admin/auth/verify', { body: { token } });
  assert.equal(ver.statusCode, 200, ver.body);
  const verBody = parse(ver);
  assert.ok(verBody.session, 'a session token is minted');
  assertValid('/admin/auth/verify', 'POST', 200, verBody);
});

// --- /admin/me (200) ---------------------------------------------------------

test('GET /admin/me — 200 principal shape validates', async () => {
  const h = make();
  const session = await login(h);
  const res = await h.call('GET', '/admin/me', { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.role, 'super_admin');
  assert.ok(Array.isArray(body.permissions));
  assertValid('/admin/me', 'GET', 200, body);
});

// --- /admin/metrics/overview (200) -------------------------------------------

test('GET /admin/metrics/overview — 200 dashboard payload validates', async () => {
  const h = make();
  const session = await login(h);
  const res = await h.call('GET', '/admin/metrics/overview', { bearer: session, query: { from: '2026-08-01', to: '2026-08-14' } });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.ok(body.range && body.kpis && body.gauge && body.series && body.parrainages, 'top-level sections present');
  assertValid('/admin/metrics/overview', 'GET', 200, body);
});

// --- refresh (200) + logout (200) --------------------------------------------

test('POST /admin/auth/refresh + /logout — 200 shapes validate', async () => {
  const h = make();
  const session = await login(h);
  const refreshed = await h.call('POST', '/admin/auth/refresh', { bearer: session });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assertValid('/admin/auth/refresh', 'POST', 200, parse(refreshed));

  const out = await h.call('POST', '/admin/auth/logout', { bearer: session });
  assert.equal(out.statusCode, 200, out.body);
  assertValid('/admin/auth/logout', 'POST', 200, parse(out));
});

// --- The shared Errors envelope on a 401 (Unauthorized $ref) -----------------

test('the admin error envelope validates on a 401', async () => {
  const h = make();
  const res = await h.call('GET', '/admin/metrics/overview'); // no bearer
  assert.equal(res.statusCode, 401, res.body);
  const body = parse(res);
  assert.equal(body.errors[0].code, 'non_autorise');
  assertValid('/admin/metrics/overview', 'GET', 401, body);
});

// --- Drift sweep : every documented admin path is routed ---------------------

test('every path in admin-openapi.yaml is routed (no "route inconnue" fall-through)', async () => {
  const h = make();
  for (const { path: routePath, method } of contract.documentedRoutes()) {
    const res = await h.call(method, routePath, { body: {} });
    let msg = null;
    try { msg = JSON.parse(res.body).errors?.[0]?.message ?? null; } catch { /* non-JSON */ }
    assert.notEqual(msg, 'Route inconnue.', `documented ${method} ${routePath} is NOT routed by the admin app`);
  }
});

// --- Drift flag : routed admin paths all documented --------------------------

test('the admin handler routes exactly the documented set (no undocumented route)', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'admin-handler.js'), 'utf8');
  const routed = new Set([...src.matchAll(/route === '([^']+)'/g)].map((m) => m[1]));
  const documented = new Set(contract.documentedRoutes().map((r) => r.path));

  assert.deepEqual([...documented].filter((p) => !routed.has(p)), [], 'admin-openapi.yaml documents a path the app does not route');
  assert.deepEqual([...routed].filter((p) => !documented.has(p)), [], 'the admin handler routes a path missing from admin-openapi.yaml');
});
