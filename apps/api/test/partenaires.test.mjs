import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
import { claimPartner } from '../test-support/partner-claim.mjs';
const domain = require('@nota/domain');

// POST /partenaires — the referral program's self-serve front door (ADR 0011) —
// plus the notary side of attribution (a parrain on the signup) and the reward
// notifications the retain path fires.

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';

// Minimal fake Stripe for the /notaries/connect signup path (same surface as
// billing.test.mjs's fake, trimmed to what connectNotary touches).
function fakeStripe() {
  return {
    async createConnectAccount({ notaryId }) { return { accountId: 'acct_' + notaryId }; },
    async createOnboardingLink({ accountId }) { return { url: 'https://connect.stripe.test/onboard/' + accountId }; },
    constructEvent(raw) { return JSON.parse(raw); },
  };
}

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  return {
    ...createApp(repo, {
      now: () => TODAY,
      nowMs: () => NOW_MS,
      newId: () => 'id-' + ++n,
      notifier,
      billing,
      // Billing is injected ONLY so /notaries/connect works; keep the
      // pre-billing offer flow (offers live immediately), like the BDD world.
      billingConfigured: false,
      ...opts,
    }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
const register = (a, body) =>
  a.handle({ method: 'POST', path: '/partenaires', body: JSON.stringify(body) });
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };
const bearer = (token) => ({ authorization: 'Bearer ' + token });

// --- registration -------------------------------------------------------------

test('claiming a code is email-verified: request pends, verify confirms with normalized storage + welcome/operator mails', async () => {
  const a = app();
  // Step 1 — the request only PENDS: nothing is stored, no welcome yet.
  const req = await register(a, { type: 'courtier_hypothecaire', courriel: 'Eve@Courtage.CA', code: 'eve-roy' });
  assert.equal(req.statusCode, 200, req.body);
  const { devToken, ttlMinutes } = parse(req);
  assert.ok(devToken, 'the dev echo carries the verification token');
  // The pane tells the partner how long the emailed link lives — from the API,
  // never a guessed number (audit 2026-09-02, P1-6).
  assert.equal(ttlMinutes, 30, 'the claim answer carries the link lifetime in minutes');
  assert.equal(await a.repo.getPartner('everoy'), null, 'no partner record before verification');

  // Step 2 — verify writes the confirmed partner (normalized) and echoes it.
  const res = await a.handle({ method: 'POST', path: '/partenaires/verify', body: JSON.stringify({ token: devToken }) });
  assert.equal(res.statusCode, 201, res.body);
  const { partenaire } = parse(res);
  assert.equal(partenaire.code, 'EVEROY', 'the code is stored NORMALIZED');
  assert.equal(partenaire.courriel, 'eve@courtage.ca', 'the courriel is lowercased');
  assert.equal(partenaire.type, 'courtier_hypothecaire');

  const stored = await a.repo.getPartner('everoy');
  assert.equal(stored.code, 'EVEROY');
  assert.equal(stored.createdAt, TODAY);
  assert.ok(stored.confirmedAt, 'the stored partner is explicitly confirmed');

  await flush();
  const welcome = a.mailer.sent.find((m) => m.to === 'eve@courtage.ca' && m.html.includes(BASE + '/?ref=EVEROY'));
  assert.ok(welcome, 'the partner gets their welcome mail, carrying the shareable link');
  const ops = a.mailer.sent.find((m) => m.to === 'ops@nota.ca');
  assert.ok(ops, 'the operator is alerted');
  assert.ok(ops.subject.includes('EVEROY'));
});

test('POST /partenaires: each typed validation error (type_inconnu, courriel_invalide, code_invalide)', async () => {
  const a = app();
  const bad = await register(a, { type: 'plombier', courriel: 'nope', code: 'x' });
  assert.equal(bad.statusCode, 422);
  const codes = parse(bad).errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['code_invalide', 'courriel_invalide', 'type_inconnu']);
  assert.equal(await a.repo.getPartner('X'), null, 'nothing stored on a rejected registration');

  // Each error also fires alone.
  assert.ok(parse(await register(a, { type: 'agent_immobilier', courriel: 'a@b.ca', code: '???' })).errors.some((e) => e.code === 'code_invalide'));
  assert.ok(parse(await register(a, { type: 'agent_immobilier', courriel: 'no', code: 'GOODCODE' })).errors.some((e) => e.code === 'courriel_invalide'));
  assert.ok(parse(await register(a, { type: 'nope', courriel: 'a@b.ca', code: 'GOODCODE' })).errors.some((e) => e.code === 'type_inconnu'));
});

