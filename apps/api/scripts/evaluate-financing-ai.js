'use strict';

// Synthetic development regression checks, never professional ground truth.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const D = require('@nota/domain');

const datasetBytes = readFileSync(require.resolve('../evals/financing-extraction-cases.json'));
const dataset = JSON.parse(datasetBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const sameSet = (actual, expected) => Array.isArray(actual) &&
  actual.every(value => typeof value === 'string') && new Set(actual).size === actual.length &&
  isDeepStrictEqual([...actual].sort(), [...expected].sort());
const fieldKey = field => JSON.stringify([field.fieldId, field.value]);

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
      !dataset.datasetId || !dataset.version || !Array.isArray(dataset.cases) || !dataset.cases.length ||
      !sameSet(dataset.fieldIds, D.FINANCING_AI_FIELDS.map(field => field.id))) {
    throw new Error('Invalid synthetic development dataset metadata.');
  }
  const ids = new Set();
  for (const c of dataset.cases) {
    if (!c.id || ids.has(c.id) || !record(c.expected) ||
        !exactKeys(c.expected, ['fields', 'missing', 'conflicts', 'status'])) {
      throw new Error('Invalid synthetic case identity or expectation.');
    }
    ids.add(c.id);
    // The domain owns admissible fields, bounds, literal evidence and conflicts.
    const checked = D.validateFinancingAIExtraction(c.input, { fields: c.expected.fields });
    if (!checked.ok || !isDeepStrictEqual(checked.value, c.expected)) {
      throw new Error('Synthetic expectation does not match the domain contract.');
    }
  }
}

function inventory() {
  validateDataset();
  return {
    mode: 'inventory-only', modelEvaluated: false, trained: false,
    dataset: datasetProvenance(), cases: dataset.cases.length,
    caseIds: dataset.cases.map(c => c.id),
    limitation: 'Unreviewed synthetic development fixtures. No model run or professional benchmark.',
  };
}

/**
 * Exact unordered (fieldId, value) comparison plus source anchors. Every returned
 * quote must be a literal substring of its page and contain the literal value.
 * Golden evidence entries are alternative allowed anchors, not mandatory copies:
 * a longer verbatim excerpt containing the anchor is accepted on the same page.
 * A source substring alone cannot make a wrong role/value/instruction correct.
 */
function scoreCase(c, answer) {
  const failures = [];
  const fail = (code, details = {}) => failures.push({ code, ...details });
  const metrics = { expectedFields: c.expected.fields.length, returnedFields: 0,
    exactFields: 0, evidencedFields: 0, falseSupportedClaims: 0 };
  if (!record(answer) || answer.ok !== true) {
    const refused = record(answer) && answer.ok === false;
    const codes = ['invalid_input', 'unavailable', 'invalid_output', 'refused', 'refusal'];
    const refusalCode = refused && codes.includes(answer.code) ? answer.code : refused ? 'unknown_refusal' : null;
    fail(refused ? 'unexpected_refusal' : 'invalid_result');
    return { pass: false, refused, refusalCode, failures, metrics };
  }
  if (!exactKeys(answer, ['ok', 'preparation', 'provenance', 'usage'])) fail('unexpected_result_shape');
  const p = answer.preparation;
  if (!exactKeys(p, ['fields', 'missing', 'conflicts', 'status'])) fail('unexpected_preparation_shape');
  if (!record(p)) return { pass: false, refused: false, refusalCode: null, failures, metrics };
  if (p.status !== c.expected.status) fail('unsafe_review_status');
  if (!sameSet(p.missing, c.expected.missing)) fail('missing_set_mismatch');
  if (!sameSet(p.conflicts, c.expected.conflicts)) fail('conflict_set_mismatch');
  const checked = D.validateFinancingAIExtraction(c.input, { fields: p.fields });
  if (!checked.ok) fail('domain_rejected_preparation');
  else if (!sameSet(p.missing, checked.value.missing) || !sameSet(p.conflicts, checked.value.conflicts)) {
    fail('inconsistent_preparation');
  }
  const expected = new Map(c.expected.fields.map(field => [fieldKey(field), field]));
  const seen = new Set();
  const fields = Array.isArray(p.fields) ? p.fields : [];
  metrics.returnedFields = fields.length;
  for (const field of fields) {
    if (!exactKeys(field, ['fieldId', 'value', 'evidence']) || typeof field.value !== 'string') {
      fail('invalid_field_shape');
      metrics.falseSupportedClaims++;
      continue;
    }
    const key = fieldKey(field);
    const gold = expected.get(key);
    const duplicate = seen.has(key);
    seen.add(key);
    if (duplicate) fail('duplicate_field', { fieldId: field.fieldId });
    if (!gold) fail('unexpected_field_value', { fieldId: field.fieldId, value: field.value });
    else if (!duplicate) metrics.exactFields++;
    let supported = Array.isArray(field.evidence) && field.evidence.length > 0;
    if (!supported) fail('missing_evidence', { fieldId: field.fieldId });
    for (const e of Array.isArray(field.evidence) ? field.evidence : []) {
      const page = record(e) && c.input.pages.find(p => p.documentId === e.documentId && p.page === e.page);
      if (!exactKeys(e, ['documentId', 'page', 'quote']) || !page ||
          typeof e.quote !== 'string' || !e.quote.trim() || !field.value.trim() ||
          !page.text.includes(e.quote) || !e.quote.includes(field.value.trim())) {
        supported = false;
        fail('invalid_page_evidence', { fieldId: field.fieldId });
      } else if (gold && !gold.evidence.some(anchor => anchor.documentId === e.documentId &&
          anchor.page === e.page && e.quote.includes(anchor.quote))) {
        supported = false;
        fail('unexpected_evidence_anchor', { fieldId: field.fieldId });
      }
    }
    if (supported) metrics.evidencedFields++;
    if (!gold || !supported) metrics.falseSupportedClaims++;
  }
  for (const [key, field] of expected) {
    if (!seen.has(key)) fail('expected_field_absent', { fieldId: field.fieldId, value: field.value });
  }
  return { pass: !failures.length, refused: false, refusalCode: null, failures, metrics };
}

