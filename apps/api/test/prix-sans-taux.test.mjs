import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const prix = require('../src/prix-nota-config.js');
const domain = require('@nota/domain');

const NOW = '2026-09-02T12:00:00.000Z';

/**
 * GARDE DÉONTOLOGIQUE — le calcul du prix ne peut pas redevenir un taux.
 *
 * **Art. 29.1 du Code de déontologie des notaires** : « Le notaire ne peut
 * conclure aucune convention ayant pour effet de mettre en péril
 * l'indépendance, le désintéressement, l'objectivité et l'intégrité requis pour
 * l'exercice de la profession de notaire. » Un prix qui bougerait selon une
 * cote attribuée par Nota est une telle convention — c'est l'article qui a fait
 * tomber les ADR 0027 et 0028, et c'est celui-ci qui la retient.
 *
 * `prix-nota-separe.test.mjs` tient le CONTRAT du modèle à deux lignes ; cette
 * suite-ci tient l'INVARIANT du calcul, et elle est délibérément hostile : elle
 * lit la source de `billing.js` en plus de son comportement, parce qu'un taux
 * peut réapparaître par une porte que trois assertions de comportement
 * laisseraient ouverte (un plafond « temporaire », un rabais « de lancement »,
 * une lecture de la cote « juste pour un log »).
 *
 * Si un jour Nota décide vraiment de faire varier son prix, il faudra un ADR
 * qui réponde d'abord à l'art. 29.1 — et ce fichier devra tomber en même temps,
 * délibérément. Le faire passer en le retouchant serait le contourner.
 */

const SRC = readFileSync(new URL('../src/billing.js', import.meta.url), 'utf8');

function fakeStripe(calls = { transfers: [] }) {
  return {
    calls,
    async createConnectAccount(a) { return { accountId: 'acct_' + a.notaryId }; },
    async createOnboardingLink(a) { return { url: 'https://connect.test/' + a.accountId }; },
    async captureAndTransfer(a) {
      calls.transfers.push(a);
      return { chargeId: 'ch', transferId: 'tr', netCents: a.amountCents - a.applicationFeeCents };
    },
  };
}

async function notaire(repo, email, over = {}) {
  const id = notaryIdForEmail(email);
  await repo.putNotary({
    id, email, connectAccountId: 'acct_' + id,
    status: NOTARY_STATUS.ACTIVE, chargesEnabled: true,
    createdAt: NOW, updatedAt: NOW, ...over,
  });
  return id;
}

const billingOn = (repo) => createBilling({ repo, stripe: fakeStripe(), now: () => NOW });

// ---------------------------------------------------------------------------
// La surface : rien qui expose un taux
// ---------------------------------------------------------------------------

test('la facturation n’expose plus aucune porte de taux', async () => {
  const b = billingOn(createMemoryRepo());
  for (const nom of ['commissionFor', 'commissionWith', 'commissionRate', 'feeCents', 'floorRate', 'resolveBareme']) {
    assert.equal(b[nom], undefined, `billing expose encore ${nom}`);
  }
  // Ce qui reste est la porte du prix, et elle seule.
  assert.equal(typeof b.quoteOffer, 'function');
  assert.equal(typeof b.priceAct, 'function');
  assert.equal(typeof b.resolveGrilleNota, 'function');
});

