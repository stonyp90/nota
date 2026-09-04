/**
 * Headless DOM tests for the « Annulation » section (the late-cancellation
 * fee barème Nota decides, ADR 0023 §2). Same harness as commission.test.mjs:
 * boot index.html in jsdom, eval admin.js, stub fetch as the admin API,
 * assert on the rendered DOM. Covers: the rail entry + route, the read view
 * (percent display, day bands, defaults-vs-override source line, the free
 * empty barème), the edit form (percent → fraction conversion on PUT, tier
 * add/remove, API 422 surfaced inline), the in-page confirmed DELETE reset,
 * and the analyst read-only view.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

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

async function boot(handler, hash) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
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

// The GET /annulation payload — defaults ruling, or a stored override ruling.
function sampleAnnulation(opts = {}) {
  const defaut = {
    paliers: [
      { maxJours: 3, taux: 0.30 },
      { maxJours: 14, taux: 0.10 },
    ],
  };
  if (opts.override) {
    const override = {
      paliers: opts.emptyOverride ? [] : [{ maxJours: 5, taux: 0.5 }],
      updatedAt: '2026-08-28T12:00:00.000Z',
    };
    return { defaut, override, effectif: { paliers: override.paliers } };
  }
  return { defaut, override: null, effectif: defaut };
}

// The authed API: super_admin by default, or an analyst without settings:write.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { annulation: opts.annulation || sampleAnnulation(), onWrite: opts.onWrite || null };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/annulation')) {
      if (method === 'GET') return [200, state.annulation];
      if (state.onWrite) return state.onWrite(method, url, body);
      return [200, method === 'PUT' ? { ok: true, override: {} } : { ok: true }];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an enabled Annulation entry that routes to the barème view', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const links = [...doc.querySelectorAll('.admin-rail-link')];
  const entry = links.find((b) => text(b).includes('Annulation'));
  assert.ok(entry, 'rail entry « Annulation » is missing');
  assert.equal(entry.disabled, false, 'the entry must be enabled (not a « Bientôt » placeholder)');
  // « Commission » a disparu du rail avec l'ADR 0031 : c'est « Prix » qui la
  // remplace, et l'ordre se vérifie contre elle — sinon l'assertion portait sur
  // un `undefined` et ne vérifiait plus rien.
  const prix = links.find((b) => text(b).includes('Prix'));
  const firstDisabled = links.find((b) => b.disabled);
  assert.ok(prix, 'l’entrée « Prix » manque au rail');
  assert.ok(links.indexOf(entry) > links.indexOf(prix), 'Annulation sits after Prix');
  assert.ok(links.indexOf(entry) < links.indexOf(firstDisabled), 'Annulation sits before the disabled placeholders');

  click(win, entry);
  await waitFor(win, '.bareme-card');
  assert.equal(win.location.hash, '#/annulation');
  assert.equal(text(doc.querySelector('.page-title')), 'Annulation');
  const active = doc.querySelector('.admin-rail-link[aria-current="page"]');
  assert.ok(text(active).includes('Annulation'), 'the rail marks Annulation active');
});

test('the read view shows the barème in force as day bands and percentages', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-card');

  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Dernière minute'), '30 %', 'the 0.30 fraction displays as « 30 % »');
  assert.equal(byKey('Paliers'), '2');
  assert.equal(byKey('Gratuit dès'), '15 jours', 'free from the day after the last tier');

  const rows = [...doc.querySelectorAll('.ptable tbody tr')];
  assert.equal(rows.length, 2, 'both tiers render');
  const cells = (r) => [...r.querySelectorAll('td')].map(text);
  assert.deepEqual(cells(rows[0]), ['0–3 jours', '30 %'], 'the first band starts at zero');
  assert.deepEqual(cells(rows[1]), ['4–14 jours', '10 %'], 'the second band starts after the first');

  // No override stored — the source line quietly says the defaults rule.
  assert.match(text(doc.querySelector('.chart-card-sub')), /Valeurs par défaut du déploiement/);
});

test('a stored override shows its updatedAt; an EMPTY override reads as free everywhere', async () => {
  const { win, doc } = await boot(api({ annulation: sampleAnnulation({ override: true, emptyOverride: true }) }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-card');
  const sub = [...doc.querySelectorAll('.chart-card-sub')].map(text).join(' ');
  assert.match(sub, /Barème décidé par Nota — modifié le 2026-08-28 08:00 \(heure de Québec\)\./);
  assert.equal(doc.querySelector('.ptable'), null, 'no tier table on an empty barème');
  assert.match(text(doc.querySelector('.tpl-note')), /Aucun palier — l’annulation est gratuite partout\./);
  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Dernière minute'), '0 %', 'an empty barème charges nothing even at zero days');
  // P2-25 — « Gratuit dès 0 jour » ne veut rien dire : sans palier, la tuile s'efface.
  assert.equal(byKey('Gratuit dès'), undefined);
});

// ---------------------------------------------------------------------------
// Audit console admin (2026-09-03)
// ---------------------------------------------------------------------------

test('P2-24 — la tuile « Dernière minute » parle du jour de la signature, pas de la veille', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-card');
  const tile = [...doc.querySelectorAll('.stat-tile')].find((t) => text(t.querySelector('.stat-k')) === 'Dernière minute');
  assert.equal(text(tile.querySelector('.stat-sub')), 'retenu le jour de la signature');
});

test('P2-26 — le formulaire refuse lui-même un taux hors de (0, 1) et des jours non croissants, sans réseau', async () => {
  const writes = [];
  const handler = api({ onWrite(method, url, body) { writes.push(body); return [200, { ok: true, override: {} }]; } });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  const form = await waitFor(win, '.bareme-form');
  const rows = form.querySelector('.bareme-rows');
  const inputs = (i) => rows.children[i].querySelectorAll('input');

  // 150 % n'est pas un taux.
  inputs(0)[1].value = '150';
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0, 'rien ne part');
  let err = form.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /Palier 1 : il faut un nombre de jours entier ≥ 0 et un taux entre 0 et 1/);
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(inputs(0)[1].getAttribute('aria-invalid'), 'true', 'le champ fautif porte la marque');
  assert.equal(win.document.activeElement, inputs(0)[1], 'et reçoit le focus');

  // Des jours qui redescendent.
  inputs(0)[1].value = '30';
  inputs(0)[0].value = '20';
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0);
  err = form.querySelector('.tpl-error');
  assert.match(text(err), /Palier 2 : les jours doivent être strictement croissants/);

  // Corrigé : ça part.
  inputs(0)[0].value = '3';
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 1);
});

test('P2-27 — la date de modification se lit à l’heure de Québec, et le dit', async () => {
  const { win, doc } = await boot(api({ annulation: sampleAnnulation({ override: true }) }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-card');
  // 2026-08-28T12:00Z = 08:00 à Montréal (EDT).
  const sub = [...doc.querySelectorAll('.chart-card-sub')].map(text).join(' ');
  assert.match(sub, /modifié le 2026-08-28 08:00 \(heure de Québec\)\./);
});

test('the edit form converts percent inputs to fractions and PUTs the full barème', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, url, body });
      return [200, { ok: true, override: Object.assign({}, body, { updatedAt: futureISO() }) }];
    },
  });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  const form = await waitFor(win, '.bareme-form');

  // The rows are seeded from the barème in force: days as integers, taux in
  // percent (not fraction).
  const rowsBox = form.querySelector('.bareme-rows');
  assert.equal(rowsBox.children.length, 2);
  const [joursIn, tauxIn] = rowsBox.children[0].querySelectorAll('input');
  assert.equal(joursIn.value, '3');
  assert.equal(tauxIn.value, '30', 'taux seeded as percent, not fraction');
  tauxIn.value = '35'; // typing « 35 » must travel as 0.35

  submit(win, form);
  await settle(win);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /\/annulation$/);
  assert.deepEqual(writes[0].body, {
    paliers: [
      { maxJours: 3, taux: 0.35 },
      { maxJours: 14, taux: 0.10 },
    ],
  });
  await waitFor(win, '.stat-tile'); // the view reloads after a save
  assert.match(text(doc.querySelector('#toast')), /Barème enregistré/);
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url.includes('/annulation')).length >= 2, 'the barème is re-fetched after the save');
});

test('tier rows can be added (cap 10) and removed — removing them ALL sends the empty kill-switch', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) { writes.push({ method, body }); return [200, { ok: true, override: {} }]; },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  const form = await waitFor(win, '.bareme-form');
  const rowsBox = form.querySelector('.bareme-rows');
  const addBtn = [...form.querySelectorAll('button')].find((b) => text(b) === 'Ajouter un palier');

  // The add control caps at 10 rows.
  for (let i = 0; i < 12; i++) click(win, addBtn);
  assert.equal(rowsBox.children.length, 10, 'never more than 10 tiers');
  assert.equal(addBtn.disabled, true, 'the add control disables at the cap');

  // Remove every row: an EMPTY barème is a valid override (free everywhere).
  while (rowsBox.children.length > 0) click(win, rowsBox.children[0].querySelector('.bareme-remove'));
  assert.equal(addBtn.disabled, false, 'removing rows re-enables add');

  submit(win, form);
  await settle(win);
  assert.deepEqual(writes[0].body, { paliers: [] }, 'the empty list travels — the kill-switch is data');
});

test('a 422 from the API surfaces every message inline without reloading', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, body });
      return [422, { errors: [
        { code: 'palier_invalide', message: 'Palier 1 : il faut un nombre de jours entier ≥ 0 et un taux entre 0 et 1 (ex. 0,30 pour 30 %).' },
        { code: 'paliers_desordonnes', message: 'Palier 2 : les jours doivent être strictement croissants.' },
      ] }];
    },
  });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  const form = await waitFor(win, '.bareme-form');
  const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/annulation')).length;

  submit(win, form);
  await settle(win);
  const err = form.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /un taux entre 0 et 1/);
  assert.match(text(err), /strictement croissants/);
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url.includes('/annulation')).length, gets, 'no reload on a validation failure');
});

test('Revenir aux valeurs par défaut asks an in-page confirmation, then DELETEs', async () => {
  const writes = [];
  const handler = api({
    annulation: sampleAnnulation({ override: true }),
    onWrite(method, url, body) { writes.push({ method, url, body }); return [200, { ok: true }]; },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-form');

  const open = [...doc.querySelectorAll('button')].find((b) => text(b) === 'Revenir aux valeurs par défaut');
  assert.ok(open, 'an overridden barème offers the reset');
  const confirmBox = doc.querySelector('.bareme-confirm');
  assert.equal(confirmBox.hidden, true, 'the confirm strip starts hidden');

  click(win, open);
  assert.equal(confirmBox.hidden, false, 'the first click only reveals the confirm step');
  assert.equal(writes.length, 0, 'no DELETE before the confirmation');

  // Annuler backs out without any request.
  click(win, [...confirmBox.querySelectorAll('button')].find((b) => text(b) === 'Annuler'));
  assert.equal(confirmBox.hidden, true);
  assert.equal(writes.length, 0);

  click(win, open);
  click(win, [...confirmBox.querySelectorAll('button')].find((b) => text(b) === 'Confirmer la réinitialisation'));
  await settle(win);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'DELETE');
  assert.match(writes[0].url, /\/annulation$/);
  await waitFor(win, '.stat-tile');
  assert.match(text(doc.querySelector('#toast')), /Barème réinitialisé/);
});

test('without a stored override the reset is not offered', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-form');
  const open = [...doc.querySelectorAll('button')].find((b) => text(b) === 'Revenir aux valeurs par défaut');
  assert.equal(open, undefined, 'no reset without a stored barème');
});

test('an analyst sees the barème read-only: banner, no form, no write controls', async () => {
  const { win, doc } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  await waitFor(win, '.bareme-card');

  assert.match(text(doc.querySelector('.tpl-readonly-note')), /Lecture seule/);
  assert.ok(doc.querySelector('.ptable'), 'the analyst still reads the tiers');
  assert.equal(doc.querySelector('.bareme-form'), null, 'no edit form for the analyst');
  const labels = [...doc.querySelectorAll('button')].map(text);
  assert.ok(!labels.includes('Enregistrer le barème'), 'no save control');
  assert.ok(!labels.includes('Revenir aux valeurs par défaut'), 'no reset control');
});

test('a failed barème fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/annulation') && method === 'GET') {
      return fail ? [500, null] : [200, sampleAnnulation()];
    }
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/annulation';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.bareme-card');
  assert.ok(!doc.querySelector('.error-banner'), 'the banner clears after a successful retry');
});
