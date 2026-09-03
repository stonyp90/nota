/**
 * The client side of the carnet talks by itself: a client who posted an offer
 * sees, in "Mes offres", what notaries sent back (a higher-price proposition,
 * a document request) and can act on it in ≤3 clicks.
 *
 * Boot harness mirrors ux-nav.test.mjs (domain then app inside jsdom), with a
 * fetch stub keyed by URL so the API contract is exercised without a server.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Every window this file boots is closed when the file is done: a signed-in
// client on the profil tab runs the 15 s status poll (app.js clientPollStart),
// and a jsdom timer left running keeps the test process alive forever.
const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

/**
 * `routes`: [{ match: (url, init) => bool, reply: (url, init) => response }].
 * Every call is logged in `calls` so tests can assert on URL, headers, body.
 */
async function boot({ url = '', seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {}, headers: (init && init.headers) || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
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
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

const activePane = (doc) => {
  const on = Array.from(doc.querySelectorAll('.tab-pane')).filter((p) => !p.hidden);
  assert.equal(on.length, 1, 'exactly one visible pane');
  return on[0].id;
};

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 1000, clientToken: 'tok-o1' };

function statusRoute(body) {
  return {
    match: (u) => u.includes('/client/bid?'),
    reply: () => jsonRes(200, body),
  };
}

const withProposition = () => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
  propositions: [{ id: 'p1', etude: 'Étude Tremblay', montant: 1200, delta: 200, message: 'Dossier complexe.', status: 'en_attente', createdAt: todayISO() }],
  demandes: [],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
});

const withDemande = () => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
  propositions: [],
  demandes: [{ id: 'd1', etude: 'Étude Roy', documents: [{ id: 'piece_identite', nom: 'Pièce d’identité avec photo', kind: 'doc' }, { id: 'x', nom: 'Relevé bancaire', kind: 'doc' }], message: '', createdAt: todayISO(), fournie: false }],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
});

// (a) a seeded offer with a clientToken triggers GET /client/bid with the bearer header
test('profil render fetches the live status of each tokened offer with its bearer token', async () => {
  const { Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute(withProposition())],
  });
  calls.length = 0;
  Nota.setTab('profil');
  await wait(40);
  const c = calls.find((x) => x.url.includes('/client/bid?'));
  assert.ok(c, 'GET /client/bid was called');
  assert.match(c.url, /id=o1/);
  assert.match(c.url, new RegExp('dateISO=' + DATE));
  const auth = c.headers.Authorization || c.headers.authorization;
  assert.equal(auth, 'Bearer tok-o1');
});

// (b) an en_attente proposition renders Accepter/Refuser; accept POSTs and the row becomes retained
test('a pending proposition renders accept/decline, and accepting retains the offer at the new amount', async () => {
  const status = withProposition();
  const { win, doc, Nota, D, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [
      statusRoute(status),
      {
        match: (u) => u.endsWith('/client/propositions/accept'),
        reply: () => {
          status.bid = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 1200, status: 'retenue', etude: 'Étude Tremblay' };
          status.propositions[0].status = 'acceptee';
          return jsonRes(200, { bid: status.bid, proposition: status.propositions[0] });
        },
      },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  const block = doc.querySelector('.my-offer-prop[data-prop-id="p1"]');
  assert.ok(block, 'the proposition block renders under the row');
  assert.match(block.textContent, /Étude Tremblay/);
  assert.match(block.textContent, /1\s*200\s*\$/);
  assert.match(block.textContent, /\+\s*200\s*\$/);
  assert.match(block.textContent, /Dossier complexe\./);
  const accept = block.querySelector('.btn-prop-accept');
  const decline = block.querySelector('.btn-prop-decline');
  assert.ok(accept && decline, 'both buttons');
  assert.match(accept.textContent, /Accepter/);
  assert.match(accept.textContent, /1\s*200\s*\$/);
  assert.match(decline.textContent, /Refuser/);

  calls.length = 0;
  accept.click();
  await wait(40);
  const post = calls.find((x) => x.url.endsWith('/client/propositions/accept'));
  assert.ok(post, 'POST accept');
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { id: 'o1', dateISO: DATE, propositionId: 'p1' });
  assert.equal(post.headers.Authorization || post.headers.authorization, 'Bearer tok-o1');

  const mine = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'));
  assert.equal(mine[0].montant, 1200);
  assert.equal(mine[0].retained, true);
  const row = doc.querySelector('#my-offers-live tr.my-offer[data-id="o1"]');
  assert.equal(row.dataset.status, 'approved');
  assert.equal(row.querySelector('.c-montant').textContent, D.money(1200));
  assert.match(row.querySelector('.my-offer-status').textContent, /Retenue par Étude Tremblay/);
  assert.match($(doc, 'toast').textContent, /retenue à 1\s*200\s*\$/);
});

