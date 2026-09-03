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
  DOMS.push(dom);
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

// The contact block a notary needs on their profile to retain (ADR 0033).
const PROFIL_OK = { nom: 'Me Démo Nota', etude: 'Étude Démo', telephone: '418 555 0100', adresse: '1, rue de la Démo, Québec (QC) G1R 1A1', lienCNQ: null, rayonKm: 0, urgences: false, prefixe: null };

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
    // Two-step passwordless sign-in: request echoes a challenge token (dev),
    // verify redeems it for the session + feed tokens.
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
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
    if (path.includes('/notary/bids/message')) {
      return json({ message: { id: 'msg-' + calls.length, de: 'notaire', texte: body.texte, createdAt: '2026-08-12T10:00:00Z' } });
    }
    if (path.includes('/notary/bids/release')) {
      const bid = bids.find((b) => b.id === body.id) || {};
      return json({ bid: { ...bid, status: 'ouverte', etude: null } });
    }
    if (path.includes('/notary/profile')) return json({ profil: { ...PROFIL_OK, lienCNQ: (body && body.lienCNQ) || null, rayonKm: (body && body.rayonKm) || 0, urgences: !!(body && body.urgences), prefixe: (body && body.prefixe) || null } });
    if (path.includes('/notary/bids')) {
      return json({
        bids, retained: extra.retained || [],
        rating: extra.rating || null,
        // A COMPLETE contact profile by default (ADR 0033): without nom /
        // téléphone / adresse the console gates Retenir and Proposer.
        profil: extra.profil || PROFIL_OK,
        // ADR 0028: the cote travels with every feed load — always there,
        // barème or not.
        cote: extra.cote || null,
        commission: extra.commission || null,
      });
    }
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
// The by-date agenda (ADR 0020): the date is data ON the card, not a layout
// axis — one grid packs the width chronologically (soonest day first, best
// offer leading its act), and the slim day strip above it carries each
// signing day's count and money where a full-width band per day used to.
// ---------------------------------------------------------------------------
test('open demands render chronologically in one grid; the day strip totals each day', async () => {
  const { doc, open, D } = await bootSignedIn((seedOpen) => seedOpen.slice(0, 8));
  const agenda = D.agendaByDate(open);
  const grids = doc.querySelectorAll('#notary-open-list .nc-agenda-grid');
  assert.equal(grids.length, 1, 'exactly one flat grid holds the feed');
  const cards = [...grids[0].querySelectorAll('.nc-card')];
  // Array.from: the domain ran inside the jsdom realm, so its arrays carry
  // another prototype — strict deepEqual would reject them for that alone.
  const expected = Array.from(agenda).flatMap((d) => Array.from(d.services).flatMap((s) => Array.from(s.bids, (b) => b.id)));
  assert.deepEqual(cards.map((c) => c.dataset.id), expected, 'cards run soonest day first, best offer leading its act');
  for (const card of cards) {
    const b = open.find((x) => x.id === card.dataset.id);
    assert.equal(card.dataset.date, b.dateISO, 'each card carries its signing date');
    assert.ok(card.querySelector('.nc-card-when .nc-when-date'), 'the date reads on the card itself');
  }
  const tiles = [...doc.querySelectorAll('#notary-open-list .nc-days .nc-daytile')];
  assert.equal(tiles.length, agenda.length, 'one day tile per signing day');
  tiles.forEach((tile, i) => {
    const exp = agenda[i];
    assert.equal(tile.dataset.date, exp.dateISO, 'day tiles run in ascending date order');
    assert.equal(tile.querySelector('.nc-day-total').textContent, D.money(exp.total), 'per-day total via money()');
    assert.equal(tile.querySelector('.nc-day-count').textContent, String(exp.count), 'per-day count');
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
  assert.ok(shown.every((c) => open.find((b) => b.id === c.dataset.id).serviceId === svcIds[0]), 'no other act’s card remains');
  click(doc.querySelector('#notary-open-filter .chip[data-svc="all"]'));
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-card').length, open.length, 'Tous restores the full list');
});

// ---------------------------------------------------------------------------
// Card actions: confirm-before-accept, proposition, documents, agenda menu.
// ---------------------------------------------------------------------------
// Retenir opens the confirm SHEET (ADR 0033 — one <dialog>, the whole
// engagement read back); only the sheet's primary posts. The sheet's content
// is covered by notary-mise-en-relation.test.mjs.
test('Retenir asks for a confirmation step before the accept request fires', async () => {
  const { doc, open, calls, D } = await bootSignedIn();
  const cardNow = () => doc.querySelector(`#notary-open-list .nc-card[data-id="${open[0].id}"]`);
  const sheet = $(doc, 'nc-retenir-dialog');
  // Open and settle. Under CI load a stray late re-render can replace the card
  // node between the click and the assertions — re-query and re-click until
  // the sheet is open instead of sampling once.
  const open_ = async () => {
    for (let tries = 0; tries < 5; tries++) {
      if (sheet.open) break;
      click(cardNow().querySelector('.nc-accept'));
      await wait(20);
    }
    return cardNow();
  };
  await open_();
  assert.equal(sheet.open, true, 'Retenir opens the confirm sheet');
  assert.equal(calls.filter((c) => c.path.includes('/notary/bids/accept')).length, 0, 'opening the sheet must not POST');
  const go = $(doc, 'nc-retenir-go');
  assert.ok(go.textContent.includes(D.money(open[0].montant)), 'the confirm button shows the amount');
  assert.ok($(doc, 'nc-retenir-later'), 'a « Pas maintenant » escape is offered');
  click($(doc, 'nc-retenir-later'));
  assert.notEqual(sheet.open, true, 'Pas maintenant closes the sheet');
  await open_();
  click($(doc, 'nc-retenir-go'));
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/bids/accept'));
  assert.equal(posts.length, 1, 'the confirmed click POSTs once');
  assert.deepEqual(posts[0].body, { id: open[0].id, dateISO: open[0].dateISO });
  assert.notEqual(sheet.open, true, 'the sheet closes after the accept');
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
test('an accept never books earnings — settlement waits for « Acte signé » (ADR 0015)', async () => {
  const { doc, open, Nota } = await bootSignedIn();
  const target = open[0];
  const card = doc.querySelector(`#notary-open-list .nc-card[data-id="${target.id}"]`);
  click(card.querySelector('.nc-accept'));
  click($(doc, 'nc-retenir-go'));
  await wait(10);
  const entry = Nota.notary.retainedFor('demo@etude.ca').find((e) => e.id === target.id);
  assert.ok(entry, 'the accept landed in the retained store');
  assert.notEqual(entry.completed, true, 'no act is booked as completed at accept — money moves at signing');
  // The retained card still offers the « Acte signé » path — that is where
  // the settlement (and « Vos revenus ») happens.
  const toast = $(doc, 'toast').textContent;
  assert.ok(/signature/.test(toast), 'the toast says settlement happens at signing: ' + toast);
});

// --- The public profile & the cote-earned commission (ADR 0016 → ADR 0028) ---
// Since ADR 0028 ONE measure decides the share, so the share sentence moved
// where that measure is published: « Votre cote », right under « Vos revenus ».

// A cote payload with the four axes — enough for the panel to render around
// the share sentences these tests are about.
const COTE_STUB = {
  cote: 83,
  axes: [
    { id: 'satisfaction', nom: 'Satisfaction des clients', points: 33, max: 40, detail: { note: 4.5, avis: 10, notePonderee: 4.3, cible: 4.8 } },
    { id: 'services', nom: 'Services rendus', points: 17, max: 25, detail: { actes: 14, cible: 50, servicesRendus: 2, catalogue: 2 } },
    { id: 'disponibilite', nom: 'Disponibilité', points: 19, max: 20, detail: { repondu: 40, declinees: 2, reponses: 42, cibleReponses: 20, rayonKm: 50, urgences: true } },
    { id: 'presence', nom: 'Présence sur Nota', points: 14, max: 15, detail: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 400 } },
  ],
};

test('ART. 29.1 — la console ne nomme AUCUNE part, même si le serveur en envoyait une', async () => {
  // Le serveur a cessé d'envoyer un barème (ADR 0031), mais la console doit
  // rester muette même si un déploiement plus ancien en renvoyait un : le
  // client d'une API ne se protège pas en supposant que le serveur est à jour.
  // L'art. 29.1 du Code de déontologie interdit au notaire « aucune convention
  // ayant pour effet de mettre en péril l'indépendance, le désintéressement,
  // l'objectivité et l'intégrité » : un revenu indexé sur une note attribuée
  // par une entreprise privée en est une, et l'AFFICHER la rend opposable.
  const { doc } = await bootSignedIn(null, {
    rating: { note: 4.5, avis: 10 },
    cote: COTE_STUB,
    commission: {
      taux: 0.15, plancher: 0.05, tauxEffectif: 0.08, part: 0.92, bonus: 0.07, cote: 83,
      axes: COTE_STUB.axes,
      paliers: [{ cote: 80, taux: 0.08, part: 0.92 }, { cote: 90, taux: 0.05, part: 0.95 }],
      prochain: { cote: 90, manque: 7, tauxEffectif: 0.05, part: 0.95 },
    },
  });
  const cote = $(doc, 'notary-cote');
  assert.equal(cote.querySelectorAll('.nc-commission').length, 0, 'aucune phrase d’argent');
  assert.equal(cote.querySelector('.nc-cote-next'), null, 'aucun palier suivant');
  assert.equal(cote.querySelectorAll('.nc-bareme-row').length, 0, 'aucun barème');
  assert.ok(!/gardez|au lieu de|%/.test(cote.textContent.replace(/\d+\s?\/\s?\d+/g, '')),
    'ni pourcentage, ni part : ' + cote.textContent.slice(0, 200));
});

test('la console dit ce que la cote NE fait PAS', async () => {
  const { doc } = await bootSignedIn(null, { cote: COTE_STUB });
  const note = $(doc, 'notary-cote').querySelector('.nc-cote-note');
  assert.ok(note, 'une phrase accompagne la cote');
  assert.match(note.textContent, /en entier/, note.textContent);
  assert.match(note.textContent, /jamais à ce que vous gagnez/, note.textContent);
});

test('without a commission block (billing off) no rate line is invented anywhere', async () => {
  const { doc } = await bootSignedIn(null, { cote: COTE_STUB });
  assert.equal($(doc, 'notary-earnings').querySelector('.nc-commission'), null, 'not with the money');
  assert.equal($(doc, 'notary-cote').querySelector('.nc-commission'), null, 'nor with the cote');
  assert.equal($(doc, 'notary-cote').querySelector('.nc-cote-next'), null, 'and no phantom next rung');
  // The cote itself still stands: a notary has one with or without billing.
  assert.match($(doc, 'notary-cote').querySelector('.nc-cote-n').textContent, /83/);
});

test('the profile form prefills the stored fiche, validates through the domain, and POSTs on save', async () => {
  const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/42/';
  const { doc, calls } = await bootSignedIn(null, { profil: { lienCNQ: FICHE } });
  const inp = $(doc, 'nc-cnq');
  assert.ok(inp, 'the CNQ link input must exist in the console');
  assert.equal(inp.value, FICHE, 'the stored fiche prefills the form');

  // A lookalike host is refused by the DOMAIN before any network call.
  const before = calls.filter((c) => c.path.includes('/notary/profile')).length;
  input(inp, 'https://cnq.org.evil.ca/fiche');
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  const errs = $(doc, 'nc-profil-errors');
  assert.equal(errs.hidden, false, 'the domain refusal must surface');
  assert.equal(calls.filter((c) => c.path.includes('/notary/profile')).length, before, 'no POST on an invalid link');

  // A real fiche is saved through POST /notary/profile.
  input(inp, FICHE);
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/profile'));
  assert.equal(posts.length, before + 1, 'one POST per save');
  assert.equal(posts[posts.length - 1].body.lienCNQ, FICHE);
  assert.equal(errs.hidden, true, 'errors clear on success');
  assert.equal($(doc, 'nc-profil-saved').hidden, false, 'the saved note confirms');
});

// The étude's sector (ADR 0025): prefilled from the stored profile, validated
// through the domain before any network call, sent on save.
test('the profile form carries the étude sector — prefilled, domain-validated, POSTed', async () => {
  const { doc, calls } = await bootSignedIn(null, { profil: { lienCNQ: null, rayonKm: 25, urgences: false, prefixe: 'G1V' } });
  const pre = $(doc, 'nc-prefixe');
  assert.ok(pre, 'the étude-sector input must exist in the console');
  assert.equal(pre.value, 'G1V', 'the stored sector prefills the form');

  // A malformed sector is refused by the DOMAIN before any network call.
  const before = calls.filter((c) => c.path.includes('/notary/profile')).length;
  input(pre, '123');
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  assert.equal($(doc, 'nc-profil-errors').hidden, false, 'the domain refusal must surface');
  assert.equal(calls.filter((c) => c.path.includes('/notary/profile')).length, before, 'no POST on a bad sector');

  // A real sector is normalized and rides the save.
  input(pre, ' g1r ');
  submit($(doc, 'nc-profil-form'));
  await wait(10);
  const posts = calls.filter((c) => c.path.includes('/notary/profile'));
  assert.equal(posts.length, before + 1, 'one POST per save');
  assert.equal(posts[posts.length - 1].body.prefixe, 'G1R', 'normalized like the bid sector');
});

// The measured distance rides the card's facts row (ADR 0025) — only when the
// API could compute it; a feed without sectors shows no phantom kilometres.
test('a demand card shows « ≈ N km » when the API measured it, nothing otherwise', async () => {
  const { doc } = await bootSignedIn((seedOpen) => [
    { ...seedOpen[0], id: 'near', distanceKm: 6 },
    { ...seedOpen[1], id: 'nodist', distanceKm: null },
  ]);
  const nearCard = doc.querySelector('#notary-open-list .nc-card[data-id="near"]') ||
    [...doc.querySelectorAll('#notary-open-list .nc-card')].find((c) => c.textContent.includes('≈ 6 km'));
  assert.ok(nearCard, 'the measured card exists');
  const dist = nearCard.querySelector('.nc-distance');
  assert.ok(dist, 'the distance fact renders');
  assert.equal(dist.textContent, '≈ 6 km', 'approximate by design — the sign says so');
  const others = [...doc.querySelectorAll('#notary-open-list .nc-card')].filter((c) => c !== nearCard);
  assert.ok(others.every((c) => !c.querySelector('.nc-distance')), 'no phantom kilometres without a measure');
});

// The date is an attribute of the card, not a layout axis (ADR 0020): no day
// sections survive — one grid packs the width — and the day strip doubles as
// a per-day filter. The disclosure behaviour itself is covered by
// notary-feed-simple.test.mjs.
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('one grid, no day sections; a day tile filters to its day and back', async () => {
  const heavy = addDays(todayISO(), 2), light = addDays(todayISO(), 5);
  // Clone one open bid: late in a month the seed may hold too few future
  // demands to shape two days from real fixtures.
  const { doc } = await bootSignedIn((seedOpen) =>
    [0, 1, 2, 3].map((i) => ({ ...seedOpen[0], id: 'tile-' + i, dateISO: i < 3 ? heavy : light }))
  );
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-day').length, 0, 'no day section survives');
  const grids = doc.querySelectorAll('#notary-open-list .nc-agenda-grid');
  assert.equal(grids.length, 1, 'exactly one grid holds the feed');
  assert.equal(grids[0].querySelectorAll('.nc-card').length, 4, 'every card lives in the one grid');
  const tiles = [...doc.querySelectorAll('#notary-open-list .nc-daytile')];
  assert.deepEqual(tiles.map((t) => t.dataset.date), [heavy, light], 'day tiles run soonest first');

  click(tiles[1]);
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-card').length, 1, 'a day tile narrows the grid to its day');
  const on = doc.querySelector(`#notary-open-list .nc-daytile[data-date="${light}"]`);
  assert.equal(on.getAttribute('aria-pressed'), 'true', 'the active day reads pressed');
  click(on);
  assert.equal(doc.querySelectorAll('#notary-open-list .nc-card').length, 4, 'pressing again restores every day');
});
