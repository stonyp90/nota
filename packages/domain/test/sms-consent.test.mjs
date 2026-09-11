/**
 * Le texto est un canal de consentement EXPRÈS (ADR 0051).
 *
 * LCAP / CASL : un texto est un message électronique commercial, et Nota n'y
 * lit aucune exemption transactionnelle. Le domaine porte donc trois règles
 * pures, sans I/O :
 *   • validateSmsConsent — ce qu'un formulaire a le droit de dire (vrai, faux,
 *     rien) et ce qu'il n'a pas le droit de dire (« oui », 1, 'true') ;
 *   • alertes.sms du notaire — un booléen strict, faux par défaut, dans la même
 *     structure que pace/urgentOnly ;
 *   • smsText — la ligne unique qu'un carrier reçoit : préfixe dans la langue
 *     du destinataire, sujet du gabarit, lien profond, 320 caractères au plus ;
 *   • maskTelephone — ce que l'écran des préférences peut montrer du numéro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

test('validateSmsConsent : absent ou nul vaut « non » ; seul un booléen est accepté', () => {
  for (const raw of [undefined, null]) {
    const r = D.validateSmsConsent(raw);
    assert.deepEqual(r, { ok: true, value: false, error: null }, String(raw));
  }
  assert.deepEqual(D.validateSmsConsent(true), { ok: true, value: true, error: null });
  assert.deepEqual(D.validateSmsConsent(false), { ok: true, value: false, error: null });
  // Un consentement exprès ne se déduit JAMAIS d'une chaîne « truthy ».
  for (const raw of ['true', 'oui', 1, 0, 'false', {}, []]) {
    const r = D.validateSmsConsent(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.value, null);
    assert.equal(r.error.code, 'sms_consent_invalide');
    assert.ok(r.error.message.length > 0);
  }
});

test('alertes du notaire : sms est faux par défaut, retenu quand vrai, refusé quand ce n’est pas un booléen', () => {
  assert.deepEqual(D.NOTARY_ALERTES_DEFAULT, { pace: 'daily', urgentOnly: false, sms: false });
  assert.deepEqual(D.validateNotaryAlertes(undefined).value, { pace: 'daily', urgentOnly: false, sms: false });
  assert.deepEqual(D.validateNotaryAlertes({ pace: 'instant' }).value, { pace: 'instant', urgentOnly: false, sms: false });
  assert.deepEqual(D.validateNotaryAlertes({ pace: 'instant', sms: true }).value, { pace: 'instant', urgentOnly: false, sms: true });
  assert.deepEqual(D.validateNotaryAlertes({ sms: false }).value, { pace: 'daily', urgentOnly: false, sms: false });
  for (const bad of ['oui', 1, 'true']) {
    const r = D.validateNotaryAlertes({ pace: 'daily', sms: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors.some((e) => e.code === 'alertes_invalides'), JSON.stringify(r.errors));
  }
  // Un profil stocké sans le champ (antérieur à l'ADR 0051) lit « faux ».
  assert.deepEqual(D.notaryAlertes({ alertes: { pace: 'weekly', urgentOnly: true } }), { pace: 'weekly', urgentOnly: true, sms: false });
  // Et validateNotaryProfile porte la même structure.
  assert.deepEqual(D.validateNotaryProfile({ alertes: { pace: 'instant', sms: true } }).alertes, { pace: 'instant', urgentOnly: false, sms: true });
});

test('smsText : une ligne, préfixe dans la langue, sujet puis lien, 320 caractères au plus', () => {
  assert.equal(D.SMS_TEXT_MAX, 320);
  assert.equal(
    D.smsText({ lang: 'fr', subject: 'Un notaire a retenu votre demande', url: 'https://nota.example/#offre=b1' }),
    'Nota : Un notaire a retenu votre demande — https://nota.example/#offre=b1'
  );
  assert.equal(
    D.smsText({ lang: 'en', subject: 'A notary has taken your request', url: 'https://nota.example/#offre=b1' }),
    'Nota: A notary has taken your request — https://nota.example/#offre=b1'
  );
  // La langue inconnue est le français ; un sujet vide ne produit rien.
  assert.equal(D.smsText({ subject: 'Sujet', url: 'https://nota.example/' }), 'Nota : Sujet — https://nota.example/');
  assert.equal(D.smsText({ lang: 'fr', subject: '   ', url: 'https://nota.example/' }), null);
  // Sans lien, le sujet seul ; les sauts de ligne du sujet sont aplatis.
  assert.equal(D.smsText({ lang: 'fr', subject: 'Ligne\nune  et\tdeux', url: null }), 'Nota : Ligne une et deux');
  // Le plafond du carrier : le lien survit, c'est le sujet qui cède.
  const long = D.smsText({ lang: 'fr', subject: 'x'.repeat(400), url: 'https://nota.example/#offre=b1' });
  assert.equal(long.length, 320);
  assert.ok(long.endsWith(' — https://nota.example/#offre=b1'), 'le lien est intact au bout');
  assert.ok(long.includes('…'), 'le sujet tronqué le dit');
});

test('maskTelephone : les quatre derniers chiffres seulement', () => {
  assert.equal(D.maskTelephone('(418) 555-0100'), '••• ••• 0100');
  assert.equal(D.maskTelephone('+14185550100'), '••• ••• 0100');
  assert.equal(D.maskTelephone(''), null);
  assert.equal(D.maskTelephone(null), null);
  assert.equal(D.maskTelephone('12'), null, 'moins de quatre chiffres : rien à montrer');
});
