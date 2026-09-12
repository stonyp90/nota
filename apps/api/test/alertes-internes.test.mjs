import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory');
const { createNotifier } = require('../src/notifications');
const { createFakeMailer } = require('../src/notify-port');
const emails = require('../src/emails');

/**
 * UNE ALERTE INTERNE NE S'ÉTEINT PAS PAR UN LIEN DE DÉSABONNEMENT.
 *
 * Audit du 2026-09-12 : les douze alertes opérateur sont « relationnelles »
 * (l'opérateur peut les couper depuis la console, gabarit par gabarit — c'est
 * son interrupteur, et il est délibéré) et elles portent, comme tout courriel,
 * le lien RFC 8058. Un seul clic sur ce lien — ou l'adresse de l'opérateur
 * arrivée sur la liste de retrait par n'importe quel chemin — éteignait TOUTE
 * l'alerte interne, escalade de messagerie comprise, sans erreur, sans trace :
 * la maison devenait aveugle et personne ne l'apprenait.
 *
 * Le retrait global est le choix d'un DESTINATAIRE qui ne veut plus de courrier
 * de Nota. Il ne vise pas le courrier que Nota s'écrit à elle-même.
 */
const OPERATEUR = 'operateur@nota.ca';

function monde() {
  const repo = createMemoryRepo();
  const mailer = createFakeMailer();
  const notifier = createNotifier({
    repo, mailer, baseUrl: 'https://gonota.ca', operatorEmail: OPERATEUR, now: () => '2026-09-12',
  });
  return { repo, mailer, notifier };
}

test('l’opérateur retiré reçoit quand même ses alertes — la maison ne devient pas aveugle', async () => {
  const { repo, mailer, notifier } = monde();
  await repo.putUnsubscribe(OPERATEUR, '2026-09-12');
  assert.equal(await repo.isUnsubscribed(OPERATEUR), true, 'le retrait est bien enregistré');

  await notifier.onOfferCreated({
    id: 'b1', courriel: 'client@exemple.ca', serviceId: 'refinancement', montant: 2400, dateISO: '2026-10-12', status: 'ouverte',
  });
  await new Promise((r) => setImmediate(r));

  const versOperateur = mailer.sent.filter((m) => m.to === OPERATEUR);
  assert.equal(versOperateur.length, 1, 'l’alerte de nouvelle offre part malgré le retrait');
});

test('le retrait garde toute sa force sur le courrier relationnel d’un client', async () => {
  const { repo, mailer, notifier } = monde();
  const client = 'client@exemple.ca';
  await repo.putUnsubscribe(client, '2026-09-12');

  // clientWelcome est relationnel (TEMPLATE_META) et destiné au client : le
  // retrait doit le taire. C'est la contre-épreuve de l'exemption ci-dessus.
  assert.equal(emails.TEMPLATE_META.clientWelcome.transactionnel, false);
  await notifier.onClientSignup({ email: client, lang: 'fr' });
  await new Promise((r) => setImmediate(r));
  assert.equal(mailer.sent.filter((m) => m.to === client).length, 0, 'le client retiré n’est pas relancé');
});

test('l’exemption se lit sur l’audience du gabarit, pas sur une liste d’adresses', () => {
  const internes = Object.entries(emails.TEMPLATE_META)
    .filter(([, meta]) => ['operateur', 'operator', 'admin'].includes(meta.audience))
    .map(([key]) => key);
  assert.ok(internes.length >= 12, 'les alertes internes sont bien déclarées par leur audience');
  // Aucune d'elles ne vise un client ou un notaire : l'exemption ne peut donc
  // pas servir à forcer du courrier vers quelqu'un qui l'a refusé.
  for (const key of internes) {
    const meta = emails.TEMPLATE_META[key];
    assert.ok(!['client', 'notaire', 'partenaire'].includes(meta.audience), key + ' reste interne');
  }
});
