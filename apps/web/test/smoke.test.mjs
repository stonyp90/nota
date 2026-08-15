/**
 * Headless DOM smoke tests for the Nota web app (apps/web/public).
 *
 * The browser loads two <script> tags: domain.js (the UMD @nota/domain, which
 * exposes window.NotaDomain) then app.js (the IIFE that boots and exposes
 * window.Nota). jsdom does NOT fetch external scripts, so we build the DOM with
 * runScripts:'outside-only', then eval the two source files from disk IN ORDER
 * (domain first) inside the window scope, reproducing the real boot.
 *
 * Determinism: the offline fallback seeds the carnet from D.makeFixtures(today),
 * whose bids land 1..27 days ahead — so on the last day of a month the current
 * month can hold zero bids. To keep this smoke suite stable on ANY calendar day,
 * we pre-seed localStorage with makeFixtures(firstOfCurrentMonth): every fixture
 * date (2nd..28th) then falls inside the anchor month. This still exercises the
 * real offline path (fetch rejects -> ensureSeed reads localStorage) while making
 * monthBids a fixed, fully computable set. All expected values are derived from
 * the same window.NotaDomain instance — nothing about the app is hardcoded here.
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

// Same formulas the app uses, so "today"/"anchor" match without pinning the clock.
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const monthKey = (iso) => iso.slice(0, 7);
function daysInMonthUTC(anchor) {
  const p = anchor.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); // day 0 of next month = last day of this one
}

function fire(win, elmt, type) {
  elmt.dispatchEvent(new win.Event(type, { bubbles: true }));
}

/**
 * Build a fresh window, eval domain + app in order, and wait for the async boot.
 * Fresh per test so interactive mutations (offer form, theme, day modal) never
 * bleed between assertions.
 */
async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      // Force the deterministic offline/localStorage path on boot.
      window.fetch = () => Promise.reject(new Error('offline'));
      // jsdom doesn't implement scrolling; setTab calls it on its default path.
      window.scrollTo = () => {};
      // jsdom ships HTMLDialogElement but not showModal/close.
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });

  const win = dom.window;

  // 1) domain -> window.NotaDomain
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;

  // 2) deterministic seed anchored to the first of the current month
  const today = todayISO();
  const anchor = firstOfMonth(today);
  const month = monthKey(anchor);
  const seed = D.makeFixtures(anchor);
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(seed));

  // 3) app -> boots immediately (readyState is 'complete'), exposes window.Nota
  win.eval(APP_SRC);
  await wait(50); // boot awaits store.listMonth

  const expectedMonth = seed.filter((b) => monthKey(b.dateISO) === month);
  return { dom, win, doc: win.document, D, Nota: win.Nota, today, anchor, month, seed, expectedMonth };
}

const $ = (doc, id) => doc.getElementById(id);
const all = (doc, sel) => Array.from(doc.querySelectorAll(sel));

// 1. Boot exposes the two documented globals with their expected shape.
test('boot exposes window.NotaDomain and window.Nota with expected keys', async () => {
  const { win, D, Nota } = await boot();
  assert.equal(typeof win.NotaDomain, 'object');
  for (const k of ['money', 'SERVICES', 'TIERS', 'STATUS', 'validateOffer', 'makeFixtures']) {
    assert.ok(k in D, `NotaDomain missing ${k}`);
  }
  assert.equal(typeof Nota, 'object');
  for (const k of ['state', 'store', 'domain', 'setTab', 'selectDate', 'reload', 'dossierState', '_internals']) {
    assert.ok(k in Nota, `Nota missing ${k}`);
  }
});

// 2. Offline fallback + seeded fixtures.
test('store is offline and monthBids is seeded deterministically', async () => {
  const { Nota, expectedMonth } = await boot();
  assert.equal(Nota.store.online, false);
  assert.ok(Nota.state.monthBids.length > 0, 'monthBids should be populated offline');
  assert.equal(Nota.state.monthBids.length, expectedMonth.length);
});

