import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const emails = require('../src/emails');

test('every template accepts bilingual signature overrides with bounded plain text', () => {
  for (const key of Object.keys(emails.TEMPLATE_META)) {
    assert.equal(emails.validateOverride(key, { signatureFr: 'Camille — Équipe Nota', signatureEn: 'Camille — Nota team' }).ok, true, key);
    assert.equal(emails.validateOverride(key, { signatureFr: 'Camille' }).ok, false, key);
    assert.equal(emails.validateOverride(key, { signatureFr: '<script>x</script>', signatureEn: '<script>x</script>' }).ok, false, key);
    assert.equal(emails.validateOverride(key, { signatureFr: 'x'.repeat(241), signatureEn: 'x'.repeat(241) }).ok, false, key);
  }
});

test('signature renders in both alternatives while preserving sender and unsubscribe footer', () => {
  const msg = emails.offerPublished({ serviceId: 'refinancement', montant: 2000, dateISO: '2026-10-12', baseUrl: 'https://gonota.ca', unsubscribeUrl: 'https://gonota.ca/api/unsubscribe?token=test', __override: { signatureFr: 'Camille — Équipe Nota', signatureEn: 'Camille — Nota team' } });
  for (const body of [msg.html, msg.text]) {
    assert.ok(body.includes('Camille — Équipe Nota'));
    assert.ok(body.includes('Camille — Nota team'));
    assert.ok(body.includes('https://gonota.ca/api/unsubscribe?token=test'));
  }
});
