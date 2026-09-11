// Le texto est un canal de consentement EXPRÈS (ADR 0051).
//
// Trois portes, un seul principe : sans consentement enregistré, aucun texto,
// jamais. Le consentement est par destinataire, clé = courriel (comme toute
// préférence) ; le texto part APRÈS le courriel, dans la langue du
// destinataire, et il est UNE ligne : le sujet du gabarit + le lien profond.
// Un texto qui échoue ne coûte jamais le courriel ; un gabarit éteint par
// l'admin, un désabonnement marketing ou un doublon taisent les DEUX canaux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { notarySignIn } from '../test-support/notary-session.mjs';
import { activeNotary } from '../test-support/notary-fixture.mjs';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createFakeSms } = require('../src/sms-port.js');
const { createNotifier } = require('../src/notifications.js');
const { signToken, notaryIdForEmail, SCOPES } = require('../src/notary-auth.js');
const emails = require('../src/emails.js');
const domain = require('@nota/domain');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';
const CLIENT = 'client@example.ca';
const NOTAIRE = 'jeanne@etude.ca';
const PHONE = '(418) 555-0100';
const E164 = '+14185550100';
const clientLink = (bid) => BASE + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle=jeton-' + bid.id;

function setup(over = {}) {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const sms = createFakeSms();
  const notifier = createNotifier({ repo, mailer, sms, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY + 'T14:00:00.000Z', clientLink, ...over });
  return { repo, mailer, sms, notifier };
}

const retainedBid = (over = {}) => ({
  id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-19', montant: 2500, tier: 'prioritaire', premium: 1,
  status: 'retenue', anonyme: true, courriel: CLIENT, nom: 'Marie Roy', telephone: PHONE, prefixe: 'G1R',
  notaryId: 'n-1', createdAt: TODAY, ...over,
});
const seedNotary = (repo, over = {}) => repo.putNotary(activeNotary(NOTAIRE, { id: 'n-1', ...over }));
const consent = (repo, email, telephone = PHONE, value = true) => repo.putSmsConsent(email, { telephone, consent: value, at: TODAY + 'T13:00:00.000Z' });
const mailTo = (mailer, to) => mailer.sent.filter((m) => m.to === to);
const textsTo = (sms, to) => sms.sent.filter((m) => m.to === to);

// --- Le dépôt : consentement par destinataire, clé = courriel -----------------

test('putSmsConsent / getSmsConsent : par courriel normalisé, le retrait (false) s’écrit aussi, absent vaut null', async () => {
  const repo = createMemoryRepo();
  assert.equal(await repo.getSmsConsent(CLIENT), null);
  await repo.putSmsConsent(' Client@Example.ca ', { telephone: PHONE, consent: true, at: TODAY });
  assert.deepEqual(await repo.getSmsConsent(CLIENT), { telephone: PHONE, consent: true, at: TODAY });
  await repo.putSmsConsent(CLIENT, { telephone: PHONE, consent: false, at: TODAY + 'T15:00:00.000Z' });
  assert.deepEqual(await repo.getSmsConsent(CLIENT), { telephone: PHONE, consent: false, at: TODAY + 'T15:00:00.000Z' });
  await repo.deleteSmsConsent(CLIENT);
  assert.equal(await repo.getSmsConsent(CLIENT), null, 'l’effacement (Loi 25) a une porte');
});

// --- Le registre des gabarits : lesquels textent -----------------------------

test('TEMPLATE_META : les 17 gabarits liés à un acte et sensibles au temps textent ; jamais un lien magique, un opérateur, un partenaire ou une campagne', () => {
  const texting = [
    'offerRetained', 'dateApproaching', 'dateMissedNoUptake', 'propositionRecue', 'messageDuNotaire', 'documentsDemandes',
    'offerCancelled', 'actReleased', 'cautionRefusee',
    'demandeRetenueNotaire', 'propositionAcceptee', 'propositionRefusee', 'messageDuClient', 'documentDuClient',
    'offerCancelledNotary', 'nouvelleDemande', 'cautionRefuseeNotaire',
  ];
  for (const key of texting) assert.equal(emails.TEMPLATE_META[key] && emails.TEMPLATE_META[key].sms, true, key);
  const flagged = Object.keys(emails.TEMPLATE_META).filter((k) => emails.TEMPLATE_META[k].sms === true).sort();
  assert.deepEqual(flagged, texting.slice().sort(), 'exactement ces 17 — aucun autre');
  for (const key of flagged) {
    const meta = emails.TEMPLATE_META[key];
    assert.ok(!/MagicLink$/.test(key), key + ' : un lien magique ne texte jamais');
    assert.ok(['client', 'notaire'].includes(meta.audience), key + ' : ' + meta.audience);
  }
});

