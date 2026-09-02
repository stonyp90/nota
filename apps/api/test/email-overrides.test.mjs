// Admin-parametrizable templates — the CONSUMPTION side of the override port:
//   repo.getEmailOverride(key) ->
//     { key, actif, subjectFr/En, preheaderFr/En, corpsFr/En, ctaFr/En, updatedAt } | null
// The port is optional (guarded with a typeof check), read through a 60s TTL
// cache keyed on the injected clock, and can (a) turn a RELATIONAL template
// off, (b) reword its subject, preheader, body and CTA via {{token}}
// interpolation. TEMPLATE_META describes every registry key for the admin
// console — audience, labels, token vocabulary, and whether the template is
// transactional. The auth-critical direct sends (notary magic link, partner
// claim link, admin magic link) are NOT overridable at all.
// `emails.validateOverride(key, payload)` is the pure gate the console calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const emails = require('../src/emails.js');
const domain = require('@nota/domain');

const BASE = 'https://nota.example';
const TODAY = '2026-08-12T09:00:00.000Z';
const NB = ' '; // fr-CA no-break space in money()

const bid = (over = {}) => ({
  id: 'b1',
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  status: 'ouverte',
  courriel: 'client@example.ca',
  ...over,
});

// A repo whose getEmailOverride is instrumented: overrides.set(key, record).
function setup({ nowISO = TODAY } = {}) {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const overrides = new Map();
  let calls = 0;
  repo.getEmailOverride = async (key) => {
    calls += 1;
    return overrides.get(key) || null;
  };
  let clock = nowISO;
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: null, now: () => clock });
  return { repo, mailer, notifier, overrides, callCount: () => calls, setClock: (iso) => { clock = iso; } };
}

// --- TEMPLATE_META covers the registry, exactly -------------------------------

test('TEMPLATE_META covers exactly Object.keys(TEMPLATES)', () => {
  const keys = Object.keys(emails.TEMPLATES).sort();
  const meta = Object.keys(emails.TEMPLATE_META).sort();
  assert.deepEqual(meta, keys);
});

test('every TEMPLATE_META entry is complete: audience, labels, default subjects, placeholder vocabulary', () => {
  const AUDIENCES = ['client', 'notaire', 'partenaire', 'operateur', 'admin'];
  const VOCAB = ['montant', 'service', 'date', 'code', 'n', 'note', 'etude', 'email'];
  for (const [key, m] of Object.entries(emails.TEMPLATE_META)) {
    assert.ok(AUDIENCES.includes(m.audience), `${key}: bad audience ${m.audience}`);
    for (const f of ['labelFr', 'labelEn', 'defaultSubjectFr', 'defaultSubjectEn']) {
      assert.ok(typeof m[f] === 'string' && m[f].trim(), `${key}: missing ${f}`);
    }
    assert.ok(Array.isArray(m.placeholders), `${key}: placeholders must be an array`);
    for (const p of m.placeholders) {
      assert.ok(VOCAB.includes(p), `${key}: unknown placeholder ${p}`);
    }
    // Any {{token}} shown in a default subject must be a declared placeholder.
    for (const side of ['defaultSubjectFr', 'defaultSubjectEn']) {
      for (const [, tok] of m[side].matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
        assert.ok(m.placeholders.includes(tok), `${key}: ${side} uses undeclared {{${tok}}}`);
      }
    }
  }
});

// --- renderSubjectOverride ----------------------------------------------------

test('renderSubjectOverride interpolates the vocabulary per language and joins FR / EN', () => {
  const s = emails.renderSubjectOverride(
    { subjectFr: 'Offre {{montant}} — {{service}} le {{date}}', subjectEn: 'Offer {{montant}} — {{service}} on {{date}}' },
    { montant: 1500, serviceId: 'refinancement', dateISO: '2026-08-19' }
  );
  assert.ok(s.includes('1' + NB + '500' + NB + '$'), 'fr money: ' + s);
  assert.ok(s.includes('$1,500'), 'en money');
  assert.ok(s.includes('Refinancement') && s.includes('Mortgage refinancing'), 'service per language');
  assert.ok(s.includes(' / '), 'bilingual join');
});

test('renderSubjectOverride: unknown/missing tokens become empty, newlines are stripped', () => {
  const s = emails.renderSubjectOverride(
    { subjectFr: 'A {{inconnu}} {{code}}\nB', subjectEn: 'C {{note}} D' },
    { code: 'EVEROY' }
  );
  assert.equal(s, 'A  EVEROY B / C  D');
});

