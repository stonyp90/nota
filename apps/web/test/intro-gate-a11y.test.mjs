/**
 * Intro-gate accessibility and timing (audit 2026-09-02, P0-9 / P1-10 /
 * P1-11 / P1-12 / P2-20). The static look-and-layout law lives in
 * intro-gate-ui.test.mjs; what THIS suite pins is the gate's behaviour as a
 * modal:
 *
 *   • P0-9  — under prefers-reduced-motion the gate NEVER opens, ?intro=1
 *     included: the CSS hides .ig under RM, so forcing it produced an
 *     invisible, scroll-locked overlay.
 *   • P1-10 — the gate is a real dialog: role=dialog, aria-modal, labelled
 *     by its title; focus lands on the first door, then on « Passer → » once
 *     a film runs; everything behind it is inert while it is open, and not
 *     once it closes.
 *   • P1-11 — the gate shows BEFORE the carnet fetch resolves: a slow or
 *     hanging API must not delay the first paint's pitch.
 *   • P1-12 — watching a film to its end twice counts as having seen it;
 *     once does not (the gate greets a second time, then stops).
 *   • P2-20 — the twenty drifting dice are not built at all under RM: the
 *     CSS already froze them, the DOM cost was still paid.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);

async function boot({ url = 'https://nota.example/', reducedMotion = false, seed = {}, fetch } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = fetch || (() => Promise.reject(new Error('offline')));
      window.scrollTo = () => {};
      window.matchMedia = (q) => ({
        matches: reducedMotion && /prefers-reduced-motion:\s*reduce/.test(q),
        media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota };
}

const BEHIND = ['.site-header', '#main', '.site-footer', '#chat-wrap'];

test('P1-10: the gate is a labelled modal dialog', () => {
  const doc = new JSDOM(HTML_SRC).window.document;
  const gate = $(doc, 'intro-gate');
  assert.equal(gate.getAttribute('role'), 'dialog');
  assert.equal(gate.getAttribute('aria-modal'), 'true');
  const by = gate.getAttribute('aria-labelledby');
  assert.ok(by && $(doc, by) && $(doc, by).closest('#intro-gate'), 'labelled by its own title');
});

test('P1-10: open, the gate takes focus and inerts everything behind it; closed, it gives both back', async () => {
  const { doc, win } = await boot();
  const gate = $(doc, 'intro-gate');
  assert.equal(gate.hidden, false, 'a fresh arrival meets the gate');
  assert.equal(doc.activeElement, $(doc, 'ig-door-client'), 'focus lands on the first door');
  for (const sel of BEHIND) {
    assert.ok(doc.querySelector(sel).hasAttribute('inert'), sel + ' is inert behind the gate');
  }
  $(doc, 'ig-door-notaire').click();
  assert.equal(doc.activeElement, $(doc, 'ig-skip'), 'a running film hands focus to « Passer → »');
  $(doc, 'ig-skip').click();
  await wait(400);
  assert.equal(gate.hidden, true);
  for (const sel of BEHIND) {
    assert.ok(!doc.querySelector(sel).hasAttribute('inert'), sel + ' is live again once the gate closes');
  }
  assert.equal(win.localStorage.getItem('nota.introSeen'), '1');
});

test('P0-9: under prefers-reduced-motion the gate never opens — ?intro=1 included', async () => {
  const forced = await boot({ url: 'https://nota.example/?intro=1', reducedMotion: true });
  assert.equal($(forced.doc, 'intro-gate').hidden, true, 'the CSS hides .ig under RM; opening it would lock the scroll behind nothing');
  assert.ok(!forced.doc.body.classList.contains('ig-open'), 'no scroll lock');
  assert.ok(!forced.doc.querySelector('#main').hasAttribute('inert'), 'nothing is inert');
  const plain = await boot({ reducedMotion: true });
  assert.equal($(plain.doc, 'intro-gate').hidden, true);
  // Without RM, ?intro=1 still forces the gate back for review.
  const review = await boot({ url: 'https://nota.example/?intro=1', seed: { 'nota.introSeen': '1' } });
  assert.equal($(review.doc, 'intro-gate').hidden, false);
});

test('P1-11: the gate shows before the carnet fetch resolves', async () => {
  // A hanging API: boot awaits refreshMonthData → store.listMonth → fetch.
  const { doc } = await boot({ fetch: () => new Promise(() => {}) });
  assert.equal($(doc, 'intro-gate').hidden, false, 'the pitch does not wait for the market');
  assert.ok(doc.body.classList.contains('ig-open'));
});

test('P1-12: a film watched to its end twice counts as seen; once does not', async () => {
  const once = await boot();
  $(once.doc, 'ig-door-client').click();
  once.Nota.intro.dismiss('carnet', false); // what the end-of-film timer calls
  assert.equal(once.win.localStorage.getItem('nota.introSeen'), null, 'one full viewing: the gate returns next visit');
  assert.equal(once.win.localStorage.getItem('nota.introPlays'), '1', 'but the viewing is counted');

  const twice = await boot({ seed: { 'nota.introPlays': '1' } });
  assert.equal($(twice.doc, 'intro-gate').hidden, false, 'the second visit is greeted again');
  $(twice.doc, 'ig-door-client').click();
  twice.Nota.intro.dismiss('carnet', false);
  assert.equal(twice.win.localStorage.getItem('nota.introSeen'), '1', 'two full viewings: the gate stops greeting');

  const third = await boot({ seed: { 'nota.introPlays': '2', 'nota.introSeen': '1' } });
  assert.equal($(third.doc, 'intro-gate').hidden, true);
});

test('P2-20: the drifting dice are not built under prefers-reduced-motion', async () => {
  const rm = await boot({ reducedMotion: true });
  assert.equal($(rm.doc, 'site-bg'), null, 'no site backdrop under RM — the CSS froze it, the DOM cost stays');
  assert.equal($(rm.doc, 'ig-bg'), null);
  const live = await boot();
  assert.ok($(live.doc, 'site-bg'), 'the backdrop still greets everyone else');
  assert.equal($(live.doc, 'site-bg').querySelectorAll(':scope > i').length, 20);
});
