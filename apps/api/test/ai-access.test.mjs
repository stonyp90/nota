import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNotaryAIAccess } = require('../src/ai-access.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const D = require('@nota/domain');

const NOW = Date.parse('2026-09-09T14:00:00Z');

test('beta entitlement is opt-in, lifetime-limited and cannot be reset', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n1', email: 'n1@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  assert.equal((await access.get('n1')).enabled, false);
  // ADR 0052 : activer la bêta EST l'acceptation de l'échange — la voie
  // gratuite est payée en révisions, et rien ne se sert sans elle.
  assert.equal((await access.enroll('n1', { contribue: true })).access.beta.remaining, 5);
  for (let i = 0; i < D.NOTARY_AI_BETA_TRIAL_USES; i += 1) assert.equal((await access.consume('n1')).ok, true);
  assert.equal((await access.enroll('n1')).access.beta.remaining, 0);
  const exhausted = await access.consume('n1');
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.code, 'quota_epuise');
  assert.equal((await access.get('n1')).beta.remaining, 0);
});

test('subscription quota and purchased units are separate, and failed AI work can refund one unit', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n2', email: 'n2@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  await access.enroll('n2', { contribue: true });
  for (let i = 0; i < D.NOTARY_AI_BETA_TRIAL_USES; i += 1) assert.equal((await access.consume('n2')).ok, true);
  await access.updateSubscription('n2', { status: 'active', planId: 'essentiel', periodEnd: '2026-10-09T00:00:00.000Z', used: 19 });
  assert.equal((await access.consume('n2')).source, 'subscription');
  assert.equal((await access.get('n2')).subscription.remaining, 0);
  await access.addCredits('n2', 2);
  const used = await access.consume('n2');
  assert.equal(used.source, 'piece');
  assert.equal((await access.get('n2')).paidUses, 1);
  assert.equal(await access.refund('n2', used.source), true);
  assert.equal((await access.get('n2')).paidUses, 2);
});

test('subscription usage resets only when Stripe advances the subscription period', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n3', email: 'n3@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  await access.updateSubscription('n3', { status: 'active', planId: 'essentiel', subscriptionId: 'sub_1', periodStart: '2026-09-09T00:00:00.000Z', used: 19 });
  await access.updateSubscription('n3', { status: 'active', planId: 'essentiel', subscriptionId: 'sub_1', periodStart: '2026-09-09T00:00:00.000Z', used: 20 });
  assert.equal((await access.get('n3')).subscription.used, 20);
  await access.updateSubscription('n3', { status: 'active', subscriptionId: 'sub_1', periodStart: '2026-10-09T00:00:00.000Z' });
  assert.equal((await access.get('n3')).subscription.used, 0);
});

test('a one-off payment is credited once even when Stripe replays its event', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n4', email: 'n4@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  assert.equal((await access.addCreditsOnce('n4', 'cs_test_1', 3)).paidUses, 3);
  assert.equal((await access.addCreditsOnce('n4', 'cs_test_1', 3)).paidUses, 3);
  assert.equal((await access.get('n4')).paidUses, 3);
});

// ADR 0052 — le notaire paie, ou il enseigne.

test('la voie gratuite ne sert aucune analyse avant le consentement à contribuer', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n5', email: 'n5@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  await access.enroll('n5');
  const before = await access.get('n5');
  assert.equal(before.contribution.mode, 'requise');
  assert.equal(before.contribution.consentie, false);
  const refused = await access.consume('n5');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'contribution_requise');
  assert.equal((await access.get('n5')).beta.remaining, D.NOTARY_AI_BETA_TRIAL_USES);

  const consented = await access.setContribution('n5', true);
  assert.equal(consented.contribution.consentie, true);
  assert.equal(consented.contribution.consentiLe, new Date(NOW).toISOString());
  const served = await access.consume('n5');
  assert.equal(served.ok, true);
  assert.equal(served.source, 'trial');
});

test('le notaire qui paie ne doit rien à l’apprentissage, même avec des essais bêta au compteur', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n6', email: 'n6@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  await access.enroll('n6');
  await access.updateSubscription('n6', { status: 'active', planId: 'essentiel', periodEnd: '2026-10-09T00:00:00.000Z' });
  const view = await access.get('n6');
  assert.equal(view.contribution.mode, 'facultative');
  assert.equal(view.contribution.requise, false);
  // La réserve gratuite sert encore en premier — mais sans consentement exigé.
  const served = await access.consume('n6');
  assert.equal(served.ok, true);
  assert.equal(served.source, 'trial');
});

test('le consentement se retire, et le retrait referme la voie gratuite sans toucher au marché', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n7', email: 'n7@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: { NOTA_AI_MONETIZATION_ENABLED: 'true' }, nowMs: () => NOW });
  await access.enroll('n7');
  await access.setContribution('n7', true);
  assert.equal((await access.consume('n7')).ok, true);
  const withdrawn = await access.setContribution('n7', false);
  assert.equal(withdrawn.contribution.consentie, false);
  assert.equal(withdrawn.contribution.refuseLe, new Date(NOW).toISOString());
  assert.equal((await access.consume('n7')).code, 'contribution_requise');
  // La sortie reste ouverte : payer lève l'exigence.
  await access.addCredits('n7', 1);
  assert.equal((await access.consume('n7')).ok, true);
});

test('sans monétisation, la règle ne s’arme pas', async () => {
  const repo = createMemoryRepo();
  await repo.putNotary({ id: 'n8', email: 'n8@example.ca', status: 'active' });
  const access = createNotaryAIAccess({ repo, env: {}, nowMs: () => NOW });
  assert.equal((await access.consume('n8')).ok, true);
});
