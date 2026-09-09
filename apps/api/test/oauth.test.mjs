import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const require = createRequire(import.meta.url);
const { createOAuth } = require('../src/oauth');
const { createMemoryRepo } = require('../src/repo-memory');
const { createApp } = require('../src/handler');
const { notaryIdForEmail } = require('../src/notary-auth');
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256', use: 'sig' };
const tenant = '11111111-1111-4111-8111-111111111111';
const issuers = { google: 'https://accounts.google.com', linkedin: 'https://www.linkedin.com/oauth', microsoft: `https://login.microsoftonline.com/${tenant}/v2.0` };
function fixture() {
  const env = { NOTA_OAUTH_ORIGIN: 'https://nota.example', NOTA_OAUTH_ENCRYPTION_KEY: 'ab'.repeat(32) };
  for (const id of Object.keys(issuers)) {
    env[`NOTA_OAUTH_${id.toUpperCase()}_CLIENT_ID`] = id + '-client';
    env[`NOTA_OAUTH_${id.toUpperCase()}_CLIENT_SECRET`] = id + '-secret';
  }
  const repo = createMemoryRepo(); let clock = Date.now(), nonce, provider, patch = {}, keyIssuer = 'https://login.microsoftonline.com/{tenantid}/v2.0';
  const calls = [], mails = [];
  const service = createOAuth({ repo, env, now: () => clock, fetch: async (url, opts) => {
    calls.push([String(url), opts]);
    if (opts?.method === 'POST') {
      const claims = { iss: issuers[provider], aud: provider + '-client', sub: 'stable-subject', nonce, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 300, tid: tenant, email: 'untrusted@example.test', ...patch };
      const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
      return Response.json({ id_token: token, access_token: 'access-token-must-not-persist' });
    }
    return Response.json({ keys: [{ ...jwk, issuer: keyIssuer }] });
  } });
  const app = createApp(repo, { oauth: service, nowMs: () => clock, notifier: { onOAuthLinkRequested: async x => { mails.push(x); return { sent: true }; } } });
  return { repo, service, env, calls, mails, app, patch: p => { patch = p; }, keyIssuer: s => { keyIssuer = s; }, advance: () => { clock += 600001; }, async begin(id = 'google', role = 'client') {
    provider = id;
    const result = await service.start(id, role, 'en'), q = new URL(result.url).searchParams;
    nonce = q.get('nonce');
    return { ...result, query: { state: q.get('state'), code: 'code' } };
  } };
}
async function authenticate(f, id = 'google', role = 'client') {
  const flow = await f.begin(id, role);
  return { flow, result: await f.service.complete(await f.service.callback(id, flow.query, flow.binding), flow.binding) };
}
for (const provider of Object.keys(issuers)) test(`${provider}: real signed OIDC response, mailbox proof once, subsequent sign-in uses stable subject`, async () => {
  const f = fixture(), { flow, result } = await authenticate(f, provider);
  assert.ok(result.linkTicket); assert.equal(result.email, undefined);
  assert.equal(new URL(flow.url).searchParams.get('scope'), 'openid profile email');
  assert.equal(new URL(flow.url).searchParams.has('code_challenge'), provider !== 'linkedin');
  const pending = await f.service.requestLink(result.linkTicket, flow.binding, 'verified@example.test');
  assert.equal(pending.role, 'client');
  const token = new URL(pending.link).hash.split('=')[1];
  await assert.rejects(f.service.verifyLink(token, 'z'.repeat(43)), { code: 'oauth_invalid_state' });
  const linked = await f.service.verifyLink(token, flow.binding);
  assert.equal(linked.email, 'verified@example.test');
  await assert.rejects(f.service.verifyLink(token, flow.binding), { code: 'oauth_invalid_state' });
  f.patch({ email: 'somebody-else@example.test' });
  const again = await authenticate(f, provider);
  assert.equal(again.result.email, 'verified@example.test'); assert.equal(again.result.linkTicket, undefined);
  assert.ok(!JSON.stringify(await f.repo.getOAuthIdentity(linked.subject)).includes('access-token'));
});
for (const [name, patch] of Object.entries({ audience: { aud: 'another-app' }, issuer: { iss: 'https://attacker.example' }, nonce: { nonce: 'wrong' }, expiry: { exp: 1 }, authorizedParty: { azp: 'another-app' }, subject: { sub: '' } })) test(`rejects signed ID token with wrong ${name}`, async () => {
  const f = fixture(), flow = await f.begin(); f.patch(patch);
  await assert.rejects(f.service.callback('google', flow.query, flow.binding));
  await assert.rejects(f.service.callback('google', flow.query, flow.binding), { code: 'oauth_invalid_state' });
});
test('Microsoft key issuer and token tenant must match', async () => {
  const f = fixture(), flow = await f.begin('microsoft'); f.keyIssuer('https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0');
  await assert.rejects(f.service.callback('microsoft', flow.query, flow.binding));
});
test('browser binding, provider mix-up, expiry and replay fail before token exchange', async () => {
  const f = fixture(), flow = await f.begin();
  await assert.rejects(f.service.callback('google', flow.query, 'z'.repeat(43)), { code: 'oauth_invalid_state' });
  await assert.rejects(f.service.callback('linkedin', flow.query, flow.binding), { code: 'oauth_invalid_state' });
  assert.equal(f.calls.length, 0);
  f.advance(); await assert.rejects(f.service.callback('google', flow.query, flow.binding), { code: 'oauth_invalid_state' });
  assert.equal(f.calls.length, 0);
});
test('concurrent callbacks exchange a code once; consent denial consumes state', async () => {
  const f = fixture(), flow = await f.begin();
  const results = await Promise.allSettled([f.service.callback('google', flow.query, flow.binding), f.service.callback('google', flow.query, flow.binding)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.calls.filter(x => x[1]?.method === 'POST').length, 1);
  const denied = await f.begin();
  await assert.rejects(f.service.callback('google', { ...denied.query, error: 'access_denied' }, denied.binding), { code: 'oauth_consent_denied' });
  await assert.rejects(f.service.callback('google', denied.query, denied.binding), { code: 'oauth_invalid_state' });
});
test('misconfigured origin or key disables providers including production HTTP', async () => {
  const f = fixture();
  for (const overrides of [{ NOTA_OAUTH_ENCRYPTION_KEY: '' }, { NOTA_OAUTH_ORIGIN: 'https://nota.example/path' }, { NOTA_OAUTH_ORIGIN: 'http://localhost:4173', NODE_ENV: 'production' }]) {
    const service = createOAuth({ repo: f.repo, env: { ...f.env, ...overrides } });
    assert.ok(service.providers().every(x => !x.configured));
    await assert.rejects(service.start('google', 'client'), { code: 'oauth_unconfigured' });
  }
});
const request = (path, body, binding, method = 'POST') => ({ path: '/auth/oauth/' + path, method, body, sourceIp: '127.0.0.1', headers: { 'content-type': 'application/json', origin: 'https://nota.example', cookie: 'nota_oauth_binding=' + binding } });
test('HTTP completion reuses client session verification and does not grant the provider email', async () => {
  const f = fixture(), { flow, result } = await authenticate(f);
  // Exercise delivery with the same notifier adapter as production.
  const send = await f.app.handle(request('link/request', { ticket: result.linkTicket, email: 'owner@example.test' }, flow.binding));
  assert.equal(send.statusCode, 200); assert.equal(f.mails.length, 1);
  assert.equal(f.mails[0].role, 'client');
  assert.ok(!send.body.includes('oauthverify'));
  const token = new URL(f.mails[0].link).hash.split('=')[1];
  const verified = await f.app.handle(request('link/verify', { ticket: token }, flow.binding));
  assert.equal(verified.statusCode, 200);
  const body = JSON.parse(verified.body);
  assert.equal(body.courriel, 'owner@example.test'); assert.equal(body.role, 'client'); assert.deepEqual(body.offres, []);
  assert.match(verified.headers['set-cookie'], /Max-Age=0/);
  const replay = await f.app.handle(request('link/verify', { ticket: token }, flow.binding)); assert.equal(replay.statusCode, 400);
});
test('notary OAuth preserves approval gate and establishes an existing approved session', async () => {
  const f = fixture(), { flow, result } = await authenticate(f, 'google', 'notary');
  const pending = await f.service.requestLink(result.linkTicket, flow.binding, 'notary@example.test');
  assert.equal(pending.role, 'notary');
  const first = await f.app.handle(request('link/verify', { ticket: new URL(pending.link).hash.split('=')[1] }, flow.binding));
  assert.equal(first.statusCode, 403); assert.ok(!first.body.includes('feedToken'));
  await f.repo.putNotary({ id: notaryIdForEmail('notary@example.test'), email: 'notary@example.test', status: 'active' });
  const next = await f.begin('google', 'notary'); const ticket = await f.service.callback('google', next.query, next.binding);
  const response = await f.app.handle(request('complete', { ticket }, next.binding));
  assert.equal(response.statusCode, 200); assert.ok(JSON.parse(response.body).feedToken);
});
test('HTTP rejects cross-site and non-JSON mutations and does not reflect provider errors', async () => {
  const f = fixture(); const bad = request('google/start', { role: 'client' }, ''); bad.headers.origin = 'https://attacker.example';
  assert.equal((await f.app.handle(bad)).statusCode, 403);
  bad.headers.origin = 'https://nota.example'; bad.headers['content-type'] = 'text/plain';
  assert.equal((await f.app.handle(bad)).statusCode, 415);
  const result = await f.app.handle({ path: '/auth/oauth/google/callback', query: { error: 'sensitive-provider-diagnostic' } });
  assert.equal(result.statusCode, 303); assert.ok(!JSON.stringify(result).includes('sensitive-provider-diagnostic'));
});
test('Dynamo ticket consumption checks binding and expiry atomically; identity writes never overwrite', async () => {
  const { createDynamoRepo } = require('../src/repo-dynamo'); const calls = [];
  const repo = createDynamoRepo({ tableName: 'test', doc: { send: async c => { calls.push(c.input); return {}; } } });
  await repo.consumeOAuthTicket('id', 'result', 'browser-hash', 123);
  assert.match(calls[0].ConditionExpression, /binding = :binding/); assert.match(calls[0].ConditionExpression, /expiresAt > :now/);
  assert.equal(calls[0].ReturnValues, 'ALL_OLD');
  await repo.getOAuthIdentity('subject'); assert.equal(calls[1].ConsistentRead, true);
  await repo.putOAuthIdentity('subject', { email: 'owner@example.test' }); assert.equal(calls[2].ConditionExpression, 'attribute_not_exists(PK)');
});
