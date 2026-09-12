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
    // Plus de paire de flèches dans l'en-tête étroit (propriétaire, 2026-09-12 :
    // « enlever les 2 flèches ») : le bouton du navigateur et le geste de retour
    // du téléphone font déjà ce travail. L'en-tête étroit = marque, puis burger.
    expect(await page.locator('[data-history]').count(), 'aucune flèche d’historique ne revient').toBe(0);
    await expect(page.locator('#cal-today')).toHaveText('Today');
    expect(await page.locator('#cal-today').evaluate(n => getComputedStyle(n, '::after').content)).not.toContain('Auj.');
    await page.locator('#nav-burger').click();
    const drawer = page.locator('#mobile-nav');
    await expect(drawer).toBeVisible();
    // The drawer carries the two preferences the header trims away under 900px.
    // There is exactly ONE brand, so there is no palette chooser here (ADR 0048):
    // a control the drawer shows must be a control the app actually wires.
    await expect(drawer.locator('#mnav-lang')).toBeVisible();
    await expect(drawer.locator('#mnav-theme')).toBeVisible();
    expect(await drawer.locator('select, [role="combobox"]').count(),
      'no orphan dropdown survives in the drawer').toBe(0);
    await expect(page.locator('#main')).toHaveAttribute('inert', '');
    await page.locator('#mnav-close').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await drawer.evaluate(n => n.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.locator('#mnav-close')).toBeFocused();
    // Every preference control is operable from the keyboard and leaves the
    // drawer open — only Escape closes it.
    const themeSwitch = drawer.locator('#mnav-theme');
    await themeSwitch.click();
    await expect(themeSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(drawer).toBeVisible();
    await themeSwitch.click();
    await expect(themeSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(page.locator('#nav-burger')).toBeFocused();
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '');
  });
}
