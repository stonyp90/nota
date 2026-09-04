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
  // ADR 0033 — la mise en relation est complète
  'demandeRetenueNotaire',
  'nouvelleDemande',
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
  'operatorDemandeRetenue',
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
  assert.ok(m.html && m.html.includes(emails.PALETTE.brand), 'HTML must carry the Nota brand');
  assert.ok(m.html.includes(res.devLink), 'HTML CTA must carry the magic link');
  assert.ok(m.text.includes(res.devLink), 'text alternative must carry the magic link');
});

// =============================================================================
// ADR 0031 — aucun courriel ne peut décrire un partage d'honoraires
// =============================================================================
//
// Art. 32 du Code de déontologie des notaires : « Le notaire ne peut partager
// ses honoraires avec une personne qui n'est pas membre d'un ordre
// professionnel régi par le Code des professions ». Art. 32.1 2° de la Loi sur
// le notariat : est présumée usurper les fonctions de notaire la personne,
// autre qu'un membre de l'Ordre, agissant comme intermédiaire, qui « obtient
// d'un notaire qu'il abandonne une partie de ses honoraires et frais ».
//
// Depuis l'ADR 0031, Nota ne prélève plus rien sur le montant offert — le
// notaire le reçoit en entier — et facture son propre prix, fixe, au client.
// Une copie qui reparle de « commission », d'un pourcentage de partage ou de
// « la part que le notaire garde » décrirait donc à la fois une infraction et
// une opération que le code ne fait plus. Ce contrat tient la porte fermée sur
// l'ensemble du registre, pas seulement sur les gabarits corrigés une fois.
//
// Art. 68 (publicité incomplète) tient l'autre bout : le client paie DEUX
// lignes, et aucun courriel ne peut lui promettre que la seconde n'existe pas.

// Le texte que l'oeil voit : le HTML sans ses balises (« width="100%" » n'est
// pas une affirmation), plus l'alternative texte et le sujet.
function visible(out) {
  return (
    out.html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ') +
    ' ' + out.text + ' ' + out.subject
  );
}

const RENDER_CTX = {
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  days: 7,
  bids: [{ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, tier: 'rapide' }],
  notaryEmail: 'notaire@example.ca',
  email: 'client@example.ca',
  note: 4,
  commentaire: 'Merci.',
  link: BASE + '/#auth?token=t0k3n',
  code: 'EVEROY',
  baseUrl: BASE,
  unsubscribeUrl: UNSUB,
};

