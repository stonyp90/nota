// The in-app bell learns of EVERY business event (2026-09-11).
//
// `notifIn` writes one row per event under the recipient's subject (a client's
// offer, a notary's courriel); `GET /notifications` serves it. The 2026-09-11
// inventory found the rows missing for: publication, a document request, the
// J-7/3/1/0 reminders, the cancellation itself, the settled act, the answer to
// a proposal, a refused card hold, and the indemnity expiry sweep. Each case
// below drives the REAL route (or the reminder use-case) and reads the row
// back through the repo, asserting subject, kind, titre (from the domain
// catalogue, never retyped) and refId. The rows are best-effort: a repo
// without the door leaves every route intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { createBilling } = require('../src/billing.js');
const { runReminders } = require('../src/reminders.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const { notaryNotifSubject, clientNotifSubject } = require('../src/keys.js');
import { notarySignIn } from '../test-support/notary-session.mjs';
import { activeNotary } from '../test-support/notary-fixture.mjs';
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const NOTARY_EMAIL = 'jeanne@etude.ca';
const NOTARY = notaryIdForEmail(NOTARY_EMAIL);
const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };

const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
const titreOf = (kind) => domain.NOTIF_KINDS.find((k) => k.id === kind).titre;

function fakeStripe() {
  return {
    async chargeActCommission(args) { return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
    constructEvent(rawBody) { return JSON.parse(rawBody); },
  };
}

function app({ withBilling = false, repo = createMemoryRepo([]) } = {}) {
  let n = 0;
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  const billing = withBilling ? createBilling({ repo, stripe: fakeStripe(), now: () => TODAY }) : undefined;
  return {
    ...createApp(repo, { now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...(billing ? { billing } : {}) }),
    repo, mailer, notifier,
  };
}

async function session(a, email = NOTARY_EMAIL) {
  await a.repo.putNotary(activeNotary(email, { etude: 'Étude Tremblay' }));
  return (await notarySignIn(a, email)).token;
}

async function postBid(a, over = {}) {
  const res = await a.handle({
    method: 'POST', path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2900, courriel: 'client@example.ca', prefixe: 'G1R', pricing: PRICING, ...over }),
  });
  assert.equal(res.statusCode, 201, res.body);
  await flush();
  return parse(res); // { bid, clientToken }
}

const accept = (a, token, b) =>
  a.handle({ method: 'POST', path: '/notary/bids/accept', headers: bearer(token), body: JSON.stringify({ id: b.id, dateISO: b.dateISO }) });

const clientRows = (a, bidId) => a.repo.listNotifications(clientNotifSubject(bidId));
const notaryRows = (a, email = NOTARY_EMAIL) => a.repo.listNotifications(notaryNotifSubject(email));
const ofKind = (rows, kind) => rows.filter((r) => r.kind === kind);

// --- 1. publication ---------------------------------------------------------

test('POST /bids writes « publiee » under the client subject, with the catalogue titre and the offer as refId', async () => {
  const a = app();
  const { bid } = await postBid(a);
  const rows = ofKind(await clientRows(a, bid.id), 'publiee');
  assert.equal(rows.length, 1, 'exactly one publication row');
  assert.equal(rows[0].titre, titreOf('publiee'));
  assert.equal(rows[0].refId, bid.id);
  assert.equal(rows[0].audience, 'client');
  assert.equal(rows[0].lien, '#offre=' + bid.id + '&d=' + bid.dateISO);
  assert.ok(rows[0].corps.includes(domain.money(bid.montant)), 'the body names the amount: ' + rows[0].corps);
  // Served by the client door with the offer's token.
  const got = await a.handle({ method: 'GET', path: '/notifications', query: { id: bid.id }, headers: bearer((await postBid(a)).clientToken) });
  assert.equal(got.statusCode, 403, 'another offer’s token opens nothing');
});

