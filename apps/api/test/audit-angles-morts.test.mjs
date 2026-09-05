// LES ANGLES MORTS DE LA PISTE D'AUDIT (2026-09-05).
//
// L'ADR 0036 a donné un ACTEUR à chaque entrée. Ce qu'elle n'a pas fait, c'est
// vérifier que chaque geste qui compte ÉCRIT une entrée. L'audit du 2026-09-05
// a compté quatre familles de gestes qui n'en laissaient aucune :
//
//   1. L'ARGENT AUTRE QUE LE RÈGLEMENT ET LES FRAIS D'ANNULATION. L'autorisation
//      de carte (la caution) — le geste qui bloque des milliers de dollars chez
//      le client —, sa libération, l'enregistrement de la carte, et chaque
//      changement d'état poussé par Stripe passaient sans trace. Un journal qui
//      voit le règlement mais pas la réservation qui le rend possible ne permet
//      pas de reconstituer une plainte : « on m'a bloqué 2 400 $ » n'a pas de
//      réponse dans le registre.
//   2. LA VIE DU NOTAIRE AU-DELÀ DE SON ACTIVATION. L'inscription spontanée, et
//      surtout LE PÉRIMÈTRE (`rayonKm`, l'opt-in `urgences`) : ces deux champs
//      décident QUI voit QUELLE demande. Les changer, c'est changer le marché
//      qu'un notaire peut servir — un geste au moins aussi sensible que
//      l'activation, qui, elle, était journalisée.
//   3. LES ANNULATIONS SANS FRAIS. Le journal ne portait l'annulation QUE
//      lorsqu'une somme avait été prélevée (ou refusée). Une annulation dans la
//      fenêtre gratuite, et celle d'une offre jamais retenue, ne laissaient
//      rien : l'offre disparaissait du carnet sans qu'aucun registre ne dise
//      quand, ni par qui.
//   4. (hors de ce fichier) La messagerie — support et clavardage — reste
//      non journalisée ; ses routes appartiennent à une autre session.
//
// LA RÈGLE QUE CES TESTS DÉFENDENT, et qui vaut pour toute entrée neuve :
// l'acteur, le sujet, le JOUR OUVRABLE de Québec, et assez de contexte pour
// être lisible dans un an. Jamais de courriel, jamais d'adresse d'origine,
// jamais de jeton — la piste publique est conservée sept ans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-09-05';
// 19 h 30 UTC = 15 h 30 à Québec : le même jour civil des deux côtés, pour que
// les assertions sur `day` portent sur la RÈGLE (le jour ouvrable nommé par
// l'appelant) et non sur un hasard de fuseau. Le test « soir » plus bas prend
// l'autre bord.
const NOW_MS = Date.parse('2026-09-05T19:30:00.000Z');
const EMAIL = 'me.tremblay@etude.ca';
const NOTAIRE = notaryIdForEmail(EMAIL);
const DATE_SIGNATURE = '2026-09-25';
const PRICING = { valeur_pret: 300000, approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' };
const OFFRE = {
  serviceId: 'refinancement', dateISO: DATE_SIGNATURE, montant: 2000, prefixe: 'G1R',
  courriel: 'client@exemple.ca', pricing: PRICING,
};

const parse = (r) => JSON.parse(r.body);

// Un facturier de démonstration : il ne parle à personne, il note ce qu'on lui
// demande. `mode` est celui de l'ADR 0035 — « paiement » quand la caution est
// posée tout de suite, « enregistrement » quand seule la carte est gardée.
function fauxBilling(over = {}) {
  const vu = { authorize: [], cancel: [] };
  const b = {
    quoteOffer: async (m) => ({
      honorairesCents: m * 100, prixNotaCents: 40000, totalCents: m * 100 + 40000,
      prixNotaServiceCents: 35000, prixNotaDateCents: 5000,
    }),
    authorizeOffer: async (a) => {
      vu.authorize.push(a);
      return { ok: true, url: 'https://checkout.test/x', sessionId: 'cs_test_1', mode: 'enregistrement' };
    },
    cancelAuthorization: async (a) => { vu.cancel.push(a); return { ok: true }; },
    ...over,
  };
  b.vu = vu;
  return b;
}

function harness(opts = {}) {
  const repo = createMemoryRepo([]);
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => NOW_MS,
    notaryConsoleUrl: 'https://nota.example',
    env: { NOTA_BASE_URL: 'https://nota.quebec' },
    ...opts,
  });
  return { app, repo };
}

