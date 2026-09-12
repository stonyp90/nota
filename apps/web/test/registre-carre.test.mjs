/**
 * LE REGISTRE CARRÉ : UNE SEULE ÉCHELLE DE COINS, SUR TOUTES LES SURFACES.
 *
 * Le propriétaire, 2026-08-27 : « tout garder le même style carré ». ADR 0048 :
 * la marque est la même partout, et un coin n'est pas une préférence de
 * composant — c'est un barreau de l'échelle, 12 / 8 / 6 / 3 px, déclaré une fois
 * par feuille et lu par jeton. Seul un point de 8 px ou moins reste rond.
 *
 * Ce filet manquait. Le carnet et la console tenaient la règle à la main, mais
 * les deux documents autonomes (le deck, le plan d'affaires) avaient dérivé vers
 * une géométrie à eux — 999px, 50%, 4, 5, 7, 9, 10, 14 et 16px — et la console
 * avait gardé deux gélules dans le CRM. Une page qui arrondit ses pastilles
 * n'est plus la même marque que celle qui les coupe au carré.
 *
 * Deux invariants voisins n'avaient de maison nulle part et vivent ici : un
 * jeton ne se pointe pas lui-même, et la chrome du navigateur suit le canevas
 * sur chaque surface (ADR 0048 : « le theme-color suit le canevas »).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// Les feuilles partagées (elles lisent leurs jetons) et les deux documents
// autonomes, qui n'héritent de rien et recopient donc l'échelle chez eux.
const CARNET = read('../public/styles.css');
const JETONS_ADMIN = read('../../admin/public/tokens.css');
const ADMIN = read('../../admin/public/admin.css');
const SALLE = read('../public/signature.css');
const DECK = read('../../../docs/pitch-deck.html');
const PLAN = read('../../../docs/business-plan.html');
// Le générateur du plan : c'est LUI la source, la page n'en est que la sortie.
const GENERATEUR = read('../../../docs/planning/render-business-plan.py');

const SURFACES = [['admin.css', ADMIN], ['signature.css', SALLE], ['pitch-deck.html', DECK], ['business-plan.html', PLAN]];
const COPIES_DE_L_ECHELLE = [['styles.css', CARNET], ['tokens.css', JETONS_ADMIN], ['pitch-deck.html', DECK], ['business-plan.html', PLAN]];

/** Commentaires neutralisés, longueurs conservées pour que les lignes restent justes. */
const net = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** Chaque valeur de border-radius d'une feuille, avec sa ligne.
 *  Les glyphes de chapitre du plan (.signal--*) sont des DESSINS : un rond y est
 *  une forme, pas un coin d'interface, et le registre ne les gouverne pas. */
const DESSIN = /signal--/;
function rayons(src) {
  const propre = net(src);
  const out = [];
  const re = /border-radius\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(propre))) {
    const avant = propre.slice(0, m.index);
    const sel = avant.split('}').pop().split('{')[0];
    if (DESSIN.test(sel)) continue;
    out.push({ valeur: m[1].trim(), ligne: avant.split('\n').length });
  }
  return out;
}

const BARREAUX = [0, 3, 6, 8, 12];

test('aucune gélule : un coin ne dépasse jamais le barreau haut', () => {
  const fautifs = [];
  for (const [nom, src] of [...SURFACES, ['styles.css', CARNET]]) {
    for (const r of rayons(src)) {
      for (const px of r.valeur.match(/(\d+(?:\.\d+)?)px/g) || []) {
        if (parseFloat(px) > 12) fautifs.push(nom + ':' + r.ligne + ' border-radius: ' + r.valeur);
      }
    }
  }
  assert.deepEqual([...new Set(fautifs)], [], 'une gélule (99px, 999px…) n’est pas un coin de l’échelle — prendre --radius-sm ou --radius-xs');
});

test('chaque coin littéral tombe sur un barreau : 12 / 8 / 6 / 3', () => {
  const fautifs = [];
  for (const [nom, src] of SURFACES) {
    for (const r of rayons(src)) {
      for (const px of r.valeur.match(/(\d+(?:\.\d+)?)px/g) || []) {
        if (!BARREAUX.includes(parseFloat(px))) fautifs.push(nom + ':' + r.ligne + ' ' + px + ' (border-radius: ' + r.valeur + ')');
      }
    }
  }
  assert.deepEqual([...new Set(fautifs)], [], 'un coin hors échelle est un second registre — 12 / 8 / 6 / 3, par jeton');
});

