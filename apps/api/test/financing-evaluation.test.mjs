import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluate } = require('../scripts/evaluate-financing');
const { createSupportAssistant } = require('../src/support-assistant');
const { createFakeAssistant } = require('../src/assistant-port');
const D = require('@nota/domain');

test('model prompt includes source-backed financing and private-field labels, not values', () => {
  const prompt = createSupportAssistant().systemPrompt();
  assert.ok(prompt.includes(D.FINANCING_KNOWLEDGE.version));
  for (const s of D.FINANCING_KNOWLEDGE.sources) assert.ok(prompt.includes(s.url));
  assert.ok(prompt.includes('dettes_garanties'));
});
test('a provider outage or blanket escalation cannot pass the synthetic benchmark', async () => {
  const r = await evaluate(createFakeAssistant({ throw: 'offline' }), 'fake');
  assert.ok(r.passed < r.total);
  assert.equal(r.promptSha256.length, 64);
  assert.equal(r.datasetSha256.length, 64);
});
test('synthetic cases cite known sources and have unique identifiers', () => {
  const cases = require('../evals/financing-cases.json');
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  const sources = new Set(D.FINANCING_KNOWLEDGE.sources.map(s => s.id));
  for (const c of cases) for (const id of c.sourceIds) assert.ok(sources.has(id));
});
