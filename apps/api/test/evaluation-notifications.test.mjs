// The evaluation feedback loop (ADR 0015/0016): POST /client/evaluation now
// notifies — the rated notary hears about their new note (their public average
// moved), and a LOW note (<= 2) alerts the operator for a human follow-up.
// Idempotent per bid (the evaluation itself is write-once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { notaryIdForEmail, signToken, SCOPES } = require('../src/notary-auth.js');
const emails = require('../src/emails.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const UNSUB = BASE + '/unsubscribe?token=abc123';

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

const NOTARY = notaryIdForEmail('n@etude.ca');

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

// A retained bid whose act is already settled in the ledger (evaluation open).
async function seed(a, over = {}) {
  await a.repo.putNotary({ id: NOTARY, email: 'n@etude.ca', status: 'active', label: 'Étude N' });
  const bid = {
    id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 2800,
    status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca', ...over,
  };
  await a.repo.put(bid);
  await a.repo.markActCompleted(bid.id, { bidId: bid.id, notaryId: NOTARY, actAmount: 2800, commissionCents: 42000, completedAt: TODAY });
  return bid;
}

const evaluate = (a, body) =>
  a.handle({ method: 'POST', path: '/client/evaluation', headers: bearer(clientToken(body.id)), body: JSON.stringify(body) });

const ratingMailTo = (a, to) => a.mailer.sent.filter((m) => m.to === to && /évaluation|rating/i.test(m.subject));

// --- templates ----------------------------------------------------------------

test('evaluationRecueNotaire shows the note, the comment excerpt, and the public-average mention', () => {
  const out = emails.evaluationRecueNotaire({
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
    note: 4, commentaire: 'Très <pro> et rapide.',
    baseUrl: BASE, unsubscribeUrl: UNSUB,
  });
  assert.ok(out.subject.includes(' / '), 'bilingual subject');
  assert.match(out.subject, /4\/5/);
  assert.ok(out.html.includes('Très &lt;pro&gt; et rapide.'), 'comment esc()ed');
  assert.ok(/moyenne publique/.test(out.html), 'FR mentions the public average');
  assert.ok(/public average/.test(out.html), 'EN mentions the public average');
  const ctas = (out.html.match(new RegExp('href="' + BASE + '/#notaires"', 'g')) || []).length;
  assert.equal(ctas, 2, 'CTA opens the console in both languages');
});

test('evaluationRecueNotaire without a comment renders without the comment block', () => {
  const out = emails.evaluationRecueNotaire({
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, note: 5,
    baseUrl: BASE, unsubscribeUrl: UNSUB,
  });
  assert.ok(!/Commentaire du client/.test(out.html));
});

test('operatorLowRating alerts with the bid context, the note and the comment', () => {
  const out = emails.operatorLowRating({
    serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800,
    note: 1, commentaire: 'Injoignable.', notaireEmail: 'n@etude.ca',
    baseUrl: BASE, unsubscribeUrl: UNSUB,
  });
  assert.match(out.subject, /1\/5/);
  assert.ok(out.html.includes('n@etude.ca'), 'the notary is identified');
  assert.ok(out.html.includes('Injoignable.'));
  assert.ok(out.html.includes('Refinancement'), 'the act is named');
});

// --- notifier use-case --------------------------------------------------------

test('onEvaluationSubmitted mails the rated notary once per bid; a good note skips the operator', async () => {
  const a = app();
  await a.repo.putNotary({ id: NOTARY, email: 'n@etude.ca', label: 'Étude N' });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca' };

  await a.notifier.onEvaluationSubmitted(bid, { note: 5, commentaire: 'Impeccable.' });
  await a.notifier.onEvaluationSubmitted(bid, { note: 5, commentaire: 'Impeccable.' }); // retry — idempotent
  assert.equal(ratingMailTo(a, 'n@etude.ca').length, 1, 'one rating mail to the notary');
  assert.equal(a.mailer.sent.filter((m) => m.to === 'ops@nota.ca').length, 0, 'no operator alert for a good note');
});

test('onEvaluationSubmitted with note <= 2 also alerts the operator', async () => {
  const a = app();
  await a.repo.putNotary({ id: NOTARY, email: 'n@etude.ca', label: 'Étude N' });
  const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2800, status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca' };

  await a.notifier.onEvaluationSubmitted(bid, { note: 2, commentaire: 'Difficile à joindre.' });
  assert.equal(ratingMailTo(a, 'n@etude.ca').length, 1);
  const ops = a.mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(ops.length, 1, 'the operator is alerted on a low note');
  assert.match(ops[0].subject, /2\/5/);
});

// --- route wiring -------------------------------------------------------------

test('POST /client/evaluation fires the feedback mails after the write (fire-and-forget)', async () => {
  const a = app();
  const bid = await seed(a);
  const res = await evaluate(a, { id: bid.id, dateISO: bid.dateISO, note: 1, commentaire: 'Décevant.' });
  assert.equal(res.statusCode, 201, res.body);
  await flush();

  assert.equal(ratingMailTo(a, 'n@etude.ca').length, 1, 'the notary hears about their evaluation');
  const ops = a.mailer.sent.filter((m) => m.to === 'ops@nota.ca' && /Évaluation faible|Low rating/.test(m.subject));
  assert.equal(ops.length, 1, 'the low note reaches the operator');

  // The idempotent re-submit path (200, evaluation on file) mails nothing new.
  const again = await evaluate(a, { id: bid.id, dateISO: bid.dateISO, note: 5 });
  assert.equal(again.statusCode, 200);
  await flush();
  assert.equal(ratingMailTo(a, 'n@etude.ca').length, 1, 'no second rating mail');
});

test('a notifier failure never breaks POST /client/evaluation', async () => {
  const a = app({ notifier: { onEvaluationSubmitted: () => Promise.reject(new Error('SES down')) } });
  const bid = await seed(a);
  const res = await evaluate(a, { id: bid.id, dateISO: bid.dateISO, note: 4 });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(parse(res).evaluation.note, 4);
});
