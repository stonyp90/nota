'use strict';

// Offline-only dataset builder. It consumes an explicitly authorized and
// deidentified export; it never calls an AI provider and never updates model
// weights. The normal invocation is an inventory report, which makes an
// accidental production training job impossible.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const D = require('@nota/domain');
const { buildNotaryPreferenceDataset } = require('../src/notary-learning');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? '' : String(argv[index + 1] || '').trim();
}

function parseArgs(argv) {
  const input = valueAfter(argv, '--input');
  const known = new Set(['--input', '--authorized', '--deidentified', '--approved-by', '--frozen-qualification', '--qualification-passed', '--rollback-plan']);
  for (let i = 0; i < argv.length; i += 1) {
    if (!known.has(argv[i])) throw new Error('Unsupported argument: ' + argv[i]);
    if (argv[i] === '--input' || argv[i] === '--approved-by') i += 1;
  }
  return {
    input,
    authorizedDataUse: argv.includes('--authorized'),
    deidentified: argv.includes('--deidentified'),
    approvedBy: valueAfter(argv, '--approved-by'),
    frozenQualificationSet: argv.includes('--frozen-qualification'),
    qualificationPassed: argv.includes('--qualification-passed'),
    rollbackPlan: argv.includes('--rollback-plan'),
  };
}

function inventory() {
  return {
    mode: 'inventory-only',
    learningProgram: D.NOTARY_LEARNING_PROGRAM,
    trainingEligible: false,
    weightUpdate: 'not_started',
    reason: 'An input export and every offline authorization gate are required.',
  };
}

function loadRecords(file) {
  const parsed = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.records) ? parsed.records : [];
}

function run({ argv = process.argv.slice(2), write = console.log } = {}) {
  const options = parseArgs(argv);
  if (!options.input) {
    write(JSON.stringify(inventory(), null, 2));
    return 0;
  }
  const report = buildNotaryPreferenceDataset(loadRecords(options.input), options);
  write(JSON.stringify(report, null, 2));
  return report.trainingEligible ? 0 : 2;
}

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { inventory, loadRecords, parseArgs, run };
