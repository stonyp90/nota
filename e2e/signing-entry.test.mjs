import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { startSigningFixture } from './servers/signing-fixture.mjs';

test('Nota mailbox sign-in returns each participant to the requested signing dossier', { timeout: 60000 }, async () => {
  const fixture = await startSigningFixture();
  const browser = await chromium.launch();
  try {
    for (const role of ['client', 'notary']) {
      const context = await browser.newContext();
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const target = '/signature.html?bidId=' + fixture.bid.id + '&dateISO=' + fixture.bid.dateISO + '&role=' + role;
      await page.goto(fixture.baseURL + target);
      await expect(page.locator('#signin-link')).toHaveText('Connexion requise pour ce dossier');
      await page.locator('#signin-link').click();
      await expect(page).toHaveURL(new RegExp('#t=' + (role === 'client' ? 'profil' : 'notaires') + '$'));
      const request = await fixture.app.handle({ path: '/' + role + '/session/request', method:'POST', headers:{},
        sourceIp:'127.0.0.1', body:role === 'client' ? {courriel:'client@example.test'} : {email:'notaire@example.test'} });
      const challenge = JSON.parse(request.body).devToken;
      assert.ok(challenge);
      const emailTab = await context.newPage(); emailTab.setDefaultTimeout(15000);
      await emailTab.goto(fixture.baseURL + '/#' + (role === 'client' ? 'cauth=' : 'nauth=') + encodeURIComponent(challenge));
      await expect(emailTab).toHaveURL(fixture.baseURL + target, { timeout: 20000 });
      await expect(emailTab.locator('#workspace')).toBeVisible();
      assert.equal(await emailTab.evaluate(() => localStorage.getItem('nota.signing.return')), null);
      await context.close();
    }
  } finally { await browser.close(); await fixture.close(); }
});
