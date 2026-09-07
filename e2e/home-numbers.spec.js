'use strict';

/**
 * home-numbers.spec — the pricing facts a client sees first.
 *
 * Guards the announced « from » price of each act, the "$18,000" calendar
 * regression (no visible price anywhere near five figures), and that every
 * shown median sits at or above its act's fee floor. Fixtures are randomized
 * per server boot, so this asserts INVARIANTS (floors, ceilings) — never exact
 * medians.
 *
 * The figures are read from the pulse row's own STRUCTURE (`.pulse-fig-v`, in
 * render order: the floor, then the median) rather than parsed out of its
 * aria-label sentence. The label is copy — it is rewritten whenever the pricing
 * story changes, and it exists in two languages; the two `.pulse-fig-v` nodes
 * are the data. `parseMoney` reads "$2,000" and "2 000 $" alike, so these
 * assertions hold in either dictionary.
 */
const { test, expect } = require('@playwright/test');
const D = require('@nota/domain');
const { gotoHome, parseMoney, visibleAmounts } = require('./helpers');

// The acts whose pulse rows this spec reads. Every figure below is COMPUTED
// from the domain rather than restated here: a spec that repeats a number is a
// second place to change when the price moves, and the second place is the one
// that gets forgotten.
const ACTS = ['refinancement', 'financement'];

// The « à partir de » a client actually reads. ADR 0042: the announced price is
// the TOTAL — the notary's starting fees PLUS Nota's own price at the standard
// tier — because art. 224 c) of the Loi sur la protection du consommateur
// requires an announced price to include everything the consumer must pay, and
// Nota's service is a mandatory fixed charge on top of the fees. The bare fee
// floor is not a price anyone can obtain, so it is not a price anyone may
// advertise. Computed on the catalogue grid, which is exactly the grid the E2E
// stack serves (the in-memory repo carries no CONFIG#PRIX override).
const ANNOUNCED = Object.fromEntries(
  ACTS.map((svc) => [svc, D.prixAnnonce(svc).totalCents / 100]),
);

// The other number, and a different question: the lowest FEES a notary may be
// offered for the act (ADR 0010/0011). A published offer carries the notary's
// fees alone, so this — not the announced total — is what a median of offers
// has to clear.
const FLOORS = Object.fromEntries(
  ACTS.map((svc) => [svc, D.serviceById(svc).prixDepart]),
);

/**
 * The two figures a pulse row publishes, read positionally from the DOM:
 * `à partir de` / `from` first, the month's median second. A row with no offers
 * this month renders an em dash on the median (`.is-empty`), which parses to
 * NaN — the callers below treat that as "not shown", never as zero.
 */
async function readPulseFigures(page, svc) {
  const values = page.locator(`.pulse-row[data-svc="${svc}"] .pulse-fig-v`);
  await values.first().waitFor({ state: 'visible' });
  const texts = await values.allInnerTexts();
  expect(texts.length, `${svc} should publish a floor and a median`).toBeGreaterThanOrEqual(2);
  return { from: parseMoney(texts[0]), median: parseMoney(texts[1]), texts };
}

test.describe('home pricing numbers', () => {
  test('refinancement and financement "from" prices are the announced total', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    for (const [svc, announced] of Object.entries(ANNOUNCED)) {
      const { from, texts } = await readPulseFigures(page, svc);
      expect(from, `${svc} announced price, from pulse figures: ${JSON.stringify(texts)}`).toBe(announced);
      // And the guard that ADR 0042 exists for: never the bare fee floor, which
      // is a price the client cannot obtain.
      expect(from, `${svc} must not advertise the fee floor alone`).toBeGreaterThan(FLOORS[svc]);
    }
  });

  test('no visible price is anywhere near five figures ($18,000 regression)', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    // Scoped to the carnet surface: the booking sheet's quote block states
    // Nota's own price and a card total, which are not calendar prices.
    const amounts = await visibleAmounts(page);
    expect(amounts.length, 'the home should render at least some prices').toBeGreaterThan(0);

    const over = amounts.filter((n) => n >= 10_000);
    expect(over, `prices >= $10,000 must not appear; saw ${JSON.stringify(over)}`).toEqual([]);
  });

  test('each shown median is at or above its act fee floor', async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });

    for (const [svc, floor] of Object.entries(FLOORS)) {
      const { median, texts } = await readPulseFigures(page, svc);
      // A month can legitimately have no offers for an act (an em dash instead
      // of a median) — only assert when a median is actually shown.
      if (!Number.isNaN(median)) {
        expect(median, `${svc} median must be >= floor; figures: ${JSON.stringify(texts)}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});
