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
    // Le lien passe par /api : c'est le seul chemin que CloudFront route vers
    // la Lambda (le routeur SPA avale les autres). Voir desabonnement-lien.test.mjs.
    const expected = BASE + '/api/unsubscribe?token=' + encodeUnsubToken(m.to);
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

// =============================================================================
// ADR 0033 — la mise en relation est complète, et la conversation est le canal
// =============================================================================

const NB = '\u00a0'; // fr-CA no-break space in money()
const CONTACT = { nom: 'Me Jeanne Tremblay', etude: 'Étude Tremblay', telephone: '418 555-0199', adresse: '12, rue Saint-Jean, Québec (QC) G1R 1N4', lienCNQ: 'https://www.cnq.org/fiche/jt' };
const retainedBid = (over = {}) =>
  bidWithEmail({
    status: 'retenue', notaryId: 'n-1', etude: 'Étude Tremblay', nom: 'Marie Roy', telephone: '(418) 555-0100', prefixe: 'G1R',
    pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'desjardins', deplacement: 'client_50' },
    dossier: { __consent: true, __pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'desjardins', deplacement: 'client_50' } },
    ...over,
  });

// An href is HTML: `&` reads `&amp;` inside the attribute.
const href = (url) => url.replace(/&/g, '&amp;');

function setup33(over = {}) {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const clientLink = (bid) => BASE + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle=jeton-' + bid.id;
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY, clientLink, adminUrl: 'https://admin.nota.example', ...over });
  return { repo, mailer, notifier };
}

test('onOfferRetained mails the CLIENT the notary’s contact block and the act deep link, the NOTARY the client’s block, and the operator — once per bid', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary({ id: 'n-1', email: 'jeanne@etude.ca', status: 'active', ...CONTACT });
  const bid = retainedBid();

  await notifier.onOfferRetained(bid);
  await notifier.onOfferRetained(bid); // the accept route is idempotent; so is the mail

  const toClient = mailer.sent.filter((m) => m.to === 'client@example.ca');
  assert.equal(toClient.length, 1, 'one retention mail to the client');
  assert.match(toClient[0].subject, /retenu votre demande/);
  assert.ok(toClient[0].html.includes('Me Jeanne Tremblay'), 'the client learns who');
  assert.ok(toClient[0].html.includes('href="tel:4185550199"'), 'and can call');
  assert.ok(toClient[0].html.includes('jeanne@etude.ca'));
  assert.ok(toClient[0].html.includes(href(BASE + '/#offre=b1&d=2026-08-19&cle=jeton-b1')), 'the CTA is the signed deep link');
  assert.ok(toClient[0].text.includes(BASE + '/#offre=b1&d=2026-08-19&cle=jeton-b1'), 'raw in the text alternative');

  const toNotary = mailer.sent.filter((m) => m.to === 'jeanne@etude.ca');
  assert.equal(toNotary.length, 1, 'one retention mail to the notary');
  assert.match(toNotary[0].subject, /Demande retenue/);
  assert.ok(toNotary[0].html.includes('Marie Roy'), 'the notary learns whom');
  assert.ok(toNotary[0].html.includes('href="tel:4185550100"'), 'and can call');
  assert.ok(toNotary[0].html.includes('client@example.ca'));
  assert.ok(toNotary[0].html.includes('Desjardins'), 'the lender rides along');
  assert.ok(toNotary[0].html.includes(href(BASE + '/#notaires&acte=b1')), 'the CTA opens the retained card');

  const toOps = mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(toOps.length, 1, 'one operator alert');
  assert.match(toOps[0].subject, /Demande retenue/);
  assert.ok(toOps[0].html.includes('https://admin.nota.example'), 'operator CTA lands on the admin console');
  assert.equal(mailer.sent.length, 3, 'nothing else, and nothing twice');
});

test('onOfferRetained quotes the barème in force (stored config first, env defaults otherwise) on this montant', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary({ id: 'n-1', email: 'jeanne@etude.ca', status: 'active', ...CONTACT });
  await repo.putCancellationConfig({ paliers: [{ maxJours: 5, taux: 0.2 }] }, TODAY);
  await notifier.onOfferRetained(retainedBid({ montant: 2000 }));
  const client = mailer.sent.find((m) => m.to === 'client@example.ca');
  const notary = mailer.sent.find((m) => m.to === 'jeanne@etude.ca');
  for (const m of [client, notary]) {
    assert.ok(m.html.includes('20' + NB + '%'), 'FR taux from the stored barème: ' + m.subject);
    assert.ok(m.html.includes('400' + NB + '$'), 'FR amount = 20 % × 2 000 $');
    assert.ok(m.html.includes('$400'), 'EN amount');
    assert.ok(!m.html.includes('30' + NB + '%'), 'the env default never leaks once a barème is stored');
  }
});

