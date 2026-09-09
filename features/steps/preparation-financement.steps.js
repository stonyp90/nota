const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const D = require('@nota/domain');
When('le client a déjà indiqué son adresse et son prêteur', function () {
  this.workPacket = D.financingWorkPacket({ serviceId: 'refinancement', dossier: { adresse: '12 rue Exemple' }, pricing: { preteur: 'rbc', valeur_pret: 250000 } });
});
Then('Nota prépare ces renseignements sans les redemander', function () {
  assert.ok(this.workPacket.draftFields.some(f => f.fieldId === 'property_address' && f.value === '12 rue Exemple'));
  assert.ok(!this.workPacket.missing.some(i => ['adresse', 'preteur', 'valeur_pret'].includes(i.id)));
});
Then('les vérifications officielles restent en attente', function () {
  assert.ok(this.workPacket.checks.every(c => c.status === 'pending'));
  assert.equal(this.workPacket.measurement.measuredReduction, null);
});
When('une extraction cite une page absente du dossier', function () {
  this.extraction = D.validateFinancingAIExtraction({ serviceId: 'refinancement', pages: [
    { documentId: 'offre', page: 1, text: 'Banque Exemple' },
  ] }, { fields: [{ fieldId: 'lender_name', value: 'Banque Exemple', evidence: [
    { documentId: 'offre', page: 2, quote: 'Banque Exemple' },
  ] }] });
});
Then('la proposition de financement est refusée', function () {
  assert.equal(this.extraction.ok, false);
});
When('le notaire accepte un champ extrait avec sa preuve', function () {
  this.aiReview = D.validateFinancingAIReview({ id: 'analyse-1', preparation: { fields: [{}] } }, {
    analysisId: 'analyse-1', decisions: [{ index: 0, decision: 'accepted' }], trainingEligible: true,
  });
});
Then('la révision reste privée et ne certifie pas la signature', function () {
  assert.equal(this.aiReview.ok, true);
  assert.equal(this.aiReview.value.trainingEligible, false);
  assert.equal(this.aiReview.value.signingReadiness, 'not_assessed');
});
When('tous les éléments du refinancement sont déclarés', function () {
  const dossier = Object.fromEntries(D.dossierItems('refinancement').map(item => [item.id, 'Déclaré']));
  this.brief = D.financingPreparation('refinancement', dossier);
});
Then('les vérifications du notaire restent à faire', function () {
  assert.equal(this.brief.missing.length, 0);
  assert.equal(this.brief.signingReadiness, 'not_assessed');
  assert.ok(this.brief.checks.every(check => check.status === 'notary_review_required'));
});
When('je prépare les renseignements de refinancement', function () {
  this.preparation = D.cleanDossier('refinancement', {
    parties_signature: 'Deux propriétaires', contact_preteur: 'Conseiller bancaire',
    dettes_garanties: 'Prêt et marge', aiReadyToSign: true,
  });
});
Then('le dossier conserve les parties, le prêteur et les dettes garanties', function () {
  assert.equal(this.preparation.parties_signature, 'Deux propriétaires');
  assert.equal(this.preparation.contact_preteur, 'Conseiller bancaire');
  assert.equal(this.preparation.dettes_garanties, 'Prêt et marge');
});
Then('les champs inconnus ne certifient pas la signature', function () {
  assert.equal(this.preparation.aiReadyToSign, undefined);
});
