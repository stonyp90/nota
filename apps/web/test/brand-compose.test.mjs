/**
 * LA PLANCHE SERVIE EST CELLE QUE LE GÉNÉRATEUR PRODUIT.
 *
 * `apps/web/public/brand-compose.html` monte la même marque cinq fois : ses
 * quarante panneaux ont un balisage identique et ne diffèrent que par
 * l'identifiant du dessin. Une page pareille ne vaut que si elle reste
 * rigoureusement parallèle — dès qu'une main corrige UN panneau, la planche
 * cesse de comparer des marques et se met à comparer des accidents.
 *
 * Le filet est donc simple : la page servie doit être, octet pour octet, ce
 * que `brand-compose.mjs` produit. Une retouche à la main tombe ici, avec le
 * geste qui la répare (relancer le générateur après l'avoir corrigé, lui).
 *
 * Leçon du 2026-09-12, plusieurs sessions écrivant dans le même arbre : une
 * réécriture de page entière depuis la version validée emporte silencieusement
 * le travail des autres. Un générateur commis à côté de sa page rend cette
 * perte visible au lieu de la laisser passer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, CIBLE } from '../brand-compose.mjs';

const SERVI = readFileSync(CIBLE, 'utf8');

test('la page servie est exactement la sortie du générateur', () => {
  assert.equal(SERVI, build(),
    'brand-compose.html a été retouché à la main : corrige apps/web/brand-compose.mjs, puis `node apps/web/brand-compose.mjs`');
});

test('les cinq marques montent le même gabarit, seul le dessin change', () => {
  const sections = SERVI.match(/<section class="marque[^"]*">/g) || [];
  assert.equal(sections.length, 5, 'cinq marques, ni plus ni moins');

  // Chaque planche porte les huit pièces, dans le même ordre.
  const PIECES = ['Lockup · fond nuit', 'Lockup · fond papier', 'Empilé',
    'La lettre seule', 'Barre d’accueil · thème sombre', 'Barre d’accueil · thème clair',
    'Carte sociale', 'Signature de courriel'];
  for (const piece of PIECES) {
    // Comptées sur la LÉGENDE : les commentaires du style nomment les mêmes
    // pièces, et un filet qui les confondrait compterait de travers.
    const n = SERVI.split('<div class="cap">' + piece).length - 1;
    assert.equal(n, 5, 'la pièce « ' + piece + ' » manque à une planche (trouvée ' + n + ' fois)');
  }

  // Les sept dessins vivent une seule fois, en <symbol> ; partout ailleurs on
  // les référence. Un dessin recopié, c'est un dessin qui divergera.
  for (const id of ['n-plein', 'n-couture', 'n-paraphe', 'w-plein', 'w-couture', 'w-paraphe', 'w-point-haut']) {
    const declarations = SERVI.split('<symbol id="' + id + '"').length - 1;
    assert.equal(declarations, 1, 'le dessin ' + id + ' est déclaré une fois');
  }
  const horsDefs = SERVI.slice(SERVI.indexOf('</svg>') + 6);
  assert.equal(/<path |<polygon /.test(horsDefs), false, 'une lettre est redessinée hors des symboles');
});

test('chaque symbole part de l’origine zéro', () => {
  // Un <symbol viewBox="0 3.5 …"> référencé par un <svg viewBox="0 3.5 …">
  // décale le dessin de 3,5 et le rogne par le haut : les deux viewBox se
  // composent. Toute la planche part donc de 0, symboles comme références.
  for (const vb of SERVI.match(/viewBox="[^"]*"/g) || []) {
    assert.match(vb, /viewBox="0 0 /, 'un viewBox ne commence pas à l’origine : ' + vb);
  }
});
