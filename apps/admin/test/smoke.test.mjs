/**
 * Headless DOM smoke tests for the Nota admin console (apps/admin/public).
 *
 * admin.js is a strict-CSP IIFE that exposes NOTHING on window — every helper is
 * module-private by design (the session bearer must not be reachable). So we test
 * it the way a browser exercises it: load index.html in jsdom, eval admin.js to
 * boot it, stub window.fetch to play the admin API, and assert on the DOM it
 * renders. That drives the real formatters (money, rate, dates) and the real
 * router/auth/overview code paths — nothing about the app is duplicated here.
 *
 * jsdom does NOT fetch external <script>s, so we build the DOM with
 * runScripts:'outside-only' and eval the source from disk inside the window.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fetch stub that plays the admin API. `handler(method, url, body)` returns
 * [status, jsonBody]; status 0 simulates a network failure (fetch rejects).
 * Every call is recorded on `calls` for assertions.
 */
function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
    calls.push({ method, url: String(url), body });
    const out = handler(method, String(url), body) || [404, null];
    const [status, json] = out;
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
    });
  };
}

// A signed-in window schedules a ~59-min session-refresh timer; left open it
// would keep Node's event loop alive and `node --test` would never exit. Track
// every window and close them all once the suite finishes.
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

/** Boot a fresh window at `hash`, with the API stubbed by `handler`. */
async function boot(handler, hash) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC); // IIFE boots synchronously; async router work settles below
  await settle(win);
  return { win, calls, doc: win.document };
}

/** Poll until `sel` appears (or timeout) so chained async fetches can resolve. */
async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}
/** Let a burst of queued micro/macro tasks drain. */
async function settle(win) { for (let i = 0; i < 3; i++) await wait(5); }

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();

// A representative non-empty overview payload used by several tests.
function sampleOverview(over) {
  return Object.assign({
    kpis: { offersPosted: 120, offersRetained: 48, actsCompleted: 31, commissionCents: 1234567, retentionRate: 0.4 },
    gauge: { open: 12, retained: 48, activeNotaries: 9, onboardingNotaries: 3 },
    series: {
      offersPerDay: [
        { date: '2026-08-01', count: 3 },
        { date: '2026-08-02', count: 5 },
        { date: '2026-08-03', count: 2 },
      ],
      byService: [
        { serviceId: 'testament', nom: 'Testament', offers: 60, retained: 25 },
        { serviceId: 'procuration', nom: 'Procuration', offers: 60, retained: 23 },
      ],
    },
  }, over || {});
}

// The happy-path API: either login method verifies, /me returns a super admin, metrics OK.
function authedApi(overview) {
  const data = overview || sampleOverview();
  return (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess-token', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess-token-2', expiresAt: futureISO() }];
    if (url.includes('/auth/logout')) return [200, { ok: true }];
    if (url.endsWith('/me') || url.includes('/me?')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: [] }];
    if (url.includes('/metrics/overview')) return [200, data];
    return [404, null];
  };
}

// ---------------------------------------------------------------------------

test('unauthenticated boot renders the magic-link request gate', async () => {
  const { doc } = await boot(() => [404, null], '');
  assert.equal(text(doc.querySelector('.auth-title')), 'Console Nota');
  assert.ok(doc.querySelector('input#auth-email'), 'email input is missing');
  const submit = doc.querySelector('.auth-form button[type="submit"]');
  assert.equal(text(submit), 'Recevoir le lien');
  assert.ok(doc.querySelector('input#auth-password'), 'password input is missing');
  assert.ok(doc.querySelector('.auth-password-help'), 'password recovery behavior should be explained beside the field');
  const toggle = doc.querySelector('.password-toggle');
  assert.ok(toggle, 'password visibility control is missing');
  const password = doc.querySelector('#auth-password');
  assert.equal(password.type, 'password');
  toggle.click();
  assert.equal(password.type, 'text');
  assert.equal(toggle.textContent, 'Masquer');
  assert.equal(toggle.getAttribute('aria-label'), 'Masquer le mot de passe');
  toggle.click();
  assert.equal(password.type, 'password');
  assert.equal(toggle.textContent, 'Afficher');
  assert.equal(toggle.getAttribute('aria-label'), 'Afficher le mot de passe');
});