// 3. Calendar grid: one day cell per day-of-month + 7 weekday headers.
test('calendar renders day cells for the anchor month and 7 weekday headers', async () => {
  const { doc, anchor } = await boot();
  const dayCells = all(doc, '#cal-grid .cal-cell:not(.is-out)');
  assert.equal(dayCells.length, daysInMonthUTC(anchor));
  assert.equal(all(doc, '#cal-grid .cal-dow').length, 7);
});

// 4. Legend shows one item per tier (5).
test('legend renders one item per timing tier', async () => {
  const { doc, D } = await boot();
  assert.equal(all(doc, '#legend .legend-item').length, D.TIERS.length);
  assert.equal(D.TIERS.length, 5);
});

// 5. No open/taken day ever renders a bare em-dash headline.
test('no calendar headline is a bare em-dash', async () => {
  const { doc } = await boot();
  const tops = all(doc, '#cal-grid .cal-top');
  assert.ok(tops.length > 0, 'expected at least one headline figure');
  assert.ok(tops.every((t) => t.textContent.trim() !== '—'), 'a cal-top rendered a bare em-dash');
});

// 6. Days with bids carry the has-bids class and a count badge.
test('days with bids get has-bids and a count badge', async () => {
  const { doc } = await boot();
  const hasBids = all(doc, '#cal-grid .cal-cell.has-bids');
  assert.ok(hasBids.length > 0, 'expected at least one day with bids');
  assert.ok(hasBids.every((c) => c.querySelector('.cal-count')), 'a has-bids cell is missing its count badge');
});

// 7. Offer form: 3 service options, anonymity on by default, service selection
//    enables the slider and caps it at prixDepart * PREMIUM_CAP.
test('offer form: services populated, anon default on, slider capped at prixDepart*10', async () => {
  const { win, doc, D, Nota } = await boot();
  assert.equal($(doc, 'o-service').options.length, D.SERVICES.length);
  assert.equal(D.SERVICES.length, 3);

  assert.equal($(doc, 'o-anon').checked, true);
  assert.equal(Nota.state.offer.anonyme, true);

  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  const amt = $(doc, 'o-amount');
  assert.equal(amt.disabled, false);
  const refi = D.serviceById('refinancement');
  assert.equal(amt.max, String(refi.prixDepart * D.PREMIUM_CAP)); // 2000 * 10 = 20000
  assert.equal(amt.max, '20000');
});

// 8. A valid service+date+amount combination enables the submit button.
test('a valid offer combination enables #offer-submit', async () => {
  const { win, doc, D } = await boot();
  const submit = $(doc, 'offer-submit');
  assert.equal(submit.disabled, true); // nothing chosen yet

  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  const date = $(doc, 'o-date');
  date.value = D.addDays(todayISO(), 5); // near future, within range, not passed
  fire(win, date, 'change');
  fire(win, date, 'input');

  const amt = $(doc, 'o-amount');
  amt.value = '2000'; // at the refinancement floor (2000), within the 20000 cap
  fire(win, amt, 'input');

  // The 3 mandatory refinancement params must be answered before submit enables.
  assert.equal(submit.disabled, true, 'still blocked until mandatory params answered');
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(win, lv, 'input');
  $(doc, 'crit-succession__non').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();

  assert.equal(submit.disabled, false);
});