const tokenKeys = { input: 'in', output: 'out', cacheRead: 'cacheRead', cacheWrite: 'cacheWrite' };
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;

// Snapshot only numeric counters, never provider text or exception properties.
// Legacy adapters may have replaced missing counters with zero: without an
// explicit reported flag, only positive counters are safe to include.
function usageSample(usage) {
  const legacy = record(usage) && !Object.hasOwn(usage, 'reported');
  const reported = record(usage) && usage.reported === true && tokenCount(usage.in) && tokenCount(usage.out);
  const tokens = Object.fromEntries(Object.entries(tokenKeys).map(([name, key]) => {
    const value = usage && usage[key];
    return [name, (reported || legacy) && tokenCount(value) && (!legacy || value > 0) ? value : null];
  }));
  return { legacy, tokens };
}

function summarizeUsage(attempts) {
  const reportedAttempts = attempts.filter(a => a.usage.tokens.input !== null && a.usage.tokens.output !== null).length;
  return {
    reportedAttempts, unknownAttempts: attempts.length - reportedAttempts,
    legacyAttempts: attempts.filter(a => a.usage.legacy).length,
    tokens: Object.fromEntries(Object.keys(tokenKeys).map(name => {
      const known = attempts.map(a => a.usage.tokens[name]).filter(value => value !== null);
      return [name, {
        total: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
        knownAttempts: known.length, unknownAttempts: attempts.length - known.length,
      }];
    })),
  };
}

function latencySummary(attempts) {
  const sorted = attempts.map(a => a.latencyMs).sort((a, b) => a - b);
  const percentile = fraction => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
  return { count: sorted.length, latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null } };
}

