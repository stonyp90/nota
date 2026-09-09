import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTurnSecretReader } = require('../src/turn-secret');
const { createSalleService } = require('../src/salle');

test('the relay secret is cached briefly, then rotates from SSM', async () => {
  let now = 0, reads = 0;
  const read = createTurnSecretReader({
    env: { NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER: '/nota/test/turn' }, nowMs: () => now,
    readTurnSecret: async name => { assert.equal(name, '/nota/test/turn'); return String(++reads).repeat(32); },
  });
  assert.equal(await read(), '1'.repeat(32));
  assert.equal(await read(), '1'.repeat(32));
  now = 300001;
  assert.equal(await read(), '2'.repeat(32));
});

test('the ceremony uses the existing Canadian relay without exposing its shared secret', async () => {
  const secret = 'x'.repeat(40), nowMs = () => 1800000000000;
  const urls = ['turn:turn.gonota.ca:3478?transport=udp', 'turns:turn.gonota.ca:443?transport=tcp'];
  const salle = createSalleService({ env: {
    NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER: '/nota/test/turn', NOTA_SIGNING_TURN_URLS: JSON.stringify(urls),
  }, nowMs, readTurnSecret: async () => secret });
  const servers = await salle.iceServers('client:bid-test');
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].urls, urls);
  const expiry = Number(servers[0].username.split(':')[0]);
  assert.equal(expiry, nowMs() / 1000 + 1800);
  assert.equal(servers[0].credential, crypto.createHmac('sha1', secret).update(servers[0].username).digest('base64'));
  assert.ok(!JSON.stringify(servers).includes(secret));
});

test('a configured relay with an unavailable secret fails instead of falling back to a direct connection', async () => {
  const salle = createSalleService({ env: {
    NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER: '/nota/test/turn', NOTA_SIGNING_TURN_URLS: 'turn:turn.gonota.ca:3478',
  }, readTurnSecret: async () => '' });
  await assert.rejects(salle.iceServers('client:bid-test'), /TURN secret unavailable/);
});
