'use strict';

// Cross-service synthetic regression checks. This is a controlled evaluation
// loop, never a claim of professional accuracy and never a model-weight
// training job. Customer documents stay out of this dataset.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const D = require('@nota/domain');

const datasetBytes = readFileSync(require.resolve('../evals/notary-ai-extraction-cases.json'));
const dataset = JSON.parse(datasetBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const sameSet = (actual, expected) => Array.isArray(actual) &&
  actual.every(value => typeof value === 'string') && new Set(actual).size === actual.length &&
  isDeepStrictEqual([...actual].sort(), [...expected].sort());
const fieldKey = field => JSON.stringify([field.fieldId, field.value]);
const services = ['financement', 'refinancement', 'testament', 'procuration'];
const financingServices = new Set(['financement', 'refinancement']);

function domainInput(input) {
  return financingServices.has(input?.serviceId) ? D.validateFinancingAIInput(input) : D.validateActAIInput(input);
}

function domainExtraction(input, fields) {
  return financingServices.has(input?.serviceId)
    ? D.validateFinancingAIExtraction(input, { fields })
    : D.validateActAIExtraction(input, { fields });
}

function knowledgeVersion(serviceId) {
  return financingServices.has(serviceId)
    ? D.FINANCING_KNOWLEDGE.version
    : D.notaryServiceKnowledge(serviceId).version;
}

function datasetProvenance() {
  return {
    id: dataset.datasetId, version: dataset.version, split: dataset.split,
    origin: dataset.origin, reviewStatus: dataset.reviewStatus,
    professionalBenchmark: false, sha256: sha256(datasetBytes),
    hashEncoding: 'sha256 of exact UTF-8 dataset file bytes',
  };
}

function validateDataset() {
  if (dataset.origin !== 'wholly_synthetic' || dataset.split !== 'development' ||
      dataset.reviewStatus !== 'not_notary_reviewed' || dataset.professionalBenchmark !== false ||
      !dataset.datasetId || !dataset.version || !record(dataset.fieldIds) ||
      !Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Invalid synthetic notary AI dataset metadata.');
  }
  for (const serviceId of services) {
    if (!sameSet(dataset.fieldIds[serviceId], D.actAIFields(serviceId).map(field => field.id))) {
      throw new Error('Synthetic dataset field vocabulary is out of sync for ' + serviceId + '.');
    }
  }
  const ids = new Set();
  for (const c of dataset.cases) {
    if (!c.id || ids.has(c.id) || !services.includes(c.input?.serviceId) || !record(c.expected) ||
        !exactKeys(c.expected, ['fields', 'missing', 'conflicts', 'status'])) {
      throw new Error('Invalid synthetic case identity or expectation.');
    }
    ids.add(c.id);
    const checkedInput = domainInput(c.input);
    const checkedOutput = domainExtraction(c.input, c.expected.fields);
    if (!checkedInput.ok || !checkedOutput.ok || !isDeepStrictEqual(checkedOutput.value, c.expected)) {
      throw new Error('Synthetic expectation does not match the domain contract for ' + c.id + '.');
    }
  }
}

function inventory() {
  validateDataset();
  return {
    mode: 'inventory-only', modelEvaluated: false, trained: false,
    learningMode: 'controlled_evaluation', notaryReviewRequired: true,
    dataset: datasetProvenance(), cases: dataset.cases.length,
    services: Object.fromEntries(services.map(serviceId => [serviceId, {
      cases: dataset.cases.filter(c => c.input.serviceId === serviceId).length,
      fields: dataset.fieldIds[serviceId],
    }])),
    limitation: 'Unreviewed synthetic development fixtures. No live model run, professional benchmark or measured time saving.',
  };
}

function scoreCase(c, answer) {
  const failures = [];
  const fail = (code, details = {}) => failures.push({ code, ...details });
  const metrics = { expectedFields: c.expected.fields.length, returnedFields: 0,
    exactFields: 0, evidencedFields: 0, falseSupportedClaims: 0 };
  if (!record(answer) || answer.ok !== true) {
    fail('unexpected_refusal');
    return { pass: false, refused: record(answer) && answer.ok === false, failures, metrics };
  }
  if (!exactKeys(answer, ['ok', 'preparation', 'provenance', 'usage'])) fail('unexpected_result_shape');
  const preparation = answer.preparation;
  if (!exactKeys(preparation, ['fields', 'missing', 'conflicts', 'status'])) fail('unexpected_preparation_shape');
  if (!record(preparation)) return { pass: false, refused: false, failures, metrics };
  if (preparation.status !== c.expected.status) fail('unsafe_review_status');
  if (!sameSet(preparation.missing, c.expected.missing)) fail('missing_set_mismatch');
  if (!sameSet(preparation.conflicts, c.expected.conflicts)) fail('conflict_set_mismatch');
  const checked = domainExtraction(c.input, preparation.fields);
  if (!checked.ok) fail('domain_rejected_preparation');
  else if (!sameSet(preparation.missing, checked.value.missing) || !sameSet(preparation.conflicts, checked.value.conflicts)) {
    fail('inconsistent_preparation');
  }

  const expected = new Map(c.expected.fields.map(field => [fieldKey(field), field]));
  const seen = new Set();
  const fields = Array.isArray(preparation.fields) ? preparation.fields : [];
  metrics.returnedFields = fields.length;
  for (const field of fields) {
    if (!exactKeys(field, ['fieldId', 'value', 'evidence']) || typeof field.value !== 'string') {
      fail('invalid_field_shape'); metrics.falseSupportedClaims++; continue;
    }
    const key = fieldKey(field);
    const gold = expected.get(key);
    if (seen.has(key)) fail('duplicate_field', { fieldId: field.fieldId });
    seen.add(key);
    if (!gold) fail('unexpected_field_value', { fieldId: field.fieldId, value: field.value });
    else metrics.exactFields++;
    let supported = Array.isArray(field.evidence) && field.evidence.length > 0;
    if (!supported) fail('missing_evidence', { fieldId: field.fieldId });
    for (const evidence of Array.isArray(field.evidence) ? field.evidence : []) {
      const page = record(evidence) && c.input.pages.find(p => p.documentId === evidence.documentId && p.page === evidence.page);
      if (!exactKeys(evidence, ['documentId', 'page', 'quote']) || !page || typeof evidence.quote !== 'string' ||
          !evidence.quote.trim() || !field.value.trim() || !page.text.includes(evidence.quote) ||
          !evidence.quote.includes(field.value.trim())) {
        supported = false; fail('invalid_page_evidence', { fieldId: field.fieldId });
      } else if (gold && !gold.evidence.some(anchor => anchor.documentId === evidence.documentId &&
          anchor.page === evidence.page && evidence.quote.includes(anchor.quote))) {
        supported = false; fail('unexpected_evidence_anchor', { fieldId: field.fieldId });
      }
    }
    if (supported) metrics.evidencedFields++;
    if (!gold || !supported) metrics.falseSupportedClaims++;
  }
  for (const [key, field] of expected) if (!seen.has(key)) fail('expected_field_absent', { fieldId: field.fieldId });
  return { pass: !failures.length, refused: false, failures, metrics };
}

function usageSample(usage) {
  const valid = value => Number.isSafeInteger(value) && value >= 0;
  return {
    in: valid(usage?.in) ? usage.in : null,
    out: valid(usage?.out) ? usage.out : null,
    reported: usage?.reported === true && valid(usage?.in) && valid(usage?.out),
  };
}

function latencySummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null };
}

