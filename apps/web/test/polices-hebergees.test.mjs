/**
 * LES POLICES SONT SERVIES PAR NOTA, PAR PERSONNE D'AUTRE.
 *
 * Propriétaire, 2026-09-12 : « je vois qu'il y a du Google là […] s'assurer
 * qu'il n'y en a pas ». Chaque page appelait `fonts.googleapis.com` (et
 * `rsms.me` pour le carnet) dès le premier octet : l'adresse IP et l'agent du
 * visiteur atteignaient Google AVANT toute bannière, sur un site qui vend des
 * actes notariés. C'est le seul appel tiers qui ne demandait rien à personne.
 *
 * Deux surprises trouvées au passage : la CSP de la console admin
 * (`font-src 'self'`) et celle de la salle de signature (`rsms.me` seulement)
 * BLOQUAIENT déjà ces feuilles en production — ces deux surfaces tournaient
 * donc en polices de repli sans que rien ne le dise. Héberger les fichiers
 * répare la conformité ET la typographie.
 *
 * Inter et Sora sont sous licence SIL Open Font 1.1 : les redistribuer avec le
 * produit est permis, à condition de joindre la licence (fonts/OFL.txt).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const abs = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(abs(p), 'utf8');

const WEB_PUBLIC = abs('../public');
const ADMIN_PUBLIC = abs('../../admin/public');

/** Tout ce qui part chez le visiteur : pages, feuilles, scripts, manifestes. */
function servedFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { servedFiles(p, out); continue; }
    if (/\.(html|css|js|mjs|webmanifest|json|txt)$/.test(name)) out.push(p);
  }
  return out;
}

const HOTES_TIERS = /fonts\.googleapis\.com|fonts\.gstatic\.com|rsms\.me/;

/** Ce que le navigateur exécute : les commentaires racontent l'histoire, ils
 *  ne déclenchent aucune requête — le filet ne doit pas les confondre. */
const sansCommentaires = (src) => src
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('aucune page servie n’appelle un hôte de polices tiers', () => {
  const fautifs = [];
  for (const p of [...servedFiles(WEB_PUBLIC), ...servedFiles(ADMIN_PUBLIC), abs('../seo-pages.mjs')]) {
    if (HOTES_TIERS.test(sansCommentaires(readFileSync(p, 'utf8')))) fautifs.push(p.replace(abs('../../..') + '/', ''));
  }
  assert.deepEqual(fautifs, [], 'ces fichiers appellent encore Google ou rsms.me pour une police');
});

const FICHIERS = ['inter-latin.woff2', 'inter-latin-ext.woff2', 'sora-latin.woff2', 'sora-latin-ext.woff2'];

test('les fichiers de police vivent dans le dépôt, avec leur licence', () => {
  for (const racine of [WEB_PUBLIC, ADMIN_PUBLIC]) {
    for (const nom of FICHIERS) {
      const p = join(racine, 'fonts', nom);
      const buf = readFileSync(p);
      assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2', p + ' n’est pas un woff2');
      assert.ok(buf.length > 10000, p + ' est trop petit pour être une police (' + buf.length + ' octets)');
    }
    const ofl = readFileSync(join(racine, 'fonts', 'OFL.txt'), 'utf8');
    assert.match(ofl, /SIL OPEN FONT LICENSE/i, 'la licence OFL doit accompagner les fichiers');
  }
});

// Chaque surface a sa propre feuille : le carnet et les pages d'acquisition
// lisent styles.css, la salle signature.css, la console tokens.css, et les deux
// pages de marque sont autonomes par construction (elles recopient déjà les
// jetons, le commentaire de leur <style> le dit).
const SURFACES = [
  ['styles.css', read('../public/styles.css')],
  ['signature.css', read('../public/signature.css')],
  ['admin tokens.css', read('../../admin/public/tokens.css')],
  ['brand.html', read('../public/brand.html')],
  ['brand-explorations.html', read('../public/brand-explorations.html')],
  ['brand-blanc.html', read('../public/brand-blanc.html')],
  ['brand-compose.html', read('../public/brand-compose.html')],
];

