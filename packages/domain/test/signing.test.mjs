import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../signing.js';

const at = 100000;
const ready = (status = 'admitted') => ({ status, expiresAt: at + S.SESSION_MS, admitted: true,
  participants: { notary: { joined: true, connected: true, lastSeenAt: at, acknowledged: false },
    client: { joined: true, connected: true, lastSeenAt: at, acknowledged: false } } });

test('rehearsal document states its absence of legal effect and proof binds exact context', () => {
  assert.match(S.DOCUMENT.text, /ne constitue pas un acte notarié/);
  assert.equal(S.proofMessage('session', 'hash', 'client', 'nonce'), 'NOTA-REHEARSAL-V1\nsession\nhash\nclient\nnonce');
});
test('only notary may review and release, and admission is necessary', () => {
  assert.equal(S.decision(ready(), 'client', 'review', at).ok, false);
  assert.equal(S.decision(ready(), 'notary', 'release', at).ok, false);
  assert.equal(S.decision(ready(), 'notary', 'review', at).ok, true);
  assert.equal(S.decision({ ...ready('paused'), admitted: false }, 'notary', 'review', at).ok, false);
  assert.equal(S.decision(ready('reviewed'), 'notary', 'release', at).ok, true);
});
test('missing and stale media presence stop review, release and acknowledgment', () => {
  for (const [status, action, role] of [['admitted', 'review', 'notary'], ['reviewed', 'release', 'notary'], ['released', 'acknowledge', 'client']]) {
    const session = ready(status);
    session.participants.client.lastSeenAt = at - S.PRESENCE_MS;
    assert.equal(S.decision(session, role, action, at).code, 'presence_requise');
    session.participants.client.lastSeenAt = at;
    session.participants.client.connected = false;
    assert.equal(S.decision(session, role, action, at).ok, false);
  }
});
test('client acknowledgment precedes notary completion; expiry and terminal states reject commands', () => {
  const s = ready('released');
  assert.equal(S.decision(s, 'notary', 'acknowledge', at).ok, false);
  s.participants.client.acknowledged = true;
  assert.deepEqual(S.decision(s, 'notary', 'acknowledge', at), { ok: true, status: 'complete', code: 'etape_invalide' });
  for (const terminal of ['complete', 'closed']) assert.equal(S.decision(ready(terminal), 'client', 'pause', at).ok, false);
  assert.equal(S.decision(s, 'client', 'close', s.expiresAt).ok, false);
});
