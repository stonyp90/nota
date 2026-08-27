/**
 * Nota select — the brand-styled dropdown drawn over every VISIBLE native
 * <select>.
 *
 * Why: the OS draws the native popup (macOS Chrome follows the OS appearance,
 * not the page's color-scheme), so a dark Nota page could open a white system
 * menu — off-brand and jarring. The enhancement keeps the native <select> in
 * the DOM as the single source of truth (forms, tests and i18n keep talking to
 * it) and paints the visible control with the design tokens:
 *
 *   .nselect            wrapper (position:relative anchor)
 *   ├─ select.nselect-native   the real control, visually hidden
 *   ├─ button.nselect-btn      the closed control (combobox pattern)
 *   │   └─ span.nselect-value  mirrors the selected option's text
 *   └─ ul[role=listbox].nselect-list   the branded popup, li[role=option] items
 *
 * Two-way sync: picking an option writes sel.value and fires change (bubbling),
 * so existing listeners run; any programmatic sel.value write repaints the
 * button label (the app prefills ct-sujet this way).
 *
 * Harness mirrors cancel-contact.test.mjs (jsdom + fetch stub).
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
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain };
}

const wrapOf = (sel) => sel.closest('.nselect');
const key = (win, el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

// --- The enhancement contract ------------------------------------------------

test('every visible select is enhanced; the hidden a11y mirrors are left alone', async () => {
  const { doc } = await boot();

  const sujet = $(doc, 'ct-sujet');
  const wrap = wrapOf(sujet);
  assert.ok(wrap, 'ct-sujet must be wrapped in .nselect');
  assert.ok(sujet.classList.contains('nselect-native'), 'the native control is visually retired');
  const btn = wrap.querySelector('button.nselect-btn');
  assert.ok(btn, 'the visible control is a button');
  assert.equal(btn.type, 'button', 'must never submit the surrounding form');
  assert.equal(btn.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  const list = wrap.querySelector('.nselect-list');
  assert.equal(list.getAttribute('role'), 'listbox');
  assert.equal(list.hidden, true, 'the popup starts closed');

  // The button label mirrors the selected option from the start.
  assert.equal(wrap.querySelector('.nselect-value').textContent, 'Question générale');

  // The screen-reader mirrors (d-service / o-service) keep their native UI.
  for (const id of ['d-service', 'o-service']) {
    assert.ok(!wrapOf($(doc, id)), id + ' is a visually-hidden mirror and must NOT be enhanced');
  }
});

test('the label points at the button, and the native select leaves the tab order', async () => {
  const { doc } = await boot();
  const sujet = $(doc, 'ct-sujet');
  const btn = wrapOf(sujet).querySelector('.nselect-btn');
  assert.equal(sujet.tabIndex, -1);
  assert.equal(sujet.getAttribute('aria-hidden'), 'true');
  const lbl = doc.querySelector('label[for="' + btn.id + '"]');
  assert.ok(lbl, 'the field label must re-point at the visible button');
  assert.equal(lbl.textContent, 'Sujet');
});

// --- Open, pick, sync --------------------------------------------------------

test('clicking the button opens the branded listbox mirroring the options', async () => {
  const { doc } = await boot();
  const sujet = $(doc, 'ct-sujet');
  const wrap = wrapOf(sujet);
  const btn = wrap.querySelector('.nselect-btn');

  btn.click();
  const list = wrap.querySelector('.nselect-list');
  assert.equal(list.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const opts = [...list.querySelectorAll('[role="option"]')];
  assert.deepEqual(opts.map((o) => o.textContent), [...sujet.options].map((o) => o.textContent));
  assert.equal(opts[0].getAttribute('aria-selected'), 'true', 'the current choice is marked');
});

test('picking an option writes the native value, fires change, closes', async () => {
  const { win, doc } = await boot();
  const sujet = $(doc, 'ct-sujet');
  const wrap = wrapOf(sujet);
  let changes = 0;
  sujet.addEventListener('change', () => { changes += 1; });

  wrap.querySelector('.nselect-btn').click();
  const target = [...wrap.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'Problème technique');
  target.click();

  assert.equal(sujet.value, 'Problème technique');
  assert.equal(changes, 1, 'existing change listeners must keep firing');
  assert.equal(wrap.querySelector('.nselect-list').hidden, true, 'popup closes on pick');
  assert.equal(wrap.querySelector('.nselect-value').textContent, 'Problème technique');
  void win;
});

test('the contact prefill (a programmatic write + change) repaints the label', async () => {
  const { win, doc } = await boot();
  const sujet = $(doc, 'ct-sujet');
  // Contract: programmatic writes are followed by a bubbling change — exactly
  // what openContactDialog() does when it resets the subject on open.
  sujet.value = 'Aide avec une offre';
  sujet.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(wrapOf(sujet).querySelector('.nselect-value').textContent, 'Aide avec une offre');

  // And the real door: opening « Nous joindre » resets the subject + label.
  $(doc, 'mnav-contact').click();
  assert.equal(sujet.value, 'Question générale');
  assert.equal(wrapOf(sujet).querySelector('.nselect-value').textContent, 'Question générale');
});

test('keyboard: ArrowDown opens and walks, Enter commits, Escape closes', async () => {
  const { win, doc } = await boot();
  const sujet = $(doc, 'ct-sujet');
  const wrap = wrapOf(sujet);
  const btn = wrap.querySelector('.nselect-btn');
  const list = wrap.querySelector('.nselect-list');

  key(win, btn, 'ArrowDown');
  assert.equal(list.hidden, false, 'ArrowDown opens the closed control');
  key(win, btn, 'ArrowDown');
  const opts = [...list.querySelectorAll('[role="option"]')];
  assert.ok(opts[1].classList.contains('is-active'), 'ArrowDown moves the active option');
  key(win, btn, 'Enter');
  assert.equal(sujet.value, sujet.options[1].value, 'Enter commits the active option');
  assert.equal(list.hidden, true);

  key(win, btn, 'ArrowDown');
  assert.equal(list.hidden, false);
  key(win, btn, 'Escape');
  assert.equal(list.hidden, true, 'Escape closes without committing');
});

test('clicking outside closes the popup', async () => {
  const { doc } = await boot();
  const wrap = wrapOf($(doc, 'ct-sujet'));
  wrap.querySelector('.nselect-btn').click();
  assert.equal(wrap.querySelector('.nselect-list').hidden, false);
  doc.body.click();
  assert.equal(wrap.querySelector('.nselect-list').hidden, true);
});

// --- The dynamic lender select (the screenshot offender) ---------------------

test('the booking flow’s lender catalogue renders as an enhanced Nota select', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.selectDate(addDays(todayISO(), 10));
  await wait(10);

  const sel = $(doc, 'crit-preteur');
  assert.ok(sel, 'the lender select must exist');
  const wrap = wrapOf(sel);
  assert.ok(wrap, 'the dynamically built .crit-select must be enhanced too');

  const btn = wrap.querySelector('.nselect-btn');
  btn.click();
  const opts = [...wrap.querySelectorAll('[role="option"]')];
  assert.equal(opts.length, 1 + D.LENDERS.length, 'the popup IS the catalogue');

  const desj = opts.find((o) => /Desjardins/.test(o.textContent));
  assert.ok(desj, 'the catalogue names Desjardins');
  desj.click();
  assert.equal(sel.value, 'desjardins');
  // The change reached the pricing pipeline: the native listener ran.
  assert.match(wrap.querySelector('.nselect-value').textContent, /Desjardins/);
  void win;
});

// --- The stylesheet stays on brand -------------------------------------------

test('the Nota select is drawn with the design tokens, not literal colors', () => {
  const btnRule = CSS_SRC.match(/\.nselect-btn\s*{[^}]*}/);
  assert.ok(btnRule, '.nselect-btn rule missing');
  assert.match(btnRule[0], /var\(--surface\)/);
  assert.match(btnRule[0], /var\(--ink\)/);
  const listRule = CSS_SRC.match(/\.nselect-list\s*{[^}]*}/);
  assert.ok(listRule, '.nselect-list rule missing');
  assert.match(listRule[0], /var\(--surface\)/);
  assert.match(listRule[0], /var\(--shadow-lg\)/);
  assert.ok(!/\.nselect[^{]*{[^}]*#[0-9a-fA-F]{3}/.test(CSS_SRC), 'no literal hex colors in the nselect rules');
});

test('the remaining native controls are themed: textarea joins the field rule, checkboxes get the brand accent', () => {
  assert.match(
    CSS_SRC,
    /select, input\[type='text'\], input\[type='email'\], input\[type='tel'\], input\[type='number'\], input\[type='date'\], textarea\s*{/,
    'textarea must share the token-styled field rule (the contact form message was native chrome)'
  );
  assert.match(
    CSS_SRC,
    /input\[type='checkbox'\], input\[type='radio'\]\s*{\s*accent-color: var\(--brand\)/,
    'every checkbox/radio must take the brand accent by default'
  );
});
