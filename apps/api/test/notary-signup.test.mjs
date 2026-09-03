// Notary supply-side onboarding without Stripe at the door (2026-09-02).
//
// Until now the ONLY way into the notary console was a finished Stripe Connect
// onboarding (`POST /notaries/connect` → hosted ID + bank form → webhook flips
// `status: 'active'` → the magic link). Asking a notary for a passport and a
// bank account before they have even seen the demand is the biggest churn
// wall on the supply side — and in production Stripe is not configured, so
// the wall had no door at all.
//
// The new sequence: sign up with a professional email (+ an optional CNQ
// fiche link) → the operator vets and activates from the admin console →
// the notary signs in and works → Stripe payout connect only when needed,
// before marking an act signed. This file covers the public side:
//   • POST /notaries/signup — the free, Stripe-less front door;
//   • the console gate opens on `approuveLe`, not on Stripe's `active`;
//   • an approved notary keeps console access through the WHOLE Stripe
//     onboarding, and settlement still refuses without `chargesEnabled`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createNotifier } = require('../src/notifications.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createBilling, NOTARY_STATUS } = require('../src/billing.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const domain = require('@nota/domain');
import { notarySignIn } from '../test-support/notary-session.mjs';

const TODAY = '2026-09-02';
const NOW_MS = Date.parse('2026-09-02T15:00:00.000Z');
const BASE = 'https://nota.example';
const ADMIN = 'https://admin.nota.example';
const OPERATOR = 'ops@nota.ca';
const NID = (email) => notaryIdForEmail(email);
const parse = (res) => JSON.parse(res.body);

function fakeStripe() {
  const calls = { accounts: [], links: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.accounts.push(args); return { accountId: 'acct_' + args.notaryId }; },
    async createOnboardingLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard/' + args.accountId }; },
    constructEvent(rawBody, signature) {
      if (!signature || signature === 'bad') throw new Error('signature verification failed');
      return JSON.parse(rawBody);
    },
  };
}

// No Stripe unless a test asks for it — EXACTLY the production of 2026-09-02.
function harness({ stripe = false, ...opts } = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: OPERATOR, adminUrl: ADMIN, now: () => TODAY });
  const stripeFake = stripe ? fakeStripe() : null;
  const billing = stripeFake ? createBilling({ repo, stripe: stripeFake, now: () => TODAY + 'T15:00:00.000Z' }) : undefined;
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => NOW_MS,
    newId: () => 'id-' + ++n,
    notifier,
    env: {},
    siteUrl: BASE,
    ...(billing ? { billing, billingConfigured: false } : {}),
    ...opts,
  });
  return { app, repo, mailer, stripe: stripeFake, billing };
}

const signup = (app, body, ip = '1.1.1.1') =>
  app.handle({ method: 'POST', path: '/notaries/signup', sourceIp: ip, body: JSON.stringify(body) });

const funnelTotal = async (repo, id) => {
  let total = 0;
  for (let s = 0; s < 10; s += 1) {
    for (const it of await repo.queryStats('STATS#GLOBAL#' + s, 'D#' + TODAY, 'D#' + TODAY)) total += Number(it['funnel_' + id] || 0);
  }
  return total;
};

// --- POST /notaries/signup ---------------------------------------------------

test('signup creates a pending notary from an email alone — no Stripe, 200 { ok }, gauge + funnel counted once', async () => {
  const { app, repo, mailer } = harness();
  const res = await signup(app, { email: ' Me.Roy@Etude.CA ', lienCNQ: 'https://www.cnq.org/trouver-un-notaire/roy', parrain: 'eve-roy' });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res), { ok: true });

  const n = await repo.getNotary(NID('me.roy@etude.ca'));
  assert.ok(n, 'a NOTARY# record keyed by notaryIdForEmail exists');
  assert.equal(n.email, 'me.roy@etude.ca');
  assert.equal(n.label, 'me.roy@etude.ca');
  assert.equal(n.role, 'notary');
  assert.equal(n.status, 'en_attente');
  assert.equal(n.inscritLe, new Date(NOW_MS).toISOString());
  assert.equal(n.createdAt, new Date(NOW_MS).toISOString());
  assert.equal(n.lienCNQ, 'https://www.cnq.org/trouver-un-notaire/roy');
  assert.equal(n.parrain, 'EVEROY', 'the referral code is normalized through the domain');
  assert.equal(n.approuveLe, undefined, 'nobody is approved by signing up');
  assert.equal(n.connectAccountId, undefined, 'no Stripe account was opened');

  // Analytics: the onboarding gauge and the notaire_inscrit funnel step, once.
  assert.equal((await repo.getGauge()).onboarding, 1);
  assert.equal(await funnelTotal(repo, 'notaire_inscrit'), 1);

  // Mail: the notary is told the vetting sequence (no Stripe mentioned); the
  // operator is pointed at the admin console's Notaires screen.
  await new Promise((r) => setTimeout(r, 10));
  const toNotary = mailer.sent.find((m) => m.to === 'me.roy@etude.ca');
  assert.ok(toNotary, 'the notary receives « Inscription reçue »');
  assert.match(toNotary.subject, /Inscription reçue/);
  assert.match(toNotary.text, /Tableau de l’Ordre/);
  assert.match(toNotary.text, /jour ouvrable/);
  assert.doesNotMatch(toNotary.text + toNotary.html, /Stripe/, 'no payout talk at the door');
  const toOps = mailer.sent.find((m) => m.to === OPERATOR);
  assert.ok(toOps, 'the operator is alerted');
  assert.match(toOps.text, /me\.roy@etude\.ca/);
  assert.match(toOps.text, /cnq\.org\/trouver-un-notaire\/roy/);
  assert.ok(toOps.html.includes(ADMIN + '/#/notaires'), 'the CTA opens the admin console on Notaires');
});

