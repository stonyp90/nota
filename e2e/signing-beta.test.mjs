import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { startSigningFixture } from './servers/signing-fixture.mjs';

test('two authenticated browsers exchange real encrypted media and sign the same test document', { timeout: 150000 }, async () => {
  const fixture = await startSigningFixture();
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'] });
  const pages = {}, errors = [], signalConflicts = new Set();
  try {
    for (const role of ['notary', 'client']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['camera', 'microphone'] });
      await context.addInitScript(({ role, token, bid }) => {
        if (role === 'notary') localStorage.setItem('nota.notary.token', JSON.stringify(token));
        else localStorage.setItem('nota.myoffers.v1', JSON.stringify([{ id: bid.id, dateISO: bid.dateISO, clientToken: token }]));
        const RTC = window.RTCPeerConnection;
        window.__testPeers = []; window.__testIceErrors = [];
        window.RTCPeerConnection = class extends RTC { constructor(config) { super(config); window.__testPeers.push(this); this.addEventListener('icecandidateerror', event => window.__testIceErrors.push({ code:event.errorCode, message:event.errorText, url:event.url })); } };
      }, { role, token: fixture.tokens[role], bid: fixture.bid });
      const page = await context.newPage(); pages[role] = page;
      // A heartbeat can win the revision between GET and POST /signal.
      // Reject each participant's first signal and require the real handshake
      // to recover; all subsequent signaling and media use the real server.
      await page.route('**/api/signing-beta/sessions/*/signal', async route => {
        if (!signalConflicts.has(role)) {
          signalConflicts.add(role);
          await route.fulfill({ status:409, contentType:'application/json', body:JSON.stringify({ errors:[{ code:'conflit_revision' }] }) });
        } else await route.continue();
      });
      page.setDefaultTimeout(20000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', async r => { if (r.url().includes('/signing-beta/') && r.status() >= 400) console.log(role, 'API', new URL(r.url()).pathname, r.status(), await r.text()); });
      await page.goto(fixture.baseURL + '/signature.html?bidId=' + fixture.bid.id + '&dateISO=' + fixture.bid.dateISO + '&role=' + role);
      await expect(page.locator('#workspace')).toBeVisible();
      await page.locator('#camera-test').click();
      await page.locator('#beta-consent').check();
    }
    const n = pages.notary, c = pages.client;
    await n.locator('#join-button').click();
    await c.locator('#join-button').click();
    await n.locator('#admit-button').click();
    for (const page of [n, c]) {
      await expect(page.locator('#verification-panel')).toBeVisible({ timeout: 65000 });
      await page.locator('#peer-verified').check();
    }
    assert.equal(await n.locator('#connection-fingerprint').textContent(), await c.locator('#connection-fingerprint').textContent());
    assert.equal(signalConflicts.size, 2, 'both participants recovered from a stale signal revision');
    if (process.env.NOTA_SIGNING_TEST_RECONNECT === 'true') {
      const firstFingerprint = await n.locator('#connection-fingerprint').textContent();
      // Fault injection at the transport boundary, followed by the real UI
      // recovery path. No server or media success response is mocked.
      await n.evaluate(() => { const p = window.__testPeers.at(-1); p.close(); p.dispatchEvent(new Event('connectionstatechange')); });
      await n.locator('#reconnect-button').click();
      for (const page of [n, c]) {
        await expect(page.locator('#verification-panel')).toBeVisible({ timeout: 65000 });
        await page.locator('#peer-verified').check();
      }
      assert.equal(await n.locator('#connection-fingerprint').textContent(), await c.locator('#connection-fingerprint').textContent());
      assert.notEqual(await n.locator('#connection-fingerprint').textContent(), firstFingerprint);
    }
    await n.locator('#identity-confirmed').check();
    await n.locator('#verify-button').click();
    await n.locator('#review-button').click();
    await n.locator('#release-button').click();
    await expect(c.locator('#signing-controls')).toBeVisible();
    // A camera interruption must revoke permission before any acknowledgment.
    await c.locator('#camera-button').click();
    await expect(n.locator('#status-title')).toHaveText('La séance est en pause.');
    await expect(c.locator('#sign-button')).toBeDisabled();
    await c.locator('#camera-button').click();
    await n.locator('#review-button').click();
    await n.locator('#release-button').click();
    for (const page of [c, n]) {
      await page.locator('#sign-consent').check();
      await page.locator('#sign-button').click();
    }
    await expect(n.locator('#receipt-button')).toBeVisible();
    await expect(c.locator('#receipt-button')).toBeVisible();
    const downloadPromise = n.waitForEvent('download');
    await n.locator('#receipt-button').click();
    const download = await downloadPromise;
    const evidence = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(evidence.acknowledgments.length, 2);
    assert.equal(evidence.status, 'complete');
    assert.equal(await fixture.repo.getActCompletion(fixture.bid.id), null);
    const stats = await c.evaluate(async () => {
      const pc = window.__testPeers.at(-1);
      const reports = [...(await pc.getStats()).values()];
      const transport = reports.find(r => r.type === 'transport' && r.selectedCandidatePairId);
      const pair = transport && reports.find(r => r.id === transport.selectedCandidatePairId);
      const candidate = pair && reports.find(r => r.id === pair.localCandidateId);
      return { state: pc.connectionState, inbound: reports.filter(r => r.type === 'inbound-rtp').map(r => ({ kind: r.kind, bytesReceived: r.bytesReceived })),
        candidateType: candidate?.candidateType,
        transports: reports.filter(r => r.type === 'transport').map(r => ({ dtlsState: r.dtlsState, selectedCandidatePairId: !!r.selectedCandidatePairId })) };
    });
    assert.equal(stats.state, 'connected');
    assert.ok(stats.inbound.some(r => r.kind === 'video' && r.bytesReceived > 0));
    assert.ok(stats.inbound.some(r => r.kind === 'audio' && r.bytesReceived > 0));
    assert.ok(stats.transports.some(r => r.dtlsState === 'connected'));
    if (process.env.NOTA_SIGNING_TURN_URLS) assert.equal(stats.candidateType, 'relay');
    assert.deepEqual(errors, []);
    await mkdir('output/signing-beta-qa', { recursive: true });
    await n.screenshot({ path: 'output/signing-beta-qa/completed-desktop.png', fullPage: true });
    console.log('WebRTC verified:', JSON.stringify(stats));
    await c.locator('#leave-button').click();
    assert.equal(await c.evaluate(() => document.querySelector('#local-video').srcObject), null);
  } catch (error) {
    await mkdir('output/signing-beta-qa', { recursive: true });
    for (const [role, page] of Object.entries(pages)) {
      await page.screenshot({ path: 'output/signing-beta-qa/failure-' + role + '.png', fullPage: true });
      console.log(role, await page.locator('#status-title').textContent(), await page.locator('#notice').textContent());
      console.log(role, await page.evaluate(() => window.__testPeers.map(p => ({ connection:p.connectionState,ice:p.iceConnectionState,gather:p.iceGatheringState,signal:p.signalingState,local:!!p.localDescription,remote:!!p.remoteDescription,localCandidates:(p.localDescription?.sdp.match(/a=candidate:/g)||[]).length }))));
      console.log(role, 'ICE errors:', await page.evaluate(() => window.__testIceErrors));
      console.log(role, 'RTC configuration:', await page.evaluate(() => window.__testPeers.map(p=>({policy:p.getConfiguration().iceTransportPolicy,servers:p.getConfiguration().iceServers.map(s=>({urls:s.urls,hasCredential:!!s.credential,role:s.username?.split(':').at(-1)}))}))));
    }
    console.log('Browser errors:', errors);
    throw error;
  } finally { await browser.close(); await fixture.close(); }
});
