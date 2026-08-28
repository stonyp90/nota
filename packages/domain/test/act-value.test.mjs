// The value confirmed at signing prices the commission, and the write-once act
// ledger makes it permanent — so the domain bounds it against the retained
// offer. A fat-fingered « 46 004 600 » (the offer typed twice) must die in
// validation, never in the ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('validateActValue accepts the retained amount as-is', () => {
  const out = D.validateActValue({ actAmount: 4600, retainedMontant: 4600 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
  assert.equal(out.actAmount, 4600);
});

test('validateActValue accepts a modest signing adjustment and coerces strings', () => {
  for (const val of ['5200', 5200, 3500]) {
    const out = D.validateActValue({ actAmount: val, retainedMontant: 4600 });
    assert.equal(out.ok, true, val + ' must pass');
    assert.equal(out.actAmount, Number(val));
  }
});

test('validateActValue refuses a non-positive or non-numeric value', () => {
  for (const bad of [0, -5, 'abc', null, undefined, NaN]) {
    const out = D.validateActValue({ actAmount: bad, retainedMontant: 4600 });
    assert.equal(out.ok, false, bad + ' must be refused');
    assert.ok(out.errors.some((e) => e.code === 'montant_invalide'));
    assert.equal(out.actAmount, null);
  }
});

test('validateActValue refuses a value far outside the retained offer (both directions)', () => {
  // The append-typo (4600 typed into a prefilled 4600 → 46004600) and the
  // lost-digits typo (460) are both out of bounds.
  for (const bad of [46004600, 460, 46000]) {
    const out = D.validateActValue({ actAmount: bad, retainedMontant: 4600 });
    assert.equal(out.ok, false, bad + ' must be refused');
    assert.ok(out.errors.some((e) => e.code === 'montant_hors_bornes'), bad + ' → montant_hors_bornes');
  }
});

test('the bounds are the published ratios of the retained offer', () => {
  const { minRatio, maxRatio } = D.ACT_VALUE_BOUNDS;
  assert.ok(minRatio > 0 && maxRatio > 1);
  const lo = Math.round(4600 * minRatio);
  const hi = Math.round(4600 * maxRatio);
  assert.equal(D.validateActValue({ actAmount: lo, retainedMontant: 4600 }).ok, true);
  assert.equal(D.validateActValue({ actAmount: hi, retainedMontant: 4600 }).ok, true);
  assert.equal(D.validateActValue({ actAmount: lo - 1, retainedMontant: 4600 }).ok, false);
  assert.equal(D.validateActValue({ actAmount: hi + 1, retainedMontant: 4600 }).ok, false);
});

test('without a retained reference, only positivity applies', () => {
  const out = D.validateActValue({ actAmount: 46004600 });
  assert.equal(out.ok, true); // nothing to compare against — the API always has one
  assert.equal(out.actAmount, 46004600);
});