test('an anonymous offer without courriel still rings its own bell (the token is the identity)', async () => {
  const a = app();
  const { bid } = await postBid(a, { courriel: undefined });
  assert.equal(ofKind(await clientRows(a, bid.id), 'publiee').length, 1);
});

// --- 2. documents requested -------------------------------------------------

test('POST /notary/bids/documents writes « documents_demandes » for the client, listing the documents', async () => {
  const a = app();
  const token = await session(a);
  const { bid } = await postBid(a);
  const res = await a.handle({
    method: 'POST', path: '/notary/bids/documents', headers: bearer(token),
    body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, documents: ['offre_preteur'], message: 'Merci.' }),
  });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  const rows = ofKind(await clientRows(a, bid.id), 'documents_demandes');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].titre, titreOf('documents_demandes'));
  assert.equal(rows[0].refId, bid.id);
  const nom = parse(res).demande.documents[0].nom;
  assert.ok(rows[0].corps.includes(nom), 'the body names the document: ' + rows[0].corps);
});

// --- 3. cancellation --------------------------------------------------------

test('cancelling a RETAINED offer writes « annulee » for the client AND for the retaining notary', async () => {
  const a = app();
  const token = await session(a);
  const { bid, clientToken } = await postBid(a);
  assert.equal((await accept(a, token, bid)).statusCode, 200);
  await flush();
  const res = await a.handle({ method: 'POST', path: '/client/bid/cancel', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  const client = ofKind(await clientRows(a, bid.id), 'annulee');
  assert.equal(client.length, 1);
  assert.equal(client[0].titre, titreOf('annulee'));
  assert.equal(client[0].refId, bid.id);
  const notary = ofKind(await notaryRows(a), 'annulee');
  assert.equal(notary.length, 1, 'the notary who retained learns of the cancellation');
  assert.equal(notary[0].audience, 'notaire');
  assert.equal(notary[0].refId, bid.id);
  assert.equal(notary[0].lien, '#notaires&acte=' + bid.id);
});

test('cancelling an OPEN offer writes « annulee » for the client only', async () => {
  const a = app();
  await session(a);
  const { bid, clientToken } = await postBid(a);
  const res = await a.handle({ method: 'POST', path: '/client/bid/cancel', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  assert.equal(ofKind(await clientRows(a, bid.id), 'annulee').length, 1);
  assert.equal(ofKind(await notaryRows(a), 'annulee').length, 0, 'nobody retained: no notary row');
});

// --- 4. act completed -------------------------------------------------------

test('POST /notary/acts/complete writes « acte » for both sides, once', async () => {
  const a = app({ withBilling: true });
  await a.repo.putNotary(activeNotary(NOTARY_EMAIL, { chargesEnabled: true, connectAccountId: 'acct_x', commissionCentsCollected: 0 }));
  const token = (await notarySignIn(a, NOTARY_EMAIL)).token;
  const bid = { id: 'b1', dateISO: '2026-08-20', serviceId: 'refinancement', montant: 4600, status: domain.STATUS.RETENUE, notaryId: NOTARY, courriel: 'client@example.ca' };
  await a.repo.put(bid);
  const complete = () => a.handle({ method: 'POST', path: '/notary/acts/complete', headers: bearer(token), body: JSON.stringify({ bidId: bid.id, dateISO: bid.dateISO, actAmount: 4600 }) });
  assert.equal((await complete()).statusCode, 200);
  await flush();
  const client = ofKind(await clientRows(a, bid.id), 'acte');
  assert.equal(client.length, 1);
  assert.equal(client[0].titre, titreOf('acte'));
  assert.equal(client[0].refId, bid.id);
  const notary = ofKind(await notaryRows(a), 'acte');
  assert.equal(notary.length, 1);
  assert.equal(notary[0].refId, bid.id);
  // A duplicate submit settles idempotently and rings nothing new.
  assert.equal((await complete()).statusCode, 200);
  await flush();
  assert.equal(ofKind(await clientRows(a, bid.id), 'acte').length, 1, 'no second client row');
  assert.equal(ofKind(await notaryRows(a), 'acte').length, 1, 'no second notary row');
});

// --- 5. proposal answered ---------------------------------------------------

async function proposed(a) {
  const token = await session(a);
  const { bid, clientToken } = await postBid(a);
  const res = await a.handle({ method: 'POST', path: '/notary/bids/propose', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, montant: 3600 }) });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  return { bid, clientToken, proposition: parse(res).proposition };
}

test('accepting a proposal writes « proposition_reponse » under the proposing notary', async () => {
  const a = app();
  const { bid, clientToken, proposition } = await proposed(a);
  const res = await a.handle({ method: 'POST', path: '/client/propositions/accept', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, propositionId: proposition.id }) });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  const rows = ofKind(await notaryRows(a), 'proposition_reponse');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].titre, titreOf('proposition_reponse'));
  assert.equal(rows[0].refId, bid.id);
  assert.ok(/accept/i.test(rows[0].corps), 'the body says accepted: ' + rows[0].corps);
  assert.ok(rows[0].corps.includes(domain.money(3600)), 'and names the amount: ' + rows[0].corps);
});

