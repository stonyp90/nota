import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createFinancingAI, createAnthropicFinancingPort, createBedrockFinancingPort } = require('../src/financing-ai');
const region = 'ca-central-1';
const model = 'us.anthropic.claude-sonnet-4-6';
const input = { serviceId: 'refinancement', pages: [{ documentId: 'synthetic-only', page: 3,
  text: 'EXEMPLE FICTIF. Prêteur : Caisse Imaginaire.' }] };
const field = { fieldId: 'lender_name', value: 'Caisse Imaginaire', evidence: [
  { documentId: 'synthetic-only', page: 3, quote: 'Prêteur : Caisse Imaginaire.' },
] };
const reply = (changes = {}) => ({ stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ fields: [field] }) }],
  usage: { input_tokens: 13, output_tokens: 7, cache_read_input_tokens: 2 }, ...changes });
function clientReturning(value = reply()) {
  const calls = [];
  return { calls, async send(command, options) {
    calls.push({ command, options });
    return { body: Buffer.from(JSON.stringify(value)) };
  } };
}

test('Bedrock requires explicit nonblank region and model, even with an injected client', () => {
  const client = clientReturning();
  for (const config of [{}, { region }, { model }, { region: ' ', model }, { region, model: '\t' },
    { region: 4, model }, { region, model: null }]) {
    assert.equal(createBedrockFinancingPort({ ...config, client }), null);
  }
  assert.equal(client.calls.length, 0);
});

test('Bedrock sends the same grounded request as Anthropic and preserves actual profile provenance', async () => {
  const client = clientReturning();
  const port = createBedrockFinancingPort({ region: ` ${region} `, model: ` ${model} `, client });
  const result = await createFinancingAI({ port }).prepare(input);
  assert.equal(result.ok, true);
  assert.equal(result.provenance.model, model);
  assert.deepEqual(result.preparation.fields, [field]);
  assert.equal(result.preparation.status, 'needs_notary_review');
  assert.deepEqual(result.usage, { in: 13, out: 7, cacheRead: 2, cacheWrite: 0, reported: true });
  const request = client.calls[0].command.input;
  assert.equal(request.modelId, model);
  assert.equal(request.contentType, 'application/json');
  assert.equal(request.accept, 'application/json');
  assert.ok(client.calls[0].options.abortSignal instanceof AbortSignal);
  const { anthropic_version, ...body } = JSON.parse(request.body);
  assert.equal(anthropic_version, 'bedrock-2023-05-31');
  let directBody;
  const direct = createAnthropicFinancingPort({ apiKey: 'synthetic-test-key', model,
    client: { messages: { async create(value) { directBody = value; return reply(); } } } });
  const directResult = await createFinancingAI({ port: direct }).prepare(input);
  const { model: directModel, ...directRequest } = directBody;
  assert.equal(directModel, model);
  assert.deepEqual(body, directRequest);
  assert.deepEqual(result.provenance, directResult.provenance);
  assert.deepEqual(JSON.parse(body.messages[0].content), { pages: input.pages, fieldIds: D.FINANCING_AI_FIELDS.map(f => f.id) });
  assert.equal(body.tools, undefined);
  assert.equal(body.model, undefined);
  assert.equal(body.apiKey, undefined);
  await createFinancingAI({ port }).prepare({ ...input, pages: [{ ...input.pages[0], text: 'Fictional empty page.' }] });
  assert.notEqual(client.calls[1].options.abortSignal, client.calls[0].options.abortSignal);
  assert.equal(JSON.parse(client.calls[1].command.input.body).messages.length, 1);
});