test('the normal login form posts email and password and renders the overview', async () => {
  const handler = (method, url, body) => {
    if (url.includes('/auth/login')) {
      assert.equal(body.email, 'ops@nota.ca');
      assert.equal(body.password, 'secret-password');
      return [200, { ok: true, session: 'password-session', expiresAt: futureISO(), role: 'super_admin' }];
    }
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: [] }];
    if (url.includes('/metrics/overview')) return [200, sampleOverview()];
    return [404, null];
  };
  const { win, doc } = await boot(handler, '');
  doc.querySelector('#auth-email').value = 'ops@nota.ca';
  const password = doc.querySelector('#auth-password');
  password.value = 'secret-password';
  password.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(text(doc.querySelector('.auth-form button[type="submit"]')), 'Se connecter');
  doc.querySelector('.auth-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(win, '.page-title');
  assert.equal(text(doc.querySelector('.page-title')), 'Aperçu');
});

test('an invalid email is rejected client-side (no request sent)', async () => {
  const { win, doc, calls } = await boot(() => [200, { ok: true }], '');
  const input = doc.querySelector('#auth-email');
  const form = doc.querySelector('.auth-form');
  input.value = 'not-an-email';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.match(text(doc.querySelector('.auth-error')), /Courriel invalide/);
  assert.equal(calls.filter((c) => c.url.includes('/auth/request')).length, 0, 'a request should not have been sent for a bad email');
});

test('a valid email sends the request and shows a neutral, non-enumerating note', async () => {
  const handler = (m, url) => (url.includes('/auth/request') ? [200, { ok: true, devLink: '#/auth?token=DEV123' }] : [404, null]);
  const { win, doc, calls } = await boot(handler, '');
  doc.querySelector('#auth-email').value = 'ops@nota.ca';
  doc.querySelector('.auth-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(win, '.auth-note');
  // Neutral copy — must NOT confirm whether the address is authorized.
  assert.match(text(doc.querySelector('.auth-note')), /Si cette adresse est autorisée/);
  const req = calls.find((c) => c.url.includes('/auth/request'));
  assert.ok(req && req.body && req.body.email === 'ops@nota.ca', 'the entered email should be POSTed');
  // Dev-only convenience link is surfaced when the API returns it.
  const dev = doc.querySelector('.auth-devlink a');
  assert.ok(dev && dev.getAttribute('href').includes('token=DEV123'), 'dev link should be rendered');
});

test('a valid magic link verifies and renders the overview with correctly formatted KPIs', async () => {
  const { win, doc } = await boot(authedApi(), '#/auth?token=GOODTOKEN');
  await waitFor(win, '.page-title');
  assert.equal(text(doc.querySelector('.page-title')), 'Aperçu');

  // The private formatters are exercised through the rendered tiles.
  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Offres publiées'), '120');
  assert.equal(byKey('Taux de rétention'), '40 %');            // 0.4 fraction -> "40 %"
  assert.equal(byKey('Actes complétés'), '31');
  assert.equal(byKey('Facturé par Nota'), '12 345,67 $');      // cents -> fr-CA money (ADR 0031 : plus de « commission »)
  assert.equal(byKey('Notaires actifs'), '9');

  // Two charts render, and the used token is scrubbed from the URL.
  assert.equal(doc.querySelectorAll('.chart-svg').length, 2, 'expected line + bar charts');
  assert.equal(win.location.hash, '', 'the magic-link token must be stripped from the URL');
  assert.equal(text(doc.querySelector('#admin-user-email')), 'ops@nota.ca', 'userbar should show the signed-in email');
  // A sign-in confirmation toast fires and is shown.
  const toast = doc.querySelector('#toast');
  assert.match(text(toast), /Connexion réussie/);
  assert.ok(toast.classList.contains('show'), 'toast should be visible right after sign-in');
});

test('retention rate accepts a 0..100 percent as well as a 0..1 fraction', async () => {
  const { win, doc } = await boot(authedApi(sampleOverview({
    kpis: { offersPosted: 200, offersRetained: 85, actsCompleted: 40, commissionCents: 0, retentionRate: 42.5 },
  })), '#/auth?token=T');
  await waitFor(win, '.page-title');
  const rate = [...doc.querySelectorAll('.stat-tile')].find((t) => text(t.querySelector('.stat-k')) === 'Taux de rétention');
  assert.equal(text(rate.querySelector('.stat-v')), '42,5 %');
});

test('an all-zero period renders the empty state (and muted real zeros)', async () => {
  const empty = { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } };
  const { win, doc } = await boot(authedApi(empty), '#/auth?token=T');
  await waitFor(win, '.empty-state');
  assert.ok(doc.querySelector('.stat-grid.is-muted'), 'zeros should render as a muted tile grid');
  assert.match(text(doc.querySelector('.empty-state-title')), /Aucune donnée/);
  assert.equal(doc.querySelectorAll('.chart-svg').length, 0, 'no charts should render for an empty period');
});

