import assert from 'node:assert/strict';

/**
 * Drive the two-step, email-verified partner code claim (request → verify) and
 * return the confirmed partner body `{ code, type, courriel, createdAt,
 * confirmedAt }`. Outside production the request echoes the single-use
 * verification token (`devToken`), so tests confirm a code with no mailbox —
 * mirroring test-support/notary-session.mjs.
 *
 * `body` is the claim payload `{ type, courriel, code }`. Lives OUTSIDE
 * apps/api/test so node --test never treats it as a test file.
 */
export async function claimPartner(app, body, { ip } = {}) {
  const req = await app.handle({
    method: 'POST',
    path: '/partenaires',
    body: JSON.stringify(body),
    ...(ip ? { sourceIp: ip } : {}),
  });
  assert.equal(req.statusCode, 200, 'claim request body: ' + req.body);
  const rbody = JSON.parse(req.body);
  // The owner re-claiming an already-confirmed code short-circuits (no token to
  // redeem): the request already carries the confirmed partner.
  if (rbody.confirmed && rbody.partenaire) return rbody.partenaire;
  assert.ok(rbody.devToken, 'dev echo must carry the verification token: ' + req.body);
  const ver = await app.handle({
    method: 'POST',
    path: '/partenaires/verify',
    body: JSON.stringify({ token: rbody.devToken }),
  });
  assert.equal(ver.statusCode, 201, 'verify body: ' + ver.body);
  return JSON.parse(ver.body).partenaire;
}
