import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLocalAdminApp, seedDevStats, DEV_ADMIN_EMAIL } = require('../admin-local-server.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-20';

// The local admin server is the dev-mode composition root: in-memory repo,
// seeded fixtures + analytics history, devEcho magic links. These tests drive
// the SAME flow the browser does — request a link, redeem it, read the overview.

test('createLocalAdminApp (memory mode) issues a devLink for the dev admin email', async () => {
  const { app, email } = createLocalAdminApp({ today: TODAY });
  assert.equal(email, DEV_ADMIN_EMAIL);

  const res = await app.handle({
    method: 'POST',
    path: '/admin/auth/request',
    headers: {},
    body: JSON.stringify({ email }),
    sourceIp: '127.0.0.1',
  });
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.ok(json.devLink, 'dev mode must echo the magic link');
  assert.ok(json.devLink.includes('#/auth?token='), 'link lands on the SPA auth route');
});

test('a non-allowlisted email gets the same 200 with no devLink', async () => {
  const { app } = createLocalAdminApp({ today: TODAY });
  const res = await app.handle({
    method: 'POST',
    path: '/admin/auth/request',
    headers: {},
    body: JSON.stringify({ email: 'stranger@example.com' }),
    sourceIp: '127.0.0.2',
  });
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.devLink, undefined);
});

test('the devLink redeems for a session and the overview serves seeded, non-empty metrics', async () => {
  const { app, email } = createLocalAdminApp({ today: TODAY });

  const req = await app.handle({
    method: 'POST',
    path: '/admin/auth/request',
    headers: {},
    body: JSON.stringify({ email }),
    sourceIp: '127.0.0.3',
  });
  const token = decodeURIComponent(JSON.parse(req.body).devLink.split('token=')[1]);

  const verify = await app.handle({
    method: 'POST',
    path: '/admin/auth/verify',
    headers: {},
    body: JSON.stringify({ token }),
    sourceIp: '127.0.0.3',
  });
  assert.equal(verify.statusCode, 200);
  const session = JSON.parse(verify.body).session;
  assert.ok(session);

  const overview = await app.handle({
    method: 'GET',
    path: '/admin/metrics/overview',
    query: {},
    headers: { authorization: `Bearer ${session}` },
    sourceIp: '127.0.0.3',
  });
  assert.equal(overview.statusCode, 200);
  const data = JSON.parse(overview.body);
  assert.ok(data.kpis.offersPosted > 0, 'seeded history must show posted offers');
  assert.ok(data.gauge.open > 0, 'fixtures must show live open offers');
  assert.ok(
    data.series.offersPerDay.some((d) => d.count > 0),
    'the offers-per-day series must not be flat zero'
  );
});

test('the /api/admin/* prefix (as proxied by the admin dev server) reaches the same routes', async () => {
  const { app, email } = createLocalAdminApp({ today: TODAY });
  const res = await app.handle({
    method: 'POST',
    path: '/api/admin/auth/request',
    headers: {},
    body: JSON.stringify({ email }),
    sourceIp: '127.0.0.4',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.body).devLink);
});

test('seedDevStats is deterministic and keys history inside the trailing 30 days', async () => {
  const bids = domain.makeFixtures(TODAY);
  const a = createMemoryRepo([]);
  const b = createMemoryRepo([]);
  await seedDevStats(a, bids, TODAY);
  await seedDevStats(b, bids, TODAY);

  const { createAnalytics } = require('../src/analytics.js');
  const overviewA = await createAnalytics({ repo: a, now: () => TODAY }).overview({});
  const overviewB = await createAnalytics({ repo: b, now: () => TODAY }).overview({});
  assert.deepEqual(overviewA.kpis, overviewB.kpis, 'same seed input → same KPIs');
  assert.equal(overviewA.kpis.offersPosted, bids.length, 'every fixture bid lands in the 30-day window');
});