test('renderSubjectOverride requires BOTH sides — a half-configured override returns null', () => {
  assert.equal(emails.renderSubjectOverride({ subjectFr: 'Seulement FR' }, {}), null);
  assert.equal(emails.renderSubjectOverride({ subjectFr: '', subjectEn: 'Only EN' }, {}), null);
  assert.equal(emails.renderSubjectOverride({ subjectFr: '  ', subjectEn: 'Only EN' }, {}), null);
  assert.equal(emails.renderSubjectOverride(null, {}), null);
});

// --- sendOnce consumption -----------------------------------------------------

// L'interrupteur ne coupe QUE le relationnel : `clientWelcome` est une
// bienvenue de conversion, pas l'accusé d'un geste que la personne a posé.
test('a disabled template is not sent (reason: disabled) and is not marked in the SENT ledger', async () => {
  const { repo, mailer, notifier, overrides } = setup();
  overrides.set('clientWelcome', { key: 'clientWelcome', enabled: false, subjectFr: null, subjectEn: null, updatedAt: TODAY });

  const r = await notifier.onClientSignup('client@example.ca');
  assert.equal(r.ok, true);
  assert.deepEqual(r.results[0], { sent: false, reason: 'disabled', kind: 'clientWelcome' });
  assert.equal(mailer.sent.length, 0);
  // Not marked sent: re-enabling later lets the mail go out.
  assert.equal(await repo.wasNotificationSent('client@example.ca', 'clientWelcome'), false);
});

test('a subject override is applied with placeholder interpolation; the body stays the template', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', {
    key: 'offerPublished', enabled: true,
    subjectFr: 'Votre demande {{service}} de {{montant}}', subjectEn: 'Your {{service}} request of {{montant}}',
    updatedAt: TODAY,
  });

  await notifier.onOfferCreated(bid());
  assert.equal(mailer.sent.length, 1);
  const m = mailer.sent[0];
  assert.equal(m.subject, 'Votre demande Refinancement hypothécaire de 1' + NB + '500' + NB + '$ / Your Mortgage refinancing request of $1,500');
  assert.ok(m.html.includes('Votre offre est publiée'), 'the HTML body is untouched');
});

test('the override cache holds for 60s on the injected clock, then refetches', async () => {
  const { notifier, overrides, callCount, setClock } = setup();
  overrides.set('offerPublished', { key: 'offerPublished', enabled: true, subjectFr: 'X', subjectEn: 'Y', updatedAt: TODAY });

  await notifier.onOfferCreated(bid({ id: 'b1' }));
  await notifier.onOfferCreated(bid({ id: 'b2' }));
  assert.equal(callCount(), 1, 'two sends inside the TTL cost one override read');

  // Advance the injected clock past the TTL: the next send refetches.
  setClock('2026-08-12T09:01:01.000Z');
  await notifier.onOfferCreated(bid({ id: 'b3' }));
  assert.equal(callCount(), 2, 'a send past the TTL refetches the override');
});

test('a repo without getEmailOverride is untouched — everything sends as before', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: null, now: () => TODAY });
  const r = await notifier.onOfferCreated(bid());
  assert.equal(r.results[0].sent, true);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /Votre offre est en ligne/);
});

test('a broken override store never blocks mail', async () => {
  const repo = createMemoryRepo();
  repo.getEmailOverride = async () => { throw new Error('dynamo down'); };
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: null, now: () => TODAY });
  const r = await notifier.onOfferCreated(bid());
  assert.equal(r.results[0].sent, true);
  assert.equal(mailer.sent.length, 1);
});

test('the notary magic link is NOT overridable — auth-critical mail ignores a disable', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('notaryMagicLink', { key: 'notaryMagicLink', enabled: false, subjectFr: 'Piégé', subjectEn: 'Trap', updatedAt: TODAY });
  const r = await notifier.onNotaryLoginRequested({ email: 'n@etude.ca', link: BASE + '/#nauth=t', ttlMinutes: 15 });
  assert.equal(r.sent, true, 'the sign-in link must always go out');
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /Espace notaire/, 'the built-in subject stands');
});

