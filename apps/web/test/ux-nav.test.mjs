/**
 * Navigation-depth (three-click) guarantees for the web app.
 *
 * Every pane must be reachable in at most three clicks from anywhere, at any
 * time — not only during a one-shot flow:
 *   1. The dossier has a permanent door: a client's account menu carries a
 *      "Mon dossier" row (before this, the only entry was the post-publish
 *      success card — navigate away once and the pane was unreachable).
 *   2. An anonymous visitor who has published offers (no email is required to
 *      publish) keeps the account bell: their offers, dossier and
 *      notifications stay reachable without signing in.
 *   3. The active pane lives in the URL hash (`t`), so panes are deep-linkable
 *      and the browser Back button navigates panes instead of leaving the site.
 *   4. While a <dialog> is open the page behind must not scroll: the lock has
 *      to cover the <html> scroller (body alone does nothing — the root
 *      element keeps scrolling and the page loses its place).
 *
 * Boot harness mirrors smoke.test.mjs: eval domain then app inside jsdom.
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

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);

async function boot({ hash = '', seed = {} } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
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
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, Nota: win.Nota };
}

const acctLabels = (doc) =>
  Array.from(doc.querySelectorAll('#acct-actions .acct-action .acct-item-title')).map((n) => n.textContent);

const activePane = (doc) => {
  const on = Array.from(doc.querySelectorAll('.tab-pane')).filter((p) => !p.hidden);
  assert.equal(on.length, 1, 'exactly one visible pane');
  return on[0].id;
};

// ---------------------------------------------------------------------------
// 1. The dossier has a permanent door
// ---------------------------------------------------------------------------

test('client account menu carries a permanent "Mon dossier" row that opens the dossier pane', async () => {
  const offer = { id: 'o1', dateISO: todayISO(), serviceId: 'procuration', montant: 900 };
  const { doc, Nota } = await boot({
    seed: {
      'nota.profile.v1': JSON.stringify({ courriel: 'client@example.ca' }),
      'nota.myoffers.v1': JSON.stringify([offer]),
    },
  });
  Nota.account.render();
  const labels = acctLabels(doc);
  assert.ok(labels.includes('Mon dossier'), 'a permanent route to the dossier: ' + labels.join(' | '));
  assert.ok(labels.includes('Mon profil'), 'the profile row survives');
  assert.equal(labels.filter((t) => t === 'Mes offres').length, 0,
    'no duplicate row: offers are the first card of "Mon profil"');

  const row = Array.from(doc.querySelectorAll('#acct-actions .acct-action'))
    .find((b) => b.textContent.includes('Mon dossier'));
  row.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-dossier');
  // The dossier opens on the service of the client's live offer, not a default.
  assert.equal($(doc, 'd-service').value, 'procuration');
});

// ---------------------------------------------------------------------------
// 2. Anonymous publishers keep their account door
// ---------------------------------------------------------------------------

test('anonymous visitor with published offers keeps the account bell and reaches "Mes offres"', async () => {
  const offer = { id: 'o2', dateISO: todayISO(), serviceId: 'testament', montant: 1400 };
  const { doc, Nota } = await boot({ seed: { 'nota.myoffers.v1': JSON.stringify([offer]) } });
  Nota.account.render();
  assert.equal(Nota.account.role(), 'anon');
  assert.equal(doc.querySelector('.acct-wrap').hidden, false,
    'the bell stays: notifications and offers derive from this device');
  const labels = acctLabels(doc);
  assert.ok(labels.includes('Mes offres'), 'a route to the offers: ' + labels.join(' | '));
  assert.ok(labels.includes('Mon dossier'), 'a route to the dossier');

  const row = Array.from(doc.querySelectorAll('#acct-actions .acct-action'))
    .find((b) => b.textContent.includes('Mes offres'));
  row.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-profil');
});

test('anonymous visitor with no offers still gets no account bell', async () => {
  const { doc, Nota } = await boot();
  Nota.account.render();
  assert.equal(doc.querySelector('.acct-wrap').hidden, true);
});

// ---------------------------------------------------------------------------
// 3. Panes live in the URL: deep links + Back button
// ---------------------------------------------------------------------------

test('a #t=<pane> deep link boots straight into that pane', async () => {
  const { doc, Nota } = await boot({ hash: '#t=notaires' });
  assert.equal(Nota.state.tab, 'notaires');
  assert.equal(activePane(doc), 'pane-notaires');
});

test('an unknown pane in the hash falls back to the carnet', async () => {
  const { doc } = await boot({ hash: '#t=nope' });
  assert.equal(activePane(doc), 'pane-carnet');
});

test('setTab records the pane in the hash and the Back button returns to the previous pane', async () => {
  const { win, doc, Nota } = await boot();
  assert.equal(activePane(doc), 'pane-carnet');

  Nota.setTab('conditions');
  assert.match(win.location.hash, /(^|[#&])t=conditions(&|$)/);

  Nota.setTab('charte');
  assert.match(win.location.hash, /t=charte/);

  win.history.back();
  await wait(30);
  assert.equal(activePane(doc), 'pane-conditions', 'Back walks panes instead of leaving the site');

  win.history.back();
  await wait(30);
  assert.equal(activePane(doc), 'pane-carnet', 'Back reaches the landing pane');
});

test('the carnet keeps a clean URL: no t= param on the default pane', async () => {
  const { win, Nota } = await boot();
  Nota.setTab('notaires');
  Nota.setTab('carnet');
  assert.doesNotMatch(win.location.hash, /(^#|&)t=/);
});

// ---------------------------------------------------------------------------
// 4. Modal scroll lock covers the real scroller
// ---------------------------------------------------------------------------

test('the dialog scroll lock targets the <html> scroller, not only <body>', () => {
  assert.match(CSS_SRC, /html:has\(dialog\[open\]\)[^{}]*\{[^}]*overflow:\s*hidden/,
    'body:has(dialog[open]) alone lets the root element scroll behind an open modal');
});

// ---------------------------------------------------------------------------
// New menu copy stays bilingual
// ---------------------------------------------------------------------------

test('"Mon dossier" carries an English entry', () => {
  I18N.force('en');
  assert.equal(I18N.t('Mon dossier'), 'My file');
  I18N.force('fr');
});
