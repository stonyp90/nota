import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const emails = require('../src/emails.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { createAdmin } = require('../src/admin.js');
const { createBilling } = require('../src/billing.js');

const BASE = 'https://nota.example';
const UNSUB = BASE + '/unsubscribe?token=abc123';
const NB = ' '; // fr-CA no-break space in money()
const TODAY = '2026-08-12';

// Every user-facing feature of the marketplace has its own dedicated template,
// all rendered through the ONE shared bilingual layout. The generic brand /
// CASL / bilingual assertions in emails-brand.test.mjs iterate the registry, so
// each name listed here is automatically held to the same design contract.
const FEATURE_TEMPLATES = [
  // client — offer lifecycle
  'clientWelcome',
  'offerPublished',
  'dossierIncomplete',
  'dateApproaching',
  'offerRetained',
  'dateMissedNoUptake',
  'offerCancelled',
  'evaluationInvite',
  // client — pay-on-accept lifecycle
  'offerAuthorized',
  'offerAuthorizationVoided',
  // retained-act conversation (chat)
  'messageDuNotaire',
  'messageDuClient',
  // evaluation feedback loop (ADR 0015/0016)
  'evaluationRecueNotaire',
  'operatorLowRating',
  // notary — marketplace lifecycle
  'newMatchingBids',
  'notaryMagicLink',
  'notaryOnboardingStarted',
  'notaryActive',
  'actPaidNotary',
  'notaryDisconnectedWinback',
  'offerCancelledNotary',
  // contact form (nous joindre)
  'contactRecu',
  // admin console
  'adminMagicLink',
  // partner referrals (ADR 0011)
  'partnerWelcome',
  'referralRewardClient',
  'referralRewardNotary',
  // operator alerts
  'operatorNewLead',
  'operatorNotaryActive',
  'operatorActCompleted',
  'operatorNewPartner',
  'operatorOfferCancelled',
  'operatorContactMessage',
];

test('every marketplace feature has its dedicated template in the registry', () => {
  for (const name of FEATURE_TEMPLATES) {
    assert.equal(
      typeof emails.TEMPLATES[name],
      'function',
      `missing dedicated template: ${name}`
    );
  }
});

// --- auth links (admin + notary console) -------------------------------------

test('adminMagicLink renders the sign-in link as the CTA of both language blocks', () => {
  const link = 'https://admin.nota.ca/#/auth?token=t0k3n';
  const out = emails.adminMagicLink({ link, unsubscribeUrl: UNSUB, baseUrl: BASE });
  assert.ok(out.subject.includes(' / '), 'subject must be bilingual');
  assert.match(out.subject, /Nota Admin/);
  const ctas = (out.html.match(new RegExp('href="' + link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
  assert.equal(ctas, 2, 'expected one FR and one EN CTA on the magic link');
  assert.ok(out.text.includes(link), 'text alternative must carry the link');
});

test('notaryMagicLink renders the console sign-in link in both blocks', () => {
  const link = BASE + '/#notaires?token=t0k3n';
  const out = emails.notaryMagicLink({ link, unsubscribeUrl: UNSUB, baseUrl: BASE });
  assert.ok(out.subject.includes(' / '));
  const ctas = (out.html.match(new RegExp('href="' + link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
  assert.equal(ctas, 2);
  assert.ok(out.text.includes(link));
});

test('partnerClaimLink renders the single-use confirmation link in both blocks', () => {
  const link = BASE + '/#pauth=t0k3n';
  const out = emails.partnerClaimLink({ link, code: 'EVEROY', ttlMinutes: 30, unsubscribeUrl: UNSUB, baseUrl: BASE });
  assert.ok(out.subject.includes(' / '), 'subject must be bilingual');
  assert.match(out.subject, /EVEROY/);
  const ctas = (out.html.match(new RegExp('href="' + link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
  assert.equal(ctas, 2, 'expected one FR and one EN CTA on the confirmation link');
  assert.ok(out.text.includes(link), 'text alternative must carry the link');
});

// --- notary onboarding (free Stripe Connect) ---------------------------------

test('notaryOnboardingStarted drives to the hosted onboarding link', () => {
  const url = 'https://connect.stripe.com/setup/s/abc';
  const out = emails.notaryOnboardingStarted({ onboardingUrl: url, unsubscribeUrl: UNSUB, baseUrl: BASE });
  const ctas = (out.html.match(new RegExp('href="' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
  assert.equal(ctas, 2, 'both language CTAs must point at the onboarding URL');
  assert.ok(out.text.includes(url));
});

test('notaryActive announces the account is ready, in both languages', () => {
  const out = emails.notaryActive({ unsubscribeUrl: UNSUB, baseUrl: BASE });
  assert.ok(out.subject.includes(' / '));
  assert.ok(out.html.includes(BASE + '/#notaires'), 'CTA must open the notary console');
});

// --- pay-on-accept: authorization lifecycle ----------------------------------

const BID_CTX = {
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  baseUrl: BASE,
  unsubscribeUrl: UNSUB,
};

test('offerAuthorized confirms the hold and shows the offer in both currencies', () => {
  const out = emails.offerAuthorized(BID_CTX);
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$'), 'missing fr-CA amount');
  assert.ok(out.html.includes('$1,500'), 'missing en-CA amount');
  assert.ok(out.html.includes('Refinancement'), 'missing FR service name');
  assert.ok(out.html.includes('Mortgage refinancing'), 'missing EN service name');
});

test('offerAuthorizationVoided tells the client their offer left the carnet', () => {
  const out = emails.offerAuthorizationVoided(BID_CTX);
  assert.ok(out.subject.includes(' / '));
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$'));
  assert.ok(out.html.includes('$1,500'));
});

// --- payout / act completion -------------------------------------------------

test('actPaidNotary shows the act value via domain money() on each side', () => {
  const out = emails.actPaidNotary({ ...BID_CTX, actAmount: 1500 });
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$'));
  assert.ok(out.html.includes('$1,500'));
});

test('operatorActCompleted alerts the operator with the act line', () => {
  const out = emails.operatorActCompleted({ ...BID_CTX, actAmount: 1500, notaryEmail: 'n@x.ca' });
  assert.ok(out.subject.includes(' / '));
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$'));
});

// --- partner referrals (ADR 0011) --------------------------------------------
// The amounts always come from domain.REFERRAL — a change there must flow into
// the mails with no template edit.

const domain = require('@nota/domain');

test('partnerWelcome carries the shareable link, both reward amounts from the domain, and the type label', () => {
  const out = emails.partnerWelcome({ code: 'EVEROY', type: 'courtier_hypothecaire', baseUrl: BASE, unsubscribeUrl: UNSUB });
  assert.ok(out.subject.includes('EVEROY'));
  const link = BASE + '/?ref=EVEROY';
  const ctas = (out.html.match(new RegExp('href="' + link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;
  assert.ok(ctas >= 2, 'both language CTAs must point at the ?ref link');
  assert.ok(out.text.includes(link));
  // Amounts from domain.REFERRAL via money()/moneyEn(), never literals.
  assert.ok(out.html.includes(domain.money(domain.REFERRAL.client)), 'missing the fr client reward');
  assert.ok(out.html.includes(domain.moneyEn(domain.REFERRAL.notaire)), 'missing the en notary reward');
  // The partner-type label comes from the domain list.
  assert.ok(out.html.includes('Courtier hypothécaire'));
  assert.ok(out.html.includes('Mortgage broker'));
});

test('referralRewardClient announces the flat client reward with the retained demand line', () => {
  const out = emails.referralRewardClient({ ...BID_CTX, code: 'EVEROY' });
  assert.ok(out.subject.includes(domain.money(domain.REFERRAL.client)));
  assert.ok(out.html.includes(domain.moneyEn(domain.REFERRAL.client)));
  assert.ok(out.html.includes('Refinancement'), 'the demand line names the act');
});

test('referralRewardNotary announces the flat notary reward, once-per-notary', () => {
  const out = emails.referralRewardNotary({ code: 'EVEROY', baseUrl: BASE, unsubscribeUrl: UNSUB });
  assert.ok(out.subject.includes(domain.money(domain.REFERRAL.notaire)));
  assert.ok(out.html.includes(domain.moneyEn(domain.REFERRAL.notaire)));
});

test('operatorNewPartner mirrors the operator-alert style with code, type and courriel', () => {
  const out = emails.operatorNewPartner({ code: 'EVEROY', type: 'agent_immobilier', courriel: 'eve@agence.ca', baseUrl: BASE, unsubscribeUrl: UNSUB });
  assert.ok(out.subject.includes('EVEROY'));
  assert.ok(out.html.includes('Agent immobilier'));
  assert.ok(out.html.includes('eve@agence.ca'));
});

// --- notifier wiring ---------------------------------------------------------

function setup() {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  return { repo, mailer, notifier };
}

const pendingBid = (over = {}) => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-08-20',
  montant: 2800,
  tier: 'rapide',
  courriel: 'client@example.ca',
  ...over,
});

test('account.updated for an ACTIVE notary sends notaryActive exactly once', async () => {
  const { mailer, notifier } = setup();
  const event = { id: 'evt_a', type: 'account.updated', data: { object: {} } };
  const notary = { id: 'n-1', email: 'notaire@example.ca', status: 'active' };
  await notifier.onAccountEvent(event, notary);
  await notifier.onAccountEvent(event, notary); // webhook redelivery — no double-send
  const got = mailer.sent.filter((m) => m.to === 'notaire@example.ca');
  assert.equal(got.length, 1, 'notary should be welcomed exactly once');
  assert.ok(got[0].subject.includes(' / '), 'bilingual subject expected');
});

test('account.updated for a notary still onboarding sends nothing', async () => {
  const { mailer, notifier } = setup();
  const event = { id: 'evt_b', type: 'account.updated', data: { object: {} } };
  await notifier.onAccountEvent(event, { id: 'n-2', email: 'notaire@example.ca', status: 'onboarding' });
  assert.equal(mailer.sent.length, 0);
});

test('checkout.session.completed with the authorized bid mails offerAuthorized to the client', async () => {
  const { mailer, notifier } = setup();
  const event = { id: 'evt_c', type: 'checkout.session.completed', data: { object: {} } };
  await notifier.onAccountEvent(event, null, pendingBid());
  const got = mailer.sent.filter((m) => m.to === 'client@example.ca');
  assert.equal(got.length, 1);
});

test('checkout.session.completed without a bid still sends nothing (no notary welcome)', async () => {
  const { mailer, notifier } = setup();
  const event = { id: 'evt_d', type: 'checkout.session.completed', data: { object: {} } };
  await notifier.onAccountEvent(event, null);
  assert.equal(mailer.sent.length, 0);
});

test('checkout.session.expired with the voided bid mails offerAuthorizationVoided', async () => {
  const { mailer, notifier } = setup();
  const event = { id: 'evt_e', type: 'checkout.session.expired', data: { object: {} } };
  await notifier.onAccountEvent(event, null, pendingBid());
  const got = mailer.sent.filter((m) => m.to === 'client@example.ca');
  assert.equal(got.length, 1);
});

test('onNotaryConnected mails the onboarding link once per address', async () => {
  const { mailer, notifier } = setup();
  const url = 'https://connect.stripe.com/setup/s/abc';
  await notifier.onNotaryConnected('Notaire@Example.CA', url);
  await notifier.onNotaryConnected('notaire@example.ca', url); // double-click — no double-send
  const got = mailer.sent.filter((m) => m.to === 'notaire@example.ca');
  assert.equal(got.length, 1);
  assert.ok(got[0].html.includes(url), 'onboarding URL must be the CTA');
});

test('onActPaid mails the payout statement to the notary and alerts the operator, once per bid', async () => {
  const { repo, mailer, notifier } = setup();
  await repo.putNotary({ id: 'n-1', email: 'notaire@example.ca', status: 'active' });
  const bid = pendingBid({ id: 'b9' });
  await notifier.onActPaid({ notaryId: 'n-1', bid, actAmount: 1400 });
  await notifier.onActPaid({ notaryId: 'n-1', bid, actAmount: 1400 }); // idempotent retry
  const toNotary = mailer.sent.filter((m) => m.to === 'notaire@example.ca');
  const toOps = mailer.sent.filter((m) => m.to === 'ops@nota.ca');
  assert.equal(toNotary.length, 1, 'one payout statement to the notary');
  assert.equal(toOps.length, 1, 'one act-completed alert to the operator');
});

// --- billing exposes the affected bid to the webhook route -------------------

test('handleWebhook returns the bid touched by a pay-on-accept event', async () => {
  const repo = createMemoryRepo();
  const stripe = { constructEvent: (raw) => JSON.parse(raw) };
  const billing = createBilling({ repo, stripe, now: () => TODAY });
  await repo.put({ ...pendingBid(), status: 'ouverte', paymentStatus: 'pending' });
  const event = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { metadata: { bidId: 'b1', bidDate: '2026-08-20' }, payment_intent: 'pi_1' } },
  };
  const result = await billing.handleWebhook(JSON.stringify(event), 'sig');
  assert.equal(result.ok, true);
  assert.ok(result.bid, 'handleWebhook must surface the affected bid to the route');
  assert.equal(result.bid.id, 'b1');
});

// --- the admin magic link ships on the shared branded template ---------------

test('the admin sign-in email uses the branded bilingual template, not an inline one-off', async () => {
  const repo = createMemoryRepo();
  const sent = [];
  const admin = createAdmin({
    repo,
    mailer: { send: async (m) => sent.push(m) },
    nowMs: () => 1_700_000_000_000,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const res = await admin.requestLogin({ email: 'ops@nota.ca', ip: '1.2.3.4' });
  assert.equal(res.ok, true);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.ok(m.subject.includes(' / '), 'bilingual subject expected');
  assert.match(m.subject, /Nota Admin/);
  assert.ok(m.html && m.html.includes('#2c5f34'), 'HTML must carry the Nota brand');
  assert.ok(m.html.includes(res.devLink), 'HTML CTA must carry the magic link');
  assert.ok(m.text.includes(res.devLink), 'text alternative must carry the magic link');
});
