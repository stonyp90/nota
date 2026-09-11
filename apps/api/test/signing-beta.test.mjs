import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { signToken, verifyToken, SCOPES } = require('../src/notary-auth');
const D = require('@nota/domain');
const S = require('@nota/domain/signing');

const start = Date.parse('2026-09-09T14:00:00Z');
const bid = { id: 'beta-bid', dateISO: '2026-09-18', notaryId: 'owner', status: D.STATUS.RETENUE, nom: 'Client Démo', serviceId: 'refinancement', montant: 2000 };
const sdp = 'v=0\r\na=fingerprint:sha-256 ' + Array(32).fill('AB').join(':') + '\r\n';
async function setup({ enabled = true, env = {} } = {}) {
  let now = start, n = 0;
  const repo = createMemoryRepo([{ ...bid }]);
  await repo.putNotary({ id: 'owner', status: 'active', nom: 'Me Exemple' });
  const keys = {};
  for (const role of ['notary', 'client']) keys[role] = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const app = createApp(repo, { env: { NOTA_SIGNING_BETA_ENABLED: String(enabled), ...env }, nowMs: () => now, newId: () => 's' + ++n });
  const token = (role, evidence = { verifiedAt: start }, sub) => signToken(sub || (role === 'notary' ? 'owner' : bid.id), now + 3600000,
    role === 'notary' ? SCOPES.SESSION : SCOPES.CLIENT, undefined, evidence);
  const call = async (path = '/signing-beta/sessions', { method = 'GET', role = 'notary', body = {}, auth = token(role) } = {}) => {
    const result = await app.handle({ path, method, headers: auth ? { authorization: 'Bearer ' + auth } : {}, sourceIp: '127.0.0.1',
      query: { bidId: bid.id, dateISO: bid.dateISO }, body: { bidId: bid.id, dateISO: bid.dateISO, ...body } });
    return { ...result, data: JSON.parse(result.body) };
  };
  const current = async role => (await call(undefined, { role })).data.session;
  const post = async (operation, body, role = 'notary') => {
    const session = await current(role);
    if (operation === 'signal' && body.sdp && body.signature === undefined) {
      const message = S.signalMessage(session.id, role, body.type, crypto.createHash('sha256').update(body.sdp).digest('hex'));
      body = { ...body, signature: Buffer.from(await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys[role].privateKey, Buffer.from(message))).toString('base64url') };
    }
    return call('/signing-beta/sessions/' + session.id + '/' + operation, { method: 'POST', role, body: { revision: session.revision, ...body } });
  };
  const command = (action, extra = {}, role = 'notary') => post('commands', { action, ...extra }, role);
  const create = () => crypto.webcrypto.subtle.exportKey('jwk', keys.notary.publicKey).then(publicKeyJwk => call(undefined, { method: 'POST', body: { publicKeyJwk } }));
  const admitted = async () => {
    assert.equal((await create()).statusCode, 201);
    assert.equal((await command('join', { publicKeyJwk: await crypto.webcrypto.subtle.exportKey('jwk', keys.client.publicKey) }, 'client')).statusCode, 200);
    assert.equal((await command('admit')).statusCode, 200);
  };
  const observed = async () => {
    const stored = await repo.getSigningSession(bid.id);
    if (!stored.signals.notary) assert.equal((await post('signal', { type: 'offer', sdp })).statusCode, 200);
    if (!stored.signals.client) assert.equal((await post('signal', { type: 'answer', sdp }, 'client')).statusCode, 200);
    for (const role of ['notary', 'client']) assert.equal((await post('heartbeat', { connected: true }, role)).statusCode, 200);
  };
  const acknowledge = async role => {
    const session = await current(role);
    const signature = Buffer.from(await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys[role].privateKey, Buffer.from(session.challenge.message))).toString('base64url');
    return command('acknowledge', { signature }, role);
  };
  return { repo, app, call, current, post, command, create, admitted, observed, acknowledge, keys, token, advance: ms => { now += ms; } };
}