test('ADR 0031 — aucun gabarit ne parle de commission ni d’un pourcentage de partage', () => {
  for (const [name, render] of Object.entries(emails.TEMPLATES)) {
    const v = visible(render(RENDER_CTX));

    // Le mot lui-même : Nota ne prélève aucune commission (art. 32, art. 32.1 2°).
    assert.ok(
      !/commission/i.test(v),
      `${name}: « commission » est réapparu dans un courriel — Nota ne prélève plus rien sur les honoraires (ADR 0031)`
    );

    // Un pourcentage, quel qu'il soit : le prix de Nota est un montant fixe, pas
    // un taux, et la cote ne décide plus d'un dollar (art. 29.1).
    const pct = v.match(/\d+(?:[.,]\d+)?\s*%/);
    assert.ok(
      !pct,
      `${name}: un pourcentage (${pct && pct[0]}) est réapparu — le prix de Nota est un montant fixe, jamais un taux`
    );

    // La périphrase qui disait la même chose sans le mot.
    assert.ok(
      !/part qu[e’']|share (?:they|you) keep|honoraires partagés|fee split/i.test(v),
      `${name}: la copie décrit encore une part prélevée sur les honoraires du notaire`
    );
  }
});

test('ADR 0031 + art. 68 — aucun courriel client ne promet que Nota ne coûte rien de plus', () => {
  const clients = Object.keys(emails.TEMPLATES).filter(
    (n) => emails.TEMPLATE_META[n] && emails.TEMPLATE_META[n].audience === 'client'
  );
  assert.ok(clients.length >= 10, 'le registre client doit rester couvert en entier');

  for (const name of clients) {
    const v = visible(emails.TEMPLATES[name](RENDER_CTX));
    assert.ok(
      !/rien de plus|nothing extra|no extra (?:cost|fee)|sans frais suppl/i.test(v),
      `${name}: le client paie son offre PLUS le prix du service de Nota — le promettre gratuit est une publicité incomplète (art. 68)`
    );
  }
});

test('clientWelcome nomme les deux lignes que le client paie, dans les deux langues', () => {
  // Le pendant positif du test précédent : retirer « rien de plus » ne suffit
  // pas, encore faut-il que la seconde ligne soit dite (art. 68).
  const out = emails.clientWelcome(RENDER_CTX);
  const v = visible(out);
  assert.match(v, /va en entier au notaire/, 'FR: la première ligne revient au notaire');
  assert.match(v, /prix du service de Nota/, 'FR: la seconde ligne est celle de Nota');
  assert.match(v, /goes to the notary in full/, 'EN: same');
  assert.match(v, /price of Nota’s service/, 'EN: same');
  // Le prix lui-même est configurable (`prix-nota-config.js`) : il ne doit pas
  // être gravé dans une chaîne de courriel.
  assert.ok(!/400\s*(?:,00)?\s*\$|\$\s*400/.test(v), 'le montant du prix de Nota ne se code pas en dur');
});

// --- art. 68 et art. 14 — aucune promesse de vitesse jamais mesurée ---------
//
// Art. 68 : aucune publicité fausse, trompeuse ou incomplète. Art. 14 : aucune
// fausse représentation « quant à l'efficacité de ses propres services ».
// Aucun acte n'a encore été conclu sur la plateforme : « retenu beaucoup plus
// vite », « le marché se conclut généralement à » et « augmente vos chances »
// n'ont aucune observation derrière eux. La copie dit le mécanisme — plus de
// préavis, plus de notaires peuvent s'organiser — et rien de plus fort. Même
// règle que le commentaire au-dessus d'`OBTAIN_CHANCE` dans le domaine.
test('art. 68 / art. 14 — aucun courriel client ne promet une vitesse ou un marché non mesurés', () => {
  const clients = Object.keys(emails.TEMPLATES).filter(
    (n) => emails.TEMPLATE_META[n] && emails.TEMPLATE_META[n].audience === 'client'
  );
  for (const name of clients) {
    // dateApproaching change de branche selon le palier : les trois sont tenues.
    for (const tier of ['standard', 'rapide', 'prioritaire', 'urgence', 'extreme']) {
      const v = visible(emails.TEMPLATES[name](Object.assign({}, RENDER_CTX, { tier })));
      assert.ok(
        !/plus vite|plus rapidement|gets taken faster|attracts a notary faster|much faster/i.test(v),
        `${name} (${tier}): une promesse de vitesse comparative, qu'aucune donnée n'appuie`
      );
      assert.ok(
        !/le marché se conclut|the market usually settles/i.test(v),
        `${name} (${tier}): un comportement de marché affirmé alors qu'aucun acte n'a encore été conclu`
      );
      assert.ok(
        !/augmente (?:nettement )?vos chances|improves your chances/i.test(v),
        `${name} (${tier}): une probabilité annoncée que personne n'a mesurée`
      );
    }
  }
});

// =============================================================================
// ADR 0033 — la mise en relation est complète, et la conversation est le canal
// =============================================================================

const NOTAIRE = {
  nom: 'Me Jeanne Tremblay',
  etude: 'Étude Tremblay',
  telephone: '418 555-0199',
  adresse: '12, rue Saint-Jean, Québec (QC) G1R 1N4',
  courriel: 'jeanne@etude.ca',
  lienCNQ: 'https://www.cnq.org/trouver-un-notaire/jeanne-tremblay',
};
// Le barème en vigueur, DÉJÀ chiffré par cancellation-config sur ce montant :
// le gabarit met en forme, il ne calcule rien.
const BAREME = [
  { maxJours: 3, taux: 0.3, frais: 450 },
  { maxJours: 14, taux: 0.1, frais: 150 },
];
const CLIENT_URL = BASE + '/#offre=b1&d=2026-08-19&cle=jeton';
const ACTE_URL = BASE + '/#notaires&acte=b1';
// An href is HTML: `&` reads `&amp;` inside the attribute (the text alternative carries the raw URL).
const ctaCount = (html, url) => (html.match(new RegExp('href="' + url.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length;

test('offerRetained names the notary with a tel: link, the conversation, the withdrawal and the barème, and deep-links to the act', () => {
  const out = emails.offerRetained({ ...BID_CTX, bidId: 'b1', notaire: NOTAIRE, bareme: BAREME, clientUrl: CLIENT_URL });
  assert.ok(out.html.includes('Me Jeanne Tremblay'), 'the notary is named');
  assert.ok(out.html.includes('Étude Tremblay'), 'the étude is named');
  assert.ok(out.html.includes('href="tel:4185550199"'), 'the phone is a tel: link');
  assert.ok(out.html.includes('12, rue Saint-Jean'), 'the address shows');
  assert.ok(out.html.includes('href="mailto:jeanne@etude.ca"'), 'the courriel is a mailto');
  assert.ok(out.html.includes(NOTAIRE.lienCNQ), 'the CNQ fiche link rides along');
  assert.ok(/espace Nota/.test(out.html), 'FR: the conversation lives in the client space');
  assert.ok(/Nota space/.test(out.html), 'EN: same');
  assert.ok(/désister/.test(out.html), 'FR: the notary may still withdraw');
  assert.ok(/withdraw/.test(out.html), 'EN: same');
  // The barème, with the amounts computed upstream, in both languages.
  assert.ok(out.html.includes('30' + NB + '%') && out.html.includes('450' + NB + '$'), 'FR: 30 % → 450 $');
  assert.ok(out.html.includes('30%') && out.html.includes('$450'), 'EN: 30% → $450');
  assert.ok(/gratuit/.test(out.html) && /free/.test(out.html), 'beyond the last palier is free');
  assert.equal(ctaCount(out.html, CLIENT_URL), 2, 'both CTAs open the act deep link');
  assert.ok(out.text.includes(CLIENT_URL));
  assert.ok(out.text.includes('418 555-0199'), 'text alternative carries the phone');
});

test('offerRetained without a deep link falls back to the client space; without a profile it stays honest', () => {
  const out = emails.offerRetained({ ...BID_CTX, bidId: 'b1' });
  assert.equal(ctaCount(out.html, BASE + '/#t=profil'), 2);
  assert.ok(!/undefined|null/.test(out.text), 'no leaked empties: ' + out.text);
});

test('demandeRetenueNotaire hands the notary the client block, the file readiness, what binds them, and the act deep link', () => {
  const out = emails.demandeRetenueNotaire({
    ...BID_CTX, bidId: 'b1',
    client: { nom: 'Marie Roy', courriel: 'marie@exemple.ca', telephone: '(418) 555-0100', secteur: 'G1R', deplacement: 'notaire_25', preteur: 'desjardins' },
    dossier: { ready: false, missing: ['Pièce d’identité'], requis: [] },
    bareme: BAREME,
  });
  assert.ok(out.subject.includes(' / '), 'bilingual subject');
  assert.match(out.subject, /Demande retenue/);
  assert.ok(out.html.includes('Marie Roy'));
  assert.ok(out.html.includes('href="mailto:marie@exemple.ca"'));
  assert.ok(out.html.includes('href="tel:4185550100"'), 'client phone is dialable');
  assert.ok(out.html.includes('G1R'), 'the postal sector');
  assert.ok(out.html.includes(domain.deplacementById('notaire_25').nom), 'the déplacement band, from the domain');
  assert.ok(out.html.includes('Desjardins'), 'the lender, from the domain');
  assert.ok(/Pièce d’identité/.test(out.html), 'the missing item is listed');
  assert.ok(/signature/.test(out.html) && /en entier/.test(out.html), 'FR: honoraires paid in full at signing');
  assert.ok(/in full/.test(out.html), 'EN: same');
  assert.ok(/dédommagement/.test(out.html) && /compensation/.test(out.html), 'the fee is the notary’s compensation');
  assert.ok(out.html.includes('450' + NB + '$') && out.html.includes('$450'), 'the barème amounts on THIS montant');
  assert.ok(/désister/.test(out.html) && /gratuit/.test(out.html), 'withdrawal is free, and counted');
  assert.ok(!/commission/i.test(out.html), 'never a commission');
  assert.equal(ctaCount(out.html, ACTE_URL), 2, 'both CTAs open the retained card');
});

test('demandeRetenueNotaire with a ready file and a client-travel band says so', () => {
  const out = emails.demandeRetenueNotaire({
    ...BID_CTX, bidId: 'b1',
    client: { nom: null, courriel: 'x@exemple.ca', telephone: null, secteur: 'G1V', deplacement: 'client_50', preteur: 'autre', preteurNom: 'Caisse locale' },
    dossier: { ready: true, missing: [], requis: [] },
    bareme: [],
  });
  assert.ok(/Dossier prêt/.test(out.html) && /File ready/.test(out.html));
  assert.ok(out.html.includes('Caisse locale'), 'the typed « autre prêteur » name travels');
  assert.ok(/aucuns frais/.test(out.html), 'an empty barème reads as free');
  assert.ok(!/undefined|null/.test(out.text), out.text);
});

test('offerCancelled tells the client what was kept, and that it goes to the notary', () => {
  const paid = emails.offerCancelled({ ...BID_CTX, bidId: 'b1', annulation: { taux: 0.3, frais: 450, joursAvant: 2 } });
  assert.ok(paid.html.includes('450' + NB + '$') && paid.html.includes('30' + NB + '%'), 'FR: amount + taux');
  assert.ok(paid.html.includes('$450') && paid.html.includes('30%'), 'EN: same');
  assert.ok(/dédommagement/.test(paid.html) && /compensation/.test(paid.html), 'the fee compensates the notary');
  const free = emails.offerCancelled({ ...BID_CTX, bidId: 'b1', annulation: null });
  assert.ok(/sans frais/.test(free.html) && /no fee/.test(free.html), 'null annulation reads as free');
  assert.ok(!/450/.test(free.html));
});

test('offerCancelledNotary is honest about the money — paid, owed, or nothing — and never promises a call from the team', () => {
  const paid = emails.offerCancelledNotary({ ...BID_CTX, bidId: 'b1', annulation: { taux: 0.3, frais: 450, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } } });
  assert.ok(paid.html.includes('450' + NB + '$') && /vous sont versés/.test(paid.html), 'FR: the amount is transferred');
  assert.ok(paid.html.includes('$450') && /transferred to you/.test(paid.html), 'EN: same');
  const owed = emails.offerCancelledNotary({ ...BID_CTX, bidId: 'b1', annulation: { taux: 0.1, frais: 150, dedommagement: { notaire: true, verse: false, transferId: null } } });
  assert.ok(owed.html.includes('150' + NB + '$') && /versements Stripe/.test(owed.html), 'FR: owed until Stripe payouts are wired');
  assert.ok(/Stripe payouts/.test(owed.html), 'EN: same');
  const free = emails.offerCancelledNotary({ ...BID_CTX, bidId: 'b1', annulation: null });
  assert.ok(/aucuns frais/.test(free.html) && /no fee/.test(free.html));
  for (const out of [paid, owed, free]) {
    assert.ok(!/régulariser|notre équipe vous écrit|our team will contact/.test(out.html), 'no false promise');
    assert.equal(ctaCount(out.html, ACTE_URL), 2, 'CTA opens the console at the act');
  }
});

test('nouvelleDemande alerts the notary with the demand, its sector, band, lender and distance, and deep-links to it', () => {
  const out = emails.nouvelleDemande({
    ...BID_CTX, bidId: 'b1', secteur: 'G1R', deplacement: 'client_25', preteur: 'rbc', distanceKm: 6,
  });
  assert.ok(out.subject.includes(' / '));
  assert.match(out.subject, /Nouvelle demande/);
  assert.ok(out.html.includes('1' + NB + '500' + NB + '$') && out.html.includes('$1,500'));
  assert.ok(out.html.includes('G1R'));
  assert.ok(out.html.includes(domain.deplacementById('client_25').nom));
  assert.ok(out.html.includes('RBC Banque Royale'));
  assert.ok(/6 km/.test(out.html), 'the measured distance when known');
  assert.equal(ctaCount(out.html, ACTE_URL), 2);
  const noDist = emails.nouvelleDemande({ ...BID_CTX, bidId: 'b1', secteur: 'G1R' });
  assert.ok(!/ km/.test(noDist.html.replace(/km\b[^<]*<\/a>/g, '')) || !/≈/.test(noDist.html), 'no distance line without a measure');
});

test('operatorDemandeRetenue is a small revenue event, and operator CTAs land on the admin console when configured', () => {
  const out = emails.operatorDemandeRetenue({ ...BID_CTX, bidId: 'b1', etude: 'Étude Tremblay', adminUrl: 'https://admin.nota.example' });
  assert.match(out.subject, /Demande retenue/);
  assert.ok(out.html.includes('Étude Tremblay'));
  assert.equal(ctaCount(out.html, 'https://admin.nota.example'), 2, 'admin console CTA');
  const lead = emails.operatorNewLead({ ...BID_CTX, adminUrl: 'https://admin.nota.example' });
  assert.equal(ctaCount(lead.html, 'https://admin.nota.example'), 2);
  const fallback = emails.operatorNewLead(BID_CTX);
  assert.equal(ctaCount(fallback.html, BASE + '/'), 2, 'no admin URL → the public carnet');
});

test('every client act email deep-links to the act when clientUrl is given; every notary act email opens the act card', () => {
  // (offerCancelled invites a NEW date, so its CTA stays the public carnet.)
  const clientTemplates = ['offerRetained', 'messageDuNotaire', 'documentDuNotaire', 'propositionRecue', 'documentsDemandes', 'dateApproaching', 'dateMissedNoUptake', 'dossierIncomplete', 'offerPublished', 'evaluationInvite', 'actReleased', 'offerAuthorized', 'offerAuthorizationVoided'];
  for (const name of clientTemplates) {
    const out = emails[name]({ ...BID_CTX, bidId: 'b1', clientUrl: CLIENT_URL, days: 3, proposition: { montant: 1600 }, demande: { documents: [] }, message: 'x', document: 'x.pdf' });
    assert.equal(ctaCount(out.html, CLIENT_URL), 2, name + ': CTA must be the client deep link');
  }
  const notaryTemplates = ['messageDuClient', 'documentDuClient', 'propositionAcceptee', 'demandeRetenueNotaire', 'offerCancelledNotary', 'evaluationRecueNotaire', 'nouvelleDemande'];
  for (const name of notaryTemplates) {
    const out = emails[name]({ ...BID_CTX, bidId: 'b1', proposition: { montant: 1600 }, message: 'x', document: 'x.pdf', note: 4, client: {}, dossier: { ready: true, missing: [], requis: [] }, bareme: [] });
    assert.equal(ctaCount(out.html, ACTE_URL), 2, name + ': CTA must open the act card');
  }
});

test('TEMPLATE_META registers the ADR 0033 templates with their audience and placeholders', () => {
  assert.equal(emails.TEMPLATE_META.demandeRetenueNotaire.audience, 'notaire');
  assert.equal(emails.TEMPLATE_META.demandeRetenueNotaire.transactionnel, true);
  assert.equal(emails.TEMPLATE_META.nouvelleDemande.audience, 'notaire');
  assert.equal(emails.TEMPLATE_META.nouvelleDemande.transactionnel, false, 'an alert the notary asked for can be silenced');
  assert.equal(emails.TEMPLATE_META.operatorDemandeRetenue.audience, 'operateur');
  assert.ok(emails.TEMPLATE_META.offerRetained.placeholders.includes('etude'), 'the client subject may name the étude');
});
