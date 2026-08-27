import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// The retained-act conversation: once a notary retains an act, client and
// notary talk inside Nota — and the notary may still withdraw when a surfaced
// detail (an unfamiliar lender, a conflict) makes the file impossible.

const RETAINED = { id: 'b1', serviceId: 'refinancement', status: D.STATUS.RETENUE, notaryId: 'n-1', etude: 'Étude Laval' };
const OPEN = { id: 'b2', serviceId: 'refinancement', status: D.STATUS.OUVERTE };

test('validateChatMessage: accepts a plain message from either role on a retained act', () => {
  for (const de of [D.CHAT_FROM.CLIENT, D.CHAT_FROM.NOTAIRE]) {
    const r = D.validateChatMessage({ bid: RETAINED, de, texte: '  Bonjour — le relevé arrive demain.  ' });
    assert.equal(r.ok, true);
    assert.equal(r.texte, 'Bonjour — le relevé arrive demain.');
  }
});

test('validateChatMessage: rejects empty, oversized, unknown-sender and non-retained', () => {
  assert.ok(D.validateChatMessage({ bid: RETAINED, de: 'client', texte: '   ' }).errors.some((e) => e.code === 'message_requis'));
  assert.ok(
    D.validateChatMessage({ bid: RETAINED, de: 'client', texte: 'x'.repeat(D.CHAT_MESSAGE_MAX + 1) })
      .errors.some((e) => e.code === 'message_trop_long'),
  );
  assert.ok(D.validateChatMessage({ bid: RETAINED, de: 'banquier', texte: 'Allo' }).errors.some((e) => e.code === 'expediteur_invalide'));
  assert.ok(D.validateChatMessage({ bid: OPEN, de: 'client', texte: 'Allo' }).errors.some((e) => e.code === 'offre_non_retenue'));
  assert.ok(D.validateChatMessage({ de: 'client', texte: 'Allo' }).errors.some((e) => e.code === 'offre_non_retenue'));
});

test('validateRelease: only a retained act can be put back on the market', () => {
  assert.equal(D.validateRelease({ bid: RETAINED }).ok, true);
  assert.equal(D.validateRelease({ bid: RETAINED, message: 'Prêteur hors de mes habitudes.' }).message, 'Prêteur hors de mes habitudes.');
  assert.ok(D.validateRelease({ bid: OPEN }).errors.some((e) => e.code === 'offre_non_retenue'));
  assert.ok(D.validateRelease({}).errors.some((e) => e.code === 'offre_non_retenue'));
  assert.ok(
    D.validateRelease({ bid: RETAINED, message: 'x'.repeat(D.CHAT_MESSAGE_MAX + 1) })
      .errors.some((e) => e.code === 'message_trop_long'),
  );
});

test('releasedBid: the act returns to the market exactly as the client posted it', () => {
  const out = D.releasedBid({ ...RETAINED, montant: 2400, dateISO: '2026-09-20' });
  assert.equal(out.status, D.STATUS.OUVERTE);
  assert.equal(out.notaryId, null);
  assert.equal(out.etude, null);
  assert.equal(out.montant, 2400);
  assert.equal(out.dateISO, '2026-09-20');
  // The original is untouched — pure function.
  assert.equal(RETAINED.status, D.STATUS.RETENUE);
});
