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
  const tops = all(doc, '#cal-grid .cal-avg');
  assert.ok(tops.length > 0, 'expected at least one average figure');
  assert.ok(tops.every((t) => t.textContent.trim() !== '—'), 'a cal-avg rendered a bare em-dash');
});

// 6. Days with bids show the average price + a %-chance-to-obtain chip.
test('days with bids show avg price and chance', async () => {
  const { doc } = await boot();
  const hasBids = all(doc, '#cal-grid .cal-cell.has-bids');
  assert.ok(hasBids.length > 0, 'expected at least one day with bids');
  assert.ok(hasBids.every((c) => c.querySelector('.cal-avg')), 'a has-bids cell is missing its average figure');
  assert.ok(hasBids.every((c) => c.querySelector('.cal-chance')), 'a has-bids cell is missing its chance chip');
  assert.ok(hasBids.every((c) => /\d+\s*%/.test(c.querySelector('.cal-chance').textContent)), 'chance chip shows a percentage');
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
test('profile "Mes offres" lists offers with their live status', async () => {
  const { win, doc, D, Nota } = await boot();
  const iso = D.addDays(todayISO(), 5);
  win.localStorage.setItem('nota.myoffers.v1', JSON.stringify([{ id: 'o1', dateISO: iso, serviceId: 'testament', montant: 900 }]));
  Nota.setTab('profil');
  const row = doc.querySelector('.my-offer');
  assert.ok(row, 'an offer row is shown in the profile');
  const badge = row.querySelector('.my-offer-badge');
  assert.ok(badge, 'the status badge is shown');
  assert.equal(badge.dataset.status, 'pending'); // future date, not retained
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

// 12. Money passthrough: amounts route through D.money — trailing " $" and
//     space-grouped thousands appear in the rendered figures.
test('rendered amounts use the money() format ("N NNN $")', async () => {
  const { doc } = await boot();
  const texts = all(doc, '#cal-grid .cal-avg, #agenda .bid-amount').map((e) => e.textContent);
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
async function reseed(ctx, bids) {
  ctx.win.localStorage.setItem('nota.bids.v1', JSON.stringify(bids));
  await ctx.Nota.reload();
  await wait(30);
}
const dayOf = (anchor, dd) => anchor.slice(0, 8) + dd; // 'YYYY-MM-' + 'DD'

test('the calendar badges the client\'s own offer status (approved)', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 2); // future date (past cells are blanked)
  // The client tracked this offer; the matching public bid is retained -> approved.
  ctx.win.localStorage.setItem('nota.myoffers.v1', JSON.stringify([{ id: 'r1', dateISO: iso, serviceId: 'testament', montant: 900 }]));
  await reseed(ctx, [{
    id: 'r1', serviceId: 'testament', dateISO: iso, montant: 900,
    tier: 'standard', status: ctx.D.STATUS.RETENUE, etude: 'Étude X', anonyme: true, createdAt: iso,
  }]);
  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell, 'cell for the offer date exists');
  assert.ok(cell.classList.contains('has-mine'));
  const badge = cell.querySelector('.cal-mine');
  assert.ok(badge, 'the client-offer status badge is shown');
  assert.equal(badge.dataset.status, 'approved');
});

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

  const cell = ctx.doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell.classList.contains('is-taken'), 'all-retained cell is marked taken');
  assert.ok(cell.querySelector('.cal-avg.is-cleared'), 'taken cell shows a struck cleared average');
  assert.match(cell.querySelector('.cal-chance').textContent, /\d+\s*%/); // chance still shown

  ctx.Nota.setView('liste'); // the agenda lives in the List view now
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
  ctx.Nota.setView('liste'); // the agenda lives in the List view now
  const empty = ctx.doc.querySelector('.agenda .agenda-empty');
  assert.ok(empty, 'agenda renders its empty state');
  assert.ok(empty.querySelector('button'), 'empty state offers a CTA button');
});

test('LIST: every upcoming day of the month renders a full card, even with no offer', async () => {
  const ctx = await boot();
  // A single offer on today; every later day of the month then has none.
  await reseed(ctx, [{
    id: 't1', serviceId: 'testament', dateISO: ctx.today, montant: 1500,
    tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: ctx.today,
  }]);
  ctx.Nota.setView('liste');

  const dim = daysInMonthUTC(ctx.anchor);
  const todayDay = Number(ctx.today.slice(8, 10));
  const upcoming = dim - todayDay + 1; // today .. last day of month, inclusive

  const groups = all(ctx.doc, '#agenda .agenda-group');
  assert.equal(groups.length, upcoming, 'one full card per upcoming day, empty days included');

  const todayCard = ctx.doc.querySelector('#agenda .agenda-group[data-date="' + ctx.today + '"]');
  assert.ok(todayCard && todayCard.querySelector('.bid-row'), "today's card shows its own offer");

  const vacant = all(ctx.doc, '#agenda .agenda-vacant');
  assert.equal(vacant.length, upcoming - 1, 'each day without an offer shows a vacant placeholder');
  if (dim > todayDay) assert.ok(vacant.length > 0, 'an empty upcoming day still renders a full rectangle');
});

