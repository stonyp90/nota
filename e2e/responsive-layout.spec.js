'use strict';

/**
 * responsive-layout.spec — the public surfaces hold their shape at every size.
 *
 * Written after the 2026-09-03 report (« le UI UX semble brisé ») : ADR 0033's
 * compliance block had landed INSIDE the notary gate card, the right rail grew
 * ~400px taller than the demand grid beside it, and the content column opened a
 * 586px hole on every desktop. Nothing failed — no test looked at the page's
 * shape, only at its markup.
 *
 * These are the shape assertions, at the seven sizes the product actually meets
 * (a 320px phone through a 1920px desktop):
 *   • no page scrolls sideways;
 *   • a demand tile never truncates the act's name and never lets the amount
 *     collide with its tier pill (the tile re-flows by container query instead);
 *   • the notary landing's compliance band spans BOTH columns and closes them —
 *     it is the guard against putting it back in the rail;
 *   • the two-column landing only exists where the content column can hold more
 *     than one tile per row.
 *
 * Deliberately NOT pixel-perfect: fixtures are randomized per server boot, so a
 * sparse month legitimately leaves a ragged column bottom. The bounds here are
 * the ones that separate "a column ended" from "the page broke".
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

// The sizes the product meets: two phones (the 320px floor still shipping on
// an iPhone SE 1st gen, and a modern 390px phone), a tablet in each
// orientation, a laptop, and two desktops.
const VIEWPORTS = [
  { name: 'phone 320', width: 320, height: 568 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'tablet portrait 768', width: 768, height: 1024 },
  { name: 'tablet landscape 1024', width: 1024, height: 800 },
  { name: 'laptop 1280', width: 1280, height: 800 },
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'desktop 1920', width: 1920, height: 1080 },
];

// The public doors, by the tab that opens each.
const PANES = [
  { tab: 'carnet', pane: '#pane-carnet' },
  { tab: 'notaires', pane: '#pane-notaires' },
  { tab: 'partenaires', pane: '#pane-partenaires' },
];

/**
 * Layout assertions read geometry, so they must not race the page's own motion:
 * a fallback font face is wider than the real one, and the hero's `cardPop`
 * entrance overshoots past scale(1) — a box measured mid-flight sticks out past
 * an edge it never reaches at rest. Wait for the fonts and for every finite
 * animation to finish (the ambient, infinite ones are skipped), capped so a
 * held animation slows a test instead of hanging it.
 */
async function settled(page) {
  await page.evaluate(async () => {
    if (document.fonts) { try { await document.fonts.ready; } catch (e) { /* no font API */ } }
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect && a.effect.getComputedTiming();
      return t && t.iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  });
}

/**
 * Open a door the way the size in front of us offers it: the header tab strip
 * on a wide screen, the burger drawer on a phone (the header trims itself, so
 * #tab-notaires is simply not there under the tablet band).
 */
