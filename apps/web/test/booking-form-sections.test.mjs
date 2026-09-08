/**
 * L'écran 2 de la feuille, EN SECTIONS (2026-09-05).
 *
 * Retour du propriétaire : « améliore l'expérience du formulaire, on peut
 * grouper en sections et rendre ça le plus intuitif possible pour chaque cas ».
 * Dix questions sur une grille plate ne disaient pas ce qui les reliait, et les
 * quatre facultatives tombaient dans un seul tiroir anonyme au bas de l'écran,
 * loin de la question qu'elles précisent.
 *
 * Ce que ce fichier tient :
 *   §1 les sections viennent du DOMAINE (ordre, intitulé, raison d'être) —
 *      l'écran ne réécrit pas la liste ;
 *   §2 chaque question est rendue dans SA section, l'obligatoire ouvert ;
 *   §3 le facultatif se replie DANS sa section (« Préciser »), avec son compte,
 *      et la porte « Répondez à : … » sait encore l'ouvrir ;
 *   §4 chaque section dit où elle en est (le même vocabulaire que le compte de
 *      l'étape) ;
 *   §5 la conséquence d'une réponse est dite sous la réponse : le document
 *      qu'elle ajoute, lu du domaine — jamais deviné par l'écran ;
 *   §6 le dossier rend les mêmes sections que la feuille ;
 *   §7 l'écran 3 (le prix) se lit dans le MÊME registre — trois cartes : le
 *      montant, le marché, le devis — et la hiérarchie y est tenue (retour du
 *      propriétaire : « mieux découpler les sections », « avoid blank space »,
 *      « improve price section as well ») ;
 *   §8 l'aide d'une question vit derrière son « i » — la question ne montre
 *      plus que son libellé et ses réponses, et ces réponses sont des boutons
 *      qu'on reconnaît (« keep it really straight forward », « (i) for more
 *      information with info on mouse hover etc »).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* already closed */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function boot({ routes = [] } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const r = routes.find((x) => x.match(String(u), init || {}));
        if (!r) return Promise.reject(new Error('offline'));
        return Promise.resolve(r.reply(String(u), init || {}));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(70);
  return { win, doc: win.document, Nota: win.Nota, D: win.NotaDomain };
}

async function open(doc, svc = 'refinancement') {
  const iso = addDays(todayISO(), 6);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="' + svc + '"]').click();
  await wait(20);
  return iso;
}
const sections = (doc) => [...doc.querySelectorAll('#o-criteria > .crit-sec')];
const section = (doc, id) => doc.querySelector('#o-criteria > .crit-sec[data-groupe="' + id + '"]');
const row = (doc, crit) => doc.querySelector('#o-criteria .crit-row[data-crit="' + crit + '"]');

// --- §1 · les sections viennent du domaine ----------------------------------

test('§1 — une section par groupe du domaine, dans l’ordre du domaine, titre et raison d’être compris', async () => {
  const { doc, D } = await boot();
  await open(doc);
  const groups = D.criteriaGroups('refinancement');
  assert.ok(groups.length >= 2, 'le domaine groupe les questions');
  assert.deepEqual(sections(doc).map((s) => s.dataset.groupe), [...groups.map((g) => g.id)]);
  for (const g of groups) {
    const sec = section(doc, g.id);
    assert.ok(sec, g.id + ' est rendue');
    assert.equal(sec.querySelector('.crit-sec-t').textContent, g.nom, 'l’intitulé vient du domaine');
    assert.equal(sec.querySelector('.crit-sec-aide').textContent, g.aide, 'la raison d’être aussi');
    // Nommée pour un lecteur d'écran : le groupe porte le titre qu'on lit.
    assert.equal(sec.getAttribute('role'), 'group');
    assert.equal(sec.getAttribute('aria-labelledby'), sec.querySelector('.crit-sec-t').id);
  }
});

test('§1 — l’acte change, les sections suivent (le financement ajoute sa question au bon endroit)', async () => {
  const { doc, D } = await boot();
  await open(doc, 'financement');
  assert.deepEqual(sections(doc).map((s) => s.dataset.groupe), [...D.criteriaGroups('financement').map((g) => g.id)]);
  assert.equal(row(doc, 'contexte').closest('.crit-sec').dataset.groupe, 'pret');
});

