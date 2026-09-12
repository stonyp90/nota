/**
 * LE TIROIR DU TÉLÉPHONE : LA MARQUE, LA PISTE ET LE GALET.
 *
 * Propriétaire, 2026-09-12, capture du tiroir ouvert sur un téléphone. Trois
 * défauts sur la même image, tous invisibles à la souris :
 *
 * 1. LA MARQUE MESURAIT 162 px au lieu de 26. `.brand-mark` pose
 *    `width: var(--lockup-tile)` et ce jeton n'existe QUE sur `.brand-lockup` ;
 *    l'en-tête du tiroir n'en a pas, donc la déclaration devenait invalide,
 *    la largeur repassait à `auto` et l'image remplissait la ligne. Un jeton
 *    manquant ne doit jamais pouvoir agrandir un logo : d'où la valeur de repli.
 *
 * 2. LE GALET DE L'INTERRUPTEUR DE THÈME SORTAIT DE SA PISTE. Le galet EST
 *    `.tswitch::before` (24 px, fond, cadre, ombre). La règle tactile du
 *    2026-09-11 a redéclaré le MÊME pseudo-élément pour agrandir la cible
 *    (`inset: -8px -4px`), ce qui a écrasé sa géométrie : sur tout pointeur
 *    grossier, le galet devenait une boîte décalée hors du contrôle. La cible
 *    tactile prend donc `::after`, qui ne peint rien.
 *
 * 3. LES BOUTONS FR|EN DÉBORDAIENT DE LEUR PISTE. Au doigt, `.mini-seg-btn`
 *    monte à 44 px de haut dans une piste de 28 : 8 px dehors en haut et en
 *    bas. La piste grandit avec eux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
const HTML = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

/** Le corps de la première règle qui porte exactement ce sélecteur. */
function regle(selecteur) {
  const re = new RegExp('(^|[}\\n])\\s*' + selecteur.replace(/[.[\]()*+?^$|\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = CSS.match(re);
  assert.ok(m, 'règle introuvable : ' + selecteur);
  return m[2];
}

/** TOUS les blocs @media (pointer: coarse) mis bout à bout : la couche
 *  tactile est éclatée en plusieurs endroits de la feuille, et la règle vaut
 *  pour l'ensemble. */
function blocTactile() {
  const blocs = [];
  let i = CSS.indexOf('@media (pointer: coarse) {');
  while (i > 0) {
    let depth = 0;
    for (let j = CSS.indexOf('{', i); j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}' && --depth === 0) { blocs.push(CSS.slice(i, j)); i = CSS.indexOf('@media (pointer: coarse) {', j); break; }
    }
  }
  assert.ok(blocs.length, 'la couche tactile existe');
  return blocs.join('\n');
}

test('un jeton de lockup absent ne peut plus agrandir la marque', () => {
  for (const sel of ['.brand-mark', '.brand-mark-svg']) {
    const corps = regle(sel);
    for (const prop of ['width', 'height']) {
      const m = new RegExp(prop + ':\\s*var\\(--lockup-tile\\s*,\\s*(\\d+)px\\)').exec(corps);
      assert.ok(m, sel + ' : ' + prop + ' doit donner une valeur de repli à --lockup-tile');
      assert.ok(Number(m[1]) <= 40, sel + ' : le repli reste une marque d’en-tête, pas une affiche');
    }
  }
  // L'en-tête du tiroir pose sa propre taille, celle que son balisage annonce.
  assert.match(regle('.mnav-head'), /--lockup-tile:\s*26px/, 'le tiroir dit la taille de sa marque');
  assert.match(HTML, /<span class="brand-mark" aria-hidden="true"><img src="favicon\.svg" width="26" height="26"/, 'le balisage du tiroir annonce toujours 26');
});

test('la cible tactile ne prend pas la place du galet', () => {
  const tactile = blocTactile();
  assert.doesNotMatch(tactile, /\.tswitch::before\s*\{/, 'le galet vit dans ::before — la cible tactile doit passer par ::after');
  assert.match(tactile, /\.tswitch::after\s*\{[^}]*position:\s*absolute/, 'la cible tactile de l’interrupteur existe toujours');
  // Le galet garde sa géométrie : 24 px, collé au coin, pas un `inset`.
  const galet = regle('.tswitch::before');
  assert.match(galet, /width:\s*24px/, 'le galet mesure une cellule');
  assert.match(galet, /top:\s*2px;\s*left:\s*2px/, 'le galet est posé au coin, pas étiré');
});

test('la piste contient les boutons qu’elle a fait grandir', () => {
  const tactile = blocTactile();
  const btn = /\.mini-seg-btn\s*\{[^}]*min-height:\s*(\d+)px/.exec(tactile);
  assert.ok(btn, 'les boutons montent bien à 44 au doigt');
  const piste = /\.mini-seg\s*\{[^}]*height:\s*(\d+)px/.exec(tactile);
  assert.ok(piste, 'la piste doit grandir dans le même bloc');
  const pad = Number((/padding:\s*(\d+)px/.exec(regle('.mini-seg')) || [0, 0])[1]);
  assert.ok(Number(piste[1]) >= Number(btn[1]) + 2 * pad,
    'piste ' + piste[1] + 'px pour des boutons de ' + btn[1] + 'px et ' + pad + 'px de marge : ils débordent');
});
