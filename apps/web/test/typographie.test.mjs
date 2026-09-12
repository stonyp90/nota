/**
 * UNE SEULE ÉCHELLE TYPOGRAPHIQUE, CELLE DE LA PAGE SIGNATURE (bêta).
 *
 * Propriétaire, 2026-09-10 : « the font is really not accurate across the
 * app » — chaque pane posait sa propre taille de titre (21/28 px au carnet,
 * 26/38 aux partenaires, 28/46 chez les notaires) pendant que la bêta titrait
 * en Sora 800. Le patron de la bêta devient la source de vérité :
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
// Les trois pages autonomes (elles n'héritent pas de styles.css) qui recopient l'échelle.
const BRAND_HTML = read('../public/brand.html');
const DECK_HTML = read('../../../docs/pitch-deck.html');
const PLAN_HTML = read('../../../docs/business-plan.html');
const COPIES = { 'styles.css': CSS, 'tokens.css': ADMIN_TOKENS, 'signature.css': SIG_CSS, 'brand.html': BRAND_HTML, 'pitch-deck.html': DECK_HTML, 'business-plan.html': PLAN_HTML };
// Un jeton lu dans n'importe quelle copie, espaces normalisés (les feuilles minifiées n'en ont pas).
const token = (src, name) => { const m = src.match(new RegExp('(^|[;{\\s])' + name + ':\\s*([^;}]+)')); return m ? m[2].replace(/\s+/g, '').trim() : null; };

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
    '--type-h2', '--type-h3', '--type-h4', '--type-h4-lh', '--type-h4-ls', '--type-lead', '--type-lead-lh', '--type-eyebrow', '--type-eyebrow-ls']) {
    assert.match(CSS, new RegExp('(^|[;\\s])' + t + ':', 'm'), t + ' manque dans styles.css');
  }
  assert.match(CSS, /--font-display:\s*'Sora'/, 'la face d’affichage est Sora');
  assert.match(CSS, /--type-h1:\s*clamp\(26px, 2\.25vw, 36px\)/, 'h1 = la taille de la bêta, verbatim');
  assert.match(CSS, /--type-h2:\s*clamp\(19px, 1\.5vw, 24px\)/, 'h2 = la taille de la bêta, verbatim');
  assert.match(CSS, /--type-h3:\s*17px/, 'h3 = la taille de la bêta, verbatim');
  assert.match(CSS, /--type-lead:\s*16px/, 'lede = la taille de la bêta, verbatim');
  // Le barreau h4 (addendum 2026-09-11) : les kickers de carte, déclaré dans
  // les DEUX :root avec les mêmes valeurs — jamais dans un seul.
  const h4 = (src) => (src.match(/--type-h4:\s*([^;]+);\s*--type-h4-lh:\s*([^;]+);\s*--type-h4-ls:\s*([^;]+);/) || []).slice(1).map((v) => v.trim());
  assert.deepEqual(h4(CSS), ['15px', '1.3', '-.01em'], 'h4 = 15px / 1.3 / -.01em dans styles.css');
  assert.deepEqual(h4(ADMIN_TOKENS), h4(CSS), 'tokens.css porte le même barreau h4');
});

// Propriétaire, 2026-09-11 : « every font size, every font style must be the same
// across ALL applications: admin, business plan, pitch deck, web ». Le barreau du
// texte courant (--type-body) rejoint l'échelle, et CHAQUE copie de :root — la
// feuille web, les jetons admin, la salle, le guide de marque, le deck, le plan —
// porte les mêmes valeurs, barreau par barreau. Une copie qui dérive fait tomber
// ce test, pas seulement la copie web.
test('chaque copie de :root porte la même échelle, barreau par barreau', () => {
  const rungs = ['--type-h1', '--type-h1-lh', '--type-h1-ls', '--type-h1-compact', '--type-h2', '--type-h2-lh', '--type-h2-ls',
    '--type-h3', '--type-h3-lh', '--type-h3-ls', '--type-h4', '--type-h4-lh', '--type-h4-ls', '--type-lead', '--type-lead-lh',
    '--type-eyebrow', '--type-eyebrow-ls', '--type-body', '--type-body-lh', '--weight-display'];
  assert.equal(token(CSS, '--type-body'), '16px', 'le texte courant = 16px (la valeur effective du carnet)');
  assert.equal(token(CSS, '--type-body-lh'), '1.5', 'interligne du texte courant = 1.5');
  const drift = [];
  for (const [name, src] of Object.entries(COPIES)) {
    for (const rung of rungs) {
      const got = token(src, rung);
      if (got !== token(CSS, rung)) drift.push(`${name} ${rung} = ${got} (styles.css : ${token(CSS, rung)})`);
    }
  }
  assert.deepEqual(drift, [], 'copies hors échelle :\n  ' + drift.join('\n  '));
  // Et le corps de texte LIT le barreau, sur chaque surface qui pose sa taille.
  assert.match(CSS, /^body \{[^}]*font-size: var\(--type-body\);\s*line-height: var\(--type-body-lh\)/m, 'styles.css body lit --type-body');
  assert.match(ADMIN_CSS, /^body \{[^}]*font-size: var\(--type-body\);\s*line-height: var\(--type-body-lh\)/m, 'admin.css body lit --type-body');
  assert.match(BRAND_HTML, /body \{[^}]*font: var\(--type-body\)\/var\(--type-body-lh\)/, 'brand.html body lit --type-body');
  assert.match(DECK_HTML, /html,body\{[^}]*font-size:var\(--type-body\);line-height:var\(--type-body-lh\)/, 'pitch-deck.html body lit --type-body');
  assert.match(PLAN_HTML, /body\{[^}]*font-size:var\(--type-body\);\s*line-height:var\(--type-body-lh\)/, 'business-plan.html body lit --type-body');
  for (const [name, src] of Object.entries(COPIES)) {
    assert.match(src, /(^|[;{\s])--font-display:\s*'?Sora/m, name + ' : la face d’affichage est Sora');
  }
});

// Les trois pages autonomes portent les DEUX thèmes par le mécanisme du produit :
// clair sur :root nu, sombre sous la requête média gardée, sombre sous
// [data-theme="dark"] — et le même interrupteur que l'en-tête du carnet, sur la
// même clé (nota.theme), pour qu'un choix suive le visiteur d'une surface à l'autre.
test('le guide de marque, le deck et le plan portent les deux thèmes et l’interrupteur du site', () => {
  for (const [name, src] of Object.entries({ 'brand.html': BRAND_HTML, 'pitch-deck.html': DECK_HTML, 'business-plan.html': PLAN_HTML })) {
    assert.match(src, /@media \(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/, name + ' : bloc sombre gardé contre un choix clair explicite');
    assert.match(src, /:root\[data-theme="dark"\]\s*\{/, name + ' : bloc sombre explicite');
    assert.match(src, /<button[^>]*class="tswitch"[^>]*id="theme-toggle"[^>]*role="switch"/, name + ' : l’interrupteur du site');
    assert.match(src, /localStorage\.setItem\('nota\.theme', JSON\.stringify\(next\)\)/, name + ' : le choix est écrit sous nota.theme, encodé comme lsSave');
    assert.match(src, /JSON\.parse\(localStorage\.getItem\('nota\.theme'\)/, name + ' : le thème est posé avant la première peinture');
    assert.doesNotMatch(src, /:root\s*\{\s*color-scheme:\s*dark/, name + ' : aucun :root nu ne force le sombre');
  }
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

// Les quatre propriétés qu'une règle de titre n'a pas le droit de poser
// elle-même : seul un barreau de l'échelle (h1…h4, ou la variante empilée
// --type-h1-compact) passe.
function offScale(b) {
  const bad = [];
  const size = b.body.match(/font-size:\s*([^;]+);/);
  if (size && !/^var\(--type-h[1-4](-compact)?\)$/.test(size[1].trim())) bad.push(b.line + ' ' + b.sel + ' → font-size: ' + size[1].trim());
  const weight = b.body.match(/font-weight:\s*([^;]+);/);
  if (weight && weight[1].trim() !== 'var(--weight-display)') bad.push(b.line + ' ' + b.sel + ' → font-weight: ' + weight[1].trim());
  const family = b.body.match(/font-family:\s*([^;]+);/);
  if (family && family[1].trim() !== 'var(--font-display)') bad.push(b.line + ' ' + b.sel + ' → font-family: ' + family[1].trim());
  const ls = b.body.match(/letter-spacing:\s*([^;]+);/);
  if (ls && !/^var\(--type-h[1-4]-ls\)$/.test(ls[1].trim())) bad.push(b.line + ' ' + b.sel + ' → letter-spacing: ' + ls[1].trim());
  return bad;
}

test('aucune règle de titre ne pose sa propre taille, graisse ou face', () => {
  const bad = headingBlocks(CSS).flatMap(offScale);
  assert.deepEqual(bad, [], 'titres hors échelle :\n  ' + bad.join('\n  '));
});

// Les classes posées sur un h1/h2/h3 de index.html. Une règle .auth-title ou
// .nc-h contournait l'échelle aussi sûrement qu'une règle h2 : le 2026-09-11,
// onze d'entre elles posaient 15–21 px et leur propre graisse pendant que la
// règle d'élément passait le test. Une règle compte dès que son DERNIER
// composé porte une de ces classes (.nc-h .nc-h-amt vise un span, pas le titre).
function headingClasses(html) {
  const out = new Set();
  for (const m of html.matchAll(/<h[123]\b[^>]*\bclass="([^"]+)"/g)) for (const c of m[1].trim().split(/\s+/)) out.add(c);
  return out;
}
function headingClassBlocks(src, classes) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().split('\n').pop().trim();
    const hit = sel.split(',').some((s) => {
      const last = s.trim().split(/\s*[>+~\s]\s*/).pop() || '';
      return [...last.matchAll(/\.([A-Za-z0-9_-]+)/g)].some((c) => classes.has(c[1]));
    });
    if (!hit) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ sel, body: m[2], line });
  }
  return out;
}

