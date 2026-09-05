/**
 * Tests DOM — « LES ENVOIS PASSÉS », le chemin de retour vers qui a reçu quoi.
 *
 * Le registre par (campagne, destinataire) est durable côté serveur, et l'écran
 * le lisait — UNE FOIS, dans la seconde qui suivait l'envoi, sur la réponse du
 * POST. Rechargez la console, ouvrez-la sur un autre appareil, revenez le
 * lendemain : plus aucun chemin ne menait à une campagne passée. L'identifiant
 * ne vivait que dans une variable de rendu.
 *
 * Ce que ces tests tiennent :
 *   • l'écran liste les campagnes d'un JOUR, à l'ouverture, sans avoir rien
 *     envoyé — c'est le cas « je reviens le lendemain » ;
 *   • le jour affiché est celui que le SERVEUR nomme (jour ouvrable de Québec),
 *     jamais une tranche calculée dans le navigateur ;
 *   • ouvrir une campagne passée demande SES destinataires et les rend, telles
 *     que le serveur les a masquées ou non ;
 *   • une porte fermée se lit comme une porte fermée, et un journal muet ne se
 *     déguise pas en journal vide.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

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
const all = (doc, sel) => [...doc.querySelectorAll(sel)];

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

const JOUR = '2026-09-03';

function sampleCampagnes(jour = JOUR) {
  return {
    ok: true,
    jour,
    campagnes: [
      {
        campagneId: 'camp_2', at: jour + 'T18:20:00.000Z', statut: 'envoyee',
        audience: [{ type: 'segment', segmentId: 'notaires_silencieux' }],
        templateKey: null,
        message: { sujetFr: 'On ne vous a pas vu', sujetEn: 'We have not seen you' },
        nature: 'commercial', envoyes: 12, total: 14, echoues: 2,
        echecs: [{ courriel: 'b•••@etude.ca', raison: 'unsubscribed' }],
        exclus: { desabonnes: 1, sansConsentement: 1, frequence: 0, doublons: 0, sansCourriel: 0 },
        registre: { ecrits: 14, echecs: 0, frequenceEchecs: 0 },
        garde: { frequence: 'appliquee', consentement: 'registre' },
      },
      {
        campagneId: 'camp_1', at: jour + 'T14:05:00.000Z', statut: 'echouee',
        audience: [{ type: 'group', groupId: 'pilote' }],
        templateKey: 'notaryReengage', message: null,
        nature: 'commercial', envoyes: 0, total: 3, echoues: 3, echecs: [],
        exclus: null, registre: null, garde: null,
      },
    ],
  };
}

function sampleDestinataires(campagneId = 'camp_2') {
  return {
    ok: true,
    campagneId,
    destinataires: [
      { courriel: 'a@etude.ca', statut: 'envoye', erreur: null, at: JOUR + 'T18:20:01.000Z' },
      { courriel: 'b•••@etude.ca', statut: 'echoue', erreur: 'unsubscribed', at: JOUR + 'T18:20:02.000Z' },
    ],
    cursor: null,
  };
}

const SEGMENTS = {
  ok: true,
  limites: { sujet: 200, preheader: 200, corps: 4000, cta: 60, jetons: ['email'] },
  segments: [{
    id: 'notaires_silencieux', libelle: 'Notaires silencieux', libelleEn: 'Silent notaries',
    vise: 'Le notaire qui n’a rien retenu depuis un moment.',
    audience: 'notaire', nature: 'commercial',
    params: [{ nom: 'joursSilence', defaut: 30, min: 7, max: 365 }],
  }],
};

function api(opts = {}) {
  const permissions = opts.permissions
    || ['analytics:read', 'pii:read', 'campaigns:send', 'audiences:read', 'audiences:write'];
  const state = {
    campagnes: opts.campagnes || sampleCampagnes(),
    campagnesStatus: opts.campagnesStatus || 200,
    destinataires: opts.destinataires || sampleDestinataires(),
    destinatairesStatus: opts.destinatairesStatus || 200,
  };
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions }];
    if (url.includes('/notifications/templates')) return [200, { limites: {}, templates: [] }];
    if (url.includes('/segments')) return [200, SEGMENTS];
    if (url.includes('/audiences/groups')) {
      return [200, { ok: true, groupes: [], limites: { identifiantMotif: '^[a-z0-9][a-z0-9_-]{0,39}$', libelleMax: 80, membresMax: 500 } }];
    }
    if (url.includes('/recipients')) {
      return [state.destinatairesStatus, state.destinatairesStatus === 200 ? state.destinataires : null];
    }
    if (url.includes('/campaigns') && method === 'GET') {
      if (state.campagnesStatus !== 200) return [state.campagnesStatus, null];
      const m = /[?&]jour=([^&]+)/.exec(url);
      const jour = m ? decodeURIComponent(m[1]) : null;
      return [200, typeof state.campagnes === 'function' ? state.campagnes(jour) : state.campagnes];
    }
    if (url.includes('/campaigns')) {
      return [200, { ok: true, envoyes: 1, echoues: 0, echecs: [], registre: { ecrits: 1, echecs: 0 }, exclus: {}, campagneId: 'camp_3' }];
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
  win.location.hash = '#/campagnes';
  await waitFor(win, '.camp-form');
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

test('l’écran liste les envois passés SANS qu’on ait rien envoyé — le cas « je reviens le lendemain »', async () => {
  const { win, doc } = await ouvrir();
  await waitFor(win, '.camp-histoire-ligne');
  const lignes = all(doc, '.camp-histoire-ligne');
  assert.equal(lignes.length, 2, 'les deux campagnes du jour');
  assert.equal(lignes[0].getAttribute('data-campagne'), 'camp_2', 'la plus récente d’abord, comme le serveur la rend');
  assert.match(text(lignes[0]), /On ne vous a pas vu/, 'qui a reçu QUOI : la copie voyage avec la trace');
  assert.match(text(lignes[0]), /12/, 'et combien ont été joints');
  assert.match(text(lignes[1]), /notaryReengage/, 'un gabarit réexpédié se nomme par sa clé');
});

test('le jour affiché est celui que le SERVEUR nomme — la console n’en calcule aucun', async () => {
  const { win, doc } = await ouvrir();
  await waitFor(win, '.camp-histoire-jour');
  assert.equal(q(doc, '.camp-histoire-jour').value, JOUR,
    'le jour ouvrable de Québec vient du serveur : une tranche UTC dans le navigateur mentirait à 21 h');
});

test('changer de jour redemande CE jour-là au serveur', async () => {
  const handler = api();
  handler.state.campagnes = (jour) => (jour === '2026-09-01'
    ? { ok: true, jour: '2026-09-01', campagnes: [] }
    : sampleCampagnes());
  const { win, doc, calls } = await ouvrir(handler);
  await waitFor(win, '.camp-histoire-ligne');

  change(win, q(doc, '.camp-histoire-jour'), '2026-09-01');
  await settle(win);
  const demande = calls.filter((c) => c.method === 'GET' && c.url.includes('/campaigns')).pop();
  assert.match(demande.url, /jour=2026-09-01/);
  assert.equal(all(doc, '.camp-histoire-ligne').length, 0);
  assert.match(text(q(doc, '.camp-histoire-corps')), /Aucune campagne/);
});

test('ouvrir une campagne passée demande SES destinataires et les rend', async () => {
  const { win, doc, calls } = await ouvrir();
  await waitFor(win, '.camp-histoire-ligne');
  const ligne = all(doc, '.camp-histoire-ligne')[0];
  click(win, ligne.querySelector('.camp-histoire-voir'));
  await waitFor(win, '.camp-histoire-ligne .camp-recus');

  const demande = calls.find((c) => c.url.includes('/recipients'));
  assert.ok(demande, 'la deuxième moitié du chemin part vraiment');
  assert.match(demande.url, /\/campaigns\/camp_2\/recipients$/);

  const table = q(doc, '.camp-histoire-ligne .camp-recus-table');
  assert.match(text(table), /a@etude\.ca/);
  assert.match(text(table), /b•••@etude\.ca/, 'le masque est celui du serveur : la console ne démasque rien');
  assert.equal(all(doc, '.camp-histoire-ligne .camp-recus-table tbody tr').length, 2);
});

test('refermer une campagne ouverte range sa liste — un écran ne s’empile pas', async () => {
  const { win, doc } = await ouvrir();
  await waitFor(win, '.camp-histoire-ligne');
  const ligne = all(doc, '.camp-histoire-ligne')[0];
  const bouton = ligne.querySelector('.camp-histoire-voir');
  click(win, bouton);
  await waitFor(win, '.camp-histoire-ligne .camp-recus');
  assert.equal(bouton.getAttribute('aria-expanded'), 'true');
  click(win, bouton);
  await settle(win);
  assert.equal(ligne.querySelector('.camp-recus'), null);
  assert.equal(bouton.getAttribute('aria-expanded'), 'false');
});

test('un journal muet ne se déguise pas en journal vide', async () => {
  const handler = api({ campagnesStatus: 500 });
  const { win, doc } = await ouvrir(handler);
  await waitFor(win, '.camp-histoire-corps');
  await settle(win);
  assert.equal(q(doc, '.camp-histoire-ligne'), null);
  assert.match(text(q(doc, '.camp-histoire-corps')), /n’a pas répondu/,
    'une panne se dit ; « aucune campagne » serait un mensonge tranquille');
});

test('quitter l’écran et y revenir retrouve la liste — c’est tout le défaut, en un geste', async () => {
  const { win, doc } = await ouvrir();
  await waitFor(win, '.camp-histoire-ligne');
  win.location.hash = '#/audiences';
  await settle(win);
  win.location.hash = '#/campagnes';
  await waitFor(win, '.camp-histoire-ligne');
  assert.deepEqual(
    all(doc, '.camp-histoire-ligne').map((l) => l.getAttribute('data-campagne')),
    ['camp_2', 'camp_1'],
  );
});

test('sans « analytics:read » sur le journal, l’écran dit la porte fermée plutôt qu’une panne', async () => {
  const handler = api({ campagnesStatus: 403 });
  const { win, doc } = await ouvrir(handler);
  await waitFor(win, '.camp-histoire-corps');
  await settle(win);
  assert.equal(q(doc, '.camp-histoire-corps .error-banner'), null, 'aucun « Réessayer » mort');
  assert.match(text(q(doc, '.camp-histoire-corps')), /Lire les tableaux de bord/);
});
