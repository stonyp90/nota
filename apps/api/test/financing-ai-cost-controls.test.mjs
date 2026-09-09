import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { signToken, SCOPES } = require('../src/notary-auth');
const { financingRequestIdentity, createFinancingAI } = require('../src/financing-ai');
const now = Date.parse('2026-09-09T14:00:00Z');
const page = { documentId: 'synthetic-source', page: 1, text: 'FICTIF. Prêteur : Banque Exemple.' };
const field = { fieldId: 'lender_name', value: 'Banque Exemple', evidence: [{ documentId: page.documentId, page: page.page, quote: page.text }] };
const base = { id: 'file-a', dateISO: '2026-09-18', serviceId: 'refinancement', status: D.STATUS.RETENUE, notaryId: 'notary-a', montant: 2000 };
function setup({ records = [base], env: overrides = {}, extract, repo: suppliedRepo } = {}) {
  const repo = suppliedRepo || createMemoryRepo(records.map(b => structuredClone(b)));
  const calls = [], counters = [];
  const increment = repo.incrNotaryRateCounter.bind(repo);
  repo.incrNotaryRateCounter = async (...args) => { counters.push(args); return increment(...args); };
  const env = { NOTA_FINANCING_AI_ENABLED: 'true', ...overrides };
  const port = { model: 'synthetic-model', async extract(input) {
    calls.push(input);
    return extract ? extract(input) : { extraction: { fields: [field] }, usage: { in: 100, out: 20, cacheRead: 0, cacheWrite: 0 } };
  } };
  const app = createApp(repo, { now: () => '2026-09-09', nowMs: () => now, env, financingAIPort: port });
  async function request(body = {}, owner = 'notary-a', route = '/notary/financing/preparation') {
    const response = await app.handle({ method: 'POST', path: route,
      headers: owner ? { authorization: 'Bearer ' + signToken(owner, now + 60000, SCOPES.SESSION) } : {},
      body: JSON.stringify({ id: base.id, dateISO: base.dateISO, pages: [page], processingAuthorized: true, ...body }) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }
  return { repo, calls, counters, env, port, request };
}

test('unchanged source reuses validated analysis and review without provider or admission calls; packet stays fresh', async () => {
  const a = setup();
  const first = await a.request();
  assert.equal(first.status, 200);
  assert.equal(first.body.reused, false);
  assert.equal(first.body.analysis.preparedBy, 'notary-a');
  assert.match(first.body.analysis.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.body.analysis.performance.usage.reported, true);
  const review = await a.request({ analysisId: first.body.analysis.id,
    decisions: [{ index: 0, decision: 'accepted' }], activeReviewSeconds: 12 }, 'notary-a', '/notary/financing/review');
  assert.equal(review.status, 200);
  const stored = await a.repo.get(base.id, base.dateISO);
  await a.repo.put({ ...stored, dossier: { adresse: 'Nouvelle déclaration fictive' } });
  for (let i = 0; i < 8; i++) {
    const cached = await a.request();
    assert.equal(cached.status, 200);
    assert.equal(cached.body.reused, true);
    assert.equal(cached.body.analysis.id, first.body.analysis.id);
    assert.deepEqual(cached.body.analysis.review, review.body.review);
    assert.equal(cached.body.workPacket.customerContext.find(f => f.id === 'adresse').value, 'Nouvelle déclaration fictive');
  }
  assert.equal(a.calls.length, 1);
  assert.deepEqual(a.counters.map(c => c[0]), ['financing_ai', 'financing_ai_budget']);
  assert.equal(D.redactedBid(await a.repo.get(base.id, base.dateISO), new Date(now).toISOString()).financingAnalysis, null);
});

test('a changed source or model regenerates; forged reuse identity is ignored', async () => {
  const a = setup();
  const first = await a.request();
  const changed = await a.request({ pages: [{ ...page, text: page.text + '\nNouvelle note.' }], requestFingerprint: first.body.analysis.requestFingerprint });
  assert.equal(changed.body.reused, false);
  assert.notEqual(changed.body.analysis.id, first.body.analysis.id);
  a.port.model = 'another-synthetic-model';
  const modelChanged = await a.request({ pages: [{ ...page, text: page.text + '\nNouvelle note.' }] });
  assert.equal(modelChanged.body.reused, false);
  assert.equal(modelChanged.body.analysis.provenance.model, a.port.model);
  assert.equal(a.calls.length, 3);
});

test('reuse identity changes with provider, region, page reference and text', () => {
  const input = { serviceId: 'refinancement', pages: [page] };
  const config = { provider: 'bedrock', region: 'ca-central-1', model: 'synthetic-model' };
  const first = financingRequestIdentity(input, config);
  assert.deepEqual(financingRequestIdentity(structuredClone(input), config), first);
  const identities = [
    financingRequestIdentity(input, { ...config, provider: 'anthropic' }),
    financingRequestIdentity(input, { ...config, region: 'us-east-1' }),
    financingRequestIdentity(input, { ...config, model: 'another-model' }),
    financingRequestIdentity({ ...input, pages: [{ ...page, page: 2 }] }, config),
    financingRequestIdentity({ ...input, pages: [{ ...page, documentId: 'other' }] }, config),
    financingRequestIdentity({ ...input, pages: [{ ...page, text: page.text + ' ' }] }, config),
  ];
  assert.ok(identities.every(identity => identity.fingerprint !== first.fingerprint));
  assert.equal(financingRequestIdentity({ ...input, pages: [] }, config), null);
});

test('saved output is revalidated before reuse; legacy and former-owner analyses are not cache hits', async () => {
  const a = setup();
  await a.request();
  const original = await a.repo.get(base.id, base.dateISO);
  const corrupt = structuredClone(original);
  corrupt.financingAnalysis.preparation.fields[0].value = 'Invented bank';
  await a.repo.put(corrupt);
  assert.equal((await a.request()).body.reused, false);
  const legacy = await a.repo.get(base.id, base.dateISO);
  delete legacy.financingAnalysis.requestFingerprint;
  await a.repo.put(legacy);
  assert.equal((await a.request()).body.reused, false);
  const reassigned = await a.repo.get(base.id, base.dateISO);
  await a.repo.put({ ...reassigned, notaryId: 'notary-b' });
  assert.equal((await a.request()).status, 403);
  assert.equal((await a.request({}, 'notary-b')).body.reused, false);
  assert.equal(a.calls.length, 4);
});

test('simultaneous identical submissions in one worker share one generation and admission reservation', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const a = setup({ extract: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { extraction: { fields: [field] } }; } });
  const first = a.request();
  await started;
  const second = a.request();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.calls.length, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results[0].body.analysis.id, results[1].body.analysis.id);
  assert.deepEqual(results.map(r => r.body.reused), [false, true]);
  assert.equal(a.counters.length, 2);
});

