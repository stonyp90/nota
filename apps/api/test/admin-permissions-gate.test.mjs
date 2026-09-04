// Audit console admin (2026-09-03), P0-9 et P0-10 : ce que le catalogue publie
// doit être ce que le serveur applique, et une porte qui n'est gardée nulle
// part n'est pas une permission — c'est une promesse.
//
//   • `permissions:read` garde désormais GET /admin/permissions ;
//   • `services:write` sort du catalogue (aucune route ne l'appliquait) — mais
//     un groupe déjà stocké qui la porte continue de se charger, et ses membres
//     de se connecter ;
//   • GET /admin/metrics/overview exige `analytics:read`, et ne livre le
//     courriel d'un partenaire qu'à qui détient `pii:read` ;
//   • GET /admin/me dit la fenêtre d'inactivité de la session, pour que la
//     console ne vise plus le plafond de 12 h alors que la session meurt à
//     30 min d'inactivité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const rbac = require('../src/rbac.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-09-03';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();
const parse = (res) => JSON.parse(res.body);

function make(over = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: {
      allowlist: ['ops@nota.ca', 'nu@nota.ca', 'analyst@nota.ca'],
      baseUrl: 'https://admin.nota.ca',
      devEcho: true,
      ...(over.config || {}),
    },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: over.analytics || createAnalytics({ repo, now: () => TODAY }),
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

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

// Un compte connu SANS rôle, sans groupe, sans grant : il ouvre une session,
// et ne peut rien.
async function loginNu(h, email = 'nu@nota.ca', extra = {}) {
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: null, disabled: false, createdAt: NOW_ISO, ...extra });
  return login(h, email);
}

// ============================================================================
// permissions:read
// ============================================================================

test('GET /admin/permissions exige « permissions:read » — un compte nu reçoit 403', async () => {
  const h = make();
  const nu = await loginNu(h);
  const res = await h.call('GET', '/admin/permissions', { bearer: nu });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(parse(res).errors[0].code, 'interdit');
});

test('le catalogue s’ouvre au joker et à un grant direct « permissions:read »', async () => {
  const h = make();
  const s = await login(h);
  assert.equal((await h.call('GET', '/admin/permissions', { bearer: s })).statusCode, 200);

  const lecteur = await loginNu(h, 'nu@nota.ca', { permissions: ['permissions:read'] });
  const res = await h.call('GET', '/admin/permissions', { bearer: lecteur });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(parse(res).permissions.some((p) => p.cle === 'permissions:read'));
});

// ============================================================================
// Le catalogue ne publie que ce qui est appliqué
// ============================================================================

