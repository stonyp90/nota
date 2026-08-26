import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { signToken, verifyToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...opts }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
// Zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const PRICING = { refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' } };
const bearer = (token) => ({ authorization: 'Bearer ' + token });

async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude ' + email });
  return (await notarySignIn(a, email)).token;
}

async function seedBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement',
      dateISO: '2026-08-20',
      montant: 2800,
      courriel: 'client@example.ca',
      pricing: PRICING.refinancement,
      dossier: { adresse: '10 rue des Érables, Québec' },
      ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res); // { bid, clientToken }
}

const propose = (a, token, body) =>
  a.handle({ method: 'POST', path: '/notary/bids/propose', headers: bearer(token), body: JSON.stringify(body) });
const askDocs = (a, token, body) =>
  a.handle({ method: 'POST', path: '/notary/bids/documents', headers: bearer(token), body: JSON.stringify(body) });
const listBids = (a, token) => a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} });
const clientBid = (a, token, id, dateISO) =>
  a.handle({ method: 'GET', path: '/client/bid', headers: bearer(token), query: { id, dateISO } });
const clientPost = (a, token, path, body) =>
  a.handle({ method: 'POST', path, headers: bearer(token), body: JSON.stringify(body) });

// --- POST /bids issues a client token -----------------------------------------

test('POST /bids returns a client-scoped token bound to the bid, valid 400 days', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  assert.ok(clientToken, 'clientToken missing');
  const claims = verifyToken(clientToken, NOW_MS);
  assert.equal(claims.scope, SCOPES.CLIENT);
  assert.equal(claims.sub, bid.id);
  assert.equal(verifyToken(clientToken, NOW_MS + 399 * 86400 * 1000).sub, bid.id);
  assert.equal(verifyToken(clientToken, NOW_MS + 401 * 86400 * 1000), null);
  // The stored record starts with empty propositions/demandes.
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.deepEqual(stored.propositions, []);
  assert.deepEqual(stored.demandes, []);
  // Never echoed on the public list.
  const list = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }));
  assert.equal(JSON.stringify(list).includes(clientToken), false);
});

// --- POST /notary/bids/propose --------------------------------------------------

test('propose: a higher price is stored, projected to the notary, and emailed to the client', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const token = await session(a, 'me@notaire.ca');
  const res = await propose(a, token, { id: bid.id, dateISO: bid.dateISO, montant: 3400, message: '  Dossier complexe.  ' });
  assert.equal(res.statusCode, 200, res.body);
  const { proposition } = parse(res);
  assert.equal(proposition.montant, 3400);
  assert.equal(proposition.delta, 600);
  assert.equal(proposition.message, 'Dossier complexe.');
  assert.equal(proposition.status, 'en_attente');
  assert.equal(proposition.createdAt, TODAY);
  assert.equal('notaryId' in proposition, false);
  await flush();
  const mails = a.mailer.sent.filter((m) => m.to === 'client@example.ca');
  const m = mails.find((x) => x.subject.includes('propos'));
  assert.ok(m, 'client was not emailed: ' + JSON.stringify(a.mailer.sent.map((x) => x.subject)));
  assert.ok(m.html.includes(domain.money(3400)), 'email must show the proposed amount via money()');
  assert.ok(m.html.includes(BASE + '/#t=profil'), 'CTA must point at the profil link');
});

test('propose: 401 without a session token, 404 unknown bid, 409 retained, 422 domain errors', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const token = await session(a, 'me@notaire.ca');
  assert.equal((await propose(a, '', { id: bid.id, dateISO: bid.dateISO, montant: 3400 })).statusCode, 401);
  assert.equal((await propose(a, token, { id: 'nope', dateISO: bid.dateISO, montant: 3400 })).statusCode, 404);

  const low = await propose(a, token, { id: bid.id, dateISO: bid.dateISO, montant: 2500 });
  assert.equal(low.statusCode, 422);
  assert.ok(parse(low).errors.some((e) => e.code === 'proposition_inferieure'));

  const long = await propose(a, token, { id: bid.id, dateISO: bid.dateISO, montant: 3400, message: 'x'.repeat(501) });
  assert.equal(long.statusCode, 422);
  assert.ok(parse(long).errors.some((e) => e.code === 'message_trop_long'));

  const other = await session(a, 'other@notaire.ca');
  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(other), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  const taken = await propose(a, token, { id: bid.id, dateISO: bid.dateISO, montant: 3400 });
  assert.equal(taken.statusCode, 409);
  assert.equal(parse(taken).errors[0].code, 'deja_retenue');
});

