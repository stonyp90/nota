// UN ÉVÉNEMENT D'AGENDA DOIT RAMENER QUELQUE PART.
//
// Le carnet s'ajoute à Outlook, Google ou Apple en un clic, et les demandes y
// apparaissent à leur date. Mais un VEVENT sans propriété `URL:` est une
// impasse : le notaire voit « Refinancement hypothécaire — 2 475 $ » le mardi
// 15, et n'a d'autre choix que de retenir la date, d'ouvrir un navigateur et
// de retrouver la demande à la main. C'est là qu'on abandonne.
//
// RFC 5545 §3.8.4.6 prévoit exactement cela : URL associe à l'événement la
// ressource qui le décrit, et les clients d'agenda l'affichent en lien.
//
// Chaque flux pointe vers SA surface — le carnet public vers le carnet, les
// signatures retenues vers la console du notaire. Pas de lien par offre : l'app
// n'a pas de route profonde vers une demande, et en inventer une pour un
// courriel serait mettre la charrue devant les bœufs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCarnetFeed, buildNotaryFeed } = require('../src/ics.js');

const BASE = 'https://nota.test';
const OFFRE = { id: 'abc-123', dateISO: '2026-09-15', serviceId: 'refinancement', montant: 2475 };

test('le carnet public ramène au carnet', () => {
  assert.match(buildCarnetFeed([OFFRE], '20260902T120000Z', BASE), /\r\nURL:https:\/\/nota\.test\/\r\n/);
});

test('une signature retenue ramène à la console du notaire', () => {
  assert.match(buildNotaryFeed([OFFRE], '20260902T120000Z', BASE), /\r\nURL:https:\/\/nota\.test\/#notaires\r\n/);
});

test('sans origine connue, aucun lien inventé', () => {
  // L'origine vient de la configuration. Absente, un événement sans lien vaut
  // mieux qu'un lien vers un domaine faux.
  assert.doesNotMatch(buildCarnetFeed([OFFRE], null), /URL:/);
  assert.doesNotMatch(buildNotaryFeed([OFFRE], null), /URL:/);
});

test('une barre oblique finale en trop ne double jamais', () => {
  assert.match(buildCarnetFeed([OFFRE], null, 'https://nota.test/'), /\r\nURL:https:\/\/nota\.test\/\r\n/);
  assert.doesNotMatch(buildCarnetFeed([OFFRE], null, 'https://nota.test//'), /nota\.test\/\//);
});

test('le flux reste parsable, un seul VEVENT par demande', () => {
  const ics = buildCarnetFeed([OFFRE], null, BASE);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 1);
  assert.ok(ics.endsWith('END:VCALENDAR'));
  assert.match(ics, /\r\nURL:[^\r\n]+\r\nEND:VEVENT/, 'URL doit rester DANS le VEVENT');
});