// --- §2 · chaque question dans sa section ------------------------------------

test('§2 — chaque question obligatoire est ouverte dans sa propre section', async () => {
  const { doc, D } = await boot();
  await open(doc);
  for (const g of D.criteriaGroups('refinancement')) {
    for (const c of g.requis) {
      const r = row(doc, c.id);
      assert.ok(r, c.id + ' est rendue');
      assert.equal(r.closest('.crit-sec').dataset.groupe, g.id, c.id + ' habite ' + g.id);
      assert.equal(r.closest('details'), null, c.id + ' est obligatoire : rien ne la replie');
    }
  }
});

// --- §3 · le facultatif se replie DANS sa section ----------------------------

test('§3 — les questions facultatives se replient dans LEUR section, comptées sur le volet', async () => {
  const { doc, D } = await boot();
  await open(doc);
  for (const g of D.criteriaGroups('refinancement')) {
    const sec = section(doc, g.id);
    const det = sec.querySelector('details.crit-more');
    if (!g.facultatifs.length) { assert.equal(det, null, g.id + ' n’ouvre pas un tiroir vide'); continue; }
    assert.ok(det, g.id + ' replie ses précisions');
    assert.equal(det.open, false, 'fermé au départ : le chemin court reste court');
    assert.match(det.querySelector('summary').textContent, /Préciser/);
    assert.equal(det.querySelector('summary .crit-more-n').textContent, String(g.facultatifs.length),
      'le volet dit combien de questions il cache');
    for (const c of g.facultatifs) {
      assert.equal(row(doc, c.id).closest('details'), det, c.id + ' est repliée dans sa section');
    }
  }
  // Plus de tiroir anonyme au bas de l'écran.
  assert.equal(doc.querySelector('#o-criteria > details.crit-more'), null);
});

test('§3 — la porte « Répondez à : … » ouvre encore le tiroir de la section', async () => {
  const { doc, Nota } = await boot();
  await open(doc);
  Nota.focusCriterionRow('certificat_localisation');
  await wait(10);
  assert.equal(row(doc, 'certificat_localisation').closest('details').open, true);
});

// --- §4 · chaque section dit où elle en est ----------------------------------

test('§4 — chaque section porte son propre compte, dans le vocabulaire de l’étape', async () => {
  const { doc } = await boot();
  await open(doc);
  const tally = (id) => section(doc, id).querySelector('.crit-sec-n');
  // La signature est pré-répondue (le déplacement a un défaut) : elle est complète.
  assert.equal(tally('signature').textContent, '✓');
  assert.equal(tally('signature').dataset.state, 'done');
  // Le prêt attend ses trois réponses. Le chiffre à l'œil, la phrase à
  // l'oreille : l'étape dit déjà « 3 réponses attendues », la section ne la
  // répète pas à l'écran mais la porte pour un lecteur d'écran.
  assert.equal(tally('pret').dataset.state, 'due');
  assert.equal(tally('pret').textContent, '3');
  assert.equal(tally('pret').getAttribute('aria-label'), '3 réponses attendues');
  const fire = (el, type) => el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const sel = $(doc, 'crit-preteur'); sel.value = 'desjardins'; fire(sel, 'change');
  await wait(20);
  assert.equal(tally('pret').textContent, '✓');
  assert.equal(tally('pret').getAttribute('aria-label'), '✓ complet');
  assert.equal(tally('pret').dataset.state, 'done');
});

// --- §5 · la conséquence d'une réponse, sous la réponse ----------------------

test('§5 — une réponse qui ajoute un document le dit sous la question, avec le nom du domaine', async () => {
  const { doc, D } = await boot();
  await open(doc);
  const r = row(doc, 'succession');
  const note = r.querySelector('.crit-effet');
  assert.ok(note, 'la ligne de conséquence existe dès la première peinture');
  assert.equal(note.dataset.on, 'false', '« Non » (le défaut) n’ajoute rien');
  $(doc, 'crit-succession__oui').click();
  await wait(10);
  const nom = D.serviceById('refinancement').documents.find((d) => d.id === 'testament_transmission').nom;
  assert.equal(note.dataset.on, 'true');
  assert.equal(note.textContent, 'Ajoute un document : ' + nom);
  $(doc, 'crit-succession__non').click();
  await wait(10);
  assert.equal(note.dataset.on, 'false', 'et la conséquence se retire avec la réponse');
});

