// La mise en relation est complète (ADR 0033) : le notaire porte un nom, un
// téléphone et l'adresse de son étude AVANT de pouvoir retenir ou proposer ;
// le client retenu reçoit les quatre ; la console reçoit les conditions de
// l'engagement (paiement à la signature, barème d'annulation, désistement) et
// la fenêtre de mois qu'elle couvre. Le widget de soutien est limité par IP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT, activeNotary } from '../test-support/notary-fixture.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { signToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth.js');
const cancellationCfg = require('../src/cancellation-config.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const EMAIL = 'me@etude.ca';
const NOTARY = notaryIdForEmail(EMAIL);
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, ...opts }), repo };
}
const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);
const call = (a, method, path, { token, body, query, sourceIp } = {}) =>
  a.handle({ method, path, ...(token ? { headers: bearer(token) } : {}), ...(body ? { body: JSON.stringify(body) } : {}), query: query || {}, ...(sourceIp ? { sourceIp } : {}) });

async function seedBid(a, over = {}) {
  const res = await call(a, 'POST', '/bids', { body: { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'client@example.ca', nom: 'Marie Roy', prefixe: 'G1R', pricing: PRICING, ...over } });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}
async function session(a, record) {
  await a.repo.putNotary(record);
  return (await notarySignIn(a, record.email)).token;
}
const accept = (a, token, bid) => call(a, 'POST', '/notary/bids/accept', { token, body: { id: bid.id, dateISO: bid.dateISO } });
const propose = (a, token, bid, montant = 3200) => call(a, 'POST', '/notary/bids/propose', { token, body: { id: bid.id, dateISO: bid.dateISO, montant } });
const feed = async (a, token) => parse(await call(a, 'GET', '/notary/bids', { token }));

// --- Le profil : identité et alertes ------------------------------------------

test('POST /notary/profile stores nom, étude, téléphone, adresse and alertes, and returns the full profil', async () => {
  const a = app();
  const token = await session(a, { id: NOTARY, email: EMAIL, status: 'active', label: 'ancienne-etiquette' });

  const res = await call(a, 'POST', '/notary/profile', { token, body: {
    nom: ' Me Julie Tremblay ', etude: 'Tremblay Notaires', telephone: '(418) 555-0199',
    adresse: '123, rue Saint-Jean, Québec (QC) G1R 1N4', rayonKm: 25,
    alertes: { pace: 'instant', urgentOnly: true },
  } });
  assert.equal(res.statusCode, 200, res.body);
  const { profil } = parse(res);
  assert.equal(profil.nom, 'Me Julie Tremblay');
  assert.equal(profil.etude, 'Tremblay Notaires');
  assert.equal(profil.telephone, '(418) 555-0199');
  assert.equal(profil.adresse, '123, rue Saint-Jean, Québec (QC) G1R 1N4');
  assert.equal(profil.courriel, EMAIL);
  assert.equal(profil.rayonKm, 25);
  assert.equal(profil.complet, true);
  assert.deepEqual(profil.manquants, []);
  assert.deepEqual(profil.alertes, { pace: 'instant', urgentOnly: true });

  const stored = await a.repo.getNotary(NOTARY);
  assert.equal(stored.nom, 'Me Julie Tremblay');
  assert.equal(stored.telephone, '(418) 555-0199');
  assert.deepEqual(stored.alertes, { pace: 'instant', urgentOnly: true });
  assert.equal(stored.status, 'active', 'the write spreads the existing record');
  assert.equal(stored.label, 'ancienne-etiquette', 'the legacy label survives untouched');

  // The console reads the same block back.
  const view = await feed(a, token);
  assert.equal(view.profil.nom, 'Me Julie Tremblay');
  assert.equal(view.profil.complet, true);
  assert.deepEqual(view.profil.alertes, { pace: 'instant', urgentOnly: true });
});

