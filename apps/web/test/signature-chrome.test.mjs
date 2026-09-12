/**
 * The Signature door wears the same brand as the Carnet.
 *
 * signature.html loads ONE stylesheet — its own — so nothing it shows
 * inherits from styles.css and every divergence is shipped. The owner,
 * 2026-09-12: « Carnet est vraiment ce que Nota, le brand, doit dégager…
 * s'assurer que l'espace notaire, partenaire, signature » le suivent.
 *
 * These are the divergences a reader MEETS, pinned here so the fork cannot
 * quietly widen again:
 *   • the theme — the page hard-stamped data-theme="dark", so a light visitor
 *     crossed from a light Carnet into a dark room, and got a dark flash on
 *     every load because nothing ran before first paint;
 *   • the language — the FR|EN button was wired to children that do not exist
 *     in the markup, so clicking it did nothing at all;
 *   • the body rung and the subtitle ink — 14px where the house reads 16, and
 *     --ink where the house eyebrow reads --subtitle-ink (ADR 0050 / the
 *     subtitle register).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f) => readFileSync(fileURLToPath(new URL('../public/' + f, import.meta.url)), 'utf8');
const HTML = read('signature.html');
const CSS = read('signature.css');
const JS = read('signature.js');
const INDEX = read('index.html');

test('the room opens in the viewer’s own theme, before first paint', () => {
  const openingTag = HTML.slice(0, HTML.indexOf('>', HTML.indexOf('<html')) + 1);
  assert.doesNotMatch(
    openingTag, /data-theme/,
    'a hard-stamped theme ignores the viewer: ' + openingTag,
  );
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  // A FILE, not an inline script: this room's CSP takes script from 'self'
  // only, and signature-room.test.mjs pins that no inline script survives.
  assert.match(head, /<script src="theme-boot\.js"><\/script>/, 'the head loads the boot file');
  assert.ok(
    head.indexOf('theme-boot.js') < head.indexOf('<link rel="stylesheet"'),
    'the theme must be settled BEFORE the stylesheet paints, or the page flashes',
  );
  const boot = read('theme-boot.js');
  assert.match(boot, /nota\.theme/, 'the saved choice is read first, like index.html');
  assert.match(boot, /prefers-color-scheme/, 'and the system preference decides when there is no saved choice');
  // index.html's own first-paint script is the shape being matched.
  assert.match(INDEX.slice(0, INDEX.indexOf('</head>')), /nota\.theme/);
});

test('a live change of the system theme repaints the room', () => {
  assert.match(
    JS, /matchMedia\('\(prefers-color-scheme: dark\)'\)/,
    'the room must listen for the system theme while it is open',
  );
});

test('the FR|EN control is wired to something that exists', () => {
  for (const lang of ['fr', 'en']) {
    assert.match(
      HTML, new RegExp('data-set-lang="' + lang + '"'),
      `the markup carries no data-set-lang="${lang}" — signature.js binds those children, and an empty NodeList binds nothing`,
    );
  }
  assert.match(JS, /data-set-lang/, 'the wiring still reads the attribute the markup carries');
});

test('the room reads on the house body rung and the subtitle register', () => {
  const body = /(^|\})\s*body\s*\{([^}]*)\}/m.exec(CSS);
  assert.ok(body, 'signature.css has a body rule');
  assert.match(body[2], /font-size:\s*var\(--type-body\)/, 'body font-size: ' + body[2].slice(0, 120));
  assert.match(body[2], /line-height:\s*var\(--type-body-lh\)/, 'body line-height: ' + body[2].slice(0, 120));

  const eyebrow = /\.eyebrow\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(eyebrow, 'signature.css has an .eyebrow rule');
  assert.match(eyebrow[1], /color:\s*var\(--subtitle-ink\)/, '.eyebrow colour: ' + eyebrow[1].slice(0, 120));
  assert.match(CSS, /--subtitle-ink:/, 'and the token it names is defined here');
});

test('no round surface bigger than a dot', () => {
  // The square-corner register: only a dot (≤8px) may be round.
  const circles = [...CSS.matchAll(/([^{}]+)\{([^}]*border-radius:\s*50%[^}]*)\}/g)]
    .map(([, sel]) => sel.trim().replace(/\s+/g, ' '))
    .filter((sel) => !/dot|:before|::before|:after|::after/.test(sel));
  assert.deepEqual(circles, [], 'round surfaces left in signature.css: ' + circles.join(' | '));
});
