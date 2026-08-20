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
  // The store rebuilds any seed whose pricing signature is stale (ensureSeed);
  // stamp the current signature so this pre-seed reads as current, exactly as
  // a previous run of the app would have left it.
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());

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
  const { doc, anchor, today } = await boot();
  const dayCells = all(doc, '#cal-grid .cal-cell:not(.is-out)');
  assert.equal(all(doc, '#cal-grid .cal-dow').length, 7);

  // The month is drawn WHOLE, past weeks included: a month missing its first
  // fortnight reads as a broken calendar. Past days are inert, not absent.
  const dim = daysInMonthUTC(anchor);
  const dayNums = dayCells.map((c) => Number(c.dataset.date.slice(8, 10)));
  assert.equal(dayCells.length, dim, 'every day of the month has a cell');
  assert.equal(dayNums[0], 1, 'the month starts on the 1st');
  assert.equal(dayNums[dayNums.length - 1], dim, 'and runs to its last day');
  assert.deepEqual(dayNums, dayNums.slice().sort((a, b) => a - b), 'in order, with no gaps');

  const todayDay = Number(today.slice(8, 10));
  if (today.slice(0, 7) === anchor.slice(0, 7)) {
    assert.ok(dayNums.includes(todayDay), 'today is rendered');
    // Everything before today is present AND inert: past dates cannot be booked.
    const past = dayCells.filter((c) => c.dataset.date < today);
    assert.equal(past.length, todayDay - 1, 'every day before today is rendered');
    past.forEach((c) => {
      assert.ok(c.classList.contains('is-past'), c.dataset.date + ' is marked past');
      assert.equal(c.getAttribute('aria-disabled'), 'true', c.dataset.date + ' is disabled');
      assert.equal(c.tabIndex, -1, c.dataset.date + ' is out of the tab order');
    });
  }
});

// 4. Legend shows one item per tier (5).
test('legend renders one item per timing tier', async () => {
  const { doc, D } = await boot();
  assert.equal(all(doc, '#legend .legend-item').length, D.TIERS.length);
  assert.equal(D.TIERS.length, 5, 'five steps, because the last week is where the price moves');
});

// 5. No open/taken day ever renders a bare em-dash headline.
test('no calendar figure is a bare em-dash', async () => {
  const { doc } = await boot();
  const amounts = all(doc, '#cal-grid .svc-bid-amount, #cal-grid .cal-avg');
  assert.ok(amounts.length > 0, 'expected at least one price figure');
  assert.ok(amounts.every((t) => t.textContent.trim() !== '—'), 'a cell rendered a bare em-dash');
});

// 6. A cell states the best OPEN offer per act — a price needs no explaining,
//    unlike the odds percentage it replaced. The colour is decoded by the legend.
test('a day with bids shows the best open offer per act', async () => {
  const { doc, D } = await boot();
  const hasBids = all(doc, '#cal-grid .cal-cell.has-bids');
  assert.ok(hasBids.length > 0, 'expected at least one day with bids');

  // Every such cell prices at least one act, and never repeats the act's name
  // (the Service key in the legend carries it).
  const priced = hasBids.filter((c) => c.querySelector('.cal-svc-bids'));
  assert.ok(priced.length > 0, 'at least one day still has an open offer');
  const names = D.SERVICES.map((sv) => sv.nom);
  priced.forEach((c) => {
    const items = [...c.querySelectorAll('.svc-bid')];
    assert.ok(items.length > 0 && items.length <= D.SERVICES.length);
    items.forEach((it) => {
      // The act's own glyph, tinted with its colour: the same mark the legend,
      // the chips and the market rows use, so one glyph means one act everywhere.
      assert.ok(it.querySelector('.svc-ic') || it.querySelector('.svc-bid-dot'),
        'each price carries its act mark');
      assert.match(it.querySelector('.svc-bid-amount').textContent, /\u00A0\$$/, 'formatted through money()');
      // A cell prints the dot and the price only — no visible act name.
      assert.equal(it.querySelector('.svc-bid-name'), null, 'no visible name in a cell');
      // ...but the name must reach a screen reader, which has no hover and
      // cannot see a colour, and must feed the hover tooltip.
      const sr = it.querySelector('.visually-hidden');
      assert.ok(sr && names.includes(sr.textContent), 'the act is named for assistive tech');
      assert.equal(it.dataset.name, sr.textContent, 'the tooltip names the same act');
    });
  });
  // The odds percentage is gone from the compact surface.
  assert.equal(doc.querySelectorAll('#cal-grid .cal-chance').length, 0);
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
  // The form quotes Nota's starting price; the slider caps at notaPrice × 10.
  assert.equal(amt.max, String(D.notaPrice('refinancement') * D.PREMIUM_CAP)); // 2000 * 10 = 20000
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
  const chip = doc.querySelector('.profil-doc-chips .chip[data-svc="testament"]');
  assert.ok(chip, 'document service chip rendered in the profile');
  chip.click();
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
  // Nota price = 1.5× market (2000 -> 3000) with no answers.
  assert.ok(price.textContent.includes(D.money(D.notaPrice('refinancement'))), 'Nota price 3000 with no answers');

  const coemp = $(doc, 'dcrit-coemprunteur');
  assert.ok(coemp, 'profile pricing question rendered');
  coemp.checked = true;
  fire(win, coemp, 'change'); // +150 market (+225 Nota), persisted to the profile
  assert.ok($(doc, 'dossier-price').textContent.includes(D.money(D.notaPrice('refinancement', { coemprunteur: true }))));

  // Booking flow reads the profile answer back -> same Nota floor.
  const osel = $(doc, 'o-service');
  osel.value = 'refinancement';
  fire(win, osel, 'change');
  assert.equal(Number($(doc, 'o-amount').min), D.notaPrice('refinancement', { coemprunteur: true }));
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
  assert.equal(root.getAttribute('data-theme'), 'dark'); // dark is the default

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'light');

  $(doc, 'theme-toggle').click();
  assert.equal(root.getAttribute('data-theme'), 'dark');
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
  const { win, doc, D } = await boot();
  const sel = $(doc, 'o-service');
  sel.value = 'refinancement';
  fire(win, sel, 'change');

  assert.equal($(doc, 'o-criteria-step').hidden, false);
  assert.ok($(doc, 'crit-valeur_pret'), 'loan-value input rendered');
  const coemp = $(doc, 'crit-coemprunteur');
  assert.ok(coemp, 'co-borrower flag rendered');

  const amt = $(doc, 'o-amount');
  assert.equal(Number(amt.min), D.notaPrice('refinancement')); // Nota floor (3000) before any criterion

  coemp.checked = true;
  fire(win, coemp, 'change'); // +150 market -> Nota floor rises
  assert.equal(Number(amt.min), D.notaPrice('refinancement', { coemprunteur: true })); // 3225
  assert.equal(Number(amt.max), D.notaPrice('refinancement', { coemprunteur: true }) * 10); // 32250
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
  const { win, doc } = await boot();
  // Only two primary tabs remain (Carnet, Notaires) — the rest moved into the menu.
  assert.equal(doc.querySelectorAll('.nav-tabs .nav-tab').length, 2);

  // A signed-in client (has a courriel): the identity head routes to their profile.
  win.localStorage.setItem('nota.profile.v1', JSON.stringify({ courriel: 'marie@example.ca' }));

  const bell = $(doc, 'notif-bell');
  bell.click(); // open the account menu (re-renders it into the client state)
  assert.equal($(doc, 'notif-panel').hidden, false);
  assert.equal($(doc, 'notif-panel').dataset.role, 'client');
  assert.equal($(doc, 'header-auth').hidden, true); // sign-in hidden once signed in

  $(doc, 'acct-profil').click(); // client head -> "Mon profil"
  assert.equal($(doc, 'pane-profil').hidden, false);
  assert.equal($(doc, 'notif-panel').hidden, true); // menu closes after navigating
});

// 12d-bis. Notifications are personal: an anonymous visitor gets no badge and the
// account panel is flagged anonymous (the CSS hides the notifications section).
test('anonymous visitor sees no notifications', async () => {
  const { win, doc } = await boot();
  win.localStorage.setItem('nota.notifs.v1', JSON.stringify([{ key: 'k', title: 'Rappel', read: false }]));
  $(doc, 'notif-bell').click(); // open panel -> renders account menu + notifs (anonymous)
  assert.equal($(doc, 'notif-panel').dataset.role, 'anon');
  assert.equal($(doc, 'notif-badge').hidden, true); // no unread badge while logged out
  assert.equal($(doc, 'header-auth').hidden, false); // visible sign-in when logged out
  // The sign-in / sign-up modal exists as the anonymous entry point.
  assert.ok($(doc, 'auth-dialog'), 'sign-in modal is present');
  assert.equal(doc.querySelectorAll('#auth-role .seg-btn').length, 2); // client / notary
  assert.equal(doc.querySelectorAll('.auth-oauth').length, 3); // Google / Facebook / LinkedIn
});