test('a foreign claim on a CONFIRMED code is 409; the owner re-requesting is idempotent 200', async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'eve@agence.ca', code: 'EVEROY' }, { ip: '1.1.1.1' });

  // Someone else wants the same code (even spelled differently): 409, nothing overwritten.
  const stolen = await register(a, { type: 'courtier_hypothecaire', courriel: 'pirate@x.ca', code: 'eve.roy' });
  assert.equal(stolen.statusCode, 409);
  assert.equal(parse(stolen).errors[0].code, 'code_deja_pris');
  assert.equal((await a.repo.getPartner('EVEROY')).courriel, 'eve@agence.ca');

  // The owner re-requesting their own confirmed code (refresh, double-click):
  // idempotent 200 with what is on file — no second verification needed.
  const again = await register(a, { type: 'agent_immobilier', courriel: 'EVE@agence.ca', code: 'EVEROY' });
  assert.equal(again.statusCode, 200);
  assert.equal(parse(again).confirmed, true);
  assert.equal(parse(again).partenaire.code, 'EVEROY');

  // The welcome (kind partnerWelcome) was sent at most once (SENT ledger), even
  // after the re-request — the confirmation link is a separate transactional mail.
  await flush();
  assert.equal(a.mailer.sent.filter((m) => m.to === 'eve@agence.ca' && m.html.includes(BASE + '/?ref=EVEROY')).length, 1);
});

// --- notary referral attribution (signup) --------------------------------------

test('POST /notaries/connect stores a valid parrain on the notary record, normalized and private', async () => {
  const a = app();
  const res = await a.handle({
    method: 'POST', path: '/notaries/connect',
    body: JSON.stringify({ email: 'new@notaire.ca', parrain: 'eve-roy' }),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.body.includes('parrain'), false, 'the connect response never echoes the code');
  assert.equal(res.body.includes('EVEROY'), false);
  const notary = await a.repo.getNotary(notaryIdForEmail('new@notaire.ca'));
  assert.equal(notary.parrain, 'EVEROY');
});

test('POST /notaries/connect silently drops an invalid parrain — signup never fails over a broken link', async () => {
  const a = app();
  const res = await a.handle({
    method: 'POST', path: '/notaries/connect',
    body: JSON.stringify({ email: 'new@notaire.ca', parrain: '???' }),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await a.repo.getNotary(notaryIdForEmail('new@notaire.ca'))).parrain, null);
});

test('the notary sign-in flow never exposes a stored parrain', async () => {
  const a = app();
  const id = notaryIdForEmail('me@notaire.ca');
  await a.repo.putNotary({ id, email: 'me@notaire.ca', status: 'active', parrain: 'EVEROY' });
  const body = await notarySignIn(a, 'me@notaire.ca');
  assert.equal(JSON.stringify(body).includes('EVEROY'), false, 'the session response leaked the referral code');
  // The upsert must not clobber the stored attribution either.
  assert.equal((await a.repo.getNotary(id)).parrain, 'EVEROY');
});

// --- self-referral (the industry-standard fraud check) --------------------------
// A partner's own booking or own signup never earns their code: attribution is
// dropped silently (the transaction itself always succeeds).

test('POST /bids drops a self-referral: the partner booking with their own code earns nothing', async () => {
  const a = app();
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      // Same person, different casing — the guard must match normalized emails.
      courriel: 'Eve@Courtage.CA', parrain: 'eve-roy', pricing: PRICING, prefixe: 'G1R',
    }),
  });
  assert.equal(res.statusCode, 201, 'the booking itself always succeeds: ' + res.body);
  const bid = parse(res).bid;
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.parrain, null, 'no attribution on a self-referral');
  assert.equal(stored.courriel, 'eve@courtage.ca', 'the booking is otherwise intact');
});

