import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
// ADR 0033 — a notary may only retain with a reachable profile.
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
const { notaryIdForEmail } = require('../src/notary-auth.js');

// The retained-act conversation + the notary's post-acceptance withdrawal
// (désistement). Both live behind the retention: no thread before a notary
// holds the act, and only the holder can write or release.

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;

function app(seed = [], opts = {}) {
  let n = 0;
  const repo = createMemoryRepo(seed);
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, ...opts }),
    repo,
  };
}

// The same app, with the REAL notifier over a fake mailer — for the scenarios
// that assert who is told about a withdrawal.
function mailedApp() {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'tangerine', deplacement: 'client_50' };
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude Test', ...NOTARY_CONTACT });
  return notarySignIn(a, email);
}

async function postBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900,
      courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING, ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res); // { bid, clientToken }
}

const accept = (a, token, b) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });
const notarySend = (a, token, b, texte) =>
  a.handle({ method: 'POST', path: '/notary/bids/message', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });
const clientSend = (a, clientToken, b, texte) =>
  a.handle({ method: 'POST', path: '/client/bid/message', headers: bearer(clientToken), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });
const release = (a, token, b, message) =>
  a.handle({ method: 'POST', path: '/notary/bids/release', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, ...(message ? { message } : {}) }) });
const clientView = (a, clientToken, b) =>
  a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken), query: { id: b.id, dateISO: b.dateISO } });

// --- The lender reaches the notary feed --------------------------------------

test('GET /notary/bids names the lender (and its virtual flag) on every open bid', async () => {
  const a = app();
  await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  const res = await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} });
  assert.equal(res.statusCode, 200);
  const [b] = parse(res).bids;
  assert.deepEqual(b.preteur, { id: 'tangerine', nom: 'Tangerine', virtuel: true });
});

test('a bid that predates the lender question carries preteur: null (no crash)', async () => {
  const a = app();
  const { bid } = await postBid(a);
  // Simulate an old record: strip the lender answer in place.
  const stored = await a.repo.get(bid.id, bid.dateISO);
  await a.repo.update({ ...stored, pricing: { ...stored.pricing, preteur: undefined } });
  const { token } = await session(a, 'n1@notaire.ca');
  const res = await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} });
  assert.equal(parse(res).bids[0].preteur, null);
});

// --- The conversation --------------------------------------------------------

test('no thread before retention: both sides get 422 offre_non_retenue', async () => {
  const a = app();
  const { bid, clientToken } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  // The notary is not even the holder — the guard fires first (403).
  assert.equal((await notarySend(a, token, bid, 'Bonjour')).statusCode, 403);
  const rc = await clientSend(a, clientToken, bid, 'Bonjour');
  assert.equal(rc.statusCode, 422);
  assert.equal(parse(rc).errors[0].code, 'offre_non_retenue');
});

test('once retained, the holder and the client exchange messages both can read back', async () => {
  const a = app();
  const { bid, clientToken } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  assert.equal((await accept(a, token, bid)).statusCode, 200);

  const m1 = await notarySend(a, token, bid, '  Bonjour — votre prêteur est Tangerine : avez-vous déjà les instructions ?  ');
  assert.equal(m1.statusCode, 200);
  assert.equal(parse(m1).message.de, 'notaire');
  assert.equal(parse(m1).message.texte, 'Bonjour — votre prêteur est Tangerine : avez-vous déjà les instructions ?');

  const m2 = await clientSend(a, clientToken, bid, 'Oui, reçues hier.');
  assert.equal(m2.statusCode, 200);
  assert.equal(parse(m2).message.de, 'client');

  // The client reads the thread on their bid view…
  const cv = parse(await clientView(a, clientToken, bid));
  assert.deepEqual(cv.messages.map((m) => m.de), ['notaire', 'client']);
  // …and the notary reads it on their retained list and the dossier.
  const nb = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  assert.deepEqual(nb.retained[0].messages.map((m) => m.texte), [
    'Bonjour — votre prêteur est Tangerine : avez-vous déjà les instructions ?',
    'Oui, reçues hier.',
  ]);
  assert.deepEqual(nb.retained[0].preteur, { id: 'tangerine', nom: 'Tangerine', virtuel: true });
  const dossier = parse(await a.handle({ method: 'GET', path: '/notary/dossier', headers: bearer(token), query: { id: bid.id, dateISO: bid.dateISO } }));
  assert.equal(dossier.messages.length, 2);
});

