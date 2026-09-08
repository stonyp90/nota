'use strict';
const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('nota.introSeen', '1');
    localStorage.setItem('nota.onboarded.v1', '1');
  });
}
for (const [locale, expected] of [['en-US', 'en-CA'], ['fr-CA', 'fr-CA'], ['de-DE', 'fr-CA']]) {
  test(`fresh ${locale} browser chooses ${expected} and sends its language to the API`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await seed(page);
    const request = page.waitForRequest(r => /\/bids\?month=/.test(r.url()));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', expected);
    expect((await request).headers()['accept-language']).toBe(expected.slice(0, 2));
    await context.close();
  });
}
for (const width of [390, 1440]) {
  test(`${width}px: menu language persists, overrides the URL and updates authenticated email preferences`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.addInitScript(() => localStorage.setItem('nota.myoffers.v1', JSON.stringify([
      { id: 'language-test', dateISO: '2026-10-12', clientToken: 'test-client-token' }
    ])));
    const saves = [];
    await page.route('**/notification-preferences*', async route => {
      saves.push(route.request().postDataJSON());
      await route.fulfill({ json: { catalog: [], preferences: {}, emailLanguage: saves.at(-1).emailLanguage } });
    });
    await page.goto('/?lang=en#t=carnet');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
    if (width < 600) {
      // Open the actual mobile options menu.
      await page.locator('#nav-burger').click();
    }
    const selector = width < 600 ? '#mnav-lang' : '#lang-toggle';
    await page.locator(selector + ' [data-set-lang="fr"]').click();
    await expect(page).toHaveURL(/lang=fr/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
    await expect.poll(() => saves.some(s => s.emailLanguage === 'fr')).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('nota.lang'))).toBe('fr');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  });
}

test('first supported browser preference is used and storage denial does not break detection', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['es-MX', 'en-US', 'fr-CA'] });
    Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
});

test('a menu choice survives reload when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
  });
  await page.goto('/?source=KEEP#t=carnet');
  await page.evaluate(() => window.NotaI18N.setLang('fr'));
  await expect(page).toHaveURL(/source=KEEP&lang=fr#t=carnet/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});

test('invalid language URL values do not masquerade as a supported override', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-CA' });
  const page = await context.newPage();
  await seed(page);
  await page.goto('/?lang=en-invalid');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  await context.close();
});