function performanceSummary(results, successfulCases, providerAttempts, successfulProviderAttempts, withoutProviderAttempt) {
  return {
    definitions: {
      caseLatency: 'Wall-clock milliseconds from before input hashing through engine preparation, exact scoring and provenance checks; includes failures.',
      providerLatency: 'Wall-clock milliseconds awaiting each port.extract call, including thrown calls; excludes engine validation and scoring. Internal adapter retries are not separately observable.',
      percentiles: 'Nearest rank: sorted[ceil(n * percentile) - 1]; empty populations return null.',
      successfulScoredCases: 'Engine returned ok:true and the case was scored, including empty extractions and cases that fail exact scoring.',
      usage: 'Returned provider counters only, including rejected extractions. Totals are known subtotals, null when no counters are known; unknown attempts may have consumed tokens. reportedAttempts requires known input and output, not cache counters. reported:false or invalid input/output under reported:true makes usage unknown. Legacy counters without reported are included only when positive; legacy zeros are unknown.',
    },
    allAttempts: latencySummary(results),
    successfulScoredCases: { ...latencySummary(successfulCases), usage: summarizeUsage(successfulProviderAttempts) },
    providerAttempts: {
      ...latencySummary(providerAttempts),
      returned: providerAttempts.filter(a => a.returned).length,
      threw: providerAttempts.filter(a => !a.returned).length,
      usage: summarizeUsage(providerAttempts),
    },
    failures: {
      unscoredCases: results.length - successfulCases.length,
      scoredFailures: successfulCases.filter(r => !r.pass).length,
      withoutProviderAttempt,
      evaluationErrors: results.filter(r => r.error).length,
      invalidResults: results.filter(r => r.failures.some(f => f.code === 'invalid_result')).length,
      refusalsByCode: Object.fromEntries(['invalid_input', 'unavailable', 'invalid_output', 'refused', 'refusal', 'unknown_refusal']
        .map(code => [code, results.filter(r => r.refusalCode === code).length])),
    },
    costUsd: null,
    costStatus: 'No verified provider/model/region rate configuration; cost is unknown, including unavailable runs.',
  };
}

async function evaluate(port, model) {
  validateDataset();
  // Inventory works without loading the engine, SDK or provider credentials.
  const { createFinancingAI } = require('../src/financing-ai');
  const { DEFAULT_MODEL } = require('../src/assistant-port');
  const selectedModel = (port && port.model) || model || DEFAULT_MODEL;
  const results = [];
  const successfulCases = [];
  const providerAttempts = [];
  const successfulProviderAttempts = [];
  let withoutProviderAttempt = 0;
  const promptHashes = new Set();
  let observedPromptSha256;
  const observedPort = port && typeof port.extract === 'function' ? {
    model: port.model,
    async extract(request) {
      // Hash the actual system prompt passed to the port, including on failure.
      // Do not forward the dataset labels, expected values or case descriptions.
      observedPromptSha256 = typeof request.system === 'string' ? sha256(request.system) : null;
      if (observedPromptSha256) promptHashes.add(observedPromptSha256);
      const started = Date.now();
      const attempt = { returned: false, usage: usageSample(null) };
      try {
        const response = await port.extract(request);
        attempt.returned = true;
        attempt.latencyMs = Date.now() - started;
        // Usage can survive an invalid extraction even when the engine refuses
        // the result. Never copy the raw response or inspect a thrown error.
        try { attempt.usage = usageSample(response && response.usage); } catch { /* unknown usage */ }
        return response;
      } finally {
        if (!attempt.returned) attempt.latencyMs = Date.now() - started;
        providerAttempts.push(attempt);
      }
    },
  } : port;
  const engine = createFinancingAI({ port: observedPort, model: selectedModel });
  for (const c of dataset.cases) {
    const started = Date.now();
    const firstProviderAttempt = providerAttempts.length;
    const inputSha256 = sha256(JSON.stringify(c.input));
    observedPromptSha256 = null;
    let answer;
    let error = false;
    try {
      answer = await engine.prepare(structuredClone(c.input));
    } catch {
      // Provider exceptions can contain source text or credentials. Never log them.
      error = true;
    }
    const scored = scoreCase(c, answer);
    if (error) scored.failures.push({ code: 'evaluation_error' });
    if (answer && answer.ok === true) {
      const p = answer.provenance;
      if (!record(p) || p.model !== selectedModel || p.inputSha256 !== inputSha256 ||
          !observedPromptSha256 || p.promptSha256 !== observedPromptSha256 ||
          p.knowledgeVersion !== D.FINANCING_KNOWLEDGE.version) {
        scored.failures.push({ code: 'provenance_mismatch' });
      }
    }
    results.push({
      id: c.id, ...scored, pass: !scored.failures.length, error,
      inputSha256, promptSha256: observedPromptSha256,
      provenance: answer && answer.ok === true ? answer.provenance : null,
      usage: answer && answer.ok === true ? answer.usage : null,
      preparation: answer && answer.ok === true ? answer.preparation : null,
      latencyMs: Date.now() - started,
    });
    if (providerAttempts.length === firstProviderAttempt) withoutProviderAttempt++;
    if (answer && answer.ok === true) {
      successfulCases.push(results.at(-1));
      successfulProviderAttempts.push(...providerAttempts.slice(firstProviderAttempt));
    }
  }
  const failures = promptHashes.size > 1 ? [{ code: 'prompt_changed_during_run' }] : [];
  const passed = results.filter(r => r.pass).length;
  const sum = name => results.reduce((total, r) => total + r.metrics[name], 0);
  return {
    mode: 'synthetic-evaluation', execution: 'caller-supplied-port',
    model: selectedModel, requestedModel: model || null, generatedAt: new Date().toISOString(),
    dataset: datasetProvenance(), datasetSha256: sha256(datasetBytes),
    knowledgeVersion: D.FINANCING_KNOWLEDGE.version,
    promptSha256: promptHashes.size === 1 ? [...promptHashes][0] : null,
    promptSha256s: [...promptHashes].sort(),
    trained: false, professionalBenchmark: false,
    pass: passed === results.length && failures.length === 0,
    passed, failed: results.length - passed, total: results.length, failures,
    refusals: results.filter(r => r.refused).length, errors: results.filter(r => r.error).length,
    expectedFields: sum('expectedFields'), returnedFields: sum('returnedFields'),
    exactFields: sum('exactFields'), evidencedFields: sum('evidencedFields'),
    falseSupportedClaims: sum('falseSupportedClaims'),
    performance: performanceSummary(results, successfulCases, providerAttempts, successfulProviderAttempts, withoutProviderAttempt),
    limitation: 'Exact regression checks on unreviewed synthetic development data. An injected port may be a test double; no professional accuracy, notary approval or time savings are established.',
    results,
  };
}

