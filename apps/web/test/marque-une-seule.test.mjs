/**
 * UNE SEULE MARQUE, DEUX APPLICATIONS QUI LA SERVENT.
 *
 * L'ADR 0048 dessine la marque une fois et fait de chaque autre occurrence un
 * `<use>`. Deux fichiers échappent à cette règle parce qu'ils sont servis par
 * des applications différentes et ne peuvent pas se référencer l'une l'autre :
 *
 *   apps/admin/public/favicon.svg   — une COPIE du dessin de apps/web/public
 *   apps/admin/public/tokens.css    — une COPIE de la rampe de styles.css
 *
 * Le 12 septembre 2026, le dessin a bougé deux fois dans la même journée (les
 * fûts du N sont passés de 7,5 à 8,5 puis à 9,5). Les deux copies suivaient à
 * la main. Rien ne les lisait : la console pouvait porter un N plus mince que
 * le produit pendant des semaines sans qu'un test tombe.
 *
 * Ce filet lit les deux sources et refuse la divergence. Il ne dit pas quel
 * dessin est le bon — il dit que la console et le produit portent le même.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const WEB_FAVICON = lire('../public/favicon.svg');
const ADMIN_FAVICON = lire('../../admin/public/favicon.svg');
const WEB_CSS = lire('../public/styles.css');
const ADMIN_CSS = lire('../../admin/public/tokens.css');

// Le dessin, c'est tout ce qu'il y a entre le <svg …> et le </svg> : la balise
// ouvrante porte l'aria-label, qui nomme légitimement chaque application.
const dessin = (svg) => {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  assert.ok(m, 'le fichier est un SVG');
  // Un commentaire n'est pas un trait : chaque fichier garde le sien.
  return m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
};

test('la console porte exactement le dessin du produit', () => {
  assert.equal(dessin(ADMIN_FAVICON), dessin(WEB_FAVICON),
    'apps/admin/public/favicon.svg a dérivé de apps/web/public/favicon.svg — recopiez le dessin');
});

test('chaque application nomme sa propre icône', () => {
  assert.match(WEB_FAVICON, /aria-label="Nota"/, 'le produit dit « Nota »');
  assert.match(ADMIN_FAVICON, /aria-label="Nota Admin"/, 'la console dit « Nota Admin »');
});

const rampe = (css) => {
  const out = new Map();
  for (const [, pas, valeur] of css.matchAll(/--nota-blue-(\d+):\s*(#[0-9a-fA-F]{6})/g)) {
    if (!out.has(pas)) out.set(pas, valeur.toLowerCase());
  }
  return out;
};

test('la rampe de bleu est la même des deux côtés', () => {
  const web = rampe(WEB_CSS);
  const admin = rampe(ADMIN_CSS);
  assert.ok(web.size >= 10, 'le produit publie une rampe complète (' + web.size + ' pas)');
  const ecarts = [];
  for (const [pas, valeur] of web) {
    if (!admin.has(pas)) { ecarts.push(`--nota-blue-${pas} manque dans la console`); continue; }
    if (admin.get(pas) !== valeur) ecarts.push(`--nota-blue-${pas} : produit ${valeur}, console ${admin.get(pas)}`);
  }
  for (const pas of admin.keys()) {
    if (!web.has(pas)) ecarts.push(`--nota-blue-${pas} n'existe que dans la console`);
  }
  assert.deepEqual(ecarts, [], 'la rampe a divergé :\n  ' + ecarts.join('\n  '));
});
