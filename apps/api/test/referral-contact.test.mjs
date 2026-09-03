import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
const domain = require('@nota/domain');

// The two privacy-critical features of the financing pivot, end to end:
//
//   • Referral attribution on a bid (ADR 0011): `parrain` rides along on
//     POST /bids, is stored ONLY when the domain says it is a real code, and
//     is never visible again outside the admin ledger.
//   • Mise en relation (ADR 0010 §4): the client's telephone is collected
//     privately, and contact details flow — in BOTH directions — only at the
//     moment a bid is RETAINED, never before.
//
// Plus the "transmis autrement" dossier value, which must satisfy a document
// request exactly like an uploaded file name.

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;

function app(seed = []) {
  let n = 0;
  const repo = createMemoryRepo(seed);
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n }),
    repo,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });

// Zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

const postBid = (a, over = {}) =>
  a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement',
      dateISO: '2026-08-20',
      montant: 2800,
      courriel: 'client@example.ca',
      prefixe: 'G1R',
      pricing: PRICING,
      ...over,
    }),
  });

async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude ' + email, ...NOTARY_CONTACT });
  return (await notarySignIn(a, email)).token;
}

const listNotaryBids = (a, token) =>
  a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} });
const accept = (a, token, id, dateISO) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id, dateISO }) });
const clientBid = (a, token, id, dateISO) =>
  a.handle({ method: 'GET', path: '/client/bid', headers: bearer(token), query: { id, dateISO } });

// --- Referral attribution on POST /bids (ADR 0011) ---------------------------

test('a valid parrain is stored NORMALIZED on the bid; the response never echoes it', async () => {
  const a = app();
  const res = await postBid(a, { parrain: 'eve-roy' }); // separators + case are the client's problem, not ours
  assert.equal(res.statusCode, 201, res.body);
  const body = parse(res);
  assert.equal(res.body.includes('parrain'), false, 'POST /bids must not echo the referral code');
  const stored = (await a.repo._all())[0];
  assert.equal(stored.parrain, 'EVEROY');
  assert.equal(domain.isReferralCode(stored.parrain), true);
  void body;
});

test('an INVALID parrain is silently dropped — the booking must never fail over a broken referral link', async () => {
  const a = app();
  for (const bad of ['ab', 'x'.repeat(13), '???', '', null, 42]) {
    const res = await postBid(a, { dateISO: '2026-08-21', parrain: bad });
    assert.equal(res.statusCode, 201, 'an invalid code must not fail the booking: ' + JSON.stringify(bad));
  }
  for (const b of await a.repo._all()) {
    assert.equal(b.parrain, null, 'no invalid code may be stored');
  }
});

test('parrain never leaks: public carnet, notary console, client space, calendar feed', async () => {
  const a = app();
  const { bid } = parse(await postBid(a, { parrain: 'EVEROY' }));
  const clientToken = parse(await postBid(a, { dateISO: '2026-08-21', parrain: 'EVEROY' })).clientToken;

  // Public list + public feed.
  const pub = await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } });
  assert.equal(pub.body.includes('EVEROY'), false, 'GET /bids leaked the referral code');
  const feed = await a.handle({ method: 'GET', path: '/carnet/feed.ics', query: {} });
  assert.equal(feed.body.includes('EVEROY'), false, 'the public feed leaked the referral code');

  // Notary console — open list, then the retained view after an accept.
  const token = await session(a, 'me@notaire.ca');
  assert.equal((await listNotaryBids(a, token)).body.includes('EVEROY'), false, 'the open-bid console leaked the referral code');
  await accept(a, token, bid.id, bid.dateISO);
  assert.equal((await listNotaryBids(a, token)).body.includes('EVEROY'), false, 'the retained view leaked the referral code');

  // Client space (their own bid) never re-echoes it either.
  const own = await clientBid(a, clientToken, 'id-2', '2026-08-21');
  assert.equal(own.body.includes('EVEROY'), false, 'GET /client/bid leaked the referral code');
});

// --- Telephone (mise en relation, ADR 0010 §4) --------------------------------

test('telephone: loose formats pass (10 or 11 digits once stripped) and are stored as typed, trimmed', async () => {
  const a = app();
  const formats = ['(418) 555-1234', '418.555.1234', '  1 418 555 1234  ', '+1 418-555-1234'];
  for (const [i, telephone] of formats.entries()) {
    const res = await postBid(a, { dateISO: '2026-08-2' + (i + 1), telephone });
    assert.equal(res.statusCode, 201, 'should accept ' + JSON.stringify(telephone) + ': ' + res.body);
  }
  const stored = await a.repo._all();
  assert.equal(stored[0].telephone, '(418) 555-1234');
  assert.equal(stored[2].telephone, '1 418 555 1234', 'stored trimmed, otherwise exactly as typed');
});

test('telephone: too short / too long is a typed 422 telephone_invalide; absent is fine', async () => {
  const a = app();
  for (const bad of ['555-1234', '12345678901234', 'pas un numéro']) {
    const res = await postBid(a, { telephone: bad });
    assert.equal(res.statusCode, 422, JSON.stringify(bad));
    assert.ok(parse(res).errors.some((e) => e.code === 'telephone_invalide'));
  }
  assert.equal((await a.repo._all()).length, 0, 'nothing stored on a rejected offer');
  assert.equal((await postBid(a, {})).statusCode, 201, 'no telephone at all is allowed');
  assert.equal((await a.repo._all())[0].telephone, null);
});

