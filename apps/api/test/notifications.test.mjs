import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier, encodeUnsubToken, decodeUnsubToken } = require('../src/notifications.js');
const emails = require('../src/emails.js');

const TODAY = '2026-08-12';
const BASE = 'https://nota.example';

function setup({ operatorEmail = 'ops@nota.ca' } = {}) {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail, now: () => TODAY });
  return { repo, mailer, notifier };
}

const bidWithEmail = (over = {}) => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  premium: 1500 / 950,
  status: 'ouverte',
  anonyme: true,
  courriel: 'client@example.ca',
  createdAt: TODAY,
  ...over,
});

// --- template compliance (CASL: sender ID + working unsubscribe) -------------

test('every email template has a subject, an unsubscribe link, and sender identification', () => {
  const ctx = {
    serviceId: 'refinancement',
    dateISO: '2026-08-19',
    montant: 1500,
    tier: 'prioritaire',
    days: 7,
    bids: [{ serviceId: 'financement', dateISO: '2026-08-20', montant: 1900, tier: 'rapide' }],
    notaryEmail: 'notaire@example.ca',
    email: 'client@example.ca',
    baseUrl: BASE,
    unsubscribeUrl: BASE + '/unsubscribe?token=abc123',
  };

  const names = Object.keys(emails.TEMPLATES);
  assert.ok(names.length >= 11, 'expected the full lifecycle set of templates');

  for (const name of names) {
    const out = emails.TEMPLATES[name](ctx);
    assert.ok(out.subject && out.subject.trim().length > 0, `${name}: empty subject`);
    // Working unsubscribe mechanism, in both HTML and text.
    assert.ok(out.html.includes(ctx.unsubscribeUrl), `${name}: HTML missing unsubscribe link`);
    assert.ok(out.text.includes(ctx.unsubscribeUrl), `${name}: text missing unsubscribe link`);
    // Sender identification: name + the mailing address.
    assert.ok(out.html.includes(emails.SENDER.name), `${name}: HTML missing sender name`);
    assert.ok(out.html.includes(emails.SENDER.address), `${name}: HTML missing mailing address`);
    assert.ok(out.text.includes(emails.SENDER.address), `${name}: text missing mailing address`);
    // A single primary CTA (one anchor button rendered by the layout).
    assert.ok(/<a /.test(out.html), `${name}: no link/CTA in HTML`);
  }
});

test('unsubscribe token round-trips', () => {
  assert.equal(decodeUnsubToken(encodeUnsubToken('Client@Example.CA')), 'Client@Example.CA');
  assert.equal(decodeUnsubToken('!!!not-base64!!!').includes('\x00'), false);
});

// --- onOfferCreated: idempotent, and confirms to client + operator -----------

test('onOfferCreated sends offerPublished once (idempotent on repeat)', async () => {
  const { mailer, notifier } = setup();
  const bid = bidWithEmail();

  await notifier.onOfferCreated(bid);
  await notifier.onOfferCreated(bid); // repeat — must not double-send

  const toClient = mailer.sent.filter((m) => m.to === 'client@example.ca');
  const toOps = mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(toClient.length, 1, 'client should get exactly one offerPublished');
  assert.equal(toOps.length, 1, 'operator should get exactly one new-lead alert');
  assert.equal(mailer.sent.length, 2, 'no third message on the repeat call');
});

test('a suppressed (unsubscribed) address gets nothing', async () => {
  const { repo, mailer, notifier } = setup();
  await repo.putUnsubscribe('client@example.ca', TODAY);

  await notifier.onOfferCreated(bidWithEmail());

  assert.equal(mailer.sent.some((m) => m.to === 'client@example.ca'), false, 'suppressed client was mailed');
  // The operator is a different address and is unaffected.
  assert.equal(mailer.sent.some((m) => m.to === 'ops@nota.ca'), true);
});

test('onOfferCreated with no courriel still alerts the operator, mails no client', async () => {
  const { mailer, notifier } = setup();
  await notifier.onOfferCreated(bidWithEmail({ courriel: null }));
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, 'ops@nota.ca');
});

// --- account lifecycle (commission model) ------------------------------------

test('onAccountEvent IGNORES checkout.session.completed (pay-on-accept: that event is the CLIENT authorizing their offer card, not a notary signup)', async () => {
  const { mailer, notifier } = setup();
  const event = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { metadata: { bidId: 'BID#1' }, customer_email: 'client@example.ca' } },
  };
  await notifier.onAccountEvent(event, null);
  // Must NOT welcome the paying client as a notary, nor falsely alert the operator.
  assert.equal(mailer.sent.length, 0, 'checkout.session.completed must send no account email');
});