test('signup validates: a bad email is 422 courriel_invalide, a non-CNQ link is 422 lien_cnq_invalide, nothing written', async () => {
  const { app, repo } = harness();
  const bad = await signup(app, { email: 'not-an-email' });
  assert.equal(bad.statusCode, 422);
  assert.equal(parse(bad).errors[0].code, 'courriel_invalide');

  const link = await signup(app, { email: 'me@etude.ca', lienCNQ: 'https://example.com/roy' });
  assert.equal(link.statusCode, 422);
  assert.equal(parse(link).errors[0].code, 'lien_cnq_invalide');
  assert.equal(await repo.getNotary(NID('me@etude.ca')), null);
  assert.equal(await repo.getGauge(), null, 'no gauge moved');
});

test('signup is enumeration-safe and idempotent: an existing record only gains what it lacked, never a downgrade, never a second count', async () => {
  const { app, repo, mailer } = harness();
  await repo.putNotary({ id: NID('me@etude.ca'), email: 'me@etude.ca', status: 'active', approuveLe: '2026-08-01T00:00:00.000Z', parrain: 'FIRST' });
  const res = await signup(app, { email: 'me@etude.ca', lienCNQ: 'https://www.cnq.org/trouver-un-notaire/me', parrain: 'OTHER' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { ok: true }, 'same body as a brand-new signup');

  const n = await repo.getNotary(NID('me@etude.ca'));
  assert.equal(n.status, 'active', 'never downgraded');
  assert.equal(n.approuveLe, '2026-08-01T00:00:00.000Z');
  assert.equal(n.parrain, 'FIRST', 'first-touch attribution stands');
  assert.equal(n.lienCNQ, 'https://www.cnq.org/trouver-un-notaire/me', 'a missing fiche is filled in');
  assert.equal(n.inscritLe, undefined, 'an existing record is not re-stamped as a new signup');
  assert.equal(await repo.getGauge(), null, 'no gauge for an existing notary');
  assert.equal(await funnelTotal(repo, 'notaire_inscrit'), 0, 'the funnel counts first signups only');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(mailer.sent.length, 0, 'an already-approved notary is not told to wait for vetting');
});

test('a pending notary who signs up twice is counted and mailed once', async () => {
  const { app, repo, mailer } = harness();
  await signup(app, { email: 'me@etude.ca' }, '1.1.1.1');
  await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget mail land in the SENT ledger
  await signup(app, { email: 'me@etude.ca' }, '2.2.2.2');
  assert.equal((await repo.getGauge()).onboarding, 1);
  assert.equal(await funnelTotal(repo, 'notaire_inscrit'), 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(mailer.sent.filter((m) => m.to === 'me@etude.ca').length, 1);
  assert.equal(mailer.sent.filter((m) => m.to === OPERATOR).length, 1);
});

test('a self-referral is dropped; an invalid code never fails the signup', async () => {
  const { app, repo } = harness();
  await repo.createPartner({ code: 'EVEROY', type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', confirmedAt: '2026-08-01T00:00:00.000Z' });
  const self = await signup(app, { email: 'eve@courtage.ca', parrain: 'EVEROY' }, '1.1.1.1');
  assert.equal(self.statusCode, 200);
  assert.equal((await repo.getNotary(NID('eve@courtage.ca'))).parrain, null);

  const junk = await signup(app, { email: 'me@etude.ca', parrain: '!!' }, '2.2.2.2');
  assert.equal(junk.statusCode, 200);
  assert.equal((await repo.getNotary(NID('me@etude.ca'))).parrain, null);
});

test('signup is rate-limited per IP like the sign-in request', async () => {
  const { app } = harness();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await signup(app, { email: `n${i}@etude.ca` }, '9.9.9.9')).statusCode, 200);
  }
  const sixth = await signup(app, { email: 'n6@etude.ca' }, '9.9.9.9');
  assert.equal(sixth.statusCode, 429);
  assert.deepEqual(parse(sixth), { ok: true, throttled: true });
  // Another IP is untouched.
  assert.equal((await signup(app, { email: 'n7@etude.ca' }, '8.8.8.8')).statusCode, 200);
});

test('signup answers 400 on a malformed body', async () => {
  const { app } = harness();
  const res = await app.handle({ method: 'POST', path: '/notaries/signup', sourceIp: '1.1.1.1', body: '{not json' });
  assert.equal(res.statusCode, 400);
});

// --- The gate: approval, not Stripe ------------------------------------------

test('a pending notary cannot open the console; once approuveLe is stamped the magic link works', async () => {
  const { app, repo } = harness();
  await signup(app, { email: 'me@etude.ca' });
  const pending = await app.handle({ method: 'POST', path: '/notary/session/request', sourceIp: '1.1.1.1', body: JSON.stringify({ email: 'me@etude.ca' }) });
  assert.equal(pending.statusCode, 200, 'generic ack — never reveals the state');
  assert.equal(parse(pending).devToken, undefined, 'no challenge minted while pending');

  // The operator activates (the admin route is covered in admin-notaries.test.mjs).
  const n = await repo.getNotary(NID('me@etude.ca'));
  await repo.putNotary({ ...n, approuveLe: new Date(NOW_MS).toISOString(), status: 'active' });
  const session = await notarySignIn(app, 'me@etude.ca', { ip: '2.2.2.2' });
  assert.ok(session.token, 'the console opens on approval alone — no Stripe account exists');
  assert.equal((await repo.getNotary(NID('me@etude.ca'))).connectAccountId, undefined);
});

test('approuveLe alone opens the gate, whatever the Stripe status says', async () => {
  const { app, repo } = harness();
  // Approved while Stripe still calls them « onboarding » (they connected
  // payouts before the operator's click landed).
  await repo.putNotary({ id: NID('me@etude.ca'), email: 'me@etude.ca', status: NOTARY_STATUS.ONBOARDING, approuveLe: '2026-09-01T00:00:00.000Z', chargesEnabled: false });
  const session = await notarySignIn(app, 'me@etude.ca', { ip: '3.3.3.3' });
  assert.ok(session.token);
});

test('listActiveNotaries carries every approved notary, not only Stripe-active ones', async () => {
  const repo = createMemoryRepo([]);
  await repo.putNotary({ id: 'a', email: 'a@etude.ca', status: 'active' });
  await repo.putNotary({ id: 'b', email: 'b@etude.ca', status: 'en_attente', approuveLe: '2026-09-01T00:00:00.000Z' });
  await repo.putNotary({ id: 'c', email: 'c@etude.ca', status: 'en_attente' });
  await repo.putNotary({ id: 'd', email: 'd@etude.ca', status: NOTARY_STATUS.ONBOARDING, approuveLe: '2026-09-01T00:00:00.000Z' });
  const ids = (await repo.listActiveNotaries()).map((n) => n.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'd']);
});

