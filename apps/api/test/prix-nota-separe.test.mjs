import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const prix = require('../src/prix-nota-config.js');
const { coteFor } = require('../src/cote.js');
const domain = require('@nota/domain');

// ADR 0034 — le prix de Nota est une GRILLE : une ligne par service, plus la
// garantie de date. Cette suite tarife un refinancement au palier standard,
// sauf mention contraire ; l'invariant qu'elle garde est le même qu'avant —
// le prix ne dépend NI du notaire, NI de la valeur de l'acte.
const OFFRE = { serviceId: 'refinancement', tierId: 'standard' };
const PRIX = domain.prixNota(OFFRE.serviceId, OFFRE.tierId).totalCents;

const NOW = '2026-09-01T12:00:00.000Z';

/**
 * Le prix de Nota est celui de Nota — pas une part des honoraires du notaire.
 *
 * Quatre textes, vérifiés mot pour mot aux sources officielles, imposent
 * ensemble cette forme :
 *
 * - **Art. 32.1 L.N. 2°** — est présumée usurper les fonctions de notaire la
 *   personne qui « obtient d'un notaire qu'il abandonne une partie de ses
 *   honoraires ». Le notaire doit donc recevoir 100 % du montant offert.
 * - **Art. 32 C.déont.** — le notaire ne peut partager ses honoraires avec un
 *   non-membre d'un ordre. Même conclusion, prise par l'autre bout.
 * - **Art. 29.1 C.déont.** — le notaire ne peut conclure aucune convention
 *   mettant en péril son indépendance et son désintéressement. Un revenu
 *   indexé sur une note attribuée par une entreprise privée est exactement
 *   cela : **le prix de Nota ne doit donc jamais dépendre du notaire.**
 * - **Art. 32.1 L.N. 3°** — écarte l'intermédiaire qui procure des services
 *   « sans aucune responsabilité de sa part envers le notaire pour ses
 *   honoraires ». Nota capture le total et garantit le net du notaire.
 *
 * La cote survit — classement, accès — mais elle ne touche plus à l'argent.
 */

function fakeStripe(calls = { transfers: [], charges: [] }) {
  return {
    calls,
    async createConnectAccount(a) { return { accountId: 'acct_' + a.notaryId }; },
    async createOnboardingLink(a) { return { url: 'https://connect.test/' + a.accountId }; },
    async captureAndTransfer(a) {
      calls.transfers.push(a);
      return {
        paymentIntentId: a.paymentIntentId, chargeId: 'ch_' + a.bidId, transferId: 'tr_' + a.bidId,
        applicationFeeCents: a.applicationFeeCents, netCents: a.amountCents - a.applicationFeeCents,
      };
    },
    async chargeActCommission(a) { calls.charges.push(a); return { id: 'pi_' + a.bidId, applicationFeeCents: a.applicationFeeCents }; },
    async createOfferAuthorization(a) { return { sessionId: 'cs_' + a.bidId, url: 'https://checkout.test/' + a.bidId }; },
  };
}

async function notary(repo, email, { cote = null } = {}) {
  const id = notaryIdForEmail(email);
  await repo.putNotary({
    id, email, connectAccountId: 'acct_' + id,
    status: NOTARY_STATUS.ACTIVE, chargesEnabled: true,
    // Deux profils aux antipodes de la cote : ratings, actes, ancienneté.
    ratingSum: cote === 'haute' ? 5 * 40 : 0,
    ratingCount: cote === 'haute' ? 40 : 0,
    actsCompleted: cote === 'haute' ? 80 : 0,
    lienCNQ: cote === 'haute' ? 'https://www.cnq.org/trouver-un-notaire/fiche/1/' : null,
    createdAt: NOW, updatedAt: NOW,
  });
  return id;
}

const billingOn = (repo, stripe) => createBilling({ repo, stripe, now: () => NOW });

// ---------------------------------------------------------------------------
// La configuration
// ---------------------------------------------------------------------------

