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
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

// The console's live-feed poll is a jsdom timer that would hold the runner's
// process open — close every window once the suite ends so it can exit.
const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5

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
  DOMS.push(dom);
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
// 2. The account bell is for the signed-in state ONLY (owner's ask, 2026-08-28)
// ---------------------------------------------------------------------------

test('anonymous visitor with published offers still gets NO account bell — only the auth pair', async () => {
  const offer = { id: 'o2', dateISO: todayISO(), serviceId: 'refinancement', montant: 1400 };
  const { doc, Nota } = await boot({ seed: { 'nota.myoffers.v1': JSON.stringify([offer]) } });
  Nota.account.render();
  assert.equal(Nota.account.role(), 'anon');
  assert.equal(doc.querySelector('.acct-wrap').hidden, true,
    'signed-out means no bell, even with offers published from this device');
  assert.equal($(doc, 'header-auth').hidden, false,
    'the explicit login/signup pair is the signed-out door');
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

test('setTab records the pane in the hash and the Back button returns to the previous pane', { timeout: 10_000 }, async () => {
  const { win, doc, Nota } = await boot();
  assert.equal(activePane(doc), 'pane-carnet');

  Nota.setTab('conditions');
  assert.match(win.location.hash, /(^|[#&])t=conditions(&|$)/);

  Nota.setTab('charte');
  assert.match(win.location.hash, /t=charte/);

  let navigated = new Promise(resolve => win.addEventListener('popstate', resolve, { once: true }));
  win.history.back();
  await navigated;
  assert.equal(activePane(doc), 'pane-conditions', 'Back walks panes instead of leaving the site');

  navigated = new Promise(resolve => win.addEventListener('popstate', resolve, { once: true }));
  win.history.back();
  await navigated;
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

// 2026-09-05, owner's instruction: « Préparer mon dossier — remove this from
// footer ». It was the ONLY door to the Dossier pane for a visitor who has not
// yet published an offer; the pane is now reached from the published-offer
// card alone (app.js, #dossier-next-cta). This test records that the door is
// gone on purpose, so its removal is never mistaken for a regression.
test('the footer no longer carries a door to the Dossier', async () => {
  const { doc } = await boot();
  assert.equal(doc.querySelector('.site-footer .goto-link[data-goto="dossier"]'), null);
});

test('the notary door is named for what it is, not as a directory of notaries', async () => {
  const { doc } = await boot();
  assert.equal($(doc, 'tab-notaires').textContent.trim(), 'Espace notaire');
  assert.equal(doc.querySelector('#mobile-nav [data-tab="notaires"]').textContent.trim(), 'Espace notaire');
});

test('the guide and the offer flow stay within three taps of the phone drawer', async () => {
  // The drawer mirrors the three flat doors (ADR 0010 §2) — no guide/publish
  // rows of its own. The guide is ONE tap from anywhere (the standalone « ? »
  // bubble, owner 2026-08-27); the offer flow is burger → Carnet → hero CTA.
  const { doc } = await boot();
  $(doc, 'guide-fab').click();
  await wait(10);
  assert.equal($(doc, 'onboarding-dialog').open, true, 'the guide opens from the standalone bubble');
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

test('sign-in and sign-up open the SAME door (owner, 2026-08-28) — never the pedagogical guide', async () => {
  const { doc } = await boot();
  $(doc, 'header-signup').click();
  await wait(10);
  assert.equal($(doc, 'auth-dialog').open, true, 'S’inscrire → the signup form, like a traditional site');
  assert.notEqual($(doc, 'onboarding-dialog').open, true, 'the guide stays on the « ? » and the footer');
  $(doc, 'auth-dialog').close();
  $(doc, 'header-login').click();
  await wait(10);
  assert.equal($(doc, 'auth-dialog').open, true, 'Se connecter → the same door, titled Connexion');
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
    // A complete contact profile (ADR 0033), or Retenir opens the form instead.
    if (String(url).includes('/notary/bids')) return json({ bids: [bid], retained: [], profil: { nom: 'Me Démo', telephone: '418 555 0100', adresse: '1, rue de la Démo, Québec' } });
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
  assert.equal(calls.filter((c) => c.url.includes('/accept')).length, 0, 'the first click only opens the confirm sheet');
  assert.equal($(doc, 'nc-retenir-dialog').open, true, 'the confirm sheet is the second click');
  $(doc, 'nc-retenir-go').click();
  await wait(30);
  assert.equal(calls.filter((c) => c.url.includes('/accept')).length, 1, 'the second click retains');
});

// ---------------------------------------------------------------------------
// 6. Three flat doors — no submenu layer anywhere (ADR 0010 §2)
// ---------------------------------------------------------------------------

test('desktop nav: marketplace and Beta flat doors, and no submenu machinery survives', async () => {
  const { doc } = await boot();
  const tabs = Array.from(doc.querySelectorAll('.nav-tabs .nav-tab'));
  assert.deepEqual(tabs.map((t) => t.dataset.tab), ['carnet', 'notaires', 'partenaires', 'beta'],
    'Carnet · Espace notaire · Partenaires · Bêta');
  // The retired chevron/submenu layer must not linger in any form.
  assert.equal(doc.querySelector('.nav-more'), null, 'no chevron toggles');
  assert.equal(doc.querySelector('.nav-history'), null, 'the header has no back/forward arrow rail');
  assert.equal(doc.querySelector('.mnav-history'), null, 'the drawer has no back/forward arrow rail');
  // Owner, 2026-09-12: « enlever les 2 flèches » — the narrow header's own
  // back/forward pair is gone too. The browser button and the phone's back
  // gesture already walk the panes; the header is brand, then burger.
  assert.equal(doc.querySelector('[data-history]'), null, 'no back/forward arrow anywhere in the shell');
  assert.equal(doc.querySelector('.mobile-history'), null, 'the narrow header has no history pair');
  assert.equal(doc.querySelector('[id^="submenu-"]'), null, 'no desktop submenus');
  assert.equal(doc.querySelector('.mnav-more'), null, 'no drawer accordions');
  assert.equal(doc.querySelector('#mobile-nav [id^="msub-"]:not(#msub-legal)'), null,
    'the only drawer fold is the legal one');
  // No "Services" door either — the catalogue lives inside the carnet.
  assert.ok(!tabs.some((t) => /services/i.test(t.textContent)), 'no Services tab');
  assert.equal($(doc, 'tab-beta').textContent.replace(/\s+/g, '').trim(), 'SignatureBêta');
  assert.ok($(doc, 'tab-beta').querySelector('.nav-tab-badge'), 'Signature carries the Bêta flag');
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

test('phone drawer: marketplace and Beta plus auth, theme, language and the legal fold', async () => {
  const { doc } = await boot();
  $(doc, 'nav-burger').click();
  await wait(10);
  const drawer = $(doc, 'mobile-nav');
  const doors = Array.from(drawer.querySelectorAll('.mnav-link[data-tab]'));
  assert.deepEqual(doors.map((d) => d.dataset.tab), ['carnet', 'notaires', 'partenaires', 'beta'],
    'the drawer mirrors the desktop doors');
  assert.ok($(doc, 'mnav-auth'), 'the auth group exists (shown while anonymous)');
  // Language and theme are PREFERENCE rows — label left, small toggle right —
  // grouped apart from the navigation rows.
  const prefs = drawer.querySelector('.mnav-prefs');
  assert.ok(prefs, 'one preferences group (language + theme)');
  assert.ok(prefs.contains($(doc, 'mnav-theme')) && prefs.contains($(doc, 'mnav-lang')),
    'language and theme both live in the preferences group');
  assert.equal($(doc, 'mnav-theme').getAttribute('role'), 'switch', 'theme is a real switch');
  assert.deepEqual(
    Array.from($(doc, 'mnav-lang').querySelectorAll('button[data-set-lang]')).map((b) => b.dataset.setLang),
    ['fr', 'en'], 'the drawer language control offers both languages');
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

test('language and theme share the header cluster; the guide floats on its own', async () => {
  const { doc } = await boot();
  const tools = doc.querySelector('.site-header .header-tools');
  assert.ok(tools, 'one .header-tools cluster instead of a scatter of icons');
  assert.deepEqual(
    Array.from(tools.children).map((b) => b.id),
    ['lang-toggle', 'theme-toggle'],
    'language · theme — in that order, nothing else'
  );
  // The "?" guide is ALWAYS reachable but NEVER part of that menu (owner's
  // ask, 2026-08-27): it lives in its own standalone bubble outside the
  // header, visible from first paint, signed in or out.
  const fab = $(doc, 'guide-fab');
  assert.ok(fab, 'the standalone guide bubble exists');
  assert.equal(fab.hidden, false, 'the guide bubble shows from first paint');
  assert.equal(fab.closest('.site-header'), null, 'the guide does not sit in the header menu');
  assert.equal(fab.closest('#mobile-nav'), null, 'nor in the phone drawer');
  // Language and theme show their STATE: a FR | EN segment (marked by
  // i18n.js) and a sun/moon switch — no more bare icons hiding the answer.
  assert.deepEqual(
    Array.from($(doc, 'lang-toggle').querySelectorAll('button[data-set-lang]')).map((b) => b.dataset.setLang),
    ['fr', 'en'], 'the header language control offers both languages');
  assert.equal($(doc, 'theme-toggle').getAttribute('role'), 'switch', 'the header theme control is a switch');
  const wrap = doc.querySelector('.site-header .wrap');
  assert.equal(wrap.lastElementChild.id, 'nav-burger',
    'the burger is the last control, so the phone header reads brand → ? → avatar → burger');
});

test('each band trims the header; the drawer covers what the phone hides', () => {
  // The three controls sit TOGETHER on one shared track, all the same 28px
  // height (owner's ask, 2026-08-26: « les mettre ensemble et même
  // grosseur ») — a quiet background, never a border.
  assert.match(CSS_SRC, /\.header-tools\s*\{[^}]*background:\s*var\(--surface-inset\)/,
    'one shared track holds guide, language and theme');
  assert.doesNotMatch(CSS_SRC, /\.header-tools\s*\{[^}]*border:\s*1px/,
    'no border drawn around the header tool group');
  assert.match(CSS_SRC, /\.mini-seg\s*\{[^}]*height:\s*28px/,
    'the FR | EN segment matches the shared 28px height');
  assert.match(CSS_SRC, /\.tswitch\s*\{[^}]*height:\s*28px/,
    'the theme switch matches the shared 28px height');
  // …and the strip stays SEGMENTED: a thin hairline before each control
  // after the first (language | theme).
  assert.match(CSS_SRC, /\.header-tools > \* \+ \*::after\s*\{[^}]*width:\s*1px/,
    'hairlines split the strip into segments');
  // The « ? » is its own fixed bubble, bottom-right, on every band — help is
  // one tap from anywhere without living in any menu (owner, 2026-08-27).
  assert.match(CSS_SRC, /\.guide-fab\s*\{[^}]*position:\s*fixed/,
    'the guide bubble is pinned to the viewport');
  // Desktop compact band (900–1099.98) slims chrome so the full set still fits;
  // the 768px tablet uses the drawer because coarse-pointer controls are 44px.
  assert.match(CSS_SRC, /@media \(min-width: 900px\) and \(max-width: 1099\.98px\)/);
  // Phone: tabs, auth, theme AND the inline language toggle hand off to the
  // drawer (#mnav-theme / #mnav-lang, pinned above) — only the "?" guide keeps
  // its one-tap header spot while signed out.
  const phone = CSS_SRC.slice(CSS_SRC.indexOf('@media (max-width: 899.98px)'));
  assert.notEqual(phone.length, CSS_SRC.length, 'phone header band exists');
  assert.match(phone, /#lang-toggle\s*\{[^}]*display:\s*none/,
    'the inline language toggle yields to the drawer row on phones');
});

test('theme switches show the current theme, stay in sync, and never close the drawer', async () => {
  const { doc } = await boot();
  const header = $(doc, 'theme-toggle');
  const drawerSwitch = $(doc, 'mnav-theme');
  // Nothing is stamped before the viewer chooses (2026-09-11): the device
  // decides, and the switches report what is EFFECTIVELY on screen — the test
  // harness reports a light device, so both say light (checked = dark).
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  assert.equal(header.getAttribute('aria-checked'), 'false');
  assert.equal(drawerSwitch.getAttribute('aria-checked'), 'false');
  header.click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(header.getAttribute('aria-checked'), 'true', 'the header switch reflects the flip');
  assert.equal(drawerSwitch.getAttribute('aria-checked'), 'true', 'the drawer twin follows');
  // The drawer's switch drives the same state — and adjusting a preference is
  // not a navigation choice, so the drawer must stay open.
  $(doc, 'nav-burger').click();
  await wait(10);
  drawerSwitch.click();
  await wait(10);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(header.getAttribute('aria-checked'), 'false');
  assert.equal($(doc, 'mobile-nav').classList.contains('is-open'), true,
    'flipping the theme keeps the drawer open');
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
    'Un code. Deux récompenses.',
    'Réclamez votre code',
    'Votre code partenaire',
    'Code souhaité',
    'Copier le lien',
  ]) {
    assert.notEqual(I18N.t(fr), fr, 'missing EN entry for: ' + fr);
  }
  I18N.force('fr');
});

// ---------------------------------------------------------------------------
// Audit 2026-09-02 — the public site's chrome, links, PWA files and print.
// ---------------------------------------------------------------------------
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const cssBlock = (sel) => {
  const i = CSS_SRC.indexOf(sel + ' {');
  assert.ok(i >= 0, 'rule ' + sel);
  return CSS_SRC.slice(i, CSS_SRC.indexOf('}', i));
};
const px = (block, prop) => Number((new RegExp('(?:^|[\\s;])' + prop + ':\\s*(-?\\d+)').exec(block) || [])[1]);

test('P0-1: the support fab leaves phones; on desktop it stacks above the guide bubble', () => {
  const phone = CSS_SRC.slice(CSS_SRC.indexOf('@media (max-width: 767.98px)'));
  assert.match(phone, /\.sup-fab\s*\{[^}]*display:\s*none/,
    'phones drop the chat fab — the calendar corner ADR 0022 cleared stays clear');
  const guide = cssBlock('.guide-fab'), sup = cssBlock('.sup-wrap');
  assert.ok(px(sup, 'bottom') >= px(guide, 'bottom') + px(guide, 'height'),
    'the chat fab sits ABOVE the guide bubble on desktop, never on it');
  assert.ok(px(sup, 'z-index') > px(guide, 'z-index'), 'and paints over it if they ever touch');
});

test('P0-1: the phone drawer carries a « Messagerie » row that opens the support panel', async () => {
  const { doc } = await boot();
  const row = $(doc, 'mnav-messagerie');
  assert.ok(row && row.closest('#mobile-nav'), 'the drawer offers the chat where the fab is gone');
  $(doc, 'nav-burger').click();
  await wait(10);
  row.click();
  await wait(10);
  assert.equal($(doc, 'chat-panel').hidden, false, 'the support panel opens');
  assert.equal($(doc, 'mobile-nav').classList.contains('is-open'), false, 'and the drawer closes');
});

test('P1-1: every pane link carries its hash destination — never href="#"', async () => {
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  for (const a of dom.window.document.querySelectorAll('a.goto-link[data-goto]')) {
    if (a.closest('#pane-notaires')) continue; // that pane is another session's this wave
    assert.equal(a.getAttribute('href'), '#t=' + a.dataset.goto, 'link to ' + a.dataset.goto);
  }
  // …and the in-page door still wins over a plain hash jump.
  const { doc, win } = await boot();
  doc.querySelector('.site-footer .goto-link[data-goto="charte"]').click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-charte');
  // writeHash carries the carnet filters too — the pane key is what matters.
  assert.match(win.location.hash, /(^#|&)t=charte(&|$)/);
});

test('P1-16: the account bell opens a dialog; the open drawer is modal and the page behind it inert', async () => {
  const { doc } = await boot();
  assert.equal($(doc, 'notif-bell').getAttribute('aria-haspopup'), 'dialog', 'not a menu — the panel carries no menu roles');
  assert.equal($(doc, 'notif-panel').getAttribute('role'), 'dialog');
  const drawer = $(doc, 'mobile-nav');
  assert.equal(drawer.getAttribute('role'), 'dialog');
  assert.equal(drawer.getAttribute('aria-modal'), 'true');
  const behind = ['.site-header', '#main', '.site-footer'];
  $(doc, 'nav-burger').click();
  await wait(10);
  for (const sel of behind) assert.ok(doc.querySelector(sel).hasAttribute('inert'), sel + ' is inert behind the drawer');
  $(doc, 'mnav-close').click();
  await wait(10);
  for (const sel of behind) assert.ok(!doc.querySelector(sel).hasAttribute('inert'), sel + ' is live again');
  assert.equal(doc.activeElement, $(doc, 'nav-burger'), 'focus returns to the burger');
});

test('widening an open mobile menu releases the page and restores desktop focus', async () => {
  const { win, doc } = await boot();
  win.innerWidth = 390;
  $(doc, 'nav-burger').click();
  assert.ok($(doc, 'main').hasAttribute('inert'));
  win.innerWidth = 899;
  win.dispatchEvent(new win.Event('resize'));
  assert.equal($(doc, 'nav-burger').getAttribute('aria-expanded'), 'true');
  win.innerWidth = 900;
  win.dispatchEvent(new win.Event('resize'));
  assert.equal($(doc, 'nav-burger').getAttribute('aria-expanded'), 'false');
  assert.ok(!doc.documentElement.classList.contains('nav-open'));
  assert.ok(!$(doc, 'mobile-nav').classList.contains('is-open'));
  for (const selector of ['.site-header', '#main', '.site-footer']) {
    assert.ok(!doc.querySelector(selector).hasAttribute('inert'), selector + ' becomes interactive');
  }
  assert.equal(doc.activeElement, $(doc, 'tab-carnet'));
});

test('P1-18: a print stylesheet exists — light canvas, chrome hidden, content kept', () => {
  const i = CSS_SRC.indexOf('@media print');
  assert.ok(i >= 0, 'no @media print');
  const print = CSS_SRC.slice(i);
  // (.demo-banner stays: a printed fictional carnet must still say so.)
  for (const sel of ['.site-header', '.site-footer nav', '.guide-fab', '.sup-wrap', '.mark-drift', '.mnav', '#intro-gate']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(print, new RegExp('(?:^|[,\\s])' + esc + '\\s*(?:,|\\{)', 'm'), 'print hides ' + sel);
  }
  assert.match(print, /display:\s*none\s*!important/);
  assert.match(print, /:root\[data-theme='dark'\][^{]*\{[^}]*--bg:/, 'the dark theme is overridden to light on paper');
  assert.match(print, /color-scheme:\s*light/);
  assert.match(print, /box-shadow:\s*none/);
});

test('P2-1: every border-radius is a token, 0 or the 50% dot — no literal pill or off-scale corner', () => {
  const noComments = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [...noComments.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  // The intro films are a scaled composition in their own unit (--igu): a
  // calc() radius there is the film's drawing, not UI chrome.
  const bad = decls.filter((v) => !/^(?:var\(--radius(?:-sm|-xs|-lg)?\)|0|50%|inherit|calc\([^)]*var\(--igu\)[^)]*\)|\s)+$/.test(v));
  assert.deepEqual(bad, [], 'literal radii outside the square register (8/6/3/12px tokens)');
});

test('P2-10: the phone header hides the empty tool strip; no dead #nav-guide references', () => {
  const phone = CSS_SRC.slice(CSS_SRC.indexOf('@media (max-width: 899.98px)'));
  assert.match(phone, /\.header-tools\s*\{[^}]*display:\s*none/, 'language and theme live in the drawer — the strip is empty');
  assert.ok(!/nav-guide/.test(HTML_SRC), 'index.html still mentions #nav-guide');
  assert.ok(!/nav-guide/.test(CSS_SRC), 'styles.css still mentions #nav-guide');
});

test('P2-18: « Comment ça marche » in the footer is a button, not a dead link', async () => {
  const { doc } = await boot();
  const b = $(doc, 'footer-guide');
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.getAttribute('type'), 'button');
  b.click();
  await wait(10);
  assert.equal($(doc, 'onboarding-dialog').open, true);
});

test('P2-19: the lockup is drawn once as <symbol>s; every inline copy is a <use>', () => {
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('symbol#nota-logomark').length, 1, 'one symbol');
  const marks = doc.querySelectorAll('svg.ig-mark');
  assert.ok(marks.length >= 1, 'the introduction renders the shared mark');
  for (const m of marks) {
    assert.ok(m.querySelector('use[href="#nota-logomark"]'), 'a mark is a <use>');
    assert.equal(m.querySelector('rect, polygon, circle'), null, 'no shapes inlined again');
  }
  const outside = HTML_SRC.replace(/<symbol[\s\S]*?<\/symbol>/g, '');
  assert.ok(!/fill="#[0-9a-fA-F]{3,6}"/.test(outside), 'no hardcoded fill outside the two symbols');
  // The mark's two brand colors are the stylesheet's Nota ramp — every asset
  // (symbol, favicon.svg, og.svg, manifests, theme-color) stays in lockstep.
  const ramp = (step) => /--nota-blue-STEP:\s*(#[0-9a-fA-F]{6})/.source.replace('STEP', step);
  const brand = new RegExp(ramp('700')).exec(CSS_SRC)[1].toLowerCase();
  const bright = new RegExp(ramp('500')).exec(CSS_SRC)[1].toLowerCase();
  const mark = new RegExp(ramp('900')).exec(CSS_SRC)[1].toLowerCase();
  const symbol = /<symbol[\s\S]*?<\/symbol>/.exec(HTML_SRC)[0].toLowerCase();
  assert.ok(symbol.includes('fill="' + mark + '"'), 'the symbol’s square is --nota-blue-900');
  assert.ok(symbol.includes('fill="' + bright + '"'), 'the symbol’s signal is --nota-blue-500');
  for (const f of ['../public/favicon.svg', '../public/og.svg']) {
    const svg = read(f).toLowerCase();
    assert.ok(svg.includes(mark) && svg.includes(bright) && !svg.includes('#2c5f34') && !svg.includes('#50b848'), f + ' carries the current Nota blue-teal mark');
  }
  const light = [...doc.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.getAttribute('media'));
  assert.equal(light.getAttribute('content').toLowerCase(), brand, 'the light theme-color is the brand token');
  for (const f of ['../public/manifest.webmanifest', '../public/manifest.en.webmanifest']) {
    assert.equal(JSON.parse(read(f)).theme_color.toLowerCase(), brand, f + ' theme_color is the brand token');
  }

  // ADR 0048 amendment (2026-09-11) — « 01 is the right one »: the word is
  // exploration 01's O T A, SOLID and heavy, on tight tracking, with NO rule
  // under it. The outline word (fill:none + stroke) and the signature-line rule
  // are retired; nothing may bring either back on any surface.
  const word = /<symbol id="nota-wordmark"[\s\S]*?<\/symbol>/.exec(HTML_SRC)[0];
  assert.equal((HTML_SRC.match(/<symbol id="nota-wordmark"/g) || []).length, 1, 'one wordmark symbol');
  assert.match(word, /fill="currentColor"/, 'the word is filled, not stroked');
  assert.ok(!/stroke=|fill="none"/.test(word), 'no outline letterforms left in the wordmark');
  const letters = [...word.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(letters.length, 3, 'exactly three letterforms: O, T and A');

  // ADR 0048 amendment (2026-09-11, later the same day) — variant C « square
  // tile, square signal », then design 02 « Signal repris par le badge », layout
  // 16 « Centré à 60 % » and the letter details 22 « Le T signé » + 27 « Le
  // point final ». The drawing is pinned by path signature: every copy (symbol,
  // signing room, admin, favicons, og.svg) must carry these exact strings, and
  // the round signal, the rx="12" tile, the rounded O and the straight T may
  // not return anywhere.
  const C = {
    tile: '<rect width="64" height="64" rx="7" fill="#264961"/>',
    stems: ['<rect x="16" y="15" width="9.5" height="34" rx="1"/>', '<rect x="38.5" y="15" width="9.5" height="34" rx="1"/>'],
    n: '<polygon points="16,15 26.2,15 48,49 37.8,49"/>',
    signal: '<rect x="40" y="8" width="16" height="16" rx="3" fill="#407598" stroke="#264961" stroke-width="3"/>',
    o: 'M0 8.5a5 5 0 0 1 5-5H22a5 5 0 0 1 5 5V26.5a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5ZM7.8 12.8v9.4a1.5 1.5 0 0 0 1.5 1.5h8.4a1.5 1.5 0 0 0 1.5-1.5V12.8a1.5 1.5 0 0 0-1.5-1.5H9.3a1.5 1.5 0 0 0-1.5 1.5Z',
    t: 'M31 3.5H57.6V11.3H48.2V27.02L40.4 31.5V11.3H31Z',
    a: 'M65.17 6.7L70.74 3.5H72.5L84.1 31.5H75.77L73.93 25.89H64.95L63.23 31.5H54.9ZM69.5 10L73 20.3H66Z',
    period: '<rect x="87.4" y="27.1" width="4.4" height="4.4" rx="1" fill="#407598"/>',
    // The wordmark's viewBox IS its cap band (y 3.5–31.5, 28 tall; the period
    // sits inside x 0–91.8), so a word box --lockup-word tall renders caps
    // exactly that tall; every <svg class="brand-word-svg"> that <use>s it is
    // the same 91.8 × 28 box.
    wordView: 'viewBox="0 3.5 91.8 28"',
    useView: 'viewBox="0 0 91.8 28"',
  };
  const RETIRED = [
    ['the round signal', /<circle cx="48"/],
    ['the rx="12" tile', /rx="12"/],
    ['the rx="2.5" stems', /rx="2\.5"/],
    ['the rounded O', /M11 3\.5H16a11/],
    ['the retired outline O', /M16\.5 6H10a7\.5/],
    ['the straight T', /H45\.35V31\.5H38\.05/],
    ['the retired signature-line rule', /M0\.5 36\.5h86/],
  ];
  const markOf = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\s*\/>/g, '/>').replace(/" \/>/g, '"/>');
  assert.deepEqual(letters, [C.o, C.t, C.a], 'the O is the square portal, the T carries the bevelled stem, the A wears the cut apex');
  assert.ok(word.includes(C.period), 'the period (a signal square, rx 1) closes the word');
  assert.deepEqual([...word.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()), [bright], 'the ONE colour literal inside the wordmark is the signal token’s value (the period)');
  assert.ok(word.includes('<symbol id="nota-wordmark" ' + C.wordView), 'the wordmark viewBox is the cap band (0 3.5 91.8 28)');
  const logomark = /<symbol id="nota-logomark"[\s\S]*?<\/symbol>/.exec(HTML_SRC)[0];
  for (const shape of [C.tile, ...C.stems, C.n, C.signal]) assert.ok(logomark.includes(shape), 'the logomark carries ' + shape.slice(0, 40));
  assert.ok(logomark.includes('<symbol id="nota-logomark" viewBox="0 0 64 64">'), 'the logomark viewBox is the tile');

  // The word travels by reference on the page, and by an identical copy into
  // og.svg — which is opened without the page's CSS, so it may not depend on a
  // web font and may not <use> anything.
  const words = doc.querySelectorAll('svg.brand-word-svg');
  assert.ok(words.length >= 1, 'the page renders the shared word');
  for (const w of words) {
    assert.ok(w.querySelector('use[href="#nota-wordmark"]'), 'a word is a <use>');
    assert.equal(w.querySelector('path, text'), null, 'no letterform inlined again');
    assert.equal(w.getAttribute('viewBox'), '0 0 91.8 28', 'a word box is the symbol’s cap band, so its CSS height is the cap height');
  }
  const og = read('../public/og.svg');
  for (const d of letters) assert.ok(og.includes(d), 'og.svg carries the same letterform: ' + d.slice(0, 12));
  const ogWord = /<g id="og-word"[\s\S]*?<\/g>/.exec(og)[0];
  assert.ok(!/<text|font-family/.test(ogWord), 'og.svg opens without the page CSS: its word may not need a web font');
  assert.ok(!/<use/.test(ogWord), 'og.svg is standalone: it may not reference a symbol');
  assert.ok(ogWord.includes(C.period), 'og.svg closes the word with the period');
  const ogTile = /<g id="og-tile"[\s\S]*?<\/g>\s*<\/g>/.exec(og)[0];
  for (const shape of [C.tile, ...C.stems, C.n, C.signal]) assert.ok(ogTile.includes(shape), 'og.svg carries the logomark verbatim: ' + shape.slice(0, 40));
  const ogBadge = /<g id="og-badge"[\s\S]*?<\/g>/.exec(og)[0];
  assert.ok(ogBadge.includes('fill="' + bright + '"') && /<text[^>]*fill="#ffffff"/.test(ogBadge) && ogBadge.includes('>QUÉBEC<'), 'og.svg: the QUÉBEC badge is on the signal colour with white text (design 02)');
  assert.ok(!/<text|font-family/.test(read('../public/favicon.svg')), 'favicon.svg is drawn, not typeset');
  const signature = read('../public/signature.html');
  const admin = read('../../admin/public/index.html');
  for (const [name, src] of [['index.html', HTML_SRC], ['signature.html', signature], ['admin/index.html', admin], ['og.svg', og], ['favicon.svg', read('../public/favicon.svg')], ['admin/favicon.svg', read('../../admin/public/favicon.svg')]]) {
    for (const [what, re] of RETIRED) assert.ok(!re.test(src), name + ': ' + what + ' is back');
  }
  // The favicons are the mark alone — the same five shapes, byte for byte.
  for (const fav of ['../public/favicon.svg', '../../admin/public/favicon.svg']) {
    const m = markOf(read(fav));
    for (const shape of [C.tile, ...C.stems, C.n, C.signal]) assert.ok(m.includes(shape), fav + ' carries ' + shape.slice(0, 40));
  }
  // The admin console inlines its own copy of the word: same paths, same period, same box.
  assert.ok(admin.includes('<svg class="admin-brand-word-svg" ' + C.useView), 'admin: the word box is the cap band');
  for (const d of [C.o, C.t, C.a]) assert.ok(admin.includes('d="' + d + '"'), 'admin carries the same letterform: ' + d.slice(0, 12));
  assert.ok(admin.includes(C.period), 'admin closes the word with the period');
  assert.ok(signature.includes('<symbol id="nota-wordmark" ' + C.wordView), 'signing room: the wordmark viewBox is the cap band');
  assert.ok(!signature.includes('viewBox="0 0 92 42"'), 'signing room: no word box is left on the old 92 × 42 frame');

  // Optical sizing at 48% (ADR 0048) — the lockup's GEOMETRY is five custom
  // properties, declared ONCE per surface stylesheet on its lockup root, with
  // the SAME ratios in the carnet, the signing room and the admin console. A
  // surface sets --lockup-tile alone; the word (centred on the tile), the two
  // gaps and the badge follow. Nothing else may size a tile or a word in px.
  const LOCKUP = {
    '--lockup-word': 'calc(var(--lockup-tile) * .48)',
    '--lockup-gap': 'calc(var(--lockup-tile) * .12)',
    '--lockup-badge-gap': 'calc(var(--lockup-tile) * .16)',
    '--lockup-badge-size': 'max(9px, calc(var(--lockup-tile) * .16))',
  };
  const SHEETS = [
    ['styles.css', CSS_SRC, '.brand-sub', ['.brand-word', '.brand-mark-svg', '.ig-mark', '.ig-word']],
    ['signature.css', read('../public/signature.css'), '.brand-sub', ['.brand-word', '.brand-mark-svg']],
    ['admin.css', read('../../admin/public/admin.css'), '.admin-brand-sub', ['.admin-brand-word', '.admin-brand-mark']],
  ];
  for (const [name, css, badge, sized] of SHEETS) {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*--lockup-tile:[^{}]*)\}/g)];
    const roots = blocks.filter((b) => /--lockup-word:/.test(b[2]));
    assert.equal(roots.length, 1, name + ': the five lockup properties are declared in exactly ONE block (its lockup root)');
    const decl = roots[0][2];
    for (const [k, v] of Object.entries(LOCKUP)) {
      const hit = new RegExp(k.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(decl);
      assert.ok(hit, name + ': declares ' + k);
      assert.equal(hit[1].trim(), v, name + ': ' + k + ' carries the shared optical ratio');
      assert.equal((css.match(new RegExp(k.replace(/-/g, '\\-') + ':', 'g')) || []).length, 1, name + ': ' + k + ' is declared once — a surface re-sets --lockup-tile only');
    }
    assert.match(decl, /--lockup-tile:\s*\d+px;/, name + ': the root sets its tile in px');
    // Every tile and word box is sized from the properties — no literal px.
    for (const sel of sized) {
      const re = new RegExp(sel.replace(/[.]/g, '\\.') + '(?![\\w-])[^{}]*\\{[^}]*(?:width|height):\\s*\\d+(?:\\.\\d+)?px', 'g');
      assert.ok(!re.test(css), name + ': ' + sel + ' is sized in px instead of the lockup properties');
    }
    assert.ok(css.includes('width: calc(var(--lockup-word) * 91.8 / 28); height: var(--lockup-word);'), name + ': the word box is --lockup-word tall and keeps the cap band’s ratio');
    assert.ok(css.includes('width: var(--lockup-tile); height: var(--lockup-tile);'), name + ': the tile is --lockup-tile square');
    // The public header/footer use a soft neutral badge; the other lockups keep design 02.
    const badgeRule = [...css.matchAll(new RegExp(badge.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}', 'g'))].find((m) => /background:/.test(m[1]));
    assert.ok(badgeRule, name + ': a ' + badge + ' rule that paints the badge');
    if (name === 'styles.css') {
      assert.match(badgeRule[1], /background:\s*light-dark\(#eef0f2, #2b3035\)/, name + ': Québec has a subtle neutral background in both themes');
      assert.match(badgeRule[1], /color:\s*var\(--ink-muted\)/, name + ': Québec uses theme-aware secondary text');
    } else {
      assert.match(badgeRule[1], /background:\s*var\(--nota-blue-500\)/, name + ': the badge ground is --nota-blue-500 (design 02)');
      assert.match(badgeRule[1], /color:\s*var\(--on-accent\)/, name + ': the badge text is --on-accent (white in both themes)');
    }
    assert.match(badgeRule[1], /font-size:\s*var\(--lockup-badge-size\)/, name + ': the badge is sized from the tile');
    assert.match(badgeRule[1], /font-weight:\s*800/, name + ': the badge is 800');
    assert.match(badgeRule[1], /letter-spacing:\s*\.1em/, name + ': the badge tracks .1em');
    assert.match(badgeRule[1], /padding:\s*\.55em \.7em/, name + ': the badge pads .55em .7em');
    assert.match(badgeRule[1], /border-radius:\s*var\(--radius-xs\)/, name + ': the badge sits on the 3 px step of the square register');
  }
});

test('P1-8: the canonical origin is declared once in the head', () => {
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  const doc = dom.window.document;
  const meta = doc.querySelector('meta[name="nota:site"]');
  assert.ok(meta, 'a <meta name="nota:site"> names the public origin');
  const site = meta.getAttribute('content');
  assert.match(site, /^https:\/\/[^/]+$/, 'origin only, no trailing slash: ' + site);
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), site + '/', 'canonical and site agree');
});

test('P2-2 / P2-3 / P2-4: manifests — no forced orientation, a dark splash, an English start URL', () => {
  const fr = JSON.parse(read('../public/manifest.webmanifest'));
  const en = JSON.parse(read('../public/manifest.en.webmanifest'));
  const darkBg = /:root\[data-theme='dark'\]\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{6})/.exec(CSS_SRC)[1].toLowerCase();
  for (const m of [fr, en]) {
    assert.equal(m.orientation, undefined, 'no portrait lock — the carnet is a table, tablets rotate');
    assert.equal(m.background_color.toLowerCase(), darkBg, 'the splash is the dark canvas the page boots in');
  }
  assert.equal(fr.start_url, '/');
  assert.equal(en.start_url, '/?lang=en');
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  const dark = [...dom.window.document.querySelectorAll('meta[name="theme-color"]')]
    .find((m) => /prefers-color-scheme:\s*dark/.test(m.getAttribute('media') || ''));
  assert.ok(dark, 'a dark theme-color meta');
  assert.equal(dark.getAttribute('content').toLowerCase(), darkBg);
});

test('P2-6: the sitemap carries lastmod and hreflang alternates', () => {
  const xml = read('../public/sitemap.xml');
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(xml, /<xhtml:link rel="alternate" hreflang="en-CA" href="[^"]*\?lang=en"\s*\/>/);
  assert.match(xml, /hreflang="fr-CA"/);
  assert.match(xml, /hreflang="x-default"/);
});

test('P2-7: the service worker ignores other origins and never answers a failed asset with HTML', () => {
  const sw = read('../public/sw.js');
  assert.match(sw, /url\.origin\s*!==\s*self\.location\.origin/, 'a same-origin guard before any caching');
  assert.equal((sw.match(/caches\.match\('\/index\.html'\)/g) || []).length, 1,
    'only the navigation branch falls back to the shell — an asset must not get index.html');
});


test('notary landing keeps the beta disclosure inside optional information', async () => {
  const { doc } = await boot();
  doc.querySelector('.nav-tab[data-tab="notaires"]').click();
  await wait(10);

  const note = doc.getElementById('notary-ai-beta-note');
  assert.ok(note, 'the beta markup remains available to its dedicated tab flow');
  assert.equal(note.hidden, false, 'the beta teaser is available on the notary landing');
  assert.equal(note.parentElement.id, 'notary-calendar-explore',
    'the beta teaser stays with optional information after calendar subscription');
  assert.equal(note.parentElement.open, false, 'secondary information starts folded');
  note.parentElement.open = true;
  assert.match(CSS_SRC, /\.notary-landing-left\s*\{/,
    'the landing has a dedicated left content rail');
  assert.match(CSS_SRC, /\.notary-landing-right\s*\{/,
    'the landing has a dedicated right content rail');
  assert.match(CSS_SRC, /#pane-notaires[^{}]*\.notary-ai-beta-note\s*\{\s*display:\s*block/s,
    'the landing keeps the beta teaser available without expanding its footprint');

  const toggle = doc.getElementById('notary-ai-beta-toggle');
  const details = doc.getElementById('notary-ai-beta-details');
  assert.equal(toggle.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(details.getAttribute('role'), 'dialog');
  assert.equal(details.getAttribute('aria-hidden'), 'true');
  toggle.click();
  assert.equal(details.getAttribute('aria-hidden'), 'false');
  assert.equal(details.hidden, false, 'clicking the info control opens the explanation');
  assert.match(CSS_SRC, /\.beta-teaser-details\s*\{[^}]*position:\s*absolute/, 'the explanation floats over the page');
  assert.match(CSS_SRC, /\.beta-teaser:hover \.beta-teaser-details,\s*\.beta-teaser:focus-within \.beta-teaser-details/, 'hover and keyboard focus reveal the same surface');
});

test('the footer’s Beta link asks an anonymous visitor to sign in', async () => {
  const { doc } = await boot();
  doc.querySelector('.site-footer [data-goto="beta"]').click();
  // The owner, 2026-09-12: a section that needs an account is not available
  // without one. The visitor stays on the carnet with the sign-in sheet up,
  // instead of landing on a room they cannot enter.
  assert.equal(activePane(doc), 'pane-carnet');
  assert.equal($(doc, 'auth-dialog').open, true, 'the sign-in sheet is what opens instead');
});

test('Beta opens from the footer, participates in history and exposes the preview', async () => {
  const { win, doc } = await boot({ seed: { 'nota.profile.v1': JSON.stringify({ courriel: 'client@exemple.test' }) } });
  doc.querySelector('.site-footer [data-goto="beta"]').click();
  assert.equal(activePane(doc), 'pane-beta');
  assert.equal(win.location.hash.includes('t=beta'), true);
  assert.equal(doc.activeElement, doc.querySelector('#pane-beta h1'));
  assert.equal($(doc, 'tab-beta').getAttribute('aria-selected'), 'true');
  assert.equal($(doc, 'beta-preview').getAttribute('href'), '/signature.html');
  assert.equal(doc.querySelector('.beta-demo').open, false, 'advanced demonstration is secondary');
  assert.match(doc.querySelector('.beta-boundary').textContent, /ne signe aucun acte notarié/);
  doc.querySelector('#pane-beta [data-goto="notaires"]').click();
  assert.equal(activePane(doc), 'pane-notaires');
  win.history.back();
  for (let i = 0; i < 40 && activePane(doc) !== 'pane-beta'; i++) await wait(25);
  assert.equal(activePane(doc), 'pane-beta');
});