// --- Console access survives the whole Stripe onboarding ---------------------

test('an approved notary keeps console access through the whole Stripe onboarding; settlement still waits for chargesEnabled', async () => {
  const { app, repo, stripe, billing } = harness({ stripe: true });
  const email = 'me@etude.ca';
  const id = NID(email);
  await signup(app, { email });
  await repo.putNotary({ ...(await repo.getNotary(id)), approuveLe: new Date(NOW_MS).toISOString(), status: 'active' });
  const gaugeBefore = { ...(await repo.getGauge()) };

  // 1. Connect payouts from the console: the record keeps its approved status.
  const connect = await app.handle({ method: 'POST', path: '/notaries/connect', body: JSON.stringify({ email }) });
  assert.equal(connect.statusCode, 200, connect.body);
  let n = await repo.getNotary(id);
  assert.equal(n.status, 'active', 'connecting payouts never demotes an approved notary to onboarding');
  assert.equal(n.approuveLe, new Date(NOW_MS).toISOString());
  assert.equal(n.connectAccountId, 'acct_' + id);
  assert.equal(n.chargesEnabled, false);
  assert.deepEqual(await repo.getGauge(), gaugeBefore, 'no onboarding delta for a notary already counted');
  assert.ok((await notarySignIn(app, email, { ip: '1.1.1.1' })).token, 'still signed in mid-onboarding');

  // 2. Stripe reports the account NOT chargeable yet: still active, still in.
  const notYet = { id: 'evt_1', type: 'account.updated', data: { object: { charges_enabled: false, metadata: { notaryId: id } } } };
  await app.handle({ method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' }, body: JSON.stringify(notYet) });
  n = await repo.getNotary(id);
  assert.equal(n.status, 'active', 'account.updated never moves an approved notary out of active');
  assert.equal(n.chargesEnabled, false);
  assert.deepEqual(await repo.getGauge(), gaugeBefore, 'the gauge does not swing on a charges toggle for an approved notary');
  const session = await notarySignIn(app, email, { ip: '2.2.2.2' });
  assert.ok(session.token, 'still signed in after a not-chargeable event');

  // 3. Settlement waits for payouts: the existing refusal stands.
  const bid = { id: 'b1', dateISO: '2026-09-20', serviceId: 'refinancement', montant: 2400, status: domain.STATUS.RETENUE, notaryId: id, courriel: 'client@example.ca' };
  await repo.put(bid);
  const complete = await app.handle({
    method: 'POST', path: '/notary/acts/complete',
    headers: { authorization: 'Bearer ' + session.token },
    body: JSON.stringify({ bidId: 'b1', dateISO: '2026-09-20', actAmount: 2400 }),
  });
  assert.equal(complete.statusCode, 422, complete.body);
  assert.equal(parse(complete).errors[0].code, 'compte_incomplet');

  // 4. Stripe clears the account: chargesEnabled flips, status untouched, gauge untouched.
  const ready = { id: 'evt_2', type: 'account.updated', data: { object: { charges_enabled: true, metadata: { notaryId: id } } } };
  await app.handle({ method: 'POST', path: '/stripe/webhook', headers: { 'stripe-signature': 'good' }, body: JSON.stringify(ready) });
  n = await repo.getNotary(id);
  assert.equal(n.status, 'active');
  assert.equal(n.chargesEnabled, true);
  assert.deepEqual(await repo.getGauge(), gaugeBefore, 'already active: no second active delta');
  assert.equal(stripe.calls.accounts.length, 1);
  assert.ok(billing, 'the real billing use-cases ran');
});

// --- POST /events — the funnel beacon ---------------------------------------

test('POST /events counts a catalogue step per day and answers 204; anything else is dropped with the same 204', async () => {
  const { app, repo } = harness();
  const post = (body, ip = '1.1.1.1') => app.handle({ method: 'POST', path: '/events', sourceIp: ip, body: typeof body === 'string' ? body : JSON.stringify(body) });
  let res = await post({ event: 'visite' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '', 'a 204 carries no body');
  assert.ok(res.headers['access-control-allow-origin'], 'CORS rides on the beacon response');
  res = await post({ event: 'visite' });
  assert.equal(res.statusCode, 204);
  res = await post({ event: 'jour_ouvert' });
  assert.equal(res.statusCode, 204);
  assert.equal(await funnelTotal(repo, 'visite'), 2);
  assert.equal(await funnelTotal(repo, 'jour_ouvert'), 1);

  // Not in the catalogue, wrong type, garbage body: all dropped, all 204.
  assert.equal((await post({ event: 'drop_table' })).statusCode, 204);
  assert.equal((await post({ event: 42 })).statusCode, 204);
  assert.equal((await post('not json')).statusCode, 204);
  assert.equal((await post({})).statusCode, 204);
  for (let s = 0; s < 10; s += 1) {
    for (const it of await repo.queryStats('STATS#GLOBAL#' + s, 'D#' + TODAY, 'D#' + TODAY)) {
      assert.equal(Object.keys(it).some((k) => /^funnel_(drop_table|42|undefined)$/.test(k)), false, 'no counter minted outside the catalogue');
    }
  }
});

test('POST /events is lightly rate-limited per IP', async () => {
  const { app, repo } = harness({ funnelRlMax: 3 });
  const post = (ip) => app.handle({ method: 'POST', path: '/events', sourceIp: ip, body: JSON.stringify({ event: 'visite' }) });
  for (let i = 0; i < 3; i += 1) assert.equal((await post('7.7.7.7')).statusCode, 204);
  const over = await post('7.7.7.7');
  assert.equal(over.statusCode, 429);
  assert.equal(await funnelTotal(repo, 'visite'), 3, 'the throttled beacon is not counted');
  assert.equal((await post('6.6.6.6')).statusCode, 204);
});

test('a published offer counts the « publie » step server-side — the client beacon is not trusted for it', async () => {
  const { app, repo } = harness();
  const res = await app.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2400, courriel: 'client@example.ca', prefixe: 'G1R',
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await funnelTotal(repo, 'publie'), 1);
  // A refused offer counts nothing.
  await app.handle({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-09-20', montant: 1 }) });
  assert.equal(await funnelTotal(repo, 'publie'), 1);
});