test('la console et la salle lisent leurs coins par jeton, jamais en dur', () => {
  const durs = [];
  for (const [nom, src] of [['admin.css', ADMIN], ['signature.css', SALLE]]) {
    for (const r of rayons(src).filter((r) => /\d+px/.test(r.valeur))) durs.push(nom + ':' + r.ligne + ' ' + r.valeur);
  }
  assert.deepEqual(durs, [], 'les deux feuilles déclarent --radius / --radius-sm / --radius-xs / --radius-lg : elles les lisent');
});

test('les quatre barreaux portent la même valeur dans chaque copie de l’échelle', () => {
  const jeton = (src, nom) => {
    const m = src.match(new RegExp('(^|[;{\\s])' + nom + ':\\s*([^;}]+)'));
    return m ? m[2].replace(/\s+/g, '') : null;
  };
  const attendu = { '--radius-lg': '12px', '--radius': '8px', '--radius-sm': '6px', '--radius-xs': '3px' };
  const fautifs = [];
  for (const [nom, src] of COPIES_DE_L_ECHELLE) {
    for (const [t, v] of Object.entries(attendu)) {
      const lu = jeton(src, t);
      if (lu !== v) fautifs.push(nom + ' ' + t + ' = ' + lu + ' (attendu ' + v + ')');
    }
  }
  assert.deepEqual(fautifs, [], 'les quatre barreaux sont les mêmes partout — une copie qui dérive est une seconde géométrie');
});

// Le plan d'affaires est une SORTIE : le corriger dans la page ne tient pas, la
// prochaine génération l'écrase. La règle vit dans le générateur.
test('le générateur du plan n’écrit ni gélule ni coin hors échelle', () => {
  const fautifs = [];
  for (const r of rayons(GENERATEUR)) {
    for (const px of r.valeur.match(/(\d+(?:\.\d+)?)px/g) || []) {
      if (!BARREAUX.includes(parseFloat(px))) fautifs.push('render-business-plan.py:' + r.ligne + ' ' + px);
    }
  }
  assert.deepEqual([...new Set(fautifs)], [], 'la feuille que le générateur écrit tient la même échelle que la page qu’elle habille');
});

// Un jeton qui se pointe lui-même n'a plus de valeur du tout : la déclaration est
// invalide et la couleur disparaît de la page sans rien casser de visible. C'est
// exactement ce qui arrive quand un second nom (--oxide: var(--danger)) se fait
// renommer vers le nom qu'il aliasait.
test('aucun jeton ne se pointe lui-même', () => {
  const fautifs = [];
  for (const [nom, src] of [...COPIES_DE_L_ECHELLE, ['admin.css', ADMIN], ['signature.css', SALLE], ['render-business-plan.py', GENERATEUR]]) {
    for (const m of net(src).matchAll(/(--[\w-]+)\s*:\s*var\(\1\)/g)) fautifs.push(nom + ' ' + m[1]);
  }
  assert.deepEqual([...new Set(fautifs)], [], 'un alias renommé vers sa propre cible rend le jeton vide');
});

// La chrome du navigateur fait partie de la marque : elle est la première chose
// peinte, avant le premier octet de la page. La console n'annonçait que le clair
// alors qu'elle a un thème sombre qui répond ; ux-nav.test.mjs ne lit que le web,
// donc personne ne l'avait vu.
test('chaque surface annonce sa chrome dans les deux thèmes', () => {
  const PAGES = [
    ['apps/web/public/index.html', read('../public/index.html')],
    ['apps/admin/public/index.html', read('../../admin/public/index.html')],
    // La salle de signature répond au thème clair depuis l'ADR 0047 (theme-boot.js)
    // mais n'annonçait qu'une chrome de nuit : un client clair traversait un carnet
    // clair puis voyait la barre du navigateur virer au noir pour signer.
    ['apps/web/public/signature.html', read('../public/signature.html')],
    ['apps/web/public/brand.html', read('../public/brand.html')],
    ['docs/pitch-deck.html', DECK],
    ['docs/business-plan.html', PLAN],
  ];
  const fautifs = [];
  for (const [nom, src] of PAGES) {
    const metas = [...src.matchAll(/<meta[^>]*name="theme-color"[^>]*>/g)].map((m) => m[0]);
    const sombre = metas.find((m) => /prefers-color-scheme:\s*dark/.test(m));
    const clair = metas.find((m) => !/prefers-color-scheme:\s*dark/.test(m));
    if (!sombre || !/#101820/i.test(sombre)) fautifs.push(nom + ' : pas de theme-color sombre #101820');
    if (!clair || !/#386888/i.test(clair)) fautifs.push(nom + ' : pas de theme-color clair #386888');
  }
  assert.deepEqual(fautifs, [], 'la chrome suit le canevas — deux metas par surface, jamais une seule');
});
