// UNE SURCHARGE ADMIN NE DOIT PAS POUVOIR RÉÉCRIRE CE QUE LE CODE A RETIRÉ.
//
// Les gardes déontologiques du 2026-09-02 vérifient la copie NATIVE des 41
// gabarits : aucun « commission », aucun pourcentage de partage, aucune
// promesse de vitesse. Elles ne regardaient pas la copie ADMIN — or depuis que
// la surcharge porte le préheader, le corps et le libellé du bouton, un
// opérateur pouvait y remettre, en une phrase, ce que l'ADR 0031 a passé une
// journée à retirer du code.
//
// Ce qui est refusé, et pourquoi :
//
//   • « commission », « part de vos honoraires », « X % de ce que le client
//     paie » — l'art. 32 du Code de déontologie interdit au notaire de partager
//     ses honoraires avec un non-membre d'un ordre, et l'art. 32.1 2° de la Loi
//     sur le notariat frappe l'intermédiaire qui l'obtient. Nota ne prélève
//     plus rien : une phrase qui l'affirmerait serait à la fois FAUSSE et une
//     pièce écrite contre elle-même.
//
// Ce qui reste permis : tout le reste. La règle vise le partage d'honoraires,
// pas le vocabulaire de l'argent — un courriel doit pouvoir parler de prix, de
// paiement et de montants.
//
// ⚠️ HYPOTHÈSE ASSUMÉE, à relâcher si le propriétaire le décide : la console
// admin est traitée comme une surface publiée, pas comme un opérateur de
// confiance. Le motif est étroit et le message dit quoi écrire à la place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const emails = require('../src/emails.js');

const codes = (r) => (r.errors || []).map((e) => e.code);

// Un gabarit client, non transactionnel, dont le corps est surchargeable.
const CIBLE = 'clientWelcome';

test('une surcharge ne peut pas réintroduire « commission » dans un courriel client', () => {
  const r = emails.validateOverride(CIBLE, {
    corpsFr: 'Nota prélève une commission sur les honoraires de votre notaire.',
    corpsEn: 'Nota takes a commission on your notary’s fees.',
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('partage_interdit'), JSON.stringify(r.errors));
  assert.match(r.errors[0].message, /honoraires/, r.errors[0].message);
});

test('ni une part des honoraires exprimée en pourcentage', () => {
  const r = emails.validateOverride(CIBLE, {
    corpsFr: 'Le notaire garde 85 % de ce que vous payez.',
    corpsEn: 'The notary keeps 85% of what you pay.',
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('partage_interdit'), JSON.stringify(r.errors));
});

test('la règle vaut sur les QUATRE paires, pas seulement le corps', () => {
  for (const champ of ['subject', 'preheader', 'corps', 'cta']) {
    const r = emails.validateOverride(CIBLE, {
      [champ + 'Fr']: 'Commission Nota',
      [champ + 'En']: 'Nota commission',
    });
    assert.equal(r.ok, false, champ + ' devrait être refusé');
    assert.ok(codes(r).includes('partage_interdit'), champ + ' : ' + JSON.stringify(r.errors));
  }
});

test('parler d’argent reste permis — la règle vise le PARTAGE, pas le vocabulaire', () => {
  const r = emails.validateOverride(CIBLE, {
    corpsFr: 'Vous payez vos honoraires au notaire et le prix du service de Nota, affichés avant tout paiement.',
    corpsEn: 'You pay the notary’s fees and Nota’s service price, both shown before any payment.',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('un pourcentage qui ne parle pas d’honoraires reste permis', () => {
  const r = emails.validateOverride(CIBLE, {
    corpsFr: 'Les frais d’annulation tardive atteignent 30 % du montant convenu.',
    corpsEn: 'Late cancellation fees reach 30% of the agreed amount.',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});
