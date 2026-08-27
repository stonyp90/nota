import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-08-12';

// Deterministic app: fixed clock, incrementing ids.
function app(seed = []) {
  let n = 0;
  const repo = createMemoryRepo(seed);
  return { ...createApp(repo, { now: () => TODAY, newId: () => 'id-' + ++n }), repo };
}

// Default mandatory pricing params per service, so a POST validates unless a
// test overrides `pricing` explicitly. These answers keep the dynamic base at
// the flat 2000 $ floor (valeur_pret <= 300000, no succession, bank approval
// obtained — every add is 0).
const DEFAULT_PRICING = {
  refinancement: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};
const post = (a, obj) =>
  a.handle({ method: 'POST', path: '/bids', body: JSON.stringify({ pricing: DEFAULT_PRICING[obj.serviceId], ...obj }) });
const getBids = (a, month) => a.handle({ method: 'GET', path: '/bids', query: month ? { month } : {} });
const parse = (res) => JSON.parse(res.body);

test('GET /health returns the server date', async () => {
  const res = await app().handle({ method: 'GET', path: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).today, TODAY);
});

test('POST /bids accepts a valid offer and echoes the derived tier', async () => {
  const a = app();
  // 3 days out is the top of the prioritaire band.
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-08-15', montant: 3000 });
  assert.equal(res.statusCode, 201);
  const { bid } = parse(res);
  assert.equal(bid.tier, 'prioritaire');
  assert.equal(bid.montant, 3000);
  assert.equal(bid.status, 'ouverte');
});

test('POST then GET: the new bid shows up in its month partition', async () => {
  const a = app();
  await post(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800 });
  const res = await getBids(a, '2026-08');
  const { bids } = parse(res);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].serviceId, 'refinancement');
});

test('GET /bids defaults to the current month and reads one month only', async () => {
  const a = app();
  await post(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800 });
  await post(a, { serviceId: 'refinancement', dateISO: '2026-09-20', montant: 2800 });
  assert.equal(parse(await getBids(a, '2026-08')).bids.length, 1);
  assert.equal(parse(await getBids(a, '2026-09')).bids.length, 1);
  assert.equal(parse(await getBids(a)).bids.length, 1); // defaults to 2026-08
});

test('server revalidates: below starting price is 422, not stored', async () => {
  const a = app();
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-09-30', montant: 1400 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'sous_prix_depart'));
  assert.equal((await a.repo._all()).length, 0);
});

test('server revalidates: above 3x premium cap is 422', async () => {
  const res = await post(app(), { serviceId: 'refinancement', dateISO: '2026-08-13', montant: 28000 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'plafond_depasse'));
});

test('server revalidates: a past date is 422', async () => {
  const res = await post(app(), { serviceId: 'refinancement', dateISO: '2026-08-01', montant: 2500 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'date_passee'));
});

test('server never trusts a client-sent tier or premium', async () => {
  const a = app();
  // Client lies: claims standard tier and a tiny premium on an urgent date.
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-08-13', montant: 2000, tier: 'standard', premium: 1.0 });
  const { bid } = parse(res);
  assert.equal(bid.tier, 'urgence'); // 1 day away, recomputed server-side
  assert.ok(Math.abs(bid.premium - 2000 / 2000) < 1e-9);
});

test('anonymity is enforced server-side: name never leaks when anonyme', async () => {
  const a = app();
  await post(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, anonyme: true, nom: 'Marie-Ève Tremblay', prefixe: 'g1r' });
  const bid = parse(await getBids(a, '2026-08')).bids[0];
  assert.equal(bid.anonyme, true);
  assert.equal(bid.nom, null);
  assert.equal(bid.prefixe, 'G1R'); // normalized, still shown for locality
});

test('a named bid keeps its name public', async () => {
  const a = app();
  await post(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, anonyme: false, nom: 'Luc Gagné' });
  const bid = parse(await getBids(a, '2026-08')).bids[0];
  assert.equal(bid.nom, 'Luc Gagné');
});

test('GET /bids rejects a malformed month', async () => {
  const res = await getBids(app(), '2026-8');
  assert.equal(res.statusCode, 400);
});