// Injectable only for offline CLI tests. Production invocation uses the engine
// exports; no fixtures or fallback answers can silently stand in for a live run.
async function main({ argv = process.argv.slice(2), env = process.env, write = console.log,
  loadEngine = () => require('../src/financing-ai'), runEvaluation = evaluate } = {}) {
  if (argv.some(arg => arg !== '--live') || argv.length > 1) throw new Error('Unsupported evaluation arguments.');
  if (!argv.includes('--live')) {
    write(JSON.stringify(inventory(), null, 2));
    return 0;
  }
  const provider = (env.NOTA_FINANCING_AI_PROVIDER || '').trim() || 'anthropic';
  if (!['anthropic', 'bedrock'].includes(provider)) {
    throw new Error('Unsupported financing AI provider. Use anthropic or bedrock.');
  }
  let model, region, port;
  if (provider === 'bedrock') {
    model = (env.NOTA_FINANCING_AI_MODEL || '').trim();
    region = (env.NOTA_FINANCING_AI_REGION || '').trim();
    if (!model || !region) {
      throw new Error('Bedrock evaluation requires NOTA_FINANCING_AI_MODEL and NOTA_FINANCING_AI_REGION. No model was evaluated.');
    }
    const { createBedrockFinancingPort } = loadEngine();
    port = createBedrockFinancingPort({ region, model });
  } else {
    const apiKey = [env.ANTHROPIC_API_KEY, env.NOTA_ASSISTANT_API_KEY]
      .find(value => typeof value === 'string' && value.trim());
    if (!apiKey) throw new Error('Live evaluation requires ANTHROPIC_API_KEY or NOTA_ASSISTANT_API_KEY. No model was evaluated.');
    const { createAnthropicFinancingPort } = loadEngine();
    const { DEFAULT_MODEL } = require('../src/assistant-port');
    model = (env.NOTA_FINANCING_AI_MODEL || '').trim() ||
      (env.NOTA_ASSISTANT_MODEL || '').trim() || DEFAULT_MODEL;
    port = createAnthropicFinancingPort({ apiKey, model });
  }
  if (!port) throw new Error('Live provider unavailable.');
  const report = await runEvaluation(port, model);
  write(JSON.stringify({ ...report, mode: 'live-synthetic-evaluation',
    execution: provider === 'bedrock' ? 'amazon-bedrock' : 'anthropic',
    ...(provider === 'bedrock' ? { region } : {}),
  }, null, 2));
  return report.pass === true && report.total > 0 && report.passed === report.total &&
    report.failed === 0 && report.failures.length === 0 ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('Financing AI evaluation could not run. Check --live provider settings, credentials, engine availability and dataset validity; no passing evaluation is recorded.');
  process.exitCode = 1;
});

module.exports = { evaluate, scoreCase, inventory, main };