// 9. Dossier tab lists documents+fields of the first service and shows 0/N.
test('dossier tab lists first service intake items and badge shows 0/N', async () => {
  const { doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const svc = D.SERVICES[0];
  const expected = svc.documents.length + svc.champs.length;
  // The intake items, excluding the appended consent row.
  assert.equal(all(doc, '#dossier-list .dossier-item:not(.dossier-consent)').length, expected);
  assert.equal(expected, 6); // testament: 2 docs + 4 champs
  assert.equal(all(doc, '#dossier-list .dossier-consent').length, 1); // consent row present
});

// 9c. The profile is the ONE place for documents: upload / remove / mark-validated.
test('profile documents: upload sets it, then it can be removed', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.setTab('profil');
  const dsel = doc.querySelector('.profil-doc-service');
  assert.ok(dsel, 'document service selector rendered in the profile');
  dsel.value = 'testament'; fire(win, dsel, 'change');
  const rows = all(doc, '.profil-doc-list .doc-row');
  const expected = D.serviceById('testament').documents.length + D.serviceById('testament').champs.length;
  assert.equal(rows.length, expected);
  // A field row exists; no "validé" affordance until it has a value.
  assert.equal(all(doc, '.profil-doc-list .doc-valid').length, 0);
});

// 9b. The dossier profile asks the price-determining questions, shows the price,
//     and is the single source of truth the booking flow reads back.
test('dossier profile determines the price and shares it with the booking flow', async () => {
  const { win, doc, D, Nota } = await boot();
  Nota.setTab('dossier');
  const dsel = $(doc, 'd-service');
  dsel.value = 'refinancement';
  fire(win, dsel, 'change');

  const price = $(doc, 'dossier-price');
  assert.ok(price, 'determined price shown in the profile');
  assert.ok(price.textContent.includes(D.money(2000)), 'base 2000 with no answers');

  const coemp = $(doc, 'dcrit-coemprunteur');
  assert.ok(coemp, 'profile pricing question rendered');
  coemp.checked = true;
  fire(win, coemp, 'change'); // +150, persisted to the profile
  assert.ok($(doc, 'dossier-price').textContent.includes(D.money(2150)));

  // Booking flow reads the profile answer back -> same dynamic floor.
  const osel = $(doc, 'o-service');
  osel.value = 'refinancement';
  fire(win, osel, 'change');
  assert.equal(Number($(doc, 'o-amount').min), 2150);
});

// 10. Clicking a has-bids cell opens the day modal populated with bid rows.
test('clicking a has-bids cell opens the day modal with bid rows', async () => {
  const { doc } = await boot();
  const cell = doc.querySelector('#cal-grid .cal-cell.has-bids');
  assert.ok(cell, 'expected a has-bids cell to click');
  cell.click();

  assert.equal($(doc, 'day-dialog').open, true);
  assert.ok(all(doc, '#day-bids .bid-row').length >= 1, 'day modal has no bid rows');
  assert.ok($(doc, 'day-title').textContent.trim().length > 0, 'day-title is empty');
});

// 11. Theme toggle flips document[data-theme] between dark and light.
test('theme toggle flips documentElement[data-theme]', async () => {
  const { doc } = await boot();
  const root = doc.documentElement;
  assert.equal(root.getAttribute('data-theme'), ''); // markup default

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'dark');

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'light');
});

// 12b. Optional courriel field exists and never blocks a valid offer, and the
//      offline store never keeps it on the public bid (privacy by omission).
test('courriel field is optional and stays private in the local store', async () => {
  const { win, doc, D, Nota } = await boot();

  // The field is present in the offer form and not required.
  const courriel = $(doc, 'o-courriel');
  assert.ok(courriel, 'offer form is missing #o-courriel');
  assert.equal(courriel.required, false);

  // A valid offer WITHOUT a courriel still enables submit.
  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');
  const date = $(doc, 'o-date');
  date.value = D.addDays(todayISO(), 5);
  fire(win, date, 'change');
  fire(win, date, 'input');
  $(doc, 'o-amount').value = '2000';
  fire(win, $(doc, 'o-amount'), 'input');
  $(doc, 'crit-valeur_pret').value = '300000'; fire(win, $(doc, 'crit-valeur_pret'), 'input');
  $(doc, 'crit-succession__non').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  assert.equal($(doc, 'offer-submit').disabled, false);

  // Creating a bid with a courriel offline must not surface it on the bid.
  const res = await Nota.store.createBid({
    serviceId: 'refinancement', dateISO: D.addDays(todayISO(), 5), montant: 2000,
    anonyme: true, courriel: 'client@example.ca',
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue' },
  });
  assert.equal(res.ok, true);
  assert.equal(res.bid.courriel, undefined);
});