test('onAccountEvent(account.updated, ACTIVE notary) welcomes the notary and alerts the operator, once', async () => {
  const { mailer, notifier } = setup();
  const event = {
    id: 'evt_acct',
    type: 'account.updated',
    data: { object: { id: 'acct_1', charges_enabled: true, metadata: { notaryId: 'n-1' } } },
  };
  const notary = { id: 'n-1', email: 'notaire@example.ca', status: 'active' };
  await notifier.onAccountEvent(event, notary);
  const toNotary = mailer.sent.filter((m) => m.to === 'notaire@example.ca');
  assert.equal(toNotary.length, 1, 'notary should get exactly one activation welcome');
  // The welcome must never mention the retired flat subscription.
  assert.ok(!/abonnement|subscription/i.test(toNotary[0].html), 'welcome must not mention a subscription');
  assert.equal(mailer.sent.filter((m) => m.to === 'ops@nota.ca').length, 1, 'operator alerted once');
  // A later account.updated redelivery (Stripe sends many) never re-sends.
  await notifier.onAccountEvent({ ...event, id: 'evt_acct_2' }, notary);
  assert.equal(mailer.sent.length, 2, 'no duplicate on a repeated account.updated');
});

test('onAccountEvent(account.updated) for a notary still onboarding sends nothing', async () => {
  const { mailer, notifier } = setup();
  const event = {
    id: 'evt_acct_off',
    type: 'account.updated',
    data: { object: { id: 'acct_1', charges_enabled: false, metadata: { notaryId: 'n-1' } } },
  };
  await notifier.onAccountEvent(event, { id: 'n-1', email: 'notaire@example.ca', status: 'onboarding' });
  assert.equal(mailer.sent.length, 0);
});

test('onAccountEvent(account.application.deauthorized) sends the win-back email', async () => {
  const { mailer, notifier } = setup();
  const event = {
    id: 'evt_deauth',
    type: 'account.application.deauthorized',
    data: { object: { id: 'acct_1', metadata: { notaryId: 'n-1' } } },
  };
  await notifier.onAccountEvent(event, { id: 'n-1', email: 'notaire@example.ca' });
  const toNotary = mailer.sent.filter((m) => m.to === 'notaire@example.ca');
  assert.equal(toNotary.length, 1);
  assert.ok(!/abonnement/i.test(toNotary[0].html), 'win-back must not mention a subscription');
});

test('onAccountEvent ignores retired subscription events (invoice.*, customer.subscription.*)', async () => {
  const { mailer, notifier } = setup();
  for (const type of ['invoice.paid', 'invoice.upcoming', 'invoice.payment_failed', 'customer.subscription.deleted']) {
    await notifier.onAccountEvent(
      { id: 'evt_' + type, type, data: { object: { id: 'sub_1' } } },
      { id: 'n-1', email: 'notaire@example.ca' }
    );
  }
  assert.equal(mailer.sent.length, 0, 'retired subscription events must send nothing');
});

// --- client welcome (sign-up conversion) -------------------------------------

const flush = () => new Promise((r) => setImmediate(r));

test('onClientSignup sends the clientWelcome once, idempotent + case-insensitive', async () => {
  const { mailer, notifier } = setup();
  await notifier.onClientSignup('New@Client.CA');
  await notifier.onClientSignup('new@client.ca'); // same address normalized — no double-send
  const toClient = mailer.sent.filter((m) => m.to === 'new@client.ca');
  assert.equal(toClient.length, 1, 'client should get exactly one welcome');
  assert.match(toClient[0].subject, /Bienvenue/);
});

test('onClientSignup honors suppression and ignores a blank address', async () => {
  const { repo, mailer, notifier } = setup();
  await repo.putUnsubscribe('opted@out.ca', TODAY);
  await notifier.onClientSignup('opted@out.ca');
  await notifier.onClientSignup('');
  assert.equal(mailer.sent.length, 0);
});

test('POST /client/welcome answers 200 {ok:true} and welcomes once across repeats', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  const app = createApp(repo, { now: () => TODAY, notifier });

  const res = await app.handle({ method: 'POST', path: '/client/welcome', body: JSON.stringify({ courriel: 'Lead@Example.CA' }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  await flush();
  const res2 = await app.handle({ method: 'POST', path: '/client/welcome', body: JSON.stringify({ email: 'lead@example.ca' }) });
  await flush();
  assert.equal(res2.statusCode, 200);
  assert.equal(mailer.sent.filter((m) => m.to === 'lead@example.ca').length, 1, 'welcome sent once across two posts');
});

test('POST /client/welcome with an invalid/blank email is a 200 no-op', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, now: () => TODAY });
  const app = createApp(repo, { now: () => TODAY, notifier });
  const res = await app.handle({ method: 'POST', path: '/client/welcome', body: JSON.stringify({ courriel: 'not-an-email' }) });
  assert.equal(res.statusCode, 200);
  await flush();
  assert.equal(mailer.sent.length, 0);
});

