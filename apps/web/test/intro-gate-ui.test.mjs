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
 *   • the chooser sits on a quiet, plain backdrop: the gate's backdrop is
 *     the theme token and nothing in the gate may paint a hardcoded color —
 *     both themes ride the same rules;
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

test('chooser: three real door buttons and the enter link, no durations anywhere', () => {
  const doors = doc.querySelectorAll('#intro-gate .ig-door');
  assert.equal(doors.length, 3, 'three doors: client, notaire and partner');
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
  assert.deepEqual(kids, ['ig-stage-client', 'ig-stage-notaire', 'ig-controls'],
    'frame order: the two stages, then the controls');
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
  // The stage supplies both axes for responsive spacing; text has a fixed minimum.
  assert.ok(stage.some((b) => /container-type:\s*size/.test(b)),
    'the stage is a size container (cqw AND cqh available)');
  assert.match(css, /font-size: clamp\(28px, 4.5cqw, 56px\)/, 'headings retain a readable minimum and a restrained maximum');
});

// The detailed professional commitments remain readable on the notary landing.
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const appSrc = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

function assertThreeArticles(root, tileSel) {
  const tiles = root.querySelectorAll(tileSel);
  assert.equal(tiles.length, 3, 'three tiles: ' + tileSel);
  for (const t of tiles) assert.ok(t.querySelector('svg'), 'each tile is illustrated');
  const txt = FLAT(root.textContent);
  assert.match(txt, /Votre indépendance et vos obligations restent entières/);
  assert.match(txt, /Art\. 32\.1/); assert.match(txt, /Loi sur le notariat/); assert.match(txt, /100 %/);
  assert.match(txt, /Art\. 32 et 29\.1/); assert.match(txt, /Code de déontologie/);
  assert.match(txt, /Art\. 49/);
  assert.match(txt, /Une décision de l’Ordre s’applique toujours en premier/);
  // Never the retired vocabulary: no share, no rate, no commission.
  assert.ok(!/commission|pourcentage|\d+\s*%(?!\s*du montant)/.test(txt.replace('100 %', '')), 'no share vocabulary: ' + txt);
}