test('propose: a new proposition by the same notary replaces the pending one; the body token fallback works', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const token = await session(a, 'me@notaire.ca');
  const first = parse(await propose(a, token, { id: bid.id, dateISO: bid.dateISO, montant: 3200 })).proposition;
  const res = await a.handle({ method: 'POST', path: '/notary/bids/propose', body: JSON.stringify({ token, id: bid.id, dateISO: bid.dateISO, montant: 3600 }) });
  assert.equal(res.statusCode, 200, res.body);
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.propositions.length, 2);
  assert.equal(stored.propositions.find((p) => p.id === first.id).status, 'remplacee');
  assert.equal(stored.propositions[1].status, 'en_attente');
});

// --- POST /notary/bids/documents ----------------------------------------------

test('documents: the request is stored, projected with fournie, and the client is emailed the list', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const token = await session(a, 'me@notaire.ca');
  const res = await askDocs(a, token, { id: bid.id, dateISO: bid.dateISO, documents: ['adresse', 'offre_preteur'], message: 'Merci.' });
  assert.equal(res.statusCode, 200, res.body);
  const { demande } = parse(res);
  assert.equal(demande.documents.length, 2);
  assert.equal(demande.documents[0].id, 'adresse');
  assert.ok(demande.documents[0].nom);
  assert.equal(demande.fournie, false); // offre_preteur missing in the dossier
  assert.equal(demande.message, 'Merci.');
  assert.equal('notaryId' in demande, false);
  await flush();
  const m = a.mailer.sent.find((x) => x.to === 'client@example.ca' && x.subject.includes('document'));
  assert.ok(m, 'client was not emailed the document list');
  assert.ok(m.html.includes(demande.documents[1].nom), 'email must list the requested items by name');
  assert.ok(m.html.includes(BASE + '/#dossier'));
});

test('documents: 422 on an unknown item or empty list; allowed for the retaining notary, 409 for another', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const token = await session(a, 'me@notaire.ca');
  const bad = await askDocs(a, token, { id: bid.id, dateISO: bid.dateISO, documents: ['inconnu'] });
  assert.equal(bad.statusCode, 422);
  assert.ok(parse(bad).errors.some((e) => e.code === 'document_inconnu'));
  const empty = await askDocs(a, token, { id: bid.id, dateISO: bid.dateISO, documents: [] });
  assert.equal(empty.statusCode, 422);
  assert.ok(parse(empty).errors.some((e) => e.code === 'documents_requis'));

  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  const mine = await askDocs(a, token, { id: bid.id, dateISO: bid.dateISO, documents: ['adresse'] });
  assert.equal(mine.statusCode, 200, mine.body);
  const other = await session(a, 'other@notaire.ca');
  const theirs = await askDocs(a, other, { id: bid.id, dateISO: bid.dateISO, documents: ['adresse'] });
  assert.equal(theirs.statusCode, 409);
});

// --- GET /notary/bids carries proposition / demande / missing / retained -------

test('GET /notary/bids: each bid carries this notary own proposition, demande and missing; other notaries stay hidden', async () => {
  const a = app();
  const { bid } = await seedBid(a);
  const me = await session(a, 'me@notaire.ca');
  const other = await session(a, 'other@notaire.ca');
  await propose(a, other, { id: bid.id, dateISO: bid.dateISO, montant: 4000 });
  const before = parse(await listBids(a, me)).bids[0];
  assert.equal(before.proposition, null);
  assert.equal(before.demande, null);
  assert.ok(Array.isArray(before.missing) && before.missing.length > 0);

  await propose(a, me, { id: bid.id, dateISO: bid.dateISO, montant: 3400 });
  await askDocs(a, me, { id: bid.id, dateISO: bid.dateISO, documents: ['adresse'] });
  const body = parse(await listBids(a, me));
  const b = body.bids[0];
  assert.equal(b.proposition.montant, 3400);
  assert.equal(b.proposition.status, 'en_attente');
  assert.equal(b.demande.documents[0].id, 'adresse');
  assert.equal(b.demande.fournie, true);
  assert.equal(JSON.stringify(body).includes('4000'), false, 'another notary proposition leaked');
  assert.deepEqual(body.retained, []);
});