test('POST /notary/profile: a field absent from the body keeps its stored value; present-but-empty clears it', async () => {
  const a = app();
  const token = await session(a, activeNotary(EMAIL, { rayonKm: 50 }));

  // The alert block posts alone (the console's « à votre rythme » block is a
  // separate form) — nom/téléphone/adresse/rayon must survive.
  const only = await call(a, 'POST', '/notary/profile', { token, body: { alertes: { pace: 'off' } } });
  assert.equal(only.statusCode, 200, only.body);
  const p = parse(only).profil;
  assert.equal(p.nom, NOTARY_CONTACT.nom);
  assert.equal(p.telephone, NOTARY_CONTACT.telephone);
  assert.equal(p.rayonKm, 50);
  assert.deepEqual(p.alertes, { pace: 'off', urgentOnly: false });

  // An explicit empty string clears — the notary removes their phone.
  const cleared = await call(a, 'POST', '/notary/profile', { token, body: { telephone: '' } });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(parse(cleared).profil.telephone, null);
  assert.equal(parse(cleared).profil.complet, false);
  assert.deepEqual(parse(cleared).profil.manquants.map((m) => m.id), ['telephone']);
  assert.deepEqual(parse(cleared).profil.alertes, { pace: 'off', urgentOnly: false }, 'the alert preference posted earlier survives');
});

test('POST /notary/profile refuses a bad téléphone, an oversized nom and an unknown alert pace with typed codes', async () => {
  const a = app();
  const token = await session(a, activeNotary(EMAIL));
  const res = await call(a, 'POST', '/notary/profile', { token, body: { telephone: '12', nom: 'x'.repeat(domain.NOTARY_NAME_MAX + 1), alertes: { pace: 'hourly' } } });
  assert.equal(res.statusCode, 422, res.body);
  const codes = parse(res).errors.map((e) => e.code);
  assert.ok(codes.includes('telephone_invalide'), codes);
  assert.ok(codes.includes('nom_invalide'), codes);
  assert.ok(codes.includes('alerte_rythme_invalide'), codes);
  assert.equal((await a.repo.getNotary(NOTARY)).telephone, NOTARY_CONTACT.telephone, 'a refused write never touches the record');
});

// --- La barrière : ni retenir ni proposer sans identité -------------------------

test('accept and propose are refused with 403 profil_incomplet + manquants while nom/téléphone/adresse are missing', async () => {
  const a = app();
  const token = await session(a, { id: NOTARY, email: EMAIL, status: 'active', label: 'Étude sans visage', nom: 'Me Sans Téléphone' });
  const bid = await seedBid(a);

  for (const res of [await accept(a, token, bid), await propose(a, token, bid)]) {
    assert.equal(res.statusCode, 403, res.body);
    const err = parse(res).errors[0];
    assert.equal(err.code, 'profil_incomplet');
    assert.deepEqual(err.manquants.map((m) => m.id), ['telephone', 'adresse']);
    for (const m of err.manquants) assert.equal(typeof m.label, 'string');
  }
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, domain.STATUS.OUVERTE, 'a refused accept never flips the bid');
  assert.equal((stored.propositions || []).length, 0, 'a refused propose writes nothing');

  // Completing the profile opens the door.
  await call(a, 'POST', '/notary/profile', { token, body: { telephone: '418 555 0100', adresse: '1, rue du Test, Québec (QC) G1R 1A1' } });
  const ok = await accept(a, token, bid);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(parse(ok).client.nom, 'Marie Roy');
});

test('the idempotent re-accept by the holder is NOT gated, even if their profile narrowed since', async () => {
  const a = app();
  const token = await session(a, activeNotary(EMAIL));
  const bid = await seedBid(a);
  assert.equal((await accept(a, token, bid)).statusCode, 200);
  // The notary later empties their phone: they keep the dossier they hold.
  await a.repo.putNotary({ ...(await a.repo.getNotary(NOTARY)), telephone: null });
  const again = await accept(a, token, bid);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(parse(again).id, bid.id);
});

