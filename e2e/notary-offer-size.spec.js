'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');
const geometry = import('./offer-card-geometry.mjs');

for (const lang of ['fr', 'en']) for (const width of [390, 768, 1280]) {
  test(`notary offers keep identical dimensions with mixed parameters — ${lang}, ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    const { offerCardGeometry, assertUniformOfferCards } = await geometry;
    await page.setViewportSize({ width, height: 960 });
    // Keep the real login and rendering path. Enrich the test feed with the
    // combinations that used to make individual cards taller than siblings.
    await page.route('**/notary/bids', async route => {
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json.bids)) json.bids = json.bids.map((bid, i) => ({
        ...bid,
        preteur: i % 3 === 0 ? { ...bid.preteur, nom: 'Fiducie de démonstration — renseignements complémentaires sur le prêteur', virtuel: true } : bid.preteur,
        ready: i % 2 === 0,
        complexity: i % 3 === 1 ? null : bid.complexity,
        distanceKm: i % 3 === 1 ? null : bid.distanceKm,
        proposition: i % 4 === 0 ? { montant: bid.montant, status: 'en_attente' } : null,
        demande: i % 4 === 2 ? { documents: bid.requestable || [], fournie: true } : null,
      }));
      await route.fulfill({ response, json });
    });
    await gotoHome(page, { suppressOnboarding: true });
    await page.goto(`/?lang=${lang}#t=notaires`);
    await page.locator('#notary-calendar-access > summary').click();
    await page.locator('#nc-email').fill('notaire.demo@etude.ca');
    await page.locator('#notary-console-signin').click();
    const cards = page.locator('#notary-open-list .nc-agenda-grid > .nc-card');
    await expect(cards.first()).toBeVisible();
    const check = async () => {
      await expect.poll(async () => {
        try { assertUniformOfferCards(await page.evaluate(offerCardGeometry)); return true; }
        catch { return false; }
      }, { message: 'all cards and their action footers must align without clipping' }).toBe(true);
      assertUniformOfferCards(await page.evaluate(offerCardGeometry));
    };
    await check();
    await cards.first().locator('.nc-toggle').click();
    await check();
    await page.locator('#notary-open-view [data-view="detail"]').click();
    await check();
    await page.locator('#notary-open-view [data-view="compact"]').click();
    await page.locator('#notary-filters-toggle').click();
    await page.locator('#notary-open-filter [data-svc="financement"]').click();
    await check();
    // A date with at least two different offers reproduces the reported view.
    const day = await cards.evaluateAll(nodes => {
      const dates = nodes.map(node => node.dataset.date);
      return dates.find(date => dates.filter(value => value === date).length > 1);
    });
    expect(day, 'fixture feed must include a shared signing date').toBeTruthy();
    await page.locator(`.nc-daytile[data-date="${day}"]`).click();
    await check();
    await page.locator('#notary-open-reset').click();
    await check();
  });
}
