/**
 * toE164 — the one canonical phone shape a carrier accepts.
 *
 * validateTelephone is deliberately loose (« a dialable North-American number
 * remains once the formatting is stripped ») because the human who dials it
 * reads the original. A text message has no human in between: the port needs
 * exactly one shape, and a number that is not unambiguously dialable must
 * become null rather than a guess.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import domain from '../index.js';

const { toE164, validateTelephone } = domain;

test('every formatting a person types resolves to the same E.164 number', () => {
  for (const raw of ['(418) 555-0100', '418.555.0100', '418 555 0100', '4185550100', '1 418 555 0100', '+1 418-555-0100', '1-418-555-0100']) {
    assert.equal(toE164(raw), '+14185550100', raw);
  }
});

test('what validateTelephone accepts, toE164 can always send — and vice versa', () => {
  for (const raw of ['(418) 555-0100', '1 418 555 0100', '514 555 0199']) {
    assert.equal(validateTelephone(raw).ok, true, raw);
    assert.match(toE164(raw), /^\+1\d{10}$/, raw);
  }
});

test('anything that is not a dialable NANP number is null, never a guess', () => {
  for (const raw of ['', null, undefined, '555-0100', '12345', '+33 6 12 34 56 78', '2 418 555 0100', 'abc', '418 555 01000']) {
    assert.equal(toE164(raw), null, String(raw));
  }
});

test('an eleven-digit number must start with the country code 1', () => {
  assert.equal(toE164('14185550100'), '+14185550100');
  assert.equal(toE164('24185550100'), null);
});
