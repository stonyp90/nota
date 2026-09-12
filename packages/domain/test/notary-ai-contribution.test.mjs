import test from 'node:test';
import assert from 'node:assert/strict';
import domain from '../index.js';

// ADR 0052 — la préparation assistée a deux voies et une seule différence :
// le notaire paie, ou il enseigne.

test('une entitlement payée rend la contribution facultative', () => {
  assert.equal(domain.notaryAIContribution({ abonnementActif: true }).mode, 'facultative');
  assert.equal(domain.notaryAIContribution({ unitesPayees: 3 }).mode, 'facultative');
  // Un abonnement actif dont le quota du mois est épuisé reste un abonnement :
  // le notaire a payé, il ne se met pas à contribuer parce qu'il a beaucoup
  // travaillé en septembre.
  assert.equal(domain.notaryAIContribution({ abonnementActif: true, unitesPayees: 0 }).mode, 'facultative');
});

test('la voie gratuite exige la contribution', () => {
  const gratuit = domain.notaryAIContribution({ abonnementActif: false, unitesPayees: 0 });
  assert.equal(gratuit.mode, 'requise');
  assert.equal(domain.notaryAIContribution(null).mode, 'requise');
  assert.equal(domain.notaryAIContribution({ unitesPayees: -2 }).mode, 'requise');
});

test('ce qui est donné est borné aux jugements du notaire, jamais au dossier du client', () => {
  const c = domain.notaryAIContribution({});
  // Les deux natures d'événement de l'ADR 0047 qui portent un jugement du
  // notaire — et elles seules.
  assert.deepEqual(c.donne, ['notary_review', 'notary_question']);
  for (const kind of c.donne) {
    const policy = domain.notaryLearningPolicyFor(kind);
    assert.equal(policy.source, 'notary', kind + ' doit venir du notaire');
  }
  // Le secret professionnel appartient au client (art. 14 C.déont.) : aucune
  // nature d'événement contribuable ne porte de matière du client.
  assert.ok(!c.donne.includes('customer_input'));
  assert.ok(!c.donne.includes('client_feedback'));
  assert.ok(c.jamais.length >= 3);
});

test('le refus laisse la place de marché entière — c\'est ce qui rend le consentement libre', () => {
  const c = domain.notaryAIContribution({});
  assert.equal(c.refusRetire, 'preparation_assistee');
  assert.equal(c.refusConserve, 'marche_complet');
  assert.equal(c.sortie, 'abonnement_ou_unite');
});
