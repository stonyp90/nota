// Admin inventory: the operator can inspect the complete domain catalogue and
// the platform feature map without receiving customer PII or a new mutation
// surface. This prevents testament/procuration and preparation features from
// existing only in the public/notary code with no operational visibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const auth = require('../src/admin-auth.js');

const START = 1_700_000_000_000;
const parse = (res) => JSON.parse(res.body);

function make() {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.gonata.ca', devEcho: true },
  });
  const app = createAdminApp(repo, { admin, adminBaseUrl: 'https://admin.gonata.ca', nowMs: () => clock.ms });
  const call = (method, path, bearer) => app.handle({
    method, path, headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '127.0.0.1' } : {},
  });
  return { repo, app, call };
}

async function sessionFor(h, email, profile = {}) {
  if (profile.role || profile.permissions) {
    await h.repo.putAdmin({ id: auth.adminIdForEmail(email), email, role: profile.role || null, permissions: profile.permissions || [], disabled: false });
  }
  const req = JSON.parse((await h.app.handle({ method: 'POST', path: '/admin/auth/request', headers: {}, body: JSON.stringify({ email }) })).body);
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return JSON.parse((await h.app.handle({ method: 'POST', path: '/admin/auth/verify', headers: {}, body: JSON.stringify({ token }) })).body).session;
}

test('catalogue and features require an authenticated analytics reader', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/catalogue')).statusCode, 401);
  assert.equal((await h.call('GET', '/admin/features')).statusCode, 401);
  const analyst = await sessionFor(h, 'analyst@nota.ca', { role: 'analyst' });
  assert.equal((await h.call('GET', '/admin/catalogue', analyst)).statusCode, 200);
  assert.equal((await h.call('GET', '/admin/features', analyst)).statusCode, 200);
});

test('catalogue includes all services and their preparation surfaces', async () => {
  const h = make();
  const session = await sessionFor(h, 'ops@nota.ca');
  const body = parse(await h.call('GET', '/admin/catalogue', session));
  assert.deepEqual(body.services.map((s) => s.id), ['refinancement', 'financement', 'testament', 'procuration']);
  for (const service of body.services) {
    assert.ok(service.pricing.criteria.length, service.id + ' pricing criteria');
    assert.ok(service.documents.length, service.id + ' documents');
    assert.ok(service.champs.length, service.id + ' intake fields');
    assert.ok(service.planNotaire.length, service.id + ' notary control plan');
    assert.ok(service.ai.fields.length, service.id + ' AI evidence fields');
  }
  const will = body.services.find((s) => s.id === 'testament');
  const poa = body.services.find((s) => s.id === 'procuration');
  assert.ok(will.champs.some((f) => f.id === 'beneficiaires_legataires'));
  assert.ok(poa.champs.some((f) => f.id === 'type_mandat'));
  assert.ok(body.preteurs.length);
  assert.ok(body.deplacements.length);
  assert.ok(body.dates.length);
  assert.equal(body.secrets, undefined);
});

test('feature inventory exposes Stripe and every current customization route', async () => {
  const h = make();
  const session = await sessionFor(h, 'ops@nota.ca');
  const body = parse(await h.call('GET', '/admin/features', session));
  const ids = body.groupes.flatMap((g) => g.fonctionnalites.map((f) => f.id));
  for (const id of ['stripe-checkout', 'stripe-connect', 'stripe-webhooks', 'cnq', 'signing-beta', 'privacy', 'audit']) assert.ok(ids.includes(id), id);
  assert.deepEqual(body.personnalisations.map((x) => x.id), ['prix', 'annulation', 'courriels', 'audiences', 'campagnes', 'acces', 'paiements', 'notaires']);
});
