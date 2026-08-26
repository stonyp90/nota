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
