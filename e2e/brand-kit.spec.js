'use strict';
const { test, expect } = require('@playwright/test');

test('copying a colour twice preserves its swatch and hex code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/brand.html?lang=fr');
  const swatch = page.locator('[data-copy="#264961"]');
  await swatch.click();
  await expect(swatch.locator('strong')).toHaveText('Copié');
  await swatch.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#264961');
  await expect(swatch.locator('.swatch-color')).toBeVisible();
  await expect(swatch.locator('code')).toHaveText('#264961');
  await expect(swatch.locator('strong')).toHaveText('Carré du logo');
});

for (const language of ['fr', 'en']) {
  for (const colorScheme of ['light', 'dark']) {
    test(`official brand kit: ${language}, ${colorScheme}`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/brand.html?lang=${language}`);
      await expect(page.locator('html')).toHaveAttribute('lang', `${language}-CA`);
      await expect(page.locator('#downloads-title')).toHaveText(language === 'en' ? 'Official resources' : 'Ressources officielles');
      await expect(page.locator('a[href*="brand-explorations"], a[href*="brand-compose"], a[href*="brand-blanc"]')).toHaveCount(0);
      for (const name of ['nota-logo-light.svg', 'nota-logo-dark.svg', 'signature-courriel.html', 'favicon.svg', 'og.svg']) {
        const response = await request.get(`/${name}`);
        expect(response.ok(), name).toBeTruthy();
        expect(response.headers()['content-type']).toContain(name.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
      }
      await expect.poll(() => page.locator('.usage-card img').evaluateAll(images => images.length === 2 && images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.locator('.nota-menu > summary').click();
      await page.getByRole('button', { name: language === 'en' ? 'Français' : 'English', exact: true }).click();
      await expect(page.locator('#downloads-title')).toHaveText(language === 'en' ? 'Ressources officielles' : 'Official resources');
    });
  }
}
