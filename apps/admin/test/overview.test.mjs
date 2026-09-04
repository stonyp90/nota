/**
 * L'Aperçu après l'audit console admin (2026-09-03) :
 *   • P1-21 : « Commission perçue » est mort avec l'ADR 0031 — la tuile dit
 *             « Facturé par Nota » ;
 *   • P1-22 : l'argent des annulations est le DÉDOMMAGEMENT des notaires
 *             (ADR 0033), jamais un revenu de Nota — deux tuiles, versés et dus —
 *             et la créance de Nota (ADR 0029) a la sienne ;
 *   • P2-32 : la jauge `retained` servie mais jamais montrée a sa tuile ;
 *   • P0-10 : un 403 sur l'aperçu se lit comme une porte fermée, pas une panne.
 * Même harnais que smoke.test.mjs.
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
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* déjà fermée */ } } });

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, url: String(url) });
    const [status, json] = handler(method, String(url)) || [404, null];
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  };
}

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
  throw new Error('délai dépassé : ' + sel);
}
async function settle(win) { for (let i = 0; i < 4; i++) await wait(5); }
const text = (n) => (n ? n.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();

function sampleOverview() {
  return {
    kpis: { offersPosted: 120, offersRetained: 48, actsCompleted: 31, commissionCents: 1234567, retentionRate: 0.4 },
    gauge: { open: 12, retained: 7, activeNotaries: 9, onboardingNotaries: 3 },
    series: { offersPerDay: [{ date: '2026-08-01', count: 3 }], byService: [{ serviceId: 'refinancement', nom: 'Refinancement', offers: 60, retained: 25 }] },
    annulations: { nombre: 3, versesCents: 84000, dusCents: 20000 },
    creances: { commissionCentsDue: 65000, dedommagementCentsDue: 20000 },
  };
}

function api(opts = {}) {
  return (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: opts.permissions || ['*'] }];
    if (url.includes('/metrics/overview')) return opts.overview ? opts.overview() : [200, sampleOverview()];
    return [404, null];
  };
}

const tilesOf = (doc) => {
  const out = {};
  doc.querySelectorAll('.stat-tile').forEach((t) => {
    out[text(t.querySelector('.stat-k'))] = { v: text(t.querySelector('.stat-v')), sub: text(t.querySelector('.stat-sub')) };
  });
  return out;
};

test('la tuile de revenu dit « Facturé par Nota » — plus jamais « Commission perçue »', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.stat-tile');
  const tiles = tilesOf(doc);
  assert.equal(tiles['Facturé par Nota'].v, '12 345,67 $');
  assert.equal(tiles['Commission perçue'], undefined);
  assert.doesNotMatch(text(doc.querySelector('.page-sub')), /commission/i, 'l’entête ne parle plus de commissions');
});

test('les dédommagements d’annulation se lisent comme l’argent des notaires, et la créance de Nota a sa tuile', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.stat-tile');
  const tiles = tilesOf(doc);
  assert.equal(tiles['Dédommagements versés aux notaires'].v, '840 $');
  assert.equal(tiles['Dédommagements versés aux notaires'].sub, 'sur la période');
  assert.equal(tiles['Dédommagements dus aux notaires'].v, '200 $');
  assert.equal(tiles['Dédommagements dus aux notaires'].sub, 'en ce moment');
  assert.equal(tiles['Dû à Nota'].v, '650 $');
  assert.equal(tiles['Dû à Nota'].sub, 'actes réglés hors plateforme');
  assert.equal(tiles['Retenues en cours'].v, '7');
});

test('une réponse sans ces sections rend des zéros, jamais une panne', async () => {
  const sans = () => { const o = sampleOverview(); delete o.annulations; delete o.creances; return [200, o]; };
  const { win, doc } = await boot(api({ overview: sans }), '#/auth?token=T');
  await waitFor(win, '.stat-tile');
  const tiles = tilesOf(doc);
  assert.equal(tiles['Dédommagements versés aux notaires'].v, '0 $');
  assert.equal(tiles['Dû à Nota'].v, '0 $');
});

test('un 403 sur l’aperçu se lit comme une porte fermée, sans bannière technique', async () => {
  const { win, doc } = await boot(api({ overview: () => [403, { errors: [{ code: 'interdit', message: 'Lecture des tableaux de bord non autorisée.' }] }] }), '#/auth?token=T');
  await waitFor(win, '.admin-denied');
  assert.equal(doc.querySelector('.error-banner'), null);
  assert.match(text(doc.querySelector('.admin-denied')), /Lire les tableaux de bord/);
});

test('en anglais, les nouvelles tuiles parlent anglais et l’argent est reformaté', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.stat-tile');
  await settle(win);
  const tiles = tilesOf(doc);
  assert.equal(tiles['Billed by Nota'].v, '$12,345.67');
  assert.equal(tiles['Compensation paid to notaries'].v, '$840');
  assert.equal(tiles['Compensation owed to notaries'].v, '$200');
  assert.equal(tiles['Owed to Nota'].v, '$650');
  assert.equal(tiles['Owed to Nota'].sub, 'acts settled off-platform');
  assert.equal(tiles['Retained right now'].v, '7');
});