test('chaque cellule de la grille est un montant en cents, jamais un taux', () => {
  const g = prix.envDefaults({});
  const cellules = [...Object.values(g.services), ...Object.values(g.garantieDate), g.defaut];
  for (const c of cellules) {
    assert.ok(Number.isInteger(c) && c >= 0, 'un entier de cents : ' + c);
    // Le mot « taux » n'a plus de sens ici : rien dans la config n'est un ratio.
    assert.ok(!(c > 0 && c < 1), 'une fraction entre 0 et 1 serait un taux : ' + c);
  }
  for (const s of domain.SERVICES) assert.ok(g.services[s.id] > 0, s.id + ' : un prix, pas rien');
});

test('envDefaults lit NOTA_PRIX_CENTS et retombe sur le catalogue', () => {
  assert.deepEqual(prix.envDefaults({}), domain.prixNotaGrille());
  // L'ancien prix unique aplatit la grille — la rétro-compatibilité de l'ADR 0034.
  const aplati = prix.envDefaults({ NOTA_PRIX_CENTS: '25000' });
  for (const s of domain.SERVICES) assert.equal(aplati.services[s.id], 25000, s.id);
  // Une valeur illisible ne fait jamais tomber la tarification.
  assert.deepEqual(prix.envDefaults({ NOTA_PRIX_CENTS: 'oups' }), domain.prixNotaGrille());
});

test('validatePrix : un entier positif en cents, et rien d’autre', () => {
  assert.equal(prix.validatePrix({ prixCents: 40000 }).ok, true, 'l’ancien corps vaut encore');
  assert.equal(prix.validatePrix({ services: { refinancement: 30000 } }).ok, true);
  const codes = (p) => (prix.validatePrix(p).errors || []).map((e) => e.code);
  assert.ok(codes({ prixCents: 0 }).includes('prix_invalide'), 'zéro');
  assert.ok(codes({ prixCents: -1 }).includes('prix_invalide'), 'négatif');
  assert.ok(codes({ prixCents: 400.5 }).includes('prix_invalide'), 'fractionnaire');
  assert.ok(codes({ services: { refinancement: 0.15 } }).includes('prix_invalide'), 'un taux');
  assert.ok(codes({}).includes('prix_invalide'), 'absent');
});

// ---------------------------------------------------------------------------
// La tarification
// ---------------------------------------------------------------------------

test('le prix de Nota ne dépend pas de la valeur de l’acte', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo, fakeStripe());
  const petit = await b.priceAct(1200, OFFRE);
  const gros = await b.priceAct(3000, OFFRE);
  assert.equal(petit.prixNotaCents, gros.prixNotaCents, 'même prix, quelle que soit la valeur');
  assert.equal(petit.prixNotaCents, PRIX);
});

test('ART. 29.1 — le prix de Nota ne dépend pas du notaire', async () => {
  const repo = createMemoryRepo();
  const calls = { transfers: [], charges: [] };
  const b = billingOn(repo, fakeStripe(calls));
  const faible = await notary(repo, 'faible@example.ca');
  const haute = await notary(repo, 'haute@example.ca', { cote: 'haute' });

  // Les deux profils doivent VRAIMENT différer, sinon ce test se compare à
  // lui-même. On le vérifie sur la cote elle-même — le nombre exact qui
  // déplaçait des dollars avant l'ADR 0031 — lue par le même port que la
  // console (`cote.coteFor`), jamais par une arithmétique refaite ici.
  const cote = async (id) => coteFor(await repo.getNotary(id), Date.parse(NOW)).cote;
  assert.ok((await cote(haute)) > (await cote(faible)),
    'sans deux cotes distinctes, l’invariant ne serait pas exercé');

  // Et on va jusqu'au MOUVEMENT D'ARGENT, pas jusqu'au devis : le devis ne
  // prend plus de notaire (c'est l'assertion d'arité, plus haut), mais le
  // règlement, lui, en connaît un. C'est là que la cote entrait autrefois.
  const a = await b.payNotaryOnAccept({ notaryId: faible, bidId: 'B-faible', actAmount: 2000, paymentIntentId: 'pi_faible', ...OFFRE });
  const z = await b.payNotaryOnAccept({ notaryId: haute, bidId: 'B-haute', actAmount: 2000, paymentIntentId: 'pi_haute', ...OFFRE });
  assert.equal(a.ok, true, JSON.stringify(a.errors || {}));
  assert.equal(z.ok, true, JSON.stringify(z.errors || {}));

  assert.equal(a.prixNotaCents, z.prixNotaCents,
    'une cote ne doit jamais déplacer un dollar — art. 29.1');
  assert.equal(a.netCents, z.netCents, 'et le net du notaire ne bouge pas non plus');
  assert.equal(calls.transfers[0].applicationFeeCents, calls.transfers[1].applicationFeeCents,
    'ce que Nota retient chez Stripe est le même nombre pour les deux');
  assert.equal(calls.transfers[0].amountCents, calls.transfers[1].amountCents,
    'et le total capturé au client aussi');
});