test('declining a proposition POSTs decline and the block reads « Refusée »', async () => {
  // The API is the source of truth: once declined, the status it serves says so.
  const status = withProposition();
  const { doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [
      statusRoute(status),
      { match: (u) => u.endsWith('/client/propositions/decline'), reply: () => { status.propositions[0].status = 'refusee'; return jsonRes(200, { proposition: { id: 'p1', status: 'refusee' } }); } },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  doc.querySelector('.my-offer-prop[data-prop-id="p1"] .btn-prop-decline').click();
  await wait(40);
  const post = calls.find((x) => x.url.endsWith('/client/propositions/decline'));
  assert.ok(post);
  assert.deepEqual(JSON.parse(post.init.body), { id: 'o1', dateISO: DATE, propositionId: 'p1' });
  const block = doc.querySelector('.my-offer-prop[data-prop-id="p1"]');
  assert.match(block.textContent, /Refusée/);
  assert.equal(block.querySelector('.btn-prop-accept'), null, 'no more buttons');
});

// (c) a demande renders the document names and the CTA opens the dossier on that service
test('a document request lists the documents and « Compléter mon dossier » opens the dossier on that act', async () => {
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute(withDemande())],
  });
  Nota.setTab('profil');
  await wait(40);
  const block = doc.querySelector('.my-offer-demande[data-demande-id="d1"]');
  assert.ok(block, 'the demande block renders');
  assert.match(block.textContent, /Le notaire demande/);
  assert.match(block.textContent, /Pièce d’identité avec photo/);
  assert.match(block.textContent, /Relevé bancaire/);
  const cta = block.querySelector('.btn-demande-dossier');
  assert.match(cta.textContent, /Compléter mon dossier/);
  cta.click();
  await wait(10);
  assert.equal(activePane(doc), 'pane-dossier');
  assert.equal($(doc, 'd-service').value, 'financement');
});

test('a fulfilled document request reads « Transmis »', async () => {
  const body = withDemande(); body.demandes[0].fournie = true;
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute(body)],
  });
  Nota.setTab('profil');
  await wait(40);
  const block = doc.querySelector('.my-offer-demande[data-demande-id="d1"]');
  assert.match(block.textContent, /Transmis/);
});

// (d) clicking the row date opens #day-dialog for that date
test('clicking the date of an offer opens that day on the carnet', async () => {
  const { doc, Nota } = await boot({ seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) } });
  Nota.setTab('profil');
  await wait(20);
  const row = doc.querySelector('#my-offers-live tr.my-offer[data-id="o1"]');
  assert.match(row.querySelector('.my-offer-status').textContent, /Ouverte — en attente d’un notaire/);
  const detail = doc.querySelector('#my-offers-live tr.my-offer-detail[data-for="o1"]');
  assert.ok(detail.querySelector('.my-offer-agenda'), 'an agenda link per row');
  assert.match(detail.querySelector('.my-offer-next').textContent, /Prochaine étape/, 'a next-step line per row');
  const dateBtn = row.querySelector('.my-offer-day');
  assert.equal(dateBtn.tagName, 'BUTTON');
  dateBtn.click();
  await wait(60);
  assert.equal($(doc, 'day-dialog').open, true);
  assert.equal($(doc, 'o-date').value, DATE);
});

// (e) a bell notification is added once per proposition id
test('the bell gets one notification per proposition, never twice', async () => {
  const { win, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [statusRoute(withProposition())],
  });
  Nota.setTab('profil');
  await wait(40);
  Nota.setTab('carnet');
  Nota.setTab('profil');
  await wait(40);
  const notifs = JSON.parse(win.localStorage.getItem('nota.notifs.v1') || '[]');
  const props = notifs.filter((n) => n.key === 'proposition:p1');
  assert.equal(props.length, 1);
  assert.match(props[0].title, /1\s*200\s*\$/);
  const cache = JSON.parse(win.localStorage.getItem('nota.offerstatus.v1') || '{}');
  assert.ok(cache.o1, 'the last status is cached per offer');
});

// Dossier push: saving a dossier change for a tokened live offer POSTs /client/dossier
test('a dossier change for an act with a live tokened offer is pushed to the API', async () => {
  const { win, doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [{ match: (u) => u.endsWith('/client/dossier'), reply: () => jsonRes(200, { readiness: {}, demandes: [] }) }],
  });
  $(doc, 'd-service').value = 'financement';
  Nota.setTab('dossier');
  await wait(20);
  calls.length = 0;
  // Scoped to the intake items: the pricing card above them now carries its
  // own text input (« Nom du prêteur », hidden until « Autre prêteur »).
  const inp = doc.querySelector('#dossier-list .dossier-item input[type="text"]');
  inp.value = 'Jean Tremblay';
  inp.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(700);
  const post = calls.find((x) => x.url.endsWith('/client/dossier'));
  assert.ok(post, 'POST /client/dossier');
  assert.equal(post.headers.Authorization || post.headers.authorization, 'Bearer tok-o1');
  const body = JSON.parse(post.init.body);
  assert.equal(body.id, 'o1');
  assert.equal(body.dateISO, DATE);
  assert.ok(body.dossier && Object.values(body.dossier).includes('Jean Tremblay'));
});

