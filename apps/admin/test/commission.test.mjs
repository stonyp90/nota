/**
 * Headless DOM tests for the « Commission » section — le barème du partage que
 * Nota décide (ADR 0021 §4, réécrit par l'ADR 0028 : la cote sur 100 est le
 * SEUL levier). Same harness as smoke.test.mjs / courriels.test.mjs: boot
 * index.html in jsdom, eval admin.js, stub fetch as the admin API, assert on
 * the rendered DOM. Covers: the rail entry + route, the read view (cote tiers,
 * the share the NOTARY keeps, defaults-vs-override source line), the barème
 * simulator, the edit form (percent → fraction conversion on PUT, tier
 * add/remove, the client-side refusal of an obvious error, an API 422 surfaced
 * inline), the in-page confirmed DELETE reset, and the analyst read-only view.
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
// Typing into a field: the value plus the input event the live readouts listen to.
const type = (win, input, value) => {
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
};

// The GET /commission payload — defaults ruling, or a stored override ruling.
// The defaults are the shipped ADR 0028 scale: 15 % au départ, 5 % au sommet.
function sampleCommission(opts = {}) {
  const defaut = {
    taux: 0.15, plancher: 0.05,
    paliers: [
      { cote: 60, taux: 0.12 },
      { cote: 70, taux: 0.10 },
      { cote: 80, taux: 0.08 },
      { cote: 90, taux: 0.05 },
    ],
  };
  if (opts.override) {
    const override = {
      taux: 0.12, plancher: 0.06,
      paliers: [{ cote: 65, taux: 0.09 }],
      updatedAt: '2026-08-27T12:00:00.000Z',
    };
    return { defaut, override, effectif: { taux: override.taux, plancher: override.plancher, paliers: override.paliers } };
  }
  return { defaut, override: null, effectif: defaut };
}

// The authed API: super_admin by default, or an analyst without settings:write.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { commission: opts.commission || sampleCommission(), onWrite: opts.onWrite || null };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/commission')) {
      if (method === 'GET') return [200, state.commission];
      if (state.onWrite) return state.onWrite(method, url, body);
      return [200, method === 'PUT' ? { ok: true, override: {} } : { ok: true }];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an enabled Commission entry that routes to the barème view', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const links = [...doc.querySelectorAll('.admin-rail-link')];
  const entry = links.find((b) => text(b).includes('Commission'));
  assert.ok(entry, 'rail entry « Commission » is missing');
  assert.equal(entry.disabled, false, 'the entry must be enabled (not a « Bientôt » placeholder)');
  const courriels = links.find((b) => text(b).includes('Courriels'));
  const firstDisabled = links.find((b) => b.disabled);
  assert.ok(links.indexOf(entry) > links.indexOf(courriels), 'Commission sits after Courriels');
  assert.ok(links.indexOf(entry) < links.indexOf(firstDisabled), 'Commission sits before the disabled placeholders');

  click(win, entry);
  await waitFor(win, '.bareme-card');
  assert.equal(win.location.hash, '#/commission');
  assert.equal(text(doc.querySelector('.page-title')), 'Commission');
  const active = doc.querySelector('.admin-rail-link[aria-current="page"]');
  assert.ok(text(active).includes('Commission'), 'the rail marks Commission active');
});

test('the read view states each cote tier and the share the NOTARY keeps', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-card');

  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')), s: text(t.querySelector('.stat-sub')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Taux de base'), '15 %', 'the 0.15 fraction displays as « 15 % »');
  assert.equal(byKey('Plancher'), '5 %');
  assert.equal(byKey('Au mieux, le notaire garde'), '95 %', 'the top of the scale is stated, not left to be computed');
  assert.equal(byKey('Paliers'), '4');
  // The old rating vocabulary (note / avis / bonification) is gone everywhere.
  const all = text(doc.querySelector('.admin-content'));
  assert.ok(!/bonification/i.test(all), 'no « bonification » left on the screen');
  assert.ok(!/Avis requis|Note moyenne/.test(all), 'no rating-axis columns left');

  const heads = [...doc.querySelectorAll('.ptable thead th')].map(text);
  assert.deepEqual(heads, ['Cote atteinte', 'Part de Nota', 'Le notaire garde']);
  const rows = [...doc.querySelectorAll('.ptable tbody tr')];
  assert.equal(rows.length, 4, 'every tier renders');
  const cells = (r) => [...r.querySelectorAll('td')].map(text);
  assert.deepEqual(cells(rows[0]), ['60', '12 %', '88 %']);
  assert.deepEqual(cells(rows[3]), ['90', '5 %', '95 %']);

  // No override stored — the source line quietly says the defaults rule.
  assert.match(text(doc.querySelector('.chart-card-sub')), /Valeurs par défaut du déploiement/);
});

test('a stored override shows its updatedAt in the source line', async () => {
  const { win, doc } = await boot(api({ commission: sampleCommission({ override: true }) }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-card');
  const sub = [...doc.querySelectorAll('.chart-card-sub')].map(text).join(' ');
  assert.match(sub, /Barème décidé par Nota — modifié le 2026-08-27 12:00\./);
});

test('the simulator prices a typed cote exactly as the server would', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-sim');

  const input = doc.querySelector('.bareme-sim-input');
  const nota = () => text(doc.querySelector('.bareme-sim-nota'));
  const notaire = () => text(doc.querySelector('.bareme-sim-notaire'));

  type(win, input, '0'); // no tier reached — the base rate rules
  assert.equal(nota(), '15 %');
  assert.equal(notaire(), '85 %');
  assert.match(text(doc.querySelector('.bareme-sim-note')), /Aucun palier atteint/);

  type(win, input, '75'); // 70 reached, 80 not
  assert.equal(nota(), '10 %');
  assert.equal(notaire(), '90 %');
  assert.match(text(doc.querySelector('.bareme-sim-note')), /Palier atteint/);
  assert.match(text(doc.querySelector('.bareme-sim-note')), /70/);

  type(win, input, '93'); // the summit
  assert.equal(nota(), '5 %');
  assert.equal(notaire(), '95 %');

  type(win, input, '200'); // out of range — nothing invented
  assert.equal(nota(), '—');
  assert.equal(notaire(), '—');
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
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');

  // The form is seeded from the barème in force, in percent.
  const [tauxIn, plancherIn] = form.querySelectorAll('.tpl-fields input');
  assert.equal(tauxIn.value, '15', 'taux seeded as percent, not fraction');
  assert.equal(plancherIn.value, '5');
  type(win, tauxIn, '12'); // typing « 12 » must travel as 0.12

  submit(win, form);
  await settle(win);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /\/commission$/);
  assert.deepEqual(writes[0].body, {
    taux: 0.12,
    plancher: 0.05,
    paliers: [
      { cote: 60, taux: 0.12 },
      { cote: 70, taux: 0.10 },
      { cote: 80, taux: 0.08 },
      { cote: 90, taux: 0.05 },
    ],
  });
  await waitFor(win, '.stat-tile'); // the view reloads after a save
  assert.match(text(doc.querySelector('#toast')), /Barème enregistré/);
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url.includes('/commission')).length >= 2, 'the barème is re-fetched after the save');
});

test('each tier row shows, live, the share the notary would keep', async () => {
  const { win } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const rows = form.querySelectorAll('.bareme-rows .bareme-palier');

  assert.equal(text(rows[0].querySelector('.bareme-part-v')), '88 %', 'seeded from the stored rate');
  const tauxIn = rows[0].querySelectorAll('input')[1];
  type(win, tauxIn, '7');
  assert.equal(text(rows[0].querySelector('.bareme-part-v')), '93 %', 'the negotiated half follows the typing');
  type(win, tauxIn, '');
  assert.equal(text(rows[0].querySelector('.bareme-part-v')), '—', 'an empty rate invents nothing');
});

test('tier rows can be added (cap 10) and removed, and travel in the PUT', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) { writes.push({ method, body }); return [200, { ok: true, override: {} }]; },
  });
  const { win } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const rowsBox = form.querySelector('.bareme-rows');
  const addBtn = [...form.querySelectorAll('button')].find((b) => text(b) === 'Ajouter un palier');

  // Remove the second seeded tier (cote 70), then add a fresh summit.
  click(win, rowsBox.children[1].querySelector('.bareme-remove'));
  assert.equal(rowsBox.children.length, 3);
  click(win, addBtn);
  assert.equal(rowsBox.children.length, 4);
  const [coteIn, tauxIn] = rowsBox.children[3].querySelectorAll('input');
  type(win, coteIn, '95');
  type(win, tauxIn, '5');

  // The add control caps at 10 rows.
  for (let i = 0; i < 12; i++) click(win, addBtn);
  assert.equal(rowsBox.children.length, 10, 'never more than 10 tiers');
  assert.equal(addBtn.disabled, true, 'the add control disables at the cap');
  while (rowsBox.children.length > 4) click(win, rowsBox.children[4].querySelector('.bareme-remove'));
  assert.equal(addBtn.disabled, false, 'removing rows re-enables add');

  submit(win, form);
  await settle(win);
  assert.deepEqual(writes[0].body.paliers, [
    { cote: 60, taux: 0.12 },
    { cote: 80, taux: 0.08 },
    { cote: 90, taux: 0.05 },
    { cote: 95, taux: 0.05 },
  ]);
});

test('an obvious error never reaches the API: the screen refuses it inline', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) { writes.push({ method, body }); return [200, { ok: true, override: {} }]; },
  });
  const { win } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const rowsBox = form.querySelector('.bareme-rows');
  const error = form.querySelector('.tpl-error');
  const rowInputs = (i) => rowsBox.children[i].querySelectorAll('input');

  // (a) a fractional cote — the cote is a whole number out of 100.
  type(win, rowInputs(0)[0], '60,5');
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0, 'nothing is sent');
  assert.equal(error.hidden, false);
  assert.match(text(error), /Palier 1 : il faut une cote entière de 1 à 100/);

  // (b) the same cote twice.
  type(win, rowInputs(0)[0], '70');
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0);
  assert.match(text(error), /Deux paliers ne peuvent pas viser la même cote \(70\)/);

  // (c) a rate that climbs back up as the cote climbs.
  type(win, rowInputs(0)[0], '60');
  type(win, rowInputs(1)[1], '14'); // cote 70 costing MORE than cote 60
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0);
  assert.match(text(error), /Une cote plus haute ne peut jamais coûter plus cher au notaire/);

  // (d) a tier rate above the base rate.
  type(win, rowInputs(1)[1], '10');
  type(win, form.querySelectorAll('.tpl-fields input')[0], '9'); // base 9 % < the 12 % tier
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 0);
  assert.match(text(error), /Palier 1 :/);

  // Back to a coherent barème: the PUT goes out and the error clears.
  type(win, form.querySelectorAll('.tpl-fields input')[0], '15');
  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 1, 'a valid barème still travels');
  assert.equal(error.hidden, true, 'the inline error clears once the barème holds');
});

test('a 422 from the API surfaces every message inline without reloading', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, body });
      return [422, { errors: [
        { code: 'taux_invalide', message: 'Le taux de base doit être un nombre entre 0 et 1 (ex. 0,15 pour 15 %).' },
        { code: 'plancher_invalide', message: 'Le plancher doit être un nombre entre 0 et le taux de base.' },
      ] }];
    },
  });
  const { win, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/commission')).length;

  submit(win, form);
  await settle(win);
  assert.equal(writes.length, 1, 'a coherent barème reaches the API — the server stays the authority');
  const err = form.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /Le taux de base doit être un nombre/);
  assert.match(text(err), /Le plancher ne peut pas dépasser le taux|Le plancher doit être un nombre/);
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url.includes('/commission')).length, gets, 'no reload on a validation failure');
});

test('Revenir aux valeurs par défaut asks an in-page confirmation, then DELETEs', async () => {
  const writes = [];
  const handler = api({
    commission: sampleCommission({ override: true }),
    onWrite(method, url, body) { writes.push({ method, url, body }); return [200, { ok: true }]; },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
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
  assert.match(writes[0].url, /\/commission$/);
  await waitFor(win, '.stat-tile');
  assert.match(text(doc.querySelector('#toast')), /Barème réinitialisé/);
});

test('without a stored override the reset is not offered', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-form');
  const open = [...doc.querySelectorAll('button')].find((b) => text(b) === 'Revenir aux valeurs par défaut');
  assert.equal(open, undefined, 'no reset without a stored barème');
});

test('an analyst sees the barème read-only — table and simulator, no form', async () => {
  const { win, doc } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-card');

  assert.match(text(doc.querySelector('.tpl-readonly-note')), /Lecture seule/);
  assert.ok(doc.querySelector('.ptable'), 'the analyst still reads the tiers');
  assert.ok(doc.querySelector('.bareme-sim'), 'the simulator is a reading, not a write — the analyst keeps it');
  assert.equal(doc.querySelector('.bareme-form'), null, 'no edit form for the analyst');
  const labels = [...doc.querySelectorAll('button')].map(text);
  assert.ok(!labels.includes('Enregistrer le barème'), 'no save control');
  assert.ok(!labels.includes('Revenir aux valeurs par défaut'), 'no reset control');
});

test('the whole cote vocabulary crosses into English — screen, simulator, refusals', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-sim');
  await settle(win);

  const page = text(doc.querySelector('.admin-content'));
  const heads = [...doc.querySelectorAll('.ptable thead th')].map(text);
  assert.deepEqual(heads, ['Cote reached', 'Nota’s share', 'The notary keeps'],
    'the tier columns are translated, not left French');
  assert.match(page, /Schedule decided by Nota — the notary’s cote out of 100 decides the split\./);
  assert.match(page, /Simulator/);
  assert.match(page, /Tier reached: cote/);
  assert.match(page, /Below the first tier the base rate applies — the notary keeps/);
  assert.match(page, /Cote tiers/, 'the edit form label follows');

  // A client-side refusal speaks English too — it is OUR string now, not the API's.
  const form = doc.querySelector('.bareme-form');
  const row = form.querySelector('.bareme-rows .bareme-palier');
  type(win, row.querySelectorAll('input')[0], '60,5');
  submit(win, form);
  await settle(win);
  assert.match(text(form.querySelector('.tpl-error')),
    /Tier 1: a whole cote from 1 to 100 and a rate between the floor and the base rate are required\./);
});

test('a failed barème fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/commission') && method === 'GET') {
      return fail ? [500, null] : [200, sampleCommission()];
    }
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.bareme-card');
  assert.ok(!doc.querySelector('.error-banner'), 'the banner clears after a successful retry');
});