test('only the RETAINING notary may write; empty and oversized messages are rejected', async () => {
  const a = app();
  const { bid, clientToken } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  await accept(a, token, bid);

  const { token: other } = await session(a, 'n2@notaire.ca');
  assert.equal((await notarySend(a, other, bid, 'Allo')).statusCode, 403);

  assert.equal((await notarySend(a, token, bid, '   ')).statusCode, 422);
  const long = await clientSend(a, clientToken, bid, 'x'.repeat(501));
  assert.equal(long.statusCode, 422);
  assert.equal(parse(long).errors[0].code, 'message_trop_long');
});

// --- The withdrawal (désistement) --------------------------------------------

test('the retaining notary can withdraw: the act returns to the market as posted', async () => {
  const a = app();
  const { bid, clientToken } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  await accept(a, token, bid);

  const res = await release(a, token, bid, 'Prêteur hors de mes habitudes.');
  assert.equal(res.statusCode, 200, res.body);
  const out = parse(res).bid;
  assert.equal(out.status, 'ouverte');
  // ART. 37 — le carnet public ne porte plus le nom de l'étude, ni quand une
  // offre est retenue ni quand elle est relâchée.
  assert.equal(out.etude, undefined);
  assert.equal(out.montant, 2900, 'the client’s offer is untouched');
  assert.equal(out.dateISO, '2026-08-20', 'the client keeps their date');

  // The withdrawing notary no longer sees the act in their open feed…
  const mine = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: {} }));
  assert.equal(mine.bids.length, 0);
  assert.equal(mine.retained.length, 0);
  // …their calendar pointer is gone…
  assert.equal((await a.repo.listRetainedByNotary(notaryIdForEmail('n1@notaire.ca'))).length, 0);
  // …but ANOTHER notary can retain it right away.
  const { token: other } = await session(a, 'n2@notaire.ca');
  const feed = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(other), query: {} }));
  assert.equal(feed.bids.length, 1);
  assert.equal((await accept(a, other, bid)).statusCode, 200);

  // The client sees the new holder, and the old thread stayed on the record.
  const cv = parse(await clientView(a, clientToken, bid));
  assert.equal(cv.bid.status, 'retenue');
});

test('release guards: only the holder, only while retained', async () => {
  const a = app();
  const { bid } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');

  // Not retained yet -> 422 offre_non_retenue.
  const open = await release(a, token, bid);
  assert.equal(open.statusCode, 422);
  assert.equal(parse(open).errors[0].code, 'offre_non_retenue');

  await accept(a, token, bid);
  const { token: other } = await session(a, 'n2@notaire.ca');
  assert.equal((await release(a, other, bid)).statusCode, 403);
  assert.equal((await release(a, 'garbage', bid)).statusCode, 401);

  // The real holder releases; a second release finds an open bid -> 422.
  assert.equal((await release(a, token, bid)).statusCode, 200);
  assert.equal((await release(a, token, bid)).statusCode, 422);
});

// --- ADR 0033: withdrawing is free, but counted — and the operator always knows

test('a release is free for the notary but COUNTED on their record (releasesCount)', async () => {
  const a = app();
  const id = notaryIdForEmail('n1@notaire.ca');
  const { token } = await session(a, 'n1@notaire.ca');

  const first = await postBid(a);
  await accept(a, token, first.bid);
  assert.equal((await release(a, token, first.bid)).statusCode, 200);
  assert.equal((await a.repo.getNotary(id)).releasesCount, 1);

  const second = await postBid(a, { dateISO: '2026-08-21' });
  await accept(a, token, second.bid);
  assert.equal((await release(a, token, second.bid, 'Conflit d’intérêts.')).statusCode, 200);
  assert.equal((await a.repo.getNotary(id)).releasesCount, 2);

  // A refused release (not the holder) counts nothing.
  const third = await postBid(a, { dateISO: '2026-08-22' });
  await accept(a, token, third.bid);
  const { token: other } = await session(a, 'n2@notaire.ca');
  assert.equal((await release(a, other, third.bid)).statusCode, 403);
  assert.equal((await a.repo.getNotary(id)).releasesCount, 2);
  assert.equal((await a.repo.getNotary(notaryIdForEmail('n2@notaire.ca'))).releasesCount, undefined);
});

test('a release ALWAYS alerts the operator — even with no payment in flight and no message', async () => {
  const a = mailedApp();
  const { bid } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  await accept(a, token, bid);
  a.mailer.sent.length = 0;

  // No hold on this bid (no billing configured), no motif given.
  assert.equal((await release(a, token, bid)).statusCode, 200);
  await flush();

  const ops = a.mailer.sent.find((m) => m.to === 'ops@nota.ca' && /désistement/i.test(m.subject));
  assert.ok(ops, 'operator was not told of the withdrawal: ' + JSON.stringify(a.mailer.sent.map((m) => [m.to, m.subject])));
  const client = a.mailer.sent.find((m) => m.to === 'client@example.ca');
  assert.ok(client, 'the client must be told their date is back on the market');
});