// (f) the publish button shows the parametre_requis hint while disabled
test('a disabled publish button says which required question is still unanswered', async () => {
  const { doc, D } = await boot();
  const iso = addDays(todayISO(), 5);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  // Default act carries required pricing questions.
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  const v = D.validateOffer({ serviceId: 'refinancement', dateISO: iso, montant: 5000, pricing: {}, todayISO: todayISO() });
  const req = v.errors.filter((e) => e.code === 'parametre_requis');
  assert.ok(req.length, 'the fixture act has required questions');
  assert.equal($(doc, 'offer-submit').disabled, true);
  const hint = $(doc, 'offer-hint');
  assert.ok(hint && !hint.hidden, 'the reason is shown');
  assert.match(hint.textContent, /Répondez à/);
  const lbl = D.serviceById('refinancement').pricing.criteria.find((c) => c.id === req[0].param).label;
  assert.ok(hint.textContent.includes(lbl), 'names the question');
  const step = $(doc, 'o-criteria-step').querySelector('.book-step-lbl');
  assert.match(step.textContent, /Les questions du notaire/);
});

// (g) a calendar cell badge contains $ and not ×
test('the calendar badge and the legend speak dollars, not multipliers', async () => {
  const { doc } = await boot();
  const iso = addDays(todayISO(), 1);
  const badge = doc.querySelector('.cal-cell[data-date="' + iso + '"] .cal-urgency');
  assert.ok(badge);
  assert.match(badge.textContent, /\$/);
  assert.ok(!badge.textContent.includes('×'), badge.textContent);
  assert.match(badge.textContent, /^dès /);
  const legend = $(doc, 'legend').textContent;
  assert.ok(!legend.includes('×'), 'no multiplier in the legend');
  assert.match(legend, /Même jour/, 'the extreme tier is shown as "same day"');
});

test('the offer dialog uses plain words: what others offer, offer as much, a dollar range, slider bounds', async () => {
  const { doc, D } = await boot();
  const iso = addDays(todayISO(), 5);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  assert.match($(doc, 'day-best-k').textContent, /Ce que d’autres offrent ce jour-là/);
  // The invented « Chances … : 95 % » is gone (never measured); the line now
  // states the mechanism, with no figure at all.
  const chance = $(doc, 'day-chance').textContent;
  assert.match(chance, /Plus la date est éloignée/);
  assert.ok(!/\d|%/.test(chance), 'no figure in the lead-time line: ' + chance);
  const tp = $(doc, 'tp-text').textContent;
  assert.match(tp, /\$/);
  assert.ok(!tp.includes('×'), tp);
  const amt = $(doc, 'o-amount');
  assert.equal($(doc, 'o-amount-min').textContent, D.money(Number(amt.min)));
  assert.equal($(doc, 'o-amount-max').textContent, D.money(Number(amt.max)));
  const num = $(doc, 'o-amount-input');
  assert.equal(Number(num.value), Number(amt.value));
  num.value = String(Number(amt.min) + 50);
  num.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  assert.equal(Number(amt.value), Number(amt.min) + 50);
  assert.match($(doc, 'gauge-label').textContent, /Trop bas|Dans la norme|Généreux/);

  // ONE price signal per step. The meta-notes that restated the price in other
  // words ("+N % sur le prix de départ", "Prix de départ ajusté : …") are gone:
  // the answers wear their own $ badges and the floor shows live in the bounds.
  assert.equal(doc.getElementById('o-mult'), null, 'no multiplier note under the slider');
  assert.equal(doc.getElementById('o-base-note'), null, 'no starting-price note under the questions');

  // The tier explains the PRE-FILL, so it lives in the same step as the amount.
  const offerStep = $(doc, 'o-amount').closest('.book-step');
  assert.ok(offerStep, 'the amount lives inside a step block');
  assert.equal($(doc, 'tier-preview').closest('.book-step'), offerStep,
    'tier-preview sits with the amount it explains, not between the steps');

  // Booking hierarchy: price -> CTA -> small print -> options. The submit
  // button precedes the options disclosure, and the Law 25 consent line is
  // always visible — never folded inside a <details>.
  const submit = $(doc, 'offer-submit');
  const options = doc.querySelector('#offer-form details.book-options');
  assert.ok(options, 'the options disclosure exists');
  const FOLLOWING = doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(submit.compareDocumentPosition(options) & FOLLOWING,
    'the CTA sits above the options disclosure');
  assert.equal($(doc, 'consent-line').closest('details'), null,
    'the consent line is out in the open, under the CTA');
});

