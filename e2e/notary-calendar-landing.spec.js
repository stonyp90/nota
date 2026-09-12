'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

for (const lang of ['fr', 'en']) for (const width of [390, 1440]) {
  test(`notary calendar subscription and professional duties — ${lang}, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoHome(page, { suppressOnboarding: true });
    await page.goto(`/?lang=${lang}#t=notaires`);
    const pane = page.locator('#pane-notaires');
    await expect(pane).toBeVisible();
    await expect(pane.locator('h1')).toHaveText(lang === 'fr' ? 'Ajoutez Nota à votre agenda.' : 'Add Nota to your calendar.');
    const calendar = page.locator('#notary-carnet');
    await expect(calendar).toBeVisible();
    const calendarBox = await calendar.boundingBox();
    const gateBox = await page.locator('#notary-console').boundingBox();
    expect(calendarBox.y).toBeLessThan(gateBox.y);
    await expect(page.locator('#nc-email')).not.toBeVisible();
    await expect(calendar.locator('.sub-card-actions a')).toHaveCount(3);
    await expect(calendar.locator('#sub-ics')).not.toBeVisible();
    const google = new URL(await calendar.locator('#sub-google').getAttribute('href'));
    const outlook = new URL(await calendar.locator('#sub-outlook').getAttribute('href'));
    const apple = await calendar.locator('#sub-apple').getAttribute('href');
    const feed = outlook.searchParams.get('url');
    expect(google.searchParams.get('cid')).toBe(apple);
    expect(apple).toBe(feed.replace(/^https?:/, 'webcal:'));
    const response = await page.request.get(feed);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('BEGIN:VCALENDAR');
    const preview = await calendar.locator('#nc-calendar-teaser').boundingBox();
    const guide = await calendar.locator('.nc-calendar-guide').boundingBox();
    if (width > 960) {
      const introduction = await pane.locator('.landing-copy').boundingBox();
      const decision = await calendar.locator('.nc-calendar-preview .nc-calendar-note').boundingBox();
      expect(guide.x + guide.width).toBeLessThan(preview.x);
      expect(Math.abs(introduction.y - decision.y)).toBeLessThan(1);
      expect(preview.y).toBeGreaterThanOrEqual(decision.y + decision.height);
      expect(preview.width).toBeGreaterThan(calendarBox.width * .5);
      expect(preview.width).toBeLessThan(calendarBox.width * .65);
    } else {
      expect(preview.width).toBeGreaterThan(calendarBox.width * .95);
      expect(preview.y).toBeGreaterThanOrEqual(guide.y + guide.height);
    }
    for (const provider of ['google', 'outlook', 'apple']) {
      const box = await calendar.locator('#sub-' + provider).boundingBox();
      expect(box.width, 'provider buttons stay secondary to the calendar').toBeLessThan(preview.width / 2);
      expect(box.height).toBeLessThanOrEqual(44);
      if (width > 960) expect(box.x + box.width).toBeLessThan(preview.x);
      else expect(box.y + box.height).toBeLessThan(preview.y);
    }
    await calendar.locator('#sub-subscription-toggle').click();
    await expect(calendar.locator('#sub-subscription-url')).toHaveValue(/\/carnet\/feed\.ics/);
    await expect(calendar.locator('.sub-card-footnote')).toContainText(lang === 'fr' ? 'fréquence de synchronisation' : 'sync schedule');
    await expect(calendar.locator('#sub-ics')).toBeVisible();
    await page.locator('#notary-calendar-obligations > summary').click();
    const rules = page.locator('#nc-conformite');
    await expect(rules).toContainText(lang === 'fr' ? 'La validation juridique du modèle de frais reste à obtenir.' : 'Legal validation of the fee model is still required.');
    await expect(rules.locator('a[href*="legisquebec"]')).toHaveCount(1);
    await expect(rules.locator('a[href*="cnq.org"]')).toHaveCount(1);
    await expect(page.locator('#notary-calendar-explore')).not.toHaveAttribute('open');
    await expect(page.locator('#notary-live-grid .nc-live-card').first()).toBeVisible();
    await page.locator('#notary-live-grid .nc-live-card').first().click();
    await expect(page.locator('#nc-email')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
