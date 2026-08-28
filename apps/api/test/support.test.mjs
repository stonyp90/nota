// Live support messaging (ADR 0026): a visitor's question lands live with the
// operator (email with a signed reply link), the operator's reply lands live
// in the widget (the thread the visitor polls) — and in the visitor's inbox
// when they left a courriel. Tokens are scoped: a visitor token can never
// speak as Nota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';

function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, supportUrl: BASE, ...opts }),
    repo,
    mailer,
  };
}

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
const ask = (a, body, token) =>
  a.handle({ method: 'POST', path: '/support/messages', headers: token ? bearer(token) : {}, body: JSON.stringify(body) });
const thread = (a, token) => a.handle({ method: 'GET', path: '/support/thread', headers: bearer(token) });
const reply = (a, token, body) =>
  a.handle({ method: 'POST', path: '/support/reply', headers: bearer(token), body: JSON.stringify(body) });

// The signed reply link the operator email carries: `${BASE}/#reponse=<token>`.
function replyTokenFrom(mail) {
  const m = /#reponse=([A-Za-z0-9_\-.%]+)/.exec(mail.html + ' ' + (mail.text || ''));
  assert.ok(m, 'the operator email must carry the signed reply link');
  return decodeURIComponent(m[1]);
}

test('a first question mints a thread, returns its token, and emails the operator a reply link', async () => {
  const a = app();
  const res = await ask(a, { texte: 'Bonjour, un refinancement se signe-t-il en soirée ?' });
  assert.equal(res.statusCode, 201, res.body);
  const j = parse(res);
  assert.ok(j.threadId && j.token, 'thread id + signed token');
  assert.equal(j.message.de, 'visiteur');
  await flush();
  const ops = a.mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(ops.length, 1, 'one live email per question');
  assert.match(ops[0].subject, /Messagerie/);
  assert.ok(ops[0].html.includes('refinancement se signe-t-il'), 'the question rides the email');
  replyTokenFrom(ops[0]);

  // The widget polls the thread with its token.
  const t = parse(await thread(a, j.token));
  assert.equal(t.messages.length, 1);
  assert.equal(t.messages[0].texte, 'Bonjour, un refinancement se signe-t-il en soirée ?');
});

test('the operator replies through the emailed link; the visitor sees it live and gets no email without a courriel', async () => {
  const a = app();
  const first = parse(await ask(a, { texte: 'Vos frais incluent-ils la quittance ?' }));
  await flush();
  const opToken = replyTokenFrom(a.mailer.sent[0]);

  const r = await reply(a, opToken, { texte: 'Oui — la quittance est incluse dans le prix affiché.' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(parse(r).message.de, 'nota');

  const t = parse(await thread(a, first.token));
  assert.deepEqual(t.messages.map((m) => m.de), ['visiteur', 'nota'], 'the reply lands in the visitor thread');
  await flush();
  assert.equal(a.mailer.sent.filter((m) => m.to !== 'ops@nota.ca').length, 0, 'no visitor email without a courriel');
});

test('a visitor courriel gets the reply copied to their inbox', async () => {
  const a = app();
  parse(await ask(a, { texte: 'Pouvez-vous me rappeler ?', courriel: 'Curieux@Exemple.CA' }));
  await flush();
  const opToken = replyTokenFrom(a.mailer.sent[0]);
  await reply(a, opToken, { texte: 'Bien sûr — laissez-nous votre numéro.' });
  await flush();
  const copies = a.mailer.sent.filter((m) => m.to === 'curieux@exemple.ca');
  assert.equal(copies.length, 1, 'the reply is copied to the (normalized) courriel');
  assert.match(copies[0].subject, /répondu/);
});

test('the thread token continues its thread; message-by-message, in order', async () => {
  const a = app();
  const first = parse(await ask(a, { texte: 'Première question.' }));
  const res = await ask(a, { texte: 'Une précision.' }, first.token);
  assert.equal(res.statusCode, 201);
  assert.equal(parse(res).threadId, first.threadId, 'same thread');
  const t = parse(await thread(a, first.token));
  assert.deepEqual(t.messages.map((m) => m.texte), ['Première question.', 'Une précision.']);
  await flush();
  assert.equal(a.mailer.sent.filter((m) => m.to === 'ops@nota.ca').length, 2, 'every message lands live');
});

test('scopes are watertight: a visitor token cannot reply as Nota, garbage cannot read', async () => {
  const a = app();
  const first = parse(await ask(a, { texte: 'Allo ?' }));
  const forged = await reply(a, first.token, { texte: 'Je suis Nota.' });
  assert.equal(forged.statusCode, 401, 'the SUPPORT scope never speaks as Nota');
  assert.equal((await thread(a, 'garbage.token')).statusCode, 401);
  const stale = await ask(a, { texte: 'suite' }, 'garbage.token');
  assert.equal(stale.statusCode, 401, 'a tampered token is refused, never silently splits the thread');
});

test('validation is the domain’s: empty or oversized messages are 422, an invalid courriel too', async () => {
  const a = app();
  const empty = await ask(a, { texte: '   ' });
  assert.equal(empty.statusCode, 422);
  assert.ok(parse(empty).errors.some((e) => e.code === 'message_requis'));
  const huge = await ask(a, { texte: 'x'.repeat(2001) });
  assert.equal(huge.statusCode, 422);
  assert.ok(parse(huge).errors.some((e) => e.code === 'message_trop_long'));
  const badMail = await ask(a, { texte: 'Allo', courriel: 'pas-un-courriel' });
  assert.equal(badMail.statusCode, 422);
  assert.ok(parse(badMail).errors.some((e) => e.code === 'courriel_invalide'));
  assert.equal(a.mailer.sent.length, 0, 'nothing invalid ever reaches the operator');
});
