/**
 * LE REGISTRE D'ENCRE : UN TITRE EST BLANC OU NOIR, JAMAIS BLEU.
 *
 * Propriétaire, 2026-09-12 : « les titres doivent tout le temps être blanc ou
 * noir. Le bleu doit être utilisé dans des cas rares où on doit mentionner une
 * information importante. Se fier au brand que nous avons créé. Si ce n'est pas
 * exposé dans le brand, bien vouloir l'exposer. »
 *
 * La règle des sous-titres existait depuis le 2026-09-10 mais AUCUN test ne la
 * tenait : cinq titres avaient déjà redérivé vers la marque (le kicker du
 * panneau de marché, les trois titres du film d'accueil, le h1 de l'espace
 * notaire). Ce fichier est le filet, et brand.html l'expose au monde.
 *
 * Ce qui peut rester bleu : ce qui MENTIONNE une information — un montant, un
 * lien, une pastille, un glyphe, le cadre ou le crochet d'un contrôle retenu.
 * Jamais le libellé principal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
// Les trois feuilles servies, PLUS le CSS en ligne des pages autonomes : une
// page qui porte son style dans son <head> échappait au filet entièrement
// (relevé par une session sœur, 2026-09-12 — ses deux planches peignaient leur
// sur-titre en bleu et rien ne le voyait).
const enLigne = (nom, src) => [nom, (src.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n')];
// `brand-explorations.html` n'est PAS lu ici : c'est la planche des directions
// rejetées, et lui imposer le registre courant reviendrait à effacer ce qu'elle
// existe pour montrer.
const FEUILLES = [
  ['styles.css', read('../public/styles.css')],
  ['signature.css', read('../public/signature.css')],
  ['admin.css', read('../../admin/public/admin.css')],
  enLigne('brand.html', read('../public/brand.html')),
  enLigne('pitch-deck.html', read('../../../docs/pitch-deck.html')),
  enLigne('business-plan.html', read('../../../docs/business-plan.html')),
  // Les deux planches de la marque BLANCHE, elles, sont lues : ce sont des
  // directions vivantes, pas un musée, et elles ont déjà dérivé une fois.
  enLigne('brand-blanc.html', read('../public/brand-blanc.html')),
  enLigne('brand-compose.html', read('../public/brand-compose.html')),
];
const BRAND = read('../public/brand.html');

/** Les règles d'une feuille : sélecteurs éclatés, commentaires neutralisés. */
function regles(src) {
  const net = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(net))) {
    const couleur = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(m[2]);
    if (!couleur) continue;
    out.push({
      sels: m[1].trim().split('\n').pop().trim().replace(/\s+/g, ' ').split(/\s*,\s*/),
      encre: couleur[1].trim(),
      ligne: net.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

// Un TITRE, tel que la maison les nomme : une balise de titre, ou une classe
// dont le dernier maillon finit par -t / -h / -title / -titre / -heading, plus
// les kickers et eyebrows (le sur-titre est un titre lui aussi).
// Les namespaces de DESSIN : le schéma animé et la carte du deck reproduisent
// des planches rendues en PNG, et les désaccorder de leur image serait un défaut
// de plus, pas un de moins.
const DESSIN = /^\.(learning-|nota-map)/;
const TITRE = /(^|[\s>+~])(h[1-6]|\.[a-z0-9-]*(titre|title|heading|kicker|eyebrow|-t|-h))(:[a-z-]+|\[[^\]]*\])*$/i;
// Le bleu de MARQUE et le bleu de PALETTE sont le même bleu : un titre peint en
// `var(--nota-blue-400)` est aussi fautif qu'un titre peint en `var(--brand)`,
// et c'est par cette maille qu'une faute est passée aujourd'hui. Les valeurs
// nues de la rampe comptent aussi — un hex dans une règle est déjà un défaut.
const ENCRE_DE_MARQUE = /var\(--(brand(-bright|-hover|-on-surface|-on-tint-strong|-word-ink)?|nota-blue-\d+)\)|#(386888|407598|274a62|264961|78a9bf|a7c1cd)\b/i;

test('aucun titre n’est peint avec une encre de marque', () => {
  const fautifs = [];
  for (const [nom, src] of FEUILLES) {
    for (const r of regles(src)) {
      if (!ENCRE_DE_MARQUE.test(r.encre)) continue;
      for (const sel of r.sels.filter((s) => TITRE.test(s))) fautifs.push(nom + ':' + r.ligne + ' ' + sel + ' → ' + r.encre);
    }
  }
  assert.deepEqual(fautifs, [], 'un titre est blanc ou noir — le bleu ne porte jamais le libellé principal');
});

// Le trou du filet : il ne lisait que les sélecteurs FINISSANT par un titre, donc
// `.welcome h1 span { color: var(--brand) }` passait — et c'était la troisième
// ligne du titre de la salle de signature, « Un même espace. », peinte en marque.
// Une balise NUE dans un titre (span, strong, em, b, i, sans classe) porte le
// libellé lui-même. Un descendant CLASSÉ, lui, peut mentionner une information :
// `.nc-h .nc-h-amt` reste bleu, et le témoin plus bas le vérifie.
const LABEL_DANS_UN_TITRE = /(^|[\s>+~])h[1-6]\s*>?\s*(span|strong|em|b|i)(:[a-z-]+)*$/i;

test('une balise nue dans un titre porte le libellé, pas une mention', () => {
  const fautifs = [];
  for (const [nom, src] of FEUILLES) {
    for (const r of regles(src)) {
      if (!ENCRE_DE_MARQUE.test(r.encre)) continue;
      for (const sel of r.sels.filter((s) => LABEL_DANS_UN_TITRE.test(s))) fautifs.push(nom + ':' + r.ligne + ' ' + sel + ' → ' + r.encre);
    }
  }
  assert.deepEqual(fautifs, [], 'un morceau de titre est un titre : blanc ou noir, jamais la marque');
});

test('un sur-titre prend l’encre des titres, pas une encre sourde', () => {
  const fautifs = [];
  for (const [nom, src] of FEUILLES) {
    for (const r of regles(src)) {
      const hits = r.sels.filter((s) => /(kicker|eyebrow)[a-z-]*$/i.test(s) && !DESSIN.test(s));
      if (!hits.length) continue;
      if (/var\(--(subtitle-ink|ink)\)/.test(r.encre)) continue;
      fautifs.push(nom + ':' + r.ligne + ' ' + hits.join(', ') + ' → ' + r.encre);
    }
  }
  assert.deepEqual(fautifs, [], 'les sur-titres prennent --subtitle-ink (ou --ink) : ni marque, ni gris sourd');
});

// Le revers de la règle : le bleu garde ses emplois. Si ces témoins tombaient,
// c'est que le balancier serait parti trop loin dans l'autre sens.
test('le bleu reste l’encre des mentions d’information', () => {
  const [, CSS] = FEUILLES[0];
  assert.match(CSS, /\.nc-h \.nc-h-amt \{[^}]*color: var\(--brand\)/, 'un montant dans un titre reste bleu');
  assert.match(CSS, /\na \{[^}]*color: var\(--brand\)/, 'un lien reste bleu');
  assert.match(CSS, /\.chip\.is-on \{[^}]*color: var\(--brand-on-surface\)/, 'un contrôle retenu garde sa marque');
});

test('le brand kit expose la règle, pas seulement le code', () => {
  assert.match(BRAND, /registre d’encre|registre d'encre/i, 'brand.html doit nommer le registre d’encre');
  assert.match(BRAND, /blanc ou noir/i, 'brand.html doit énoncer la règle des titres');
  for (const jeton of ['--subtitle-ink', '--brand-on-surface', '--brand-word-ink']) {
    assert.ok(BRAND.includes(jeton), 'brand.html doit montrer ' + jeton);
  }
});