// =============================================================================
// Surcharge complète d'un gabarit — sujet, préheader, corps, CTA, interrupteur
// =============================================================================
//
// Le propriétaire : « tout doit être configurable dans la plateforme admin ».
// La surcharge ne se limite donc plus au sujet. Deux garde-fous encadrent cette
// ouverture :
//   - art. 68 du Code de déontologie (aucune publicité fausse, trompeuse ou
//     INCOMPLÈTE) : un gabarit transactionnel — l'accusé d'un geste posé, un
//     mouvement d'argent, un acte qui change de mains — ne peut pas être
//     éteint ; le taire priverait la personne d'un fait qu'elle doit connaître ;
//   - art. 56 1° (inciter « de façon pressante ou répétée ») : à l'inverse, les
//     relances, digests et invitations DOIVENT pouvoir être coupés.
// Le texte, lui, vient d'une console admin et finit dans un courriel : il est
// refusé s'il contient du HTML, et échappé de toute façon à l'insertion.

const TRANSACTIONNELS = [
  'actPaidNotary',
  'actReleased',
  'adminMagicLink',
  'contactRecu',
  'dateMissedNoUptake',
  // ADR 0032 — une pièce arrivée dans un dossier en cours est un fait que son
  // destinataire doit connaître pour avancer. La taire serait une publicité
  // « incomplète » au sens de l'art. 68.
  'documentDuClient',
  'documentDuNotaire',
  'documentsDemandes',
  'messageDuClient',
  'messageDuNotaire',
  'notaryActive',
  'notaryMagicLink',
  'offerAuthorizationVoided',
  'offerAuthorized',
  'offerCancelled',
  'offerCancelledNotary',
  'offerPublished',
  'offerRetained',
  'partnerClaimLink',
  'partnerWelcome',
  'propositionAcceptee',
  'propositionRecue',
  'propositionRefusee',
  'referralRewardClient',
  'referralRewardNotary',
  'supportReponse',
];

test('TEMPLATE_META classe chaque gabarit : transactionnel (jamais coupable) ou relationnel', () => {
  for (const [key, m] of Object.entries(emails.TEMPLATE_META)) {
    assert.equal(typeof m.transactionnel, 'boolean', `${key}: transactionnel manquant`);
  }
  const actual = Object.entries(emails.TEMPLATE_META)
    .filter(([, m]) => m.transactionnel)
    .map(([k]) => k)
    .sort();
  assert.deepEqual(actual, TRANSACTIONNELS);
  // Toute alerte opérateur est du courrier interne de Nota : coupable.
  for (const [key, m] of Object.entries(emails.TEMPLATE_META)) {
    if (m.audience === 'operateur') assert.equal(m.transactionnel, false, `${key} doit rester coupable`);
  }
});

// --- validateOverride — le validateur pur -------------------------------------

test('validateOverride refuse une clé de gabarit inconnue', () => {
  const r = emails.validateOverride('gabaritQuiNexistePas', { subjectFr: 'A', subjectEn: 'B' });
  assert.equal(r.ok, false);
  assert.equal(r.override, null);
  assert.equal(r.errors[0].code, 'modele_inconnu');
});

