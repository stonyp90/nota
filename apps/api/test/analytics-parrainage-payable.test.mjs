// Décision du 2026-09-04 (ADR 0037, amendement de l'ADR 0011) : une récompense
// de parrainage est ACQUISE à la rétention mais PAYABLE seulement une fois
// l'acte réglé. `du` reste ce que le registre write-once a acquis ; `payable`
// est ce que l'opérateur verse. Une demande retenue puis annulée ne se paie
// pas — sans mécanisme de reprise, seul le moment du versement ferme la porte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const domain = require('@nota/domain');

const TODAY = '2026-09-04';

test('parrainages : `du` = acquis à la rétention, `payable` = les seuls actes réglés (client) et notaires ayant réglé (notaire)', async () => {
  const repo = createMemoryRepo();
  // Deux demandes référées retenues ; une seule signée et réglée.
  await repo.recordReferralEarning({ code: 'MARCQC', track: 'client', refId: 'b-signee', montant: domain.REFERRAL.client, at: TODAY });
  await repo.recordReferralEarning({ code: 'MARCQC', track: 'client', refId: 'b-annulee', montant: domain.REFERRAL.client, at: TODAY });
  await repo.markActCompleted('b-signee', { bidId: 'b-signee', notaryId: 'n1', actAmount: 2000, commissionCents: 40000, completedAt: TODAY });
  // Deux notaires référés : l'un a réglé un acte, l'autre n'a encore rien signé.
  await repo.putNotary({ id: 'n-signe', email: 'a@etude.ca', status: 'active', actsCompleted: 1 });
  await repo.putNotary({ id: 'n-vide', email: 'b@etude.ca', status: 'active', actsCompleted: 0 });
  await repo.recordReferralEarning({ code: 'MARCQC', track: 'notaire', refId: 'n-signe', montant: domain.REFERRAL.notaire, at: TODAY });
  await repo.recordReferralEarning({ code: 'MARCQC', track: 'notaire', refId: 'n-vide', montant: domain.REFERRAL.notaire, at: TODAY });

  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  const row = o.parrainages.codes.find((c) => c.code === 'MARCQC');
  assert.ok(row, 'the code has a row');
  assert.equal(row.du, 2 * domain.REFERRAL.client + 2 * domain.REFERRAL.notaire, 'acquis : tout ce que la rétention a écrit');
  assert.equal(row.payable, domain.REFERRAL.client + domain.REFERRAL.notaire, 'payable : un acte réglé, un notaire qui a réglé');
});

test('parrainages : sans aucun acte réglé, rien n’est payable — et un registre illisible ne rend rien payable', async () => {
  const repo = createMemoryRepo();
  await repo.recordReferralEarning({ code: 'EVEROY', track: 'client', refId: 'b1', montant: domain.REFERRAL.client, at: TODAY });
  const o = await createAnalytics({ repo, now: () => TODAY }).overview();
  const row = o.parrainages.codes.find((c) => c.code === 'EVEROY');
  assert.equal(row.du, domain.REFERRAL.client);
  assert.equal(row.payable, 0);

  const casse = { ...repo, getActCompletion: async () => { throw new Error('dynamo'); } };
  const o2 = await createAnalytics({ repo: casse, now: () => TODAY }).overview();
  assert.equal(o2.parrainages.codes.find((c) => c.code === 'EVEROY').payable, 0);
});
