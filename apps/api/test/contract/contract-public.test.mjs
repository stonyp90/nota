import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Contract tests: drive the REAL in-memory app to produce actual responses,
// then assert each response body validates against the OpenAPI schema declared
// for that path/method/status. A renamed field, a changed status code, a
// removed route or a reshaped body fails here — before it ships. No network,
// no DynamoDB: the same createApp harness the rest of apps/api/test uses.

const require = createRequire(import.meta.url);
const { createApp } = require('../../src/handler.js');
const { createMemoryRepo } = require('../../src/repo-memory.js');
const { createNotifier } = require('../../src/notifications.js');
const { createFakeMailer } = require('../../src/notify-port.js');
const { createBilling } = require('../../src/billing.js');
const { notaryIdForEmail } = require('../../src/notary-auth.js');
const { loadContract, specPath } = require('./openapi-contract.js');
import { notarySignIn } from '../../test-support/notary-session.mjs';

const contract = loadContract(specPath('openapi.yaml'));

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000; // fixed wall clock for deterministic tokens
const BASE = 'https://nota.example';

// The zero-add refinancement: the dynamic floor stays at the flat 2 000 $.
const DEFAULT_PRICING = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

// Minimal fake Stripe, so the Connect/webhook/act routes are DRIVABLE in the
// routing sweep instead of throwing "secretKey is required" (same surface as
// billing.test.mjs's fake, trimmed to what the driven routes touch).
function fakeStripe() {
  return {
    async createConnectAccount({ notaryId }) { return { accountId: 'acct_' + notaryId }; },
    async createOnboardingLink({ accountId }) { return { url: 'https://connect.stripe.test/onboard/' + accountId }; },
    constructEvent(raw, sig) { if (!sig) throw new Error('signature verification failed'); return JSON.parse(raw); },
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
      // Billing is injected ONLY so the Connect/act routes are reachable in the
      // sweep; the offer flow stays pre-billing (offers live immediately).
      billingConfigured: false,
      ...opts,
    }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });

// Assert a response body validates against the spec's schema for that
// path/method/status. Fails loudly when the spec has NO schema (drift point 4:
// never silently pass) unless the caller opts into `allowNoSchema`.
function assertValid(routePath, method, status, body, { allowNoSchema = false } = {}) {
  const v = contract.validatorForResponse(routePath, method, status);
  if (v.error) {
    if (allowNoSchema && v.error === 'no-json-schema') return;
    assert.fail(
      `no JSON schema in openapi.yaml for ${method} ${routePath} -> ${status} (${v.error}` +
        (v.contentTypes ? ` [${v.contentTypes.join(', ')}]` : '') + ')',
    );
  }
  const ok = v.validate(body);
  assert.ok(
    ok,
    `${method} ${routePath} -> ${status} body drifted from its OpenAPI schema:\n` +
      JSON.stringify(v.validate.errors, null, 2) + '\nbody: ' + JSON.stringify(body),
  );
}

const postBid = (a, obj) =>
  a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ pricing: DEFAULT_PRICING[obj.serviceId], ...obj }),
  });

async function seedActive(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active' });
}
async function session(a, email) {
  await seedActive(a, email);
  return notarySignIn(a, email);
}

// --- POST /bids : 201 success + 422 error ------------------------------------

test('POST /bids — 201 created shape validates', async () => {
  const a = app();
  const res = await postBid(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, courriel: 'client@example.ca' });
  assert.equal(res.statusCode, 201, res.body);
  const body = parse(res);
  assert.ok(body.clientToken, 'the per-bid client token is returned once');
  assertValid('/bids', 'POST', 201, body);
});

test('POST /bids — 422 validation-error envelope validates', async () => {
  const a = app();
  // Under the 2 000 $ floor -> domain rejects with `sous_prix_depart`.
  const res = await postBid(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 1 });
  assert.equal(res.statusCode, 422, res.body);
  const body = parse(res);
  assert.ok(Array.isArray(body.errors) && body.errors[0].code && body.errors[0].message, 'error envelope shape');
  assertValid('/bids', 'POST', 422, body);
});

