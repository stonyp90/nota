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
function bidAt(id, offset, over = {}) {
  return {
    id,
    serviceId: 'testament',
    dateISO: domain.addDays(TODAY, offset),
    montant: 700,
    tier: domain.tierForDays(Math.max(0, offset)),
    premium: 700 / 650,
    status: 'ouverte',
    anonyme: true,
    courriel: id + '@example.ca',
    createdAt: TODAY,
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

  // scanOpenBids excludes the retained bid; the past + quiet bids have no due
  // reminder; j7/j3/j1 each have one; the incomplete dossier has one.
  assert.equal(res.scanned, 6, 'retained bid should not be scanned');
  assert.equal(res.due, 4);
  assert.equal(res.sent, 4);

  const recipients = mailer.sent.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['dossier@example.ca', 'j1@example.ca', 'j3@example.ca', 'j7@example.ca']);
  // No mail to the retained, past, or quiet bids.
  for (const who of ['retenue@example.ca', 'past@example.ca', 'quiet@example.ca']) {
    assert.equal(mailer.sent.some((m) => m.to === who), false, `${who} should not be mailed`);
  }
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
