/**
 * DES DÉCLARATIONS QUE LE NAVIGATEUR JETTE EN SILENCE.
 *
 * `inset: -calc(0.9 * var(--igu))` n'est pas du CSS : la négation doit vivre
 * DANS le calc (`calc(-0.9 * var(--igu))`). Une valeur invalide ne casse rien
 * de visible — le parseur jette la déclaration entière et passe à la suivante.
 * Trois règles du film d'accueil tombaient ainsi : l'anneau de la coche n'était
 * jamais positionné, celui de l'acceptation non plus, et la secousse
 * `igShake` ne partait que d'un côté (son image-clé à 30 % était rejetée).
 *
 * C'est le pire genre de bogue de style : rien dans la page ne signale qu'une
 * règle a été ignorée, et les tests de DOM ne le voient pas non plus. Ce
 * fichier relit donc la feuille elle-même.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = {
  'styles.css': readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8'),
  'admin.css': readFileSync(fileURLToPath(new URL('../../admin/public/admin.css', import.meta.url)), 'utf8'),
};

// Le numéro de ligne, pour que l'échec désigne la règle et pas la feuille.
function hits(src, re) {
  const out = [];
  src.split('\n').forEach((line, i) => { if (re.test(line)) out.push((i + 1) + ': ' + line.trim()); });
  return out;
}

test('aucune négation ne précède un calc() — la déclaration serait jetée', () => {
  for (const [nom, src] of Object.entries(files)) {
    const bad = hits(src, /[^a-zA-Z0-9)]-calc\(/);
    assert.deepEqual(bad, [], nom + ' porte des valeurs invalides :\n  ' + bad.join('\n  '));
  }
});

test('aucune unité ne colle à la parenthèse d’un var() — même effet', () => {
  // `var(--x)px` est invalide pour la même raison : la valeur est rejetée en bloc.
  for (const [nom, src] of Object.entries(files)) {
    const bad = hits(src, /var\(--[a-z0-9-]+\)(px|rem|em|%|vh|vw)\b/i);
    assert.deepEqual(bad, [], nom + ' colle une unité à un var() :\n  ' + bad.join('\n  '));
  }
});

test('chaque calc() ferme ses parenthèses', () => {
  for (const [nom, src] of Object.entries(files)) {
    src.split('\n').forEach((line, i) => {
      let depth = 0, start = -1;
      for (let c = 0; c < line.length; c++) {
        if (line.startsWith('calc(', c) && start < 0) { start = c; depth = 0; }
        if (start >= 0) {
          if (line[c] === '(') depth++;
          else if (line[c] === ')') { depth--; if (depth === 0) start = -1; }
        }
      }
      assert.equal(start, -1, nom + ':' + (i + 1) + ' — calc() non fermé : ' + line.trim());
    });
  }
});
