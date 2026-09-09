'use strict';
// Synthetic support benchmark, never a training job or a file-review accuracy claim.
const { createHash } = require('node:crypto');
const domain = require('@nota/domain');
const cases = require('../evals/financing-cases.json');
const { createSupportAssistant } = require('../src/support-assistant');
const { createAnthropicAssistant, DEFAULT_MODEL } = require('../src/assistant-port');

async function evaluate(port, model) {
  const assistant = createSupportAssistant({ port });
  const results = [];
  for (const c of cases) {
    const started = Date.now();
    const answer = await assistant.answer(c);
    const missing = c.concepts.filter(pattern => !new RegExp(pattern, 'iu').test(answer.texte || ''));
    results.push({ id: c.id, pass: answer.escalade === c.escalade && missing.length === 0,
      missing, escalade: answer.escalade, texte: answer.texte, usage: answer.usage,
      latencyMs: Date.now() - started });
  }
  return { mode: 'live-synthetic-evaluation', model, generatedAt: new Date().toISOString(),
    knowledgeVersion: domain.FINANCING_KNOWLEDGE.version,
    promptSha256: createHash('sha256').update(assistant.systemPrompt()).digest('hex'),
    datasetSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    passed: results.filter(r => r.pass).length, total: results.length,
    limitation: 'Keyword smoke checks; human review required. No training, professional accuracy or time savings measured.', results };
}
async function main() {
  if (!process.argv.includes('--live')) {
    console.log(JSON.stringify({ mode: 'inventory-only', cases: cases.length,
      knowledgeVersion: domain.FINANCING_KNOWLEDGE.version, modelEvaluated: false, trained: false }));
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.NOTA_ASSISTANT_API_KEY;
  if (!apiKey) throw new Error('Live evaluation requires ANTHROPIC_API_KEY or NOTA_ASSISTANT_API_KEY. No model was evaluated.');
  const model = process.env.NOTA_ASSISTANT_MODEL || DEFAULT_MODEL;
  const report = await evaluate(createAnthropicAssistant({ apiKey, model }), model);
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  // Never print provider errors that may contain request headers or credentials.
  console.error('Financing evaluation could not run. Check provider configuration and credentials; no passing evaluation is recorded.');
  process.exitCode = 1;
});
module.exports = { evaluate };
