import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const D = createRequire(import.meta.url)('../index.js');
const TODAY = '2026-09-09';

const ANSWERS = {
  testament: {
    nombre_testateurs: 1, situation_familiale: 'celibataire', regime_familial: 'aucun', enfants: 'aucun',
    nombre_beneficiaires: 1, liquidateur: 'un', testament_existant: 'non', legs_complexes: 'aucun',
    nombre_immeubles: 'aucun', entreprise: false, biens_hors_qc: false, protection_beneficiaires: 'aucune',
    langue_acte: 'francais', accessibilite: 'aucune', temoin_supplementaire: false, deplacement: 'client_50',
  },
  procuration: {
    nombre_mandants: 1, nombre_mandataires: 1, mode_action: 'separement', portee_mandat: 'specifique',
    pouvoirs_sensibles: 'administration', nombre_institutions: 1, mandat_existant: 'non', duree_mandat: 'indeterminee',
    reddition_compte: false, remplacement_mandataire: false, langue_acte: 'francais', accessibilite: 'aucune',
    nombre_immeubles: 'aucun', deplacement: 'client_50',
  },
};

test('testament et procuration sont vendus avec une intake complète et des prix distincts', () => {
  assert.deepEqual(D.ACTES_A_VENIR, []);
  for (const id of ['testament', 'procuration']) {
    const service = D.serviceById(id);
    assert.ok(service);
    assert.ok(service.documents.length >= 4);
    assert.ok(service.champs.length >= 5);
    assert.equal(D.missingRequired(id, ANSWERS[id]).length, 0);
    assert.equal(D.computeBasePrice(id, {}), service.prixDepart);
    assert.ok(D.computeBasePrice(id, { ...ANSWERS[id], deplacement: 'urgence_en_ligne' }) > service.prixDepart);
  }
});

test('every price driver is explicit, and the notary-facing intake covers the file', () => {
  const expected = {
    testament: {
      criteria: ['nombre_testateurs', 'situation_familiale', 'enfants', 'nombre_beneficiaires', 'regime_familial', 'liquidateur', 'testament_existant', 'legs_complexes', 'nombre_immeubles', 'entreprise', 'biens_hors_qc', 'protection_beneficiaires', 'langue_acte', 'accessibilite', 'temoin_supplementaire', 'deplacement'],
      fields: ['testateurs', 'situation_familiale', 'regime_familial', 'enfants_personnes_charge', 'beneficiaires_legataires', 'liquidateur_souhaite', 'volontes_principales', 'actifs_importants', 'contraintes_particulieres'],
    },
    procuration: {
      criteria: ['nombre_mandants', 'nombre_mandataires', 'portee_mandat', 'nombre_institutions', 'mode_action', 'pouvoirs_sensibles', 'mandat_existant', 'duree_mandat', 'reddition_compte', 'remplacement_mandataire', 'langue_acte', 'accessibilite', 'nombre_immeubles', 'deplacement'],
      fields: ['type_mandat', 'mandants', 'mandataires', 'relation_mandataires', 'objet_mandat', 'immeuble_mandat', 'institutions_transactions', 'duree_mandat', 'contact_tiers'],
    },
  };
  for (const [id, shape] of Object.entries(expected)) {
    const service = D.serviceById(id);
    assert.deepEqual(service.pricing.criteria.map(c => c.id), shape.criteria);
    assert.ok(service.pricing.criteria.every(c => c.required), `${id}: every price driver is required`);
    assert.deepEqual(service.champs.map(c => c.id), shape.fields);
    assert.deepEqual(D.missingRequired(id, ANSWERS[id]), []);
  }
});

test('un testament complexe et une procuration immobilière font monter le plancher de manière explicite', () => {
  const testament = D.computeBasePrice('testament', { ...ANSWERS.testament, enfants: 'vulnerables', legs_complexes: 'fiducie', entreprise: true });
  assert.equal(testament, 1800 + 350 + 600 + 350);
  const procuration = D.computeBasePrice('procuration', { ...ANSWERS.procuration, portee_mandat: 'immeuble', nombre_mandants: 2, pouvoirs_sensibles: 'immeuble' });
  assert.equal(procuration, 1500 + 350 + 400 + 250);
  assert.equal(D.complexity('procuration', { ...ANSWERS.procuration, portee_mandat: 'immeuble' }).level, 'standard');
});

test('les documents conditionnels suivent les réponses, sans faire deviner au notaire', () => {
  const testamentDocs = answers => D.dossierItems('testament', answers).filter(i => i.kind === 'doc').map(i => i.id);
  assert.ok(!testamentDocs({ ...ANSWERS.testament, testament_existant: 'non', enfants: 'aucun' }).includes('testament_existant'));
  assert.ok(testamentDocs({ ...ANSWERS.testament, testament_existant: 'oui', enfants: 'mineurs' }).includes('testament_existant'));
  assert.ok(testamentDocs({ ...ANSWERS.testament, testament_existant: 'oui', enfants: 'mineurs' }).includes('personnes_a_charge'));
  const procDocs = answers => D.dossierItems('procuration', answers).filter(i => i.kind === 'doc').map(i => i.id);
  assert.ok(!procDocs(ANSWERS.procuration).includes('documents_immeuble'));
  assert.ok(procDocs({ ...ANSWERS.procuration, portee_mandat: 'immeuble' }).includes('documents_immeuble'));
});

test('validateOffer is the acceptance price gate for both new services', () => {
  for (const id of ['testament', 'procuration']) {
    const tooLow = D.validateOffer({ serviceId: id, dateISO: '2026-09-20', todayISO: TODAY, montant: 1, prefixe: 'G1R', pricing: ANSWERS[id] });
    assert.equal(tooLow.ok, false);
    assert.ok(tooLow.errors.some(e => e.code === 'sous_prix_depart'));
    const ok = D.validateOffer({ serviceId: id, dateISO: '2026-09-20', todayISO: TODAY, montant: D.computeBasePrice(id, ANSWERS[id]), prefixe: 'G1R', pricing: ANSWERS[id] });
    assert.equal(ok.ok, true);
    assert.equal(ok.basePrice, D.computeBasePrice(id, ANSWERS[id]));
  }
});

test('le paquet de travail et l’assistance IA existent même sans fournisseur', () => {
  const bid = { id: 'b-testament', dateISO: '2026-09-20', serviceId: 'testament', status: D.STATUS.RETENUE,
    notaryId: 'n1', pricing: ANSWERS.testament, dossier: { volontes_principales: 'legs à discuter' } };
  const packet = D.actWorkPacket(bid, { todayISO: TODAY });
  assert.equal(packet.serviceId, 'testament');
  assert.ok(packet.missing.length > 0);
  assert.ok(packet.checks.some(c => c.id === 'capacity'));
  const pages = [{ documentId: 'will', page: 1, text: 'Testatrice : Marie Roy. Enfants : aucun.' }];
  const input = { serviceId: 'testament', pages };
  assert.equal(D.validateActAIInput(input).ok, true);
  const extracted = D.validateActAIExtraction(input, { fields: [{ fieldId: 'testator_names', value: 'Marie Roy', evidence: [{ documentId: 'will', page: 1, quote: 'Testatrice : Marie Roy' }] }] });
  assert.equal(extracted.ok, true);
  assert.ok(extracted.value.missing.includes('beneficiaries'));
});
