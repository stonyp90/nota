/**
 * Le catalogue annoncé — procuration et testament, à l'écran 1 de la feuille
 * de réservation, en gris et marqués « Bientôt ».
 *
 * Ce que ces cartes doivent tenir :
 *   1. elles ne sont PAS des services — rien ne les price, rien ne les réserve
 *      (serviceById continue de répondre null, cf. domain.test.mjs) ;
 *   2. elles se voient à la place des actes, pour que le client sache où va le
 *      catalogue plutôt que de conclure que Nota n'en fera jamais d'autres ;
 *   3. un clic dessus ne prend jamais la sélection : l'acte choisi reste celui
 *      qui se réserve, et le formulaire ne part pas avec un service vide.
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

test('le domaine tient deux listes : ce qui se vend, et ce qui est annoncé', async () => {
  const { D } = await boot();
  // Le domaine vit dans le realm jsdom : on compare des chaînes, pas des tableaux.
  assert.equal(D.ACTES_A_VENIR.map((a) => a.id).join(','), 'procuration,testament');
  // Annoncé n'est pas vendu : aucun des deux n'entre au catalogue.
  D.ACTES_A_VENIR.forEach((a) => {
    assert.equal(D.serviceById(a.id), null, a.id + ' ne se réserve pas');
    assert.ok(!D.SERVICES.some((s) => s.id === a.id), a.id + ' n’est pas un service');
    assert.ok(a.nomCourt && a.nomEn && a.description, a.id + ' se nomme et se décrit');
  });
  assert.equal(D.acteAVenirById('testament').nomCourt, 'Testament');
  assert.equal(D.acteAVenirById('refinancement'), null, 'un acte en vente n’est pas « à venir »');
});

test('l’écran 1 montre les deux actes annoncés, en gris et marqués « Bientôt »', async () => {
  const { doc } = await boot();
  await openBooking(doc);
  const soon = [...doc.querySelectorAll('#o-service-chips .chip-soon')];
  assert.deepEqual(soon.map((b) => b.dataset.soon), ['procuration', 'testament']);
  soon.forEach((b) => {
    assert.equal(b.getAttribute('aria-disabled'), 'true', 'annoncé, pas offert');
    assert.equal(b.dataset.svc, undefined, 'aucun service derrière la carte');
    assert.match(FLAT(b.textContent), /Bientôt$/, 'la mention ferme la carte');
    // Elle ferme la carte SUR LA LIGNE RÉSERVÉE, jamais sur celle du nom :
    // dans le nom, la pastille poussait « Procuration » hors de l'axe de son
    // glyphe et la rangée annoncée se lisait de travers sous une rangée centrée.
    assert.ok(b.querySelector('.chip-svc-sub .chip-soon-tag'), 'la mention tient la ligne réservée');
    assert.equal(b.querySelector('.chip-svc-main .chip-soon-tag'), null, 'le nom reste seul sur son axe');
    assert.ok(b.title, 'la description tient dans l’infobulle');
  });
  // Les deux actes qui se réservent arrivent EN PREMIER : la porte ouverte
  // passe avant l'annonce.
  const all = [...doc.querySelectorAll('#o-service-chips .chip')];
  assert.deepEqual(
    all.map((b) => b.dataset.svc || b.dataset.soon),
    ['refinancement', 'financement', 'procuration', 'testament'],
  );
});

test('cliquer un acte annoncé ne change rien : la sélection reste sur l’acte réservable', async () => {
  const { doc } = await boot();
  await openBooking(doc);
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(20);
  const before = doc.getElementById('o-service').value;
  assert.equal(before, 'financement');

  doc.querySelector('#o-service-chips .chip-soon[data-soon="testament"]').click();
  await wait(20);
  assert.equal(doc.getElementById('o-service').value, 'financement', 'le service tenu ne bouge pas');
  assert.equal(
    doc.querySelector('#o-service-chips .chip.is-on').dataset.svc, 'financement',
    'la carte allumée non plus',
  );
  assert.ok(
    !doc.querySelector('#o-service-chips .chip-soon').hasAttribute('aria-pressed'),
    'un acte annoncé ne devient jamais un bouton pressé',
  );
});
