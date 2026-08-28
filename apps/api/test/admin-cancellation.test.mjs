// The cancellation-fee barème is Nota's to decide (ADR 0023 §2):
//   • repo.getCancellationConfig / putCancellationConfig / deleteCancellationConfig
//     on BOTH adapters (memory behaviour; dynamo command shapes against the
//     recording fake — the single CONFIG#ANNULATION / BAREME item).
//   • GET /admin/annulation — defaults + stored override, any authenticated admin.
//   • PUT /admin/annulation — validates loudly (422, out-of-order paliers
//     included), 403 for an analyst, audit-logged with before/after; DELETE
//     resets to the environment defaults.
//   • the public cancel route prices from the stored barème the moment it
//     exists (cancellation-fee.test.mjs holds the route-side proof; here the
//     resolution contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const cancellationConfig = require('../src/cancellation-config.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-08-27';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();

const BAREME = {
  paliers: [{ maxJours: 5, taux: 0.5 }, { maxJours: 20, taux: 0.15 }],
};

// ============================================================================
// cancellation-config — the one authority on defaults, env parsing, validation
// ============================================================================

test('envDefaults: built-ins when the environment is silent; the env var is actually read', () => {
  assert.deepEqual(cancellationConfig.envDefaults({}), {
    paliers: [{ maxJours: 3, taux: 0.30 }, { maxJours: 14, taux: 0.10 }],
  });
  const env = { NOTA_CANCELLATION_TIERS: '[{"maxJours":2,"taux":0.4}]' };
  assert.deepEqual(cancellationConfig.envDefaults(env), {
    paliers: [{ maxJours: 2, taux: 0.4 }],
  });
  // Garbage in the tiers env var falls back to the defaults — never a crash.
  const broken = cancellationConfig.envDefaults({ NOTA_CANCELLATION_TIERS: '{oops' });
  assert.equal(broken.paliers.length, 2);
});

test('validateSchedule: a clean barème normalizes; every malformed field is a typed error', () => {
  const ok = cancellationConfig.validateSchedule({ paliers: [{ maxJours: '5', taux: '0.5' }, { maxJours: 20, taux: 0.15 }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.paliers, BAREME.paliers);

  // An empty barème is VALID — cancellation becomes free everywhere (the
  // kill-switch is data, not a flag).
  const empty = cancellationConfig.validateSchedule({ paliers: [] });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.paliers, []);

  const codes = (p) => cancellationConfig.validateSchedule(p).errors.map((e) => e.code);
  assert.ok(codes({}).includes('paliers_invalides'), 'paliers must be a list');
  assert.ok(codes({ paliers: 'non' }).includes('paliers_invalides'), 'not a list');
  assert.ok(codes({ paliers: Array.from({ length: 11 }, (_, i) => ({ maxJours: i, taux: 0.1 })) }).includes('paliers_invalides'), 'more than 10 tiers');
  assert.ok(codes({ paliers: [{ maxJours: -1, taux: 0.1 }] }).includes('palier_invalide'), 'negative days');
  assert.ok(codes({ paliers: [{ maxJours: 2.5, taux: 0.1 }] }).includes('palier_invalide'), 'fractional days');
  assert.ok(codes({ paliers: [{ maxJours: 3, taux: 0 }] }).includes('palier_invalide'), 'taux 0');
  assert.ok(codes({ paliers: [{ maxJours: 3, taux: 1 }] }).includes('palier_invalide'), 'taux 1');
  assert.ok(codes({ paliers: [{ maxJours: 14, taux: 0.1 }, { maxJours: 3, taux: 0.3 }] }).includes('paliers_desordonnes'), 'out-of-order tiers');
  assert.ok(codes({ paliers: [{ maxJours: 3, taux: 0.3 }, { maxJours: 3, taux: 0.1 }] }).includes('paliers_desordonnes'), 'duplicate maxJours');
});

// ============================================================================
// Repo port — memory adapter behaviour
// ============================================================================

test('memory repo: the barème round-trips, stamps updatedAt, and deletes back to null', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getCancellationConfig(), null);
  const stored = await repo.putCancellationConfig(BAREME, NOW_ISO);
  assert.deepEqual(stored, { ...BAREME, updatedAt: NOW_ISO });
  assert.deepEqual(await repo.getCancellationConfig(), stored);
  await repo.deleteCancellationConfig();
  assert.equal(await repo.getCancellationConfig(), null);
});

// ============================================================================
// Repo port — dynamo adapter command shapes (recording fake, no AWS)
// ============================================================================

function recordingRepo(reply) {
  const sent = [];
  const doc = {
    async send(cmd) {
      const rec = { name: cmd.constructor.name, input: cmd.input };
      sent.push(rec);
      return reply ? reply(rec) : {};
    },
  };
  return { repo: createDynamoRepo({ tableName: 'main', adminTableName: 'admin', doc }), sent };
}

