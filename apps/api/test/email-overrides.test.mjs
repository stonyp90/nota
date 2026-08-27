// Admin-parametrizable templates — the CONSUMPTION side of the override port:
//   repo.getEmailOverride(key) -> { key, enabled, subjectFr, subjectEn, updatedAt } | null
// The port is optional (guarded with a typeof check), read through a 60s TTL
// cache keyed on the injected clock, and can (a) disable a template outright,
// (b) reword its subject via {{token}} interpolation. TEMPLATE_META describes
// every registry key for the admin console. The auth-critical direct sends
// (notary magic link, partner claim link, admin magic link) are NOT overridable.
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

test('a disabled template is not sent (reason: disabled) and is not marked in the SENT ledger', async () => {
  const { repo, mailer, notifier, overrides } = setup();
  overrides.set('offerPublished', { key: 'offerPublished', enabled: false, subjectFr: null, subjectEn: null, updatedAt: TODAY });

  const r = await notifier.onOfferCreated(bid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.results[0], { sent: false, reason: 'disabled', kind: 'offerPublished' });
  assert.equal(mailer.sent.length, 0);
  // Not marked sent: re-enabling later lets the mail go out.
  assert.equal(await repo.wasNotificationSent('b1', 'offerPublished'), false);
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
