import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../index.js';

test('preparation distinguishes declarations from evidence and never certifies closing', () => {
  const dossier = Object.fromEntries(D.dossierItems('refinancement').map(it => [it.id, 'declared']));
  dossier.piece_identite = D.DOSSIER_TRANSMIS;
  dossier.aiReadyToSign = true;
  const brief = D.financingPreparation('refinancement', dossier);
  assert.equal(brief.missing.length, 0);
  assert.equal(brief.items.find(it => it.id === 'piece_identite').status, 'external');
  assert.equal(brief.items.find(it => it.id === 'offre_preteur').status, 'listed');
  assert.equal(brief.items.find(it => it.id === 'parties_signature').status, 'declared');
  assert.equal(brief.signingReadiness, 'not_assessed');
  assert.ok(brief.checks.every(check => check.status === 'notary_review_required'));
  assert.equal(JSON.stringify(brief).includes('aiReadyToSign'), false);
});

test('preparation respects conditional documents and treats whitespace as missing', () => {
  const brief = D.financingPreparation('refinancement', { adresse: '  ', __pricing: { succession: 'non' } });
  assert.ok(brief.missing.some(it => it.id === 'adresse'));
  assert.ok(!brief.items.some(it => it.id === 'testament_transmission'));
  assert.ok(!brief.items.some(it => it.id === 'promesse_achat'));
  assert.equal(D.financingPreparation('unknown', {}), null);
});

test('financing preparation survives the private dossier boundary, with bounded text', () => {
  for (const serviceId of ['financement', 'refinancement']) {
    const fields = ['parties_signature', 'contact_preteur', 'changements_immeuble'];
    if (serviceId === 'refinancement') fields.push('dettes_garanties');
    const input = Object.fromEntries(fields.map(id => [id, 'x'.repeat(9000)]));
    input.modelApproval = true;
    const clean = D.cleanDossier(serviceId, input);
    for (const id of fields) {
      assert.equal(clean[id].length, D.DOSSIER_VALUE_MAX);
      assert.ok(D.dossierItems(serviceId).some(it => it.id === id && it.kind === 'field'));
    }
    assert.equal(clean.modelApproval, undefined);
  }
  assert.equal(D.cleanDossier('financement', { dettes_garanties: 'private' }).dettes_garanties, undefined);
});

test('preparation knowledge cites known sources and reaches the assistant with intake fields', () => {
  const facts = D.supportFacts();
  const known = new Set(facts.financement.sources.map(s => s.id));
  for (const fact of facts.financement.facts) {
    assert.ok(fact.sourceIds.length);
    for (const id of fact.sourceIds) assert.ok(known.has(id));
  }
  assert.ok(facts.services.find(s => s.id === 'refinancement').champs.some(c => c.id === 'dettes_garanties'));
  assert.match(facts.financement.operatingPolicy.join(' '), /ne lit pas les pièces/);
});