const journal = (repo, action) =>
  repo.queryTxAuditByDay(TODAY).then((e) => (action ? e.filter((x) => x.action === action) : e));

async function seule(repo, action) {
  const e = await journal(repo, action);
  assert.equal(e.length, 1, 'une seule entrée « ' + action + ' », vu ' + e.length);
  return e[0];
}

const seedNotaire = (repo, over = {}) =>
  repo.putNotary({ id: NOTAIRE, email: EMAIL, status: 'active', ...NOTARY_CONTACT, ...over });

const jetonNotaire = () => signToken(NOTAIRE, NOW_MS + 3600_000, SCOPES.SESSION);

const poster = (app, body = OFFRE) =>
  app.handle({ method: 'POST', path: '/bids', query: {}, headers: {}, body: JSON.stringify(body) });

async function offreOuverte(h, over = {}) {
  const bid = {
    id: 'b1', serviceId: 'refinancement', dateISO: DATE_SIGNATURE, montant: 2000, tier: 'standard',
    premium: 1, anonyme: true, nom: 'Client', prefixe: 'G1R', courriel: 'client@exemple.ca',
    pricing: PRICING, basePrice: 2000, status: domain.STATUS.OUVERTE, notaryId: null,
    propositions: [], demandes: [], createdAt: TODAY, ...over,
  };
  await h.repo.put(bid);
  return bid;
}

const jetonClient = (bidId = 'b1') => signToken(bidId, NOW_MS + 3600_000, SCOPES.CLIENT);

// ---------------------------------------------------------------------------
// 1. L'ARGENT — la caution, sa libération, la carte, et Stripe
// ---------------------------------------------------------------------------

test('l’autorisation de carte laisse une trace : le geste qui bloque l’argent du client', async () => {
  const billing = fauxBilling();
  const h = harness({ billing, billingConfigured: true });

  const res = await poster(h.app);
  assert.equal(res.statusCode, 201, res.body);

  const e = await seule(h.repo, 'caution_demandee');
  assert.equal(e.acteur.type, 'client');
  assert.equal(e.acteur.id, parse(res).bid.id, 'le sujet EST l’offre : c’est elle le dossier du client');
  assert.equal(e.day, TODAY, 'seau = jour ouvrable québécois');
  assert.equal(e.meta.bidId, parse(res).bid.id);
  assert.equal(e.meta.dateISO, DATE_SIGNATURE);
  assert.equal(e.meta.serviceId, 'refinancement');
  // Le TOTAL autorisé, en cents : c'est le plafond que la capture ne pourra
  // jamais dépasser (ADR 0034). Sans lui, une contestation d'un an plus tard
  // n'a pas de montant à opposer.
  assert.equal(e.meta.totalCents, 2000 * 100 + 40000);
  assert.equal(e.meta.prixNotaServiceCents, 35000);
  assert.equal(e.meta.prixNotaDateCents, 5000);
  assert.equal(e.meta.mode, 'enregistrement', 'ADR 0035 — quelle surface Stripe s’est ouverte');
  assert.equal(e.meta.sessionId, 'cs_test_1');
  assert.equal(e.ip, null, 'la porte publique ne consigne aucune origine');
  assert.ok(!JSON.stringify(e).includes('client@exemple.ca'), 'aucun courriel dans la piste publique');
});

test('une autorisation REFUSÉE par le facturier ne s’inscrit pas comme si elle avait tenu', async () => {
  const billing = fauxBilling({
    authorizeOffer: async () => ({ ok: false, errors: [{ code: 'montant_invalide', message: 'non' }] }),
  });
  const h = harness({ billing, billingConfigured: true });

  assert.equal((await poster(h.app)).statusCode, 422);
  assert.equal((await journal(h.repo, 'caution_demandee')).length, 0,
    'rien n’a été bloqué : le journal ne doit pas prétendre le contraire');
});