test('retention stamps the declared étude on the bid (notaryEtude: étude, then legacy label)', async () => {
  const a = app();
  const token = await session(a, activeNotary(EMAIL, { label: 'me@etude.ca', etude: 'Tremblay Notaires' }));
  const bid = await seedBid(a);
  assert.equal((await accept(a, token, bid)).statusCode, 200);
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).etude, 'Tremblay Notaires');

  // A proposition carries the same name (the client's projection shows it).
  const b2 = await seedBid(a, { dateISO: '2026-08-21' });
  assert.equal((await propose(a, token, b2)).statusCode, 200);
  const stored = await a.repo.get(b2.id, b2.dateISO);
  assert.equal(stored.propositions[0].etude, 'Tremblay Notaires');
});

// --- Ce que la console reçoit : conditions, fenêtre, prévision d'annulation -------

test('GET /notary/bids carries profil (complet/manquants/courriel/alertes), conditions and fenetre', async () => {
  const a = app();
  const token = await session(a, { id: NOTARY, email: EMAIL, status: 'active' });
  const view = await feed(a, token);

  assert.equal(view.profil.courriel, EMAIL);
  assert.equal(view.profil.complet, false);
  assert.deepEqual(view.profil.manquants.map((m) => m.id), ['nom', 'telephone', 'adresse']);
  assert.equal(view.profil.nom, null);
  assert.deepEqual(view.profil.alertes, { pace: 'daily', urgentOnly: false });

  assert.equal(view.conditions.paiement, 'signature');
  assert.deepEqual(view.conditions.tarifNota, view.tarif, 'the same object as `tarif`');
  assert.deepEqual(view.conditions.annulation, { paliers: cancellationCfg.envDefaults().paliers, beneficiaire: 'notaire' });
  assert.deepEqual(view.conditions.desistement, { gratuit: true, compte: true });

  assert.deepEqual(view.fenetre, ['2026-08', '2026-09', '2026-10', '2026-11']);
});

test('conditions.annulation.paliers is the stored barème when the admin set one (resolved like the cancel route)', async () => {
  const a = app();
  await a.repo.putCancellationConfig({ paliers: [{ maxJours: 5, taux: 0.2 }] });
  const token = await session(a, activeNotary(EMAIL));
  const view = await feed(a, token);
  assert.deepEqual(view.conditions.annulation.paliers, [{ maxJours: 5, taux: 0.2 }]);
});

test('each retained entry carries the cancellation forecast for TODAY (null without a live hold)', async () => {
  const noBilling = app();
  const t1 = await session(noBilling, activeNotary(EMAIL));
  const b1 = await seedBid(noBilling);
  assert.equal((await accept(noBilling, t1, b1)).statusCode, 200);
  const v1 = await feed(noBilling, t1);
  assert.equal(v1.retained.length, 1);
  assert.equal(v1.retained[0].annulation, null);

  // With billing on and an authorized hold, the forecast is the barème's answer.
  const repo = createMemoryRepo([]);
  const stripe = {
    async createOfferAuthorization(args) { return { sessionId: 'cs_' + args.bidId, url: 'https://checkout.test/' + args.bidId }; },
    constructEvent(raw) { return JSON.parse(raw); },
  };
  const billing = createBilling({ repo, stripe, now: () => TODAY });
  const withBilling = { ...createApp(repo, { siteUrl: 'https://nota.test', now: () => TODAY, nowMs: () => NOW_MS, newId: (() => { let n = 0; return () => 'bid-' + ++n; })(), billing }), repo };
  const t2 = await session(withBilling, activeNotary(EMAIL));
  const dateISO = domain.addDays(TODAY, 3);
  const b2 = await seedBid(withBilling, { dateISO });
  await repo.authorizeBid(b2.id, b2.dateISO, { paymentIntentId: 'pi_' + b2.id, authorizedAt: TODAY });
  assert.equal((await accept(withBilling, t2, b2)).statusCode, 200);
  const v2 = await feed(withBilling, t2);
  assert.deepEqual(v2.retained[0].annulation, { taux: 0.3, frais: 840, joursAvant: 3 });
});