async function openPane(page, tab, pane) {
  const headerTab = page.locator(`#tab-${tab}`);
  if (await headerTab.isVisible().catch(() => false)) {
    await headerTab.click();
  } else {
    await page.locator('#nav-burger').click();
    const link = page.locator(`.mnav-link[data-tab="${tab}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('#mobile-nav')).not.toBeVisible();
  }
  await expect(page.locator(pane)).toBeVisible();
  await settled(page);
}

/** Box of one element in PAGE coordinates, or null when it is not rendered. */
async function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left, right: r.right, width: r.width, height: r.height };
  }, selector);
}

test.describe('responsive layout', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: no page scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoHome(page, { suppressOnboarding: true });
    await settled(page);
      await settled(page);
      for (const { tab, pane } of PANES) {
        await openPane(page, tab, pane);
        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          const vw = de.clientWidth;
          const offenders = [];
          // Clipped subtrees do not count: the dice field behind the page is a
          // deliberate overflow inside an `overflow: hidden` box, and it moves
          // nothing. Only what can actually widen the page is an offender.
          const clipped = (el) => {
            for (let a = el.parentElement; a && a !== de; a = a.parentElement) {
              const o = getComputedStyle(a);
              if (o.overflowX !== 'visible' || o.overflow !== 'visible') return true;
            }
            return false;
          };
          document.querySelectorAll('body *').forEach((el) => {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' || cs.visibility === 'hidden') return;
            const r = el.getBoundingClientRect();
            if (r.width < 24 || r.height < 8) return;
            if (r.right <= vw + 1.5) return;
            const p = el.parentElement && el.parentElement.getBoundingClientRect();
            if (p && p.right > vw + 1.5) return;   // report the outermost only
            if (clipped(el)) return;
            offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
          });
          return { scrollW: de.scrollWidth, clientW: vw, offenders: offenders.slice(0, 5) };
        });
        expect(overflow.offenders, `${pane} has nothing past the right edge`).toEqual([]);
        expect(overflow.scrollW, `${pane} does not scroll sideways`).toBeLessThanOrEqual(overflow.clientW + 1);
      }
    });

    test(`${vp.name}: a demand tile keeps its act name and never stacks money under its tier`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoHome(page, { suppressOnboarding: true });
    await settled(page);
      await settled(page);
      await openPane(page, 'notaires', '#pane-notaires');
      const teaser = page.locator('#notary-live-grid .nc-live-card').first();
      await expect(teaser).toBeVisible();

      const tiles = await page.evaluate(() => {
        return [...document.querySelectorAll('.nc-live-card:not(.nc-live-more)')].map((card) => {
          const name = card.querySelector('.nc-live-svc-name');
          const amt = card.querySelector('.nc-live-amt');
          const pill = card.querySelector('.pill');
          const a = amt.getBoundingClientRect();
          const p = pill.getBoundingClientRect();
          const sameLine = Math.abs(a.top - p.top) < 10;
          return {
            text: name.textContent,
            truncated: name.scrollWidth > name.clientWidth + 1,
            collides: sameLine && a.right > p.left + 0.5,
            width: Math.round(card.getBoundingClientRect().width),
          };
        });
      });
      expect(tiles.length, 'the landing teases the open month').toBeGreaterThan(0);
      expect(tiles.filter((t) => t.truncated).map((t) => t.text),
        'the act is the tile: « Refinancement » must never read « Refin… »').toEqual([]);
      expect(tiles.filter((t) => t.collides).map((t) => t.width),
        'the amount never runs under its tier pill — the tile drops the pill to its own line instead').toEqual([]);
    });
  }

  test('the compliance band spans both columns and closes them (never back inside the gate)', async ({ page }) => {
    // Its home is the pane, not the console: inside the gate card it made the
    // rail ~400px taller than the demand grid and opened the 586px hole.
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHome(page, { suppressOnboarding: true });
    await settled(page);
    await openPane(page, 'notaires', '#pane-notaires');

    expect(await page.locator('#notary-console #nc-conformite').count(),
      'the band is a child of the pane, never of the gate card').toBe(0);

    const band = await boxOf(page, '#nc-conformite');
    const live = await boxOf(page, '#notary-live');
    const rail = await boxOf(page, '#notary-console');
    const agenda = await boxOf(page, '#notary-carnet');
    expect(band && live && rail, 'the landing shows demands, a gate and the band').toBeTruthy();

    // Full width: wider than the demand grid alone, and reaching the rail's edge.
    expect(band.width, 'the band runs across both columns').toBeGreaterThan(live.width + 100);
    expect(band.right).toBeGreaterThanOrEqual(rail.right - 2);

    // And it CLOSES them: below both, with no dead band before it.
    const columnsEnd = Math.max(live.bottom, rail.bottom, agenda ? agenda.bottom : 0);
    expect(band.top, 'the band sits under both columns').toBeGreaterThanOrEqual(columnsEnd - 1);
    expect(band.top - columnsEnd, 'no dead band between the columns and the compliance strip').toBeLessThan(48);
  });

  test('two columns only where the content column holds more than one tile per row', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });
    await settled(page);

    // A tablet in portrait: one centred column — gate under the demands.
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPane(page, 'notaires', '#pane-notaires');
    let live = await boxOf(page, '#notary-live');
    let rail = await boxOf(page, '#notary-console');
    expect(rail.top, 'stacked: the gate follows the demands').toBeGreaterThan(live.bottom - 1);

    // A desktop: two columns — the gate opens level with the first row of tiles.
    await page.setViewportSize({ width: 1440, height: 900 });
    await settled(page);
    live = await boxOf(page, '#notary-live');
    rail = await boxOf(page, '#notary-console');
    expect(Math.abs(rail.top - live.top), 'side by side: the gate seats on the tiles’ own top line').toBeLessThan(4);
    expect(rail.left, 'the gate is the right-hand rail').toBeGreaterThan(live.right - 1);

    // Read the grid's own used track list, not the tiles' measured tops: a
    // hovered tile lifts 2px and would otherwise read as a row of its own.
    // auto-fit collapses the tracks a sparse month leaves empty, so the
    // non-zero tracks are exactly the columns actually in use.
    const { tiles, columns } = await page.evaluate(() => {
      const grid = document.querySelector('#notary-live-grid');
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter((t) => parseFloat(t) > 0);
      return { tiles: grid.querySelectorAll('.nc-live-card').length, columns: tracks.length };
    });
    // Fixtures are randomized per server boot: a month can legitimately open
    // with a single demand, and one tile cannot fill a row.
    if (tiles > 1) {
      expect(columns, 'a two-column landing never files the tiles one under the other').toBeGreaterThan(1);
    }
  });
});
