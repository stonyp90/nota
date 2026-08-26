/**
 * Partner code claim — EMAIL VERIFICATION (ADR 0011, fraud-hardening). Claiming a
 * referral code is now a two-step, mailbox-proven handshake, mirroring the notary
 * magic link, closing two confirmed fraud vectors:
 *   • CODE SQUATTING — grabbing a real broker's obvious code before they register
 *     so their genuine referrals pay the squatter;
 *   • HARVEST-THEN-CLAIM — farming earnings on a vanity code, then claiming it to
 *     become the payee.
 * A claim is only PENDING until the emailed link is redeemed:
 *   • POST /partenaires        — per-IP rate-limited; mints a single-use challenge
 *                                and emails a confirmation link. No partner record.
 *   • POST /partenaires/verify — atomically consumes the challenge and only THEN
 *                                writes the confirmed partner (the payee of record).
 *
 * Harness mirrors partenaires.test.mjs / notary-magic-link.test.mjs: createApp
 * over the memory repo, an injected clock so challenge expiry is deterministic,
 * a fake mailer capturing every send, and the dev echo carrying the token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail, signToken, signChallengeToken, SCOPES } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { claimPartner } from '../test-support/partner-claim.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const START = 1_760_000_000_000;
const BASE = 'https://nota.example';
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' };

function app(opts = {}) {
  let n = 0;
  const clock = { ms: START };
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, {
      now: () => TODAY,
      nowMs: () => clock.ms,
      newId: () => 'id-' + ++n,
      notifier,
      billingConfigured: false,
      siteUrl: BASE,
      ...opts,
    }),
    repo,
    mailer,
    clock,
  };
}

const parse = (res) => JSON.parse(res.body);
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
const bearer = (token) => ({ authorization: 'Bearer ' + token });

const requestClaim = (a, body, ip) =>
  a.handle({ method: 'POST', path: '/partenaires', body: JSON.stringify(body), ...(ip ? { sourceIp: ip } : {}) });
const verifyClaim = (a, token) =>
  a.handle({ method: 'POST', path: '/partenaires/verify', body: JSON.stringify({ token }) });

const CLAIM = { type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'EVEROY' };

// --- The claim is not a partner until the link is redeemed -------------------

test('POST /partenaires only PENDS a claim: no partner record, no welcome mail yet', async () => {
  const a = app();
  const res = await requestClaim(a, CLAIM, '1.1.1.1');
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.ok(body.devToken, 'dev echo carries the verification token');
  // Nothing is a partner yet — the squatter's/owner's mere request writes no record.
  assert.equal(await a.repo.getPartner('EVEROY'), null, 'no partner record before verification');
  await flush();
  assert.equal(a.mailer.sent.filter((m) => m.to === 'eve@courtage.ca' && /partenaire est prêt|partner code is ready/i.test(m.subject)).length, 0, 'no welcome mail before verification');
  // The confirmation link WAS emailed (transactional).
  const link = a.mailer.sent.find((m) => m.to === 'eve@courtage.ca' && /Confirmez votre code|Confirm your partner code/i.test(m.subject));
  assert.ok(link, 'a confirmation link is emailed');
  assert.ok(link.html.includes('#pauth='), 'the link carries the challenge token in the hash');
});

test('POST /partenaires/verify writes the confirmed partner and sends the welcome + operator mails once', async () => {
  const a = app();
  const { devToken } = parse(await requestClaim(a, CLAIM, '1.1.1.1'));
  const res = await verifyClaim(a, devToken);
  assert.equal(res.statusCode, 201, res.body);
  const { partenaire } = parse(res);
  assert.equal(partenaire.code, 'EVEROY');
  assert.equal(partenaire.courriel, 'eve@courtage.ca');
  assert.ok(partenaire.confirmedAt, 'the confirmed record is stamped confirmedAt');

  const stored = await a.repo.getPartner('everoy');
  assert.equal(stored.code, 'EVEROY');
  assert.ok(stored.confirmedAt, 'the stored partner is explicitly confirmed');

  await flush();
  const welcome = a.mailer.sent.filter((m) => m.to === 'eve@courtage.ca' && m.html.includes(BASE + '/?ref=EVEROY'));
  assert.equal(welcome.length, 1, 'exactly one welcome, carrying the shareable link');
  const ops = a.mailer.sent.filter((m) => m.to === 'ops@nota.ca' && m.subject.includes('EVEROY'));
  assert.equal(ops.length, 1, 'the operator is alerted exactly once');
});

// --- Single-use, expiry, forgery ---------------------------------------------

test('the verification link is single-use: the first verify confirms, a replay is rejected', async () => {
  const a = app();
  const { devToken } = parse(await requestClaim(a, CLAIM, '9.9.9.9'));
  assert.equal((await verifyClaim(a, devToken)).statusCode, 201);
  const replay = await verifyClaim(a, devToken);
  assert.equal(replay.statusCode, 401, 'a redeemed link must not verify twice');
  assert.equal(parse(replay).errors[0].code, 'lien_invalide');
});

test('an expired claim challenge is rejected', async () => {
  const a = app({ partnerClaimTtlMs: 1000 });
  const { devToken } = parse(await requestClaim(a, CLAIM, '9.9.9.9'));
  a.clock.ms += 1001; // past the 1s window (token exp AND record expiry)
  const res = await verifyClaim(a, devToken);
  assert.equal(res.statusCode, 401);
  assert.equal(parse(res).errors[0].code, 'lien_invalide');
  assert.equal(await a.repo.getPartner('EVEROY'), null, 'an expired claim never becomes a partner');
});

test('a forged or tampered token never verifies into a confirmed partner', async () => {
  const a = app();
  // A SESSION-scoped token (wrong scope) is not a challenge.
  const asSession = signToken('EVEROY', START + 1e9, SCOPES.SESSION);
  assert.equal((await verifyClaim(a, asSession)).statusCode, 401);
  // A validly-SIGNED challenge whose cid was never stored (no record to consume).
  const ghost = signChallengeToken('EVEROY', 'never-issued', START + 1e9);
  assert.equal((await verifyClaim(a, ghost)).statusCode, 401);
  // Garbage and a tampered token.
  assert.equal((await verifyClaim(a, 'not-a-token')).statusCode, 401);
  const real = parse(await requestClaim(a, CLAIM, '9.9.9.9')).devToken;
  const tampered = real.slice(0, -2) + (real.slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.equal((await verifyClaim(a, tampered)).statusCode, 401);
  assert.equal(await a.repo.getPartner('EVEROY'), null, 'no forged path writes a partner');
});

// --- CODE SQUATTING: an unverified claim is inert -----------------------------

test("a squatter's UNCONFIRMED claim never becomes the payee and never blocks the true owner", async () => {
  const a = app();
  // The squatter requests SILVIA but never opens the link.
  const squat = await requestClaim(a, { type: 'agent_immobilier', courriel: 'squatter@evil.ca', code: 'SILVIA' }, '6.6.6.6');
  assert.equal(squat.statusCode, 200);
  assert.equal(await a.repo.getPartner('SILVIA'), null, 'a mere request owns nothing');

  // The genuine broker later claims the SAME code and DOES verify — first verify
  // wins, so the real owner is not permanently blocked.
  const partner = await claimPartner(a, { type: 'courtier_hypothecaire', courriel: 'silvia@courtage.ca', code: 'SILVIA' }, { ip: '7.7.7.7' });
  assert.equal(partner.courriel, 'silvia@courtage.ca', 'the verifying owner wins the code');

  // A referred demand retained now pays the REAL owner, never the squatter.
  const bidRes = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'client@example.ca', parrain: 'SILVIA', pricing: PRICING }),
  });
  const bid = parse(bidRes).bid;
  const id = notaryIdForEmail('me@notaire.ca');
  await a.repo.putNotary({ id, email: 'me@notaire.ca', status: 'active' });
  const token = (await notarySignIn(a, 'me@notaire.ca')).token;
  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  await flush();

  const squatterRewards = a.mailer.sent.filter((m) => m.to === 'squatter@evil.ca' && m.subject.includes(domain.money(domain.REFERRAL.client)));
  assert.equal(squatterRewards.length, 0, 'the squatter is never paid');
  const reward = a.mailer.sent.filter((m) => m.to === 'silvia@courtage.ca' && m.subject.includes(domain.money(domain.REFERRAL.client)));
  assert.equal(reward.length, 1, 'the verified owner is the payee of record');

  // The admin ledger shows only the confirmed owner as the identity.
  const overview = await createAnalytics({ repo: a.repo, now: () => TODAY }).overview();
  const row = overview.parrainages.codes.find((c) => c.code === 'SILVIA');
  assert.equal(row.courriel, 'silvia@courtage.ca', 'the ledger binds the confirmed owner only');
});

test('an UNCONFIRMED claim is never shown as the owner in the admin ledger, even after it earns', async () => {
  const a = app();
  // A vanity code accrues a raw earning (harvest) but was only ever a pending
  // claim — never confirmed. The derived earning may exist; the identity may not.
  await requestClaim(a, { type: 'agent_immobilier', courriel: 'harvester@evil.ca', code: 'VANITY7' }, '6.6.6.6');
  const bidRes = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'client@example.ca', parrain: 'VANITY7', pricing: PRICING }),
  });
  const bid = parse(bidRes).bid;
  const id = notaryIdForEmail('me@notaire.ca');
  await a.repo.putNotary({ id, email: 'me@notaire.ca', status: 'active' });
  const token = (await notarySignIn(a, 'me@notaire.ca')).token;
  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  await flush();

  assert.equal(a.mailer.sent.filter((m) => m.to === 'harvester@evil.ca' && m.subject.includes(domain.money(domain.REFERRAL.client))).length, 0, 'a pending claim receives no reward mail');
  const overview = await createAnalytics({ repo: a.repo, now: () => TODAY }).overview();
  const row = overview.parrainages.codes.find((c) => c.code === 'VANITY7');
  assert.ok(row, 'the raw earning is still derived from the carnet');
  assert.equal(row.courriel, null, 'but no identity is bound to an unconfirmed claim');
  assert.equal(row.type, null);
});

// --- Enumeration honesty on an already-confirmed code -------------------------

test('a foreign claim on a CONFIRMED code is 409; the owner re-requesting is idempotent 200', async () => {
  const a = app();
  await claimPartner(a, { type: 'agent_immobilier', courriel: 'eve@agence.ca', code: 'EVEROY' }, { ip: '1.1.1.1' });

  // Someone else wants the same code (even spelled differently): 409, nothing overwritten.
  const stolen = await requestClaim(a, { type: 'courtier_hypothecaire', courriel: 'pirate@x.ca', code: 'eve.roy' }, '2.2.2.2');
  assert.equal(stolen.statusCode, 409);
  assert.equal(parse(stolen).errors[0].code, 'code_deja_pris');
  assert.equal((await a.repo.getPartner('EVEROY')).courriel, 'eve@agence.ca');

  // The owner re-visiting their own confirmed code: idempotent 200, no re-verify.
  const again = await requestClaim(a, { type: 'agent_immobilier', courriel: 'EVE@agence.ca', code: 'EVEROY' }, '3.3.3.3');
  assert.equal(again.statusCode, 200);
  assert.equal(parse(again).confirmed, true);
  assert.equal(parse(again).partenaire.code, 'EVEROY');
});

test('a FREE code and a merely-PENDING code are indistinguishable (both get the generic ok)', async () => {
  // The whole enumeration guarantee: only a CONFIRMED code (409) leaks. A code
  // nobody has touched and a code with an outstanding pending claim look the same.
  const a = app();
  const free = parse(await requestClaim(a, { type: 'agent_immobilier', courriel: 'a@b.ca', code: 'FRESH1' }, '4.4.4.4'));
  const pendingFirst = await requestClaim(a, { type: 'agent_immobilier', courriel: 'first@b.ca', code: 'SHARED1' }, '5.5.5.5');
  const pendingSecond = parse(await requestClaim(a, { type: 'courtier_hypothecaire', courriel: 'second@b.ca', code: 'SHARED1' }, '6.6.6.6'));
  assert.equal(free.ok, true);
  assert.equal(pendingSecond.ok, true, 'a second claimant on a pending code sees the same generic ok');
  assert.equal(pendingFirst.statusCode, 200);
});

// --- HARVEST-THEN-CLAIM: first verify wins the write-once code ----------------

test('two pending claims race: whoever VERIFIES first becomes the payee; the loser is 409', async () => {
  const a = app();
  const first = parse(await requestClaim(a, { type: 'agent_immobilier', courriel: 'first@b.ca', code: 'SHARED1' }, '1.1.1.1'));
  const second = parse(await requestClaim(a, { type: 'courtier_hypothecaire', courriel: 'second@b.ca', code: 'SHARED1' }, '2.2.2.2'));

  assert.equal((await verifyClaim(a, first.devToken)).statusCode, 201, 'the first to verify wins the code');
  assert.equal((await a.repo.getPartner('SHARED1')).courriel, 'first@b.ca');

  const loser = await verifyClaim(a, second.devToken);
  assert.equal(loser.statusCode, 409, 'the code is taken by the first verifier');
  assert.equal(parse(loser).errors[0].code, 'code_deja_pris');
  assert.equal((await a.repo.getPartner('SHARED1')).courriel, 'first@b.ca', 'the loser never overwrites the owner');
});

// --- Per-IP rate limiting -----------------------------------------------------

test('the claim request is rate-limited per IP after the configured max', async () => {
  const a = app({ partnerClaimRlMax: 2 });
  assert.equal((await requestClaim(a, { ...CLAIM, code: 'AAAA11' }, '5.5.5.5')).statusCode, 200);
  assert.equal((await requestClaim(a, { ...CLAIM, code: 'BBBB22' }, '5.5.5.5')).statusCode, 200);
  const third = await requestClaim(a, { ...CLAIM, code: 'CCCC33' }, '5.5.5.5');
  assert.equal(third.statusCode, 429);
  assert.equal(parse(third).throttled, true);
  // A different IP is unaffected — the counter is keyed on the source IP.
  assert.equal((await requestClaim(a, { ...CLAIM, code: 'DDDD44' }, '6.6.6.6')).statusCode, 200);
});

// --- Validation is unchanged (a bad code never costs anything) ----------------

test('POST /partenaires still returns typed 422 errors, and stores nothing', async () => {
  const a = app();
  const bad = await requestClaim(a, { type: 'plombier', courriel: 'nope', code: 'x' }, '1.1.1.1');
  assert.equal(bad.statusCode, 422);
  const codes = parse(bad).errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['code_invalide', 'courriel_invalide', 'type_inconnu']);
  assert.equal(await a.repo.getPartner('X'), null, 'nothing stored on a rejected request');
});

// --- Dev echo: on outside production, NEVER in production ---------------------

test('the dev echo carries the token outside production but is absent under NODE_ENV=production', async () => {
  // Outside production (default here): the echo is present.
  const a = app();
  const dev = parse(await requestClaim(a, CLAIM, '7.7.7.7'));
  assert.ok(dev.devToken && dev.devLink, 'dev/test must echo the link');

  // Production: no echo whatsoever. A configured secret keeps signing from
  // failing closed.
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.NOTA_NOTARY_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.NOTA_NOTARY_SECRET = 'prod-secret-for-this-test';
  try {
    const prod = app();
    const body = parse(await requestClaim(prod, CLAIM, '8.8.8.8'));
    assert.equal(body.ok, true);
    assert.equal(body.devToken, undefined, 'production must NEVER echo the token');
    assert.equal(body.devLink, undefined);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.NOTA_NOTARY_SECRET;
    else process.env.NOTA_NOTARY_SECRET = prevSecret;
  }
});