test('§5 — la ligne de conséquence ne pousse rien : elle est réservée dès l’ouverture (ADR 0039)', async () => {
  const { doc } = await boot();
  await open(doc);
  assert.match(CSS_SRC, /\.crit-effet\[data-on='false'\]\s*\{[^}]*visibility:\s*hidden/,
    'cachée par visibility, jamais par display : la question garde sa hauteur');
});

// --- §6 · le dossier rend les mêmes sections ---------------------------------

test('§6 — le carnet du dossier pose les mêmes questions, dans les mêmes sections', async () => {
  const { doc, Nota, D } = await boot();
  Nota.setTab('dossier');
  await wait(20);
  const secs = [...doc.querySelectorAll('#dossier-list .dossier-pricing .crit-sec')];
  assert.deepEqual(secs.map((s) => s.dataset.groupe), [...D.criteriaGroups('refinancement').map((g) => g.id)]);
});

// --- La grille survit au regroupement (audit 2.15) ---------------------------

test('la grille de lecture vit maintenant DANS la section, et la ligne large la traverse encore', async () => {
  const rule = CSS_SRC.match(/^\.crit-sec-grid \{[^}]*\}/m);
  assert.ok(rule, 'la section porte la grille');
  assert.match(rule[0], /display:\s*grid/);
  assert.ok(!/(?<!-)columns:/.test(rule[0]), 'pas de multicol : une colonne brouillerait l’ordre des questions');
  const { doc } = await boot();
  await open(doc);
  assert.ok(row(doc, 'deplacement').classList.contains('crit-row--wide'));
  assert.ok(row(doc, 'deplacement').parentNode.classList.contains('crit-sec-grid'));
});

// --- §7 · l'écran du prix, dans le même registre -----------------------------

test('§7 — l’écran 3 se lit en trois cartes : le montant, le marché, le devis', async () => {
  const { doc } = await boot();
  await open(doc);
  const step = doc.querySelector('.book-step-offer');
  const secs = [...step.querySelectorAll(':scope > .offer-sec')];
  assert.equal(secs.length, 3, 'trois temps, pas dix blocs à la file');
  for (const sec of secs) {
    const t = sec.querySelector('.crit-sec-h > .crit-sec-t');
    assert.ok(t && t.textContent.trim(), 'chaque carte porte un titre');
    assert.equal(sec.getAttribute('aria-labelledby'), t.id, 'et le nomme pour un lecteur d’écran');
    assert.match(sec.querySelector('.crit-sec-aide').textContent, /\S/, 'et dit à quoi elle sert');
  }
  // Chaque pièce dans sa carte — le curseur avec son montant, le devis avec le sien.
  assert.equal($(doc, 'o-amount').closest('.offer-sec'), secs[0]);
  assert.equal($(doc, 'tier-preview').closest('.offer-sec'), secs[0]);
  assert.equal($(doc, 'gauge-label').closest('.offer-sec'), secs[0]);
  assert.equal($(doc, 'day-best').closest('.offer-sec'), secs[1]);
  assert.equal($(doc, 'day-chance').closest('.offer-sec'), secs[1]);
  assert.equal($(doc, 'offer-devis').closest('.offer-sec'), secs[2]);
  // Le garde de 2026-09-02 tient toujours : le palier explique le pré-remplissage,
  // donc il reste dans l’étape du montant.
  assert.equal($(doc, 'tier-preview').closest('.book-step'), $(doc, 'o-amount').closest('.book-step'));
});