// --- Le notifieur : la jambe texto, après le courriel ------------------------

test('consentement + téléphone → UN texto après le courriel, en E.164, dérivé du sujet, en français par défaut', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo);
  await consent(repo, CLIENT);
  const bid = retainedBid();
  const r = await notifier.onOfferRetained(bid);
  assert.equal(r.ok, true, JSON.stringify(r));
  const mails = mailTo(mailer, CLIENT);
  assert.equal(mails.length, 1, 'le courriel part');
  const texts = textsTo(sms, E164);
  assert.equal(texts.length, 1, 'exactement un texto : ' + JSON.stringify(sms.sent));
  // Le texte est calculé par le domaine à partir du sujet ENVOYÉ et du lien profond du courriel.
  assert.equal(texts[0].text, domain.smsText({ lang: 'fr', subject: mails[0].subject, url: clientLink(bid) }));
  assert.ok(texts[0].text.startsWith('Nota : '), texts[0].text);
  assert.ok(texts[0].text.length <= domain.SMS_TEXT_MAX);
  // Le résultat de l'envoi le dit, et le registre SENT# porte la jambe texto.
  const client = r.results.find((x) => x.kind === 'offerRetained');
  assert.deepEqual(client.sms, { sent: true, to: E164 });
  assert.equal(await repo.wasNotificationSent(bid.id, 'offerRetained:sms'), true);
  // Le journal Loi 25 (« ce que Nota vous a envoyé ») porte le texto comme fait distinct.
  const events = await repo.listSubjectEvents(CLIENT);
  assert.ok(events.some((e) => e.kind === 'offerRetained:sms'), JSON.stringify(events));
});

test('le texto parle la langue du destinataire : un client en anglais reçoit « Nota: » et le sujet anglais', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo);
  await consent(repo, CLIENT);
  await repo.putEmailLanguage(CLIENT, 'en');
  const bid = retainedBid();
  await notifier.onOfferRetained(bid);
  const [mail] = mailTo(mailer, CLIENT);
  const [text] = textsTo(sms, E164);
  assert.ok(text, 'un texto');
  assert.equal(text.text, domain.smsText({ lang: 'en', subject: mail.subject, url: clientLink(bid) }));
  assert.ok(text.text.startsWith('Nota: '), text.text);
});

test('le notaire consentant reçoit son texto avec le lien de sa console sur l’acte', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo, { telephone: '514 555 0199' });
  await consent(repo, NOTAIRE, '514 555 0199');
  const bid = retainedBid();
  await notifier.onOfferRetained(bid);
  const [mail] = mailTo(mailer, NOTAIRE);
  const texts = textsTo(sms, '+15145550199');
  assert.equal(texts.length, 1, JSON.stringify(sms.sent));
  assert.equal(texts[0].text, domain.smsText({ lang: 'fr', subject: mail.subject, url: BASE + '/#notaires&acte=' + bid.id }));
  assert.equal(textsTo(sms, E164).length, 0, 'le client, sans consentement, ne reçoit rien');
});

test('sans consentement enregistré → aucun texto, même avec un téléphone sur l’offre', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo);
  await notifier.onOfferRetained(retainedBid());
  assert.equal(mailTo(mailer, CLIENT).length, 1);
  assert.equal(sms.sent.length, 0, JSON.stringify(sms.sent));
});

test('consentement retiré (false) → aucun texto', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo);
  await consent(repo, CLIENT, PHONE, false);
  await notifier.onOfferRetained(retainedBid());
  assert.equal(mailTo(mailer, CLIENT).length, 1);
  assert.equal(sms.sent.length, 0);
});

