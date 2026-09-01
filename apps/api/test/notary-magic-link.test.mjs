/**
 * Notary passwordless sign-in (magic link) — the security properties that close
 * the old bare-email token mint (admin.js:6-9). The console sign-in is now a
 * two-step handshake, mirroring the admin console:
 *   • /notary/session/request  — per-IP rate-limited, enumeration-safe; emails a
 *                                single-use link ONLY to an active notary.
 *   • /notary/session/verify   — atomically consumes the challenge and issues the
 *                                same stateless SESSION + FEED tokens as before.
 *
 * Harness mirrors notary.test.mjs: createApp over the memory repo with an
 * injected clock so challenge expiry is deterministic; outside production the
 * request echoes the challenge token so the flow completes with no mailbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { signToken, signChallengeToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth.js');

const TODAY = '2026-08-12';
const START = 1_760_000_000_000;

function harness(opts = {}) {
  let n = 0;
  const clock = { ms: START };
  const repo = createMemoryRepo();
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => clock.ms,
    newId: () => 'id-' + ++n,
    // Un hôte configuré : c'est la condition d'un lien cliquable, et la porte
    // refuse désormais d'en émettre un sans (configuration-liens.test.mjs).
    // Ces scénarios-ci portent sur l'énumération, l'écho et la limitation de
    // débit — pas sur la configuration.
    notaryConsoleUrl: 'https://nota.example',
    ...opts,
  });
  return { app, repo, clock };
}

const parse = (res) => JSON.parse(res.body);

async function seedActive(repo, email) {
  await repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active' });
}

const reqLink = (app, email, ip) =>
  app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }), sourceIp: ip });
const verify = (app, token) =>
  app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token }) });

// --- No account enumeration ---------------------------------------------------

test('the request never reveals whether an email is a notary (active, inactive, stranger all identical)', async () => {
  // Dev echo OFF so we compare the PRODUCTION-shaped bodies: the enumeration
  // guarantee is about what a real caller sees, not the dev-only token echo.
  const { app, repo } = harness({ notaryLoginDevEcho: false });
  await seedActive(repo, 'active@notaire.ca');
  await repo.putNotary({ id: notaryIdForEmail('pending@notaire.ca'), email: 'pending@notaire.ca', status: 'onboarding' });

  // Distinct IPs so the per-IP rate limit never colours the comparison.
  const a = parse(await reqLink(app, 'active@notaire.ca', '1.1.1.1'));
  const b = parse(await reqLink(app, 'pending@notaire.ca', '2.2.2.2'));
  const c = parse(await reqLink(app, 'stranger@nowhere.ca', '3.3.3.3'));
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
  assert.deepEqual(c, { ok: true });
});

// --- Single-use, expiry, forgery ---------------------------------------------

test('a magic link is single-use: the first verify issues a session, a replay is rejected', async () => {
  const { app, repo } = harness();
  await seedActive(repo, 'me@notaire.ca');
  const { devToken } = parse(await reqLink(app, 'me@notaire.ca', '9.9.9.9'));
  assert.ok(devToken, 'dev echo must carry the challenge token');

  const first = await verify(app, devToken);
  assert.equal(first.statusCode, 200);
  assert.ok(parse(first).token);

  const replay = await verify(app, devToken);
  assert.equal(replay.statusCode, 401, 'a redeemed link must not verify twice');
  assert.equal(parse(replay).errors[0].code, 'lien_invalide');
});

test('an expired challenge is rejected', async () => {
  const { app, repo, clock } = harness({ notaryChallengeTtlMs: 1000 });
  await seedActive(repo, 'me@notaire.ca');
  const { devToken } = parse(await reqLink(app, 'me@notaire.ca', '9.9.9.9'));
  clock.ms += 1001; // past the 1s challenge window (token exp AND record expiry)
  const res = await verify(app, devToken);
  assert.equal(res.statusCode, 401);
  assert.equal(parse(res).errors[0].code, 'lien_invalide');
});

test('a forged or tampered challenge token never verifies into a session', async () => {
  const { app, repo } = harness();
  await seedActive(repo, 'me@notaire.ca');
  const notaryId = notaryIdForEmail('me@notaire.ca');

  // A SESSION-scoped token (wrong scope) is not a challenge.
  const asSession = signToken(notaryId, START + 1e9, SCOPES.SESSION);
  assert.equal((await verify(app, asSession)).statusCode, 401);

  // A validly-SIGNED challenge whose cid was never stored (no server-side
  // record to consume) — signature alone is not enough.
  const ghost = signChallengeToken(notaryId, 'never-issued', START + 1e9);
  assert.equal((await verify(app, ghost)).statusCode, 401);

  // Garbage and a tampered token.
  assert.equal((await verify(app, 'not-a-token')).statusCode, 401);
  const real = parse(await reqLink(app, 'me@notaire.ca', '9.9.9.9')).devToken;
  const tampered = real.slice(0, -2) + (real.slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.equal((await verify(app, tampered)).statusCode, 401);
});

// --- Only an ACTIVE notary gets a usable link --------------------------------

test('a stranger request yields no usable link (dev echo carries nothing to redeem)', async () => {
  const { app } = harness(); // dev echo ON by default outside production
  const body = parse(await reqLink(app, 'stranger@nowhere.ca', '4.4.4.4'));
  assert.equal(body.ok, true);
  assert.equal(body.devToken, undefined, 'no challenge is minted for a non-notary');
  assert.equal(body.devLink, undefined);
});

// --- The issued session actually authorizes the console ----------------------

test('the SESSION token from verify authorizes POST /notary/bids/accept', async () => {
  const { app, repo } = harness();
  await seedActive(repo, 'me@notaire.ca');

  // A real open, retainable demand to accept.
  const bidRes = await app.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({
      serviceId: 'refinancement',
      dateISO: '2026-08-20',
      montant: 2800,
      courriel: 'client@example.ca',
      prefixe: 'G1R',
      dossier: { adresse: '10 rue des Érables', preteur: 'Banque du Fleuve', __consent: true },
      pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
    }),
  });
  assert.equal(bidRes.statusCode, 201, bidRes.body);
  const bid = parse(bidRes).bid;

  const { devToken } = parse(await reqLink(app, 'me@notaire.ca', '9.9.9.9'));
  const { token } = parse(await verify(app, devToken));

  const acc = await app.handle({
    method: 'POST',
    path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }),
  });
  assert.notEqual(acc.statusCode, 401, 'the session token must authorize the console');
  assert.equal(acc.statusCode, 200, acc.body);
});

// --- Per-IP rate limiting -----------------------------------------------------

test('the request is rate-limited per IP after the configured max', async () => {
  const { app, repo } = harness({ notaryLoginRlMax: 2 });
  await seedActive(repo, 'me@notaire.ca');
  assert.equal((await reqLink(app, 'me@notaire.ca', '5.5.5.5')).statusCode, 200);
  assert.equal((await reqLink(app, 'me@notaire.ca', '5.5.5.5')).statusCode, 200);
  const third = await reqLink(app, 'me@notaire.ca', '5.5.5.5');
  assert.equal(third.statusCode, 429);
  assert.equal(parse(third).throttled, true);
  // A different IP is unaffected — the counter is keyed on the source IP.
  assert.equal((await reqLink(app, 'me@notaire.ca', '6.6.6.6')).statusCode, 200);
});

// --- Dev echo: on outside production, NEVER in production ---------------------

test('the dev echo carries the link outside production but is absent under NODE_ENV=production', async () => {
  // Outside production (default here): the echo is present.
  const { app, repo } = harness();
  await seedActive(repo, 'me@notaire.ca');
  const dev = parse(await reqLink(app, 'me@notaire.ca', '7.7.7.7'));
  assert.ok(dev.devToken && dev.devLink, 'dev/test must echo the link');

  // Production: no echo whatsoever, even for an active notary. A configured
  // secret keeps token signing from failing closed.
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.NOTA_NOTARY_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.NOTA_NOTARY_SECRET = 'prod-secret-for-this-test';
  try {
    const { app: prodApp, repo: prodRepo } = harness();
    await seedActive(prodRepo, 'me@notaire.ca');
    const body = parse(await reqLink(prodApp, 'me@notaire.ca', '8.8.8.8'));
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
