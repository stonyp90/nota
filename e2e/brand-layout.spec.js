'use strict';
const { test, expect } = require('@playwright/test');

const docs = `http://localhost:${process.env.E2E_DOCS_PORT || 4313}`;
const admin = `http://localhost:${process.env.E2E_ADMIN_PORT || 4312}`;
const surfaces = [
  { name: 'application', path: '/', mark: '.brand-mark-svg' },
  { name: 'brand', path: '/brand.html', mark: '.brand-mark-svg' },
  { name: 'plan', path: `${docs}/business-plan.html`, mark: '.plan-brand-mark' },
  { name: 'pitch', path: `${docs}/pitch-deck.html`, mark: '.brand-mark' },
  { name: 'admin', path: `${admin}/`, mark: '.admin-brand-mark' },
  { name: 'signature', path: '/signature.html', mark: '.brand-mark-svg' },
  { name: 'acquisition', path: '/notaire-financement-quebec.html', mark: '.brand-mark-svg' },
];

for (const width of [390, 1280, 1920]) {
  for (const theme of ['light', 'dark']) {
    test(`shared geometry at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(() => {
        localStorage.setItem('nota.introSeen', '1');
        localStorage.setItem('nota.onboarded.v1', '1');
      });
      let referenceBadge;
      for (const surface of surfaces) {
        await page.goto(`${surface.path}?lang=fr`);
        const header = page.locator('header.nota-header');
        await expect(header, surface.name).toBeVisible();
        const mark = header.locator(surface.mark).first();
        await expect(mark, surface.name).toBeVisible();
        const measured = await mark.evaluate(el => {
          const r = el.getBoundingClientRect();
          const h = el.closest('header').getBoundingClientRect();
          const body = getComputedStyle(document.body);
          const word = el.closest('header').querySelector('.brand-word, .admin-brand-word, .plan-brand-word');
          const badge = el.closest('header').querySelector('.brand-sub, .admin-brand-sub, .brand-region, .plan-brand-region');
          const badgeCss = getComputedStyle(badge);
          return { tile: r.height, x: r.x, y: r.y, header: h.height, word: getComputedStyle(word).color, ink: body.color,
            badge: { color: badgeCss.color, background: badgeCss.backgroundColor, size: badgeCss.fontSize, line: badgeCss.lineHeight },
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        expect(measured.tile, `${surface.name}: tile`).toBe(28);
        expect(measured.x, `${surface.name}: left rail`).toBeCloseTo(Math.max(16, Math.min(width * .04, 28)) + Math.max(0, (width - 1600) / 2), 0);
        expect(measured.header, `${surface.name}: header`).toBe(52);
        expect(measured.y, `${surface.name}: vertical logo alignment`).toBe(12);
        expect(measured.word, `${surface.name}: wordmark ink`).toBe(measured.ink);
        referenceBadge ||= measured.badge;
        expect(measured.badge, `${surface.name}: logo badge`).toEqual(referenceBadge);
        expect(measured.overflow, `${surface.name}: horizontal overflow`).toBeLessThanOrEqual(1);
        if (width === 390 && ['brand', 'plan', 'pitch'].includes(surface.name)) {
          const menu = header.locator('.nota-menu');
          await expect(menu.locator('.nota-header-actions')).toBeHidden();
          await menu.locator('summary').click();
          await expect(menu.locator('.nota-header-actions')).toBeVisible();
          await menu.locator('summary').click();
          await expect(menu.locator('.nota-header-actions')).toBeHidden();
        }
      }
    });
  }
}