// 12e. Mes offres: the profile lists the client's posted offers with their status.
test('profile "Mes offres" is a table, soonest first, past offers folded away', async () => {
  const { win, doc, D, Nota } = await boot();
  const at = (n) => D.addDays(todayISO(), n);
  win.localStorage.setItem('nota.myoffers.v1', JSON.stringify([
    { id: 'far',  dateISO: at(20), serviceId: 'testament',     montant: 900 },
    { id: 'soon', dateISO: at(2),  serviceId: 'procuration',   montant: 700 },
    { id: 'old',  dateISO: at(-5), serviceId: 'refinancement', montant: 4000 },
  ]));
  Nota.setTab('profil');

  // Four facts on one axis, not a full-width band per offer.
  const liveTable = doc.querySelector('#my-offers-live').closest('.my-offers');
  assert.deepEqual(
    all(liveTable, 'thead th').map((n) => n.textContent),
    ['Acte', 'Date', 'Montant', 'Statut'],
  );

  // The client's question is temporal, so live offers run soonest first.
  assert.deepEqual(all(doc, '#my-offers-live tr').map((r) => r.dataset.id), ['soon', 'far']);

  // A past offer can never change again, so it does not dilute the live list.
  const past = doc.querySelector('.my-offers-past');
  assert.ok(past, 'past offers are folded away');
  assert.equal(past.open, false, 'and collapsed by default');
  assert.match(past.querySelector('.my-offers-past-sum').textContent, /1 offre passée/);
  assert.deepEqual(all(doc, '#my-offers-past tr').map((r) => r.dataset.id), ['old']);

  // Status is per row, and amounts still go through money().
  const soon = doc.querySelector('#my-offers-live tr[data-id="soon"]');
  assert.equal(soon.querySelector('.my-offer-status').dataset.status, 'pending');
  assert.equal(soon.querySelector('.c-montant').textContent, D.money(700));
  assert.equal(soon.querySelector('.my-offer-rel').textContent, 'dans 2 jours');
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

// 14. The footer legal links open their dedicated panes (Loi 25 confidentialité,
//     conditions d'utilisation / TOS, charte des droits).
test('footer legal links open the confidentialité / conditions / charte panes', async () => {
  const { doc } = await boot();
  for (const [goto, paneId] of [
    ['confidentialite', 'pane-confidentialite'],
    ['conditions', 'pane-conditions'],
    ['charte', 'pane-charte'],
  ]) {
    const pane = $(doc, paneId);
    assert.ok(pane, paneId + ' missing');
    assert.equal(pane.hidden, true, goto + ' pane should start hidden');
    doc.querySelector('.site-footer .goto-link[data-goto="' + goto + '"]').click();
    assert.equal(pane.hidden, false, goto + ' pane should open');
    assert.equal(pane.classList.contains('is-active'), true);
  }
});

// 14b. The account-menu legal links open the same panes.
test('account-menu legal links open the conditions and charte panes', async () => {
  const { doc } = await boot();
  $(doc, 'acct-conditions').click();
  assert.equal($(doc, 'pane-conditions').hidden, false, 'Conditions d’utilisation opens from the menu');
  $(doc, 'acct-charte').click();
  assert.equal($(doc, 'pane-charte').hidden, false, 'Charte des droits opens from the menu');
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

// 12. Money passthrough: amounts route through D.money — the fr-CA no-break
//     space (U+00A0) groups thousands and precedes the sign, so a rendered
//     amount can never wrap mid-number.
test('rendered amounts use the money() format ("N NNN $", no-break spaces)', async () => {
  const { doc } = await boot();
  const texts = all(doc, '#cal-grid .svc-bid-amount, #cal-grid .cal-avg').map((e) => e.textContent);
  assert.ok(texts.length > 0, 'no money figures rendered');
  assert.ok(texts.some((t) => /\u00A0\$$/.test(t.trim())), 'no amount ends with a no-break space + "$"');
  assert.ok(texts.some((t) => /\d\u00A0\d{3}\u00A0\$/.test(t)), 'no grouped-thousands amount found');
  assert.ok(!texts.some((t) => / \$/.test(t)), 'a breaking space before "$" would let it wrap away');
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

  // The carnet rests on every act, so narrowing to one IS a filter.
  const oneAct = all(doc, '#chips-service .chip').find((c) => c.dataset.svc);
  oneAct.click();
  assert.equal(badge.hidden, false, 'count badge shows once a filter is active');
  assert.equal(badge.textContent, '1');
  assert.ok(toggle.classList.contains('has-active'), 'toggle should mark itself active');
});

// 18. Expand button requests true full screen on the calendar panel.
test('expand button requests fullscreen on the calendar panel', async () => {
  const { doc } = await boot();
  const panel = $(doc, 'carnet-panel');
  const btn = $(doc, 'cal-maximize');
  let called = 0;
  panel.requestFullscreen = function () { called++; return Promise.resolve(); };
  assert.equal(btn.getAttribute('aria-pressed'), 'false');

  btn.click();
  assert.equal(called, 1, 'clicking expand should request fullscreen on the calendar panel');
});

// --- EDGE CASES (UI) — status marking + empty states -------------------------

// Replace the seeded month with custom bids, then re-render through the app.
// The carnet shows exactly ONE act at a time, so seeding bids for an act and
// then reading the grid means scoping the carnet to that act. When every seeded
// bid is the same act we do it automatically — otherwise pass `scope` for the
// one under test — so a test reads as "these offers, this act".
async function reseed(ctx, bids, scope) {
  ctx.win.localStorage.setItem('nota.bids.v1', JSON.stringify(bids));
  const acts = [...new Set((bids || []).map((b) => b.serviceId))];
  const act = scope || (acts.length === 1 ? acts[0] : null);
  if (act) ctx.Nota.state.filters.service = act;
  await ctx.Nota.reload();
  await wait(30);
}
const dayOf = (anchor, dd) => anchor.slice(0, 8) + dd; // 'YYYY-MM-' + 'DD'


test('the toolbar surfaces the next availability (soonest open date)', async () => {
  const ctx = await boot();
  const today = todayISO();
  // One open offer dated today (always >= today) → it is the next availability.
  await reseed(ctx, [{
    id: 'a1', serviceId: 'testament', dateISO: today, montant: 900,
    tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: today,
  }]);
  const av = ctx.doc.getElementById('cal-avail');
  assert.ok(av && !av.hidden, 'the next-availability pill is shown when an open offer is upcoming');
  assert.match(av.textContent, /Prochaine dispo/);
  assert.ok(av.textContent.includes(String(Number(today.slice(8, 10)))), 'it names the soonest open date');

  // When that same offer is retained (none open), the pill hides.
  await reseed(ctx, [{
    id: 'a1', serviceId: 'testament', dateISO: today, montant: 900,
    tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: 'Étude X', anonyme: true, createdAt: today,
  }]);
  const av2 = ctx.doc.getElementById('cal-avail');
  assert.ok(av2.hidden, 'no open offer → the pill hides');
});

test('EDGE (UI): a fully-retained day marks the cell taken and names the notary (not dimmed)', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 2); // future date (the list only shows today onward)
  const longEtude = 'Notaires du Vieux-Québec et Associés SENCRL s.r.l.';
  await reseed(ctx, [{
    id: 'r1', serviceId: 'testament', dateISO: iso, montant: 1800,
    tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: longEtude, anonyme: true, createdAt: iso,
  }]);

  // The carnet rests on "Ouvertes", so a retained-only day is absent until the
  // client asks for retained offers — that is the product rule, not a bug.
  assert.equal(ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]').classList.contains('is-taken'),
    false, 'retained offers are not shown by default');
  ctx.doc.querySelector('#seg-statut .seg-btn[data-statut="retenue"]').click();

  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell.classList.contains('is-taken'), 'all-retained cell is marked taken');
  // Nothing is open, so there is no per-act price to quote — the cell falls back
  // to a struck-through figure for what cleared, and offers no chevron.
  assert.ok(cell.querySelector('.cal-avg.is-cleared'), 'taken cell shows a struck cleared figure');
  assert.equal(cell.querySelector('.cal-svc-bids'), null, 'no open price to show');
  assert.match(cell.querySelector('.cal-more-beat').textContent, /retenue —/, 'names the étude instead');

  // Opening the day names the étude on the offer row itself.
  cell.click();
  await wait(30);
  const chip = ctx.doc.querySelector('#day-bids .status-chip');
  assert.ok(chip, 'the retained offer carries a status chip');
  assert.match(chip.getAttribute('title') || '', /Notaires du Vieux-Québec/);
  const row = ctx.doc.querySelector('#day-bids .bid-row.is-retenue');
  assert.ok(row && !row.classList.contains('is-open'), 'row is retained, not open');
});

