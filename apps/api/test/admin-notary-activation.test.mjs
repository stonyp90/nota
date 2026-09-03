// POST /admin/notaries/{id}/activer — the operator opens a notary's console
// (2026-09-02). The supply-side door no longer goes through Stripe: a notary
// signs up with their professional email, the operator checks the Tableau de
// l'Ordre and clicks « Activer » here, and only then does the magic link work
// (`approuveLe` is what the public handler's notaryGate reads). Moderation of
// who is on the marketplace: `moderation:write`, audited, idempotent, and
// the notary is told by email where to sign in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const authDefaults = require('../src/admin-auth.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');
const emails = require('../src/emails.js');

const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();
const SITE = 'https://nota.example';
const parse = (res) => JSON.parse(res.body);

function make({ withNotifier = true } = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const sent = [];
  // The admin console mails through the notifier's generic door
  // (`sendCampaign`): the SENT ledger's partition cannot be granted to the
  // admin Lambda, and the activation's own `deja` guard is the idempotency.
  const notifier = withNotifier ? { sendCampaign: async (m) => { sent.push(m); return { sent: true, to: m.to }; } } : undefined;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    notifier,
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', siteUrl: SITE, devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => NOW_ISO.slice(0, 10) }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => NOW_ISO.slice(0, 10),
    nowMs: () => clock.ms,
  });
  const call = (method, path, { bearer, body } = {}) =>
    app.handle({
      method,
      path,
      query: {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call, sent };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.app.handle({ method: 'POST', path: '/admin/auth/request', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ email }) }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.app.handle({ method: 'POST', path: '/admin/auth/verify', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ token }) })).session;
}

async function loginAnalyste(h) {
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false, createdAt: NOW_ISO });
  return login(h, email);
}

const EMAIL = 'me.roy@etude.ca';
const ID = notaryIdForEmail(EMAIL);
async function seedPending(h, over = {}) {
  await h.repo.putNotary({
    id: ID, email: EMAIL, label: EMAIL, role: 'notary', status: 'en_attente',
    inscritLe: '2026-09-02T14:00:00.000Z', lienCNQ: 'https://www.cnq.org/trouver-un-notaire/roy', parrain: null,
    createdAt: '2026-09-02T14:00:00.000Z', ...over,
  });
  await h.repo.applyStatsDeltas([{ pk: 'STATS#GAUGE', sk: 'GAUGE', adds: { onboarding: 1 } }]);
}

test('the door is closed without a session, and to an analyst (moderation:write)', async () => {
  const h = make();
  await seedPending(h);
  assert.equal((await h.call('POST', `/admin/notaries/${ID}/activer`)).statusCode, 401);
  const analyste = await loginAnalyste(h);
  const res = await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: analyste });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal((await h.repo.getNotary(ID)).approuveLe, undefined, 'nothing stamped');
});