test('aucune classe posée sur un titre ne pose sa propre taille, graisse ou face', () => {
  const classes = headingClasses(HTML);
  assert.ok(classes.size >= 10, 'index.html porte des titres classés (' + classes.size + ')');
  const blocks = headingClassBlocks(CSS, classes);
  assert.ok(blocks.length >= 10, 'les classes de titre ont des règles (' + blocks.length + ')');
  const bad = blocks.flatMap(offScale);
  assert.deepEqual(bad, [], 'classes de titre hors échelle :\n  ' + bad.join('\n  '));
});

test('les ledes et surtitres des trois portes lisent les mêmes jetons que la bêta', () => {
  for (const sel of ['.intro p', '.pr-hero-copy > p:not(.pr-eligibility)', '.beta-lead']) {
    const m = CSS.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'));
    assert.ok(m, sel + ' existe');
    assert.match(m[1], /font-size: var\(--type-lead\)/, sel + ' lit --type-lead');
    assert.match(m[1], /line-height: var\(--type-lead-lh\)/, sel + ' lit --type-lead-lh');
  }
  for (const sel of ['.eyebrow', '.beta-eyebrow']) {
    const m = CSS.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'));
    assert.ok(m, sel + ' existe');
    assert.match(m[1], /font-size: var\(--type-eyebrow\)/, sel + ' lit --type-eyebrow');
    assert.match(m[1], /letter-spacing: var\(--type-eyebrow-ls\)/, sel + ' lit --type-eyebrow-ls');
    assert.match(m[1], /font-weight: var\(--weight-display\)/, sel + ' lit --weight-display');
  }
});

