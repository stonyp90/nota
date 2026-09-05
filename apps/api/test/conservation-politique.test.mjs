/**
 * UNE SEULE POLITIQUE DE CONSERVATION, ET LE CODE LA LIT.
 *
 * L'audit du 2026-09-05 a trouvé quatre endroits pour une seule règle : 400
 * jours écrits en clair dans `handler.js`, 400 jours redits dans `keys.js`
 * (avec une note disant que la surcharge d'environnement était fermée POUR
 * CETTE RAISON), sept ans calculés dans le domaine, 180 jours pour les avis —
 * et SIX familles d'enregistrements sans aucune borne : profils de notaires,
 * ACT#, EVAL#, EARN#, EVENT#, UNSUB#.
 *
 * Ce que cette suite tient :
 *   • la durée que POSE le code est celle que la politique DIT, à chaque porte ;
 *   • un réglage d'exploitation déplace les DEUX (le ttl de l'offre et celui de
 *     son index) — c'est précisément ce que la note de `keys.js` déclarait
 *     impossible tant que le handler comptait tout seul ;
 *   • les familles qu'on refuse d'oublier (désabonnement, consentement, marque
 *     d'effacement) ne portent AUCUN ttl, dans les deux adaptateurs.
 *
 * Les attentes sont calculées DEPUIS le domaine, jamais recopiées de la sortie
 * observée : c'est la leçon de `tests-alignes-sur-le-bug`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFakeTable } from './fake-table.mjs';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const keys = require('../src/keys.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createApp } = require('../src/handler.js');

const JOUR = 86400;

// ---------------------------------------------------------------------------
// 1. Les helpers de clés lisent la politique
// ---------------------------------------------------------------------------

test('keys.bidTtl EST la politique « offre » — pas une seconde de plus', () => {
  const dateISO = '2026-12-01';
  assert.equal(keys.bidTtl(dateISO), domain.retentionTtl('offre', dateISO + 'T00:00:00Z'));
});

test('keys.notifTtl EST la politique « avis »', () => {
  const at = '2026-09-05T14:00:00.000Z';
  assert.equal(keys.notifTtl(at), domain.retentionTtl('avis', at));
});

test('une date illisible ne rend AUCUN ttl — jamais un NaN qui vaut « éternel »', () => {
  assert.equal(keys.bidTtl('pas une date'), null);
  assert.equal(keys.notifTtl('jamais'), null);
});

// ---------------------------------------------------------------------------
// 2. La surcharge d'exploitation déplace l'offre ET son index, ensemble
// ---------------------------------------------------------------------------

test('un réglage d’exploitation borne l’offre, et l’index la SUIT', async () => {
  // La note de keys.js : « CELLE-CI N'A PAS DE SURCHARGE, et c'est délibéré :
  // handler.js calcule encore le ttl de l'offre en clair. Une variable
  // d'environnement désaccorderait donc l'index de ce qu'il indexe. » Le
  // handler passe maintenant par la maison commune, donc la porte s'ouvre — et
  // ce test est ce qui interdit de la rouvrir de travers.
  const avant = process.env.NOTA_OFFRE_RETENTION_DAYS;
  process.env.NOTA_OFFRE_RETENTION_DAYS = '30';
  try {
    const dateISO = '2026-12-01';
    const attendu = Math.floor(Date.parse(dateISO + 'T00:00:00Z') / 1000) + 30 * JOUR;
    assert.equal(keys.bidTtl(dateISO), attendu, 'le ttl de l’offre ignore le réglage');

    const repo = createMemoryRepo();
    const indexe = await repo.indexClientBid({ courriel: 'roy@exemple.ca', bidId: 'b1', dateISO, at: '2026-09-05T00:00:00.000Z' });
    assert.equal(indexe.ttl, attendu, 'l’index a survécu à l’offre qu’il indexe');
  } finally {
    if (avant === undefined) delete process.env.NOTA_OFFRE_RETENTION_DAYS;
    else process.env.NOTA_OFFRE_RETENTION_DAYS = avant;
  }
});

// ---------------------------------------------------------------------------
// 3. Le handler ne compte plus tout seul
// ---------------------------------------------------------------------------

const OFFRE = {
  serviceId: 'refinancement',
  dateISO: '2026-12-01',
  montant: 2000,
  nom: 'Roy',
  courriel: 'roy@exemple.ca',
  prefixe: 'G1R',
  pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

async function publier(repo, extra = {}) {
  const app = createApp(repo, { now: () => '2026-09-05', nowMs: () => Date.parse('2026-09-05T12:00:00Z') });
  const res = await app.handle({
    method: 'POST',
    path: '/bids',
    query: {},
    headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ ...OFFRE, ...extra }),
  });
  return { res, body: JSON.parse(res.body) };
}

test('l’offre publiée porte le ttl de la POLITIQUE, calculé au même endroit que tout le reste', async () => {
  const repo = createMemoryRepo();
  const { res, body } = await publier(repo);
  assert.equal(res.statusCode, 201, res.body);
  const stocke = await repo.get(body.bid.id, OFFRE.dateISO);
  assert.equal(stocke.ttl, keys.bidTtl(OFFRE.dateISO));
  assert.equal(stocke.ttl, domain.retentionTtl('offre', OFFRE.dateISO + 'T00:00:00Z'));
});

// ---------------------------------------------------------------------------
// 4. Les six familles qui n'avaient AUCUNE borne en portent une
// ---------------------------------------------------------------------------

function itemsPar(table, prefixe) {
  return [...table.items.values()].filter((i) => String(i.PK).startsWith(prefixe));
}

test('ACT#, EVAL#, EARN# et EVENT# portent enfin un ttl, et c’est celui de la politique', async () => {
  const table = createFakeTable();
  const repo = createDynamoRepo({ tableName: 'nota-main', doc: table.doc });

  const regleLe = '2026-06-15T14:00:00.000Z';
  // `completedAt` est le champ que la PRODUCTION écrit (billing.js, les deux
  // chemins de règlement). Un test qui ancrait le ttl sur un `at` qu'aucun
  // appelant ne pose resterait vert le jour où la chaîne de repli perdrait
  // `completedAt` — et la pièce comptable n'aurait plus aucune borne, en
  // silence.
  await repo.markActCompleted('b1', { bidId: 'b1', actAmount: 4800, completedAt: regleLe });
  const acte = itemsPar(table, 'ACT#')[0];
  assert.ok(acte, 'aucun registre d’acte écrit');
  assert.equal(acte.ttl, domain.retentionTtl('acte', regleLe), 'le registre d’acte court sept ans à compter du RÈGLEMENT');

  await repo.addNotaryEvaluation('roy', { bidId: 'b1', dateISO: '2026-06-15', serviceId: 'refinancement', note: 5, createdAt: regleLe });
  const evaluation = itemsPar(table, 'NOTARY#').find((i) => i.type === 'evaluation');
  assert.ok(evaluation, 'aucune évaluation écrite');
  assert.equal(evaluation.ttl, domain.retentionTtl('evaluation', regleLe));

  await repo.recordReferralEarning({ code: 'EVEROY', track: 'client', refId: 'b1', montant: 50, at: regleLe });
  const gain = itemsPar(table, 'PARTNER#').find((i) => i.type === 'refearn');
  assert.ok(gain, 'aucun gain de parrainage écrit');
  assert.equal(gain.ttl, domain.retentionTtl('gain_parrainage', regleLe));

  await repo.markEventProcessed('evt_1', regleLe);
  const evenement = itemsPar(table, 'EVENT#')[0];
  assert.ok(evenement, 'aucun événement Stripe écrit');
  assert.equal(evenement.ttl, domain.retentionTtl('evenement_stripe', regleLe));
});

test('un instant illisible ne pose AUCUN ttl plutôt qu’une expiration fausse', async () => {
  const table = createFakeTable();
  const repo = createDynamoRepo({ tableName: 'nota-main', doc: table.doc });
  await repo.markActCompleted('b2', { bidId: 'b2', actAmount: 4800 });
  const acte = itemsPar(table, 'ACT#')[0];
  assert.equal(acte.ttl, undefined, 'un ttl inventé détruirait la pièce comptable au hasard');
});

// ---------------------------------------------------------------------------
// 5. Ce qu'on refuse d'oublier ne porte pas de ttl
// ---------------------------------------------------------------------------

test('désabonnement, consentement et marque d’effacement n’expirent JAMAIS', async () => {
  const table = createFakeTable();
  const repo = createDynamoRepo({ tableName: 'nota-main', doc: table.doc });

  await repo.putUnsubscribe('roy@exemple.ca', '2026-09-05T00:00:00.000Z');
  await repo.putEmailConsent('roy@exemple.ca', { base: 'expres', at: '2026-09-05T00:00:00.000Z' });
  await repo.putErasure('roy@exemple.ca', '2026-09-05T00:00:00.000Z');

  for (const prefixe of ['UNSUB#', 'CONSENT#', 'ERASURE#']) {
    for (const item of itemsPar(table, prefixe)) {
      assert.equal(item.ttl, undefined, `${prefixe} porte un ttl : un refus oublié est un refus violé`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. La politique est complète : aucune famille écrite ne lui échappe
// ---------------------------------------------------------------------------

test('chaque famille de la politique est réglable sous une clé unique', () => {
  const cles = domain.RETENTION_FAMILIES.map((f) => f.cle);
  assert.equal(new Set(cles).size, cles.length, 'deux familles partagent la même clé de réglage');
});

// LE DRAPEAU `applique` NE DOIT JAMAIS MENTIR. Il voyage dans l'export remis à
// la personne : une famille annoncée bornée alors qu'aucun adaptateur ne pose
// son ttl promettrait une destruction qui n'aura pas lieu. La vérification lit
// la SOURCE des adaptateurs plutôt que de recopier une liste — deux listes qui
// doivent s'accorder finissent toujours par diverger.
const SOURCES_ADAPTATEURS = [
  readFileSync(fileURLToPath(new URL('../src/repo-dynamo.js', import.meta.url)), 'utf8'),
  readFileSync(fileURLToPath(new URL('../src/keys.js', import.meta.url)), 'utf8'),
].join('\n');

// Les familles dont le ttl se pose par un helper NOMMÉ plutôt que par `ttlDe` :
// il faut les nommer, mais chacune avec la ligne d'adaptateur qui la pose.
const POSEES_AUTREMENT = {
  offre: /bidTtl\(/,
  index_client: /bidTtl\(/,
  avis: /notifTtl\(/,
  journal_audit: /auditRetentionTtl\(/,
};

test('une famille annoncée BORNÉE porte un ttl posé quelque part — sinon le drapeau ment', () => {
  for (const ligne of domain.retentionPolicy({})) {
    if (ligne.jours === null) {
      assert.equal(ligne.applique, null, `« ${ligne.famille} » est indéfinie : elle ne s’applique ni ne s’ignore`);
      continue;
    }
    const motif = POSEES_AUTREMENT[ligne.famille];
    const pose = motif
      ? motif.test(SOURCES_ADAPTATEURS)
      : SOURCES_ADAPTATEURS.includes(`ttlDe('${ligne.famille}'`);
    assert.equal(
      ligne.applique,
      pose,
      pose
        ? `« ${ligne.famille} » pose bien son ttl mais se déclare non appliquée`
        : `« ${ligne.famille} » annonce ${ligne.jours} jours et AUCUN adaptateur ne pose ce ttl`
    );
    if (!pose) assert.ok(ligne.motifNonApplique, `« ${ligne.famille} » n’est pas appliquée sans dire pourquoi`);
  }
});

test('la politique rendue à un écran dit la durée EFFECTIVE et d’où elle vient', () => {
  const lignes = domain.retentionPolicy({ NOTA_AVIS_RETENTION_DAYS: '90' });
  const avis = lignes.find((l) => l.famille === 'avis');
  assert.equal(avis.jours, 90);
  assert.equal(avis.surchargee, true);
  assert.equal(avis.defaut, 180);

  const offre = lignes.find((l) => l.famille === 'offre');
  assert.equal(offre.surchargee, false);
  assert.ok(offre.motif && offre.base, 'une ligne de politique sans motif ni base');
});
