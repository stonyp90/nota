/**
 * L'ARRIVÉE MONTRE LE CARNET (propriétaire, 2026-09-12).
 *
 * L'écran d'accueil était une carte blanche interchangeable : un logo, une
 * promesse, deux portes. Rien n'y prouvait ce que Nota vend. La refonte fait
 * de l'arrivée le produit lui-même — de vraies dates, leur prix total, et
 * l'échelle de l'avis lue de gauche à droite :
 *
 *   • la bande #ig-carnet tient UNE date par palier du domaine, dans l'ordre
 *     des dates, jamais une liste écrite à la main ;
 *   • chaque prix est la MÊME chaîne que la case du calendrier pour la même
 *     date — une seule formule, jamais un second barème pour la vitrine ;
 *   • aucun montant n'est écrit dans le HTML : la vitrine ne peut pas mentir
 *     quand l'échelle change ;
 *   • la tuile d'ancrage est la première date standard, celle que le reste du
 *     site ouvre déjà par défaut (jamais le ×4 du jour même) ;
 *   • une tuile mène à SA date : le carnet s'ouvre sur ce jour ;
 *   • si le mois est retombé sur les fixtures, la bande porte la marque
 *     « démonstration » comme toutes les régions qui montrent des chiffres.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => { try { window.close(); } catch {} }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function arrive() {
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
  WINDOWS.push(dom.window);
  const { window } = dom;
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  const seed = D.makeFixtures(todayISO());
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(80);
  return { window, doc: window.document, D };
}

const tiles = (doc) => [...doc.querySelectorAll('#ig-carnet .ig-cal-cell')];

test('le HTML de la porte n’écrit aucun montant : les prix viennent du domaine', () => {
  const doc = new JSDOM(HTML_SRC).window.document;
  const chooser = doc.querySelector('#ig-chooser');
  assert.ok(chooser, 'la porte existe');
  assert.ok(!/\d[\d  ]*\$/.test(chooser.textContent), 'aucun prix écrit à la main : ' + chooser.textContent.trim());
  const host = chooser.querySelector('#ig-carnet');
  assert.ok(host, 'la bande du carnet a son hôte dans la porte');
  assert.ok(chooser.querySelector('.ig-arrival-copy #ig-title'), 'la promesse ouvre le parcours');
  assert.ok(chooser.querySelector('.ig-arrival-market #ig-carnet'), 'les dates ont leur espace de comparaison');
  assert.ok(host.compareDocumentPosition(chooser.querySelector('#ig-enter')) & 4,
    'les dates précèdent la porte d’entrée dans l’ordre de lecture');
});

test('la bande tient une date par palier, dans l’ordre, au prix du calendrier', async () => {
  const { doc, D } = await arrive();
  assert.equal(doc.querySelector('#intro-gate').hidden, false, 'la porte s’ouvre à la première arrivée');
  const cells = tiles(doc);
  assert.equal(cells.length, D.TIERS.length, 'une tuile par palier du domaine');
  const today = todayISO();
  let previous = '';
  for (const cell of cells) {
    assert.equal(cell.tagName, 'BUTTON', 'une tuile est un vrai bouton');
    assert.equal(cell.getAttribute('type'), 'button');
    const iso = cell.dataset.date;
    assert.match(iso, /^\d{4}-\d{2}-\d{2}$/, 'la tuile porte sa date');
    assert.ok(iso >= today, 'jamais une date passée : ' + iso);
    assert.ok(iso > previous, 'les dates montent : ' + previous + ' → ' + iso);
    previous = iso;
    // Le prix de la vitrine EST celui de la case du calendrier, au caractère près.
    const grid = doc.querySelector('#cal-grid .cal-cell[data-date="' + iso + '"] .cal-urgency');
    assert.ok(grid, 'le calendrier connaît cette date : ' + iso);
    const price = cell.querySelector('.ig-cal-price');
    assert.ok(price, 'la tuile montre un prix');
    assert.equal(price.textContent.trim(), grid.textContent.trim(),
      'une seule formule de prix pour ' + iso);
  }
  const anchors = cells.filter((c) => c.dataset.anchor === 'true');
  assert.equal(anchors.length, 1, 'une seule tuile d’ancrage');
  let n = 0;
  while (D.tierForDays(n) !== 'standard' && n < 400) n++;
  assert.equal(anchors[0].dataset.date, D.addDays(today, n),
    'l’ancre est la première date standard, jamais le jour même');
});

test('une tuile ouvre le carnet sur SA date, et la porte se referme', async () => {
  const { window, doc } = await arrive();
  const cell = tiles(doc)[0];
  const iso = cell.dataset.date;
  cell.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(400);
  assert.equal(doc.querySelector('#intro-gate').hidden, true, 'la porte est refermée');
  assert.equal(window.localStorage.getItem('nota.introSeen'), '1', 'un choix explicite se retient');
  assert.equal(doc.querySelector('#pane-carnet').hidden, false, 'on atterrit dans le carnet');
  assert.equal(doc.querySelector('#day-date').value, iso, 'sur la date choisie');
});

test('un mois de démonstration se déclare aussi dans la vitrine', async () => {
  const { doc } = await arrive();
  const host = doc.querySelector('#ig-carnet');
  assert.equal(host.dataset.demo, 'true', 'le repli sur les fixtures est déclaré');
  assert.ok(host.querySelector('.demo-mark'), 'la marque « démonstration » est visible dans la bande');
});
