'use strict';

/**
 * Shared helpers for the Nota E2E specs. Kept tiny and dependency-free.
 */

// The app defaults to French; the specs pin English (?lang=en) so text-based
// assertions read one dictionary. i18n.js honours and persists ?lang= on load.
const HOME_EN = '/?lang=en';

/**
 * Navigate to the home page in English.
 * @param {import('@playwright/test').Page} page
 * @param {{ suppressOnboarding?: boolean }} [opts]
 *   suppressOnboarding pre-seeds the "already onboarded" flag so the first-visit
 *   guide never auto-opens — for the journeys that don't test the guide itself.
 */
async function gotoHome(page, opts = {}) {
  if (opts.suppressOnboarding) {
    await page.addInitScript(() => {
      try {
        // app.js: onbSeen() reads this flag (LS_ONBOARDED = 'nota.onboarded.v1').
        localStorage.setItem('nota.onboarded.v1', '1');
      } catch (e) {}
    });
  }
  await page.goto(HOME_EN);
  // The pulse is rendered by app.js after the first /bids fetch resolves; wait
  // for it so the home is genuinely interactive before a spec asserts on it.
  await page.locator('#pulse-rows .pulse-row').first().waitFor({ state: 'visible' });
}

// Parse a Nota-rendered money string into a number. Handles both the English
// "$2,000" and the French "2 000 $" (regular OR non-breaking/thin spaces), and
// bare "2000" — the amount is whatever digits remain once separators are gone.
function parseMoney(raw) {
  if (raw == null) return NaN;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits ? Number(digits) : NaN;
}

// Every visible "$N" / "N $" amount on the page, as numbers. Used to guard the
// "$18,000" pricing regression (no cell should read anywhere near five figures).
async function visibleAmounts(page) {
  const text = await page.locator('body').innerText();
  const out = [];
  // $-prefixed (English) OR N-then-$ (French). Allow digit-group separators
  // including thin / non-breaking spaces the app uses in French formatting.
  const re = /\$\s?([\d.,   ]+)|([\d.,   ]+)\s?\$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseMoney(m[1] || m[2]);
    if (!Number.isNaN(n) && n > 0) out.push(n);
  }
  return out;
}

module.exports = { HOME_EN, gotoHome, parseMoney, visibleAmounts };