test('validateOverride normalise une surcharge complète et valide', () => {
  const r = emails.validateOverride('offerPublished', {
    actif: true,
    subjectFr: '  Offre {{montant}}  ', subjectEn: 'Offer {{montant}}',
    preheaderFr: 'Votre dossier', preheaderEn: 'Your file',
    corpsFr: 'Votre offre de {{montant}} pour {{service}} le {{date}} est en ligne.',
    corpsEn: 'Your {{montant}} offer for {{service}} on {{date}} is live.',
    ctaFr: 'Compléter', ctaEn: 'Complete',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.override.key, 'offerPublished');
  assert.equal(r.override.actif, true);
  assert.equal(r.override.subjectFr, 'Offre {{montant}}', 'les bords sont rognés');
  // `enabled` reste écrit tant que les adaptateurs de dépôt ne connaissent que ce nom.
  assert.equal(r.override.enabled, true);
  assert.equal(r.override.ctaEn, 'Complete');
});

test('validateOverride rend null tout champ vide — une surcharge absente n’est pas une surcharge vide', () => {
  const r = emails.validateOverride('offerPublished', { subjectFr: '   ', subjectEn: '' });
  assert.equal(r.ok, true);
  assert.equal(r.override.subjectFr, null);
  assert.equal(r.override.corpsFr, null);
  assert.equal(r.override.actif, true, 'actif par défaut');
});

test('validateOverride refuse un jeton absent du vocabulaire du gabarit, dans chaque champ', () => {
  // offerPublished déclare [montant, service, date] — {{code}} n’en fait pas partie.
  for (const [fr, en] of [['subjectFr', 'subjectEn'], ['preheaderFr', 'preheaderEn'], ['corpsFr', 'corpsEn'], ['ctaFr', 'ctaEn']]) {
    const r = emails.validateOverride('offerPublished', { [fr]: 'X {{code}}', [en]: 'X {{code}}' });
    assert.equal(r.ok, false, fr);
    assert.equal(r.errors[0].code, 'jeton_inconnu', fr);
    assert.match(r.errors[0].message, /\{\{code\}\}/);
    assert.match(r.errors[0].message, /montant/, 'le message nomme les jetons permis');
  }
});

test('validateOverride borne la longueur de chaque champ', () => {
  const L = emails.OVERRIDE_LIMITS;
  const cases = [
    ['subjectFr', 'subjectEn', L.sujet, 'sujet_trop_long'],
    ['preheaderFr', 'preheaderEn', L.preheader, 'preheader_trop_long'],
    ['corpsFr', 'corpsEn', L.corps, 'corps_trop_long'],
    ['ctaFr', 'ctaEn', L.cta, 'cta_trop_long'],
  ];
  for (const [fr, en, max, code] of cases) {
    const long = 'a'.repeat(max + 1);
    const r = emails.validateOverride('offerPublished', { [fr]: long, [en]: long });
    assert.equal(r.ok, false, fr);
    assert.equal(r.errors[0].code, code, fr);
    const ok = emails.validateOverride('offerPublished', { [fr]: 'a'.repeat(max), [en]: 'a'.repeat(max) });
    assert.equal(ok.ok, true, `${fr}: ${max} caractères doit passer`);
  }
});

test('validateOverride refuse le HTML dans tout champ texte', () => {
  for (const [fr, en] of [['subjectFr', 'subjectEn'], ['preheaderFr', 'preheaderEn'], ['corpsFr', 'corpsEn'], ['ctaFr', 'ctaEn']]) {
    const r = emails.validateOverride('offerPublished', { [fr]: 'Bonjour <b>vous</b>', [en]: 'Hello you' });
    assert.equal(r.ok, false, fr);
    assert.equal(r.errors[0].code, 'html_interdit', fr);
  }
  const script = emails.validateOverride('offerPublished', {
    corpsFr: '<script>alert(1)</script>', corpsEn: '<script>alert(1)</script>',
  });
  assert.equal(script.ok, false);
  assert.equal(script.errors[0].code, 'html_interdit');
});

test('validateOverride exige les deux langues pour chaque paire — jamais un courriel à moitié surchargé', () => {
  const cases = [
    ['subjectFr', 'sujet_bilingue'],
    ['preheaderFr', 'preheader_bilingue'],
    ['corpsFr', 'corps_bilingue'],
    ['ctaFr', 'cta_bilingue'],
  ];
  for (const [champ, code] of cases) {
    const r = emails.validateOverride('offerPublished', { [champ]: 'Seulement le français' });
    assert.equal(r.ok, false, champ);
    assert.equal(r.errors[0].code, code, champ);
  }
});

test('validateOverride refuse un type impossible et un champ inconnu', () => {
  const t = emails.validateOverride('offerPublished', { actif: 'oui' });
  assert.equal(t.ok, false);
  assert.equal(t.errors[0].code, 'champ_invalide');

  const n = emails.validateOverride('offerPublished', { subjectFr: 42, subjectEn: 'B' });
  assert.equal(n.ok, false);
  assert.equal(n.errors[0].code, 'champ_invalide');

  const u = emails.validateOverride('offerPublished', { corpFr: 'faute de frappe' });
  assert.equal(u.ok, false);
  assert.equal(u.errors[0].code, 'champ_inconnu');
  assert.match(u.errors[0].message, /corpFr/);
});

test('validateOverride accepte `enabled` comme ancien nom de `actif`', () => {
  const r = emails.validateOverride('clientWelcome', { enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.override.actif, false);
  assert.equal(r.override.enabled, false);
});

// --- art. 68 — un transactionnel ne s'éteint pas ------------------------------

test('validateOverride refuse d’éteindre un gabarit transactionnel, et l’accepte sur un relationnel', () => {
  for (const key of ['offerPublished', 'offerAuthorized', 'actPaidNotary']) {
    const r = emails.validateOverride(key, { actif: false });
    assert.equal(r.ok, false, key);
    assert.equal(r.errors[0].code, 'desactivation_interdite', key);
  }
  for (const key of ['clientWelcome', 'dateApproaching', 'newMatchingBids', 'operatorNewLead']) {
    const r = emails.validateOverride(key, { actif: false });
    assert.equal(r.ok, true, key);
    assert.equal(r.override.actif, false, key);
  }
  // Le reste de la surcharge reste permis sur un transactionnel : seul
  // l'interrupteur est protégé.
  const mot = emails.validateOverride('offerPublished', { actif: true, ctaFr: 'Ouvrir', ctaEn: 'Open' });
  assert.equal(mot.ok, true);
});

test('isOverrideDisabled : un enregistrement qui éteindrait un transactionnel est ignoré', () => {
  assert.equal(emails.isOverrideDisabled('clientWelcome', { actif: false }), true);
  assert.equal(emails.isOverrideDisabled('clientWelcome', { enabled: false }), true);
  assert.equal(emails.isOverrideDisabled('offerPublished', { actif: false }), false);
  assert.equal(emails.isOverrideDisabled('offerPublished', { enabled: false }), false);
  assert.equal(emails.isOverrideDisabled('clientWelcome', { actif: true }), false);
  assert.equal(emails.isOverrideDisabled('clientWelcome', null), false);
});

// --- rendu : la surcharge s'applique vraiment ---------------------------------

test('préheader, corps et CTA surchargés remplacent le gabarit, dans les deux langues', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', {
    key: 'offerPublished', actif: true,
    preheaderFr: 'Aperçu FR', preheaderEn: 'Preview EN',
    corpsFr: 'Corps surchargé de {{montant}}.', corpsEn: 'Overridden body of {{montant}}.',
    ctaFr: 'Bouton FR', ctaEn: 'Button EN',
    updatedAt: TODAY,
  });

  await notifier.onOfferCreated(bid());
  const m = mailer.sent[0];
  assert.ok(m.html.includes('Aperçu FR · Preview EN'), 'préheader bilingue');
  assert.ok(m.html.includes('Corps surchargé de 1' + NB + '500' + NB + '$.'), 'corps FR interpolé');
  assert.ok(m.html.includes('Overridden body of $1,500.'), 'corps EN interpolé');
  assert.ok(m.html.includes('Bouton FR') && m.html.includes('Button EN'), 'les deux CTA');
  assert.ok(m.text.includes('Corps surchargé de'), 'l’alternative texte suit');
  assert.ok(m.text.includes('Bouton FR : '), 'le CTA texte garde son URL');
  // Le corps d'origine a bien cédé la place.
  assert.ok(!m.html.includes('Un notaire ne peut retenir votre demande'), 'le corps d’origine est remplacé');
  // Ce que la surcharge NE touche pas : le titre, l'URL du bouton, le pied CASL.
  assert.ok(m.html.includes('Votre offre est publiée'), 'le titre reste celui du gabarit');
  assert.ok(m.html.includes('/#dossier'), 'l’URL du bouton n’est pas configurable');
  assert.ok(m.html.includes('Se désabonner / Unsubscribe'), 'le désabonnement reste');
});

