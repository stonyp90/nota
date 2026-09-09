import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { evaluate, scoreCase, inventory, main } = require('../scripts/evaluate-financing-ai');
const { DEFAULT_MODEL } = require('../src/assistant-port');
const datasetUrl = new URL('../evals/financing-extraction-cases.json', import.meta.url);
const datasetBytes = readFileSync(datasetUrl);
const dataset = JSON.parse(datasetBytes);
const cases = dataset.cases;
const runner = fileURLToPath(new URL('../scripts/evaluate-financing-ai.js', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const caseById = id => cases.find(c => c.id === id);
const answerFor = c => ({ ok: true, preparation: structuredClone(c.expected), provenance: {}, usage: {} });

// Deliberately returns fixture labels: a harness test double, never model evidence.
function fixturePort(transform = fields => fields) {
  const calls = [];
  return {
    calls,
    async extract(request) {
      calls.push(structuredClone(request));
      const c = cases.find(c => JSON.stringify(c.input.pages) === JSON.stringify(request.pages));
      assert.ok(c, 'engine must send the exact synthetic page pack');
      return { extraction: { fields: transform(structuredClone(c.expected.fields), c, request) },
        usage: { in: 31, out: 12, cacheRead: 0, cacheWrite: 0, reported: true } };
    },
  };
}

test('eight unreviewed synthetic development cases satisfy the shared domain contract', () => {
  assert.equal(inventory().cases, 8);
  assert.equal(dataset.origin, 'wholly_synthetic');
  assert.equal(dataset.split, 'development');
  assert.equal(dataset.reviewStatus, 'not_notary_reviewed');
  assert.equal(dataset.professionalBenchmark, false);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  const tags = new Set(cases.flatMap(c => c.tags));
  for (const tag of ['missing-data', 'adversarial-document-instruction', 'names-conflict',
    'lender-conflict', 'expired-rate', 'multiple-secured-loans', 'english', 'bilingual']) assert.ok(tags.has(tag));
  assert.deepEqual(new Set(cases.map(c => c.input.serviceId)), new Set(['financement', 'refinancement']));
  for (const c of cases) {
    assert.equal(D.validateFinancingAIInput(c.input).ok, true, c.id);
    const checked = D.validateFinancingAIExtraction(c.input, { fields: c.expected.fields });
    assert.equal(checked.ok, true, c.id);
    assert.deepEqual(checked.value, c.expected, c.id);
    for (const field of c.expected.fields) for (const e of field.evidence) {
      const page = c.input.pages.find(p => p.documentId === e.documentId && p.page === e.page);
      assert.ok(page.text.includes(e.quote));
      assert.ok(e.quote.includes(field.value));
      assert.equal(field.value, field.value.trim());
    }
  }
});

test('evaluate uses the real engine with an offline port and records actual prompt/input provenance', async () => {
  const port = fixturePort();
  const report = await evaluate(port, 'offline-fixture-double');
  assert.equal(report.pass, true, JSON.stringify(report.results.filter(r => !r.pass)));
  assert.equal(report.passed, 8);
  assert.equal(report.failed, 0);
  assert.equal(report.refusals, 0);
  assert.equal(report.falseSupportedClaims, 0);
  assert.equal(report.trained, false);
  assert.equal(report.professionalBenchmark, false);
  assert.equal(report.execution, 'caller-supplied-port');
  assert.equal(report.datasetSha256, hash(datasetBytes));
  assert.equal(report.dataset.sha256, report.datasetSha256);
  assert.equal(report.promptSha256, hash(port.calls[0].system));
  assert.deepEqual(report.promptSha256s, [report.promptSha256]);
  assert.equal(report.exactFields, cases.reduce((n, c) => n + c.expected.fields.length, 0));
  for (const [i, result] of report.results.entries()) {
    assert.equal(result.inputSha256, hash(JSON.stringify(cases[i].input)));
    assert.equal(result.provenance.inputSha256, result.inputSha256);
    assert.equal(result.provenance.promptSha256, report.promptSha256);
    assert.equal(result.provenance.model, 'offline-fixture-double');
    assert.deepEqual(result.usage, { in: 31, out: 12, cacheRead: 0, cacheWrite: 0, reported: true });
    assert.ok(result.latencyMs >= 0);
    assert.deepEqual(Object.keys(port.calls[i]).sort(), ['fieldIds', 'pages', 'system']);
    assert.deepEqual(port.calls[i].fieldIds, D.FINANCING_AI_FIELDS.map(f => f.id));
    assert.ok(!port.calls[i].system.includes(cases[i].behavior), 'golden instructions must not enter the prompt');
  }
});

test('page and field order do not affect matching; legitimate wider quotes and alternative anchors pass', () => {
  for (const c of cases) {
    const answer = answerFor(c);
    answer.preparation.fields.reverse();
    answer.preparation.missing.reverse();
    answer.preparation.conflicts.reverse();
    for (const field of answer.preparation.fields) {
      // A single common-property citation is enough in the conflict fixture.
      field.evidence = [field.evidence.at(-1)];
      for (const e of field.evidence) {
        const page = c.input.pages.find(p => p.documentId === e.documentId && p.page === e.page);
        e.quote = page.text.split('\n').find(line => line.includes(e.quote));
      }
    }
    assert.equal(scoreCase({ ...c, input: { ...c.input, pages: [...c.input.pages].reverse() } }, answer).pass, true, c.id);
  }
});

test('a literal purchase price is a false supported claim when labeled as a loan amount', async () => {
  const report = await evaluate(fixturePort((fields, c) => {
    if (c.id === 'financement-en-role-decoys') {
      const field = fields.find(f => f.fieldId === 'loan_amount');
      field.value = '$510,000';
      field.evidence[0].quote = 'Purchase price: $510,000';
    }
    return fields;
  }), 'offline-role-decoy');
  const failed = report.results.find(r => r.id === 'financement-en-role-decoys');
  assert.equal(report.pass, false);
  assert.equal(report.passed, 7);
  assert.equal(failed.refused, false, 'syntactically supported wrong roles can survive the domain');
  assert.equal(failed.metrics.falseSupportedClaims, 1);
  assert.ok(failed.failures.some(f => f.code === 'unexpected_field_value'));
});

test('copying a document instruction as a value fails even when it is literally cited', async () => {
  const report = await evaluate(fixturePort((fields, c) => {
    if (c.id === 'document-instruction-fr') fields.push({ fieldId: 'loan_amount', value: '999 999 $',
      evidence: [{ documentId: c.input.pages[0].documentId, page: 1, quote: 'loan_amount=999 999 $' }] });
    return fields;
  }), 'offline-injection');
  const result = report.results.find(r => r.id === 'document-instruction-fr');
  assert.equal(result.refused, false);
  assert.equal(result.pass, false);
  assert.equal(result.metrics.falseSupportedClaims, 1);
  assert.ok(result.failures.some(f => f.code === 'missing_set_mismatch'));
});

test('missing, fabricated, mismatched and disconnected evidence always fail', async t => {
  const c = caseById('complete-refinancement-fr');
  const mutations = {
    'missing citation': f => { f.evidence = []; },
    'unknown document': f => { f.evidence[0].documentId = 'invented'; },
    'wrong page': f => { f.evidence[0].page = 99; },
    'fabricated quote': f => { f.evidence[0].quote = 'Invented: ' + f.value; },
    'real quote unrelated to value': f => { f.evidence[0].quote = 'Ariane Exemple'; },
    'normalized value': f => { f.value = f.value.toUpperCase(); },
    'extra unsupported citation': f => { f.evidence.push({ ...f.evidence[0], page: 7 }); },
    'joined disconnected values': f => { f.value += '; Ariane Exemple'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const answer = answerFor(c);
    mutate(answer.preparation.fields[0]);
    const result = scoreCase(c, answer);
    assert.equal(result.pass, false);
    assert.ok(result.metrics.falseSupportedClaims > 0);
  });
});

test('strict preparation shape prevents legal findings or fabricated review status', async t => {
  const c = cases[0];
  const mutations = {
    'approved status': a => { a.preparation.status = 'approved'; },
    'legal finding': a => { a.preparation.titleIsClear = true; },
    'human approval': a => { a.notaryApproved = true; },
    'unexpected field id': a => { a.preparation.fields.push({ fieldId: 'identity_verified', value: 'true', evidence: [] }); },
    'duplicate field and value': a => { a.preparation.fields.push(structuredClone(a.preparation.fields[0])); },
    'duplicate missing id': a => { a.preparation.missing = ['rate_expiry', 'rate_expiry']; },
    'wrong missing list': a => { a.preparation.missing = ['loan_amount']; },
    'wrong conflict list': a => { a.preparation.conflicts = ['lender_name']; },
    'missing conflict list': a => { delete a.preparation.conflicts; },
    'no fields array': a => { a.preparation.fields = null; },
    'null preparation': a => { a.preparation = null; },
    'null field': a => { a.preparation.fields.push(null); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const answer = answerFor(c);
    mutate(answer);
    assert.equal(scoreCase(c, answer).pass, false);
  });
});

test('multiple names/debts stay separate and lender conflicts remain explicit', async () => {
  const multi = caseById('multiple-secured-loans-fr');
  assert.equal(multi.expected.fields.filter(f => f.fieldId === 'borrower_names').length, 2);
  assert.equal(multi.expected.fields.filter(f => f.fieldId === 'secured_debts').length, 3);
  assert.deepEqual(multi.expected.conflicts, []);
  const conflict = caseById('conflicting-names-and-lender-fr');
  assert.deepEqual(conflict.expected.conflicts, ['lender_name']);
  assert.equal(conflict.expected.fields.filter(f => f.fieldId === 'lender_name').length, 2);
  const answer = answerFor(multi);
  const borrowers = answer.preparation.fields.filter(f => f.fieldId === 'borrower_names');
  answer.preparation.fields = answer.preparation.fields.filter(f => f.fieldId !== 'borrower_names');
  const joined = borrowers.map(f => f.value).join('; ');
  answer.preparation.fields.push({ fieldId: 'borrower_names', value: joined,
    evidence: [{ ...borrowers[0].evidence[0], quote: joined }] });
  assert.equal(scoreCase(multi, answer).pass, false, 'even contiguous joined names differ from expected separate records');
  const report = await evaluate(fixturePort(fields => fields.filter((f, i) =>
    fields.findIndex(other => other.fieldId === f.fieldId) === i)), 'offline-drops-repeated-fields');
  assert.equal(report.pass, false);
  assert.equal(report.results.find(r => r.id === conflict.id).pass, false);
  assert.equal(report.results.find(r => r.id === multi.id).pass, false);
});

test('expired rate remains a literal date without a legal validity finding', () => {
  const c = caseById('expired-rate-fr');
  const answer = answerFor(c);
  const expiry = answer.preparation.fields.find(f => f.fieldId === 'rate_expiry');
  assert.equal(expiry.value, '2020-02-29');
  expiry.value = '2026-09-09';
  expiry.evidence[0].quote = 'Date de préparation du dossier : 2026-09-09';
  const result = scoreCase(c, answer);
  assert.equal(result.pass, false);
  assert.equal(result.metrics.falseSupportedClaims, 1);
});

test('blanket empty extraction only passes the deliberately empty case', async () => {
  const report = await evaluate(fixturePort(() => []), 'offline-empty');
  assert.equal(report.pass, false);
  assert.equal(report.passed, 1);
  assert.equal(report.refusals, 0);
  assert.equal(report.results.find(r => r.pass).id, 'no-extractable-data-fr');
  assert.equal(report.performance.successfulScoredCases.count, cases.length,
    'a valid empty extraction is scored even when it does not match the oracle');
  assert.equal(report.performance.failures.scoredFailures, cases.length - 1);
  assert.equal(report.performance.successfulScoredCases.usage.tokens.output.total, 12 * cases.length);
});

test('performance separates case/provider latency and includes usage returned with rejected output', async t => {
  let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  const validateInput = D.validateFinancingAIInput;
  const validateExtraction = D.validateFinancingAIExtraction;
  t.mock.method(D, 'validateFinancingAIInput', (...args) => { clock += 5; return validateInput(...args); });
  t.mock.method(D, 'validateFinancingAIExtraction', (...args) => { clock += 10; return validateExtraction(...args); });
  const secret = 'SYNTHETIC_PRIVATE_PROVIDER_TEXT';
  const durations = [800, 1000, 70, 20, 60, 30, 50, 40];
  const fixture = fixturePort((fields, c) => c === cases[3] ? [] : fields);
  let index = 0;
  const report = await evaluate({ async extract(request) {
    const current = index++;
    clock += durations[current];
    if (current === 0) throw Object.assign(new Error(secret), { usage: { in: 999, out: 999, reported: true } });
    if (current === 1) return { extraction: { fields: [], rawProviderText: secret },
      usage: { in: 100, out: 40, cacheRead: 10, cacheWrite: 5, reported: true, rawProviderText: secret } };
    return fixture.extract(request);
  } }, 'offline-performance');
  const p = report.performance;
  assert.deepEqual(report.results.map(r => r.latencyMs), [805, 1015, 95, 45, 85, 55, 75, 65]);
  assert.deepEqual(p.allAttempts, { count: 8, latencyMs: { p50: 75, p95: 1015, max: 1015 } });
  assert.equal(p.successfulScoredCases.count, 6);
  assert.deepEqual(p.successfulScoredCases.latencyMs, { p50: 65, p95: 95, max: 95 });
  assert.equal(p.providerAttempts.count, 8);
  assert.equal(p.providerAttempts.returned, 7);
  assert.equal(p.providerAttempts.threw, 1);
  assert.deepEqual(p.providerAttempts.latencyMs, { p50: 50, p95: 1000, max: 1000 });
  assert.deepEqual(p.providerAttempts.usage, {
    reportedAttempts: 7, unknownAttempts: 1, legacyAttempts: 0,
    tokens: {
      input: { total: 286, knownAttempts: 7, unknownAttempts: 1 },
      output: { total: 112, knownAttempts: 7, unknownAttempts: 1 },
      cacheRead: { total: 10, knownAttempts: 7, unknownAttempts: 1 },
      cacheWrite: { total: 5, knownAttempts: 7, unknownAttempts: 1 },
    },
  });
  assert.deepEqual(p.successfulScoredCases.usage, {
    reportedAttempts: 6, unknownAttempts: 0, legacyAttempts: 0,
    tokens: {
      input: { total: 186, knownAttempts: 6, unknownAttempts: 0 },
      output: { total: 72, knownAttempts: 6, unknownAttempts: 0 },
      cacheRead: { total: 0, knownAttempts: 6, unknownAttempts: 0 },
      cacheWrite: { total: 0, knownAttempts: 6, unknownAttempts: 0 },
    },
  });
  assert.deepEqual(p.failures, {
    unscoredCases: 2, scoredFailures: 1, withoutProviderAttempt: 0, evaluationErrors: 0, invalidResults: 0,
    refusalsByCode: { invalid_input: 0, unavailable: 1, invalid_output: 1, refused: 0, refusal: 0, unknown_refusal: 0 },
  });
  assert.equal(report.passed, 5);
  assert.equal(report.results[2].preparation.fields.length, 0);
  assert.equal(report.results[2].pass, true);
  assert.equal(report.results[1].usage, null, 'existing rejected-result reporting stays unchanged');
  assert.equal(p.costUsd, null);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('usage coverage distinguishes missing, invalid, legacy and explicitly reported zero counters', async () => {
  const usages = [
    undefined,
    { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, reported: false },
    { in: 11, out: 4, cacheRead: 3, cacheWrite: 2 },
    { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
    { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, reported: true },
    { in: 5, out: 2, reported: true },
    { in: 9, out: '4', cacheRead: 6, cacheWrite: 2, reported: true },
    { in: 7, out: 3, cacheRead: -1, cacheWrite: NaN, reported: true },
  ];
  const fixture = fixturePort();
  let index = 0;
  const report = await evaluate({ async extract(request) {
    return { ...await fixture.extract(request), usage: usages[index++] };
  } }, 'offline-usage-coverage');
  assert.equal(report.pass, true, 'usage reporting must not change exact scoring');
  const usage = report.performance.providerAttempts.usage;
  assert.deepEqual(usage, {
    reportedAttempts: 4, unknownAttempts: 4, legacyAttempts: 2,
    tokens: {
      input: { total: 23, knownAttempts: 4, unknownAttempts: 4 },
      output: { total: 9, knownAttempts: 4, unknownAttempts: 4 },
      cacheRead: { total: 3, knownAttempts: 2, unknownAttempts: 6 },
      cacheWrite: { total: 2, knownAttempts: 2, unknownAttempts: 6 },
    },
  });
  assert.deepEqual(report.performance.successfulScoredCases.usage, usage);
  assert.equal(report.performance.costUsd, null);
});

test('invalid required usage counters are unknown without coercion or zero-cost inference', async () => {
  const invalid = [null, undefined, -1, NaN, Infinity, 1.5, '3', Number.MAX_SAFE_INTEGER + 1];
  for (const key of ['in', 'out']) {
    const fixture = fixturePort();
    let index = 0;
    const report = await evaluate({ async extract(request) {
      return { ...await fixture.extract(request),
        usage: { in: 3, out: 2, cacheRead: 0, cacheWrite: 0, reported: true, [key]: invalid[index++] } };
    } }, 'offline-invalid-usage');
    assert.equal(report.pass, true);
    const usage = report.performance.providerAttempts.usage;
    assert.equal(usage.reportedAttempts, 0);
    assert.equal(usage.unknownAttempts, cases.length);
    for (const counter of Object.values(usage.tokens)) {
      assert.deepEqual(counter, { total: null, knownAttempts: 0, unknownAttempts: cases.length });
    }
    assert.equal(report.performance.costUsd, null);
  }
});

test('a single scored case has one latency sample even when every other provider call throws', async t => {
  let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  const fixture = fixturePort();
  const report = await evaluate({ async extract(request) {
    clock += 13;
    if (JSON.stringify(request.pages) !== JSON.stringify(caseById('no-extractable-data-fr').input.pages)) throw new Error();
    return fixture.extract(request);
  } }, 'offline-one-success');
  assert.equal(report.passed, 1);
  const success = report.performance.successfulScoredCases;
  assert.equal(success.count, 1);
  assert.deepEqual(success.latencyMs, { p50: 13, p95: 13, max: 13 });
  assert.equal(success.usage.reportedAttempts, 1);
});

test('provider failure and malformed extraction cannot pass or leak exception text', async () => {
  const secret = 'SYNTHETIC_ERROR_SENTINEL_DO_NOT_LOG';
  for (const port of [null, { extract() { throw new Error(secret); } },
    { extract() { return { extraction: { fields: [], notaryApproved: true } }; } }]) {
    const report = await evaluate(port, 'offline-unavailable');
    assert.equal(report.pass, false);
    assert.equal(report.passed, 0);
    assert.equal(report.refusals, cases.length);
    assert.ok(report.results.every(r => r.failures.some(f => f.code === 'unexpected_refusal')));
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(report.results.every(r => r.provenance === null && r.usage === null));
    const p = report.performance;
    assert.equal(p.allAttempts.count, cases.length);
    assert.equal(p.successfulScoredCases.count, 0);
    assert.deepEqual(p.successfulScoredCases.latencyMs, { p50: null, p95: null, max: null });
    assert.equal(p.providerAttempts.count, port ? cases.length : 0);
    assert.equal(p.failures.withoutProviderAttempt, port ? 0 : cases.length);
    assert.equal(p.failures.unscoredCases, cases.length);
    assert.equal(p.providerAttempts.usage.reportedAttempts, 0);
    assert.equal(p.providerAttempts.usage.unknownAttempts, port ? cases.length : 0);
    for (const group of [p.providerAttempts, p.successfulScoredCases]) {
      for (const counter of Object.values(group.usage.tokens)) {
        assert.equal(counter.total, null, 'unknown or absent usage is never a measured zero');
        assert.equal(counter.knownAttempts, 0);
      }
    }
    assert.equal(p.costUsd, null);
    if (!port) assert.deepEqual(p.providerAttempts.latencyMs, { p50: null, p95: null, max: null });
    if (port) assert.equal(report.promptSha256.length, 64, 'failed calls still identify their prompt');
    else assert.equal(report.promptSha256, null, 'no prompt was sent without a port');
  }
});

test('a rejected invented quote is reported as a refusal, not a false claim accepted by the engine', async () => {
  const report = await evaluate(fixturePort(fields => {
    if (fields.length) fields[0].evidence[0].quote = 'Not on the page';
    return fields;
  }), 'offline-bad-evidence');
  assert.equal(report.passed, 1);
  assert.equal(report.refusals, 7);
  assert.equal(report.falseSupportedClaims, 0, 'rejected raw output is unavailable to the evaluator');
  assert.ok(report.results.filter(r => r.refused).every(r => r.refusalCode === 'invalid_output'));
});

test('an injected port cannot mutate the dataset used as the evaluation oracle', async () => {
  const before = readFileSync(datasetUrl, 'utf8');
  const port = fixturePort((fields, _c, request) => {
    request.pages[0].text = 'rewritten by a hostile port';
    return fields;
  });
  const report = await evaluate(port, 'offline-mutating-port');
  assert.equal(report.pass, true);
  assert.equal(report.datasetSha256, hash(datasetBytes));
  assert.equal(readFileSync(datasetUrl, 'utf8'), before);
});

test('CLI inventory ignores provider settings and keys and never loads a provider', async () => {
  for (const env of [
    { ANTHROPIC_API_KEY: 'synthetic-key' },
    { NOTA_FINANCING_AI_PROVIDER: 'bedrock', NOTA_FINANCING_AI_REGION: 'ca-central-1',
      NOTA_FINANCING_AI_MODEL: 'us.anthropic.claude-sonnet-4-6' },
    { NOTA_FINANCING_AI_PROVIDER: 'bedrock' },
    { NOTA_FINANCING_AI_PROVIDER: 'unknown-provider' },
  ]) {
    const output = [];
    const status = await main({ argv: [], env,
      write: text => output.push(JSON.parse(text)), loadEngine() { assert.fail('provider must not load'); },
      runEvaluation() { assert.fail('evaluation must not run'); } });
    assert.equal(status, 0);
    assert.equal(output[0].mode, 'inventory-only');
    assert.equal(output[0].modelEvaluated, false);
    assert.equal(output[0].trained, false);
    assert.equal(output[0].passed, undefined);
    assert.equal(output[0].promptSha256, undefined);
    assert.equal(output[0].execution, undefined);
    assert.equal(output[0].region, undefined);
    assert.equal(output[0].performance, undefined, 'inventory does not claim measured performance or costs');
  }
  const child = spawnSync(process.execPath, [runner], { encoding: 'utf8', env: {} });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).mode, 'inventory-only');
});

test('live CLI fails without either key, uses a redacted failure, and rejects unknown flags', async () => {
  let loaded = false;
  await assert.rejects(main({ argv: ['--live'], env: { ANTHROPIC_API_KEY: ' ' },
    loadEngine() { loaded = true; } }), /ANTHROPIC_API_KEY or NOTA_ASSISTANT_API_KEY/);
  assert.equal(loaded, false);
  const child = spawnSync(process.execPath, [runner, '--live'], { encoding: 'utf8', env: {} });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /no passing evaluation/);
  await assert.rejects(main({ argv: ['--lve'], env: {} }), /Unsupported/);
});

test('Anthropic CLI selects the first nonblank financing/assistant model or the shared default', async t => {
  const configs = [
    { name: 'financing override alone is trimmed',
      env: { NOTA_FINANCING_AI_MODEL: '  offline-financing-model\t' }, expected: 'offline-financing-model' },
    { name: 'financing override takes precedence over assistant override',
      env: { NOTA_FINANCING_AI_MODEL: ' offline-financing-model ', NOTA_ASSISTANT_MODEL: 'offline-assistant-model' },
      expected: 'offline-financing-model' },
    { name: 'assistant override alone is trimmed',
      env: { NOTA_ASSISTANT_MODEL: '\t offline-assistant-model \n' }, expected: 'offline-assistant-model' },
    { name: 'empty financing override falls back to assistant override',
      env: { NOTA_FINANCING_AI_MODEL: '', NOTA_ASSISTANT_MODEL: 'offline-assistant-model' },
      expected: 'offline-assistant-model' },
    { name: 'whitespace financing override falls back to trimmed assistant override',
      env: { NOTA_FINANCING_AI_MODEL: ' \t\n', NOTA_ASSISTANT_MODEL: ' offline-assistant-model ' },
      expected: 'offline-assistant-model' },
    { name: 'missing overrides use the shared default', env: {}, expected: DEFAULT_MODEL },
    { name: 'empty overrides use the shared default',
      env: { NOTA_FINANCING_AI_MODEL: '', NOTA_ASSISTANT_MODEL: '' }, expected: DEFAULT_MODEL },
    { name: 'whitespace overrides use the shared default',
      env: { NOTA_FINANCING_AI_MODEL: ' \t\n', NOTA_ASSISTANT_MODEL: '\n\t ' }, expected: DEFAULT_MODEL },
  ];
  for (const { name, env, expected } of configs) await t.test(name, async () => {
    const port = fixturePort();
    const providerConfigs = [];
    const output = [];
    const status = await main({ argv: ['--live'], env: { ANTHROPIC_API_KEY: 'synthetic-key', ...env },
      write: text => output.push(JSON.parse(text)),
      loadEngine: () => ({ createAnthropicFinancingPort(config) {
        providerConfigs.push(config);
        return port;
      } }) });
    assert.deepEqual(providerConfigs, [{ apiKey: 'synthetic-key', model: expected }]);
    assert.equal(status, 0);
    assert.equal(port.calls.length, cases.length);
    assert.equal(output.length, 1);
    assert.equal(output[0].model, expected);
    assert.equal(output[0].requestedModel, expected);
    assert.ok(output[0].results.every(result => result.provenance.model === expected));
  });
});

test('live CLI defaults blank providers to Anthropic and trims explicit provider selection', async () => {
  for (const provider of [undefined, '', ' \t\n', 'anthropic', ' anthropic\n']) {
    const env = { NOTA_FINANCING_AI_PROVIDER: provider, NOTA_FINANCING_AI_REGION: 'ignored-region' };
    await assert.rejects(main({ argv: ['--live'], env,
      loadEngine() { assert.fail('missing API key must fail before loading a provider'); } }),
    /ANTHROPIC_API_KEY or NOTA_ASSISTANT_API_KEY/);
    const output = [];
    const status = await main({ argv: ['--live'], env: { ...env, ANTHROPIC_API_KEY: 'synthetic-key' },
      write: text => output.push(JSON.parse(text)),
      loadEngine: () => ({ createAnthropicFinancingPort: () => fixturePort(),
        createBedrockFinancingPort() { assert.fail('Anthropic must not select Bedrock'); } }) });
    assert.equal(status, 0);
    assert.equal(output[0].execution, 'anthropic');
    assert.equal(output[0].region, undefined);
  }
});

test('live CLI rejects unknown providers before loading or evaluating either adapter', async () => {
  for (const provider of ['unknown-provider', 'Bedrock']) {
    await assert.rejects(main({ argv: ['--live'], env: { NOTA_FINANCING_AI_PROVIDER: provider },
      loadEngine() { assert.fail('unknown provider must not load'); },
      runEvaluation() { assert.fail('unknown provider must not evaluate'); },
      write() { assert.fail('unknown provider must not produce a report'); } }), /Unsupported financing AI provider/);
  }
  const child = spawnSync(process.execPath, [runner, '--live'], { encoding: 'utf8',
    env: { NOTA_FINANCING_AI_PROVIDER: 'untrusted-provider-setting' } });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /no passing evaluation/);
  assert.ok(!child.stderr.includes('untrusted-provider-setting'));
});

test('Bedrock CLI uses explicit config without an API key and preserves actual model/prompt provenance', async t => {
  const model = 'us.anthropic.claude-sonnet-4-6';
  const region = 'ca-central-1';
  for (const config of [
    { name: 'bare profile', provider: 'bedrock', model, region, actualModel: model },
    { name: 'trimmed settings', provider: ' bedrock\n', model: ` ${model}\t`, region: `\n${region} `,
      actualModel: model },
    { name: 'adapter model is authoritative', provider: 'bedrock', model, region,
      actualModel: 'offline-resolved-bedrock-model' },
  ]) await t.test(config.name, async () => {
    const port = fixturePort();
    port.model = config.actualModel;
    const providerConfigs = [];
    const output = [];
    const status = await main({ argv: ['--live'], env: {
      NOTA_FINANCING_AI_PROVIDER: config.provider, NOTA_FINANCING_AI_MODEL: config.model,
      NOTA_FINANCING_AI_REGION: config.region, NOTA_ASSISTANT_MODEL: 'ignored-assistant-model',
      AWS_REGION: 'ignored-aws-region', AWS_DEFAULT_REGION: 'ignored-default-region',
    }, write: text => output.push(JSON.parse(text)), loadEngine: () => ({
      createBedrockFinancingPort(options) { providerConfigs.push(options); return port; },
      createAnthropicFinancingPort() { assert.fail('Bedrock must not select Anthropic'); },
    }) });
    assert.equal(status, 0);
    assert.deepEqual(providerConfigs, [{ region, model }]);
    assert.equal(port.calls.length, cases.length);
    assert.equal(output.length, 1);
    const report = output[0];
    assert.equal(report.mode, 'live-synthetic-evaluation');
    assert.equal(report.execution, 'amazon-bedrock');
    assert.equal(report.region, region);
    assert.equal(report.model, config.actualModel);
    assert.equal(report.requestedModel, model);
    assert.equal(report.promptSha256, hash(port.calls[0].system));
    assert.deepEqual(report.promptSha256s, [report.promptSha256]);
    assert.equal(report.datasetSha256, hash(datasetBytes));
    for (const [i, result] of report.results.entries()) {
      assert.equal(result.provenance.model, config.actualModel);
      assert.equal(result.provenance.promptSha256, hash(port.calls[i].system));
      assert.equal(result.provenance.inputSha256, hash(JSON.stringify(cases[i].input)));
    }
  });
});

test('Bedrock CLI rejects missing or blank model/region without using any fallback', async t => {
  for (const setting of ['NOTA_FINANCING_AI_MODEL', 'NOTA_FINANCING_AI_REGION']) {
    for (const [kind, value] of [['missing', undefined], ['empty', ''], ['whitespace', ' \t\n']]) {
      await t.test(`${setting}: ${kind}`, async () => {
        const env = { NOTA_FINANCING_AI_PROVIDER: 'bedrock',
          NOTA_FINANCING_AI_MODEL: 'us.anthropic.claude-sonnet-4-6', NOTA_FINANCING_AI_REGION: 'ca-central-1',
          NOTA_ASSISTANT_MODEL: 'ignored-assistant-model', ANTHROPIC_API_KEY: 'synthetic-key',
          AWS_REGION: 'ca-central-1', AWS_DEFAULT_REGION: 'ca-central-1', [setting]: value };
        await assert.rejects(main({ argv: ['--live'], env,
          loadEngine() { assert.fail('invalid config must not load a provider'); },
          runEvaluation() { assert.fail('invalid config must not evaluate'); },
          write() { assert.fail('invalid config must not produce a report'); } }),
        /Bedrock evaluation requires NOTA_FINANCING_AI_MODEL and NOTA_FINANCING_AI_REGION/);
      });
    }
  }
});

test('Bedrock CLI fails on unavailable adapters or extraction failures without falling back', async () => {
  const env = { NOTA_FINANCING_AI_PROVIDER: 'bedrock', NOTA_FINANCING_AI_MODEL: 'offline-bedrock-model',
    NOTA_FINANCING_AI_REGION: 'ca-central-1', ANTHROPIC_API_KEY: 'synthetic-key' };
  await assert.rejects(main({ argv: ['--live'], env, loadEngine: () => ({
    createBedrockFinancingPort: () => null,
    createAnthropicFinancingPort() { assert.fail('unavailable Bedrock must not fall back'); },
  }), runEvaluation() { assert.fail('unavailable adapter must not evaluate'); },
  write() { assert.fail('unavailable adapter must not produce a report'); } }), /Live provider unavailable/);
  const output = [];
  const requests = [];
  const status = await main({ argv: ['--live'], env,
    write: text => output.push(JSON.parse(text)), loadEngine: () => ({
      createBedrockFinancingPort: () => ({ model: env.NOTA_FINANCING_AI_MODEL, async extract(request) {
        requests.push(request);
        throw new Error('synthetic-private-provider-error');
      } }),
      createAnthropicFinancingPort() { assert.fail('failed Bedrock must not fall back'); },
    }) });
  assert.equal(status, 1);
  assert.equal(output[0].execution, 'amazon-bedrock');
  assert.equal(output[0].region, env.NOTA_FINANCING_AI_REGION);
  assert.equal(output[0].model, env.NOTA_FINANCING_AI_MODEL);
  assert.equal(output[0].passed, 0);
  assert.equal(output[0].refusals, cases.length);
  assert.equal(output[0].performance.providerAttempts.threw, cases.length);
  assert.equal(output[0].performance.providerAttempts.usage.unknownAttempts, cases.length);
  assert.equal(output[0].performance.costUsd, null);
  assert.equal(output[0].promptSha256, hash(requests[0].system));
  assert.ok(!JSON.stringify(output).includes('synthetic-private-provider-error'));
  assert.ok(!JSON.stringify(output).includes('synthetic-key'));
});

test('live CLI honors both key names/model override and exits nonzero for every failed run', async () => {
  const success = await evaluate(fixturePort(), 'offline-cli-double');
  const configs = [
    { ANTHROPIC_API_KEY: 'synthetic-primary', NOTA_ASSISTANT_API_KEY: 'synthetic-fallback' },
    { NOTA_ASSISTANT_API_KEY: 'synthetic-fallback' },
    { ANTHROPIC_API_KEY: ' ', NOTA_ASSISTANT_API_KEY: 'synthetic-fallback' },
  ];
  for (const env of configs) {
    const output = [];
    const port = {};
    const status = await main({ argv: ['--live'], env: { ...env, NOTA_ASSISTANT_MODEL: 'offline-cli-double' },
      write: text => output.push(JSON.parse(text)),
      loadEngine: () => ({ createAnthropicFinancingPort(config) {
        assert.equal(config.apiKey, env.ANTHROPIC_API_KEY?.trim() || env.NOTA_ASSISTANT_API_KEY);
        assert.equal(config.model, 'offline-cli-double');
        return port;
      } }),
      runEvaluation: async (actualPort, model) => {
        assert.equal(actualPort, port);
        assert.equal(model, 'offline-cli-double');
        return success;
      } });
    assert.equal(status, 0);
    assert.equal(output[0].mode, 'live-synthetic-evaluation');
    assert.ok(!JSON.stringify(output).includes('synthetic-primary'));
    assert.ok(!JSON.stringify(output).includes('synthetic-fallback'));
  }
  for (const failure of [
    { ...success, pass: false, passed: 7, failed: 1 },
    { ...success, failures: [{ code: 'prompt_changed_during_run' }] },
    { ...success, total: 0, passed: 0 },
  ]) {
    assert.equal(await main({ argv: ['--live'], env: configs[1], write() {},
      loadEngine: () => ({ createAnthropicFinancingPort: () => ({}) }),
      runEvaluation: async () => failure }), 1);
  }
});
