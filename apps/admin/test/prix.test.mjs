/**
 * Tests DOM sans navigateur pour la section « Prix » — le prix du service de
 * Nota, décidé par Nota (ADR 0031). Ce fichier remplace commission.test.mjs :
 * l'écran n'édite plus un barème de taux mais UN montant, parce que l'art. 29.1
 * du Code de déontologie interdit au notaire toute convention mettant en péril
 * son indépendance et son désintéressement — et un prix indexé sur une cote
 * attribuée par Nota en est une.
 *
 * Même harnais que smoke.test.mjs / courriels.test.mjs : index.html dans jsdom,
 * admin.js évalué, fetch bouchonné en API admin, assertions sur le DOM rendu.
 * Couvre : l'entrée du rail et sa route, la vue de lecture (prix en vigueur,
 * défaut, ligne de provenance), le formulaire (dollars → cents à l'envoi), le
 * refus local d'une évidence, un 422 servi en ligne, la remise à zéro derrière
 * une confirmation en page, et la vue en lecture seule de l'analyste.
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

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
    calls.push({ method, url: String(url), body });
    const out = handler(method, String(url), body) || [404, null];
    const [status, json] = out;
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
    });
  };
}

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

async function boot(handler, hash, lang) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (lang) window.localStorage.setItem('nota.lang', lang);
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  if (lang) win.eval(I18N_SRC); // same order as index.html: the engine, then the app
  win.eval(ADMIN_SRC);
  await settle(win);
  return { win, calls, doc: win.document };
}

async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}
async function settle(win) { for (let i = 0; i < 3; i++) await wait(5); }

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));
const submit = (win, form) => form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
const type = (win, input, value) => {
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
};

// La charge de GET /prix — le défaut gouverne, ou un prix stocké gouverne.
// Le défaut expédié est celui de prix-nota-config.js : 40 000 ¢ = 400 $.
function samplePrix(opts = {}) {
  const defaut = { prixCents: 40000 };
  if (opts.override) {
    const override = { prixCents: 25000, updatedAt: '2026-08-27T12:00:00.000Z' };
    return { defaut, override, effectif: { prixCents: override.prixCents } };
  }
  return { defaut, override: null, effectif: defaut };
}

// L'API authentifiée : super_admin par défaut, ou un analyste sans settings:write.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { prix: opts.prix || samplePrix(), onWrite: opts.onWrite || null };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/prix')) {
      if (method === 'GET') return [200, state.prix];
      if (state.onWrite) return state.onWrite(method, url, body);
      return [200, method === 'PUT' ? { ok: true, override: {} } : { ok: true }];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('le rail porte une entrée Prix active qui mène à la vue du prix', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const links = [...doc.querySelectorAll('.admin-rail-link')];
  const entry = links.find((b) => text(b).includes('Prix'));
  assert.ok(entry, 'l’entrée « Prix » manque au rail');
  assert.equal(entry.disabled, false, 'l’entrée doit être active (pas un « Bientôt »)');
  const courriels = links.find((b) => text(b).includes('Courriels'));
  const firstDisabled = links.find((b) => b.disabled);
  assert.ok(links.indexOf(entry) > links.indexOf(courriels), 'Prix vient après Courriels');
  assert.ok(links.indexOf(entry) < links.indexOf(firstDisabled), 'Prix vient avant les entrées désactivées');

  click(win, entry);
  await waitFor(win, '.bareme-card');
  assert.equal(win.location.hash, '#/prix');
  assert.equal(text(doc.querySelector('.page-title')), 'Prix');
  const active = doc.querySelector('.admin-rail-link[aria-current="page"]');
  assert.ok(text(active).includes('Prix'), 'le rail marque Prix comme actif');
});

test('la vue de lecture énonce le prix en vigueur, le défaut, et rien qui ressemble à un partage', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-card');

  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Prix en vigueur'), '400 $', 'les 40 000 ¢ s’affichent comme « 400 $ »');
  assert.equal(byKey('Défaut du déploiement'), '400 $');

  // ADR 0031 — le vocabulaire du partage a disparu de l'écran, en entier.
  const all = text(doc.querySelector('.admin-content'));
  assert.ok(!/taux|plancher|palier|pourcentage|%/i.test(all), 'un mot du barème est resté : ' + all.slice(0, 200));
  assert.equal(doc.querySelector('.ptable'), null, 'plus de tableau de paliers');
  assert.equal(doc.querySelector('.bareme-sim'), null, 'plus de simulateur de cote');

  // La ligne qui dit ce que le client paie vraiment, et à qui.
  assert.match(all, /Le client autorise sa carte pour le montant offert au notaire PLUS ce prix/);
  // Aucun prix stocké — la ligne de provenance le dit sans bruit.
  assert.match(text(doc.querySelector('.chart-card-sub')), /Valeur par défaut du déploiement/);
});

test('un prix stocké affiche sa date de modification dans la ligne de provenance', async () => {
  const { win, doc } = await boot(api({ prix: samplePrix({ override: true }) }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-card');
  const sub = [...doc.querySelectorAll('.chart-card-sub')].map(text).join(' ');
  // 2026-08-27T12:00Z se lit 08:00 à Montréal (EDT) — l'heure de l'opérateur, nommée (audit 2026-09-03, P2-27).
  assert.match(sub, /Prix décidé par Nota — modifié le 2026-08-27 08:00 \(heure de Québec\)\./);
  assert.equal([...doc.querySelectorAll('.stat-tile')]
    .map((t) => text(t.querySelector('.stat-v')))[0], '250 $', 'le prix stocké est celui en vigueur');
});

test('le formulaire convertit les dollars saisis en cents et PUT le prix', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, url, body });
      return [200, { ok: true, override: Object.assign({}, body, { updatedAt: futureISO() }) }];
    },
  });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  const form = await waitFor(win, '.bareme-form');

  // Le champ est amorcé sur le prix en vigueur, en dollars.
  const input = form.querySelector('.tpl-fields input');
  assert.equal(input.value, '400', 'amorcé en dollars, jamais en cents');
  type(win, input, '250,50'); // la virgule décimale du Québec voyage

  submit(win, form);
  await settle(win);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /\/prix$/);
  assert.deepEqual(writes[0].body, { prixCents: 25050 });
  await waitFor(win, '.stat-tile'); // la vue se recharge après l'enregistrement
  assert.match(text(doc.querySelector('#toast')), /Prix enregistré/);
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url.includes('/prix')).length >= 2,
    'le prix est relu après l’enregistrement');
});

test('une évidence n’atteint jamais l’API : l’écran la refuse en ligne', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) { writes.push({ method, body }); return [200, { ok: true, override: {} }]; },
  });
  const { win } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  const form = await waitFor(win, '.bareme-form');
  const input = form.querySelector('.tpl-fields input');
  const error = form.querySelector('.tpl-error');

  // Le champ parle DOLLARS : « 0,15 » y vaut 15 ¢, un prix absurde mais légal,
  // et l'écran ne refuse jamais autre chose que ce que le serveur refuse.
  for (const mauvais of ['0', '-40', 'quatre cents', '', '400,555', '15 %']) {
    type(win, input, mauvais);
    submit(win, form);
    await settle(win);
    assert.equal(writes.length, 0, 'rien n’est envoyé pour : ' + JSON.stringify(mauvais));
    assert.equal(error.hidden, false);
    assert.match(text(error), /Le prix de Nota doit être un nombre entier de cents/);
  }

  // Un prix cohérent : le PUT part et le refus s'efface.
  type(win, input, '300');
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 1, 'un prix valide voyage');
  assert.deepEqual(writes[0].body, { prixCents: 30000 });
  assert.equal(error.hidden, true, 'le refus en ligne s’efface dès que le prix tient');
});

test('un 422 de l’API s’affiche en ligne sans recharger', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, body });
      return [422, { errors: [
        { code: 'prix_invalide', message: 'Le prix de Nota doit être un nombre entier de cents, supérieur à zéro (ex. 40000 pour 400,00 $).' },
      ] }];
    },
  });
  const { win, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  const form = await waitFor(win, '.bareme-form');
  const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/prix')).length;

  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 1, 'un prix cohérent atteint l’API — le serveur reste l’autorité');
  const err = form.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /Le prix de Nota doit être un nombre entier de cents/);
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url.includes('/prix')).length, gets,
    'aucun rechargement sur un échec de validation');
});

test('Revenir à la valeur par défaut demande une confirmation en page, puis DELETE', async () => {
  const writes = [];
  const handler = api({
    prix: samplePrix({ override: true }),
    onWrite(method, url, body) { writes.push({ method, url, body }); return [200, { ok: true }]; },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-form');

  const open = [...doc.querySelectorAll('button')].find((b) => text(b) === 'Revenir à la valeur par défaut');
  assert.ok(open, 'un prix enregistré offre la remise à zéro');
  const confirmBox = doc.querySelector('.bareme-confirm');
  assert.equal(confirmBox.hidden, true, 'la bande de confirmation démarre cachée');

  click(win, open);
  assert.equal(confirmBox.hidden, false, 'le premier clic ne fait que révéler la confirmation');
  assert.equal(writes.length, 0, 'aucun DELETE avant la confirmation');

  // Annuler recule sans aucune requête.
  click(win, [...confirmBox.querySelectorAll('button')].find((b) => text(b) === 'Annuler'));
  assert.equal(confirmBox.hidden, true);
  assert.equal(writes.length, 0);

  click(win, open);
  click(win, [...confirmBox.querySelectorAll('button')].find((b) => text(b) === 'Confirmer la réinitialisation'));
  await settle(win);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'DELETE');
  assert.match(writes[0].url, /\/prix$/);
  await waitFor(win, '.stat-tile');
  assert.match(text(doc.querySelector('#toast')), /Prix réinitialisé/);
});

test('sans prix enregistré, la remise à zéro n’est pas offerte', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-form');
  const open = [...doc.querySelectorAll('button')].find((b) => text(b) === 'Revenir à la valeur par défaut');
  assert.equal(open, undefined, 'aucune remise à zéro sans prix stocké');
});

test('un analyste voit le prix en lecture seule — aucun formulaire', async () => {
  const { win, doc } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-card');

  assert.match(text(doc.querySelector('.tpl-readonly-note')), /Lecture seule/);
  assert.ok(doc.querySelector('.stat-tile'), 'l’analyste lit quand même le prix en vigueur');
  assert.equal(doc.querySelector('.bareme-form'), null, 'aucun formulaire pour l’analyste');
  const labels = [...doc.querySelectorAll('button')].map(text);
  assert.ok(!labels.includes('Enregistrer le prix'), 'aucun bouton d’enregistrement');
  assert.ok(!labels.includes('Revenir à la valeur par défaut'), 'aucun bouton de remise à zéro');
});

test('tout le vocabulaire du prix passe en anglais — écran et refus', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  await waitFor(win, '.bareme-form');
  await settle(win);

  const page = text(doc.querySelector('.admin-content'));
  assert.match(page, /Nota’s service price — a fixed amount, the same for every notary\./);
  assert.match(page, /Price in force/);
  assert.match(page, /Deployment default/);
  assert.match(page, /Edit the price/);
  assert.match(page, /Nota’s price \(\$\)/, 'l’étiquette du champ suit');
  assert.match(page, /The client authorizes their card for the amount offered to the notary PLUS this price/);

  // Un refus local parle anglais aussi — c'est NOTRE chaîne, pas celle de l'API.
  const form = doc.querySelector('.bareme-form');
  type(win, form.querySelector('.tpl-fields input'), '0');
  submit(win, form);
  await settle(win);
  assert.match(text(form.querySelector('.tpl-error')),
    /Nota’s price must be a whole number of cents, greater than zero \(e\.g\. 40000 for \$400\.00\)\./);
});

test('un GET du prix en échec montre la bannière de reprise, et la reprise rétablit', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/prix') && method === 'GET') {
      return fail ? [500, null] : [200, samplePrix()];
    }
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/prix';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.bareme-card');
  assert.ok(!doc.querySelector('.error-banner'), 'la bannière disparaît après une reprise réussie');
});
