const { test, expect } = require('@playwright/test');

for (const [language, width] of [['fr', 1440], ['en', 1440], ['fr', 390], ['en', 390]]) {
  test(`signature Beta navigation and preview: ${language}, ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?lang=' + language + '#t=beta');
    const pane = page.locator('#pane-beta');
    await expect(pane).toBeVisible();
    await expect(pane.locator('h1')).toHaveText(language === 'fr'
      ? 'La signature électronique, avec votre notaire.' : 'Electronic signing, with your notary.');
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    await page.screenshot({ path: testInfo.outputPath('beta.png'), fullPage: true });
    await pane.locator('.beta-demo summary').click();
    await pane.locator('#salle-annonce-ouvrir').click();
    await expect(page.locator('#salle-annonce-note')).toBeVisible();
    await expect(page.locator('#salle-plein')).toBeHidden();
    await pane.locator('#beta-preview').click();
    await expect(page).toHaveURL(/\/signature\.html$/);
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', language + '-CA');
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#camera-dialog')).not.toBeVisible();
    await page.goBack();
    await expect(pane).toBeVisible();
  });
}