test('capabilities explicitly report rehearsal, disabled by default and absent legal/identity approval', async () => {
  const a = await setup({ enabled: false });
  const c = await a.call('/signing-beta/capabilities', { auth: null });
  assert.equal(c.data.enabled, false);
  assert.equal(c.data.legalSignatureAvailable, false);
  assert.equal(c.data.identityProofingAvailable, false);
  assert.equal((await a.create()).statusCode, 503);
});
test('only fresh email-verified, retained owners can enter; feed and old bid tokens fail', async () => {
  const a = await setup();
  assert.equal((await a.call(undefined, { auth: null })).statusCode, 401);
  assert.equal((await a.call(undefined, { auth: a.token('client', {}) })).data.errors[0].code, 'reauth_required');
  assert.equal((await a.call(undefined, { auth: a.token('notary', { verifiedAt: start - S.AUTH_FRESH_MS }) })).statusCode, 401);
  assert.equal((await a.call(undefined, { auth: a.token('notary', undefined, 'other') })).statusCode, 403);
  assert.equal((await a.call(undefined, { auth: a.token('client', undefined, 'other') })).statusCode, 403);
  assert.equal((await a.call(undefined, { auth: signToken('owner', start + 60000, SCOPES.FEED, undefined, { verifiedAt: start }) })).statusCode, 401);
  await a.repo.putNotary({ id: 'owner', status: 'suspended' });
  assert.equal((await a.call()).statusCode, 403);
});
test('real WebCrypto acknowledgments are verified and export excludes SDP/credentials/challenges', async () => {
  const a = await setup();
  await a.admitted();
  assert.equal((await a.post('signal', { type: 'offer', sdp })).statusCode, 200);
  assert.equal((await a.post('signal', { type: 'answer', sdp }, 'client')).statusCode, 200);
  await a.observed();
  assert.equal((await a.command('review', { observationConfirmed: true })).statusCode, 200);
  assert.equal((await a.command('release')).statusCode, 200);
  assert.equal((await a.acknowledge('client')).statusCode, 200);
  const done = await a.acknowledge('notary');
  assert.equal(done.data.session.status, 'complete');
  assert.equal(done.data.session.peerSignal, null);
  const out = await a.call('/signing-beta/sessions/' + done.data.session.id + '/evidence');
  assert.equal(out.data.acknowledgments.length, 2);
  assert.equal(crypto.createHash('sha256').update(out.data.document.text).digest('hex'), out.data.document.sha256);
  for (const ack of out.data.acknowledgments) {
    const key = crypto.createPublicKey({ key: out.data.participants[ack.role].publicKeyJwk, format: 'jwk' });
    assert.equal(crypto.verify('sha256', Buffer.from(ack.message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(ack.signature, 'base64url')), true);
  }
  for (const forbidden of ['a=fingerprint', 'lastSeenAt', 'connected', 'credential', 'authorization']) assert.ok(!out.body.includes(forbidden));
  assert.equal(await a.repo.getActCompletion(bid.id), null);
  assert.deepEqual(await a.repo.get(bid.id, bid.dateISO), bid);
});
test('notary controls release; stale revisions and forged proof cannot advance', async () => {
  const a = await setup(); await a.admitted(); await a.observed();
  assert.equal((await a.command('review', { observationConfirmed: true }, 'client')).statusCode, 409);
  assert.equal((await a.command('review')).statusCode, 400);
  await a.command('review', { observationConfirmed: true }); await a.command('release');
  assert.equal((await a.command('acknowledge', { signature: 'A'.repeat(86) }, 'client')).statusCode, 422);
  assert.equal((await a.acknowledge('notary')).statusCode, 409);
  const s = await a.current();
  assert.equal((await a.call('/signing-beta/sessions/' + s.id + '/commands', { method: 'POST', body: { action: 'close', revision: s.revision - 1 } })).statusCode, 409);
  assert.equal((await a.current()).status, 'released');
});
test('disconnect or stale presence stops release, and expiry suppresses signals and signing', async () => {
  const a = await setup(); await a.admitted(); await a.observed();
  await a.command('review', { observationConfirmed: true });
  a.advance(S.PRESENCE_MS);
  assert.equal((await a.command('release')).data.errors[0].code, 'presence_requise');
  await a.observed(); await a.command('release');
  await a.post('heartbeat', { connected: false }, 'client');
  assert.equal((await a.current()).status, 'paused');
  assert.equal((await a.current()).challenge, null);
  a.advance(S.SESSION_MS);
  assert.equal((await a.current()).status, 'expired');
  assert.equal((await a.command('close')).statusCode, 409);
});
test('signaling requires admission, fingerprint, correct sender and bounded payload; no public leaks', async () => {
  const a = await setup(); await a.create();
  assert.equal((await a.post('signal', { type: 'offer', sdp })).statusCode, 409);
  await a.command('join', { publicKeyJwk: await crypto.webcrypto.subtle.exportKey('jwk', a.keys.client.publicKey) }, 'client'); await a.command('admit');
  assert.equal((await a.post('signal', { type: 'answer', sdp })).statusCode, 400);
  assert.equal((await a.post('signal', { type: 'offer', sdp: 'v=0\r\n' })).statusCode, 400);
  assert.equal((await a.post('signal', { type: 'offer', sdp: sdp + 'x'.repeat(24000) })).statusCode, 400);
  assert.equal((await a.post('signal', { type: 'offer', sdp, signature: 'A'.repeat(86) })).statusCode, 422);
  assert.equal((await a.post('signal', { type: 'offer', sdp })).statusCode, 200);
  const raw = await a.repo.get(bid.id, bid.dateISO); assert.equal(raw.signals, undefined);
  const publicResponse = await a.app.handle({ path: '/bids', method: 'GET', query: { month: '2026-09' } });
  assert.ok(!publicResponse.body.includes('fingerprint'));
});
test('rate limiting fails closed and persisted revisions/ownership are atomic', async () => {
  const a = await setup(); await a.create();
  const old = await a.repo.getSigningSession(bid.id);
  const [one, two] = await Promise.all([a.repo.compareAndSetSigningSession(bid.id, old.revision, { ...old, revision: old.revision + 1 }), a.repo.compareAndSetSigningSession(bid.id, old.revision, { ...old, revision: old.revision + 1 })]);
  assert.equal(Number(one) + Number(two), 1);
  await a.repo.put({ ...bid, notaryId: 'new-owner' });
  assert.equal(await a.repo.compareAndSetSigningSession(bid.id, old.revision + 1, { ...old, revision: old.revision + 2 }), false);
  a.repo.incrNotaryRateCounter = async () => { throw new Error('private details'); };
  const failed = await a.call(); assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('private details'));
});
test('Dynamo writes condition both retained ownership and dedicated session revision', async () => {
  const sent = [];
  const repo = createDynamoRepo({ tableName: 'test', doc: { async send(command) { sent.push(command.input); return {}; } } });
  await repo.compareAndSetSigningSession('beta-bid', 2, { ...bid, revision: 3 });
  assert.equal(sent[0].TransactItems.length, 2);
  assert.deepEqual(sent[0].TransactItems[0].ConditionCheck.Key, { PK: 'MONTH#2026-09', SK: 'BID#2026-09-18#beta-bid' });
  assert.equal(sent[0].TransactItems[1].Put.Item.PK, 'SIGNING_BETA#beta-bid');
  assert.equal(sent[0].TransactItems[1].Put.ConditionExpression, '#revision = :revision');
});
test('mailbox verification timestamp is signed; legacy tokens do not acquire it', () => {
  const fresh = signToken('owner', start + 1000, SCOPES.SESSION, undefined, { verifiedAt: start });
  assert.equal(verifyToken(fresh, start).verifiedAt, start);
  assert.equal(verifyToken(signToken('owner', start + 1000), start).verifiedAt, undefined);
  const [payload, sig] = fresh.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), verifiedAt: start + 5 })).toString('base64url') + '.' + sig;
  assert.equal(verifyToken(tampered, start), null);
});
test('participant public keys cannot be replaced and private JWK material is rejected', async () => {
  const a = await setup();
  const privateKeyJwk = await crypto.webcrypto.subtle.exportKey('jwk', a.keys.notary.privateKey);
  assert.equal((await a.call(undefined, { method: 'POST', body: { publicKeyJwk: privateKeyJwk } })).statusCode, 400);
  await a.admitted();
  const original = (await a.current()).participants.client.publicKeyJwk;
  assert.equal((await a.command('join', { publicKeyJwk: await crypto.webcrypto.subtle.exportKey('jwk', a.keys.notary.publicKey) }, 'client')).statusCode, 409);
  assert.deepEqual((await a.current()).participants.client.publicKeyJwk, original);
});
test('pausing invalidates the old challenge even after observation and release resume', async () => {
  const a = await setup(); await a.admitted(); await a.observed();
  await a.command('review', { observationConfirmed: true }); await a.command('release');
  const old = (await a.current('client')).challenge;
  const signature = Buffer.from(await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, a.keys.client.privateKey, Buffer.from(old.message))).toString('base64url');
  await a.command('pause'); await a.command('review', { observationConfirmed: true }); await a.command('release');
  assert.notEqual((await a.current('client')).challenge.nonce, old.nonce);
  assert.equal((await a.command('acknowledge', { signature }, 'client')).statusCode, 422);
  assert.equal((await a.current()).participants.client.acknowledged, false);
});
test('TURN credentials appear only after admission and remain bounded by session expiry', async () => {
  const secret = 'local-test-secret-that-is-long-enough-for-turn';
  const a = await setup({ env: { NOTA_SIGNING_TURN_URLS: '["turn:turn.example.test:3478?transport=udp"]', NOTA_SIGNING_TURN_SECRET: secret } });
  const created = await a.create(); assert.deepEqual(created.data.iceServers, []);
  await a.command('join', { publicKeyJwk: await crypto.webcrypto.subtle.exportKey('jwk', a.keys.client.publicKey) }, 'client');
  const admitted = await a.command('admit');
  const ice = admitted.data.iceServers[0];
  assert.equal(ice.username, Math.floor(admitted.data.session.expiresAt / 1000) + ':' + admitted.data.session.id + ':notary');
  assert.equal(ice.credential, crypto.createHmac('sha1', secret).update(ice.username).digest('base64'));
  assert.ok(!admitted.body.includes(secret));
  const closed = await a.command('close'); assert.deepEqual(closed.data.iceServers, []);
});