test('EDGE (UI): a filter that matches nothing empties the grid without breaking it', async () => {
  const ctx = await boot();
  ctx.Nota.state.filters.min = 9_999_999; // nothing qualifies
  await ctx.Nota.reload();
  await wait(30);
  // The month still renders its days — a calendar with no cells would lose the
  // client's place — but no day carries an offer, and the count says so.
  assert.ok(ctx.doc.querySelectorAll('#cal-grid .cal-cell:not(.is-out)').length > 0, 'the month is still drawn');
  assert.equal(ctx.doc.querySelectorAll('#cal-grid .cal-cell.has-bids').length, 0, 'no day shows an offer');
  assert.equal(ctx.doc.getElementById('result-count').textContent, '0 offre ce mois');
});



test('GRID: exactly one tab stop, and the chevron is reached by arrows not Tab', async () => {
  const ctx = await boot();
  const tabbable = all(ctx.doc, '#cal-grid [tabindex="0"]');
  assert.equal(tabbable.length, 1, 'a grid is ONE tab stop, whatever it contains');
  assert.ok(tabbable[0].classList.contains('cal-cell'));
  // Every nested control is arrow-reachable, never Tab-reachable (APG grid).
  all(ctx.doc, '#cal-grid .cell-chevron').forEach((b) => {
    assert.equal(b.tabIndex, -1, 'a chevron must not add its own tab stop');
  });
});

test('GRID: Enter on a chevron toggles that cell and does not open a day', async () => {
  const ctx = await boot();
  const cell = ctx.doc.querySelector('#cal-grid .cal-cell.has-bids .cell-chevron')?.closest('.cal-cell');
  assert.ok(cell, 'a day with offers exists');
  const chevron = cell.querySelector('.cell-chevron');

  // The grid's key handler must not swallow a keystroke aimed at a nested
  // button: it used to preventDefault and open the ROVING-focus date instead.
  const ev = new ctx.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  chevron.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'the chevron keeps its own activation');
  assert.equal($(ctx.doc, 'day-dialog').open, false, 'expanding is not booking');
});

test('GRID: a past day is inert to the keyboard, as it already is to the mouse', async () => {
  const ctx = await boot();
  // Aim the roving focus at yesterday, then press Enter on the grid.
  ctx.Nota.state.focusDate = ctx.D.addDays(ctx.today, -1);
  const ev = new ctx.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  $(ctx.doc, 'cal-grid').dispatchEvent(ev);
  assert.equal($(ctx.doc, 'day-dialog').open, false, 'a past date cannot be booked by keyboard either');
});

test('HASH: an unknown act or status falls back instead of emptying the carnet', async () => {
  // A bookmark from an older build, or a hand-typed URL, must not strand the
  // reader on an empty grid with no way back.
  const bogus = await bootSeeded({}, '#svc=nope&statut=bogus&tri=chaos');
  assert.equal(bogus.Nota.state.filters.service, '', 'unknown act falls back to every act');
  assert.equal(bogus.Nota.state.filters.statut, 'ouverte', 'unknown status falls back to the default');
  assert.equal(bogus.Nota.state.filters.sort, 'montant-desc', 'unknown sort falls back to the default');

  // A legitimate deep link still works.
  const good = await bootSeeded({}, '#svc=procuration&statut=retenue');
  assert.equal(good.Nota.state.filters.service, 'procuration');
  assert.equal(good.Nota.state.filters.statut, 'retenue');
});

test('FILTERS: reset returns to the resting state, not to a state with no act', async () => {
  const ctx = await boot();
  ctx.Nota.state.filters.min = 500;
  ctx.Nota.state.filters.service = 'procuration';
  ctx.Nota.state.filters.statut = 'retenue';
  ctx.doc.querySelector('#filters-reset').click();

  // Reset used to hardcode the pre-change defaults and set statut to '', which
  // revealed retained offers and reported MORE active filters than before.
  assert.equal(ctx.Nota.state.filters.statut, 'ouverte');
  assert.equal(ctx.Nota.state.filters.min, null);
  assert.equal($(ctx.doc, 'filters-count').hidden, true, 'resetting cannot leave filters active');
});

test('CARNET: rests on open offers; retained ones are one filter click away', async () => {
  const ctx = await boot();
  assert.equal(ctx.Nota.state.filters.statut, 'ouverte', 'the carnet opens on what is still winnable');
  assert.equal(ctx.doc.querySelector('#seg-statut .seg-btn[data-statut="ouverte"]').getAttribute('aria-pressed'), 'true');

  // A default is not a choice the client made: it must not light the active-filter
  // badge, and it must not spring the filter panel open on first paint.
  assert.equal($(ctx.doc, 'filters').hidden, true, 'the filter panel starts closed');
  const badge = ctx.doc.getElementById('filters-badge');
  if (badge) assert.equal(badge.hidden, true, 'no active-filter badge for the resting state');

  // Retained offers are still reachable — they are hidden by default, not removed.
  ctx.doc.querySelector('#seg-statut .seg-btn[data-statut="retenue"]').click();
  assert.equal(ctx.Nota.state.filters.statut, 'retenue');
  ctx.doc.querySelector('#seg-statut .seg-btn[data-statut=""]').click();
  assert.equal(ctx.Nota.state.filters.statut, '', 'and "Toutes" still shows everything');
});

test('URGENCY: every upcoming day prices its own notice, from the domain', async () => {
  const ctx = await boot();
  const near = ctx.D.addDays(ctx.today, 1);    // prioritaire
  const calm = ctx.D.addDays(ctx.today, 20);   // standard

  [near, calm].forEach((iso) => {
    const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
    if (!cell) return;                          // may fall outside the anchor month
    const tierId = ctx.D.tierForDays(ctx.D.daysBetween(ctx.today, iso));
    const mark = cell.querySelector('.cal-urgency');
    assert.ok(mark, 'a day with no offer still has a price for its notice: ' + iso);
    assert.equal(mark.dataset.tier, tierId);
    assert.equal(cell.dataset.tier, tierId, 'the cell edge matches the marker');

    // The number shown must be the number the booking form pre-fills, or the
    // calendar quotes a price the form then contradicts.
    const m = ctx.D.tierMultiplier(tierId);
    const shown = Number(mark.textContent.replace('×', '').replace(',', '.'));
    assert.equal(shown, Math.round(m * 10) / 10, 'the cell quotes the domain multiplier');
  });

  // A near date must cost strictly more than a distant one, or the whole
  // premise of the carnet is not on screen.
  assert.ok(
    ctx.D.tierMultiplier(ctx.D.tierForDays(1)) > ctx.D.tierMultiplier(ctx.D.tierForDays(20)),
    'urgency must read as more expensive',
  );

  // The legend is what turns the colour into that price.
  const key = [...ctx.doc.querySelectorAll('#legend .legend-item')]
    .find((n) => /Prioritaire/.test(n.textContent));
  assert.ok(key, 'the legend keys each tier');
  assert.match(key.textContent, /3×/, 'with its multiplier, not just a name');
});



test('LEGEND: the service key decodes the price colours, and says where detail lives', async () => {
  const ctx = await boot();
  const note = ctx.doc.querySelector('#legend .legend-note');
  assert.ok(note, 'the legend carries an explainer for the cell figures');
  const txt = note.textContent;
  assert.match(txt, /meilleure offre encore ouverte/, 'names what the figure is');
  assert.match(txt, /couleur/, 'points at the service key above it');
  assert.match(txt, /multiple du prix de départ/, 'says what the multiplier means');
  // The percentage it used to explain is no longer on the compact surface.
  assert.ok(!/chances d’obtenir/.test(txt), 'no longer explains an odds percentage');

  // The Service key still exists — it is what decodes the dot colours.
  const svcKeys = [...ctx.doc.querySelectorAll('#legend .legend-status-item')];
  assert.ok(svcKeys.length >= ctx.D.SERVICES.length, 'the service key is present');
});

test('DAY: the booking dialog says what the calendar % means for that date', async () => {
  const ctx = await boot();
  // Any upcoming day with offers — avoids assuming today + N stays in-month.
  const cell = [...ctx.doc.querySelectorAll('#cal-grid .cal-cell.has-bids')]
    .find((c) => c.dataset.date > ctx.today);
  assert.ok(cell, 'expected an upcoming cell with offers');
  const iso = cell.dataset.date;
  cell.click();
  await wait(30);

  const line = $(ctx.doc, 'day-chance');
  assert.ok(line, 'the day dialog carries a chance explainer');
  const expected = ctx.D.obtainChance(iso, ctx.today);
  assert.ok(line.textContent.includes(expected + '\u00A0%'),
    'quotes the domain value for THIS date (' + expected + ' %): ' + line.textContent);
  const days = ctx.D.daysBetween(ctx.today, iso);
  const when = days === 1 ? 'demain' : 'dans ' + days + ' jours';
  assert.ok(line.textContent.includes(when), 'and states the lead time driving it (' + when + ')');
  // The odds live ONLY here now, where the sentence says what drives them — the
  // compact cell shows prices instead, which need no explaining.
  assert.equal(cell.querySelector('.cal-chance'), null, 'no unexplained % on the cell');
});

