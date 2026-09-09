'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

for (const language of ['fr', 'en']) {
  test('compatible booking, validation and arrival context — ' + language, async ({ page }) => {
    const errors = [];
    const events = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().endsWith('/events') && request.method() === 'POST') events.push(request.postDataJSON());
    });
    await gotoHome(page, { suppressOnboarding: true });
    await page.goto('/?lang=' + language + '&utm_source=linkedin');
    await page.locator('#pulse-rows .pulse-row').first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('#cta-reserver').click();
    const sheet = page.locator('#day-dialog');
    await expect(sheet).toBeVisible();
    await sheet.locator('#o-service-chips [data-svc="financement"]').click();
    const bounds = await sheet.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    const next = sheet.locator('#book-next');
    await next.click();
    await next.click(); // unanswered questions must keep the screen and show feedback
    await expect(sheet.locator('#offer-form')).toHaveAttribute('data-at', '2');
    await expect(sheet.locator('.crit-missing').first()).toBeVisible();
    await sheet.locator('#crit-valeur_pret').fill('350000');
    await sheet.locator('#crit-contexte__propriete_detenue').click();
    await sheet.locator('#crit-approbation_bancaire__obtenue').click();
    await sheet.locator('#crit-preteur').selectOption('banque_nationale');
    await sheet.locator('#crit-deplacement').selectOption('client_50');
    await next.click();
    await next.click();
    await sheet.locator('#o-prefix').fill('G1R');
    await sheet.locator('#o-name').fill('Client Compatibilité');
    await sheet.locator('#o-courriel').fill('compatibility@example.test');
    const posted = page.waitForResponse(response => response.url().endsWith('/bids') && response.request().method() === 'POST');
    await sheet.locator('#offer-submit').click();
    const result = await posted;
    expect(result.status(), await result.text()).toBe(201);
    expect(result.request().postDataJSON().analytics.source).toBe('linkedin');
    expect(result.request().postDataJSON().analytics.language).toBe(language);
    await expect(sheet.locator('#offer-success')).toBeVisible();
    expect(events.some(event => event.event === 'formulaire_bloque')).toBe(true);
    expect(events.some(event => event.event === 'coordonnees_vues')).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const [path, lang] of [
  ['/notaire-financement-quebec.html', 'fr'],
  ['/notaire-refinancement-quebec.html', 'fr'],
  ['/mortgage-financing-notary-quebec-city.html', 'en'],
  ['/mortgage-refinancing-notary-quebec-city.html', 'en'],
]) {
  test(`retired page returns to the localized carnet: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp('/\\?lang=' + lang + '#t=carnet'));
    await expect(page.locator('html')).toHaveAttribute('lang', lang + '-CA');
    await expect(page.locator('#pane-carnet')).toBeVisible();
    await expect(page.locator('.site-footer a[href*="notaire-financement-quebec"]')).toHaveCount(0);
  });
}
