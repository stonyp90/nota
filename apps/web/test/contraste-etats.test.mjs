/**
 * UN ÉTAT VIVANT N'ÉTEINT JAMAIS SON LIBELLÉ.
 *
 * Propriétaire, 2026-09-12, devant le carnet en thème sombre : « le hover sur
 * le financement… quel acte ? » — survoler une ligne du marché, ou retenir une
 * carte d'acte, rendait le nom MOINS lisible qu'au repos. La cause est une
 * seule : ces règles écrivent avec --brand, et --brand vaut #407598 sur fond de
 * nuit — un bleu plus SOMBRE que l'encre. Mesuré sur les fonds sombres :
 *
 *   au repos   #f4f8fa sur --surface …… 14,4:1
 *   survolé    #407598 sur --surface-hover …… 2,5:1   (AA demande 4,5)
 *   retenu     #407598 sur la teinte …… 2,9:1
 *
 * La marque n'est de l'ENCRE que sur papier ; sur fond de nuit c'est
 * --brand-bright (#78a9bf) qui tient ce rôle — le dépôt l'avait déjà appris
 * une fois pour la carte 250 $ (--brand-on-tint-strong). Un jeton le dit
 * désormais partout : --brand-on-surface, clair = --brand, sombre =
 * --brand-bright. Aucune règle d'état ne repasse par --brand nu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const CSS = read('../public/styles.css');
const SIG_CSS = read('../public/signature.css');
const ADMIN_CSS = read('../../admin/public/admin.css');
const ADMIN_TOKENS = read('../../admin/public/tokens.css');

// ---------------------------------------------------------------------------
// Lire une feuille comme le navigateur : les blocs, puis les jetons qu'ils posent.
// ---------------------------------------------------------------------------

/** Le corps du bloc qui suit `anchor` (accolades appariées, commentaires inclus). */
function blockAt(src, anchor) {
  const start = src.indexOf(anchor);
  assert.ok(start >= 0, 'bloc introuvable : ' + anchor);
  let i = src.indexOf('{', start + anchor.length - 1);
  let depth = 0;
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('bloc non fermé : ' + anchor);
}

const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Les `--jeton: valeur` posés par un bloc, dernier gagnant comme en CSS. */
function tokensOf(body) {
  const map = new Map();
  const re = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(sansCommentaires(body)))) map.set(m[1], m[2].trim());
  return map;
}

/** Une portée = ses propres jetons, puis ceux de :root (l'héritage du CSS). */
function scope(...maps) {
  return (name) => {
    for (const m of maps) if (m.has(name)) return m.get(name);
    return null;
  };
}

const hex = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

/** Les arguments d'un color-mix : « in srgb » déjà retiré, parenthèses respectées. */
function virgulesDePremierNiveau(args) {
  const out = [];
  let depth = 0, courant = '';
  for (const c of args) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(courant); courant = ''; continue; }
    courant += c;
  }
  out.push(courant);
  return out;
}

/** Une proportion, écrite en clair (« 8% ») ou portée par un jeton. */
function pourcent(look, v) {
  const direct = /^([\d.]+)%$/.exec(v.trim());
  if (direct) return Number(direct[1]);
  const ref = /^var\((--[\w-]+)\)$/.exec(v.trim());
  assert.ok(ref, 'proportion illisible : ' + v);
  const next = look(ref[1]);
  assert.ok(next, 'jeton non défini : ' + ref[1]);
  return pourcent(look, next);
}

/** Résout var(), color-mix(in srgb, A P%, B) et les #hex jusqu'à un RGB. */
function rgb(look, value, seen = 0) {
  assert.ok(seen < 12, 'chaîne de jetons sans fin : ' + value);
  const v = String(value).trim();
  const direct = hex(v);
  if (direct) return direct;
  const varRef = /^var\((--[\w-]+)\)$/.exec(v);
  if (varRef) {
    const next = look(varRef[1]);
    assert.ok(next, 'jeton non défini : ' + varRef[1]);
    return rgb(look, next, seen + 1);
  }
  const mix = /^color-mix\(in srgb,\s*([\s\S]+)\)$/.exec(v);
  if (mix) {
    const [gauche, droite] = virgulesDePremierNiveau(mix[1]);
    const part = /^([\s\S]+?)\s+(\S+)$/.exec(gauche.trim());
    assert.ok(part, 'color-mix sans proportion : ' + v);
    const p = pourcent(look, part[2]) / 100;
    const a = rgb(look, part[1], seen + 1);
    const b = rgb(look, droite, seen + 1);
    return a.map((c, i) => Math.round(c * p + b[i] * (1 - p)));
  }
  throw new Error('valeur de couleur non résolue : ' + v);
}

