import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// La cote sur 100 (ADR 0028). Quatre axes, tous mesurés sur ce que le notaire
// fait réellement : ce que les clients ont dit, les actes portés, la
// disponibilité offerte au marché, la présence tenue à jour. Le domaine ne sait
// rien du partage des honoraires — il produit un nombre, la couche facturation
// le traduit en pourcentages.

const NEUF = {                    // un notaire tout neuf, profil complet
  evaluations: { note: null, avis: 0 },
  actes: { total: 0, parService: {} },
  disponibilite: { repondu: 0, declinees: 0, rayonKm: 50, urgences: false },
  presence: { fiche: true, secteur: true, joursDepuisActivite: 0, joursMembre: 1 },
};
const EXCELLENT = {               // le sommet réaliste
  evaluations: { note: 4.9, avis: 40 },
  actes: { total: 80, parService: { refinancement: 50, financement: 30 } },
  disponibilite: { repondu: 60, declinees: 3, rayonKm: 50, urgences: true },
  presence: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 500 },
};

test('cote: le total est un entier de 0 à 100 et la somme des axes', () => {
  const s = D.notaryScore(EXCELLENT);
  assert.equal(typeof s.cote, 'number');
  assert.ok(Number.isInteger(s.cote), 'la cote affichée est un entier');
  assert.ok(s.cote >= 0 && s.cote <= 100);
  const somme = s.axes.reduce((t, a) => t + a.points, 0);
  assert.equal(s.cote, Math.round(somme), 'la cote est la somme des axes, rien d’autre');
  assert.equal(s.axes.reduce((t, a) => t + a.max, 0), 100, 'les maxima font exactement 100');
});

test('cote: les quatre axes du propriétaire sont là, nommés', () => {
  const ids = D.notaryScore(EXCELLENT).axes.map((a) => a.id);
  assert.deepEqual(ids, ['satisfaction', 'services', 'disponibilite', 'presence']);
});

test('cote: un notaire excellent dépasse 90 — le palier du haut est atteignable', () => {
  assert.ok(D.notaryScore(EXCELLENT).cote > 90, 'un notaire chevronné et aimé doit passer 90');
});

test('cote: le parfait absolu vaut 100', () => {
  const parfait = {
    evaluations: { note: 5, avis: 200 },
    actes: { total: 500, parService: { refinancement: 250, financement: 250 } },
    disponibilite: { repondu: 500, declinees: 0, rayonKm: 50, urgences: true },
    presence: { fiche: true, secteur: true, joursDepuisActivite: 0, joursMembre: 3000 },
  };
  assert.equal(D.notaryScore(parfait).cote, 100);
});

test('cote: un notaire neuf n’est ni à zéro ni au sommet — il démarre au taux de base', () => {
  const c = D.notaryScore(NEUF).cote;
  assert.ok(c > 30, 'un profil complet sans historique n’est pas un zéro : ' + c);
  assert.ok(c < 60, 'sans un seul acte ni avis, le sommet reste à gagner : ' + c);
});

test('cote: aucune évaluation ne vaut pas zéro étoile — la note démarre à l’a priori', () => {
  const sansAvis = D.notaryScore(NEUF).axes.find((a) => a.id === 'satisfaction');
  assert.equal(sansAvis.detail.note, null, 'pas de fausse moyenne');
  assert.ok(sansAvis.points > 0, 'l’a priori évite de punir le nouveau');
  assert.ok(sansAvis.points < sansAvis.max);
});

test('cote: une seule évaluation parfaite n’achète pas l’axe satisfaction', () => {
  const un = D.notaryScore({ ...NEUF, evaluations: { note: 5, avis: 1 } });
  const trente = D.notaryScore({ ...NEUF, evaluations: { note: 5, avis: 30 } });
  const a1 = un.axes.find((a) => a.id === 'satisfaction');
  const a30 = trente.axes.find((a) => a.id === 'satisfaction');
  assert.ok(a30.points > a1.points + 5, 'la confiance dans la moyenne compte');
  assert.ok(a1.points < a1.max * 0.75);
});

test('cote: une mauvaise note fait vraiment mal', () => {
  const mauvais = D.notaryScore({ ...NEUF, evaluations: { note: 2.5, avis: 20 } });
  const a = mauvais.axes.find((a) => a.id === 'satisfaction');
  assert.ok(a.points < a.max * 0.2, 'une moyenne sous 3 vide l’axe : ' + a.points);
});

test('cote: les actes comptent, avec rendement décroissant', () => {
  const vol = (n) => D.notaryScore({ ...NEUF, actes: { total: n, parService: { refinancement: n } } })
    .axes.find((a) => a.id === 'services').points;
  assert.ok(vol(10) > 0);
  // Dix actes de plus valent moins cher quand on en a déjà trente : même
  // intervalle, gain plus petit.
  assert.ok(vol(20) - vol(10) > vol(40) - vol(30), 'rendement décroissant');
});

test('cote: se spécialiser ne coûte rien — le Code impose de connaître ses limites', () => {
  const un = D.notaryScore({ ...NEUF, actes: { total: 10, parService: { refinancement: 10 } } });
  const deux = D.notaryScore({ ...NEUF, actes: { total: 10, parService: { refinancement: 5, financement: 5 } } });
  assert.equal(deux.cote, un.cote, 'même volume, même cote — l’éventail n’est pas une note');
  // L'information reste visible, elle a juste cessé d'être une sanction.
  const axe = un.axes.find((a) => a.id === 'services');
  assert.equal(axe.detail.servicesRendus, 1);
  assert.equal(axe.detail.catalogue, D.SERVICES.length);
});

