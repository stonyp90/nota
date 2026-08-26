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
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5
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
// any email, and the given open bids for the console list. Every call is
// recorded on `calls` so a test can assert what was POSTed (and what was not).
function stubNotaryApi(win, bids, extra = {}) {
  const calls = [];
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body });
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session')) return json({ token: 'sess.tok', feedToken: 'feed.tok' });
    if (path.includes('/notary/bids/propose')) {
      return json({ proposition: { id: 'prop-1', montant: body.montant, delta: 0, message: body.message || null, status: 'en_attente', createdAt: '2026-08-12T10:00:00Z' } });
    }
    if (path.includes('/notary/bids/documents')) {
      const bid = bids.find((b) => b.id === body.id);
      const items = (extra.D && bid) ? extra.D.requestableItems(bid.serviceId) : [];
      const documents = body.documents.map((id) => items.find((i) => i.id === id) || { id, nom: id, kind: 'document' });
      return json({ demande: { id: 'dem-1', documents, message: body.message || null, createdAt: '2026-08-12T10:00:00Z', fournie: false } });
    }
    if (path.includes('/notary/bids/accept')) return json({ id: body.id, courriel: 'client@example.com', dossier: {} });
    if (path.includes('/notary/bids/decline')) return json({ ok: true });
    if (path.includes('/notary/bids')) return json({ bids, retained: extra.retained || [] });
    return Promise.reject(new Error('offline'));
  };
  return calls;
}

// Sign in through the real flow with a handful of open demands from the seed.
// `pick` shapes the open list (default: the first three open seed bids).
async function bootSignedIn(pick, extra = {}) {
  const ctx = await boot();
  // Only upcoming signings: the seed is anchored on the 1st, and a proposition
  // on a past date is (rightly) refused by the domain.
  const seedOpen = ctx.seed.filter((b) => b.status !== ctx.D.STATUS.RETENUE && b.dateISO >= todayISO());
  const open = (pick ? pick(seedOpen, ctx) : seedOpen.slice(0, 3))
    .map((b) => ({ ready: false, proposition: null, demande: null, missing: [], ...b }));
  const calls = stubNotaryApi(ctx.win, open, { D: ctx.D, ...extra });
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(10);
  return { ...ctx, open, calls };
}

const click = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
const input = (node, value) => { node.value = value; node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));

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

// ---------------------------------------------------------------------------
// The by-date agenda: a notary plans a week, so the open list is grouped by
// signing day (ascending), then by act, with the money on the table per day.
// ---------------------------------------------------------------------------
test('open demands are grouped by date, then by service, with per-day totals', async () => {
  const { doc, open, D } = await bootSignedIn((seedOpen) => seedOpen.slice(0, 8));
  const days = [...doc.querySelectorAll('#notary-open-list .nc-day[data-date]')];
  const agenda = D.agendaByDate(open);
  assert.equal(days.length, agenda.length, 'one .nc-day section per signing day');
  const dates = days.map((d) => d.dataset.date);
  assert.deepEqual(dates, [...dates].sort(), 'days render in ascending date order');
  days.forEach((day, i) => {
    const exp = agenda[i];
    assert.equal(day.dataset.date, exp.dateISO);
    assert.equal(day.querySelector('.nc-day-total').textContent, D.money(exp.total), 'per-day total via money()');
    assert.equal(day.querySelector('.nc-day-count').textContent, String(exp.count), 'per-day count');
    const svcs = [...day.querySelectorAll('.nc-svc[data-service]')];
    // Array.from: the domain ran inside the jsdom realm, so its arrays carry
    // another prototype — strict deepEqual would reject them for that alone.
    assert.deepEqual(svcs.map((s) => s.dataset.service), Array.from(exp.services, (s) => s.serviceId), 'one .nc-svc per service');
    svcs.forEach((s, j) => {
      assert.equal(s.querySelectorAll('.nc-card').length, exp.services[j].bids.length, 'cards live inside their service group');
      assert.equal(s.querySelector('.nc-card').dataset.id, exp.services[j].bids[0].id, 'best offer leads the service group');
    });
  });
  const head = $(doc, 'notary-open-h');
  const total = open.reduce((s, b) => s + b.montant, 0);
  assert.ok(head.textContent.includes(String(open.length)), 'heading carries the open count');
  assert.ok(head.textContent.includes(D.money(total)), 'heading carries the money in play');
});

