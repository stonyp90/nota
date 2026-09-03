import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { signToken, notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000; // fixed wall clock for deterministic tokens

function app(seed = []) {
  let n = 0;
  const repo = createMemoryRepo(seed);
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n }),
    repo,
  };
}

const parse = (res) => JSON.parse(res.body);
// The zero-add refinancement answers: the dynamic base stays at the flat 2000 $.
const DEFAULT_PRICING = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};
const postBid = (a, obj) =>
  a.handle({ method: 'POST', path: '/bids', body: JSON.stringify({ pricing: DEFAULT_PRICING[obj.serviceId], prefixe: 'G1R', ...obj }) });

// Seed an ACTIVE subscription for this email so the sign-in gate passes.
async function seedActive(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', ...NOTARY_CONTACT });
}

// Sign in an ACTIVE notary through the passwordless request → verify handshake.
// Returns the full session body { token, feedToken, expiresAt }.
async function session(a, email) {
  await seedActive(a, email);
  return notarySignIn(a, email);
}

// Console calls carry the SESSION token in the Authorization header (not a URL).
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const listBids = (a, token, service) =>
  a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(token), query: { ...(service ? { service } : {}) } });
const accept = (a, token, id, dateISO) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id, dateISO }) });
const decline = (a, token, id, dateISO) =>
  a.handle({ method: 'POST', path: '/notary/bids/decline', headers: bearer(token), body: JSON.stringify({ id, dateISO }) });
const dossier = (a, token, id, dateISO) =>
  a.handle({ method: 'GET', path: '/notary/dossier', headers: bearer(token), query: { id, dateISO } });

// Canonical dossier shape (what the web app actually saves): item values at
// the top, pricing answers under __pricing, the consent flag as '1'. The API
// stores the CLEANED dossier (domain.cleanDossier), so only this shape
// round-trips to the retaining notary.
const SAMPLE_DOSSIER = { adresse: '10 rue des Érables, Québec', __pricing: { preteur: 'banque_nationale' }, __consent: '1' };

async function seedBid(a, over = {}) {
  const res = await postBid(a, {
    serviceId: 'refinancement',
    dateISO: '2026-08-20',
    montant: 2800,
    courriel: 'client@example.ca',
    dossier: SAMPLE_DOSSIER,
    ...over,
  });
  assert.equal(res.statusCode, 201);
  return parse(res).bid; // { id, dateISO, ... } public projection
}

// --- Fix 2: the subscription gate -------------------------------------------

test('a request for a notary WITHOUT an active subscription mints no usable link (no enumeration)', async () => {
  const a = app();
  const res = await a.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email: 'me@notaire.ca' }) });
  // Generic ok — the body never reveals that this address is not an active
  // notary — and crucially NO devToken, so no session can be forged from it.
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.equal(body.devToken, undefined);
});

test('the request → verify handshake issues session + feed tokens for an ACTIVE notary (200)', async () => {
  const a = app();
  await seedActive(a, 'me@notaire.ca');
  const body = await notarySignIn(a, 'me@notaire.ca');
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.includes('.'));
  assert.equal(typeof body.feedToken, 'string');
  assert.notEqual(body.token, body.feedToken); // distinct scopes -> distinct tokens
  assert.ok(Date.parse(body.expiresAt) > NOW_MS);
});

test('sign-in with NOTA_DEMO_OPEN=true bypasses the gate (200)', async () => {
  const a = app();
  const prev = process.env.NOTA_DEMO_OPEN;
  process.env.NOTA_DEMO_OPEN = 'true';
  try {
    const body = await notarySignIn(a, 'demo@notaire.ca');
    assert.equal(typeof body.token, 'string');
    assert.equal(typeof body.feedToken, 'string');
  } finally {
    if (prev === undefined) delete process.env.NOTA_DEMO_OPEN;
    else process.env.NOTA_DEMO_OPEN = prev;
  }
});

