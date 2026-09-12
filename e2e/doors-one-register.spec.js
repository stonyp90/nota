'use strict';

/**
 * doors-one-register — the four doors open on ONE surface.
 *
 * The owner, 2026-09-12, looking at Partenaires beside Carnet: « Carnet est
 * vraiment ce que Nota, le brand, doit dégager. S'assurer que l'espace
 * notaire, partenaire, signature… Je vois plusieurs discrepancies. »
 *
 * What had drifted, measured: the Partenaires hero was a boxed panel with side
 * padding that pushed its headline 16–24px off the Carnet's left edge at every
 * width, its h1 was mid-blue where Carnet's is near-white, and the Espace
 * notaire hero carried a filled brand box with inverted ink. Each of those is
 * a LATER layer overriding rules whose own comments record the owner's asks.
 *
 * So the contract here is comparative, not absolute: whatever the Carnet does,
 * the other doors do. A change to the reference moves them all together.
 */
const { test, expect } = require('@playwright/test');

const DOORS = [
  { key: 'espace notaire', tab: 'notaires', pane: '#pane-notaires' },
  { key: 'partenaires', tab: 'partenaires', pane: '#pane-partenaires' },
  { key: 'signature bêta', tab: 'beta', pane: '#pane-beta' },
];
const WIDTHS = [390, 768, 1280];
const THEMES = ['light', 'dark'];

async function open(page, { width, theme, tab }) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('nota.introSeen', '1');
      localStorage.setItem('nota.onboarded.v1', '1');
      localStorage.setItem('nota.theme', JSON.stringify(t));
      // Signed in, because « Signature » is one of the doors compared here and
      // it needs an account since 2026-09-12 (portes-authentifiees.test.mjs).
      localStorage.setItem('nota.profile.v1', JSON.stringify({ courriel: 'client@exemple.test', nom: 'Client' }));
    } catch (e) { /* storage blocked */ }
  }, theme);
  await page.goto(tab ? `/?lang=fr#t=${tab}` : '/?lang=fr');
  await page.locator(tab ? `#pane-${tab}` : '#pane-carnet').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    if (document.fonts) { try { await document.fonts.ready; } catch (e) { /* no font API */ } }
    await new Promise((r) => setTimeout(r, 250));
  });
}

/** The reading a visitor gets: the headline's ink, face and left edge. */
const readDoor = (page, paneSel) => page.evaluate((sel) => {
  const pane = document.querySelector(sel);
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const h1 = [...pane.querySelectorAll('h1')].find(vis);
  const eyebrow = [...pane.querySelectorAll('.eyebrow, .pr-kicker, .beta-eyebrow')].find(vis);
  const box = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      face: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      size: Math.round(parseFloat(cs.fontSize)),
      left: Math.round(el.getBoundingClientRect().left),
    };
  };
  return { h1: box(h1), eyebrow: eyebrow ? { color: getComputedStyle(eyebrow).color } : null };
}, paneSel);

test.describe('the doors open on one register', () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`${theme} ${width}: every door wears the Carnet's headline`, async ({ page }) => {
        await open(page, { width, theme });
        const carnet = await readDoor(page, '#pane-carnet');
        expect(carnet.h1, 'the Carnet is the reference and must be on screen').not.toBeNull();

        for (const door of DOORS) {
          await open(page, { width, theme, tab: door.tab });
          const got = await readDoor(page, door.pane);
          expect(got.h1, `${door.key} has a headline`).not.toBeNull();
          expect(got.h1.color, `${door.key} headline ink (Carnet: ${carnet.h1.color})`).toBe(carnet.h1.color);
          expect(got.h1.face, `${door.key} headline face`).toBe(carnet.h1.face);
          // The left edge is the page's gutter: a door that boxes its hero
          // pushes the headline inward and the four doors stop lining up.
          expect(Math.abs(got.h1.left - carnet.h1.left), `${door.key} headline starts at ${got.h1.left}, Carnet at ${carnet.h1.left}`)
            .toBeLessThanOrEqual(1);
          if (got.eyebrow && carnet.eyebrow) {
            expect(got.eyebrow.color, `${door.key} kicker ink (Carnet: ${carnet.eyebrow.color})`).toBe(carnet.eyebrow.color);
          }
        }
      });
    }
  }
});
