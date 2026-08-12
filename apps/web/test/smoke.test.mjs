/**
 * Headless DOM smoke tests for the Nota web app (apps/web/public).
 *
 * The browser loads two <script> tags: domain.js (the UMD @nota/domain, which
 * exposes window.NotaDomain) then app.js (the IIFE that boots and exposes
 * window.Nota). jsdom does NOT fetch external scripts, so we build the DOM with
 * runScripts:'outside-only', then eval the two source files from disk IN ORDER
 * (domain first) inside the window scope, reproducing the real boot.
 *
 * Determinism: the offline fallback seeds the carnet from D.makeFixtures(today),
 * whose bids land 1..27 days ahead — so on the last day of a month the current
 * month can hold zero bids. To keep this smoke suite stable on ANY calendar day,
 * we pre-seed localStorage with makeFixtures(firstOfCurrentMonth): every fixture
 * date (2nd..28th) then falls inside the anchor month. This still exercises the
 * real offline path (fetch rejects -> ensureSeed reads localStorage) while making
 * monthBids a fixed, fully computable set. All expected values are derived from
 * the same window.NotaDomain instance — nothing about the app is hardcoded here.
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

// Same formulas the app uses, so "today"/"anchor" match without pinning the clock.
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const monthKey = (iso) => iso.slice(0, 7);
function daysInMonthUTC(anchor) {
  const p = anchor.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); // day 0 of next month = last day of this one
}

function fire(win, elmt, type) {
  elmt.dispatchEvent(new win.Event(type, { bubbles: true }));
}

/**
 * Build a fresh window, eval domain + app in order, and wait for the async boot.
 * Fresh per test so interactive mutations (offer form, theme, day modal) never
 * bleed between assertions.
 */
async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom has no Web Speech API.
      window.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {}, onvoiceschanged: null };
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      // Force the deterministic offline/localStorage path on boot.
      window.fetch = () => Promise.reject(new Error('offline'));
      // jsdom doesn't implement scrolling; setTab calls it on its default path.
      window.scrollTo = () => {};
      // jsdom ships HTMLDialogElement but not showModal/close.
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });

  const win = dom.window;

  // 1) domain -> window.NotaDomain
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;

  // 2) deterministic seed anchored to the first of the current month
  const today = todayISO();
  const anchor = firstOfMonth(today);
  const month = monthKey(anchor);
  const seed = D.makeFixtures(anchor);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));

  // 3) app -> boots immediately (readyState is 'complete'), exposes window.Nota
  win.eval(APP_SRC);
  await wait(50); // boot awaits store.listMonth

  const expectedMonth = seed.filter((b) => monthKey(b.dateISO) === month);
  return { dom, win, doc: win.document, D, Nota: win.Nota, today, anchor, month, seed, expectedMonth };
}

const $ = (doc, id) => doc.getElementById(id);
const all = (doc, sel) => Array.from(doc.querySelectorAll(sel));

// 1. Boot exposes the two documented globals with their expected shape.
test('boot exposes window.NotaDomain and window.Nota with expected keys', async () => {
  const { win, D, Nota } = await boot();
  assert.equal(typeof win.NotaDomain, 'object');
  for (const k of ['money', 'SERVICES', 'TIERS', 'STATUS', 'validateOffer', 'makeFixtures']) {
    assert.ok(k in D, `NotaDomain missing ${k}`);
  }
  assert.equal(typeof Nota, 'object');
  for (const k of ['state', 'store', 'domain', 'setTab', 'selectDate', 'reload', 'dossierState', '_internals']) {
    assert.ok(k in Nota, `Nota missing ${k}`);
  }
});

// 2. Offline fallback + seeded fixtures.
test('store is offline and monthBids is seeded deterministically', async () => {
  const { Nota, expectedMonth } = await boot();
  assert.equal(Nota.store.online, false);
  assert.ok(Nota.state.monthBids.length > 0, 'monthBids should be populated offline');
  assert.equal(Nota.state.monthBids.length, expectedMonth.length);
});

// 3. Calendar grid: one day cell per day-of-month + 7 weekday headers.
test('calendar renders day cells for the anchor month and 7 weekday headers', async () => {
  const { doc, anchor } = await boot();
  const dayCells = all(doc, '#cal-grid .cal-cell:not(.is-out)');
  assert.equal(dayCells.length, daysInMonthUTC(anchor));
  assert.equal(all(doc, '#cal-grid .cal-dow').length, 7);
});