test('une paire à moitié remplie laisse les DEUX langues d’origine intactes', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', {
    key: 'offerPublished', actif: true,
    corpsFr: 'Corps FR seulement', corpsEn: null,
    ctaFr: 'Bouton FR seulement', ctaEn: '  ',
    updatedAt: TODAY,
  });

  await notifier.onOfferCreated(bid());
  const m = mailer.sent[0];
  assert.ok(!m.html.includes('Corps FR seulement'), 'une demi-paire ne s’applique pas');
  assert.ok(!m.html.includes('Bouton FR seulement'), 'une demi-paire ne s’applique pas');
  assert.ok(m.html.includes('Un notaire ne peut retenir votre demande'), 'le corps FR d’origine tient');
  assert.ok(m.html.includes('A notary can only take your request'), 'le corps EN d’origine tient');
});

test('le HTML d’un enregistrement stocké est échappé, jamais injecté', async () => {
  // Une surcharge écrite avant que le validateur existe, ou par une écriture
  // directe dans la table : l'échappement à l'insertion est la garantie.
  const { mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', {
    key: 'offerPublished', actif: true,
    corpsFr: '<script>alert(1)</script>', corpsEn: '<b>bold</b>',
    ctaFr: '<i>fr</i>', ctaEn: '<i>en</i>',
    preheaderFr: '<u>fr</u>', preheaderEn: '<u>en</u>',
    updatedAt: TODAY,
  });

  await notifier.onOfferCreated(bid());
  const m = mailer.sent[0];
  for (const tag of ['<script>', '<b>', '<i>', '<u>']) {
    assert.ok(!m.html.includes(tag), `${tag} ne doit jamais atteindre le HTML`);
  }
  assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'le texte est échappé');
});