// --- GET /bids : the carnet listing ------------------------------------------

test('GET /bids — 200 carnet listing validates (with a live bid in the month)', async () => {
  const a = app();
  await postBid(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400 });
  const res = await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.month, '2026-08');
  assert.ok(body.bids.length >= 1, 'the seeded bid is listed');
  assertValid('/bids', 'GET', 200, body);
});

// --- Notary passwordless sign-in : request (200) + verify (200) --------------

test('POST /notary/session/request + /verify — both 200 shapes validate', async () => {
  const a = app();
  await seedActive(a, 'notaire@etude.ca');
  const req = await a.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email: 'notaire@etude.ca' }) });
  assert.equal(req.statusCode, 200, req.body);
  const reqBody = parse(req);
  assertValid('/notary/session/request', 'POST', 200, reqBody);

  const ver = await a.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: reqBody.devToken }) });
  assert.equal(ver.statusCode, 200, ver.body);
  assertValid('/notary/session/verify', 'POST', 200, parse(ver));
});

// --- Partner code claim : request (200) + verify (201) -----------------------

test('POST /partenaires + /partenaires/verify — 200 request and 201 confirmed shapes validate', async () => {
  const a = app();
  const req = await a.handle({
    method: 'POST',
    path: '/partenaires',
    body: JSON.stringify({ type: 'courtier_hypothecaire', courriel: 'eve@courtage.ca', code: 'eve-roy' }),
  });
  assert.equal(req.statusCode, 200, req.body);
  const reqBody = parse(req);
  assertValid('/partenaires', 'POST', 200, reqBody);

  const ver = await a.handle({ method: 'POST', path: '/partenaires/verify', body: JSON.stringify({ token: reqBody.devToken }) });
  assert.equal(ver.statusCode, 201, ver.body);
  const verBody = parse(ver);
  assert.equal(verBody.partenaire.code, 'EVEROY', 'code stored normalized');
  assertValid('/partenaires/verify', 'POST', 201, verBody);
});

// --- POST /notary/bids/accept : 200 retained + 409 already-retained ----------

test('POST /notary/bids/accept — 200 released dossier + 409 already-retained shapes validate', async () => {
  const a = app();
  const sess = await session(a, 'first@etude.ca');
  const posted = parse(await postBid(a, {
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
    courriel: 'client@example.ca', dossier: { adresse: '10 rue X', __consent: true },
  }));
  const bid = posted.bid;

  const ok = await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(sess.token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(ok.statusCode, 200, ok.body);
  const okBody = parse(ok);
  assert.equal(okBody.client.courriel, 'client@example.ca', 'the mise en relation contact is released');
  assertValid('/notary/bids/accept', 'POST', 200, okBody);

  // A SECOND notary accepting the now-retained bid -> 409 deja_retenue.
  const other = await session(a, 'second@etude.ca');
  const conflict = await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(other.token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(conflict.statusCode, 409, conflict.body);
  const conflictBody = parse(conflict);
  assert.equal(conflictBody.errors[0].code, 'deja_retenue');
  assertValid('/notary/bids/accept', 'POST', 409, conflictBody);
});

// --- The error envelope { errors: [{ code, message }] } across the API -------

test('the shared error envelope validates on a 401 (Unauthorized $ref response)', async () => {
  const a = app();
  // No Authorization header on a notary-guarded route -> 401 non_autorise.
  const res = await a.handle({ method: 'GET', path: '/notary/bids', query: {} });
  assert.equal(res.statusCode, 401, res.body);
  const body = parse(res);
  assert.equal(body.errors[0].code, 'non_autorise');
  assertValid('/notary/bids', 'GET', 401, body);
});

// --- The retained-act thread + the notary withdrawal -------------------------

test('chat + release — message, client view (with thread) and released bid shapes validate', async () => {
  const a = app();
  const posted = parse(await postBid(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, courriel: 'client@example.ca' }));
  const { token } = await session(a, 'chat@notaire.ca');
  const ref = { id: posted.bid.id, dateISO: posted.bid.dateISO };
  await a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify(ref) });

  const sent = await a.handle({ method: 'POST', path: '/notary/bids/message', headers: bearer(token), body: JSON.stringify({ ...ref, texte: 'Bonjour !' }) });
  assert.equal(sent.statusCode, 200, sent.body);
  assertValid('/notary/bids/message', 'POST', 200, parse(sent));

  const answered = await a.handle({ method: 'POST', path: '/client/bid/message', headers: bearer(posted.clientToken), body: JSON.stringify({ ...ref, texte: 'Bonjour, merci.' }) });
  assert.equal(answered.statusCode, 200, answered.body);
  assertValid('/client/bid/message', 'POST', 200, parse(answered));

  const view = await a.handle({ method: 'GET', path: '/client/bid', headers: bearer(posted.clientToken), query: ref });
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(parse(view).messages.length, 2);
  assertValid('/client/bid', 'GET', 200, parse(view));

  const released = await a.handle({ method: 'POST', path: '/notary/bids/release', headers: bearer(token), body: JSON.stringify({ ...ref, message: 'Prêteur hors de mes habitudes.' }) });
  assert.equal(released.statusCode, 200, released.body);
  assertValid('/notary/bids/release', 'POST', 200, parse(released));

  // Released while open -> the domain's offre_non_retenue in the shared envelope.
  const again = await a.handle({ method: 'POST', path: '/notary/bids/release', headers: bearer(token), body: JSON.stringify(ref) });
  assert.equal(again.statusCode, 422);
  assertValid('/notary/bids/release', 'POST', 422, parse(again));
});

