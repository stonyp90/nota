import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { requestLanguage } = require('../src/language');
const { createMemoryRepo } = require('../src/repo-memory');
const { createDynamoRepo } = require('../src/repo-dynamo');
const { createNotifier, encodeUnsubToken } = require('../src/notifications');
const { createFakeMailer } = require('../src/notify-port');
const { createApp } = require('../src/handler');
const emails = require('../src/emails');
const baseUrl = 'https://gonota.ca';
const bid = { id: 'b1', serviceId: 'refinancement', dateISO: '2026-10-12', montant: 2000, status: 'ouverte', courriel: 'client@example.com' };
function setup() {
  const repo = createMemoryRepo(); const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl, operatorEmail: 'ops@example.com' });
  return { repo, mailer, notifier, app: createApp(repo, { notifier, siteUrl: baseUrl, clientLoginDevEcho: true }) };
}
const assertLanguage = (mail, language) => {
  assert.match(mail.html, new RegExp('<html lang="' + language + '-CA">'));
  assert.ok(mail.subject && mail.text);
  assert.doesNotMatch(mail.text, language === 'fr' ? /The Nota team/ : /L’équipe Nota/);
};

test('Accept-Language honors quality, regional tags, preference order, unsupported and malformed input', () => {
  for (const [header, expected] of [
    ['en-US,en;q=0.9,fr;q=0.8', 'en'], ['fr-CA,en;q=0.8', 'fr'],
    ['es-MX,en-US;q=0.8,fr;q=0.5', 'en'], ['fr;q=0.1,en;q=0.9', 'en'],
    ['en;q=0,fr;q=0.1', 'fr'], ['en;q=garbage,fr', 'fr'],
    ['fr;q=0,en;q=0.5', 'en'], ['de-DE', 'fr'], ['EN-gb', 'en'],
  ]) assert.equal(requestLanguage({ headers: { 'Accept-Language': header } }), expected, header);
  assert.equal(requestLanguage({}), undefined);
});

test('browser intake saves language; an anonymous second request cannot replace it', async () => {
  const { app, repo, mailer } = setup();
  const call = lang => app.handle({ method: 'POST', path: '/client/welcome', headers: { 'accept-language': lang }, body: { courriel: bid.courriel } });
  assert.equal((await call('en-CA')).statusCode, 200);
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'en');
  assertLanguage(mailer.sent[0], 'en');
  await call('fr-CA');
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'en');
  assert.equal(mailer.sent.length, 1);
});

test('authenticated language-only edits preserve notification choices and reject invalid or untrusted writes', async () => {
  const { app, repo } = setup();
  await repo.putNotificationPreferences(bid.courriel, { newMatchingBids: false });
  const call = (body, headers = { authorization: 'Bearer ' + encodeUnsubToken(bid.courriel) }) => app.handle({ method: 'POST', path: '/notification-preferences', headers, body });
  assert.equal((await call({ emailLanguage: 'en' }, {})).statusCode, 401);
  for (const emailLanguage of ['de', 'bilingual', null, {}, 1]) assert.equal((await call({ emailLanguage })).statusCode, 422);
  assert.equal((await call({ emailLanguage: 'en' })).statusCode, 200);
  assert.deepEqual(await repo.getNotificationPreferences(bid.courriel), { newMatchingBids: false });
  await call({ preferences: { newMatchingBids: true } });
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'en');
  assert.equal(await repo.getEmailLanguage('other@example.com'), null);
});

test('client, operator and delayed reminders use each recipient’s language, including a later change', async () => {
  const { repo, notifier, mailer } = setup();
  await repo.putEmailLanguage(bid.courriel, 'en');
  await repo.putEmailLanguage('ops@example.com', 'fr');
  await notifier.onOfferCreated(bid);
  assertLanguage(mailer.sent.find(m => m.to === bid.courriel), 'en');
  assertLanguage(mailer.sent.find(m => m.to === 'ops@example.com'), 'fr');
  await repo.putEmailLanguage(bid.courriel, 'fr');
  await notifier.onReminderDue(bid, 'j7', '2026-10-05');
  assertLanguage(mailer.sent.at(-1), 'fr');
});

