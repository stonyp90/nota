'use strict';

/**
 * admin-rail.spec — the console rail reorganises itself for the screen it is on.
 *
 * The console ships sixteen sections. Stacked above the content, as they were,
 * they cost a phone a full screen of menu before the first figure of the view
 * the operator actually asked for. Under 860 px the rail now shows only the
 * section that is open and unfolds the rest on one press; above it, nothing
 * changes — the whole list stays in the sidebar, and no toggle exists.
 *
 * What this guards, at three sizes and on the engines the matrix drives:
 *   • a phone lands on the CONTENT, not on the menu (the view's title sits
 *     inside the first screen);
 *   • the sections are one press away, and choosing one both navigates and
 *     folds the rail back;
 *   • a laptop still sees the full rail and never sees the toggle.
 */
const { test, expect } = require('@playwright/test');

const ADMIN = `http://localhost:${process.env.E2E_ADMIN_PORT || 4312}`;

/** Sign an operator in through the dev-echoed magic link and land on a view. */
async function signIn(page, request, view = 'prix') {
  await page.goto(`${ADMIN}/?lang=fr#/${view}`);
  const login = await request.post(`${ADMIN}/api/admin/auth/request`, { data: { email: 'admin@nota.local' } });
  const body = await login.json();
  if (!body.devLink) throw new Error('admin dev link not echoed: ' + JSON.stringify(body));
  await page.evaluate((h) => { location.hash = h; }, new URL(body.devLink).hash);
  await page.waitForSelector('.admin-rail', { timeout: 20_000 });
  await page.evaluate((h) => { location.hash = h; }, `#/${view}`);
  await expect(page.locator('.page-title')).toBeVisible();
}

for (const vp of [
  { name: 'phone 390', width: 390, height: 844, folded: true },
  { name: 'tablet portrait 768', width: 768, height: 1024, folded: true },
  { name: 'laptop 1280', width: 1280, height: 800, folded: false },
]) {
  test(`the console rail fits ${vp.name}`, async ({ page, request }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn(page, request, 'prix');

    const toggle = page.locator('#admin-rail-toggle');
    const sections = page.locator('#admin-rail-sections');
    const audit = page.locator('.admin-rail-link', { hasText: 'Audit' });

    if (!vp.folded) {
      // A sidebar wide enough for the list shows the list, and nothing else.
      await expect(toggle).toBeHidden();
      await expect(audit).toBeVisible();
      return;
    }

    // Folded: the menu is one control, and the view the operator asked for
    // starts inside the first screen rather than under sixteen links.
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sections).toBeHidden();
    await expect(toggle).toContainText('Prix');
    const titleTop = await page.locator('.page-title').evaluate((el) => el.getBoundingClientRect().top);
    expect(titleTop, 'the view the operator asked for is on the first screen').toBeLessThan(vp.height);

    // One press unfolds every section, and the search comes with them.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sections).toBeVisible();
    await expect(audit).toBeVisible();
    await expect(page.locator('#admin-section-search')).toBeVisible();

    // Choosing a section navigates AND folds the rail back on the new view.
    await audit.click();
    await expect(page).toHaveURL(/#\/audit$/);
    await expect(page.locator('#admin-rail-toggle')).toContainText('Audit');
    await expect(page.locator('#admin-rail-sections')).toBeHidden();
    await expect(page.locator('#admin-rail-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
}