test('DAY: opens on the domain default act, showing only its best offer + totals', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 5);
  await reseed(ctx, [
    { id: 'r1', serviceId: 'refinancement', dateISO: iso, montant: 4000, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
    { id: 'r2', serviceId: 'refinancement', dateISO: iso, montant: 2500, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
    { id: 't1', serviceId: 'testament', dateISO: iso, montant: 9000, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
  ]);
  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  cell.click();
  await wait(30);

  // The booking form opens on the default act, not on an empty choice.
  assert.equal($(ctx.doc, 'o-service').value, ctx.D.DEFAULT_SERVICE_ID);
  const onChip = ctx.doc.querySelector('#o-service-chips .chip.is-on');
  assert.ok(onChip, 'a service chip is pre-selected');
  assert.equal(onChip.dataset.svc, ctx.D.DEFAULT_SERVICE_ID);

  // Exactly one row: the best offer for THAT act (4000), not the day's top (9000).
  // Direct children only — the rest stay in DOM inside the collapsed section.
  const rows = ctx.doc.querySelectorAll('#day-bids > .bid-row');
  assert.equal(rows.length, 1, 'only the best offer for the selected act is listed');
  assert.match(rows[0].querySelector('.bid-amount').textContent, /4\s*000/);
  assert.equal($(ctx.doc, 'day-best').textContent, ctx.D.money(4000), 'headline is the act\u2019s best');

  // ...and the totals are stated.
  const count = ctx.doc.querySelector('#day-bids .day-bids-count').textContent;
  assert.match(count, /2 offres en refinancement/, 'counts the act');
  assert.match(count, /3 offres ce jour/, 'and the whole day');
});

test('DAY: switching the act re-scopes the headline offer and the totals', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 5);
  await reseed(ctx, [
    { id: 'r1', serviceId: 'refinancement', dateISO: iso, montant: 4000, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
    { id: 't1', serviceId: 'testament', dateISO: iso, montant: 9000, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
  ]);
  ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(30);
  assert.equal($(ctx.doc, 'day-best').textContent, ctx.D.money(4000));

  ctx.doc.querySelector('#o-service-chips .chip[data-svc="testament"]').click();
  await wait(30);
  const rows = ctx.doc.querySelectorAll('#day-bids > .bid-row');
  assert.equal(rows.length, 1, 'still a single headline offer');
  assert.equal($(ctx.doc, 'day-best').textContent, ctx.D.money(9000), 'now the testament best');
  assert.match($(ctx.doc, 'day-hint').textContent, /9\s*000/, 'the bar to clear follows too');

  // An act with nothing on the day says so rather than showing another act's offer.
  ctx.doc.querySelector('#o-service-chips .chip[data-svc="procuration"]').click();
  await wait(30);
  assert.equal(ctx.doc.querySelectorAll('#day-bids > .bid-row').length, 0);
  assert.equal($(ctx.doc, 'day-best').textContent, '—');
  assert.match(ctx.doc.querySelector('#day-bids .day-bids-count').textContent, /Aucune offre en procuration/);
});

test('POSTAL: the sector field normalizes as you type and previews what is published', async () => {
  const ctx = await boot();
  const inp = $(ctx.doc, 'o-prefix');
  const prev = $(ctx.doc, 'prefix-preview');
  assert.ok(inp && prev, 'the field and its preview exist');
  assert.equal(inp.getAttribute('autocomplete'), 'postal-code', 'browsers can autofill it');
  assert.ok(ctx.doc.getElementById('prefix-help'), 'the field explains why it is asked');
  assert.equal(inp.getAttribute('aria-describedby'), 'prefix-help');

  // Lowercase + punctuation + overflow are normalized in place by the domain rule.
  inp.value = ' g1r 2k4 ';
  fire(ctx.win, inp, 'input');
  assert.equal(inp.value, 'G1R', 'normalized to the 3-character sector');
  assert.equal(prev.dataset.state, 'ok');
  assert.match(prev.textContent, /Client · G1R/, 'previews the exact public label');

  // Still typing is not an error — the field is optional.
  inp.value = 'G1';
  fire(ctx.win, inp, 'input');
  assert.equal(prev.dataset.state, 'pending');

  // A valid prefix outside Quebec is flagged, not silently accepted.
  inp.value = 'M5V';
  fire(ctx.win, inp, 'input');
  assert.equal(prev.dataset.state, 'warn');
  assert.ok(!ctx.D.isQuebecPostalPrefix('M5V'));

  // Empty clears the preview entirely.
  inp.value = '';
  fire(ctx.win, inp, 'input');
  assert.equal(prev.textContent, '');
});

test('COMING SOON: both audiences are told the act will be doable fully online', async () => {
  const { doc } = await boot();
  const client = doc.querySelector('.soon-online');
  assert.ok(client, 'the booking flow carries the notice');
  assert.match(client.textContent, /Bientôt/, 'it is labelled as not yet available');
  assert.match(client.textContent, /entièrement en ligne/);
  assert.ok(doc.getElementById('offer-submit'), 'and it sits with the publish action');

  const notary = doc.getElementById('notary-phase2-note');
  assert.ok(notary, 'the notary side carries it too');
  assert.match(notary.textContent, /Bientôt/);
  assert.match(notary.textContent, /en ligne/);
});


test('EDGE (UI): a mixed open/retained day stays available with the open average', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 2); // future date (past cells are blanked)
  await reseed(ctx, [
    { id: 'o1', serviceId: 'testament', dateISO: iso, montant: 1400, tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso },
    { id: 'r2', serviceId: 'testament', dateISO: iso, montant: 1300, tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: 'Étude X', anonyme: true, createdAt: iso },
  ]);
  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell.classList.contains('is-avail'), 'mixed day still has an open offer -> available');
  assert.ok(!cell.classList.contains('is-taken'), 'still has an open offer');
  // The price quoted is the best OPEN offer (1400) — the retained 1300 is not
  // what a client has to beat, so it never becomes the headline.
  const priced = [...cell.querySelectorAll('.svc-bid-amount')];
  assert.equal(priced.length, 1, 'one act priced on this day');
  assert.equal(priced[0].textContent.replace(/[\s\u00A0$]/g, ''), '1400');
  assert.equal(cell.querySelector('.cal-avg'), null, 'no struck figure while something is open');

  // The number to beat is that same figure, behind the chevron.
  cell.querySelector('.cell-chevron').click();
  assert.ok(cell.classList.contains('is-expanded'));
  assert.match(cell.querySelector('.cal-more-beat').textContent, /1\u00A0400/);
  // The count reflects what is actually shown: the carnet rests on "Ouvertes",
  // so the retained sibling is filtered out and is not counted as competition.
  assert.match(cell.querySelector('.cal-more-n').textContent, /1 offre/, 'counts the visible offers');
});

