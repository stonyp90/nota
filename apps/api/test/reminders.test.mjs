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

// A bid at `offset` days from TODAY, open by default, with a courriel so it is
// mailable. Uses the domain's own addDays so boundaries match exactly.
// dossierReady: true keeps the date-cadence fixtures out of the (now derived)
// dossier_incomplet nudge — its own behavior is proven separately.
function bidAt(id, offset, over = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: domain.addDays(TODAY, offset),
    montant: 2400,
    tier: domain.tierForDays(Math.max(0, offset)),
    premium: 2400 / 2000,
    status: 'ouverte',
    anonyme: true,
    courriel: id + '@example.ca',
    createdAt: TODAY,
    dossierReady: true,
    ...over,
  };
}

test('the scheduler sends exactly the due reminders for a seeded set of bids', async () => {
  // Seed: reminders due on 7/3/1; a retained bid on a cadence day (excluded);
  // a past bid (excluded); a non-cadence day (no date reminder); and one open
  // incomplete dossier on a non-cadence day (dossier_incomplet only).
  const seed = [
    bidAt('j7', 7),
    bidAt('j3', 3),
    bidAt('j1', 1),
    bidAt('retenue', 7, { status: 'retenue', etude: 'Étude Laval' }),
    bidAt('past', -1),
    bidAt('quiet', 5),
    bidAt('dossier', 10, { dossierReady: false }),
  ];
  const repo = createMemoryRepo(seed);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY });

  const res = await runReminders({ repo, notifier, now: () => TODAY });

  // listOpenBids excludes the retained bid; the past + quiet bids have no due
  // reminder; j7/j3/j1 each have one; the incomplete dossier has one.
  assert.equal(res.openBids, 6, 'retained bid should not be enumerated');
  assert.equal(res.due, 4);
  assert.equal(res.sent, 4);

  const recipients = mailer.sent.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['dossier@example.ca', 'j1@example.ca', 'j3@example.ca', 'j7@example.ca']);
  // No mail to the retained, past, or quiet bids.
  for (const who of ['retenue@example.ca', 'past@example.ca', 'quiet@example.ca']) {
    assert.equal(mailer.sent.some((m) => m.to === who), false, `${who} should not be mailed`);
  }
});

test('the scheduler mails dateApproaching for exactly the on-cadence offsets and stays silent off-cadence', async () => {
  // A multi-bid table straddling every reminder boundary. dueReminders fires
  // at 7/3/1 days out (dateApproaching) and at 0 (the j0 "still no notary"
  // nudge — dateMissedNoUptake); 8/6/4/2 are off-cadence and must send nothing.
  // Boundaries themselves are proven in the domain suite — here we assert the
  // notifier + scheduler send exactly the due set, with the right template.
  const seed = [
    bidAt('d8', 8),
    bidAt('d7', 7),
    bidAt('d6', 6),
    bidAt('d4', 4),
    bidAt('d3', 3),
    bidAt('d2', 2),
    bidAt('d1', 1),
    bidAt('d0', 0),
  ];
  const repo = createMemoryRepo(seed);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY });

  const res = await runReminders({ repo, notifier, now: () => TODAY });

  assert.equal(res.openBids, seed.length);
  assert.equal(res.due, 4, 'exactly the 7/3/1/0 offsets are due');
  assert.equal(res.sent, 4);

  const recipients = mailer.sent.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['d0@example.ca', 'd1@example.ca', 'd3@example.ca', 'd7@example.ca']);

  // 7/3/1 get the tier-aware date-approaching template.
  for (const m of mailer.sent.filter((x) => x.to !== 'd0@example.ca')) {
    assert.ok(m.subject.startsWith('Votre signature approche'), 'unexpected template: ' + m.subject);
  }
  // Day 0 (the date is today, still no notary) gets the raise-your-offer nudge.
  const j0 = mailer.sent.find((m) => m.to === 'd0@example.ca');
  assert.ok(/aucune offre retenue/.test(j0.subject), 'j0 must send dateMissedNoUptake: ' + j0.subject);
  // The off-cadence bids are never mailed.
  for (const who of ['d8', 'd6', 'd4', 'd2']) {
    assert.equal(mailer.sent.some((m) => m.to === who + '@example.ca'), false, who + ' should be silent');
  }
});

test('an open lead with no dossierReady flag derives its dossier_incomplet nudge from the file itself', async () => {
  // No flag at all (legacy record, nothing saved): the domain derives "not
  // ready" via leadReadiness and the finish-your-file nudge goes out once.
  const bare = bidAt('bare', 10);
  delete bare.dossierReady;
  // Same, but the client's saved dossier IS ready (required pricing + consent):
  // no nudge.
  const ready = bidAt('ready', 10, {
    dossier: { __consent: true, __pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' } },
  });
  delete ready.dossierReady;

  const repo = createMemoryRepo([bare, ready]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY });

  const res = await runReminders({ repo, notifier, now: () => TODAY });
  assert.equal(res.due, 1);
  assert.equal(res.sent, 1);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, 'bare@example.ca');
  assert.match(mailer.sent[0].subject, /dossier/i);
});

test('the scheduler is idempotent: a second run the same day sends nothing new', async () => {
  const repo = createMemoryRepo([bidAt('j7', 7), bidAt('j3', 3)]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', now: () => TODAY });

  const first = await runReminders({ repo, notifier, now: () => TODAY });
  const second = await runReminders({ repo, notifier, now: () => TODAY });

  assert.equal(first.sent, 2);
  assert.equal(second.due, 2, 'the reminders are still due');
  assert.equal(second.sent, 0, 'but nothing is sent twice');
  assert.equal(mailer.sent.length, 2);
});
