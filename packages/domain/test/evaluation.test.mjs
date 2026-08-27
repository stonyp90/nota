// After the act is signed and settled (ADR 0015), the client evaluates the
// notary: a 1–5 note plus an optional comment. The domain owns the validation
// and the average math; storage and gating live in the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('validateEvaluation accepts a plain note and normalizes the comment', () => {
  const out = D.validateEvaluation({ note: '5', commentaire: '  Impeccable, merci !  ' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
  assert.equal(out.note, 5);
  assert.equal(out.commentaire, 'Impeccable, merci !');
});

test('validateEvaluation requires an integer note between 1 and 5', () => {
  for (const bad of [0, 6, 3.5, 'abc', null, undefined]) {
    const out = D.validateEvaluation({ note: bad });
    assert.equal(out.ok, false, 'note ' + bad + ' must be refused');
    assert.ok(out.errors.some((e) => e.code === 'note_invalide'));
  }
});

test('validateEvaluation caps the comment and keeps it optional', () => {
  const ok = D.validateEvaluation({ note: 4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.commentaire, null);
  const long = D.validateEvaluation({ note: 4, commentaire: 'x'.repeat(D.EVALUATION_COMMENT_MAX + 1) });
  assert.equal(long.ok, false);
  assert.ok(long.errors.some((e) => e.code === 'commentaire_trop_long'));
});

test('ratingAverage rounds to one decimal and answers null with no ratings', () => {
  assert.equal(D.ratingAverage(0, 0), null);
  assert.equal(D.ratingAverage(9, 2), 4.5);
  assert.equal(D.ratingAverage(13, 3), 4.3);
  assert.equal(D.ratingAverage(5, 1), 5);
});
