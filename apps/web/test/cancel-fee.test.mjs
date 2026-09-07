/**
 * ADR 0023 / ADR 0041 — the late-cancellation CAP is DISCLOSED, not discovered.
 *
 * Since ADR 0041 nothing is taken at cancellation (art. 13 LPC forbids any
 * amount or percentage fixed in advance): cancelling a retained offer OPENS a
 * window in which the notary may claim, with a written reason, up to a cap.
 *
 *   1. GET /client/bid carries `annulation` (taux, plafond, joursAvant,
 *      delaiJours) when cancelling the retained offer today would open such a
 *      window: the confirm dialog must show the cap, the rate and the delay
 *      BEFORE the client confirms, and say nothing is kept automatically.
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
const FEE = { taux: 0.3, plafond: 840, joursAvant: 2, delaiJours: 7 };
// The indemnity file once the notary decided (ADR 0041).
const PERCUE = { ...FEE, statut: 'percue', frais: 840, justification: 'Journée bloquée, dossier ouvert.', chargeId: 'ch_1', mecanisme: 'capture', percu: true, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } };

// ADR 0035 — `caution` voyage dans la MÊME réponse que la prévision de frais :
// le dialogue sait donc s'il existe une somme réservée avant de promettre d'y
// retenir quoi que ce soit. Par défaut, la caution EST posée (la date est à
// J+2, dans la fenêtre) ; les cas sans caution le disent.
const retainedStatus = (annulation, caution) => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 2800, status: 'retenue', etude: 'Étude Tremblay' },
  notaire: { etude: 'Étude Tremblay', courriel: 'n@etude.ca', rating: null },
  propositions: [], demandes: [],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
  acte: { complete: false }, evaluation: null,
  annulation: annulation || null,
  caution: caution === undefined ? { etat: 'posee', poseeLe: DATE } : caution,
});
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, typeof body === 'function' ? body() : body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });

const RETAINED_SEED = { 'nota.myoffers.v1': JSON.stringify([{ ...OFFER, retained: true, etude: 'Étude Tremblay' }]) };

async function bootRetained({ annulation = null, caution, cancelReply } = {}) {
  // Mutable, like the real API: a cancel that succeeds changes what the next
  // GET /client/bid answers (the cancelled bid, its annulation trace, no more
  // prevision) — cancelReply receives the live status to mutate.
  const status = retainedStatus(annulation, caution);
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

test('a retained offer inside the window discloses the CAP, the rate and the delay in the confirm dialog — and that nothing is kept automatically', async () => {
  const { doc } = await bootRetained({ annulation: FEE });
  const btn = doc.querySelector('.btn-offer-cancel');
  assert.ok(btn, 'cancel button missing on the retained offer');
  btn.click();
  await wait(40); // the dialog re-asks GET /client/bid before it opens (ADR 0023 / 0033)
  assert.equal($(doc, 'cancel-dialog').open, true, 'confirm dialog did not open');

  const fee = $(doc, 'cancel-fee');
  assert.ok(fee, 'the fee note element is missing from the dialog');
  assert.equal(fee.hidden, false, 'the note must be visible when a window would open');
  assert.ok(fee.textContent.includes(D.money(840)), 'the cap must use the project money format: ' + fee.textContent);
  assert.match(fee.textContent, /30 %/, 'the rate must be shown: ' + fee.textContent);
  assert.match(fee.textContent, /jusqu’à/, 'the amount is a CAP, said as such: ' + fee.textContent);
  assert.match(fee.textContent, /dans les 7 jours/, 'the claim delay is disclosed: ' + fee.textContent);
  assert.match(fee.textContent, /sur justification/, 'a claim needs a reason: ' + fee.textContent);
  assert.match(fee.textContent, /Rien n’est retenu automatiquement/, 'art. 13 LPC — nothing fixed in advance: ' + fee.textContent);
  assert.match(fee.textContent, /somme réservée sur votre carte reste en place/, 'the hold stays until the decision: ' + fee.textContent);
  assert.ok(!/retient des frais/.test(fee.textContent), 'no fee is « kept » at cancellation any more: ' + fee.textContent);
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

test('a cancellation that opened a claim window says so — toast and « Prochaine étape » line', async () => {
  const pending = { ...FEE, statut: 'en_attente', frais: 0, percu: false, echeanceISO: addDays(todayISO(), 7), mecanisme: 'capture' };
  const { doc, calls } = await bootRetained({
    annulation: FEE,
    cancelReply: (status) => {
      status.bid = { ...status.bid, status: 'annulee', annulation: pending };
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
  assert.ok(toast.textContent.includes(D.money(840)), 'the cap rides the toast: ' + toast.textContent);
  assert.match(toast.textContent, /jusqu’à/, 'as a cap: ' + toast.textContent);
  assert.match(toast.textContent, /Rien n’est retenu pour l’instant/, toast.textContent);

  const row = doc.querySelector('.my-offer[data-id="o1"]');
  assert.equal(row.dataset.status, 'cancelled');
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.ok(next.textContent.includes(D.money(840)), 'the receipt line names the cap: ' + next.textContent);
  assert.match(next.textContent, /dans les 7 jours/, next.textContent);
});

test('once the notary claimed, the receipt says what was kept, and why', async () => {
  const { doc } = await bootRetained({
    annulation: FEE,
    cancelReply: (status) => {
      status.bid = { ...status.bid, status: 'annulee', annulation: PERCUE };
      status.annulation = null;
      return jsonRes(200, { bid: status.bid });
    },
  });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  $(doc, 'cancel-confirm').click();
  await wait(40);
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.ok(next.textContent.includes(D.money(840)), next.textContent);
  assert.match(next.textContent, /justifiée par le notaire/, 'a kept indemnity is a justified one: ' + next.textContent);
  assert.match(next.textContent, /retenue sur la somme réservée/, next.textContent);
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

test('the indemnity sentences translate fully to English, money, rate and delay converted', () => {
  const pct = '30 %';
  const disclose = 'Annuler maintenant permet au notaire de réclamer, sur justification et dans les 7 jours, ses frais réels et la valeur du travail accompli, jusqu’à ' + D.money(840) + ' (' + pct + ' du montant convenu).';
  assert.equal(
    I18N.tEn(disclose),
    'Cancelling now lets the notary claim, with a written reason and within 7 days, their real costs and the value of work done, up to $840 (30% of the agreed amount).'
  );
  for (const [fr, en] of [
    ['Rien n’est retenu automatiquement.', 'Nothing is kept automatically.'],
    ['La somme réservée sur votre carte reste en place jusqu’à sa décision, puis vous est libérée.', 'The amount held on your card stays in place until their decision, then is released to you.'],
    ['Un montant réclamé serait porté à la carte que vous avez enregistrée.', 'A claimed amount would be charged to the card you registered.'],
    ['Une indemnité réclamée est versée au notaire en dédommagement de la journée réservée, jamais à Nota.', 'A claimed indemnity is paid to the notary as compensation for the reserved day, never to Nota.'],
    ['Votre notaire n’a réclamé aucune indemnité : rien n’est retenu.', 'Your notary claimed no indemnity: nothing is kept.'],
  ]) assert.equal(I18N.tEn(fr), en);
  const pending = 'Votre notaire peut réclamer, sur justification et dans les 7 jours, une indemnité allant jusqu’à ' + D.money(840) + ' (' + pct + ' du montant convenu). Rien n’est retenu pour l’instant.';
  assert.equal(I18N.tEn(pending), 'Your notary may claim, with a written reason and within 7 days, an indemnity of up to $840 (30% of the agreed amount). Nothing is kept for now.');
  const toast = 'Offre annulée. ' + pending;
  assert.match(I18N.tEn(toast), /^Offer cancelled\. Your notary may claim/);
  const kept = 'Une indemnité de ' + D.money(840) + ', justifiée par le notaire, a été retenue sur la somme réservée pour cet acte et lui est versée en dédommagement.';
  assert.equal(I18N.tEn(kept), 'A $840 indemnity, justified by the notary, was kept from the amount held for this act and is paid to them as compensation.');
  const carte = 'Une indemnité de ' + D.money(1250) + ', justifiée par le notaire, a été portée à la carte que vous avez enregistrée et lui est versée en dédommagement.';
  assert.equal(I18N.tEn(carte), 'A $1,250 indemnity, justified by the notary, was charged to the card you registered and is paid to them as compensation.');
  const refuse = 'Votre notaire a réclamé une indemnité de ' + D.money(840) + ', mais votre carte a refusé le prélèvement : rien n’a été débité.';
  assert.equal(I18N.tEn(refuse), 'Your notary claimed a $840 indemnity, but your card declined the charge: nothing was charged.');
  const receipt = 'Vous avez annulé cette offre. ' + refuse + ' Si vous changez d’avis, choisissez une nouvelle date au carnet.';
  assert.equal(
    I18N.tEn(receipt),
    'You cancelled this offer. Your notary claimed a $840 indemnity, but your card declined the charge: nothing was charged. If you change your mind, pick a new date on the carnet.'
  );
  // Les phrases SANS frais ne bougent pas.
  assert.equal(
    I18N.tEn('Vous avez annulé cette offre. Si vous changez d’avis, choisissez une nouvelle date au carnet.'),
    'You cancelled this offer. If you change your mind, pick a new date on the carnet.'
  );
  assert.equal(I18N.tEn('Offre annulée. Elle a été retirée du carnet.'), 'Offer cancelled. It has been removed from the carnet.');
  // French mode is the identity.
  I18N.force('fr');
  assert.equal(I18N.t(disclose), disclose);
});

// --- 6. ADR 0035: le dialogue ne promet jamais une caution qui n'existe pas ---

test('sans caution posée, le dialogue dit une CHARGE possible sur la carte enregistrée — jamais une retenue sur une réservation', async () => {
  const { doc } = await bootRetained({ annulation: FEE, caution: { etat: 'enregistree', poseeLe: DATE } });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  const fee = $(doc, 'cancel-fee');
  assert.equal(fee.hidden, false);
  assert.match(fee.textContent, /porté à la carte que vous avez enregistrée/, fee.textContent);
  assert.ok(!/somme réservée sur votre carte reste en place/.test(fee.textContent), 'rien n’était réservé : ' + fee.textContent);
});

test('le reçu suit le mécanisme que le serveur a réellement employé', async () => {
  const kept = { ...PERCUE, chargeId: 'ch_2', mecanisme: 'hors_session' };
  const { doc } = await bootRetained({
    annulation: FEE,
    caution: { etat: 'enregistree', poseeLe: DATE },
    cancelReply: (status) => {
      status.bid = { ...status.bid, status: 'annulee', annulation: kept };
      status.annulation = null;
      status.caution = { etat: 'enregistree', poseeLe: DATE };
      return jsonRes(200, { bid: status.bid });
    },
  });
  doc.querySelector('.btn-offer-cancel').click();
  await wait(40);
  $(doc, 'cancel-confirm').click();
  await wait(40);
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.match(next.textContent, /portée à la carte que vous avez enregistrée/, next.textContent);
  assert.ok(!/somme réservée/.test(next.textContent), 'aucune caution n’existait : ' + next.textContent);
  assert.match($(doc, 'toast').textContent, /portée à la carte/, $(doc, 'toast').textContent);
});

test('une réclamation REFUSÉE par la carte ne se raconte pas comme une indemnité retenue', async () => {
  const kept = { ...PERCUE, statut: 'refusee', chargeId: null, mecanisme: 'hors_session', percu: false, dedommagement: { notaire: true, verse: false, transferId: null } };
  const { doc } = await bootRetained({
    annulation: FEE,
    caution: { etat: 'enregistree', poseeLe: DATE },
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
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v');
  assert.match(next.textContent, /votre carte a refusé le prélèvement/, next.textContent);
  assert.match(next.textContent, /rien n’a été débité/, next.textContent);
  assert.ok(!/versée en dédommagement/.test(next.textContent), 'rien n’a été versé : ' + next.textContent);
});