test('chaque surface déclare les deux familles, servies depuis /fonts', () => {
  for (const [nom, src] of SURFACES) {
    for (const famille of ['Inter', 'Sora']) {
      const re = new RegExp("@font-face\\s*\\{[^}]*font-family:\\s*'" + famille + "'[^}]*\\}", 'g');
      const blocs = src.match(re) || [];
      assert.ok(blocs.length >= 2, nom + ' : ' + famille + ' doit être déclarée pour latin ET latin-ext (trouvé ' + blocs.length + ')');
      for (const bloc of blocs) {
        assert.match(bloc, /url\('\/fonts\/[a-z-]+\.woff2'\) format\('woff2'\)/, nom + ' : ' + famille + ' doit pointer vers /fonts');
        assert.match(bloc, /font-display:\s*swap/, nom + ' : ' + famille + ' garde font-display: swap');
        assert.match(bloc, /unicode-range:/, nom + ' : chaque tranche garde son unicode-range');
      }
    }
  }
});

test('le service worker garde les polices dans la coquille hors ligne', () => {
  const sw = read('../public/sw.js');
  for (const nom of FICHIERS) assert.ok(sw.includes('/fonts/' + nom), 'sw.js doit précharger /fonts/' + nom);
  assert.doesNotMatch(sw, HOTES_TIERS, 'le commentaire du worker ne doit plus nommer un hôte tiers');
});

test('aucune CSP n’autorise plus un hôte de polices tiers', () => {
  for (const nom of ['cloudfront.tf', 'signing.tf', 'admin-cdn.tf']) {
    const tf = read('../../../infra/' + nom);
    const csp = (tf.match(/content_security_policy\s*=\s*"([^"]+)"/) || [])[1];
    assert.ok(csp, nom + ' : CSP introuvable');
    assert.doesNotMatch(csp, HOTES_TIERS, nom + ' : la CSP nomme encore un hôte de polices tiers');
    assert.match(csp, /font-src [^;]*'self'/, nom + ' : font-src doit accepter nos propres fichiers');
  }
});

test('la page vie privée ne promet plus des polices tierces', () => {
  const html = read('../public/index.html');
  const i18n = read('../public/i18n.js');
  const p = (html.match(/<p>Au repos, vos données[^<]*(?:<strong>[^<]*<\/strong>[^<]*)*<\/p>/) || [])[0];
  assert.ok(p, 'le paragraphe « Hébergé au Canada » est introuvable');
  assert.doesNotMatch(p, /Google|rsms/, 'il annonce encore des polices tierces');
  const cle = p.replace(/^<p>/, '').replace(/<\/p>$/, '');
  assert.ok(i18n.includes(JSON.stringify(cle)), 'la phrase française doit avoir sa traduction anglaise dans i18n.js');
});

// Les deux documents PARTAGÉS sont un cas à part : ils voyagent seuls, par
// courriel ou sur un disque, et sont AUSSI déployés sur le site. Un fichier de
// police tiré d'une autre origine s'y ferait refuser par CORS hors du site et
// n'existerait pas depuis un disque — la page retombait alors sur une police
// système sans rien dire. Ils embarquent donc leurs deux tranches latines.
const DOCUMENTS = ['../../../docs/pitch-deck.html', '../../../docs/business-plan.html'];

test('le deck et le plan d’affaires embarquent leurs polices', () => {
  for (const chemin of DOCUMENTS) {
    const src = sansCommentaires(read(chemin));
    const nom = chemin.split('/').pop();
    assert.doesNotMatch(src, HOTES_TIERS, nom + ' : aucun hôte de polices tiers');
    assert.doesNotMatch(src, /url\(['"]?https?:/, nom + ' : aucune police tirée d’une autre origine (CORS)');
    for (const famille of ['Inter', 'Sora']) {
      const re = new RegExp("@font-face \\{[^}]*font-family: '" + famille + "'[^}]*url\\(data:font/woff2;base64,");
      assert.match(src, re, nom + ' : ' + famille + ' doit être embarquée en base64');
    }
  }
});

test('le générateur du plan d’affaires porte la même règle que sa sortie', () => {
  // Sa sortie est REGÉNÉRÉE : sans la règle dans le script, la prochaine
  // exécution ramènerait les polices d'hier. Et le script recopie le premier
  // <style> de sa sortie précédente comme feuille de base, donc les @font-face
  // doivent vivre dans la feuille qu'il écrit lui-même, jamais dans le head.
  const gen = read('../../../docs/planning/render-business-plan.py');
  assert.doesNotMatch(sansCommentaires(gen), HOTES_TIERS, 'le générateur ne nomme aucun hôte tiers');
  assert.equal((gen.match(/@font-face/g) || []).length, 2, 'le générateur déclare les deux familles, une fois chacune');
  assert.ok(gen.indexOf('@font-face') > gen.indexOf('extra = """<style>'), 'les @font-face vivent dans `extra`, pas dans le head');
});
