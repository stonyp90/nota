import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';

const ids = serviceId => new Set(D.notaryControlPlan(serviceId).map(control => control.id));

test('every catalogue service exposes a pending, evidence-linked control plan', () => {
  for (const serviceId of ['financement', 'refinancement', 'testament', 'procuration']) {
    const controls = D.notaryControlPlan(serviceId);
    assert.equal(controls.length > 0, true, serviceId);
    assert.ok(controls.some(control => control.id === 'identity_quality_capacity'), serviceId);
    assert.ok(controls.some(control => control.id === 'signature_execution'), serviceId);
    for (const control of controls) {
      assert.equal(control.status, 'pending', control.id);
      assert.equal(typeof control.critical, 'boolean');
      assert.equal(control.automation, 'prepare_only');
      assert.equal(typeof control.integrationType, 'string');
      assert.equal(typeof control.integrationLabel, 'string');
      assert.equal(typeof control.integrationCandidate, 'string');
      assert.ok(Array.isArray(control.evidenceIds));
      assert.ok(Array.isArray(control.externalEvidence));
    }
  }
  assert.equal(D.notaryControlPlan('unknown'), null);
});

test('financing branches cover purchase coordination and refinancing discharge separately', () => {
  const financing = ids('financement');
  const purchase = idsWithPricing('financement', { contexte: 'achat' });
  const refinancing = ids('refinancement');
  assert.equal(financing.has('purchase_coordination'), false);
  assert.equal(purchase.has('purchase_coordination'), true);
  assert.equal(financing.has('secured_debts'), false);
  assert.equal(refinancing.has('secured_debts'), true);
  assert.equal(refinancing.has('payout_discharge'), true);
});

function idsWithPricing(serviceId, pricing) {
  return new Set(D.notaryControlPlan(serviceId, pricing).map(control => control.id));
}

test('testament and procuration controls include their distinct legal routes', () => {
  const testament = ids('testament');
  assert.ok(testament.has('family_dependants'));
  assert.ok(testament.has('existing_will'));
  assert.ok(testament.has('witnesses'));
  assert.ok(testament.has('testament_register'));

  const procuration = ids('procuration');
  assert.ok(procuration.has('mandate_regime'));
  assert.ok(procuration.has('powers_duration'));
  assert.ok(procuration.has('existing_revocation'));
  assert.ok(procuration.has('protection_route'));
});

test('control plans are copied for callers and are included in every private packet', () => {
  const first = D.notaryControlPlan('refinancement');
  first[0].evidenceIds.push('tampered');
  assert.equal(D.notaryControlPlan('refinancement')[0].evidenceIds.includes('tampered'), false);

  for (const serviceId of ['financement', 'refinancement']) {
    const packet = D.financingWorkPacket({ serviceId, status: D.STATUS.RETENUE, notaryId: 'n1', id: 'b1', dateISO: '2026-09-18', pricing: {} });
    assert.equal(packet.controlPlanVersion, D.NOTARY_CONTROL_PLAN_VERSION);
    assert.ok(packet.controls.some(control => control.id === 'identity_quality_capacity'));
  }
  for (const serviceId of ['testament', 'procuration']) {
    const packet = D.actWorkPacket({ serviceId, status: D.STATUS.RETENUE, notaryId: 'n1', id: 'b1', dateISO: '2026-09-18', pricing: {} });
    assert.equal(packet.controlPlanVersion, D.NOTARY_CONTROL_PLAN_VERSION);
    assert.equal(packet.knowledgeVersion, D.notaryServiceKnowledge(serviceId).version);
    assert.ok(packet.controls.some(control => control.id === 'identity_quality_capacity'));
  }
});