test('Bedrock refusal, truncation, unsupported evidence, tools and malformed responses fail closed', async t => {
  const cases = {
    refusal: reply({ stop_reason: 'refusal' }),
    truncated: reply({ stop_reason: 'max_tokens' }),
    toolCall: reply({ content: [{ type: 'tool_use', name: 'transfer_funds', input: {} }] }),
    invalidJson: reply({ content: [{ type: 'text', text: 'invalid' }] }),
    extraText: reply({ content: [...reply().content, { type: 'text', text: 'Approved' }] }),
    inventedValue: reply({ content: [{ type: 'text', text: JSON.stringify({ fields: [{ ...field, value: 'Invented Bank' }] }) }] }),
    approval: reply({ content: [{ type: 'text', text: JSON.stringify({ fields: [field], status: 'approved' }) }] }),
    nullReply: null,
  };
  for (const [name, response] of Object.entries(cases)) await t.test(name, async () => {
    const client = clientReturning(response);
    const port = createBedrockFinancingPort({ region, model, client });
    assert.deepEqual(await createFinancingAI({ port }).prepare(input), { ok: false, code: 'invalid_output' });
    assert.equal(client.calls.length, 1);
  });
  const port = createBedrockFinancingPort({ region, model, client: { async send() { return { body: Buffer.from('not JSON') }; } } });
  assert.deepEqual(await createFinancingAI({ port }).prepare(input), { ok: false, code: 'invalid_output' });
});

test('Bedrock transport errors never echo provider details or retry through another transport', async t => {
  const logs = [];
  for (const level of ['debug', 'info', 'log', 'warn', 'error']) t.mock.method(console, level, (...args) => logs.push(args));
  let calls = 0;
  const secret = 'synthetic-private-provider-error';
  const port = createBedrockFinancingPort({ region, model, client: { async send() { calls++; throw new Error(secret); } } });
  assert.deepEqual(await createFinancingAI({ port }).prepare(input), { ok: false, code: 'unavailable' });
  assert.equal(calls, 1);
  await assert.rejects(port.extract({ system: 'extract', pages: input.pages, fieldIds: ['lender_name'] }), error => {
    assert.equal(error.message, 'Financing AI provider unavailable.');
    assert.equal(error.cause, undefined);
    assert.ok(!error.stack.includes(secret));
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(logs, []);
});

test('Bedrock SDK uses IAM resolution, one attempt, explicit region and a fresh 20-second deadline', async () => {
  const constructions = [], deadlines = [], sends = [];
  let loads = 0;
  class FakeClient {
    constructor(config) { constructions.push(config); }
    async send(command, options) { sends.push({ command, options }); return { body: Buffer.from(JSON.stringify(reply())) }; }
  }
  class FakeCommand { constructor(value) { this.input = value; } }
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../src/financing-ai.js', import.meta.url), 'utf8'), {
    module, structuredClone, Buffer,
    AbortSignal: { timeout(ms) { const signal = { ms }; deadlines.push(signal); return signal; } },
    require(name) {
      if (name === '@aws-sdk/client-bedrock-runtime') { loads++; return { BedrockRuntimeClient: FakeClient, InvokeModelCommand: FakeCommand }; }
      if (name === '@anthropic-ai/sdk') throw new Error('Bedrock must never load the direct provider SDK');
      if (name === './assistant-port') return require('../src/assistant-port');
      return require(name);
    },
  });
  const factory = module.exports.createBedrockFinancingPort;
  const port = factory({ region, model });
  assert.equal(loads, 0);
  const request = { system: 'extract', pages: input.pages, fieldIds: ['lender_name'] };
  await port.extract(request);
  await port.extract(request);
  assert.equal(constructions.length, 1);
  assert.equal(constructions[0].region, region);
  assert.equal(constructions[0].maxAttempts, 1);
  assert.equal(constructions[0].credentials, undefined);
  assert.equal(constructions[0].endpoint, undefined);
  for (const level of ['trace', 'debug', 'info', 'warn', 'error']) assert.equal(constructions[0].logger[level]('synthetic'), undefined);
  assert.deepEqual(deadlines.map(d => d.ms), [20000, 20000]);
  assert.equal(sends[0].options.abortSignal, deadlines[0]);
  assert.equal(sends[1].options.abortSignal, deadlines[1]);
});
