'use strict';

/**
 * every-surface.spec — every surface Nota ships, at every size the product
 * meets, on every engine the suite drives.
 *
 * The owner, 2026-09-10: « test in each and every resolution — desktop, laptop,
 * tablet, cell phone — and each and every user agent, and ensure that we have
 * regression tests to cover them. We must avoid adding blank space. »
 *
 * One test per surface. On the chromium project the test walks the seven
 * canonical viewports (a 320 px phone to a 1920 px desktop); on the device
 * projects (firefox, webkit, iPhone 13, Pixel 7, iPad) it measures the surface
 * once at the project's own viewport, with its own pointer and user agent.
 * Every viewport reads the same lens (e2e/layout-lens.js): no sideways scroll,
 * no blank band, no overlapping siblings, no touch target under the product's
 * own 44 px promise, no truncated heading, no uncaught error — and every
 * heading on the display face (Sora), because one brand means one voice on
 * the carnet, the notary console, the admin console, the signing room, the
 * pitch deck and the business plan alike.
 *
 * A failure lists every offending viewport at once, so one red run says
 * exactly which size broke what.
 */
const { test, expect } = require('@playwright/test');
const { measure, settle } = require('./layout-lens');

const ADMIN = `http://localhost:${process.env.E2E_ADMIN_PORT || 4312}`;
const DOCS = `http://localhost:${process.env.E2E_DOCS_PORT || 4313}`;

const VIEWPORTS = [
  { name: 'phone 320', width: 320, height: 568 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'tablet portrait 768', width: 768, height: 1024 },
  { name: 'tablet landscape 1024', width: 1024, height: 800 },
  { name: 'laptop 1280', width: 1280, height: 800 },
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'desktop 1920', width: 1920, height: 1080 },
];

// Seeds run before the first script of the page; they cannot close over
// module scope (Playwright serialises the function), so each is self-contained.
const seenBoth = () => { try { localStorage.setItem('nota.introSeen', '1'); localStorage.setItem('nota.onboarded.v1', '1'); } catch (e) { /* storage blocked */ } };
const seenBothDark = () => { try { localStorage.setItem('nota.introSeen', '1'); localStorage.setItem('nota.onboarded.v1', '1'); localStorage.setItem('nota.theme', JSON.stringify('dark')); } catch (e) { /* storage blocked */ } };
const seenIntroOnly = () => { try { localStorage.setItem('nota.introSeen', '1'); } catch (e) { /* storage blocked */ } };

/** Fill the booking sheet up to a given step. */
async function bookTo(page, step) {
  await page.click('#cta-reserver');
  await page.waitForSelector('#day-dialog[open]');
  if (step < 2) return;
  await page.click('#o-service-chips [data-svc="financement"]');
  await page.click('#book-next');
  await page.waitForSelector('#offer-form[data-at="2"]');
  if (step < 3) return;
  await page.fill('#crit-valeur_pret', '350000');
  await page.click('#crit-contexte__propriete_detenue');
  await page.click('#crit-approbation_bancaire__obtenue');
  await page.selectOption('#crit-preteur', 'banque_nationale');
  await page.selectOption('#crit-deplacement', 'client_50');
  await page.click('#book-next');
  await page.waitForSelector('#offer-form[data-at="3"]');
  if (step < 4) return;
  await page.click('#book-next');
  await page.waitForSelector('#offer-form[data-at="4"]');
}

/** Sign an operator in through the dev-echoed magic link and land on a view. */
async function adminInto(page, request, view) {
  // The console keeps its session in memory only (never in storage): a reload
  // signs the operator out. Sign in once per test through the dev-echoed
  // magic link, then move between views by changing the hash in place.
  const alive = page.url().startsWith(ADMIN) && (await page.locator('.admin-rail').count());
  if (!alive) {
    await page.goto(`${ADMIN}/?lang=fr#/${view}`);
    const login = await request.post(`${ADMIN}/api/admin/auth/request`, { data: { email: 'admin@nota.local' } });
    const body = await login.json();
    if (!body.devLink) throw new Error('admin dev link not echoed: ' + JSON.stringify(body));
    await page.evaluate((h) => { location.hash = h; }, new URL(body.devLink).hash);
    await page.waitForSelector('.admin-rail', { timeout: 20_000 });
  }
  if (!page.url().endsWith('#/' + view)) await page.evaluate((h) => { location.hash = h; }, '#/' + view);
  await page.waitForSelector('.admin-content', { timeout: 20_000 });
  await page.waitForTimeout(500);
}