test('§7 — une carte est le seul cadre : ni double bordure, ni double gouttière', () => {
  // L’écran qui porte des cartes ne porte plus la sienne…
  assert.match(CSS_SRC, /#o-criteria-step, \.book-step-offer \{[^}]*border:\s*0/,
    'les écrans 2 et 3 rendent leur cadre aux sections');
  // …et les boîtes intérieures (marché, devis) se fondent dans la carte.
  const fondu = CSS_SRC.match(/\.offer-sec > \.day-market, \.offer-sec > \.devis \{[^}]*\}/);
  assert.ok(fondu, 'la règle de fonte existe');
  assert.match(fondu[0], /border:\s*0/);
  assert.match(fondu[0], /background:\s*none/);
});

test('§7 — une question seule sur sa ligne prend la ligne, et l’occupe', async () => {
  assert.match(CSS_SRC, /\.crit-sec-grid > \.crit-row:last-child:nth-child\(odd\) \{[^}]*grid-column:\s*1 \/ -1/,
    'pas de demi-carte vide à droite de la dernière question');
  const { doc } = await boot();
  await open(doc);
  // « L’immeuble » ne pose qu’UNE question obligatoire : elle traverse la grille.
  const succ = row(doc, 'succession');
  assert.equal(succ.parentNode.querySelectorAll(':scope > .crit-row').length, 1);
  assert.equal(succ, succ.parentNode.lastElementChild);
});

test('§7 — la revendication du modèle se lit APRÈS le total, pas plus fort que lui', () => {
  const claim = CSS_SRC.match(/\.devis-claim \{[^}]*\}/);
  assert.ok(claim, 'la revendication a enfin une règle — sans elle, elle héritait des 16 px du formulaire');
  const taille = Number(claim[0].match(/font-size:\s*([\d.]+)px/)[1]);
  const total = Number(CSS_SRC.match(/\.devis-total \{[^}]*font-size:\s*([\d.]+)px/)[1]);
  assert.ok(taille < total, 'plus petite que la ligne « Porté à votre carte » (' + taille + ' < ' + total + ')');
});

test('§7 — le titre d’écran reçoit le focus sans porter de bague : ce n’est pas un contrôle', () => {
  assert.match(CSS_SRC, /\.book-step-lbl:focus-visible[^{]*\{[^}]*outline:\s*none/,
    'bookGoTo y pose le focus (tabindex -1) — l’anneau générique dessinait une boîte verte autour du titre');
});

// --- §8 · l'aide derrière le « i », des réponses qui ressemblent à des boutons

test('§8 — l’aide d’une question a quitté la carte pour le panneau de son « i »', async () => {
  const { doc, D } = await boot();
  await open(doc);
  // Plus une seule ligne d'aide dans le flux de l'écran : elles sont toutes
  // derrière un « i ». (Le carnet du dossier suit la même règle.)
  assert.equal(doc.querySelectorAll('#o-criteria .crit-row > .help').length, 0,
    'aucune aide ne prend de hauteur dans la carte');
  for (const c of D.serviceById('refinancement').pricing.criteria) {
    if (!c.aide) continue;
    const r = row(doc, c.id);
    const help = r.querySelector('.help');
    assert.ok(help, c.id + ' garde son texte');
    assert.equal(help.textContent, c.aide, 'mot pour mot celui du domaine');
    assert.ok(help.closest('.itip-pop'), c.id + ' : le texte vit dans le panneau du « i »');
    assert.equal(help.closest('.itip').dataset.on, 'true', 'et le « i » est visible');
  }
});

test('§8 — le « i » se range contre le libellé, jamais sur une ligne à lui', async () => {
  const { doc } = await boot();
  await open(doc);
  const head = row(doc, 'valeur_pret').querySelector(':scope > .crit-head');
  const kids = [...head.children].map((n) => n.className);
  assert.deepEqual(kids.slice(0, 2), ['crit-label', 'itip'],
    'libellé puis « i » — la ligne réservée du message d’attente vient après, sinon elle pousse le « i » dessous');
  assert.match(CSS_SRC, /\.crit-req \{[^}]*flex:\s*0 1 auto/,
    'et le message d’attente ne réclame plus une ligne entière quand il tient à côté du libellé');
});

test('§8 — le contrôle reste décrit par son aide, même cachée dans le panneau', async () => {
  const { doc } = await boot();
  await open(doc);
  // aria-describedby désigne un nœud : un lecteur d'écran le lit même quand il
  // n'est pas affiché. C'est ce qui permet de replier l'aide sans la perdre.
  const grp = row(doc, 'approbation_bancaire').querySelector('[role="group"]');
  const help = row(doc, 'approbation_bancaire').querySelector('.help');
  assert.equal(grp.getAttribute('aria-describedby'), help.id);
  assert.ok(help.closest('.itip-pop'), 'le nœud décrit est bien celui du panneau');
});

test('§8 — une réponse est un bouton qu’on reconnaît : cadre, survol, et la réponse retenue cerclée de marque', () => {
  const rule = CSS_SRC.match(/\.crit-row \.seg-btn \{[^}]*\}/);
  assert.ok(rule, 'les options d’une question ont leur propre règle');
  assert.match(rule[0], /border-color:\s*var\(--border\)/, 'chaque option porte un cadre');
  assert.match(rule[0], /background:\s*var\(--surface\)/, 'et une surface — plus des libellés posés sur une barre');
  const on = CSS_SRC.match(/\.crit-row \.seg-btn\.is-on \{[^}]*\}/);
  assert.ok(on, 'la réponse retenue a la sienne');
  assert.match(on[0], /border-color:\s*var\(--brand\)/, 'le cadre passe à la marque');
  assert.match(on[0], /box-shadow:\s*inset 0 0 0 1px var\(--brand\)/,
    'et double d’épaisseur par un inset — une bordure de 2 px déplacerait le libellé');
  assert.match(on[0], /color:\s*var\(--brand\)/, 'l’encre suit');
  // Le registre des jetons tient : aucune couleur en dur.
  assert.ok(!/#[0-9a-f]{3,8}/i.test(rule[0] + on[0]), 'que des jetons');
});

