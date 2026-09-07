/**
 * Les questions du notaire, GROUPÉES (2026-09-05).
 *
 * Retour du propriétaire : « on peut grouper en sections et rendre ça le plus
 * intuitif possible pour chaque cas ». L'écran 2 de la feuille alignait dix
 * questions sur une grille plate — le montant du prêt, la succession et le
 * déplacement se suivaient sans dire ce qui les reliait, et les quatre
 * facultatives tombaient toutes dans un seul tiroir anonyme (« Affiner »).
 *
 * Le REGROUPEMENT est une DONNÉE du domaine, jamais une liste écrite dans un
 * adaptateur : la feuille cliente, le carnet du dossier — et demain la console
 * notaire — lisent le même ordre et les mêmes intitulés.
 *
 * Trois invariants :
 *   1. le catalogue des sections est déclaré une fois et chaque critère y
 *      appartient (aucun orphelin, aucune section vide) ;
 *   2. criteriaGroups() rend les sections dans l'ordre du catalogue et les
 *      questions dans l'ordre de l'acte — la lecture ne dépend pas du CSS ;
 *   3. chaque section porte au moins UNE question obligatoire : une section
 *      qui n'ouvrirait qu'un tiroir facultatif ne serait qu'un titre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const D = createRequire(import.meta.url)('../index.js');
const ACTS = ['refinancement', 'financement'];

test('le catalogue des sections est une donnée du domaine, avec un intitulé et une raison d’être', () => {
  assert.ok(Array.isArray(D.CRITERIA_GROUPS) && D.CRITERIA_GROUPS.length >= 2, 'plusieurs sections');
  const ids = D.CRITERIA_GROUPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'des identifiants uniques');
  for (const g of D.CRITERIA_GROUPS) {
    assert.match(g.nom, /\S/, `${g.id} porte un intitulé`);
    assert.match(g.aide, /\S/, `${g.id} dit à quoi la section sert`);
  }
});

test('chaque critère de chaque acte déclare une section connue — aucun orphelin', () => {
  const known = new Set(D.CRITERIA_GROUPS.map((g) => g.id));
  for (const sid of ACTS) {
    for (const c of D.serviceById(sid).pricing.criteria) {
      assert.ok(known.has(c.groupe), `${sid}/${c.id} déclare une section connue (reçu: ${c.groupe})`);
    }
  }
});

test('criteriaGroups() rend les sections dans l’ordre du catalogue et les questions dans l’ordre de l’acte', () => {
  for (const sid of ACTS) {
    const groups = D.criteriaGroups(sid);
    const order = D.CRITERIA_GROUPS.map((g) => g.id).filter((id) => groups.some((x) => x.id === id));
    assert.deepEqual(groups.map((g) => g.id), order, `${sid}: l’ordre est celui du catalogue`);
    // Les questions d'une section suivent l'ordre déclaré par l'acte.
    const declared = D.serviceById(sid).pricing.criteria.map((c) => c.id);
    for (const g of groups) {
      const ids = g.criteria.map((c) => c.id);
      const expected = declared.filter((id) => ids.includes(id));
      assert.deepEqual(ids, expected, `${sid}/${g.id}: l’ordre de l’acte est conservé`);
    }
    // Rien ne se perd et rien ne se répète en chemin.
    assert.deepEqual(
      groups.flatMap((g) => g.criteria.map((c) => c.id)).sort(),
      declared.slice().sort(),
      `${sid}: toutes les questions, une seule fois`,
    );
  }
});

test('chaque section sépare l’obligatoire du facultatif, et n’existe que si elle demande quelque chose', () => {
  for (const sid of ACTS) {
    for (const g of D.criteriaGroups(sid)) {
      assert.ok(g.criteria.length, `${sid}/${g.id}: une section vide n’est pas rendue`);
      assert.deepEqual(g.requis.map((c) => c.id), g.criteria.filter((c) => c.required).map((c) => c.id));
      assert.deepEqual(g.facultatifs.map((c) => c.id), g.criteria.filter((c) => !c.required).map((c) => c.id));
      assert.ok(g.requis.length, `${sid}/${g.id}: une section porte au moins une question obligatoire`);
      assert.equal(g.nom, D.CRITERIA_GROUPS.find((x) => x.id === g.id).nom, 'l’intitulé vient du catalogue');
      assert.equal(g.aide, D.CRITERIA_GROUPS.find((x) => x.id === g.id).aide);
    }
  }
});

test('un acte sans questions n’a pas de sections, et un acte inconnu n’explose pas', () => {
  assert.deepEqual(D.criteriaGroups('acte-qui-n-existe-pas'), []);
});

test('la conséquence d’une réponse sur les documents est dite par le domaine, mesurée contre l’absence de réponse', () => {
  // « Ajoute un document : … » / « Retire un document : … » sous la réponse
  // (l'écran 2) lit CETTE porte.
  for (const sid of ACTS) {
    const svc = D.serviceById(sid);
    const oui = D.documentEffect(svc, 'succession', 'oui');
    assert.deepEqual(oui.ajoutes.map((d) => d.id), ['testament_transmission'], `${sid}: « Oui » appelle la transmission`);
    assert.deepEqual(oui.retires, [], 'et ne retire rien');
    assert.deepEqual(D.documentEffect(svc, 'succession', 'non'), { ajoutes: [], retires: [] }, '« Non » ne change rien');
    // Sans réponse, rien ne bouge — la ligne de conséquence reste muette.
    assert.deepEqual(D.documentEffect(svc, 'succession', undefined), { ajoutes: [], retires: [] });
    // Une question sans document conditionnel ne promet rien.
    assert.deepEqual(D.documentEffect(svc, 'approbation_bancaire', 'en_cours'), { ajoutes: [], retires: [] });
    // Un document collecté PAR DÉFAUT (`sauf`) ne s’ajoute jamais : il se retire.
    const aJour = D.documentEffect(svc, 'certificat_localisation', 'a_jour');
    assert.deepEqual(aJour, { ajoutes: [], retires: [] }, 'à jour : le document était déjà attendu');
    const perime = D.documentEffect(svc, 'certificat_localisation', 'perime');
    assert.deepEqual(perime.ajoutes, []);
    assert.deepEqual(perime.retires.map((d) => d.id), ['certificat_localisation'], 'périmé : plus rien à téléverser');
  }
  assert.deepEqual(D.documentEffect(null, 'succession', 'oui'), { ajoutes: [], retires: [] });
  const fin = D.serviceById('financement');
  assert.deepEqual(D.documentEffect(fin, 'contexte', 'achat').ajoutes.map((d) => d.id), ['promesse_achat']);
  assert.deepEqual(D.documentEffect(fin, 'contexte', 'propriete_detenue').ajoutes, []);
});
