// Rasterize the deck's SVG frames in a headless Chromium that loads Sora and
// Inter FROM THE REPOSITORY — the very woff2 the site serves under
// apps/web/public/fonts (ADR 0050). ImageMagick draws a silent fallback face
// when a family is missing; a browser can be asked whether the face is loaded,
// and this script refuses to write a frame until it is.
//
// The faces used to come from fonts.googleapis.com. Nothing about that was
// private — this runs at build time, not in front of a visitor — but it made the
// deck's own slides unreproducible offline and left them depending on whichever
// cut Google served that day, while the same bytes sat in the tree. Reading the
// repository's files makes the frames byte-reproducible and keeps the slides on
// exactly the faces the product ships.
//
//   python3 docs/pitch-deck/render-slides.py --svg-out /tmp/slides
//   node docs/pitch-deck/rasterize-slides.mjs /tmp/slides
//
// Writes docs/pitch-deck/dark-slide-N.png and dark-slide-fr-N.png (N = 1…16),
// 1600×900 at 1×, the geometry the deck page expects (the same frame the
// ImageMagick path of render-slides.py writes).
//
// The QUÉBEC badge of the lockup is the one element the SVG cannot size itself:
// render-slides.py estimates the text width, and this script re-measures it
// with the real Inter 800 glyphs and fits the ground (padding .55em .7em) to it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error('usage: node rasterize-slides.mjs <dir with the SVG frames>'); process.exit(2); }
const frames = readdirSync(src).filter((f) => /^dark-slide-(fr-)?\d+\.svg$/.test(f)).sort();
if (frames.length !== 32) { console.error(`expected 32 frames in ${src}, found ${frames.length}`); process.exit(2); }

// Les quatre tranches variables servies par Nota, embarquées en base64 : une
// page `setContent` n'a pas d'origine, donc une URL file:// y serait refusée.
const FONT_DIR = join(here, '..', '..', 'apps', 'web', 'public', 'fonts');
const face = (famille, fichier) => {
  const octets = readFileSync(join(FONT_DIR, fichier)).toString('base64');
  return `@font-face{font-family:'${famille}';font-style:normal;font-weight:100 900;font-display:block;`
    + `src:url(data:font/woff2;base64,${octets}) format('woff2')}`;
};
const FONT_CSS = [
  face('Inter', 'inter-latin.woff2'), face('Inter', 'inter-latin-ext.woff2'),
  face('Sora', 'sora-latin.woff2'), face('Sora', 'sora-latin-ext.woff2'),
].join('');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
let written = 0;
for (const f of frames) {
  const svg = readFileSync(join(src, f), 'utf8');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}html,body{margin:0;background:transparent}svg{display:block;width:1600px;height:900px}</style></head><body>${svg}</body></html>`, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(async () => {
    await document.fonts.load('800 40px Sora'); await document.fonts.load('700 40px Sora');
    await document.fonts.load('400 20px Inter'); await document.fonts.load('700 20px Inter');
    await document.fonts.ready;
    return document.fonts.check('800 40px Sora') && document.fonts.check('700 20px Inter');
  });
  if (!ok) { console.error(`${f}: Sora/Inter did not load — no frame written`); process.exit(1); }
  await page.evaluate(() => {
    for (const badge of document.querySelectorAll('g[data-badge]')) {
      const text = badge.querySelector('text'); const ground = badge.querySelector('rect');
      const size = parseFloat(text.getAttribute('font-size'));
      const padX = .7 * size;
      const box = text.getBBox();
      ground.setAttribute('width', (box.width + 2 * padX).toFixed(2));
    }
  });
  const out = join(here, basename(f, '.svg') + '.png');
  await page.locator('svg').screenshot({ path: out, omitBackground: false });
  written++;
}
await browser.close();
console.log(`wrote ${written} frames to ${here}`);