test('unknown route is 404', async () => {
  const res = await app().handle({ method: 'GET', path: '/nope' });
  assert.equal(res.statusCode, 404);
});

test('courriel is stored privately and NEVER leaks in the public projection', async () => {
  const a = app();
  const res = await post(a, {
    serviceId: 'refinancement',
    dateISO: '2026-08-20',
    montant: 2800,
    courriel: 'Client@Example.CA',
  });
  assert.equal(res.statusCode, 201);
  // Not on the POST response...
  assert.equal(parse(res).bid.courriel, undefined);
  // ...nor on GET /bids...
  const listed = parse(await getBids(a, '2026-08')).bids[0];
  assert.equal(listed.courriel, undefined);
  // ...but it IS persisted privately (normalized to lowercase) for notifications.
  const stored = (await a.repo._all())[0];
  assert.equal(stored.courriel, 'client@example.ca');
});

test('an invalid courriel is rejected with courriel_invalide and nothing is stored', async () => {
  const a = app();
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, courriel: 'nope' });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'courriel_invalide'));
  assert.equal((await a.repo._all()).length, 0);
});

test('OPTIONS preflight is 204 with an empty body and CORS headers', async () => {
  const res = await app().handle({ method: 'OPTIONS', path: '/bids' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, ''); // a 204 must not carry a body
  assert.equal(res.headers['access-control-allow-methods'], 'GET,POST,OPTIONS');
});

test('an oversized POST body is rejected with 413 before it is parsed', async () => {
  const a = app();
  const huge = 'x'.repeat(64 * 1024 + 1); // one byte over the cap
  const res = await a.handle({ method: 'POST', path: '/bids', body: huge });
  assert.equal(res.statusCode, 413);
  assert.ok(parse(res).errors.some((e) => e.code === 'corps_trop_grand'));
  assert.equal((await a.repo._all()).length, 0); // nothing stored
});

test('a POST body at the size cap is not rejected as oversized', async () => {
  // Exactly 64KB of valid JSON must pass the guard (it is rejected later only on
  // its own merits, here a domain validation 201/422 — never 413).
  const a = app();
  const base = { serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800 };
  const pad = 64 * 1024 - JSON.stringify({ ...base, _p: '' }).length;
  const body = JSON.stringify({ ...base, _p: 'x'.repeat(pad) });
  assert.equal(Buffer.byteLength(body), 64 * 1024);
  const res = await a.handle({ method: 'POST', path: '/bids', body });
  assert.notEqual(res.statusCode, 413);
});

test('the public projection omits every private field (dossier, pricing, basePrice, courriel, telephone, parrain)', async () => {
  // Even if a raw item carries them, GET /bids must expose none of these.
  const repo = createMemoryRepo([
    {
      id: 'x', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, status: 'ouverte', anonyme: true, prefixe: 'G1R',
      documents: { secret: 'leak' }, dossier: { secret: 'leak' }, courriel: 'client@example.ca',
      pricing: { valeur_pret: 850000, succession: 'oui' }, basePrice: 2750, createdAt: TODAY,
      telephone: '418 555-1234', parrain: 'EVEROY',
    },
  ]);
  const a = { ...createApp(repo, { now: () => TODAY }) };
  const bid = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } })).bids[0];
  assert.equal(bid.documents, undefined);
  assert.equal(bid.dossier, undefined);
  assert.equal(bid.courriel, undefined);
  assert.equal(bid.basePrice, undefined);
  // The pricing answers (succession, loan value, bank approval) must NEVER leak.
  assert.equal(bid.pricing, undefined, 'pricing answers must never appear in the public projection');
  assert.equal(Object.prototype.hasOwnProperty.call(bid, 'pricing'), false);
  // Nor the mise en relation phone (ADR 0010) or the referral code (ADR 0011).
  assert.equal(bid.telephone, undefined, 'telephone must never appear in the public projection');
  assert.equal(bid.parrain, undefined, 'parrain must never appear in the public projection');
  // Public premium is anchored on prixDepart (2000), not the private base (2750).
  assert.ok(Math.abs(bid.premium - 2800 / 2000) < 1e-9);
});
