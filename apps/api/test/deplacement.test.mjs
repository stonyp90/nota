// ADR 0017 — the signature is in person within a declared perimeter. The
// client's `deplacement` band rides every offer; the notary declares a travel
// radius (`rayonKm`) and an online-urgency opt-in (`urgences`) on their
// profile; the feed only offers what the notary can serve, and accept/propose
// re-enforce it server-side (`deplacement_non_couvert`). Legacy bids without
// a band reach everyone, like the lender.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  return { ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, ...opts }), repo };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const NOTARY = notaryIdForEmail('n@etude.ca');
const sessionToken = () => signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);

const postProfile = (a, token, body) =>
  a.handle({ method: 'POST', path: '/notary/profile', headers: bearer(token), body: JSON.stringify(body) });

async function seedNotary(a, over = {}) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    ...over,
  });
}

// A valid offer for the band under test. urgence_en_ligne raises the dynamic
// floor to 2400 and notaire_50 to 2250 — 3000 clears every band.
const pricing = (deplacement) => ({
  valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue',
  preteur: 'desjardins', deplacement,
});

async function postBid(a, deplacement, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 3000,
      courriel: 'client@example.ca', pricing: pricing(deplacement), ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

const feed = async (a) => parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
const accept = (a, b) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(sessionToken()), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });
const propose = (a, b, montant) =>
  a.handle({ method: 'POST', path: '/notary/bids/propose', headers: bearer(sessionToken()), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, montant }) });

// Strip the band from a stored bid, in place — a record that predates ADR 0017.
async function makeLegacy(a, b) {
  const stored = await a.repo.get(b.id, b.dateISO);
  await a.repo.update({ ...stored, pricing: { ...stored.pricing, deplacement: undefined } });
}

// --- The notary profile: rayonKm + urgences ---------------------------------

test('POST /notary/profile stores rayonKm and urgences; /notary/bids reads them back', async () => {
  const a = app();
  await seedNotary(a, { ratingSum: 9, ratingCount: 2 });

  const res = await postProfile(a, sessionToken(), { rayonKm: 50, urgences: true });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res).profil, { lienCNQ: null, rayonKm: 50, urgences: true });

  // The write is a spread on the existing record — identity survives.
  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.rayonKm, 50);
  assert.equal(notary.urgences, true);
  assert.equal(notary.status, 'active');
  assert.equal(notary.ratingSum, 9);

  const view = await feed(a);
  assert.deepEqual(view.profil, { lienCNQ: null, rayonKm: 50, urgences: true });
});

test('the conservative defaults: a notary who said nothing travels nowhere, takes no urgency', async () => {
  const a = app();
  await seedNotary(a);

  // No profile write at all: the console still reads honest defaults.
  const before = await feed(a);
  assert.deepEqual(before.profil, { lienCNQ: null, rayonKm: 0, urgences: false });

  // An empty profile write stores the same defaults.
  const res = await postProfile(a, sessionToken(), {});
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res).profil, { lienCNQ: null, rayonKm: 0, urgences: false });
  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.rayonKm, 0);
  assert.equal(notary.urgences, false);
});

test('a radius outside NOTARY_RADII is refused (rayon_invalide) and never stored', async () => {
  const a = app();
  await seedNotary(a, { rayonKm: 25 });

  const res = await postProfile(a, sessionToken(), { rayonKm: 12 });
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'rayon_invalide');
  assert.equal((await a.repo.getNotary(NOTARY)).rayonKm, 25, 'a refused radius never overwrites the stored one');
});

// --- The feed only offers what the notary can serve --------------------------

test('feed gating: client bands reach everyone, notary bands need the radius, urgencies need the opt-in', async () => {
  const a = app();
  await seedNotary(a);
  const bClient = await postBid(a, 'client_25', { dateISO: '2026-08-20' });
  const bTravel = await postBid(a, 'notaire_50', { dateISO: '2026-08-21' });
  const bUrgent = await postBid(a, 'urgence_en_ligne', { dateISO: '2026-08-22' });
  const bLegacy = await postBid(a, 'client_50', { dateISO: '2026-08-23' });
  await makeLegacy(a, bLegacy);

  // No declared radius, no opt-in: the client-travel bid and the legacy one.
  const ids = async () => (await feed(a)).bids.map((b) => b.id).sort();
  assert.deepEqual(await ids(), [bClient.id, bLegacy.id].sort());

  // Widening the radius IS how the notary sees more demandes.
  await postProfile(a, sessionToken(), { rayonKm: 50 });
  assert.deepEqual(await ids(), [bClient.id, bTravel.id, bLegacy.id].sort());

  // The online-urgency opt-in unlocks the declared urgency.
  await postProfile(a, sessionToken(), { rayonKm: 50, urgences: true });
  assert.deepEqual(await ids(), [bClient.id, bTravel.id, bUrgent.id, bLegacy.id].sort());
});

test('the notary projection names the band — and stays null on a legacy bid', async () => {
  const a = app();
  await seedNotary(a);
  const posted = await postBid(a, 'client_25', { dateISO: '2026-08-20' });
  const legacy = await postBid(a, 'client_50', { dateISO: '2026-08-21' });
  await makeLegacy(a, legacy);

  const view = await feed(a);
  const banded = view.bids.find((b) => b.id === posted.id);
  assert.deepEqual(banded.deplacement, {
    id: 'client_25',
    nom: domain.deplacementById('client_25').nom,
    qui: 'client', km: 25, urgence: false,
  });
  assert.equal(view.bids.find((b) => b.id === legacy.id).deplacement, null);
});

// --- The server-authoritative gate on accept and propose ---------------------

test('accepting an urgency without the opt-in is refused; opting in unlocks it; re-accept stays idempotent', async () => {
  const a = app();
  await seedNotary(a);
  const bid = await postBid(a, 'urgence_en_ligne');

  const refused = await accept(a, bid);
  assert.equal(refused.statusCode, 403);
  assert.equal(parse(refused).errors[0].code, 'deplacement_non_couvert');
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).status, domain.STATUS.OUVERTE, 'a refused accept never retains');

  await postProfile(a, sessionToken(), { urgences: true });
  assert.equal((await accept(a, bid)).statusCode, 200);

  // A notary who legitimately retained keeps the idempotent re-accept — even
  // after narrowing their profile back down.
  await postProfile(a, sessionToken(), {});
  const again = await accept(a, bid);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(parse(again).id, bid.id);
});

test('proposing on a travel band beyond the declared radius is refused with the same code', async () => {
  const a = app();
  await seedNotary(a);
  const bid = await postBid(a, 'notaire_50');

  const refused = await propose(a, bid, 3200);
  assert.equal(refused.statusCode, 403);
  assert.equal(parse(refused).errors[0].code, 'deplacement_non_couvert');

  await postProfile(a, sessionToken(), { rayonKm: 50 });
  const ok = await propose(a, bid, 3200);
  assert.equal(ok.statusCode, 200, ok.body);
});

// --- The retained block ------------------------------------------------------

test('a retained entry carries the deplacement projection beside the lender', async () => {
  const a = app();
  await seedNotary(a);
  const bid = await postBid(a, 'notaire_25');
  await postProfile(a, sessionToken(), { rayonKm: 25 });
  assert.equal((await accept(a, bid)).statusCode, 200);

  const view = await feed(a);
  assert.equal(view.retained.length, 1);
  assert.deepEqual(view.retained[0].deplacement, {
    id: 'notaire_25',
    nom: domain.deplacementById('notaire_25').nom,
    qui: 'notaire', km: 25, urgence: false,
  });
  assert.equal(view.retained[0].preteur.id, 'desjardins');
});
