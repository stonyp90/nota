/**
 * Partner referrals (ADR 0011): flat rewards on TWO tracks, each with a
 * visible trigger. The amounts and the partner categories are DATA in the
 * domain; the ledger is always derived from the records, never kept as its
 * own state. Attribution (`parrain`) is private — these tests pin the two
 * amounts, the code format, and above all WHEN each track earns:
 *   • client:  50 $ the moment a referred demand is RETAINED (the owner chose
 *     the visible trigger — completion is tracked as information, not a gate);
 *   • notaire: 250 $ once per referred notary, at their first retained act.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('REFERRAL: two tracks, two flat, disclosable amounts — 50 $ client, 250 $ notaire', () => {
  // Flat and public so a regulated referrer (OACIQ brokers, notably) can
  // disclose them to their client — never a share of the notary's fee. The
  // notary track pays more because a notary is recurring supply.
  assert.equal(D.REFERRAL.client, 50);
  assert.equal(D.REFERRAL.notaire, 250);
  assert.ok(D.REFERRAL.notaire > D.REFERRAL.client, 'supply is worth more than one demand');
  // The single-amount model is gone — no stale `commission` key for an app to read.
  assert.equal('commission' in D.REFERRAL, false);
});

test('REFERRAL: the partner categories are the people who know a financing is coming', () => {
  assert.deepEqual(
    D.REFERRAL.partners.map((p) => p.id),
    ['agent_immobilier', 'courtier_hypothecaire', 'autre_professionnel'],
  );
  for (const p of D.REFERRAL.partners) {
    assert.ok(p.nom && p.nom.length > 0, `${p.id} has a French label`);
    assert.ok(p.nomEn && p.nomEn.length > 0, `${p.id} has an English label`);
  }
});

test('normalizeReferralCode: case-insensitive, separators dropped — eve-roy ≡ EVEROY', () => {
  assert.equal(D.normalizeReferralCode('eve-roy'), 'EVEROY');
  assert.equal(D.normalizeReferralCode('EVEROY'), 'EVEROY');
  assert.equal(D.normalizeReferralCode('  eve roy  '), 'EVEROY');
  assert.equal(D.normalizeReferralCode('eve_roy.2026'), 'EVEROY2026');
  assert.equal(D.normalizeReferralCode(null), '');
  assert.equal(D.normalizeReferralCode(undefined), '');
});

test('isReferralCode: 4–12 letters/digits after normalization, nothing else', () => {
  assert.equal(D.isReferralCode('eve-roy'), true, 'separators are forgiven');
  assert.equal(D.isReferralCode('EVEROY'), true);
  assert.equal(D.isReferralCode('AB12'), true, '4 is the shortest code');
  assert.equal(D.isReferralCode('A2C4E6G8I0K2'), true, '12 is the longest code');
  assert.equal(D.isReferralCode('abc'), false, 'too short');
  assert.equal(D.isReferralCode('A2C4E6G8I0K2M'), false, 'too long');
  assert.equal(D.isReferralCode(''), false);
  assert.equal(D.isReferralCode('   '), false);
  assert.equal(D.isReferralCode(null), false);
  assert.equal(D.isReferralCode('!!--..'), false, 'separators alone are not a code');
});

test('referralLedger: a client referral earns at RETENTION — open earns 0, retained earns 50 before any completion', () => {
  const openOnly = D.referralLedger([{ parrain: 'AGNT99', status: D.STATUS.OUVERTE }]);
  assert.deepEqual(openOnly, [{ code: 'AGNT99', demandes: 1, retenues: 0, completes: 0, notaires: 0, notairesActifs: 0, du: 0 }]);

  const retained = D.referralLedger([{ parrain: 'AGNT99', status: D.STATUS.RETENUE }]);
  assert.deepEqual(retained, [{ code: 'AGNT99', demandes: 1, retenues: 1, completes: 0, notaires: 0, notairesActifs: 0, du: 50 }],
    'the marketplace visibly worked — the 50 $ is owed, completion no longer gates it');
});

test('referralLedger: completes stays counted as information, and every spelling folds into one row', () => {
  const bids = [
    { parrain: 'everoy', status: D.STATUS.OUVERTE },                      // referred, still open — 0 $
    { parrain: 'EVE-ROY', status: D.STATUS.RETENUE },                     // retained — 50 $
    { parrain: 'eve roy', status: D.STATUS.RETENUE, acte: { id: 'a1' } }, // retained AND completed — 50 $, completes++
  ];
  const ledger = D.referralLedger(bids);
  assert.deepEqual(ledger, [{ code: 'EVEROY', demandes: 3, retenues: 2, completes: 1, notaires: 0, notairesActifs: 0, du: 100 }]);
  // completed must be strictly true to count as a completion record…
  const loose = D.referralLedger([{ parrain: 'EVEROY', status: D.STATUS.RETENUE, completed: 'oui' }]);
  assert.equal(loose[0].completes, 0, 'a truthy string is not a completion record');
  assert.equal(loose[0].du, 50, '…but retention still earns');
});

test('referralLedger: a referred notary earns 250 $ once — at their first retained act, never before', () => {
  const signedUpOnly = D.referralLedger([], [{ parrain: 'BROKR1' }]);
  assert.deepEqual(signedUpOnly, [{ code: 'BROKR1', demandes: 0, retenues: 0, completes: 0, notaires: 1, notairesActifs: 0, du: 0 }],
    'signing up is counted, not paid');

  const active = D.referralLedger([], [{ parrain: 'BROKR1', premierActe: '2026-08-20' }]);
  assert.deepEqual(active, [{ code: 'BROKR1', demandes: 0, retenues: 0, completes: 0, notaires: 1, notairesActifs: 1, du: 250 }],
    'the first retained act triggers the one-time 250 $');
});

test('referralLedger: the two tracks stack on one code — 2 retained demandes + 1 active notary owe 350 $', () => {
  const ledger = D.referralLedger(
    [
      { parrain: 'EVEROY', status: D.STATUS.RETENUE },
      { parrain: 'eve-roy', status: D.STATUS.RETENUE },
      { parrain: 'EVEROY', status: D.STATUS.OUVERTE },
    ],
    [
      { parrain: 'eve roy', premierActe: true },
      { parrain: 'EVEROY' }, // referred, no first act yet — counted, unpaid
    ],
  );
  assert.deepEqual(ledger, [{ code: 'EVEROY', demandes: 3, retenues: 2, completes: 0, notaires: 2, notairesActifs: 1, du: 2 * 50 + 250 }]);
});

test('referralLedger: records without a valid code are ignored on both tracks, never crash the fold', () => {
  const ledger = D.referralLedger(
    [
      { parrain: 'xx', status: D.STATUS.RETENUE }, // too short
      { parrain: '', status: D.STATUS.OUVERTE },
      { parrain: null, status: D.STATUS.OUVERTE },
      {},
      null,
      { parrain: 'GOODCODE', status: D.STATUS.OUVERTE },
    ],
    [
      { parrain: 'y', premierActe: true }, // too short — no 250 $ for an uncoded notary
      null,
      {},
    ],
  );
  assert.deepEqual(ledger, [{ code: 'GOODCODE', demandes: 1, retenues: 0, completes: 0, notaires: 0, notairesActifs: 0, du: 0 }]);
  assert.deepEqual(D.referralLedger([]), []);
  assert.deepEqual(D.referralLedger(null), []);
  assert.deepEqual(D.referralLedger(null, null), []);
});

test('referralLedger: sorted by dollars owed desc, then code asc — a stable partner statement', () => {
  const retained = (code) => ({ parrain: code, status: D.STATUS.RETENUE });
  const ledger = D.referralLedger(
    [
      { parrain: 'ZETA1', status: D.STATUS.OUVERTE },  // 0 $
      retained('MIKE1'),                                // 50 $
      retained('ALFA1'), retained('ALFA1'),             // 100 $
      retained('BETA1'),                                // 50 $ — ties MIKE1, code breaks the tie
    ],
    [{ parrain: 'NOTA1', premierActe: true }],          // 250 $ — the notary track leads the board
  );
  assert.deepEqual(ledger.map((e) => e.code), ['NOTA1', 'ALFA1', 'BETA1', 'MIKE1', 'ZETA1']);
  assert.deepEqual(ledger.map((e) => e.du), [250, 100, 50, 50, 0]);
});
