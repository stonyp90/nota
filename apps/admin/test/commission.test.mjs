/**
 * Headless DOM tests for the « Commission » section (the rating-earned
 * commission barème Nota decides, ADR 0021 §4). Same harness as
 * smoke.test.mjs / courriels.test.mjs: boot index.html in jsdom, eval
 * admin.js, stub fetch as the admin API, assert on the rendered DOM. Covers:
 * the rail entry + route, the read view (percent display, decimal-comma
 * notes, defaults-vs-override source line), the edit form (percent → fraction
 * conversion on PUT, tier add/remove, API 422 surfaced inline), the in-page
 * confirmed DELETE reset, and the analyst read-only view.
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

// The GET /commission payload — defaults ruling, or a stored override ruling.
function sampleCommission(opts = {}) {
  const defaut = {
    taux: 0.10, plancher: 0.05,
    paliers: [
      { note: 4.5, avis: 10, bonus: 0.01 },
      { note: 4.8, avis: 25, bonus: 0.02 },
    ],
  };
  if (opts.override) {
    const override = {
      taux: 0.12, plancher: 0.06,
      paliers: [{ note: 4.5, avis: 10, bonus: 0.02 }],
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

test('the read view shows the barème in force as percentages, notes with a decimal comma', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  await waitFor(win, '.bareme-card');

  const tiles = [...doc.querySelectorAll('.stat-tile')].map((t) => ({
    k: text(t.querySelector('.stat-k')), v: text(t.querySelector('.stat-v')),
  }));
  const byKey = (k) => (tiles.find((t) => t.k === k) || {}).v;
  assert.equal(byKey('Taux de base'), '10 %', 'the 0.10 fraction displays as « 10 % »');
  assert.equal(byKey('Plancher'), '5 %');
  assert.equal(byKey('Paliers'), '2');

  const rows = [...doc.querySelectorAll('.ptable tbody tr')];
  assert.equal(rows.length, 2, 'both tiers render');
  const cells = (r) => [...r.querySelectorAll('td')].map(text);
  assert.deepEqual(cells(rows[0]), ['4,5', '10', '− 1 %', '9 %'], 'note with decimal comma; the resulting rate is derived');
  assert.deepEqual(cells(rows[1]), ['4,8', '25', '− 2 %', '8 %']);

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
  assert.equal(tauxIn.value, '10', 'taux seeded as percent, not fraction');
  assert.equal(plancherIn.value, '5');
  tauxIn.value = '12'; // typing « 12 » must travel as 0.12

  submit(win, form);
  await settle(win);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /\/commission$/);
  assert.deepEqual(writes[0].body, {
    taux: 0.12,
    plancher: 0.05,
    paliers: [
      { note: 4.5, avis: 10, bonus: 0.01 },
      { note: 4.8, avis: 25, bonus: 0.02 },
    ],
  });
  await waitFor(win, '.stat-tile'); // the view reloads after a save
  assert.match(text(doc.querySelector('#toast')), /Barème enregistré/);
  assert.ok(calls.filter((c) => c.method === 'GET' && c.url.includes('/commission')).length >= 2, 'the barème is re-fetched after the save');
});

test('tier rows can be added (cap 10) and removed, and travel in the PUT', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) { writes.push({ method, body }); return [200, { ok: true, override: {} }]; },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const rowsBox = form.querySelector('.bareme-rows');
  const addBtn = [...form.querySelectorAll('button')].find((b) => text(b) === 'Ajouter un palier');

  // Remove the second seeded tier, then add a fresh one.
  click(win, rowsBox.children[1].querySelector('.bareme-remove'));
  assert.equal(rowsBox.children.length, 1);
  click(win, addBtn);
  assert.equal(rowsBox.children.length, 2);
  const [noteIn, avisIn, bonusIn] = rowsBox.children[1].querySelectorAll('input');
  noteIn.value = '4,9'; // decimal comma accepted on input
  avisIn.value = '30';
  bonusIn.value = '2,5';

  // The add control caps at 10 rows.
  for (let i = 0; i < 12; i++) click(win, addBtn);
  assert.equal(rowsBox.children.length, 10, 'never more than 10 tiers');
  assert.equal(addBtn.disabled, true, 'the add control disables at the cap');
  while (rowsBox.children.length > 2) click(win, rowsBox.children[2].querySelector('.bareme-remove'));
  assert.equal(addBtn.disabled, false, 'removing rows re-enables add');

  submit(win, form);
  await settle(win);
  assert.deepEqual(writes[0].body.paliers, [
    { note: 4.5, avis: 10, bonus: 0.01 },
    { note: 4.9, avis: 30, bonus: 0.025 },
  ]);
});

test('a 422 from the API surfaces every message inline without reloading', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, body });
      return [422, { errors: [
        { code: 'taux_invalide', message: 'Le taux doit être une fraction entre 0 et 1 exclus.' },
        { code: 'plancher_invalide', message: 'Le plancher ne peut pas dépasser le taux.' },
      ] }];
    },
  });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
  const form = await waitFor(win, '.bareme-form');
  const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/commission')).length;

  submit(win, form);
  await settle(win);
  const err = form.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /Le taux doit être une fraction/);
  assert.match(text(err), /Le plancher ne peut pas dépasser le taux/);
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

test('an analyst sees the barème read-only: banner, no form, no write controls', async () => {
  const { win, doc } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/commission';
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
