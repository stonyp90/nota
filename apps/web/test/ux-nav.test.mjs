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

test('theme switches show the current theme, stay in sync, and never close the drawer', async () => {
  const { doc } = await boot();
  const header = $(doc, 'theme-toggle');
  const drawerSwitch = $(doc, 'mnav-theme');
  // Dark is the boot default; both switches must say so (checked = dark).
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(header.getAttribute('aria-checked'), 'true');
  assert.equal(drawerSwitch.getAttribute('aria-checked'), 'true');
  header.click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(header.getAttribute('aria-checked'), 'false', 'the header switch reflects the flip');
  assert.equal(drawerSwitch.getAttribute('aria-checked'), 'false', 'the drawer twin follows');
  // The drawer's switch drives the same state — and adjusting a preference is
  // not a navigation choice, so the drawer must stay open.
  $(doc, 'nav-burger').click();
  await wait(10);
  drawerSwitch.click();
  await wait(10);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(header.getAttribute('aria-checked'), 'true');
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
    'Référez, et soyez récompensé.',
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
  const phone = CSS_SRC.slice(CSS_SRC.indexOf('@media (max-width: 719.98px)'));
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

test('P2-19: the logomark is drawn once as a <symbol>; every inline copy is a <use>', () => {
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('symbol#nota-logomark').length, 1, 'one symbol');
  const marks = doc.querySelectorAll('svg.ig-mark');
  assert.ok(marks.length >= 3, 'the chooser and both finales');
  for (const m of marks) {
    assert.ok(m.querySelector('use[href="#nota-logomark"]'), 'a mark is a <use>');
    assert.equal(m.querySelector('rect, polygon, circle'), null, 'no shapes inlined again');
  }
  const outside = HTML_SRC.replace(/<symbol[\s\S]*?<\/symbol>/, '');
  assert.ok(!/fill="#[0-9a-fA-F]{3,6}"/.test(outside), 'no hardcoded fill outside the symbol');
  // The mark's two greens are the stylesheet's brand ramp — every asset
  // (symbol, favicon.svg, og.svg, manifests, theme-color) says the same green.
  const ramp = (step) => /--hunter-STEP:\s*(#[0-9a-fA-F]{6})/.source.replace('STEP', step);
  const brand = new RegExp(ramp('700')).exec(CSS_SRC)[1].toLowerCase();
  const bright = new RegExp(ramp('500')).exec(CSS_SRC)[1].toLowerCase();
  const symbol = /<symbol[\s\S]*?<\/symbol>/.exec(HTML_SRC)[0].toLowerCase();
  assert.ok(symbol.includes('fill="' + brand + '"'), 'the symbol’s square is --hunter-700');
  assert.ok(symbol.includes('fill="' + bright + '"'), 'the symbol’s dot is --hunter-500');
  for (const f of ['../public/favicon.svg', '../public/og.svg']) {
    const svg = read(f).toLowerCase();
    assert.ok(svg.includes(brand) && !svg.includes('#2c5f34') && !svg.includes('#50b848'), f + ' carries the current brand green');
  }
  const light = [...doc.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.getAttribute('media'));
  assert.equal(light.getAttribute('content').toLowerCase(), brand, 'the light theme-color is the brand token');
  for (const f of ['../public/manifest.webmanifest', '../public/manifest.en.webmanifest']) {
    assert.equal(JSON.parse(read(f)).theme_color.toLowerCase(), brand, f + ' theme_color is the brand token');
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