const lum = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Le rapport WCAG, arrondi au centième comme les commentaires de la feuille. */
function contrast(look, ink, ground) {
  const a = lum(rgb(look, ink));
  const b = lum(rgb(look, ground));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const ROOT = tokensOf(blockAt(CSS, '\n:root {'));
const DARK_MEDIA = tokensOf(blockAt(CSS, ":root:not([data-theme='light']) {"));
const DARK_ATTR = tokensOf(blockAt(CSS, "\n:root[data-theme='dark'] {"));
const INTRO = tokensOf(blockAt(CSS, '\n.ig {'));
const PRINT = tokensOf(blockAt(CSS, "  :root, :root[data-theme='dark'], :root:not([data-theme='light']) {"));
const A_ROOT = tokensOf(blockAt(ADMIN_TOKENS, ':root {'));
const A_DARK_MEDIA = tokensOf(blockAt(ADMIN_TOKENS, ":root:not([data-theme='light']) {"));
const A_DARK_ATTR = tokensOf(blockAt(ADMIN_TOKENS, "\n:root[data-theme='dark'] {"));

// Toute portée qui redéfinit --brand doit redéfinir son encre : un jeton qui
// contient var() se fige sur l'élément qui le DÉCLARE, donc celui de :root
// emporterait la valeur de la page jusque dans le film d'accueil.
const PORTEES = [
  ['styles.css :root (clair)', ROOT, '--brand'],
  ['styles.css @media sombre', DARK_MEDIA, '--brand-bright'],
  ["styles.css [data-theme='dark']", DARK_ATTR, '--brand-bright'],
  ['styles.css .ig (le film)', INTRO, '--brand'],
  ['styles.css @media print', PRINT, '--brand'],
  ['admin tokens.css :root (clair)', A_ROOT, '--brand'],
  ['admin tokens.css @media sombre', A_DARK_MEDIA, '--brand-bright'],
  ["admin tokens.css [data-theme='dark']", A_DARK_ATTR, '--brand-bright'],
];

test('--brand-on-surface est posé partout où --brand l’est', () => {
  for (const [nom, map, attendu] of PORTEES) {
    assert.ok(map.has('--brand'), nom + ' : cette portée ne redéfinit plus --brand, revoir la liste');
    assert.equal(map.get('--brand-on-surface'), 'var(' + attendu + ')',
      nom + ' : --brand-on-surface doit valoir var(' + attendu + ')');
  }
});

// ---------------------------------------------------------------------------
// La règle : un état vivant n'écrit pas avec --brand nu.
// ---------------------------------------------------------------------------

const ETAT = /:hover|\.is-on|\.is-active|\.is-current|aria-pressed='true'|aria-selected='true'|:checked/;

/** Les règles dont le sélecteur porte un état ET qui posent une `color`. */
function reglesDEtat(src) {
  // Les commentaires cèdent la place à du blanc de MÊME longueur : ils ne
  // peuvent plus se faire passer pour un sélecteur, et les numéros de ligne
  // rapportés restent ceux de la feuille.
  const net = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(net))) {
    const sel = m[1].trim().split('\n').pop().trim().replace(/\s+/g, ' ');
    if (!ETAT.test(sel)) continue;
    const decl = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(m[2]);
    if (!decl) continue;
    out.push({ sel, valeur: decl[1].trim(), ligne: net.slice(0, m.index).split('\n').length });
  }
  return out;
}

test('aucun état vivant n’écrit avec --brand nu', () => {
  for (const [nom, src] of [['styles.css', CSS], ['signature.css', SIG_CSS], ['admin.css', ADMIN_CSS]]) {
    const fautives = reglesDEtat(src).filter((r) => /var\(--brand\)/.test(r.valeur));
    assert.deepEqual(fautives.map((r) => nom + ':' + r.ligne + ' ' + r.sel), [],
      nom + ' : ces états écrivent avec --brand — sur fond de nuit le libellé s’éteint, prendre --brand-on-surface');
  }
});

// ---------------------------------------------------------------------------
// Le chiffre, pour que personne n'ait à croire le commentaire sur parole.
// ---------------------------------------------------------------------------

const FONDS = ['--bg', '--surface', '--surface-inset', '--surface-hover', '--brand-tint-solid'];

test('l’encre d’état franchit AA sur tous les fonds, clair comme sombre', () => {
  for (const [nom, map] of [['sombre (@media)', DARK_MEDIA], ["sombre (data-theme)", DARK_ATTR], ['clair (:root)', ROOT]]) {
    const look = scope(map, ROOT);
    for (const fond of FONDS) {
      const r = contrast(look, 'var(--brand-on-surface)', 'var(' + fond + ')');
      assert.ok(r >= 4.5, nom + ' : --brand-on-surface sur ' + fond + ' ne donne que ' + r + ':1 (AA demande 4,5)');
    }
  }
});

test('le témoin de la régression : --brand nu échoue sur fond de nuit', () => {
  const look = scope(DARK_ATTR, ROOT);
  for (const fond of ['--surface', '--surface-hover', '--brand-tint-solid']) {
    const r = contrast(look, 'var(--brand)', 'var(' + fond + ')');
    assert.ok(r < 4.5, 'si --brand passe désormais AA sur ' + fond + ' (' + r + ':1), ce jeton n’a plus lieu d’être');
  }
});