test('onOfferRetained accepts the profile from the caller and still works when the notary has no contact yet', async () => {
  const { mailer, notifier } = setup33();
  await notifier.onOfferRetained(retainedBid(), { notary: { id: 'n-1', email: 'jeanne@etude.ca', label: 'Étude Legacy' } });
  const client = mailer.sent.find((m) => m.to === 'client@example.ca');
  assert.ok(client.html.includes('Étude Legacy'), 'the legacy label names the étude');
  assert.ok(!/undefined|null/.test(client.text));
  assert.equal(mailer.sent.filter((m) => m.to === 'jeanne@etude.ca').length, 1);
});

test('onOfferCancelled carries the fee kept (bid.annulation) to the client and to the notary', async () => {
  const { mailer, notifier } = setup33();
  const notary = { id: 'n-1', email: 'jeanne@etude.ca' };
  const bid = retainedBid({ status: 'annulee', annulation: { taux: 0.3, frais: 450, joursAvant: 2, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } } });
  await notifier.onOfferCancelled(bid, { notary, wasRetained: true });
  const client = mailer.sent.find((m) => m.to === 'client@example.ca');
  assert.ok(client.html.includes('450' + NB + '$') && /dédommagement/.test(client.html), 'the client is told what was kept and for whom');
  const n = mailer.sent.find((m) => m.to === 'jeanne@etude.ca');
  assert.ok(n.html.includes('450' + NB + '$') && /vous sont versés/.test(n.html), 'the notary is told what they receive');
  assert.ok(!/régulariser/.test(n.html));
  assert.ok(n.html.includes(href(BASE + '/#notaires&acte=b1')));
});

test('onOfferCancelled without a fee says free on both sides', async () => {
  const { mailer, notifier } = setup33();
  await notifier.onOfferCancelled(retainedBid({ status: 'annulee', annulation: null }), { notary: { id: 'n-1', email: 'jeanne@etude.ca' }, wasRetained: true });
  assert.ok(/sans frais/.test(mailer.sent.find((m) => m.to === 'client@example.ca').html));
  assert.ok(/aucuns frais/.test(mailer.sent.find((m) => m.to === 'jeanne@etude.ca').html));
});

test('client act mails use the deep link when clientLink is wired, and fall back to the client space otherwise', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary({ id: 'n-1', email: 'jeanne@etude.ca', ...CONTACT });
  const bid = retainedBid();
  await notifier.onChatMessage(bid, { id: 'm1', de: 'notaire', texte: 'Bonjour' });
  assert.ok(mailer.sent[0].html.includes(href(BASE + '/#offre=b1&d=2026-08-19&cle=jeton-b1')), 'messageDuNotaire deep-links');
  await notifier.onChatMessage(bid, { id: 'm2', de: 'client', texte: 'Allo' });
  assert.ok(mailer.sent[1].html.includes(href(BASE + '/#notaires&acte=b1')), 'messageDuClient opens the act card');

  const plain = setup({ operatorEmail: null });
  await plain.repo.putNotary({ id: 'n-1', email: 'jeanne@etude.ca', ...CONTACT });
  await plain.notifier.onChatMessage(bid, { id: 'm1', de: 'notaire', texte: 'Bonjour' });
  assert.ok(plain.mailer.sent[0].html.includes(BASE + '/#t=profil'), 'no clientLink → the client space');
  assert.ok(!plain.mailer.sent[0].html.includes('cle='));
});

test('a clientLink that throws never blocks the mail — the CTA falls back', async () => {
  const { repo, mailer, notifier } = setup33({ clientLink: () => { throw new Error('no secret'); } });
  await repo.putNotary({ id: 'n-1', email: 'jeanne@etude.ca', ...CONTACT });
  await notifier.onOfferRetained(retainedBid());
  const client = mailer.sent.find((m) => m.to === 'client@example.ca');
  assert.ok(client && client.html.includes(BASE + '/#t=profil'));
});

// --- instant lead alerts (§7) ---------------------------------------------------

const alertNotary = (id, over = {}) => ({ id, email: id + '@etude.example', status: 'active', prefixe: 'G1V', rayonKm: 25, urgences: false, ...over });
const leadMails = (mailer) => mailer.sent.filter((m) => /Nouvelle demande/.test(m.subject) && m.to !== 'ops@nota.ca');