test('declining a proposal writes « proposition_reponse » too, saying so', async () => {
  const a = app();
  const { bid, clientToken, proposition } = await proposed(a);
  const res = await a.handle({ method: 'POST', path: '/client/propositions/decline', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, propositionId: proposition.id }) });
  assert.equal(res.statusCode, 200, res.body);
  await flush();
  const rows = ofKind(await notaryRows(a), 'proposition_reponse');
  assert.equal(rows.length, 1);
  assert.ok(/refus|déclin/i.test(rows[0].corps), 'the body says declined: ' + rows[0].corps);
  assert.equal(ofKind(await clientRows(a, bid.id), 'proposition_reponse').length, 0, 'a notary-only kind never lands on the client');
});

// --- 6. the daily pass: reminders, refused hold, indemnity expiry -----------

function openBidAt(id, offset, over = {}) {
  return {
    id, serviceId: 'refinancement', dateISO: domain.addDays(TODAY, offset), montant: 2400,
    expiresOn: domain.addDays(TODAY, domain.OFFER_VALIDITY_DAYS), tier: domain.tierForDays(Math.max(0, offset)),
    premium: 1.2, status: 'ouverte', anonyme: true, courriel: id + '@example.ca', createdAt: TODAY, dossierReady: true, ...over,
  };
}

test('the reminder pass writes one « rappel » per due J-7/3/1/0 day, idempotent within the day, and never for dossier_incomplet', async () => {
  const repo = createMemoryRepo([openBidAt('j7', 7), openBidAt('j0', 0), openBidAt('quiet', 5), openBidAt('dossier', 10, { dossierReady: false })]);
  const notifier = createNotifier({ repo, mailer: createFakeMailer(), baseUrl: BASE, now: () => TODAY });
  await runReminders({ repo, notifier, now: () => TODAY });
  const j7 = ofKind(await clientRows({ repo }, 'j7'), 'rappel');
  assert.equal(j7.length, 1);
  assert.equal(j7[0].titre, titreOf('rappel'));
  assert.equal(j7[0].refId, 'j7');
  assert.equal(j7[0].lien, '#offre=j7&d=' + domain.addDays(TODAY, 7));
  assert.ok(/7/.test(j7[0].corps), 'the body carries the day count: ' + j7[0].corps);
  const j0 = ofKind(await clientRows({ repo }, 'j0'), 'rappel');
  assert.equal(j0.length, 1, 'J-0 (no notary yet) rings too');
  assert.equal(ofKind(await clientRows({ repo }, 'quiet'), 'rappel').length, 0, 'off-cadence: silent');
  assert.equal((await clientRows({ repo }, 'dossier')).length, 0, 'the dossier nudge is an email, not a bell row');
  // Same day again: nothing doubles.
  await runReminders({ repo, notifier, now: () => TODAY });
  assert.equal(ofKind(await clientRows({ repo }, 'j7'), 'rappel').length, 1, 'idempotent');
});