test('activation stamps approuveLe, flips en_attente to active, moves the gauge once, audits, and mails the sign-in door', async () => {
  const h = make();
  await seedPending(h);
  const session = await login(h);
  const res = await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.equal(body.deja, false);
  assert.equal(body.notaire.id, ID);
  assert.equal(body.notaire.statut, 'active');
  assert.equal(body.notaire.approuveLe, NOW_ISO);

  const n = await h.repo.getNotary(ID);
  assert.equal(n.approuveLe, NOW_ISO);
  assert.equal(n.status, 'active');
  assert.equal(n.lienCNQ, 'https://www.cnq.org/trouver-un-notaire/roy', 'the rest of the record is untouched');
  assert.equal(n.inscritLe, '2026-09-02T14:00:00.000Z');
  assert.deepEqual({ ...(await h.repo.getGauge()) }, { pk: 'STATS#GAUGE', sk: 'GAUGE', onboarding: 0, active: 1 });

  // The trail: who, whom, from what to what.
  const audit = (await h.repo.queryAuditByDay(NOW_ISO.slice(0, 10))).filter((e) => e.action === 'notary_activated');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].email, 'ops@nota.ca');
  assert.equal(audit[0].ip, '1.2.3.4');
  assert.equal(audit[0].meta.notaryId, ID);
  assert.equal(audit[0].meta.notaryEmail, EMAIL);
  assert.equal(audit[0].meta.statutAvant, 'en_attente');
  assert.equal(audit[0].meta.statutApres, 'active');

  // The notary is told where to sign in — the console, with the professional email.
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, EMAIL);
  assert.equal(h.sent[0].templateKey, 'notaryApproved');
  assert.equal(h.sent[0].ctx.consoleUrl, SITE + '/#notaires');
  const msg = emails.notaryApproved({ ...h.sent[0].ctx, baseUrl: SITE, unsubscribeUrl: SITE + '/api/unsubscribe?token=x' });
  assert.match(msg.text, /Connectez-vous avec votre courriel professionnel/);
  assert.ok(msg.html.includes('href="' + SITE + '/#notaires"'), 'the CTA is the console sign-in URL');
  assert.doesNotMatch(msg.subject, /Stripe/);
});

test('a second click is idempotent: 200 { deja: true }, no second gauge delta, no second mail, no second audit', async () => {
  const h = make();
  await seedPending(h);
  const session = await login(h);
  await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  const gauge = { ...(await h.repo.getGauge()) };
  const again = await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(parse(again).deja, true);
  assert.equal(parse(again).notaire.approuveLe, NOW_ISO, 'the ORIGINAL stamp stands');
  assert.deepEqual({ ...(await h.repo.getGauge()) }, gauge);
  assert.equal(h.sent.length, 1);
  const audit = (await h.repo.queryAuditByDay(NOW_ISO.slice(0, 10))).filter((e) => e.action === 'notary_activated');
  assert.equal(audit.length, 1);
});

test('activating a notary who is mid-Stripe keeps their Stripe status; an unknown id is 404', async () => {
  const h = make();
  await seedPending(h, { status: 'onboarding', connectAccountId: 'acct_x', chargesEnabled: false });
  const session = await login(h);
  const res = await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const n = await h.repo.getNotary(ID);
  assert.equal(n.approuveLe, NOW_ISO, 'the gate opens on approuveLe');
  assert.equal(n.status, 'onboarding', 'Stripe’s own status is not rewritten');
  assert.deepEqual(await h.repo.listActiveNotaries().then((l) => l.map((x) => x.id)), [ID], 'approved = active on the marketplace');

  const missing = await h.call('POST', '/admin/notaries/N000/activer', { bearer: session });
  assert.equal(missing.statusCode, 404);
  assert.equal(parse(missing).errors[0].code, 'notaire_introuvable');
});

test('without a notifier the activation still lands — the mail is best-effort', async () => {
  const h = make({ withNotifier: false });
  await seedPending(h);
  const session = await login(h);
  const res = await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await h.repo.getNotary(ID)).approuveLe, NOW_ISO);
});

test('the register carries what the operator needs to vet: fiche link, signup and approval stamps', async () => {
  const h = make();
  await seedPending(h);
  const session = await login(h);
  let rows = parse(await h.call('GET', '/admin/notaries', { bearer: session })).notaires;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].statut, 'en_attente');
  assert.equal(rows[0].lienCNQ, 'https://www.cnq.org/trouver-un-notaire/roy');
  assert.equal(rows[0].inscritLe, '2026-09-02T14:00:00.000Z');
  assert.equal(rows[0].approuveLe, null);
  await h.call('POST', `/admin/notaries/${ID}/activer`, { bearer: session });
  rows = parse(await h.call('GET', '/admin/notaries', { bearer: session })).notaires;
  assert.equal(rows[0].statut, 'active');
  assert.equal(rows[0].approuveLe, NOW_ISO);
});
