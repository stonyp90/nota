/**
 * Tests DOM — LES BORNES DE L'ÉCRAN « AUDIENCES » VIENNENT DU SERVEUR.
 *
 * La console portait ses propres copies : un `AUD_ID_RE` et un
 * `AUD_LIBELLE_MAX = 80` jumeaux de ceux d'`admin.js`, et AUCUN plafond de
 * membres — `NOTA_AUDIENCE_MEMBRES_MAX` n'était servi nulle part. Relever le
 * plafond d'un déploiement laissait donc l'interface l'ignorer, et le resserrer
 * laissait l'opérateur saisir des centaines d'adresses avant de découvrir le
 * refus au retour du réseau. Le compositeur de campagnes recevait déjà ses
 * bornes du serveur (`limites`) ; cet écran-ci ne le faisait pas.
 *
 * Ce que ces tests tiennent : la règle appliquée à l'écran EST celle que le
 * serveur a servie — motif d'identifiant, longueur du nom, plafond de
 * destinataires — et rien n'est recopié dans le fichier de la console.
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
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
  node.dispatchEvent(new win.Event('input', { bubbles: true }));
};
const q = (doc, sel) => doc.querySelector(sel);

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

// Les bornes que le serveur applique vraiment (apps/api/src/admin.js).
const LIMITES = { identifiantMotif: '^[a-z0-9][a-z0-9_-]{0,39}$', libelleMax: 80, membresMax: 500 };

function api(opts = {}) {
  const permissions = opts.permissions || ['analytics:read', 'audiences:read', 'audiences:write'];
  const state = { limites: 'limites' in opts ? opts.limites : LIMITES };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions }];
    if (url.includes('/audiences/groups')) {
      if (method === 'GET') {
        const corps = { ok: true, groupes: [] };
        if (state.limites) corps.limites = state.limites;
        return [200, corps];
      }
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

// Les deux copies nommément. Le test structurel double les tests de
// comportement ci-dessous : ceux-là prouvent que l'écran applique la règle
// SERVIE, celui-ci qu'aucune copie ne dort à côté, prête à redevenir la source.
// (`GROUP_ID_RE`, lui, garde l'écran « Accès » — un autre écran, une autre
// route, un autre chantier.)
test('AUCUNE borne d’audience n’est écrite en dur dans le fichier de la console', () => {
  assert.equal(/AUD_ID_RE/.test(ADMIN_SRC), false, 'le motif d’identifiant vient du serveur');
  assert.equal(/AUD_LIBELLE_MAX/.test(ADMIN_SRC), false, 'la longueur du nom aussi');
});

test('le champ « Nom » porte le maxlength SERVI, pas un littéral', async () => {
  const { doc } = await ouvrir(api({ limites: Object.assign({}, LIMITES, { libelleMax: 24 }) }));
  assert.equal(q(doc, '.aud-groupe-form [name="libelle"]').maxLength, 24);
});

test('le motif d’identifiant appliqué à l’écran est celui du serveur', async () => {
  // Un déploiement qui n’accepterait que trois lettres : l’écran doit refuser
  // ce que le serveur refuserait, et accepter ce qu’il accepterait.
  const { win, doc, calls } = await ouvrir(api({ limites: Object.assign({}, LIMITES, { identifiantMotif: '^[a-z]{3}$' }) }));
  const form = q(doc, '.aud-groupe-form');
  change(win, form.querySelector('[name="id"]'), 'pilote');
  change(win, form.querySelector('[name="libelle"]'), 'Pilote');
  change(win, form.querySelector('[name="membres"]'), 'a@b.ca');
  const avant = calls.length;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.equal(calls.length, avant, 'refusé avant le réseau, avec la règle du serveur');
  assert.match(text(q(doc, '.aud-erreur')), /Identifiant/);

  change(win, form.querySelector('[name="id"]'), 'abc');
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.ok(calls.find((c) => c.method === 'PUT'), 'et accepté quand la règle du serveur l’accepte');
});

test('le plafond de destinataires est celui du déploiement — l’écran le montre et le fait respecter', async () => {
  const { win, doc, calls } = await ouvrir(api({ limites: Object.assign({}, LIMITES, { membresMax: 3 }) }));
  const form = q(doc, '.aud-groupe-form');
  const compteur = form.querySelector('.tpl-count');
  assert.match(text(compteur), /3$/, 'le plafond est visible AVANT d’être atteint');

  change(win, form.querySelector('[name="id"]'), 'vague1');
  change(win, form.querySelector('[name="libelle"]'), 'Vague 1');
  change(win, form.querySelector('[name="membres"]'), 'a@b.ca\nc@d.ca\ne@f.ca\ng@h.ca');
  assert.match(text(compteur), /^4/, 'et le dépassement se voit à la saisie');
  const avant = calls.length;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.equal(calls.length, avant, 'rien ne part : le serveur refuserait de toute façon');
  assert.match(text(q(doc, '.aud-erreur')), /destinataires/i);
});

test('un serveur qui ne sert PAS ses bornes ne ferme pas l’écran — c’est lui qui tranchera', async () => {
  const { win, doc, calls } = await ouvrir(api({ limites: null }));
  const form = q(doc, '.aud-groupe-form');
  assert.ok(form, 'l’écran garde sa forme');
  change(win, form.querySelector('[name="id"]'), 'vague1');
  change(win, form.querySelector('[name="libelle"]'), 'Vague 1');
  change(win, form.querySelector('[name="membres"]'), 'a@b.ca');
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
  assert.ok(calls.find((c) => c.method === 'PUT'),
    'sans borne servie, la console n’en invente pas : elle laisse le serveur décider');
});