// --- §10 · « button are too big, do not fill them » (propriétaire, 2026-09-07)
//
// Deux décisions, dans les deux sens du même registre : une réponse se
// dimensionne sur ce qu'elle dit, et rien ne se remplit d'un aplat de marque —
// ni les réponses, ni l'action qui conclut l'écran.

test('§10 — une réponse se dimensionne sur son libellé, elle n’étire pas la ligne', () => {
  const rule = CSS_SRC.match(/\.crit-row \.seg-btn \{[^}]*\}/)[0];
  assert.ok(!/flex:\s*1 1 auto/.test(rule),
    '« Non » ne doit plus faire 400 px de large pour trois lettres');
  assert.match(rule, /flex:\s*0 1 auto/, 'elle ne grandit pas, elle peut seulement rétrécir');
  assert.match(rule, /min-width:\s*\d+px/, 'mais elle garde un plancher : une cible reste une cible');
});

test('§10 — AUCUN aplat de marque : ni la réponse retenue, ni le bouton qui conclut', () => {
  const on = CSS_SRC.match(/\.crit-row \.seg-btn\.is-on \{[^}]*\}/)[0];
  assert.ok(!/background:\s*var\(--brand(-tint[a-z-]*)?\)/.test(on),
    'la réponse retenue se cercle, elle ne se remplit pas');
  const nav = CSS_SRC.match(/\.book-nav \.book-fwd, \.book-nav #offer-submit \{\s*\n\s*background:[^}]*\}/);
  assert.ok(nav, 'la barre d’action a sa règle de couleur');
  assert.match(nav[0], /background:\s*transparent/,
    '« Continuer » / « Publier mon offre » rentrent dans le registre .btn-primary : couleur et graisse, jamais un aplat');
  assert.match(nav[0], /color:\s*var\(--brand\)/);
});

