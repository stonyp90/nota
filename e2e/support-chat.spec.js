'use strict';
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

test('lost first response retries into one conversation and one message', async ({ page }) => {
  await gotoHome(page, { suppressOnboarding: true });
  await page.locator('#chat-fab').click();
  let saved, drop = true;
  const bodies = [];
  await page.route('**/support/messages', async route => {
    bodies.push(route.request().postDataJSON());
    if (drop) {
      drop = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      saved = await response.json();
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await page.locator('#chat-text').fill('Je souhaite parler à une personne.');
  await page.locator('#chat-send').click();
  await expect(page.locator('#chat-error')).toBeVisible();
  await expect(page.locator('#chat-text')).toHaveValue('Je souhaite parler à une personne.');
  const repeated = page.waitForResponse(r => r.url().endsWith('/support/messages') && r.request().method() === 'POST');
  await page.locator('#chat-send').click();
  const result = await (await repeated).json();
  expect(result.duplicate).toBe(true);
  expect(result.threadId).toBe(saved.threadId);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(1);
});

for (const entry of ['fresh document', 'open tab']) test(`a signed customer link restores the existing conversation from a ${entry}`, async ({ page, request }) => {
  const sent = await request.post(`http://localhost:${process.env.E2E_API_PORT || 8811}/support/messages`, { data: { texte: 'Ma conversation sur un autre appareil.' } });
  expect(sent.status()).toBe(201);
  const conversation = await sent.json();
  await gotoHome(page, { suppressOnboarding: true });
  if (entry === 'fresh document') await page.goto('about:blank');
  await page.goto('/?lang=en#messagerie=' + encodeURIComponent(conversation.token));
  await expect(page.locator('#chat-panel')).toBeVisible();
  await expect(page.locator('#chat-log')).toContainText('Ma conversation sur un autre appareil.');
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nota.support.v1')).threadId)).toBe(conversation.threadId);
  await page.locator('#chat-text').fill('Une précision dans la même conversation.');
  await page.locator('#chat-send').click();
  await expect(page.locator('#chat-text')).toHaveValue('');
  await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(2);
});

for (const lang of ['fr', 'en']) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 600 }]) {
    test(`support discovery, delivery recovery and focus ${lang} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await gotoHome(page, { suppressOnboarding: true });
      await page.goto('/?lang=' + lang);
      if (viewport.width < 900) {
        await page.locator('#nav-burger').click();
        await page.locator('#mnav-messagerie').click();
      } else await page.locator('#chat-fab').click();
      const panel = page.locator('#chat-panel');
      await expect(panel).toBeVisible();
      await page.locator('#chat-topics summary').click();
      await page.locator('#chat-topic-search').fill(lang === 'fr' ? 'preteur' : 'lender');
      const result = page.locator('#chat-topic-list button:visible');
      await expect(result).toHaveCount(1);
      await result.click();
      const input = page.locator('#chat-text');
      await expect(input).toBeFocused();
      await expect(input).not.toHaveValue('');
      // The search/topic action prepares a message; a failed POST preserves it.
      const draft = await input.inputValue();
      await page.route('**/support/messages', route => route.abort('internetdisconnected'));
      await page.locator('#chat-send').click();
      await expect(page.locator('#chat-error')).toBeVisible();
      await expect(input).toHaveValue(draft);
      await expect(page.locator('#chat-log [data-id^="local-"]')).toHaveCount(0);
      await page.unroute('**/support/messages');
      await page.locator('#chat-send').click();
      await expect(input).toHaveValue('');
      await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(1);
      await expect(page.locator('#chat-courriel-row')).toBeHidden();
      await page.locator('#chat-courriel-open').click();
      await page.locator('#chat-courriel').fill('chat-followup@example.test');
      const saved = page.waitForResponse(r => r.url().endsWith('/support/thread') && r.request().method() === 'PATCH');
      await page.locator('#chat-courriel-save').click();
      expect((await saved).status()).toBe(200);
      await expect(page.locator('#chat-courriel-status')).toContainText(lang === 'fr' ? 'enregistré' : 'saved');
      await expect(page.locator('#chat-log .sup-msg[data-de="visiteur"]')).toHaveCount(1);
      const size = await panel.boundingBox();
      expect(size.x).toBeGreaterThanOrEqual(0);
      expect(size.x + size.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(size.y + size.height).toBeLessThanOrEqual(viewport.height + 1);
      await input.press('Escape');
      await expect(panel).toBeHidden();
      await expect(page.locator(viewport.width < 900 ? '#nav-burger' : '#chat-fab')).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
