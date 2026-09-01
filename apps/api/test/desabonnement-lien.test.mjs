// Le lien de désabonnement doit ABOUTIR.
//
// Défaut trouvé le 2026-09-01 par l'audit des affirmations : les courriels
// portaient `<base>/unsubscribe?token=…`, sans le préfixe `/api`. Or le site et
// l'API partagent une origine derrière CloudFront, et la fonction `spa_router`
// (infra/cloudfront.tf) réécrit tout chemin sans extension qui n'est PAS sous
// /api vers /index.html. Le destinataire recevait donc l'application web en 200,
// et son retrait n'était jamais enregistré — sur les 41 gabarits, c'est le seul
// mécanisme de retrait, et la LCAP en exige un qui fonctionne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNotifier, decodeUnsubToken } = require('../src/notifications.js');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');

const BASE = 'https://nota.example';
const TODAY = '2026-08-12';

function notifier(over = {}) {
  const repo = createMemoryRepo([]);
  return {
    repo,
    n: createNotifier({ repo, mailer: createFakeMailer(), baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY, ...over }),
  };
}

test('le lien de désabonnement passe par /api — sinon le routeur SPA l’avale', () => {
  const { n } = notifier();
  const url = n.unsubscribeUrl('client@exemple.ca');
  assert.match(url, /^https:\/\/nota\.example\/api\/unsubscribe\?token=/, url);
  // Et le jeton reste lisible par la route qui l'attend.
  assert.equal(decodeUnsubToken(new URL(url).searchParams.get('token')), 'client@exemple.ca');
});

test('le chemin annoncé dans le courriel est celui que l’API sert vraiment', async () => {
  const { repo, n } = notifier();
  const url = n.unsubscribeUrl('client@exemple.ca');
  const app = createApp(repo, { now: () => TODAY });

  // Exactement le chemin du lien, préfixe compris : c'est ce que reçoit la Lambda.
  const path = new URL(url).pathname;
  const token = new URL(url).searchParams.get('token');
  const res = await app.handle({ method: 'GET', path, query: { token }, headers: {} });
  assert.equal(res.statusCode, 200, path + ' → ' + res.statusCode);
  assert.ok(await repo.isUnsubscribed('client@exemple.ca'), 'le retrait doit être enregistré');
});

test('une base avec une barre oblique finale ne double pas le préfixe', () => {
  const { n } = notifier({ baseUrl: BASE + '/' });
  assert.match(n.unsubscribeUrl('a@b.ca'), /^https:\/\/nota\.example\/api\/unsubscribe\?token=/);
});

test('un déploiement dont l’API vit ailleurs peut le dire', () => {
  const { n } = notifier({ apiBaseUrl: 'http://localhost:8788' });
  assert.match(n.unsubscribeUrl('a@b.ca'), /^http:\/\/localhost:8788\/unsubscribe\?token=/);
});