test('the hero pulse shows the month median per service and filters the carnet', async () => {
  const ctx = await boot();
  const iso = dayOf(ctx.anchor, '15');
  const mk = (id, serviceId, montant, status) => ({
    id, serviceId, dateISO: iso, montant, tier: 'standard',
    status: status || ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso,
  });
  // testament: 700 / 900 / 2000 -> median 900, one of them retained.
  // procuration: a single 400 offer. refinancement: none this month.
  await reseed(ctx, [
    mk('t1', 'testament', 700),
    mk('t2', 'testament', 900, ctx.D.STATUS.RETENUE),
    mk('t3', 'testament', 2000),
    mk('p1', 'procuration', 400),
  ]);

  const rows = [...ctx.doc.querySelectorAll('#pulse-rows .pulse-row')];
  assert.equal(rows.length, ctx.D.SERVICES.length, 'one row per service, always');
  const byId = Object.fromEntries(rows.map((r) => [r.dataset.svc, r]));

  // Two figures per act: the floor the server accepts at all, and what other
  // clients are actually offering. They answer different questions, so both are
  // shown rather than one standing in for the other.
  const figs = (row) => [...row.querySelectorAll('.pulse-fig')].map((f) => [
    f.querySelector('.pulse-fig-k').textContent,
    f.querySelector('.pulse-fig-v').textContent,
  ]);
  const floorOf = (id) => ctx.D.money(ctx.D.serviceById(id).prixDepart);

  // The median (not the mean: 1200) is what a client is shown.
  assert.deepEqual(figs(byId.testament), [
    ['à partir de', floorOf('testament')],
    ['médiane', ctx.D.money(900)],
  ]);
  assert.match(byId.testament.querySelector('.pulse-meta').textContent, /3 offres · 1 retenue$/);
  assert.deepEqual(figs(byId.procuration), [
    ['à partir de', floorOf('procuration')],
    ['médiane', ctx.D.money(400)],
  ]);

  // An act with no offer this month still shows its floor; the median is simply
  // absent rather than the floor masquerading as a market fact.
  const refi = byId.refinancement;
  assert.deepEqual(figs(refi), [['à partir de', floorOf('refinancement')], ['médiane', '—']]);
  assert.ok(refi.querySelectorAll('.pulse-fig-v')[1].classList.contains('is-empty'));
  assert.match(refi.querySelector('.pulse-meta').textContent, /aucune offre/);

  // The foot line was removed — the rows carry the whole story; nothing may
  // resurrect it below the pulse.
  assert.equal(ctx.doc.getElementById('pulse-foot'), null);
  assert.match(ctx.doc.getElementById('pulse-month').textContent, /\d{4}$/, 'names the displayed month');

  // Clicking a row filters the carnet to that service, and syncs the chip group.
  byId.procuration.click();
  await wait(30);
  assert.equal(ctx.doc.getElementById('result-count').textContent, '1 offre ce mois');
  assert.equal(ctx.doc.querySelector('#chips-service .chip[data-svc="procuration"]').getAttribute('aria-pressed'), 'true');
  const onRow = ctx.doc.querySelector('#pulse-rows .pulse-row[data-svc="procuration"]');
  assert.equal(onRow.getAttribute('aria-pressed'), 'true');
  // The pulse itself keeps reading the WHOLE month — it is the reference, not a result.
  assert.equal(
    ctx.doc.querySelectorAll('#pulse-rows .pulse-row[data-svc="testament"] .pulse-fig-v')[1].textContent,
    ctx.D.money(900),
  );

  // Clicking the active row again returns to every act, the carnet's resting
  // scope: 4 seeded, 1 retained, so 3 open ones are counted.
  onRow.click();
  await wait(30);
  assert.equal(ctx.doc.getElementById('result-count').textContent, '3 offres ce mois');
  assert.equal(ctx.doc.querySelector('#chips-service .chip[data-svc=""]').getAttribute('aria-pressed'), 'true');
});


test('each pulse row has a book button that opens the dialog on that service', async () => {
  const ctx = await boot();
  const iso = dayOf(ctx.anchor, '15');
  await reseed(ctx, [{
    id: 'a1', serviceId: 'testament', dateISO: iso, montant: 900,
    tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso,
  }]);
  ctx.Nota.selectDate(iso);
  const item = ctx.doc.querySelector('.pulse-item .mini-reserver');
  assert.ok(item, 'the book button sits beside the filter row, not inside it');
  // A button may never nest in a button — the filter row IS a button.
  assert.equal(ctx.doc.querySelector('.pulse-row button'), null);

  item.click();
  await wait(30);
  assert.ok(ctx.doc.getElementById('day-dialog').open, 'the booking dialog opened');
  assert.equal(ctx.Nota.state.filters.service, 'testament', 'preselected the act it was clicked from');
  assert.equal(ctx.doc.getElementById('o-service').value, 'testament');
});

test('the footer exposes the domain contact email, and no phone until one exists', async () => {
  const ctx = await boot();
  const host = ctx.doc.getElementById('footer-contact');
  const mail = host.querySelector('a.mini-courriel');
  assert.equal(mail.getAttribute('href'), `mailto:${ctx.D.CONTACT.courriel}`);
  // telephone is null in the domain -> no call button is invented in the UI.
  assert.equal(host.querySelector('.mini-telephone'), ctx.D.CONTACT.telephone ? host.querySelector('.mini-telephone') : null);
});

// 16. The account menu is the ONE identity hub for both roles. It renders three
//     distinct states — notary session, device-local client, anonymous — and the
//     client can "forget me on this device" to return to anonymous.
const acctActionLabels = (doc) =>
  all(doc, '#acct-actions .acct-action .acct-item-title').map((n) => n.textContent);

test('account menu reflects the notary identity when a token is present', async () => {
  const { doc, Nota } = await boot();
  Nota.notary.state.token = 'sess.tok';
  Nota.notary.state.email = 'notaire@quebec.ca';
  Nota.account.render();
  assert.equal(Nota.account.role(), 'notary');
  assert.match($(doc, 'acct-name').textContent, /notaire@quebec\.ca/);
  const roleTag = $(doc, 'acct-role');
  assert.equal(roleTag.hidden, false);
  assert.match(roleTag.textContent, /Espace notaire/i);
  const labels = acctActionLabels(doc);
  assert.ok(labels.some((t) => /dossiers/i.test(t)), 'a route to demandes & dossiers');
  assert.ok(labels.some((t) => /déconnecter/i.test(t)), 'a sign-out action');
});

test('account menu reflects the client identity when the profile has an email', async () => {
  const { win, doc, Nota } = await boot();
  win.localStorage.setItem('nota.profile.v1', JSON.stringify({ courriel: 'client@example.ca', nom: 'Alex Roy' }));
  Nota.account.render();
  assert.equal(Nota.account.role(), 'client');
  assert.equal($(doc, 'acct-email').textContent, 'client@example.ca');
  assert.equal($(doc, 'acct-name').textContent, 'Alex Roy');
  assert.match($(doc, 'acct-role').textContent, /Client/);
  const labels = acctActionLabels(doc);
  assert.ok(labels.some((t) => /profil/i.test(t)), 'a route to the profile');
  assert.ok(labels.some((t) => /déconnecter/i.test(t)), 'a sign-out action');
});

test('account menu shows the anonymous sign-in invitation by default', async () => {
  const { doc, Nota } = await boot();
  assert.equal(Nota.account.role(), 'anon');
  Nota.account.render();
  assert.equal($(doc, 'acct-role').hidden, true);
  assert.match($(doc, 'acct-name').textContent, /connecter/i);
  const labels = acctActionLabels(doc);
  assert.ok(labels.some((t) => /Publier une offre/i.test(t)), 'an offer-flow entry');
  assert.ok(labels.some((t) => /Espace notaire/i.test(t)), 'a notary entry');
});

test('clientSignOut clears the device-local identity and offer history', async () => {
  const { win, Nota } = await boot();
  win.localStorage.setItem('nota.profile.v1', JSON.stringify({ courriel: 'client@example.ca' }));
  win.localStorage.setItem('nota.myoffers.v1', JSON.stringify([{ id: 'o1', dateISO: todayISO(), serviceId: 'testament', montant: 900 }]));
  win.confirm = () => true; // approve the "forget me on this device" guard
  assert.equal(Nota.account.role(), 'client');
  Nota.account.signOut();
  assert.equal(Nota.account.role(), 'anon', 'identity returns to anonymous');
  assert.equal(win.localStorage.getItem('nota.myoffers.v1'), null, 'offer history is cleared');
  const prof = JSON.parse(win.localStorage.getItem('nota.profile.v1') || '{}');
  assert.ok(!prof.courriel, 'the saved email is gone');
});

// 20. First-visit onboarding guide: the dialog exists, auto-shows on a fresh
//     boot (no nota.onboarded.v1), and exposes the documented handle.
test('onboarding dialog exists and auto-shows on a fresh first visit', async () => {
  const { doc, win, Nota } = await boot();
  const dlg = $(doc, 'onboarding-dialog');
  assert.ok(dlg, 'the onboarding dialog is in the DOM');
  assert.ok(dlg.classList.contains('onb-modal'), 'it carries the .onb-modal class');
  // Fresh boot: the flag is unset, so the guide auto-shows (showModal shim → open).
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), null, 'not yet flagged');
  assert.equal(dlg.open, true, 'the guide auto-shows on the first visit');
  // Documented, testable handle.
  assert.equal(typeof Nota.onboarding, 'object');
  assert.equal(typeof Nota.onboarding.open, 'function');
  assert.equal(typeof Nota.onboarding.reset, 'function');
  // VIEW 1 (role choice) is the visible view, with its two outline choice cards.
  assert.equal($(doc, 'onb-view-role').hidden, false);
  assert.equal($(doc, 'onb-view-steps').hidden, true);
  assert.equal(all(doc, '#onb-view-role .onb-choice').length, 2);
});

// 21. It stays dismissed once the browser has seen it (flag gates the auto-show).
test('onboarding does not auto-show when nota.onboarded.v1 is already set', async () => {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      // Pre-seed the "already onboarded" flag before app.js boots.
      window.localStorage.setItem('nota.onboarded.v1', '1');
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(50);
  assert.equal($(win.document, 'onboarding-dialog').open, false, 'the guide stays closed on return visits');
});