// --- Ce que le client reçoit : le notaire, joignable ------------------------------

test('GET /client/bid names the retaining notary: nom, étude, téléphone, adresse, courriel, lienCNQ, actes — never a rating', async () => {
  const a = app();
  const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/123/';
  const token = await session(a, activeNotary(EMAIL, { etude: 'Tremblay Notaires', lienCNQ: FICHE, actsCompleted: 7, ratingSum: 45, ratingCount: 10 }));
  const bid = await seedBid(a);
  const before = parse(await call(a, 'GET', '/client/bid', { token: clientToken(bid.id), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.equal(before.notaire, null, 'no contact flows before retention');

  assert.equal((await accept(a, token, bid)).statusCode, 200);
  const after = parse(await call(a, 'GET', '/client/bid', { token: clientToken(bid.id), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.deepEqual(after.notaire, {
    nom: NOTARY_CONTACT.nom,
    etude: 'Tremblay Notaires',
    telephone: NOTARY_CONTACT.telephone,
    adresse: NOTARY_CONTACT.adresse,
    courriel: EMAIL,
    lienCNQ: FICHE,
    actes: 7,
  });
});

// --- La démo ouverte retient encore ------------------------------------------------

test('under NOTA_DEMO_OPEN a brand-new account is seeded contactable, so the open demo can retain', async () => {
  const a = app();
  const prev = process.env.NOTA_DEMO_OPEN;
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    const { token } = await notarySignIn(a, 'notaire.demo@etude.ca');
    const stored = await a.repo.getNotary(notaryIdForEmail('notaire.demo@etude.ca'));
    assert.equal(stored.nom, 'Me Démo Nota');
    assert.equal(stored.etude, 'Étude Démo');
    assert.equal(stored.telephone, '418 555 0100');
    assert.equal(stored.adresse, '1, rue de la Démo, Québec (QC) G1R 1A1');
    assert.equal(stored.label, 'notaire.demo@etude.ca', 'label stays for backward compat');
    const bid = await seedBid(a);
    assert.equal((await accept(a, token, bid)).statusCode, 200);
    assert.equal((await a.repo.get(bid.id, bid.dateISO)).etude, 'Étude Démo');
  } finally {
    if (prev === undefined) delete process.env.NOTA_DEMO_OPEN;
    else process.env.NOTA_DEMO_OPEN = prev;
  }
});

// --- POST /bids : le téléphone du client passe par la règle du domaine ------------

test('POST /bids validates the client téléphone through domain.validateTelephone', async () => {
  const a = app();
  const bad = await call(a, 'POST', '/bids', { body: { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'c@example.ca', prefixe: 'G1R', pricing: PRICING, telephone: '555-1234' } });
  assert.equal(bad.statusCode, 422);
  assert.deepEqual(parse(bad).errors.map((e) => e.code), ['telephone_invalide']);
  const ok = await seedBid(a, { telephone: ' (418) 555-1234 ' });
  assert.equal((await a.repo.get(ok.id, ok.dateISO)).telephone, '(418) 555-1234', 'stored trimmed, formatting kept');
});

// --- Le widget de soutien : limité par IP ----------------------------------------

test('POST /support/messages: the 21st message from one IP in 10 minutes is 429 trop_de_messages; another IP still passes', async () => {
  const a = app();
  const send = (ip, texte = 'Bonjour') => call(a, 'POST', '/support/messages', { body: { texte }, sourceIp: ip });
  for (let i = 0; i < 20; i += 1) {
    const r = await send('10.0.0.1');
    assert.equal(r.statusCode, 201, 'message ' + (i + 1) + ': ' + r.body);
  }
  const blocked = await send('10.0.0.1');
  assert.equal(blocked.statusCode, 429, blocked.body);
  assert.deepEqual(parse(blocked), { errors: [{ code: 'trop_de_messages', message: 'Trop de messages en peu de temps. Réessayez dans quelques minutes.' }] });
  assert.equal((await send('10.0.0.2')).statusCode, 201);
});