test('la décision de prix ne porte QUE des montants en cents', async () => {
  const b = billingOn(createMemoryRepo());
  const devis = await b.priceAct(2000, { serviceId: 'refinancement', tierId: 'standard' });
  // ADR 0034 — les deux lignes de Nota sont DIVULGUÉES séparément : le prix du
  // service et la garantie de date. Une somme muette laisserait le client
  // incapable de savoir ce qu'il paie pour quoi (art. 68 C.déont.).
  assert.deepEqual(Object.keys(devis).sort(), [
    'honorairesCents', 'prixNotaCents', 'prixNotaDateCents', 'prixNotaServiceCents', 'totalCents',
  ]);
  assert.equal(devis.prixNotaCents, devis.prixNotaServiceCents + devis.prixNotaDateCents,
    'le prix de Nota EST la somme de ses deux lignes — rien ne se cache entre elles');
  // Pas un `taux`, pas une `cote`, pas une `part` — un devis qui les porterait
  // décrirait un partage, et il n'y en a plus.
  for (const v of Object.values(devis)) {
    // Entier ET jamais négatif. Le plancher a dû descendre de 1 à 0 quand la
    // ligne `prixNotaDateCents` est apparue (elle vaut zéro au palier
    // standard) : le laisser tomber sous zéro par la même occasion rendrait le
    // test aveugle à un devis à −5 000 ¢, qui virerait de l'argent au client.
    assert.ok(Number.isInteger(v) && v >= 0, 'un devis ne porte que des entiers de cents, jamais négatifs : ' + v);
    assert.ok(!(v > 0 && v < 1), 'jamais une fraction entre 0 et 1, qui serait un taux : ' + v);
  }
});

// ---------------------------------------------------------------------------
// L'invariant : le prix ne dépend de RIEN qui touche au notaire
// ---------------------------------------------------------------------------

test('ART. 29.1 — le prix ignore le notaire, jusqu’à l’ignorer comme argument', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo);
  const attendu = (await b.quoteOffer(2000)).prixNotaCents;

  // Un dossier au sommet de tout ce que la cote récompensait…
  const sommet = await notaire(repo, 'sommet@example.ca', {
    ratingSum: 4.9 * 40, ratingCount: 40,
    actsCompleted: 80, actsByService: { refinancement: 50, financement: 30 },
    proposalsCount: 60, declinesCount: 0, rayonKm: 50, urgences: true,
    lienCNQ: 'https://www.cnq.org/fiche/1/', prefixe: 'G1R',
    createdAt: '2024-01-01T00:00:00.000Z', lastSeenAt: NOW,
  });
  // …et un dossier vide qui décline tout.
  const vide = await notaire(repo, 'vide@example.ca', {
    ratingSum: 0, ratingCount: 0, actsCompleted: 0, actsByService: {},
    proposalsCount: 0, declinesCount: 40, rayonKm: 0, urgences: false, lienCNQ: null,
  });

  // Les DEUX portes sont éprouvées : `priceAct` délègue à `quoteOffer`, et un
  // prix qui redeviendrait notaire-dépendant pourrait n'entrer que par l'une.
  for (const id of [sommet, vide]) {
    const n = await repo.getNotary(id);
    assert.equal((await b.priceAct(2000, n)).prixNotaCents, attendu);
    assert.equal((await b.quoteOffer(2000, n)).prixNotaCents, attendu);
  }
  // Et un profil HOSTILE, qui rapporte lui-même le taux qu'il voudrait payer.
  const truque = { id: 'x', tauxRetenu: 0.01, coteRetenue: 100, tauxEffectif: 0, part: 1, cote: 100 };
  assert.equal((await b.priceAct(2000, truque)).prixNotaCents, attendu,
    'un champ de taux porté par le dossier ne doit jamais être lu');
  assert.equal((await b.quoteOffer(2000, truque)).prixNotaCents, attendu);
  // Sans notaire du tout, le même nombre : la preuve qu'il n'est pas une entrée.
  assert.equal((await b.priceAct(2000)).prixNotaCents, attendu);
});

test('le prix ignore la valeur de l’acte — un pourcentage, lui, la suivrait', async () => {
  const b = billingOn(createMemoryRepo());
  const montants = [1, 900, 2000, 250_000];
  const prixVus = [];
  for (const m of montants) prixVus.push((await b.quoteOffer(m)).prixNotaCents);
  assert.equal(new Set(prixVus).size, 1, 'le prix a bougé avec le montant : ' + prixVus.join(', '));
});