test('the request rejects a bad email before the gate (422)', async () => {
  const a = app();
  const res = await a.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email: 'nope' }) });
  assert.equal(res.statusCode, 422);
});

// --- Fix 3: header auth + token scopes --------------------------------------

test('GET /notary/bids requires a valid session token (invalid + expired -> 401)', async () => {
  const a = app();
  assert.equal((await listBids(a, 'garbage')).statusCode, 401);
  const expired = signToken('N-someone', NOW_MS - 1); // dev-fallback secret, past exp
  assert.equal((await listBids(a, expired)).statusCode, 401);
});

test('GET /notary/bids reads the token from the Authorization header (no query token)', async () => {
  const a = app();
  await seedBid(a);
  const { token } = await session(a, 'me@notaire.ca');
  const { bids } = parse(await listBids(a, token));
  assert.equal(bids.length, 1);
  assert.equal(bids[0].courriel, undefined);
  assert.equal(bids[0].dossier, undefined);
  assert.equal(typeof bids[0].ready, 'boolean');
  // The case-complexity signal is exposed to the notary (the default zero-add
  // refinancement answers weigh nothing = simple).
  assert.ok(bids[0].complexity && bids[0].complexity.level, 'complexity exposed to notary');
  assert.equal(bids[0].complexity.level, 'simple');
});

test('GET /notary/bids labels a hard file "complexe" with its factors', async () => {
  const a = app();
  // A refinancement in a succession with no bank approval is a hard file.
  await postBid(a, {
    serviceId: 'refinancement', dateISO: '2026-08-25', montant: 3000,
    pricing: { valeur_pret: 250000, succession: 'oui', approbation_bancaire: 'non', preteur: 'banque_nationale', deplacement: 'client_50' },
  });
  const { token } = await session(a, 'complexe@notaire.ca');
  const { bids } = parse(await listBids(a, token));
  const bid = bids.find((b) => b.serviceId === 'refinancement');
  assert.ok(bid, 'the refinancement bid is listed');
  assert.equal(bid.complexity.level, 'complexe'); // succession(2) + pas encore(2) = 4
  assert.ok(bid.complexity.factors.length >= 2, 'the hardening factors are named for the notary');
});

test('GET /notary/bids excludes bids this notary declined and supports ?service=', async () => {
  const a = app();
  const b1 = await seedBid(a, { dateISO: '2026-08-20' });
  const b2 = await seedBid(a, { dateISO: '2026-08-21', montant: 2900 });
  const { token } = await session(a, 'me@notaire.ca');

  // Decline b1 -> it drops from the list.
  assert.equal((await decline(a, token, b1.id, b1.dateISO)).statusCode, 200);
  let ids = parse(await listBids(a, token)).bids.map((b) => b.id);
  assert.deepEqual(ids, [b2.id]);

  // ?service filter matches the (one-act) catalogue; an unknown act filters everything out.
  ids = parse(await listBids(a, token, 'refinancement')).bids.map((b) => b.id);
  assert.deepEqual(ids, [b2.id]);
  assert.equal(parse(await listBids(a, token, 'testament')).bids.length, 0); // retired act: nothing listed
});

test('accept flips to retenue, releases the dossier, and is access-controlled', async () => {
  const a = app();
  const bid = await seedBid(a);
  const { token: tokenA } = await session(a, 'a@notaire.ca');
  const { token: tokenB } = await session(a, 'b@notaire.ca');

  // Notary A accepts and receives the released dossier + courriel.
  const acc = await accept(a, tokenA, bid.id, bid.dateISO);
  assert.equal(acc.statusCode, 200);
  const released = parse(acc);
  assert.equal(released.courriel, 'client@example.ca');
  assert.deepEqual(released.dossier, SAMPLE_DOSSIER);

  // Underlying bid is now retenue and no longer in the open feed.
  assert.equal(parse(await listBids(a, tokenA)).bids.length, 0);

  // Re-accept by the SAME notary is idempotent (returns the dossier again).
  const again = await accept(a, tokenA, bid.id, bid.dateISO);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(parse(again).dossier, SAMPLE_DOSSIER);

  // Another notary cannot steal it -> 409, and cannot read the dossier -> 403.
  assert.equal((await accept(a, tokenB, bid.id, bid.dateISO)).statusCode, 409);
  assert.equal((await dossier(a, tokenB, bid.id, bid.dateISO)).statusCode, 403);

  // The owning notary can fetch the dossier -> 200.
  const own = await dossier(a, tokenA, bid.id, bid.dateISO);
  assert.equal(own.statusCode, 200);
  assert.deepEqual(parse(own).dossier, SAMPLE_DOSSIER);
});

