// The messaging pass of 2026-09-04, API side:
//   • a support thread carries its STATUS (domain.supportThreadSummary) and
//     lands in a month-sharded inbox listing (keys.supportInboxMonths);
//   • a « Nous joindre » message is a support thread too — same inbox, same
//     reply path — and hands the sender a widget token to follow the answer;
//   • the retained-act chat is throttled per thread and side;
//   • read receipts travel to the other side (luParClientAt / luParNotaireAt);
//   • in-app notifications are WRITTEN by the API (message, retenue,
//     proposition, document) under the recipient's subject and READ through
//     two doors — GET /notifications and POST /notifications/lues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const keys = require('../src/keys.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();
const BASE = 'https://nota.example';
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };
const MONTHS = keys.supportInboxMonths(NOW_ISO, 3);

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, supportUrl: BASE, ...opts }),
    repo, mailer,
  };
}
async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude Inbox', ...NOTARY_CONTACT });
  return (await notarySignIn(a, email)).token;
}
async function postBid(a) {
  const res = await a.handle({ method: 'POST', path: '/bids', body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING }) });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res);
}
const accept = (a, token, b) => a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });
const notarySend = (a, token, b, texte) => a.handle({ method: 'POST', path: '/notary/bids/message', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });
const clientSend = (a, token, b, texte) => a.handle({ method: 'POST', path: '/client/bid/message', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });
const ask = (a, body, token) => a.handle({ method: 'POST', path: '/support/messages', headers: token ? bearer(token) : {}, body: JSON.stringify(body) });
const reply = (a, token, body) => a.handle({ method: 'POST', path: '/support/reply', headers: bearer(token), body: JSON.stringify(body) });
function replyTokenFrom(mail) {
  const m = /#reponse=([A-Za-z0-9_\-.%]+)/.exec(mail.html + ' ' + (mail.text || ''));
  assert.ok(m, 'operator email carries the reply link');
  return decodeURIComponent(m[1]);
}
const findById = (node, id) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findById(n, id); if (f) return f; } return null; }
  if (node.id === id && ('lecture' in node || 'messages' in node)) return node;
  for (const v of Object.values(node)) { const f = findById(v, id); if (f) return f; }
  return null;
};

// --- Inbox -------------------------------------------------------------------

test('a support thread carries its status, and the inbox lists threads newest-first with it', async () => {
  const a = app();
  const first = parse(await ask(a, { texte: 'Signez-vous le soir ?' }));
  await flush();
  const second = parse(await ask(a, { texte: 'Et le samedi ?', courriel: 'sam@exemple.ca' }));
  await flush();
  let rows = await a.repo.listSupportThreads({ months: MONTHS, limit: 10 });
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map((t) => [t.id, t]));
  assert.equal(byId[first.threadId].statut, domain.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(byId[first.threadId].nb, 1);
  assert.equal(byId[first.threadId].dernierDe, 'visiteur');
  assert.equal(byId[first.threadId].dernierAt, NOW_ISO);
  assert.equal(byId[second.threadId].courriel, 'sam@exemple.ca');
  // The operator answers the first: it flips to « répondu », the other stays.
  const opToken = replyTokenFrom(a.mailer.sent.find((m) => m.to === 'ops@nota.ca'));
  assert.equal((await reply(a, opToken, { texte: 'Oui, jusqu’à 20 h.' })).statusCode, 200);
  rows = await a.repo.listSupportThreads({ months: MONTHS, limit: 10 });
  const after = Object.fromEntries(rows.map((t) => [t.id, t]));
  assert.equal(after[first.threadId].statut, domain.SUPPORT_STATUT.REPONDU);
  assert.equal(after[first.threadId].nb, 2);
  assert.equal(after[second.threadId].statut, domain.SUPPORT_STATUT.A_REPONDRE);
  // Summaries are what the console will show — bounded, no whole log.
  const s = domain.supportThreadSummary(after[first.threadId]);
  assert.equal(s.dernierTexte, 'Oui, jusqu’à 20 h.');
  // A month outside the window sees nothing.
  assert.equal((await a.repo.listSupportThreads({ months: ['1999-01'], limit: 10 })).length, 0);
});

