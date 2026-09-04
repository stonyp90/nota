/**
 * The Stripe path of a publish (audit 2.2). When POST /bids answers with a
 * Checkout URL, the sheet leaves for Stripe BEFORE the success card renders —
 * and the return (?paiement=ok) landed on « Mes offres » with a one-line
 * notice and the documents card open on the FIRST act of the catalogue,
 * whatever the client had just paid for.
 *
 * Now the sheet remembers the offer on the device (nota.checkout.v1) right
 * before the redirect, and the return renders the success card the client
 * never saw: the act, the date, the amount, the dossier's real progress with
 * its one-tap door, and the three calendar links — with the documents card
 * preselected on that act. The memo is consumed on return (ok or annulé).
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
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });

async function boot({ url = '', routes = [], seed = {} } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/' + url, pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {} };
        calls.push(call);
        const r = routes.find((x) => x.match(call.url, call.init));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(call.url, call.init));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

const ls = (win, k) => JSON.parse(win.localStorage.getItem(k) || 'null');
const DATE = addDays(todayISO(), 8);

test('a publish that needs a card authorization memorizes the offer on the device before leaving for Stripe', async () => {
  let posted = null;
  const routes = [monthRoute(), {
    match: (u, init) => u.endsWith('/bids') && init.method === 'POST',
    reply: (u, init) => {
      posted = JSON.parse(init.body);
      return jsonRes(201, {
        bid: { id: 'b1', serviceId: posted.serviceId, dateISO: posted.dateISO, montant: posted.montant, status: 'ouverte' },
        clientToken: 'tok-b1', paymentStatus: 'pending', checkoutUrl: 'https://checkout.example/s/1',
      });
    },
  }];
  const { win, doc, Nota } = await boot({ routes });
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  Nota.selectDate(DATE);
  await wait(20);
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(20);
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-contexte__propriete_detenue').click();
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const p = $(doc, 'crit-preteur'); p.value = 'banque_nationale'; fire(p, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(pre, 'input');
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(em, 'input');
  assert.equal($(doc, 'offer-submit').disabled, false, 'publishable');
  // jsdom cannot navigate away; the redirect itself is not what is asserted.
  fire($(doc, 'offer-form'), 'submit');
  await wait(60);
  assert.ok(posted, 'POST /bids went out');
  const memo = ls(win, 'nota.checkout.v1');
  assert.deepEqual(memo, { bidId: 'b1', serviceId: 'financement', dateISO: DATE, montant: posted.montant },
    'the memo names the offer the success card will need');
});

test('?paiement=ok renders the success card the client never saw — act, date, dossier progress, calendar links — on that act', async () => {
  const memo = { bidId: 'b1', serviceId: 'financement', dateISO: DATE, montant: 2350 };
  const { win, doc, D } = await boot({
    url: '?paiement=ok', routes: [monthRoute()],
    seed: {
      'nota.checkout.v1': memo,
      'nota.myoffers.v1': [{ id: 'b1', serviceId: 'financement', dateISO: DATE, montant: 2350, clientToken: 'tok-b1' }],
      'nota.profile.v1': { courriel: 'client@exemple.ca' },
      'nota.dossier.v1': { financement: { piece_identite: 'permis.pdf' } },
    },
  });
  const notice = $(doc, 'checkout-notice');
  assert.ok(notice, 'the standing notice is still there');
  const card = $(doc, 'checkout-success');
  assert.ok(card, 'the success card renders on the pane the client lands on');
  assert.equal(notice.nextElementSibling, card, 'right under the notice');
  const svc = D.serviceById('financement');
  assert.match(card.textContent, new RegExp(svc.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'names the act');
  assert.ok(card.textContent.includes(D.money(2350)), 'states the amount');

  // The dossier's real progress, and its one-tap door.
  const r = D.leadReadiness('financement', { piece_identite: 'permis.pdf' }, {}); // this device's answers: none yet
  assert.equal(card.querySelector('.dossier-next-badge').textContent, r.done + '/' + r.total);
  const cta = $(doc, 'checkout-dossier-cta');
  assert.ok(cta, 'the dossier door');

  // The three calendar links, for THIS offer.
  const compact = DATE.replace(/-/g, '');
  assert.match($(doc, 'checkout-ics-link').getAttribute('href'), /^data:text\/calendar/);
  assert.equal($(doc, 'checkout-ics-link').getAttribute('download'), 'offre-nota.ics');
  assert.ok($(doc, 'checkout-gcal-link').getAttribute('href').includes('calendar.google.com'));
  assert.ok($(doc, 'checkout-gcal-link').getAttribute('href').includes(compact + '/'), 'the event is on the offer’s date');
  assert.ok($(doc, 'checkout-outlook-link').getAttribute('href').includes('startdt=' + DATE));

  // The documents card opens on the act just paid for — not the catalogue's first.
  const chip = doc.querySelector('.profil-doc-chips .chip[data-svc="financement"]');
  assert.equal(chip.getAttribute('aria-pressed'), 'true', 'the paid act is the pressed chip');
  assert.equal(doc.querySelector('.profil-doc-chips .chip[data-svc="refinancement"]').getAttribute('aria-pressed'), 'false');
  const docRows = doc.querySelectorAll('.profil-doc-list .doc-row');
  assert.equal(docRows.length, D.dossierItems('financement', {}).length, 'the checklist is that act’s');

  // The memo is consumed.
  assert.equal(ls(win, 'nota.checkout.v1'), null);

  // The door lands in the dossier of that act.
  cta.click();
  await wait(20);
  assert.equal($(doc, 'd-service').value, 'financement');
});

test('?paiement=annule drops the memo and shows no success card', async () => {
  const { win, doc } = await boot({
    url: '?paiement=annule', routes: [monthRoute()],
    seed: { 'nota.checkout.v1': { bidId: 'b1', serviceId: 'financement', dateISO: DATE, montant: 2350 } },
  });
  assert.equal(ls(win, 'nota.checkout.v1'), null);
  assert.equal($(doc, 'checkout-success'), null);
});
