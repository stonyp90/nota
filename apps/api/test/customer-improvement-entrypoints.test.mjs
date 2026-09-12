import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const lambda = readFileSync(new URL('../customer-improvement.js', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../scripts/run-customer-improvement.js', import.meta.url), 'utf8');

function sandbox(source, { flag, argv = [], table = 'must-not-be-accessed', allowReads = false } = {}) {
  const calls = { imports: [], logs: [], errors: [], repositories: [], runs: [] };
  const process = { env: { TABLE_NAME: table, NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED: flag }, argv, exitCode: undefined };
  const exports = {};
  const repo = {};
  const result = { version: 'fixture', day: '2026-09-12', decision: { action: 'hold' }, applied: false, auditRecorded: false };
  runInNewContext(source, {
    exports, process,
    console: { log: (...args) => calls.logs.push(args), error: (...args) => calls.errors.push(args) },
    require(name) {
      calls.imports.push(name);
      assert.equal(allowReads, true, 'disabled/default entry points must not even load an AWS or domain dependency');
      if (name === '@nota/domain') return { businessDay: () => '2026-09-12' };
      if (name.endsWith('/repo-dynamo')) return { createDynamoRepo(options) { calls.repositories.push(options); return repo; } };
      if (name.endsWith('/customer-improvement')) return { async runCustomerImprovement(options) { calls.runs.push(options); return result; } };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  return { calls, process, exports, result, repo };
}

test('disabled, missing and misspelled Lambda flags stop before imports, reads or logs', async () => {
  for (const flag of [undefined, '', ' ', 'false', ' FALSE ', '0', 'off', 'yes', 'tru', 'unexpected']) {
    const harness = sandbox(lambda, { flag });
    // An event cannot override the environment's cost stop.
    const result = await harness.exports.handler({ enabled: true });
    assert.equal(result.skipped, true, String(flag));
    assert.equal(result.reason, 'disabled');
    assert.equal(result.applied, false);
    assert.deepEqual(harness.calls, { imports: [], logs: [], errors: [], repositories: [], runs: [] });
  }
});

test('explicit opt-in runs the existing worker and logs only its bounded report', async () => {
  for (const flag of ['true', ' TRUE ', '1', 'on']) {
    const harness = sandbox(lambda, { flag, allowReads: true });
    assert.equal(await harness.exports.handler(), harness.result);
    assert.equal(harness.calls.repositories.length, 1);
    assert.equal(harness.calls.runs.length, 1);
    assert.equal(harness.calls.runs[0].repo, harness.repo);
    assert.equal(harness.calls.runs[0].enabled, true);
    assert.equal(harness.calls.runs[0].now(), '2026-09-12');
    assert.equal(harness.calls.logs.length, 1);
    assert.equal(JSON.stringify(harness.calls.logs).includes('must-not-be-accessed'), false);
  }
});

test('operator command defaults to no AWS access even when a real table is configured', () => {
  for (const argv of [[], ['--dry-run'], ['--read-awss']]) {
    const harness = sandbox(cli, { argv });
    assert.equal(harness.process.exitCode, 1);
    assert.equal(harness.calls.imports.length, 0);
    assert.match(String(harness.calls.errors[0]), /No AWS access performed/);
  }
});

test('explicit operator reads remain read-only and apply remains deliberate', async () => {
  for (const [arg, enabled] of [['--read-aws', false], ['--apply', true]]) {
    const harness = sandbox(cli, { argv: [arg], allowReads: true });
    await Promise.resolve();
    assert.equal(harness.calls.repositories.length, 1);
    assert.equal(harness.calls.runs[0].enabled, enabled);
    assert.equal(harness.calls.logs.length, 1);
    assert.equal(harness.process.exitCode, undefined);
  }
});

test('authorized operator mode still rejects a missing table without loading clients', () => {
  const harness = sandbox(cli, { argv: ['--read-aws'], table: '' });
  assert.equal(harness.process.exitCode, 1);
  assert.equal(harness.calls.imports.length, 0);
  assert.match(String(harness.calls.errors[0]), /TABLE_NAME is required/);
});
