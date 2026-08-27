// Admin-editable email templates (ADR 0018 §3/§6) — the STORAGE + ADMIN API
// side of the override port whose consumption lives in notifications.js:
//   • repo.getEmailOverride / putEmailOverride / deleteEmailOverride /
//     listEmailOverrides on BOTH adapters (memory behaviour; dynamo command
//     shapes against the recording fake — CONFIG#EMAIL single partition).
//   • GET /admin/notifications/templates merges TEMPLATE_META with the store.
//   • PUT /admin/notifications/templates/{key} validates (404 unknown key,
//     422 bad token / one-sided subject / too long / non-boolean enabled),
//     403 for an analyst, audit-logged with before/after.
//   • DELETE resets to the built-in behaviour, audit-logged.
// Plus a regression: isUnsubscribed must normalize (trim+lowercase) the way
// putUnsubscribe does, on both adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createDynamoRepo } = require('../src/repo-dynamo.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const emails = require('../src/emails.js');
const authDefaults = require('../src/admin-auth.js');

const TODAY = '2026-08-14';
const START = 1_700_000_000_000;
const NOW_ISO = new Date(START).toISOString();

// ============================================================================
// Repo port — memory adapter behaviour
// ============================================================================

test('memory repo: putEmailOverride stores the normalized record and getEmailOverride round-trips it', async () => {
  const repo = createMemoryRepo();
  const stored = await repo.putEmailOverride(
    { key: 'offerPublished', enabled: true, subjectFr: ' Offre {{montant}} ', subjectEn: 'Offer {{montant}}' },
    NOW_ISO
  );
  assert.deepEqual(stored, {
    key: 'offerPublished',
    enabled: true,
    subjectFr: 'Offre {{montant}}',
    subjectEn: 'Offer {{montant}}',
    updatedAt: NOW_ISO,
  });
  assert.deepEqual(await repo.getEmailOverride('offerPublished'), stored);
  assert.equal(await repo.getEmailOverride('unknownKey'), null);
});

test('memory repo: empty-string subjects are stored as null (kill-switch-only override)', async () => {
  const repo = createMemoryRepo();
  const stored = await repo.putEmailOverride({ key: 'offerPublished', enabled: false, subjectFr: '', subjectEn: '  ' }, NOW_ISO);
  assert.equal(stored.enabled, false);
  assert.equal(stored.subjectFr, null);
  assert.equal(stored.subjectEn, null);
});

test('memory repo: deleteEmailOverride removes; listEmailOverrides returns every record sorted by key', async () => {
  const repo = createMemoryRepo();
  await repo.putEmailOverride({ key: 'offerRetained', enabled: true, subjectFr: 'B', subjectEn: 'B' }, NOW_ISO);
  await repo.putEmailOverride({ key: 'clientWelcome', enabled: false }, NOW_ISO);
  assert.deepEqual((await repo.listEmailOverrides()).map((o) => o.key), ['clientWelcome', 'offerRetained']);
  await repo.deleteEmailOverride('clientWelcome');
  assert.deepEqual((await repo.listEmailOverrides()).map((o) => o.key), ['offerRetained']);
  assert.equal(await repo.getEmailOverride('clientWelcome'), null);
});

test('the REAL memory repo satisfies the notifier consumption contract (disable + subject override)', async () => {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => TODAY + 'T09:00:00.000Z' });
  const bid = {
    id: 'b1', serviceId: 'refinancement', dateISO: '2026-08-19', montant: 1500,
    tier: 'prioritaire', status: 'ouverte', courriel: 'client@example.ca',
  };
  await repo.putEmailOverride({ key: 'offerPublished', enabled: false }, NOW_ISO);
  const r = await notifier.onOfferCreated(bid);
  assert.deepEqual(r.results[0], { sent: false, reason: 'disabled', kind: 'offerPublished' });
  assert.equal(mailer.sent.length, 0);
});

// ============================================================================
// Repo port — dynamo adapter command shapes (recording fake, no AWS)
// ============================================================================

function recordingRepo(reply) {
  const sent = [];
  const doc = {
    async send(cmd) {
      const rec = { name: cmd.constructor.name, input: cmd.input };
      sent.push(rec);
      return reply ? reply(rec) : {};
    },
  };
  return { repo: createDynamoRepo({ tableName: 'main', adminTableName: 'admin', doc }), sent };
}

