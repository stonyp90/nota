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

// --- Email templates (ADR 0018) ----------------------------------------------

test('GET /admin/notifications/templates — 200 merged list validates', async () => {
  const h = make();
  const session = await login(h);
  await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { enabled: true, subjectFr: 'Offre {{montant}}', subjectEn: 'Offer {{montant}}' },
  });
  const res = await h.call('GET', '/admin/notifications/templates', { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.ok(Array.isArray(body.templates) && body.templates.length > 0);
  assertValid('/admin/notifications/templates', 'GET', 200, body);
});

test('PUT + DELETE /admin/notifications/templates/{key} — 200/404/422 shapes validate', async () => {
  const h = make();
  const session = await login(h);

  const put = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    // `offerPublished` est transactionnel : il ne s'éteint pas. Une
    // reformulation, elle, reste permise — c'est ce que le contrat décrit.
    body: { subjectFr: 'Offre {{montant}}', subjectEn: 'Offer {{montant}}' },
  });
  assert.equal(put.statusCode, 200, put.body);
  assertValid('/admin/notifications/templates/{key}', 'PUT', 200, parse(put));

  const unknown = await h.call('PUT', '/admin/notifications/templates/nope', { bearer: session, body: {} });
  assert.equal(unknown.statusCode, 404, unknown.body);
  assertValid('/admin/notifications/templates/{key}', 'PUT', 404, parse(unknown));

  const badToken = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: 'X {{code}}', subjectEn: 'Y {{code}}' },
  });
  assert.equal(badToken.statusCode, 422, badToken.body);
  assertValid('/admin/notifications/templates/{key}', 'PUT', 422, parse(badToken));

  const del = await h.call('DELETE', '/admin/notifications/templates/offerPublished', { bearer: session });
  assert.equal(del.statusCode, 200, del.body);
  assertValid('/admin/notifications/templates/{key}', 'DELETE', 200, parse(del));
});

// --- Groupes d'audience + registre des destinataires (2026-09-04) ------------
// Deux notions qui portaient le MÊME nom dans la console : le groupe RBAC
// (des permissions) et le groupe d'audience (des destinataires). Le contrat
// les sépare, et les deux formes sont validées ici contre leur schéma.

test('GET + PUT + DELETE /admin/audiences/groups — les trois formes valident leur schéma', async () => {
  const h = make();
  const session = await login(h);

  const put = await h.call('PUT', '/admin/audiences/groups/pilote', {
    bearer: session,
    body: { libelle: 'Pilote', audience: 'notaire', nature: 'commercial', membres: ['roy@etude.test'] },
  });
  assert.equal(put.statusCode, 200, put.body);
  assertValid('/admin/audiences/groups/{id}', 'PUT', 200, parse(put));

  const liste = await h.call('GET', '/admin/audiences/groups', { bearer: session });
  assert.equal(liste.statusCode, 200, liste.body);
  const body = parse(liste);
  assert.deepEqual(body.groupes.map((g) => g.id), ['pilote']);
  assertValid('/admin/audiences/groups', 'GET', 200, body);

  const mauvais = await h.call('PUT', '/admin/audiences/groups/pilote', {
    bearer: session,
    body: { libelle: '', audience: 'martien', nature: 'promo', membres: [] },
  });
  assert.equal(mauvais.statusCode, 422, mauvais.body);
  assertValid('/admin/audiences/groups/{id}', 'PUT', 422, parse(mauvais));

  const del = await h.call('DELETE', '/admin/audiences/groups/pilote', { bearer: session });
  assert.equal(del.statusCode, 200, del.body);
  assertValid('/admin/audiences/groups/{id}', 'DELETE', 200, parse(del));

  const absent = await h.call('DELETE', '/admin/audiences/groups/pilote', { bearer: session });
  assert.equal(absent.statusCode, 404, absent.body);
  assertValid('/admin/audiences/groups/{id}', 'DELETE', 404, parse(absent));
});