test('onOfferCreated alerts instantly every active notary on pace « instant » who can serve the demand — once per (bid, notary)', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary(alertNotary('instant', { alertes: { pace: 'instant', urgentOnly: false } }));
  await repo.putNotary(alertNotary('daily', { alertes: { pace: 'daily', urgentOnly: false } }));
  await repo.putNotary(alertNotary('default'));
  await repo.putNotary(alertNotary('off', { alertes: { pace: 'off', urgentOnly: false } }));
  await repo.putNotary(alertNotary('inactive', { status: 'pending', alertes: { pace: 'instant', urgentOnly: false } }));
  await repo.putNotary(alertNotary('farAway', { rayonKm: 0, alertes: { pace: 'instant', urgentOnly: false } }));
  const bid = bidWithEmail({ prefixe: 'G1R', pricing: { deplacement: 'notaire_25', preteur: 'rbc' } });

  await notifier.onOfferCreated(bid);
  await notifier.onOfferCreated(bid); // POST /bids retries never double-alert

  const leads = leadMails(mailer);
  assert.deepEqual(leads.map((m) => m.to), ['instant@etude.example'], 'only the instant notary within reach');
  assert.ok(leads[0].html.includes(href(BASE + '/#notaires&acte=b1')), 'CTA opens the demand in the console');
  assert.ok(leads[0].html.includes('RBC Banque Royale'), 'the lender is named');
  assert.ok(leads[0].html.includes('G1R'), 'the sector is named');
  assert.ok(/km/.test(leads[0].html), 'the measured distance when both sectors are known');
});

test('urgentOnly keeps standard/rapide demands out and lets an elevated tier through', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary(alertNotary('urgent', { alertes: { pace: 'instant', urgentOnly: true } }));
  await notifier.onOfferCreated(bidWithEmail({ id: 'calm', tier: 'standard' }));
  assert.equal(leadMails(mailer).length, 0, 'a standard demand does not ring');
  await notifier.onOfferCreated(bidWithEmail({ id: 'hot', tier: 'urgence' }));
  assert.equal(leadMails(mailer).length, 1);
});

test('a demand that is not live yet (card hold pending) rings nobody; it rings once the hold is authorized', async () => {
  const { repo, mailer, notifier } = setup33();
  await repo.putNotary(alertNotary('instant', { alertes: { pace: 'instant', urgentOnly: false } }));
  const bid = bidWithEmail({ paymentStatus: 'pending' });
  await notifier.onOfferCreated(bid);
  assert.equal(leadMails(mailer).length, 0);
  await notifier.onAccountEvent({ id: 'evt_ok', type: 'checkout.session.completed', data: { object: {} } }, null, { ...bid, paymentStatus: 'authorized' });
  assert.equal(leadMails(mailer).length, 1, 'the authorized demand rings the instant notary');
});

test('a repo without listNotaries keeps onOfferCreated working (no instant alerts)', async () => {
  const { repo, mailer, notifier } = setup33();
  delete repo.listNotaries;
  const r = await notifier.onOfferCreated(bidWithEmail());
  assert.equal(r.ok, true);
  assert.equal(leadMails(mailer).length, 0);
});

// --- support widget (§7) -------------------------------------------------------

test('onSupportReply points the visitor back at the site messagerie; onSupportMessage exposes {{email}} to the operator subject', async () => {
  const { repo, mailer, notifier } = setup33();
  await notifier.onSupportReply({ message: { id: 'sm1', texte: 'Oui.' }, courriel: 'curieux@exemple.ca' });
  assert.ok(mailer.sent[0].html.includes(BASE + '/#messagerie'), 'CTA reopens the widget');
  repo.getEmailOverride = async (key) => (key === 'operatorSupportMessage' ? { key, actif: true, subjectFr: 'Question de {{email}}', subjectEn: 'Question from {{email}}' } : null);
  await notifier.onSupportMessage({ message: { id: 'sm2', texte: 'Allo ?' }, courriel: 'curieux@exemple.ca', replyUrl: BASE + '/#reponse=t' });
  assert.equal(mailer.sent[1].subject, 'Question de curieux@exemple.ca / Question from curieux@exemple.ca');
});

// --- operator is always told of a release (§2.5) ---------------------------------

test('onActReleased always alerts the operator, money in flight or not', async () => {
  const { mailer, notifier } = setup33();
  await notifier.onActReleased(retainedBid({ status: 'ouverte', notaryId: null }), { notary: { id: 'n-1', email: 'jeanne@etude.ca', ...CONTACT }, paidOrHeld: false, message: null });
  const ops = mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(ops.length, 1, 'the operator hears of every withdrawal');
  assert.ok(ops[0].html.includes('Étude Tremblay'));
  assert.ok(ops[0].html.includes('https://admin.nota.example'));
});