test('dynamo repo: email overrides live under the single CONFIG#EMAIL partition, TPL#<key> items', async () => {
  const { repo, sent } = recordingRepo((rec) => {
    if (rec.name === 'QueryCommand') {
      return { Items: [{ PK: 'CONFIG#EMAIL', SK: 'TPL#offerPublished', type: 'email_override', key: 'offerPublished', enabled: true, subjectFr: 'X', subjectEn: 'Y', updatedAt: NOW_ISO }] };
    }
    if (rec.name === 'GetCommand') {
      return { Item: { PK: 'CONFIG#EMAIL', SK: 'TPL#offerPublished', type: 'email_override', key: 'offerPublished', enabled: false, subjectFr: null, subjectEn: null, updatedAt: NOW_ISO } };
    }
    return {};
  });

  const stored = await repo.putEmailOverride({ key: 'offerPublished', enabled: true, subjectFr: '', subjectEn: 'Only EN' }, NOW_ISO);
  const put = sent.find((s) => s.name === 'PutCommand');
  assert.equal(put.input.TableName, 'main', 'overrides live on the MAIN table (the notifier reads it)');
  assert.equal(put.input.Item.PK, 'CONFIG#EMAIL');
  assert.equal(put.input.Item.SK, 'TPL#offerPublished');
  assert.equal(put.input.Item.subjectFr, null, 'empty-string subject stored as null');
  assert.equal(put.input.Item.subjectEn, 'Only EN');
  assert.equal(put.input.Item.updatedAt, NOW_ISO);
  assert.equal(stored.subjectFr, null);

  const got = await repo.getEmailOverride('offerPublished');
  const get = sent.find((s) => s.name === 'GetCommand');
  assert.deepEqual(get.input.Key, { PK: 'CONFIG#EMAIL', SK: 'TPL#offerPublished' });
  assert.equal(got.PK, undefined, 'storage keys are stripped on read');
  assert.equal(got.type, undefined);
  assert.equal(got.enabled, false);

  const listed = await repo.listEmailOverrides();
  const q = sent.find((s) => s.name === 'QueryCommand');
  assert.equal(q.input.TableName, 'main');
  assert.equal(q.input.ExpressionAttributeValues[':pk'], 'CONFIG#EMAIL');
  assert.equal(q.input.ExpressionAttributeValues[':b'], 'TPL#');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].PK, undefined, 'listed overrides are stripped too');

  await repo.deleteEmailOverride('offerPublished');
  const del = sent.find((s) => s.name === 'DeleteCommand');
  assert.deepEqual(del.input.Key, { PK: 'CONFIG#EMAIL', SK: 'TPL#offerPublished' });
});

// ============================================================================
// Regression — isUnsubscribed must normalize like putUnsubscribe (both repos)
// ============================================================================

test('memory repo: a mixed-case unsubscribe still suppresses the mixed-case lookup (trim + lowercase)', async () => {
  const repo = createMemoryRepo();
  await repo.putUnsubscribe('  Client@Example.CA ', NOW_ISO);
  assert.equal(await repo.isUnsubscribed('client@example.ca'), true);
  assert.equal(await repo.isUnsubscribed(' CLIENT@example.CA'), true, 'lookup must normalize like the write did');
  assert.equal(await repo.isUnsubscribed('other@example.ca'), false);
});

test('dynamo repo: isUnsubscribed builds the same normalized UNSUB# key putUnsubscribe wrote', async () => {
  const { repo, sent } = recordingRepo(() => ({}));
  await repo.putUnsubscribe('  Client@Example.CA ', NOW_ISO);
  await repo.isUnsubscribed(' CLIENT@example.CA');
  const put = sent.find((s) => s.name === 'PutCommand');
  const get = sent.find((s) => s.name === 'GetCommand');
  assert.equal(put.input.Item.PK, 'UNSUB#client@example.ca');
  assert.equal(get.input.Key.PK, 'UNSUB#client@example.ca', 'the read key must match the normalized write key');
});

// ============================================================================
// Admin API — routes, permissions, validation, audit
// ============================================================================

function make(adminConfig = {}) {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true, ...adminConfig },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const call = (method, path, { body, bearer, query } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, clock, call };
}

const parse = (res) => JSON.parse(res.body);

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.call('POST', '/admin/auth/request', { body: { email } }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  const verified = parse(await h.call('POST', '/admin/auth/verify', { body: { token } }));
  return verified.session;
}