async function evaluate(port, model) {
  validateDataset();
  const { createFinancingAI, createActAI } = require('../src/financing-ai');
  const selectedModel = (port && port.model) || model || 'unknown-model';
  const calls = [];
  const latencies = [];
  const provider = port && typeof port.extract === 'function' ? {
    model: port.model,
    async extract(request) {
      const started = Date.now();
      try {
        const response = await port.extract(request);
        calls.push({ serviceId: request.serviceId || null, system: request.system });
        return response;
      } finally {
        latencies.push(Date.now() - started);
      }
    },
  } : port;
  const promptHashes = new Map();
  const results = [];
  for (const c of dataset.cases) {
    const started = Date.now();
    const inputSha256 = sha256(JSON.stringify(c.input));
    let answer;
    let error = false;
    const observed = provider && typeof provider.extract === 'function' ? provider : null;
    const engine = financingServices.has(c.input.serviceId)
      ? createFinancingAI({ port: observed, model: selectedModel })
      : createActAI({ serviceId: c.input.serviceId, port: observed, model: selectedModel });
    try { answer = await engine.prepare(structuredClone(c.input)); } catch { error = true; }
    const scored = scoreCase(c, answer);
    const prompt = calls.at(-1)?.system;
    const promptSha256 = typeof prompt === 'string' ? sha256(prompt) : null;
    if (promptSha256) {
      const prior = promptHashes.get(c.input.serviceId);
      if (prior && prior !== promptSha256) scored.failures.push({ code: 'prompt_changed_during_run' });
      promptHashes.set(c.input.serviceId, promptSha256);
    }
    if (error) scored.failures.push({ code: 'evaluation_error' });
    if (answer?.ok === true) {
      const provenance = answer.provenance;
      if (!record(provenance) || provenance.model !== selectedModel || provenance.inputSha256 !== inputSha256 ||
          provenance.promptSha256 !== promptSha256 || provenance.knowledgeVersion !== knowledgeVersion(c.input.serviceId)) {
        scored.failures.push({ code: 'provenance_mismatch' });
      }
    }
    results.push({ id: c.id, serviceId: c.input.serviceId, ...scored, error,
      inputSha256, promptSha256, provenance: answer?.ok === true ? answer.provenance : null,
      usage: answer?.ok === true ? answer.usage : null, latencyMs: Date.now() - started });
  }
  const passed = results.filter(r => r.pass && !r.error).length;
  const sum = name => results.reduce((total, r) => total + r.metrics[name], 0);
  return {
    mode: 'synthetic-evaluation', execution: 'caller-supplied-port', model: selectedModel,
    generatedAt: new Date().toISOString(), dataset: datasetProvenance(), datasetSha256: sha256(datasetBytes),
    knowledgeVersions: Object.fromEntries(services.map(serviceId => [serviceId, knowledgeVersion(serviceId)])),
    promptSha256: Object.fromEntries([...promptHashes.entries()]),
    trained: false, learningMode: 'controlled_evaluation', notaryReviewRequired: true,
    professionalBenchmark: false, pass: passed === results.length, passed, failed: results.length - passed,
    total: results.length, refusals: results.filter(r => r.refused).length, errors: results.filter(r => r.error).length,
    expectedFields: sum('expectedFields'), returnedFields: sum('returnedFields'),
    exactFields: sum('exactFields'), evidencedFields: sum('evidencedFields'), falseSupportedClaims: sum('falseSupportedClaims'),
    performance: { cases: latencySummary(results.map(r => r.latencyMs)), provider: latencySummary(latencies), providerCalls: latencies.length,
      usage: { reported: results.filter(r => r.usage?.reported).length, unknown: results.filter(r => !r.usage?.reported).length } },
    limitation: 'Exact regression checks on unreviewed synthetic development data. No professional accuracy, legal decision, notary approval or time saving is established.',
    results,
  };
}

