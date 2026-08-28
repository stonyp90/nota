/**
 * The notary's open feed reads in ONE PASS — progressive disclosure over the
 * old wall of cards.
 *
 * The decision signals stay on the always-visible row (act, amount, tier /
 * complexity / readiness pills, lender · déplacement facts, anything already
 * in flight); everything verbose (facteurs prose, the propose/docs/agenda
 * toolbar) folds into a per-card body behind a « Détails » disclosure. A
 * two-state seg — « L’essentiel » / « Tout afficher » — flips the whole feed
 * at once and the choice is remembered on the device.
 *
 * Boot harness mirrors notary-focus.test.mjs: jsdom outside-only, domain then
 * app, real sign-in via a URL-routing fetch stub.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const $ = (doc, id) => doc.getElementById(id);
const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

async function boot(opts = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
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
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  const seed = D.makeFixtures(firstOfMonth(todayISO()));
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  if (opts.pollMs) win.__NOTA_POLL_MS__ = opts.pollMs; // shrink the feed poll for tests
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota, seed };
}

function stubNotaryApi(win, bids) {
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/bids')) return json({ bids, retained: [], rating: null, profil: { lienCNQ: null }, commission: null });
    return Promise.reject(new Error('offline'));
  };
}

async function bootSignedIn(n = 8) {
  const ctx = await boot();
  const seedOpen = ctx.seed.filter((b) => b.status !== ctx.D.STATUS.RETENUE && b.dateISO >= todayISO());
  const open = seedOpen.slice(0, n).map((b) => ({ ready: false, proposition: null, demande: null, missing: [], ...b }));
  stubNotaryApi(ctx.win, open);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, open };
}

// ---------------------------------------------------------------------------
// Default: the essential view — verbose blocks fold behind a per-card toggle.
// ---------------------------------------------------------------------------
test('the feed boots in the essential view: toolbar and facteurs fold into a hidden body', async () => {
  const { doc, open } = await bootSignedIn();
  const cards = [...doc.querySelectorAll('#notary-open-list .nc-card')];
  assert.equal(cards.length, open.length, 'every open demand renders');
  for (const card of cards) {
    const body = card.querySelector('.nc-card-body');
    assert.ok(body, 'each card carries a disclosure body');
    assert.equal(body.hidden, true, 'the body starts folded');
    assert.ok(body.querySelector('.nc-docs-btn'), 'the toolbar lives inside the folded body');
    const factors = card.querySelector('.nc-factors');
    if (factors) assert.ok(body.contains(factors), 'facteurs prose lives inside the folded body');
    const toggle = card.querySelector('.nc-toggle');
    assert.ok(toggle, 'each card offers a Détails disclosure');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    // The decision row never folds: amount, Retenir, signal pills stay out.
    const accept = card.querySelector('.nc-accept');
    assert.ok(accept && !body.contains(accept), 'Retenir stays on the visible row');
    assert.ok(accept.classList.contains('btn-primary'), 'Retenir keeps its primary weight');
    const meta = card.querySelector('.nc-card-meta');
    assert.ok(meta && !body.contains(meta), 'signal pills stay on the visible row');
  }
  // The date is card data, not structure (ADR 0020): no day sections, one
  // responsive grid packs the width (CSS pinned by regex, like the header
  // heights in ux-nav), and the old masonry span never returns.
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-day').length, 0, 'no day sections survive');
  assert.ok(doc.querySelector('#notary-open-list .nc-agenda-grid'), 'one grid holds the feed');
  assert.match(CSS_SRC, /\.nc-grid\s*{[^}]*auto-fill/, 'the grid packs the width with auto-fill tracks');
  assert.doesNotMatch(CSS_SRC, /\.nc-day--span/, 'the masonry span rule is gone from the stylesheet');
});

test('the per-card toggle opens and closes the body, and an open card survives a re-render', async () => {
  const { doc } = await bootSignedIn();
  const card = doc.querySelector('#notary-open-list .nc-card');
  const id = card.dataset.id;
  click(card.querySelector('.nc-toggle'));
  assert.equal(card.querySelector('.nc-card-body').hidden, false, 'toggle reveals the body');
  assert.equal(card.querySelector('.nc-toggle').getAttribute('aria-expanded'), 'true');

  // Re-render through the filter round-trip: the card must come back open.
  click(doc.querySelector('#notary-open-filter .chip[data-svc="all"]'));
  const fresh = doc.querySelector(`#notary-open-list .nc-card[data-id="${id}"]`);
  assert.equal(fresh.querySelector('.nc-card-body').hidden, false, 'the open card stays open across renders');

  click(fresh.querySelector('.nc-toggle'));
  assert.equal(fresh.querySelector('.nc-card-body').hidden, true, 'toggle folds it back');
});

test('clicking the card surface (not a control) toggles the disclosure too', async () => {
  const { doc } = await bootSignedIn();
  const card = doc.querySelector('#notary-open-list .nc-card');
  click(card.querySelector('.nc-card-title'));
  assert.equal(card.querySelector('.nc-card-body').hidden, false, 'the whole row is the disclosure target');
  click(card.querySelector('.nc-card-title'));
  assert.equal(card.querySelector('.nc-card-body').hidden, true);
});

// ---------------------------------------------------------------------------
// The global seg: « Tout afficher » unfolds every card at once; « L’essentiel »
// folds them back; the choice persists on the device.
// ---------------------------------------------------------------------------
test('« Tout afficher » unfolds every card, persists, and « L’essentiel » folds back', async () => {
  const { doc, win } = await bootSignedIn();
  const seg = $(doc, 'notary-open-view');
  assert.ok(seg, 'the view seg exists');
  const btnDetail = seg.querySelector('[data-view="detail"]');
  const btnCompact = seg.querySelector('[data-view="compact"]');
  assert.ok(btnDetail && btnCompact, 'both view choices are offered');
  assert.equal(btnCompact.getAttribute('aria-pressed'), 'true', 'essential is the default');

  click(btnDetail);
  const bodies = [...doc.querySelectorAll('#notary-open-list .nc-card-body')];
  assert.ok(bodies.length > 0, 'bodies render in the full view');
  assert.ok(bodies.every((b) => !b.hidden), 'every body is visible in the full view');
  assert.equal(btnDetail.getAttribute('aria-pressed'), 'true');
  assert.equal(win.localStorage.getItem('nota.notary.view.v1'), 'detail', 'the choice is remembered');

  // Re-render keeps the full view.
  click(doc.querySelector('#notary-open-filter .chip[data-svc="all"]'));
  assert.ok([...doc.querySelectorAll('#notary-open-list .nc-card-body')].every((b) => !b.hidden), 'the full view survives a render');

  click(btnCompact);
  assert.ok([...doc.querySelectorAll('#notary-open-list .nc-card-body')].every((b) => b.hidden), 'essential folds everything back');
  assert.equal(win.localStorage.getItem('nota.notary.view.v1'), 'compact');
});

// ---------------------------------------------------------------------------
// The console refreshes ITSELF (owner, 2026-08-27): no Rafraîchir button — a
// background poll re-pulls the feed while the session lives, and it never
// fires mid-gesture (focused field, armed confirm, open inline form).
// ---------------------------------------------------------------------------
test('the console refreshes itself: no Rafraîchir button, a background poll re-pulls the feed', async () => {
  const ctx = await boot({ pollMs: 40 });
  const seedOpen = ctx.seed.filter((b) => b.status !== ctx.D.STATUS.RETENUE && b.dateISO >= todayISO());
  const open = seedOpen.slice(0, 4).map((b) => ({ ready: false, proposition: null, demande: null, missing: [], ...b }));
  let feedPulls = 0;
  ctx.win.fetch = (url) => {
    const path = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/bids')) { feedPulls++; return json({ bids: open, retained: [], rating: null, profil: { lienCNQ: null }, commission: null }); }
    return Promise.reject(new Error('offline'));
  };
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  assert.equal($(ctx.doc, 'notary-refresh'), null, 'the Rafraîchir button is gone');
  const before = feedPulls;
  assert.ok(before >= 1, 'sign-in pulls the feed');
  await wait(150);
  assert.ok(feedPulls > before, 'the poll re-pulls the feed on its own');

  // An armed Retenir confirm freezes the poll — a re-render mid-gesture would
  // disarm the hand that was about to accept.
  click(ctx.doc.querySelector('#notary-open-list .nc-card .nc-accept'));
  const card = ctx.doc.querySelector('#notary-open-list .nc-card[data-confirm="1"]');
  assert.ok(card, 'the confirm armed');
  const armedAt = feedPulls;
  await wait(150);
  assert.equal(feedPulls, armedAt, 'no pull fires while a confirm is armed');
});

// ---------------------------------------------------------------------------
// A signed-in notary's app IS the console: the chrome drops the client doors
// (Carnet, Partenaires hidden via body.is-notary-session) until sign-out.
// The sign-out door lives in the header account menu — the panel bar is gone.
// ---------------------------------------------------------------------------
test('signing in marks the notary session on the body; signing out clears it', async () => {
  const ctx = await boot();
  assert.equal(ctx.doc.body.classList.contains('is-notary-session'), false, 'signed out: full menu');
  stubNotaryApi(ctx.win, []);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  assert.equal(ctx.doc.body.classList.contains('is-notary-session'), true, 'signed in: the chrome focuses the console');
  const signOutBtn = [...ctx.doc.querySelectorAll('#acct-actions .acct-action')].find((b) => b.textContent.includes('Se déconnecter'));
  assert.ok(signOutBtn, 'the account menu carries Se déconnecter');
  click(signOutBtn);
  await wait(10);
  assert.equal(ctx.doc.body.classList.contains('is-notary-session'), false, 'signing out restores the menu');
});

// ---------------------------------------------------------------------------
// The two calendar-sync rows are ONE register: the console's « Vos signatures
// dans votre agenda » row wears the same branded sub-btn buttons as the
// public « carnet dans votre agenda » card (Google / Outlook / Apple / iCal).
// ---------------------------------------------------------------------------
test('the notary agenda sync row carries the same branded buttons as the carnet card', () => {
  const dom = new JSDOM(HTML_SRC);
  DOMS.push(dom);
  const doc = dom.window.document;
  for (const id of ['notary-google', 'notary-outlook', 'notary-apple', 'notary-webcal']) {
    const a = doc.getElementById(id);
    assert.ok(a, id + ' link exists');
    assert.ok(a.classList.contains('sub-btn'), id + ' shares the sub-btn register');
    assert.ok(a.querySelector('svg.brand-ic'), id + ' carries its brand icon');
  }
});
