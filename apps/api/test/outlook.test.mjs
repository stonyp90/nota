import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createOutlook } = require('../src/outlook');
const { createMemoryRepo } = require('../src/repo-memory');
function fixture() {
  let clock = 1000;
  const repo = createMemoryRepo();
  const calls = [];
  const env = { NOTA_OUTLOOK_CLIENT_ID: 'client', NOTA_OUTLOOK_CLIENT_SECRET: 'private', NOTA_CALENDAR_ENCRYPTION_KEY: 'ab'.repeat(32), NOTA_OUTLOOK_REDIRECT_URI: 'https://gonota.ca/api/calendar/outlook/callback' };
  const fetch = async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => url.endsWith('/token') ? { access_token: 'access', refresh_token: 'refresh-private', scope: 'Calendars.ReadWrite' } : { id: 'calendar', owner: { address: 'owner@example.test' } } }; };
  const service = createOutlook({ repo, env, fetch, now: () => clock });
  return { repo, service, calls, env, fetch, advance: () => { clock += 600001; } };
}
async function begin(service) {
  const { url, binding } = await service.start('N-one');
  return { query: { state: new URL(url).searchParams.get('state'), code: 'provider-code' }, binding, url };
}
test('PKCE connection binds browser, encrypts credentials and exposes only account status', async () => {
  const f = fixture(); const flow = await begin(f.service);
  assert.equal(new URL(flow.url).searchParams.get('code_challenge_method'), 'S256');
  await assert.rejects(f.service.finish(flow.query, 'wrong-browser'), { code: 'calendar_invalid_state' });
  assert.equal(f.calls.length, 0);
  await f.service.finish(flow.query, flow.binding);
  assert.equal(f.calls[0][1].body.get('grant_type'), 'authorization_code');
  assert.equal(f.calls[0][1].body.get('code_verifier').length, 43);
  assert.deepEqual(await f.service.status('N-one'), { configured: true, connected: true, account: 'owner@example.test' });
  assert.ok(!JSON.stringify(await f.repo.getCalendar('N-one')).includes('refresh-private'));
  assert.equal((await f.service.status('N-other')).connected, false);
  await assert.rejects(f.service.finish(flow.query, flow.binding), { code: 'calendar_invalid_state' });
});
test('expired, modified and superseded OAuth states fail before provider access', async () => {
  for (const mode of ['expired', 'modified', 'superseded']) {
    const f = fixture(); const flow = await begin(f.service);
    if (mode === 'expired') f.advance();
    if (mode === 'modified') flow.query.state = 'broken';
    if (mode === 'superseded') await begin(f.service);
    await assert.rejects(f.service.finish(flow.query, flow.binding), { code: 'calendar_invalid_state' });
    assert.equal(f.calls.length, 0);
  }
});
test('disconnect invalidates pending authorization and removes credentials', async () => {
  const f = fixture(); const flow = await begin(f.service);
  await f.service.disconnect('N-one');
  await assert.rejects(f.service.finish(flow.query, flow.binding), { code: 'calendar_invalid_state' });
  assert.equal((await f.service.status('N-one')).connected, false);
});
test('a cancelled consent is consumed without requesting tokens', async () => {
  const f = fixture(); const flow = await begin(f.service);
  flow.query.error = 'access_denied';
  await assert.rejects(f.service.finish(flow.query, flow.binding), { code: 'calendar_consent_denied' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.finish(flow.query, flow.binding), { code: 'calendar_invalid_state' });
});
test('simultaneous callbacks exchange a code only once', async () => {
  const f = fixture(); const flow = await begin(f.service);
  const results = await Promise.allSettled([f.service.finish(flow.query, flow.binding), f.service.finish(flow.query, flow.binding)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.calls.filter(([url]) => url.endsWith('/token')).length, 1);
});
test('missing configuration stays disabled', async () => {
  const service = createOutlook({ repo: createMemoryRepo(), env: {} });
  assert.deepEqual(await service.status('N-one'), { configured: false, connected: false });
  await assert.rejects(service.start('N-one'), { code: 'calendar_unconfigured' });
});
test('provider failures and missing scope never persist credentials', async () => {
  for (const provider of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ access_token: 'access', refresh_token: 'private', scope: 'openid' }) })]) {
    const f = fixture();
    const service = createOutlook({ repo: f.repo, env: f.env, fetch: provider });
    const flow = await begin(service);
    await assert.rejects(service.finish(flow.query, flow.binding));
    assert.equal((await service.status('N-one')).connected, false);
    assert.equal((await f.repo.getCalendar('N-one')).pending, null);
  }
});
test('disconnect while provider is responding cannot resurrect credentials', async () => {
  const f = fixture();
  const service = createOutlook({ repo: f.repo, env: f.env, fetch: async (url, opts) => {
    if (url.endsWith('/token')) await service.disconnect('N-one');
    return f.fetch(url, opts);
  } });
  const flow = await begin(service);
  await assert.rejects(service.finish(flow.query, flow.binding), { code: 'calendar_conflict' });
  assert.equal((await service.status('N-one')).connected, false);
});
test('Dynamo uses strong reads and conditional writes for connection races', async () => {
  const { createDynamoRepo } = require('../src/repo-dynamo');
  const calls = [];
  const repo = createDynamoRepo({ tableName: 'test', doc: { send: async cmd => { calls.push(cmd.input); return {}; } } });
  await repo.getCalendar('N-one');
  assert.equal(calls[0].ConsistentRead, true);
  await repo.compareAndSetCalendar('N-one', null, { revision: 'one' });
  assert.equal(calls[1].ConditionExpression, 'attribute_not_exists(PK)');
  await repo.compareAndSetCalendar('N-one', 'one', { revision: 'two' });
  assert.equal(calls[2].ExpressionAttributeValues[':revision'], 'one');
  const conflict = createDynamoRepo({ tableName: 'test', doc: { send: async () => { throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' }); } } });
  assert.equal(await conflict.compareAndSetCalendar('N-one', 'one', {}), false);
});
test('HTTP routes reject feed credentials, secure binding cookies and omit provider errors', async () => {
  const { createApp } = require('../src/handler');
  const { signToken, SCOPES } = require('../src/notary-auth');
  const old = process.env.NOTA_NOTARY_SECRET;
  process.env.NOTA_NOTARY_SECRET = 'test-outlook-signing-secret';
  try {
    const session = signToken('N-one', Date.now() + 60000, SCOPES.SESSION);
    const feed = signToken('N-one', Date.now() + 60000, SCOPES.FEED);
    const f = fixture();
    const app = createApp(f.repo, { outlook: f.service });
    assert.equal((await app.handle({ method: 'POST', path: '/notary/calendar/outlook/connect', headers: { authorization: `Bearer ${feed}` } })).statusCode, 401);
    const started = await app.handle({ method: 'POST', path: '/notary/calendar/outlook/connect', headers: { authorization: `Bearer ${session}` } });
    assert.equal(started.statusCode, 200);
    assert.match(started.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax/);
    const url = new URL(JSON.parse(started.body).url);
    const query = { state: url.searchParams.get('state'), code: 'provider-code' };
    assert.equal((await app.handle({ path: '/calendar/outlook/callback', query })).statusCode, 400);
    const result = await app.handle({ path: '/calendar/outlook/callback', query, headers: { cookie: started.headers['set-cookie'].split(';')[0] } });
    assert.equal(result.statusCode, 303);
    assert.equal(result.headers.location, '/#t=notaires');
    assert.equal(result.body, '');
  } finally { if (old === undefined) delete process.env.NOTA_NOTARY_SECRET; else process.env.NOTA_NOTARY_SECRET = old; }
});
