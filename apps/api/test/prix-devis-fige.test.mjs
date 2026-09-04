/**
 * ADR 0034 — LE RÈGLEMENT REJOUE LE DEVIS AUTORISÉ, JAMAIS LA GRILLE DU JOUR.
 *
 * La grille est vivante : la console admin la change quand Nota le décide, et
 * c'est le but. L'autorisation, elle, ne l'est pas. La carte du client est
 * bloquée pour UN total, une fois, avant qu'il ne s'engage — et Stripe refuse
 * toute capture supérieure à son autorisation.
 *
 * Un règlement qui relirait la grille du jour se casserait donc dans les deux
 * sens :
 *   — à la HAUSSE, la capture dépasse le blocage : Stripe la refuse, l'acte
 *     reste retenu et impayé (`paiement_echoue`) alors que la signature a bien
 *     eu lieu ;
 *   — à la BAISSE, le client aurait bloqué plus que ce qu'on lui prend, et
 *     l'écart entre le prix ANNONCÉ et le prix FACTURÉ est exactement la
 *     publicité « incomplète » que l'art. 68 du Code de déontologie interdit.
 *
 * Les deux lignes de Nota sont donc FIGÉES sur l'offre au moment où la carte
 * est engagée, et c'est ce qu'on capture — quoi qu'il soit arrivé à la grille
 * entre-temps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';

const NOW = '2026-08-12T00:00:00.000Z';
const NOW_MS = 1_760_000_000_000;
const TODAY = '2026-08-12';
const DATE = '2026-08-20';
const MONTANT = 2000;
const parse = (res) => JSON.parse(res.body);

// Le palier de CETTE date, et le prix de Nota qui va avec — lus au domaine
// plutôt qu'écrits ici : le jour où le catalogue change, la suite suit. Huit
// jours d'avis ⇒ palier « rapide », donc les DEUX lignes sont non nulles, et
// c'est délibéré : un devis figé qui n'aurait qu'une ligne à vérifier laisserait
// l'autre libre de dériver.
const TIER = domain.tierForDays(domain.daysBetween(TODAY, DATE));
const ATTENDU = domain.prixNota('refinancement', TIER);
const HONORAIRES = MONTANT * 100;

// Zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const PRICING = {
  valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue',
  preteur: 'banque_nationale', deplacement: 'client_50',
};

function fakeStripe() {
  const calls = { authorizations: [], setups: [], holds: [], transfers: [] };
  return {
    calls,
    async createConnectAccount(a) { return { accountId: 'acct_' + a.notaryId }; },
    async createOnboardingLink() { return { url: 'https://connect.test/' }; },
    async createOfferAuthorization(a) { calls.authorizations.push(a); return { sessionId: 'cs', url: 'https://checkout.test/' + a.bidId }; },
    // ADR 0035 — une date lointaine ENREGISTRE la carte au lieu de réserver
    // tout de suite ; la caution est posée à l'approche de la signature.
    async createOfferSetup(a) { calls.setups.push(a); return { sessionId: 'cs_setup', url: 'https://checkout.test/setup/' + a.bidId }; },
    async placeOfferAuthorization(a) { calls.holds.push(a); return { id: 'pi_' + a.bidId, amountCents: a.amountCents }; },
    async retrieveSetupIntent() { return { payment_method: 'pm_x', customer: 'cus_x' }; },
    async listCustomerPaymentMethods() { return [{ id: 'pm_x' }]; },
    async captureAndTransfer(a) {
      calls.transfers.push(a);
      // La vraie contrainte de Stripe : on ne capture jamais au-dessus de
      // l'autorisation. Sans elle, ce test passerait en facturant le client
      // 150 $ de plus que ce qu'il a lu.
      const bloque = calls.authorizations.find((z) => z.bidId === a.bidId);
      if (bloque && a.amountCents > bloque.amountCents) {
        throw new Error(`capture ${a.amountCents} > authorization ${bloque.amountCents}`);
      }
      return {
        paymentIntentId: a.paymentIntentId, chargeId: 'ch', transferId: 'tr',
        applicationFeeCents: a.applicationFeeCents, netCents: a.amountCents - a.applicationFeeCents,
      };
    },
    async cancelOfferAuthorization(a) { return { id: a.paymentIntentId, status: 'canceled' }; },
    constructEvent(raw, sig) { if (!sig || sig === 'bad') throw new Error('bad signature'); return JSON.parse(raw); },
  };
}

function setup() {
  const repo = createMemoryRepo();
  const stripe = fakeStripe();
  const billing = createBilling({ repo, stripe, now: () => NOW });
  const app = createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'x', billing });
  return { repo, stripe, app };
}

// Publier une offre ET autoriser la carte : l'état exact d'où part un règlement.
async function offreAutorisee(app, { serviceId = 'refinancement', montant = MONTANT } = {}) {
  const posted = parse(await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId, dateISO: DATE, montant, prefixe: 'G1R', pricing: PRICING }),
  }));
  await app.handle({
    method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' },
    body: JSON.stringify({
      id: 'evt', type: 'checkout.session.completed',
      data: { object: { payment_intent: 'pi_x', metadata: { bidId: 'x', bidDate: DATE } } },
    }),
  });
  return posted;
}

async function notaireActif(app, repo, email = 'a@notaire.ca') {
  const id = notaryIdForEmail(email);
  await repo.putNotary({
    id, email, status: 'active', chargesEnabled: true, connectAccountId: 'acct_x',
    commissionCentsCollected: 0, ...NOTARY_CONTACT,
  });
  const sess = await notarySignIn(app, email);
  return { id, auth: { authorization: 'Bearer ' + sess.token } };
}

const retenir = (app, auth) => app.handle({
  method: 'POST', path: '/notary/bids/accept', headers: auth,
  body: JSON.stringify({ id: 'x', dateISO: DATE }),
});

const regler = (app, auth, actAmount = MONTANT) => app.handle({
  method: 'POST', path: '/notary/acts/complete', headers: auth,
  body: JSON.stringify({ bidId: 'x', dateISO: DATE, actAmount }),
});

// ===========================================================================

test('le devis des DEUX lignes est figé sur l’offre au moment de l’autorisation', async () => {
  const { repo, stripe, app } = setup();
  await offreAutorisee(app);

  const bid = await repo.get('x', DATE);
  const attendu = domain.prixNota('refinancement', bid.tier);
  assert.equal(bid.prixNotaServiceCents, attendu.serviceCents);
  assert.equal(bid.prixNotaDateCents, attendu.dateCents);
  // Ce qui est figé EST ce que la carte bloque : une seule résolution de la
  // grille pour les deux, jamais deux lectures qui pourraient déjà diverger.
  const demande = stripe.calls.authorizations[0] || stripe.calls.setups[0] || stripe.calls.holds[0];
  assert.ok(demande, 'la publication demande bien quelque chose à la carte');
  assert.equal(
    demande.amountCents,
    MONTANT * 100 + bid.prixNotaServiceCents + bid.prixNotaDateCents,
  );
  // Et rien de tout cela ne fuit au carnet public.
  const feed = parse(await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(feed.bids[0].prixNotaServiceCents, undefined);
});

test('UNE HAUSSE DE LA GRILLE APRÈS L’AUTORISATION NE MONTE PAS LA CAPTURE', async () => {
  const { repo, stripe, app } = setup();
  await offreAutorisee(app);
  const demande = stripe.calls.authorizations[0] || stripe.calls.setups[0] || stripe.calls.holds[0];
  assert.ok(demande, 'la publication demande bien quelque chose à la carte');
  const bloque = demande.amountCents;
  assert.equal(bloque, HONORAIRES + ATTENDU.totalCents, 'les deux lignes de Nota, en plus des honoraires');
  assert.ok(ATTENDU.dateCents > 0, 'le palier « ' + TIER + ' » vend bien une garantie de date');

  // L'opérateur monte le refinancement à 399 $ depuis la console, entre la
  // publication et la signature. C'est une décision légitime — pour la SUITE.
  await repo.putPrixNotaConfig({ services: { refinancement: 39900 } }, NOW);
  const grilleDuJour = await require('../src/prix-nota-config.js').resolveGrille(repo, {});
  assert.equal(grilleDuJour.services.refinancement, 39900, 'la nouvelle grille est bien en vigueur');

  const { auth } = await notaireActif(app, repo);
  await retenir(app, auth);
  const done = parse(await regler(app, auth));

  assert.equal(done.ok, true);
  assert.equal(done.paid, true, 'la capture doit aboutir : elle ne dépasse pas l’autorisation');
  assert.equal(done.commissionCents, ATTENDU.totalCents, 'le prix facturé est celui que le client a lu');
  assert.equal(stripe.calls.transfers[0].amountCents, bloque, 'la capture porte le total AUTORISÉ');
  assert.equal(stripe.calls.transfers[0].applicationFeeCents, ATTENDU.totalCents);
  assert.equal(done.netCents, HONORAIRES, 'et le notaire nette ses honoraires entiers — art. 32.1 2° L.N.');

  // La suite, elle, suit la nouvelle grille : figer un devis n'est pas geler le prix.
  const suivante = parse(await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-25', montant: MONTANT, prefixe: 'G1R', pricing: PRICING }),
  }));
  assert.equal(suivante.paymentStatus, 'pending');
  const tierSuivant = domain.tierForDays(domain.daysBetween(TODAY, '2026-08-25'));
  // Selon la date, l'ADR 0035 réserve tout de suite ou enregistre la carte :
  // ce qui compte ici est le MONTANT demandé, pas le mécanisme choisi.
  const derniere = stripe.calls.setups.at(-1) || stripe.calls.authorizations.at(-1) || stripe.calls.holds.at(-1);
  assert.ok(derniere, 'la publication suivante demande bien quelque chose à la carte');
  assert.equal(
    derniere.amountCents,
    HONORAIRES + 39900 + domain.prixNotaGrille().garantieDate[tierSuivant],
  );
});

test('UNE BAISSE DE LA GRILLE NE FAIT PAS NON PLUS DÉVIER LE PRIX FACTURÉ — art. 68', async () => {
  const { repo, stripe, app } = setup();
  await offreAutorisee(app);

  await repo.putPrixNotaConfig({ services: { refinancement: 9900 } }, NOW);
  const { auth } = await notaireActif(app, repo);
  await retenir(app, auth);
  const done = parse(await regler(app, auth));

  assert.equal(done.commissionCents, ATTENDU.totalCents,
    'le prix annoncé et le prix facturé sont le même nombre, dans les deux sens');
  assert.equal(stripe.calls.transfers[0].applicationFeeCents, ATTENDU.totalCents);
});

test('le REPLI (capture impossible) rejoue lui aussi le devis autorisé', async () => {
  const { repo, stripe, app } = setup();
  await offreAutorisee(app);
  await repo.putPrixNotaConfig({ services: { refinancement: 39900 } }, NOW);

  const { auth, id } = await notaireActif(app, repo);
  await retenir(app, auth);
  // La carte a expiré / est refusée : l'acte se règle quand même, en créance.
  stripe.captureAndTransfer = async () => { throw new Error('card_declined'); };
  const done = parse(await regler(app, auth));

  assert.equal(done.ok, true);
  assert.equal(done.paid, undefined, 'rien n’a transité : c’est une créance');
  assert.equal(done.commissionCents, ATTENDU.totalCents, 'la créance est celle du devis lu, pas de la grille du jour');
  assert.equal((await repo.getActCompletion('x')).commissionCentsDue, ATTENDU.totalCents);
  assert.equal((await repo.getNotary(id)).commissionCentsDue, ATTENDU.totalCents);
});

test('le registre write-once fige les deux lignes AUTORISÉES, pas les courantes', async () => {
  const { repo, app } = setup();
  await offreAutorisee(app);
  await repo.putPrixNotaConfig({ services: { refinancement: 39900 }, garantieDate: { [TIER]: 12345 } }, NOW);

  const { auth } = await notaireActif(app, repo);
  await retenir(app, auth);
  await regler(app, auth);

  const regle = await repo.getActCompletion('x');
  assert.equal(regle.prixNotaServiceCents, ATTENDU.serviceCents, 'la ligne du service, telle qu’autorisée');
  assert.equal(regle.prixNotaDateCents, ATTENDU.dateCents, 'et la ligne de la garantie de date avec elle');
  assert.equal(regle.prixNotaCents, ATTENDU.totalCents);
  assert.equal(regle.honorairesCents, HONORAIRES);
});

test('RÉTRO-COMPATIBILITÉ — une offre SANS devis figé se tarife encore sur la grille', async () => {
  const { repo, stripe, app } = setup();
  // Un enregistrement d'avant l'ADR 0034 : autorisé, retenu, et sans les deux
  // lignes. La grille en vigueur reprend la main, exactement comme avant.
  const { auth, id } = await notaireActif(app, repo);
  await repo.put({
    id: 'x', dateISO: DATE, serviceId: 'refinancement', montant: MONTANT, tier: 'standard',
    status: 'retenue', notaryId: id, paymentStatus: 'authorized', paymentIntentId: 'pi_legacy',
    courriel: 'client@x.ca',
  });
  await repo.putPrixNotaConfig({ services: { refinancement: 30000 } }, NOW);

  const done = parse(await regler(app, auth));
  assert.equal(done.commissionCents, 30000, 'sans devis figé, la grille du jour décide');
  assert.equal(stripe.calls.transfers[0].applicationFeeCents, 30000);
});

test('le domaine refuse un devis figé à moitié — les deux lignes, ou aucune', () => {
  assert.equal(domain.prixNotaFige({ prixNotaServiceCents: 24900 }), null, 'la ligne de date manque');
  assert.equal(domain.prixNotaFige({ prixNotaDateCents: 0 }), null, 'la ligne de service manque');
  assert.equal(domain.prixNotaFige({ prixNotaServiceCents: 0.15, prixNotaDateCents: 0 }), null,
    'une fraction serait un taux, jamais des cents');
  assert.equal(domain.prixNotaFige({ prixNotaServiceCents: -1, prixNotaDateCents: 0 }), null, 'négatif');
  assert.equal(domain.prixNotaFige(null), null);
  assert.deepEqual(domain.prixNotaFige({ prixNotaServiceCents: 24900, prixNotaDateCents: 15000 }), {
    serviceCents: 24900, dateCents: 15000, totalCents: 39900,
  });
  // Un devis figé se rejoue TEL QUEL : les planchers de la grille vivante ne
  // le « corrigent » pas — c'est un fait comptable, plus une décision.
  assert.deepEqual(domain.prixNotaFige({ prixNotaServiceCents: 0, prixNotaDateCents: 0 }), {
    serviceCents: 0, dateCents: 0, totalCents: 0,
  });
});
