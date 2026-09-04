/**
 * ADR 0033 — the mise en relation is complete, and the conversation is the
 * channel. The CLIENT side:
 *
 *   1. Booking identity: the name is ALWAYS collected (anonymity governs the
 *      public carnet only), the courriel is required (it is how the client
 *      learns a notary retained them), the téléphone sits next to them and is
 *      validated inline by the domain. The payload always carries `nom`.
 *   2. The retained band leads with a « Votre notaire » contact card — name,
 *      étude, tel: link, address with a maps link, mailto, the Chambre fiche,
 *      the acts count — then the conversation.
 *   3. Shared chat helpers: whenLabel (day + time), a thread that scrolls to
 *      its end, a composer (Enter sends, Shift+Enter breaks, counter, busy,
 *      inline error).
 *   4. Unread on the client side (nota.seen.v1): a badge on the offer row,
 *      a clickable bell entry that opens the band and marks it seen.
 *   5. The thread polls while the profil tab is visible, and pauses when a
 *      field has focus.
 *   6. The cancel dialog re-fetches the fee forecast before it opens and says
 *      the fee compensates the notary; « Prochaine étape » says the notary
 *      may withdraw; the conditions pane states the barème.
 *   7. The device-independent deep link #offre=…&d=…&cle=… lands on the band.
 *
 * Harness mirrors client-offers.test.mjs (jsdom + fetch stub keyed by URL).
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
const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});

async function boot({ url = '', seed = {}, routes = [], onWindow } = {}) {
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
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
      if (onWindow) onWindow(window);
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls, dom };
}

const activePane = (doc) => {
  const on = Array.from(doc.querySelectorAll('.tab-pane')).filter((p) => !p.hidden);
  assert.equal(on.length, 1, 'exactly one visible pane');
  return on[0].id;
};

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 2400, clientToken: 'tok-o1' };
const NOTAIRE = {
  nom: 'Me Anne Roy', etude: 'Étude Roy', telephone: '418 555 0100',
  adresse: '12, rue Saint-Jean, Québec (QC) G1R 1N4', courriel: 'anne@etuderoy.ca',
  lienCNQ: 'https://www.cnq.org/trouver-un-notaire/fiche/42/', actes: 12, cnq: true,
};
const MSGS = [
  // A past day: a stamp from today renders as the time alone (F7 P0-2).
  { id: 'm1', de: 'notaire', texte: 'Bonjour — avez-vous les instructions ?', createdAt: '2026-08-03T14:32:00.000Z' },
  { id: 'm2', de: 'notaire', texte: 'Je peux aussi passer le matin.', createdAt: '2026-08-03T15:05:00.000Z' },
];
const retainedStatus = (over = {}) => Object.assign({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 2400, status: 'retenue', etude: 'Étude Roy' },
  notaire: NOTAIRE, propositions: [], demandes: [], readiness: null,
  messages: MSGS.slice(), documents: [], acte: { complete: false }, evaluation: null, annulation: null,
}, over);
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, typeof body === 'function' ? body() : body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });
const RETAINED_SEED = { 'nota.myoffers.v1': [{ ...OFFER, retained: true, etude: 'Étude Roy' }] };

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

// ---------------------------------------------------------------------------
// 1. Booking identity
// ---------------------------------------------------------------------------

test('the name is always visible in the open flow — anonymity governs the public carnet only', async () => {
  const { doc } = await boot();
  const name = $(doc, 'o-name');
  assert.ok(name, '#o-name exists');
  assert.equal(name.closest('details'), null, 'the name is not folded in the options');
  assert.equal($(doc, 'name-row').hidden, false, 'visible while the offer is anonymous (default)');
  assert.equal($(doc, 'o-anon').checked, true, 'precondition: anonymous by default');
  const label = doc.querySelector('label[for="o-name"]');
  assert.match(label.textContent, /transmis seulement au notaire qui retient votre demande/);
  assert.equal(name.required, true);
  // The switch says what it governs: the PUBLIC display, nothing else.
  assert.match($(doc, 'anon-help').textContent, /Votre nom reste transmis au notaire/);
  // Courriel and téléphone stand right beside the name, in the open flow.
  const wrap = name.closest('.book-identity');
  assert.ok(wrap, 'the three identity fields share one block');
  assert.ok(wrap.querySelector('#o-courriel'), 'courriel in the same block');
  assert.ok(wrap.querySelector('#o-telephone'), 'téléphone in the same block');
  assert.equal($(doc, 'o-courriel').required, true, 'the courriel is required');
  assert.match(doc.querySelector('label[for="o-courriel"]').textContent, /prévenir dès qu’un notaire retient/);
  assert.equal($(doc, 'o-telephone').required, false, 'the téléphone is recommended, not required');
  // The account opt-in stays discreet, in the folded options.
  assert.ok($(doc, 'o-account').closest('details'), 'the opt-in keeps its fold');
});

test('the submit gate names the missing name and courriel, and an invalid téléphone blocks with the domain’s message', async () => {
  const { win, doc, D } = await boot();
  await openValidOffer(win, doc);
  const submit = $(doc, 'offer-submit');
  const hint = $(doc, 'offer-hint');
  assert.equal(submit.disabled, true, 'blocked without identity');
  assert.match(hint.textContent, /Votre nom/);
  assert.match(hint.textContent, /Votre courriel/);

  const nom = $(doc, 'o-name'); nom.value = 'Marie Roy'; fire(win, nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'marie@exemple.ca'; fire(win, em, 'input');
  assert.equal(submit.disabled, false, 'name + courriel lift the gate');
  assert.equal(hint.hidden, true);

  // A malformed number blocks, with the domain's own words, right under the field.
  const tel = $(doc, 'o-telephone'); tel.value = '12 34'; fire(win, tel, 'input');
  assert.equal(submit.disabled, true, 'an invalid téléphone blocks');
  const v = D.validateTelephone('12 34');
  assert.equal(v.ok, false);
  assert.equal($(doc, 'o-telephone-preview').textContent, v.error.message);
  assert.match(hint.textContent, /Votre téléphone/);
  tel.value = '(418) 555-0199'; fire(win, tel, 'input');
  assert.equal(submit.disabled, false, 'a dialable number passes');
  assert.equal($(doc, 'o-telephone-preview').dataset.state, 'ok');
  tel.value = ''; fire(win, tel, 'input');
  assert.equal(submit.disabled, false, 'empty is fine — recommended, not required');
});

test('the payload always carries `nom`, even on an anonymous offer', async () => {
  const { win, doc, Nota } = await boot();
  await openValidOffer(win, doc);
  const nom = $(doc, 'o-name'); nom.value = 'Marie Roy'; fire(win, nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'marie@exemple.ca'; fire(win, em, 'input');
  const tel = $(doc, 'o-telephone'); tel.value = '(418) 555-0199'; fire(win, tel, 'input');
  let captured = null;
  Nota.store.createBid = async (payload) => {
    captured = payload;
    return { ok: true, bid: { id: 'x', serviceId: payload.serviceId, dateISO: payload.dateISO, montant: payload.montant, tier: 'standard' } };
  };
  assert.equal($(doc, 'o-anon').checked, true, 'precondition: anonymous');
  fire(win, $(doc, 'offer-form'), 'submit');
  await wait(20);
  assert.ok(captured, 'createBid was called');
  assert.equal(captured.anonyme, true);
  assert.equal(captured.nom, 'Marie Roy', 'the name travels privately even when the carnet stays anonymous');
  assert.equal(captured.courriel, 'marie@exemple.ca');
  assert.equal(captured.telephone, '(418) 555-0199');
  // Remembered for next time, and the profile card carries the same three.
  const prof = JSON.parse(win.localStorage.getItem('nota.profile.v1'));
  assert.equal(prof.nom, 'Marie Roy');
  assert.equal(prof.telephone, '(418) 555-0199');
});

test('the coordinates card prefills the three identity fields of the next booking', async () => {
  const { doc, Nota } = await boot({
    seed: { 'nota.profile.v1': { nom: 'Marie Roy', courriel: 'marie@exemple.ca', telephone: '418 555 0199', prefixe: 'G1R' } },
  });
  Nota.setTab('profil');
  assert.equal($(doc, 'p-nom').value, 'Marie Roy');
  assert.match(doc.querySelector('label[for="p-nom"]').textContent, /notaire/, 'the label says whom the name reaches');
  Nota.setTab('carnet');
  doc.querySelector('.cal-cell[data-date="' + addDays(todayISO(), 6) + '"]').click();
  await wait(40);
  assert.equal($(doc, 'o-name').value, 'Marie Roy');
  assert.equal($(doc, 'o-courriel').value, 'marie@exemple.ca');
  assert.equal($(doc, 'o-telephone').value, '418 555 0199');
});

// ---------------------------------------------------------------------------
// 2. The retained band: « Votre notaire » first
// ---------------------------------------------------------------------------

test('a retained offer leads with the notary’s contact card — name, étude, tel:, address map link, mailto, fiche, acts', async () => {
  const { doc, Nota, D } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const cell = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-detail-cell');
  const card = cell.querySelector('.my-offer-contact');
  assert.ok(card, 'the contact card renders');
  assert.equal(cell.firstElementChild, card, 'the card comes FIRST in the band');
  assert.match(card.querySelector('.my-offer-contact-h').textContent, /Votre notaire/);
  assert.match(card.textContent, /Me Anne Roy/);
  assert.match(card.textContent, /Étude Roy/);
  const tel = card.querySelector('a.my-offer-contact-tel');
  assert.ok(tel, 'a tel: link');
  assert.equal(tel.getAttribute('href'), D.telHref('418 555 0100'));
  assert.match(tel.textContent, /418 555 0100/);
  assert.ok(tel.querySelector('svg'), 'the phone icon rides the link');
  const addr = card.querySelector('a.my-offer-contact-addr');
  assert.ok(addr, 'the address is a link');
  assert.equal(addr.getAttribute('href'), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(NOTAIRE.adresse));
  assert.equal(addr.getAttribute('target'), '_blank');
  assert.equal(addr.getAttribute('rel'), 'noopener');
  assert.match(addr.textContent, /rue Saint-Jean/);
  const mail = card.querySelector('a.my-offer-contact-mail');
  assert.equal(mail.getAttribute('href'), 'mailto:anne@etuderoy.ca');
  const fiche = card.querySelector('a.cnq-link');
  assert.equal(fiche.getAttribute('href'), NOTAIRE.lienCNQ);
  assert.match(fiche.textContent, /Vérifier sa fiche à la Chambre/);
  assert.equal(card.querySelector('.my-offer-acts').textContent, '12 actes signés via Nota');
  // ADR 0030: facts only — never a rating on a named notary.
  assert.ok(!/★|☆|\bavis\b|\bcote\b/i.test(card.textContent), card.textContent);
  // Then the conversation.
  const chat = cell.querySelector('.my-offer-chat');
  assert.ok(chat, 'the conversation follows');
  assert.ok(card.compareDocumentPosition(chat) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'card before chat');
});

test('a notary without a phone or address still gets a card — only the missing rows are absent', async () => {
  const st = retainedStatus({ notaire: { etude: 'Étude Neuve', courriel: 'n@etude.ca', actes: 0 } });
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(st), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const card = doc.querySelector('.my-offer-contact');
  assert.ok(card);
  assert.match(card.textContent, /Étude Neuve/);
  assert.equal(card.querySelector('.my-offer-contact-tel'), null);
  assert.equal(card.querySelector('.my-offer-contact-addr'), null);
  assert.ok(card.querySelector('.my-offer-contact-mail'));
});

// ---------------------------------------------------------------------------
// 3. Shared chat helpers
// ---------------------------------------------------------------------------

test('whenLabel says the day AND the time; the thread stamps each bubble with it', async () => {
  const { win, doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  // A past day (today reads as the time alone — see the F7 block below).
  const iso = '2026-08-03T14:32:00';
  const label = Nota.chat.whenLabel(iso);
  const d = new win.Date(iso);
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  assert.match(label, new RegExp('· ' + hh + ':' + mm + '$'), label);
  assert.match(label, /août/, 'the day part is the local day: ' + label);
  assert.equal(Nota.chat.whenLabel('2026-08-03'), Nota.chat.whenLabel('2026-08-03').replace(/ · .*$/, ''), 'a date-only stamp has no time');
  Nota.setTab('profil');
  await wait(40);
  const whens = doc.querySelectorAll('.my-offer-chat .chat-when');
  assert.equal(whens.length, 2);
  assert.match(whens[0].textContent, /·\s*\d{2}:\d{2}/);
});

test('the composer: Enter sends, Shift+Enter does not, the counter shows from 400, busy then cleared', async () => {
  let resolveSend;
  const { win, doc, Nota, calls } = await boot({
    seed: RETAINED_SEED,
    routes: [
      statusRoute(retainedStatus()), monthRoute(),
      { match: (u) => u.endsWith('/client/bid/message'), reply: (u, init) => new Promise((res) => { resolveSend = () => res(jsonRes(200, { message: { id: 'm9', de: 'client', texte: JSON.parse(init.body).texte, createdAt: '2026-09-03T16:00:00.000Z' } })); }) },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  const chat = doc.querySelector('.my-offer-chat');
  const input = chat.querySelector('.chat-input');
  const button = chat.querySelector('.client-chat-send');
  assert.ok(input && button);
  assert.equal(input.rows, 1, 'starts one line — grows with the text');
  // Counter: hidden below 400, visible from 400.
  input.value = 'a'.repeat(399); fire(win, input, 'input');
  assert.equal(chat.querySelector('.chat-count').hidden, true);
  input.value = 'a'.repeat(400); fire(win, input, 'input');
  const count = chat.querySelector('.chat-count');
  assert.equal(count.hidden, false);
  assert.match(count.textContent, /^400\s*\/\s*500$/);
  // Shift+Enter is a line break, not a send.
  input.value = 'Ligne 1';
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  await wait(5);
  assert.ok(!calls.some((c) => c.url.endsWith('/client/bid/message')), 'no send on Shift+Enter');
  // Enter sends — busy state while the request is in flight.
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(5);
  const post = calls.find((c) => c.url.endsWith('/client/bid/message'));
  assert.ok(post, 'Enter sends');
  assert.equal(JSON.parse(post.init.body).texte, 'Ligne 1');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Envoi…');
  resolveSend();
  await wait(20);
  const bubbles = doc.querySelectorAll('.my-offer-chat .chat-bubble');
  assert.ok([...bubbles].some((b) => /Ligne 1/.test(b.textContent)), 'the sent message appears');
  const input2 = doc.querySelector('.my-offer-chat .chat-input');
  assert.equal(input2.value, '', 'the composer is cleared');
  assert.equal(doc.querySelector('.my-offer-chat .client-chat-send').disabled, false);
});

test('a refused send reports inline, keeps the draft, and an empty draft never leaves', async () => {
  const { win, doc, Nota, calls } = await boot({
    seed: RETAINED_SEED,
    routes: [
      statusRoute(retainedStatus()), monthRoute(),
      { match: (u) => u.endsWith('/client/bid/message'), reply: () => jsonRes(409, { errors: [{ code: 'fil_ferme', message: 'La conversation est fermée.' }] }) },
    ],
  });
  Nota.setTab('profil');
  await wait(40);
  const chat = doc.querySelector('.my-offer-chat');
  chat.querySelector('.client-chat-send').click();
  await wait(5);
  assert.ok(!calls.some((c) => c.url.endsWith('/client/bid/message')), 'nothing sent for an empty draft');
  const err = chat.querySelector('.chat-error');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /Écrivez un message/);
  const input = chat.querySelector('.chat-input');
  input.value = 'Allo'; fire(win, input, 'input');
  assert.equal(err.hidden, true, 'typing clears the error');
  chat.querySelector('.client-chat-send').click();
  await wait(20);
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /La conversation est fermée/);
  assert.equal(input.value, 'Allo', 'the draft survives a refusal');
});

// ---------------------------------------------------------------------------
// 4. Unread
// ---------------------------------------------------------------------------

test('unread notary messages badge the offer row; focusing the composer marks them seen (nota.seen.v1)', async () => {
  const { win, doc, Nota } = await boot({
    seed: { ...RETAINED_SEED, 'nota.profile.v1': { courriel: 'client@exemple.ca' } },
    routes: [statusRoute(retainedStatus()), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  const badge = doc.querySelector('#my-offers-live tr.my-offer[data-id="o1"] .my-offer-unread');
  assert.ok(badge, 'the row carries an unread badge');
  assert.equal(badge.hidden, false);
  assert.match(badge.textContent, /2 nouveaux messages/);
  // The account menu's « Mon profil » door counts them too.
  Nota.account.render();
  const door = [...doc.querySelectorAll('#acct-actions .acct-action')].find((b) => /Mon profil/.test(b.textContent));
  assert.ok(door.querySelector('.acct-badge'), 'the profile door carries the count');
  assert.equal(door.querySelector('.acct-badge').textContent, '2');

  doc.querySelector('.my-offer-chat .chat-input').dispatchEvent(new win.FocusEvent('focus'));
  await wait(5);
  const seen = JSON.parse(win.localStorage.getItem('nota.seen.v1'));
  assert.equal(seen.o1, MSGS[1].createdAt, 'seen = the newest notary message');
  assert.equal(doc.querySelector('#my-offers-live tr.my-offer[data-id="o1"] .my-offer-unread').hidden, true, 'badge gone');
  Nota.account.render();
  const door2 = [...doc.querySelectorAll('#acct-actions .acct-action')].find((b) => /Mon profil/.test(b.textContent));
  assert.equal(door2.querySelector('.acct-badge'), null);
});

test('the bell entry for a notary message carries the offer id, opens the band and marks it seen', async () => {
  const { win, doc, Nota } = await boot({
    seed: { ...RETAINED_SEED, 'nota.profile.v1': { courriel: 'client@exemple.ca' } },
    routes: [statusRoute(retainedStatus()), monthRoute()],
  });
  const notifs = JSON.parse(win.localStorage.getItem('nota.notifs.v1'));
  const n = notifs.find((x) => x.key === 'message:m1');
  assert.ok(n, 'the message rang');
  assert.equal(n.offerId, 'o1', 'the entry knows its offer');
  $(doc, 'notif-bell').click();
  const item = [...doc.querySelectorAll('#notif-list .notif-item')].find((x) => /Votre notaire vous a écrit/.test(x.textContent));
  assert.ok(item, 'the entry renders');
  assert.equal(item.getAttribute('role'), 'button', 'and is clickable');
  item.click();
  await wait(20);
  assert.equal(activePane(doc), 'pane-profil');
  const band = doc.querySelector('.my-offer-detail[data-for="o1"]');
  assert.ok(band.classList.contains('is-flash'), 'the band is highlighted');
  const seen = JSON.parse(win.localStorage.getItem('nota.seen.v1'));
  assert.equal(seen.o1, MSGS[1].createdAt);
  Nota.setTab('carnet');
});

// ---------------------------------------------------------------------------
// 5. Polling
// ---------------------------------------------------------------------------

test('the thread polls while the profil tab is shown, pauses on a focused field, stops on another tab', async () => {
  const { win, doc, Nota, calls } = await boot({
    seed: RETAINED_SEED,
    routes: [statusRoute(retainedStatus()), monthRoute()],
    // A visible, ACTIVE window — jsdom never has focus, which is exactly why
    // no other test in this suite ends up holding a live timer.
    onWindow: (w) => { w.__NOTA_CLIENT_POLL_MS__ = 25; w.document.hasFocus = () => true; },
  });
  Nota.setTab('carnet');
  await wait(80);
  const before = calls.filter((c) => c.url.includes('/client/bid?')).length;
  await wait(80);
  assert.equal(calls.filter((c) => c.url.includes('/client/bid?')).length, before, 'no polling off the profil tab');
  Nota.setTab('profil');
  await wait(120);
  const during = calls.filter((c) => c.url.includes('/client/bid?')).length;
  assert.ok(during >= before + 3, 'polls every tick on the profil tab: ' + (during - before));
  // A focused composer pauses the poll — a repaint must never eat a draft.
  const input = doc.querySelector('.my-offer-chat .chat-input');
  input.focus();
  assert.equal(doc.activeElement, input, 'precondition: the field has focus');
  const paused = calls.filter((c) => c.url.includes('/client/bid?')).length;
  await wait(100);
  assert.equal(calls.filter((c) => c.url.includes('/client/bid?')).length, paused, 'paused while a field has focus');
  input.blur();
  Nota.setTab('carnet');
  await wait(30);
  const stopped = calls.filter((c) => c.url.includes('/client/bid?')).length;
  await wait(100);
  assert.equal(calls.filter((c) => c.url.includes('/client/bid?')).length, stopped, 'stopped after leaving the tab');
  win.close();
});

test('a poll that brings a new message repaints the thread without touching a draft', async () => {
  const status = retainedStatus();
  const { win, doc, Nota } = await boot({
    seed: RETAINED_SEED,
    routes: [statusRoute(() => status), monthRoute()],
    onWindow: (w) => { w.__NOTA_CLIENT_POLL_MS__ = 25; w.document.hasFocus = () => true; },
  });
  Nota.setTab('profil');
  await wait(40);
  const input = doc.querySelector('.my-offer-chat .chat-input');
  input.value = 'Brouillon en cours'; fire(win, input, 'input');
  input.blur();
  status.messages = MSGS.concat([{ id: 'm3', de: 'notaire', texte: 'Nouvelle question.', createdAt: '2026-09-03T16:10:00.000Z' }]);
  await wait(120);
  const bubbles = doc.querySelectorAll('.my-offer-chat .chat-bubble');
  assert.ok([...bubbles].some((b) => /Nouvelle question/.test(b.textContent)), 'the new message landed');
  assert.equal(doc.querySelector('.my-offer-chat .chat-input').value, 'Brouillon en cours', 'the draft survived the repaint');
  Nota.setTab('carnet');
  win.close();
});

// ---------------------------------------------------------------------------
// 6. Cancellation disclosure, next step, conditions
// ---------------------------------------------------------------------------

test('the cancel dialog re-fetches the forecast before it opens and says the fee compensates the notary', async () => {
  let fee = null;
  const { doc, Nota, calls, D } = await boot({
    seed: RETAINED_SEED,
    routes: [statusRoute(() => retainedStatus({ annulation: fee })), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  // The cache says « free »; the server now says 10 %. The dialog must show the server.
  fee = { taux: 0.1, frais: 240, joursAvant: 6 };
  calls.length = 0;
  doc.querySelector('.btn-offer-cancel').click();
  await wait(30);
  assert.ok(calls.some((c) => c.url.includes('/client/bid?')), 'GET /client/bid before showModal');
  assert.equal($(doc, 'cancel-dialog').open, true);
  const note = $(doc, 'cancel-fee');
  assert.equal(note.hidden, false);
  assert.ok(note.textContent.includes(D.money(240)), note.textContent);
  assert.match(note.textContent, /10 %/);
  assert.match(note.textContent, /versés au notaire/, 'says where the fee goes: ' + note.textContent);
  assert.match(note.textContent, /journée réservée/, note.textContent);
  assert.match($(doc, 'cancel-text').textContent, /Me Anne Roy|Étude Roy/);
});

test('« Prochaine étape » on a retained offer says the notary may withdraw and what happens then', async () => {
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const next = doc.querySelector('.my-offer-detail[data-for="o1"] .my-offer-next-v').textContent;
  assert.match(next, /se désister/, next);
  assert.match(next, /carnet/, next);
  assert.match(next, /prévenu/, next);
  assert.ok(I18N.covered(next), 'the sentence has its English side');
});

test('the conditions pane states the barème, who receives the fee, and the notary’s right to withdraw', async () => {
  const { doc } = await boot();
  const pane = $(doc, 'pane-conditions').textContent;
  assert.ok(!/retirer une offre tant qu’aucun notaire ne l’a retenue\.$/m.test(pane), 'the old « free withdrawal » line is gone');
  const li = $(doc, 'tos-annulation');
  assert.ok(li, 'a dedicated cancellation clause');
  const t = li.textContent;
  assert.match(t, /30 %/); assert.match(t, /10 %/); assert.match(t, /15 jours/);
  assert.match(t, /dédommagement/);
  assert.match(t, /avant toute confirmation|avant de confirmer/);
  assert.match(t, /se désister/);
  assert.match(t, /barème/);
});

// ---------------------------------------------------------------------------
// 7. Deep link
// ---------------------------------------------------------------------------

test('#offre=…&d=…&cle=… lands on Mes offres, stores the token, fills the entry from the API and flashes the band', async () => {
  const st = retainedStatus({ bid: { id: 'o9', serviceId: 'refinancement', dateISO: DATE, montant: 2600, status: 'retenue', etude: 'Étude Roy' } });
  const { win, doc, calls } = await boot({
    url: '#offre=o9&d=' + DATE + '&cle=tok-9',
    routes: [statusRoute(st), monthRoute()],
  });
  await wait(40);
  assert.equal(activePane(doc), 'pane-profil');
  assert.ok(!/cle=/.test(win.location.hash), 'the token is stripped from the URL: ' + win.location.hash);
  const mine = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'));
  const e = mine.find((o) => o.id === 'o9');
  assert.ok(e, 'the entry is upserted');
  assert.equal(e.clientToken, 'tok-9');
  assert.equal(e.dateISO, DATE);
  assert.equal(e.serviceId, 'refinancement', 'filled from GET /client/bid');
  assert.equal(e.montant, 2600);
  assert.equal(e.retained, true);
  const c = calls.find((x) => x.url.includes('/client/bid?') && x.url.includes('id=o9'));
  assert.equal(c.headers.Authorization || c.headers.authorization, 'Bearer tok-9');
  const band = doc.querySelector('.my-offer-detail[data-for="o9"]');
  assert.ok(band, 'the band is on screen');
  assert.ok(band.classList.contains('is-flash'), 'and highlighted');
  assert.ok(band.querySelector('.my-offer-contact'), 'with the notary card');
  assert.equal($(doc, 'intro-gate').hidden, true, 'no intro film over a deep link');
});

test('a second visit through the same link refreshes the token on the existing entry, never duplicates it', async () => {
  const { win } = await boot({
    url: '#offre=o1&d=' + DATE + '&cle=tok-new',
    seed: RETAINED_SEED,
    routes: [statusRoute(retainedStatus()), monthRoute()],
  });
  await wait(40);
  const mine = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'));
  assert.equal(mine.filter((o) => o.id === 'o1').length, 1);
  assert.equal(mine.find((o) => o.id === 'o1').clientToken, 'tok-new');
  assert.equal(mine.find((o) => o.id === 'o1').montant, 2400, 'what the device knew is kept');
});

test('the legacy #t=profil still opens Mes offres', async () => {
  const { doc } = await boot({ url: '#t=profil', seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  assert.equal(activePane(doc), 'pane-profil');
});

// ---------------------------------------------------------------------------
// Styles: tokens only, square register, no dead selectors
// ---------------------------------------------------------------------------

test('the new client classes are styled with tokens and exist in the stylesheet', () => {
  for (const sel of ['.book-identity', '.my-offer-contact-h', '.my-offer-contact-tel', '.my-offer-contact-addr', '.chat-count', '.chat-error', '.my-offer-unread', '.acct-badge', '.my-offer-detail.is-flash']) {
    assert.ok(CSS_SRC.includes(sel), 'styled: ' + sel);
  }
  const block = CSS_SRC.slice(CSS_SRC.indexOf('/* --- Retained-act conversation'), CSS_SRC.indexOf('/* --- Withdrawal (désistement)'));
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(block), 'no literal colour in the chat block');
  assert.ok(!/border-radius:\s*(50%|999px|9999px)/.test(block), 'no pill in the chat block');
});

// ---------------------------------------------------------------------------
// F7 — audit fixes on the client side (2026-09-03)
// ---------------------------------------------------------------------------

// P0-2 — the DAY of a stamp follows the same local clock as its time: an
// evening message whose UTC date is already tomorrow reads as the local day;
// a stamp from today reads as the time alone (like the support widget).
test('whenLabel: the day follows the local clock, and today is the time alone', async () => {
  const { win, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  const now = new win.Date();
  const today = Nota.chat.whenLabel(now.toISOString());
  assert.match(today, /^\d{2}:\d{2}$/, 'today → time only: ' + today);
  const y = new win.Date(now.getTime() - 864e5); y.setHours(23, 30, 0, 0);
  const label = Nota.chat.whenLabel(y.toISOString());
  assert.match(label, /· 23:30$/, label);
  assert.ok(new RegExp('(^|\\D)' + y.getDate() + '(\\D|$)').test(label), 'the local day number, not the UTC one: ' + label + ' (expected day ' + y.getDate() + ')');
  const dateOnly = Nota.chat.whenLabel('2026-08-03');
  assert.ok(!/\d{2}:\d{2}/.test(dateOnly), 'a date-only stamp carries no time: ' + dateOnly);
  assert.ok(!APP_SRC.includes('function ncWhenLabel'), 'the unreachable notary-side fallback is gone');
  assert.equal(Nota.notary.whenLabel, Nota.chat.whenLabel, 'one whenLabel for both sides');
});

// P1-5 — an Enter that ends an IME composition is not a send.
test('Enter during IME composition never sends (isComposing)', async () => {
  const { win, doc, Nota, calls } = await boot({
    seed: RETAINED_SEED,
    routes: [statusRoute(retainedStatus()), monthRoute(),
      { match: (u) => u.endsWith('/client/bid/message'), reply: () => jsonRes(200, { message: { id: 'm9', de: 'client', texte: 'x', createdAt: '2026-08-03T16:00:00.000Z' } }) }],
  });
  Nota.setTab('profil');
  await wait(40);
  const input = doc.querySelector('.my-offer-chat .chat-input');
  input.value = '日本語'; fire(win, input, 'input');
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  await wait(10);
  assert.ok(!calls.some((c) => c.url.endsWith('/client/bid/message')), 'a composition Enter is not a send');
});

// P1-6 — the account door badge is created when unread arrives after the menu
// was painted, and hidden (not destroyed) at zero.
test('the account door badge appears when unread messages arrive after the menu was painted', async () => {
  let msgs = [];
  const { doc, Nota } = await boot({
    seed: { ...RETAINED_SEED, 'nota.profile.v1': { courriel: 'client@exemple.ca' } },
    routes: [statusRoute(() => retainedStatus({ messages: msgs.slice() })), monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  Nota.account.render();
  const door = () => [...doc.querySelectorAll('#acct-actions .acct-action')].find((b) => /Mon profil/.test(b.textContent));
  assert.equal(door().querySelector('.acct-badge'), null, 'nothing unread → no badge');
  msgs = MSGS.slice();
  await Nota.client.pollTick();
  await wait(20);
  const badge = door().querySelector('.acct-badge');
  assert.ok(badge, 'the door badge is created on the spot, without a menu repaint');
  assert.equal(badge.textContent, '2');
  Nota.client.markSeen('o1');
  const after = door().querySelector('.acct-badge');
  assert.ok(!after || after.hidden, 'no visible badge at zero');
});

// P1-7 — a deep link is validated BEFORE it is persisted: an expired token
// never becomes a phantom entry polled forever.
test('an expired deep link (401/403) is not persisted, and the client is told which link opens the demand', async () => {
  const { win, doc } = await boot({
    url: '#offre=o9&d=' + DATE + '&cle=tok-old',
    routes: [{ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(403, { errors: [{ code: 'non_autorise', message: 'Jeton invalide ou expiré.' }] }) }, monthRoute()],
  });
  await wait(40);
  const mine = JSON.parse(win.localStorage.getItem('nota.myoffers.v1') || '[]');
  assert.ok(!mine.some((o) => o.id === 'o9'), 'no phantom entry');
  assert.match($(doc, 'toast').textContent, /lien a expiré/);
  assert.match($(doc, 'toast').textContent, /courriel le plus récent/);
  assert.ok(!/cle=/.test(win.location.hash), 'the token still leaves the URL');
});

test('an expired link on a KNOWN offer keeps the stored token untouched', async () => {
  const { win } = await boot({
    url: '#offre=o1&d=' + DATE + '&cle=tok-old',
    seed: RETAINED_SEED,
    routes: [{ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(401, {}) }, monthRoute()],
  });
  await wait(40);
  const mine = JSON.parse(win.localStorage.getItem('nota.myoffers.v1'));
  assert.equal(mine.find((o) => o.id === 'o1').clientToken, 'tok-o1', 'the working token is not replaced by a dead one');
});

// P1-9 / P1-10 — documents count as unread; the badge splits its number from
// its words so each translates in place; the document row carries its time.
test('a notary document counts as unread, badges the row with its own words, and its row carries the time', async () => {
  const docs = [{ id: 'd1', de: 'notaire', nom: 'Projet.pdf', taille: 1000, etat: 'pret', createdAt: '2026-08-03T15:30:00.000Z' }];
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus({ messages: [], documents: docs })), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const badge = doc.querySelector('#my-offers-live tr.my-offer[data-id="o1"] .my-offer-unread');
  assert.ok(badge && !badge.hidden, 'the document badges the row');
  assert.equal(badge.querySelector('.my-offer-unread-n').textContent, '1', 'the number sits in its own span');
  assert.match(badge.textContent, /1 nouveau document/);
  const row = doc.querySelector('.my-offer-chat .chat-doc[data-doc="d1"]');
  assert.ok(row, 'the document row renders');
  assert.ok(row.querySelector('.chat-when'), 'with its time');
  assert.match(row.querySelector('.chat-when').textContent, /\d{2}:\d{2}/);
  Nota.client.markSeen('o1');
  assert.equal(Nota.client.unread('o1'), 0, 'seen covers documents too');
});

// P2-7 — a notary who never gave a name is said so, not dressed as « Votre notaire ».
test('a notary without a name reads honestly — no « Votre notaire » standing in for a name', async () => {
  const noti = { nom: null, etude: null, telephone: null, adresse: null, courriel: 'x@etude.ca', lienCNQ: null, actes: 0, cnq: false };
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus({ notaire: noti })), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  const name = doc.querySelector('.my-offer-contact-name');
  assert.ok(name, 'the card renders (a courriel is enough to reach the notary)');
  assert.match(name.textContent, /Nom non communiqué/);
  assert.ok(!/Votre notaire/.test(name.textContent), name.textContent);
});

// P2-9 — the cancel button says it is busy while the forecast is re-fetched.
test('« Annuler cette offre » shows a pending state while the forecast is re-fetched', async () => {
  let slow = false;
  const { doc, Nota } = await boot({
    seed: RETAINED_SEED,
    routes: [{ match: (u) => u.includes('/client/bid?'), reply: () => (slow ? new Promise((res) => setTimeout(() => res(jsonRes(200, retainedStatus())), 60)) : jsonRes(200, retainedStatus())) }, monthRoute()],
  });
  Nota.setTab('profil');
  await wait(40);
  slow = true;
  const btn = doc.querySelector('.btn-offer-cancel');
  btn.click();
  await wait(5);
  assert.equal(btn.disabled, true, 'disabled while the server is asked');
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  await wait(100);
  assert.equal($(doc, 'cancel-dialog').open, true);
  assert.equal(btn.disabled, false, 're-armed once the dialog is up');
});

// P2-18 — the dialog says Nota charges nothing on a cancelled demand.
test('the cancel dialog says Nota charges nothing on a cancelled demand', async () => {
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  Nota.setTab('profil');
  await wait(40);
  doc.querySelector('.btn-offer-cancel').click();
  await wait(30);
  assert.match($(doc, 'cancel-dialog').textContent, /Nota ne facture pas son service sur une demande annulée/);
});

// P2-13 — the pane is « Mes offres »; the deep-linked band takes the focus.
test('#pane-profil is titled « Mes offres », its lede no longer claims « sur cet appareil », and the deep-linked band takes the focus', async () => {
  const st = retainedStatus({ bid: { id: 'o9', serviceId: 'refinancement', dateISO: DATE, montant: 2600, status: 'retenue', etude: 'Étude Roy' } });
  const { doc } = await boot({ url: '#offre=o9&d=' + DATE + '&cle=tok-9', routes: [statusRoute(st), monthRoute()] });
  await wait(40);
  const pane = $(doc, 'pane-profil');
  assert.equal(pane.querySelector('h1').textContent.trim(), 'Mes offres');
  assert.ok(!/sur cet appareil/.test(pane.querySelector('.intro p').textContent), 'the device note leaves the lede');
  const band = doc.querySelector('.my-offer-detail[data-for="o9"]');
  assert.equal(doc.activeElement, band, 'the band is focused');
});

// P2-1 — one IntersectionObserver per surface, however many repaints.
test('one IntersectionObserver for Mes offres: re-rendering never constructs another', async () => {
  let made = 0; const observed = [];
  const { doc, Nota } = await boot({
    seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()],
    onWindow: (w) => { w.IntersectionObserver = function () { made++; this.observe = (t) => observed.push(t); this.unobserve = () => {}; this.disconnect = () => {}; }; },
  });
  Nota.setTab('profil'); await wait(40);
  Nota.setTab('carnet'); Nota.setTab('profil'); await wait(40);
  assert.ok(doc.querySelector('.my-offer-chat .chat-thread'), 'the thread is on screen');
  assert.equal(made, 1, 'one observer');
  assert.ok(observed.length >= 2, 'every repaint observes its fresh thread');
});

// P2-10 — the counters are not live regions (every keystroke past 400 would
// otherwise be announced).
test('the composer counter carries no aria-live', async () => {
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus()), monthRoute()] });
  Nota.setTab('profil'); await wait(40);
  assert.equal(doc.querySelector('.my-offer-chat .chat-count').hasAttribute('aria-live'), false);
});