test('a « Nous joindre » message becomes a support thread and hands back a widget token', async () => {
  const a = app();
  const res = await a.handle({ method: 'POST', path: '/contact', body: JSON.stringify({ nom: 'Ève Roy', courriel: 'eve@exemple.ca', sujet: 'question', message: 'Faites-vous les subrogations ?' }) });
  assert.equal(res.statusCode, 202, res.body);
  const body = parse(res);
  assert.equal(body.recu, true);
  assert.ok(body.threadId && body.token, 'the sender can follow the answer in the widget');
  const rows = await a.repo.listSupportThreads({ months: MONTHS, limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origine, 'contact');
  assert.equal(rows[0].courriel, 'eve@exemple.ca');
  assert.equal(rows[0].nom, 'Ève Roy');
  assert.equal(rows[0].statut, domain.SUPPORT_STATUT.A_REPONDRE);
  // The widget token reads the very thread.
  const t = await a.handle({ method: 'GET', path: '/support/thread', headers: bearer(body.token) });
  assert.equal(t.statusCode, 200);
  assert.equal(parse(t).messages.length, 1);
  assert.equal(parse(t).messages[0].texte, 'Faites-vous les subrogations ?');
  // The two emails of the contact route still go out.
  await flush();
  assert.ok(a.mailer.sent.some((m) => m.to === 'ops@nota.ca'), 'operator alert');
  assert.ok(a.mailer.sent.some((m) => m.to === 'eve@exemple.ca'), 'acknowledgement to the sender');
});

// --- Chat throttle -------------------------------------------------------------

test('the retained-act chat is throttled per thread and side', async () => {
  const a = app({ chatRlMax: 2 });
  const notary = await session(a, 'chat@etude.ca');
  const { bid, clientToken } = await postBid(a);
  assert.equal((await accept(a, notary, bid)).statusCode, 200);
  assert.equal((await notarySend(a, notary, bid, 'un')).statusCode, 200);
  assert.equal((await notarySend(a, notary, bid, 'deux')).statusCode, 200);
  assert.equal((await notarySend(a, notary, bid, 'trois')).statusCode, 429, 'third message in the window is refused');
  // The client's side has its own counter.
  assert.equal((await clientSend(a, clientToken, bid, 'ok')).statusCode, 200);
});

// --- Read receipts ---------------------------------------------------------------

test('read receipts travel to the other side, and only the holder can mark', async () => {
  const a = app();
  const notary = await session(a, 'lu@etude.ca');
  const other = await session(a, 'autre@etude.ca');
  const { bid, clientToken } = await postBid(a);
  assert.equal((await accept(a, notary, bid)).statusCode, 200);
  assert.equal((await notarySend(a, notary, bid, 'Bonjour')).statusCode, 200);
  // Before anyone reads: nothing.
  let cb = parse(await a.handle({ method: 'GET', path: '/client/bid', query: { id: bid.id, dateISO: bid.dateISO }, headers: bearer(clientToken) }));
  assert.equal(cb.lecture.notaire, null);
  // The notary opens the thread → the client sees « vu ».
  const rn = await a.handle({ method: 'POST', path: '/notary/bids/lecture', headers: bearer(notary), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(rn.statusCode, 200, rn.body);
  assert.equal(parse(rn).luLe, NOW_ISO);
  cb = parse(await a.handle({ method: 'GET', path: '/client/bid', query: { id: bid.id, dateISO: bid.dateISO }, headers: bearer(clientToken) }));
  assert.equal(cb.lecture.notaire, NOW_ISO);
  // The client opens the thread → the notary's view carries it.
  const rc = await a.handle({ method: 'POST', path: '/client/bid/lecture', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(rc.statusCode, 200, rc.body);
  const nb = parse(await a.handle({ method: 'GET', path: '/notary/bids', headers: bearer(notary) }));
  const mine = findById(nb, bid.id);
  assert.ok(mine, 'the retained act is in the notary view');
  assert.equal(mine.lecture.client, NOW_ISO);
  // A bystander notary cannot mark someone else's thread.
  const ro = await a.handle({ method: 'POST', path: '/notary/bids/lecture', headers: bearer(other), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(ro.statusCode, 403);
});

// --- In-app notifications -------------------------------------------------------

test('the API writes in-app notifications and the bell reads them through two doors', async () => {
  const a = app();
  const notary = await session(a, 'bell@etude.ca');
  const { bid, clientToken } = await postBid(a);
  assert.equal((await accept(a, notary, bid)).statusCode, 200);
  await flush();
  const clientList = () => a.handle({ method: 'GET', path: '/notifications', query: { id: bid.id }, headers: bearer(clientToken) });
  // Retention rang the client.
  let r = parse(await clientList());
  assert.equal(r.nonLus, 1);
  assert.equal(r.avis[0].kind, 'retenue');
  assert.equal(r.avis[0].refId, bid.id);
  assert.ok(r.avis[0].titre, 'the domain title rides along');
  // A notary message rings the client; a client message rings the notary.
  assert.equal((await notarySend(a, notary, bid, 'Pouvez-vous m’envoyer le relevé ?')).statusCode, 200);
  await flush();
  r = parse(await clientList());
  assert.equal(r.nonLus, 2);
  assert.ok(r.avis.some((x) => x.kind === 'message' && /relevé/.test(x.corps)));
  assert.equal((await clientSend(a, clientToken, bid, 'Le voici.')).statusCode, 200);
  await flush();
  const n = parse(await a.handle({ method: 'GET', path: '/notifications', headers: bearer(notary) }));
  assert.equal(n.nonLus, 1);
  assert.equal(n.avis[0].kind, 'message');
  assert.equal(n.avis[0].refId, bid.id);
  assert.match(n.avis[0].lien, /acte=/);
  // Reading clears the count, and stays cleared.
  const m = await a.handle({ method: 'POST', path: '/notifications/lues', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, ids: 'toutes' }) });
  assert.equal(m.statusCode, 200, m.body);
  assert.equal(parse(m).marques, 2);
  r = parse(await clientList());
  assert.equal(r.nonLus, 0);
  assert.equal(r.avis.length, 2, 'read notifications are still listed, just read');
  // Doors are scoped: no token → 401, a client token on another offer → 403.
  assert.equal((await a.handle({ method: 'GET', path: '/notifications' })).statusCode, 401);
  assert.equal((await a.handle({ method: 'GET', path: '/notifications', query: { id: 'other' }, headers: bearer(clientToken) })).statusCode, 403);
});

test('a proposition and a withdrawal ring the client too', async () => {
  const a = app();
  const notary = await session(a, 'prop@etude.ca');
  const { bid, clientToken } = await postBid(a);
  const p = await a.handle({ method: 'POST', path: '/notary/bids/propose', headers: bearer(notary), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, montant: 3200 }) });
  assert.equal(p.statusCode, 200, p.body);
  await flush();
  let r = parse(await a.handle({ method: 'GET', path: '/notifications', query: { id: bid.id }, headers: bearer(clientToken) }));
  assert.ok(r.avis.some((x) => x.kind === 'proposition'), 'proposition rings');
  assert.equal((await accept(a, notary, bid)).statusCode, 200);
  const rel = await a.handle({ method: 'POST', path: '/notary/bids/release', headers: bearer(notary), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(rel.statusCode, 200, rel.body);
  await flush();
  r = parse(await a.handle({ method: 'GET', path: '/notifications', query: { id: bid.id }, headers: bearer(clientToken) }));
  assert.ok(r.avis.some((x) => x.kind === 'desistement'), 'withdrawal rings');
});