test('le webhook qui AUTORISE la carte est journalisé — l’argent est réservé à cet instant', async () => {
  const h = harness({
    billingConfigured: true,
    billing: {
      handleWebhook: async () => ({
        ok: true, handled: true, duplicate: false, type: 'checkout.session.completed',
        event: { id: 'evt_1', type: 'checkout.session.completed' },
        notary: null,
        bid: { id: 'b1', dateISO: DATE_SIGNATURE, paymentStatus: 'authorized', paymentIntentId: 'pi_1' },
      }),
    },
  });

  const res = await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'carte_autorisee');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' });
  assert.equal(e.meta.bidId, 'b1');
  assert.equal(e.meta.dateISO, DATE_SIGNATURE);
  assert.equal(e.meta.paymentIntentId, 'pi_1');
  assert.equal(e.meta.eventId, 'evt_1', 'l’événement Stripe, pour recoudre avec leur tableau de bord');
  assert.equal(e.meta.type, 'checkout.session.completed');
  assert.equal(e.day, TODAY);
});

test('l’enregistrement d’une carte est journalisé — sans jamais nommer la carte', async () => {
  const h = harness({
    billingConfigured: true,
    billing: {
      handleWebhook: async () => ({
        ok: true, handled: true, duplicate: false, type: 'setup_intent.succeeded',
        event: { id: 'evt_2', type: 'setup_intent.succeeded' },
        notary: null,
        bid: {
          id: 'b1', dateISO: DATE_SIGNATURE, paymentStatus: 'enregistre',
          paymentCustomerId: 'cus_1', paymentMethodId: 'pm_1',
        },
      }),
    },
  });

  assert.equal((await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' })).statusCode, 200);

  const e = await seule(h.repo, 'carte_enregistree');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' });
  assert.equal(e.meta.customerId, 'cus_1');
  // L'IDENTIFIANT du moyen de paiement, jamais un numéro : `pm_…` est une
  // référence opaque chez Stripe, et c'est tout ce qu'un auditeur peut avoir
  // besoin de recoudre.
  assert.equal(e.meta.paymentMethodId, 'pm_1');
  assert.ok(!/\b\d{12,}\b/.test(JSON.stringify(e)), 'aucune suite de chiffres qui ressemblerait à une carte');
});

test('la LIBÉRATION d’une caution est journalisée, et dit d’où elle vient', async () => {
  const h = harness({
    billingConfigured: true,
    billing: {
      handleWebhook: async () => ({
        ok: true, handled: true, duplicate: false, type: 'payment_intent.canceled',
        event: { id: 'evt_3', type: 'payment_intent.canceled' },
        notary: null,
        bid: { id: 'b1', dateISO: DATE_SIGNATURE, paymentStatus: 'void' },
      }),
    },
  });

  assert.equal((await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' })).statusCode, 200);

  const e = await seule(h.repo, 'caution_liberee');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' });
  assert.equal(e.meta.origine, 'webhook', 'qui a relâché : Stripe, une renégociation, ou une annulation');
  assert.equal(e.meta.type, 'payment_intent.canceled');
});

test('un webhook REJOUÉ n’écrit rien : le journal compte des faits, pas des livraisons', async () => {
  const h = harness({
    billingConfigured: true,
    billing: {
      handleWebhook: async () => ({
        ok: true, handled: false, duplicate: true, type: 'checkout.session.completed',
        event: { id: 'evt_1', type: 'checkout.session.completed' }, notary: null, bid: null,
      }),
    },
  });

  assert.equal((await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' })).statusCode, 200);
  assert.equal((await journal(h.repo)).length, 0);
});

test('une signature Stripe invalide n’écrit RIEN — sinon la porte devient un robinet à journal', async () => {
  // La même leçon que le plafond des jetons forgés : toutes ces écritures
  // atterriraient sur la MÊME clé de partition que les traces d'argent.
  const h = harness({ billingConfigured: true, billing: { handleWebhook: async () => ({ ok: false }) } });

  for (let i = 0; i < 5; i += 1) {
    assert.equal((await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' })).statusCode, 400);
  }
  assert.equal((await journal(h.repo)).length, 0);
});

test('le compte Stripe d’un notaire change d’état : la trace nomme le notaire, pas l’offre', async () => {
  const h = harness({
    billingConfigured: true,
    billing: {
      handleWebhook: async () => ({
        ok: true, handled: true, duplicate: false, type: 'account.updated',
        event: { id: 'evt_4', type: 'account.updated' },
        notary: { id: NOTAIRE, status: 'active', chargesEnabled: true }, bid: null,
      }),
    },
  });

  assert.equal((await h.app.handle({ method: 'POST', path: '/stripe/webhook', headers: {}, body: '{}' })).statusCode, 200);

  const e = await seule(h.repo, 'notaire_compte_stripe');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.notaryId, NOTAIRE);
  assert.equal(e.meta.chargesEnabled, true);
  assert.equal(e.meta.statut, 'active');
  assert.equal(e.meta.type, 'account.updated');
});

// ---------------------------------------------------------------------------
// 2. LE NOTAIRE — inscription, périmètre, proposition, désistement
// ---------------------------------------------------------------------------

test('l’inscription spontanée d’un notaire est journalisée — sans son adresse', async () => {
  const h = harness();

  const res = await h.app.handle({
    method: 'POST', path: '/notaries/signup', headers: {}, sourceIp: '203.0.113.9',
    body: JSON.stringify({ email: EMAIL, lienCNQ: 'https://www.cnq.org/trouver-un-notaire/fiche/12345' }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'notaire_inscription');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.nouveau, true, 'un dossier neuf, ou une reprise : les deux gestes ne se réparent pas pareil');
  assert.equal(e.meta.lienCNQ, true, 'la fiche officielle a-t-elle été fournie — le fait, pas l’URL');
  assert.equal(e.day, TODAY);
  assert.ok(!JSON.stringify(e).includes(EMAIL), 'le courriel n’entre jamais dans la piste publique');
});

test('un périmètre qui change est journalisé AVEC son avant/après : il décide qui voit quoi', async () => {
  const h = harness();
  await seedNotaire(h.repo, { rayonKm: 0, urgences: false, prefixe: 'G1R' });

  const res = await h.app.handle({
    method: 'POST', path: '/notary/profile', headers: { authorization: 'Bearer ' + jetonNotaire() },
    body: JSON.stringify({ ...NOTARY_CONTACT, rayonKm: 50, urgences: true, prefixe: 'G1R' }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'notaire_profil_modifie');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  // LE CŒUR DE CETTE ENTRÉE : le périmètre avant et après. Un rayon élargi ou
  // un opt-in urgences allumé change le marché que ce notaire peut servir —
  // c'est le seul geste de profil qui déplace de l'argent.
  assert.deepEqual(e.meta.perimetre.avant, { rayonKm: 0, urgences: false, prefixe: 'G1R' });
  assert.deepEqual(e.meta.perimetre.apres, { rayonKm: 50, urgences: true, prefixe: 'G1R' });
  assert.ok(e.meta.champs.includes('rayonKm'), 'quels champs ont bougé');
  assert.ok(e.meta.champs.includes('urgences'));
  // Le nom, le téléphone et l'adresse sont des renseignements personnels : le
  // journal dit QU'ILS ont changé, jamais leur valeur (Loi 25, sept ans).
  assert.ok(!JSON.stringify(e).includes(NOTARY_CONTACT.telephone), 'aucune valeur personnelle recopiée');
});

test('un profil rechargé à l’identique n’écrit rien : le journal n’est pas un compteur de sauvegardes', async () => {
  const h = harness();
  await seedNotaire(h.repo, { rayonKm: 25, urgences: false, prefixe: 'G1R' });

  await h.app.handle({
    method: 'POST', path: '/notary/profile', headers: { authorization: 'Bearer ' + jetonNotaire() },
    body: JSON.stringify({ ...NOTARY_CONTACT, rayonKm: 25, urgences: false, prefixe: 'G1R' }),
  });

  assert.equal((await journal(h.repo, 'notaire_profil_modifie')).length, 0);
});

test('une proposition est journalisée : un notaire a mis un prix sur un acte', async () => {
  const h = harness();
  await seedNotaire(h.repo, { rayonKm: 50, prefixe: 'G1R' });
  await offreOuverte(h);

  const res = await h.app.handle({
    method: 'POST', path: '/notary/bids/propose', headers: { authorization: 'Bearer ' + jetonNotaire() },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE, montant: 2400 }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'notaire_proposition');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.bidId, 'b1');
  assert.equal(e.meta.dateISO, DATE_SIGNATURE);
  assert.equal(e.meta.montant, 2400);
  assert.equal(e.meta.montantOffert, 2000, 'ce que le client offrait : sans lui, l’écart ne se relit pas');
  assert.equal(e.meta.remplace, false);
});

test('le DÉSISTEMENT d’un notaire qui avait retenu l’acte est journalisé', async () => {
  const h = harness();
  await seedNotaire(h.repo, { rayonKm: 50, prefixe: 'G1R' });
  await offreOuverte(h, { status: domain.STATUS.RETENUE, notaryId: NOTAIRE, etude: 'Étude Tremblay' });

  const res = await h.app.handle({
    method: 'POST', path: '/notary/bids/release', headers: { authorization: 'Bearer ' + jetonNotaire() },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE, message: 'Conflit d’intérêts découvert.' }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'notaire_desistement');
  assert.deepEqual(e.acteur, { type: 'notaire', id: NOTAIRE });
  assert.equal(e.meta.bidId, 'b1');
  assert.equal(e.meta.dateISO, DATE_SIGNATURE);
  assert.equal(e.meta.montant, 2000);
  assert.equal(e.meta.etude, 'Étude Tremblay');
  // Le MOTIF appartient au client et au fil de la conversation (art. 37) : le
  // journal dit qu'un message a été laissé, jamais ce qu'il disait.
  assert.equal(e.meta.message, true);
  assert.ok(!JSON.stringify(e).includes('Conflit'), 'le texte du désistement n’entre pas au journal');
});

// ---------------------------------------------------------------------------
// 3. LES ANNULATIONS — y compris celles qui ne coûtent rien
// ---------------------------------------------------------------------------

test('l’annulation d’une offre JAMAIS RETENUE laisse une trace — elle n’en laissait aucune', async () => {
  const h = harness();
  await offreOuverte(h);

  const res = await h.app.handle({
    method: 'POST', path: '/client/bid/cancel', headers: { authorization: 'Bearer ' + jetonClient() },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'offre_annulee');
  assert.deepEqual(e.acteur, { type: 'client', id: 'b1' });
  assert.equal(e.meta.bidId, 'b1');
  assert.equal(e.meta.dateISO, DATE_SIGNATURE);
  assert.equal(e.meta.serviceId, 'refinancement');
  assert.equal(e.meta.montant, 2000);
  assert.equal(e.meta.retenue, false);
  assert.equal(e.meta.notaryId, null);
  assert.equal(e.meta.motif, 'non_retenue', 'pourquoi rien n’a été prélevé');
  assert.equal(e.meta.frais, 0);
  assert.equal(e.day, TODAY);
});

test('une annulation dans la FENÊTRE GRATUITE laisse une trace, elle aussi', async () => {
  // Loin de la signature : le barème ne retient rien. C'est exactement le cas
  // qui ne laissait rien — et donc celui qu'un client peut contester sans que
  // Nota puisse dire quand l'annulation est arrivée.
  const h = harness({ billingConfigured: true, billing: { cancelAuthorization: async () => ({ ok: true }) } });
  await offreOuverte(h, {
    status: domain.STATUS.RETENUE, notaryId: NOTAIRE, etude: 'Étude Tremblay',
    // Une carte enregistrée : Nota POURRAIT prélever. Si elle ne prélève rien,
    // c'est le barème qui l'a décidé — et c'est ce que le motif doit dire.
    paymentStatus: 'enregistre', paymentCustomerId: 'cus_1', paymentMethodId: 'pm_1',
  });
  await seedNotaire(h.repo);

  const res = await h.app.handle({
    method: 'POST', path: '/client/bid/cancel', headers: { authorization: 'Bearer ' + jetonClient() },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const e = await seule(h.repo, 'offre_annulee');
  assert.equal(e.meta.retenue, true);
  assert.equal(e.meta.notaryId, NOTAIRE);
  assert.equal(e.meta.motif, 'fenetre_gratuite');
  assert.equal(e.meta.frais, 0);
  assert.equal(e.meta.joursAvant, 20, 'combien de jours avant la signature : la seule variable du barème');
});

test('un acte retenu annulé SANS moyen de paiement se distingue d’une annulation gratuite', async () => {
  // Les deux ne coûtent rien au client, et le journal les confondait dans le
  // même silence. Elles n'appellent pourtant pas le même geste : la première
  // est le barème qui s'applique, la seconde est un notaire qui a bloqué sa
  // journée pour un acte que Nota ne PEUT pas facturer.
  const h = harness({ billingConfigured: true, billing: {} });
  await seedNotaire(h.repo);
  await offreOuverte(h, { status: domain.STATUS.RETENUE, notaryId: NOTAIRE, etude: 'Étude Tremblay' });

  await h.app.handle({
    method: 'POST', path: '/client/bid/cancel', headers: { authorization: 'Bearer ' + jetonClient() },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE }),
  });

  const e = await seule(h.repo, 'offre_annulee');
  assert.equal(e.meta.motif, 'sans_moyen_paiement');
});

test('une annulation AVEC frais garde ses deux traces : le fait, et l’argent', async () => {
  // `annulation_frais` (ADR 0023) reste la pièce financière ; `offre_annulee`
  // est le fait. Les confondre, c'était perdre le fait chaque fois que le
  // barème ne retenait rien.
  // Cinq jours avant la signature : le palier « ≤ 14 jours » du barème par
  // défaut, 10 % — et une caution VIVANTE, donc capturable.
  const proche = '2026-09-10';
  const h = harness({
    billingConfigured: true,
    billing: {
      chargeCancellationFee: async () => ({ ok: true, chargeId: 'ch_1', verse: true, transferId: 'tr_1', mecanisme: 'capture' }),
      cancelAuthorization: async () => ({ ok: true }),
    },
  });
  await seedNotaire(h.repo);
  await offreOuverte(h, {
    dateISO: proche, status: domain.STATUS.RETENUE, notaryId: NOTAIRE, etude: 'Étude Tremblay',
    paymentStatus: 'authorized', paymentIntentId: 'pi_1', authorizedAt: TODAY,
  });

  const res = await h.app.handle({
    method: 'POST', path: '/client/bid/cancel', headers: { authorization: 'Bearer ' + jetonClient() },
    body: JSON.stringify({ id: 'b1', dateISO: proche }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const frais = await seule(h.repo, 'annulation_frais');
  assert.equal(frais.meta.percu, true);
  const fait = await seule(h.repo, 'offre_annulee');
  assert.equal(fait.meta.motif, 'frais_percus');
  assert.ok(fait.meta.frais > 0, 'le fait porte le montant lui aussi : une seule requête au journal doit suffire');
});

test('des frais DUS que Nota n’a pas pu prélever ne se lisent PAS « fenêtre gratuite »', async () => {
  // LE CAS QUI SE DÉGUISAIT EN NORMAL (revue du 2026-09-05). Le barème réclame
  // 10 % — l'offre a bien une carte, c'est elle qui a fait naître les frais —
  // mais `chargeCancellationFee` rend `aucun_moyen` : un code qui n'est NI un
  // succès NI `frais_refuses`, donc le seul cas où AUCUNE entrée
  // `annulation_frais` n'est écrite. Le motif se calculait alors sur le moyen
  // de paiement, qui est présent, et le journal annonçait « fenetre_gratuite ».
  // Le motif le plus alarmant — le notaire a bloqué sa journée, des frais lui
  // étaient dus, personne ne les a pris — se lisait comme le plus banal, et
  // rien d'autre au registre ne venait le contredire.
  const proche = '2026-09-10';
  const h = harness({
    billingConfigured: true,
    billing: {
      chargeCancellationFee: async () => ({ ok: false, code: 'aucun_moyen' }),
      cancelAuthorization: async () => ({ ok: true }),
    },
  });
  await seedNotaire(h.repo);
  await offreOuverte(h, {
    dateISO: proche, status: domain.STATUS.RETENUE, notaryId: NOTAIRE, etude: 'Étude Tremblay',
    paymentStatus: 'enregistre', paymentCustomerId: 'cus_1', paymentMethodId: 'pm_1',
  });

  const res = await h.app.handle({
    method: 'POST', path: '/client/bid/cancel', headers: { authorization: 'Bearer ' + jetonClient() },
    body: JSON.stringify({ id: 'b1', dateISO: proche }),
  });
  assert.equal(res.statusCode, 200, res.body);

  assert.equal((await journal(h.repo, 'annulation_frais')).length, 0,
    'aucune pièce financière : c’est précisément pourquoi le FAIT doit porter la vérité');
  const e = await seule(h.repo, 'offre_annulee');
  assert.equal(e.meta.motif, 'frais_non_preleves');
  assert.equal(e.meta.frais, 0, '`frais` reste ce qui a bougé — rien');
  // Le montant RÉCLAMÉ par le barème, calculé depuis le barème et non recopié
  // d'une sortie observée : 10 % du montant au palier « ≤ 14 jours ».
  const attendu = require('../src/cancellation-config.js').feeFor({
    montant: 2000,
    joursAvant: domain.daysBetween(TODAY, proche),
    paliers: require('../src/cancellation-config.js').envDefaults().paliers,
  });
  assert.ok(attendu.frais > 0, 'le barème réclamait bien quelque chose');
  assert.equal(e.meta.fraisDus, attendu.frais, 'ce que le notaire attend, lisible sans rejouer le barème');
});

// ---------------------------------------------------------------------------
// 4. Le jour ouvrable, sur toutes les entrées neuves
// ---------------------------------------------------------------------------

test('un geste du SOIR appartient à la journée d’affaires en cours, pas au lendemain UTC', async () => {
  // 21 h à Québec le 5 septembre = 01 h UTC le 6. `toISOString().slice(0,10)`
  // rangerait l'entrée sous le 6 ; le journal se lit par jour de QUÉBEC.
  const soirMs = Date.parse('2026-09-06T01:15:00.000Z');
  const repo = createMemoryRepo([]);
  const app = createApp(repo, {
    now: () => domain.businessDay(soirMs, 'America/Toronto'),
    nowMs: () => soirMs,
    env: { NOTA_BASE_URL: 'https://nota.quebec' },
  });
  await repo.put({
    id: 'b1', serviceId: 'refinancement', dateISO: DATE_SIGNATURE, montant: 2000, tier: 'standard',
    premium: 1, anonyme: true, prefixe: 'G1R', pricing: PRICING, basePrice: 2000,
    status: domain.STATUS.OUVERTE, notaryId: null, propositions: [], demandes: [], createdAt: TODAY,
  });

  await app.handle({
    method: 'POST', path: '/client/bid/cancel',
    headers: { authorization: 'Bearer ' + signToken('b1', soirMs + 3600_000, SCOPES.CLIENT) },
    body: JSON.stringify({ id: 'b1', dateISO: DATE_SIGNATURE }),
  });

  const e = (await repo.queryTxAuditByDay('2026-09-05')).filter((x) => x.action === 'offre_annulee');
  assert.equal(e.length, 1, 'l’entrée du soir se lit sous le 5 septembre, pas sous le 6');
  assert.equal(e[0].day, '2026-09-05');
});
