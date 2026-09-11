import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { adminIdForEmail } = require('../src/admin-auth.js');

const NOW = '2026-08-14T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function make(seed) {
  const repo = createMemoryRepo(seed);
  const admin = createAdmin({
    repo,
    newId: (() => { let n = 0; return () => `crm-${++n}`; })(),
    nowMs: () => NOW_MS,
    now: () => NOW,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, { admin, now: () => NOW.slice(0, 10), nowMs: () => NOW_MS, adminBaseUrl: 'https://admin.nota.ca' });
  const call = (method, path, { body, bearer, query } = {}) => app.handle({
    method, path, query: query || {},
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { repo, call };
}

async function login(h) {
  const request = JSON.parse((await h.call('POST', '/admin/auth/request', { body: { email: 'ops@nota.ca' } })).body);
  const token = decodeURIComponent(request.devLink.split('token=')[1]);
  return JSON.parse((await h.call('POST', '/admin/auth/verify', { body: { token } })).body).session;
}

function bid(id, overrides = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: '2026-08-20',
    createdAt: '2026-08-10T12:00:00.000Z',
    status: 'ouverte',
    nom: 'Marie Exemple',
    courriel: 'marie@example.com',
    telephone: '5145551212',
    dossier: {},
    pricing: {},
    acquisition: { version: 1, first: { source: 'google' }, last: { source: 'google' } },
    ...overrides,
  };
}

test('CRM summary is joined from persisted bids and completed acts, with an exact range', async () => {
  const h = make([
    bid('lead-1'),
    bid('lead-2', { id: 'lead-2', courriel: 'second@example.com', status: 'retenue', retainedAt: '2026-08-11T12:00:00.000Z', acquisition: { version: 1, first: { source: 'facebook' }, last: { source: 'facebook' } } }),
  ]);
  await h.repo.markActCompleted('lead-2', { completedAt: '2026-08-12T12:00:00.000Z' });
  await h.repo.putEmailConsent('marie@example.com', { base: true, at: NOW, source: 'form' });
  const session = await login(h);
  const response = await h.call('GET', '/admin/crm/leads', { bearer: session, query: { from: '2026-08-01', to: '2026-08-31', limit: '10' } });
  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.deepEqual(data.range, { from: '2026-08-01', to: '2026-08-31', field: 'dateISO', months: 1 });
  assert.equal(data.summary.total, 2);
  assert.equal(data.summary.retained, 1);
  assert.equal(data.summary.completed, 1);
  assert.equal(data.summary.consented, 1);
  assert.equal(data.dataQuality.exact, true);
  assert.equal(data.dataQuality.ga4, 'supplementary_only');
  assert.equal(data.leads.find((row) => row.bidId === 'lead-1').courriel, 'marie@example.com');
});

test('CRM workflow updates are revision-checked and do not alter the customer bid', async () => {
  const h = make([bid('lead-3')]);
  const session = await login(h);
  const first = await h.call('GET', '/admin/crm/leads', { bearer: session, query: { from: '2026-08-01', to: '2026-08-31' } });
  const row = JSON.parse(first.body).leads[0];
  const update = await h.call('PUT', '/admin/crm/leads/lead-3', {
    bearer: session,
    body: { dateISO: '2026-08-20', stage: 'contacte', note: 'Rappeler demain', nextFollowUpAt: '2026-08-21', revision: row.revision },
  });
  assert.equal(update.statusCode, 200);
  const saved = JSON.parse(update.body).lead;
  assert.equal(saved.revision, 1);
  assert.equal(saved.stage, 'contacte');
  assert.equal((await h.repo.get('lead-3', '2026-08-20')).status, 'ouverte');
  const conflict = await h.call('PUT', '/admin/crm/leads/lead-3', {
    bearer: session,
    body: { dateISO: '2026-08-20', stage: 'perdu', revision: 0 },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(JSON.parse(conflict.body).errors[0].code, 'crm_conflit');
});

test('CRM permission is separate from analytics and PII', async () => {
  const h = make([bid('lead-4')]);
  await h.repo.putAdmin({ id: adminIdForEmail('ops@nota.ca'), email: 'ops@nota.ca', role: null, permissions: ['analytics:read'], disabled: false });
  const session = await login(h);
  const response = await h.call('GET', '/admin/crm/leads', { bearer: session });
  assert.equal(response.statusCode, 403);
});

test('CRM rejects an impossible implicit end date instead of silently changing the requested window', async () => {
  const h = make([bid('lead-range')]);
  const session = await login(h);
  const response = await h.call('GET', '/admin/crm/leads', {
    bearer: session,
    query: { from: '2026-08-15' },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(JSON.parse(response.body).errors[0].code, 'periode_invalide');
});

test('CRM keeps PII and private notes masked when the operator lacks pii:read', async () => {
  const h = make([bid('lead-5')]);
  await h.repo.putAdmin({ id: adminIdForEmail('ops@nota.ca'), email: 'ops@nota.ca', role: null, permissions: ['leads:read', 'leads:write'], disabled: false });
  const session = await login(h);
  const listed = JSON.parse((await h.call('GET', '/admin/crm/leads', { bearer: session, query: { from: '2026-08-01', to: '2026-08-31' } })).body).leads[0];
  assert.equal(listed.courriel, '••••@••••');
  const updated = await h.call('PUT', '/admin/crm/leads/lead-5', { bearer: session, body: { dateISO: '2026-08-20', stage: 'contacte', note: 'ne doit pas sortir', revision: listed.revision } });
  assert.equal(JSON.parse(updated.body).lead.note, null);
});