test('les deux faces se chargent partout — le rendu ne dépend plus des polices installées', () => {
  // Depuis le 2026-09-12 les faces ne viennent plus d'un hôte tiers : chaque
  // surface les trouve dans la feuille qu'elle charge déjà, servie par Nota
  // (le détail du réglage vit dans polices-hebergees.test.mjs).
  const face = (src, famille) => new RegExp("@font-face \\{[^}]*font-family: '" + famille + "'[^}]*url\\('/fonts/").test(src);
  for (const [nom, feuille, page, lien] of [
    ['le carnet', CSS, HTML, /<link[^>]+href="styles\.css"/],
    ['la salle', SIG_CSS, SIG_HTML, /<link[^>]+href="signature\.css"/],
    ['la console', ADMIN_TOKENS, ADMIN_HTML, /<link[^>]+href="admin\.css"/],
  ]) {
    assert.ok(face(feuille, 'Inter') && face(feuille, 'Sora'), nom + ' déclare Inter ET Sora depuis /fonts');
    assert.match(page, lien, nom + ' charge bien la feuille qui les porte');
    assert.doesNotMatch(page, /fonts\.googleapis\.com|fonts\.gstatic\.com|rsms\.me/, nom + ' n’appelle plus d’hôte tiers');
  }
  assert.match(SIG_CSS, /h1,h2,h3\{[^}]*font-family:var\(--font-display\)[^}]*font-weight:var\(--weight-display\)/, 'la salle suit la graisse d’affichage commune');
  assert.match(SIG_CSS, /--type-h1:clamp\(26px, 2\.25vw, 36px\)/, 'la salle porte la même échelle');
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

test('la salle de signature ne pose aucune taille de titre hors échelle', () => {
  // Une seule feuille minifiée : les blocs de titre s'y lisent comme partout.
  const bad = [];
  for (const b of headingBlocks(SIG_CSS)) {
    const size = b.body.match(/font-size:\s*([^;}]+)/);
    if (size && !/^var\(--type-h[1-4](-compact)?\)$/.test(size[1].trim())) bad.push(b.sel + ' → font-size: ' + size[1].trim());
    const family = b.body.match(/font-family:\s*([^;}]+)/);
    if (family && family[1].trim() !== 'var(--font-display)') bad.push(b.sel + ' → font-family: ' + family[1].trim());
  }
  assert.deepEqual(bad, [], 'titres de la salle hors échelle :\n  ' + bad.join('\n  '));
});