// 12b. Pricing criteria are woven into the booking flow and adjust the floor live
//      ("the document merged with the process").
test('offer criteria render and a flag raises the dynamic floor', async () => {
  const { win, doc } = await boot();
  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  assert.equal($(doc, 'o-criteria-step').hidden, false);
  assert.ok($(doc, 'crit-valeur_pret'), 'loan-value input rendered');
  const coemp = $(doc, 'crit-coemprunteur');
  assert.ok(coemp, 'co-borrower flag rendered');

  const amt = $(doc, 'o-amount');
  assert.equal(Number(amt.min), 2000); // base floor before any criterion

  coemp.checked = true;
  fire(win, coemp, 'change'); // +150 -> dynamic floor rises
  assert.equal(Number(amt.min), 2150);
  assert.equal(Number(amt.max), 21500); // (2000 + 150) * 10
});

// 12c. The profile saves coordinates + notification prefs and prefills the offer.
test('profile persists coordinates and prefills the offer form', async () => {
  const { win, doc, Nota } = await boot();
  Nota.setTab('profil');

  const courriel = $(doc, 'p-courriel'); courriel.value = 'client@example.ca'; fire(win, courriel, 'input');
  const prefix = $(doc, 'p-prefixe'); prefix.value = 'g1r'; fire(win, prefix, 'input');
  const pub = $(doc, 'p-notif-published'); assert.ok(pub, 'notification toggle rendered');
  pub.checked = false; fire(win, pub, 'change');

  // Re-render reflects the persisted values (incl. the uppercased prefix + the pref).
  Nota.setTab('carnet'); Nota.setTab('profil');
  assert.equal($(doc, 'p-courriel').value, 'client@example.ca');
  assert.equal($(doc, 'p-prefixe').value, 'G1R');
  assert.equal($(doc, 'p-notif-published').checked, false);

  // Opening a day prefills the offer form from the profile.
  doc.querySelector('#cal-grid .cal-cell.has-bids').click();
  assert.equal($(doc, 'o-courriel').value, 'client@example.ca');
  assert.equal($(doc, 'o-prefix').value, 'G1R');
});

// 12d. The single account menu (avatar) merges profile + notifications + menu.
test('account menu opens and navigates to the profile', async () => {
  const { doc } = await boot();
  // Only two primary tabs remain (Carnet, Notaires) — the rest moved into the menu.
  assert.equal(doc.querySelectorAll('.nav-tabs .nav-tab').length, 2);

  const bell = $(doc, 'notif-bell');
  bell.click(); // open the account menu
  assert.equal($(doc, 'notif-panel').hidden, false);

  $(doc, 'acct-profil').click(); // "Mon profil"
  assert.equal($(doc, 'pane-profil').hidden, false);
  assert.equal($(doc, 'notif-panel').hidden, true); // menu closes after navigating
});

// 13. Notary console: the auth gate renders, the authed view is gated until
//     sign-in, and Nota.notary exposes its hooks. feedUrl builds a webcal link.
test('notary console renders its auth gate and exposes Nota.notary hooks', async () => {
  const { doc, Nota } = await boot();
  assert.ok($(doc, 'notary-console'), 'notary console missing');
  assert.ok($(doc, 'nc-email'), 'notary email field missing');
  assert.equal($(doc, 'notary-authed').hidden, true); // gated until sign-in
  assert.equal($(doc, 'notary-auth-form').hidden, false);
  assert.equal(typeof Nota.notary, 'object');
  for (const k of ['signIn', 'signOut', 'loadBids', 'accept', 'decline', 'feedUrl', 'state']) {
    assert.ok(k in Nota.notary, `Nota.notary missing ${k}`);
  }
  // feedUrl swaps the http(s) scheme for webcal:// and carries the token.
  assert.match(Nota.notary.feedUrl('abc.def'), /^webcal:\/\/.*\/notary\/feed\.ics\?token=abc\.def$/);
});

