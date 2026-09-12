/**
 * LES PAGES D'ACQUISITION RESTENT LIÉES, SANS S'AFFICHER.
 *
 * Propriétaire, 2026-09-12 : « There's no need to display in the footer
 * notaire for a client in Quebec. We can put it in the website, but ensure
 * that they are hidden so nobody see them and that they are there for SEO,
 * GEO, LLMS. » — les deux pages de recherche (« Notaire pour un
 * refinancement / financement hypothécaire à Québec ») parlaient à Google
 * dans un pied de page lu par des clients qui, eux, sont DÉJÀ sur le carnet.
 *
 * Elles restent donc dans le document, liées, mais hors de vue :
 *  - `visually-hidden` et non `display: none` — un lien masqué par
 *    `display: none` est explicitement dévalué par Google et disparaît de
 *    l'arbre d'accessibilité ; hors écran, il reste indexable et un lecteur
 *    d'écran qui parcourt les liens le trouve encore. Rien n'est caché À
 *    quelqu'un : c'est la MISE EN PAGE qui ne le montre plus.
 *  - `tabindex="-1"` : le clavier ne s'arrête pas sur un lien invisible.
 *  - sitemap.xml et llms.txt continuent de les porter — c'est par là que
 *    passent réellement les robots d'indexation et les lecteurs LLM, le lien
 *    interne n'étant qu'un signal de plus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const HTML = read('../public/index.html');
const CSS = read('../public/styles.css');
const doc = new JSDOM(HTML).window.document;

const PAGES = ['/notaire-refinancement-quebec.html', '/notaire-financement-quebec.html'];

test('les deux pages restent liées depuis le pied de page', () => {
  for (const href of PAGES) {
    const a = doc.querySelector('.site-footer a[href="' + href + '"]');
    assert.ok(a, href + ' : le lien interne a disparu du pied de page');
    assert.ok(a.textContent.trim().length > 10, href + ' : le lien garde son texte, c’est lui que l’index lit');
  }
});

test('elles ne s’affichent plus, sans sortir de l’index', () => {
  for (const href of PAGES) {
    const a = doc.querySelector('.site-footer a[href="' + href + '"]');
    const masque = a.closest('.visually-hidden');
    assert.ok(masque, href + ' : le lien doit vivre dans un conteneur .visually-hidden');
    assert.equal(a.getAttribute('tabindex'), '-1', href + ' : pas d’arrêt clavier sur un lien invisible');
    assert.equal(a.hasAttribute('hidden'), false, href + ' : `hidden` retirerait la page de l’index');
    assert.equal(masque.classList.contains('hidden'), false, href + ' : `display: none` dévalue le lien, rester hors écran');
  }
  // Le tapis hors écran ne doit pas devenir un display:none par une règle tardive.
  assert.match(CSS, /\.visually-hidden \{[^}]*position: absolute[^}]*clip: rect\(0 0 0 0\)/, 'la règle hors écran a changé de nature');
});

test('les robots et les lecteurs LLM gardent leur chemin propre', () => {
  const sitemap = read('../public/sitemap.xml');
  const llms = read('../public/llms.txt');
  for (const href of PAGES) {
    assert.ok(sitemap.includes(href), href + ' : absente du sitemap, le lien caché deviendrait le seul chemin');
    assert.ok(llms.includes(href), href + ' : absente de llms.txt');
  }
});