test('« services:write » n’est plus publié — aucune route ne l’applique', async () => {
  const h = make();
  const s = await login(h);
  const body = parse(await h.call('GET', '/admin/permissions', { bearer: s }));
  const cles = body.permissions.map((p) => p.cle);
  assert.equal(cles.includes('services:write'), false, 'une permission gardée nulle part est une promesse, pas une permission');
  // « Publié == appliqué » se vérifie contre le CODE, pas contre le catalogue
  // lui-même (la version précédente comparait rbac.PERMISSIONS à rbac.PERMISSIONS
  // et ne pouvait jamais rougir — c'est ainsi que billing:write est resté publié
  // sans qu'aucune route ne l'applique). Une clé publiée doit apparaître dans un
  // garde `rbac.can(…, 'clé')` de la couche admin.
  const source = ['admin.js', 'admin-handler.js']
    .map((f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
  const appliquees = new Set([...source.matchAll(/rbac\.can\([^,]+,\s*'([a-z]+:[a-z]+)'\)/g)].map((m) => m[1]));
  for (const k of cles) {
    assert.ok(appliquees.has(k), k + ' est publiée mais aucun garde rbac.can() ne l’applique');
  }
  // Celles-ci SONT gardées (activation d'un notaire, journal, campagnes) : elles restent.
  for (const k of ['moderation:write', 'audit:read', 'campaigns:send', 'permissions:read']) {
    assert.ok(cles.includes(k), k + ' reste au catalogue');
  }
});

test('un groupe déjà stocké avec « services:write » se charge encore, et ses membres se connectent', async () => {
  const h = make();
  const s = await login(h);
  // Écrit directement au dépôt, comme un groupe créé avant le nettoyage.
  await h.repo.putGroup({ id: 'catalogue', nom: 'Catalogue', description: '', permissions: ['services:write', 'audit:read'] }, NOW_ISO);
  const liste = parse(await h.call('GET', '/admin/groups', { bearer: s }));
  const g = liste.groupes.find((x) => x.id === 'catalogue');
  assert.ok(g, 'le groupe se lit toujours');
  assert.deepEqual(g.permissions, ['services:write', 'audit:read'], 'ses données ne sont pas réécrites en silence');

  const membre = await loginNu(h, 'nu@nota.ca', { groupes: ['catalogue'] });
  const moi = parse(await h.call('GET', '/admin/me', { bearer: membre }));
  assert.ok(moi.permissions.includes('audit:read'), 'la permission encore appliquée mord');
  assert.equal((await h.call('GET', '/admin/audit', { bearer: membre, query: { jour: TODAY } })).statusCode, 200);
});

// ============================================================================
// analytics:read sur l'aperçu, pii:read sur le courriel des partenaires
// ============================================================================

function fakeAnalytics() {
  return {
    overview: async () => ({
      range: { from: '2026-08-05', to: TODAY, days: 30 },
      kpis: { offersPosted: 1, offersRetained: 0, retentionRate: 0, commissionCents: 0, actsCompleted: 0 },
      gauge: { open: 1, retained: 0, activeNotaries: 0, onboardingNotaries: 0, pendingNotaries: 0 },
      series: { offersPerDay: [], byService: [] },
      entonnoir: [],
      parrainages: {
        client: 50, notaire: 250,
        codes: [{ code: 'ABC123', demandes: 1, retenues: 1, completes: 0, notaires: 0, notairesActifs: 0, du: 50, type: 'courtier', courriel: 'p@courtier.ca', typeNom: 'Courtier', typeNomEn: 'Broker' }],
      },
    }),
  };
}

test('GET /admin/metrics/overview exige « analytics:read »', async () => {
  const h = make({ analytics: fakeAnalytics() });
  const nu = await loginNu(h);
  assert.equal((await h.call('GET', '/admin/metrics/overview', { bearer: nu })).statusCode, 403);
});

test('sans « pii:read », le courriel d’un partenaire ne voyage pas ; avec le joker, il voyage', async () => {
  const h = make({ analytics: fakeAnalytics() });
  const analyste = await loginNu(h, 'analyst@nota.ca', { role: 'analyst' });
  const res = await h.call('GET', '/admin/metrics/overview', { bearer: analyste });
  assert.equal(res.statusCode, 200, res.body);
  const row = parse(res).parrainages.codes[0];
  assert.equal(row.courriel, null, 'l’analyste lit un tableau de bord, pas un annuaire');
  assert.equal(row.type, 'courtier', 'le reste de la ligne est intact');

  const s = await login(h);
  assert.equal(parse(await h.call('GET', '/admin/metrics/overview', { bearer: s })).parrainages.codes[0].courriel, 'p@courtier.ca');
});

// ============================================================================
// /admin/me dit la fenêtre d'inactivité
// ============================================================================

test('GET /admin/me porte la fenêtre d’inactivité et le plafond absolu de la session', async () => {
  const h = make({ config: { sessionIdleTtlMs: 7 * 60 * 1000, sessionAbsoluteTtlMs: 60 * 60 * 1000 } });
  const s = await login(h);
  const moi = parse(await h.call('GET', '/admin/me', { bearer: s }));
  assert.equal(moi.idleTtlMs, 7 * 60 * 1000, 'la console doit viser la vraie échéance');
  assert.equal(moi.expiresAt, new Date(START + 60 * 60 * 1000).toISOString());
});

test('« billing:write » gouverne le prix de Nota : seule, elle ouvre PUT/DELETE /admin/prix ; sans elle ni settings:write, 403', async () => {
  const h = make();
  const s = await login(h);
  const facturier = await loginNu(h, 'nu@nota.ca', { permissions: ['billing:write'] });
  const lecteur = await loginNu(h, 'analyst@nota.ca', { permissions: ['analytics:read'] });
  const body = { prixCents: 25000 };
  const ok = await h.call('PUT', '/admin/prix', { bearer: facturier, body });
  assert.notEqual(ok.statusCode, 403, 'billing:write must not be refused: ' + ok.body);
  assert.notEqual(ok.statusCode, 401, ok.body);
  const non = await h.call('PUT', '/admin/prix', { bearer: lecteur, body });
  assert.equal(non.statusCode, 403, non.body);
  const reset = await h.call('DELETE', '/admin/prix', { bearer: facturier });
  assert.notEqual(reset.statusCode, 403, reset.body);
  // Le super_admin garde son accès (settings:write reste accepté).
  assert.notEqual((await h.call('PUT', '/admin/prix', { bearer: s, body })).statusCode, 403);
});
