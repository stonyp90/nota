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
const domain = require('@nota/domain');

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
      await page.locator('#notary-calendar-explore > summary').click();
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

  test('professional obligations expand below the calendar and access', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHome(page, { suppressOnboarding: true });
    await openPane(page, 'notaires', '#pane-notaires');
    await expect(page.locator('#nc-conformite')).not.toBeVisible();
    await page.locator('#notary-calendar-obligations > summary').click();
    const band = await boxOf(page, '#nc-conformite');
    const calendar = await boxOf(page, '#notary-carnet');
    expect(band.top).toBeGreaterThan(calendar.bottom);
    expect(band.width).toBeGreaterThan(0);
  });

  test('tablet and desktop keep subscription before optional access', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });
    await openPane(page, 'notaires', '#pane-notaires');
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const calendar = await boxOf(page, '#notary-carnet');
      const access = await boxOf(page, '#notary-console');
      expect(access.top).toBeGreaterThanOrEqual(calendar.bottom);
      await expect(page.locator('#nc-email')).not.toBeVisible();
    }
  });

  test('opening notary access leaves calendar choices above the form', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });
    await openPane(page, 'notaires', '#pane-notaires');
    await page.locator('#notary-calendar-access > summary').click();
    await expect(page.locator('#nc-email')).toBeVisible();
    const calendar = await boxOf(page, '#notary-carnet');
    const form = await boxOf(page, '#notary-auth-form');
    expect(form.top).toBeGreaterThan(calendar.bottom);
  });
});

// Inventory count must keep the landing aligned without reserving a tall wall
// of empty cells. Exercise actual successful API responses, including empty,
// rather than offline demos.
test.describe('notary inventory keeps its footprint', () => {
  for (const vp of VIEWPORTS) {
    for (const lang of ['fr', 'en']) {
      test(`${vp.name}, ${lang}: zero, one and partial inventory keep the grid aligned`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.addInitScript(() => {
          localStorage.setItem('nota.introSeen', '1');
          localStorage.setItem('nota.onboarded.v1', '1');
        });
        const seed = domain.makeFixtures(domain.businessDay()).filter((b) => b.status !== domain.STATUS.RETENUE);
        const targetMonth = domain.businessDay().slice(0, 7);
        let count = 12;
        await page.route('**/bids?*', async (route) => {
          const month = new URL(route.request().url()).searchParams.get('month');
          const bids = month === targetMonth ? Array.from({ length: count }, (_, i) => ({
            ...seed[i % seed.length], id: 'layout-' + i,
            // Keep every synthetic bid in the requested month so each count
            // really exercises the twelve-slot grid, including February.
            dateISO: `${month}-${String(i + 1).padStart(2, '0')}`,
          })) : [];
          await route.fulfill({ json: { bids: bids.filter((b) => b.dateISO.startsWith(month)) }, headers: { 'access-control-allow-origin': '*' } });
        });
        for (count of [12, 0, 1, 5, 13]) {
          if (count === 12) await page.goto(`/?lang=${lang}#t=notaires`);
          else await page.reload();
          await expect(page.locator('#sub-google')).toBeVisible();
          await expect(page.locator('#nc-email')).not.toBeVisible();
          await page.locator('#notary-calendar-explore > summary').click();
          await page.locator('#notary-calendar-obligations > summary').click();
          await expect(page.locator('#notary-live')).toBeVisible();
          await expect(page.locator('#notary-live-grid .nc-live-card')).toHaveCount(Math.min(count, 12));
          // At zero the footprint shrinks to NC_LIVE_EMPTY_SLOTS: the next-step
          // band under the grid carries the page, so the grid stops reserving
          // room for inventory that is not there.
          const floor = count ? 6 : 3;
          await expect(page.locator('#notary-live-grid .nc-live-slot')).toHaveCount(Math.max(0, floor - Math.min(count, 12)));
          await settled(page);
          const geometry = { hero: await boxOf(page, '#pane-notaires .intro--hero') };
          for (const id of ['notary-live-grid', 'notary-console', 'notary-carnet', 'nc-conformite']) {
            geometry[id] = await boxOf(page, '#' + id);
          }
          expect(geometry['notary-carnet'].top, `${count} offers: calendar follows the hero`).toBeGreaterThanOrEqual(geometry.hero.bottom - 1);
          expect(geometry['notary-live-grid'].top, `${count} offers: optional inventory follows subscription`).toBeGreaterThanOrEqual(geometry['notary-carnet'].bottom - 1);
          expect(geometry['notary-console'].top, `${count} offers: optional access follows subscription`).toBeGreaterThanOrEqual(geometry['notary-carnet'].bottom - 1);
          expect(geometry['nc-conformite'].top, `${count} offers: obligations stay secondary`).toBeGreaterThanOrEqual(geometry['notary-console'].bottom - 1);
          if (count === 0) {
            const empty = page.locator('.nc-live-empty');
            await expect(empty.locator('strong')).toHaveText(lang === 'fr' ? 'Aucune demande ouverte' : 'No open request');
            const rect = await boxOf(page, '.nc-live-empty');
            expect(rect.height).toBe(geometry['notary-live-grid'].height);
            expect(rect.width).toBe(geometry['notary-live-grid'].width);
          } else {
            await expect(page.locator('.nc-live-empty')).toHaveCount(0);
            if (count < 12) {
              await expect(page.locator('.nc-live-slot').first()).toHaveText(lang === 'fr' ? 'Pas d’offre' : 'No offer');
            }
          }
          const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
          expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
        }
      });
    }
  }
});

