/**
 * « Vos évaluations » — the notary's own track record (ADR 0021).
 *
 * The console gains a collapsed disclosure panel (ADR 0019's register:
 * history folds, the working surface doesn't) listing every client
 * evaluation the notary has earned: stars, the act, the act's date and the
 * client's comment — anonymized: the panel never shows who wrote it.
 * The list is fetched from GET /notary/evaluations with the SESSION bearer
 * on the panel's FIRST open only, then cached for the session.
 *
 * Boot harness mirrors notary-feed-simple.test.mjs: jsdom outside-only,
 * domain then app, real sign-in via a URL-routing fetch stub.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const $ = (doc, id) => doc.getElementById(id);

async function boot() {
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
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota, seed };
}

// URL-routing fetch stub: the standard notary session doors plus the new
// evaluations door. Records every /notary/evaluations call with its headers.
function stubNotaryApi(win, { evaluations = [], rating = null, evalStatus = 200 } = {}) {
  const calls = { evals: [] };
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/evaluations')) {
      calls.evals.push({ path, headers: init.headers || {} });
      if (evalStatus !== 200) return json({ errors: [{ message: 'boom' }] }, evalStatus);
      return json({ rating, evaluations });
    }
    if (path.includes('/notary/bids')) return json({ bids: [], retained: [], rating, profil: { lienCNQ: null }, commission: null });
    return Promise.reject(new Error('offline'));
  };
  return calls;
}

async function bootSignedIn(opts) {
  const ctx = await boot();
  const calls = stubNotaryApi(ctx.win, opts);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, calls };
}

// Two evaluations, newest first, exactly the API contract's shape — plus
// sneaky identity fields the renderer must NEVER pick up: the panel is
// anonymous even if a payload ever carried more than the contract.
function fixtures(D) {
  const svc = D.SERVICES[0];
  return [
    { note: 5, commentaire: 'Impeccable, tout était prêt avant la signature.', serviceId: svc.id, dateISO: '2026-08-20', createdAt: '2026-08-21T15:00:00.000Z', clientNom: 'Jeanne Untel', courriel: 'jeanne@client.ca' },
    { note: 3, commentaire: null, serviceId: svc.id, dateISO: '2026-07-02', createdAt: '2026-07-03T15:00:00.000Z', clientNom: 'Marc Untel', courriel: 'marc@client.ca' },
  ];
}

// ---------------------------------------------------------------------------
// (a) The panel exists, collapsed by default, inside the authed console.
// ---------------------------------------------------------------------------
test('the panel ships collapsed inside #notary-authed, with the right summary', async () => {
  const { doc, calls } = await bootSignedIn();
  const panel = $(doc, 'notary-evals');
  assert.ok(panel, 'the « Vos évaluations » panel exists');
  assert.equal(panel.tagName, 'DETAILS', 'it is a details disclosure');
  assert.equal(panel.open, false, 'it starts collapsed — history, not the working surface');
  assert.ok(panel.classList.contains('nc-prefs'), 'it wears the console disclosure register');
  assert.ok($(doc, 'notary-authed').contains(panel), 'it lives inside the authed console');
  const h = panel.querySelector('summary .nc-h');
  assert.ok(h && h.textContent.includes('Vos évaluations'), 'the summary carries the h2 title');
  assert.ok(panel.querySelector('summary .nc-prefs-hint'), 'the summary carries a quiet hint');
  // It sits between the money and the profile: revenus → évaluations → profil.
  const earnings = $(doc, 'notary-earnings');
  const profil = $(doc, 'notary-profil');
  assert.ok(earnings.compareDocumentPosition(panel) & 4, 'the panel follows « Vos revenus »');
  assert.ok(panel.compareDocumentPosition(profil) & 4, 'the panel precedes « Votre profil public »');
  assert.equal(calls.evals.length, 0, 'nothing is fetched while the panel stays closed');
});

// ---------------------------------------------------------------------------
// (b) First open fetches with the session bearer and renders the rows.
// ---------------------------------------------------------------------------
test('opening the panel fetches /notary/evaluations with the bearer and renders newest first', async () => {
  const ctx = await boot();
  const evals = fixtures(ctx.D);
  const calls = stubNotaryApi(ctx.win, { evaluations: evals, rating: { note: 4.5, avis: 2 } });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);

  const panel = $(ctx.doc, 'notary-evals');
  panel.open = true; // fires the toggle event in jsdom
  await wait(20);

  assert.equal(calls.evals.length, 1, 'one fetch on first open');
  const headers = calls.evals[0].headers;
  const auth = headers.authorization || headers.Authorization;
  assert.equal(auth, 'Bearer sess.tok', 'the SESSION bearer authenticates the call');

  const list = $(ctx.doc, 'nc-evals-list');
  const rows = [...list.querySelectorAll('.nc-eval')];
  assert.equal(rows.length, 2, 'one row per evaluation');

  // The aggregate leads, via the same badge clients see.
  const badge = list.querySelector('.rating-badge');
  assert.ok(badge, 'the aggregate rating badge heads the list');
  assert.match(badge.textContent, /4,5/, 'the average reads fr-CA');

  // Newest first: the 5-star evaluation with the comment renders first.
  const first = rows[0];
  const stars = first.querySelector('.nc-eval-stars');
  assert.equal(stars.textContent, '★★★★★', 'five filled stars');
  assert.equal(stars.getAttribute('aria-label'), 'Note 5 sur 5', 'stars carry an accessible note');
  const svcLabel = ctx.D.SERVICES[0].nom;
  assert.ok(first.querySelector('.nc-eval-svc').textContent.includes(svcLabel), 'the act is labeled from the domain');
  const expectedDate = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date('2026-08-20T00:00:00Z'));
  assert.equal(first.querySelector('.nc-eval-date').textContent, expectedDate, 'the act date reads fr-CA');
  assert.ok(first.querySelector('.nc-eval-comment').textContent.includes('Impeccable'), 'the client comment is quoted');

  // Second row: three of five stars, no comment node.
  const second = rows[1];
  assert.equal(second.querySelector('.nc-eval-stars').textContent, '★★★☆☆');
  assert.equal(second.querySelector('.nc-eval-comment'), null, 'no empty comment block');

  // Cached for the session: closing and reopening never re-fetches.
  panel.open = false;
  await wait(10);
  panel.open = true;
  await wait(20);
  assert.equal(calls.evals.length, 1, 'the second open reuses the session cache');
});

// ---------------------------------------------------------------------------
// (c) Empty response → the quiet empty state.
// ---------------------------------------------------------------------------
test('an empty history renders the empty-state help line', async () => {
  const { doc } = await bootSignedIn({ evaluations: [] });
  const panel = $(doc, 'notary-evals');
  panel.open = true;
  await wait(20);
  const help = $(doc, 'nc-evals-list').querySelector('.help');
  assert.ok(help, 'the empty state is a quiet help line');
  assert.match(help.textContent, /premiers actes signés/, 'it points at the first signed acts');
  assert.equal($(doc, 'nc-evals-list').querySelectorAll('.nc-eval').length, 0, 'no ghost rows');
});

// A failed load must read as an error, never as "no evaluations yet" — and
// never crash the console.
test('a server error renders a quiet help line, not a crash', async () => {
  const { doc } = await bootSignedIn({ evalStatus: 500 });
  const panel = $(doc, 'notary-evals');
  panel.open = true;
  await wait(20);
  const help = $(doc, 'nc-evals-list').querySelector('.help');
  assert.ok(help, 'the error state is a quiet help line');
  assert.match(help.textContent, /Impossible de charger vos évaluations/);
});

// ---------------------------------------------------------------------------
// (d) The panel is anonymous: no client identity, even if the payload leaks it.
// ---------------------------------------------------------------------------
test('no client identity is rendered anywhere in the panel', async () => {
  const ctx = await boot();
  const evals = fixtures(ctx.D); // fixtures carry sneaky clientNom/courriel fields
  stubNotaryApi(ctx.win, { evaluations: evals, rating: { note: 4.5, avis: 2 } });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  const panel = $(ctx.doc, 'notary-evals');
  panel.open = true;
  await wait(20);
  const text = panel.textContent;
  assert.ok(!text.includes('Jeanne'), 'no client first name');
  assert.ok(!text.includes('Untel'), 'no client family name');
  assert.ok(!text.includes('@client.ca'), 'no client email');
  assert.ok(!/\S+@\S+\.\S+/.test(text), 'no email-shaped string at all');
});
