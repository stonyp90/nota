/**
 * Notary-pane focus guarantees: at every resolution the pane's working surface
 * is the OPEN, CONFIRMABLE demand — everything else (identity bar, earnings,
 * preferences, payments, calendar) is supporting noise that must stay behind it.
 *
 * Layout (column order, breakpoints) lives in CSS and is verified visually;
 * what THIS suite locks is the structure that layout depends on:
 *   • signed-out: the live open inventory precedes the console in the pane;
 *   • signed-in: the open-demands list is the first working block, before
 *     retained files, earnings, preferences and payments;
 *   • each open card leads with Retenir as its one full-size primary action;
 *   • zero-state earnings render no tile grid — a wall of "0 $" under the
 *     open list would compete with the demands for nothing.
 *
 * Boot mirrors smoke.test.mjs: jsdom outside-only, domain then app, offline
 * store seeded deterministically. The notary session is driven through the
 * real sign-in path with a URL-routing fetch stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';

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
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  const anchor = firstOfMonth(todayISO());
  const seed = D.makeFixtures(anchor);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota, seed };
}

const $ = (doc, id) => doc.getElementById(id);

// Route the app's API calls so the REAL sign-in + load path runs: a session for
// any email, and the given open bids for the console list.
function stubNotaryApi(win, bids) {
  win.fetch = (url) => {
    const path = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session')) return json({ token: 'sess.tok', feedToken: 'feed.tok' });
    if (path.includes('/notary/bids')) return json({ bids });
    return Promise.reject(new Error('offline'));
  };
}

// Sign in through the real flow with a handful of open demands from the seed.
async function bootSignedIn() {
  const ctx = await boot();
  const open = ctx.seed
    .filter((b) => b.status !== ctx.D.STATUS.RETENUE)
    .slice(0, 3)
    .map((b) => ({ ...b, ready: false }));
  stubNotaryApi(ctx.win, open);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, open };
}

// Signed OUT: the pane must put the live open inventory before the console —
// the demands are the pitch; the gate follows them.
test('signed-out pane: the live open inventory precedes the sign-in console', async () => {
  const { doc } = await boot();
  const live = $(doc, 'notary-live');
  const consoleBox = $(doc, 'notary-console');
  assert.ok(live && consoleBox, 'landing blocks missing');
  assert.ok(
    live.compareDocumentPosition(consoleBox) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
    'the console must follow the live inventory in the pane'
  );
  assert.equal(live.hidden, false, 'the live inventory must be visible signed-out');
  assert.ok(
    doc.querySelectorAll('#notary-live-grid .nc-live-card').length > 0,
    'the live inventory must actually show open demands'
  );
});

// Signed IN: open demands are the first working block of the console.
test('signed-in console: open demands come before every supporting block', async () => {
  const { doc } = await bootSignedIn();
  const openList = $(doc, 'notary-open-list');
  const FOLLOWING = doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING;
  for (const id of ['notary-retained-list', 'notary-earnings', 'notary-prefs', 'notary-connect']) {
    const other = $(doc, id);
    assert.ok(other, `${id} missing`);
    assert.ok(
      openList.compareDocumentPosition(other) & FOLLOWING,
      `${id} must follow the open-demands list`
    );
  }
});

// The card's one job is confirming the bid: Retenir is the full-size primary
// action; Décliner stays small and secondary.
test('an open demand card leads with a full-size Retenir and a demoted Décliner', async () => {
  const { doc, open } = await bootSignedIn();
  const cards = doc.querySelectorAll('#notary-open-list .nc-card');
  assert.equal(cards.length, open.length, 'every open demand renders a card');
  const card = cards[0];
  const accept = card.querySelector('.nc-accept');
  const decline = card.querySelector('.nc-decline');
  assert.ok(accept && decline, 'card actions missing');
  assert.ok(accept.classList.contains('btn-primary'), 'Retenir must be the primary action');
  assert.ok(!accept.classList.contains('btn-sm'), 'Retenir must not be shrunk to a small button');
  assert.ok(decline.classList.contains('btn-sm'), 'Décliner stays small');
  assert.ok(!decline.classList.contains('btn-primary'), 'Décliner must not compete as primary');
  assert.ok(
    accept.compareDocumentPosition(decline) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
    'Retenir leads the action row'
  );
});

// Zero-state earnings must not stack a grid of "0 $" tiles under the open list.
test('earnings with nothing completed render no tile grid, only the help line', async () => {
  const { doc } = await bootSignedIn();
  const earnings = $(doc, 'notary-earnings');
  assert.ok(earnings, 'earnings block missing');
  assert.equal(earnings.querySelectorAll('.nc-stat').length, 0, 'zero-state earnings must not render stat tiles');
  assert.ok(earnings.querySelector('.help'), 'the zero state keeps its one-line explanation');
});