test('accept/decline also accept the session token in the POST body (fallback)', async () => {
  const a = app();
  const bid = await seedBid(a);
  const { token } = await session(a, 'a@notaire.ca');
  // No Authorization header — token in the body is the documented fallback.
  const acc = await a.handle({
    method: 'POST',
    path: '/notary/bids/accept',
    body: JSON.stringify({ token, id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(acc.statusCode, 200);
  assert.deepEqual(parse(acc).dossier, SAMPLE_DOSSIER);
});

test('a FEED-scoped token cannot list, accept, or read a dossier', async () => {
  const a = app();
  const bid = await seedBid(a);
  const { token, feedToken } = await session(a, 'a@notaire.ca');

  // Feed token is rejected on every session-scoped route (401).
  assert.equal((await listBids(a, feedToken)).statusCode, 401);
  assert.equal((await accept(a, feedToken, bid.id, bid.dateISO)).statusCode, 401);

  // Retain with the real session token so a dossier exists to guard.
  assert.equal((await accept(a, token, bid.id, bid.dateISO)).statusCode, 200);
  assert.equal((await dossier(a, feedToken, bid.id, bid.dateISO)).statusCode, 401);
});

test('GET /notary/feed.ics accepts ONLY a feed token and returns a VCALENDAR', async () => {
  const a = app();
  const bid = await seedBid(a);
  const { token, feedToken } = await session(a, 'a@notaire.ca');
  await accept(a, token, bid.id, bid.dateISO);

  // A session token is rejected on the feed route (wrong scope) -> 401.
  assert.equal((await a.handle({ method: 'GET', path: '/notary/feed.ics', query: { token } })).statusCode, 401);

  // The feed token works.
  const res = await a.handle({ method: 'GET', path: '/notary/feed.ics', query: { token: feedToken } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/calendar/);
  assert.match(res.body, /BEGIN:VCALENDAR/);
  assert.match(res.body, /Signature notari/);
  assert.ok(res.body.includes('UID:' + bid.id + '@nota'));
  assert.ok(res.body.includes('DTSTART;VALUE=DATE:20260820'));
});

test('the notary feed carries the decision details of the hydrated bid', async () => {
  const a = app();
  const bid = await seedBid(a, { nom: 'Marie Tremblay' });
  const { token, feedToken } = await session(a, 'a@notaire.ca');
  await accept(a, token, bid.id, bid.dateISO);

  const res = await a.handle({ method: 'GET', path: '/notary/feed.ics', query: { token: feedToken } });
  assert.equal(res.statusCode, 200);
  // Unfold (RFC 5545 §3.1) before matching: long lines are folded at 75 octets.
  const body = res.body.replace(/\r\n[ \t]/g, '');
  // Montant in the French SUMMARY, lender / déplacement / dossier state / client
  // in the DESCRIPTION — everything the retaining notary needs at a glance.
  assert.match(body, /SUMMARY:Signature notariée — Refinancement hypothécaire — 2\u{a0}800\u{a0}\$/u);
  assert.ok(body.includes('Prêteur : Banque Nationale'), 'missing the lender line');
  assert.ok(body.includes('LOCATION:À l’étude · ≤ 50 km'), 'missing the déplacement LOCATION');
  assert.ok(body.includes('Client : Marie Tremblay'), 'missing the client name');
  assert.ok(/Dossier (prêt|en préparation)/.test(body), 'missing the dossier readiness line');
  // The feed stays read-only: never the courriel, never the dossier content.
  assert.ok(!body.includes('client@example.ca'), 'feed leaked the client courriel');
  assert.ok(!body.includes('Érables'), 'feed leaked dossier content');
});

test('feed.ics and dossier reject an invalid token with 401', async () => {
  const a = app();
  assert.equal((await a.handle({ method: 'GET', path: '/notary/feed.ics', query: { token: 'x' } })).statusCode, 401);
  assert.equal((await dossier(a, 'x', 'id-1', '2026-08-20')).statusCode, 401);
});

test('GET /carnet/feed.ics is PUBLIC (no token) and never leaks private data', async () => {
  const a = app();
  const bid = await seedBid(a); // posts to 2026-08-20 with courriel client@example.ca

  // No token required — it is the public carnet, same data as GET /bids.
  const res = await a.handle({ method: 'GET', path: '/carnet/feed.ics', query: {} });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/calendar/);
  assert.match(res.body, /BEGIN:VCALENDAR/);
  assert.ok(res.body.includes('UID:' + bid.id + '@nota'), 'feed is missing the seeded offer');
  assert.ok(res.body.includes('DTSTART;VALUE=DATE:20260820'), 'feed has the wrong event date');
  assert.match(res.body, /SUMMARY:.*Refinancement/, 'feed SUMMARY should carry the domain service name');
  // The public feed MUST NEVER expose the client courriel or dossier.
  assert.ok(!res.body.includes('client@example.ca'), 'public feed leaked a courriel');
  assert.ok(!/Érables|Banque du Fleuve/.test(res.body), 'public feed leaked dossier content');
});

// --- Fix 4: conditional accept closes the TOCTOU race -----------------------

test('two concurrent accepts on one open bid -> exactly one 200, one 409, one notaryId', async () => {
  const a = app();
  const bid = await seedBid(a);
  const { token: tokenA } = await session(a, 'a@notaire.ca');
  const { token: tokenB } = await session(a, 'b@notaire.ca');

  const [ra, rb] = await Promise.all([
    accept(a, tokenA, bid.id, bid.dateISO),
    accept(a, tokenB, bid.id, bid.dateISO),
  ]);

  // Exactly one winner (200 with dossier) and one loser (409).
  assert.deepEqual([ra.statusCode, rb.statusCode].sort(), [200, 409]);
  const winner = ra.statusCode === 200 ? ra : rb;
  assert.deepEqual(parse(winner).dossier, SAMPLE_DOSSIER);

  // The stored bid is retenue with a SINGLE notaryId, and only that notary reads it.
  const stored = (await a.repo._all()).find((b) => b.id === bid.id);
  assert.equal(stored.status, 'retenue');
  const idA = notaryIdForEmail('a@notaire.ca');
  const idB = notaryIdForEmail('b@notaire.ca');
  assert.ok(stored.notaryId === idA || stored.notaryId === idB);
  const loserToken = stored.notaryId === idA ? tokenB : tokenA;
  assert.equal((await dossier(a, loserToken, bid.id, bid.dateISO)).statusCode, 403);
});

test('POST /bids stores a dossier privately and it NEVER leaks in GET /bids', async () => {
  const a = app();
  await seedBid(a);
  // Public list carries neither the dossier nor the courriel.
  const listed = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } })).bids[0];
  assert.equal(listed.dossier, undefined);
  assert.equal(listed.courriel, undefined);
  // But both are persisted privately on the raw item.
  const stored = (await a.repo._all())[0];
  assert.deepEqual(stored.dossier, SAMPLE_DOSSIER);
  assert.equal(stored.courriel, 'client@example.ca');
});