test("POST /bids keeps the attribution when the booker is NOT the code's owner", async () => {
  const a = app();
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      courriel: 'client@example.ca', parrain: 'EVEROY', pricing: PRICING, prefixe: 'G1R',
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const bid = parse(res).bid;
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).parrain, 'EVEROY');
});

test('POST /bids: an anonymous booking (no courriel) with an UNREGISTERED code keeps the attribution', async () => {
  // Without a courriel there is nothing to compare — the guard must not
  // become an accidental "registered codes only" filter.
  const a = app();
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      parrain: 'GHOST1', pricing: PRICING, prefixe: 'G1R',
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const bid = parse(res).bid;
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).parrain, 'GHOST1');
});

test('POST /notaries/connect drops a self-referral: a partner cannot refer themselves as a notary', async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
  const res = await a.handle({
    method: 'POST', path: '/notaries/connect',
    body: JSON.stringify({ email: 'Marc@Agence.CA', parrain: 'MARCQC' }),
  });
  assert.equal(res.statusCode, 200, 'the signup itself always succeeds: ' + res.body);
  assert.equal((await a.repo.getNotary(notaryIdForEmail('Marc@Agence.CA'))).parrain, null);
});

// --- reward notifications on retention -----------------------------------------

async function seedRetainable(a, over = {}) {
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING, ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

async function session(a, email) {
  const existing = await a.repo.getNotary(notaryIdForEmail(email));
  await a.repo.putNotary({ ...(existing || {}), id: notaryIdForEmail(email), email, status: 'active', ...NOTARY_CONTACT });
  return (await notarySignIn(a, email)).token;
}

test('a retained referred demand mails the REGISTERED partner exactly once (kind referral_client)', async () => {
  const a = app();
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const bid = await seedRetainable(a, { parrain: 'EVEROY' });
  const token = await session(a, 'me@notaire.ca');

  const accept = () =>
    a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal((await accept()).statusCode, 200);
  await flush();

  const rewards = a.mailer.sent.filter((m) => m.to === 'eve@courtage.ca' && m.subject.includes(domain.money(domain.REFERRAL.client)));
  assert.equal(rewards.length, 1, 'exactly one client-reward mail');

  // An idempotent re-accept never re-sends (SENT ledger on (bid id, referral_client)).
  assert.equal((await accept()).statusCode, 200);
  await flush();
  assert.equal(
    a.mailer.sent.filter((m) => m.to === 'eve@courtage.ca' && m.subject.includes(domain.money(domain.REFERRAL.client))).length,
    1
  );
});

test('an UNREGISTERED parrain earns silently: no reward mail goes anywhere', async () => {
  const a = app();
  const bid = await seedRetainable(a, { parrain: 'GHOST1' }); // valid code, never registered
  const token = await session(a, 'me@notaire.ca');
  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  await flush();
  assert.equal(
    a.mailer.sent.filter((m) => m.subject.includes(domain.money(domain.REFERRAL.client))).length,
    0,
    'no registered courriel -> nowhere to send the reward'
  );
});

test('a referred notary retaining their FIRST act mails the partner once ever (kind referral_notaire)', async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
  // The notary signed up through a MARCQC link; the code sits privately on the profile.
  const id = notaryIdForEmail('ref@notaire.ca');
  await a.repo.putNotary({ id, email: 'ref@notaire.ca', status: 'active', parrain: 'MARCQC' });
  const token = await session(a, 'ref@notaire.ca');

  const b1 = await seedRetainable(a, {});
  const b2 = await seedRetainable(a, { dateISO: '2026-08-21' });
  const accept = (b) =>
    a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });

  assert.equal((await accept(b1)).statusCode, 200);
  await flush();
  const notaryRewards = () =>
    a.mailer.sent.filter((m) => m.to === 'marc@agence.ca' && m.subject.includes(domain.money(domain.REFERRAL.notaire)));
  assert.equal(notaryRewards().length, 1, 'the first retained act pays the partner');

  // A SECOND retained act never re-pays: (notary id, referral_notaire) is once ever.
  assert.equal((await accept(b2)).statusCode, 200);
  await flush();
  assert.equal(notaryRewards().length, 1, 'once per referred notary, ever');
});

