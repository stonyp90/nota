/**
 * The info tip — the house pattern for a SITUATIONAL note.
 *
 * The complaint (owner, 2026-09-05): a note that appears because of an answer
 * — « sans les instructions du prêteur en main… », in orange, under the bank
 * approval question — GREW the card that held it and pushed everything below
 * it down the page, then let it snap back on the next answer. The form moved
 * under the client's hand while they were reading it.
 *
 * The contract these tests hold:
 *   1. A situational note never takes a line of its own. It rides a small
 *      « i » on the question's OWN line and opens in a floating panel.
 *   2. The tip keeps its box whether or not it has something to say — the
 *      label line does not jitter either — and a tip with nothing to say is
 *      neither focusable nor announced (visibility, never display).
 *   3. Three ways in: hover, keyboard focus, and a click that pins the panel.
 *      A pinned panel closes on Escape, on an outside click, and when another
 *      tip is opened — two never stand open at once.
 *   4. It is a real button with a real name, and the panel it controls is a
 *      role="tooltip" it points at.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

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
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(70);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain };
}

async function openRefinancement(doc, days = 6) {
  const iso = addDays(todayISO(), days);
  doc.defaultView.Nota.selectDate(iso);
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  return iso;
}
const row_ = (doc, crit) => doc.querySelector('#o-criteria .crit-row[data-crit="' + crit + '"]');

test('a situational note costs the card no height: it rides the question’s own line, in a panel that floats', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  const ap = row_(doc, 'approbation_bancaire');

  // The row's own children before and after the note turns on: identical.
  // Nothing is appended, nothing is removed — only an attribute flips.
  const shape = () => [...ap.children].map((c) => c.tagName + '.' + c.className).join('|');
  const before = shape();
  $(doc, 'crit-approbation_bancaire__en_cours').click();
  await wait(10);
  assert.equal(shape(), before, 'the row gains no new block — its height cannot have changed');

  const tip = $(doc, 'o-approbation-note');
  assert.ok(tip.classList.contains('itip'), 'the note is an info tip');
  assert.equal(tip.dataset.on, 'true');
  assert.ok(tip.closest('.crit-head'), 'pinned to the question’s label line');
  assert.equal(tip.parentNode.previousElementSibling, null, 'the head is the row’s first child');

  // The panel is out of flow: it cannot push anything.
  assert.match(CSS_SRC, /\.itip-pop\s*\{[^}]*position:\s*absolute/, 'the panel floats over the page');
  // And the « i » keeps its box when it has nothing to say — visibility, so
  // the space is held AND the control is neither focusable nor announced.
  assert.match(CSS_SRC, /\.itip\[data-on='false'\]\s*\{\s*visibility:\s*hidden;\s*\}/,
    'a silent tip keeps its box (never display:none, which would move the line)');
});

test('the tip is a real button, named, pointing at the panel it controls', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  $(doc, 'crit-approbation_bancaire__en_cours').click();
  await wait(10);
  const tip = $(doc, 'o-approbation-note');
  const btn = tip.querySelector('.itip-btn');
  const pop = tip.querySelector('.itip-pop');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button', 'never a submit inside the offer form');
  assert.equal(btn.getAttribute('aria-label'), 'Information', 'the icon is never the label');
  assert.equal(btn.getAttribute('aria-controls'), pop.id);
  assert.equal(btn.getAttribute('aria-describedby'), pop.id, 'a screen reader reads the sentence after the button');
  assert.equal(pop.getAttribute('role'), 'tooltip');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.match(pop.textContent, /rarement tenable/);
  assert.equal(btn.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the glyph is decoration');
});

test('three ways in: a click pins the panel, Escape and an outside click close it, and two never stand open', async () => {
  const { win, doc } = await boot();
  await openRefinancement(doc);
  $(doc, 'crit-approbation_bancaire__en_cours').click();
  $(doc, 'crit-deplacement__qui_notaire').click();
  await wait(10);
  const ap = $(doc, 'o-approbation-note');
  const far = row_(doc, 'deplacement').querySelector('.itip.crit-caveat[data-caveat="notaire"]');
  assert.equal(far.dataset.on, 'true', 'both tips have something to say');

  ap.querySelector('.itip-btn').click();
  assert.equal(ap.dataset.open, 'true', 'a click pins it open — the phone and the keyboard get in too');
  assert.equal(ap.querySelector('.itip-btn').getAttribute('aria-expanded'), 'true');

  // Opening the second closes the first: one panel over the page at a time.
  far.querySelector('.itip-btn').click();
  assert.equal(ap.dataset.open, 'false');
  assert.equal(far.dataset.open, 'true');

  // Escape closes it and hands focus back to the « i ».
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(far.dataset.open, 'false');
  assert.equal(doc.activeElement, far.querySelector('.itip-btn'), 'focus comes back to the control');

  // An outside click dismisses it.
  ap.querySelector('.itip-btn').click();
  assert.equal(ap.dataset.open, 'true');
  doc.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(ap.dataset.open, 'false');
});

test('a note that stands down closes its own panel and stops being reachable', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  $(doc, 'crit-approbation_bancaire__en_cours').click();
  await wait(10);
  const tip = $(doc, 'o-approbation-note');
  tip.querySelector('.itip-btn').click();
  assert.equal(tip.dataset.open, 'true');

  $(doc, 'crit-approbation_bancaire__obtenue').click();
  await wait(10);
  assert.equal(tip.dataset.on, 'false', 'approval in hand: nothing to say');
  assert.equal(tip.dataset.open, 'false', 'the pinned panel goes with it');
  assert.equal(tip.querySelector('.itip-pop').textContent, '', 'and says nothing to a screen reader');
});

test('every question carries its head, so no answer can grow the sheet', async () => {
  const { doc } = await boot();
  await openRefinancement(doc);
  const rows = [...doc.querySelectorAll('#o-criteria .crit-row[data-crit]')];
  assert.ok(rows.length >= 4, 'the refinancing sheet asks several questions');
  for (const r of rows) {
    // Flag questions carry their label inside the checkbox's own line already.
    if (r.querySelector(':scope > label.crit-flag')) continue;
    const head = r.querySelector(':scope > .crit-head');
    assert.ok(head, 'the question ' + r.dataset.crit + ' has a head line');
    assert.ok(head.querySelector(':scope > .crit-label'), 'the label lives on it');
  }
});

test('the awaited-answer note rides the label line instead of opening one under it', async () => {
  const { win, doc } = await boot();
  await openRefinancement(doc);
  const ap = row_(doc, 'approbation_bancaire');
  // Every node the row renders, head included — the message's line is reserved
  // from the first paint, so starting the form inserts nothing anywhere.
  const shape = () => [...ap.querySelectorAll('*')].map((c) => c.tagName + '.' + c.className).join('|');
  const before = shape();
  const note0 = ap.querySelector('.crit-req');
  assert.ok(note0 && note0.dataset.on === 'false', 'the line is already there, and silent');
  assert.ok(note0.closest('.crit-head'), 'on the label’s own line');

  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000';
  lv.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(10);
  const note = ap.querySelector('.crit-req');
  assert.equal(note, note0, 'the same line speaks — nothing was inserted');
  assert.equal(note.dataset.on, 'true', 'the awaited question still says so, out loud');
  assert.equal(note.hidden, false, 'never display:none — that is what used to move the sheet');
  assert.equal(shape(), before, 'the row gained no node — the sheet did not grow');
});

test('the « i » is a 24 px target and does not lean on hover alone', () => {
  // WCAG 2.2 Target Size (Minimum): the glyph stays 18 px so it never lifts the
  // label's line, and the target is grown outward by an out-of-flow pad.
  assert.match(CSS_SRC, /\.itip-btn::after\s*\{[^}]*inset:\s*-3px/, 'the hit area is padded out to 24 px');
  // On a touch screen a tap leaves a stuck :hover behind — the panel would
  // never close. Hover is offered only where a pointer can hover.
  assert.match(CSS_SRC, /@media \(hover: hover\)\s*\{\s*\.itip:hover > \.itip-pop/,
    'hover is gated on a real pointer');
  assert.match(CSS_SRC, /\.itip\[data-open='true'\] > \.itip-pop \{ opacity: 1/,
    'the pinning tap works everywhere, hover or not');
});

test('the sector preview keeps its line, so typing a postal code never nudges the fields under it', () => {
  assert.match(CSS_SRC, /\.prefix-preview\s*\{[^}]*min-height:/, 'the line is reserved');
  assert.ok(!/\.prefix-preview:empty\s*\{\s*display:\s*none/.test(CSS_SRC),
    'it no longer collapses to nothing between an empty field and the first character');
});

test('a held line always pairs a display with its visibility — otherwise the browser’s [hidden] wins and the line goes anyway', () => {
  // The trap this test exists for: `visibility: hidden` alone does NOT hold a
  // line. The user agent's own `[hidden] { display: none }` still applies
  // unless an AUTHOR `display` outranks it, and the line vanishes exactly as
  // before — silently, because jsdom computes no layout and every unit test
  // still passes. Every `[hidden]` rule that reaches for `visibility` must
  // therefore state a `display` in the same block.
  const blocks = [...CSS_SRC.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)];
  const holds = blocks.filter(([, , body]) => /visibility:\s*hidden/.test(body));
  for (const [, selector, body] of holds) {
    // …and the app's own blanket `.hidden, [hidden] { display: none !important }`
    // outranks a plain declaration, so the display must answer !important.
    assert.match(body, /display:\s*[a-z-]+\s*!important/,
      'a held line whose display cannot outrank the [hidden] blanket: ' + selector.trim());
  }
  // Said ONCE, as one list — not re-invented next to each element it governs.
  assert.ok(holds.length <= 2, 'the register is one place, not a scatter of rules');
  const [, selectors] = holds[0];
  for (const s of ['.hold', '.offer-hint', '.day-beat', '.cal-avail', '.chat-count', '.nc-field-err', '.ct-count']) {
    assert.ok(selectors.includes(s + '[hidden]'), s + ' is not in the register');
  }
  assert.match(CSS_SRC, /\.hold-line \{ min-height:/);
});

test('the lines that must stay readable are reserved, not hidden', () => {
  // A validation message, a counter, a « ✓ enregistré » cannot go behind an
  // « i » — they have to be read in place. So they keep their line instead.
  for (const [name, re] of [
    ['the publish gate’s reason', /\.offer-hint \{[^}]*min-height:/],
    ['the live line under the amount slider', /\.day-value-note \{[^}]*min-height:/],
    ['the act chip’s bar figure', /\.chip-svc-sub \{[^}]*min-height:/],
    ['the dossier’s readiness line', /\.dossier-missing \{[^}]*min-height:/],
    ['the notary’s field errors', /\.nc-field-err \{[^}]*min-height:/],
    ['the guide’s live role lines', /\.onb-choice-live \{[^}]*min-height:/],
    ['the three « enregistré » confirmations', /\.nc-prefs-saved \{[^}]*min-height:/],
  ]) assert.match(CSS_SRC, re, name + ' does not hold its line');

  // The collapse-to-nothing idiom is gone from the nodes that are emptied
  // rather than hidden — `:empty { display: none }` moved the page too.
  for (const dead of ['.day-value-note:empty', '.chip-svc-sub:empty', '.dossier-missing:empty', '.prefix-preview:empty']) {
    assert.ok(!CSS_SRC.includes(dead), dead + ' still collapses its own line');
  }
});

test('one screen at a time: nothing from another screen is laid out beside it', () => {
  // The trap this test exists for: the held-line register answers
  // `display: block !important`, which OUTRANKS a plain `display: none` on the
  // screen machine. `#offer-hint` carries both — so once the offer was
  // publishable it laid a 29px empty band above the action bar on screens 1-3,
  // and no test saw it, because no test knew the screens existed.
  const machine = CSS_SRC.match(/\.day-book > \[data-screen\] \{([^}]*)\}/);
  assert.ok(machine, 'the screen machine exists');
  assert.match(machine[1], /display:\s*none\s*!important/,
    'the machine must outrank the held-line register, which is !important');
  assert.match(CSS_SRC, /\.day-book\[data-at='4'\] > \[data-screen='4'\] \{ display: block !important; \}/,
    'and the showing side answers in kind, or nothing would ever show');
  // A published offer shows the confirmation alone.
  assert.match(CSS_SRC, /\.day-book\[data-at='done'\] > \.book-rail[\s\S]{0,80}display: none/,
    'the rail and the action bar leave with the form');
  assert.ok(APP_SRC.includes("bf.dataset.at = 'done'"), 'publishing puts the sheet in the done state');
});

test('every block of the booking sheet belongs to a screen', async () => {
  const { doc } = await boot();
  const form = $(doc, 'offer-form');
  // Anything without a data-screen shows on ALL FOUR screens. Only three
  // things may: the rail, the action bar, and the published-offer card.
  const exempt = new Set(['book-rail', 'offer-success']);
  const leaks = [...form.children].filter((n) => {
    if (n.hasAttribute('data-screen')) return false;
    if (exempt.has(n.id) || n.classList.contains('book-nav')) return false;
    // A visually-hidden mirror costs no layout and must stay in the whole-form
    // validity guard — it is deliberately screenless.
    return !n.classList.contains('visually-hidden');
  }).map((n) => n.id || n.className);
  assert.deepEqual(leaks, [], 'these blocks would show on every screen');
});

test('answering a list swaps in place — it never stacks a new field under it', async () => {
  // Owner, 2026-09-05: « sélectionner une valeur dans la liste ne fait pas
  // bouger le rendu du composant ». Choosing « Autre prêteur » used to reveal
  // the lender-name field UNDER the question's help, growing the sheet by
  // 101 px — every other value moved nothing, so answering this one question
  // shoved everything below it down the dialog. The companion now takes the
  // place the help gives up: one line for one line.
  const { win, doc } = await boot();
  await openRefinancement(doc);
  const row = row_(doc, 'preteur');
  // 2026-09-05 : l'aide a rejoint le panneau du « i » de la question ; l'échange
  // qu'exige ce test tient toujours — elle se retire quand le compagnon arrive.
  const help = row.querySelector('.help');
  const other = row.querySelector(':scope > .crit-other');
  const input = other.querySelector('input[type="text"]');
  assert.ok(help && other && input, 'the question has a help, a companion and its field');
  assert.equal(other.hidden, true, 'the companion is away while a catalogue lender is chosen');
  assert.equal(help.hidden, false);

  const sel = $(doc, 'crit-preteur');
  sel.value = 'autre';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(10);
  assert.equal(other.hidden, false, 'the companion arrives');
  assert.equal(help.hidden, true, '…and the help gives up its line — they swap, never stack');

  sel.value = 'desjardins';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(10);
  assert.equal(other.hidden, true);
  assert.equal(help.hidden, false, 'and back');

  // What keeps the swap even: the companion costs ONE line — its label is read,
  // not printed, and the field says what to write.
  assert.ok(other.querySelector('label.visually-hidden'), 'the companion’s label is read, not printed');
  assert.ok(input.placeholder, 'the field says what to write');
  const ohelp = other.querySelector('.help');
  if (ohelp) assert.ok(ohelp.classList.contains('visually-hidden'),
    'its own help is announced, not printed — a second line would unbalance the swap');
});

test('selected text answers to the brand tokens, not the browser’s blue', () => {
  assert.match(CSS_SRC, /::selection\s*\{[^}]*var\(--brand\)/);
  assert.ok(!/::selection\s*\{[^}]*#[0-9a-f]{3,8}/i.test(CSS_SRC), 'no literal colour in the selection rule');
});
