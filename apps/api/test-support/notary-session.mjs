import assert from 'node:assert/strict';

/**
 * Drive the two-step passwordless notary sign-in (request → verify) and return
 * the session body `{ token, feedToken, expiresAt }`. Outside production the
 * request echoes the single-use challenge token (`devToken`), so tests complete
 * the handshake with no mailbox. The caller seeds an ACTIVE notary (or runs
 * under NOTA_DEMO_OPEN) beforehand, exactly as the old one-shot route required.
 *
 * Lives OUTSIDE apps/api/test so node --test never treats it as a test file.
 */
export async function notarySignIn(app, email, { ip } = {}) {
  const req = await app.handle({
    method: 'POST',
    path: '/notary/session/request',
    body: JSON.stringify({ email }),
    ...(ip ? { sourceIp: ip } : {}),
  });
  assert.equal(req.statusCode, 200, 'request body: ' + req.body);
  const rbody = JSON.parse(req.body);
  assert.ok(rbody.devToken, 'dev echo must carry the challenge token: ' + req.body);
  const ver = await app.handle({
    method: 'POST',
    path: '/notary/session/verify',
    body: JSON.stringify({ token: rbody.devToken }),
  });
  assert.equal(ver.statusCode, 200, 'verify body: ' + ver.body);
  return JSON.parse(ver.body);
}