test('both films explain the outcome in four scenes and offer a direct next step', () => {
  for (const film of ['client', 'notaire']) {
    const stage = doc.querySelector('#ig-stage-' + film);
    const scenes = [...stage.querySelectorAll('.ig-scene')];
    assert.equal(scenes.length, 4);
    const masthead = stage.querySelector('.ig-masthead');
    const wordmark = masthead && masthead.querySelector('.ig-wordmark');
    assert.equal(stage.querySelector('.ig-dollar, .ig-step'), null, 'each message stands on its own without dollar scenery or repeated step cards');
    for (const scene of scenes) {
      assert.ok(scene.querySelector('.ig-h'));
      assert.ok(scene.querySelector('.ig-sub'));
      assert.ok(!scene.hasAttribute('aria-hidden'), 'visible scene text stays accessible');
    }
    if (film === 'notaire') {
      assert.ok(wordmark && wordmark.querySelector('svg'), 'the notary header carries the Nota mark');
      assert.equal(wordmark.querySelector('.ig-word')?.textContent.trim(), 'OTA');
      assert.ok(!masthead.closest('.ig-scene'));
      for (const scene of [scenes[0], scenes.at(-1)]) {
        const signature = scene.querySelector('.ig-signature');
        assert.ok(signature && signature.querySelector('svg'), 'Nota opens and closes the notary film');
        assert.equal(signature.querySelector('.ig-word')?.textContent.trim(), 'OTA', 'scene signatures use the complete Nota lockup');
      }
    } else {
      assert.equal(masthead, null, 'the client animation keeps only the calendar and its explanation');
      assert.equal(stage.querySelectorAll('.ig-wordmark').length, 1, 'one persistent Nota signature identifies the calendar');
      assert.ok(stage.querySelector('.ig-client-calendar .ig-client-brand'), 'the calendar carries the approved Nota lockup');
      assert.ok(stage.querySelector('#ig-client-dates'), 'the client sees which calendar gesture to make');
      assert.equal(stage.querySelector('#ig-client-dates').closest('.ig-scene'), null, 'the calendar stays visible between scenes');
      assert.match(scenes[1].textContent, /Refinancement/);
      assert.match(scenes[2].textContent, /Votre offre.*Service Nota.*Prix total/s);
      assert.ok(scenes[3].querySelector('.ig-client-publish'), 'publication is demonstrated before the real guide');
    }
    const next = scenes.at(-1).querySelector('.ig-cta');
    assert.ok(next && next.tagName === 'BUTTON', 'the last scene has a real next-step button');
    assert.equal(next.getAttribute('type'), 'button');
    assert.equal(next.dataset.igGoto, film === 'client' ? 'carnet' : 'notaires');
    assert.ok(next.textContent.trim(), 'the next step has a readable label');
  }
  assert.match(css, /igBarAnim 14s/);
  assert.match(appSrc, /IG_FILM_MS = 14400/);
  assert.ok(doc.querySelector('#ig-pause'));
  assert.equal(doc.querySelectorAll('#intro-gate [data-lang-seg]').length, 2);
  assert.equal(doc.querySelectorAll('#intro-gate .ig-progress-seek').length, 2,
    'each film exposes a seekable scene progress control');
  assert.match(appSrc, /function igSeekScene\(/, 'the progress control can jump between scenes');
});

test('notary landing: the three articles remain available in a secondary disclosure', () => {
  const sec = doc.querySelector('#nc-conformite');
  assert.ok(sec, 'the Conformité section exists');
  assert.equal(sec.tagName, 'SECTION');
  assert.equal(sec.parentElement.id, 'notary-calendar-obligations');
  assert.equal(sec.parentElement.open, false, 'calendar subscription is the initial focus');
  assert.ok(sec.parentElement.querySelector('summary'), 'professional obligations remain discoverable');
  assert.ok(!sec.closest('#notary-console'), 'never back inside the gate card');
  assert.equal(sec.closest('#pane-notaires') && sec.closest('#pane-notaires').id, 'pane-notaires');
  assertThreeArticles(sec, '.nc-conformite-tile');
  const link = sec.querySelector('a.goto-link[data-goto="conditions"]');
  assert.ok(link, 'a door to the conditions — the site’s deontology surface');
  assert.match(FLAT(link.textContent), /Lire nos engagements déontologiques/);
  assert.match(css, /:has\(#notary-auth-form\[hidden\]\)\s*#nc-conformite\s*\{[^}]*display:\s*none/, 'signed-in, the gate folds and the block with it');
  // It takes the content column under the demands at every two-column width.
  assert.match(css, /#nc-conformite\s*\{[^}]*grid-area:\s*conformite/, 'the band is placed by the pane grid');
  for (const areas of css.match(/grid-template-areas:[^;]*;/g) || []) {
    if (/\bconsole\b/.test(areas) && /\blive\b/.test(areas)) {
      assert.match(areas, /\bconformite\b/, 'every notary-landing layout places the band: ' + areas);
    }
  }
  for (const b of blocks('.nc-conformite-tile')) {
    assert.ok(!/(?:background|color|border)[^;}]*(?:#[0-9a-fA-F]{3}|rgb\(|hsl\()/.test(b), 'tiles paint tokens only: ' + b);
  }
});

test('backdrop: the gate floats on theme tokens — no hardcoded paint breaks the palette', () => {
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

test('arrival chooser stays visually quiet: no second field of moving cubes', () => {
  assert.equal(doc.querySelector('#intro-gate #ig-bg'), null, 'the onboarding gate has no distracting cube layer');
});

test('arrival backdrop stays simple with no decorative section layer', () => {
  assert.equal(doc.querySelector('#intro-gate .ig-depth'), null, 'the onboarding gate has no decorative depth layer');
  assert.doesNotMatch(css, /\.ig-depth(?:[-\s\.#:{]|$)/, 'the stylesheet has no decorative depth rules');
});
