/**
 * Account opt-in during the bid flow (no-emphasis account creation).
 *
 * A visitor can browse the carnet and publish an offer with zero identity —
 * that stays true. But DURING the bid, a client must be able to really create
 * their (passwordless) account, without the form pushing it: a discreet
 * checkbox next to the optional courriel, inside the collapsed
 * « Options et confidentialité » block. Checked + courriel → the same signup
 * path as the auth modal (POST /client/welcome + signed-in state). Unchecked →
 * nothing new: no server call, no account language.
 *
 * Boot harness mirrors client-offers.test.mjs (domain then app inside jsdom,
 * fetch stub keyed by URL, every call logged for assertions).
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
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }; // LOCAL date, like app.js — the UTC slice rolls to tomorrow every evening in UTC-4/-5
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function fire(win, elmt, type) {
  elmt.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));
}

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
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
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

// Routes for a fully-online publish: the month list, the bid POST, the welcome.
const DATE_OFFSET = 5;
function onlineRoutes() {
  return [
    { match: (u, i) => u.includes('/bids?month=') && (!i.method || i.method === 'GET'), reply: () => jsonRes(200, { bids: [] }) },
    {
      match: (u, i) => /\/bids$/.test(u.split('?')[0]) && i.method === 'POST',
      reply: (u, i) => {
        const p = JSON.parse(i.body);
        return jsonRes(201, {
          bid: { id: 'b1', serviceId: p.serviceId, dateISO: p.dateISO, montant: p.montant, tier: 'standard', status: 'ouverte' },
          clientToken: 'tok-b1',
        });
      },
    },
    { match: (u, i) => u.includes('/client/welcome') && i.method === 'POST', reply: () => jsonRes(200, { ok: true }) },
  ];
}

// Drive the offer form to a valid, submittable state (same path as smoke §8).
function fillValidOffer(win, doc, D) {
  const sel = $(doc, 'o-service'); sel.value = 'refinancement'; fire(win, sel, 'change');
  const date = $(doc, 'o-date'); date.value = addDays(todayISO(), DATE_OFFSET); fire(win, date, 'change'); fire(win, date, 'input');
  const amt = $(doc, 'o-amount'); amt.value = '2000'; fire(win, amt, 'input');
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(win, lv, 'input');
  $(doc, 'crit-succession__non').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const selPreteur = $(doc, 'crit-preteur'); selPreteur.value = 'banque_nationale'; fire(win, selPreteur, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(win, pre, 'input'); // REQUIRED sector
  const selDeplacement = $(doc, 'crit-deplacement'); selDeplacement.value = 'client_50'; fire(win, selDeplacement, 'change');
}

const welcomeCalls = (calls) => calls.filter((c) => c.url.includes('/client/welcome'));

// 1. The opt-in exists but carries no emphasis: it lives inside the collapsed
//    « Options et confidentialité » block, right by the optional courriel,
//    unchecked — and inert until a courriel is typed.
test('account opt-in is discreet: in the collapsed options, unchecked, inert without courriel', async () => {
  const { doc } = await boot();
  const box = $(doc, 'o-account');
  assert.ok(box, '#o-account checkbox exists in the bid dialog');
  assert.equal(box.type, 'checkbox');
  assert.equal(box.checked, false, 'never pre-checked');
  assert.equal(box.disabled, true, 'inert until a courriel is typed');

  const details = box.closest('details');
  assert.ok(details, 'the opt-in hides inside the <details> options block');
  assert.equal(details.hasAttribute('open'), false, 'options block stays collapsed by default');

  // It sits in the same private-fields block as the courriel it depends on.
  assert.ok(details.querySelector('#o-courriel'), 'same block as the optional courriel');
  // The three always-visible steps never mention the account.
  const steps = Array.from(doc.querySelectorAll('#offer-form .form-step'));
  assert.ok(steps.every((s) => !s.querySelector('#o-account')), 'no account field in the visible steps');
});

// 2. The checkbox follows the courriel: valid email enables it, clearing the
//    field disables AND unchecks it (no stale opt-in).
test('opt-in enables with a valid courriel and resets when the courriel is cleared', async () => {
  const { win, doc } = await boot();
  const box = $(doc, 'o-account');
  const em = $(doc, 'o-courriel');

  em.value = 'client@exemple.ca'; fire(win, em, 'input');
  assert.equal(box.disabled, false, 'valid courriel enables the opt-in');

  box.checked = true; fire(win, box, 'change');
  em.value = ''; fire(win, em, 'input');
  assert.equal(box.disabled, true, 'cleared courriel disables the opt-in');
  assert.equal(box.checked, false, 'and unchecks it');

  em.value = 'pas-un-courriel'; fire(win, em, 'input');
  assert.equal(box.disabled, true, 'an invalid courriel keeps it inert');
});

// 3. Opted in: publishing the offer really creates the account — the same
//    /client/welcome signup the auth modal performs — and signs the client in.
test('publishing with the opt-in checked creates the account (POST /client/welcome)', async () => {
  const { win, doc, D, Nota, calls } = await boot({ routes: onlineRoutes() });

  fillValidOffer(win, doc, D);
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(win, em, 'input');
  const box = $(doc, 'o-account'); box.checked = true; fire(win, box, 'change');

  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(20);

  const wc = welcomeCalls(calls);
  assert.equal(wc.length, 1, 'exactly one signup call');
  assert.equal(JSON.parse(wc[0].init.body).courriel, 'client@exemple.ca');
  // The device is signed in as a client afterwards (same as the auth modal).
  assert.equal(JSON.parse(win.localStorage.getItem('nota.profile.v1')).courriel, 'client@exemple.ca');
});

// 4. Not opted in: a courriel alone stays what it always was — a private
//    notification channel. No signup call is made.
test('publishing with a courriel but no opt-in never calls /client/welcome', async () => {
  const { win, doc, D, calls } = await boot({ routes: onlineRoutes() });

  fillValidOffer(win, doc, D);
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(win, em, 'input');

  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(20);

  assert.equal(welcomeCalls(calls).length, 0, 'no signup without the explicit opt-in');
  // The offer itself still went through.
  assert.ok(calls.some((c) => /\/bids$/.test(c.url.split('?')[0]) && c.init.method === 'POST'), 'bid was published');
});
