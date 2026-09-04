/**
 * Demonstration data must never be indistinguishable from the real market.
 *
 * store.listMonth falls back to domain fixtures whenever the API is
 * unreachable or answers anything but 200 — a legitimate capability (the
 * marketing site, the intro film, offline development), and a serious problem
 * the moment the invented carnet is presented exactly like the real one. An
 * API outage silently turned the site into a fictional marketplace: medians,
 * offer counts, retentions and per-day price ladders, all made up, all bare.
 *
 * The rule this suite enforces: we DECLARE, we never hide. The carnet keeps
 * rendering; every region that shows an aggregate figure carries a visible
 * mark and sits under `data-demo="true"`, and a persistent banner says why.
 *
 * The load-bearing test is `no market figure is ever bare`: it walks every
 * element that displays a market figure and fails unless it lives inside a
 * marked region — so a figure added later is covered without touching this
 * file. Its mirror, `nothing is marked when the API answers`, keeps the mark
 * from becoming decoration that is always on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

// Every element that puts a MARKET aggregate on screen. Each must sit inside a
// region marked as demonstration when the figures are invented.
const MARKET_FIGURES = [
  '.pulse-fig-v',   // the median, and the floor beside it
  '.pulse-meta',    // « 21 offres · 6 retenues »
  '#result-count',  // « 25 offres au carnet »
  '.cal-avail',     // the next availability drawn from the same list
  '.cal-urgency',   // the per-day « dès 2 000 $ », tuned on the month's history
  '.cal-avg',       // the per-day average
  '.nc-live-card',  // the notary teaser: real dates and amounts from the month
  '#onb-live-client', // « 34 demandes publiées ce mois-ci · 9 retenues »
  '#onb-live-notary', // « N demandes ouvertes · X $ à retenir »
  '#day-best-v',    // the offer to beat, inside the booking dialog
  '#tp-text',       // the tier preview, tuned on the month
];

// Not a display but a VALUE the client is about to publish: the amount
// pre-filled by D.recommendedAmount(..., state.monthBids). Calibrated on
// invented offers, it would put a fictional price in a real publication.
const SUGGESTED_VALUE = '#o-amount';

async function boot({ routes = [], seed = {} } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const r = routes.find((x) => x.match(String(u), init || {}));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(String(u), init || {}));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, seed[k]));
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, dom };
}

// A live /bids door, answering with REAL offers for whatever month is asked.
function liveBids(D) {
  return {
    match: (u) => u.includes('/bids?month='),
    reply: (u) => {
      const month = decodeURIComponent(u.split('month=')[1] || '').slice(0, 7);
      return jsonRes(200, { bids: [
        { id: 'r1', serviceId: 'refinancement', dateISO: month + '-15', montant: 2400, tier: 'standard', status: 'ouverte', etude: null, anonyme: true, prefixe: 'G1R' },
        { id: 'r2', serviceId: 'financement', dateISO: month + '-18', montant: 1900, tier: 'rapide', status: 'retenue', etude: 'Étude Roy', anonyme: true, prefixe: 'G1V' },
      ] });
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The banner: persistent, sober, and it says the figures are invented.
// ---------------------------------------------------------------------------
test('a failed carnet load raises a persistent banner that names the data as fictional', async () => {
  const { doc, dom } = await boot(); // every fetch rejects → fixtures
  const banner = $(doc, 'demo-banner');
  assert.ok(banner, 'the banner exists in the shell');
  assert.equal(banner.hidden, false, 'and it is showing');
  const t = banner.textContent;
  assert.match(t, /démonstration/i, 'it names the data: ' + t);
  assert.match(t, /fictif|fictives|fictifs/i, 'in plain words: ' + t);
  assert.match(t, /n’a pas pu être chargé|pas pu être chargé/, 'and says why: ' + t);
  // Persistent, not a toast, and not an alarm.
  assert.equal(banner.getAttribute('role'), 'status', 'a status, never an alert');
  assert.ok(!banner.classList.contains('toast'), 'not a toast');
  dom.window.close();
});

test('we declare, we do not hide: the carnet still renders under the banner', async () => {
  const { doc, dom } = await boot();
  assert.equal($(doc, 'demo-banner').hidden, false);
  assert.equal($(doc, 'pane-carnet').hidden, false, 'the carnet pane stays visible');
  assert.ok(doc.querySelectorAll('.pulse-row').length > 0, 'the pulse still renders');
  assert.ok(doc.querySelectorAll('.cal-cell').length > 0, 'the calendar still renders');
  dom.window.close();
});

// ---------------------------------------------------------------------------
// 2. THE test: no market figure may appear bare.
// ---------------------------------------------------------------------------
test('no market figure is ever bare when the carnet is running on fixtures', async () => {
  const { doc, dom } = await boot();

  // The sweep must not pass by rendering nothing at all.
  const found = MARKET_FIGURES.flatMap((sel) => Array.from(doc.querySelectorAll(sel)));
  assert.ok(found.length >= 4, 'the carnet must actually be showing figures to guard: ' + found.length);

  for (const node of found) {
    const region = node.closest('[data-demo="true"]');
    assert.ok(region,
      'a market figure is shown outside any demonstration-marked region: '
      + '<' + node.tagName.toLowerCase() + ' class="' + node.className + '"> « ' + node.textContent.trim() + ' »');
    assert.ok(region.querySelector('.demo-mark'),
      'the region around « ' + node.textContent.trim() + ' » is flagged but carries no VISIBLE mark');
  }

  // The mark says what it means, in words, not just as a class name.
  const mark = doc.querySelector('.demo-mark');
  assert.match(mark.textContent, /démonstration/i, mark.textContent);
  assert.match(mark.getAttribute('title') || '', /démonstration/i, 'it explains itself on hover');
  dom.window.close();
});

test('the price suggested to the client is never fictional in silence', async () => {
  const { doc, dom } = await boot(); // offline → fixtures
  const iso = new Date(Date.parse(todayISO() + 'T00:00:00Z') + 5 * 864e5).toISOString().slice(0, 10);
  const cell = doc.querySelector('.cal-cell[data-date="' + iso + '"]');
  assert.ok(cell, 'a bookable day is on screen');
  cell.click();
  await wait(60);

  const amount = doc.querySelector(SUGGESTED_VALUE);
  assert.ok(amount, 'the booking dialog carries the amount control');
  assert.ok(Number(amount.value) > 0, 'and it is pre-filled — that is the whole risk');

  // The screen the client reads while deciding must say the calibration is
  // invented. Region marking, so the mark covers the figures around it too.
  const region = amount.closest('[data-demo="true"]');
  assert.ok(region, 'the client can be suggested a price calibrated on fixtures with nothing on screen saying so');
  assert.ok(region.querySelector('.demo-mark'), 'the booking surface is flagged but shows no visible mark');

  // Every displayed market figure in the same dialog is covered as well.
  for (const sel of ['#day-best-v', '#tp-text']) {
    const node = doc.querySelector(sel);
    if (!node || !node.textContent.trim()) continue;
    assert.ok(node.closest('[data-demo="true"]'), sel + ' is bare inside the booking dialog: ' + node.textContent);
  }
  dom.window.close();
});

test('the onboarding guide and the notary teaser do not quote fixtures bare', async () => {
  const { doc, win, dom } = await boot();
  // The teaser renders on the signed-out notary landing.
  win.Nota.setTab('notaires');
  await wait(60);
  const live = $(doc, 'notary-live');
  if (!live.hidden) {
    assert.ok(live.matches('[data-demo="true"]') || live.closest('[data-demo="true"]'),
      'the notary teaser quotes month data unmarked');
    assert.ok(live.querySelector('.demo-mark') || live.closest('[data-demo="true"]').querySelector('.demo-mark'),
      'the notary teaser carries no visible mark');
  }
  // The welcome guide's two live-proof lines.
  const onb = $(doc, 'onboarding-dialog');
  const cl = $(doc, 'onb-live-client');
  if (cl && !cl.hidden) {
    assert.match(cl.textContent, /demande/, 'the proof line is populated: ' + cl.textContent);
    assert.ok(cl.closest('[data-demo="true"]'), 'the guide quotes month data unmarked: ' + cl.textContent);
    assert.ok(onb.querySelector('.demo-mark'), 'the guide carries no visible mark');
  }
  dom.window.close();
});

test('nothing is marked when the API answers — the mark is not decoration', async () => {
  const ctx = await boot({ routes: [] });
  const { D } = ctx;
  ctx.dom.window.close();
  const { doc, dom } = await boot({ routes: [liveBids(D)] });

  assert.equal($(doc, 'demo-banner').hidden, true, 'no banner on a live carnet');
  assert.equal(doc.querySelector('.demo-mark'), null, 'no demonstration mark anywhere');
  assert.equal(doc.querySelector('[data-demo="true"]'), null, 'and no region flagged');
  // …while the real figures are on screen.
  assert.ok(doc.querySelectorAll('.pulse-fig-v').length > 0, 'the live pulse renders');
  assert.match($(doc, 'result-count').textContent, /offre/, 'and the live count too');
  dom.window.close();
});

test('the mark clears the moment a call succeeds again', async () => {
  const ctx = await boot({ routes: [] });
  const { D } = ctx;
  ctx.dom.window.close();

  // Boot offline, then bring the door back and reload the month.
  const live = liveBids(D);
  let up = false;
  const flaky = { match: (u) => u.includes('/bids?month='), reply: (u) => { if (!up) throw new Error('down'); return live.reply(u); } };
  const { doc, win, dom } = await boot({ routes: [flaky] });
  assert.equal($(doc, 'demo-banner').hidden, false, 'down → marked');
  assert.ok(doc.querySelector('.demo-mark'), 'down → mark present');

  up = true;
  await win.Nota.refreshMonthData();
  await wait(40);
  assert.equal($(doc, 'demo-banner').hidden, true, 'recovered → banner gone');
  assert.equal(doc.querySelector('.demo-mark'), null, 'recovered → mark gone');
  assert.equal(doc.querySelector('[data-demo="true"]'), null, 'recovered → no region flagged');
  dom.window.close();
});

// A partial outage is still an outage. refreshMonthData loads several months
// CONCURRENTLY (the rolling window crosses seams) and store.online is
// last-writer-wins: if the month that fell back settles BEFORE a month that
// succeeded, the flag would say "online" while half the screen is invented.
test('one failed month out of several marks the whole screen', async () => {
  const ctx = await boot({ routes: [] });
  const { D } = ctx;
  ctx.dom.window.close();

  // The first month asked for answers late and succeeds; every other month
  // fails immediately — so the successful one settles LAST.
  let first = null;
  const partial = {
    match: (u) => u.includes('/bids?month='),
    reply: (u) => {
      const month = decodeURIComponent(u.split('month=')[1] || '').slice(0, 7);
      if (first === null) first = month;
      if (month !== first) throw new Error('down');
      return new Promise((res) => setTimeout(() => res(jsonRes(200, { bids: [
        { id: 'r1', serviceId: 'refinancement', dateISO: month + '-15', montant: 2400, tier: 'standard', status: 'ouverte', etude: null, anonyme: true, prefixe: 'G1R' },
      ] })), 20));
    },
  };
  const { doc, dom } = await boot({ routes: [partial] });
  await wait(60);
  assert.equal($(doc, 'demo-banner').hidden, false,
    'a month that fell back was masked by one that succeeded later');
  assert.ok(doc.querySelector('.demo-mark'), 'and the figures went unmarked');
  dom.window.close();
});

// ---------------------------------------------------------------------------
// 3. Publishing offline: nothing was published, and the screen must say so.
// ---------------------------------------------------------------------------
test('the offline success screen says nothing was published and no notary will see it', async () => {
  const { doc, win, dom } = await boot(); // offline
  win.Nota.showOfferSuccess();
  await wait(20);
  const box = $(doc, 'offer-success');
  assert.equal(box.hidden, false, 'the success screen is shown');
  const note = $(doc, 'offer-success-demo');
  assert.ok(note, 'the offline origin of this "publication" is stated');
  const t = note.textContent;
  assert.match(t, /[Rr]ien n’a été publié/, 'it says nothing was published: ' + t);
  assert.match(t, /cet appareil/, 'that it lives only on this device: ' + t);
  assert.match(t, /aucun notaire/, 'and that no notary will see it: ' + t);
  // The lead must not still read as a plain « Offre publiée. »
  const lead = $(doc, 'offer-success-lead');
  assert.ok(lead, 'the success lead is addressable');
  assert.ok(!/^Offre publiée\./.test(lead.textContent.trim()),
    'the lead still announces a real publication: ' + lead.textContent);
  dom.window.close();
});

test('the online success screen carries no demo note', async () => {
  const ctx = await boot({ routes: [] });
  const { D } = ctx;
  ctx.dom.window.close();
  const { doc, win, dom } = await boot({ routes: [liveBids(D)] });
  win.Nota.showOfferSuccess();
  await wait(20);
  assert.equal($(doc, 'offer-success-demo'), null, 'no demo note when the API is live');
  assert.match($(doc, 'offer-success-lead').textContent, /publiée/i, 'the real lead stands');
  dom.window.close();
});

// The English boot must declare it too — a bilingual site that only warns in
// French is only half honest.
test('the declaration is bilingual', async () => {
  const I18N = (() => {
    const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
    const mod = { exports: {} };
    new Function('module', 'exports', src)(mod, mod.exports);
    return mod.exports;
  })();
  I18N.force('en');
  assert.equal(I18N.tEn('Données de démonstration'), 'Demonstration data');
  assert.match(I18N.tEn('Le carnet réel n’a pas pu être chargé. Ces offres et ces montants sont fictifs.'), /fictional/);
  assert.equal(I18N.tEn('démonstration'), 'demonstration');
  const note = I18N.tEn('Rien n’a été publié. Le carnet réel est injoignable : cette offre n’existe que sur cet appareil, et aucun notaire ne la verra.');
  assert.match(note, /Nothing was published/, note);
  assert.match(note, /only on this device/, note);
  assert.match(note, /no notary will see it/, note);
  assert.ok(I18N.covered('Enregistrée sur cet appareil seulement.'), 'the corrected lead is translated');
  assert.ok(I18N.covered('Chiffres de démonstration : le carnet réel n’a pas pu être chargé.'), 'and the mark tooltip');
});

// ---------------------------------------------------------------------------
// 4. The register: tokens, square, and not an alarm.
// ---------------------------------------------------------------------------
test('the demonstration register is token-driven and square', () => {
  for (const sel of ['.demo-banner', '.demo-mark', '.demo-note']) {
    const i = CSS_SRC.indexOf(sel + ' {');
    assert.ok(i > -1, 'missing rule ' + sel);
    const rule = CSS_SRC.slice(i, CSS_SRC.indexOf('}', i));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rule), sel + ' hardcodes a colour: ' + rule);
    assert.ok(!/border-radius:\s*(50%|999)/.test(rule), sel + ' must stay square: ' + rule);
    assert.ok(!/--danger/.test(rule), sel + ' must not read as an alarm: ' + rule);
  }
});

// ---------------------------------------------------------------------------
// 5. P0-8 — the onboarding vignettes escape the dialog's mark. The guide's
//    mark sits in .onb-live-host, inside the ROLE view, which is hidden the
//    moment a role is picked — exactly when the week board / bid vignette
//    start quoting the month's (possibly invented) demands.
// ---------------------------------------------------------------------------
test('P0-8: the onboarding vignettes (bid, week board) carry their own mark when the figures are invented', async () => {
  const { doc, win, dom } = await boot(); // every fetch rejects → fixtures
  win.Nota.onboarding.open();
  await wait(10);
  doc.querySelector('#onboarding-dialog .onb-choice[data-role="client"]').click();
  await wait(30);
  const bid = $(doc, 'ob-bid');
  assert.equal(bid.hidden, false, 'the client steps play the bid vignette');
  assert.equal(bid.dataset.demo, 'true', 'the bid vignette is a marked region');
  assert.ok(bid.querySelector('.demo-mark'), 'and carries a visible mark');
  $(doc, 'onb-back').click();
  await wait(10);
  doc.querySelector('#onboarding-dialog .onb-choice[data-role="notary"]').click();
  await wait(30);
  const wk = $(doc, 'ob-week');
  assert.equal(wk.hidden, false, 'the notary steps play the week board (wide screens)');
  assert.equal(wk.dataset.demo, 'true', 'the week board is a marked region');
  assert.ok(wk.querySelector('.demo-mark'), 'and carries a visible mark');
  dom.window.close();
});
