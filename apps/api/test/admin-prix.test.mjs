// Le prix de Nota est celui de Nota, et Nota le décide (ADR 0031) :
//   • repo.getPrixNotaConfig / putPrixNotaConfig / deletePrixNotaConfig sur LES
//     DEUX adaptateurs (comportement en mémoire ; formes de commandes dynamo
//     contre le faux enregistreur — l'unique item CONFIG#PRIX / PRIX).
//   • GET /admin/prix — défaut + prix stocké, pour tout admin authentifié.
//   • PUT /admin/prix — valide fort (422), 403 pour un analyste, journalisé
//     avec avant/après ; DELETE revient au défaut du déploiement.
//   • la facturation tarife avec le prix stocké dès qu'il existe.
//
// Cette suite remplace admin-commission.test.mjs, qui testait une porte
// d'édition de TAUX. L'art. 29.1 du Code de déontologie interdit au notaire
// toute convention mettant en péril son indépendance et son désintéressement :
// un prix indexé sur une cote attribuée par Nota en était une, et il n'y a donc
// plus de barème à éditer — un montant, et c'est tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createBilling } = require('../src/billing.js');
const prixConfig = require('../src/prix-nota-config.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-08-27';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();

// 250,00 $ — un prix rond que Nota pourrait décider demain.
const PRIX = { prixCents: 25000 };

// ============================================================================
// prix-nota-config — la seule autorité sur le défaut, l'environnement, la règle
// ============================================================================

test('envDefaults : le défaut intégré quand l’environnement se tait, NOTA_PRIX_CENTS sinon', () => {
  assert.deepEqual(prixConfig.envDefaults({}), { prixCents: prixConfig.DEFAULT_PRIX_CENTS });
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_CENTS: '25000' }), { prixCents: 25000 });
  // Une valeur illisible se lit comme ABSENTE : un prix périmé doit retomber
  // sur le défaut, jamais faire tomber la tarification.
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_CENTS: '{oops' }), { prixCents: prixConfig.DEFAULT_PRIX_CENTS });
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_CENTS: '0' }), { prixCents: prixConfig.DEFAULT_PRIX_CENTS });
});

test('validatePrix : un entier de cents strictement positif, et rien d’autre', () => {
  const ok = prixConfig.validatePrix({ prixCents: '25000' });
  assert.equal(ok.ok, true);
  assert.equal(ok.prixCents, 25000);

  const codes = (p) => prixConfig.validatePrix(p).errors.map((e) => e.code);
  assert.ok(codes({ prixCents: 0 }).includes('prix_invalide'), 'zéro');
  assert.ok(codes({ prixCents: -40000 }).includes('prix_invalide'), 'négatif');
  assert.ok(codes({ prixCents: 400.5 }).includes('prix_invalide'), 'fraction de cent');
  assert.ok(codes({ prixCents: '0,15' }).includes('prix_invalide'), 'un taux n’est pas un prix');
  assert.ok(codes({}).includes('prix_invalide'), 'absent');
});

// ============================================================================
// Repo port — adaptateur en mémoire
// ============================================================================

test('memory repo : le prix fait l’aller-retour, estampille updatedAt, et se supprime', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getPrixNotaConfig(), null);
  const stored = await repo.putPrixNotaConfig(PRIX, NOW_ISO);
  assert.deepEqual(stored, { ...PRIX, updatedAt: NOW_ISO });
  assert.deepEqual(await repo.getPrixNotaConfig(), stored);
  await repo.deletePrixNotaConfig();
  assert.equal(await repo.getPrixNotaConfig(), null);
});

// ============================================================================
// Repo port — formes de commandes dynamo (faux enregistreur, aucun AWS)
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

test('dynamo repo : le prix est l’unique item CONFIG#PRIX / PRIX de la table PRINCIPALE', async () => {
  const { repo, sent } = recordingRepo((rec) => {
    if (rec.name === 'GetCommand') {
      return { Item: { PK: 'CONFIG#PRIX', SK: 'PRIX', type: 'prix_nota_config', ...PRIX, updatedAt: NOW_ISO } };
    }
    return {};
  });

  await repo.putPrixNotaConfig(PRIX, NOW_ISO);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'main', 'la facturation lit le prix sur la table qu’elle possède déjà');
  assert.equal(put.input.Item.PK, 'CONFIG#PRIX');
  assert.equal(put.input.Item.SK, 'PRIX');
  assert.equal(put.input.Item.prixCents, 25000);
  assert.equal(put.input.Item.updatedAt, NOW_ISO);

  const got = await repo.getPrixNotaConfig();
  const get = sent.find((s) => s.name === 'GetCommand');
  assert.deepEqual(get.input.Key, { PK: 'CONFIG#PRIX', SK: 'PRIX' });
  assert.equal(got.PK, undefined, 'les clés de stockage sont retirées à la lecture');
  assert.equal(got.prixCents, 25000);

  await repo.deletePrixNotaConfig();
  const del = sent.find((s) => s.name === 'DeleteCommand');
  assert.deepEqual(del.input.Key, { PK: 'CONFIG#PRIX', SK: 'PRIX' });
});

