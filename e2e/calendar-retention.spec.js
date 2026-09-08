'use strict';

// Two independent browser identities, the real HTTP handler and its ICS feeds.
// No provider is mocked in the browser. The E2E server still uses memory storage,
// dev login and fake billing: this does NOT prove external calendar ingestion.
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');
const { NOTARY_CONTACT } = require('../apps/api/test-support/notary-fixture');

const unfold = text => text.replace(/\r\n[ \t]/g, '');

for (const counterOffer of [false, true]) {
test('partner booking → calendar link → ' + (counterOffer ? 'counter-offer accepted' : 'notary confirmation') + ' → client and signing calendars agree', async ({ page, browser }) => {
  test.setTimeout(90000);
  await gotoHome(page, { suppressOnboarding: true });
  await page.goto('/?lang=en&ref=EVEROY');
  await expect(page.locator('#referral-status')).toContainText('EVEROY');
  await page.locator('.pulse-row[data-svc="financement"]').locator('xpath=..').locator('.mini-reserver').click();
  const sheet = page.locator('#day-dialog');
  const next = sheet.locator('#book-next');
  await next.click();
  await sheet.locator('#crit-valeur_pret').fill('350000');
  await sheet.locator('#crit-contexte__propriete_detenue').click();
  await sheet.locator('#crit-approbation_bancaire__obtenue').click();
  await sheet.locator('#crit-preteur').selectOption('banque_nationale');
  await sheet.locator('#crit-deplacement').selectOption('client_50');
  await next.click();
  await next.click();
  await sheet.locator('#o-prefix').fill('G1R');
  await sheet.locator('#o-name').fill('Client Calendrier Test');
  await sheet.locator('#o-courriel').fill('calendar-client@example.test');
  await expect(sheet.locator('#o-parrain')).toBeVisible();
  await expect(sheet.locator('#o-parrain')).toHaveValue('EVEROY');
  const posted = page.waitForResponse(r => r.url().endsWith('/bids') && r.request().method() === 'POST');
  await sheet.locator('#offer-submit').click();
  const created = await posted;
  expect(created.status(), await created.text()).toBe(201);
  expect(created.request().postDataJSON().parrain).toBe('EVEROY');
  const { bid, clientToken } = await created.json();
  await expect(sheet.locator('#offer-success')).toBeVisible();
  const api = new URL(created.url()).origin;
  const publicResponse = await page.request.get(api + '/carnet/feed.ics');
  expect(publicResponse.ok()).toBeTruthy();
  const event = unfold(await publicResponse.text()).split('BEGIN:VEVENT').find(e => e.includes('UID:' + bid.id + '@nota'));
  expect(event).toBeTruthy();
  const link = event.split('\r\n').find(line => line.startsWith('URL:')).slice(4);
  expect(event.split('\r\n').find(line => line.startsWith('DESCRIPTION:'))).toContain(link);
  expect(event).toContain('DTSTART;VALUE=DATE:' + bid.dateISO.replace(/-/g, ''));
  expect(event).not.toContain(clientToken);

  const notaryContext = await browser.newContext();
  const notary = await notaryContext.newPage();
  try {
    await notary.addInitScript(() => { localStorage.setItem('nota.onboarded.v1', '1'); localStorage.setItem('nota.introSeen', '1'); });
    await notary.goto(link);
    await expect(notary.locator('#pane-notaires')).toBeVisible();
    const verified = notary.waitForResponse(r => r.url().endsWith('/notary/session/verify'));
    await notary.locator('#nc-email').fill('calendar-notary-' + Date.now() + '@example.test');
    await notary.locator('#notary-console-signin').click();
    const session = await (await verified).json();
    await expect(notary.locator('#notary-authed')).toBeVisible();
    // Complete this isolated test identity's required contact profile.
    const saved = await notary.request.post(api + '/notary/profile', {
      headers: { authorization: 'Bearer ' + session.token },
      data: { ...NOTARY_CONTACT, etude: 'Étude Calendrier Test', prefixe: 'G1R', rayonKm: 50 },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await notary.reload();
    const card = notary.locator('#notary-open-list .nc-card[data-id="' + bid.id + '"]');
    await expect(card).toBeVisible();
    let expectedAmount = bid.montant;
    if (counterOffer) {
      await card.locator('.nc-toggle').click();
      await card.locator('.nc-propose-btn').click();
      expectedAmount = Number(await card.locator('.nc-propose-amt').inputValue());
      expect(expectedAmount).toBeGreaterThan(bid.montant);
      await card.locator('.nc-form-msg').fill('Proposition calendrier à confirmer.');
      const proposed = notary.waitForResponse(r => r.url().endsWith('/notary/bids/propose'));
      await card.locator('.nc-propose-send').click();
      const proposalResponse = await proposed;
      expect(proposalResponse.ok(), await proposalResponse.text()).toBeTruthy();
      const { proposition } = await proposalResponse.json();
      await page.keyboard.press('Escape');
      await page.locator('#notif-bell').click();
      await page.locator('#notif-panel .acct-action', { hasText: 'My profile' }).click();
      const proposal = page.locator('.my-offer-prop[data-prop-id="' + proposition.id + '"]');
      await expect(proposal).toContainText('Proposition calendrier à confirmer.');
      const answered = page.waitForResponse(r => r.url().endsWith('/client/propositions/accept'));
      await proposal.locator('.btn-prop-accept').click();
      const response = await answered;
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).bid.montant).toBe(expectedAmount);
      await notary.reload();
    } else {
      await card.locator('.nc-accept').click();
      await expect(notary.locator('#nc-retenir-dialog')).toBeVisible();
      const accepted = notary.waitForResponse(r => r.url().endsWith('/notary/bids/accept'));
      await notary.locator('#nc-retenir-go').click();
      const response = await accepted;
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    await expect(notary.locator('#notary-retained-list .nc-card[data-id="' + bid.id + '"]')).toBeVisible();

    const feed = await notary.locator('#notary-webcal').getAttribute('href');
    expect(new URL(feed).searchParams.get('token')).toBe(session.feedToken);
    expect(feed).not.toContain(session.token);
    expect(new URL(await notary.locator('#notary-outlook').getAttribute('href')).searchParams.get('url')).toBe(feed);
    expect(await notary.locator('#notary-apple').getAttribute('href')).toBe(feed.replace(/^https?:/, 'webcal:'));
    expect(new URL(await notary.locator('#notary-google').getAttribute('href')).searchParams.get('cid')).toBe(feed.replace(/^https?:/, 'webcal:'));
    const retainedFeed = await notary.request.get(feed);
    expect(retainedFeed.ok()).toBeTruthy();
    const text = unfold(await retainedFeed.text());
    expect(text.split('UID:' + bid.id + '@nota').length - 1).toBe(1);
    expect(text).toContain('URL:' + link);
    const clientState = await page.request.get(api + '/client/bid', {
      params: { id: bid.id, dateISO: bid.dateISO }, headers: { authorization: 'Bearer ' + clientToken },
    });
    expect(clientState.ok()).toBeTruthy();
    const current = (await clientState.json()).bid;
    expect(current.status).toBe('retenue');
    expect(current.montant).toBe(expectedAmount);

    // The customer's independent browser sees the actual retained file and
    // can write to the retaining notary, who reads and replies in their own UI.
    await page.keyboard.press('Escape');
    await page.locator('#notif-bell').click();
    await page.locator('#notif-panel .acct-action', { hasText: 'My profile' }).click();
    const clientChat = page.locator('.my-offer-chat[data-id="' + bid.id + '"]');
    await expect(clientChat).toBeVisible();
    await clientChat.locator('.chat-input').fill('Bonjour, voici mon message de test calendrier.');
    const sent = page.waitForResponse(r => r.url().endsWith('/client/bid/message'));
    await clientChat.locator('.client-chat-send').click();
    expect((await sent).ok()).toBeTruthy();
    await notary.reload();
    const retainedCard = notary.locator('#notary-retained-list .nc-card[data-id="' + bid.id + '"]');
    await expect(retainedCard).toContainText('Bonjour, voici mon message de test calendrier.');
    await retainedCard.locator('.chat-input').fill('Bien reçu, réponse du notaire de test.');
    const replied = notary.waitForResponse(r => r.url().endsWith('/notary/bids/message'));
    await retainedCard.locator('.nc-chat-send').click();
    expect((await replied).ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator('.my-offer-chat[data-id="' + bid.id + '"]')).toContainText('Bien reçu, réponse du notaire de test.');


    // A client cancellation must remove the event from both subscriptions.
    const cancelled = await page.request.post(api + '/client/bid/cancel', {
      headers: { authorization: 'Bearer ' + clientToken }, data: { id: bid.id, dateISO: bid.dateISO },
    });
    expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
    for (const url of [feed, api + '/carnet/feed.ics']) {
      const refreshed = await page.request.get(url);
      expect(refreshed.ok()).toBeTruthy();
      expect(unfold(await refreshed.text())).not.toContain('UID:' + bid.id + '@nota');
    }
  } finally { await notaryContext.close(); }
});

}
