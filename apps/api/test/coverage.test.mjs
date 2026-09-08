import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
async function check(notaries, query = { prefixe: 'G1R', deplacement: 'client_10' }) {
  const repo = createMemoryRepo();
  for (const n of notaries) await repo.putNotary(n);
  const response = await createApp(repo).handle({ method: 'GET', path: '/coverage', query });
  return { code: response.statusCode, body: JSON.parse(response.body) };
}
test('no active notaries yields none without disclosing identities', async () => {
  assert.deepEqual(await check([{ id: 'pending', status: 'onboarding', prefixe: 'G1R' }]), { code: 200, body: { status: 'none', count: 0, incomplete: false } });
});
test('nearby active notary covers the requested area', async () => {
  assert.equal((await check([{ id: 'private', status: 'active', prefixe: 'G1R' }])).body.status, 'covered');
});
test('distant notary does not cover a ten kilometre radius', async () => {
  assert.equal((await check([{ id: 'far', status: 'active', prefixe: 'G3A' }])).body.status, 'none');
});
test('missing coordinates remain unknown instead of a false zero', async () => {
  assert.equal((await check([{ id: 'unknown', status: 'active' }])).body.status, 'unknown');
});
test('invalid postal sector and band are rejected', async () => {
  assert.equal((await check([], { prefixe: 'bad', deplacement: 'invented' })).code, 422);
});

test('returns all geographic matches, excluding inactive and distant notaries', async () => {
  const result = await check([{id:'a',status:'active',prefixe:'G1R'}, {id:'b',status:'active',prefixe:'G1R'}, {id:'c',status:'active',prefixe:'G3A'}, {id:'d',status:'onboarding',prefixe:'G1R'}]);
  assert.deepEqual(result.body, {status:'covered',count:2,incomplete:false});
});
test('unknown coordinates produce an honest lower bound or null', async () => {
  assert.deepEqual((await check([{id:'a',status:'active'}])).body, {status:'unknown',count:null,incomplete:true});
  assert.deepEqual((await check([{id:'a',status:'active'}, {id:'b',status:'active',prefixe:'G1R'}])).body, {status:'covered',count:1,incomplete:true});
});
