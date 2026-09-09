'use strict';

// Test-only CPU benchmark; no model, network, credentials or persisted data.
// Run: node apps/api/scripts/benchmark-support-matcher.js
// This compares matching algorithms, not chat response latency. Both paths
// use equivalent Unicode normalization; the baseline is the previous scan.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const domain = require('@nota/domain');
const { preparedTopic } = require('../src/support-playbook');

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const previousScan = question => {
  const text = normalize(question);
  return domain.SUPPORT_TOPICS.find(topic => [topic.fr, topic.en].some(phrase => normalize(phrase) === text));
};
const indexed = question => preparedTopic(question, domain.SUPPORT_TOPICS);
const questions = [
  ...domain.SUPPORT_TOPICS.flatMap(topic => [topic.fr, topic.en]),
  'Pouvez-vous préciser les étapes de publication ?',
];
for (const question of questions) assert.equal(previousScan(question)?.id, indexed(question)?.id);

const iterations = 50000;
function run(matcher, count = iterations) {
  const started = performance.now();
  for (let i = 0; i < count; i++) matcher(questions[i % questions.length]);
  return performance.now() - started;
}
run(previousScan, 5000);
run(indexed, 5000);
const scans = [], indexes = [];
for (let round = 0; round < 3; round++) {
  // Alternate ordering to reduce a systematic warm-up/order advantage.
  if (round % 2) {
    indexes.push(run(indexed));
    scans.push(run(previousScan));
  } else {
    scans.push(run(previousScan));
    indexes.push(run(indexed));
  }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = value => Math.round(value * 10) / 10;
console.log(JSON.stringify({
  scope: 'Topic-matching CPU only; not end-to-end chat latency',
  node: process.version,
  iterationsPerRound: iterations,
  rounds: scans.length,
  questions: questions.length,
  previousScanMs: scans.map(round),
  indexedMatcherMs: indexes.map(round),
  previousScanMedianMs: round(median(scans)),
  indexedMatcherMedianMs: round(median(indexes)),
  medianSpeedup: round(median(scans) / median(indexes)),
}, null, 2));
