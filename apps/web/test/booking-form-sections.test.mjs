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

test('§8 — une réponse est un bouton qu’on reconnaît : cadre, survol, et la réponse retenue peinte à la marque', () => {
  const rule = CSS_SRC.match(/\.crit-row \.seg-btn \{[^}]*\}/);
  assert.ok(rule, 'les options d’une question ont leur propre règle');
  assert.match(rule[0], /border-color:\s*var\(--border\)/, 'chaque option porte un cadre');
  assert.match(rule[0], /background:\s*var\(--surface\)/, 'et une surface — plus des libellés posés sur une barre');
  const on = CSS_SRC.match(/\.crit-row \.seg-btn\.is-on \{[^}]*\}/);
  assert.ok(on, 'la réponse retenue a la sienne');
  assert.match(on[0], /background:\s*var\(--brand-tint-solid-strong\)/, 'peinte à la marque, jamais un gris de plus');
  assert.match(on[0], /border-color:\s*var\(--brand\)/);
  // Le registre des jetons tient : aucune couleur en dur.
  assert.ok(!/#[0-9a-f]{3,8}/i.test(rule[0] + on[0]), 'que des jetons');
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
