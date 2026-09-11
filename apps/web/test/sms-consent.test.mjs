/**
 * Le texto est un canal de consentement EXPRÈS (ADR 0051) — côté client.
 *
 *   1. Le formulaire de réservation (étape 4) porte UNE case, sous le
 *      téléphone : décochée par défaut, inerte tant qu'aucun numéro composable
 *      n'est saisi (le motif de #o-account, qui suit son courriel), et un
 *      numéro effacé la décoche — une offre ne consent jamais à l'aveugle.
 *   2. Le POST /bids porte `smsConsent` en booléen strict : vrai quand la case
 *      est cochée, faux sinon — jamais absent, parce qu'une offre est le
 *      moment où la personne s'est prononcée.
 *   3. L'écran des préférences de courriel montre l'interrupteur texto avec le
 *      numéro MASQUÉ que le serveur rend, et son enregistrement renvoie
 *      `smsConsent` ; sans numéro connu, l'interrupteur est inerte et le dit.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function boot({ url = '', routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {}, body: init && init.body ? JSON.parse(init.body) : null };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

// Drive the booking sheet to the point where only the identity is missing.
async function openValidOffer(win, doc) {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(20);
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(win, lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const p = $(doc, 'crit-preteur'); p.value = 'banque_nationale'; fire(win, p, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(win, pre, 'input');
  await wait(10);
  return iso;
}
async function fillIdentity(win, doc, telephone) {
  const nom = $(doc, 'o-name'); nom.value = 'Marie Roy'; fire(win, nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'marie@exemple.ca'; fire(win, em, 'input');
  const tel = $(doc, 'o-telephone'); tel.value = telephone; fire(win, tel, 'input');
  await wait(5);
}

// --- 1. La case ---------------------------------------------------------------

test('la case texto vit sous le téléphone, décochée et inerte tant qu’aucun numéro composable n’est saisi', async () => {
  const { win, doc, D } = await boot();
  const box = $(doc, 'o-sms');
  assert.ok(box, '#o-sms exists');
  assert.equal(box.type, 'checkbox');
  assert.equal(box.checked, false, 'never pre-checked — consent is express (LCAP)');
  assert.equal(box.disabled, true, 'inert without a phone');
  const label = doc.querySelector('label[for="o-sms"]');
  assert.ok(label, 'a label');
  assert.match(label.textContent, /texto \(SMS\)/, 'says what it is');
  assert.match(label.textContent, /retient ma demande/, 'names the key moments');
  // Right under the téléphone: the same block, after the phone's own row.
  const telRow = $(doc, 'o-telephone').closest('.form-row');
  const smsRow = box.closest('.form-row');
  assert.ok(telRow && smsRow && telRow.parentElement === smsRow.parentElement, 'same block as the phone');
  assert.ok(telRow.compareDocumentPosition(smsRow) & win.Node.DOCUMENT_POSITION_FOLLOWING, 'after the phone row');

  await openValidOffer(win, doc);
  await fillIdentity(win, doc, '12 34');
  assert.equal(box.disabled, true, 'an undialable number does not arm the box');
  await fillIdentity(win, doc, '(418) 555-0199');
  assert.equal(D.toE164('(418) 555-0199'), '+14185550199', 'precondition: dialable');
  assert.equal(box.disabled, false, 'a dialable number arms it');
  box.checked = true; fire(win, box, 'change');
  const tel = $(doc, 'o-telephone'); tel.value = ''; fire(win, tel, 'input');
  assert.equal(box.disabled, true, 'phone cleared → inert again');
  assert.equal(box.checked, false, 'and unchecked: a bid never consents blindly');
});

// --- 2. Le POST ---------------------------------------------------------------

test('le POST /bids porte smsConsent : vrai quand la case est cochée, faux sinon', async () => {
  const { win, doc, Nota } = await boot();
  await openValidOffer(win, doc);
  await fillIdentity(win, doc, '(418) 555-0199');
  let captured = null;
  Nota.store.createBid = async (payload) => {
    captured = payload;
    return { ok: true, bid: { id: 'x', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } };
  };
  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(20);
  assert.ok(captured, 'createBid was called');
  assert.equal(captured.smsConsent, false, 'unchecked → an explicit false');
  assert.equal(captured.telephone, '(418) 555-0199');

  const { win: w2, doc: d2, Nota: N2 } = await boot();
  await openValidOffer(w2, d2);
  await fillIdentity(w2, d2, '418 555 0199');
  $(d2, 'o-sms').checked = true; fire(w2, $(d2, 'o-sms'), 'change');
  let c2 = null;
  N2.store.createBid = async (payload) => { c2 = payload; return { ok: true, bid: { id: 'y', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } }; };
  fire(w2, $(d2, 'offer-form'), 'submit');
  await wait(20);
  assert.equal(c2 && c2.smsConsent, true, 'checked → true');
});

// --- 3. Les préférences -------------------------------------------------------

function prefsRoute(state) {
  return {
    match: (u) => u.includes('/notification-preferences'),
    reply: (u, init) => {
      if (init && init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.smsConsent !== undefined) state.sms.consent = body.smsConsent;
      }
      return jsonRes(200, { catalog: [{ key: 'offerRetained', labelFr: 'Demande retenue', labelEn: 'Request taken', required: false }], preferences: {}, emailLanguage: 'fr', sms: state.sms });
    },
  };
}

test('l’écran des préférences montre l’interrupteur texto avec le numéro masqué et enregistre smsConsent', async () => {
  const state = { sms: { consent: true, telephone: '••• ••• 0100' } };
  const { win, doc, calls } = await boot({ url: '#email-preferences=tok-abc', routes: [prefsRoute(state)] });
  await wait(40);
  const dialog = $(doc, 'email-preferences-dialog');
  assert.ok(dialog, 'the dialog opened from the hash');
  const sw = $(doc, 'email-preferences-sms');
  assert.ok(sw, 'the SMS switch exists');
  assert.equal(sw.type, 'checkbox');
  assert.equal(sw.checked, true, 'reflects the server consent');
  assert.equal(sw.disabled, false);
  assert.match(dialog.textContent, /texto \(SMS\)/, 'named as a text channel');
  assert.match(dialog.textContent, /0100/, 'the masked number is shown — never the full one');
  sw.checked = false; fire(win, sw, 'change');
  fire(win, dialog.querySelector('form'), 'submit');
  await wait(20);
  const post = calls.find((c) => c.url.includes('/notification-preferences') && c.init.method === 'POST');
  assert.ok(post, 'a POST went out');
  assert.equal(post.body.smsConsent, false, 'the withdrawal travels as an explicit false');
  assert.ok(post.body.preferences, 'the email preferences ride along as before');
});

test('sans numéro connu, l’interrupteur texto est inerte et l’écran dit pourquoi', async () => {
  const state = { sms: { consent: false, telephone: null } };
  const { win, doc, calls } = await boot({ url: '#email-preferences=tok-abc', routes: [prefsRoute(state)] });
  await wait(40);
  const dialog = $(doc, 'email-preferences-dialog');
  const sw = $(doc, 'email-preferences-sms');
  assert.ok(sw, 'the switch exists');
  assert.equal(sw.checked, false);
  assert.equal(sw.disabled, true, 'nothing to text to');
  assert.match(dialog.textContent, /Aucun numéro/, 'explains the inert switch');
  fire(win, dialog.querySelector('form'), 'submit');
  await wait(20);
  const post = calls.find((c) => c.url.includes('/notification-preferences') && c.init.method === 'POST');
  assert.ok(post);
  assert.equal(post.body.smsConsent, undefined, 'an inert switch says nothing — it never sends a consent');
});