// --- Drift sweep : every documented path is actually ROUTED ------------------

test('every path documented in openapi.yaml is routed by the app (no "route inconnue" fall-through)', async () => {
  const a = app();
  // Seed a session so notary routes are reached past the auth gate where cheap;
  // the sweep only needs to prove the ROUTE matches, not that the call succeeds.
  for (const { path: routePath, method } of contract.documentedRoutes()) {
    const res = await a.handle({ method, path: routePath, query: {}, body: '{}' });
    // The generic fall-through is the ONLY 404 whose message is "Route inconnue.".
    let msg = null;
    try { msg = JSON.parse(res.body).errors?.[0]?.message ?? null; } catch { /* html/non-JSON body */ }
    assert.notEqual(
      msg, 'Route inconnue.',
      `documented ${method} ${routePath} is NOT routed by the app (hit the generic 404 fall-through)`,
    );
  }
});

// --- Drift flag : routed-but-undocumented routes -----------------------------

// Parsed straight from the handler source so a NEW route added there without a
// matching openapi.yaml entry trips this test. These four are known and
// intentionally OUT of the public JSON contract for now (the two *.ics feeds
// answer text/calendar, not JSON; decline/dossier are secondary notary
// routes; acts/complete graduated to the spec when settlement gained its
// domain bound). If you route a new path, either document it in openapi.yaml
// or add it here with a reason.
const KNOWN_UNDOCUMENTED = new Set([
  '/notary/bids/decline',
  '/notary/dossier',
  '/notary/feed.ics',
  '/carnet/feed.ics',
]);

function routedPathsFromHandler() {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'handler.js'), 'utf8');
  const set = new Set();
  for (const m of src.matchAll(/route === '([^']+)'/g)) set.add(m[1]);
  return set;
}

test('no documented path is missing from the app, and undocumented routes are the known set', async () => {
  const routed = routedPathsFromHandler();
  const documented = new Set(contract.documentedRoutes().map((r) => r.path));

  const documentedButNotRouted = [...documented].filter((p) => !routed.has(p));
  assert.deepEqual(documentedButNotRouted, [], 'openapi.yaml documents paths the app does not route');

  const routedButNotDocumented = [...routed].filter((p) => !documented.has(p)).sort();
  assert.deepEqual(
    routedButNotDocumented, [...KNOWN_UNDOCUMENTED].sort(),
    'a routed path is neither documented in openapi.yaml nor in KNOWN_UNDOCUMENTED — resolve the drift',
  );
});
