'use strict';

/**
 * home-numbers.spec — the pricing facts a client sees first.
 *
 * Guards the floors (refinancement $2,000 / financement $1,800), the "$18,000"
 * calendar regression (no visible price anywhere near five figures), and that
 * every shown median sits at or above its act's floor. Fixtures are randomized
 * per server boot, so this asserts INVARIANTS (floors, ceilings) — never exact
 * medians.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome, parseMoney, visibleAmounts } = require('./helpers');

// Floor per act, straight from the domain catalogue (ADR 0010/0011).
const FLOORS = { refinancement: 2000, financement: 1800 };

// Pull "from $X … median offer $Y" out of a pulse row's aria-label — the app
// composes it there from domain data, so it is the stable source of both figures.
function readPulseLabel(label) {
  const from = label.match(/from\s+\$?([\d.,]+)/i);
  const median = label.match(/median offer\s+\$?([\d.,]+)/i);
  return {
    from: from ? parseMoney(from[1]) : NaN,
    median: median ? parseMoney(median[1]) : NaN,
  };
}

test.describe('home pricing numbers', () => {
  test('refinancement and financement "from" floors are exact', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    const refi = await page.locator('.pulse-row[data-svc="refinancement"]').getAttribute('aria-label');
    const fin = await page.locator('.pulse-row[data-svc="financement"]').getAttribute('aria-label');

    expect(readPulseLabel(refi).from, `refinancement floor, from aria-label: ${refi}`).toBe(FLOORS.refinancement);
    expect(readPulseLabel(fin).from, `financement floor, from aria-label: ${fin}`).toBe(FLOORS.financement);
  });

  test('no visible price is anywhere near five figures ($18,000 regression)', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    const amounts = await visibleAmounts(page);
    expect(amounts.length, 'the home should render at least some prices').toBeGreaterThan(0);

    const over = amounts.filter((n) => n >= 10_000);
    expect(over, `prices >= $10,000 must not appear; saw ${JSON.stringify(over)}`).toEqual([]);
  });

  test('each shown median is at or above its act floor', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    for (const svc of Object.keys(FLOORS)) {
      const label = await page.locator(`.pulse-row[data-svc="${svc}"]`).getAttribute('aria-label');
      const { median } = readPulseLabel(label);
      // A month can legitimately have no offers for an act ("no offers this
      // month" instead of a median) — only assert when a median is shown.
      if (!Number.isNaN(median)) {
        expect(median, `${svc} median must be >= floor; aria-label: ${label}`).toBeGreaterThanOrEqual(FLOORS[svc]);
      }
    }
  });
});