for (const key of Object.keys(emails.TEMPLATES).filter(key => !/MagicLink$/.test(key))) {
  test(`${key}: actual generic send resolves the recipient language in both languages`, async () => {
    const { repo, notifier, mailer } = setup();
    for (const language of ['fr', 'en']) {
      await repo.putEmailLanguage(bid.courriel, language);
      const result = await notifier.sendCampaign({ to: bid.courriel, templateKey: key, ctx: { ...bid, baseUrl, emailLanguage: language === 'fr' ? 'en' : 'fr' } });
      assert.equal(result.sent, true, JSON.stringify(result));
      assertLanguage(mailer.sent.at(-1), language);
    }
  });
}

for (const [method, args] of [
  ['onClientLoginRequested', { courriel: bid.courriel }],
  ['onNotaryLoginRequested', { email: bid.courriel }],
  ['onPartnerClaimRequested', { email: bid.courriel, code: 'TESTCODE' }],
  ['onPartnerCodeReminder', { courriel: bid.courriel, code: 'TESTCODE' }],
]) test(`${method}: requested browser language wins for this message without changing the account`, async () => {
  const { repo, notifier, mailer } = setup();
  await repo.putEmailLanguage(bid.courriel, 'fr');
  await repo.putUnsubscribe(bid.courriel, '2026-09-08');
  assert.equal((await notifier[method]({ ...args, link: baseUrl + '/#auth=test', emailLanguage: 'en' })).sent, true);
  assertLanguage(mailer.sent.at(-1), 'en');
  await notifier[method]({ ...args, link: baseUrl + '/#auth=new' });
  assertLanguage(mailer.sent.at(-1), 'fr');
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'fr');
});

test('Dynamo language and template settings update independent attributes on the same normalized recipient', async () => {
  const commands = [];
  const repo = createDynamoRepo({ tableName: 'test', doc: { async send(cmd) { commands.push(cmd.input); return { Item: { emailLanguage: 'en' } }; } } });
  await repo.putEmailLanguage(' Client@Example.com ', 'en', true);
  await repo.putNotificationPreferences('client@example.com', { offerPublished: false });
  assert.deepEqual(commands[0].Key, commands[1].Key);
  assert.match(commands[0].UpdateExpression, /if_not_exists/);
  assert.doesNotMatch(commands[1].UpdateExpression, /emailLanguage/);
  assert.equal(await repo.getEmailLanguage('client@example.com'), 'en');
  assert.equal(commands[2].ConsistentRead, true);
});

test('failed delivery is retryable and does not mark the notification sent', async () => {
  const repo = createMemoryRepo(); let attempts = 0;
  await repo.putEmailLanguage(bid.courriel, 'en');
  const notifier = createNotifier({ repo, baseUrl, mailer: { async send(mail) { assertLanguage(mail, 'en'); if (++attempts === 1) throw new Error('temporary failure'); } } });
  assert.equal((await notifier.onClientSignup(bid.courriel)).ok, false);
  assert.equal(await repo.wasNotificationSent(bid.courriel, 'clientWelcome'), false);
  assert.equal((await notifier.onClientSignup(bid.courriel)).results[0].sent, true);
  assert.equal(attempts, 2);
});

test('HTTP sign-in sends the browser language, persists only after verification, and rejects replay', async () => {
  const { app, repo, mailer } = setup();
  await repo.putEmailLanguage(bid.courriel, 'fr');
  const headers = { 'accept-language': 'en-CA' };
  const requested = await app.handle({ method: 'POST', path: '/client/session/request', headers, body: { courriel: bid.courriel } });
  assert.equal(requested.statusCode, 200);
  assertLanguage(mailer.sent.at(-1), 'en');
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'fr');
  const body = { token: JSON.parse(requested.body).devToken };
  assert.ok(body.token);
  assert.equal((await app.handle({ method: 'POST', path: '/client/session/verify', headers, body })).statusCode, 200);
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'en');
  assert.equal((await app.handle({ method: 'POST', path: '/client/session/verify', headers: { 'accept-language': 'fr' }, body })).statusCode, 401);
  assert.equal(await repo.getEmailLanguage(bid.courriel), 'en');
});

test('language storage failure does not break a valid intake or prevent its email', async () => {
  const { app, repo, mailer } = setup();
  repo.putEmailLanguage = async () => { throw new Error('temporary database failure'); };
  const response = await app.handle({ method: 'POST', path: '/client/welcome', headers: { 'accept-language': 'en' }, body: { courriel: bid.courriel } });
  assert.equal(response.statusCode, 200);
  assert.equal(mailer.sent.length, 1);
});
