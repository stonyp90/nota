/**
 * Tests DOM pour l'écran « Usagers » — le dossier d'UNE personne (Loi 25).
 *
 * L'audit du 2026-09-05 : aucune route, aucun écran n'ouvrait une personne. Un
 * opérateur ne pouvait pas répondre à « que détenez-vous sur moi ? ».
 *
 * Ce que cet écran doit rendre lisible, et que ces tests tiennent :
 *   • le dossier DIT quand il est masqué — un opérateur qui l'ignore croirait
 *     que Nota ne détient pas ce qu'elle détient ;
 *   • il DIT ce qu'il n'a pas pu regarder — les registres sans index par
 *     personne sont nommés, avec la raison ;
 *   • l'effacement se PRÉVISUALISE : deux colonnes, ce qui part et ce qui
 *     reste, avant qu'on ne détruise quoi que ce soit ;
 *   • il ne promet JAMAIS plus que ce que le serveur a fait ;
 *   • sans la permission, l'écran garde sa forme et dit ce qui manque.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 4; i++) await wait(5); };
const text = (node) => (node ? node.textContent : '');
const q = (doc, sel) => doc.querySelector(sel);
const all = (doc, sel) => [...doc.querySelectorAll(sel)];
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

const COURRIEL = 'roy@exemple.ca';

function dossier(over = {}) {
  return {
    courriel: COURRIEL,
    enClair: true,
    offres: [{
      id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2000,
      statut: 'ouverte', createdAt: '2026-09-05', anonyme: true,
      nom: 'Éveline Roy', telephone: '418 555-0100', prefixe: 'G1R',
      dossier: null, pricing: null,
      paiement: { statut: 'pending', prixNotaServiceCents: null, prixNotaDateCents: null },
      acte: null, messagesCount: 1,
      messages: [{ id: 'm1', de: 'client', texte: 'Bonjour, quand signons-nous ?', createdAt: '2026-09-05T13:00:00.000Z' }],
      notaryId: null, avis: [],
      conservationJusqua: '2028-01-05', efface: false, effaceLe: null,
    }],
    consentement: null,
    journalConsentement: [],
    desabonne: false,
    journalEnvois: [],
    journalAudit: [],
    effacement: null,
    sources: [
      { famille: 'offre', joignable: true, note: null },
      { famille: 'fil_soutien', joignable: false, note: 'Les conversations de soutien sont indexées par MOIS, jamais par adresse.' },
    ],
    ...over,
  };
}

// LE PLAN DE RÉFÉRENCE EST CELUI DU DOMAINE, pas une maquette écrite à la main.
// Une fausse forme ici rendrait ces tests verts sur une console qui ne sait pas
// lire ce que le serveur envoie vraiment — c'est ainsi qu'une maquette sans
// `executable` a laissé passer une colonne « ce qui sera effacé » qui listait
// trois registres que rien n'efface.
const domain = createRequire(import.meta.url)('@nota/domain');
const PLAN_REEL = domain.erasurePlan({
  courriel: COURRIEL,
  offres: [{ id: 'b1', dateISO: '2026-12-01', status: 'annulee', acteComplete: false }],
  at: '2026-09-05T12:00:00.000Z',
});

function plan(over = {}) {
  return { ...PLAN_REEL, ...over };
}

function api(opts = {}) {
  const permissions = opts.permissions || ['subjects:read', 'subjects:erase', 'pii:read'];
  const state = {
    dossier: opts.dossier || dossier(),
    dossierStatus: opts.dossierStatus || 200,
    effacement: opts.effacement || null,
    exportStatus: opts.exportStatus || 200,
  };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'analyst' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'analyst', permissions }];
    if (url.includes('/usagers/') && url.endsWith('/export')) {
      return [state.exportStatus, state.exportStatus === 200 ? { format: 'nota.dossier-usager.v1', dossier: state.dossier } : null];
    }
    if (url.includes('/usagers/') && url.endsWith('/effacement')) {
      if (state.effacement) return typeof state.effacement === 'function' ? state.effacement(method, url, body) : state.effacement;
      return [200, {
        execute: body && body.confirmer === true,
        courriel: COURRIEL,
        plan: plan(),
        effacees: body && body.confirmer === true ? ['b1'] : [],
        enAttente: [],
        marque: null,
        avertissement: null,
      }];
    }
    if (url.includes('/usagers/')) return [state.dossierStatus, state.dossierStatus === 200 ? state.dossier : null];
    return [404, null];
  };
  handler.state = state;
  return handler;
}

async function ouvrir(handler) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      // jsdom n'implémente ni <dialog>.showModal ni les URL d'objets : on les
      // pose pour que la fenêtre d'effacement et l'export soient observables.
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new window.Event('close'));
      };
      window.URL.createObjectURL = () => 'blob:x';
      window.URL.revokeObjectURL = () => {};
      window.fetch = (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        let body = null;
        if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
        calls.push({ method, url: String(url), body });
        const [status, json] = (handler || api())(method, String(url), body) || [404, null];
        return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
      };
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC);
  await settle();
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/usagers';
  // `.page-title` existe déjà (l'aperçu) : on attend que ce soit CELUI de
  // l'écran Usagers, sans quoi on lirait la page précédente.
  await waitForTitle(win, 'Usagers');
  return { win, doc: win.document, calls };
}

async function waitForTitle(win, titre, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const h = win.document.querySelector('.page-title');
    if (h && h.textContent === titre) return h;
    await wait(5);
  }
  throw new Error('timeout waiting for title ' + titre);
}

async function waitFor(win, sel, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}

// Cherche une adresse et attend le dossier.
async function chercher(h, adresse = COURRIEL) {
  const { win, doc } = h;
  const input = q(doc, '#usr-courriel');
  input.value = adresse;
  q(doc, '.usr-recherche').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(win, '.usr-tete');
  return h;
}

// ---------------------------------------------------------------------------

test('le rail porte une entrée Usagers active qui mène au dossier', async () => {
  const { win, doc } = await ouvrir(api());
  assert.equal(win.location.hash, '#/usagers');
  assert.equal(text(q(doc, '.page-title')), 'Usagers');
  assert.ok(text(q(doc, '.admin-rail-link[aria-current="page"]')).includes('Usagers'));
});

test('l’écran s’ouvre sur une recherche, pas sur une liste de tout le monde', async () => {
  // Un annuaire de toute la clientèle serait exactement ce que la minimisation
  // interdit : on ouvre UNE personne, nommément.
  const { doc } = await ouvrir(api());
  assert.ok(q(doc, '#usr-courriel'), 'aucun champ de recherche');
  assert.equal(all(doc, '.usr-offre').length, 0, 'l’écran a listé des dossiers sans qu’on demande');
});

test('le dossier montre les offres, l’argent et la date de destruction promise', async () => {
  const h = await chercher(await ouvrir(api()));
  const offre = q(h.doc, '.usr-offre');
  assert.match(text(offre), /refinancement/);
  const faits = text(q(h.doc, '.usr-faits'));
  assert.match(faits, /Éveline Roy/);
  assert.match(faits, /418 555-0100/);
  assert.match(faits, /2 000 \$/);
  // « Et vous le gardez combien de temps ? » — répondu sans qu'on demande.
  assert.match(faits, /Conservé jusqu’au/);
  // ET AVEC SON ANNÉE. « conservé jusqu'au 5 janv. » ne promet rien : la
  // conservation d'une offre court 400 jours, celle d'une pièce comptable sept
  // ans. Une date sans année, sur cet écran, est une date fausse.
  assert.match(faits, /2028/, 'la date de conservation a perdu son année');
});

test('la CONVERSATION se lit dans le dossier — un décompte ne répond pas à l’art. 27', async () => {
  const h = await chercher(await ouvrir(api()));
  const conv = q(h.doc, '.usr-conv');
  assert.ok(conv, 'la conversation n’est pas rendue');
  assert.match(text(conv), /Bonjour, quand signons-nous \?/);
  assert.match(text(q(h.doc, '.usr-faits')), /Messages/);
});

test('sans le contenu, l’EXISTENCE de la conversation reste dite', async () => {
  // Le serveur retire le contenu sans `pii:read` ; l'écran doit quand même dire
  // qu'une conversation existe, sinon Nota paraîtrait n'en détenir aucune.
  const h = await chercher(await ouvrir(api({
    permissions: ['subjects:read'],
    dossier: (() => {
      const d = dossier({ enClair: false, courriel: 'r•••@exemple.ca' });
      d.offres[0].messages = null;
      return d;
    })(),
  })));
  assert.equal(q(h.doc, '.usr-conv'), null, 'le contenu a été rendu sans permission');
  assert.match(text(q(h.doc, '.usr-faits')), /Messages/);
});

test('un dossier MASQUÉ le dit — sinon l’opérateur croirait que Nota ne détient rien', async () => {
  const h = await chercher(await ouvrir(api({
    permissions: ['subjects:read'],
    dossier: dossier({ enClair: false, courriel: 'r•••@exemple.ca', offres: [] }),
  })));
  const badge = q(h.doc, '.usr-badge-masque');
  assert.ok(badge, 'aucune étiquette « Masqué »');
  assert.match(text(badge), /Masqué/);
  // L'étiquette porte le MOT, pas seulement une couleur.
  assert.notEqual(text(badge).trim(), '');
});

test('le dossier NOMME les registres qu’il ne peut pas joindre par personne', async () => {
  const h = await chercher(await ouvrir(api()));
  const sources = q(h.doc, '.usr-sources');
  assert.ok(sources, 'aucune liste de registres');
  assert.match(text(sources), /fil_soutien/);
  assert.match(text(sources), /Sans index par personne/);
  assert.match(text(sources), /indexées par MOIS/);
});

test('une marque d’effacement se lit EN TÊTE — « effacé » et « jamais connu » ne se confondent pas', async () => {
  const h = await chercher(await ouvrir(api({
    dossier: dossier({ effacement: { at: '2026-09-05T12:00:00.000Z' } }),
  })));
  const marque = q(h.doc, '.usr-marque');
  assert.ok(marque, 'la marque d’effacement n’apparaît pas');
  assert.match(text(marque), /Dossier effacé/);
  assert.match(text(marque), /ce que la loi oblige à conserver/);
});

test('effacer PRÉVISUALISE d’abord : deux colonnes, ce qui part et ce qui reste', async () => {
  const h = await chercher(await ouvrir(api()));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');

  const cols = all(q(h.doc, '.usr-dlg-cols'), '.usr-dlg-col');
  assert.equal(cols.length, 2, 'les deux moitiés du plan doivent être visibles ensemble');
  assert.match(text(cols[0]), /Ce qui sera effacé/);
  assert.match(text(cols[1]), /Ce qui sera conservé/);
  assert.match(text(cols[1]), /Preuve d’imputabilité/, 'une conservation doit dire son motif');

  // « Ce qui sera effacé » ne contient QUE ce que l'exécutant sait détruire.
  const promis = text(cols[0]);
  for (const hors of ['journal des envois', 'destinataire', 'index']) {
    assert.doesNotMatch(promis.toLowerCase(), new RegExp(hors), `« ${hors} » est annoncé effacé alors que rien ne l’efface`);
  }

  // Et RIEN n'a été détruit : l'appel de prévisualisation ne porte pas `confirmer`.
  const appels = h.calls.filter((c) => c.url.endsWith('/effacement'));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].body.confirmer, undefined, 'la prévisualisation a confirmé toute seule');
});

test('la fenêtre d’effacement porte le moule commun : un form.dlg-x-form et son ✕', async () => {
  const h = await chercher(await ouvrir(api()));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');
  const form = q(h.doc, '.usr-dlg form.dlg-x-form');
  assert.ok(form, 'la fenêtre ne suit pas le moule des dialogues de Nota');
  const x = q(form, '.dlg-x');
  assert.ok(x, 'aucune sortie ✕ : la fenêtre enfermerait l’opérateur');
  assert.equal(x.getAttribute('aria-label'), 'Fermer');
});

test('un plan PARTIEL le dit clairement avant qu’on ne confirme', async () => {
  const h = await chercher(await ouvrir(api({
    effacement: [200, {
      execute: false, courriel: COURRIEL, effacees: [], enAttente: [], marque: null, avertissement: null,
      plan: plan({
        complet: false,
        conserve: [{
          famille: 'offre', quoi: 'Offres dont l’acte est RÉGLÉ.', ids: ['b1'], compte: 1,
          motif: 'Un acte réglé est une pièce comptable.', base: 'Sept ans', jusqua: '2033-06-15',
        }],
      }),
    }],
  })));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');
  assert.match(text(q(h.doc, '.usr-dlg-lead')), /PARTIEL/);
  assert.match(text(q(h.doc, '.usr-dlg-cols')), /pièce comptable/);
  // Écrite comme partout ailleurs sur cet écran : lisible, et avec son année.
  assert.match(text(q(h.doc, '.usr-dlg-cols')), /2033/, 'la date de fin de conservation doit être visible');
  assert.doesNotMatch(text(q(h.doc, '.usr-dlg-cols')), /2033-06-15/, 'une date ISO brute au milieu d’une phrase');
});

test('confirmer envoie confirmer:true, une seule fois', async () => {
  const h = await chercher(await ouvrir(api()));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');
  click(h.win, [...h.doc.querySelectorAll('.usr-dlg .btn-danger')][0]);
  await settle();
  await settle();
  const confirmes = h.calls.filter((c) => c.url.endsWith('/effacement') && c.body && c.body.confirmer === true);
  assert.equal(confirmes.length, 1);
});

test('la console n’annonce JAMAIS plus que ce que le serveur a effacé', async () => {
  // Le serveur dit « rien n'a été écrit » : la console doit dire la même chose.
  const h = await chercher(await ouvrir(api({
    effacement: (method, url, body) => [200, {
      execute: body && body.confirmer === true,
      courriel: COURRIEL, plan: plan(), effacees: [], enAttente: ['b1'], marque: null,
      avertissement: 'Une partie de l’effacement n’a PAS pu être écrite.',
    }],
  })));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');
  click(h.win, [...h.doc.querySelectorAll('.usr-dlg .btn-danger')][0]);
  await settle();
  await settle();
  const toast = text(q(h.doc, '#toast'));
  assert.match(toast, /partiel/i, 'la console a annoncé un effacement complet');
  assert.doesNotMatch(toast, /^Dossier effacé\.$/);
});

test('sans « subjects:erase », le bouton d’effacement est fermé et dit pourquoi', async () => {
  const h = await chercher(await ouvrir(api({ permissions: ['subjects:read', 'pii:read'] })));
  const bouton = [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer'));
  assert.ok(bouton.disabled, 'lire un dossier ne doit pas autoriser à le détruire');
  assert.match(bouton.title, /Effacer le dossier d’une personne/);
});

test('sans « subjects:read », l’écran garde sa forme et NOMME la permission qui manque', async () => {
  const { doc } = await ouvrir(api({ permissions: ['analytics:read'] }));
  const refus = q(doc, '.admin-denied');
  assert.ok(refus, 'la section a été escamotée au lieu de dire pourquoi');
  assert.match(text(refus), /Ouvrir le dossier d’une personne/);
  assert.equal(q(doc, '#usr-courriel'), null, 'la recherche reste fermée');
});

test('l’export demande le dossier au serveur et le remet tel quel', async () => {
  const h = await chercher(await ouvrir(api()));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Exporter')));
  await settle();
  await settle();
  const appels = h.calls.filter((c) => c.url.endsWith('/export'));
  assert.equal(appels.length, 1, 'l’export ne passe pas par le serveur');
  assert.match(text(q(h.doc, '#toast')), /exporté/i);
});

test('une adresse refusée par le serveur laisse l’opérateur corriger', async () => {
  const h = await ouvrir(api({ dossierStatus: 422 }));
  const input = q(h.doc, '#usr-courriel');
  input.value = 'pas-une-adresse';
  q(h.doc, '.usr-recherche').dispatchEvent(new h.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(h.win, '.usr-erreur');
  assert.match(text(q(h.doc, '.usr-erreur')), /pas valide/);
  // Le champ survit au refus : sans lui, l'adresse serait à retaper.
  assert.ok(q(h.doc, '#usr-courriel'), 'le champ de recherche a disparu avec l’erreur');
});

test('ce que le code ne sait pas détruire est montré AVANT la confirmation, hors de la colonne « effacé »', async () => {
  // LA RÉGRESSION. Le plan du domaine range `journal_sujet`,
  // `destinataire_campagne` et `index_client` dans `efface` avec
  // `executable: false` : la console les rangeait dans « ce qui sera effacé »,
  // l'opérateur confirmait, et l'adresse restait en clair.
  const h = await chercher(await ouvrir(api()));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');

  const alerte = q(h.doc, '.usr-dlg-residu');
  assert.ok(alerte, 'aucun avertissement sur ce que Nota ne sait pas effacer');
  assert.equal(alerte.getAttribute('role'), 'alert');
  assert.match(text(alerte), /Hors de portée/);

  const pleine = q(h.doc, '.usr-dlg-col-pleine');
  assert.ok(pleine, 'les registres hors de portée ne sont nommés nulle part');
  assert.match(text(pleine), /Ce qui ne peut pas être effacé/);
  // Chacun porte sa raison, lue du plan et non réinventée par l'écran.
  const hors = PLAN_REEL.efface.filter((l) => l.executable === false);
  assert.ok(hors.length >= 3);
  for (const ligne of hors) assert.match(text(pleine), new RegExp(ligne.quoi.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text(pleine), /Non effaçable/);
});

test('un plan qui laisse des résidus ne s’annonce JAMAIS « Dossier effacé »', async () => {
  // Le serveur a bien écrit l'offre — mais le plan n'était pas complet, donc
  // l'effacement ne l'est pas. La console disait « Dossier effacé » dès que
  // `effacees` n'était pas vide, sans regarder le plan.
  const h = await chercher(await ouvrir(api({
    effacement: (method, url, body) => [200, {
      execute: !!(body && body.confirmer === true),
      courriel: COURRIEL, plan: plan(), effacees: ['b1'], enAttente: [], marque: null, avertissement: null,
    }],
  })));
  click(h.win, [...h.doc.querySelectorAll('.usr-actions .btn')].find((b) => text(b).includes('Effacer')));
  await waitFor(h.win, '.usr-dlg');
  click(h.win, [...h.doc.querySelectorAll('.usr-dlg .btn-danger')][0]);
  await settle();
  await settle();
  assert.equal(PLAN_REEL.complet, false, 'le domaine ne déclare plus aucun plan complet : ce test perdrait son sens');
  assert.match(text(q(h.doc, '#toast')), /partiel/i, 'la console a annoncé un effacement complet');
});
