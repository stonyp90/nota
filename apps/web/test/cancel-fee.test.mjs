/**
 * ADR 0023 — the late-cancellation fee is DISCLOSED, not discovered.
 *
 *   1. GET /client/bid carries `annulation` (taux, frais, joursAvant) when
 *      cancelling the retained offer today would keep a fee: the confirm
 *      dialog must show the amount and the percentage BEFORE the client
 *      confirms.
 *   2. `annulation: null` → the fee note stays hidden and the wording is the
 *      existing free-cancellation copy.
 *   3. POST /client/bid/cancel answers with bid.annulation when a fee was
 *      actually kept: the receipt (toast, « Prochaine étape » line) says what
 *      was kept, in the same money format.
 *   4. A settled act answers 409 `acte_complete`: the client is told plainly
 *      that it can no longer be cancelled.
 *   5. Every composed sentence has its English side (i18n rules).
 *
 * Harness mirrors cancel-contact.test.mjs (jsdom + fetch stub).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// Every window this file boots is closed when the file is done: a signed-in
// client on the profil tab runs the 15 s status poll (app.js clientPollStart),
// and a jsdom timer left running keeps the test process alive forever.
const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

// The bilingual layer, evaluated the way i18n.test.mjs does (UMD as script).
const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
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
  return { win, doc: win.document, Nota: win.Nota, calls };
}

const DATE = addDays(todayISO(), 2); // inside the last-minute fee window
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 2800, clientToken: 'tok-o1' };
const FEE = { taux: 0.3, frais: 840, joursAvant: 2 };

const retainedStatus = (annulation) => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 2800, status: 'retenue', etude: 'Étude Tremblay' },
  notaire: { etude: 'Étude Tremblay', courriel: 'n@etude.ca', rating: null },
  propositions: [], demandes: [],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
  acte: { complete: false }, evaluation: null,
  annulation: annulation || null,
});
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, typeof body === 'function' ? body() : body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });

const RETAINED_SEED = { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Tremblay' }]) };

async function bootRetained({ annulation = null, cancelReply } = {}) {
  // Mutable, like the real API: a cancel that succeeds changes what the next
  // GET /client/bid answers (the cancelled bid, its annulation trace, no more
  // prevision) — cancelReply receives the live status to mutate.
  const status = retainedStatus(annulation);
  const ctx = await boot({
    seed: RETAINED_SEED,
    routes: [
      statusRoute(() => status), monthRoute(),
      ...(cancelReply ? [{ match: (u) => u.endsWith('/client/bid/cancel'), reply: () => cancelReply(status) }] : []),
    ],
  });
  ctx.Nota.setTab('profil');
  await wait(40);
  return ctx;
}

// --- 1. The fee is shown BEFORE the client confirms --------------------------

test('a retained offer inside the fee window discloses amount and rate in the confirm dialog', async () => {
  const { doc } = await bootRetained({ annulation: FEE });
  const btn = doc.querySelector('.btn-offer-cancel');
  assert.ok(btn, 'cancel button missing on the retained offer');
  btn.click();
  await wait(40); // the dialog re-asks GET /client/bid before it opens (ADR 0023 / 0033)
  assert.equal($(doc, 'cancel-dialog').open, true, 'confirm dialog did not open');

  const fee = $(doc, 'cancel-fee');
  assert.ok(fee, 'the fee note element is missing from the dialog');
  assert.equal(fee.hidden, false, 'the fee note must be visible when annulation is present');
  assert.ok(fee.textContent.includes(D.money(840)), 'the amount must use the project money format (NBSP Quebec style): ' + fee.textContent);
  assert.match(fee.textContent, /30 %/, 'the percentage must be shown: ' + fee.textContent);
  assert.match(fee.textContent, /caution/, 'the note must say where the fee comes from');
  // The retained wording above the note is untouched.
  assert.match($(doc, 'cancel-text').textContent, /Étude Tremblay/);
});

// --- 2. annulation: null → free wording, no fee note -------------------------

test('annulation null keeps the free-cancellation wording — the fee note stays hidden', async () => {
  const { doc } = await bootRetained({ annulation: null });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40); // the dialog re-asks GET /client/bid before it opens (ADR 0023 / 0033)
  assert.equal($(doc, 'cancel-dialog').open, true);
  const fee = $(doc, 'cancel-fee');
  assert.equal(fee.hidden, true, 'no fee → no note');
  assert.equal(fee.textContent, '', 'a hidden note carries no stale text');
  assert.match($(doc, 'cancel-text').textContent, /avisé par courriel/, 'the existing wording is kept');
});

test('an open (never retained) offer shows no fee note either', async () => {
  const { doc } = await boot({
    seed: { 'nota.myoffers.v1': JSON.stringify([OFFER]) },
    routes: [
      statusRoute({ ...retainedStatus(null), bid: { ...retainedStatus(null).bid, status: 'ouverte', etude: null }, notaire: null }),
      monthRoute(),
    ],
  });
  const Nota = doc.defaultView.Nota;
  Nota.setTab('profil');
  await wait(40);
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  assert.equal($(doc, 'cancel-fee').hidden, true);
  assert.match($(doc, 'cancel-text').textContent, /retirée du carnet/);
});

// --- 3. The receipt says what was kept ---------------------------------------

test('a cancellation that kept a fee says so — toast and « Prochaine étape » line', async () => {
  const kept = { ...FEE, chargeId: 'ch_1' };
  const { doc, calls } = await bootRetained({
    annulation: FEE,
    cancelReply: (status) => {
      status.bid = { ...status.bid, status: 'annulee', annulation: kept };
      status.annulation = null;
      return jsonRes(200, { bid: status.bid });
    },
  });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  $(doc, 'cancel-confirm').click();
  await wait(40);

  const call = calls.find((x) => x.url.endsWith('/client/bid/cancel'));
  assert.ok(call, 'POST /client/bid/cancel was not sent');

  const toast = $(doc, 'toast');
  assert.match(toast.textContent, /Offre annulée/, toast.textContent);
  assert.ok(toast.textContent.includes(D.money(840)), 'the kept amount rides the toast: ' + toast.textContent);
  assert.match(toast.textContent, /30 %/, 'the kept rate rides the toast: ' + toast.textContent);

  const row = doc.querySelector('.my-offer[data-id="o1"]');
  assert.equal(row.dataset.status, 'cancelled');
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.ok(next.textContent.includes(D.money(840)), 'the receipt line mentions what was kept: ' + next.textContent);
  assert.match(next.textContent, /30 %/, next.textContent);
});

test('a free cancellation keeps the existing receipt — no fee mentioned anywhere', async () => {
  const { doc } = await bootRetained({
    annulation: null,
    cancelReply: (status) => {
      status.bid = { ...status.bid, status: 'annulee', annulation: null };
      return jsonRes(200, { bid: status.bid });
    },
  });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  $(doc, 'cancel-confirm').click();
  await wait(40);
  assert.equal($(doc, 'toast').textContent, 'Offre annulée. Elle a été retirée du carnet.');
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.ok(!/frais/i.test(next.textContent), 'no fee wording on a free cancellation: ' + next.textContent);
});

// --- 4. 409 acte_complete ----------------------------------------------------

test('a settled act answers 409 acte_complete — the client is told it can no longer be cancelled', async () => {
  const { doc, calls } = await bootRetained({
    annulation: null,
    cancelReply: () => jsonRes(409, { errors: [{ code: 'acte_complete', message: 'Cet acte est signé et réglé — il ne peut plus être annulé.' }] }),
  });
  doc.querySelector('.btn-offer-cancel').click();
  calls.length = 0;
  $(doc, 'cancel-confirm').click();
  await wait(40);
  assert.equal($(doc, 'cancel-dialog').open, false, 'the dialog closes — there is nothing left to confirm');
  assert.match($(doc, 'toast').textContent, /ne peut plus être annulé/, $(doc, 'toast').textContent);
  const row = doc.querySelector('.my-offer[data-id="o1"]');
  assert.notEqual(row.dataset.status, 'cancelled', 'a settled act is never shown as cancelled');
});

// --- 5. Bilingual: every composed sentence has its English side --------------

test('the fee sentences translate fully to English, money and rate converted', () => {
  const pct = '30 %';
  // The ADR 0033 wording — the fee goes to the notary (i18n-rules-live.test.mjs
  // pins these to what app.js composes).
  const disclose = 'Annuler maintenant retient des frais de ' + D.money(840) + ' (' + pct + ' du montant convenu) sur votre caution. Ils sont versés au notaire en dédommagement de la journée réservée. Le reste vous est libéré immédiatement.';
  assert.equal(
    I18N.tEn(disclose),
    'Cancelling now keeps a fee of $840 (30% of the agreed amount) from your deposit. It is paid to the notary as compensation for the day they reserved. The rest is released to you immediately.'
  );
  const toast = 'Offre annulée. Des frais de ' + D.money(840) + ' (' + pct + ') ont été retenus sur votre caution et versés au notaire en dédommagement.';
  assert.equal(I18N.tEn(toast), 'Offer cancelled. A fee of $840 (30%) was kept from your deposit and paid to the notary as compensation.');
  const notif = 'Des frais de ' + D.money(1250) + ' (' + pct + ') ont été retenus sur votre caution et versés au notaire en dédommagement.';
  assert.equal(I18N.tEn(notif), 'A fee of $1,250 (30%) was kept from your deposit and paid to the notary as compensation.');
  const receipt = 'Vous avez annulé cette offre. Des frais de ' + D.money(840) + ' (' + pct + ') ont été retenus sur votre caution et versés au notaire en dédommagement. Si vous changez d’avis, choisissez une nouvelle date au carnet.';
  assert.equal(
    I18N.tEn(receipt),
    'You cancelled this offer. A fee of $840 (30%) was kept from your deposit and paid to the notary as compensation. If you change your mind, pick a new date on the carnet.'
  );
  assert.equal(
    I18N.tEn('Cet acte est signé et réglé — il ne peut plus être annulé.'),
    'This act is signed and settled — it can no longer be cancelled.'
  );
  // French mode is the identity.
  I18N.force('fr');
  assert.equal(I18N.t(disclose), disclose);
});