test('a failed metrics fetch shows a retry banner, and retry recovers', async () => {
  let fail = true;
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: [] }];
    if (url.includes('/metrics/overview')) return fail ? [500, null] : [200, sampleOverview()];
    return [404, null];
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  banner.querySelector('button').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, '.stat-grid');
  assert.ok(!doc.querySelector('.error-banner'), 'error banner should clear after a successful retry');
});

test('a 401 on an authenticated request drops the session back to the sign-in gate', async () => {
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(), role: 'analyst' }];
    if (url.endsWith('/me')) return [401, { error: 'unauthorized' }];
    return [404, null];
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.auth-title');
  assert.equal(text(doc.querySelector('.auth-title')), 'Console Nota');
  assert.ok(doc.querySelector('#admin-userbar').hidden, 'the userbar must be hidden once the session is cleared');
});

test('logout tears down the session and returns to the gate', async () => {
  const { win, doc } = await boot(authedApi(), '#/auth?token=T');
  await waitFor(win, '.page-title');
  doc.querySelector('#admin-logout').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, '.auth-title');
  assert.equal(text(doc.querySelector('.auth-title')), 'Console Nota');
  assert.ok(doc.querySelector('#admin-userbar').hidden, 'userbar should be hidden after logout');
});

test('section search handles accents, clears with Escape, and navigates with Enter', async () => {
  const { win, doc } = await boot(authedApi(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const input = doc.querySelector('#admin-section-search');
  input.value = 'apercu';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.deepEqual([...doc.querySelectorAll('.admin-rail-link')].filter(n => !n.hidden).map(n => n.textContent), ['Aperçu']);
  input.value = 'unfindable';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('.admin-rail [role="status"]').hidden, false);
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal([...doc.querySelectorAll('.admin-rail-link')].filter(n => !n.hidden).length, doc.querySelectorAll('.admin-rail-link').length);
  input.value = 'prix';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle(win);
  assert.equal(win.location.hash, '#/prix');
  assert.equal(text(doc.querySelector('.page-title')), 'Prix');
});

test('payments renders explicit credential status and working settings shortcuts', async () => {
  const api = authedApi();
  const { win, doc } = await boot((m, url, body) => url.endsWith('/payments')
    ? [200, { secretConfigured: true, webhookConfigured: false, mode: 'test', currency: 'cad', locale: 'fr-CA' }]
    : api(m, url, body), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/paiements';
  await waitFor(win, '.settings-list');
  assert.deepEqual([...doc.querySelectorAll('.settings-list dd')].map(n => n.textContent), ['Configuré', 'Manquant']);
  const shortcut = [...doc.querySelectorAll('.admin-content .tpl-actions button')].find(n => n.textContent === 'Annulation');
  shortcut.click();
  await settle(win);
  assert.equal(win.location.hash, '#/annulation');
});

test('services and features expose the domain catalogue and the operator inventory', async () => {
  const service = {
    id: 'testament', nom: 'Testament notarié', nomEn: 'Notarial will', actif: true,
    description: 'Testament reçu devant notaire.',
    prixAnnonce: { totalCents: 22900 },
    pricing: { criteria: [{ id: 'beneficiaires', label: 'Bénéficiaires', required: true, options: [{ label: 'Une personne' }] }] },
    documents: [{ id: 'piece_identite', nom: 'Pièce d’identité' }],
    champs: [{ id: 'beneficiaires_legataires', label: 'Bénéficiaires et légataires' }],
    planNotaire: [{ id: 'identity', label: 'Vérifier l’identité' }],
    ai: { active: true, fields: [{ id: 'beneficiaries', label: 'Bénéficiaires' }] },
    connaissance: { sources: [] },
  };
  const features = {
    groupes: [{ id: 'integrations', nom: 'Intégrations et paiements', nomEn: 'Integrations and payments', fonctionnalites: [{ id: 'stripe-checkout', nom: 'Stripe Checkout', nomEn: 'Stripe Checkout', statut: 'actif', statutEn: 'active' }] }],
    personnalisations: [{ id: 'prix', nom: 'Prix par service', nomEn: 'Service prices', mode: 'editable', permission: 'billing:write' }],
  };
  const base = authedApi();
  const handler = (method, url, body) => {
    if (url.includes('/catalogue')) return [200, { services: [service], actesAVenir: [], dates: [], deplacements: [], preteurs: [], typesDocuments: [], versions: {} }];
    if (url.includes('/features')) return [200, { ok: true, ...features }];
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/services';
  await waitFor(win, '.service-card');
  assert.equal(text(doc.querySelector('.service-card .chart-card-title')), 'Testament notarié');
  assert.equal(text(doc.querySelector('.tpl-readonly-note strong')), 'Source unique');
  assert.match(text(doc.querySelector('.service-card')), /Bénéficiaires et légataires/);
  win.location.hash = '#/fonctionnalites';
  await waitFor(win, '.feature-group');
  assert.match(text(doc.querySelector('.feature-group')), /Stripe Checkout/);
  assert.match(text(doc.querySelector('.feature-group + .chart-card')), /Prix par service/);
});

test('catalogue and feature collections show explicit 0, 1 and nested zero states', async () => {
  const service = {
    id: 'testament', nom: 'Testament', nomEn: 'Will', actif: true,
    description: '', prixAnnonce: { totalCents: 10000 },
    pricing: { criteria: [] }, documents: [], champs: [], planNotaire: [],
    ai: { active: true, fields: [] }, connaissance: { sources: [] },
  };
  const base = authedApi();
  const handler = (method, url, body) => {
    if (url.includes('/catalogue')) return [200, { services: [service] }];
    if (url.includes('/features')) return [200, {
      groupes: [{ id: 'empty', nom: 'Groupe vide', nomEn: 'Empty group', fonctionnalites: [] }],
      personnalisations: [],
    }];
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/services';
  await waitFor(win, '.service-card');
  assert.match(text(doc.querySelector('.service-card').parentElement.querySelector('.collection-count')), /^1 service$/);
  assert.deepEqual([...doc.querySelectorAll('.service-detail summary')].map((n) => n.textContent), [
    'Questions et paramètres (0)', 'Documents (0)', 'Renseignements à recueillir (0)',
    'Plan de contrôle notarial (0)', 'Préparation IA avec preuve (0)', 'Sources de connaissance (0)',
  ]);
  assert.equal(doc.querySelectorAll('.service-detail .collection-empty-inline').length, 6);

  win.location.hash = '#/fonctionnalites';
  await waitFor(win, '.feature-group');
  assert.match(text(doc.querySelector('.feature-group > .collection-count')), /^0 fonctionnalité$/);
  assert.match(text(doc.querySelector('.feature-group .collection-empty-inline')), /Aucune fonctionnalité/);
  assert.match(text(doc.querySelector('.feature-group + .chart-card > .collection-count')), /^0 personnalisation$/);
});

test('an explicitly empty catalogue is still rendered as a 0-state', async () => {
  const base = authedApi();
  const handler = (method, url, body) => url.includes('/catalogue')
    ? [200, { services: [] }]
    : base(method, url, body);
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/services';
  await waitFor(win, '.collection-empty');
  assert.match(text(doc.querySelector('.collection-count')), /^0 service$/);
  assert.match(text(doc.querySelector('.collection-empty')), /0 service/);
});
