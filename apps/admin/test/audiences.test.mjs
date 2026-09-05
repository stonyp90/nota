/**
 * Tests DOM pour l'écran « Audiences » — les listes de DESTINATAIRES qu'une
 * campagne peut viser.
 *
 * Elles n'avaient PAS d'écran. Le dépôt savait les stocker depuis longtemps
 * (`AUDIENCE#GROUPES`, quatre méthodes dans les deux adaptateurs, testées) et
 * personne ne les appelait ; le compositeur, lui, proposait les groupes RBAC —
 * des paquets de PERMISSIONS d'administrateurs — sous l'étiquette « Un
 * groupe ». Viser l'un d'eux ne pouvait atteindre personne.
 *
 * Ce que cet écran doit rendre lisible, et que ces tests tiennent :
 *   • l'AUDIENCE d'une liste décide quelle fiche le serveur ira lire pour
 *     chaque adresse — donc quelle base de consentement il peut établir ;
 *   • la NATURE décide si la LCAP exige une base du tout, et elle est déclarée
 *     ici plutôt que devinée à l'envoi ;
 *   • une suppression NOMME ce qu'elle efface et combien d'adresses partent ;
 *   • sans « audiences:write », l'écran garde sa forme et dit pourquoi.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (win) => { for (let i = 0; i < 4; i++) await wait(5); };
const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
  node.dispatchEvent(new win.Event('input', { bubbles: true }));
};
const q = (doc, sel) => doc.querySelector(sel);

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

function sampleAudiences() {
  return {
    ok: true,
    groupes: [{
      id: 'pilote', libelle: 'Groupe pilote', audience: 'notaire', nature: 'commercial',
      membres: ['a@etude.ca', 'b@etude.ca'], nbMembres: 2, updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  };
}

function api(opts = {}) {
  const permissions = opts.permissions || ['analytics:read', 'audiences:read', 'audiences:write'];
  const state = {
    audiences: opts.audiences || sampleAudiences(),
    audiencesStatus: opts.audiencesStatus || 200,
    ecriture: opts.ecriture || null,
  };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'analyst' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'analyst', permissions }];
    if (url.includes('/audiences/groups')) {
      if (method === 'GET') return [state.audiencesStatus, state.audiencesStatus === 200 ? state.audiences : null];
      if (state.ecriture) return typeof state.ecriture === 'function' ? state.ecriture(method, url, body) : state.ecriture;
      return [200, { ok: true, groupe: Object.assign({ id: 'x' }, body) }];
    }
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
  await settle(win);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audiences';
  await waitFor(win, '.aud-groupes');
  return { win, doc: win.document, calls };
}

async function waitFor(win, sel, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}

// ---------------------------------------------------------------------------

test('le rail porte une entrée Audiences active qui mène à l’écran des listes', async () => {
  const { win, doc } = await ouvrir();
  assert.equal(win.location.hash, '#/audiences');
  assert.equal(text(q(doc, '.page-title')), 'Audiences');
  const actif = q(doc, '.admin-rail-link[aria-current="page"]');
  assert.ok(text(actif).includes('Audiences'));
});

test('l’écran distingue explicitement une liste d’adresses d’un groupe de permissions', async () => {
  const { doc } = await ouvrir();
  assert.match(text(q(doc, '.page-sub')), /Ce ne sont pas les groupes de l’écran Accès/);
  assert.match(text(q(doc, '.aud-cadre')), /base de consentement/);
  assert.match(text(q(doc, '.aud-cadre')), /LCAP/);
});

test('une liste montre son audience, sa nature et son nombre de destinataires', async () => {
  const { doc } = await ouvrir();
  const row = q(doc, '.aud-groupe');
  assert.match(text(row), /Groupe pilote/);
  const faits = text(q(doc, '.aud-groupe-faits'));
  assert.match(faits, /Notaires/, 'quelle fiche le serveur ira lire');
  assert.match(faits, /Campagne commerciale/, 'et si la LCAP exige une base');
  assert.match(faits, /2 destinataires/);
});

test('créer une liste envoie EXACTEMENT ce que l’opérateur a écrit, une adresse par ligne', async () => {
  const { win, doc, calls } = await ouvrir();
  const form = q(doc, '.aud-groupe-form');
  assert.ok(form, 'le formulaire de création est offert avec « audiences:write »');
  change(win, form.querySelector('[name="id"]'), 'vague1');
  change(win, form.querySelector('[name="libelle"]'), 'Vague 1');
  change(win, form.querySelector('[name="audience"]'), 'client');
  change(win, form.querySelector('[name="nature"]'), 'transactionnel');
  change(win, form.querySelector('[name="membres"]'), 'A@Exemple.CA\nb@exemple.ca\n\n');
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);

  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, 'la liste part par un PUT');
  assert.match(put.url, /\/audiences\/groups\/vague1$/);
  assert.deepEqual(put.body, {
    libelle: 'Vague 1', audience: 'client', nature: 'transactionnel',
    membres: ['a@exemple.ca', 'b@exemple.ca'],
  });
});

test('le compteur d’adresses suit la saisie — on sait à combien on va écrire', async () => {
  const { win, doc } = await ouvrir();
  const form = q(doc, '.aud-groupe-form');
  const compteur = form.querySelector('.tpl-count');
  assert.equal(text(compteur), '0');
  change(win, form.querySelector('[name="membres"]'), 'a@b.ca\nc@d.ca\ne@f.ca');
  assert.equal(text(compteur), '3');
});

test('un identifiant déjà pris est refusé AVANT le réseau — un PUT est un upsert', async () => {
  const { win, doc, calls } = await ouvrir();
  const form = q(doc, '.aud-groupe-form');
  change(win, form.querySelector('[name="id"]'), 'pilote');
  change(win, form.querySelector('[name="libelle"]'), 'Autre chose');
  change(win, form.querySelector('[name="membres"]'), 'a@b.ca');
  const avant = calls.length;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.equal(calls.length, avant, 'rien ne part : l’écraser effacerait une liste');
  assert.match(text(q(doc, '.aud-groupe-form .aud-erreur')), /porte déjà cet identifiant/);
});

test('une liste vide est refusée : un groupe sans destinataire n’est pas une audience', async () => {
  const { win, doc, calls } = await ouvrir();
  const form = q(doc, '.aud-groupe-form');
  change(win, form.querySelector('[name="id"]'), 'vide');
  change(win, form.querySelector('[name="libelle"]'), 'Vide');
  const avant = calls.length;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.equal(calls.length, avant);
  assert.match(text(q(doc, '.aud-groupe-form .aud-erreur')), /Groupe vide/);
});

test('« Modifier » ouvre la liste TELLE QU’ELLE EST, adresses comprises', async () => {
  const { win, doc } = await ouvrir();
  click(win, q(doc, '.aud-groupe-edit'));
  await settle(win);
  const form = q(doc, '.aud-groupe .aud-groupe-form');
  assert.ok(form, 'l’éditeur s’ouvre sous la ligne');
  assert.equal(form.querySelector('[name="id"]').value, 'pilote');
  assert.equal(form.querySelector('[name="id"]').readOnly, true, 'l’identifiant ne se renomme pas');
  assert.equal(form.querySelector('[name="libelle"]').value, 'Groupe pilote');
  assert.equal(form.querySelector('[name="audience"]').value, 'notaire');
  assert.equal(form.querySelector('[name="membres"]').value, 'a@etude.ca\nb@etude.ca');
});

test('supprimer NOMME la liste et compte les adresses qui partent avec elle', async () => {
  const { win, doc, calls } = await ouvrir();
  click(win, q(doc, '.aud-groupe-del'));
  await settle(win);
  const confirm = q(doc, '.aud-groupe .bareme-confirm');
  assert.ok(confirm && !confirm.hidden, 'la confirmation se pose en page, jamais un confirm() du navigateur');
  assert.match(text(confirm), /Groupe pilote/);
  assert.match(text(confirm), /2 adresse/);
  assert.match(text(confirm), /Les personnes, elles, ne sont pas touchées/);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'rien sur le seul clic');

  click(win, confirm.querySelector('.btn-danger'));
  await settle(win);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del);
  assert.match(del.url, /\/audiences\/groups\/pilote$/);
});

test('le refus du serveur se lit là où le geste a été fait', async () => {
  const handler = api({
    ecriture: (method) => (method === 'DELETE'
      ? [404, { errors: [{ code: 'groupe_introuvable', message: 'Ce groupe d’audience n’existe pas.' }] }]
      : [200, { ok: true }]),
  });
  const { win, doc } = await ouvrir(handler);
  click(win, q(doc, '.aud-groupe-del'));
  await settle(win);
  click(win, q(doc, '.aud-groupe .bareme-confirm .btn-danger'));
  await settle(win);
  assert.match(text(q(doc, '.aud-groupe .aud-erreur')), /Groupe introuvable/);
});

test('sans « audiences:write », l’écran garde sa forme et nomme la permission qui manque', async () => {
  const { doc } = await ouvrir(api({ permissions: ['analytics:read', 'audiences:read'] }));
  assert.match(text(q(doc, '.tpl-readonly-note')), /Lecture seule/);
  assert.match(text(q(doc, '.tpl-readonly-note')), /Modifier les groupes d’audience/);
  assert.ok(q(doc, '.aud-groupe'), 'la liste reste lisible');
  assert.equal(q(doc, '.aud-groupe-form'), null);
  assert.equal(q(doc, '.aud-groupe-edit'), null);
  assert.equal(q(doc, '.aud-groupe-del'), null);
});

test('sans « audiences:read », c’est une porte fermée — pas une panne à réessayer', async () => {
  const handler = api({ permissions: ['analytics:read'] });
  handler.state.audiencesStatus = 403;
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        calls.push({ method, url: String(url) });
        const [status, json] = handler(method, String(url), null) || [404, null];
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
  await settle(win);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audiences';
  await waitFor(win, '.admin-denied');
  assert.equal(q(win.document, '.error-banner'), null, 'aucun « Réessayer » mort');
  assert.match(text(q(win.document, '.admin-denied')), /Voir les groupes d’audience/);
});

test('en anglais, l’écran parle anglais — jusqu’à la nature de la liste', async () => {
  const calls = [];
  const handler = api();
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', 'en');
      window.scrollTo = () => {};
      window.fetch = (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        calls.push({ method, url: String(url) });
        const [status, json] = handler(method, String(url), null) || [404, null];
        return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
      };
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(I18N_SRC);
  win.eval(ADMIN_SRC);
  await settle(win);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audiences';
  await waitFor(win, '.aud-groupes');
  const doc = win.document;
  assert.equal(text(q(doc, '.page-title')), 'Audiences');
  assert.match(text(q(doc, '.aud-groupe-faits')), /Notaries/);
  assert.match(text(q(doc, '.aud-groupe-faits')), /Commercial campaign/);
  assert.match(text(q(doc, '.aud-groupes')), /Audience groups/);
});
