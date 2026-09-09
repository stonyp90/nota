'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

for (const width of [900, 1024, 1280]) {
  test(`desktop header controls remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await gotoHome(page, { suppressOnboarding: true });
    const outside = await page.locator('.site-header').evaluate(header =>
      [...header.querySelectorAll('button, a')].filter(n => {
        const r = n.getBoundingClientRect();
        return r.width && r.height && (r.left < 0 || r.right > innerWidth + 1);
      }).map(n => n.textContent.trim()));
    expect(outside).toEqual([]);
  });
}

for (const width of [320, 390, 768]) {
  test(`mobile menu keeps its layout, labels and keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await gotoHome(page, { suppressOnboarding: true });
    const back = await page.locator('#nav-back').boundingBox();
    const forward = await page.locator('#nav-forward').boundingBox();
    expect(Math.abs(back.y - forward.y)).toBeLessThan(2);
    expect(back.width).toBeGreaterThanOrEqual(44);
    expect(forward.x).toBeGreaterThanOrEqual(back.x + back.width);
    await expect(page.locator('#cal-today')).toHaveText('Today');
    expect(await page.locator('#cal-today').evaluate(n => getComputedStyle(n, '::after').content)).not.toContain('Auj.');
    await page.locator('#nav-burger').click();
    const drawer = page.locator('#mobile-nav');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('combobox', { name: 'Colour palette', exact: true })).toBeVisible();
    await expect(page.locator('#main')).toHaveAttribute('inert', '');
    await page.locator('#mnav-close').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await drawer.evaluate(n => n.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.locator('#mnav-close')).toBeFocused();
    const palette = drawer.getByRole('combobox', { name: 'Colour palette', exact: true });
    await palette.click();
    await expect(palette).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(palette).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(page.locator('#nav-burger')).toBeFocused();
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '');
  });
}
