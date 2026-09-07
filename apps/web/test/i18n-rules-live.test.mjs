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
  ['cancel dialog — cap disclosure (openCancelDialog, ADR 0041)',
    'Annuler maintenant permet au notaire de réclamer, sur justification et dans les 7 jours, ses frais réels et la valeur du travail accompli, jusqu’à ' + money + ' (' + pct + ' du montant convenu).',
    /lets the notary claim, with a written reason and within 7 days/, /réclamer|justification/],
  ['cancel toast (confirmCancelOffer)',
    'Offre annulée. Votre notaire peut réclamer, sur justification et dans les 7 jours, une indemnité allant jusqu’à ' + money + ' (' + pct + ' du montant convenu). Rien n’est retenu pour l’instant.',
    /Offer cancelled\. Your notary may claim, with a written reason and within 7 days, an indemnity of up to \$840 \(30%/, /frais|réclamer/],
  ['cancel bell entry body (confirmCancelOffer)',
    'Une indemnité de ' + money + ', justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement.',
    /^A \$840 indemnity, justified by the notary/, /frais|caution/],
  ['« Prochaine étape » receipt (offerNextStep)',
    'Vous avez annulé cette offre. Une indemnité de ' + money + ', justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement. Si vous changez d’avis, choisissez une nouvelle date au carnet.',
    /You cancelled this offer\. A \$840 indemnity/, /frais|caution/],
  ['unread badge aria-label (unreadLabel) — plural',
    '3 nouveaux messages', /3 new message/, /nouveaux/],
  ['unread badge aria-label (unreadLabel) — singular',
    '1 nouveau message', /1 new message/, /nouveau/],
  // The market-pulse rows name themselves for a screen reader in one composed
  // sentence (pulseRow). Three shapes, because the reference has three states:
  // a reference exists, too few offers to carry one, or no offer at all.
  ['pulse row aria-label (pulseRow) — with a month reference',
    'Refinancement, à partir de ' + D.money(2279) + ', repère du mois ' + D.money(4165) + '. Afficher le carnet pour cet acte.',
    /^Refinancing, from \$2,279, month’s reference \$4,165\. Show the carnet for this act\.$/,
    /repère|Afficher|cet acte/],
  ['pulse row aria-label (pulseRow) — too few offers for a reference',
    'Refinancement, à partir de ' + D.money(2279) + ', pas assez d’offres ce mois pour un repère. Afficher le carnet pour cet acte.',
    /^Refinancing, from \$2,279, not enough offers this month for a reference\. Show the carnet for this act\.$/,
    /assez|offres|Afficher|cet acte/],
  ['pulse row aria-label (pulseRow) — active filter, with a reference',
    'Refinancement, à partir de ' + D.money(2279) + ', repère du mois ' + D.money(4165) + '. Retirer ce filtre.',
    /^Refinancing, from \$2,279, month’s reference \$4,165\. Remove this filter\.$/,
    /repère|Retirer|filtre/],
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
    'Annuler maintenant permet au notaire de réclamer, sur justification et dans les ',
    ' du montant convenu).',
    'Rien n’est retenu automatiquement.',
    'La somme réservée sur votre carte reste en place jusqu’à sa décision, puis vous est libérée.',
    ', justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement.',
    'Vous avez annulé cette offre. ',
    ' Si vous changez d’avis, choisissez une nouvelle date au carnet.',
    "'Offre annulée. ' + keptLine",
    // pulseRow's own fragments, so a rewording of the aria-label fails here.
    "', à partir de '",
    "', repère du mois '",
    "', aucune offre ce mois'",
    "', pas assez d’offres ce mois pour un repère'",
    "'Afficher le carnet pour cet acte.'",
    "'Retirer ce filtre.'",
  ]) {
    assert.ok(APP_SRC.includes(frag), 'app.js no longer composes: ' + frag);
  }
});

test('French mode is the identity for every exemplar', () => {
  I18N.force('fr');
  for (const [, fr] of LIVE) assert.equal(I18N.t(fr), fr);
  I18N.force('en');
});