/**
 * The surfaces. `root` is the column the lens measures for blank bands;
 * `wait` proves the surface rendered; `open` reaches a state past the load.
 */
const SURFACES = [
  { key: 'carnet', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', root: '#pane-carnet' },
  { key: 'carnet, English, dark theme', url: '/?lang=en', seed: seenBothDark, wait: '#pulse-rows .pulse-row', root: '#pane-carnet', theme: 'dark' },
  { key: 'notaires (signed out)', url: '/?lang=fr#t=notaires', seed: seenBoth, wait: '#notary-live-grid', root: '#pane-notaires' },
  { key: 'partenaires', url: '/?lang=fr#t=partenaires', seed: seenBoth, wait: '.pr-hero', root: '#pane-partenaires' },
  { key: 'signature beta', url: '/?lang=fr#t=beta', seed: seenBoth, wait: '#pane-beta h1', root: '#pane-beta' },
  { key: 'confidentialité', url: '/?lang=fr#t=confidentialite', seed: seenBoth, wait: '#pane-confidentialite', root: '#pane-confidentialite' },
  { key: 'conditions', url: '/?lang=fr#t=conditions', seed: seenBoth, wait: '#pane-conditions', root: '#pane-conditions' },
  { key: 'charte', url: '/?lang=fr#t=charte', seed: seenBoth, wait: '#pane-charte', root: '#pane-charte' },
  { key: 'mes offres (empty)', url: '/?lang=fr#t=profil', seed: seenBoth, wait: '#profil-body', root: '#pane-profil' },
  { key: 'dossier', url: '/?lang=fr#t=dossier', seed: seenBoth, wait: '#dossier-list', root: '#pane-dossier' },
  { key: 'booking sheet · step 1', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', open: (p) => bookTo(p, 1), root: '#day-dialog' },
  { key: 'booking sheet · step 2', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', open: (p) => bookTo(p, 2), root: '#day-dialog' },
  { key: 'booking sheet · step 3', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', open: (p) => bookTo(p, 3), root: '#day-dialog' },
  { key: 'booking sheet · step 4', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', open: (p) => bookTo(p, 4), root: '#day-dialog' },
  { key: 'auth dialog', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row',
    open: async (p) => { await p.evaluate(() => (document.getElementById('header-login') || document.getElementById('mnav-login')).click()); await p.waitForSelector('#auth-dialog[open]'); }, root: '#auth-dialog' },
  { key: 'mobile drawer', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row', maxWidth: 899,
    open: async (p) => { await p.click('#nav-burger'); await expect(p.locator('#mobile-nav')).toBeVisible(); }, root: '#mobile-nav' },
  { key: 'notary console (signed in)', url: '/?lang=fr#t=notaires', seed: seenBoth, wait: '#nc-email, #notary-authed:not([hidden])',
    open: async (p) => {
      // The session survives a reload (ncRestore): sign in once, then only resize.
      if (!(await p.locator('#notary-authed:not([hidden])').count())) {
        await p.fill('#nc-email', 'lens.notaire@etude.ca');
        await p.click('#notary-console-signin');
      }
      await p.waitForSelector('#notary-authed:not([hidden])', { timeout: 15_000 });
      await p.waitForSelector('#notary-open-list .nc-card, #notary-open-empty:not([hidden])', { timeout: 15_000 });
    }, root: '#pane-notaires' },
  { key: 'support chat', url: '/?lang=fr', seed: seenBoth, wait: '#pulse-rows .pulse-row',
    open: async (p) => {
      await p.evaluate(() => { const f = document.getElementById('chat-fab'); if (f && f.offsetParent) f.click(); else { document.getElementById('nav-burger').click(); document.getElementById('mnav-messagerie').click(); } });
      await expect(p.locator('#chat-panel')).toBeVisible();
    }, root: '#chat-panel' },
  { key: 'signing room · welcome', url: '/signature.html?lang=fr', seed: () => {}, wait: '#welcome', root: 'body' },
  { key: 'admin · sign-in', url: `${ADMIN}/?lang=fr`, seed: () => {}, wait: '#auth-email', root: '#app' },
  { key: 'admin · aperçu', admin: '', root: '#app' },
  { key: 'admin · courriels', admin: 'courriels', root: '#app' },
  { key: 'admin · messagerie', admin: 'support', root: '#app' },
  { key: 'admin · accès', admin: 'acces', root: '#app' },
  { key: 'admin · CRM', admin: 'crm', root: '#app' },
  { key: 'admin · usagers', admin: 'usagers', root: '#app' },
  { key: 'pitch deck', url: `${DOCS}/pitch-deck.html`, seed: () => {}, wait: '#slide', root: 'body' },
  { key: 'business plan', url: `${DOCS}/business-plan.html`, seed: () => {}, wait: '#plan-en', root: 'body' },
  { key: 'brand guide', url: '/brand.html', seed: () => {}, wait: 'h1', root: 'body' },
];

// The two first-visit surfaces exist only WITHOUT reduced motion (the films
// and the guide are suppressed for a visitor who asked for less motion).
const MOTION_SURFACES = [
  { key: 'intro gate (first visit)', url: '/?lang=fr', seed: () => {}, wait: '#intro-gate:not([hidden])', root: '#intro-gate' },
  { key: 'onboarding guide', url: '/?lang=fr', seed: seenIntroOnly, wait: '#onboarding-dialog[open]', root: '#onboarding-dialog' },
];

async function sweep(page, request, surface, testInfo) {
  const chromium = testInfo.project.name === 'chromium';
  const touch = !!testInfo.project.use.hasTouch;
  const sizes = chromium ? VIEWPORTS : [{ name: testInfo.project.name, ...testInfo.project.use.viewport }];
  const failures = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  if (surface.seed) await page.addInitScript(surface.seed);

  for (const vp of sizes) {
    if (surface.maxWidth && vp.width > surface.maxWidth) continue;
    errors.length = 0;
    if (chromium) await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      if (surface.admin !== undefined) await adminInto(page, request, surface.admin);
      else {
        await page.goto(surface.url);
        await page.waitForSelector(surface.wait, { timeout: 20_000 });
        if (surface.open) await surface.open(page);
      }
      await settle(page);
      const m = await page.evaluate(measure, { rootSel: surface.root, touch, vw: vp.width, vh: vp.height, allowOverlap: ['.pulse-row', '.mini-reserver'] });
      const at = `[${vp.name}]`;
      if (m.sideways) failures.push(`${at} scrolls sideways (${m.scrollW} > ${m.clientW}): ${m.offenders.join('; ') || 'no outermost offender found'}`);
      for (const b of m.bands) failures.push(`${at} blank band: ${b}`);
      for (const o of m.overlaps) failures.push(`${at} overlap: ${o}`);
      for (const s of m.small) failures.push(`${at} touch target under 44px: ${s}`);
      for (const c of m.clippedText) failures.push(`${at} truncated heading: ${c}`);
      for (const f of m.headingFonts) if (f !== 'Sora') failures.push(`${at} heading not on the display face: ${f}`);
      if (surface.theme && m.theme !== surface.theme) failures.push(`${at} theme is ${m.theme}, expected ${surface.theme}`);
      for (const e of errors) failures.push(`${at} page error: ${e}`);
    } catch (e) {
      failures.push(`[${vp.name}] could not reach the surface: ${String(e.message).split('\n')[0].slice(0, 200)}`);
    }
  }
  expect(failures, `${surface.key} holds its shape at every size`).toEqual([]);
}

test.describe('every surface at every size', () => {
  for (const surface of SURFACES) {
    test(surface.key, async ({ page, request }, testInfo) => {
      test.setTimeout(testInfo.project.name === 'chromium' ? 180_000 : 60_000);
      await sweep(page, request, surface, testInfo);
    });
  }
});

test.describe('the first-visit surfaces (motion allowed)', () => {
  test.use({ reducedMotion: 'no-preference' });
  for (const surface of MOTION_SURFACES) {
    test(surface.key, async ({ page, request }, testInfo) => {
      test.setTimeout(testInfo.project.name === 'chromium' ? 180_000 : 60_000);
      await sweep(page, request, surface, testInfo);
    });
  }
});
