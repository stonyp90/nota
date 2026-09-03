/**
 * ADR 0034 — LE PRIX DE NOTA EST UNE GRILLE PAR SERVICE.
 *
 * L'ADR 0031 a mis Nota hors des honoraires du notaire, mais avec UN prix pour
 * tout le catalogue. Un prix unique posé sur des actes inégaux est régressif :
 * 400 $ pesaient 18,2 % d'un financement à 1 800 $ et 9,4 % d'un acte à
 * 4 000 $. La grille corrige le poids sans toucher au mur : le prix dépend du
 * SERVICE et du DÉLAI — deux dimensions publiées — et de rien qui touche au
 * notaire (art. 29.1 C.déont.).
 *
 * Cette suite tient trois choses :
 *   • la configuration (défaut du catalogue, environnement, validation) ;
 *   • la RÉTRO-COMPATIBILITÉ — une configuration stockée à prix unique doit
 *     continuer de tarifer exactement ce qu'elle tarifait la veille ;
 *   • le bout en bout : la console admin écrit la grille, la facturation la
 *     lit, le carnet l'annonce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const prixConfig = require('../src/prix-nota-config.js');
const { createBilling } = require('../src/billing.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createApp } = require('../src/handler.js');
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');

const TODAY = '2026-08-27';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();
const parse = (res) => JSON.parse(res.body);

// La grille du catalogue, telle que le domaine la publie.
const CATALOGUE = domain.prixNotaGrille();

// ===========================================================================
// La configuration — défaut, environnement, validation
// ===========================================================================

test('envDefaults rend la GRILLE du catalogue quand l’environnement se tait', () => {
  const g = prixConfig.envDefaults({});
  assert.deepEqual(g, CATALOGUE);
  assert.equal(g.services.financement, 19900);
  assert.equal(g.services.refinancement, 24900);
  assert.equal(g.garantieDate.standard, 0);
});

test('RÉTRO-COMPATIBILITÉ — NOTA_PRIX_CENTS aplatit la grille sur l’ancien prix unique', () => {
  const g = prixConfig.envDefaults({ NOTA_PRIX_CENTS: '40000' });
  for (const s of domain.SERVICES) assert.equal(g.services[s.id], 40000, s.id);
  for (const t of domain.TIERS) assert.equal(g.garantieDate[t.id], 0, t.id);
  // Une valeur illisible se lit comme absente : le catalogue reprend la main.
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_CENTS: '{oops' }), CATALOGUE);
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_CENTS: '0' }), CATALOGUE);
});

test('NOTA_PRIX_GRILLE porte une grille complète, cellule par cellule', () => {
  const g = prixConfig.envDefaults({
    NOTA_PRIX_GRILLE: JSON.stringify({ services: { financement: 15000 }, garantieDate: { extreme: 90000 } }),
  });
  assert.equal(g.services.financement, 15000);
  assert.equal(g.services.refinancement, 24900, 'les cellules muettes restent celles du catalogue');
  assert.equal(g.garantieDate.extreme, 90000);
  // Un JSON illisible ne fait jamais tomber la tarification.
  assert.deepEqual(prixConfig.envDefaults({ NOTA_PRIX_GRILLE: '{oops' }), CATALOGUE);
});

test('validatePrix accepte la grille, et refuse tout ce qui ressemble à un ratio', () => {
  const ok = prixConfig.validatePrix({ services: { refinancement: '30000' }, garantieDate: { rapide: 7500 } });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors || []));
  assert.equal(ok.config.services.refinancement, 30000, 'les cents sont normalisés en entiers');
  assert.equal(ok.config.garantieDate.rapide, 7500);
  assert.equal(ok.grille.services.refinancement, 30000, 'la grille en vigueur est calculée sur-le-champ');

  const codes = (p) => (prixConfig.validatePrix(p).errors || []).map((e) => e.code);
  assert.ok(codes({ services: { refinancement: 0.15 } }).includes('prix_invalide'), 'un taux');
  assert.ok(codes({ services: { refinancement: 0 } }).includes('prix_invalide'), 'zéro');
  assert.ok(codes({ services: { refinancement: -1 } }).includes('prix_invalide'), 'négatif');
  assert.ok(codes({ services: { refinancement: 300.5 } }).includes('prix_invalide'), 'fraction de cent');
  assert.ok(codes({ services: { succession: 30000 } }).includes('service_inconnu'), 'un service hors catalogue');
  assert.ok(codes({ garantieDate: { demain: 100 } }).includes('palier_inconnu'), 'un palier hors catalogue');
  assert.ok(codes({}).includes('prix_invalide'), 'une grille vide ne décide rien');
});

test('la garantie de date peut valoir ZÉRO — un service, jamais', () => {
  assert.equal(prixConfig.validatePrix({ garantieDate: { rapide: 0 } }).ok, true,
    'renoncer à facturer la garantie de date est une décision légitime');
  assert.equal(prixConfig.validatePrix({ services: { financement: 0 } }).ok, false,
    'un service gratuit ne serait plus un prix : l’art. 33 interdit de rien donner');
});

test('RÉTRO-COMPATIBILITÉ — validatePrix accepte encore l’ancien corps { prixCents }', () => {
  const v = prixConfig.validatePrix({ prixCents: '40000' });
  assert.equal(v.ok, true);
  assert.equal(v.prixCents, 40000, 'l’ancien contrat rend l’ancien champ');
  for (const s of domain.SERVICES) assert.equal(v.grille.services[s.id], 40000);
});

test('resolveGrille : le stocké l’emporte, l’illisible retombe, le legacy vaut encore', async () => {
  const repo = createMemoryRepo();
  assert.deepEqual(await prixConfig.resolveGrille(repo, {}), CATALOGUE);

  await repo.putPrixNotaConfig({ services: { refinancement: 30000 } }, NOW_ISO);
  const g = await prixConfig.resolveGrille(repo, {});
  assert.equal(g.services.refinancement, 30000);
  assert.equal(g.services.financement, 19900, 'les cellules muettes suivent le catalogue');

  await repo.putPrixNotaConfig({ prixCents: 40000 }, NOW_ISO);
  const legacy = await prixConfig.resolveGrille(repo, {});
  for (const s of domain.SERVICES) assert.equal(legacy.services[s.id], 40000);

  await repo.putPrixNotaConfig({ services: { refinancement: 'oups' } }, NOW_ISO);
  assert.deepEqual(await prixConfig.resolveGrille(repo, {}), CATALOGUE,
    'une cellule illisible ne fait pas tomber la tarification');
});

// ===========================================================================
// La facturation — deux lignes, par service et par palier
// ===========================================================================

const fakeStripe = () => ({
  async createConnectAccount(a) { return { accountId: 'acct_' + a.notaryId }; },
  async createOnboardingLink() { return { url: 'https://connect.test/' }; },
  async captureAndTransfer(a) {
    return { chargeId: 'ch', transferId: 'tr', applicationFeeCents: a.applicationFeeCents, netCents: a.amountCents - a.applicationFeeCents };
  },
  async createOfferAuthorization(a) { return { sessionId: 'cs_' + a.bidId, url: 'https://checkout.test/' + a.bidId }; },
});

const billingOn = (repo) => createBilling({ repo, stripe: fakeStripe(), now: () => NOW_ISO });

test('le devis porte la ligne du SERVICE et celle de la GARANTIE DE DATE', async () => {
  const b = billingOn(createMemoryRepo());
  const calme = await b.quoteOffer(2000, { serviceId: 'refinancement', tierId: 'standard' });
  assert.equal(calme.prixNotaServiceCents, 24900);
  assert.equal(calme.prixNotaDateCents, 0);
  assert.equal(calme.prixNotaCents, 24900, 'la somme des deux lignes');
  assert.equal(calme.totalCents, 200_000 + 24900);

  const presse = await b.quoteOffer(2000, { serviceId: 'refinancement', tierId: 'prioritaire' });
  assert.equal(presse.prixNotaServiceCents, 24900, 'le service ne change pas parce que la date approche');
  assert.equal(presse.prixNotaDateCents, domain.tierById('prioritaire').prixNotaDateCents);
  assert.equal(presse.prixNotaCents, presse.prixNotaServiceCents + presse.prixNotaDateCents);
});

test('deux services à la même date ne paient pas le même prix', async () => {
  const b = billingOn(createMemoryRepo());
  const fin = await b.quoteOffer(1800, { serviceId: 'financement', tierId: 'standard' });
  const refi = await b.quoteOffer(1800, { serviceId: 'refinancement', tierId: 'standard' });
  assert.equal(fin.prixNotaCents, 19900);
  assert.equal(refi.prixNotaCents, 24900);
  assert.ok(fin.prixNotaCents < refi.prixNotaCents,
    'le plus petit acte du catalogue porte le plus petit prix — la grille n’est pas régressive');
});

test('ART. 29.1 — à service et palier égaux, le prix ignore la valeur de l’acte', async () => {
  const b = billingOn(createMemoryRepo());
  const vus = [];
  for (const m of [1, 900, 2000, 250_000]) {
    vus.push((await b.quoteOffer(m, { serviceId: 'refinancement', tierId: 'urgence' })).prixNotaCents);
  }
  assert.equal(new Set(vus).size, 1, 'le prix a suivi le montant : ' + vus.join(', '));
});

test('RÉTRO-COMPATIBILITÉ — une config à prix unique tarife encore 400 $ partout', async () => {
  const repo = createMemoryRepo();
  await repo.putPrixNotaConfig({ prixCents: 40000 }, NOW_ISO);
  const b = billingOn(repo);
  for (const serviceId of ['refinancement', 'financement']) {
    for (const tierId of ['standard', 'extreme']) {
      const d = await b.quoteOffer(2000, { serviceId, tierId });
      assert.equal(d.prixNotaCents, 40000, serviceId + '/' + tierId);
      assert.equal(d.prixNotaDateCents, 0, 'un prix unique ne portait aucune garantie de date');
    }
  }
});

test('le règlement capture EXACTEMENT le prix du service et du palier retenus', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const id = 'n-capture';
  await repo.putNotary({
    id, email: 'capture@exemple.ca', connectAccountId: 'acct_' + id,
    status: 'active', chargesEnabled: true, createdAt: NOW_ISO, updatedAt: NOW_ISO,
  });
  const r = await b.completeAct({
    notaryId: id, bidId: 'B1', actAmount: 2000,
    serviceId: 'financement', tierId: 'prioritaire',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors || {}));
  const attendu = domain.prixNota('financement', 'prioritaire').totalCents;
  assert.equal(r.prixNotaCents, attendu);
  assert.equal(r.honorairesCents, 200_000, 'les honoraires restent entiers — art. 32.1 2° L.N.');
});

// ===========================================================================
// La porte admin — éditer la grille comme on éditait le prix
// ===========================================================================

function adminHarness() {
  const repo = createMemoryRepo();
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => START,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => START,
  });
  const call = (method, path, { body, bearer } = {}) =>
    app.handle({
      method, path, query: {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, call };
}

async function login(h) {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.call('POST', '/admin/auth/verify', { body: { token } })).session;
}

test('GET /admin/prix rend la grille en vigueur ET le catalogue à éditer', async () => {
  const h = adminHarness();
  const session = await login(h);
  const body = parse(await h.call('GET', '/admin/prix', { bearer: session }));

  assert.deepEqual(body.defaut, CATALOGUE);
  assert.equal(body.override, null);
  assert.deepEqual(body.effectif, CATALOGUE);
  // La console n'a pas le domaine : le catalogue voyage avec la grille, sans
  // quoi l'écran devrait coder en dur les services et les paliers.
  assert.ok(Array.isArray(body.catalogue.services));
  assert.deepEqual(
    body.catalogue.services.map((s) => s.id),
    domain.SERVICES.map((s) => s.id),
  );
  assert.equal(body.catalogue.services[0].nom, domain.SERVICES[0].nom);
  assert.deepEqual(
    body.catalogue.garantieDate.map((t) => t.id),
    domain.TIERS.map((t) => t.id),
  );
});

test('PUT /admin/prix enregistre une grille, la journalise, et tarife la suite', async () => {
  const h = adminHarness();
  const session = await login(h);
  const billing = createBilling({ repo: h.repo, stripe: fakeStripe(), now: () => NOW_ISO });

  assert.equal(
    (await billing.quoteOffer(2000, { serviceId: 'refinancement', tierId: 'standard' })).prixNotaCents,
    24900,
  );

  const grille = { services: { refinancement: 29900, financement: 21900 }, garantieDate: { prioritaire: 15000 } };
  const put = await h.call('PUT', '/admin/prix', { bearer: session, body: grille });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(parse(put).override.services.refinancement, 29900);

  const apres = await billing.quoteOffer(2000, { serviceId: 'refinancement', tierId: 'prioritaire' });
  assert.equal(apres.prixNotaServiceCents, 29900, 'le prix se relit à chaque devis — aucun déploiement');
  assert.equal(apres.prixNotaDateCents, 15000);
  assert.equal(apres.honorairesCents, 200_000, 'et les honoraires ne bougent pas d’un cent');

  const audit = (await h.repo.queryAuditByDay(NOW_ISO.slice(0, 10)))
    .find((a) => a.action === 'prix_nota_updated');
  assert.ok(audit, 'entrée d’audit prix_nota_updated manquante');
  assert.equal(audit.meta.after.services.refinancement, 29900);

  assert.equal((await h.call('DELETE', '/admin/prix', { bearer: session })).statusCode, 200);
  assert.equal(
    (await billing.quoteOffer(2000, { serviceId: 'refinancement', tierId: 'prioritaire' })).prixNotaServiceCents,
    24900,
  );
});

test('PUT /admin/prix refuse un service hors catalogue', async () => {
  const h = adminHarness();
  const session = await login(h);
  const bad = await h.call('PUT', '/admin/prix', { bearer: session, body: { services: { succession: 30000 } } });
  assert.equal(bad.statusCode, 422);
  assert.ok(parse(bad).errors.map((e) => e.code).includes('service_inconnu'));
});

// ===========================================================================
// Le carnet — ce que le client peut lire avant d'offrir
// ===========================================================================

const carnet = (a) => a.handle({ method: 'GET', path: '/bids', headers: {}, query: {} });

test('ART. 68 — le carnet annonce la GRILLE, pas un seul nombre', async () => {
  const repo = createMemoryRepo([]);
  const a = { ...createApp(repo, { now: () => TODAY }), repo };
  const { tarif } = parse(await carnet(a));
  assert.deepEqual(tarif.grille, CATALOGUE);
  assert.equal(tarif.prixNotaMinCents, CATALOGUE.defaut,
    'le « à partir de » est la cellule la plus basse — jamais un prix inventé');
  assert.equal(tarif.taxesIncluses, false);
  assert.equal(tarif.deboursInclus, false);
});

test('le carnet suit la grille stockée, y compris une ancienne à prix unique', async () => {
  const repo = createMemoryRepo([]);
  const a = { ...createApp(repo, { now: () => TODAY }), repo };
  await repo.putPrixNotaConfig({ prixCents: 40000 }, NOW_ISO);
  const { tarif } = parse(await carnet(a));
  assert.equal(tarif.grille.services.financement, 40000);
  assert.equal(tarif.prixNotaMinCents, 40000);
});