// 4. Legend shows one item per tier (5).
test('legend renders one item per timing tier', async () => {
  const { doc, D } = await boot();
  assert.equal(all(doc, '#legend .legend-item').length, D.TIERS.length);
  assert.equal(D.TIERS.length, 5);
});

// 5. No open/taken day ever renders a bare em-dash headline.
test('no calendar headline is a bare em-dash', async () => {
  const { doc } = await boot();
  const tops = all(doc, '#cal-grid .cal-top');
  assert.ok(tops.length > 0, 'expected at least one headline figure');
  assert.ok(tops.every((t) => t.textContent.trim() !== '—'), 'a cal-top rendered a bare em-dash');
});

// 6. Days with bids carry the has-bids class and a count badge.
test('days with bids get has-bids and a count badge', async () => {
  const { doc } = await boot();
  const hasBids = all(doc, '#cal-grid .cal-cell.has-bids');
  assert.ok(hasBids.length > 0, 'expected at least one day with bids');
  assert.ok(hasBids.every((c) => c.querySelector('.cal-count')), 'a has-bids cell is missing its count badge');
});

// 7. Offer form: 3 service options, anonymity on by default, service selection
//    enables the slider and caps it at prixDepart * PREMIUM_CAP.
test('offer form: services populated, anon default on, slider capped at prixDepart*10', async () => {
  const { win, doc, D, Nota } = await boot();
  assert.equal($(doc, 'o-service').options.length, D.SERVICES.length);
  assert.equal(D.SERVICES.length, 3);

  assert.equal($(doc, 'o-anon').checked, true);
  assert.equal(Nota.state.offer.anonyme, true);

  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  const amt = $(doc, 'o-amount');
  assert.equal(amt.disabled, false);
  const refi = D.serviceById('refinancement');
  assert.equal(amt.max, String(refi.prixDepart * D.PREMIUM_CAP)); // 950 * 10 = 9500
  assert.equal(amt.max, '9500');
});

// 8. A valid service+date+amount combination enables the submit button.
test('a valid offer combination enables #offer-submit', async () => {
  const { win, doc, D } = await boot();
  const submit = $(doc, 'offer-submit');
  assert.equal(submit.disabled, true); // nothing chosen yet

  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  const date = $(doc, 'o-date');
  date.value = D.addDays(todayISO(), 5); // near future, within range, not passed
  fire(win, date, 'change');
  fire(win, date, 'input');

  const amt = $(doc, 'o-amount');
  amt.value = '2000'; // between 950 and 9500
  fire(win, amt, 'input');

  assert.equal(submit.disabled, false);
});

// 9. Dossier tab lists documents+fields of the first service and shows 0/N.
test('dossier tab lists first service intake items and badge shows 0/N', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const svc = D.SERVICES[0];
  const expected = svc.documents.length + svc.champs.length;
  // The intake items, excluding the appended consent row.
  assert.equal(all(doc, '#dossier-list .dossier-item:not(.dossier-consent)').length, expected);
  assert.equal(expected, 6); // testament: 2 docs + 4 champs
  assert.equal(all(doc, '#dossier-list .dossier-consent').length, 1); // consent row present
  assert.equal($(doc, 'dossier-badge').textContent, '0/' + expected);
});

// 10. Clicking a has-bids cell opens the day modal populated with bid rows.
test('clicking a has-bids cell opens the day modal with bid rows', async () => {
  const { doc } = await boot();
  const cell = doc.querySelector('#cal-grid .cal-cell.has-bids');
  assert.ok(cell, 'expected a has-bids cell to click');
  cell.click();

  assert.equal($(doc, 'day-dialog').open, true);
  assert.ok(all(doc, '#day-bids .bid-row').length >= 1, 'day modal has no bid rows');
  assert.ok($(doc, 'day-title').textContent.trim().length > 0, 'day-title is empty');
});

// 11. Theme toggle flips document[data-theme] between dark and light.
test('theme toggle flips documentElement[data-theme]', async () => {
  const { doc } = await boot();
  const root = doc.documentElement;
  assert.equal(root.getAttribute('data-theme'), ''); // markup default

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'dark');

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'light');
});