test('consentement mais gabarit non marqué (offerPublished) → courriel seul', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await consent(repo, CLIENT);
  assert.notEqual(emails.TEMPLATE_META.offerPublished.sms, true);
  await notifier.onOfferCreated(retainedBid({ status: 'ouverte', notaryId: undefined }));
  assert.equal(mailTo(mailer, CLIENT).length, 1);
  assert.equal(sms.sent.length, 0);
});

test('consentement sans numéro composable → aucun texto (jamais une devinette)', async () => {
  const { repo, sms, notifier } = setup();
  await seedNotary(repo);
  await consent(repo, CLIENT, '+33 6 12 34 56 78');
  await notifier.onOfferRetained(retainedBid());
  assert.equal(sms.sent.length, 0);
});

test('idempotent : le même refId/kind ne texte pas deux fois', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await seedNotary(repo);
  await consent(repo, CLIENT);
  const bid = retainedBid();
  await notifier.onOfferRetained(bid);
  await notifier.onOfferRetained(bid);
  assert.equal(mailTo(mailer, CLIENT).length, 1);
  assert.equal(textsTo(sms, E164).length, 1);
});

test('le coupe-circuit admin (gabarit relationnel éteint) tait LES DEUX canaux', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await consent(repo, CLIENT);
  assert.equal(emails.TEMPLATE_META.dateApproaching.sms, true);
  assert.equal(emails.TEMPLATE_META.dateApproaching.transactionnel, false, 'seul un gabarit relationnel s’éteint (art. 68)');
  await repo.putEmailOverride({ key: 'dateApproaching', actif: false }, TODAY);
  const r = await notifier.onReminderDue(retainedBid({ status: 'ouverte', dateISO: '2026-08-15' }), 'j3', TODAY);
  assert.equal(r.reason, 'disabled');
  assert.equal(mailer.sent.length, 0);
  assert.equal(sms.sent.length, 0);
});

test('un désabonnement marketing tait le courriel relationnel ET son texto', async () => {
  const { repo, mailer, sms, notifier } = setup();
  await consent(repo, CLIENT);
  await repo.putUnsubscribe(CLIENT, TODAY);
  const r = await notifier.onReminderDue(retainedBid({ status: 'ouverte', dateISO: '2026-08-15' }), 'j3', TODAY);
  assert.equal(r.reason, 'unsubscribed');
  assert.equal(mailer.sent.length, 0);
  assert.equal(sms.sent.length, 0);
});

test('un texto qui échoue ne coûte jamais le courriel : le résultat le dit, le registre ne le marque pas', async () => {
  const sms = { sent: [], async send() { throw new Error('carrier down'); } };
  const { repo, mailer, notifier } = setup({ sms });
  await seedNotary(repo);
  await consent(repo, CLIENT);
  const bid = retainedBid();
  const r = await notifier.onOfferRetained(bid);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(mailTo(mailer, CLIENT).length, 1, 'le courriel est parti');
  const client = r.results.find((x) => x.kind === 'offerRetained');
  assert.equal(client.sent, true);
  assert.deepEqual(client.sms, { sent: false, reason: 'sms-failed' });
  assert.equal(await repo.wasNotificationSent(bid.id, 'offerRetained'), true);
  assert.equal(await repo.wasNotificationSent(bid.id, 'offerRetained:sms'), false, 'un envoi raté reste dû');
});

test('sans port SMS (notifieur sans `sms`), le consentement ne change rien au courriel', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, now: () => TODAY, clientLink });
  await seedNotary(repo);
  await consent(repo, CLIENT);
  const r = await notifier.onOfferRetained(retainedBid());
  assert.equal(r.ok, true);
  assert.equal(mailTo(mailer, CLIENT).length, 1);
  assert.equal(r.results.find((x) => x.kind === 'offerRetained').sms, undefined);
});

// --- Les routes : où le consentement se pose ---------------------------------

