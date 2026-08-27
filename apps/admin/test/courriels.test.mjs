/**
 * Headless DOM tests for the « Courriels » section (admin-editable email
 * templates, ADR 0018). Same harness as smoke.test.mjs: boot index.html in
 * jsdom, eval admin.js, stub fetch as the admin API, assert on the rendered
 * DOM. Covers: the rail entry + route, the grouped template list with the
 * override badges, the inline editor (PUT on save, DELETE on reset, API
 * validation errors surfaced inline), and the analyst read-only view.
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

// A small but audience-spanning template payload.
function sampleTemplates() {
  return {
    templates: [
      {
        key: 'offerPublished', audience: 'client',
        labelFr: 'Offre publiée', labelEn: 'Offer posted',
        defaultSubjectFr: 'Votre offre est en ligne : {{montant}}', defaultSubjectEn: 'Your offer is live: {{montant}}',
        placeholders: ['montant', 'service', 'date'], override: null,
      },
      {
        key: 'clientWelcome', audience: 'client',
        labelFr: 'Bienvenue client', labelEn: 'Client welcome',
        defaultSubjectFr: 'Bienvenue sur Nota', defaultSubjectEn: 'Welcome to Nota',
        placeholders: ['email'],
        override: { enabled: true, subjectFr: 'Allo {{email}}', subjectEn: 'Hi {{email}}', updatedAt: '2026-08-27T12:00:00.000Z' },
      },
      {
        key: 'propositionAcceptee', audience: 'notaire',
        labelFr: 'Proposition acceptée', labelEn: 'Proposal accepted',
        defaultSubjectFr: 'Proposition acceptée : {{montant}}', defaultSubjectEn: 'Proposal accepted: {{montant}}',
        placeholders: ['montant', 'service', 'date'],
        override: { enabled: false, subjectFr: null, subjectEn: null, updatedAt: '2026-08-27T12:00:00.000Z' },
      },
      {
        key: 'operatorNewLead', audience: 'operateur',
        labelFr: 'Nouvelle offre publiée', labelEn: 'New offer posted',
        defaultSubjectFr: 'Nouvelle offre : {{montant}}', defaultSubjectEn: 'New offer: {{montant}}',
        placeholders: ['montant', 'service', 'date'], override: null,
      },
    ],
  };
}

// The authed API: super_admin by default, or an analyst without the write permission.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  let templates = opts.templates || sampleTemplates();
  const state = { templates, onWrite: opts.onWrite || null };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/notifications/templates/')) {
      if (state.onWrite) return state.onWrite(method, url, body);
      return [200, method === 'PUT' ? { ok: true, override: {} } : { ok: true, key: url.split('/').pop() }];
    }
    if (url.includes('/notifications/templates')) return [200, state.templates];
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an enabled Courriels entry that routes to the templates view', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Courriels'));
  assert.ok(entry, 'rail entry « Courriels » is missing');
  assert.equal(entry.disabled, false, 'the entry must be enabled (not a « Bientôt » placeholder)');

  click(win, entry);
  await waitFor(win, '.tpl-row');
  assert.equal(win.location.hash, '#/courriels');
  assert.equal(text(doc.querySelector('.page-title')), 'Courriels');
  const active = doc.querySelector('.admin-rail-link[aria-current="page"]');
  assert.ok(text(active).includes('Courriels'), 'the rail marks Courriels active');
});

test('templates render grouped by audience, with default subjects and override badges', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  await waitFor(win, '.tpl-row');

  const groups = [...doc.querySelectorAll('.tpl-group .chart-card-title')].map(text);
  assert.deepEqual(groups, ['Clients', 'Notaires', 'Opérateur'], 'audience groups in canonical order, empty ones omitted');

  const rows = [...doc.querySelectorAll('.tpl-row')];
  assert.equal(rows.length, 4);

  const offerRow = rows.find((r) => text(r.querySelector('.tpl-label')) === 'Offre publiée');
  assert.match(text(offerRow), /Votre offre est en ligne : \{\{montant\}\}/, 'the FR default subject shows');
  assert.match(text(offerRow), /Your offer is live: \{\{montant\}\}/, 'the EN default subject shows');
  assert.equal(offerRow.querySelectorAll('.tpl-badge').length, 0, 'no badge without an override');

  const welcomeRow = rows.find((r) => text(r.querySelector('.tpl-label')) === 'Bienvenue client');
  assert.equal(text(welcomeRow.querySelector('.tpl-badge.is-custom')), 'Modifié');
  assert.match(text(welcomeRow), /Allo \{\{email\}\}/, 'the overridden subject replaces the default in the row');

  const disabledRow = rows.find((r) => text(r.querySelector('.tpl-label')) === 'Proposition acceptée');
  assert.equal(text(disabledRow.querySelector('.tpl-badge.is-off')), 'Désactivé');
});

test('the editor opens with the template vocabulary as chips and PUTs the full override on save', async () => {
  const writes = [];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, url, body });
      return [200, { ok: true, override: { key: 'offerPublished', enabled: true, subjectFr: body.subjectFr, subjectEn: body.subjectEn, updatedAt: futureISO() } }];
    },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  await waitFor(win, '.tpl-row');

  const row = [...doc.querySelectorAll('.tpl-row')].find((r) => text(r.querySelector('.tpl-label')) === 'Offre publiée');
  click(win, row.querySelector('.tpl-edit'));
  const editor = row.querySelector('.tpl-editor');
  assert.ok(editor, 'the editor expands inline');

  const chips = [...editor.querySelectorAll('.tpl-chip')].map(text);
  assert.deepEqual(chips, ['{{montant}}', '{{service}}', '{{date}}'], 'the allowed tokens show as hint chips');

  const [frInput, enInput] = editor.querySelectorAll('input.input');
  assert.equal(frInput.placeholder, 'Votre offre est en ligne : {{montant}}', 'the default subject is the placeholder');
  frInput.value = ' Nouvelle offre {{montant}} ';
  enInput.value = 'New offer {{montant}}';
  const save = [...editor.querySelectorAll('button')].find((b) => text(b) === 'Enregistrer');
  click(win, save);
  await settle(win);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.match(writes[0].url, /\/notifications\/templates\/offerPublished$/);
  assert.deepEqual(writes[0].body, {
    enabled: true,
    subjectFr: 'Nouvelle offre {{montant}}', // trimmed client-side
    subjectEn: 'New offer {{montant}}',
  });
  await waitFor(win, '.tpl-row'); // the list reloads after a save
  assert.match(text(doc.querySelector('#toast')), /Modèle enregistré/);
});

test('Réinitialiser DELETEs the override; a 422 from the API surfaces inline without reloading', async () => {
  const writes = [];
  let reply = [422, { errors: [{ code: 'jeton_inconnu', message: 'subjectFr : le jeton {{code}} n’existe pas pour ce modèle.' }] }];
  const handler = api({
    onWrite(method, url, body) {
      writes.push({ method, url, body });
      return method === 'DELETE' ? [200, { ok: true, key: 'clientWelcome' }] : reply;
    },
  });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  await waitFor(win, '.tpl-row');

  // 422 path: the API message lands in the inline error region.
  const row = [...doc.querySelectorAll('.tpl-row')].find((r) => text(r.querySelector('.tpl-label')) === 'Bienvenue client');
  click(win, row.querySelector('.tpl-edit'));
  const editor = row.querySelector('.tpl-editor');
  const save = [...editor.querySelectorAll('button')].find((b) => text(b) === 'Enregistrer');
  click(win, save);
  await settle(win);
  const err = editor.querySelector('.tpl-error');
  assert.equal(err.hidden, false);
  assert.match(text(err), /jeton \{\{code\}\} n’existe pas/);

  // DELETE path: the overridden row offers Réinitialiser, which DELETEs.
  const reset = [...editor.querySelectorAll('button')].find((b) => text(b) === 'Réinitialiser');
  assert.ok(reset, 'an overridden template offers Réinitialiser');
  click(win, reset);
  await settle(win);
  const del = writes.find((w) => w.method === 'DELETE');
  assert.ok(del, 'a DELETE was sent');
  assert.match(del.url, /\/notifications\/templates\/clientWelcome$/);
  await waitFor(win, '.tpl-row');
  assert.match(text(doc.querySelector('#toast')), /Modèle réinitialisé/);
});

test('a template with no override offers no Réinitialiser', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  await waitFor(win, '.tpl-row');
  const row = [...doc.querySelectorAll('.tpl-row')].find((r) => text(r.querySelector('.tpl-label')) === 'Offre publiée');
  click(win, row.querySelector('.tpl-edit'));
  const buttons = [...row.querySelectorAll('.tpl-editor button')].map(text);
  assert.ok(buttons.includes('Enregistrer'));
  assert.ok(!buttons.includes('Réinitialiser'), 'no reset without a stored override');
});

test('an analyst sees the list read-only: banner, no save controls, disabled inputs', async () => {
  const { win, doc } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  await waitFor(win, '.tpl-row');

  assert.match(text(doc.querySelector('.tpl-readonly-note')), /Lecture seule/);
  const row = [...doc.querySelectorAll('.tpl-row')].find((r) => text(r.querySelector('.tpl-label')) === 'Offre publiée');
  const open = row.querySelector('.tpl-edit');
  assert.equal(text(open), 'Détails', 'the affordance reads Détails, not Modifier');
  click(win, open);
  const editor = row.querySelector('.tpl-editor');
  assert.ok(editor, 'the analyst can still inspect the template');
  assert.equal(editor.querySelectorAll('.tpl-actions button').length, 0, 'no save/reset controls');
  for (const input of editor.querySelectorAll('input')) {
    assert.equal(input.disabled, true, 'inputs are disabled for the analyst');
  }
});

test('a failed template fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/notifications/templates') && !url.includes('/templates/')) {
      return fail ? [500, null] : [200, sampleTemplates()];
    }
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/courriels';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.tpl-row');
  assert.ok(!doc.querySelector('.error-banner'), 'the banner clears after a successful retry');
});