// ============================================================================
// API admin — routes, permissions, validation, audit
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

test('toutes les routes du prix sont 401 sans session', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/prix')).statusCode, 401);
  assert.equal((await h.call('PUT', '/admin/prix', { body: PRIX })).statusCode, 401);
  assert.equal((await h.call('DELETE', '/admin/prix')).statusCode, 401);
});

test('GET montre le défaut et aucun prix stocké ; l’analyste lit mais n’écrit jamais', async () => {
  const h = make();
  const analyst = await loginAnalyst(h);
  const body = parse(await h.call('GET', '/admin/prix', { bearer: analyst }));
  assert.equal(body.defaut.prixCents, prixConfig.DEFAULT_PRIX_CENTS);
  assert.equal(body.override, null);
  assert.deepEqual(body.effectif, body.defaut, 'aucun prix stocké → le défaut gouverne');
  // Le défaut est un MONTANT : la porte ne porte plus rien qui ressemble à un
  // taux, un plancher ou un palier (art. 29.1).
  assert.deepEqual(Object.keys(body.defaut), ['prixCents']);

  const put = await h.call('PUT', '/admin/prix', { bearer: analyst, body: PRIX });
  assert.equal(put.statusCode, 403);
  const del = await h.call('DELETE', '/admin/prix', { bearer: analyst });
  assert.equal(del.statusCode, 403);
});

test('super_admin enregistre un prix : validé, en vigueur, journalisé ; DELETE réinitialise', async () => {
  const h = make();
  const session = await login(h);

  const bad = await h.call('PUT', '/admin/prix', { bearer: session, body: { prixCents: 0.15 } });
  assert.equal(bad.statusCode, 422);
  assert.ok(parse(bad).errors.map((e) => e.code).includes('prix_invalide'));

  const put = await h.call('PUT', '/admin/prix', { bearer: session, body: PRIX });
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(parse(put).override, { ...PRIX, updatedAt: NOW_ISO });

  const read = parse(await h.call('GET', '/admin/prix', { bearer: session }));
  assert.equal(read.override.prixCents, 25000);
  assert.equal(read.effectif.prixCents, 25000, 'le prix stocké EST celui en vigueur');

  // Le changement est au journal d'audit avec son avant/après.
  const auditDay = NOW_ISO.slice(0, 10);
  const updated = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'prix_nota_updated');
  assert.ok(updated, 'entrée d’audit prix_nota_updated manquante');
  assert.equal(updated.meta.before, null);
  assert.equal(updated.meta.after.prixCents, 25000);

  const del = await h.call('DELETE', '/admin/prix', { bearer: session });
  assert.equal(del.statusCode, 200, del.body);
  assert.equal(await h.repo.getPrixNotaConfig(), null);
  const reset = (await h.repo.queryAuditByDay(auditDay)).find((a) => a.action === 'prix_nota_reset');
  assert.ok(reset, 'entrée d’audit prix_nota_reset manquante');
  assert.equal(reset.meta.before.prixCents, 25000);
});

// ============================================================================
// La porte et la tarification lisent le MÊME item
// ============================================================================

test('un prix enregistré depuis la console tarife l’offre suivante ; une remise à zéro rend le défaut', async () => {
  const h = make();
  const session = await login(h);
  const billing = createBilling({ repo: h.repo, stripe: {}, now: () => NOW_ISO });

  assert.equal((await billing.quoteOffer(2000)).prixNotaCents, prixConfig.DEFAULT_PRIX_CENTS);

  assert.equal((await h.call('PUT', '/admin/prix', { bearer: session, body: PRIX })).statusCode, 200);
  const apres = await billing.quoteOffer(2000);
  assert.equal(apres.prixNotaCents, 25000, 'le prix se relit à chaque devis — aucun déploiement');
  assert.equal(apres.honorairesCents, 200_000, 'et les honoraires du notaire ne bougent pas d’un cent');
  assert.equal(apres.totalCents, 225_000);

  assert.equal((await h.call('DELETE', '/admin/prix', { bearer: session })).statusCode, 200);
  assert.equal((await billing.quoteOffer(2000)).prixNotaCents, prixConfig.DEFAULT_PRIX_CENTS);
});
