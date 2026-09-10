import test from 'node:test';
import assert from 'node:assert/strict';
import domain from '../index.js';

test('notary AI pricing is a small, predictable hybrid catalogue', () => {
  assert.equal(domain.NOTARY_AI_BETA_TRIAL_USES, 5);
  assert.deepEqual(domain.NOTARY_AI_PLANS.map(plan => plan.id), ['essentiel', 'cabinet', 'equipe']);
  for (const plan of domain.NOTARY_AI_PLANS) {
    assert.ok(plan.monthlyCents > 0);
    assert.ok(plan.includedUses > 0);
    assert.ok(plan.overageCents > 0);
    assert.equal(domain.notaryAIPlan(plan.id), plan);
    assert.deepEqual(domain.notaryAIPlanPublic(plan.id), { ...plan });
  }
  assert.equal(domain.notaryAIPlan('unknown'), null);
});

test('cabinet plans are a separate commercial vocabulary with multi-notary tiers', () => {
  assert.deepEqual(domain.CABINET_PLANS.map(plan => plan.id), ['independant', 'cabinet', 'reseau']);
  assert.equal(domain.cabinetPlan('cabinet').multiNotaires, true);
  assert.equal(domain.cabinetPlan('independant').multiNotaires, false);
  assert.equal(domain.cabinetPlan('unknown'), null);
  assert.deepEqual(domain.cabinetPlanPublic('reseau'), { ...domain.CABINET_PLANS[2] });
});
