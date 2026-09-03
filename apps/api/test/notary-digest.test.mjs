import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { runReminders } = require('../src/reminders.js');

const TODAY = '2026-08-12';
const YESTERDAY = domain.addDays(TODAY, -1);

// A live, open bid created yesterday — the exact population the daily digest
// mails to active notaries. dossierReady:true keeps the dossier nudge out of
// the frame; a far-off date keeps the j7/j3/j1 cadence quiet.
function freshBid(id, over = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: domain.addDays(TODAY, 30),
    montant: 2400,
    tier: 'confort',
    status: 'ouverte',
    anonyme: true,
    courriel: id + '@client.example',
    createdAt: YESTERDAY + 'T14:00:00.000Z',
    dossierReady: true,
    pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'client_50' },
    ...over,
  };
}

function activeNotary(id, over = {}) {
  return { id, email: id + '@etude.example', status: 'active', etude: 'Étude ' + id, ...over };
}

async function run(seedBids, notaries, { today = TODAY } = {}) {
  const repo = createMemoryRepo(seedBids);
  for (const n of notaries) await repo.putNotary(n);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => today });
  const summary = await runReminders({ repo, notifier, now: () => today });
  return { repo, mailer, notifier, summary };
}

const digestMails = (mailer) => mailer.sent.filter((m) => m.subject.includes('carnet'));

test("the daily digest mails yesterday's live demands to every active notary", async () => {
  const { mailer, summary } = await run(
    [freshBid('d1'), freshBid('d2', { montant: 3000 })],
    [activeNotary('n1'), activeNotary('n2')]
  );
  const digests = digestMails(mailer);
  assert.equal(digests.length, 2);
  assert.deepEqual(digests.map((m) => m.to).sort(), ['n1@etude.example', 'n2@etude.example']);
  // Both demands are in the body, priciest first.
  assert.match(digests[0].subject, /2 nouvelles demandes/);
  assert.ok(digests[0].html.indexOf('3 000') < digests[0].html.indexOf('2 400'));
  assert.equal(summary.digest.sent, 2);
});

test('the digest is sent at most once per notary per day, and re-arms the next day', async () => {
  const repo = createMemoryRepo([freshBid('d1')]);
  await repo.putNotary(activeNotary('n1'));
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY });
  await runReminders({ repo, notifier, now: () => TODAY });
  await runReminders({ repo, notifier, now: () => TODAY });
  assert.equal(digestMails(mailer).length, 1);
  // Next day, a demand created today enters tomorrow's window and mails anew.
  const d2 = freshBid('d2', { createdAt: TODAY + 'T15:00:00.000Z' });
  await repo.put(d2);
  const TOMORROW = domain.addDays(TODAY, 1);
  await runReminders({ repo, notifier, now: () => TOMORROW });
  assert.equal(digestMails(mailer).length, 2);
});

test('a bid appears in exactly one digest — only the ones created yesterday are included', async () => {
  const { mailer } = await run(
    [
      freshBid('old', { createdAt: domain.addDays(TODAY, -3) + 'T10:00:00.000Z' }),
      freshBid('today', { createdAt: TODAY + 'T08:00:00.000Z' }),
      freshBid('fresh'),
    ],
    [activeNotary('n1')]
  );
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1);
  assert.match(digests[0].subject, /1 nouvelle demande/);
});

test('never-live demands stay out of the digest (pending or voided card hold)', async () => {
  const { mailer } = await run(
    [freshBid('pending', { paymentStatus: 'pending' }), freshBid('void', { paymentStatus: 'void' })],
    [activeNotary('n1')]
  );
  assert.equal(digestMails(mailer).length, 0);
});

test('the déplacement perimeter filters each notary’s digest (ADR 0017)', async () => {
  const urgence = freshBid('urgence', { pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'urgence_en_ligne' } });
  const far = freshBid('far', { montant: 2600, pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'notaire_50' } });
  const { mailer } = await run(
    [urgence, far],
    [
      activeNotary('roule', { rayonKm: 50, urgences: false }),
      activeNotary('urgentiste', { rayonKm: 0, urgences: true }),
      activeNotary('sedentaire', { rayonKm: 0, urgences: false }),
    ]
  );
  const digests = digestMails(mailer);
  const byTo = Object.fromEntries(digests.map((m) => [m.to, m]));
  assert.match(byTo['roule@etude.example'].subject, /1 nouvelle demande/);
  assert.match(byTo['urgentiste@etude.example'].subject, /1 nouvelle demande/);
  // A notary no fresh demand can reach gets no mail at all.
  assert.equal(byTo['sedentaire@etude.example'], undefined);
});

