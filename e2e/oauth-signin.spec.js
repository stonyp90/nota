'use strict';

/**
 * The E2E provider loopback is deliberately local-only. It follows the
 * browser's redirect through start -> provider authorize -> callback -> ID
 * token validation -> result ticket -> session grant for every provider.
 * Production still requires each provider's registered client credentials.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

for (const provider of ['google', 'microsoft', 'linkedin']) {
  test(`${provider} sign-in completes end to end`, async ({ page }) => {
    await gotoHome(page, { suppressOnboarding: true });
    await page.locator('#header-login').click();

    const button = page.locator(`[data-provider="${provider}"]`);
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await expect(button).not.toContainText(/bientôt|soon/i);

    await button.click();
    await expect(page.locator('#auth-dialog')).not.toBeVisible();
    await expect(page.locator('#acct-email')).toHaveText('oauth.demo@example.test');
    await expect.poll(() => page.evaluate(() => location.hash)).not.toMatch(/oauth(?:error|verify)?=/);
  });
}
