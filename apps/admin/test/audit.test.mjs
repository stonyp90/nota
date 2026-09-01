/**
 * Headless DOM tests for the « Audit » section — le journal append-only, pièce
 * SOC 2. Même harnais que notaires.test.mjs. Couvre : le sélecteur de jour (qui
 * part sur aujourd'hui), la ligne d'argent lisible sans JSON pour un acte
 * réglé, le changement de jour, le 422 d'une date illisible, la porte fermée à
 * l'analyste, le jour vide, et la traversée en anglais.
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
  if (lang) win.eval(I18N_SRC);
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
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const today = () => new Date().toISOString().slice(0, 10);

// Une journée : un acte réglé (la pièce financière) et un geste d'admin.
function sampleDay(jour) {
  return {
    jour: jour,
    entrees: [
      { id: 'a2', ts: jour + 'T18:11:03.000Z', day: jour, action: 'commission_schedule_updated',
        adminId: 'ad1', email: 'ops@nota.ca', ip: '24.201.10.4',
        meta: { before: { taux: 0.15 }, after: { taux: 0.14 } } },
      { id: 'a1', ts: jour + 'T14:02:00.000Z', day: jour, action: 'acte_regle',
        adminId: null, email: null, ip: null,
        meta: { bidId: 'b1', dateISO: '2026-08-20', notaryId: 'n1', serviceId: 'refinancement',
                montant: 2800, taux: 0.15, cote: 51, commission: 420, net: 2380,
                chargeId: 'ch_1', transferId: 'tr_1' } },
    ],
  };
}

function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { days: opts.days || null, status: opts.status || 200, error: opts.error || null };
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/audit')) {
      if (state.status !== 200) return [state.status, state.error];
      var jour = (/[?&]jour=([^&]*)/.exec(url) || [])[1] || '';
      if (state.days) return [200, state.days[jour] || { jour: jour, entrees: [] }];
      return [200, sampleDay(jour)];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an Audit entry; the journal opens on today', async () => {
  const { win, doc, calls } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b) .includes('Audit'));
  assert.ok(entry, 'rail entry « Audit » is missing');
  assert.equal(entry.disabled, false);

  click(win, entry);
  await waitFor(win, '.audit-entry');
  assert.equal(win.location.hash, '#/audit');
  assert.equal(text(doc.querySelector('.page-title')), 'Audit');

  const day = doc.querySelector('.audit-day');
  assert.ok(day, 'the day picker is there');
  assert.equal(day.type, 'date');
  assert.equal(day.value, today(), 'it starts on today');
  const asked = calls.filter((c) => c.url.includes('/audit'));
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, new RegExp('/audit\\?jour=' + today() + '$'));
});

test('a settled act reads as a sentence, newest first, without ever showing JSON', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  const entries = [...doc.querySelectorAll('.audit-entry')];
  assert.equal(entries.length, 2, 'both entries render, in the order served (newest first)');
  assert.match(text(entries[0].querySelector('.audit-action')), /Barème de commission modifié/,
    'a known action reads in French, never as its raw code');
  assert.match(text(entries[0]), /ops@nota\.ca/);
  assert.match(text(entries[0]), /24\.201\.10\.4/);
  assert.match(text(entries[0].querySelector('.audit-ts')), /18:11/);

  const acte = entries[1];
  assert.match(text(acte.querySelector('.audit-action')), /Acte réglé/);
  assert.equal(
    text(acte.querySelector('.audit-money')),
    '2 800 $ payés · 15 % · 420 $ à Nota · 2 380 $ au notaire · cote 51',
    'the money line is the disclosure — it must read on its own');
  // Les identifiants restent lisibles à côté, sans noyer la phrase.
  const facts = text(acte.querySelector('.audit-facts'));
  assert.match(facts, /refinancement/);
  assert.match(facts, /2026-08-20/);
  assert.match(facts, /b1/);
  assert.ok(!/\{|\}/.test(text(acte.querySelector('.audit-money'))), 'no JSON in the sentence');
});

test('picking another day refetches that day and nothing else', async () => {
  const days = {
    '2026-08-30': sampleDay('2026-08-30'),
    '2026-08-29': { jour: '2026-08-29', entrees: [] },
  };
  const { win, doc, calls } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-day');

  change(win, doc.querySelector('.audit-day'), '2026-08-30');
  await waitFor(win, '.audit-entry');
  const urls = calls.filter((c) => c.url.includes('/audit')).map((c) => c.url);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /jour=2026-08-30$/);
  assert.equal(doc.querySelectorAll('.audit-entry').length, 2);

  change(win, doc.querySelector('.audit-day'), '2026-08-29');
  await waitFor(win, '.empty-state');
  assert.equal(doc.querySelectorAll('.audit-entry').length, 0, 'an empty day says so instead of keeping the old one');
});

test('an unreadable date is answered by the API message, inline', async () => {
  const handler = api({ status: 422, error: { errors: [{ code: 'jour_invalide', message: 'Le jour doit être une date ISO (AAAA-MM-JJ).' }] } });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  const err = await waitFor(win, '.tpl-error');
  assert.match(text(err), /Le jour doit être une date ISO/);
  assert.equal(doc.querySelector('.error-banner'), null, 'a validation answer is not a technical failure');
  assert.ok(doc.querySelector('.audit-day'), 'the picker survives, so the operator can correct the day');
  assert.equal(calls.filter((c) => c.url.includes('/audit')).length, 1);
});

test('an analyst never reaches the journal: rail entry reserved, route closed, no request', async () => {
  const { win, doc, calls } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Audit'));
  assert.equal(entry.disabled, true);
  assert.match(text(entry), /Réservé/);

  win.location.hash = '#/audit';
  await waitFor(win, '.admin-denied');
  assert.equal(doc.querySelector('.audit-entry'), null);
  assert.equal(calls.filter((c) => c.url.includes('/audit')).length, 0);
});

test('a failed journal fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/audit')) return fail ? [500, null] : [200, sampleDay(today())];
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.audit-entry');
  assert.ok(!doc.querySelector('.error-banner'));
});

test('the money line crosses into English with the money reformatted', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  await settle(win);

  const money = [...doc.querySelectorAll('.audit-money')][0];
  assert.equal(text(money), '$2,800 paid · 15% · $420 to Nota · $2,380 to the notary · cote 51');
  assert.match(text(doc.querySelector('.audit-action')), /Commission schedule updated/);
});