// --- client endpoints -----------------------------------------------------------

test('GET /client/bid: the owner sees propositions (with etude, no notaryId), demandes and readiness', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const me = await session(a, 'me@notaire.ca');
  await propose(a, me, { id: bid.id, dateISO: bid.dateISO, montant: 3200 });
  await propose(a, me, { id: bid.id, dateISO: bid.dateISO, montant: 3400, message: 'Bonjour' });
  await askDocs(a, me, { id: bid.id, dateISO: bid.dateISO, documents: ['offre_preteur'] });

  const res = await clientBid(a, clientToken, bid.id, bid.dateISO);
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.bid.id, bid.id);
  assert.equal(body.propositions.length, 1, 'replaced propositions are hidden');
  assert.equal(body.propositions[0].montant, 3400);
  assert.equal(body.propositions[0].etude, 'Étude me@notaire.ca');
  assert.equal(body.propositions[0].message, 'Bonjour');
  assert.equal(JSON.stringify(body).includes(notaryIdForEmail('me@notaire.ca')), false, 'notaryId leaked to the client');
  assert.equal(body.demandes[0].fournie, false);
  assert.equal(body.demandes[0].etude, 'Étude me@notaire.ca');
  assert.equal(body.readiness.ready, false);
  assert.ok(body.readiness.missing.includes(body.demandes[0].documents[0].nom));
});

test('GET /client/bid: 401 without token, 403 for a token of another bid or a notary session, 404 unknown', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const { clientToken: otherToken } = await seedBid(a, { dateISO: '2026-08-21' });
  assert.equal((await clientBid(a, '', bid.id, bid.dateISO)).statusCode, 401);
  const forbidden = await clientBid(a, otherToken, bid.id, bid.dateISO);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(parse(forbidden).errors[0].code, 'interdit');
  const notary = await session(a, 'me@notaire.ca');
  assert.equal((await clientBid(a, notary, bid.id, bid.dateISO)).statusCode, 401);
  const spoof = signToken('nope', NOW_MS + 1000, SCOPES.CLIENT);
  assert.equal((await clientBid(a, spoof, 'nope', bid.dateISO)).statusCode, 404);
});

test('accept a proposition: the bid is retained by that notary at the new amount, others refused, emails fire', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const me = await session(a, 'me@notaire.ca');
  const other = await session(a, 'other@notaire.ca');
  const mine = parse(await propose(a, me, { id: bid.id, dateISO: bid.dateISO, montant: 3400 })).proposition;
  const theirs = parse(await propose(a, other, { id: bid.id, dateISO: bid.dateISO, montant: 3800 })).proposition;

  const res = await clientPost(a, clientToken, '/client/propositions/accept', { id: bid.id, dateISO: bid.dateISO, propositionId: mine.id });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.bid.status, 'retenue');
  assert.equal(body.bid.montant, 3400);
  assert.equal(body.bid.etude, 'Étude me@notaire.ca');
  assert.equal(body.proposition.status, 'acceptee');

  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.notaryId, notaryIdForEmail('me@notaire.ca'));
  assert.equal(stored.montant, 3400);
  assert.ok(Math.abs(stored.premium - 3400 / stored.basePrice) < 1e-9);
  assert.equal(stored.propositions.find((p) => p.id === theirs.id).status, 'refusee');
  assert.equal('paymentStatus' in stored, false, 'no billing: no paymentStatus');
  const retainedEvents = await a.repo.listRetainedByNotary(notaryIdForEmail('me@notaire.ca'));
  assert.equal(retainedEvents.length, 1);
  assert.equal(retainedEvents[0].montant, 3400);

  await flush();
  assert.ok(a.mailer.sent.some((m) => m.to === 'me@notaire.ca' && m.subject.includes('accept')), 'notary not told of acceptance');
  assert.ok(a.mailer.sent.some((m) => m.to === 'client@example.ca' && m.subject.includes('retenu')), 'client not told of retention');

  // The console learns about it through `retained` on GET /notary/bids.
  const list = parse(await listBids(a, me));
  assert.equal(list.bids.length, 0);
  assert.equal(list.retained.length, 1);
  assert.equal(list.retained[0].viaProposition, true);
  assert.equal(list.retained[0].montant, 3400);
  assert.equal(list.retained[0].courriel, 'client@example.ca');
  assert.deepEqual(list.retained[0].dossier, { adresse: '10 rue des Érables, Québec' });

  // A second accept is closed.
  const again = await clientPost(a, clientToken, '/client/propositions/accept', { id: bid.id, dateISO: bid.dateISO, propositionId: theirs.id });
  assert.equal(again.statusCode, 422);
  assert.equal(parse(again).errors[0].code, 'proposition_close');
  const missing = await clientPost(a, clientToken, '/client/propositions/accept', { id: bid.id, dateISO: bid.dateISO, propositionId: 'zzz' });
  assert.equal(missing.statusCode, 404);
  assert.equal(parse(missing).errors[0].code, 'proposition_introuvable');
});

