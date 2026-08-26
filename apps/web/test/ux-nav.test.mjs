/**
 * Navigation-depth (three-click) guarantees for the web app.
 *
 * Every pane must be reachable in at most three clicks from anywhere, at any
 * time — not only during a one-shot flow:
 *   1. The dossier has a permanent door: a client's account menu carries a
 *      "Mon dossier" row (before this, the only entry was the post-publish
 *      success card — navigate away once and the pane was unreachable).
 *   2. An anonymous visitor who has published offers (no email is required to
 *      publish) keeps the account bell: their offers, dossier and
 *      notifications stay reachable without signing in.
 *   3. The active pane lives in the URL hash (`t`), so panes are deep-linkable
 *      and the browser Back button navigates panes instead of leaving the site.
 *   4. While a <dialog> is open the page behind must not scroll: the lock has
 *      to cover the <html> scroller (body alone does nothing — the root
 *      element keeps scrolling and the page loses its place).
 *
 * Boot harness mirrors smoke.test.mjs: eval domain then app inside jsdom.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);

async function boot({ hash = '', seed = {} } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, Nota: win.Nota };
}

const acctLabels = (doc) =>
  Array.from(doc.querySelectorAll('#acct-actions .acct-action .acct-item-title')).map((n) => n.textContent);

const activePane = (doc) => {
  const on = Array.from(doc.querySelectorAll('.tab-pane')).filter((p) => !p.hidden);
  assert.equal(on.length, 1, 'exactly one visible pane');
  return on[0].id;
};

// ---------------------------------------------------------------------------
// 1. The dossier has a permanent door
// ---------------------------------------------------------------------------

test('client account menu carries a permanent "Mon dossier" row that opens the dossier pane', async () => {
  const offer = { id: 'o1', dateISO: todayISO(), serviceId: 'financement', montant: 900 };
  const { doc, Nota } = await boot({
    seed: {
      'nota.profile.v1': JSON.stringify({ courriel: 'client@example.ca' }),
      'nota.myoffers.v1': JSON.stringify([offer]),
    },
  });
  Nota.account.render();
  const labels = acctLabels(doc);
  assert.ok(labels.includes('Mon dossier'), 'a permanent route to the dossier: ' + labels.join(' | '));
  assert.ok(labels.includes('Mon profil'), 'the profile row survives');
  assert.equal(labels.filter((t) => t === 'Mes offres').length, 0,
    'no duplicate row: offers are the first card of "Mon profil"');

  const row = Array.from(doc.querySelectorAll('#acct-actions .acct-action'))
    .find((b) => b.textContent.includes('Mon dossier'));
  row.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-dossier');
  // The dossier opens on the service of the client's live offer, not a default.
  assert.equal($(doc, 'd-service').value, 'financement');
});

// ---------------------------------------------------------------------------
// 2. Anonymous publishers keep their account door
// ---------------------------------------------------------------------------

test('anonymous visitor with published offers keeps the account bell and reaches "Mes offres"', async () => {
  const offer = { id: 'o2', dateISO: todayISO(), serviceId: 'refinancement', montant: 1400 };
  const { doc, Nota } = await boot({ seed: { 'nota.myoffers.v1': JSON.stringify([offer]) } });
  Nota.account.render();
  assert.equal(Nota.account.role(), 'anon');
  assert.equal(doc.querySelector('.acct-wrap').hidden, false,
    'the bell stays: notifications and offers derive from this device');
  const labels = acctLabels(doc);
  assert.ok(labels.includes('Mes offres'), 'a route to the offers: ' + labels.join(' | '));
  assert.ok(labels.includes('Mon dossier'), 'a route to the dossier');

  const row = Array.from(doc.querySelectorAll('#acct-actions .acct-action'))
    .find((b) => b.textContent.includes('Mes offres'));
  row.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-profil');
});

test('anonymous visitor with no offers still gets no account bell', async () => {
  const { doc, Nota } = await boot();
  Nota.account.render();
  assert.equal(doc.querySelector('.acct-wrap').hidden, true);
});

// ---------------------------------------------------------------------------
// 3. Panes live in the URL: deep links + Back button
// ---------------------------------------------------------------------------

test('a #t=<pane> deep link boots straight into that pane', async () => {
  const { doc, Nota } = await boot({ hash: '#t=notaires' });
  assert.equal(Nota.state.tab, 'notaires');
  assert.equal(activePane(doc), 'pane-notaires');
});

test('an unknown pane in the hash falls back to the carnet', async () => {
  const { doc } = await boot({ hash: '#t=nope' });
  assert.equal(activePane(doc), 'pane-carnet');
});

test('setTab records the pane in the hash and the Back button returns to the previous pane', async () => {
  const { win, doc, Nota } = await boot();
  assert.equal(activePane(doc), 'pane-carnet');

  Nota.setTab('conditions');
  assert.match(win.location.hash, /(^|[#&])t=conditions(&|$)/);

  Nota.setTab('charte');
  assert.match(win.location.hash, /t=charte/);

  win.history.back();
  await wait(30);
  assert.equal(activePane(doc), 'pane-conditions', 'Back walks panes instead of leaving the site');

  win.history.back();
  await wait(30);
  assert.equal(activePane(doc), 'pane-carnet', 'Back reaches the landing pane');
});

test('the carnet keeps a clean URL: no t= param on the default pane', async () => {
  const { win, Nota } = await boot();
  Nota.setTab('notaires');
  Nota.setTab('carnet');
  assert.doesNotMatch(win.location.hash, /(^#|&)t=/);
});

// ---------------------------------------------------------------------------
// 4. Modal scroll lock covers the real scroller
// ---------------------------------------------------------------------------

test('the dialog scroll lock targets the <html> scroller, not only <body>', () => {
  assert.match(CSS_SRC, /html:has\(dialog\[open\]\)[^{}]*\{[^}]*overflow:\s*hidden/,
    'body:has(dialog[open]) alone lets the root element scroll behind an open modal');
});

// ---------------------------------------------------------------------------
// 5. Three-click reachability for every destination, for every role
// ---------------------------------------------------------------------------

const visible = (node) => {
  for (let n = node; n; n = n.parentElement) if (n.hidden) return false;
  return true;
};

test('the dossier has a door before any offer exists (footer link, anonymous visitor)', async () => {
  const { doc } = await boot();
  const link = doc.querySelector('.site-footer .goto-link[data-goto="dossier"]');
  assert.ok(link, 'footer carries "Préparer mon dossier"');
  link.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-dossier');
});

test('the notary door is named for what it is, not as a directory of notaries', async () => {
  const { doc } = await boot();
  assert.equal($(doc, 'tab-notaires').textContent.trim(), 'Espace notaire');
  assert.equal(doc.querySelector('#mobile-nav [data-tab="notaires"]').textContent.trim(), 'Espace notaire');
});

test('the guide and the offer flow stay within three taps of the phone drawer', async () => {
  // The drawer mirrors the three flat doors (ADR 0010 §2) — no guide/publish
  // rows of its own. The guide is ONE tap from anywhere while signed out (the
  // compact header icon); the offer flow is burger → Carnet → hero CTA.
  const { doc } = await boot();
  $(doc, 'nav-guide').click();
  await wait(10);
  assert.equal($(doc, 'onboarding-dialog').open, true, 'the guide opens from the header icon');
  $(doc, 'onboarding-dialog').close();
  $(doc, 'nav-burger').click();
  await wait(10);
  doc.querySelector('#mobile-nav .mnav-link[data-tab="carnet"]').click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-carnet');
  assert.equal($(doc, 'mobile-nav').classList.contains('is-open'), false, 'choosing a door closes the drawer');
  $(doc, 'cta-reserver').click();
  await wait(30);
  assert.equal($(doc, 'day-dialog').open, true, 'the offer flow opens from the hero CTA');
});

test('sign-in and sign-up are different doors: sign-up opens the role choice', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  await wait(10);
  assert.equal($(doc, 'onboarding-dialog').open, true, 'S’inscrire → who are you?');
  assert.notEqual($(doc, 'auth-dialog').open, true);
  $(doc, 'onboarding-dialog').close();
  $(doc, 'header-login').click();
  await wait(10);
  assert.equal($(doc, 'auth-dialog').open, true, 'Se connecter → courriel');
});

test('a shared day link reopens that day on boot, and Back closes it', async () => {
  const iso = todayISO();
  const { win, doc } = await boot({ hash: '#jour=' + iso });
  await wait(80);
  assert.equal($(doc, 'day-dialog').open, true, 'the day dialog is restored from the hash');
  win.history.pushState(null, '', '#t=charte');
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  await wait(30);
  assert.notEqual($(doc, 'day-dialog').open, true, 'navigating history never leaves a modal orphaned');
});

test('signed-in notary: retain is within two clicks of the landing (tab → Retenir → Confirmer)', async () => {
  const bid = { id: 'n1', serviceId: 'refinancement', dateISO: todayISO(), montant: 1400, tier: 'extreme', ready: true, missing: [] };
  const { win, doc, Nota } = await boot({
    seed: { 'nota.notary.token': JSON.stringify('sess.tok'), 'nota.notary.email': JSON.stringify('n@etude.ca') },
  });
  const calls = [];
  win.fetch = (url, opts) => {
    calls.push({ url: String(url), opts });
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (String(url).includes('/notary/bids/accept')) return json({ id: 'n1', courriel: null, dossier: null });
    if (String(url).includes('/notary/bids')) return json({ bids: [bid], retained: [] });
    return Promise.reject(new Error('offline'));
  };
  await Nota.notary.loadBids();
  $(doc, 'tab-notaires').click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-notaires');
  assert.ok(visible($(doc, 'notary-authed')), 'the console is already open for a restored session');
  const acc = doc.querySelector('.nc-card[data-id="n1"] .nc-accept');
  acc.click();
  await wait(10);
  assert.equal(calls.filter((c) => c.url.includes('/accept')).length, 0, 'the first click only arms');
  doc.querySelector('.nc-card[data-id="n1"] .nc-accept').click();
  await wait(30);
  assert.equal(calls.filter((c) => c.url.includes('/accept')).length, 1, 'the second click retains');
});

// ---------------------------------------------------------------------------
// 6. Three flat doors — no submenu layer anywhere (ADR 0010 §2)
// ---------------------------------------------------------------------------

test('desktop nav: exactly three flat doors, and no submenu machinery survives', async () => {
  const { doc } = await boot();
  const tabs = Array.from(doc.querySelectorAll('.nav-tabs .nav-tab'));
  assert.deepEqual(tabs.map((t) => t.dataset.tab), ['carnet', 'notaires', 'partenaires'],
    'Carnet · Espace notaire · Partenaires — in that order, nothing else');
  // The retired chevron/submenu layer must not linger in any form.
  assert.equal(doc.querySelector('.nav-more'), null, 'no chevron toggles');
  assert.equal(doc.querySelector('[id^="submenu-"]'), null, 'no desktop submenus');
  assert.equal(doc.querySelector('.mnav-more'), null, 'no drawer accordions');
  assert.equal(doc.querySelector('#mobile-nav [id^="msub-"]:not(#msub-legal)'), null,
    'the only drawer fold is the legal one');
  // No "Services" door either — the catalogue lives inside the carnet.
  assert.ok(!tabs.some((t) => /services/i.test(t.textContent)), 'no Services tab');
});

test('the Partenaires door opens the partner pane with domain-driven rewards', async () => {
  const { win, doc } = await boot();
  $(doc, 'tab-partenaires').click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-partenaires');
  const D = win.NotaDomain;
  // The two flat amounts are ALWAYS the domain's — never markup literals.
  assert.equal($(doc, 'pr-amount-client').textContent, D.money(D.REFERRAL.client));
  assert.equal($(doc, 'pr-amount-notaire').textContent, D.money(D.REFERRAL.notaire));
});

test('the dossier is not a header door: reached from flows, never from the menu', async () => {
  const { doc } = await boot();
  // Not in the desktop tabs, not in the phone drawer sections. It stays
  // reachable from flows: the footer test above covers the anonymous case,
  // and the booking flow post-publish card is pinned by the smoke tests.
  assert.equal(doc.querySelector('.nav-tabs [data-tab="dossier"]'), null);
  assert.equal(doc.querySelector('#mobile-nav [data-tab="dossier"]'), null);
});

test('phone drawer: the trio plus auth, theme, language and the legal fold', async () => {
  const { doc } = await boot();
  $(doc, 'nav-burger').click();
  await wait(10);
  const drawer = $(doc, 'mobile-nav');
  const doors = Array.from(drawer.querySelectorAll('.mnav-link[data-tab]'));
  assert.deepEqual(doors.map((d) => d.dataset.tab), ['carnet', 'notaires', 'partenaires'],
    'the drawer mirrors the three flat doors');
  assert.ok($(doc, 'mnav-auth'), 'the auth group exists (shown while anonymous)');
  assert.ok($(doc, 'mnav-theme'), 'theme toggle row');
  assert.ok($(doc, 'mnav-lang'), 'language toggle row');
  assert.ok(drawer.querySelector('.mnav-expandrow[aria-controls="msub-legal"]'), 'the one legal fold');
  // A door click closes the drawer.
  doors[2].click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-partenaires');
  assert.equal(drawer.classList.contains('is-open'), false);
});

test('phone drawer: legal links fold behind one thin expandable row', async () => {
  const { doc } = await boot();
  $(doc, 'nav-burger').click();
  await wait(10);
  const toggle = doc.querySelector('.mnav-expandrow[aria-controls="msub-legal"]');
  assert.ok(toggle, 'one row stands in for the three legal links');
  assert.equal($(doc, 'msub-legal').hidden, true);
  toggle.click();
  await wait(10);
  assert.equal($(doc, 'msub-legal').hidden, false);
  assert.ok($(doc, 'mobile-nav').classList.contains('is-open'), 'expanding legal keeps the drawer open');
  doc.querySelector('#msub-legal .goto-link[data-goto="confidentialite"]').click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-confidentialite');
  assert.equal($(doc, 'mobile-nav').classList.contains('is-open'), false);
});

test('the header is thin: 52px desktop band, 48px phone band', () => {
  assert.match(CSS_SRC, /--header-h:\s*52px/, 'desktop header height token');
  assert.match(CSS_SRC, /--header-h:\s*48px/, 'phone header height token');
});

// ---------------------------------------------------------------------------
// Header tool cluster — the loose icons regroup, and every band trims itself
// ---------------------------------------------------------------------------

test('the guide, language and theme icons share one header cluster; the burger closes the row', async () => {
  const { doc } = await boot();
  const tools = doc.querySelector('.site-header .header-tools');
  assert.ok(tools, 'one .header-tools cluster instead of a scatter of icons');
  assert.deepEqual(
    Array.from(tools.children).map((b) => b.id),
    ['nav-guide', 'lang-toggle', 'theme-toggle'],
    'guide · language · theme — in that order, nothing else'
  );
  const wrap = doc.querySelector('.site-header .wrap');
  assert.equal(wrap.lastElementChild.id, 'nav-burger',
    'the burger is the last control, so the phone header reads brand → ? → avatar → burger');
});

test('each band trims the header; the drawer covers what the phone hides', () => {
  assert.match(CSS_SRC, /\.header-tools\s*\{[^}]*border/, 'the cluster is drawn as one group');
  assert.match(CSS_SRC, /\.icon-btn\[hidden\]\s*\{\s*display:\s*none/,
    'a hidden icon (the signed-in guide) must actually disappear — .icon-btn sets display:grid');
  // Tablet compact band (720–899.98) slims chrome so the full set still fits.
  assert.match(CSS_SRC, /@media \(min-width: 720px\) and \(max-width: 899\.98px\)/);
  // Phone: tabs, auth, theme AND the inline language toggle hand off to the
  // drawer (#mnav-theme / #mnav-lang, pinned above) — only the "?" guide keeps
  // its one-tap header spot while signed out.
  const phone = CSS_SRC.slice(CSS_SRC.indexOf('@media (max-width: 719.98px)'));
  assert.notEqual(phone.length, CSS_SRC.length, 'phone header band exists');
  assert.match(phone, /#lang-toggle\s*\{[^}]*display:\s*none/,
    'the inline language toggle yields to the drawer row on phones');
});

// ---------------------------------------------------------------------------
// New menu copy stays bilingual
// ---------------------------------------------------------------------------

test('"Mon dossier" carries an English entry', () => {
  I18N.force('en');
  assert.equal(I18N.t('Mon dossier'), 'My file');
  I18N.force('fr');
});

test('the three doors and the partner claim form carry English entries', () => {
  I18N.force('en');
  for (const fr of [
    'Espace notaire',
    'Partenaires',
    'Référez, et soyez récompensé.',
    'Réclamez votre code',
    'Code souhaité',
    'Copier le lien',
  ]) {
    assert.notEqual(I18N.t(fr), fr, 'missing EN entry for: ' + fr);
  }
  I18N.force('fr');
});
