'use strict';

/**
 * french-fits — the chrome, measured in the language the product ships in.
 *
 * Every other layout spec here pins `?lang=en` (helpers.gotoHome does it so
 * text assertions read one dictionary), and Nota's first language is French,
 * whose labels are longer. On 2026-09-12 that gap was hiding a real defect:
 * the header's full control set needed 1002px in French while the drawer only
 * takes over below 900, so from 900 to 1001 the « S'inscrire » button — the
 * signup call to action — was painted past the right edge and clipped by
 * `overflow-x: clip`, with no sideways scroll to reveal it. English needed
 * exactly 900 and fit, so nothing failed.
 *
 * The same band cramps the hero's market strip: at 768 the amounts ran under
 * the book arrow beside them, and the strip's kicker ran into the month label.
 *
 * These assertions are about FIT, not pixels: nothing may need more width than
 * it has, in either language, at any size between the drawer threshold and a
 * roomy desktop.
 */
const { test, expect } = require('@playwright/test');

const LANGS = ['fr', 'en'];
// The band between the drawer threshold (900) and the roomy header (1100),
// plus the two sizes on each side of it.
const BAND = [900, 920, 940, 960, 980, 1000, 1024, 1060, 1099, 1100, 1280];

async function goto(page, lang, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nota.introSeen', '1');
      localStorage.setItem('nota.onboarded.v1', '1');
    } catch (e) { /* storage blocked */ }
  });
  await page.goto(`/?lang=${lang}`);
  await page.locator('#pulse-rows .pulse-row').first().waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    if (document.fonts) { try { await document.fonts.ready; } catch (e) { /* no font API */ } }
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect && a.effect.getComputedTiming();
      return t && t.iterations !== Infinity;
    });
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]);
  });
}

/** What the header needs versus what it has, plus its right-most control. */
const headerFit = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.site-header .wrap');
  const vis = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const parts = [...wrap.children].filter(vis).map((k) => ({
    name: k.id || k.className.split(' ')[0],
    w: Math.round(k.getBoundingClientRect().width),
  }));
  const auth = document.querySelector('#header-auth');
  const last = auth && vis(auth) ? [...auth.children].filter(vis).pop() : null;
  return {
    need: wrap.scrollWidth,
    have: Math.round(wrap.getBoundingClientRect().width),
    vw: document.documentElement.clientWidth,
    lastLabel: last ? last.textContent.trim() : null,
    lastRight: last ? Math.round(last.getBoundingClientRect().right) : null,
    parts,
  };
});

test.describe('the header fits the language it is written in', () => {
  for (const lang of LANGS) {
    for (const width of BAND) {
      test(`${lang} ${width}: every header control is on screen`, async ({ page }) => {
        await goto(page, lang, width);
        const fit = await headerFit(page);
        expect(
          fit.need,
          `header needs ${fit.need}px and has ${fit.have}px — ${fit.parts.map((p) => `${p.name}=${p.w}`).join(' ')}`,
        ).toBeLessThanOrEqual(fit.have + 1);
        if (fit.lastRight != null) {
          expect(
            fit.lastRight,
            `« ${fit.lastLabel} » ends at ${fit.lastRight} in a ${fit.vw}px viewport`,
          ).toBeLessThanOrEqual(fit.vw - 2);
        }
      });
    }
  }
});

test.describe('the header fits a thumb too', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const lang of LANGS) {
    for (const width of [900, 1024, 1099]) {
      test(`${lang} ${width} touch: every header control is on screen`, async ({ page }) => {
        await goto(page, lang, width);
        const fit = await headerFit(page);
        expect(fit.need, `header needs ${fit.need}px and has ${fit.have}px`).toBeLessThanOrEqual(fit.have + 1);
      });
    }
  }
});

test.describe('the market strip holds its shape', () => {
  // 768 is a tablet in portrait and the narrowest size that still shows the
  // hero's two columns — the strip's worst case.
  for (const width of [768, 834, 900, 1024, 1280]) {
    test(`fr ${width}: the amounts never run under the book arrow`, async ({ page }) => {
      await goto(page, 'fr', width);
      const rows = await page.evaluate(() => [...document.querySelectorAll('.pulse-item')].map((item) => {
        const figs = item.querySelector('.pulse-figs').getBoundingClientRect();
        const btn = item.querySelector('.mini-btn').getBoundingClientRect();
        const svc = item.querySelector('.pulse-svc').getBoundingClientRect();
        return {
          act: item.querySelector('.pulse-svc').textContent.trim(),
          figsRight: Math.round(figs.right),
          figsLeft: Math.round(figs.left),
          btnLeft: Math.round(btn.left),
          svcRight: Math.round(svc.right),
        };
      }));
      expect(rows.length).toBeGreaterThan(1);
      for (const r of rows) {
        expect(r.figsRight, `${r.act}: amounts end at ${r.figsRight}, the arrow starts at ${r.btnLeft}`)
          .toBeLessThanOrEqual(r.btnLeft);
        expect(r.figsLeft, `${r.act}: amounts start at ${r.figsLeft}, the act name ends at ${r.svcRight}`)
          .toBeGreaterThanOrEqual(r.svcRight);
      }
    });

    test(`fr ${width}: the strip's kicker and its month stay apart`, async ({ page }) => {
      await goto(page, 'fr', width);
      const head = await page.evaluate(() => {
        const k = document.querySelector('.pulse-head .hero-steps-title') || document.querySelector('.pulse-head > *');
        const m = document.querySelector('#pulse-month');
        const a = k.getBoundingClientRect(), b = m.getBoundingClientRect();
        return {
          kicker: k.textContent.trim(), month: m.textContent.trim(),
          kRight: Math.round(a.right), mLeft: Math.round(b.left),
          sameLine: Math.abs(a.top - b.top) < 6,
        };
      });
      if (head.sameLine) {
        expect(head.kRight, `« ${head.kicker} » ends at ${head.kRight}, « ${head.month} » starts at ${head.mLeft}`)
          .toBeLessThanOrEqual(head.mLeft);
      }
    });
  }
});

test.describe('the phone’s door to the guide is a thumb target', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('fr 390: « Comment ça marche » is 44px on a coarse pointer', async ({ page }) => {
    await goto(page, 'fr', 390, 844);
    const box = await page.evaluate(() => {
      const el = document.querySelector('#footer-guide');
      if (!el) return null;
      el.scrollIntoView();
      const r = el.getBoundingClientRect();
      const ext = getComputedStyle(el, '::before');
      const grow = ext.content !== 'none' && ext.position === 'absolute' && /^-?\d/.test(ext.inset)
        ? Math.abs(parseFloat(ext.inset)) * 2 : 0;
      return { w: Math.round(r.width + grow), h: Math.round(r.height + grow), label: el.textContent.trim() };
    });
    expect(box, '#footer-guide is the phone door to the guide (ADR 0022)').not.toBeNull();
    expect(box.h, `« ${box.label} » is ${box.w}×${box.h}`).toBeGreaterThanOrEqual(44);
  });
});