test('a refused card hold writes « caution » for the client and for the retaining notary', async () => {
  const bid = openBidAt('b1', domain.CAUTION_LEAD_DAYS, { status: 'retenue', notaryId: NOTARY, paymentStatus: 'enregistre', paymentCustomerId: 'cus_b1', paymentMethodId: 'pm_b1' });
  const repo = createMemoryRepo([bid]);
  await repo.putNotary(activeNotary(NOTARY_EMAIL));
  const billing = {
    attendCaution: () => true,
    async placeCaution() { return { ok: false, code: 'caution_refusee', refus: { code: 'card_declined' } }; },
  };
  const notifier = { async onReminderDue() { return { sent: false }; }, async onCautionRefusee() { return { ok: true }; } };
  const res = await runReminders({ repo, notifier, billing, now: () => TODAY });
  assert.equal(res.caution.refusee, 1);
  const client = ofKind(await repo.listNotifications(clientNotifSubject('b1')), 'caution');
  assert.equal(client.length, 1);
  assert.equal(client[0].titre, titreOf('caution'));
  assert.equal(client[0].refId, 'b1');
  const notary = ofKind(await repo.listNotifications(notaryNotifSubject(NOTARY_EMAIL)), 'caution');
  assert.equal(notary.length, 1);
  assert.equal(notary[0].lien, '#notaires&acte=b1');
});

test('the indemnity expiry sweep writes « annulation » for the client (the money outcome), once', async () => {
  const bid = openBidAt('b1', 3, {
    status: domain.STATUS.ANNULEE, notaryId: NOTARY, cancelledAt: domain.addDays(TODAY, -8),
    annulation: { statut: 'en_attente', echeanceISO: domain.addDays(TODAY, -1), taux: 0.1, plafond: 240, joursAvant: 5 },
  });
  const repo = createMemoryRepo([bid]);
  await repo.putNotary(activeNotary(NOTARY_EMAIL));
  const notifier = { async onReminderDue() { return { sent: false }; }, async onIndemniteDecidee() { return { ok: true }; } };
  const res = await runReminders({ repo, notifier, now: () => TODAY });
  assert.equal(res.indemnites.echues, 1);
  const rows = ofKind(await repo.listNotifications(clientNotifSubject('b1')), 'annulation');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].titre, titreOf('annulation'));
  assert.equal(rows[0].refId, 'b1');
  assert.ok(/rien n’est retenu/i.test(rows[0].corps), rows[0].corps);
  // The next day the sweep finds nothing pending: no second row.
  await runReminders({ repo, notifier, now: () => domain.addDays(TODAY, 1) });
  assert.equal(ofKind(await repo.listNotifications(clientNotifSubject('b1')), 'annulation').length, 1);
});

// --- 7. best-effort: a repo without the door leaves every route intact -------

test('a repo without appendNotification changes no route outcome', async () => {
  const repo = createMemoryRepo([]);
  delete repo.appendNotification;
  const a = app({ repo });
  const token = await session(a);
  const { bid, clientToken } = await postBid(a);
  assert.equal((await a.handle({ method: 'POST', path: '/notary/bids/documents', headers: bearer(token), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO, documents: ['offre_preteur'], message: 'Merci.' }) })).statusCode, 200);
  assert.equal((await accept(a, token, bid)).statusCode, 200);
  assert.equal((await a.handle({ method: 'POST', path: '/client/bid/cancel', headers: bearer(clientToken), body: JSON.stringify({ id: bid.id, dateISO: bid.dateISO }) })).statusCode, 200);
  await flush();
  // And the reminder pass runs to completion without the door.
  const res = await runReminders({ repo, notifier: a.notifier, now: () => TODAY });
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
});