test('only ACTIVE notaries with an address are mailed', async () => {
  const { mailer } = await run(
    [freshBid('d1')],
    [activeNotary('n1'), activeNotary('inactif', { status: 'pending' }), activeNotary('muet', { email: null })]
  );
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1);
  assert.equal(digests[0].to, 'n1@etude.example');
});

test('the digest lists at most 8 demands, priciest first (the carnet teaser block)', async () => {
  const seed = Array.from({ length: 10 }, (_, i) => freshBid('d' + i, { montant: 2000 + i * 100 }));
  const { mailer } = await run(seed, [activeNotary('n1')]);
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1);
  assert.match(digests[0].subject, /10 nouvelles demandes/);
  // Cheapest two fall off the 8-row table.
  assert.ok(!digests[0].text.includes(domain.money(2000)));
  assert.ok(!digests[0].text.includes(domain.money(2100)));
  assert.ok(digests[0].text.includes(domain.money(2900)));
});

test('a repo without listActiveNotaries keeps the reminder run working (no digest)', async () => {
  const repo = createMemoryRepo([freshBid('d1')]);
  delete repo.listActiveNotaries;
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY });
  const summary = await runReminders({ repo, notifier, now: () => TODAY });
  assert.equal(digestMails(mailer).length, 0);
  assert.equal(summary.digest.sent, 0);
});

test('the digest applies the same MEASURED reach as the live feed (ADR 0025)', async () => {
  // Étude at Sainte-Foy, 25 km radius; client ~6 km away asks the notary to
  // come (band 50). The old declarative proxy (rayon 25 < bande 50) hid this
  // demand from the digest while the feed showed it — the two must agree.
  const near = freshBid('near', { prefixe: 'G1R', pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'notaire_50' } });
  // A client ~20 km away who only travels 10 km cannot reach this étude —
  // priced higher so the digest could not hide it by the 8-demand cap.
  const far = freshBid('far', { montant: 3000, prefixe: 'G3A', pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'client_10' } });
  const { mailer } = await run([near, far], [activeNotary('n1', { rayonKm: 25, prefixe: 'G1V' })]);
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1);
  assert.match(digests[0].subject, /1 nouvelle demande/);
  assert.ok(digests[0].html.includes(domain.money(2400)), 'the reachable demand is in');
  assert.ok(!digests[0].html.includes(domain.money(3000)), 'the out-of-reach demand stays out');
});

// --- ADR 0033 §7 — the digest follows each notary’s pace ------------------------

test('pace « off » and pace « instant » receive no digest; « daily » and an absent preference do', async () => {
  const { mailer } = await run(
    [freshBid('d1')],
    [
      activeNotary('off', { alertes: { pace: 'off', urgentOnly: false } }),
      activeNotary('instant', { alertes: { pace: 'instant', urgentOnly: false } }),
      activeNotary('daily', { alertes: { pace: 'daily', urgentOnly: false } }),
      activeNotary('legacy'),
    ]
  );
  assert.deepEqual(digestMails(mailer).map((m) => m.to).sort(), ['daily@etude.example', 'legacy@etude.example']);
});

test('pace « weekly » digests only on Mondays, covering the whole past week', async () => {
  const MONDAY = '2026-08-17'; // a Monday
  const TUESDAY = '2026-08-18';
  const seed = [
    freshBid('sixDaysAgo', { createdAt: domain.addDays(MONDAY, -6) + 'T10:00:00.000Z' }),
    freshBid('yesterday', { createdAt: domain.addDays(MONDAY, -1) + 'T10:00:00.000Z' }),
    freshBid('eightDaysAgo', { createdAt: domain.addDays(MONDAY, -8) + 'T10:00:00.000Z', montant: 5000 }),
  ];
  const tue = await run(seed, [activeNotary('weekly', { alertes: { pace: 'weekly', urgentOnly: false } })], { today: TUESDAY });
  assert.equal(digestMails(tue.mailer).length, 0, 'not on a Tuesday');
  const mon = await run(seed, [activeNotary('weekly', { alertes: { pace: 'weekly', urgentOnly: false } })], { today: MONDAY });
  const digests = digestMails(mon.mailer);
  assert.equal(digests.length, 1, 'on Monday');
  assert.match(digests[0].subject, /2 nouvelles demandes/, 'the week’s demands, not only yesterday’s');
  assert.ok(!digests[0].html.includes(domain.money(5000)), 'older than a week stays out');
});

test('urgentOnly keeps a weekly/daily digest to elevated tiers', async () => {
  const { mailer } = await run(
    [freshBid('calm', { tier: 'standard' }), freshBid('hot', { tier: 'urgence', montant: 4000 })],
    [activeNotary('picky', { alertes: { pace: 'daily', urgentOnly: true } })]
  );
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1);
  assert.match(digests[0].subject, /1 nouvelle demande/);
  assert.ok(digests[0].html.includes(domain.money(4000)));
});
