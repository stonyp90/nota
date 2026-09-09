import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');

test('public carnet receives only the current bounded customer-experience mode', async () => {
  const repo = createMemoryRepo([]);
  await repo.putExperienceConfig({
    mode: 'guided', revision: 4, baseline: { formStarts: 20, publications: 10 },
    history: [{ action: 'enable_guided_intake', from: 'standard', to: 'guided', reason: 'blockedRate' }],
  }, '2026-09-09T13:15:00.000Z');
  const app = createApp(repo, { now: () => '2026-09-09', nowMs: () => Date.parse('2026-09-09T14:00:00.000Z') });
  const result = await app.handle({ method: 'GET', path: '/bids', query: { month: '2026-09' } });
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.deepEqual(body.experience, {
    version: '2026-09-09.1', mode: 'guided', guidanceLevel: 'guided',
  });
  assert.equal(JSON.stringify(body.experience).includes('baseline'), false);
  assert.equal(JSON.stringify(body.experience).includes('blockedRate'), false);
});

test('experience reads are coalesced when the calendar requests several months', async () => {
  const repo = createMemoryRepo([]);
  let reads = 0;
  const original = repo.getExperienceConfig;
  repo.getExperienceConfig = async () => { reads += 1; await new Promise(resolve => setTimeout(resolve, 1)); return original(); };
  const app = createApp(repo, { now: () => '2026-09-09', nowMs: () => Date.parse('2026-09-09T14:00:00.000Z') });
  await Promise.all([
    app.handle({ method: 'GET', path: '/bids', query: { month: '2026-08' } }),
    app.handle({ method: 'GET', path: '/bids', query: { month: '2026-09' } }),
    app.handle({ method: 'GET', path: '/bids', query: { month: '2026-10' } }),
  ]);
  assert.equal(reads, 1);
});
