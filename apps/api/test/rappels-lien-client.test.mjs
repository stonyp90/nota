// LE LIEN QUI RAMÈNE LE CLIENT, DANS LE COURRIEL QUI EST FAIT POUR ÇA.
//
// ADR 0033 §2.7 : chaque courriel d'acte porte `clientUrl`, le lien signé et
// indépendant de l'appareil qui ouvre L'ACTE du client. Le handler HTTP le
// frappe (`clientLink`, handler.js) ; le lot quotidien — celui qui envoie les
// rappels J-7 / J-3 / J-1, le J-0 sans preneur, le dossier incomplet, la
// caution refusée et l'indemnité expirée — construisait son notificateur SANS
// `clientLink`. `clientUrlFor` retombait donc sur `null` et le bouton de tous
// les courriels programmés menait à l'espace client générique, derrière une
// nouvelle authentification.
//
// C'est exactement l'inverse de leur travail : ces courriels-là sont les seuls
// qui parlent à quelqu'un qui n'est PAS devant l'écran. Un rappel de la veille
// qui demande de se reconnecter avant de montrer l'acte est un rappel qu'on
// ne suit pas.
//
// Trois garanties :
//   1. le lot passe bien `clientLink` au notificateur ;
//   2. le courriel programmé porte le lien de l'acte, pas l'espace générique ;
//   3. la Lambda des rappels reçoit le MÊME secret de signature que l'API —
//      sans quoi le lien qu'elle frappe ne se vérifierait pas au retour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { runReminders } = require('../src/reminders.js');

const lire = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ENTREE_RAPPELS = lire('../reminders.js');
const NOTIFICATIONS_TF = lire('../../../infra/notifications.tf');
const LAMBDA_TF = lire('../../../infra/lambda.tf');

const TODAY = '2026-08-12';
const BASE = 'https://nota.example';

function bidAt(id, offset, over = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: domain.addDays(TODAY, offset),
    montant: 2400,
    tier: domain.tierForDays(Math.max(0, offset)),
    premium: 2400 / 2000,
    status: 'ouverte',
    anonyme: true,
    courriel: id + '@example.ca',
    createdAt: TODAY,
    dossierReady: true,
    ...over,
  };
}

// 1. Le lot construit son notificateur avec le lien client.
test('l’entrée des rappels passe clientLink au notificateur', () => {
  const appel = ENTREE_RAPPELS.match(/createNotifier\(\{[\s\S]*?\n {2}\}\);/);
  assert.ok(appel, 'createNotifier introuvable dans apps/api/reminders.js');
  assert.match(appel[0], /clientLink:/,
    'le lot quotidien construit encore son notificateur sans clientLink — '
    + 'tous les courriels programmés perdent le lien vers l’acte');
});

// 2. Ce que le client reçoit : le lien de SON acte, pas la porte générique.
test('un rappel programmé porte le lien signé de l’acte, pas l’espace générique', async () => {
  const repo = createMemoryRepo([bidAt('j1', 1)]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({
    repo,
    mailer,
    baseUrl: BASE,
    operatorEmail: null,
    now: () => TODAY,
    clientLink: (bid) => BASE + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle=jeton-signe',
  });

  await runReminders({ repo, notifier, now: () => TODAY });

  const mail = mailer.sent.find((m) => m.to === 'j1@example.ca');
  assert.ok(mail, 'le rappel J-1 n’est pas parti');
  assert.match(mail.html, /#offre=j1&amp;d=|#offre=j1&d=/,
    'le courriel de rappel ne porte pas le lien de l’acte : ' + mail.html.slice(0, 400));
});

// Et la preuve que la garantie 2 mesure quelque chose : sans clientLink, le
// même rappel retombe sur l'espace générique. C'était l'état livré.
test('sans clientLink le même rappel retombe sur l’espace générique', async () => {
  const repo = createMemoryRepo([bidAt('j1', 1)]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: null, now: () => TODAY });

  await runReminders({ repo, notifier, now: () => TODAY });

  const mail = mailer.sent.find((m) => m.to === 'j1@example.ca');
  assert.ok(mail, 'le rappel J-1 n’est pas parti');
  assert.ok(!/#offre=j1/.test(mail.html), 'témoin cassé : le lien de l’acte est apparu sans clientLink');
});

// 3. Le lien n'a de valeur que s'il se vérifie au retour : même secret que l'API.
test('la Lambda des rappels signe avec le même secret que l’API', () => {
  const bloc = NOTIFICATIONS_TF.match(/resource "aws_lambda_function" "reminders"[\s\S]*?\n}\n/);
  assert.ok(bloc, 'la Lambda des rappels est introuvable dans infra/notifications.tf');

  const secretApi = LAMBDA_TF.match(/NOTA_NOTARY_SECRET\s*=\s*(\S+)/);
  assert.ok(secretApi, 'NOTA_NOTARY_SECRET introuvable sur la Lambda API');

  assert.match(bloc[0], /NOTA_NOTARY_SECRET\s*=\s*\S+/,
    'la Lambda des rappels n’a pas de secret de signature : le lien qu’elle frappe '
    + 'ne se vérifierait pas au retour');

  const secretRappels = bloc[0].match(/NOTA_NOTARY_SECRET\s*=\s*(\S+)/);
  assert.equal(secretRappels[1], secretApi[1],
    'les deux Lambdas ne signent pas avec le même secret : '
    + secretRappels[1] + ' ≠ ' + secretApi[1]);
});