test('the service chip filter hides the other services', async () => {
  const { doc, open } = await bootSignedIn((seedOpen) => seedOpen.slice(0, 8));
  const svcIds = [...new Set(open.map((b) => b.serviceId))];
  assert.ok(svcIds.length > 1, 'fixture must span several services');
  const chip = doc.querySelector(`#notary-open-filter .chip[data-svc="${svcIds[0]}"]`);
  assert.ok(chip, 'a chip per service');
  click(chip);
  const shown = [...doc.querySelectorAll('#notary-open-list .nc-card')];
  assert.equal(shown.length, open.filter((b) => b.serviceId === svcIds[0]).length);
  assert.ok(doc.querySelectorAll(`#notary-open-list .nc-svc[data-service]:not([data-service="${svcIds[0]}"])`).length === 0, 'no other service group remains');
  click(doc.querySelector('#notary-open-filter .chip[data-svc="all"]'));
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-card').length, open.length, 'Tous restores the full list');
});

// ---------------------------------------------------------------------------
// Card actions: confirm-before-accept, proposition, documents, agenda menu.
// ---------------------------------------------------------------------------
test('Retenir asks for a confirmation step before the accept request fires', async () => {
  const { doc, open, calls, D } = await bootSignedIn();
  const cardNow = () => doc.querySelector(`#notary-open-list .nc-card[data-id="${open[0].id}"]`);
  // Arm and settle. Under CI load a stray late re-render can replace the card
  // node and drop the armed state between the click and the assertions — so
  // re-query and re-click until the confirm sticks instead of sampling once.
  const arm = async () => {
    for (let tries = 0; tries < 5; tries++) {
      if (cardNow().dataset.confirm === '1') break;
      click(cardNow().querySelector('.nc-accept'));
      await wait(20);
    }
    return cardNow();
  };
  let card = await arm();
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 0, 'arming must not POST');
  const confirm = card.querySelector('.nc-accept');
  assert.ok(confirm.textContent.includes(D.money(open[0].montant)), 'the confirm button shows the amount');
  assert.ok(card.querySelector('.nc-accept-cancel'), 'an Annuler escape is offered');
  click(card.querySelector('.nc-accept-cancel'));
  assert.ok(!card.querySelector('.nc-accept-cancel'), 'Annuler reverts the confirm state');
  card = await arm();
  click(card.querySelector('.nc-accept'));
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/accept'));
  assert.equal(posts.length, 1, 'the confirmed click POSTs once');
  assert.deepEqual(posts[0].body, { id: open[0].id, dateISO: open[0].dateISO });
});

test('Proposer un prix validates inline and POSTs a valid proposition', async () => {
  const { doc, open, calls, D } = await bootSignedIn();
  const b = open[0];
  const card = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"]`);
  click(card.querySelector('.nc-propose-btn'));
  const form = card.querySelector('form.nc-propose');
  assert.ok(form, 'the proposition form opens inline');
  const amt = form.querySelector('input[name="montant"]');
  assert.equal(Number(amt.value), D.suggestedCounterOffer(b), 'prefilled with the suggested counter-offer');
  assert.equal(Number(amt.min), b.montant + 1);
  input(amt, String(b.montant));
  submit(form);
  await wait(5);
  const expected = D.validateCounterOffer({ bid: b, montant: b.montant, todayISO: todayISO() }).errors.find((e) => e.code === 'proposition_inferieure').message;
  assert.ok(form.querySelector('.nc-form-errors').textContent.includes(expected), 'the domain error shows inline');
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/propose')).length, 0, 'no POST on an invalid amount');
  const good = D.suggestedCounterOffer(b);
  input(amt, String(good));
  submit(form);
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/propose'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].body.id, b.id);
  assert.equal(posts[0].body.dateISO, b.dateISO);
  assert.equal(posts[0].body.montant, good);
  const fresh = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"]`);
  const pill = fresh.querySelector('.nc-prop-pill');
  assert.ok(pill, 'the card shows the sent-proposition pill');
  assert.ok(pill.textContent.includes(D.money(good)));
  assert.equal(pill.dataset.status, 'en_attente');
  assert.ok(!fresh.querySelector('form.nc-propose'), 'the form collapses after success');
});

test('Demander des documents pre-checks the missing items and POSTs their ids', async () => {
  const { doc, open, calls, D } = await bootSignedIn((seedOpen, ctx) => {
    const first = seedOpen[0];
    const items = ctx.D.requestableItems(first.serviceId);
    return [{ ...first, missing: [items[0].nom] }, ...seedOpen.slice(1, 3)];
  });
  const b = open[0];
  const items = D.requestableItems(b.serviceId);
  const card = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"]`);
  click(card.querySelector('.nc-docs-btn'));
  const form = card.querySelector('form.nc-docs');
  assert.ok(form, 'the documents form opens inline');
  const boxes = [...form.querySelectorAll('input[type="checkbox"][name="documents"]')];
  assert.equal(boxes.length, items.length, 'one checkbox per requestable item');
  const first = boxes.find((x) => x.value === items[0].id);
  assert.equal(first.checked, true, 'missing items are pre-checked');
  assert.ok(first.closest('label').querySelector('.nc-missing'), 'missing items are marked manquant');
  assert.equal(boxes.filter((x) => x.checked).length, 1);
  submit(form);
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/documents'));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.documents, [items[0].id]);
  assert.equal(posts[0].body.id, b.id);
  const fresh = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"]`);
  const pill = fresh.querySelector('.nc-docs-pill');
  assert.ok(pill, 'the card shows the documents-requested pill');
  assert.ok(pill.textContent.includes('1'));
});

