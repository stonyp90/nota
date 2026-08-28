// The retained-act conversation now NOTIFIES: each side is mailed when the
// other writes in the dossier thread — notaire → client (messageDuNotaire),
// client → notaire (messageDuClient) — exactly once per message (refId =
// message.id in the SENT ledger), wired fire-and-forget in both chat routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...opts }),
    repo,
    mailer,
    notifier,
  };
}

async function session(a, email) {
  await a.repo.putNotary({ id: notaryIdForEmail(email), email, status: 'active', label: 'Étude Chat' });
  return notarySignIn(a, email);
}

async function postBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING, ...over }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res); // { bid, clientToken }
}

const accept = (a, token, b) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });
const notarySend = (a, token, b, texte) =>
  a.handle({ method: 'POST', path: '/notary/bids/message', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });
const clientSend = (a, clientToken, b, texte) =>
  a.handle({ method: 'POST', path: '/client/bid/message', headers: bearer(clientToken), body: JSON.stringify({ id: b.id, dateISO: b.dateISO, texte }) });

const toClientChatMail = (a) => a.mailer.sent.filter((m) => m.to === 'client@example.ca' && /Message de votre notaire/.test(m.subject));
const toNotaryChatMail = (a, email) => a.mailer.sent.filter((m) => m.to === email && /Réponse de votre client/.test(m.subject));

// --- templates ----------------------------------------------------------------

const emails = require('../src/emails.js');
const NB = ' ';
const UNSUB = BASE + '/unsubscribe?token=abc123';

test('messageDuNotaire shows the study, the excerpt in a callout, and drives to the client space', () => {
  const out = emails.messageDuNotaire({
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900,
    etude: 'Étude Chat', message: 'Merci de fournir la quittance <du> prêteur.',
    baseUrl: BASE, unsubscribeUrl: UNSUB,
  });
  assert.ok(out.subject.includes(' / '), 'bilingual subject');
  assert.match(out.subject, /Message de votre notaire/);
  assert.ok(out.html.includes('Étude Chat'), 'study name must show');
  // The excerpt is escaped user text inside the shared callout.
  assert.ok(out.html.includes('Merci de fournir la quittance &lt;du&gt; prêteur.'), 'excerpt esc()ed in a callout');
  assert.ok(!out.html.includes('<du>'), 'raw user text must never reach the HTML');
  const ctas = (out.html.match(new RegExp('href="' + BASE + '/#t=profil"', 'g')) || []).length;
  assert.equal(ctas, 2, 'FR + EN CTA both open the client space');
});

test('messageDuClient carries the amount in the subject and drives to the console', () => {
  const out = emails.messageDuClient({
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900,
    message: 'Parfait, à mardi.',
    baseUrl: BASE, unsubscribeUrl: UNSUB,
  });
  assert.ok(out.subject.includes('2' + NB + '900' + NB + '$'), 'fr amount in subject: ' + out.subject);
  assert.ok(out.subject.includes('$2,900'), 'en amount in subject');
  assert.ok(out.html.includes('Parfait, à mardi.'));
  const ctas = (out.html.match(new RegExp('href="' + BASE + '/#notaires"', 'g')) || []).length;
  assert.equal(ctas, 2, 'FR + EN CTA both open the notary console');
});

// --- notifier use-case --------------------------------------------------------

test('onChatMessage notaire→client mails the client once per message, never twice', async () => {
  const a = app();
  await a.repo.putNotary({ id: 'n-1', email: 'n@etude.ca', label: 'Étude Chat' });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, status: domain.STATUS.RETENUE, notaryId: 'n-1', courriel: 'client@example.ca' };
  const msg = { id: 'm1', de: domain.CHAT_FROM.NOTAIRE, texte: 'Bonjour!' };

  await a.notifier.onChatMessage(bid, msg);
  await a.notifier.onChatMessage(bid, msg); // retry — idempotent per message
  assert.equal(toClientChatMail(a).length, 1);
  assert.ok(toClientChatMail(a)[0].html.includes('Étude Chat'), 'the resolved study name rides along');

  // The NEXT message notifies again — idempotency is per message, not per bid.
  await a.notifier.onChatMessage(bid, { id: 'm2', de: domain.CHAT_FROM.NOTAIRE, texte: 'Autre chose.' });
  assert.equal(toClientChatMail(a).length, 2);
});

test('onChatMessage client→notaire resolves the notary profile and mails their address', async () => {
  const a = app();
  await a.repo.putNotary({ id: 'n-1', email: 'n@etude.ca', label: 'Étude Chat' });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, status: domain.STATUS.RETENUE, notaryId: 'n-1', courriel: 'client@example.ca' };

  await a.notifier.onChatMessage(bid, { id: 'm1', de: domain.CHAT_FROM.CLIENT, texte: 'Reçu, merci.' });
  assert.equal(toNotaryChatMail(a, 'n@etude.ca').length, 1);
  // No mail to the client on their own message.
  assert.equal(toClientChatMail(a).length, 0);
});

test('a suppressed client address silences the chat mail (CASL)', async () => {
  const a = app();
  await a.repo.putUnsubscribe('client@example.ca', TODAY);
  await a.repo.putNotary({ id: 'n-1', email: 'n@etude.ca' });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, status: domain.STATUS.RETENUE, notaryId: 'n-1', courriel: 'client@example.ca' };
  const r = await a.notifier.onChatMessage(bid, { id: 'm1', de: domain.CHAT_FROM.NOTAIRE, texte: 'Bonjour!' });
  assert.equal(r.results[0].sent, false);
  assert.equal(toClientChatMail(a).length, 0);
});

// --- route wiring (fire-and-forget in BOTH chat routes) -----------------------

test('the full thread over the API: each side is mailed for the other’s messages, once each', async () => {
  const a = app();
  const { bid, clientToken } = await postBid(a);
  const { token } = await session(a, 'n1@notaire.ca');
  assert.equal((await accept(a, token, bid)).statusCode, 200);
  await flush();

  // Notary writes → the client is mailed.
  assert.equal((await notarySend(a, token, bid, 'Bonjour, merci de compléter le dossier.')).statusCode, 200);
  await flush();
  assert.equal(toClientChatMail(a).length, 1, 'client mailed on the notary message');

  // Client answers → the retaining notary is mailed.
  assert.equal((await clientSend(a, clientToken, bid, 'C’est fait!')).statusCode, 200);
  await flush();
  assert.equal(toNotaryChatMail(a, 'n1@notaire.ca').length, 1, 'notary mailed on the client reply');

  // A second notary message mails the client again (new message id).
  assert.equal((await notarySend(a, token, bid, 'Parfait, à mardi 14 h.')).statusCode, 200);
  await flush();
  assert.equal(toClientChatMail(a).length, 2);
});

test('a mail failure never breaks the chat routes', async () => {
  const brokenNotifier = { onChatMessage: () => Promise.reject(new Error('SES down')) };
  const a = app({ notifier: brokenNotifier });
  const repo = a.repo;
  await repo.put({ id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, status: domain.STATUS.RETENUE, notaryId: notaryIdForEmail('n1@notaire.ca'), courriel: 'client@example.ca' });
  await repo.putNotary({ id: notaryIdForEmail('n1@notaire.ca'), email: 'n1@notaire.ca', status: 'active' });
  const { token } = await notarySignIn(a, 'n1@notaire.ca');
  const res = await notarySend(a, token, { id: 'b1', dateISO: '2026-08-20' }, 'Bonjour');
  assert.equal(res.statusCode, 200, res.body);
});
