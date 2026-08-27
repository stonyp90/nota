// POST /notary/profile — the notary attaches (or clears) the link of their
// official fiche in the Chambre des notaires directory (ADR 0016). Clients see
// the membership as a badge on propositions (`cnq`), and the full link only on
// the retained notaire block — like `courriel`, never before the retention.
// /notary/bids hands the console its own `profil` and the commission it earns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
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
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);
const NOTARY = notaryIdForEmail('n@etude.ca');
const sessionToken = () => signToken(NOTARY, NOW_MS + 60_000, SCOPES.SESSION);
const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/123/';

const postProfile = (a, token, body) =>
  a.handle({ method: 'POST', path: '/notary/profile', headers: bearer(token), body: JSON.stringify(body) });

async function seedNotary(a, over = {}) {
  await a.repo.putNotary({
    id: NOTARY, email: 'n@etude.ca', label: 'Étude N',
    status: 'active', chargesEnabled: true, connectAccountId: 'acct_n',
    ...over,
  });
}

test('the notary stores their CNQ fiche; the console reads it back from /notary/bids', async () => {
  const a = app();
  await seedNotary(a, { ratingSum: 9, ratingCount: 2, commissionCentsCollected: 12345 });

  const res = await postProfile(a, sessionToken(), { lienCNQ: '  ' + FICHE + '  ' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).profil.lienCNQ, FICHE);

  // The write is a spread on the existing record — billing identity, rating
  // aggregates and accumulator all survive.
  const notary = await a.repo.getNotary(NOTARY);
  assert.equal(notary.lienCNQ, FICHE);
  assert.equal(notary.status, 'active');
  assert.equal(notary.ratingSum, 9);
  assert.equal(notary.commissionCentsCollected, 12345);

  const consoleView = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.equal(consoleView.profil.lienCNQ, FICHE);
});

test('only the Chambre’s host passes; an empty link clears the fiche; a session token is required', async () => {
  const a = app();
  await seedNotary(a, { lienCNQ: FICHE });

  const bad = await postProfile(a, sessionToken(), { lienCNQ: 'https://cnq.org.evil.ca/fiche' });
  assert.equal(bad.statusCode, 422);
  assert.equal(parse(bad).errors[0].code, 'lien_cnq_invalide');
  assert.equal((await a.repo.getNotary(NOTARY)).lienCNQ, FICHE, 'a refused link never overwrites the stored one');

  const cleared = await postProfile(a, sessionToken(), { lienCNQ: '' });
  assert.equal(cleared.statusCode, 200);
  assert.equal(parse(cleared).profil.lienCNQ, null);
  assert.equal((await a.repo.getNotary(NOTARY)).lienCNQ, null);

  const anon = await a.handle({ method: 'POST', path: '/notary/profile', body: JSON.stringify({ lienCNQ: FICHE }) });
  assert.equal(anon.statusCode, 401);
  const feed = await postProfile(a, signToken(NOTARY, NOW_MS + 60_000, SCOPES.FEED), { lienCNQ: FICHE });
  assert.equal(feed.statusCode, 401, 'a feed-scoped token never writes a profile');
});

test('clients see the badge on propositions and the link only once retained', async () => {
  const a = app();
  await seedNotary(a, { lienCNQ: FICHE });

  // An open bid with a proposition from the CNQ-linked notary: badge, no link.
  await a.repo.put({
    id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2800,
    status: domain.STATUS.OUVERTE, courriel: 'client@example.ca',
    propositions: [{ id: 'p1', notaryId: NOTARY, etude: 'Étude N', montant: 3200, delta: 400, status: 'en_attente', createdAt: TODAY }],
  });
  const open = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(open.propositions[0].cnq, true);
  assert.equal(JSON.stringify(open.propositions).includes('cnq.org'), false, 'the fiche URL must never ride an open bid');
  assert.equal(open.notaire, null);

  // Retained by that notary: the full link rides the contact block.
  await a.repo.update({ ...(await a.repo.get('b1', '2026-08-20')), status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude N' });
  const mine = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(mine.notaire.lienCNQ, FICHE);

  // A notary without a fiche: badge false, link null.
  await a.repo.putNotary({ ...(await a.repo.getNotary(NOTARY)), lienCNQ: null });
  const bare = parse(await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(clientToken('b1')), query: { id: 'b1', dateISO: '2026-08-20' } }));
  assert.equal(bare.notaire.lienCNQ, null);
});

test('/notary/bids names the commission the notary earns — and the next tier to reach', async () => {
  const billing = createBilling({ repo: createMemoryRepo(), stripe: {}, commissionRate: 0.10 });
  const a = app({ billing });
  await seedNotary(a, { ratingSum: 45, ratingCount: 10 }); // 4.5 over 10 avis → 9%

  const view = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.deepEqual(view.commission, {
    taux: 0.10, tauxEffectif: 0.09, bonus: 0.01,
    prochain: { note: 4.8, avis: 10, tauxEffectif: 0.08 },
  });
});

test('without billing configured the console gets no commission block (never a fake rate)', async () => {
  const a = app();
  await seedNotary(a);
  const view = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(sessionToken()), query: {} }));
  assert.equal(view.commission, null);
  assert.deepEqual(view.profil, { lienCNQ: null, rayonKm: 0, urgences: false });
});
