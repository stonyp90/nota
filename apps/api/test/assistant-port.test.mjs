import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { createAnthropicAssistant, ANSWER_SCHEMA, DEFAULT_MODEL } = require('../src/assistant-port');

// Synthetic fixtures exercise the actual transport contract without calling
// a provider. They do not measure a live model's answer quality.
const good = { repond: true, niveau: 2, motif: null, texte: 'Consultez votre espace client.' };
const input = { systeme: 'Reviewed support policy.', question: 'Pouvez-vous préciser ?', locale: 'fr' };
const response = (answer = good, overrides = {}) => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }],
  usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 150 }, ...overrides,
});
function setup(reply = response(), options = {}) {
  const calls = [];
  const client = { messages: { async create(body, config) {
    calls.push({ body, config });
    return typeof reply === 'function' ? reply(body) : reply;
  } } };
  return { calls, port: createAnthropicAssistant({ apiKey: 'synthetic-test-key', client, ...options }) };
}

test('missing or blank credentials disable the transport, including an injected client', () => {
  for (const apiKey of [undefined, null, '', '  ', 123, {}]) assert.equal(setup(response(), { apiKey }).port, null);
});

test('transport sends one ordered conversation, a cached system prompt, and the strict answer schema', async () => {
  const { calls, port } = setup();
  const result = await port.answer({ ...input, historique: [
    { de: 'visiteur', texte: 'Bonjour.' },
    { de: 'assistant', texte: 'Bonjour !' },
    { de: 'nota', texte: 'La personne reprend ici.' },
  ] });
  assert.deepEqual(result, { ...good, locale: 'fr', usage: { in: 200, out: 30, cacheRead: 150 } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.messages, [
    { role: 'user', content: 'Bonjour.' },
    { role: 'assistant', content: 'Bonjour !' },
    { role: 'assistant', content: 'La personne reprend ici.' },
    { role: 'user', content: input.question },
  ]);
  assert.deepEqual(calls[0].body.system, [{ type: 'text', text: input.systeme, cache_control: { type: 'ephemeral' } }]);
  assert.equal(calls[0].body.model, DEFAULT_MODEL);
  assert.deepEqual(calls[0].body.output_config.format, { type: 'json_schema', schema: ANSWER_SCHEMA });
  assert.equal(calls[0].body.tools, undefined);
  assert.deepEqual(calls[0].config, { timeout: 20000, maxRetries: 0 });
});

test('configured transport limits reach each request and invalid numeric limits use bounded defaults', async () => {
  const custom = setup(response(), { model: 'synthetic-model', maxTokens: 600, effort: 'medium', timeoutMs: 12000 });
  await custom.port.answer(input);
  assert.equal(custom.calls[0].body.model, 'synthetic-model');
  assert.equal(custom.calls[0].body.max_tokens, 600);
  assert.equal(custom.calls[0].body.output_config.effort, 'medium');
  assert.deepEqual(custom.calls[0].config, { timeout: 12000, maxRetries: 0 });
  for (const invalid of [0, -1, NaN, Infinity, '12000']) {
    const { calls, port } = setup(response(), { timeoutMs: invalid, maxTokens: invalid });
    await port.answer(input);
    assert.equal(calls[0].config.timeout, 20000);
    assert.equal(calls[0].body.max_tokens, 1500);
  }
});

test('SDK initialization is lazy, reused, and never logs visitor payloads', async () => {
  const source = readFileSync(new URL('../src/assistant-port.js', import.meta.url), 'utf8');
  const clients = [];
  let loads = 0;
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, require(name) {
    assert.equal(name, '@anthropic-ai/sdk');
    loads++;
    return class {
      constructor(config) { clients.push(config); }
      messages = { async create() { return response(); } };
    };
  } });
  const port = module.exports.createAnthropicAssistant({ apiKey: 'synthetic-test-key', timeoutMs: 12000 });
  assert.equal(loads, 0);
  await port.answer(input);
  await port.answer(input);
  assert.equal(loads, 1);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].logLevel, 'off');
  assert.equal(clients[0].timeout, 12000);
  assert.equal(clients[0].maxRetries, 0);
});

