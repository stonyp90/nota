import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { evaluate, scoreCase, inventory, main } = require('../scripts/evaluate-notary-ai');
const dataset = JSON.parse(readFileSync(new URL('../evals/notary-ai-extraction-cases.json', import.meta.url)));
const cases = dataset.cases;
const hash = value => createHash('sha256').update(value).digest('hex');

function fixturePort() {
  const calls = [];
  return {
    model: 'offline-four-service-fixture', calls,
    async extract(request) {
      calls.push(structuredClone(request));
      const c = cases.find(item => JSON.stringify(item.input.pages) === JSON.stringify(request.pages));
      assert.ok(c, 'the engine must send the exact synthetic page pack');
      return { extraction: { fields: structuredClone(c.expected.fields) }, usage: { in: 41, out: 17, reported: true } };
    },
  };
}

test('the development inventory covers all four active notary services without claiming training', () => {
  const report = inventory();
  assert.equal(report.cases, 4);
  assert.equal(report.trained, false);
  assert.equal(report.learningMode, 'controlled_evaluation');
  assert.equal(report.notaryReviewRequired, true);
  assert.deepEqual(Object.keys(report.services).sort(), ['financement', 'procuration', 'refinancement', 'testament']);
  assert.ok(report.services.financement.fields.includes('purchase_price'));
  assert.ok(report.services.refinancement.fields.includes('payout_valid_through'));
  assert.ok(report.services.testament.fields.includes('testament_formalities'));
  assert.ok(report.services.procuration.fields.includes('mandate_regime'));
  for (const c of cases) assert.equal(D.validateActAIInput(c.input).ok || D.validateFinancingAIInput(c.input).ok, true, c.id);
});

test('one offline evaluation exercises financing, refinancing, testament and procuration provenance', async () => {
  const port = fixturePort();
  const report = await evaluate(port, port.model);
  assert.equal(report.pass, true, JSON.stringify(report.results.filter(r => !r.pass)));
  assert.equal(report.passed, 4);
  assert.equal(report.failed, 0);
  assert.equal(report.falseSupportedClaims, 0);
  assert.equal(report.trained, false);
  assert.equal(report.professionalBenchmark, false);
  assert.equal(report.dataset.sha256, hash(readFileSync(new URL('../evals/notary-ai-extraction-cases.json', import.meta.url))));
  assert.deepEqual(Object.keys(report.promptSha256).sort(), ['financement', 'procuration', 'refinancement', 'testament']);
  assert.equal(port.calls.length, 4);
  for (const [index, c] of cases.entries()) {
    assert.deepEqual(port.calls[index].fieldIds, D.actAIFields(c.input.serviceId).map(field => field.id));
    assert.ok(!port.calls[index].system.includes(c.id));
    assert.equal(report.results[index].provenance.model, port.model);
    assert.equal(report.results[index].usage.reported, true);
  }
});

test('the evaluator rejects a legal finding, an unsupported field and altered evidence', () => {
  const c = cases.find(item => item.input.serviceId === 'procuration');
  const answer = { ok: true, preparation: structuredClone(c.expected), provenance: {}, usage: {} };
  answer.preparation.fields.push({ fieldId: 'capacity_confirmed', value: 'oui', evidence: [] });
  assert.equal(scoreCase(c, answer).pass, false);

  const altered = { ok: true, preparation: structuredClone(c.expected), provenance: {}, usage: {} };
  altered.preparation.fields[0].evidence[0].quote = 'Le client a conclu un mandat de protection.';
  assert.equal(scoreCase(c, altered).pass, false);
});

test('the CLI inventory is offline and a live run refuses to pretend without credentials', async () => {
  const output = [];
  assert.equal(await main({ argv: [], write: value => output.push(value) }), 0);
  assert.match(output[0], /"trained": false/);
  await assert.rejects(main({ argv: ['--live'], env: {}, write: () => {} }), /requires ANTHROPIC_API_KEY/);
});