// Pre-seed an analyst identity so the magic-link bootstrap keeps that role.
async function loginAnalyst(h) {
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email),
    email,
    role: 'analyst',
    disabled: false,
    createdAt: NOW_ISO,
  });
  return login(h, email);
}

test('every template route is 401 without a session', async () => {
  const h = make();
  assert.equal((await h.call('GET', '/admin/notifications/templates')).statusCode, 401);
  assert.equal((await h.call('PUT', '/admin/notifications/templates/offerPublished', { body: {} })).statusCode, 401);
  assert.equal((await h.call('DELETE', '/admin/notifications/templates/offerPublished')).statusCode, 401);
});

test('super_admin carries notifications:write; analyst does not (via /admin/me)', async () => {
  const h = make();
  const superMe = parse(await h.call('GET', '/admin/me', { bearer: await login(h) }));
  assert.ok(superMe.permissions.includes('notifications:write'));
  const analystMe = parse(await h.call('GET', '/admin/me', { bearer: await loginAnalyst(h) }));
  assert.equal(analystMe.role, 'analyst');
  assert.ok(!analystMe.permissions.includes('notifications:write'));
  assert.ok(analystMe.permissions.includes('analytics:read'), 'analyst keeps read');
});

test('GET /admin/notifications/templates lists the full registry with override:null everywhere by default', async () => {
  const h = make();
  const res = await h.call('GET', '/admin/notifications/templates', { bearer: await login(h) });
  assert.equal(res.statusCode, 200);
  const { templates } = parse(res);
  assert.deepEqual(templates.map((t) => t.key).sort(), Object.keys(emails.TEMPLATE_META).sort());
  for (const t of templates) {
    assert.equal(t.override, null);
    assert.ok(['client', 'notaire', 'partenaire', 'operateur', 'admin'].includes(t.audience));
    assert.ok(t.labelFr && t.labelEn && t.defaultSubjectFr && t.defaultSubjectEn);
    assert.ok(Array.isArray(t.placeholders));
  }
});

test('PUT stores an override and the list merges it onto its template', async () => {
  const h = make();
  const session = await login(h);
  const put = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: 'Votre offre {{montant}}', subjectEn: 'Your offer {{montant}}' },
  });
  assert.equal(put.statusCode, 200, put.body);
  const { override } = parse(put);
  assert.equal(override.key, 'offerPublished');
  assert.equal(override.enabled, true, 'enabled defaults to true when omitted');
  assert.equal(override.subjectFr, 'Votre offre {{montant}}');
  assert.ok(override.updatedAt, 'the stored override carries updatedAt');

  const { templates } = parse(await h.call('GET', '/admin/notifications/templates', { bearer: session }));
  const row = templates.find((t) => t.key === 'offerPublished');
  assert.equal(row.override.subjectEn, 'Your offer {{montant}}');
  const other = templates.find((t) => t.key === 'clientWelcome');
  assert.equal(other.override, null, 'untouched templates stay override-less');
});

test('PUT validation: unknown key is 404, on PUT and DELETE alike', async () => {
  const h = make();
  const session = await login(h);
  const put = await h.call('PUT', '/admin/notifications/templates/notATemplate', { bearer: session, body: {} });
  assert.equal(put.statusCode, 404);
  assert.equal(parse(put).errors[0].code, 'modele_inconnu');
  const del = await h.call('DELETE', '/admin/notifications/templates/notATemplate', { bearer: session });
  assert.equal(del.statusCode, 404);
});

test('PUT validation: a {{token}} outside the template vocabulary is 422 with the allowed list in the message', async () => {
  const h = make();
  const session = await login(h);
  // offerPublished declares [montant, service, date] — {{code}} is not allowed.
  const res = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: 'Offre {{code}}', subjectEn: 'Offer {{code}}' },
  });
  assert.equal(res.statusCode, 422, res.body);
  const err = parse(res).errors[0];
  assert.equal(err.code, 'jeton_inconnu');
  assert.match(err.message, /\{\{code\}\}/);
  assert.match(err.message, /\{\{montant\}\}/, 'the message lists the allowed tokens');
});

