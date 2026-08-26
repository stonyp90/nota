import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createBilling } = require('../src/billing.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
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
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' };
const bearer = (token) => ({ authorization: 'Bearer ' + token });

// --- registration -------------------------------------------------------------

test('POST /partenaires claims a code: normalized storage, 201 echo, welcome + operator mails', async () => {
  const a = app();
  const res = await register(a, { type: 'courtier_hypothecaire', courriel: 'Eve@Courtage.CA', code: 'eve-roy' });
  assert.equal(res.statusCode, 201, res.body);
  const { partenaire } = parse(res);
  assert.equal(partenaire.code, 'EVEROY', 'the code is stored NORMALIZED');
  assert.equal(partenaire.courriel, 'eve@courtage.ca', 'the courriel is lowercased');
  assert.equal(partenaire.type, 'courtier_hypothecaire');

  const stored = await a.repo.getPartner('everoy');
  assert.equal(stored.code, 'EVEROY');
  assert.equal(stored.createdAt, TODAY);

  await flush();
  const welcome = a.mailer.sent.find((m) => m.to === 'eve@courtage.ca');
  assert.ok(welcome, 'the partner gets their welcome mail');
  assert.ok(welcome.html.includes(BASE + '/?ref=EVEROY'), 'the welcome carries the shareable link');
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

test('POST /partenaires: a foreign claim on a taken code is 409; the owner re-claiming is idempotent 200', async () => {
  const a = app();
  assert.equal((await register(a, { type: 'agent_immobilier', courriel: 'eve@agence.ca', code: 'EVEROY' })).statusCode, 201);

  // Someone else wants the same code (even spelled differently): 409, nothing overwritten.
  const stolen = await register(a, { type: 'courtier_hypothecaire', courriel: 'pirate@x.ca', code: 'eve.roy' });
  assert.equal(stolen.statusCode, 409);
  assert.equal(parse(stolen).errors[0].code, 'code_deja_pris');
  assert.equal((await a.repo.getPartner('EVEROY')).courriel, 'eve@agence.ca');

  // The owner re-submitting (refresh, double-click): 200 with what is on file.
  const again = await register(a, { type: 'agent_immobilier', courriel: 'EVE@agence.ca', code: 'EVEROY' });
  assert.equal(again.statusCode, 200);
  assert.equal(parse(again).partenaire.code, 'EVEROY');

  // The welcome was sent at most once (SENT ledger), even after the re-claim.
  await flush();
  assert.equal(a.mailer.sent.filter((m) => m.to === 'eve@agence.ca').length, 1);
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

test('the notary session flow never exposes a stored parrain', async () => {
  const a = app();
  const id = notaryIdForEmail('me@notaire.ca');
  await a.repo.putNotary({ id, email: 'me@notaire.ca', status: 'active', parrain: 'EVEROY' });
  const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email: 'me@notaire.ca' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('EVEROY'), false, 'the session response leaked the referral code');
  // The upsert must not clobber the stored attribution either.
  assert.equal((await a.repo.getNotary(id)).parrain, 'EVEROY');
});

// --- self-referral (the industry-standard fraud check) --------------------------
// A partner's own booking or own signup never earns their code: attribution is
// dropped silently (the transaction itself always succeeds).

test('POST /bids drops a self-referral: the partner booking with their own code earns nothing', async () => {
  const a = app();
  await register(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      // Same person, different casing — the guard must match normalized emails.
      courriel: 'Eve@Courtage.CA', parrain: 'eve-roy', pricing: PRICING,
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
  await register(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
      courriel: 'client@example.ca', parrain: 'EVEROY', pricing: PRICING,
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
      parrain: 'GHOST1', pricing: PRICING,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  const bid = parse(res).bid;
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).parrain, 'GHOST1');
});

test('POST /notaries/connect drops a self-referral: a partner cannot refer themselves as a notary', async () => {
  const a = app();
  await register(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
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
      courriel: 'client@example.ca', pricing: PRICING, ...over,
    }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

async function session(a, email) {
  const existing = await a.repo.getNotary(notaryIdForEmail(email));
  await a.repo.putNotary({ ...(existing || {}), id: notaryIdForEmail(email), email, status: 'active' });
  const res = await a.handle({ method: 'POST', path: '/notary/session', body: JSON.stringify({ email }) });
  assert.equal(res.statusCode, 200, res.body);
  return parse(res).token;
}

test('a retained referred demand mails the REGISTERED partner exactly once (kind referral_client)', async () => {
  const a = app();
  await register(a, { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' });
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
  await register(a, { type: 'agent_immobilier', courriel: 'marc@agence.ca', code: 'MARCQC' });
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