// 12b. Optional courriel field exists and never blocks a valid offer, and the
//      offline store never keeps it on the public bid (privacy by omission).
test('courriel field is optional and stays private in the local store', async () => {
  const { win, doc, D, Nota } = await boot();

  // The field is present in the offer form and not required.
  const courriel = $(doc, 'o-courriel');
  assert.ok(courriel, 'offer form is missing #o-courriel');
  assert.equal(courriel.required, false);

  // A valid offer WITHOUT a courriel still enables submit.
  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');
  const date = $(doc, 'o-date');
  date.value = D.addDays(todayISO(), 5);
  fire(win, date, 'change');
  fire(win, date, 'input');
  $(doc, 'o-amount').value = '2000';
  fire(win, $(doc, 'o-amount'), 'input');
  assert.equal($(doc, 'offer-submit').disabled, false);

  // Creating a bid with a courriel offline must not surface it on the bid.
  const res = await Nota.store.createBid({
    serviceId: 'refinancement', dateISO: D.addDays(todayISO(), 5), montant: 2000,
    anonyme: true, courriel: 'client@example.ca',
  });
  assert.equal(res.ok, true);
  assert.equal(res.bid.courriel, undefined);
});

// 13. Notary console: the auth gate renders, the authed view is gated until
//     sign-in, and Nota.notary exposes its hooks. feedUrl builds a webcal link.
test('notary console renders its auth gate and exposes Nota.notary hooks', async () => {
  const { doc, Nota } = await boot();
  assert.ok($(doc, 'notary-console'), 'notary console missing');
  assert.ok($(doc, 'nc-email'), 'notary email field missing');
  assert.equal($(doc, 'notary-authed').hidden, true); // gated until sign-in
  assert.equal($(doc, 'notary-auth-form').hidden, false);
  assert.equal(typeof Nota.notary, 'object');
  for (const k of ['signIn', 'signOut', 'loadBids', 'accept', 'decline', 'feedUrl', 'state']) {
    assert.ok(k in Nota.notary, `Nota.notary missing ${k}`);
  }
  // feedUrl swaps the http(s) scheme for webcal:// and carries the token.
  assert.match(Nota.notary.feedUrl('abc.def'), /^webcal:\/\/.*\/notary\/feed\.ics\?token=abc\.def$/);
});

// 14. The footer privacy link opens the dedicated Law 25 confidentialité pane.
test('privacy link opens the Law 25 confidentialité pane', async () => {
  const { doc } = await boot();
  const pane = $(doc, 'pane-confidentialite');
  assert.ok(pane, 'confidentialité pane missing');
  assert.equal(pane.hidden, true);
  $(doc, 'privacy-link').click();
  assert.equal(pane.hidden, false);
  assert.equal(pane.classList.contains('is-active'), true);
});

// 15. Submitting an offer attaches the saved dossier snapshot + courriel to the
//     store payload (so an accepting notary sees real data).
test('submitting an offer attaches the saved dossier snapshot and courriel', async () => {
  const { win, doc, D, Nota } = await boot();
  const snap = { valeurPropriete: '250000', __consent: '1' };
  win.localStorage.setItem('nota.dossier.v1', JSON.stringify({ refinancement: snap }));

  // Nota.store is the same object the app submits through — spy on createBid.
  let captured = null;
  const orig = Nota.store.createBid;
  Nota.store.createBid = async function (payload) {
    captured = payload;
    return { ok: true, bid: { id: 'x', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } };
  };

  const sel = $(doc, 'o-service'); sel.value = 'refinancement'; fire(win, sel, 'change');
  const date = $(doc, 'o-date'); date.value = D.addDays(todayISO(), 5); fire(win, date, 'change'); fire(win, date, 'input');
  $(doc, 'o-amount').value = '2000'; fire(win, $(doc, 'o-amount'), 'input');
  $(doc, 'o-courriel').value = 'client@example.ca'; fire(win, $(doc, 'o-courriel'), 'input');
  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(10);

  Nota.store.createBid = orig;
  assert.ok(captured, 'createBid was not called');
  // Compare by value (the snapshot is parsed in the jsdom realm, so a strict
  // deep-equal would trip on cross-realm prototypes).
  assert.equal(JSON.stringify(captured.dossier), JSON.stringify(snap));
  assert.equal(captured.courriel, 'client@example.ca');
});

// 12. Money passthrough: amounts route through D.money — trailing " $" and
//     space-grouped thousands appear in the rendered figures.
test('rendered amounts use the money() format ("N NNN $")', async () => {
  const { doc } = await boot();
  const texts = all(doc, '#cal-grid .cal-top, #agenda .bid-amount').map((e) => e.textContent);
  assert.ok(texts.length > 0, 'no money figures rendered');
  assert.ok(texts.some((t) => / \$$/.test(t.trim())), 'no amount ends with " $"');
  assert.ok(texts.some((t) => /\d \d{3} \$/.test(t)), 'no space-grouped thousands amount found');
});