test('dynamo repo: the barème is the single CONFIG#ANNULATION / BAREME item on the MAIN table', async () => {
  const { repo, sent } = recordingRepo((rec) => {
    if (rec.name === 'GetCommand') {
      return { Item: { PK: 'CONFIG#ANNULATION', SK: 'BAREME', type: 'cancellation_config', ...BAREME, updatedAt: NOW_ISO } };
    }
    return {};
  });

  await repo.putCancellationConfig(BAREME, NOW_ISO);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'main', 'the cancel route reads the barème from the table it already owns');
  assert.equal(put.input.Item.PK, 'CONFIG#ANNULATION');
  assert.equal(put.input.Item.SK, 'BAREME');
  assert.deepEqual(put.input.Item.paliers, BAREME.paliers);
  assert.equal(put.input.Item.updatedAt, NOW_ISO);

  const got = await repo.getCancellationConfig();
  const get = sent.find((s) => s.name === 'GetCommand');
  assert.deepEqual(get.input.Key, { PK: 'CONFIG#ANNULATION', SK: 'BAREME' });
  assert.equal(got.PK, undefined, 'storage keys are stripped on read');
  assert.deepEqual(got.paliers, BAREME.paliers);

  await repo.deleteCancellationConfig();
  const del = sent.find((s) => s.name === 'DeleteCommand');
  assert.deepEqual(del.input.Key, { PK: 'CONFIG#ANNULATION', SK: 'BAREME' });
});

// ============================================================================
// Admin API — routes, permissions, validation, audit
// ============================================================================

function make() {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer } = {}) =>
    app.handle({
      method,
      path,
      query: {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call };
}

const parse = (res) => JSON.parse(res.body);

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  const verified = parse(await h.call('POST', '/admin/auth/verify', { body: { token } }));
  return verified.session;
}

async function loginAnalyst(h) {
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email),
    email,
    role: 'analyst',
    disabled: false,
    createdAt: NOW_ISO,
  });
  return login(h, email);
}

test('every annulation route is 401 without a session', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/annulation')).statusCode, 401);
  assert.equal((await h.call('PUT', '/admin/annulation', { body: BAREME })).statusCode, 401);
  assert.equal((await h.call('DELETE', '/admin/annulation')).statusCode, 401);
});

test('GET shows the defaults and no override; an analyst may read but never write', async () => {
  const h = make();
  const analyst = await loginAnalyst(h);
  const body = parse(await h.call('GET', '/admin/annulation', { bearer: analyst }));
  assert.deepEqual(body.defaut.paliers, [{ maxJours: 3, taux: 0.30 }, { maxJours: 14, taux: 0.10 }]);
  assert.equal(body.override, null);
  assert.deepEqual(body.effectif, body.defaut, 'no override → the defaults rule');

  const put = await h.call('PUT', '/admin/annulation', { bearer: analyst, body: BAREME });
  assert.equal(put.statusCode, 403);
  const del = await h.call('DELETE', '/admin/annulation', { bearer: analyst });
  assert.equal(del.statusCode, 403);
});

test('super_admin stores a barème: validated, effective, audit-logged; DELETE resets', async () => {
  const h = make();
  const session = await login(h);

  const bad = await h.call('PUT', '/admin/annulation', { bearer: session, body: { paliers: 'non' } });
  assert.equal(bad.statusCode, 422);
  assert.ok(parse(bad).errors.map((e) => e.code).includes('paliers_invalides'));

  const unordered = await h.call('PUT', '/admin/annulation', {
    bearer: session,
    body: { paliers: [{ maxJours: 14, taux: 0.1 }, { maxJours: 3, taux: 0.3 }] },
  });
  assert.equal(unordered.statusCode, 422);
  assert.ok(parse(unordered).errors.map((e) => e.code).includes('paliers_desordonnes'), 'out-of-order paliers are refused');

  const put = await h.call('PUT', '/admin/annulation', { bearer: session, body: BAREME });
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(parse(put).override, { ...BAREME, updatedAt: NOW_ISO });

  const read = parse(await h.call('GET', '/admin/annulation', { bearer: session }));
  assert.deepEqual(read.override.paliers, BAREME.paliers);
  assert.deepEqual(read.effectif.paliers, BAREME.paliers, 'the stored barème IS the effective one');

  // The change is in the audit log with its before/after.
  const auditDay = NOW_ISO.slice(0, 10);
  const updated = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'cancellation_schedule_updated');
  assert.ok(updated, 'cancellation_schedule_updated audit entry missing');
  assert.equal(updated.meta.before, null);
  assert.deepEqual(updated.meta.after.paliers, BAREME.paliers);

  const del = await h.call('DELETE', '/admin/annulation', { bearer: session });
  assert.equal(del.statusCode, 200, del.body);
  assert.equal((await h.repo.getCancellationConfig()), null);
  const reset = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'cancellation_schedule_reset');
  assert.ok(reset, 'cancellation_schedule_reset audit entry missing');
  assert.deepEqual(reset.meta.before.paliers, BAREME.paliers);
});

test('an EMPTY barème is storable — the override rules and cancellation is free everywhere', async () => {
  const h = make();
  const session = await login(h);
  const put = await h.call('PUT', '/admin/annulation', { bearer: session, body: { paliers: [] } });
  assert.equal(put.statusCode, 200, put.body);

  const read = parse(await h.call('GET', '/admin/annulation', { bearer: session }));
  assert.deepEqual(read.override.paliers, []);
  assert.deepEqual(read.effectif.paliers, [], 'the empty override beats the defaults — the kill-switch is data');

  // The same resolution the public cancel route performs: stored paliers in,
  // zero fee out (route-side proof in cancellation-fee.test.mjs).
  const stored = await h.repo.getCancellationConfig();
  assert.equal(cancellationConfig.feeFor({ montant: 2800, joursAvant: 0, paliers: stored.paliers }).frais, 0);
});
