'use strict';
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const screenshots = process.env.NOTA_EXPERIENCE_SCREENSHOTS;
async function openPartner(page, theme) {
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('nota.introSeen', '1');
    localStorage.setItem('nota.onboarded.v1', '1');
    localStorage.setItem('nota.theme', JSON.stringify(theme));
    localStorage.setItem('nota.profile.v1', JSON.stringify({ courriel: 'experience@exemple.ca', nom: 'Camille' }));
    localStorage.setItem('nota.partner.v1', JSON.stringify({ code: 'NOTA2026', courriel: 'experience@exemple.ca', type: 'courtier' }));
  }, { theme });
  await page.goto('/?lang=fr#t=partenaires');
  await expect(page.locator('#partner-active-code')).toHaveText('NOTA2026');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280, 1920]) {
    test(`experience hierarchy and readable panels: ${theme}, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await openPartner(page, theme);
      const layout = await page.evaluate(() => {
        const css = selector => getComputedStyle(document.querySelector(selector));
        const size = selector => parseFloat(css(selector).fontSize);
        const colour = value => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = rgb => rgb.slice(0, 3).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        const panel = css('#partner-success');
        const base = colour(getComputedStyle(document.documentElement).getPropertyValue('--bg'));
        const fill = colour(panel.backgroundColor);
        const backdrop = fill.slice(0, 3).map((c, i) => c * fill[3] / 255 + base[i] * (1 - fill[3] / 255));
        const text = colour(css('#partner-success .help').color);
        const l = [luminance(backdrop), luminance(text)].sort((a, b) => b - a);
        return {
          headline: size('#pane-partenaires h1'), lead: size('.pr-hero-copy > p'),
          code: size('#partner-active-code'), note: size('.pr-earned'), legal: size('.pr-eligibility'),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
          clipped: [...document.querySelectorAll('#pane-partenaires h1,#pane-partenaires h2')].filter(e => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1).length,
          alpha: fill[3] / 255, opacity: panel.opacity, contrast: (l[0] + .05) / (l[1] + .05),
        };
      });
      expect(layout.headline).toBeGreaterThan(layout.lead * 1.4);
      expect(layout.headline).toBeLessThanOrEqual(36);
      expect(layout.code).toBeLessThan(layout.headline);
      expect(layout.note).toBeLessThan(layout.lead);
      expect(layout.legal).toBeLessThan(layout.lead);
      expect(layout.sideways).toBe(false);
      expect(layout.clipped).toBe(0);
      expect(layout.alpha).toBeGreaterThan(.6);
      expect(layout.alpha).toBeLessThan(.95);
      expect(layout.opacity).toBe('1');
      expect(layout.contrast).toBeGreaterThanOrEqual(4.5);
      if (screenshots && width <= 1280) await page.screenshot({ path: path.join(screenshots, `partenaires-${theme}-${width}.png`), fullPage: true });
    });
  }
}

test('reduced motion keeps panels readable and controls still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPartner(page, 'dark');
  await page.locator('#partner-copy').hover();
  await page.waitForTimeout(80);
  const motion = await page.evaluate(() => ({
    running: document.getAnimations().filter(a => a.playState === 'running').length,
    opacity: getComputedStyle(document.querySelector('#partner-success')).opacity,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  expect(motion.running).toBe(0);
  expect(motion.opacity).toBe('1');
  expect(motion.scroll).toBe('auto');
  await expect(page.locator('#partner-copy')).toBeVisible();
});