test('Décliner collapses into an undo line and only POSTs once flushed', async () => {
  const { doc, open, calls, Nota } = await bootSignedIn();
  const b = open[0];
  const card = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"]`);
  click(card.querySelector('.nc-decline'));
  await wait(5);
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/decline')).length, 0, 'the POST waits for the undo window');
  const undo = doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"] .nc-undo`);
  assert.ok(undo, 'an Annuler undo is offered');
  click(undo);
  await wait(5);
  assert.ok(doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"] .nc-accept`), 'undo restores the card');
  click(doc.querySelector(`#notary-open-list .nc-card[data-id="${b.id}"] .nc-decline`));
  await Nota.notary.flushDecline(b.id);
  await wait(5);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/decline'));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { id: b.id, dateISO: b.dateISO });
});

test('the Agenda menu offers Google, Outlook and .ics on open and retained cards', async () => {
  const retained = { id: 'ret-1', dateISO: todayISO(), serviceId: 'financement', montant: 900, tier: 'standard', prefixe: 'G1R', courriel: 'c@x.ca', dossier: {}, viaProposition: true };
  const { doc } = await bootSignedIn(null, { retained: [retained] });
  for (const sel of ['#notary-open-list .nc-card', '#notary-retained-list .nc-card']) {
    const card = doc.querySelector(sel);
    assert.ok(card, `${sel} missing`);
    const menu = card.querySelector('.nc-agenda');
    assert.ok(menu, `${sel}: agenda menu missing`);
    const hrefs = [...menu.querySelectorAll('a[href]')].map((a) => a.href);
    assert.ok(hrefs.some((h) => h.startsWith('https://calendar.google.com/')), 'Google link');
    assert.ok(hrefs.some((h) => h.startsWith('https://outlook.live.com/')), 'Outlook link');
    assert.ok(hrefs.some((h) => h.startsWith('data:text/calendar')), '.ics link');
  }
});

test('retained entries from the API hydrate the retained list', async () => {
  const retained = { id: 'ret-1', dateISO: todayISO(), serviceId: 'financement', montant: 900, tier: 'standard', prefixe: 'G1R', courriel: 'c@x.ca', dossier: {}, viaProposition: true };
  const { doc, Nota } = await bootSignedIn(null, { retained: [retained] });
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="ret-1"]');
  assert.ok(card, 'the API-retained file renders');
  assert.ok(card.querySelector('.nc-via-prop'), 'counter-accepted retention shows its pill');
  assert.ok(card.querySelector('.nc-docs-btn'), 'a retaining notary may still ask for documents');
  assert.ok(Nota.notary.retainedFor('demo@etude.ca').some((e) => e.id === 'ret-1'), 'merged into the local store');
});

// PAY-ON-ACCEPT (ADR 0008): when the accept response says the captured payment
// settled (`paid: true` + the REAL server-charged commission), the console must
// book the act as completed on the spot — « Vos revenus » counts it, and the
// notary is never asked to "complete" an act that has already paid out.
test('a paid accept books the act into « Vos revenus » immediately', async () => {
  const { doc, open, calls, D, Nota, win } = await bootSignedIn();
  const target = open[0];
  // Override the accept route: this bid was card-authorized, so retaining it
  // captures and pays instantly.
  const prevFetch = win.fetch;
  win.fetch = (url, init = {}) => {
    if (String(url).includes('/notary/bids/accept')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        id: target.id, courriel: 'client@example.com', dossier: {},
        paid: true, commissionCents: 12500, netCents: target.montant * 100 - 12500,
      }) });
    }
    return prevFetch(url, init);
  };
  const card = doc.querySelector(`#notary-open-list .nc-card[data-id="${target.id}"]`);
  click(card.querySelector('.nc-accept'));
  click(card.querySelector('.nc-accept'));
  await wait(10);
  const entry = Nota.notary.retainedFor('demo@etude.ca').find((e) => e.id === target.id);
  assert.ok(entry, 'the accept landed in the retained store');
  assert.equal(entry.completed, true, 'a paid act is booked as completed');
  assert.equal(entry.actAmount, target.montant);
  assert.equal(entry.commissionCents, 12500, 'the REAL server-charged commission, never a client-side rate');
  // The earnings block reflects it without any further action.
  const earn = $(doc, 'notary-earnings').textContent;
  assert.ok(earn.includes(D.money(target.montant)), 'realized value counted');
  assert.ok(earn.includes(D.money(125)), 'commission shown from the server figure');
});
