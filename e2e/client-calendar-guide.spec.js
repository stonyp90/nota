'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome, chooseFinancingLenderAndTravel } = require('./helpers');

// The full bilingual form is exercised on slower browser engines too.
test.setTimeout(60_000);
// Form assertions concern interaction. Keep decorative timelines from competing
// with input delivery in Firefox's headless software renderer.
test.beforeEach(async ({ page, browserName }, testInfo) => {
  page.setDefaultNavigationTimeout(45_000);
  if (browserName === 'firefox') {
    testInfo.setTimeout(120_000);
    page.setDefaultTimeout(30_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
});

async function startGuide(page, lang) {
  await gotoHome(page, { lang });
  await page.locator('.onb-choice[data-role="client"]').click();
  await page.locator('#onb-cta').click();
  await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '0');
}
async function chooseDate(page) {
  const cell = page.locator('#cal-grid .client-walk-target');
  const date = await cell.getAttribute('data-date');
  await cell.click();
  await expect(page.locator('#day-dialog')).toBeVisible();
  if (await page.locator('#day-preview').isVisible()) {
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '0-preview');
    await page.locator('#client-walk-next').click();
  }
  await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '1');
  await expect(page.locator('#o-date')).toHaveValue(date);
}

for (const width of [390, 1280]) for (const lang of ['fr', 'en']) {
  test(`guided refinancing reaches publication without publishing automatically (${lang}, ${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    let posted = 0;
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/bids') posted++; });
    await startGuide(page, lang);
    await expect(page.locator('#cal-start, #cal-help, .cal-choose-label')).toHaveCount(0);
    await expect(page.locator('#day-dialog')).not.toBeVisible();
    const overlap = await page.evaluate(() => {
      const card = document.querySelector('#client-walkthrough').getBoundingClientRect();
      const date = document.querySelector('#cal-grid .client-walk-target').getBoundingClientRect();
      return Math.max(0, Math.min(card.right, date.right) - Math.max(card.left, date.left))
        * Math.max(0, Math.min(card.bottom, date.bottom) - Math.max(card.top, date.top));
    });
    expect(overlap, 'the guide leaves its target date visible').toBe(0);
    await expect(page.locator('#cal-grid [aria-selected="true"]')).toHaveCount(0);
    await expect(page.locator('#client-walk-title')).toHaveText(lang === 'fr' ? 'Votre date de signature' : 'Your signing date');
    await chooseDate(page);
    await page.locator('#o-service-chips [data-svc="refinancement"]').click();
    await page.locator('#client-walk-next').click();
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '2');
    await page.locator('#client-walk-next').click();
    await expect(page.locator('#offer-form')).toHaveAttribute('data-at', '2');
    await page.locator('#crit-valeur_pret').fill('350000');
    await page.locator('#crit-approbation_bancaire__obtenue').click();
    await chooseFinancingLenderAndTravel(page);
    await page.locator('#book-next').click();
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '3');
    await expect(page.locator('#offer-devis')).toBeVisible();
    await page.locator('#book-back').click();
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '2');
    await expect(page.locator('#crit-valeur_pret')).toHaveValue('350000');
    await page.locator('#client-walk-next').click();
    await page.locator('#client-walk-next').click();
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '4');
    await page.locator('#o-prefix').fill('G1R');
    await page.locator('#o-name').fill('Client Exemple');
    await page.locator('#o-courriel').fill('client@example.ca');
    await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '5');
    await expect(page.locator('#offer-submit')).toBeEnabled();
    await page.locator('#client-walk-next').click();
    await expect(page.locator('#client-walkthrough')).toHaveCount(0);
    await expect(page.locator('#o-name')).toHaveValue('Client Exemple');
    await expect(page.locator('#offer-submit')).toBeFocused();
    expect(posted).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('skip preserves the real form; reload stays quiet; help can replay the guide', async ({ page }) => {
  await startGuide(page, 'en');
  await chooseDate(page);
  await page.locator('#client-walk-next').click();
  await page.locator('#crit-valeur_pret').fill('420000');
  await page.locator('#client-walk-skip').click();
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
  await expect(page.locator('#day-dialog')).toBeVisible();
  await expect(page.locator('#crit-valeur_pret')).toHaveValue('420000');
  await page.reload();
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
  await page.locator('#footer-guide').click();
  await page.locator('#onb-cta').click();
  await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
  await expect(page.locator('#cal-grid .client-walk-target')).toHaveCount(0);
});

test('the client film leads directly into the optional guide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?lang=fr');
  await page.locator('#ig-door-client').click();
  await expect(page.locator('#ig-stage-client .ig-client-brand')).toBeVisible();
  await expect(page.locator('#ig-stage-client .ig-wordmark')).toHaveCount(1);
  const dateCount = await page.locator('#ig-client-dates .ig-client-date').count();
  expect([28, 35, 42]).toContain(dateCount);
  await page.locator('#ig-stage-client .ig-progress-seek').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#ig-stage-client .ig-c4')).toBeVisible();
  await page.locator('#ig-stage-client [data-ig-goto="carnet"]').click();
  await expect(page.locator('#intro-gate')).not.toBeVisible();
  await expect(page.locator('#client-walkthrough')).toHaveAttribute('data-step', '0');
  await expect(page.locator('#day-dialog')).not.toBeVisible();
  await page.locator('#client-walk-skip').click();
  await page.reload();
  await expect(page.locator('#intro-gate')).not.toBeVisible();
  await expect(page.locator('#onboarding-dialog')).not.toBeVisible();
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
});

test('the calendar content aligns with the hero; direct booking remains available', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoHome(page, { suppressOnboarding: true });
  const positions = await page.evaluate(() => ['#pane-carnet h1', '#cal-prev', '#cal-grid .cal-cell'].map(s => document.querySelector(s).getBoundingClientRect().left));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  await page.locator('#cta-reserver').click();
  await expect(page.locator('#offer-form')).toBeVisible();
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
});

test('reduced-motion visitors can use the calendar and skip the guide with the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startGuide(page, 'en');
  await expect(page.locator('#cal-grid .client-walk-target')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  const date = await page.locator('#cal-grid .cal-cell:focus').getAttribute('data-date');
  await page.keyboard.press('Enter');
  await expect(page.locator('#day-dialog')).toBeVisible();
  await expect(page.locator('#o-date')).toHaveValue(date);
  await page.keyboard.press('Escape');
  await expect(page.locator('#client-walkthrough')).toHaveCount(0);
  await expect(page.locator('#day-dialog')).toBeVisible();
});

test('the date preview stays clear and operable across rotation and screen sizes', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page, { suppressOnboarding: true, lang: 'fr' });
  const cell = page.locator('#cal-grid .cal-cell.has-bids:not(.is-past)').first();
  const originalDate = await cell.getAttribute('data-date');
  await cell.click();
  const sheet = page.locator('#day-dialog');
  const action = page.locator('#day-preview > button');
  const offers = page.locator('#day-preview-offers');
  const edit = page.locator('#day-date-edit');
  await expect(sheet).toHaveAttribute('data-interaction', 'preview');
  await expect(action).toHaveText('Préparer mon offre');
  await expect(action).toBeFocused();
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1024, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(offers).toHaveJSProperty('open', false);
    const geometry = await page.evaluate(() => {
      const dlg = document.querySelector('#day-dialog');
      const rect = dlg.getBoundingClientRect();
      const targets = ['#day-title', '#day-date-edit > summary', '#day-preview > button', '#day-close']
        .map(selector => ({ selector, rect: document.querySelector(selector).getBoundingClientRect().toJSON() }));
      return { width: innerWidth, height: innerHeight, scroll: dlg.scrollWidth, client: dlg.clientWidth, rect: rect.toJSON(), targets };
    });
    expect(geometry.scroll, 'the dialog has no horizontal overflow').toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.rect.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.rect.right).toBeLessThanOrEqual(size.width + 1);
    for (const { selector, rect } of geometry.targets) {
      expect(rect.left, selector).toBeGreaterThanOrEqual(-1);
      expect(rect.right, selector).toBeLessThanOrEqual(size.width + 1);
      expect(rect.top, selector).toBeGreaterThanOrEqual(-1);
      expect(rect.bottom, selector).toBeLessThanOrEqual(size.height + 1);
    }
    await page.screenshot({ path: testInfo.outputPath('date-preview-' + size.width + '.png') });
    await offers.locator('summary').click();
    await expect(offers).toHaveJSProperty('open', true);
    await expect(offers.locator('.bid-row').first()).toBeVisible();
    await offers.locator('summary').click();
    await edit.locator('summary').click();
    await expect(page.locator('#day-date')).toBeVisible();
    await edit.locator('summary').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await action.click();
  await expect(page.locator('#offer-form')).toBeVisible();
  await expect(page.locator('#offer-form .day-market #day-bids')).toHaveCount(1);
  await page.locator('#book-next').click();
  await expect(page.locator('#offer-form')).toHaveAttribute('data-at', '2');
  await edit.locator('summary').click();
  const nextDate = new Date(originalDate + 'T00:00:00Z');
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  await page.locator('#day-date').fill(nextDate.toISOString().slice(0, 10));
  await expect(sheet).toHaveAttribute('data-interaction', 'offer');
  await expect(page.locator('#offer-form')).toHaveAttribute('data-at', '2');
  await expect(edit.locator('summary')).toBeFocused();
});
