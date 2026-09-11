/**
 * UNE SEULE ÉCHELLE TYPOGRAPHIQUE, CELLE DE LA PAGE SIGNATURE (bêta).
 *
 * Propriétaire, 2026-09-10 : « the font is really not accurate across the
 * app » — chaque pane posait sa propre taille de titre (21/28 px au carnet,
 * 26/38 aux partenaires, 28/46 chez les notaires) pendant que la bêta titrait
 * en Sora 800 à 42–68 px. Le patron de la bêta devient la source de vérité :
 * des jetons --type-* dans :root, et AUCUNE règle de titre ne pose sa propre
 * taille en px/clamp. Le calendrier, lui, ne remplit plus les nombres.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const CSS = read('../public/styles.css');
const HTML = read('../public/index.html');
const SIG_CSS = read('../public/signature.css');
const SIG_HTML = read('../public/signature.html');
const ADMIN_CSS = read('../../admin/public/admin.css');
const ADMIN_TOKENS = read('../../admin/public/tokens.css');
const ADMIN_HTML = read('../../admin/public/index.html');

// Les blocs de règles dont le sélecteur se termine par h1/h2/h3 (ou une liste
// de tels sélecteurs), avec leur numéro de ligne.
function headingBlocks(src) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().split('\n').pop().trim();
    if (!/h[123]\s*(,|$)/.test(sel.replace(/\s*,\s*/g, ','))) continue;
    if (!/(^|[\s>+~,])h[123](\s*,|$)/.test(sel)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ sel, body: m[2], line });
  }
  return out;
}

test('les jetons de l’échelle vivent dans :root, copiés de la bêta', () => {
  for (const t of ['--font-display', '--weight-display', '--type-h1', '--type-h1-lh', '--type-h1-ls',
    '--type-h2', '--type-h3', '--type-lead', '--type-lead-lh', '--type-eyebrow', '--type-eyebrow-ls']) {
    assert.match(CSS, new RegExp('(^|[;\\s])' + t + ':', 'm'), t + ' manque dans styles.css');
  }
  assert.match(CSS, /--font-display:\s*'Sora'/, 'la face d’affichage est Sora');
  assert.match(CSS, /--type-h1:\s*clamp\(32px, 3\.6vw, 56px\)/, 'h1 = échelle Nota de production');
  assert.match(CSS, /--type-h2:\s*clamp\(22px, 2\.1vw, 30px\)/, 'h2 = échelle Nota de production');
  assert.match(CSS, /--type-h3:\s*16px/, 'h3 = échelle Nota de production');
  assert.match(CSS, /--type-lead:\s*16px/, 'lede = échelle Nota de production');
});

test('h1, h2, h3 prennent la face et la graisse d’affichage globalement', () => {
  const m = CSS.match(/^h1, h2, h3 \{([^}]*)\}/m);
  assert.ok(m, 'la règle globale h1, h2, h3 existe');
  assert.match(m[1], /font-family: var\(--font-display\)/);
  assert.match(m[1], /font-weight: var\(--weight-display\)/);
  assert.match(CSS, /^h1 \{[^}]*font-size: var\(--type-h1\)/m, 'h1 lit son jeton');
  assert.match(CSS, /^h2 \{[^}]*font-size: var\(--type-h2\)/m, 'h2 lit son jeton');
  assert.match(CSS, /^h3 \{[^}]*font-size: var\(--type-h3\)/m, 'h3 lit son jeton');
});

