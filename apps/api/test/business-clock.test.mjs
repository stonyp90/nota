import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { runReminders } = require('../src/reminders.js');

// Regression: the DEFAULT clocks (what Lambda actually runs — no `now`
// injected) must derive "today" from the Québec civil day, not the UTC day.
// Before the fix, every evening after ~20:00 in Québec the UTC date had
// already rolled to tomorrow and a same-day booking came back 422 date_passee.

// 2026-08-26 21:30 in Québec (EDT, UTC-4) — already the 27th in UTC.
const QUEBEC_EVENING_MS = Date.parse('2026-08-27T01:30:00.000Z');

const PRICING = { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale' };

test('default clock: /health reports the Québec day, not the UTC day', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: QUEBEC_EVENING_MS });
  return createApp(createMemoryRepo([]))
    .handle({ method: 'GET', path: '/health' })
    .then((res) => {
      assert.equal(JSON.parse(res.body).today, '2026-08-26');
    });
});

test('a same-day booking posted in the Québec evening is NOT date_passee', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: QUEBEC_EVENING_MS });
  const app = createApp(createMemoryRepo([]), { newId: () => 'bid-evening' });
  const res = await app.handle({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO: '2026-08-26', montant: 6000, pricing: PRICING }),
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).bid.tier, 'extreme');
});

test('default clock in winter (EST, UTC-5): still the Québec day', (t) => {
  // 2027-01-14 22:00 in Québec == 2027-01-15T03:00Z.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-15T03:00:00.000Z') });
  return createApp(createMemoryRepo([]))
    .handle({ method: 'GET', path: '/health' })
    .then((res) => {
      assert.equal(JSON.parse(res.body).today, '2027-01-14');
    });
});

test('the timezone stays configurable — NOTA_TIMEZONE overrides the default', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: QUEBEC_EVENING_MS });
  process.env.NOTA_TIMEZONE = 'UTC';
  t.after(() => { delete process.env.NOTA_TIMEZONE; });
  const res = await createApp(createMemoryRepo([])).handle({ method: 'GET', path: '/health' });
  assert.equal(JSON.parse(res.body).today, '2026-08-27');
});

test('reminder day math also runs on the Québec day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: QUEBEC_EVENING_MS });
  const result = await runReminders({
    repo: createMemoryRepo([]),
    notifier: { onReminderDue: async () => ({ sent: true }) },
  });
  assert.equal(result.todayISO, '2026-08-26');
});