// The partners pane has a denser story than the other public doors: a reward
// hero, audience chips, an estimator, a timeline and a claim form. Keep its
// own geometry contract explicit at every supported width so a translation or
// a new partner type cannot create a blank rail or a clipped action.
test.describe('partners pane at every supported resolution', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the two amounts and the claim form keep one readable flow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoHome(page, { suppressOnboarding: true });
      await openPane(page, 'partenaires', '#pane-partenaires');

      const geometry = await page.evaluate(() => {
        const rect = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const hero = rect('.pr-hero');
        const copy = rect('.pr-hero-copy');
        const rewards = rect('.pr-rewards');
        const earned = rect('.pr-earned');
        const headingRange = document.createRange();
        headingRange.selectNodeContents(document.querySelector('.pr-hero h1'));
        const headingRight = headingRange.getBoundingClientRect().right;
        const cards = [...document.querySelectorAll('.pr-card')].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width };
        });
        const chips = [...document.querySelectorAll('#partner-type .chip')].map((el) => {
          const r = el.getBoundingClientRect();
          return { right: r.right, width: r.width, height: r.height };
        });
        return {
          viewport: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth },
          hero, copy, rewards, earned, headingRight, cards, chips,
          grid: rect('.pr-grid'), form: rect('.pr-form-panel'), note: rect('.pr-grid .note'),
          submit: rect('#partner-submit'),
        };
      });

      expect(geometry.viewport.scrollWidth, 'partners never scrolls sideways').toBeLessThanOrEqual(geometry.viewport.width + 1);
      expect(geometry.cards.length).toBe(2);
      expect(geometry.cards.every((c) => c.width > 0 && c.right <= geometry.hero.right + 1), 'reward cards stay inside the hero').toBe(true);
      expect(geometry.chips.every((c) => c.width > 0 && c.right <= geometry.form.right + 1), 'the profession chips stay inside the form').toBe(true);
      expect(geometry.submit.width, 'the claim action remains visible').toBeGreaterThanOrEqual(160);
      expect(geometry.grid.top - geometry.hero.bottom, 'no empty band opens between the offer and the form').toBeLessThanOrEqual(48);
      expect(geometry.earned.top - geometry.rewards.bottom, 'the acquisition rule stays under its two amounts').toBeLessThanOrEqual(24);
      // Sous le héros il n'y a plus qu'une colonne : le formulaire, puis la
      // mention du prix du client — jamais côte à côte.
      expect(geometry.note.top, 'the fine print stacks under the form').toBeGreaterThanOrEqual(geometry.form.bottom - 1);
      expect(geometry.form.left).toBeCloseTo(geometry.note.left, 0);

      if (vp.width < 901) {
        expect(geometry.rewards.top).toBeGreaterThanOrEqual(geometry.copy.bottom - 1);
      } else {
        expect(geometry.copy.right).toBeLessThanOrEqual(geometry.rewards.left + 1);
        expect(geometry.rewards.left - geometry.headingRight, 'measure the gap from visible headline text, not an empty grid track').toBeLessThanOrEqual(140);
      }
    });
  }
});

// --- « Nous joindre » (2026-09-04 redesign) ------------------------------------
// The contact dialog is the one popup a stranger meets first. At every size:
// no sideways scroll with it open, the dialog stays inside the viewport, the
// Envoyer button can be reached, and nom + courriel share a row only where
// the dialog column can hold two fields.
test.describe('the legacy email contact dialog at every size', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: « Nous joindre » fits, never scrolls sideways, and its fields re-flow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoHome(page);
      await page.evaluate(() => window.Nota.contact.openEmail());
      const dlg = page.locator('#contact-dialog');
      await expect(dlg).toBeVisible();
      await settled(page);
      const m = await page.evaluate(() => {
        const d = document.getElementById('contact-dialog');
        const r = d.getBoundingClientRect();
        const nom = document.getElementById('ct-nom').getBoundingClientRect();
        const mail = document.getElementById('ct-courriel').getBoundingClientRect();
        document.getElementById('ct-submit').scrollIntoView({ block: 'nearest' });
        const btn = document.getElementById('ct-submit').getBoundingClientRect();
        return {
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          inner: window.innerWidth, innerH: window.innerHeight,
          sameRow: Math.abs(nom.top - mail.top) < 2,
          btnVisible: btn.top >= 0 && btn.bottom <= window.innerHeight && btn.width > 0,
        };
      });
      expect(m.sideways, 'no sideways scroll with the dialog open').toBe(false);
      expect(m.left, 'dialog inside the viewport (left)').toBeGreaterThanOrEqual(0);
      expect(m.right, 'dialog inside the viewport (right)').toBeLessThanOrEqual(m.inner + 1);
      expect(m.top, 'dialog inside the viewport (top)').toBeGreaterThanOrEqual(0);
      expect(m.bottom, 'dialog inside the viewport (bottom)').toBeLessThanOrEqual(m.innerH + 1);
      expect(m.btnVisible, 'Envoyer reachable').toBe(true);
      // Under 480px the dialog is a sheet whose column cannot hold two fields.
      expect(m.sameRow).toBe(vp.width >= 480);
    });
  }
});