test('aucune règle de titre ne pose sa propre taille, graisse ou face', () => {
  const bad = [];
  for (const b of headingBlocks(CSS)) {
    const size = b.body.match(/font-size:\s*([^;]+);/);
    if (size && !/^var\(--type-h[123]/.test(size[1].trim())) bad.push(b.line + ' ' + b.sel + ' → font-size: ' + size[1].trim());
    const weight = b.body.match(/font-weight:\s*([^;]+);/);
    if (weight && weight[1].trim() !== 'var(--weight-display)') bad.push(b.line + ' ' + b.sel + ' → font-weight: ' + weight[1].trim());
    const family = b.body.match(/font-family:\s*([^;]+);/);
    if (family && family[1].trim() !== 'var(--font-display)') bad.push(b.line + ' ' + b.sel + ' → font-family: ' + family[1].trim());
    const ls = b.body.match(/letter-spacing:\s*([^;]+);/);
    if (ls && !/^var\(--type-h[123]-ls\)$/.test(ls[1].trim())) bad.push(b.line + ' ' + b.sel + ' → letter-spacing: ' + ls[1].trim());
  }
  assert.deepEqual(bad, [], 'titres hors échelle :\n  ' + bad.join('\n  '));
});

test('les ledes et surtitres des trois portes lisent les mêmes jetons que la bêta', () => {
  for (const sel of ['.intro p', '.pr-hero p', '.beta-lead']) {
    const m = CSS.match(new RegExp('^' + sel.replace(/[.]/g, '\\.') + ' \\{([^}]*)\\}', 'm'));
    assert.ok(m, sel + ' existe');
    assert.match(m[1], /font-size: var\(--type-lead\)/, sel + ' lit --type-lead');
    assert.match(m[1], /line-height: var\(--type-lead-lh\)/, sel + ' lit --type-lead-lh');
  }
  for (const sel of ['.eyebrow', '.beta-eyebrow']) {
    const m = CSS.match(new RegExp('^' + sel.replace(/[.]/g, '\\.') + ' \\{([^}]*)\\}', 'm'));
    assert.ok(m, sel + ' existe');
    assert.match(m[1], /font-size: var\(--type-eyebrow\)/, sel + ' lit --type-eyebrow');
    assert.match(m[1], /letter-spacing: var\(--type-eyebrow-ls\)/, sel + ' lit --type-eyebrow-ls');
    assert.match(m[1], /font-weight: var\(--weight-display\)/, sel + ' lit --weight-display');
  }
});

test('les deux faces se chargent partout — le rendu ne dépend plus des polices installées', () => {
  const both = /fonts\.googleapis\.com\/css2\?[^"]*family=Inter[^"]*family=Sora/;
  assert.match(HTML, both, 'index.html charge Inter ET Sora');
  assert.match(SIG_HTML, both, 'signature.html charge Inter ET Sora');
  assert.match(ADMIN_HTML, both, 'admin charge Inter ET Sora');
  assert.match(SIG_CSS, /h1,h2,h3\{[^}]*font-family:var\(--font-display\)[^}]*font-weight:var\(--weight-display\)/, 'la salle titre en Sora 800');
  assert.match(SIG_CSS, /--type-h1:\s*clamp\(32px, 3\.6vw, 56px\)/, 'la salle porte la même échelle');
  assert.match(ADMIN_TOKENS, /--font-display:\s*'Sora'/, 'admin porte la face d’affichage');
  assert.match(ADMIN_CSS, /^h1, h2, h3 \{[^}]*font-family: var\(--font-display\)/m, 'admin titre en Sora');
});

test('aucun nombre du calendrier ne porte de fond coloré', () => {
  const today = CSS.match(/\.cal-cell\.is-today \.cal-daynum \{([^}]*)\}/);
  assert.ok(today, 'la règle du jour existe');
  assert.doesNotMatch(today[1], /background/, 'le numéro du jour n’a plus de fond');
  assert.match(today[1], /gap:/, 'le pli téléphone (JEU 27) garde son espace');
  const extreme = CSS.match(/\.cal-urgency\[data-tier='extreme'\] \{([^}]*)\}/);
  assert.ok(extreme, 'la règle du palier extrême existe');
  assert.doesNotMatch(extreme[1], /background/, 'le prix « dès … $ » du palier extrême n’a plus de fond');
});