// 22. Choosing CLIENT renders that role's 3 steps and the client CTA label.
test('onboarding: choosing the client role renders its 3 steps + CTA', async () => {
  const { doc } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  assert.equal($(doc, 'onb-view-role').hidden, true);
  assert.equal($(doc, 'onb-view-steps').hidden, false);
  const steps = all(doc, '#onb-steps .onb-step');
  assert.equal(steps.length, 3, 'three steps for the client');
  const titles = steps.map((s) => s.querySelector('.onb-step-t').textContent);
  assert.deepEqual(titles, ['Choisissez votre date', 'Proposez votre prix', 'Un notaire vous retient']);
  const chips = steps.map((s) => s.querySelector('.onb-step-n').textContent);
  assert.deepEqual(chips, ['1', '2', '3'], 'numbered 1..3');
  assert.equal($(doc, 'onb-cta').textContent, 'Publier ma demande →');
  assert.equal($(doc, 'onboarding-dialog').getAttribute('data-role'), 'client');
});

// 23. Choosing NOTARY renders its 3 steps and the notary CTA label; "Changer"
//     returns to VIEW 1.
test('onboarding: choosing the notary role renders its 3 steps + CTA, and back returns to VIEW 1', async () => {
  const { doc } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="notary"]').click();
  const titles = all(doc, '#onb-steps .onb-step .onb-step-t').map((n) => n.textContent);
  assert.deepEqual(titles, ['Voyez les demandes ouvertes', 'Retenez celle qui vous convient', 'Complétez l’acte']);
  assert.equal($(doc, 'onb-cta').textContent, 'Voir les demandes →');
  // "← Changer" swaps back to the role choice.
  $(doc, 'onb-back').click();
  assert.equal($(doc, 'onb-view-role').hidden, false);
  assert.equal($(doc, 'onb-view-steps').hidden, true);
});

// 24. Completing the client CTA sets the flag, closes the guide, and routes into
//     the real offer flow (carnet tab + the day dialog opens).
test('onboarding: the client CTA flags onboarded, closes, and opens the offer flow', async () => {
  const { doc, win, Nota } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  $(doc, 'onb-cta').click();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), '1', 'onboarded flag is set');
  assert.equal($(doc, 'onboarding-dialog').open, false, 'the guide is closed');
  assert.equal(Nota.state.tab, 'carnet', 'routed into the carnet');
  assert.equal($(doc, 'day-dialog').open, true, 'the reserve/offer day dialog opened');
});

// 25. Completing the notary CTA routes to the notaires tab.
test('onboarding: the notary CTA flags onboarded, closes, and routes to notaires', async () => {
  const { doc, win, Nota } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="notary"]').click();
  $(doc, 'onb-cta').click();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), '1');
  assert.equal($(doc, 'onboarding-dialog').open, false);
  assert.equal(Nota.state.tab, 'notaires', 'routed into the notaries tab');
});

// 26. Dismissing via "Passer" sets the flag without routing; reset() clears it
//     and open() re-shows VIEW 1.
test('onboarding: Passer dismisses + flags, and reset()/open() re-show the guide', async () => {
  const { doc, win, Nota } = await boot();
  // Move to VIEW 2 so "Passer" is present, then skip.
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  $(doc, 'onb-skip').click();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), '1', 'Passer flags onboarded');
  assert.equal($(doc, 'onboarding-dialog').open, false, 'the guide is closed');
  // reset() clears the flag; open() shows VIEW 1 again.
  Nota.onboarding.reset();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), null, 'reset clears the flag');
  Nota.onboarding.open();
  assert.equal($(doc, 'onboarding-dialog').open, true, 'open() re-shows the guide');
  assert.equal($(doc, 'onb-view-role').hidden, false, 'at VIEW 1 (role choice)');
});

// 27. The footer "Comment ça marche" link re-opens the guide at VIEW 1.
test('onboarding: the footer link re-opens the guide at VIEW 1', async () => {
  const { doc } = await boot();
  const dlg = $(doc, 'onboarding-dialog');
  try { dlg.close(); } catch (e) {} // simulate a prior dismissal
  assert.equal(dlg.open, false);
  const link = $(doc, 'footer-guide');
  assert.ok(link, 'the footer guide link exists');
  link.click();
  assert.equal(dlg.open, true, 'the footer link re-opens the guide');
  assert.equal($(doc, 'onb-view-role').hidden, false, 'reopened at VIEW 1');
});

// ---------------------------------------------------------------------------
// Onboarding, second pass: a remembered role, a recoverable dismissal, and the
// accessibility affordances a two-view modal needs.
// ---------------------------------------------------------------------------

// Boot a fresh app with arbitrary pre-seeded localStorage. Same shims as boot(),
// but the seed runs before app.js so the gates see it.
async function bootSeeded(seed, hash) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed || {}).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, Nota: win.Nota };
}

// 28. The role choice is remembered on the device, not just parked on the dialog.
test('onboarding: the chosen role is persisted and exposed on the handle', async () => {
  const { doc, win, Nota } = await boot();
  assert.equal(win.localStorage.getItem('nota.role.v1'), null, 'no role before choosing');
  doc.querySelector('#onb-view-role .onb-choice[data-role="notary"]').click();
  assert.equal(win.localStorage.getItem('nota.role.v1'), 'notary', 'the choice is persisted');
  assert.equal(Nota.onboarding.role(), 'notary', 'and readable through the handle');
  // Going back and picking the other role overwrites it.
  $(doc, 'onb-back').click();
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  assert.equal(Nota.onboarding.role(), 'client', 'the latest choice wins');
});

// 29. That remembered role is what the auth modal opens on — a notary who said
//     "Je suis notaire" must not be asked again as a client.
test('onboarding: the remembered role pre-selects the auth modal', async () => {
  const { doc } = await bootSeeded({ 'nota.role.v1': 'notary', 'nota.onboarded.v1': '1' });
  $(doc, 'header-login').click();
  const on = doc.querySelector('#auth-role .seg-btn.is-on');
  assert.ok(on, 'a role segment is selected');
  assert.equal(on.dataset.role, 'notary', 'the auth modal opens on the remembered role');
  assert.equal($(doc, 'auth-continue').textContent, 'Accéder à l’espace notaire →');
});

// 30. An accidental dismissal (Escape / backdrop / ✕) must not burn the guide
//     forever — it defers, and the visitor gets one more chance.
test('onboarding: an accidental dismissal defers instead of flagging onboarded', async () => {
  const { doc, win } = await boot();
  const dlg = $(doc, 'onboarding-dialog');
  assert.equal(dlg.open, true);
  fire(win, dlg, 'close'); // what Escape / backdrop / ✕ do in a real browser
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), null, 'not permanently flagged');
  assert.equal(win.localStorage.getItem('nota.onboarded.dismissed.v1'), '1', 'the dismissal is counted');
});

// 31. Second chance granted after one dismissal; withheld after two.
test('onboarding: re-shows after one dismissal, stops after two', async () => {
  const second = await bootSeeded({ 'nota.onboarded.dismissed.v1': '1' });
  assert.equal($(second.doc, 'onboarding-dialog').open, true, 'one more chance after a single dismissal');
  const third = await bootSeeded({ 'nota.onboarded.dismissed.v1': '2' });
  assert.equal($(third.doc, 'onboarding-dialog').open, false, 'two dismissals means stop asking');
});

// 32. An explicit "Passer" is a decision, not an accident — it flags immediately.
test('onboarding: Passer flags onboarded on the first click', async () => {
  const { doc, win } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  $(doc, 'onb-skip').click();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), '1');
  // The trailing `close` event a real browser fires must not also count a dismissal.
  fire(win, $(doc, 'onboarding-dialog'), 'close');
  assert.equal(win.localStorage.getItem('nota.onboarded.dismissed.v1'), null, 'no stray dismissal counted');
});

// 33. Someone already signed in has nothing to be onboarded about.
test('onboarding: does not auto-show for an already signed-in visitor', async () => {
  // Seeded exactly as lsSave writes them (JSON), and ncRestore needs both the
  // token and the email before it will consider the session restored.
  const notary = await bootSeeded({
    'nota.notary.token': JSON.stringify('tok-abc'),
    'nota.notary.email': JSON.stringify('me@etude.ca'),
  });
  assert.equal($(notary.doc, 'onboarding-dialog').open, false, 'a signed-in notary is not greeted');
  const client = await bootSeeded({ 'nota.profile.v1': JSON.stringify({ courriel: 'a@b.ca' }) });
  assert.equal($(client.doc, 'onboarding-dialog').open, false, 'a known client is not greeted');
});

// 34. Accessibility: the dialog must announce the view the reader is actually on,
//     move focus into it, and say where they are in the flow.
test('onboarding: labelling, progress and focus follow the active view', async () => {
  const { doc } = await boot();
  const dlg = $(doc, 'onboarding-dialog');
  assert.equal(dlg.getAttribute('aria-labelledby'), 'onb-title', 'VIEW 1 is labelled by its own heading');
  assert.equal($(doc, 'onb-progress').textContent, 'Étape 1 sur 2');
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  assert.equal(dlg.getAttribute('aria-labelledby'), 'onb-steps-title', 'VIEW 2 relabels to the steps heading');
  assert.equal($(doc, 'onb-steps-progress').textContent, 'Étape 2 sur 2');
  assert.equal(doc.activeElement, $(doc, 'onb-cta'), 'focus lands on the CTA of the new view');
  // Back restores VIEW 1's label and clears the parked role.
  $(doc, 'onb-back').click();
  assert.equal(dlg.getAttribute('aria-labelledby'), 'onb-title');
  assert.equal(dlg.getAttribute('data-role'), null, 'the parked role is cleared on back');
});

