'use strict';

/**
 * The identity a notary needs before they may RETAIN or PROPOSE (ADR 0033):
 * a name, a phone and the étude's address — `domain.notaryContactMissing`
 * gates /notary/bids/accept and /notary/bids/propose on exactly these three.
 * Tests that seed a notary who will act on a demande spread this block so the
 * gate is a fact of the fixture, not a surprise 403 in an unrelated suite.
 *
 * CommonJS so the Cucumber steps (features/steps) can require it; the ESM
 * tests import the `.mjs` twin, which re-exports this file.
 * Lives OUTSIDE apps/api/test so node --test never treats it as a test file.
 */
const { notaryIdForEmail } = require('../src/notary-auth.js');

const NOTARY_CONTACT = Object.freeze({
  nom: 'Me Test Notaire',
  telephone: '418 555 0100',
  adresse: '1, rue du Test, Québec (QC) G1R 1A1',
});

/** An ACTIVE, contactable notary record for `repo.putNotary`. */
function activeNotary(email, over = {}) {
  return { id: notaryIdForEmail(email), email, status: 'active', ...NOTARY_CONTACT, ...over };
}

module.exports = { NOTARY_CONTACT, activeNotary };
