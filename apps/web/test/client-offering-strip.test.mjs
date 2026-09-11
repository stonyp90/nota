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
  WINDOWS.push(dom.window);
  const { window } = dom;
  window.localStorage.setItem('nota.introSeen', '1');
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
  assert.match(CSS_SRC, /\.pulse-item:hover \.pulse-row[^}]*background:\s*var\(--surface-hover-veil\)/,
    'hover feedback belongs to the whole row and remains a visible affordance');
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
