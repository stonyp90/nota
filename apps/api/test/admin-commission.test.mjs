// The commission barème is Nota's to decide (ADR 0021 §3/§4):
//   • repo.getCommissionConfig / putCommissionConfig / deleteCommissionConfig
//     on BOTH adapters (memory behaviour; dynamo command shapes against the
//     recording fake — the single CONFIG#COMMISSION / BAREME item).
//   • GET /admin/commission — defaults + stored override, any authenticated admin.
//   • PUT /admin/commission — validates loudly (422), 403 for an analyst,
//     audit-logged with before/after; DELETE resets to the environment defaults.
//   • billing prices from the stored barème the moment it exists (billing.test.mjs
//     holds the settlement-side proof; here the resolution contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const commissionConfig = require('../src/commission-config.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-08-27';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();

// ADR 0028: un palier est désormais UNE cote atteinte → le taux que Nota garde.
const BAREME = {
  taux: 0.12,
  plancher: 0.06,
  paliers: [{ cote: 70, taux: 0.08 }],
};

// ============================================================================
// commission-config — the one authority on defaults, env parsing, validation
// ============================================================================

test('envDefaults: built-ins when the environment is silent; the env vars are actually read (ADR 0016 gap)', () => {
  // ADR 0028: le défaut expédié est l'échelle de la cote — 15 % au départ,
  // 5 % au sommet, et le notaire garde donc de 85 % à 95 %.
  assert.deepEqual(commissionConfig.envDefaults({}), {
    taux: 0.15,
    plancher: 0.05,
    paliers: [
      { cote: 60, taux: 0.12 },
      { cote: 70, taux: 0.10 },
      { cote: 80, taux: 0.08 },
      { cote: 90, taux: 0.05 },
    ],
  });
  const env = {
    NOTA_COMMISSION_RATE: '0.08',
    NOTA_COMMISSION_RATE_FLOOR: '0.04',
    NOTA_COMMISSION_TIERS: '[{"cote":75,"taux":0.06}]',
  };
  assert.deepEqual(commissionConfig.envDefaults(env), {
    taux: 0.08,
    plancher: 0.04,
    paliers: [{ cote: 75, taux: 0.06 }],
  });
  // Garbage in the tiers env var falls back to the defaults — never a crash.
  const broken = commissionConfig.envDefaults({ NOTA_COMMISSION_TIERS: '{oops' });
  assert.equal(broken.paliers.length, commissionConfig.DEFAULT_TIERS.length);
  // Et la forme d'avant l'ADR 0028 n'est plus un barème : elle se lit comme
  // absente, jamais comme une grille à moitié comprise.
  const perime = commissionConfig.envDefaults({ NOTA_COMMISSION_TIERS: '[{"note":4,"avis":2,"bonus":0.02}]' });
  assert.deepEqual(perime.paliers, commissionConfig.DEFAULT_TIERS);
});

test('validateSchedule: a clean barème normalizes; every malformed field is a typed error', () => {
  const ok = commissionConfig.validateSchedule({ taux: '0.12', plancher: 0.06, paliers: [{ cote: '70', taux: 0.08 }] });
  assert.equal(ok.ok, true);
  assert.deepEqual({ taux: ok.taux, plancher: ok.plancher, paliers: ok.paliers }, BAREME);

  const codes = (p) => commissionConfig.validateSchedule(p).errors.map((e) => e.code);
  assert.ok(codes({ taux: 1.2, plancher: 0.05, paliers: [] }).includes('taux_invalide'), 'taux ≥ 1');
  assert.ok(codes({ taux: 0.1, plancher: 0.2, paliers: [] }).includes('plancher_invalide'), 'floor above the rate');
  assert.ok(codes({ taux: 0.1, plancher: 0.05 }).includes('paliers_invalides'), 'paliers must be a list');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 0, taux: 0.08 }] }).includes('palier_invalide'), 'cote 0');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 101, taux: 0.08 }] }).includes('palier_invalide'), 'cote 101');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 70.5, taux: 0.08 }] }).includes('palier_invalide'), 'cote fractionnaire');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 70, taux: 0.02 }] }).includes('palier_invalide'), 'sous le plancher');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 70, taux: 0.5 }] }).includes('palier_invalide'), 'au-dessus du taux de base');
  assert.ok(codes({ taux: 0.1, plancher: 0.05, paliers: [{ cote: 60, taux: 0.07 }, { cote: 80, taux: 0.09 }] }).includes('paliers_invalides'), 'une cote plus haute ne coûte jamais plus cher');
});

// ============================================================================
// Repo port — memory adapter behaviour
// ============================================================================