async function main({ argv = process.argv.slice(2), env = process.env, write = console.log,
  loadEngine = () => require('../src/financing-ai'), runEvaluation = evaluate } = {}) {
  if (argv.some(arg => arg !== '--live') || argv.length > 1) throw new Error('Unsupported evaluation arguments.');
  if (!argv.includes('--live')) { write(JSON.stringify(inventory(), null, 2)); return 0; }
  const providerName = (env.NOTA_AI_EVAL_PROVIDER || env.NOTA_FINANCING_AI_PROVIDER || '').trim() || 'anthropic';
  if (!['anthropic', 'bedrock'].includes(providerName)) throw new Error('Unsupported AI evaluation provider.');
  let model, port, region;
  if (providerName === 'bedrock') {
    model = (env.NOTA_AI_EVAL_MODEL || env.NOTA_FINANCING_AI_MODEL || '').trim();
    region = (env.NOTA_AI_EVAL_REGION || env.NOTA_FINANCING_AI_REGION || '').trim();
    if (!model || !region) throw new Error('Live evaluation requires an explicit Bedrock model and region.');
    port = loadEngine().createBedrockFinancingPort({ region, model });
  } else {
    const apiKey = [env.ANTHROPIC_API_KEY, env.NOTA_ASSISTANT_API_KEY]
      .find(value => typeof value === 'string' && value.trim());
    if (!apiKey) throw new Error('Live evaluation requires ANTHROPIC_API_KEY or NOTA_ASSISTANT_API_KEY.');
    model = (env.NOTA_AI_EVAL_MODEL || env.NOTA_FINANCING_AI_MODEL || env.NOTA_ASSISTANT_MODEL || '').trim() || 'claude-sonnet-4-20250514';
    port = loadEngine().createAnthropicFinancingPort({ apiKey, model });
  }
  if (!port) throw new Error('Live provider unavailable.');
  const report = await runEvaluation(port, model);
  write(JSON.stringify({ ...report, mode: 'live-synthetic-evaluation', execution: providerName === 'bedrock' ? 'amazon-bedrock' : 'anthropic', ...(region ? { region } : {}) }, null, 2));
  return report.pass ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('Notary AI evaluation could not run. Check provider settings, credentials, engine availability and dataset validity.');
  process.exitCode = 1;
});

module.exports = { evaluate, scoreCase, inventory, main };