test('POST /admin/campaigns avec un message composé + GET .../recipients — les deux schémas tiennent', async () => {
  const envoyes = [];
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier: { async sendCampaign(m) { envoyes.push(m); return { sent: true, to: m.to }; } },
    newId: () => `camp-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin, analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca', now: () => TODAY, nowMs: () => clock.ms,
  });
  const call = (method, routePath, { body, bearer, query } = {}) =>
    app.handle({
      method, path: routePath, query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const req = parse(await call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const session = parse(await call('POST', '/admin/auth/verify', {
    body: { token: decodeURIComponent(req.devLink.split('token=')[1]) },
  })).session;

  await repo.putNotary({
    id: 'roy', email: 'roy@etude.test', status: 'active', chargesEnabled: true,
    connectAccountId: 'acct_roy', createdAt: new Date(START - 86400000).toISOString(),
  });

  const message = {
    sujetFr: 'Le carnet vous attend', sujetEn: 'The carnet is waiting',
    corpsFr: 'Des demandes arrivent chaque jour à Québec.', corpsEn: 'Requests arrive every day in Québec.',
  };
  const apercu = await call('POST', '/admin/campaigns/preview', {
    bearer: session, body: { audience: { type: 'user', email: 'roy@etude.test' }, message },
  });
  assert.equal(apercu.statusCode, 200, apercu.body);
  assertValid('/admin/campaigns/preview', 'POST', 200, parse(apercu));

  const envoi = await call('POST', '/admin/campaigns', {
    bearer: session, body: { audience: { type: 'user', email: 'roy@etude.test' }, message },
  });
  assert.equal(envoi.statusCode, 200, envoi.body);
  const envoiBody = parse(envoi);
  assert.equal(envoiBody.envoyes, 1);
  assertValid('/admin/campaigns', 'POST', 200, envoiBody);

  const recus = await call('GET', `/admin/campaigns/${envoiBody.campagneId}/recipients`, { bearer: session });
  assert.equal(recus.statusCode, 200, recus.body);
  const recusBody = parse(recus);
  assert.deepEqual(recusBody.destinataires.map((d) => d.statut), ['envoye']);
  assertValid('/admin/campaigns/{campagneId}/recipients', 'GET', 200, recusBody);

  // LE CHEMIN DE RETOUR. Sans cette liste, l'identifiant ci-dessus ne vivait
  // que dans la réponse de l'envoi : un rechargement coupait l'accès au
  // registre. Le jour par défaut est celui de QUÉBEC.
  const liste = await call('GET', '/admin/campaigns', { bearer: session });
  assert.equal(liste.statusCode, 200, liste.body);
  const listeBody = parse(liste);
  assert.deepEqual(listeBody.campagnes.map((c) => c.campagneId), [envoiBody.campagneId]);
  assertValid('/admin/campaigns', 'GET', 200, listeBody);

  const jourFaux = await call('GET', '/admin/campaigns', { bearer: session, query: { jour: 'hier' } });
  assert.equal(jourFaux.statusCode, 422, jourFaux.body);
  assertValid('/admin/campaigns', 'GET', 422, parse(jourFaux));

  // Ni copie ni gabarit : refusé, et le refus a un schéma lui aussi.
  const vide = await call('POST', '/admin/campaigns', {
    bearer: session, body: { audience: { type: 'user', email: 'roy@etude.test' } },
  });
  assert.equal(vide.statusCode, 422, vide.body);
  assertValid('/admin/campaigns', 'POST', 422, parse(vide));
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
  // Exact-match routes are `route === '...'`; a parameterized route is matched
  // by regex in the handler and declares its documented shape with a
  // `// contract: /admin/...` marker right above the regex.
  const routed = new Set([
    ...[...src.matchAll(/route === '([^']+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/\/\/ contract: (\S+)/g)].map((m) => m[1]),
  ]);
  const documented = new Set(contract.documentedRoutes().map((r) => r.path));

  assert.deepEqual([...documented].filter((p) => !routed.has(p)), [], 'admin-openapi.yaml documents a path the app does not route');
  assert.deepEqual([...routed].filter((p) => !documented.has(p)), [], 'the admin handler routes a path missing from admin-openapi.yaml');
});