test('memory repo: the barème round-trips, stamps updatedAt, and deletes back to null', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getCommissionConfig(), null);
  const stored = await repo.putCommissionConfig(BAREME, NOW_ISO);
  assert.deepEqual(stored, { ...BAREME, updatedAt: NOW_ISO });
  assert.deepEqual(await repo.getCommissionConfig(), stored);
  await repo.deleteCommissionConfig();
  assert.equal(await repo.getCommissionConfig(), null);
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

test('dynamo repo: the barème is the single CONFIG#COMMISSION / BAREME item on the MAIN table', async () => {
  const { repo, sent } = recordingRepo((rec) => {
    if (rec.name === 'GetCommand') {
      return { Item: { PK: 'CONFIG#COMMISSION', SK: 'BAREME', type: 'commission_config', ...BAREME, updatedAt: NOW_ISO } };
    }
    return {};
  });

  await repo.putCommissionConfig(BAREME, NOW_ISO);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'main', 'billing reads the barème from the table it already owns');
  assert.equal(put.input.Item.PK, 'CONFIG#COMMISSION');
  assert.equal(put.input.Item.SK, 'BAREME');
  assert.equal(put.input.Item.taux, 0.12);
  assert.equal(put.input.Item.updatedAt, NOW_ISO);

  const got = await repo.getCommissionConfig();
  const get = sent.find((s) => s.name === 'GetCommand');
  assert.deepEqual(get.input.Key, { PK: 'CONFIG#COMMISSION', SK: 'BAREME' });
  assert.equal(got.PK, undefined, 'storage keys are stripped on read');
  assert.equal(got.taux, 0.12);

  await repo.deleteCommissionConfig();
  const del = sent.find((s) => s.name === 'DeleteCommand');
  assert.deepEqual(del.input.Key, { PK: 'CONFIG#COMMISSION', SK: 'BAREME' });
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

test('every commission route is 401 without a session', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/commission')).statusCode, 401);
  assert.equal((await h.call('PUT', '/admin/commission', { body: BAREME })).statusCode, 401);
  assert.equal((await h.call('DELETE', '/admin/commission')).statusCode, 401);
});

test('GET shows the defaults and no override; an analyst may read but never write', async () => {
  const h = make();
  const analyst = await loginAnalyst(h);
  const body = parse(await h.call('GET', '/admin/commission', { bearer: analyst }));
  assert.equal(body.defaut.taux, 0.15, 'Nota ne prend jamais plus de 15 %');
  assert.equal(body.defaut.plancher, 0.05, 'et jamais moins de 5 %');
  assert.deepEqual(body.defaut.paliers[body.defaut.paliers.length - 1], { cote: 90, taux: 0.05 },
    'au-dessus de 90, le notaire garde 95 %');
  assert.equal(body.override, null);
  assert.deepEqual(body.effectif, body.defaut, 'no override → the defaults rule');

  const put = await h.call('PUT', '/admin/commission', { bearer: analyst, body: BAREME });
  assert.equal(put.statusCode, 403);
  const del = await h.call('DELETE', '/admin/commission', { bearer: analyst });
  assert.equal(del.statusCode, 403);
});

test('super_admin stores a barème: validated, effective, audit-logged; DELETE resets', async () => {
  const h = make();
  const session = await login(h);

  const bad = await h.call('PUT', '/admin/commission', { bearer: session, body: { taux: 2, plancher: 0.5, paliers: 'non' } });
  assert.equal(bad.statusCode, 422);
  assert.ok(parse(bad).errors.map((e) => e.code).includes('taux_invalide'));

  const put = await h.call('PUT', '/admin/commission', { bearer: session, body: BAREME });
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(parse(put).override, { ...BAREME, updatedAt: NOW_ISO });

  const read = parse(await h.call('GET', '/admin/commission', { bearer: session }));
  assert.equal(read.override.taux, 0.12);
  assert.equal(read.effectif.taux, 0.12, 'the stored barème IS the effective one');

  // The change is in the audit log with its before/after.
  const auditDay = NOW_ISO.slice(0, 10);
  const updated = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'commission_schedule_updated');
  assert.ok(updated, 'commission_schedule_updated audit entry missing');
  assert.equal(updated.meta.before, null);
  assert.equal(updated.meta.after.taux, 0.12);

  const del = await h.call('DELETE', '/admin/commission', { bearer: session });
  assert.equal(del.statusCode, 200, del.body);
  assert.equal((await h.repo.getCommissionConfig()), null);
  const reset = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'commission_schedule_reset');
  assert.ok(reset, 'commission_schedule_reset audit entry missing');
  assert.equal(reset.meta.before.taux, 0.12);
});