// --- durable ledger: the money owed never evaporates ---------------------------
// The admin ledger claims ALL-TIME totals, but the live walk only sees the
// forward month window. Earnings are therefore recorded durably at EVENT time
// (the retain), so a signing date scrolling out of the window can never shrink
// what is due (monotonicity). These read the same overview the console renders.

const overviewAt = (a, day) => createAnalytics({ repo: a.repo, now: () => day }).overview();
const rowFor = (o, code) => o.parrainages.codes.find((c) => c.code === code);

test('a retained referred demand still owes 50 $ once its date is far outside the 4-month window', async () => {
  const a = app();
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const bid = await seedRetainable(a, { parrain: 'EVEROY' });
  const token = await session(a, 'me@notaire.ca');
  const res = await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);

  // Months later the signing (2026-08-20) is invisible to the live window —
  // the durable ledger must still owe the partner their client reward.
  const row = rowFor(await overviewAt(a, '2027-03-01'), 'EVEROY');
  assert.ok(row, 'the code keeps its ledger row after the window scrolls past');
  assert.equal(row.retenues, 1, 'the all-time retained count is monotonic');
  assert.equal(row.du, domain.REFERRAL.client);
  assert.equal(row.courriel, 'eve@courtage.ca', 'the registry join still identifies who to pay');
});

test("a referred notary's long-past first retained act still owes 250 $ (durable premierActe)", async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
  const id = notaryIdForEmail('ref@notaire.ca');
  await a.repo.putNotary({ id, email: 'ref@notaire.ca', status: 'active', parrain: 'MARCQC' });
  const token = await session(a, 'ref@notaire.ca');
  const b1 = await seedRetainable(a, {});
  const res = await a.handle({
    method: 'POST', path: '/notary/bids/accept', headers: bearer(token),
    body: JSON.stringify({ id: b1.id, dateISO: b1.dateISO }),
  });
  assert.equal(res.statusCode, 200, res.body);

  // The first-retained-act fact is stamped durably on the notary record...
  const profile = await a.repo.getNotary(id);
  assert.equal(profile.premierActe, true, 'the first retained act is marked on the profile');
  assert.ok(profile.premierActeAt, 'with the moment it happened');

  // ...so the notaire reward survives long after the act left the window.
  const row = rowFor(await overviewAt(a, '2027-03-01'), 'MARCQC');
  assert.ok(row, 'the code keeps its ledger row');
  assert.equal(row.notairesActifs, 1);
  assert.equal(row.du, domain.REFERRAL.notaire);
});

test('replaying the accept never double-counts the durable earnings', async () => {
  const a = app();
  await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  // The retaining notary is ALSO referred by the same partner — both tracks fire.
  const id = notaryIdForEmail('ref@notaire.ca');
  await a.repo.putNotary({ id, email: 'ref@notaire.ca', status: 'active', parrain: 'EVEROY' });
  const token = await session(a, 'ref@notaire.ca');
  const bid = await seedRetainable(a, { parrain: 'EVEROY' });
  const accept = () =>
    a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal((await accept()).statusCode, 200);
  // A double-submit by the same notary is idempotent at the HTTP layer — and
  // must be idempotent in the money ledger too.
  assert.equal((await accept()).statusCode, 200);

  const row = rowFor(await overviewAt(a, '2027-03-01'), 'EVEROY');
  assert.equal(row.retenues, 1, 'the client earning is counted once per bid');
  assert.equal(row.notairesActifs, 1, 'the notaire earning is counted once per notary, ever');
  assert.equal(row.du, domain.REFERRAL.client + domain.REFERRAL.notaire);
});

test('a freshly registered partner with ZERO referrals is visible in the ledger (du 0)', async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'zoe@agence.ca', code: 'ZOEQC' });
  const row = rowFor(await overviewAt(a, TODAY), 'ZOEQC');
  assert.ok(row, 'a claimed code appears even before any referral');
  assert.deepEqual(row, {
    code: 'ZOEQC', demandes: 0, retenues: 0, completes: 0, notaires: 0, notairesActifs: 0, du: 0,
    type: 'agent_immobilier', courriel: 'zoe@agence.ca',
    typeNom: 'Agent immobilier', typeNomEn: 'Real-estate agent',
  });
});
