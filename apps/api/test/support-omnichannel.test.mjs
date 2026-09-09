import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory');
const { createApp } = require('../src/handler');
const { createLocalAdminApp } = require('../admin-local-server');
const { createFakeMailer } = require('../src/notify-port');
const { createNotifier } = require('../src/notifications');
const { createSupportConversations } = require('../src/support-conversations');
const { createSupportEmailReceiver } = require('../src/support-email');

const parsed = response => JSON.parse(response.body);
const bearer = token => ({ authorization: 'Bearer ' + token });

test('widget, local admin and both email participants keep one transcript through retries and reopening', async () => {
  const repo = createMemoryRepo(), mailer = createFakeMailer();
  const env = { NOTA_SUPPORT_EMAIL_DOMAIN: 'replies.nota.example', NOTA_NOTARY_SECRET: 'support-test-only-signing-secret-'.repeat(2), NOTA_OPERATOR_EMAIL: 'operator@nota.example' };
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', adminUrl: 'https://admin.nota.example', operatorEmail: env.NOTA_OPERATOR_EMAIL, supportEmailDomain: env.NOTA_SUPPORT_EMAIL_DOMAIN, supportEmailSecret: env.NOTA_NOTARY_SECRET });
  const app = createApp(repo, { notifier, env: {} });
  const local = createLocalAdminApp({ repo, mailer, notifier });
  await local.ready;
  assert.equal(local.repo, repo, 'the actual local composition receives the public repository');
  const callAdmin = (method, path, body, token) => local.app.handle({ method, path, body, headers: token ? bearer(token) : {}, sourceIp: '127.0.0.1' });
  const login = parsed(await callAdmin('POST', '/admin/auth/request', { email: local.email }));
  const challenge = decodeURIComponent(new URL(login.devLink).hash.split('token=')[1]);
  const auth = parsed(await callAdmin('POST', '/admin/auth/verify', { token: challenge }));
  const token = auth.session;
  assert.ok(token);

  const firstResponse = await app.handle({ method: 'POST', path: '/support/messages', body: { texte: 'Je voudrais parler à une personne.', courriel: 'customer@example.test' }, headers: {} });
  assert.equal(firstResponse.statusCode, 201);
  const first = parsed(firstResponse);
  const list = parsed(await callAdmin('GET', '/admin/support', null, token));
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].id, first.threadId);
  const threadPath = '/admin/support/' + first.threadId;
  const reply = { texte: 'Bonjour, quelle étape souhaitez-vous clarifier?', messageId: 'admin-attempt-1' };
  assert.equal((await callAdmin('POST', threadPath + '/reponse', reply, token)).statusCode, 200);
  assert.equal(parsed(await callAdmin('POST', threadPath + '/reponse', reply, token)).duplicate, true);
  const customerMail = mailer.sent.find(mail => mail.to === 'customer@example.test');
  assert.ok(customerMail.replyTo);

  let storedRaw;
  const conversations = createSupportConversations({ repo, notifier });
  const receiver = createSupportEmailReceiver({ repo, conversations, env, getObject: async () => ({ Body: Buffer.from(storedRaw) }) });
  const receive = async ({ sender, destination, id, text }) => {
    storedRaw = [`From: ${sender}`, `To: ${destination}`, `Message-ID: <${id}@example.test>`, 'Subject: Re: Soutien Nota', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', text].join('\r\n');
    return receiver.receive({ eventSource: 'aws:ses', ses: {
      mail: { messageId: 'ses-' + id, source: sender },
      receipt: { recipients: [destination], spamVerdict: { status: 'PASS' }, virusVerdict: { status: 'PASS' }, dmarcVerdict: { status: 'PASS' }, dkimVerdict: { status: 'PASS' }, spfVerdict: { status: 'PASS' } },
    } });
  };
  await callAdmin('POST', threadPath + '/clos', null, token);
  const visitor = { sender: 'customer@example.test', destination: customerMail.replyTo, id: 'visitor-mail-1', text: 'Comment préparer mes documents?\r\n\r\nLe 9 septembre, Nota a écrit :\r\n> Ancien message' };
  assert.equal((await receive(visitor)).accepted, true);
  assert.equal((await receive(visitor)).duplicate, true);
  const reopened = parsed(await callAdmin('GET', threadPath, null, token));
  assert.equal(reopened.thread.statut, 'a_repondre');
  assert.equal(reopened.thread.messages.length, 3);
  assert.equal(reopened.thread.messages[2].texte, 'Comment préparer mes documents?');
  const operatorMail = mailer.sent.filter(mail => mail.to === env.NOTA_OPERATOR_EMAIL).at(-1);
  assert.ok(operatorMail.replyTo);
  const operator = { sender: env.NOTA_OPERATOR_EMAIL, destination: operatorMail.replyTo, id: 'operator-mail-1', text: 'Le notaire vous indiquera les documents requis.\r\n\r\nOn Wednesday, Customer wrote:\r\n> Question' };
  assert.equal((await receive(operator)).accepted, true);
  assert.equal((await receive(operator)).duplicate, true);
  const widget = parsed(await app.handle({ method: 'GET', path: '/support/thread', headers: bearer(first.token) }));
  assert.deepEqual(widget.messages.map(message => message.de), ['visiteur', 'nota', 'visiteur', 'nota']);
  assert.equal(widget.messages[3].texte, 'Le notaire vous indiquera les documents requis.');
  assert.equal(widget.humain, true);
  assert.equal(parsed(await callAdmin('GET', '/admin/support', null, token)).threads.length, 1);
  assert.equal(mailer.sent.filter(mail => mail.to === 'customer@example.test').length, 2);
  assert.equal(mailer.sent.filter(mail => mail.to === env.NOTA_OPERATOR_EMAIL).length, 2);
});
