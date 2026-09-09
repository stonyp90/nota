'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');
const ADMIN = `http://localhost:${process.env.E2E_ADMIN_PORT || 4312}`;

for (const lang of ['fr', 'en']) {
  test(`admin replies and closes the widget conversation ${lang}`, async ({ page, context, request }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await gotoHome(page, { suppressOnboarding: true });
    await page.goto('/?lang=' + lang);
    await page.locator('#chat-fab').click();
    const question = 'Question de soutien ' + lang + ' ' + Date.now();
    await page.locator('#chat-text').fill(question);
    const accepted = page.waitForResponse(r => r.url().endsWith('/support/messages') && r.request().method() === 'POST');
    await page.locator('#chat-send').click();
    expect((await accepted).status()).toBe(201);
    await expect.poll(() => page.evaluate(() => !!JSON.parse(localStorage.getItem('nota.support.v1'))?.token)).toBe(true);
    await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(1);
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('nota.support.v1')));
    const admin = await context.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    // Opening the emailed deep link before authentication preserves the thread
    // destination through the existing admin magic-link gate.
    await admin.goto(ADMIN + '/?lang=' + lang + '#/support?thread=' + encodeURIComponent(session.threadId));
    const login = await request.post(ADMIN + '/api/admin/auth/request', { data: { email: 'admin@nota.local' } });
    expect(login.ok()).toBeTruthy();
    const { devLink } = await login.json();
    await admin.goto(ADMIN + '/?lang=' + lang + new URL(devLink).hash);
    await expect(admin.locator('#support-log')).toContainText(question);
    const reply = lang === 'fr' ? 'Bonjour, comment puis-je vous aider?' : 'Hello, how can I help?';
    await admin.locator('#support-text').fill(reply);
    // A saved reply with a lost HTTP response can be retried safely using the
    // same message identifier. The real API, not a stub, stores both requests.
    let drop = true;
    await admin.route('**/api/admin/support/*/reponse', async route => {
      if (drop) { drop = false; await route.fetch(); await route.abort('connectionfailed'); }
      else await route.continue();
    });
    await admin.locator('#support-send').click();
    await expect(admin.locator('#support-text')).toHaveValue(reply);
    await expect(admin.locator('#support-send')).toBeEnabled();
    await admin.locator('#support-send').click();
    await expect(admin.locator('#support-text')).toHaveValue('');
    await expect(admin.locator('#support-log [data-from="nota"]')).toHaveCount(1);
    await page.bringToFront();
    await page.reload();
    if (!(await page.locator('#chat-panel').isVisible())) await page.locator('#chat-fab').click();
    await expect(page.locator('#chat-log .sup-msg[data-de="nota"]')).toHaveCount(1);
    await expect(page.locator('#chat-log')).toContainText(reply);
    await admin.bringToFront();
    await admin.locator('#support-close').click();
    await expect(admin.locator('#support-close')).toBeHidden();
    await page.bringToFront();
    await page.locator('#chat-text').fill('Une précision pour la même conversation.');
    await page.locator('#chat-send').click();
    await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(2);
    await admin.bringToFront();
    await admin.locator('#support-refresh').click();
    await expect(admin.locator('#support-log [data-from="visiteur"]')).toHaveCount(2);
    await expect(admin.locator('#support-close')).toBeVisible();
    await expect(admin.locator('#support-close')).toBeEnabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nota.support.v1')).threadId)).toBe(session.threadId);
    expect(errors).toEqual([]);
  });
}