const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' };
function app(opts = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const sms = createFakeSms();
  const notifier = createNotifier({ repo, mailer, sms, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY, clientLink });
  return { ...createApp(repo, { siteUrl: BASE, now: () => TODAY, nowMs: () => NOW_MS, newId: () => 'id-' + ++n, notifier, ...opts }), repo, mailer, sms };
}
const parse = (res) => JSON.parse(res.body);
const bearer = (token) => ({ authorization: 'Bearer ' + token });
const call = (a, method, path, { token, body, query } = {}) =>
  a.handle({ method, path, ...(token ? { headers: bearer(token) } : {}), ...(body ? { body: JSON.stringify(body) } : {}), query: query || {} });
const postBid = (a, over = {}) => call(a, 'POST', '/bids', { body: { serviceId: 'refinancement', dateISO: '2026-08-22', montant: 2500, courriel: CLIENT, nom: 'Marie Roy', prefixe: 'G1R', pricing: PRICING, telephone: PHONE, ...over } });
const clientToken = (bidId) => signToken(bidId, NOW_MS + 60_000, SCOPES.CLIENT);

test('POST /bids : smsConsent:true avec téléphone → 201 et un consentement enregistré sous le courriel ; rien ne fuit', async () => {
  const a = app();
  const res = await postBid(a, { smsConsent: true });
  assert.equal(res.statusCode, 201, res.body);
  const body = parse(res);
  assert.equal(JSON.stringify(body).includes('smsConsent'), false, 'jamais dans une projection');
  assert.deepEqual(await a.repo.getSmsConsent(CLIENT), { telephone: PHONE, consent: true, at: TODAY });
  const month = parse(await call(a, 'GET', '/bids', { query: { month: '2026-08' } }));
  assert.equal(JSON.stringify(month).includes('smsConsent'), false, 'jamais sur le carnet');
  const stored = await a.repo.get(body.bid.id, body.bid.dateISO);
  assert.equal(stored.smsConsent, undefined, 'le consentement n’est pas un attribut de l’offre');
});

test('POST /bids : smsConsent:false s’écrit aussi — c’est un retrait exprès ; absent ne touche pas au registre', async () => {
  const a = app();
  await a.repo.putSmsConsent(CLIENT, { telephone: PHONE, consent: true, at: '2026-08-01' });
  assert.equal((await postBid(a, { smsConsent: false })).statusCode, 201);
  assert.equal((await a.repo.getSmsConsent(CLIENT)).consent, false);
  await a.repo.putSmsConsent(CLIENT, { telephone: PHONE, consent: true, at: '2026-08-01' });
  assert.equal((await postBid(a, {})).statusCode, 201);
  assert.deepEqual(await a.repo.getSmsConsent(CLIENT), { telephone: PHONE, consent: true, at: '2026-08-01' }, 'une offre muette sur le texto ne retire rien');
});

test('POST /bids : consentir sans téléphone → 422 telephone_requis_sms ; un consentement non booléen → 422 sms_consent_invalide', async () => {
  const a = app();
  let res = await postBid(a, { smsConsent: true, telephone: '' });
  assert.equal(res.statusCode, 422, res.body);
  assert.ok(parse(res).errors.some((e) => e.code === 'telephone_requis_sms'), res.body);
  res = await postBid(a, { smsConsent: 'oui' });
  assert.equal(res.statusCode, 422, res.body);
  assert.ok(parse(res).errors.some((e) => e.code === 'sms_consent_invalide'), res.body);
  assert.equal(await a.repo.getSmsConsent(CLIENT), null, 'rien n’est écrit sur un refus');
});

test('bout en bout : un client qui a coché le texto reçoit UN SMS quand un notaire retient sa demande', async () => {
  const a = app();
  await a.repo.putNotary(activeNotary(NOTAIRE, { prefixe: 'G1R', rayonKm: 25 }));
  const { token } = await notarySignIn(a, NOTAIRE);
  const bid = parse(await postBid(a, { smsConsent: true })).bid;
  assert.equal(a.sms.sent.length, 0, 'publier ne texte pas (offerPublished n’est pas marqué)');
  const acc = await call(a, 'POST', '/notary/bids/accept', { token, body: { id: bid.id, dateISO: bid.dateISO } });
  assert.equal(acc.statusCode, 200, acc.body);
  const texts = textsTo(a.sms, E164);
  assert.equal(texts.length, 1, JSON.stringify(a.sms.sent));
  const mail = mailTo(a.mailer, CLIENT).find((m) => /retenu/i.test(m.subject));
  assert.ok(mail, 'le courriel « demande retenue »');
  assert.equal(texts[0].text.split(' — ')[0], 'Nota : ' + mail.subject);
});