// --- l'interrupteur, côté envoi -----------------------------------------------

test('actif:false coupe un gabarit relationnel', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('clientWelcome', { key: 'clientWelcome', actif: false, updatedAt: TODAY });
  const r = await notifier.onClientSignup('client@example.ca');
  assert.deepEqual(r.results[0], { sent: false, reason: 'disabled', kind: 'clientWelcome' });
  assert.equal(mailer.sent.length, 0);
});

test('actif:false n’éteint PAS un gabarit transactionnel — le courriel part quand même', async () => {
  const { mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', {
    key: 'offerPublished', actif: false,
    subjectFr: 'Reformulé {{montant}}', subjectEn: 'Reworded {{montant}}',
    updatedAt: TODAY,
  });
  const r = await notifier.onOfferCreated(bid());
  assert.equal(r.results[0].sent, true, 'la confirmation d’une offre publiée ne se coupe pas (art. 68)');
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /^Reformulé /, 'le reste de la surcharge s’applique quand même');
});

test('les jetons du contexte déclaré interpolent même quand le gabarit en reçoit moins', async () => {
  // onClientSignup ne passe que l'environnement au gabarit ; le contexte
  // déclaré à sendOnce doit quand même nourrir {{email}}.
  const { mailer, notifier, overrides } = setup();
  overrides.set('clientWelcome', {
    key: 'clientWelcome', actif: true,
    subjectFr: 'Bienvenue {{email}}', subjectEn: 'Welcome {{email}}',
    updatedAt: TODAY,
  });
  await notifier.onClientSignup('client@example.ca');
  assert.equal(mailer.sent[0].subject, 'Bienvenue client@example.ca / Welcome client@example.ca');
});

test('tout le registre supporte une surcharge : rendu bilingue, échappement, pied CASL intacts', () => {
  const ctx = {
    serviceId: 'refinancement', dateISO: '2026-08-19', montant: 1500, tier: 'prioritaire', days: 7,
    bids: [{ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, tier: 'rapide' }],
    note: 4, code: 'EVEROY', email: 'client@example.ca', etude: 'Étude Test',
    link: BASE + '/#auth', baseUrl: BASE, unsubscribeUrl: BASE + '/unsubscribe?token=abc',
    __override: {
      actif: true,
      subjectFr: 'Sujet FR', subjectEn: 'Subject EN',
      preheaderFr: 'Aperçu FR', preheaderEn: 'Preview EN',
      corpsFr: 'Corps FR & <cie>', corpsEn: 'Body EN & <co>',
      ctaFr: 'Agir', ctaEn: 'Act',
    },
  };
  for (const [name, render] of Object.entries(emails.TEMPLATES)) {
    const out = render(ctx);
    assert.equal(out.subject, 'Sujet FR / Subject EN', name);
    assert.ok(out.html.includes('Aperçu FR · Preview EN'), `${name}: préheader`);
    assert.ok(out.html.includes('Corps FR &amp; &lt;cie&gt;'), `${name}: corps FR échappé`);
    assert.ok(out.html.includes('Body EN &amp; &lt;co&gt;'), `${name}: corps EN échappé`);
    assert.ok(!out.html.includes('<cie>'), `${name}: aucune balise injectée`);
    assert.ok(out.html.includes('Se désabonner / Unsubscribe'), `${name}: pied CASL`);
    assert.ok(out.text.includes('Corps FR'), `${name}: alternative texte`);
    assert.ok(!out.html.includes('__override'), `${name}: le champ technique ne fuit pas`);
  }
});