test('telephone never appears publicly, not even as a key', async () => {
  const a = app();
  await postBid(a, { telephone: '418 555-1234' });
  const pub = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } })).bids[0];
  assert.equal(Object.prototype.hasOwnProperty.call(pub, 'telephone'), false);
});

// --- Contact exchange happens at RETENTION, in both directions ----------------

test('before retention: the notary sees no client contact, the client sees no notaire', async () => {
  const a = app();
  const posted = parse(await postBid(a, { anonyme: true, nom: 'Marie-Ève Tremblay', telephone: '418 555-1234' }));
  const token = await session(a, 'me@notaire.ca');

  const list = parse(await listNotaryBids(a, token));
  assert.equal(list.bids.length, 1);
  const open = list.bids[0];
  for (const key of ['client', 'nom', 'courriel', 'telephone']) {
    assert.equal(Object.prototype.hasOwnProperty.call(open, key), false, key + ' present on an OPEN bid');
  }
  assert.equal(list.retained.length, 0);

  const own = parse(await clientBid(a, posted.clientToken, posted.bid.id, posted.bid.dateISO));
  assert.equal(own.notaire, null, 'no notary contact before retention');
});

test('after retention: the retaining notary gets {nom, courriel, telephone} — nom even for an anonymous bid', async () => {
  const a = app();
  const posted = parse(await postBid(a, { anonyme: true, nom: 'Marie-Ève Tremblay', telephone: '418 555-1234' }));
  assert.equal(posted.bid.nom, null, 'the carnet keeps the anonymity promise');
  const token = await session(a, 'me@notaire.ca');

  // The accept response itself carries the contact block.
  const acc = parse(await accept(a, token, posted.bid.id, posted.bid.dateISO));
  assert.deepEqual(acc.client, { nom: 'Marie-Ève Tremblay', courriel: 'client@example.ca', telephone: '418 555-1234' });

  // So does the console's retained view…
  const list = parse(await listNotaryBids(a, token));
  assert.equal(list.retained.length, 1);
  assert.deepEqual(list.retained[0].client, { nom: 'Marie-Ève Tremblay', courriel: 'client@example.ca', telephone: '418 555-1234' });

  // …and the dossier route.
  const dos = parse(await a.handle({ method: 'GET', path: '/notary/dossier', headers: bearer(token), query: { id: posted.bid.id, dateISO: posted.bid.dateISO } }));
  assert.deepEqual(dos.client, { nom: 'Marie-Ève Tremblay', courriel: 'client@example.ca', telephone: '418 555-1234' });

  // The PUBLIC carnet still honors anonymity after retention.
  const pub = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } })).bids[0];
  assert.equal(pub.nom, null);
});

test('after retention: the client sees the retaining notary étude + courriel; another notary sees nothing', async () => {
  const a = app();
  const posted = parse(await postBid(a, {}));
  const tokenA = await session(a, 'a@notaire.ca');
  const tokenB = await session(a, 'b@notaire.ca');
  await accept(a, tokenA, posted.bid.id, posted.bid.dateISO);

  const own = parse(await clientBid(a, posted.clientToken, posted.bid.id, posted.bid.dateISO));
  // ADR 0030 : le bloc notaire porte la mise en relation et des FAITS — jamais
  // une moyenne ni une cote (art. 70 du Code de déontologie). ADR 0033 : la
  // mise en relation est complète — nom, téléphone et adresse de l'étude.
  assert.deepEqual(own.notaire, {
    nom: NOTARY_CONTACT.nom, etude: 'Étude a@notaire.ca', telephone: NOTARY_CONTACT.telephone, adresse: NOTARY_CONTACT.adresse,
    courriel: 'a@notaire.ca', lienCNQ: null, actes: 0,
  });
  assert.equal(JSON.stringify(own).includes(notaryIdForEmail('a@notaire.ca')), false, 'the internal notaryId must never reach the client');

  // The losing notary's console lists nothing — no contact leak sideways.
  const listB = parse(await listNotaryBids(a, tokenB));
  assert.equal(listB.bids.length, 0);
  assert.equal(listB.retained.length, 0);
});

// --- Dossier "transmis autrement" (ADR 0010 §4) --------------------------------

test('a dossier value of DOSSIER_TRANSMIS satisfies a document request exactly like an upload', async () => {
  const a = app();
  const posted = parse(await postBid(a, { dossier: { adresse: '10 rue des Érables, Québec' } }));
  const token = await session(a, 'me@notaire.ca');

  // The notary asks for the lender's offer; the client already sent it through
  // the notary's own channel, so they mark it transmis autrement.
  await a.handle({
    method: 'POST', path: '/notary/bids/documents', headers: bearer(token),
    body: JSON.stringify({ id: posted.bid.id, dateISO: posted.bid.dateISO, documents: ['offre_preteur'] }),
  });
  const res = parse(await a.handle({
    method: 'POST', path: '/client/dossier', headers: bearer(posted.clientToken),
    body: JSON.stringify({
      id: posted.bid.id, dateISO: posted.bid.dateISO,
      dossier: { adresse: '10 rue des Érables, Québec', offre_preteur: domain.DOSSIER_TRANSMIS, __consent: true, __pricing: PRICING },
    }),
  }));

  // The demande is fournie — Nota does not insist on being the pipe, only on
  // the checklist being visibly complete.
  assert.equal(res.demandes[0].fournie, true, 'transmis autrement must count as provided');
  // And the readiness checklist counts it done too.
  assert.equal(res.readiness.missing.includes('Offre de financement du prêteur'), false);
  assert.equal(res.readiness.ready, true, 'required answers + consent -> ready (documents never gate)');
});