test('POST /notary/profile : alertes.sms:true avec téléphone → consentement du notaire ; sans téléphone → 422 telephone_requis_sms', async () => {
  const a = app();
  await a.repo.putNotary(activeNotary(NOTAIRE));
  const { token } = await notarySignIn(a, NOTAIRE);
  let res = await call(a, 'POST', '/notary/profile', { token, body: { alertes: { pace: 'instant', urgentOnly: false, sms: true } } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res).profil.alertes, { pace: 'instant', urgentOnly: false, sms: true });
  assert.deepEqual(await a.repo.getSmsConsent(NOTAIRE), { telephone: '418 555 0100', consent: true, at: TODAY });
  // L'interrupteur à « off » est un retrait exprès.
  res = await call(a, 'POST', '/notary/profile', { token, body: { alertes: { pace: 'instant', urgentOnly: false, sms: false } } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await a.repo.getSmsConsent(NOTAIRE)).consent, false);
  // Sans numéro sur le profil, on ne peut pas consentir à un texto.
  res = await call(a, 'POST', '/notary/profile', { token, body: { telephone: '', alertes: { pace: 'daily', urgentOnly: false, sms: true } } });
  assert.equal(res.statusCode, 422, res.body);
  assert.ok(parse(res).errors.some((e) => e.code === 'telephone_requis_sms'), res.body);
  assert.equal((await a.repo.getSmsConsent(NOTAIRE)).consent, false, 'un refus n’écrit rien');
  // Un corps sans `sms` garde le défaut (faux) — jamais un consentement déduit.
  res = await call(a, 'POST', '/notary/profile', { token, body: { alertes: { pace: 'weekly', urgentOnly: true } } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).profil.alertes.sms, false);
});

test('GET/POST /notification-preferences : le texto s’y lit (numéro masqué) et s’y retire ; consentir sans numéro → 422', async () => {
  const a = app();
  const bid = parse(await postBid(a, { smsConsent: true })).bid;
  const q = { id: bid.id, dateISO: bid.dateISO };
  let res = await call(a, 'GET', '/notification-preferences', { token: clientToken(bid.id), query: q });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res).sms, { consent: true, telephone: '••• ••• 0100' });
  res = await call(a, 'POST', '/notification-preferences', { token: clientToken(bid.id), query: q, body: { smsConsent: false } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(parse(res).sms, { consent: false, telephone: '••• ••• 0100' });
  assert.equal((await a.repo.getSmsConsent(CLIENT)).consent, false);
  res = await call(a, 'POST', '/notification-preferences', { token: clientToken(bid.id), query: q, body: { smsConsent: true } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(parse(res).sms.consent, true, 'le numéro enregistré sert au retour');
  // Quelqu'un sans numéro connu ne peut pas consentir d'ici.
  const b2 = parse(await call(a, 'POST', '/bids', { body: { serviceId: 'refinancement', dateISO: '2026-08-23', montant: 2500, courriel: 'sans@example.ca', nom: 'Sans Tel', prefixe: 'G1R', pricing: PRICING } })).bid;
  res = await call(a, 'GET', '/notification-preferences', { token: clientToken(b2.id), query: { id: b2.id, dateISO: b2.dateISO } });
  assert.deepEqual(parse(res).sms, { consent: false, telephone: null });
  res = await call(a, 'POST', '/notification-preferences', { token: clientToken(b2.id), query: { id: b2.id, dateISO: b2.dateISO }, body: { smsConsent: true } });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(parse(res).error, 'telephone_requis_sms');
  res = await call(a, 'POST', '/notification-preferences', { token: clientToken(bid.id), query: q, body: { smsConsent: 'oui' } });
  assert.equal(res.statusCode, 422, res.body);
});
