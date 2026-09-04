/**
 * The client funnel, before a paid publication — four churn points the
 * funnel-mapping report named, each locked here.
 *
 *   1. HONEST PRICE LINE. Since ADR 0031 the client pays two lines: the
 *      notary's fees (100 % of the offer) and Nota's own service price.
 *      « Gratuit pour vous » was false, and it sat exactly where the form
 *      shows « Service Nota 400 $ ». The hero line now states the two-line
 *      truth and quotes the price the API serves — never a literal.
 *   2. A SENSIBLE DEFAULT DATE. The hero CTA opened TODAY (the ×4 tier): a
 *      first-time visitor met 7 400 $ + 400 $. With no date selected it now
 *      opens the first STANDARD date, and the day dialog carries a native
 *      date picker so the date can move without closing it.
 *   4. POST-PUBLISH EXPECTATIONS. The success screen (and the Checkout
 *      return) say what happens next — visible to registered notaries,
 *      emailed the moment one retains it, withdrawable free of charge until
 *      then — with no delay promise.
 *   5. FUNNEL BEACONS, identifier-free: only D.FUNNEL_EVENTS ids, one
 *      « visite » per page load, nothing stored, never throws.
 *
 * Harness mirrors account-optin.test.mjs (domain then app inside jsdom, fetch
 * stub keyed by URL, every call logged), plus a navigator.sendBeacon stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
const LLMS_SRC = readFileSync(fileURLToPath(new URL('../public/llms.txt', import.meta.url)), 'utf8');

const I18N = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const FLAT = (s) => String(s).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const fire = (win, elmt, type) => elmt.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

const PRIX_CENTS = 40000;
// ADR 0034 — le tarif servi est une GRILLE. `tarifOf(cents)` fabrique une
// grille plate à ce prix : le « à partir de » du héros en est la cellule la
// plus basse, et c'est ce que le héros doit citer.
const tarifOf = (cents) => {
  const grille = domain.prixNotaGrille({ prixCents: cents });
  return { grille, prixNotaMinCents: grille.defaut, taxesIncluses: false, deboursInclus: false };
};
const monthRoute = (cents = PRIX_CENTS) => ({
  match: (u, i) => u.includes('/bids?month=') && (!i.method || i.method === 'GET'),
  reply: (u) => jsonRes(200, { month: u.split('month=')[1], bids: [], tarif: tarifOf(cents) }),
});

// Read a Blob's text the way a browser would (jsdom has FileReader, no Blob#text).
const blobText = (win, blob) => new Promise((res) => {
  if (typeof blob === 'string') return res(blob);
  const r = new win.FileReader();
  r.onload = () => res(String(r.result));
  r.readAsText(blob);
});

async function boot({ url = '', seed = {}, routes = [], beacon = true, fetchThrows = false } = {}) {
  const calls = [];
  const beacons = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        if (fetchThrows) throw new Error('fetch exploded');
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      if (beacon) {
        Object.defineProperty(window.navigator, 'sendBeacon', {
          configurable: true,
          value: (u, body) => { beacons.push({ url: String(u), body }); return true; },
        });
      }
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
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls, beacons, dom };
}

// The funnel ids a page sent, in order — every keepalive POST to /events.
// (sendBeacon is deliberately NOT the transport: it always carries
// credentials, which the API's wildcard CORS origin refuses — see track().)
async function sentEvents(win, beacons, calls) {
  const out = [];
  for (const b of beacons) out.push(JSON.parse(await blobText(win, b.body)));
  for (const c of calls || []) {
    if (c.url.endsWith('/events') && c.init.method === 'POST') out.push(JSON.parse(c.init.body));
  }
  return out;
}

// The smallest notice at the STANDARD tier, from the domain's own ladder.
function firstStandardOffset(D) {
  let n = 0;
  while (D.tierForDays(n) !== 'standard') n++;
  return n;
}

// ---------------------------------------------------------------------------
// 1. Honest price line
// ---------------------------------------------------------------------------
// The retired claims, exactly: « publier est gratuit » stays true and stays.
const FREE_LIE = /Gratuit pour (vous|le client)|It is free for the client|free for the client\.|Free for (you|the client)|se rémunère auprès du notaire|paid by the notary/;

test('no client surface claims the client pays nothing', () => {
  for (const [name, src] of Object.entries({ 'index.html': HTML_SRC, 'app.js': APP_SRC, 'i18n.js': I18N_SRC, 'llms.txt': LLMS_SRC })) {
    const hit = src.match(FREE_LIE);
    assert.ok(!hit, name + ' still says the client pays nothing: « ' + (hit && hit[0]) + ' »');
  }
});

test('the hero states the two-line truth and quotes the price the API serves', async () => {
  const { doc, D, dom } = await boot({ routes: [monthRoute(52500)] });
  const tag = doc.querySelector('#pane-carnet .intro--hero .hero-tagline');
  const line = $(doc, 'hero-price-line');
  assert.ok(line && tag.contains(line), 'the price line lives inside the hero tagline');
  const t = FLAT(line.textContent);
  assert.match(t, /100 % de votre offre/, 'the notary gets the whole offer: ' + t);
  assert.match(t, /signature/, 'and Nota is paid at signing: ' + t);
  assert.match(t, /à partir de/, 'the grid is quoted as a floor, never as THE price: ' + t);
  assert.ok(t.includes(FLAT(D.money(525))), 'the served price (525 $) is quoted, not a literal: ' + t);
  assert.ok(!t.includes(FLAT(D.money(400))), 'the default price is NOT baked into the page: ' + t);
  dom.window.close();
});

test('offline, the hero says the price is PUBLISHED — never « fixe », never an invented amount', async () => {
  // ADR 0034 : le prix n'est plus un nombre unique, il varie par service ET
  // par palier de délai. Le chemin nominal dit « à partir de X » ; ce repli,
  // qui ne connaît aucun chiffre, doit rester vrai sans en citer un.
  const { doc, dom } = await boot();
  const t = FLAT($(doc, 'hero-price-line').textContent);
  assert.match(t, /100 % de votre offre/, t);
  assert.ok(!/\$/.test(t), 'no amount when the tarif is unknown: ' + t);
  assert.match(t, /prix publié d’avance/, 'says the price is published, not fixed: ' + t);
  assert.ok(!/fixe/.test(t), 'le prix n’est plus fixe : ' + t);
  dom.window.close();
});

test('the intro film note and the film kicker say the two-line truth', () => {
  const note = HTML_SRC.match(/<p class="ig-note">([^<]*)<\/p>/);
  assert.ok(note, 'the client film keeps its closing note');
  assert.match(FLAT(note[1]), /100 % de votre offre/, note[1]);
  assert.match(FLAT(note[1]), /signature/, note[1]);
  const kicker = HTML_SRC.match(/<span class="ig-kicker">Exemple([^<]*)<\/span>/);
  assert.ok(kicker && !/gratuit/i.test(kicker[1]), 'the example kicker no longer says « gratuit pour vous »: ' + (kicker && kicker[1]));
});

test('the new price copy is translated, amount included', () => {
  I18N.force('en');
  const repli = 'Le notaire reçoit 100 % de votre offre ; le service Nota, à un prix publié d’avance, se paie seulement à la signature.';
  assert.ok(I18N.covered(repli), 'no English entry for the fallback price line');
  assert.match(I18N.tEn(repli), /published in advance/, I18N.tEn(repli));
  // L'ancienne affirmation — « à prix fixe » — ne doit survivre nulle part :
  // depuis l'ADR 0034 le prix varie par service ET par palier de délai.
  assert.ok(!/à prix fixe/.test(HTML_SRC), 'index.html affirme encore un prix fixe');
  assert.ok(!/à prix fixe/.test(I18N_SRC), 'le dictionnaire porte encore un prix fixe');
  const priced = 'Le notaire reçoit 100 % de votre offre ; le service Nota, à partir de 525 $, se paie seulement à la signature.';
  const en = I18N.tEn(priced);
  assert.ok(!/reçoit|offre|signature\b.*\./.test(en) || /receives/.test(en), 'the composed line has a rule: ' + en);
  assert.match(en, /100 ?% of your offer/, en);
  assert.ok(en.includes('$525'), 'the amount rides through, money-converted: ' + en);
  assert.match(en, /from \$525/, 'the « à partir de » is translated, never left in French: ' + en);
  assert.ok(!/Free for you|Free for the client/.test(I18N_SRC), 'the English side of the retired claim is gone');
});

// ---------------------------------------------------------------------------
// 2. The CTA opens a sensible date, and the date can move inside the dialog
// ---------------------------------------------------------------------------
test('with no date selected, the hero CTA opens the first STANDARD date, never today', async () => {
  const { doc, D, Nota, dom } = await boot();
  assert.equal(Nota.state.selectedDate, null, 'nothing selected at boot');
  $(doc, 'cta-reserver').click();
  await wait(60);
  assert.equal($(doc, 'day-dialog').open, true, 'the booking dialog opened');
  const expected = addDays(todayISO(), firstStandardOffset(D));
  assert.equal($(doc, 'o-date').value, expected, 'the form date is the first standard date');
  assert.equal(Nota.state.selectedDate, expected);
  assert.equal($(doc, 'tp-pill').dataset.tier, 'standard', 'the tier shown is standard, not the ×4 same-day tier');
  dom.window.close();
});

test('the pulse « Réserver » button opens the same first standard date', async () => {
  const { doc, D, dom } = await boot();
  const btn = doc.querySelector('#pulse-rows .mini-reserver');
  assert.ok(btn, 'the pulse has a reserve button');
  btn.click();
  await wait(60);
  assert.equal($(doc, 'o-date').value, addDays(todayISO(), firstStandardOffset(D)));
  dom.window.close();
});

test('a selected calendar day still wins over the default', async () => {
  const { doc, dom } = await boot();
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  $(doc, 'day-dialog').close();
  $(doc, 'cta-reserver').click();
  await wait(40);
  assert.equal($(doc, 'o-date').value, iso, 'the cell the client clicked is the date the CTA reopens');
  dom.window.close();
});

test('the day dialog carries a native date picker that moves the date without closing', async () => {
  const { win, doc, D, Nota, dom } = await boot();
  $(doc, 'cta-reserver').click();
  await wait(60);
  const pick = $(doc, 'day-date');
  assert.ok(pick, '#day-date exists');
  assert.equal(pick.type, 'date');
  assert.ok(pick.closest('#day-dialog .day-head'), 'it sits in the dialog header');
  assert.equal(pick.getAttribute('min'), todayISO(), 'no past date');
  assert.equal(pick.value, $(doc, 'o-date').value, 'it mirrors the form date');
  const label = doc.querySelector('label[for="day-date"]');
  assert.ok(label && /Date de signature/.test(label.textContent), 'labelled « Date de signature »');

  const soon = addDays(todayISO(), 3);
  pick.value = soon; fire(win, pick, 'change');
  await wait(60);
  assert.equal($(doc, 'day-dialog').open, true, 'the dialog stays open');
  assert.equal($(doc, 'o-date').value, soon, 'the form follows the picker');
  assert.equal(Nota.state.selectedDate, soon);
  assert.equal($(doc, 'tp-pill').dataset.tier, D.tierForDays(3), 'the tier label re-rendered for the new notice');
  assert.equal($(doc, 'day-title').textContent.trim().length > 0, true);

  // A past date is refused and the picker snaps back to the open day.
  pick.value = addDays(todayISO(), -2); fire(win, pick, 'change');
  await wait(30);
  assert.equal($(doc, 'o-date').value, soon, 'a past date changes nothing');
  assert.equal(pick.value, soon);
  dom.window.close();
});

// ---------------------------------------------------------------------------
// 4. Post-publish expectations
// ---------------------------------------------------------------------------
const DELAY_PROMISE = /\d+\s*(h\b|heures?|minutes?|jours?)|sous peu|rapidement|immédiat/i;

test('the online success screen says what happens next, honestly', async () => {
  const { doc, Nota, dom } = await boot({ routes: [monthRoute()] });
  $(doc, 'o-courriel').value = 'client@exemple.ca';
  Nota.showOfferSuccess();
  await wait(20);
  const next = $(doc, 'offer-success-next');
  assert.ok(next && !next.hidden, 'the expectation line is on the success screen');
  const t = FLAT(next.textContent);
  assert.match(t, /visible des notaires inscrits/, t);
  assert.match(t, /client@exemple\.ca/, 'names the courriel that will be written to: ' + t);
  assert.match(t, /dès qu’un notaire/, t);
  assert.match(t, /retirer/, 'says it can be withdrawn: ' + t);
  assert.match(t, /sans frais/, 'free of charge: ' + t);
  assert.ok(!DELAY_PROMISE.test(t), 'no delay promise: ' + t);
  dom.window.close();
});

test('offline, nothing was published — no expectation is raised', async () => {
  const { doc, Nota, dom } = await boot();
  $(doc, 'o-courriel').value = 'client@exemple.ca';
  Nota.showOfferSuccess();
  await wait(20);
  const next = $(doc, 'offer-success-next');
  assert.ok(!next || next.hidden || !FLAT(next.textContent), 'no « visible des notaires » line for a local-only offer');
  dom.window.close();
});

test('returning from Checkout with ?paiement=ok shows the same expectation line', async () => {
  const { doc, dom } = await boot({
    url: '?paiement=ok',
    routes: [monthRoute()],
    seed: { 'nota.profile.v1': JSON.stringify({ courriel: 'client@exemple.ca' }) },
  });
  const note = $(doc, 'checkout-notice');
  assert.ok(note, 'a standing notice on the pane the client lands on');
  const t = FLAT(note.textContent);
  assert.match(t, /carte est acceptée/, t);
  assert.match(t, /client@exemple\.ca/, t);
  assert.match(t, /retirer/, t);
  assert.match(t, /sans frais/, t);
  assert.ok(!DELAY_PROMISE.test(t), 'no delay promise: ' + t);
  dom.window.close();
});

test('the expectation copy is translated, courriel included', () => {
  I18N.force('en');
  for (const s of ['Votre demande est maintenant visible des notaires inscrits.', 'Vous pouvez la retirer sans frais jusque-là.']) {
    assert.ok(I18N.covered(s), 'no English entry for: ' + s);
  }
  const en = I18N.tEn('Nous vous écrivons à client@exemple.ca dès qu’un notaire la retient.');
  assert.match(en, /client@exemple\.ca/, en);
  assert.ok(!/écrivons|dès qu/.test(en), 'the composed sentence has a rule: ' + en);
});

// ---------------------------------------------------------------------------
// 5. Funnel beacons
// ---------------------------------------------------------------------------
test('one « visite » per page load, as a credential-less keepalive POST to /events with only the event id', async () => {
  const { win, beacons, calls, D, dom } = await boot();
  const ev = await sentEvents(win, beacons, calls);
  assert.deepEqual(ev.map((e) => e.event), ['visite']);
  assert.deepEqual(Object.keys(ev[0]), ['event'], 'no identifier, no extra field');
  const post = calls.find((c) => c.url.endsWith('/events'));
  assert.ok(post, 'the event went by fetch');
  assert.equal(post.init.keepalive, true, 'survives a page unload');
  assert.equal(post.init.credentials, 'omit', 'never carries credentials (a wildcard CORS origin refuses them)');
  assert.equal(post.init.headers['content-type'], 'text/plain', 'a simple request: no preflight to abort on unload');
  assert.equal(beacons.length, 0, 'sendBeacon is never used — it always sends credentials');
  assert.ok(D.isFunnelEvent('visite'));
  // Nothing is remembered about the visitor for it.
  assert.ok(!Object.keys(win.localStorage).some((k) => /event|funnel|visite/i.test(k)), 'nothing stored');
  dom.window.close();
});

test('opening a day, touching the form, the notary door and the Checkout return each beacon once', async () => {
  const { win, doc, beacons, calls, Nota, D, dom } = await boot();
  $(doc, 'cta-reserver').click();
  await wait(60);
  let ev = (await sentEvents(win, beacons, calls)).map((e) => e.event);
  assert.deepEqual(ev, ['visite', 'jour_ouvert']);

  // The first input in the form, once per opening — a second input is silent.
  const lv = $(doc, 'crit-valeur_pret') || doc.querySelector('#offer-form input:not([type=hidden])');
  assert.ok(lv, 'a form input to touch');
  fire(win, lv, 'input');
  fire(win, lv, 'input');
  fire(win, $(doc, 'o-service'), 'change');
  ev = (await sentEvents(win, beacons, calls)).map((e) => e.event);
  assert.deepEqual(ev, ['visite', 'jour_ouvert', 'formulaire']);

  // Reopening a day starts a new « formulaire » window.
  $(doc, 'day-dialog').close();
  doc.querySelector('.cal-cell[data-date="' + addDays(todayISO(), 6) + '"]').click();
  await wait(40);
  // The criteria re-render on open: touch the LIVE input, not a detached node.
  fire(win, $(doc, 'crit-valeur_pret') || doc.querySelector('#offer-form input:not([type=hidden])'), 'input');
  ev = (await sentEvents(win, beacons, calls)).map((e) => e.event);
  assert.deepEqual(ev, ['visite', 'jour_ouvert', 'formulaire', 'jour_ouvert', 'formulaire']);

  Nota.setTab('notaires');
  Nota.setTab('carnet');
  Nota.setTab('notaires');
  ev = (await sentEvents(win, beacons, calls)).map((e) => e.event);
  assert.equal(ev.filter((e) => e === 'notaire_porte').length, 1, 'the notary door counts once per load');

  for (const e of ev) assert.ok(D.isFunnelEvent(e), 'unknown funnel id sent: ' + e);
  assert.ok(!ev.includes('publie') && !ev.includes('notaire_inscrit'), 'the server counts those');
  dom.window.close();
});

test('the Checkout return beacons paiement_ok / paiement_annule', async () => {
  const ok = await boot({ url: '?paiement=ok' });
  assert.ok((await sentEvents(ok.win, ok.beacons, ok.calls)).some((e) => e.event === 'paiement_ok'));
  ok.dom.window.close();
  const ko = await boot({ url: '?paiement=annule' });
  const ev = (await sentEvents(ko.win, ko.beacons, ko.calls)).map((e) => e.event);
  assert.ok(ev.includes('paiement_annule'));
  assert.ok(!ev.includes('paiement_ok'));
  ko.dom.window.close();
});

test('the event goes by keepalive POST even without sendBeacon; a broken transport never throws', async () => {
  const { calls, dom } = await boot({ beacon: false });
  const post = calls.find((c) => c.url.endsWith('/events'));
  assert.ok(post, 'fetch fallback used');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.keepalive, true);
  assert.deepEqual(JSON.parse(post.init.body), { event: 'visite' });
  dom.window.close();

  // fetch throws synchronously and there is no sendBeacon: the page still boots.
  const broken = await boot({ beacon: false, fetchThrows: true });
  assert.ok(broken.Nota, 'app booted despite a throwing transport');
  assert.equal(broken.doc.getElementById('pane-carnet').hidden, false);
  broken.dom.window.close();
});

test('only catalogue ids can be sent — a stray name is dropped before the wire', () => {
  // The guard is structural: track() asserts D.isFunnelEvent before sending.
  assert.match(APP_SRC, /function track\(eventId\)[\s\S]{0,300}D\.isFunnelEvent\(eventId\)/,
    'track() must gate on D.isFunnelEvent');
  assert.ok(!/track\('publie'\)|track\('notaire_inscrit'\)/.test(APP_SRC), 'the web never sends the server-counted steps');
});