test('accept a proposition with billing on: no capture, the bid is flagged a_reautoriser', async () => {
  const fakeBilling = {
    authorizeOffer: async () => ({ ok: true, url: BASE + '/checkout' }),
    payNotaryOnAccept: async () => { throw new Error('must not capture'); },
  };
  const b = app({ billing: fakeBilling, billingConfigured: true });
  const { bid, clientToken } = await seedBid(b);
  await b.repo.authorizeBid(bid.id, bid.dateISO, { paymentIntentId: 'pi_1', authorizedAt: TODAY });
  const me = await session(b, 'me@notaire.ca');
  const p = parse(await propose(b, me, { id: bid.id, dateISO: bid.dateISO, montant: 3400 })).proposition;
  const res = await clientPost(b, clientToken, '/client/propositions/accept', { id: bid.id, dateISO: bid.dateISO, propositionId: p.id });
  assert.equal(res.statusCode, 200, res.body);
  const after = await b.repo.get(bid.id, bid.dateISO);
  assert.equal(after.paymentStatus, 'a_reautoriser');
  assert.equal(after.status, 'retenue');
});

test('decline a proposition: status refusee, bid stays open, notary emailed', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const me = await session(a, 'me@notaire.ca');
  const p = parse(await propose(a, me, { id: bid.id, dateISO: bid.dateISO, montant: 3400 })).proposition;
  const res = await clientPost(a, clientToken, '/client/propositions/decline', { id: bid.id, dateISO: bid.dateISO, propositionId: p.id });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).proposition.status, 'refusee');
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.status, 'ouverte');
  assert.equal(stored.montant, 2800);
  await flush();
  assert.ok(a.mailer.sent.some((m) => m.to === 'me@notaire.ca' && m.subject.includes('déclin')), 'notary not told of refusal');
  // Declining twice is closed.
  const again = await clientPost(a, clientToken, '/client/propositions/decline', { id: bid.id, dateISO: bid.dateISO, propositionId: p.id });
  assert.equal(again.statusCode, 422);
});

test('POST /client/dossier replaces the dossier and answers with readiness + demandes', async () => {
  const a = app();
  const { bid, clientToken } = await seedBid(a);
  const me = await session(a, 'me@notaire.ca');
  await askDocs(a, me, { id: bid.id, dateISO: bid.dateISO, documents: ['offre_preteur'] });
  const bad = await clientPost(a, clientToken, '/client/dossier', { id: bid.id, dateISO: bid.dateISO, dossier: 'nope' });
  assert.equal(bad.statusCode, 422);
  assert.equal(parse(bad).errors[0].code, 'dossier_invalide');
  const res = await clientPost(a, clientToken, '/client/dossier', {
    id: bid.id,
    dateISO: bid.dateISO,
    dossier: { adresse: '10 rue des Érables, Québec', offre_preteur: 'offre-banque.pdf', __consent: true },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.demandes[0].fournie, true);
  assert.equal(typeof body.readiness.ready, 'boolean');
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.dossier.offre_preteur, 'offre-banque.pdf');
  // Another bid's token cannot write here.
  const { clientToken: otherToken } = await seedBid(a, { dateISO: '2026-08-22' });
  assert.equal((await clientPost(a, otherToken, '/client/dossier', { id: bid.id, dateISO: bid.dateISO, dossier: {} })).statusCode, 403);
});
