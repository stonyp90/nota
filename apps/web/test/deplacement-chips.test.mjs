/**
 * Déplacement pour la signature — the six-band select becomes TWO ROWS OF
 * CHIPS: who travels (moi / le notaire / urgence en ligne), then the radius
 * for that direction. Everything is visible at a glance — no menu to open —
 * and the +$ rides on each chip like the other pricing chips.
 *
 * A visually-hidden native <select id="crit-deplacement"> stays the source
 * of truth (the o-service pattern): programmatic writes that dispatch
 * `change` repaint the chips, so the existing tests and the dossier page
 * keep one write path.
 *
 * Boot harness mirrors booking-defaults.test.mjs.
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
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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

async function openRefinancement(win, doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  return iso;
}

test('two chip rows render — the default band (je me déplace, 50 km) arrives pressed', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  // No visible select left for the déplacement — the native one is hidden.
  const sel = $(doc, 'crit-deplacement');
  assert.ok(sel, 'the native select survives as the source of truth');
  assert.ok(sel.classList.contains('visually-hidden'), 'but it is hidden — chips are the UI');
  assert.equal(sel.value, 'client_50', 'the +0 band is pre-selected');

  // Row 1: who travels. Row 2: the radius for that direction.
  assert.equal($(doc, 'crit-deplacement__qui_client').getAttribute('aria-pressed'), 'true');
  assert.equal($(doc, 'crit-deplacement__qui_notaire').getAttribute('aria-pressed'), 'false');
  assert.equal($(doc, 'crit-deplacement__client_50').getAttribute('aria-pressed'), 'true');
  assert.ok($(doc, 'crit-deplacement__client_25'), 'the client radii are all offered');
  assert.ok($(doc, 'crit-deplacement__client_10'));
  assert.ok(!$(doc, 'crit-deplacement__notaire_25'), 'the notary radii wait for their direction');
});

test('choosing « le notaire se déplace » swaps the radius row and lands on its cheapest band', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  $(doc, 'crit-deplacement__qui_notaire').click();
  await wait(10);
  const sel = $(doc, 'crit-deplacement');
  assert.equal(sel.value, 'notaire_25', 'the first notary band is auto-selected');
  assert.equal($(doc, 'crit-deplacement__notaire_25').getAttribute('aria-pressed'), 'true');
  assert.ok($(doc, 'crit-deplacement__notaire_50'), 'the 50 km band is offered');
  assert.ok(!$(doc, 'crit-deplacement__client_50'), 'the client radii are gone');

  $(doc, 'crit-deplacement__notaire_50').click();
  await wait(10);
  assert.equal(sel.value, 'notaire_50');
});

test('urgence en ligne needs no radius — the second row disappears', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  $(doc, 'crit-deplacement__qui_en_ligne').click();
  await wait(10);
  assert.equal($(doc, 'crit-deplacement').value, 'urgence_en_ligne');
  assert.ok(!$(doc, 'crit-deplacement__client_50'), 'no radius row for an online signing');
  assert.ok(!$(doc, 'crit-deplacement__notaire_25'));
});

test('a programmatic write through the native select repaints the chips (nota-select contract)', async () => {
  const { win, doc } = await boot();
  await openRefinancement(win, doc);

  const sel = $(doc, 'crit-deplacement');
  sel.value = 'notaire_50';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(10);
  assert.equal($(doc, 'crit-deplacement__qui_notaire').getAttribute('aria-pressed'), 'true');
  assert.equal($(doc, 'crit-deplacement__notaire_50').getAttribute('aria-pressed'), 'true');
});

test('the price follows the band — notaire 50 km lifts the floor by 250 $', async () => {
  const { win, doc, D } = await boot();
  await openRefinancement(win, doc);
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  // Answer the three variable questions so the floor is comparable.
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '250000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const selPreteur = $(doc, 'crit-preteur'); selPreteur.value = 'banque_nationale'; fire(selPreteur, 'change');
  await wait(10);
  const floorBefore = Number($(doc, 'o-amount').min);

  $(doc, 'crit-deplacement__qui_notaire').click();
  await wait(10);
  $(doc, 'crit-deplacement__notaire_50').click();
  await wait(10);
  assert.equal(Number($(doc, 'o-amount').min), floorBefore + 250, 'the +250 band moves the floor');
});