test('ART. 32.1 2° — le notaire reçoit 100 % du montant offert', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo, fakeStripe());
  const p = await b.priceAct(2000, OFFRE);
  assert.equal(p.honorairesCents, 200_000, 'le montant offert, intact');
  assert.equal(p.totalCents, 200_000 + p.prixNotaCents, 'le client paie les deux lignes');
});

test('la décision de prix ne porte plus ni taux ni cote', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo, fakeStripe());
  const p = await b.priceAct(2000, OFFRE);
  assert.equal(p.taux, undefined, 'plus de taux');
  assert.equal(p.cote, undefined, 'la cote ne touche plus à l’argent');
});

// ---------------------------------------------------------------------------
// Le règlement
// ---------------------------------------------------------------------------

test('CAPTURE — le client paie le total, Nota retient son prix, le notaire nette ses honoraires', async () => {
  const repo = createMemoryRepo();
  const calls = { transfers: [], charges: [] };
  const b = billingOn(repo, fakeStripe(calls));
  const id = await notary(repo, 'reglement@example.ca');
  await repo.putBidPayment?.('B1', { paymentIntentId: 'pi_B1' });

  const r = await b.payNotaryOnAccept({ notaryId: id, bidId: 'B1', actAmount: 2000, paymentIntentId: 'pi_B1', ...OFFRE });
  assert.equal(r.ok, true, JSON.stringify(r.errors || {}));
  assert.equal(r.prixNotaCents, PRIX);
  assert.equal(r.honorairesCents, 200_000);

  const t = calls.transfers[0] || calls.charges[0];
  assert.ok(t, 'un règlement Stripe a eu lieu');
  assert.equal(t.applicationFeeCents, PRIX, 'les frais d’application SONT le prix de Nota');
  assert.equal(t.amountCents, 200_000 + PRIX, 'le total capturé porte les deux lignes');
  assert.equal(t.amountCents - t.applicationFeeCents, 200_000, 'le net du notaire = ses honoraires entiers');
});

test('l’autorisation couvre les deux lignes, jamais les seuls honoraires', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo, fakeStripe());
  const devis = await b.quoteOffer(2000, OFFRE);
  assert.equal(devis.honorairesCents, 200_000);
  assert.equal(devis.prixNotaCents, PRIX);
  assert.equal(devis.totalCents, 200_000 + PRIX,
    'c’est ce total que la carte du client doit autoriser');
});

test('CRÉANCE — un règlement hors plateforme doit le prix de Nota, pas une part d’honoraires', async () => {
  const repo = createMemoryRepo();
  const b = billingOn(repo, fakeStripe());
  const id = await notary(repo, 'creance@example.ca');
  const r = await b.completeAct({ notaryId: id, bidId: 'B2', actAmount: 2000, ...OFFRE });
  assert.equal(r.ok, true, JSON.stringify(r.errors || {}));
  assert.equal(r.paye, false);
  assert.equal(r.prixNotaCents, PRIX, 'la créance est le prix de Nota');
  assert.equal(r.honorairesCents, 200_000, 'les honoraires restent entiers');
});
