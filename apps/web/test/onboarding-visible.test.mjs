/**
 * Onboarding lives in the guide, not on the landing.
 *
 * The standing #how-it-works section duplicated the guide's two flows on the
 * carnet landing; the owner removed it — the landing is the carnet itself, and
 * the marketplace is explained by the one-shot guide (#onboarding-dialog),
 * re-openable any time from the nav / footer "Comment ça marche" links.
 *
 *   1. The landing carries NO standing #how-it-works section (the pin for the
 *      removal — the pitch is the hero line + the carnet, nothing repeated).
 *   2. The guide's week board stays legible at dialog width (CSS contracts).
 *
 * Boot harness mirrors ux-nav.test.mjs: eval domain then app inside jsdom.
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

// ---------------------------------------------------------------------------
// 1. The landing carries no standing onboarding section
// ---------------------------------------------------------------------------

test('the landing has no standing #how-it-works section — the guide owns onboarding', async () => {
  const { doc } = await boot();
  assert.equal($(doc, 'how-it-works'), null, 'the section is gone from the landing');
  assert.equal(doc.querySelector('.how-card'), null, 'no stray role cards either');
  // The hero entry is gone too (owner's ask, 2026-08-25): pre-signup the guide
  // is a SMALL « ? » bubble — visible without eating hero space; the footer
  // link remains as the always-there fallback. Since 2026-08-27 the bubble is
  // STANDALONE (fixed, bottom-right), never part of the header menu.
  assert.equal($(doc, 'hero-guide'), null, 'no wide guide button in the hero CTA row');
  const guide = $(doc, 'guide-fab');
  assert.ok(guide, 'the standalone guide bubble exists');
  assert.ok(guide.classList.contains('icon-btn'), 'it is an icon button, not a text door');
  assert.ok(guide.querySelector('svg'), 'it carries the "?" glyph');
  assert.equal(guide.hidden, false, 'signed out (anon), the bubble shows');
  assert.equal(guide.closest('.site-header'), null, 'it does not live in the header menu');
  assert.ok($(doc, 'footer-guide'), 'the footer still offers the guide');
  assert.ok($(doc, 'onboarding-dialog'), 'the guide dialog itself remains');
});

test('the guide bubble is always there — signed in included', async () => {
  // The "?" is the ONE standing way back into the guide (owner's ask,
  // 2026-08-26): it never retires on sign-in, and the account menu carries
  // no duplicate "Comment ça marche" row.
  const { doc } = await boot({
    seed: { 'nota.profile.v1': JSON.stringify({ courriel: 'eve@client.ca', nom: 'Eve Roy' }) },
  });
  assert.equal($(doc, 'guide-fab').hidden, false, 'signed in, the bubble stays');
});

test('the guide opens from the standalone bubble in one tap', async () => {
  const { doc } = await boot();
  $(doc, 'guide-fab').click();
  await wait(10);
  assert.equal($(doc, 'onboarding-dialog').open, true);
});

// ---------------------------------------------------------------------------
// 2. The guide's week board is legible at dialog width
// ---------------------------------------------------------------------------
// The regressions these pin: the modal flavour (.nc-week--onb) hid the act's
// name unconditionally and swapped EVERY amount to the calendar's compact form
// ("5,6k"), so at full dialog width the board said neither the service nor the
// real price; and the chips and the empty ghost slots carried two different
// hard-coded heights, so a half-filled column read as two misaligned grids.
// The contract now: outside a narrow @container query, the exact amount and
// the act's name are visible; chips and slots share ONE height token; the
// compact form survives, but only where a phone-narrow container demands it.

const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

// styles.css minus every @container/@media block — the default layer only.
function defaultLayer(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  for (let i = 0; i < css.length; ) {
    const at = css.indexOf('@', i);
    if (at === -1) { out += css.slice(i); break; }
    if (!/^@(media|container)/.test(css.slice(at))) { out += css.slice(i, at + 1); i = at + 1; continue; }
    out += css.slice(i, at);
    let j = css.indexOf('{', at), depth = 1;
    for (j++; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    i = j;
  }
  return out;
}

// Every declaration block the default layer attaches to a selector.
function defaultDecls(css, selector) {
  const layer = defaultLayer(css);
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(layer))) {
    if (m[1].split(',').some((s) => s.trim() === selector)) out.push(m[2]);
  }
  return out.join(';');
}

test('week board: the exact amount and the act name show at dialog width', () => {
  assert.ok(!/display:\s*none/.test(defaultDecls(CSS_SRC, '.nc-week--onb .nc-week-chip-name')),
    'the act name is not hidden outside a narrow container query');
  assert.ok(!/font-size:\s*0/.test(defaultDecls(CSS_SRC, '.nc-week--onb .nc-week-chip-amt')),
    'the exact amount is not swapped for the compact form outside a narrow container query');
  // The phone fallback is still there — inside a container query, not the default.
  assert.match(CSS_SRC, /@container ncweek[^{]*\{[\s\S]*?attr\(data-compact\)/,
    'a narrow container still swaps to the compact amount');
});

test('week board: chips and empty slots share one height token', () => {
  const chip = defaultDecls(CSS_SRC, '.nc-week-chip');
  const slot = defaultDecls(CSS_SRC, '.nc-week-slot');
  const h = (d) => (d.match(/(?:^|;)\s*height:\s*([^;]+)/) || [])[1]?.trim();
  assert.equal(h(chip), 'var(--wk-cell-h)', 'the chip height is the shared token');
  assert.equal(h(slot), 'var(--wk-cell-h)', 'the slot height is the same token');
});
