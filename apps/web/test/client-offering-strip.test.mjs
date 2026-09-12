/**
 * Focused regressions for the client-offering strip and date entry points.
 *
 * These are intentionally web-only tests.  The screenshots describe the
 * desired interaction, but are not executable instructions: the assertions
 * below protect the contracts that can be checked without a real browser
 * layout engine, plus the actual click paths in jsdom.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => { try { window.close(); } catch {} }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function boot({ width = 1024 } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.innerWidth = width;
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
  window.localStorage.setItem('nota.introSeen', '1');
  window.localStorage.setItem('nota.onboarded.v1', '1');
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  const seed = D.makeFixtures(todayISO());
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(60);
  return { window, doc: window.document, D, Nota: window.Nota };
}

function futureOfferCell(doc) {
  return [...doc.querySelectorAll('#cal-grid .cal-cell.has-bids')]
    .find((cell) => cell.dataset.date >= todayISO());
}

test('client-offering strip keeps price facts whole and gives narrow layouts a safe fallback', () => {
  assert.match(CSS_SRC, /\.pulse-figs\s*\{[^}]*white-space:\s*nowrap/,
    'the two offering figures cannot wrap into ambiguous price fragments');
  assert.match(CSS_SRC, /\.pulse-meta\s*\{[^}]*white-space:\s*nowrap/,
    'the offer count remains one readable status line');
  assert.match(CSS_SRC, /\.pulse-item\s*\{[^}]*min-width:\s*0/,
    'the strip may shrink around its grid without pushing the page wide');
  assert.match(CSS_SRC, /\.pulse-item \.pulse-row\s*\{[^}]*min-width:\s*0/,
    'the filter control has an explicit shrink contract');
  assert.match(CSS_SRC, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.pulse-rows\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'phone widths use one calm offering column instead of squeezing two cards');
  assert.match(CSS_SRC, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.pulse-svc\s*\{[^}]*white-space:\s*nowrap/,
    'service names do not split into a second line on the narrowest strip');
  assert.match(CSS_SRC, /\.pulse-row:hover \.pulse-svc, \.pulse-row\.is-on \.pulse-svc\s*\{[^}]*text-decoration:\s*underline/,
    'hover and selection underline the service without adding a card surface');
  assert.match(CSS_SRC, /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--ring\)/,
    'keyboard focus provides the mobile/touch equivalent when hover does not exist');
});

test('clicking a date opens its day model, while expanding a cell stays in the calendar', async () => {
  const { doc } = await boot();
  const cell = futureOfferCell(doc);
  assert.ok(cell, 'a future offering date exists');
  const date = cell.dataset.date;

  cell.querySelector('.cell-chevron')?.click();
  assert.equal($(doc, 'day-dialog').open, false,
    'the in-cell detail toggle is not mistaken for opening the offer flow');
  assert.ok(cell.classList.contains('is-expanded'), 'the date model expands in place');

  cell.click();
  await wait(20);
  assert.equal($(doc, 'day-dialog').open, true, 'pressing the date opens the day model');
  assert.equal($(doc, 'o-date').value, date, 'the model is scoped to the pressed date');
});

test('the offering row filters only; its separate reserve action opens the offer form for that model', async () => {
  const { doc, Nota } = await boot();
  const item = doc.querySelector('#pulse-rows .pulse-item');
  const row = item?.querySelector('.pulse-row');
  const reserve = item?.querySelector('.mini-reserver');
  assert.ok(row && reserve, 'the offering strip exposes separate filter and reserve controls');
  const serviceId = row.dataset.svc;

  row.click();
  await wait(20);
  assert.equal(Nota.state.filters.service, serviceId, 'selecting the model filters the carnet');
  assert.equal($(doc, 'day-dialog').open, false, 'filtering does not unexpectedly open a form');

  reserve.click();
  await wait(20);
  assert.equal($(doc, 'day-dialog').open, true, 'the explicit reserve action opens the offer form');
  assert.equal($(doc, 'o-service').value, serviceId, 'the form carries the selected model');
  assert.ok($(doc, 'offer-form'), 'the offer form is present in the opened day flow');
});

test('a mobile date separates preparing an offer from exploring published offers', async () => {
  const { doc } = await boot({ width: 390 });
  const cell = futureOfferCell(doc);
  cell.click();
  await wait(20);
  const preview = $(doc, 'day-preview');
  const market = $(doc, 'day-preview-offers');
  const prepare = preview.querySelector(':scope > button');
  assert.equal($(doc, 'day-dialog').dataset.interaction, 'preview');
  assert.equal($(doc, 'offer-form').hidden, true);
  assert.equal(prepare.textContent, 'Préparer mon offre');
  assert.equal(market.open, false, 'other clients’ amounts do not masquerade as a quote');
  assert.equal(doc.activeElement, prepare, 'the primary action receives focus; active: ' + doc.activeElement.id);
  assert.equal($(doc, 'day-date-edit').open, false, 'the date is stated once until the client changes it');

  market.open = true;
  assert.ok(market.querySelector('.bid-row'), 'published offers remain available on demand');
  prepare.click();
  assert.equal($(doc, 'offer-form').hidden, false);
  assert.equal(preview.hidden, true);
  assert.ok($(doc, 'day-bids').closest('#offer-form .day-market'), 'market context returns to the real form');
  assert.ok(doc.activeElement.closest('#o-service-chips'), 'focus continues to the service choice');
  assert.equal($(doc, 'o-date').value, cell.dataset.date);
});

test('changing the mobile signing date preserves preview or form mode and restores focus', async () => {
  const { window, doc, D } = await boot({ width: 320 });
  futureOfferCell(doc).click();
  await wait(20);
  const edit = $(doc, 'day-date-edit'), pick = $(doc, 'day-date');
  edit.open = true;
  pick.value = D.addDays(todayISO(), 10);
  pick.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  assert.equal($(doc, 'day-dialog').dataset.interaction, 'preview');
  assert.equal($(doc, 'o-date').value, pick.value);
  assert.equal(edit.open, false);
  assert.equal(doc.activeElement, doc.querySelector('#day-preview > button'));

  doc.querySelector('#day-preview > button').click();
  edit.open = true;
  pick.value = D.addDays(todayISO(), 11);
  pick.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  assert.equal($(doc, 'day-dialog').dataset.interaction, 'offer', 'editing a date does not send the form back to the preview');
  assert.equal($(doc, 'offer-form').hidden, false);
  assert.equal($(doc, 'o-date').value, pick.value);
  assert.ok(doc.activeElement.closest('#o-service-chips'));
});