// 35. A second, softer exit: look around the carnet without being thrown into a
//     modal. The old client CTA chained straight into the day dialog.
test('onboarding: the secondary CTA lands on the carnet without opening a modal', async () => {
  const { doc, win, Nota } = await boot();
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  const alt = $(doc, 'onb-alt');
  assert.ok(alt, 'the secondary action exists');
  assert.equal(alt.textContent, 'Explorer le carnet d’abord');
  alt.click();
  assert.equal(win.localStorage.getItem('nota.onboarded.v1'), '1', 'still a completed onboarding');
  assert.equal($(doc, 'onboarding-dialog').open, false, 'the guide closed');
  assert.equal(Nota.state.tab, 'carnet', 'landed on the carnet');
  assert.equal($(doc, 'day-dialog').open, false, 'and NOT chained into a second modal');
});

// 36. The guide stays reachable from the account menu, not just a footer link a
//     first-time visitor will never look for.
test('onboarding: the account menu offers a way back into the guide', async () => {
  const { doc, win } = await bootSeeded({ 'nota.profile.v1': JSON.stringify({ courriel: 'a@b.ca' }) });
  win.Nota.account.render();
  const row = Array.from(doc.querySelectorAll('#acct-actions button, #acct-actions a'))
    .find((b) => /Comment ça marche/.test(b.textContent));
  assert.ok(row, 'the account menu has a "Comment ça marche" row');
  row.click();
  assert.equal($(doc, 'onboarding-dialog').open, true, 'it re-opens the guide');
  assert.equal($(doc, 'onb-view-role').hidden, false, 'at VIEW 1');
});

// 37. localStorage can throw (Safari private mode). The guide must not then
//     re-greet on every single navigation within the session.
test('onboarding: survives a localStorage that refuses to write', async () => {
  const { doc, win } = await boot();
  // Make every write throw, as a locked-down browser would.
  win.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  doc.querySelector('#onb-view-role .onb-choice[data-role="client"]').click();
  $(doc, 'onb-skip').click();
  assert.equal($(doc, 'onboarding-dialog').open, false, 'dismissal still works');
  assert.equal(win.Nota.onboarding.seen(), true, 'and is remembered in memory for this session');
});

// 38. Client sign-in fires a fire-and-forget welcome email (POST /client/welcome).
//     The backend is idempotent; the UI must fire it and never block on it.
test('client sign-in POSTs the welcome email to /client/welcome', async () => {
  const ctx = await boot();
  const { win, doc } = ctx;
  // Record outbound fetches (the boot stub rejects everything; here we resolve).
  const calls = [];
  win.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };

  $(doc, 'auth-email').value = 'nouveau@client.ca';   // authRole defaults to 'client'
  fire(win, $(doc, 'auth-email-form'), 'submit');
  await wait(0);

  const welcome = calls.find((c) => c.url.indexOf('/client/welcome') !== -1);
  assert.ok(welcome, 'expected a POST to /client/welcome on client sign-in');
  assert.equal((welcome.opts.method || '').toUpperCase(), 'POST');
  assert.equal(JSON.parse(welcome.opts.body || '{}').courriel, 'nouveau@client.ca');
});

// ---------------------------------------------------------------------------
// 20. THE TWO DATA EXTREMES, and the cascade rule that keeps cells from
//     overlapping at narrow widths.
//
//     jsdom has NO layout engine: every getBoundingClientRect is 0x0, so a real
//     "do these two boxes intersect" assertion is impossible here. The geometry
//     was verified in a browser at 320/360/375/390/414/430/563/600/768/834/
//     1024/1280/1440/1920. What these tests pin down instead are the two things
//     that CAUSE the overlaps we actually shipped:
//       a) a cell rendering content it has no room for, or an amount whose
//          compact fallback is missing, so the narrow layouts print nothing or
//          print the long form and spill into the next day;
//       b) a late @media rule silently outranking the @container rule that was
//          supposed to make the cell fit. That one bit twice.
// ---------------------------------------------------------------------------

// Every act, every day, several offers each, and amounts long enough to be the
// worst case for a 34px cell.
function heavyBids(D, anchor, days) {
  const out = [];
  for (let d = 1; d <= days; d++) {
    const dd = String(d).padStart(2, '0');
    D.SERVICES.forEach((svc, si) => {
      for (let n = 0; n < 3; n++) {
        out.push({
          id: 'h' + d + '-' + svc.id + '-' + n,
          serviceId: svc.id,
          dateISO: anchor.slice(0, 8) + dd,
          // Deliberately wide: five figures is the longest a cell will ever see.
          montant: 10000 + si * 1000 + n * 137,
          tier: 'standard',
          status: n === 2 ? D.STATUS.RETENUE : D.STATUS.OUVERTE,
          anonyme: true,
          createdAt: anchor,
        });
      }
    });
  }
  return out;
}

test('no data: the calendar still renders a full month and claims nothing', async () => {
  const ctx = await boot();
  await reseed(ctx, [], 'testament');
  // Wholly-past week rows are dropped on purpose, so a month is not 28+ cells.
  // What must hold is that every remaining day of the month has one.
  const cells = all(ctx.doc, '#cal-grid .cal-cell');
  const anchor0 = firstOfMonth(todayISO());
  const dates = new Set(cells.map((c) => c.dataset.date).filter(Boolean));
  for (let d = Number(todayISO().slice(8)); d <= daysInMonthUTC(anchor0); d++) {
    assert.ok(dates.has(anchor0.slice(0, 8) + String(d).padStart(2, '0')),
      'day ' + d + ' of the month has a cell even with zero offers');
  }
  assert.equal(cells.length % 7, 0, 'the grid still renders whole weeks, got ' + cells.length);
  // Nothing may claim an offer, a price, or a "N offres" count.
  assert.equal(all(ctx.doc, '#cal-grid .svc-bid').length, 0, 'no service rows on an empty month');
  assert.equal(all(ctx.doc, '#cal-grid .cal-avg').length, 0, 'no cleared-day figure on an empty month');
  // The legend is what decodes the colours, so it must survive the empty state.
  assert.ok(all(ctx.doc, '.legend .legend-item').length > 0, 'legend still renders with no data');
  // French pluralisation: "0 offre", never "0 offres".
  const count = ctx.doc.getElementById('result-count');
  if (count && count.textContent.trim()) {
    assert.ok(!/\b0\s+offres\b/.test(count.textContent), 'singular for zero, got: ' + count.textContent);
  }
});

test('lots of data: every cell stays inside the shape the narrow layouts assume', async () => {
  const ctx = await boot();
  const D = ctx.D;
  const anchor = firstOfMonth(todayISO());
  const days = daysInMonthUTC(anchor);
  await reseed(ctx, heavyBids(D, anchor, days), 'testament');

  const cells = all(ctx.doc, '#cal-grid .cal-cell').filter((c) => !c.classList.contains('is-out'));
  const remaining = daysInMonthUTC(anchor) - Number(todayISO().slice(8)) + 1;
  assert.ok(cells.length >= remaining, 'every remaining day of the month has a cell under load');

  const withBids = cells.filter((c) => c.querySelector('.svc-bid'));
  assert.ok(withBids.length > 0, 'the heavy fixture reaches the grid');

  withBids.forEach((cell) => {
    // A cell shows at most ONE row per act however many offers a day collects.
    // More than that and the 3-column phone cell runs past its own height.
    const rows = cell.querySelectorAll('.svc-bid');
    assert.ok(rows.length <= D.SERVICES.length,
      cell.dataset.date + ' renders ' + rows.length + ' rows for ' + D.SERVICES.length + ' acts');

    cell.querySelectorAll('.svc-bid-amount').forEach((amt) => {
      // Below a 560px container the amount is hidden and ::after prints
      // attr(data-compact). No data-compact means a BLANK price on every phone.
      const compact = amt.getAttribute('data-compact');
      assert.ok(compact && compact.trim(), 'every amount carries a compact form, ' + cell.dataset.date);
      assert.ok(compact.length <= 6,
        'compact form stays short enough for a 26px content box, got "' + compact + '"');
    });
  });

  // The multiplier is the one figure that shares the cell's top line with the
  // date, and it is what escaped its box before. Every future cell prints one.
  const future = cells.filter((c) => c.dataset.date >= todayISO() && !c.classList.contains('is-past'));
  future.forEach((c) => {
    assert.ok(c.querySelector('.cal-urgency'), 'future cell ' + c.dataset.date + ' prints its multiplier');
  });
});

