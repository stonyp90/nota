/**
 * The composed sentences app.js actually produces at runtime must have a LIVE
 * English side. Exact-dictionary coverage is enforced elsewhere (i18n.test.mjs
 * scans index.html and the domain); the RULES that translate sentences with
 * amounts, rates and counts are only ever exercised by the strings the code
 * composes — and those strings drift (ADR 0033 reworded the cancellation-fee
 * sentences with « … et versés au notaire en dédommagement … » while the four
 * rules still matched the ADR 0023 wording, so an English client read French).
 *
 * Each exemplar below is the French sentence exactly as app.js composes it,
 * with a realistic amount / rate / count in place. The test fails on identity:
 * an untranslated exemplar means the rule and the code no longer agree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

const pct = '30 %';
const money = D.money(840);

// [name, French exemplar as composed by app.js, a fragment the English MUST carry,
//  a French fragment the English must NOT carry]
const LIVE = [
  ['cancel dialog — fee disclosure (openCancelDialog)',
    'Annuler maintenant retient des frais de ' + money + ' (' + pct + ' du montant convenu) sur la somme réservée pour cet acte. Ils sont versés au notaire en dédommagement de la journée réservée. Le reste vous est libéré immédiatement.',
    /(paid|transferred) to the notary/, /versés|caution/],
  ['cancel toast (confirmCancelOffer)',
    'Offre annulée. Des frais de ' + money + ' (' + pct + ') ont été retenus sur la somme réservée pour cet acte et versés au notaire en dédommagement.',
    /Offer cancelled\. A fee of \$840 \(30%\)/, /frais|caution/],
  ['cancel bell entry body (confirmCancelOffer)',
    'Des frais de ' + money + ' (' + pct + ') ont été retenus sur la somme réservée pour cet acte et versés au notaire en dédommagement.',
    /^A fee of \$840 \(30%\)/, /frais|caution/],
  ['« Prochaine étape » receipt (offerNextStep)',
    'Vous avez annulé cette offre. Des frais de ' + money + ' (' + pct + ') ont été retenus sur la somme réservée pour cet acte et versés au notaire en dédommagement. Si vous changez d’avis, choisissez une nouvelle date au carnet.',
    /You cancelled this offer\. A fee of \$840 \(30%\)/, /frais|caution/],
  ['unread badge aria-label (unreadLabel) — plural',
    '3 nouveaux messages', /3 new message/, /nouveaux/],
  ['unread badge aria-label (unreadLabel) — singular',
    '1 nouveau message', /1 new message/, /nouveau/],
];

for (const [name, fr, mustEn, mustNotFr] of LIVE) {
  test('live sentence translates: ' + name, () => {
    const en = I18N.tEn(fr);
    assert.notEqual(en, fr, 'identity — no rule matches the sentence app.js composes:\n  ' + fr);
    assert.match(en, mustEn, en);
    assert.ok(!mustNotFr.test(en), 'French left in the English: ' + en);
  });
}

// The exemplars above must be the sentences app.js really composes: each
// fixed fragment of the four cancellation sentences is looked up in the source
// so a future rewording fails here, not in a client's browser.
test('the cancellation exemplars mirror the fragments app.js composes', () => {
  for (const frag of [
    'Annuler maintenant retient des frais de ',
    ' du montant convenu) sur la somme réservée pour cet acte.',
    ' Ils sont versés au notaire en dédommagement de la journée réservée.',
    ' Le reste vous est libéré immédiatement.',
    ') ont été retenus sur la somme réservée pour cet acte et versés au notaire en dédommagement.',
    'Vous avez annulé cette offre. ',
    ' Si vous changez d’avis, choisissez une nouvelle date au carnet.',
    "'Offre annulée. ' + keptLine",
  ]) {
    assert.ok(APP_SRC.includes(frag), 'app.js no longer composes: ' + frag);
  }
});

test('French mode is the identity for every exemplar', () => {
  I18N.force('fr');
  for (const [, fr] of LIVE) assert.equal(I18N.t(fr), fr);
  I18N.force('en');
});