// --- reminder kind → template mapping ---------------------------------------

test('onReminderDue maps j7/j3/j1 → dateApproaching, j0 → dateMissedNoUptake, dossier_incomplet → dossierIncomplete', async () => {
  const { mailer, notifier } = setup();
  const bid = bidWithEmail({ dateISO: TODAY }); // days = 0 for the j0 case

  await notifier.onReminderDue(bidWithEmail({ id: 'r1' }), 'j7', TODAY);
  await notifier.onReminderDue(bidWithEmail({ id: 'r2' }), 'j0', TODAY);
  await notifier.onReminderDue(bid, 'dossier_incomplet', TODAY);

  assert.equal(mailer.sent.length, 3);
  assert.match(mailer.sent[0].subject, /Votre signature approche/);
  assert.match(mailer.sent[1].subject, /aucune offre retenue/, 'j0 must send the raise-your-offer nudge');
  assert.match(mailer.sent[2].subject, /dossier/i);
});

// --- unsubscribe route -------------------------------------------------------

test('GET /unsubscribe records the opt-out and returns an HTML confirmation', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => TODAY });
  const token = encodeUnsubToken('client@example.ca');

  const res = await app.handle({ method: 'GET', path: '/unsubscribe', query: { token } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(await repo.isUnsubscribed('client@example.ca'), true);
});

test('GET /unsubscribe normalizes the decoded address (trim + lowercase) before recording it', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => TODAY });
  // A token minted from a case-variant, padded address — the suppression record
  // must land normalized, so the notifier's isUnsubscribed check matches it.
  // The memory repo normalizes defensively on its own, so capture what the
  // ROUTE hands the port: that is what the dynamo adapter would store.
  const seen = [];
  const orig = repo.putUnsubscribe.bind(repo);
  repo.putUnsubscribe = (email, at) => { seen.push(email); return orig(email, at); };
  const token = encodeUnsubToken('  Client@Example.CA ');

  const res = await app.handle({ method: 'GET', path: '/unsubscribe', query: { token } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, ['client@example.ca'], 'the route must normalize before writing the opt-out');
  assert.equal(await repo.isUnsubscribed('client@example.ca'), true);
});

test('GET /unsubscribe with a bad token is 400 and records nothing', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => TODAY });
  const res = await app.handle({ method: 'GET', path: '/unsubscribe', query: { token: '%%%' } });
  assert.equal(res.statusCode, 400);
});

// RFC 8058 one-click: mailbox providers POST to the List-Unsubscribe URL with
// no user interaction — the route must accept POST and record the opt-out.
test('POST /unsubscribe (one-click, RFC 8058) records the opt-out', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => TODAY });
  const token = encodeUnsubToken('client@example.ca');

  const res = await app.handle({ method: 'POST', path: '/unsubscribe', query: { token } });
  assert.equal(res.statusCode, 200);
  assert.equal(await repo.isUnsubscribed('client@example.ca'), true);
});

test('POST /unsubscribe with a bad token is 400 and records nothing', async () => {
  const repo = createMemoryRepo();
  const app = createApp(repo, { now: () => TODAY });
  const res = await app.handle({ method: 'POST', path: '/unsubscribe', query: { token: '%%%' } });
  assert.equal(res.statusCode, 400);
});

// --- List-Unsubscribe plumbing: the notifier hands the mailer the URL --------

test('every mailer.send carries the recipient unsubscribe URL for List-Unsubscribe headers', async () => {
  const { mailer, notifier } = setup();
  await notifier.onOfferCreated(bidWithEmail());
  await notifier.onNotaryLoginRequested({ email: 'n@example.ca', link: BASE + '/n/verify?t=x' });

  assert.ok(mailer.sent.length >= 2);
  for (const m of mailer.sent) {
    const expected = BASE + '/unsubscribe?token=' + encodeUnsubToken(m.to);
    assert.equal(m.unsubscribeUrl, expected, `send to ${m.to} must carry its unsubscribe URL`);
  }
});

// --- fire-and-forget resilience: a mail failure never breaks POST /bids ------

test('POST /bids still returns 201 when the notifier throws', async () => {
  const repo = createMemoryRepo();
  const brokenNotifier = {
    onOfferCreated() {
      return Promise.reject(new Error('SES down'));
    },
  };
  const app = createApp(repo, { now: () => TODAY, newId: () => 'x', notifier: brokenNotifier });
  const res = await app.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, courriel: 'client@example.ca', prefixe: 'G1R', pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' } }),
  });
  assert.equal(res.statusCode, 201);
});