test('LIST: a day shows at most two offers; the rest fold into a "+N autres offres" control', async () => {
  const ctx = await boot();
  const iso = ctx.today;
  await reseed(ctx, [1900, 1700, 1500, 1300].map(function (montant, i) {
    return { id: 'm' + i, serviceId: 'testament', dateISO: iso, montant: montant,
      tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, createdAt: iso };
  }));
  ctx.Nota.setView('liste');

  const card = ctx.doc.querySelector('#agenda .agenda-group[data-date="' + iso + '"]');
  assert.ok(card, 'today has a card');
  assert.equal(card.querySelectorAll('.bid-row').length, 2, 'at most two offers shown per day');
  const more = card.querySelector('.agenda-more');
  assert.ok(more, 'the overflow folds into a "+N autres offres" control');
  assert.match(more.textContent, /\+\s*2\s+autres\s+offres/);
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
  // Average is of the OPEN offers only (1400), not struck.
  const avg = cell.querySelector('.cal-avg');
  assert.ok(avg && !avg.classList.contains('is-cleared'), 'open average shown, not struck');
  assert.equal(avg.textContent.replace(/\s| |\$/g, ''), '1400');
  assert.match(cell.querySelector('.cal-chance').textContent, /\d+\s*%/);
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

  // The median (not the mean: 1200) is what a client is shown.
  assert.equal(byId.testament.querySelector('.pulse-amount').textContent, ctx.D.money(900));
  assert.match(byId.testament.querySelector('.pulse-meta').textContent, /3 offres · 1 retenue$/);
  assert.equal(byId.procuration.querySelector('.pulse-amount').textContent, ctx.D.money(400));

  // A service with no offer this month falls back to its floor, flagged as such.
  const refi = byId.refinancement;
  assert.equal(refi.querySelector('.pulse-amount').textContent, ctx.D.money(ctx.D.serviceById('refinancement').prixDepart));
  assert.ok(refi.querySelector('.pulse-amount').classList.contains('is-floor'), 'floor, not a market median');
  assert.match(refi.querySelector('.pulse-meta').textContent, /aucune offre/);

  // The foot states how much of the carnet notaries have already taken.
  assert.match(ctx.doc.getElementById('pulse-foot').textContent, /1 des 4 demandes .* \(25 %\)\./);
  assert.match(ctx.doc.getElementById('pulse-month').textContent, /\d{4}$/, 'names the displayed month');

  // Clicking a row filters the carnet to that service, and syncs the chip group.
  byId.procuration.click();
  await wait(30);
  assert.equal(ctx.doc.getElementById('result-count').textContent, '1 offre ce mois');
  assert.equal(ctx.doc.querySelector('#chips-service .chip[data-svc="procuration"]').getAttribute('aria-pressed'), 'true');
  const onRow = ctx.doc.querySelector('#pulse-rows .pulse-row[data-svc="procuration"]');
  assert.equal(onRow.getAttribute('aria-pressed'), 'true');
  // The pulse itself keeps reading the WHOLE month — it is the reference, not a result.
  assert.equal(ctx.doc.querySelector('#pulse-rows .pulse-row[data-svc="testament"] .pulse-amount').textContent, ctx.D.money(900));

  // Clicking the active row again clears the filter.
  onRow.click();
  await wait(30);
  assert.equal(ctx.doc.getElementById('result-count').textContent, '4 offres ce mois');
  assert.equal(ctx.doc.querySelector('#chips-service .chip[data-svc=""]').getAttribute('aria-pressed'), 'true');
});

test('offer rows carry an .ics download and a share action', async () => {
  const ctx = await boot();
  const iso = ctx.D.addDays(ctx.today, 2); // future date (the list only shows today onward)
  await reseed(ctx, [{
    id: 'a1', serviceId: 'testament', dateISO: iso, montant: 900,
    tier: 'standard', status: ctx.D.STATUS.OUVERTE, anonyme: true, prefixe: 'G1R', createdAt: iso,
  }]);
  ctx.Nota.setView('liste');
  const row = ctx.doc.querySelector('.agenda .bid-row');
  assert.ok(row, 'the list renders the offer');

  const ics = row.querySelector('a.mini-agenda');
  assert.ok(ics, 'agenda button is a real link, so the download works natively');
  assert.equal(ics.getAttribute('download'), `nota-${iso}.ics`);
  // A valid all-day VEVENT for that exact date, not a placeholder href.
  const cal = decodeURIComponent(ics.href.replace(/^data:text\/calendar;charset=utf-8,/, ''));
  assert.match(cal, /BEGIN:VCALENDAR/);
  assert.match(cal, new RegExp(`DTSTART;VALUE=DATE:${iso.replace(/-/g, '')}`));
  assert.ok(ics.getAttribute('aria-label').length > 10, 'icon-only button is named for screen readers');

  // No Web Share and no clipboard in jsdom: the URL still has to reach the user.
  const share = row.querySelector('button.mini-partager');
  assert.ok(share, 'share action present');
  share.click();
  const toast = ctx.doc.getElementById('toast');
  assert.match(toast.textContent, new RegExp(`svc=testament&jour=${iso}`), 'falls back to showing the deep link');
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
  assert.ok(labels.some((t) => /Publier une demande/i.test(t)), 'an offer-flow entry');
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
async function bootSeeded(seed) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
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
