/**
 * Rasterize the four PNG icons from ONE drawing: apps/web/public/favicon.svg.
 *
 * ADR 0048 draws the mark once and every other copy is a `<use>`. The rasters
 * were the exception: nothing regenerated them and no guard read them, so on
 * 2026-09-12 the three PWA icons were found still carrying the drawing retired
 * the day before — the round signal dot, the rx 12 tile, the rounded N stems.
 * They were re-rendered by hand, which fixes the files and not the hole. This
 * script is the hole: one command, no hand-placed geometry, and a guard
 * (apps/web/test/icones-marque.test.mjs) that probes the pixels back against
 * the SVG's own numbers.
 *
 *   node apps/web/scripts/render-icons.mjs
 *
 * Writes, all from favicon.svg:
 *   icon-192.png            192  the PWA icon, `purpose: any`
 *   icon-512.png            512  the same, large
 *   apple-touch-icon.png    180  FLATTENED on the tile colour — iOS paints its
 *                                own black behind transparent corners
 *   icon-maskable-512.png   512  `purpose: maskable` (see below)
 *
 * WHY A SEPARATE MASKABLE FILE. Android does not draw the icon you give it: it
 * crops it to the launcher's own shape and guarantees only the central 80 % —
 * a circle of radius .4 × the side. Measured on this drawing, the outer corner
 * of the signal square sits at 33.94 tile units from the centre, which is 271 px
 * at 512 against a safe radius of 204.8. Both manifests declared `icon-512.png`
 * as the maskable icon, so **the signal — the one detail the brand is built
 * around — was being clipped on every Android home screen.**
 *
 * The maskable variant therefore: (1) fills the canvas edge to edge with the
 * tile colour and drops the tile's corner radius, because the launcher supplies
 * the silhouette; (2) centres the drawing's own content box and scales it until
 * its half-diagonal fits the safe circle. Both numbers are computed below from
 * the SVG, never typed in, so the file follows the drawing wherever it goes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const SOURCE = join(PUBLIC, 'favicon.svg');

const svg = readFileSync(SOURCE, 'utf8');

/** The one literal this script needs from the drawing: the tile's fill. */
const tile = svg.match(/<rect width="64" height="64"[^>]*fill="(#[0-9a-fA-F]{6})"/);
if (!tile) throw new Error('favicon.svg: the 64×64 tile rect is not where it was — read it before rendering');
const TILE_COLOUR = tile[1];

/** The side of the viewBox, so nothing downstream assumes 64. */
const view = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
if (!view || view[1] !== view[2]) throw new Error('favicon.svg: expected a square viewBox starting at 0 0');
const SIDE = parseFloat(view[1]);

/**
 * The box the INK occupies, read from the drawing rather than assumed: every
 * <rect> and every <polygon> point, minus the tile itself (which is the ground,
 * not the content). The signal's stroke is the tile colour, so it is the notch
 * that cuts the tile and not a visible edge — it is deliberately not counted.
 */
function contentBox(src) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const see = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const m of src.matchAll(/<rect([^>]*)\/>/g)) {
    const at = (n) => { const v = m[1].match(new RegExp(n + '="(-?[\\d.]+)"')); return v ? parseFloat(v[1]) : 0; };
    const w = at('width'), h = at('height');
    if (w === SIDE && h === SIDE) continue; // the ground
    see(at('x'), at('y')); see(at('x') + w, at('y') + h);
  }
  for (const m of src.matchAll(/points="([^"]+)"/g)) {
    for (const pair of m[1].trim().split(/\s+/)) { const [x, y] = pair.split(',').map(Number); see(x, y); }
  }
  if (!Number.isFinite(x0)) throw new Error('favicon.svg: no ink found — the drawing changed shape');
  return { x0, y0, x1, y1 };
}

const box = contentBox(svg);
const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
const halfDiagonal = Math.hypot((box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2);
const SAFE_RADIUS = SIDE * 0.4; // Android's guaranteed area: a circle of 80 % of the side
const FIT = Math.min(1, SAFE_RADIUS / halfDiagonal);

/** The maskable drawing: the same ink, on a full-bleed ground, inside the safe circle. */
function maskableSvg(src) {
  const ink = src
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<rect width="64" height="64"[^>]*\/>/, '') // the launcher draws the tile shape
    .replace(/[ \t]+$/gm, '');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SIDE + ' ' + SIDE + '" role="img" aria-label="Nota">'
    + '<rect width="' + SIDE + '" height="' + SIDE + '" fill="' + TILE_COLOUR + '"/>'
    + '<g transform="translate(' + (SIDE / 2) + ',' + (SIDE / 2) + ') scale(' + FIT.toFixed(6) + ') translate(' + (-cx) + ',' + (-cy) + ')">'
    + ink + '</g></svg>';
}

const FRAMES = [
  { file: 'icon-192.png', size: 192, svg, ground: null },
  { file: 'icon-512.png', size: 512, svg, ground: null },
  // iOS composites its own black behind a transparent corner, so this one is flat.
  { file: 'apple-touch-icon.png', size: 180, svg, ground: TILE_COLOUR },
  { file: 'icon-maskable-512.png', size: 512, svg: maskableSvg(svg), ground: TILE_COLOUR },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
for (const f of FRAMES) {
  await page.setContent(
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:'
    + (f.ground || 'transparent') + '}svg{display:block;width:' + f.size + 'px;height:' + f.size + 'px}</style>'
    + '</head><body>' + f.svg + '</body></html>');
  await page.locator('svg').screenshot({ path: join(PUBLIC, f.file), omitBackground: !f.ground });
}
await browser.close();

writeFileSync(join(PUBLIC, 'icon-maskable-512.svg'), maskableSvg(svg) + '\n');
console.log('rendered from ' + SOURCE);
console.log('  content box  x ' + box.x0 + '–' + box.x1 + '  y ' + box.y0 + '–' + box.y1);
console.log('  safe circle  r ' + SAFE_RADIUS + '   content half-diagonal ' + halfDiagonal.toFixed(2) + '   fit ×' + FIT.toFixed(4));
for (const f of FRAMES) console.log('  ' + f.file + '  ' + f.size + 'px' + (f.ground ? '  on ' + f.ground : '  transparent corners'));