test('PUT validation: a subject in only one language is 422 (both-or-neither)', async () => {
  const h = make();
  const session = await login(h);
  for (const body of [
    { subjectFr: 'Seulement FR' },
    { subjectFr: '', subjectEn: 'Only EN' },
    { subjectFr: '   ', subjectEn: 'Only EN' },
  ]) {
    const res = await h.call('PUT', '/admin/notifications/templates/offerPublished', { bearer: session, body });
    assert.equal(res.statusCode, 422, res.body);
    assert.equal(parse(res).errors[0].code, 'sujet_bilingue');
  }
});

test('PUT validation: over-long subject and non-boolean enabled are 422; malformed JSON is 400', async () => {
  const h = make();
  const session = await login(h);
  const long = 'x'.repeat(201);
  const tooLong = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: long, subjectEn: 'ok' },
  });
  assert.equal(tooLong.statusCode, 422);
  assert.equal(parse(tooLong).errors[0].code, 'sujet_trop_long');

  const badEnabled = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { enabled: 'non' },
  });
  assert.equal(badEnabled.statusCode, 422);
  assert.equal(parse(badEnabled).errors[0].code, 'champ_invalide');

  const badJson = await h.app.handle({
    method: 'PUT',
    path: '/admin/notifications/templates/offerPublished',
    query: {},
    headers: { authorization: `Bearer ${session}` },
    body: '{nope',
  });
  assert.equal(badJson.statusCode, 400);
});

test('an analyst can read the list but PUT/DELETE are 403 (and change nothing)', async () => {
  const h = make();
  const analyst = await loginAnalyst(h);
  assert.equal((await h.call('GET', '/admin/notifications/templates', { bearer: analyst })).statusCode, 200);

  const put = await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: analyst,
    body: { enabled: false },
  });
  assert.equal(put.statusCode, 403);
  assert.equal(parse(put).errors[0].code, 'interdit');
  assert.equal((await h.call('DELETE', '/admin/notifications/templates/offerPublished', { bearer: analyst })).statusCode, 403);
  assert.equal(await h.repo.getEmailOverride('offerPublished'), null, 'nothing was stored');
});

test('DELETE resets the override to the built-in behaviour', async () => {
  const h = make();
  const session = await login(h);
  await h.call('PUT', '/admin/notifications/templates/offerPublished', { bearer: session, body: { enabled: false } });
  assert.ok(await h.repo.getEmailOverride('offerPublished'));

  const del = await h.call('DELETE', '/admin/notifications/templates/offerPublished', { bearer: session });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(parse(del), { ok: true, key: 'offerPublished' });
  assert.equal(await h.repo.getEmailOverride('offerPublished'), null);

  const { templates } = parse(await h.call('GET', '/admin/notifications/templates', { bearer: session }));
  assert.equal(templates.find((t) => t.key === 'offerPublished').override, null);
});

test('every write is audit-logged with before/after; a rejected write is not', async () => {
  const h = make();
  const session = await login(h);
  await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: 'A {{montant}}', subjectEn: 'B {{montant}}' },
  });
  await h.call('PUT', '/admin/notifications/templates/offerPublished', { bearer: session, body: { enabled: false } });
  await h.call('DELETE', '/admin/notifications/templates/offerPublished', { bearer: session });
  // Rejected: unknown token — must NOT append an audit entry.
  await h.call('PUT', '/admin/notifications/templates/offerPublished', {
    bearer: session,
    body: { subjectFr: '{{code}}', subjectEn: '{{code}}' },
  });

  const day = new Date(START).toISOString().slice(0, 10);
  const entries = (await h.repo.queryAuditByDay(day)).filter((e) => e.action.startsWith('email_template_'));
  assert.deepEqual(entries.map((e) => e.action), ['email_template_updated', 'email_template_updated', 'email_template_reset']);

  const [first, second, reset] = entries;
  assert.equal(first.meta.key, 'offerPublished');
  assert.equal(first.meta.before, null, 'first write starts from no override');
  assert.equal(first.meta.after.subjectFr, 'A {{montant}}');
  assert.equal(second.meta.before.subjectFr, 'A {{montant}}', 'second write carries the previous record as before');
  assert.equal(second.meta.after.enabled, false);
  assert.equal(second.meta.after.subjectFr, null, 'PUT is a full replacement');
  assert.equal(reset.meta.after, null);
  assert.equal(reset.meta.before.enabled, false);
  assert.equal(entries[0].email, 'ops@nota.ca', 'the acting admin is recorded');
});