test('joined requests recheck ownership after generation and never return erased or reassigned data', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const a = setup({ extract: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { extraction: { fields: [field] } }; } });
  const first = a.request(); await started;
  const second = a.request(); await new Promise(resolve => setImmediate(resolve));
  await a.repo.put({ ...base, notaryId: 'notary-b' });
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.every(r => r.status === 409 && !r.body.analysis));
  assert.equal(a.calls.length, 1);
});

test('failed generation does not poison duplicate state, and disabled/unauthorized requests cannot reuse', async () => {
  let fail = true;
  const a = setup({ extract: () => { if (fail) throw new Error('provider down'); return { extraction: { fields: [field] } }; } });
  assert.equal((await a.request()).status, 503);
  fail = false;
  assert.equal((await a.request()).body.reused, false);
  assert.equal(a.calls.length, 2);
  assert.equal((await a.request({}, null)).status, 401);
  assert.equal((await a.request({ processingAuthorized: false })).status, 422);
  a.env.NOTA_FINANCING_AI_ENABLED = 'false';
  assert.equal((await a.request()).status, 503);
  assert.equal(a.calls.length, 2);
});

test('daily admission limit is shared across notaries and workers; cached reads remain free of reservations', async () => {
  const records = [base, { ...base, id: 'file-b', notaryId: 'notary-b' }, { ...base, id: 'file-c', notaryId: 'notary-c' }];
  const repo = createMemoryRepo(records);
  const a = setup({ repo, env: { NOTA_FINANCING_AI_MAX_CALLS_PER_DAY: '2' } });
  const b = setup({ repo, env: { NOTA_FINANCING_AI_MAX_CALLS_PER_DAY: '2' } });
  assert.equal((await a.request()).status, 200);
  assert.equal((await b.request({ id: 'file-b' }, 'notary-b')).status, 200);
  assert.equal((await b.request({ id: 'file-c' }, 'notary-c')).status, 429);
  assert.equal((await a.request()).body.reused, true);
  assert.equal(a.calls.length + b.calls.length, 2);
});

test('invalid daily limits and unavailable shared budget counter fail closed before provider use', async () => {
  for (const limit of ['0', '-1', '1.5', 'bad', 'Infinity']) {
    const a = setup({ env: { NOTA_FINANCING_AI_MAX_CALLS_PER_DAY: limit } });
    assert.equal((await a.request()).status, 503);
    assert.equal(a.calls.length, 0);
  }
  const a = setup();
  const increment = a.repo.incrNotaryRateCounter;
  a.repo.incrNotaryRateCounter = async (...args) => { if (args[0] === 'financing_ai_budget') throw new Error('counter unavailable'); return increment(...args); };
  assert.equal((await a.request()).status, 503);
  assert.equal(a.calls.length, 0);
});

test('malformed shared counter results fail closed before provider use', async () => {
  for (const malformed of [0, -1, 1.5, Number.NaN, undefined, '1']) {
    const a = setup();
    a.repo.incrNotaryRateCounter = async () => malformed;
    assert.equal((await a.request()).status, 503);
    assert.equal(a.calls.length, 0);
  }
});

test('usage includes cache writes and distinguishes absent/invalid counters from measured zero', async () => {
  const input = { serviceId: 'refinancement', pages: [page] };
  for (const [usage, reported, cacheWrite] of [
    [undefined, false, 0], [{ in: 0, out: 0 }, true, 0],
    [{ in: 10, out: 4, cacheWrite: 1200 }, true, 1200],
    [{ in: 10, out: 4, cacheWrite: 'private' }, false, 0],
    [{ in: 0, out: 0, reported: false }, false, 0],
  ]) {
    const result = await createFinancingAI({ port: { async extract() { return { extraction: { fields: [field] }, usage }; } } }).prepare(input);
    assert.equal(result.ok, true);
    assert.equal(result.usage.reported, reported);
    assert.equal(result.usage.cacheWrite, cacheWrite);
    assert.ok(!JSON.stringify(result.usage).includes('private'));
  }
});