test('les frais d’application Stripe SONT le prix, jamais une fraction du total', async () => {
  const repo = createMemoryRepo();
  const calls = { transfers: [] };
  const b = createBilling({ repo, stripe: fakeStripe(calls), now: () => NOW });
  const id = await notaire(repo, 'capture@example.ca');
  await b.payNotaryOnAccept({ notaryId: id, bidId: 'B1', actAmount: 3000, paymentIntentId: 'pi' });

  const t = calls.transfers[0];
  assert.equal(t.applicationFeeCents, domain.prixNota().totalCents,
    'un règlement sans service nommé retombe sur la ligne la plus basse du catalogue');
  assert.equal(t.amountCents - t.applicationFeeCents, 300_000,
    'le net du notaire EST le montant offert — art. 32.1 2° de la Loi sur le notariat');
});

// ---------------------------------------------------------------------------
// La source : les portes par lesquelles un taux reviendrait
// ---------------------------------------------------------------------------

test('billing.js ne lit plus la cote du notaire, ni de près ni de loin', () => {
  // La cote (`cote.js`, `domain.notaryScore`) survit et classe le fil. Elle ne
  // doit tout simplement plus être JOIGNABLE depuis la facturation : c'est la
  // frontière que l'art. 29.1 impose, et une frontière se garde à l'import.
  assert.equal(/require\(['"]\.\/cote['"]\)/.test(SRC), false,
    'billing.js requiert de nouveau l’adaptateur de cote');
  assert.equal(/notaryScore|coteFor/.test(SRC), false,
    'billing.js appelle de nouveau le calcul de cote');
});

test('billing.js ne contient plus d’arithmétique de taux', () => {
  // Les mots par lesquels le barème est déjà revenu une fois. Les commentaires
  // en parlent au passé (« la part de Nota ÉTAIT un pourcentage ») ; c'est le
  // CODE qu'on inspecte, une ligne de commentaire étant retirée d'abord.
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const interdits = [
    /\btauxEffectif\b/, /\bplancher\b/, /\bpaliers\b/, /\bbareme\b/i,
    /\bcommissionWith\b/, /\bcommissionFor\b/, /\brateFloor\b/, /\bbonusTiers\b/,
    /\bcommissionRate\b/, /\bcommissionTiers\b/, /\broundRate\b/,
  ];
  for (const re of interdits) {
    assert.equal(re.test(code), false, 'la machinerie du taux est revenue dans billing.js : ' + re);
  }
  // Et la seule multiplication tolérée est celle des dollars en cents : un
  // `* taux` ou un `1 - taux` est exactement ce qu'on ne veut plus voir.
  assert.equal(/\*\s*(taux|rate|pct|pourcentage)/i.test(code), false, 'une multiplication par un taux');
  assert.equal(/\b1\s*-\s*(taux|rate)\b/i.test(code), false, 'le complément d’un taux — donc une part');
});

test('la configuration du prix ne peut pas devenir un taux', () => {
  // `validatePrix` est la seule porte d'entrée d'un prix (environnement, item
  // stocké, console admin). Tout ce qui ressemble à un ratio doit s'y briser.
  for (const v of [0.15, 0.05, 1, 0.5, '0,15', '15 %']) {
    const r = prix.validatePrix({ prixCents: v });
    if (v === 1) {
      // 1 cent est un prix légal — absurde, mais légal. Ce qu'il ne faut pas,
      // c'est qu'une FRACTION passe.
      assert.equal(r.ok, true);
      continue;
    }
    assert.equal(r.ok, false, `un taux a été accepté comme prix : ${v}`);
    assert.equal(r.errors[0].code, 'prix_invalide');
  }
  const srcCfg = readFileSync(new URL('../src/prix-nota-config.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(/\btaux\b|\bplancher\b|\bpaliers\b/.test(srcCfg), false,
    'prix-nota-config.js s’est remis à parler de taux');
});