test('§10 — et l’action ne traverse plus la barre : elle se range à droite', () => {
  const geo = CSS_SRC.match(/\.book-nav \.book-fwd, \.book-nav #offer-submit \{ flex:[^}]*\}/);
  assert.ok(geo, 'la géométrie de la barre est nommée');
  assert.ok(!/flex:\s*1 1 auto/.test(geo[0]), 'plus de bandeau de 600 px pour un mot');
  assert.match(geo[0], /margin:\s*0 0 0 auto/, 'l’action va au bout de la barre, « Retour » garde la gauche');
});

test('§10 — la coche de la réponse retenue a sa place réservée (ADR 0039)', () => {
  const before = CSS_SRC.match(/\.crit-row \.seg-btn::before, \.crit-row \.seg-btn::after \{[^}]*\}/);
  assert.ok(before, 'chaque option porte la boîte de la coche — et son jumeau muet');
  assert.match(before[0], /visibility:\s*hidden/,
    'réservée dès la première peinture : répondre ailleurs ne fait pas respirer la piste');
  assert.match(CSS_SRC, /\.crit-row \.seg-btn::after \{ margin-left: 6px; \}/,
    'et le jumeau garde le libellé centré : la coche seule le pousserait à droite');
  assert.match(CSS_SRC, /\.crit-row \.seg-btn\.is-on::before \{ visibility: visible; \}/);
  // Un défaut non touché n'a rien coché : la coche dirait « vous avez répondu ».
  assert.match(CSS_SRC,
    /\.crit-row\[data-default='true'\] \.seg-btn\.is-on::before \{ visibility: hidden; \}/);
});

test('§8 — deux « i » côte à côte ne se ressemblent pas : « i » renseigne, « ! » alerte', async () => {
  const { doc } = await boot();
  await open(doc);
  const glyph = (tip) => tip.querySelector('svg').innerHTML;
  const info = row(doc, 'approbation_bancaire').querySelector('.itip[data-tone="info"]');
  const warn = doc.querySelector('#o-criteria .itip[data-tone="warn"]');
  assert.ok(info && warn, 'la question porte son aide et sa note de situation');
  assert.notEqual(glyph(info), glyph(warn), 'deux glyphes, pas deux couleurs du même');
});

// --- §9 · la grille se tasse : plus de demi-cadre nu -------------------------
//
// Retour du propriétaire (2026-09-07) : « enlever tous les espaces blancs […]
// le user doit comprendre rapidement ». Trois trous se voyaient sur la même
// carte : une réponse à deux choix qui s'empile en demi-largeur creusait un
// demi-cadre sous la question d'à côté ; un rang compact resté seul devant une
// bande pleine largeur gardait le sien à droite ; et chaque bande de section
// dépensait une ligne entière pour sa raison d'être.

test('§9 — aucun rang compact ne suit un rang pleine largeur : les bandes descendent', async () => {
  const { doc } = await boot();
  await open(doc, 'financement');
  for (const grid of doc.querySelectorAll('#o-criteria .crit-sec-grid')) {
    const rows = [...grid.querySelectorAll(':scope > .crit-row')];
    const wide = (r) => r.dataset.span === 'row' || r.classList.contains('crit-row--wide');
    const premierLarge = rows.findIndex(wide);
    if (premierLarge < 0) continue;
    assert.ok(rows.slice(premierLarge).every(wide),
      'une bande intercalée laisse une demi-cellule nue au-dessus d’elle : ' +
      rows.map((r) => r.dataset.crit + (wide(r) ? '(large)' : '')).join(' · '));
  }
});

test('§9 — un rang compact seul devant une bande prend la ligne', () => {
  assert.match(CSS_SRC,
    /\.crit-sec-grid > \.crit-row:nth-child\(odd\):has\(\+ \.crit-row\[data-span='row'\]\)/,
    'sinon « Prêteur hypothécaire » garde un demi-cadre nu à sa droite');
});