test('every answer that moves the price wears its own dollar badge', async () => {
  const { doc, D } = await boot();
  const iso = addDays(todayISO(), 5);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);

  // The domain owns what a succession adds; the chip must quote that number —
  // price transparency ON the answer, where the choice is made.
  const crit = D.serviceById('refinancement').pricing.criteria.find((c) => c.id === 'succession');
  const oui = crit.options.find((o) => o.id === 'oui');
  assert.ok(oui && Number(oui.add) > 0, 'the fixture option carries a price add');
  const chip = $(doc, 'crit-succession__oui');
  assert.ok(chip, 'the succession « Oui » chip renders');
  const badge = chip.querySelector('.crit-add');
  assert.ok(badge, 'the price effect is shown on the answer itself');
  // "+400 $" style: sign (U+2212 for minus) + D.money of the absolute add.
  const expected = (Number(oui.add) > 0 ? '+' : '−') + D.money(Math.abs(Number(oui.add)));
  assert.equal(badge.textContent, expected);

  // The badge is appended AFTER the label text node: the i18n exact-match
  // lookup depends on the label staying a clean, standalone text node.
  assert.equal(chip.firstChild.nodeType, 3, 'the label text node comes first');
  assert.equal(chip.firstChild.textContent, oui.label);

  // A zero add earns no badge — silence means "does not move the price".
  const non = crit.options.find((o) => o.id === 'non');
  assert.equal(Number(non.add) || 0, 0, 'the fixture "Non" option is price-neutral');
  assert.equal($(doc, 'crit-succession__non').querySelector('.crit-add'), null,
    'no badge on an answer that does not move the price');
});

test('the client steps are said once: in the guide, not repeated in the hero', async () => {
  // The hero keeps a single tagline; the numbered steps live in the guide
  // dialog only (one source: ONB_FLOWS) — a returning client resumes at them.
  const { doc } = await boot({ seed: { 'nota.role.v1': 'client', 'nota.onboarded.v1': '1' } });
  assert.equal(doc.querySelector('#pane-carnet .hero-points'), null);
  doc.getElementById('footer-guide').click();
  await wait(10);
  const steps = doc.querySelectorAll('#onb-steps .onb-step');
  assert.equal(steps.length, 3);
  assert.match(steps[0].textContent, /Choisissez votre date/);
  assert.match(steps[2].textContent, /Un notaire vous retient/);
});

test('returning from Stripe with ?paiement=ok lands on Mes offres', async () => {
  const { doc } = await boot({ url: '?paiement=ok', seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) } });
  assert.equal(activePane(doc), 'pane-profil');
});

test('the tier dollar band follows the act and its answers, never a stale floor', async () => {
  // The band ("les offres se concluent entre X et Y") is tier × the CURRENT
  // act's dynamic base. Switching act, or answering a price question, must
  // re-quote it — a date-only refresh once kept the previous act's floor.
  const { doc, D } = await boot();
  const iso = addDays(todayISO(), 5);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(20);
  const t = D.tierById(D.tierForDays(D.daysBetween(todayISO(), iso)));
  const before = D.computeBasePrice('financement', {});
  assert.ok($(doc, 'tp-text').textContent.includes(D.money(Math.round(before * t.apercuMin))),
    'after an act switch the band quotes the new act’s floor');
  doc.getElementById('crit-contexte__achat').click();
  await wait(20);
  const after = D.computeBasePrice('financement', { contexte: 'achat' });
  assert.ok(after > before, 'the answer raises the base');
  assert.ok($(doc, 'tp-text').textContent.includes(D.money(Math.round(after * t.apercuMin))),
    'answering a price question re-quotes the band');
});

test('a calm date quotes ONE figure — never « entre X et X »', async () => {
  // The standard tier is pinned to 1× (apercuMin === apercuMax), which is every
  // date two weeks out or more — the degenerate range read as a bug on the most
  // common booking. One bound → one number, « autour de X ».
  const { doc, D } = await boot();
  const iso = addDays(todayISO(), 20);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(20);
  const t = D.tierById(D.tierForDays(D.daysBetween(todayISO(), iso)));
  assert.equal(t.apercuMin, t.apercuMax, 'precondition: the calm tier is a single point');
  const text = $(doc, 'tp-text').textContent;
  assert.match(text, /se concluent autour de /, 'a point band collapses to one figure: ' + text);
  assert.ok(!/entre .+ et .+/.test(text), 'no degenerate « entre X et X »: ' + text);
});