test('no @media rule may outrank a calendar @container rule on the same property', () => {
  // The regression this exists for: styles.css set
  //   @container cal (max-width: 440px) { .cal-cell { padding: 6px 8px 10px } }
  // and then, HUNDREDS of lines later,
  //   @media (max-width: 680px)         { .cal-cell { padding: 6px 6px } }
  // Equal specificity, so the media rule won purely on file order and every
  // container query that sized a cell was dead. Same story for .cal-grid's gap.
  const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

  // Split into top-level at-rule blocks, keeping the offset each one starts at.
  const blocks = [];
  const re = /@(media|container)([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push({ kind: m[1], cond: m[2].trim(), start: m.index, body: css.slice(re.lastIndex, i - 1) });
  }

  // (selector, property) pairs a block sets, for calendar selectors only.
  const pairs = (body) => {
    const out = [];
    const rr = /([^{}]+)\{([^{}]*)\}/g;
    let r;
    while ((r = rr.exec(body))) {
      const sel = r[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
      if (!/(^|[\s,>+~])\.cal[-\w]*/.test(sel)) continue;
      r[2].split(';').forEach((decl) => {
        const p = decl.split(':')[0].trim().toLowerCase();
        if (p) out.push(sel + ' || ' + p);
      });
    }
    return out;
  };

  const containers = blocks.filter((b) => b.kind === 'container' && /\bcal(wrap)?\b/.test(b.cond));
  assert.ok(containers.length > 0, 'the calendar still uses container queries');

  const clashes = [];
  containers.forEach((c) => {
    const owned = new Set(pairs(c.body));
    blocks
      .filter((b) => b.kind === 'media' && b.start > c.start)
      .forEach((b) => {
        pairs(b.body).forEach((p) => {
          if (owned.has(p)) clashes.push('@media (' + b.cond + ') overrides @container (' + c.cond + ') on  ' + p);
        });
      });
  });

  assert.deepEqual(clashes, [],
    'a later @media rule silently defeats a calendar @container rule:\n  ' + clashes.join('\n  '));
});

// ============================================================================
// Menu UX — the header tablist follows the ARIA tabs pattern (roving tabindex,
// arrow keys), and the account menu behaves like a real menu button: focus
// moves in on open, Escape hands it back to the trigger, arrows walk the rows,
// and tabbing away closes the panel.
// ============================================================================

const key = (win, elmt, k) =>
  elmt.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('header tabs: roving tabindex and arrow-key activation', async () => {
  const { win, doc, Nota } = await boot();
  const tabs = all(doc, '.nav-tabs .nav-tab');
  assert.equal(tabs[0].tabIndex, 0, 'selected tab is in the Tab order');
  assert.equal(tabs[1].tabIndex, -1, 'unselected tab is reached by arrows, not Tab');

  tabs[0].focus();
  key(win, tabs[0], 'ArrowRight');
  assert.equal(Nota.state.tab, 'notaires', 'ArrowRight activates the next tab');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(doc.activeElement, tabs[1], 'focus follows the activation');

  key(win, tabs[1], 'ArrowRight'); // wraps around
  assert.equal(Nota.state.tab, 'carnet');
  key(win, tabs[0], 'End');
  assert.equal(Nota.state.tab, 'notaires');
  key(win, tabs[1], 'Home');
  assert.equal(Nota.state.tab, 'carnet');

  // A pane with no header tab (profil) must not strand the tablist at -1/-1.
  Nota.setTab('profil', { focus: false });
  assert.ok(tabs.some((t) => t.tabIndex === 0), 'one header tab stays in the Tab order');
});

test('account menu: aria wiring, focus on open, Escape restores the trigger', async () => {
  const { win, doc } = await boot();
  const bell = $(doc, 'notif-bell');
  assert.equal(bell.getAttribute('aria-controls'), 'notif-panel');

  bell.click();
  assert.equal($(doc, 'notif-panel').hidden, false);
  assert.equal(doc.activeElement, $(doc, 'acct-profil'), 'first item focused on open');

  key(win, doc.activeElement, 'Escape');
  assert.equal($(doc, 'notif-panel').hidden, true);
  assert.equal(doc.activeElement, bell, 'Escape returns focus to the trigger');
});

test('account menu: ArrowDown / ArrowUp walk the rows and wrap', async () => {
  const { win, doc } = await boot();
  $(doc, 'notif-bell').click();
  const panel = $(doc, 'notif-panel');
  const head = $(doc, 'acct-profil');
  assert.equal(doc.activeElement, head);

  key(win, head, 'ArrowDown');
  assert.notEqual(doc.activeElement, head, 'ArrowDown leaves the head');
  assert.ok(panel.contains(doc.activeElement), 'focus stays inside the panel');
  key(win, doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, head, 'ArrowUp comes back');
  key(win, head, 'ArrowUp'); // wraps to the last row
  assert.ok(panel.contains(doc.activeElement) && doc.activeElement !== head, 'ArrowUp wraps from the first row');
});

test('account menu closes when focus moves outside it', async () => {
  const { doc } = await boot();
  $(doc, 'notif-bell').click();
  assert.equal($(doc, 'notif-panel').hidden, false);
  $(doc, 'cta-reserver').focus(); // e.g. Tab past the end of the menu
  assert.equal($(doc, 'notif-panel').hidden, true, 'the menu never lingers behind a moved focus');
});

// 21. Adjacent-month days pad the first and last weeks. Standard calendar
//     behaviour: the real date, muted, no prices (only the anchor month's offers
//     are loaded, so a figure there would be a claim the app cannot make), and a
//     FUTURE one navigates to its own month where the offers do exist.
test('the first and last weeks are padded with real adjacent-month dates', async () => {
  const { doc, anchor } = await boot();
  const rows = all(doc, '#cal-grid .cal-row:not(.cal-dow-row)');
  assert.ok(rows.length > 0, 'the grid renders week rows');
  rows.forEach((r, i) => {
    assert.equal(r.children.length, 7, 'week ' + (i + 1) + ' is a full seven columns');
  });

  const outs = all(doc, '#cal-grid .cal-cell.is-out');
  outs.forEach((c) => {
    assert.ok(c.dataset.date, 'an adjacent-month cell carries its real date');
    assert.notEqual(c.dataset.date.slice(0, 7), anchor.slice(0, 7), 'and it is NOT the anchor month');
    const n = c.querySelector('.cal-daynum');
    assert.ok(n && n.textContent.trim(), 'it prints its day number');
    assert.equal(c.querySelectorAll('.svc-bid').length, 0, 'and never a price');
    assert.equal(c.tabIndex, -1, 'it stays out of the tab order');
  });

  // Leading pad runs to the last day of the previous month; trailing starts at 1.
  const lead = outs.filter((c) => c.dataset.date < anchor);
  if (lead.length) {
    const prevLast = lead[lead.length - 1].dataset.date;
    const nextDay = new Date(prevLast + 'T00:00:00Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    assert.equal(nextDay.toISOString().slice(0, 10), anchor, 'the leading pad runs up to the 1st');
  }
  const trail = outs.filter((c) => c.dataset.date > anchor);
  if (trail.length) {
    assert.equal(Number(trail[0].dataset.date.slice(8, 10)), 1, 'the trailing pad starts on the 1st');
  }
});

test('a future adjacent-month day moves the calendar to its own month', async () => {
  const ctx = await boot();
  const { doc, Nota } = ctx;
  const nav = all(doc, '#cal-grid .cal-cell.is-out.is-nav');
  if (!nav.length) return; // a month that starts on Monday and ends on Sunday has no pad
  const target = nav[0].dataset.date;
  assert.ok(target > todayISO(), 'only future adjacent days are navigable');
  nav[0].click();
  // The click sets the anchor and THEN reloads and re-renders. Poll for the
  // rendered cell, not the anchor: a fixed wait, or waiting on the anchor
  // alone, races the re-render under a loaded test runner.
  const inMonth = () => doc.querySelector('#cal-grid .cal-cell:not(.is-out)[data-date="' + target + '"]');
  for (let i = 0; i < 100 && !inMonth(); i++) await wait(20);
  assert.equal(Nota.state.anchor.slice(0, 7), target.slice(0, 7), 'the calendar moved to that month');
  assert.ok(inMonth(), 'and the date is now an in-month cell');

  // Past adjacent days stay inert: they are not navigable and not bookable.
  all(doc, '#cal-grid .cal-cell.is-out').forEach((c) => {
    if (c.dataset.date < todayISO()) {
      assert.ok(!c.classList.contains('is-nav'), c.dataset.date + ' is not navigable');
      assert.equal(c.getAttribute('aria-disabled'), 'true', c.dataset.date + ' is disabled');
    }
  });
});
