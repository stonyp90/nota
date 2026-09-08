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
// Each event links to its request in the console. DESCRIPTION repeats the
// URL so calendar clients that hide the URL property still expose the action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCarnetFeed, buildNotaryFeed } = require('../src/ics.js');

const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
const BASE = 'https://nota.test';
const OFFRE = { id: 'abc-123', dateISO: '2026-09-15', serviceId: 'refinancement', montant: 2475 };

test('le carnet public ouvre la demande précise dans la console', () => {
  assert.match(buildCarnetFeed([OFFRE], '20260902T120000Z', BASE), /\r\nURL:https:\/\/nota\.test\/#notaires&acte=abc-123\r\n/);
});

test('une signature retenue ramène à la console du notaire', () => {
  assert.match(buildNotaryFeed([OFFRE], '20260902T120000Z', BASE), /\r\nURL:https:\/\/nota\.test\/#notaires&acte=abc-123\r\n/);
});

test('sans origine connue, aucun lien inventé', () => {
  // L'origine vient de la configuration. Absente, un événement sans lien vaut
  // mieux qu'un lien vers un domaine faux.
  assert.doesNotMatch(buildCarnetFeed([OFFRE], null), /URL:/);
  assert.doesNotMatch(buildNotaryFeed([OFFRE], null), /URL:/);
});

test('une barre oblique finale en trop ne double jamais', () => {
  assert.match(buildCarnetFeed([OFFRE], null, 'https://nota.test/'), /\r\nURL:https:\/\/nota\.test\/#notaires&acte=abc-123\r\n/);
  assert.doesNotMatch(buildCarnetFeed([OFFRE], null, 'https://nota.test//'), /nota\.test\/\//);
});

test('le flux reste parsable, un seul VEVENT par demande', () => {
  const ics = buildCarnetFeed([OFFRE], null, BASE);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 1);
  assert.ok(ics.endsWith('END:VCALENDAR'));
  assert.match(ics, /\r\nURL:[^\r\n]+\r\nEND:VEVENT/, 'URL doit rester DANS le VEVENT');
});

for (const build of [buildCarnetFeed, buildNotaryFeed]) {
  test(build.name + ': each description contains its own encoded link, without credentials', () => {
    const ids = ['abc-123', 'bid &é/#?'];
    const feed = build(ids.map(id => ({ ...OFFRE, id })), null, BASE);
    const events = unfold(feed).split('BEGIN:VEVENT').slice(1);
    events.forEach((event, i) => {
      const link = BASE + '/#notaires&acte=' + encodeURIComponent(ids[i]);
      assert.ok(event.includes('URL:' + link + '\r\n'));
      const description = event.split('\r\n').find(line => line.startsWith('DESCRIPTION:'));
      assert.ok(description.includes(link), 'link remains visible in event description');
      assert.match(description, /Ouvrir.*Nota.*Open.*Nota/);
      assert.doesNotMatch(event, /token=|nauth=|courriel/);
    });
    for (const line of feed.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
    assert.doesNotMatch(build([OFFRE], null), /Ouvrir|Open in Nota|Open this file/);
  });
}
