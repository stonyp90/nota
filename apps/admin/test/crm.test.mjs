import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const OPEN = [];
after(() => OPEN.forEach((win) => win.close()));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(win, selector) {
  for (let i = 0; i < 300; i += 1) {
    const node = win.document.querySelector(selector);
    if (node) return node;
    await wait(5);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

test('CRM admin view renders exact persisted conversion counters and the lead editor', async () => {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', 'fr');
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.fetch = (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET' });
        const path = String(url);
        let body = {};
        if (path.includes('/auth/verify')) body = { ok: true, session: 's', expiresAt: new Date(Date.now() + 3600000).toISOString(), role: 'super_admin' };
        else if (path.endsWith('/me')) body = { email: 'ops@nota.ca', role: 'super_admin', permissions: ['*'] };
        else if (path.includes('/crm/leads')) body = {
          leads: [{ bidId: 'lead-1', serviceId: 'refinancement', serviceNom: 'Refinancement hypothécaire', serviceNomEn: 'Mortgage refinancing', dateISO: '2026-08-20', bidStatus: 'ouverte', stage: 'nouveau', stageNom: 'Nouveau', stageNomEn: 'New', stageSource: 'derived', nom: 'Marie Exemple', hasEmail: true, hasTelephone: false, courriel: 'marie@example.com', telephone: null, acquisition: { last: { source: 'google' } }, readiness: { ready: true }, revision: 0, nextFollowUpAt: null }],
          stages: [{ id: 'nouveau', nom: 'Nouveau', nomEn: 'New' }],
          summary: { total: 1, contactables: 1, ready: 1, retained: 0, completed: 0, overdueFollowUps: 0, bySource: [{ source: 'google', total: 1, retained: 0, completed: 0 }] },
          range: { from: '2026-07-22', to: '2026-12-08', field: 'dateISO', months: 6 },
          dataQuality: { exact: true, source: 'persisted_bids_and_act_ledger', ga4: 'supplementary_only', completionAvailable: true },
        };
        else if (path.includes('/metrics/overview')) body = { kpis: {}, gauge: {}, series: {}, entonnoir: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      };
    },
  });
  OPEN.push(dom.window);
  dom.window.eval(I18N_SRC);
  dom.window.eval(ADMIN_SRC);
  await waitFor(dom.window, '.admin-rail');
  dom.window.location.hash = '#/crm';
  await waitFor(dom.window, '.crm-trust');
  assert.match(dom.window.document.querySelector('.crm-trust').textContent, /Source de vérité/);
  assert.equal(dom.window.document.querySelector('.crm-table tbody tr').dataset.bidId, 'lead-1');
  assert.match(dom.window.document.querySelector('.crm-leads-card').textContent, /Marie Exemple/);
  assert.match(dom.window.document.querySelector('.crm-source-sub').textContent, /conversion/);
  assert.ok(calls.some((call) => call.url.includes('/crm/leads')));
});