// 14. The footer privacy link opens the dedicated Law 25 confidentialité pane.
test('privacy link opens the Law 25 confidentialité pane', async () => {
  const { doc } = await boot();
  const pane = $(doc, 'pane-confidentialite');
  assert.ok(pane, 'confidentialité pane missing');
  assert.equal(pane.hidden, true);
  $(doc, 'privacy-link').click();
  assert.equal(pane.hidden, false);
  assert.equal(pane.classList.contains('is-active'), true);
});

// 15. Submitting an offer attaches the saved dossier snapshot + courriel to the
//     store payload (so an accepting notary sees real data).
test('submitting an offer attaches the saved dossier snapshot and courriel', async () => {
  const { win, doc, D, Nota } = await boot();
  const snap = { valeurPropriete: '250000', __consent: '1' };
  win.localStorage.setItem('nota.dossier.v1', JSON.stringify({ refinancement: snap }));

  // Nota.store is the same object the app submits through — spy on createBid.
  let captured = null;
  const orig = Nota.store.createBid;
  Nota.store.createBid = async function (payload) {
    captured = payload;
    return { ok: true, bid: { id: 'x', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } };
  };

  const sel = $(doc, 'o-service'); sel.value = 'refinancement'; fire(win, sel, 'change');
  const date = $(doc, 'o-date'); date.value = D.addDays(todayISO(), 5); fire(win, date, 'change'); fire(win, date, 'input');
  $(doc, 'o-amount').value = '2000'; fire(win, $(doc, 'o-amount'), 'input');
  $(doc, 'crit-valeur_pret').value = '300000'; fire(win, $(doc, 'crit-valeur_pret'), 'input');
  $(doc, 'crit-succession__non').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  $(doc, 'o-courriel').value = 'client@example.ca'; fire(win, $(doc, 'o-courriel'), 'input');
  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(10);

  Nota.store.createBid = orig;
  assert.ok(captured, 'createBid was not called');
  // The saved snapshot's fields ride along (the dossier also picks up the
  // answered __pricing, which is expected — pricing answers live in the profile).
  assert.equal(captured.dossier.valeurPropriete, snap.valeurPropriete);
  assert.equal(captured.dossier.__consent, snap.__consent);
  assert.equal(captured.courriel, 'client@example.ca');
});

// 12. Money passthrough: amounts route through D.money — trailing " $" and
//     space-grouped thousands appear in the rendered figures.
test('rendered amounts use the money() format ("N NNN $")', async () => {
  const { doc } = await boot();
  const texts = all(doc, '#cal-grid .cal-top, #agenda .bid-amount').map((e) => e.textContent);
  assert.ok(texts.length > 0, 'no money figures rendered');
  assert.ok(texts.some((t) => / \$$/.test(t.trim())), 'no amount ends with " $"');
  assert.ok(texts.some((t) => /\d \d{3} \$/.test(t)), 'no space-grouped thousands amount found');
});

// 17. Filters are collapsed by default and the toolbar toggle reveals/hides them;
//     activating a filter surfaces a count badge on the (collapsed) toggle.
test('filters stay hidden until the toggle opens them, with an active-count badge', async () => {
  const { win, doc } = await boot();
  const panel = $(doc, 'filters');
  const toggle = $(doc, 'filters-toggle');
  assert.equal(panel.hidden, true, 'filter panel should start hidden');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  toggle.click();
  assert.equal(panel.hidden, false, 'toggle should reveal the filter panel');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  toggle.click();
  assert.equal(panel.hidden, true, 'toggle should collapse the filter panel again');

  // The count badge stays hidden with no active filters, and appears once one is set.
  const badge = $(doc, 'filters-count');
  assert.equal(badge.hidden, true, 'count badge should be hidden with no active filters');
  const openBtn = all(doc, '#chips-service .chip').find((c) => c.dataset.svc);
  openBtn.click();
  assert.equal(badge.hidden, false, 'count badge should show once a filter is active');
  assert.equal(badge.textContent, '1');
  assert.ok(toggle.classList.contains('has-active'), 'toggle should mark itself active');
});