test('cote: décliner est une RÉPONSE, jamais une pénalité — seul le silence coûte', () => {
  const axe = (s) => D.notaryScore({ ...NEUF, disponibilite: { ...NEUF.disponibilite, ...s } })
    .axes.find((a) => a.id === 'disponibilite');

  const silence = axe({ repondu: 0, declinees: 0 });
  const dixDeclins = axe({ repondu: 0, declinees: 10 });
  const dixAccords = axe({ repondu: 10, declinees: 0 });
  const melange = axe({ repondu: 5, declinees: 5 });

  assert.ok(dixDeclins.points > silence.points, 'répondre dix fois vaut mieux que ne rien répondre');
  assert.equal(melange.points, dixAccords.points, 'la teneur de la réponse ne change pas la note');
  assert.equal(dixDeclins.points, dixAccords.points, 'un notaire qui refuse ce qu’il ne peut pas porter n’est pas puni');
  assert.equal(melange.detail.reponses, 10);
  assert.equal(melange.detail.declinees, 5, 'le détail reste honnête sur ce qui s’est passé');
});

test('cote: répondre à tout le marché, partout, remplit l’axe disponibilité', () => {
  const plein = D.notaryScore({ ...NEUF, disponibilite: { repondu: 40, declinees: 0, rayonKm: 50, urgences: true } })
    .axes.find((a) => a.id === 'disponibilite');
  assert.equal(plein.points, plein.max);
  const rien = D.notaryScore({ ...NEUF, disponibilite: { repondu: 0, declinees: 0, rayonKm: 0, urgences: false } })
    .axes.find((a) => a.id === 'disponibilite');
  assert.equal(rien.points, 0, 'aucune réponse, aucune portée : rien');
});

test('cote: la présence se tient à jour — fiche, secteur, activité récente, ancienneté', () => {
  const plein = D.notaryScore(EXCELLENT).axes.find((a) => a.id === 'presence');
  assert.equal(plein.points, plein.max);
  const sansFiche = D.notaryScore({ ...EXCELLENT, presence: { ...EXCELLENT.presence, fiche: false } })
    .axes.find((a) => a.id === 'presence');
  assert.ok(sansFiche.points < plein.points);
  const absent = D.notaryScore({ ...EXCELLENT, presence: { ...EXCELLENT.presence, joursDepuisActivite: 120 } })
    .axes.find((a) => a.id === 'presence');
  assert.ok(absent.points < plein.points, 'un notaire qui ne vient plus perd sa présence');
});

test('cote: chaque axe s’explique — libellé, points, maximum, détail chiffré', () => {
  for (const a of D.notaryScore(EXCELLENT).axes) {
    assert.ok(a.nom && typeof a.nom === 'string', 'un libellé français');
    assert.ok(a.nomEn && typeof a.nomEn === 'string', 'et sa traduction');
    assert.ok(a.points >= 0 && a.points <= a.max);
    assert.equal(Math.round(a.points * 10) / 10, a.points, 'une décimale, pas douze');
    assert.equal(typeof a.detail, 'object');
  }
});

test('cote: une entrée vide ou absurde ne casse rien', () => {
  for (const bad of [undefined, null, {}, { evaluations: 'non', actes: 7, disponibilite: null, presence: [] }]) {
    const s = D.notaryScore(bad);
    assert.ok(Number.isInteger(s.cote) && s.cote >= 0 && s.cote <= 100, 'cote saine pour ' + JSON.stringify(bad));
  }
});

test('cote: la pondération est un document, pas une constante enfouie', () => {
  assert.equal(typeof D.COTE, 'object');
  const maison = D.notaryScore(EXCELLENT, { satisfaction: { ...D.COTE.satisfaction, max: 10 } });
  assert.equal(maison.axes.find((a) => a.id === 'satisfaction').max, 10);
});

test('cote: le palmarès par service dit ce que le notaire rend, service par service', () => {
  const ledger = [
    { note: 5, serviceId: 'refinancement', createdAt: '2026-08-01T00:00:00.000Z' },
    { note: 4, serviceId: 'refinancement', createdAt: '2026-08-02T00:00:00.000Z' },
    { note: 3, serviceId: 'financement', createdAt: '2026-08-03T00:00:00.000Z' },
    { note: 5, serviceId: null, createdAt: '2026-08-04T00:00:00.000Z' },
  ];
  const par = D.notaryServiceRecord(ledger, { refinancement: 6, financement: 2 });
  const refi = par.find((s) => s.serviceId === 'refinancement');
  assert.equal(refi.avis, 2);
  assert.equal(refi.note, 4.5);
  assert.equal(refi.actes, 6);
  assert.ok(refi.nom, 'le nom du service voyage avec la ligne');
  const fin = par.find((s) => s.serviceId === 'financement');
  assert.equal(fin.note, 3);
  assert.equal(fin.actes, 2);
  assert.equal(par.length, D.SERVICES.length, 'tout le catalogue est représenté, même à zéro');
});

test('cote: un service jamais rendu se lit à zéro, sans fausse note', () => {
  const par = D.notaryServiceRecord([], {});
  for (const s of par) {
    assert.equal(s.note, null);
    assert.equal(s.avis, 0);
    assert.equal(s.actes, 0);
  }
});
