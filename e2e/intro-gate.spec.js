'use strict';

/**
 * intro-gate.spec — the first thing a fresh visitor sees.
 *
 * The arrival offers the client and notary films plus direct partner access.
 * Skipping is always possible, and the gate greets a browser only once.
 * NOTE: unlike every other spec, this one does NOT go through gotoHome() —
 * gotoHome seeds the gate away on purpose.
 */
const { test, expect } = require('@playwright/test');
const { HOME_EN } = require('./helpers');

test('a fresh visit shows three doors; the notary door plays its film and lands on the pane', async ({ page }) => {
  await page.goto(HOME_EN);

  // The gate owns the first paint; the onboarding guide yields to it.
  const gate = page.locator('#intro-gate');
  await expect(gate).toBeVisible();
  await expect(page.locator('#onboarding-dialog')).not.toBeVisible();

  // Every audience has a readable title and a short next-step description.
  await expect(page.locator('#ig-door-client')).toContainText(/looking for a notary/i);
  await expect(page.locator('#ig-door-notaire')).toContainText(/a notary/i);
  await expect(page.locator('#ig-door-partner')).toContainText(/partner/i);
  await expect(page.locator('#ig-chooser .ig-door-sub')).toHaveCount(3);

  // The arrival shows the carnet, not a promise: one real date per notice
  // tier, each with the total price a client would pay for that day.
  const tiles = page.locator('#ig-carnet .ig-cal-cell');
  await expect(tiles).toHaveCount(5);
  await expect(tiles.first()).toContainText(/\$[\d,]+/);
  await expect(tiles.last()).toContainText(/\$[\d,]+/);
  // The calm date is the one marked, never the same-day price.
  await expect(page.locator('#ig-carnet .ig-cal-cell[data-anchor="true"]')).toHaveCount(1);

  // Choosing the notary door starts that film.
  await page.locator('#ig-door-notaire').click();
  await expect(page.locator('#ig-frame')).toBeVisible();
  await expect(page.locator('#ig-stage-notaire')).toHaveClass(/run/);

  // The scene bar is both a progress indicator and a seek control: moving it
  // one stop forward restarts the film on the second beat.
  const seek = page.locator('#ig-stage-notaire .ig-progress-seek');
  await seek.click();
  await seek.press('Home');
  await seek.press('ArrowRight');
  await expect(seek).toHaveValue('1');
  await expect(page.locator('#ig-stage-notaire')).toHaveAttribute('style', /--ig-seek-offset:\s*3500ms/);

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

for (const lang of ['fr', 'en']) test(`the branded arrival and client film fit phone, tablet and desktop (${lang})`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/?lang=' + lang);
  await expect(page.locator('#ig-chooser')).toBeVisible();
  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width < 768 ? 844 : 900 });
    const layout = await page.evaluate(() => {
      const box = document.querySelector('#ig-chooser').getBoundingClientRect();
      const doors = [...document.querySelectorAll('#ig-chooser .ig-door')].map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height }));
      return { left: box.left, right: box.right, width: innerWidth, doors, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.width);
    expect(layout.doors.every(b => b.height >= 44 && b.width >= 100)).toBe(true);
    await expect(page.locator('#ig-chooser .language-control')).toHaveCSS('opacity', '1');
    if ([320, 1280].includes(width)) await page.screenshot({ path: testInfo.outputPath(`arrival-${lang}-${width}.png`) });
  }
  await page.locator('#ig-door-client').click();
  await page.locator('#ig-pause').click();
  await expect(page.locator('#ig-stage-client .ig-client-brand')).toBeVisible();
  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : width < 768 ? 844 : 720 });
    const layout = await page.evaluate(() => {
      const calendar = document.querySelector('.ig-client-calendar').getBoundingClientRect();
      const copy = document.querySelector('.ig-c1').getBoundingClientRect();
      const controls = document.querySelector('.ig-controls').getBoundingClientRect();
      const overlap = Math.max(0, Math.min(calendar.right, copy.right) - Math.max(calendar.left, copy.left)) * Math.max(0, Math.min(calendar.bottom, copy.bottom) - Math.max(calendar.top, copy.top));
      return { overlap, bottom: calendar.bottom, controlsTop: controls.top, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout.overlap).toBeLessThan(1);
    expect(layout.bottom).toBeLessThanOrEqual(layout.controlsTop);
    expect(layout.overflow).toBe(false);
    if ([320, 1280].includes(width)) await page.screenshot({ path: testInfo.outputPath(`film-${lang}-${width}.png`) });
  }
});
