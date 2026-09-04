/**
 * The messaging pass of 2026-09-04, web side:
 *   • « Vu » — the other side's read receipt under the last own message they
 *     have read, on both threads (client band, notary card), and the read
 *     stamp POSTed when the thread is looked at;
 *   • a « Nous joindre » send keeps the support thread's token so the answer
 *     lands live in the site's messagerie, with a door to open it;
 *   • the notary's header bell pulls the API's notifications after a feed
 *     load, and « tout marquer lu » is told to the server.
 *
 * Boot harness mirrors client-offers.test.mjs (domain then app inside jsdom,
 * fetch stub keyed by URL, calls logged).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function boot({ seed = {}, routes = [] } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const call = { url: String(u), init: init || {}, headers: (init && init.headers) || {} };
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
  const win = dom.window; openWindows.push(win);
  win.eval(DOMAIN_SRC); win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain, calls };
}

const DATE = addDays(todayISO(), 6);
const OFFER = { id: 'o1', dateISO: DATE, serviceId: 'financement', montant: 2400, clientToken: 'tok-o1' };
const NOTAIRE = { nom: 'Me Anne Roy', etude: 'Étude Roy', telephone: '418 555 0100', adresse: '12, rue Saint-Jean, Québec (QC) G1R 1N4', courriel: 'anne@etuderoy.ca', lienCNQ: null, actes: 3, cnq: false };
const RETAINED_SEED = { 'nota.myoffers.v1': [{ ...OFFER, retained: true, etude: 'Étude Roy' }] };
const monthRoute = () => ({ match: (u) => u.includes('/bids?month='), reply: (u) => jsonRes(200, { month: u.slice(-7), bids: [] }) });
const MSGS = [
  { id: 'm1', de: 'notaire', texte: 'Bonjour, avez-vous le relevé ?', createdAt: '2026-08-12T09:00:00.000Z' },
  { id: 'm2', de: 'client', texte: 'Oui, je l’envoie.', createdAt: '2026-08-12T09:05:00.000Z' },
  { id: 'm3', de: 'client', texte: 'Voilà.', createdAt: '2026-08-12T09:30:00.000Z' },
];
const retainedStatus = (over = {}) => ({
  bid: { id: 'o1', serviceId: 'financement', dateISO: DATE, montant: 2400, status: 'retenue', etude: 'Étude Roy' },
  notaire: NOTAIRE, propositions: [], demandes: [],
  readiness: { total: 6, done: 2, missing: [], consent: false, ready: false },
  messages: MSGS, documents: [], lecture: { notaire: null }, ...over,
});
const statusRoute = (body) => ({ match: (u) => u.includes('/client/bid?'), reply: () => jsonRes(200, body) });

test('client: « Vu » sits under the last own message the notary has read — and nowhere else', async () => {
  // Read up to 09:05 → « Vu » under m2, not m3 (written after) and never under the notary's m1.
  const { doc, Nota } = await boot({ seed: RETAINED_SEED, routes: [statusRoute(retainedStatus({ lecture: { notaire: '2026-08-12T09:10:00.000Z' } })), monthRoute()] });
  Nota.setTab('profil'); await wait(60);
  const rows = [...doc.querySelectorAll('.my-offer-chat .chat-msg')];
  assert.equal(rows.length, 3);
  assert.equal(rows[1].querySelector('.chat-seen') && rows[1].querySelector('.chat-seen').textContent, 'Vu');
  assert.equal(rows[0].querySelector('.chat-seen'), null, 'not under the notary’s own message');
  assert.equal(rows[2].querySelector('.chat-seen'), null, 'not under a message written after the stamp');
});

test('client: without a stamp nothing says « Vu »; looking at the thread POSTs the read stamp once', async () => {
  const { doc, Nota, calls } = await boot({
    seed: RETAINED_SEED,
    routes: [statusRoute(retainedStatus()), monthRoute(), { match: (u) => u.endsWith('/client/bid/lecture'), reply: () => jsonRes(200, { luLe: '2026-08-12T10:00:00.000Z' }) }],
  });
  Nota.setTab('profil'); await wait(60);
  assert.equal(doc.querySelector('.my-offer-chat .chat-seen'), null);
  Nota.client.markSeen('o1'); Nota.client.markSeen('o1');
  await wait(20);
  const posts = calls.filter((c) => c.url.endsWith('/client/bid/lecture'));
  assert.equal(posts.length, 1, 'one stamp per newest message, not one per glance');
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.id, 'o1');
  assert.equal(body.dateISO, DATE);
  assert.equal(posts[0].headers.Authorization, 'Bearer tok-o1');
});

test('« Nous joindre » keeps the support thread token and opens a door into the messagerie', async () => {
  const { doc, calls, win } = await boot({
    seed: { 'nota.profile.v1': { nom: 'Anne Tremblay', courriel: 'anne@example.ca' } },
    routes: [monthRoute(), { match: (u) => u.endsWith('/contact'), reply: () => jsonRes(202, { recu: true, threadId: 'th-9', token: 'sup.tok.9' }) },
      { match: (u) => u.endsWith('/support/thread'), reply: () => jsonRes(200, { messages: [{ id: 'x', de: 'visiteur', texte: 'Bonjour, une question.', createdAt: '2026-08-12T10:00:00.000Z' }] }) }],
  });
  $(doc, 'mnav-contact').click();
  $(doc, 'ct-message').value = 'Bonjour, une question.';
  $(doc, 'ct-submit').click();
  await wait(60);
  assert.ok(calls.find((c) => c.url.endsWith('/contact')), 'POST /contact');
  assert.equal($(doc, 'contact-success').hidden, false);
  const sess = JSON.parse(win.localStorage.getItem('nota.support.v1') || 'null');
  assert.ok(sess && sess.token === 'sup.tok.9' && sess.threadId === 'th-9', 'the widget now follows this thread');
  const door = $(doc, 'ct-open-chat');
  assert.ok(door && !door.hidden, 'a door into the messagerie, revealed by the token');
  door.click();
  await wait(30);
  assert.equal($(doc, 'chat-panel').hidden, false, 'the widget opens on the thread');
});

test('notary: « Vu » under the last own message the client has read, and the bell pulls the API’s notifications', async () => {
  const entry = {
    id: 'r-1', serviceId: 'refinancement', dateISO: addDays(todayISO(), 6), montant: 2900, tier: 'rapide', prefixe: 'G1V',
    courriel: 'client@example.ca', dossier: { __consent: true },
    client: { nom: 'Marie Roy', courriel: 'client@example.ca', telephone: '(418) 555-1234' },
    preteur: { id: 'tangerine', nom: 'Tangerine', virtuel: true }, deplacement: { qui: 'notaire', km: 25, urgence: false },
    messages: [
      { id: 'a', de: 'notaire', texte: 'Bonjour !', createdAt: '2026-08-12T09:00:00.000Z' },
      { id: 'b', de: 'client', texte: 'Bonjour.', createdAt: '2026-08-12T09:02:00.000Z' },
    ],
    documents: [], annulation: null, completed: false, viaProposition: false,
    lecture: { client: '2026-08-12T09:01:00.000Z' },
  };
  const profil = { nom: 'Me Anne Roy', etude: 'Étude Roy', telephone: '418 555 0100', adresse: '1, rue de la Démo, Québec (QC) G1R 1A1', courriel: 'demo@etude.ca', lienCNQ: null, rayonKm: 25, urgences: false, prefixe: 'G1R', alertes: { pace: 'daily', urgentOnly: false }, complet: true, manquants: [] };
  const avis = [{ id: 'n1', kind: 'message', titre: 'Nouveau message', corps: 'Bonjour.', lien: '#notaires&acte=r-1', refId: 'r-1', at: '2026-08-12T09:02:00.000Z', luLe: null }];
  const { doc, Nota, calls } = await boot({
    routes: [
      monthRoute(),
      { match: (u) => u.includes('/notary/session/request'), reply: () => jsonRes(200, { ok: true, devToken: 'chal.tok' }) },
      { match: (u) => u.includes('/notary/session/verify'), reply: () => jsonRes(200, { token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' }) },
      { match: (u) => u.endsWith('/notifications'), reply: () => jsonRes(200, { avis, nonLus: 1 }) },
      { match: (u) => u.endsWith('/notifications/lues'), reply: () => jsonRes(200, { marques: 1 }) },
      { match: (u) => u.endsWith('/notary/bids/lecture'), reply: () => jsonRes(200, { luLe: '2026-08-12T10:00:00.000Z' }) },
      { match: (u) => u.includes('/notary/bids'), reply: () => jsonRes(200, { bids: [], retained: [entry], profil, rating: null, cote: null }) },
    ],
  });
  await Nota.notary.signIn('demo@etude.ca');
  await wait(80);
  const card = doc.querySelector('#notary-retained-list .nc-card[data-id="r-1"]');
  assert.ok(card, 'the retained card renders');
  const rows = [...card.querySelectorAll('.chat-msg')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.chat-seen') && rows[0].querySelector('.chat-seen').textContent, 'Vu', 'under the notary’s own message the client read');
  assert.equal(rows[1].querySelector('.chat-seen'), null);
  // The bell pulled the server's entry: unread, and a door to the act.
  assert.ok(calls.some((c) => c.url.endsWith('/notifications') && c.headers.authorization === 'Bearer sess.tok'), 'GET /notifications with the session');
  const stored = JSON.parse(doc.defaultView.localStorage.getItem('nota.notifs.v1') || '[]');
  const srv = stored.find((n) => n.key === 'srv:n1');
  assert.ok(srv, 'the server entry is in the bell');
  assert.equal(srv.read, false);
  assert.equal(srv.lien, '#notaires&acte=r-1');
  // Marking all read tells the server.
  $(doc, 'notif-clear').click();
  await wait(20);
  assert.ok(calls.some((c) => c.url.endsWith('/notifications/lues') && c.headers.authorization === 'Bearer sess.tok'), 'POST /notifications/lues with the session');
});
