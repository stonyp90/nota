/**
 * English labels in the domain. Server-side consumers (email templates, ICS
 * feeds) need English service/tier names, and labels meaningful to the product
 * live in @nota/domain — so the English names live beside the French ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const D = createRequire(import.meta.url)('../index.js');

test('every service carries English names', () => {
  // The financing family (ADR 0010) — the walker covers whatever the catalogue holds.
  const expected = {
    refinancement: ['Mortgage refinancing', 'Refinancing'],
    financement: ['Mortgage financing', 'Financing'],
  };
  for (const s of D.SERVICES) {
    assert.ok(s.nomEn && s.nomCourtEn, `service ${s.id} is missing nomEn/nomCourtEn`);
    assert.ok(expected[s.id], `service ${s.id} has pinned English names`);
    assert.equal(s.nomEn, expected[s.id][0]);
    assert.equal(s.nomCourtEn, expected[s.id][1]);
  }
});

test('every tier carries an English name', () => {
  const expected = { standard: 'Standard', rapide: 'Fast', prioritaire: 'Priority', urgence: 'Urgent', extreme: 'Extreme' };
  for (const t of D.TIERS) {
    assert.equal(t.nomEn, expected[t.id], `tier ${t.id}`);
  }
});
