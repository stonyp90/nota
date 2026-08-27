'use strict';

/**
 * intro-gate.spec — the first thing a fresh visitor sees.
 *
 * On a truly fresh browser the intro gate owns the first paint: two doors
 * (client / notary), each playing its pitch film, then landing on the matching
 * pane. Skipping is always possible, and the gate greets a browser only once.
 * NOTE: unlike every other spec, this one does NOT go through gotoHome() —
 * gotoHome seeds the gate away on purpose.
 */
const { test, expect } = require('@playwright/test');
const { HOME_EN } = require('./helpers');

test('a fresh visit shows the two doors; the notary door plays its film and lands on the pane', async ({ page }) => {
  await page.goto(HOME_EN);

  // The gate owns the first paint; the onboarding guide yields to it.
  const gate = page.locator('#intro-gate');
  await expect(gate).toBeVisible();
  await expect(page.locator('#onboarding-dialog')).not.toBeVisible();

  // Two doors, one per audience.
  await expect(page.locator('#ig-door-client')).toContainText(/looking for a notary/i);
  await expect(page.locator('#ig-door-notaire')).toContainText(/a notary/i);

  // Choosing the notary door starts that film.
  await page.locator('#ig-door-notaire').click();
  await expect(page.locator('#ig-frame')).toBeVisible();
  await expect(page.locator('#ig-stage-notaire')).toHaveClass(/run/);

  // Skipping lands on the notary pane and remembers the visit.
  await page.locator('#ig-skip').click();
  await expect(gate).not.toBeVisible();
  await expect(page.locator('#pane-notaires')).toBeVisible();
  const seen = await page.evaluate(() => localStorage.getItem('nota.introSeen'));
  expect(seen).toBe('1');

  // A reload goes straight to the site — the gate greets a browser only once.
  await page.reload();
  await expect(page.locator('#intro-gate')).not.toBeVisible();
});
