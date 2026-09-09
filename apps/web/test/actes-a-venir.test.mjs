/**
 * Le catalogue des actes vendus à l'écran 1 de la feuille de réservation.
 *
 * Ce que ces cartes doivent tenir :
 *   1. testament and procuration are bookable services, not duplicate
 *      coming-soon cards;
 *   2. every service exposes its own intake and price criteria;
 *   3. selecting either new service updates the same booking form.
 *
 * Boot harness identique à booking-defaults.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const FLAT = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, D: win.NotaDomain };
}

async function openBooking(doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  return iso;
}

test('le catalogue ne duplique pas les services vendus dans les actes à venir', async () => {
  const { D } = await boot();
  assert.equal(D.ACTES_A_VENIR.length, 0);
  assert.ok(D.serviceById('testament'));
  assert.ok(D.serviceById('procuration'));
  assert.equal(D.acteAVenirById('testament'), null);
  assert.equal(D.acteAVenirById('refinancement'), null, 'un acte en vente n’est pas « à venir »');
});

test('l’écran 1 montre les quatre actes réservable et aucun faux « Bientôt »', async () => {
  const { doc, D } = await boot();
  await openBooking(doc);
  const soon = [...doc.querySelectorAll('#o-service-chips .chip-soon')];
  assert.equal(soon.length, 0);
  const all = [...doc.querySelectorAll('#o-service-chips .chip')];
  assert.equal(all.map((b) => b.dataset.svc || b.dataset.soon).join(','), D.SERVICES.map((s) => s.id).join(','));
});

test('cliquer testament ou procuration sélectionne le service et conserve le flux de prix', async () => {
  const { doc } = await boot();
  await openBooking(doc);
  doc.querySelector('#o-service-chips .chip[data-svc="testament"]').click();
  await wait(20);
  assert.equal(doc.getElementById('o-service').value, 'testament');
  assert.equal(doc.querySelector('#o-service-chips .chip.is-on').dataset.svc, 'testament');
  assert.ok(doc.querySelector('#o-amount').value > 0, 'the selected service has a price');

  doc.querySelector('#o-service-chips .chip[data-svc="procuration"]').click();
  await wait(20);
  assert.equal(doc.getElementById('o-service').value, 'procuration');
  assert.equal(doc.querySelector('#o-service-chips .chip.is-on').dataset.svc, 'procuration');
});

test('la carte d’acte se couche sur une feuille large, et reste debout sous le pouce', () => {
  // La feuille de réservation s'élargit avec l'écran ; debout, les quatre
  // cartes encaissaient cette largeur en vide (≈ 400 px de carte pour un mot).
  // C'est la largeur de la FEUILLE qui décide — un @container, pas un @media :
  // le dialogue est centré, sa largeur ne suit pas la fenêtre au même rythme.
  assert.match(CSS_SRC, /\.day-book \{[^}]*container-type:\s*inline-size/, 'la feuille est un conteneur de requête');
  assert.match(CSS_SRC, /@container book \(min-width: 600px\) \{/, 'le seuil est celui de la feuille');
  const block = CSS_SRC.slice(CSS_SRC.indexOf('@container book (min-width: 600px)'));
  assert.match(block, /#o-service-chips \.chip \{[^}]*flex-direction:\s*row/, 'couchée : le glyphe, le nom, puis le montant');
  // Et le pouce garde ses grandes cibles : AUCUNE règle ne redresse la carte
  // sous le seuil — c'est la règle de base (colonne) qui tient là.
  assert.match(CSS_SRC, /#o-service-chips \.chip \{[^}]*flex-direction:\s*column/, 'debout par défaut');
});
