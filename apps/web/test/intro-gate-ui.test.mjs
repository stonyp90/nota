/**
 * Intro-gate UI guarantees — the owner's rules on the first-arrival chooser
 * and the two pitch films, pinned against the STATIC surface (index.html +
 * styles.css). Behaviour (routing, the introSeen flag, deep links) lives in
 * smoke.test.mjs 40b–40c; what THIS suite locks is the look-and-layout law:
 *
 *   • the chooser doors carry NO durations (owner, 2026-08-27: the two
 *     invitations dropped their stopwatch — bdb23f5);
 *   • « Passer → » NEVER overlaps the film: .ig-skip is display:block with
 *     margin-left:auto, in normal flow BELOW the stages, never absolute;
 *   • the film is TRULY full screen (owner, 2026-08-27: « full screen ») —
 *     .ig-frame is a fixed, inset-0 viewport layer, and the stage wears no
 *     card chrome (no border, no radius, no shadow, no fixed aspect box);
 *   • the chooser floats over the drifting dice, not a dead sheet: the
 *     gate's backdrop is the theme token and nothing in the gate may paint
 *     a hardcoded color — both themes ride the same rules;
 *   • the doors and skip are real, reachable buttons.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const html = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
const doc = new JSDOM(html).window.document;

// Every rule block whose selector list names `sel` (a selector can head
// several rules — layout in one, paint in another).
const blocks = (sel) => {
  const re = new RegExp('(?:^|[,\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'gm');
  const list = css.match(re);
  assert.ok(list && list.length, sel + ' rule exists');
  return list;
};

test('chooser: two real door buttons and the enter link, no durations anywhere', () => {
  const doors = doc.querySelectorAll('#intro-gate .ig-door');
  assert.equal(doors.length, 2, 'two doors: client and notaire');
  for (const d of doors) {
    assert.equal(d.tagName, 'BUTTON', 'a door is a real button');
    assert.equal(d.getAttribute('type'), 'button', 'never an implicit submit');
    // Owner (2026-08-27): the invitations dropped their stopwatch — no
    // « 20 s », « 15 s », « 20 secondes »… on either door.
    assert.ok(!/\d+\s*s(ec|\b)/iu.test(d.textContent), 'a door carries no duration: ' + d.textContent.trim());
  }
  const enter = doc.querySelector('#ig-enter');
  assert.ok(enter && enter.tagName === 'BUTTON' && enter.getAttribute('type') === 'button',
    '« Entrer sur le site » is a real button too');
});

test('skip: « Passer → » sits BELOW the film in normal flow — never absolute, never over it', () => {
  const skip = doc.querySelector('#ig-skip');
  assert.ok(skip, 'the skip button exists');
  assert.equal(skip.tagName, 'BUTTON');
  assert.equal(skip.getAttribute('type'), 'button');
  // DOM order: the skip follows BOTH stages inside the frame, so normal flow
  // puts it under the film, not on it.
  const frame = doc.querySelector('#ig-frame');
  const kids = [...frame.children].map((k) => k.id || k.className);
  assert.deepEqual(kids, ['ig-stage-client', 'ig-stage-notaire', 'ig-skip'],
    'frame order: the two stages, then the skip');
  // CSS: in-flow block pushed right by an auto margin — and NO rule may ever
  // absolutize it back over the picture.
  assert.ok(blocks('.ig-skip').some((b) => /display:\s*block/.test(b) && /margin-left:\s*auto/.test(b)),
    '.ig-skip is display:block with margin-left:auto');
  assert.ok(!/\.ig-skip[^{]*\{[^}]*position:\s*(absolute|fixed)/.test(css),
    '.ig-skip is never position:absolute/fixed — it must never cover the film');
});

test('film: the frame is a fixed, edge-to-edge viewport layer with no card chrome', () => {
  const frame = blocks('.ig-frame');
  assert.ok(frame.some((b) => /position:\s*fixed/.test(b) && /inset:\s*0/.test(b)),
    'the frame is fixed and inset:0 — truly full screen, no gutters');
  // display:flex on .ig-frame outranks the UA [hidden] rule — the explicit
  // guard keeps `hidden` meaning hidden.
  assert.match(css, /\.ig-frame\[hidden\]\s*\{[^}]*display:\s*none/,
    'a [hidden] guard keeps the frame dismissible');
  // The stage fills the layer: no rounded inset card floating in margins.
  const stage = blocks('.ig-stage');
  assert.ok(stage.some((b) => /flex:\s*1/.test(b)), 'the stage takes every pixel above the skip bar');
  assert.ok(!stage.some((b) => /border-radius|box-shadow|aspect-ratio|border:\s*1px/.test(b)),
    'the stage wears no card chrome (border/radius/shadow) and no fixed aspect box');
  // Owner (2026-08-27, round two): « s'assurer que c'est vraiment l'écran
  // complet » — the stage itself spans the frame, no 16:9 max-width leaving
  // gutters beside the film on wide monitors.
  assert.ok(!stage.some((b) => /max-width/.test(b)),
    'the stage has no max-width — the film paints edge to edge');
  // And the composition survives it: the stage measures BOTH axes and the
  // scenes size in --igu, a unit capped by width AND height, so the type
  // never outgrows a short-and-wide screen.
  assert.ok(stage.some((b) => /container-type:\s*size/.test(b)),
    'the stage is a size container (cqw AND cqh available)');
  assert.ok(stage.some((b) => /--igu:\s*min\(\s*1cqw\s*,\s*[\d.]+cqh\s*\)/.test(b)),
    'the film unit --igu is min(1cqw, k·cqh) — height caps the scale');
});

// ADR 0033 §5 — the notaire film tells the profession's rules before it
// signs off: one compliance scene between the acceptance and the finale,
// three illustrated tiles citing the articles (ADR 0031, docs/legal/
// conformite-deontologique-notaires.md), and the same tiles repeated on the
// landing under the sign-in gate so they are visible outside the film.
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const appSrc = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

function assertThreeArticles(root, tileSel) {
  const tiles = root.querySelectorAll(tileSel);
  assert.equal(tiles.length, 3, 'three tiles: ' + tileSel);
  for (const t of tiles) assert.ok(t.querySelector('svg'), 'each tile is illustrated');
  const txt = FLAT(root.textContent);
  assert.match(txt, /Nota respecte les règles de votre profession/);
  assert.match(txt, /Art\. 32\.1/); assert.match(txt, /Loi sur le notariat/); assert.match(txt, /100 %/);
  assert.match(txt, /Art\. 32 et 29\.1/); assert.match(txt, /Code de déontologie/);
  assert.match(txt, /Art\. 49/);
  assert.match(txt, /Une décision de l’Ordre s’applique toujours en premier/);
  // Never the retired vocabulary: no share, no rate, no commission.
  assert.ok(!/commission|pourcentage|\d+\s*%(?!\s*du montant)/.test(txt.replace('100 %', '')), 'no share vocabulary: ' + txt);
}

test('notaire film: a compliance scene sits between the acceptance and the finale, and the timeline grew with it', () => {
  const scenes = [...doc.querySelectorAll('#ig-stage-notaire .ig-scene')].map((s) => s.className.replace('ig-scene ', ''));
  assert.deepEqual(scenes, ['ig-n1', 'ig-n2', 'ig-n3', 'ig-n4', 'ig-n5'], 'five scenes, the finale last');
  const conf = doc.querySelector('#ig-stage-notaire .ig-n4');
  assertThreeArticles(conf, '.ig-conf-tile');
  assert.match(FLAT(doc.querySelector('#ig-stage-notaire .ig-n5').textContent), /Remplissez votre semaine\./, 'the finale is still the finale');
  // CSS timeline: the new scene enters after n3 leaves, the finale holds.
  const n3out = /\.run \.ig-n3 \{[^}]*igOut [\d.]+s ease ([\d.]+)s/.exec(css);
  const EASE = '(?:[^ ]+|cubic-bezier\\([^)]*\\))';
  const n4in = new RegExp('\\.run \\.ig-n4 \\{ animation: igIn [\\d.]+s ' + EASE + ' ([\\d.]+)s both, igOut [\\d.]+s ease ([\\d.]+)s forwards; \\}').exec(css);
  const n5in = new RegExp('\\.run \\.ig-n5 \\{ animation: igIn [\\d.]+s ' + EASE + ' ([\\d.]+)s both, igHold [\\d.]+s linear ([\\d.]+)s forwards; \\}').exec(css);
  assert.ok(n3out && n4in && n5in, 'n3 out, n4 in/out and n5 in/hold are all timed');
  assert.ok(Number(n4in[1]) > Number(n3out[1]), 'n4 enters after n3 leaves');
  assert.ok(Number(n5in[1]) > Number(n4in[2]), 'n5 enters after n4 leaves');
  assert.ok(Number(n4in[2]) - Number(n4in[1]) >= 4, 'the compliance scene stays long enough to be read');
  assert.ok(/\.run \.ig-n4 \.ig-conf-tile:nth-child\(3\) \{ animation-delay/.test(css), 'the tiles arrive one by one');
  // The bar and the JS constant follow the film's new length (bar = timer − 0.6 s).
  const bar = /#ig-stage-notaire\.run \.ig-progress \{ animation-duration: ([\d.]+)s; \}/.exec(css);
  const timer = /film === 'client' \? (\d+) : (\d+)\)/.exec(appSrc);
  assert.ok(bar && timer, 'bar duration and film timer found');
  assert.ok(Number(timer[2]) > 15600, 'the notaire film is longer than before');
  assert.equal(Number(timer[2]), Math.round(Number(bar[1]) * 1000) + 600, 'the timer trails the bar by the same 0.6 s as the client film');
  assert.ok(Number(timer[2]) >= Number(n5in[2]) * 1000, 'the timer fires after the finale holds');
  // The gate stays inert under prefers-reduced-motion.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ig \{ display: none; \}/);
  // Tokens only, square register, on the new tiles.
  for (const b of blocks('.ig-conf-tile')) {
    assert.ok(!/(?:background|color|border)[^;}]*(?:#[0-9a-fA-F]{3}|rgb\(|hsl\()/.test(b), 'tiles paint tokens only: ' + b);
    assert.ok(!/border-radius:\s*(?:50%|calc\(99)/.test(b), 'no pill on a tile');
  }
});

test('notary landing: the same three articles sit right under the sign-in gate, and fold away signed-in', () => {
  const sec = doc.querySelector('#nc-conformite');
  assert.ok(sec, 'the Conformité section exists');
  assert.equal(sec.tagName, 'SECTION');
  assert.equal(sec.previousElementSibling && sec.previousElementSibling.id, 'notary-auth-form', 'right under the gate');
  assert.equal(sec.closest('#pane-notaires') && sec.closest('#pane-notaires').id, 'pane-notaires');
  assertThreeArticles(sec, '.nc-conformite-tile');
  const link = sec.querySelector('a.goto-link[data-goto="conditions"]');
  assert.ok(link, 'a door to the conditions — the site’s deontology surface');
  assert.match(FLAT(link.textContent), /Lire nos engagements déontologiques/);
  assert.match(css, /#notary-auth-form\[hidden\]\s*\+\s*#nc-conformite\s*\{[^}]*display:\s*none/, 'signed-in, the gate folds and the block with it');
  for (const b of blocks('.nc-conformite-tile')) {
    assert.ok(!/(?:background|color|border)[^;}]*(?:#[0-9a-fA-F]{3}|rgb\(|hsl\()/.test(b), 'tiles paint tokens only: ' + b);
  }
});

test('backdrop: the gate floats on theme tokens — no hardcoded paint hides the dice', () => {
  assert.ok(blocks('.ig').some((b) => /background:\s*var\(--bg\)/.test(b)),
    'the gate backdrop is the theme token — both themes follow');
  // The whole ig block set (gate, frame, stage, skip) paints ONLY via var():
  // a literal color in either theme would make one of them a dead sheet.
  for (const sel of ['.ig', '.ig-frame', '.ig-stage', '.ig-skip']) {
    for (const b of blocks(sel)) {
      assert.ok(!/(?:background|color|border)[^;}]*(?:#[0-9a-fA-F]{3}|rgb\(|hsl\()/.test(b),
        sel + ' paints tokens only, no literals: ' + b.trim());
    }
  }
});
