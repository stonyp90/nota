import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('Function URL adapter preserves incoming and outgoing OAuth cookies', async () => {
  let request;
  const app = { handle: async value => { request = value; return { statusCode: 200, headers: { 'set-cookie': 'nota_oauth_binding=bound; Secure; HttpOnly', 'cache-control': 'no-store' }, body: '{}' }; } };
  const context = { exports: {}, process: { env: {} }, Buffer, require: name => {
    if (name === './src/handler') return { createApp: () => app };
    if (name === './src/repo-dynamo') return { createDynamoRepo: () => ({}) };
    if (name === './src/runtime-secrets') return { loadRuntimeSecrets: async () => 'v1' };
    throw new Error(name);
  } };
  vm.runInNewContext(readFileSync(new URL('../index.js', import.meta.url), 'utf8'), context);
  const response = await context.exports.handler({ rawPath: '/api/auth/oauth/google/callback', headers: { origin: 'https://gonota.ca' }, cookies: ['other=value', 'nota_oauth_binding=bound'] });
  assert.equal(request.headers.cookie, 'other=value; nota_oauth_binding=bound');
  assert.equal(response.cookies[0], 'nota_oauth_binding=bound; Secure; HttpOnly');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
});