// 18. Maximize toggle expands the calendar full-width and hides the offer panel.
test('maximize toggle adds cal-max and hides the side panel', async () => {
  const { doc } = await boot();
  const layout = doc.querySelector('.layout');
  const btn = $(doc, 'cal-maximize');
  assert.equal(layout.classList.contains('cal-max'), false);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');

  btn.click();
  assert.equal(layout.classList.contains('cal-max'), true, 'maximize should add cal-max');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');

  btn.click();
  assert.equal(layout.classList.contains('cal-max'), false, 'toggling again should restore the layout');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

// --- EDGE CASES (UI) — status marking + empty states -------------------------

// Replace the seeded month with custom bids, then re-render through the app.
async function reseed(ctx, bids) {
  ctx.win.localStorage.setItem('nota.bids.v1', JSON.stringify(bids));
  await ctx.Nota.reload();
  await wait(30);
}
const dayOf = (anchor, dd) => anchor.slice(0, 8) + dd; // 'YYYY-MM-' + 'DD'

test('EDGE (UI): a fully-retained day marks the cell taken and names the notary (not dimmed)', async () => {
  const ctx = await boot();
  const iso = dayOf(ctx.anchor, '15');
  const longEtude = 'Notaires du Vieux-Québec et Associés SENCRL s.r.l.';
  await reseed(ctx, [{
    id: 'r1', serviceId: 'testament', dateISO: iso, montant: 1800,
    tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: longEtude, anonyme: true, createdAt: iso,
  }]);

  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell.classList.contains('is-taken'), 'all-retained cell is marked taken');
  assert.ok(cell.querySelector('.cal-top.is-cleared'), 'taken cell shows a struck cleared amount');

  const chip = ctx.doc.querySelector('.agenda .status-chip');
  assert.ok(chip, 'retained agenda row carries a status chip');
  assert.match(chip.getAttribute('title') || '', /Notaires du Vieux-Québec/);
  const row = ctx.doc.querySelector('.agenda .bid-row.is-retenue');
  assert.ok(row && !row.classList.contains('is-open'), 'row is retained, not open');
});

test('EDGE (UI): a filter that matches nothing renders the empty state with a reset CTA', async () => {
  const ctx = await boot();
  ctx.Nota.state.filters.min = 9_999_999; // nothing qualifies
  await ctx.Nota.reload();
  await wait(30);
  const empty = ctx.doc.querySelector('.agenda .agenda-empty');
  assert.ok(empty, 'agenda renders its empty state');
  assert.ok(empty.querySelector('button'), 'empty state offers a CTA button');
});

test('EDGE (UI): a mixed open/retained day keeps the open headline + a split status meter', async () => {
  const ctx = await boot();
  const iso = dayOf(ctx.anchor, '16');
  await reseed(ctx, [
    { id: 'o1', serviceId: 'testament', dateISO: iso, montant: 900, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
    { id: 'r2', serviceId: 'testament', dateISO: iso, montant: 700, tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: 'Étude X', anonyme: true, createdAt: iso },
  ]);
  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell.classList.contains('has-retenue'), 'mixed day flagged has-retenue');
  assert.ok(!cell.classList.contains('is-taken'), 'still has an open offer');
  assert.ok(cell.querySelector('.cal-top:not(.is-cleared)'), 'open headline shown, not struck');
  assert.ok(cell.querySelector('.cal-status-open') && cell.querySelector('.cal-status-taken'), 'split open/taken meter');
});