test('parameter coverage links each service intake to AI fields and human controls', () => {
  for (const serviceId of ['financement', 'refinancement', 'testament', 'procuration']) {
    const service = D.serviceById(serviceId);
    const coverage = D.notaryParameterCoverage(serviceId);
    assert.equal(coverage.version, D.NOTARY_PARAMETER_COVERAGE_VERSION);
    assert.equal(coverage.serviceId, serviceId);
    assert.deepEqual(coverage.intake.map(field => field.id), service.champs.map(field => field.id));
    assert.deepEqual(coverage.documents.map(document => document.id), service.documents.map(document => document.id));
    assert.ok(coverage.pricing.length > 0);
    assert.ok(coverage.ai.fields.length > 0);
    assert.ok(coverage.humanControls.length > 0);
    assert.ok(coverage.integrations.length > 0);
  }
  const financing = D.notaryParameterCoverage('financement');
  assert.ok(financing.ai.fields.some(field => field.id === 'purchase_price'));
  assert.ok(financing.ai.mappedIntake.some(mapping => mapping.intakeId === 'identification_immeuble' && mapping.aiFieldId === 'property_identifier'));
  const procuration = D.notaryParameterCoverage('procuration');
  assert.ok(procuration.ai.fields.some(field => field.id === 'mandate_regime'));
  assert.ok(procuration.ai.mappedIntake.some(mapping => mapping.intakeId === 'type_mandat' && mapping.aiFieldId === 'mandate_regime'));
  assert.equal(D.notaryParameterCoverage('unknown'), null);
});

test('workflow summary gives the notary one next action and keeps AI review explicit', () => {
  const controls = D.notaryControlPlan('refinancement');
  const analysis = { preparation: { fields: [{ fieldId: 'lender_name', value: 'Banque Exemple' }] } };
  const awaiting = D.notaryWorkflowSummary({
    missing: [], comparisons: [{ fieldId: 'lender_name' }], dateFlags: [], analysis, controls,
  });
  assert.equal(awaiting.stage, 'ai_review');
  assert.deepEqual(awaiting.nextActions.slice(0, 2), [
    { id: 'review_ai_proposals', owner: 'notary', priority: 'now', count: 1 },
    { id: 'resolve_exceptions', owner: 'notary', priority: 'now', count: 1 },
  ]);
  assert.equal(awaiting.ai.status, 'awaiting_review');
  assert.equal(awaiting.controls.criticalPending, controls.filter(control => control.critical).length);

  const reviewed = D.notaryWorkflowSummary({
    missing: [], comparisons: [], dateFlags: [], analysis,
    review: { activeReviewSeconds: 27 }, reviewed: true, controls,
  });
  assert.equal(reviewed.stage, 'notary_controls');
  assert.equal(reviewed.ai.status, 'reviewed');
  assert.equal(reviewed.ai.reviewSeconds, 27);
  assert.equal(reviewed.nextActions[0].id, 'complete_critical_controls');
});

test('case coverage names known branches and routes unknown work before automation', () => {
  for (const serviceId of ['financement', 'refinancement', 'testament', 'procuration']) {
    const coverage = D.notaryCaseCoverage(serviceId);
    assert.equal(coverage.version, D.NOTARY_CASE_COVERAGE_VERSION);
    assert.equal(coverage.serviceId, serviceId);
    assert.equal(coverage.unknownCasePolicy, 'route_to_notary_before_automation');
    assert.equal(coverage.outputPolicy, 'evidence_proposal_only');
    const ids = coverage.cases.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(coverage.cases.length >= 15, serviceId);
    assert.ok(coverage.cases.some(item => item.id === 'standard_natural_person' && item.disposition === 'prepare_and_review'));
    assert.ok(coverage.cases.some(item => item.id === 'unknown_or_out_of_catalogue' && item.disposition === 'route_to_notary'));
    for (const item of coverage.cases) {
      assert.ok(['prepare_and_review', 'route_to_notary'].includes(item.disposition), item.id);
      assert.equal(typeof item.critical, 'boolean');
      assert.ok(item.signals.length > 0, item.id);
      assert.ok(item.controlIds.length > 0, item.id);
    }
  }
  assert.equal(D.notaryCaseCoverage('unknown'), null);
});

test('parameter coverage carries the same case contract for every service', () => {
  for (const serviceId of ['financement', 'refinancement', 'testament', 'procuration']) {
    const coverage = D.notaryParameterCoverage(serviceId);
    assert.equal(coverage.caseCoverage.version, D.NOTARY_CASE_COVERAGE_VERSION);
    assert.equal(coverage.caseCoverage.serviceId, serviceId);
    assert.ok(coverage.caseCoverage.cases.some(item => item.id === 'unknown_or_out_of_catalogue'));
  }
});
