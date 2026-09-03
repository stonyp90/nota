/**
 * Two client lifelines, one popup construction.
 *
 *   1. Every dialog is built the same way: first child is the shared
 *      <form method="dialog" class="dlg-x-form"> whose ✕ stays pinned
 *      top-right (position:sticky) while the dialog scrolls.
 *   2. Cancelling an offer — open or already retained — from « Mes offres »,
 *      through the confirm dialog, to POST /client/bid/cancel.
 *   3. « Nous joindre »: the contact dialog validates inline via the domain
 *      and POSTs /contact, with the per-offer « Besoin d'aide ? » door
 *      carrying the offer's id for triage.
 *
 * Harness mirrors client-offers.test.mjs (jsdom + fetch stub).
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
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

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

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 1000, clientToken: 'tok-o1' };

const openStatus = () => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 1000, status: 'ouverte', etude: null },
  propositions: [], demandes: [],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
});
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });

// --- 1. One popup construction ----------------------------------------------

test('every dialog opens with the same sticky ✕ construction', async () => {
  const { doc } = await boot();
  const dialogs = Array.from(doc.querySelectorAll('dialog'));
  assert.ok(dialogs.length >= 6, 'expected the full set of dialogs, got ' + dialogs.length);
  for (const dlg of dialogs) {
    const first = dlg.firstElementChild;
    assert.ok(first, dlg.id + ': empty dialog');
    assert.equal(first.tagName, 'FORM', dlg.id + ': first child must be the close form');
    assert.equal(first.className, 'dlg-x-form', dlg.id + ': close form must use the shared class');
    assert.equal(first.getAttribute('method'), 'dialog', dlg.id + ': close form must be method=dialog');
    const x = first.querySelector('button.dlg-x');
    assert.ok(x, dlg.id + ': missing the shared ✕ button');
    assert.equal(x.getAttribute('aria-label'), 'Fermer', dlg.id + ': ✕ must be labelled Fermer');
  }
});

test('the ✕ and the day header are position:sticky so they survive scrolling', () => {
  assert.match(CSS_SRC, /\.dlg-x-form\s*{[^}]*position:\s*sticky/, '.dlg-x-form must be sticky');
  assert.match(CSS_SRC, /\.day-head\s*{[^}]*position:\s*sticky/, '.day-head must be sticky');
  assert.match(CSS_SRC, /\.mnav-head\s*{[^}]*position:\s*sticky/, '.mnav-head must be sticky');
  assert.ok(!/\.dlg-x-form\s*{[^}]*position:\s*absolute/.test(CSS_SRC), 'the old absolute pin must be gone');
});

// --- 2. Cancel an offer ------------------------------------------------------

test('an open offer offers « Annuler cette offre », confirms, POSTs and turns Annulée', async () => {
  const status = openStatus();
  const { doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [
      statusRoute(status), monthRoute(),
      {
        match: (u) => u.endsWith('/client/bid/cancel'),
        reply: () => jsonRes(200, { bid: { ...status.bid, status: 'annulee' } }),
      },
    ],
  });
  Nota.setTab('profil');
  await wait(40);

  const btn = doc.querySelector('.btn-offer-cancel');
  assert.ok(btn, 'cancel button missing on a pending offer');
  btn.click();
  await wait(40); // the dialog re-asks GET /client/bid before it opens (ADR 0023 / 0033)
  assert.equal($(doc, 'cancel-dialog').open, true, 'confirm dialog did not open');

  $(doc, 'cancel-confirm').click();
  await wait(40);
  const call = calls.find((x) => x.url.endsWith('/client/bid/cancel'));
  assert.ok(call, 'POST /client/bid/cancel was not sent');
  const auth = call.headers.Authorization || call.headers.authorization;
  assert.equal(auth, 'Bearer tok-o1');
  assert.deepEqual(JSON.parse(call.init.body), { id: 'o1', dateISO: DATE });

  const row = doc.querySelector('.my-offer[data-id="o1"]');
  assert.ok(row, 'offer row disappeared');
  assert.equal(row.dataset.status, 'cancelled');
  assert.equal(row.querySelector('.my-offer-status').textContent, 'Annulée');
  assert.ok(!doc.querySelector('.btn-offer-cancel'), 'a cancelled offer must not offer cancel again');
});

test('cancelling a retained offer warns that the notary will be notified', async () => {
  const retained = { ...OFFER };
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...retained, retained: true, etude: 'Étude Tremblay' }]) },
    routes: [statusRoute({ ...openStatus(), bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Tremblay' } }), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  const btn = doc.querySelector('.btn-offer-cancel');
  assert.ok(btn, 'a retained offer must still be cancellable');
  btn.click();
  await wait(40); // the dialog re-asks GET /client/bid before it opens (ADR 0023 / 0033)
  assert.match($(doc, 'cancel-text').textContent, /Étude Tremblay/);
  assert.match($(doc, 'cancel-text').textContent, /avisé par courriel/);
});

// --- 3. Nous joindre ---------------------------------------------------------

test('the contact dialog validates inline (domain codes) before any network call', async () => {
  const { doc, calls } = await boot({ routes: [monthRoute()] });
  $(doc, 'mnav-contact').click();
  assert.equal($(doc, 'contact-dialog').open, true);
  $(doc, 'ct-courriel').value = 'pas-un-courriel';
  $(doc, 'ct-message').value = '';
  calls.length = 0;
  $(doc, 'ct-submit').click();
  await wait(20);
  const errs = $(doc, 'ct-errors');
  assert.equal(errs.hidden, false);
  assert.ok(errs.textContent.includes('courriel'), errs.textContent);
  assert.ok(!calls.some((c) => c.url.endsWith('/contact')), 'invalid form must not reach the API');
});

test('a valid message POSTs /contact and shows the success state', async () => {
  const { doc, calls } = await boot({
    seed: { 'nota.profile.v1': JSON.stringify({ nom: 'Anne Tremblay', courriel: 'anne@example.ca' }) },
    routes: [monthRoute(), { match: (u) => u.endsWith('/contact'), reply: () => jsonRes(202, { recu: true }) }],
  });
  $(doc, 'mnav-contact').click();
  assert.equal($(doc, 'ct-nom').value, 'Anne Tremblay', 'name must prefill from the profile');
  assert.equal($(doc, 'ct-courriel').value, 'anne@example.ca', 'email must prefill from the profile');
  $(doc, 'ct-message').value = 'Bonjour, une question.';
  $(doc, 'ct-submit').click();
  await wait(40);
  const call = calls.find((c) => c.url.endsWith('/contact'));
  assert.ok(call, 'POST /contact missing');
  const body = JSON.parse(call.init.body);
  assert.equal(body.courriel, 'anne@example.ca');
  assert.equal(body.message, 'Bonjour, une question.');
  assert.equal($(doc, 'contact-success').hidden, false);
  assert.equal($(doc, 'contact-form').hidden, true);
});

test('« Besoin d’aide ? » on an offer prefills the subject and ties the bid id', async () => {
  const { doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [
      statusRoute(openStatus()), monthRoute(),
      { match: (u) => u.endsWith('/contact'), reply: () => jsonRes(202, { recu: true }) },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  const help = doc.querySelector('.my-offer-help');
  assert.ok(help, 'per-offer help door missing');
  help.click();
  assert.equal($(doc, 'contact-dialog').open, true);
  assert.equal($(doc, 'ct-sujet').value, 'Aide avec une offre');
  assert.equal($(doc, 'ct-context').hidden, false);
  $(doc, 'ct-courriel').value = 'anne@example.ca';
  $(doc, 'ct-message').value = 'J’aimerais changer la date.';
  $(doc, 'ct-submit').click();
  await wait(40);
  const call = calls.find((c) => c.url.endsWith('/contact'));
  assert.ok(call, 'POST /contact missing');
  assert.equal(JSON.parse(call.init.body).bidId, 'o1');
});

// --- 4. Evaluation (ADR 0015) ------------------------------------------------

test('a signed act offers the five stars; submitting POSTs /client/evaluation and thanks the client', async () => {
  const status = {
    ...openStatus(),
    bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Tremblay' },
    acte: { complete: true },
    evaluation: null,
  };
  const { doc, Nota, calls } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Tremblay' }]) },
    routes: [
      statusRoute(status), monthRoute(),
      {
        match: (u) => u.endsWith('/client/evaluation'),
        reply: () => {
          status.evaluation = { note: 4, commentaire: 'Très bien.' }; // the live status now carries it
          return jsonRes(201, { evaluation: status.evaluation });
        },
      },
    ],
  });
  Nota.setTab('profil');
  await wait(40);

  const box = doc.querySelector('.my-offer-eval');
  assert.ok(box, 'evaluation block missing on a completed act');
  const stars = box.querySelectorAll('.eval-star');
  assert.equal(stars.length, 5);
  const submit = box.querySelector('.eval-submit');
  assert.equal(submit.disabled, true, 'submit stays off until a note is picked');

  stars[3].click(); // 4 stars
  assert.equal(submit.disabled, false);
  assert.equal(stars[3].getAttribute('aria-pressed'), 'true');
  box.querySelector('.eval-comment').value = 'Très bien.';
  submit.click();
  await wait(40);

  const call = calls.find((c) => c.url.endsWith('/client/evaluation'));
  assert.ok(call, 'POST /client/evaluation missing');
  const body = JSON.parse(call.init.body);
  assert.equal(body.note, 4);
  assert.equal(body.commentaire, 'Très bien.');
  const auth = call.headers.Authorization || call.headers.authorization;
  assert.equal(auth, 'Bearer tok-o1');

  const done = doc.querySelector('.my-offer-eval-done');
  assert.ok(done, 'the thank-you echo did not render');
  assert.ok(done.textContent.includes('★★★★☆'), done.textContent);
});

test('no evaluation block before the act is settled', async () => {
  const status = { ...openStatus(), bid: { ...openStatus().bid, status: 'retenue' }, acte: { complete: false } };
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true }]) },
    routes: [statusRoute(status), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  assert.equal(doc.querySelector('.my-offer-eval'), null);
});

// Art. 70, C. déont. notaires (N-3, r. 2): a notary may not use « ou permettre
// que soit utilisé » a testimonial about themselves — no exception for
// authentic reviews. These two tests once REQUIRED a public rating badge on
// the client’s screen; they are inverted, not deleted, so the reversal stays
// legible. The API no longer serves `rating` here either.
test('a notary’s rating is NEVER published on their proposition or on the retained contact line (art. 70)', async () => {
  const status = {
    ...openStatus(),
    bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Tremblay' },
    // Even if a stale payload still carried an appreciation, nothing may render it.
    notaire: { etude: 'Étude Tremblay', courriel: 'n@etude.ca', rating: { note: 4.5, avis: 12 }, cote: 91, actes: 12 },
    propositions: [{ id: 'p1', etude: 'Étude Roy', montant: 1200, delta: 200, message: '', status: 'en_attente', createdAt: '2026-08-01', rating: { note: 4.8, avis: 7 }, cote: 88, actes: 37 }],
    acte: { complete: false },
  };
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Tremblay' }]) },
    routes: [statusRoute(status), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  assert.equal(doc.querySelector('.my-offer-prop .rating-badge'), null, 'no star badge on a proposition');
  assert.equal(doc.querySelector('.my-offer-contact .rating-badge'), null, 'nor on the retained contact line');
  assert.equal(doc.querySelector('.cote-badge'), null, 'and no cote pill anywhere on the client side');
  for (const node of [doc.querySelector('.my-offer-prop'), doc.querySelector('.my-offer-contact')]) {
    assert.ok(!/★|☆/.test(node.textContent), 'no star: ' + node.textContent);
    assert.ok(!/\bavis\b|\bcote\b/i.test(node.textContent), 'no review count, no cote: ' + node.textContent);
  }
  // What replaces them: the verifiable facts.
  assert.match(doc.querySelector('.my-offer-prop').textContent, /37 actes signés via Nota/);
  assert.match(doc.querySelector('.my-offer-contact').textContent, /12 actes signés via Nota/);
});

test('a notary with no acts gets no badge at all — never a zero, never an empty pill', async () => {
  const status = {
    ...openStatus(),
    bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Neuve' },
    notaire: { etude: 'Étude Neuve', courriel: 'n@etude.ca', cnq: false, actes: 0 },
    acte: { complete: false },
  };
  const { doc, Nota } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Neuve' }]) },
    routes: [statusRoute(status), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  assert.equal(doc.querySelector('.rating-badge'), null, 'no rating badge');
  assert.equal(doc.querySelector('.my-offer-acts'), null, 'no acts fact at zero');
  assert.ok(!/0 acte/.test(doc.querySelector('.my-offer-contact').textContent), 'and no « 0 acte » to read as a demerit');
});

test('a CNQ fiche shows as a badge on the proposition and as the full link once retained (ADR 0016)', async () => {
  const FICHE = 'https://www.cnq.org/trouver-un-notaire/fiche/42/';
  const status = {
    ...openStatus(),
    bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Tremblay' },
    notaire: { etude: 'Étude Tremblay', courriel: 'n@etude.ca', cnq: true, actes: 12, lienCNQ: FICHE },
    propositions: [{ id: 'p1', etude: 'Étude Roy', montant: 1200, delta: 200, message: '', status: 'en_attente', createdAt: '2026-08-01', cnq: true, actes: 4 }],
    acte: { complete: false },
  };
  const { doc } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Tremblay' }]) },
    routes: [statusRoute(status), monthRoute()],
  });
  doc.defaultView.Nota.setTab('profil');
  await wait(40);
  // The proposing notary earns the membership badge — never the URL itself.
  assert.ok(doc.querySelector('.cnq-badge'), 'the proposition must carry the CNQ badge');
  // The retained contact block carries the full fiche link, new-tab safe.
  const link = doc.querySelector('a.cnq-link');
  assert.ok(link, 'the retained contact must link the official fiche');
  assert.equal(link.getAttribute('href'), FICHE);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
});

test('no fiche → no CNQ badge and no fiche link', async () => {
  const status = {
    ...openStatus(),
    bid: { ...openStatus().bid, status: 'retenue', etude: 'Étude Neuve' },
    notaire: { etude: 'Étude Neuve', courriel: 'n@etude.ca', rating: null, lienCNQ: null },
    propositions: [{ id: 'p1', etude: 'Étude Roy', montant: 1200, delta: 200, message: '', status: 'en_attente', createdAt: '2026-08-01', rating: null, cnq: false }],
    acte: { complete: false },
  };
  const { doc } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Neuve' }]) },
    routes: [statusRoute(status), monthRoute()],
  });
  doc.defaultView.Nota.setTab('profil');
  await wait(40);
  assert.equal(doc.querySelector('.cnq-badge'), null);
  assert.equal(doc.querySelector('a.cnq-link'), null);
});
