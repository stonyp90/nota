import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { signToken, SCOPES } = require('../src/notary-auth');
const { createFinancingAI, financingRequestIdentity } = require('../src/financing-ai');
const { DEFAULT_MODEL } = require('../src/assistant-port');
const { loadContract, specPath } = require('./contract/openapi-contract');
const contract = loadContract(specPath('openapi.yaml'));
const now = Date.parse('2026-09-09T14:00:00Z');
const bid = { id: 'b1', dateISO: '2026-09-18', serviceId: 'refinancement', status: D.STATUS.RETENUE, notaryId: 'owner', montant: 2000 };
const page = { documentId: 'offer', page: 1, text: 'Prêteur : Banque Exemple.' };
const fields = [{ fieldId: 'lender_name', value: 'Banque Exemple', evidence: [{ documentId: 'offer', page: 1, quote: page.text }] }];
function setup({ scenario, env = {}, repo: injectedRepo } = {}) {
  const calls = [];
  const repo = injectedRepo || createMemoryRepo([{ ...bid }]);
  repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: 'owner', paye: true, netCents: 1,
    transferId: 'test-paid', completedAt: '2026-09-09T14:00:00.000Z' });
  const port = { async extract(v) { calls.push(v); return scenario ? scenario(v, repo) : { extraction: { fields } }; } };
  const app = createApp(repo, { now: () => '2026-09-09', nowMs: () => now,
    env: { NOTA_FINANCING_AI_ENABLED: 'true', ...env }, financingAIPort: port });
  const request = async (path = '/notary/financing/preparation', body = {}, owner = 'owner', method = 'POST', scope = SCOPES.SESSION) => {
    const result = await app.handle({ path, method,
      headers: owner ? { authorization: 'Bearer ' + signToken(owner, now + 60000, scope) } : {},
      query: { id: bid.id, dateISO: bid.dateISO },
      body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, pages: [page], processingAuthorized: true, ...body }),
    });
    return { ...result, data: JSON.parse(result.body) };
  };
  return { repo, calls, app, request };
}

// Isolate the route's provider factories without changing the shared require
// cache. The real engine/domain validate synthetic results; no SDK or credential
// discovery is reachable from this loader. Session auth is covered above/below
// through createApp; this harness exercises the runtime configuration boundary.
function setupProvider({ env = {}, port, secret = ' synthetic-ssm-key ', secretError,
  factoryError, scenario } = {}) {
  const factories = [], extractions = [], secrets = [];
  const factory = provider => config => {
    factories.push({ provider, config: structuredClone(config) });
    if (factoryError) throw new Error('private factory details');
    return { model: config.model || DEFAULT_MODEL, async extract(input) {
      extractions.push({ provider, input });
      return scenario ? scenario(input) : { extraction: { fields } };
    } };
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../src/financing-ai-routes.js', import.meta.url), 'utf8'), {
    module,
    require(name) {
      if (name === './financing-ai') return { createFinancingAI, financingRequestIdentity,
        createAnthropicFinancingPort: factory('anthropic'), createBedrockFinancingPort: factory('bedrock') };
      if (name === '@nota/domain') return D;
      if (name === 'node:crypto' || name === 'node:util') return require(name);
      if (name === './assistant-port') return { DEFAULT_MODEL };
      throw new Error('Unexpected module: ' + name);
    },
  });
  const repo = createMemoryRepo([{ ...bid }]);
  const handle = module.exports.createFinancingAIRoutes({ repo, port,
    env: { NOTA_FINANCING_AI_ENABLED: 'true', ...env }, nowMs: () => now,
    authenticate: request => request.owner,
    json: (statusCode, payload) => ({ statusCode, body: JSON.stringify(payload) }),
    parseBody: request => ({ payload: request.body }),
    async getSecret(name) {
      secrets.push(name);
      if (secretError) throw new Error('private secret details');
      return secret;
    },
  });
  const request = async (body = {}, owner = 'owner', method = 'POST') => {
    const result = await handle({ owner, body: { id: bid.id, dateISO: bid.dateISO,
      pages: [page], processingAuthorized: true, ...body } }, '/notary/financing/preparation', method,
    { id: bid.id, dateISO: bid.dateISO });
    return { ...result, data: JSON.parse(result.body) };
  };
  return { repo, factories, extractions, secrets, request };
}

