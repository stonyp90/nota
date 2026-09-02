// LA PORTE D'ENVOI D'UNE CAMPAGNE — une seule, celle du notifieur.
//
// `resolveAudience` (segments.js) décide QUI ; la route décide QUAND ; cette
// porte fait l'envoi lui-même. Elle ne doit pas être un second chemin qui
// oublierait ce que le premier garantit :
//
//   • la liste de suppression l'emporte, toujours et partout ;
//   • l'en-tête RFC 8058 voyage (LCAP — le retrait doit être fonctionnel) ;
//   • un gabarit éteint par l'admin reste éteint ;
//   • et surtout : le registre `SENT#` n'est PAS l'idempotence d'une campagne.
//     Sa clé de partition varie avec le destinataire, donc elle est impossible
//     à borner par `dynamodb:LeadingKeys` : la Lambda admin partirait en
//     AccessDenied APRÈS l'envoi du courriel. L'idempotence d'une campagne,
//     c'est `markCampaignSent`, borné par sa propre partition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNotifier } = require('../src/notifications.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const NOW = '2026-09-02T15:00:00.000Z';

function make({ unsub = [] } = {}) {
  const repo = createMemoryRepo([]);
  const envoyes = [];
  const notifier = createNotifier({
    repo,
    mailer: { send: async (m) => { envoyes.push(m); } },
    now: () => NOW,
    baseUrl: 'https://nota.test',
    apiBaseUrl: 'https://api.nota.test',
    operatorEmail: 'ops@nota.ca',
  });
  return { repo, notifier, envoyes, unsub };
}

test('la porte existe et rend un verdict, jamais un silence', async () => {
  const { notifier } = make();
  assert.equal(typeof notifier.sendCampaign, 'function');
  const r = await notifier.sendCampaign({ to: '', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'no-address');
});

test('un envoi porte le sujet, les deux langues, et l’en-tête de retrait', async () => {
  const { notifier, envoyes } = make();
  const r = await notifier.sendCampaign({ to: 'client@exemple.ca', templateKey: 'clientWelcome', ctx: { email: 'client@exemple.ca' } });
  assert.equal(r.sent, true, JSON.stringify(r));
  assert.equal(envoyes.length, 1);
  const m = envoyes[0];
  assert.ok(m.subject && m.html && m.text);
  // LCAP : le mécanisme de retrait doit être FONCTIONNEL, pas décoratif.
  assert.match(m.unsubscribeUrl, /^https:\/\/api\.nota\.test\/unsubscribe\?token=/);
});

test('un désabonné n’est jamais atteint, même nommé explicitement', async () => {
  const { notifier, repo, envoyes } = make();
  await repo.putUnsubscribe('parti@exemple.ca', NOW);
  const r = await notifier.sendCampaign({ to: 'parti@exemple.ca', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'unsubscribed');
  assert.equal(envoyes.length, 0);
});

test('un gabarit éteint par l’admin reste éteint', async () => {
  const { notifier, repo, envoyes } = make();
  await repo.putEmailOverride({ key: 'clientWelcome', actif: false }, NOW);
  const r = await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'disabled');
  assert.equal(envoyes.length, 0);
});

test('un gabarit inconnu est refusé — jamais un envoi vide', async () => {
  const { notifier, envoyes } = make();
  const r = await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'pasUnGabarit', ctx: {} });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'unknown-template');
  assert.equal(envoyes.length, 0);
});

test('la campagne n’écrit PAS dans le registre SENT# — sa clé ne peut pas être bornée par IAM', async () => {
  const { notifier, repo } = make();
  let touche = false;
  const vrai = repo.markNotificationSent.bind(repo);
  repo.markNotificationSent = async (...a) => { touche = true; return vrai(...a); };
  await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(touche, false,
    'écrire SENT# ferait partir la Lambda admin en AccessDenied APRÈS l’envoi du courriel');
});

test('deux envois au même destinataire passent tous les deux — le plafond vit ailleurs', async () => {
  // La fréquence est la garde de l'art. 56 1°, et elle est portée par
  // `markCampaignSent` / `resolveAudience`. La porte d'envoi, elle, ne doit pas
  // dédoublonner en silence : un envoi refusé sans raison lisible est pire
  // qu'un envoi refusé bruyamment en amont.
  const { notifier, envoyes } = make();
  await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'clientWelcome', ctx: {} });
  await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(envoyes.length, 2);
});

test('un mailer qui lève ne fait pas tomber la campagne entière', async () => {
  const repo = createMemoryRepo([]);
  const notifier = createNotifier({
    repo, mailer: { send: async () => { throw new Error('SES down'); } },
    now: () => NOW, baseUrl: 'https://nota.test', apiBaseUrl: 'https://api.nota.test', operatorEmail: 'o@n.ca',
  });
  const r = await notifier.sendCampaign({ to: 'a@b.ca', templateKey: 'clientWelcome', ctx: {} });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'send-failed');
});