test('truncated or unfinished turns fail closed even with syntactically complete answers', async t => {
  for (const stop_reason of ['max_tokens', 'refusal', 'tool_use', 'pause_turn', 'stop_sequence', null, undefined]) {
    await t.test(String(stop_reason), async () => {
      const { port } = setup(response(good, { stop_reason }));
      assert.deepEqual(await port.answer(input), { texte: null, repond: false, niveau: null, motif: 'inconnu', usage: { in: 200, out: 30, cacheRead: 150 } });
    });
  }
});

test('malformed provider content never throws or invents a valid answer', async t => {
  const cases = [
    ['missing response', null],
    ['missing content', response(good, { content: undefined })],
    ['object content', response(good, { content: {} })],
    ['empty content', response(good, { content: [] })],
    ['null block', response(good, { content: [null] })],
    ['non-string text', response(good, { content: [{ type: 'text', text: {} }] })],
    ['broken JSON', response(good, { content: [{ type: 'text', text: '{"repond":true' }] })],
    ['markdown wrapper', response(good, { content: [{ type: 'text', text: '```json\n' + JSON.stringify(good) + '\n```' }] })],
    ['multiple text blocks', response(good, { content: [{ type: 'text', text: '{' }, { type: 'text', text: JSON.stringify(good).slice(1) }] })],
    ['unexpected tool', response(good, { content: [{ type: 'text', text: JSON.stringify(good) }, { type: 'tool_use', name: 'refund' }] })],
  ];
  for (const [name, reply] of cases) await t.test(name, async () => {
    const result = await setup(reply).port.answer(input);
    assert.equal(result.repond, false);
    assert.equal(result.texte, null);
    assert.equal(result.motif, 'inconnu');
  });
});

test('schema violations and contradictory routing fields are rejected without coercion', async t => {
  const cases = [null, [], 'answer', {}, { ...good, extra: 'unexpected' },
    { ...good, repond: 'true' }, { ...good, niveau: '2' }, { ...good, niveau: 4 },
    { ...good, motif: 'dossier_precis' }, { ...good, texte: 17 },
    { repond: true, niveau: 1, texte: good.texte },
    { ...good, repond: false, niveau: 2 }, { ...good, repond: false, niveau: null, motif: {} },
  ];
  for (const [index, answer] of cases.entries()) await t.test(`invalid structure ${index + 1}`, async () => {
    const result = await setup(response(answer)).port.answer(input);
    assert.equal(result.repond, false);
    assert.equal(result.texte, null);
  });
});

test('valid thinking blocks do not leak and proper model handoffs preserve their reason', async () => {
  const handoff = { repond: false, niveau: null, motif: 'dossier_precis', texte: '  Je transmets à Nota.  ' };
  const reply = response(handoff);
  reply.content.unshift({ type: 'thinking', thinking: 'PRIVATE_PROVIDER_REASONING' }, { type: 'redacted_thinking', data: 'PRIVATE_PROVIDER_DATA' });
  const result = await setup(reply).port.answer(input);
  assert.deepEqual(result, { ...handoff, texte: handoff.texte.trim(), locale: 'fr', usage: { in: 200, out: 30, cacheRead: 150 } });
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PROVIDER'));
});

test('usage retains only non-negative integer token counts', async () => {
  const { port } = setup(response(good, { usage: { input_tokens: -1, output_tokens: '30', cache_read_input_tokens: Infinity, raw: 'PRIVATE' } }));
  assert.deepEqual((await port.answer(input)).usage, { in: 0, out: 0, cacheRead: 0 });
});

test('transport errors remove raw provider details and never trigger an implicit retry', async () => {
  const { calls, port } = setup(() => { throw new Error('PRIVATE_QUESTION synthetic-test-key'); });
  await assert.rejects(port.answer(input), error => {
    assert.equal(error.message, 'Support assistant provider unavailable.');
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes('PRIVATE_QUESTION'));
    return true;
  });
  assert.equal(calls.length, 1);
});

test('concurrent questions never share conversation state', async () => {
  const { calls, port } = setup(async body => {
    await Promise.resolve();
    return response({ ...good, texte: body.messages.at(-1).content });
  });
  const results = await Promise.all(['First thread', 'Second thread'].map(question => port.answer({ ...input, question })));
  assert.deepEqual(results.map(result => result.texte), ['First thread', 'Second thread']);
  assert.deepEqual(calls.map(call => call.body.messages.length), [1, 1]);
});