test('§9 — une réponse qui ne tient pas sur une ligne prend la ligne entière (mesurée, pas comptée)', async () => {
  const { win, doc } = await boot();
  await open(doc, 'financement');
  const r = row(doc, 'contexte');
  assert.ok(r, 'le financement demande ce que le prêt finance');
  // jsdom n'a pas de mise en page : on mesure à sa place, comme le navigateur
  // le ferait quand les deux réponses ne tiennent pas côte à côte.
  const btns = [...r.querySelectorAll('.seg .seg-btn')];
  assert.equal(btns.length, 2, 'deux réponses — sous le seuil de trois, donc invisible à un simple compte');
  let top = 0;
  for (const b of btns) { const y = top; top += 30; b.getBoundingClientRect = () => ({ height: 24, top: y }); }
  win.Nota.settleCriteriaLayout(doc.getElementById('o-criteria'));
  assert.equal(r.dataset.span, 'row', 'la piste débordait : le rang prend la ligne');
  const suivants = [...r.parentNode.querySelectorAll(':scope > .crit-row')];
  assert.ok(suivants.indexOf(r) > suivants.indexOf(row(doc, 'preteur')),
    'et descend sous les rangs compacts, qui se retrouvent appariés');
  assert.ok(suivants.slice(suivants.indexOf(r)).every((x) => x.dataset.span === 'row' || x.classList.contains('crit-row--wide')),
    'plus un seul rang compact derrière elle');
});

test('§9 — la raison d’être d’une section rejoint la ligne de son titre', async () => {
  const { doc } = await boot();
  await open(doc);
  const head = section(doc, 'pret').querySelector('.crit-sec-h');
  const kids = [...head.children].map((n) => n.className.split(' ')[0]);
  assert.deepEqual(kids.slice(0, 3), ['crit-sec-ic', 'crit-sec-t', 'crit-sec-aide'],
    'le sujet, son titre, sa raison d’être — puis le compte et le pli');
  const rule = CSS_SRC.match(/\.crit-sec-aide \{[^}]*\}/);
  assert.ok(rule, 'la raison d’être a sa règle');
  assert.ok(!/flex:\s*1 0 100%/.test(rule[0]),
    'elle ne réclame plus une ligne à elle : trois sections, trois lignes dépensées pour rien');
});

test('§9 — l’écran 4 ne garde plus de demi-carte nue : trois champs sur une ligne, l’explication contre son champ', () => {
  const ident = CSS_SRC.match(/\.book-identity \{[^}]*\}/);
  assert.ok(ident, 'le bloc d’identité a sa règle');
  assert.match(ident[0], /grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\)/,
    'à deux colonnes, le téléphone fermait le bloc seul et traînait une demi-carte vide');
  assert.ok(!/\.book-identity \.form-row:last-child:nth-child\(odd\)/.test(CSS_SRC),
    'et la règle qui lui faisait prendre la ligne entière n’a plus lieu d’être');
  const prefix = CSS_SRC.match(/#prefix-row \{[^}]*\}/);
  assert.ok(prefix, 'le secteur postal a la sienne');
  assert.match(prefix[0], /display:\s*grid/, 'le champ et son explication se rangent côte à côte');
});

test('§9 — les champs de l’écran 4 portent un LIBELLÉ, pas une phrase', async () => {
  const { doc } = await boot();
  for (const id of ['o-name', 'o-courriel']) {
    const lbl = doc.querySelector('label[for="' + id + '"]');
    assert.ok(lbl.textContent.trim().length <= 20, id + ' : « ' + lbl.textContent.trim() + ' » se lit d’un coup d’œil');
    // La promesse n'a pas disparu : elle décrit le champ, sur sa ligne d'aide.
    const inp = $(doc, id);
    const help = doc.getElementById(inp.getAttribute('aria-describedby'));
    assert.ok(help && help.textContent.trim(), id + ' garde sa promesse sous le champ');
  }
});

test('§9 — la feuille s’élargit sur grand écran sans laisser les choix larges en îlots', () => {
  const dialog = CSS_SRC.match(/#day-dialog \{[^}]*\}/)?.[0] || '';
  assert.match(dialog, /clamp\(760px, 78vw, 1180px\)/,
    'la feuille utilise la largeur disponible sur un grand bureau');
  assert.match(CSS_SRC, /@media \(min-width: 1100px\) \{\s*\.crit-row\[data-large\] \.seg-btn \{ flex: 1 1 0; max-width: none; \}/,
    'les rangées de choix larges se répartissent sans colonne vide');
  assert.match(CSS_SRC, /\.crit-sec-grid > \.crit-row:has\(\.seg\) \{ grid-column: 1 \/ -1; \}/,
    'les réponses segmentées ne restent pas coincées dans une demi-colonne');
});
