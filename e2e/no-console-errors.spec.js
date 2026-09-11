'use strict';

/**
 * no-console-errors.spec — the app boots and books clean.
 *
 * Visits the home page and opens the booking sheet, asserting no severe console
 * errors, no uncaught page errors, and no failed SAME-ORIGIN requests (the app
 * origin and its demo API). Cross-origin resources — e.g. the optional web font
 * from rsms.me — are ignored: their availability is not the app's contract and
 * would make this flaky offline.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

// A request/console entry is "ours" (and therefore in scope) only when it is
// same-origin: localhost. Everything else (fonts, analytics) is out of scope.
function isLocal(url) {
  return /^https?:\/\/localhost[:/]/.test(url || '');
}

// Analytics beacons are best-effort keepalive requests. They remain in
// Chromium's network queue longer than the UI work they trigger, so they must
// not hold the application-settlement gate open. Their failures are still
// recorded below and remain assertions.
function isTelemetry(url) {
  return /\/events(?:\?|$)/.test(url || '');
}

test('home and booking load with no severe console errors or failed requests', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const pendingLocal = new Set();
  let lastLocalActivity = Date.now();
  const settleLocal = request => {
    if (pendingLocal.delete(request)) lastLocalActivity = Date.now();
  };
  page.on('request', request => {
    if (isLocal(request.url()) && !isTelemetry(request.url())) {
      pendingLocal.add(request);
      lastLocalActivity = Date.now();
    }
  });
  page.on('requestfinished', settleLocal);
  // Record the carnet feed status as it arrives (registering a listener up front
  // avoids racing the fetch that gotoHome already waits on).
  let bidsStatus = null;
  // Requests that DID get a 2xx: Chromium reports a bodiless 204 to a fetch
  // (the funnel beacon, POST /events) as `requestfailed` / net::ERR_ABORTED
  // right after the response has arrived — the promise resolved with 204, the
  // server counted the step, nothing failed. Only a request that never got a
  // response is a failed request.
  const answered = new WeakSet();
  page.on('response', (resp) => {
    const url = resp.url();
    if (resp.status() < 300) answered.add(resp.request());
    if (resp.status() === 204) settleLocal(resp.request());
    if (/\/bids\?month=/.test(url)) bidsStatus = resp.status();
    // A same-origin 5xx is a real server fault; 4xx here would be an app bug too.
    if (isLocal(url) && resp.status() >= 500) badResponses.push(`${resp.status()} ${url}`);
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Location URL is the most reliable origin signal; fall back to the text.
    const loc = (msg.location && msg.location()) || {};
    const url = loc.url || '';
    if (url && !isLocal(url)) return; // cross-origin resource noise
    consoleErrors.push(`${msg.text()}  @${url}`);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('requestfailed', (req) => {
    settleLocal(req);
    if (!isLocal(req.url())) return; // external font/resource failures are not ours
    if (answered.has(req)) return; // a 2xx already landed — see `answered` above
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure() && req.failure().errorText}`);
  });

  // --- Home -------------------------------------------------------------------
  await gotoHome(page, { suppressOnboarding: true });
  // The month feed the home depends on must have come back OK.
  expect(bidsStatus, 'GET /bids should serve the carnet').toBe(200);

  // --- Booking sheet ----------------------------------------------------------
  // Open a real booking from the home pulse. The mini CTA is addressed by its
  // own class (`.mini-reserver`, the sibling button of the filter row) rather
  // than by its accessible NAME: that name is copy, it is translated, and it is
  // rewritten whenever the pricing story changes. What this spec cares about is
  // that a real booking opens with a clean console, not what the button says.
  await page.locator('.pulse-row[data-svc="financement"]').first().waitFor();
  await page.locator('.pulse-item', { has: page.locator('[data-svc="financement"]') })
    .locator('.mini-reserver').click();
  await expect(page.locator('#day-dialog')).toBeVisible();
  // Match this test's origin boundary: external fonts can remain in flight
  // without being an application failure. Still wait for local lazy requests.
  await expect.poll(() => pendingLocal.size === 0 && Date.now() - lastLocalActivity >= 500,
    { timeout: 15000, message: 'Nota requests settle before checking errors' }).toBe(true);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(failedRequests, `failed same-origin requests:\n${failedRequests.join('\n')}`).toEqual([]);
  expect(badResponses, `same-origin 5xx responses:\n${badResponses.join('\n')}`).toEqual([]);
});
