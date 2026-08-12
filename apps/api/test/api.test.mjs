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

const post = (a, obj) => a.handle({ method: 'POST', path: '/bids', body: JSON.stringify(obj) });
const getBids = (a, month) => a.handle({ method: 'GET', path: '/bids', query: month ? { month } : {} });
const parse = (res) => JSON.parse(res.body);

test('GET /health returns the server date', async () => {
  const res = await app().handle({ method: 'GET', path: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).today, TODAY);
});

test('POST /bids accepts a valid offer and echoes the derived tier', async () => {
  const a = app();
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-08-17', montant: 1500 });
  assert.equal(res.statusCode, 201);
  const { bid } = parse(res);
  assert.equal(bid.tier, 'prioritaire');
  assert.equal(bid.montant, 1500);
  assert.equal(bid.status, 'ouverte');
});

test('POST then GET: the new bid shows up in its month partition', async () => {
  const a = app();
  await post(a, { serviceId: 'testament', dateISO: '2026-08-20', montant: 600 });
  const res = await getBids(a, '2026-08');
  const { bids } = parse(res);
  assert.equal(bids.length, 1);
  assert.equal(bids[0].serviceId, 'testament');
});

test('GET /bids defaults to the current month and reads one month only', async () => {
  const a = app();
  await post(a, { serviceId: 'testament', dateISO: '2026-08-20', montant: 600 });
  await post(a, { serviceId: 'testament', dateISO: '2026-09-20', montant: 600 });
  assert.equal(parse(await getBids(a, '2026-08')).bids.length, 1);
  assert.equal(parse(await getBids(a, '2026-09')).bids.length, 1);
  assert.equal(parse(await getBids(a)).bids.length, 1); // defaults to 2026-08
});

test('server revalidates: below starting price is 422, not stored', async () => {
  const a = app();
  const res = await post(a, { serviceId: 'testament', dateISO: '2026-09-30', montant: 400 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'sous_prix_depart'));
  assert.equal((await a.repo._all()).length, 0);
});

test('server revalidates: above 10x premium cap is 422', async () => {
  const res = await post(app(), { serviceId: 'testament', dateISO: '2026-08-13', montant: 5000 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'plafond_depasse'));
});

test('server revalidates: a past date is 422', async () => {
  const res = await post(app(), { serviceId: 'procuration', dateISO: '2026-08-01', montant: 300 });
  assert.equal(res.statusCode, 422);
  assert.ok(parse(res).errors.some((e) => e.code === 'date_passee'));
});

test('server never trusts a client-sent tier or premium', async () => {
  const a = app();
  // Client lies: claims standard tier and a tiny premium on an urgent date.
  const res = await post(a, { serviceId: 'refinancement', dateISO: '2026-08-13', montant: 2000, tier: 'standard', premium: 1.0 });
  const { bid } = parse(res);
  assert.equal(bid.tier, 'extreme'); // 1 day away, recomputed server-side
  assert.ok(Math.abs(bid.premium - 2000 / 950) < 1e-9);
});

test('anonymity is enforced server-side: name never leaks when anonyme', async () => {
  const a = app();
  await post(a, { serviceId: 'testament', dateISO: '2026-08-20', montant: 600, anonyme: true, nom: 'Marie-Ève Tremblay', prefixe: 'g1r' });
  const bid = parse(await getBids(a, '2026-08')).bids[0];
  assert.equal(bid.anonyme, true);
  assert.equal(bid.nom, null);
  assert.equal(bid.prefixe, 'G1R'); // normalized, still shown for locality
});

test('a named bid keeps its name public', async () => {
  const a = app();
  await post(a, { serviceId: 'testament', dateISO: '2026-08-20', montant: 600, anonyme: false, nom: 'Luc Gagné' });
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

test('the public projection omits any dossier fields', async () => {
  // Even if a raw item somehow carries documents, GET must not expose them.
  const repo = createMemoryRepo([
    { id: 'x', serviceId: 'testament', dateISO: '2026-08-20', montant: 600, status: 'ouverte', anonyme: true, prefixe: 'G1R', documents: { secret: 'leak' }, createdAt: TODAY },
  ]);
  const a = { ...createApp(repo, { now: () => TODAY }) };
  const bid = parse(await a.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } })).bids[0];
  assert.equal(bid.documents, undefined);
});