test('runtime defaults to Anthropic and trims provider, key and financing model', async t => {
  for (const provider of [undefined, '', ' \t ', 'anthropic', ' anthropic ']) {
    await t.test(JSON.stringify(provider) ?? 'unset', async () => {
      const a = setupProvider({ env: { NOTA_FINANCING_AI_PROVIDER: provider,
        ANTHROPIC_API_KEY: ' synthetic-direct-key ', NOTA_ASSISTANT_API_KEY: 'synthetic-other-key',
        NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key', NOTA_FINANCING_AI_MODEL: ' financing-model ',
        NOTA_ASSISTANT_MODEL: 'assistant-model' } });
      const response = await a.request();
      assert.equal(response.statusCode, 200);
      assert.equal(response.data.analysis.provenance.model, 'financing-model');
      assert.deepEqual(a.factories, [{ provider: 'anthropic', config: {
        apiKey: 'synthetic-direct-key', model: 'financing-model' } }]);
      assert.equal(a.extractions.length, 1);
      assert.deepEqual(a.secrets, []);
    });
  }
});
test('Anthropic preserves key and model fallback order while skipping blank settings', async t => {
  for (const [name, env, apiKey, model, secrets] of [
    ['assistant key/model', { ANTHROPIC_API_KEY: ' \t ', NOTA_ASSISTANT_API_KEY: ' synthetic-assistant-key ',
      NOTA_FINANCING_AI_MODEL: ' ', NOTA_ASSISTANT_MODEL: ' assistant-model ',
      NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' }, 'synthetic-assistant-key', 'assistant-model', []],
    ['SSM key/default model', { ANTHROPIC_API_KEY: ' ', NOTA_ASSISTANT_API_KEY: '\t',
      NOTA_FINANCING_AI_MODEL: ' ', NOTA_ASSISTANT_MODEL: ' ',
      NOTA_ASSISTANT_KEY_PARAM: ' /synthetic/key ' }, 'synthetic-ssm-key', undefined, ['/synthetic/key']],
  ]) {
    await t.test(name, async () => {
      const a = setupProvider({ env });
      const response = await a.request();
      assert.equal(response.statusCode, 200);
      assert.equal(response.data.analysis.provenance.model, model || DEFAULT_MODEL);
      assert.deepEqual(a.factories, [{ provider: 'anthropic', config: { apiKey, model: model || DEFAULT_MODEL } }]);
      assert.deepEqual(a.secrets, secrets);
    });
  }
});
test('missing/blank Anthropic credentials and secret failures return a controlled 503', async t => {
  for (const [name, options, secrets] of [
    ['unset', {}, []],
    ['blank', { env: { ANTHROPIC_API_KEY: ' ', NOTA_ASSISTANT_API_KEY: '\t', NOTA_ASSISTANT_KEY_PARAM: ' ' } }, []],
    ['missing secret', { env: { NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' }, secret: null }, ['/synthetic/key']],
    ['blank secret', { env: { NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' }, secret: ' ' }, ['/synthetic/key']],
    ['failed secret', { env: { NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' }, secretError: true }, ['/synthetic/key']],
  ]) {
    await t.test(name, async () => {
      const a = setupProvider(options);
      const response = await a.request();
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.data, { errors: [{ code: 'financing_ai_unavailable' }] });
      assert.deepEqual(a.factories, []);
      assert.deepEqual(a.extractions, []);
      assert.deepEqual(a.secrets, secrets);
    });
  }
});
test('Bedrock receives only explicit trimmed region/model and never resolves an Anthropic secret', async t => {
  for (const keys of [{}, { ANTHROPIC_API_KEY: 'synthetic-direct-key', NOTA_ASSISTANT_API_KEY: 'synthetic-assistant-key' }]) {
    await t.test(Object.keys(keys).length ? 'with ignored keys' : 'without keys', async () => {
      const a = setupProvider({ secretError: true, env: { ...keys,
        NOTA_FINANCING_AI_PROVIDER: ' bedrock ', NOTA_FINANCING_AI_REGION: ' ca-central-1 ',
        NOTA_FINANCING_AI_MODEL: ' synthetic-bedrock-profile ', NOTA_ASSISTANT_MODEL: 'assistant-model',
        NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' } });
      const response = await a.request();
      assert.equal(response.statusCode, 200);
      assert.equal(response.data.analysis.provenance.model, 'synthetic-bedrock-profile');
      assert.deepEqual(response.data.analysis.preparation.fields, fields);
      assert.deepEqual(a.factories, [{ provider: 'bedrock', config: {
        region: 'ca-central-1', model: 'synthetic-bedrock-profile' } }]);
      assert.equal(a.extractions.length, 1);
      assert.equal(a.extractions[0].provider, 'bedrock');
      assert.deepEqual(a.secrets, []);
    });
  }
});
test('Bedrock requires its own nonblank region and model; unknown providers fail closed', async t => {
  const configurations = [
    ['missing region', { NOTA_FINANCING_AI_REGION: undefined }],
    ['blank region', { NOTA_FINANCING_AI_REGION: ' \t ' }],
    ['missing model', { NOTA_FINANCING_AI_MODEL: undefined }],
    ['blank model', { NOTA_FINANCING_AI_MODEL: ' \t ' }],
    ['missing both', { NOTA_FINANCING_AI_MODEL: undefined, NOTA_FINANCING_AI_REGION: undefined }],
    ['unknown provider', { NOTA_FINANCING_AI_PROVIDER: ' unsupported ' }],
    ['misspelled provider', { NOTA_FINANCING_AI_PROVIDER: 'bedrok' }],
  ];
  for (const [name, overrides] of configurations) {
    await t.test(name, async () => {
      const a = setupProvider({ env: { NOTA_FINANCING_AI_PROVIDER: 'bedrock',
        NOTA_FINANCING_AI_REGION: 'ca-central-1', NOTA_FINANCING_AI_MODEL: 'synthetic-bedrock-model',
        AWS_REGION: 'ca-central-1', AWS_DEFAULT_REGION: 'ca-central-1', NOTA_ASSISTANT_MODEL: 'assistant-model',
        ANTHROPIC_API_KEY: 'synthetic-direct-key', NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key', ...overrides } });
      const response = await a.request();
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.data, { errors: [{ code: 'financing_ai_unavailable' }] });
      assert.deepEqual(a.factories, []);
      assert.deepEqual(a.extractions, []);
      assert.deepEqual(a.secrets, []);
      assert.equal((await a.repo.get(bid.id, bid.dateISO)).financingAnalysis, undefined);
    });
  }
});
test('Bedrock factory/transport failures and invalid evidence have no provider fallback', async t => {
  for (const [name, options, status, code] of [
    ['factory', { factoryError: true }, 503, 'unavailable'],
    ['transport', { scenario: () => { throw new Error('private provider details'); } }, 503, 'unavailable'],
    ['invalid evidence', { scenario: () => ({ extraction: { fields: [{ ...fields[0], value: 'Invented' }] } }) }, 502, 'invalid_output'],
  ]) {
    await t.test(name, async () => {
      const a = setupProvider({ ...options, env: { NOTA_FINANCING_AI_PROVIDER: 'bedrock',
        NOTA_FINANCING_AI_REGION: 'ca-central-1', NOTA_FINANCING_AI_MODEL: 'synthetic-bedrock-model',
        ANTHROPIC_API_KEY: 'synthetic-direct-key', NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' } });
      const response = await a.request();
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.data, { errors: [{ code: 'financing_ai_' + code }] });
      assert.equal(a.factories.length, 1);
      assert.equal(a.factories[0].provider, 'bedrock');
      assert.equal(a.extractions.length, options.factoryError ? 0 : 1);
      assert.deepEqual(a.secrets, []);
      assert.equal((await a.repo.get(bid.id, bid.dateISO)).financingAnalysis, undefined);
    });
  }
});
test('runtime providers and secret lookup stay behind all existing generation gates', async t => {
  for (const provider of ['anthropic', 'bedrock']) {
    await t.test(provider, async () => {
      const env = { NOTA_FINANCING_AI_PROVIDER: provider, NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key',
        NOTA_FINANCING_AI_REGION: 'ca-central-1', NOTA_FINANCING_AI_MODEL: 'synthetic-model' };
      const disabled = setupProvider({ env: { ...env, NOTA_FINANCING_AI_ENABLED: 'false' } });
      const response = await disabled.request();
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.data, { errors: [{ code: 'financing_ai_disabled' }] });
      const a = setupProvider({ env });
      assert.equal((await a.request({}, null)).statusCode, 401);
      assert.equal((await a.request({}, 'other')).statusCode, 403);
      assert.equal((await a.request({ processingAuthorized: false })).statusCode, 422);
      assert.equal((await a.request({ pages: [] })).statusCode, 422);
      assert.equal((await a.request({}, 'owner', 'GET')).statusCode, 200);
      a.repo.incrNotaryRateCounter = async () => 7;
      assert.equal((await a.request()).statusCode, 429);
      a.repo.incrNotaryRateCounter = async () => { throw new Error('counter unavailable'); };
      assert.equal((await a.request()).statusCode, 503);
      for (const subject of [a, disabled]) {
        assert.deepEqual(subject.factories, []);
        assert.deepEqual(subject.extractions, []);
        assert.deepEqual(subject.secrets, []);
      }
    });
  }
});
test('an injected test port still takes precedence over runtime provider configuration', async () => {
  for (const provider of ['bedrock', 'unknown']) {
    let calls = 0;
    const a = setupProvider({ env: { NOTA_FINANCING_AI_PROVIDER: provider, NOTA_ASSISTANT_KEY_PARAM: '/synthetic/key' },
      port: { model: 'injected-model', async extract() { calls++; return { extraction: { fields } }; } } });
    const response = await a.request();
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.analysis.provenance.model, 'injected-model');
    assert.equal(calls, 1);
    assert.deepEqual(a.factories, []);
    assert.deepEqual(a.secrets, []);
  }
});
test('only the retaining session can read or prepare, with no provider calls for failures', async () => {
  const a = setup();
  assert.equal((await a.request(undefined, {}, null)).statusCode, 401);
  assert.equal((await a.request(undefined, {}, 'other')).statusCode, 403);
  assert.equal((await a.request(undefined, {}, 'owner', 'POST', SCOPES.FEED)).statusCode, 401);
  assert.equal((await a.request(undefined, { processingAuthorized: false })).statusCode, 422);
  assert.equal((await a.request(undefined, { pages: [] })).statusCode, 422);
  assert.equal(a.calls.length, 0);
});
test('generation persists only validated evidence and server-selected service; public data excludes analysis', async () => {
  const a = setup();
  const out = await a.request(undefined, { serviceId: 'forged', reviewerId: 'forged' });
  assert.equal(out.statusCode, 200);
  const v = contract.validatorForResponse('/notary/financing/preparation', 'post', 200);
  assert.equal(v.validate(out.data), true, JSON.stringify(v.validate.errors));
  assert.equal(out.data.analysis.preparation.status, 'needs_notary_review');
  const stored = await a.repo.get(bid.id, bid.dateISO);
  assert.equal(stored.financingAnalysis.pages, undefined);
  assert.equal(stored.financingAnalysis.preparation.fields[0].value, 'Banque Exemple');
  assert.equal(stored.financingAnalysis.review, undefined);
  assert.ok(out.data.workPacket);
  const get = await a.request(undefined, {}, 'owner', 'GET');
  assert.deepEqual(get.data.analysis, out.data.analysis);
  const publicResult = await a.app.handle({ path: '/bids', method: 'GET', query: { month: '2026-09' } });
  assert.ok(!publicResult.body.includes('Banque Exemple'));
  assert.equal(D.redactedBid(stored, new Date(now).toISOString()).financingAnalysis, null);
});
test('private work packet uses fresh server context even with provider disabled and ignores client overrides', async () => {
  const a = setup({ env: { NOTA_FINANCING_AI_ENABLED: 'false' } });
  await a.repo.put({ ...bid, dossier: { adresse: 'Adresse privée', contact_preteur: 'Conseiller déclaré' }, pricing: { preteur: 'rbc', valeur_pret: 200000 } });
  const first = await a.request(undefined, { dossier: { adresse: 'Forged override' } }, 'owner', 'GET');
  assert.equal(first.statusCode, 200);
  assert.equal(first.data.workPacket.customerContext.find(f => f.id === 'adresse').value, 'Adresse privée');
  assert.equal(first.data.analysis, null);
  assert.equal(a.calls.length, 0);
  await a.repo.put({ ...bid, dossier: { adresse: 'Adresse mise à jour' } });
  const refreshed = await a.request(undefined, {}, 'owner', 'GET');
  assert.equal(refreshed.data.workPacket.customerContext.find(f => f.id === 'adresse').value, 'Adresse mise à jour');
  assert.equal((await a.request(undefined, {}, 'other', 'GET')).statusCode, 403);
  const publicResult = await a.app.handle({ path: '/bids', method: 'GET', query: { month: '2026-09' } });
  assert.ok(!publicResult.body.includes('Adresse mise à jour'));
});
test('provider absence, disabled extraction and invalid output cannot return a successful analysis', async () => {
  const disabled = setup({ env: { NOTA_FINANCING_AI_ENABLED: 'false' } });
  assert.equal((await disabled.request()).statusCode, 503);
  assert.equal(disabled.calls.length, 0);
  const invalid = setup({ scenario: () => ({ extraction: { fields: [{ ...fields[0], value: 'Invented' }] } }) });
  assert.equal((await invalid.request()).statusCode, 502);
  assert.equal((await invalid.repo.get(bid.id, bid.dateISO)).financingAnalysis, undefined);
  const failed = setup({ scenario: () => { throw new Error('private provider details'); } });
  const response = await failed.request();
  assert.equal(response.statusCode, 503);
  assert.ok(!response.body.includes('private provider details'));
});
test('ownership change during generation prevents persistence', async () => {
  const a = setup({ scenario: async (_, repo) => {
    await repo.put({ ...bid, notaryId: 'other' });
    return { extraction: { fields } };
  } });
  assert.equal((await a.request()).statusCode, 409);
  assert.equal((await a.repo.get(bid.id, bid.dateISO)).financingAnalysis, undefined);
});
test('review uses authenticated author, rejects stale/repeated review and does not authorize training', async () => {
  const a = setup();
  const generated = await a.request();
  const analysisId = generated.data.analysis.id;
  const review = { analysisId, decisions: [{ index: 0, decision: 'corrected', value: 'Nom corrigé', reason: 'Comparé au mandat courant' }], activeReviewSeconds: 42, reviewerId: 'forged', trainingEligible: true };
  assert.equal((await a.request('/notary/financing/review', { ...review, analysisId: 'old' })).statusCode, 422);
  const result = await a.request('/notary/financing/review', review);
  assert.equal(result.statusCode, 200);
  const v = contract.validatorForResponse('/notary/financing/review', 'post', 200);
  assert.equal(v.validate(result.data), true, JSON.stringify(v.validate.errors));
  assert.equal(result.data.review.reviewerId, 'owner');
  assert.equal(result.data.review.trainingEligible, false);
  assert.equal(result.data.review.signingReadiness, 'not_assessed');
  assert.equal((await a.request('/notary/financing/review', review)).statusCode, 409);
});
test('a review recorded while regeneration is in flight is not overwritten', async () => {
  const repo = createMemoryRepo([{ ...bid }]);
  await repo.saveFinancingPreparation(bid, 'owner', { id: 'a1', preparation: { fields } });
  const a = setup({ repo, scenario: async () => {
    await repo.reviewFinancingPreparation(bid, 'owner', 'a1', { reviewedAt: '2026-09-09T14:00:00Z', decisions: [] });
    return { extraction: { fields } };
  } });
  assert.equal((await a.request()).statusCode, 409);
  assert.equal((await repo.get(bid.id, bid.dateISO)).financingAnalysis.id, 'a1');
});
test('AI rate limits and unavailable counters fail closed before the provider', async () => {
  const a = setup();
  for (let i = 0; i < 6; i++) assert.equal((await a.request(undefined, { pages: [{ ...page, text: page.text + '\n' + i }] })).statusCode, 200);
  assert.equal((await a.request(undefined, { pages: [{ ...page, text: page.text + '\nnew' }] })).statusCode, 429);
  assert.equal(a.calls.length, 6);
  const b = setup();
  b.repo.incrNotaryRateCounter = async () => { throw new Error('unavailable'); };
  assert.equal((await b.request()).statusCode, 503);
  assert.equal(b.calls.length, 0);
});
test('Dynamo writes condition on current ownership, state, version and unreviewed analysis', async () => {
  const calls = [];
  const repo = createDynamoRepo({ tableName: 'test', doc: { async send(cmd) {
    calls.push(cmd.input);
    return { Attributes: { financingAnalysis: { id: 'analysis' } } };
  } } });
  await repo.saveFinancingPreparation(bid, 'owner', { id: 'analysis' });
  await repo.saveFinancingPreparation(bid, 'owner', { id: 'new' }, 'analysis');
  await repo.reviewFinancingPreparation(bid, 'owner', 'new', { decisions: [] });
  for (const c of calls) {
    assert.match(c.ConditionExpression, /notaryId = :owner/);
    assert.match(c.ConditionExpression, /#status = :retained/);
  }
  assert.match(calls[0].ConditionExpression, /attribute_not_exists\(financingAnalysis\)/);
  assert.match(calls[1].ConditionExpression, /financingAnalysis.id = :expected/);
  assert.match(calls[2].ConditionExpression, /attribute_not_exists\(financingAnalysis.review\)/);
});
