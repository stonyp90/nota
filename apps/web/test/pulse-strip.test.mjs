/**
 * The hero's market strip — « CE QUE LES CLIENTS OFFRENT » — told the truth
 * about a month that has offers, and invented one about a month that has none.
 *
 * Live on 2026-09-12 the carnet held zero offers, so every row read « aucune
 * offre ce mois » while still painting a coloured gauge (the fill's 4px
 * min-width made a 0 % share look like a sliver of market) and a « repère du
 * mois — », a column heading over nothing. Two shapes that promise data, for a
 * month with none.
 *
 * The rule these tests hold, per month and not per row, so the four rows stay
 * column-aligned whatever the month holds:
 *   • the gauge is drawn only when the month has at least one offer;
 *   • the « repère du mois » column exists only when the month can produce at
 *     least one reference (PULSE_REPERE_MIN offers on some act).
 *
 * They also hold the booking action's label, which is composed — « Réserver une
 * procuration », never « un », and the act's name in the reader's own language.
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

/**
 * Boot the app offline on a seeded carnet. `bids` null → the demo fixtures
 * (a month with a market); `[]` → the month production actually served on
 * 2026-09-12, with nothing in it at all.
 */
async function boot({ bids = null } = {}) {
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
  window.localStorage.setItem('nota.onboarded.v1', '1');
  window.eval(DOMAIN_SRC);
  const D = window.NotaDomain;
  // An empty ARRAY is a seed like any other: ensureSeed only rebuilds the
  // fixtures when the key is missing or the pricing signature moved.
  window.localStorage.setItem('nota.bids.v1', JSON.stringify(bids === null ? D.makeFixtures(todayISO()) : bids));
  window.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  window.eval(APP_SRC);
  await wait(80);
  return { window, doc: window.document, D };
}

const rows = (doc) => [...doc.querySelectorAll('#pulse-rows .pulse-item')];

test('a month with no offer paints no gauge and no reference column', async () => {
  const { doc } = await boot({ bids: [] });
  const items = rows(doc);
  assert.ok(items.length >= 2, 'the strip still names every act: ' + items.length);

  for (const item of items) {
    const name = item.querySelector('.pulse-svc').textContent.trim();
    assert.equal(
      item.querySelectorAll('.pulse-bar').length, 0,
      `${name}: a month with no offer must not paint a share-of-demand gauge`,
    );
    assert.equal(
      item.querySelectorAll('.pulse-fig').length, 1,
      `${name}: only « à partir de » survives — a reference column over nothing is a promise of data`,
    );
    assert.ok(
      !/—/.test(item.textContent),
      `${name}: no em dash standing in for a figure that does not exist`,
    );
    assert.match(
      item.querySelector('.pulse-row').getAttribute('aria-label'),
      /aucune offre ce mois/,
      `${name}: the row still SAYS the month is empty`,
    );
  }
});

test('a month with a market keeps its gauge and its reference column', async () => {
  const { doc } = await boot();
  const items = rows(doc);
  assert.ok(items.length >= 2, 'the strip names every act');

  const figCounts = new Set(items.map((i) => i.querySelectorAll('.pulse-fig').length));
  assert.equal(figCounts.size, 1, 'every row carries the same figure columns, so the amounts stay aligned');
  assert.equal([...figCounts][0], 2, '« à partir de » and « repère du mois », side by side');

  for (const item of items) {
    const name = item.querySelector('.pulse-svc').textContent.trim();
    assert.equal(item.querySelectorAll('.pulse-bar').length, 1, `${name}: the month has offers, so the gauge is drawn`);
    const fill = item.querySelector('.pulse-bar > span');
    assert.ok(fill, `${name}: the gauge carries its fill`);
    assert.match(fill.style.width, /^\d+%$/, `${name}: the fill's share is a percentage`);
  }
});

test('the booking action names the act with the right article, in the reader’s language', async () => {
  const { doc, D } = await boot();

  for (const svc of D.SERVICES) {
    assert.match(
      String(svc.article || ''), /^(un|une)$/,
      `${svc.id}: the catalogue must carry the act's own indefinite article — it cannot be guessed from the name`,
    );
  }

  const labels = rows(doc).map((i) => i.querySelector('.mini-btn').getAttribute('aria-label'));
  assert.ok(labels.includes('Réserver un refinancement'), 'masculine act: ' + labels.join(' | '));
  assert.ok(labels.includes('Réserver une procuration'), 'feminine act — « un procuration » is not French: ' + labels.join(' | '));

  // Composed with T(), like every other sentence that names an act, so the
  // English reader never gets « Book a refinancement ».
  assert.match(
    APP_SRC,
    /miniBtn\('agenda', 'Réserver ' \+ [^\n]*T\(short\)\.toLowerCase\(\)/,
    'the label must translate the act name, not paste the French one into an English sentence',
  );
});
