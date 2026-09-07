// LE DIGEST LU AVEC LA FORME QUE LA PRODUCTION ÉCRIT VRAIMENT.
//
// `POST /bids` écrit `createdAt: todayISO` — une JOURNÉE nue (`2026-09-06`),
// parce que l'horloge du handler est `domain.businessDay`. Le lot quotidien,
// lui, relisait ce champ comme un INSTANT :
//
//     domain.businessDay('2026-09-06') === '2026-09-05'
//
// `new Date('2026-09-06')` vaut minuit UTC, c'est-à-dire la VEILLE au soir à
// Québec. Une demande publiée aujourd'hui se déclarait donc née hier, et la
// fenêtre `[hier, aujourd'hui[` la manquait au tour suivant. Le lot tourne à
// 9 h (heure de l'Est) : concrètement, tout ce qui était publié après 9 h ne
// figurait dans AUCUN digest, jamais. C'est la majorité de la demande — et,
// vu du notaire, une place de marché vide.
//
// Le suite existante ne pouvait pas le voir : toutes ses fixtures collent un
// `T14:00:00.000Z` derrière la date (notary-digest.test.mjs:28, 73, 83…), une
// forme que la production n'écrit jamais. Les tests étaient alignés sur le
// bogue. Ceux-ci utilisent la forme réelle.
//
// `segments.js:450-454` porte déjà la garde correcte et l'explique dans les
// mêmes termes ; c'est elle qui manquait ici.
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

const HANDLER_SRC = readFileSync(fileURLToPath(new URL('../src/handler.js', import.meta.url)), 'utf8');

const TODAY = '2026-08-12';
const YESTERDAY = domain.addDays(TODAY, -1);

// La forme que `POST /bids` écrit : `createdAt` est une journée nue.
function bidCreatedOn(id, jour, over = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: domain.addDays(TODAY, 30),
    montant: 2400,
    tier: 'confort',
    status: 'ouverte',
    anonyme: true,
    courriel: id + '@client.example',
    createdAt: jour,
    dossierReady: true,
    pricing: { [domain.DEPLACEMENT_CRITERION_ID]: 'client_50' },
    ...over,
  };
}

async function run(seedBids, notaries, today = TODAY) {
  const repo = createMemoryRepo(seedBids);
  for (const n of notaries) await repo.putNotary(n);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: 'https://nota.example', operatorEmail: null, now: () => today });
  const summary = await runReminders({ repo, notifier, now: () => today });
  return { mailer, summary };
}

const activeNotary = (id) => ({ id, email: id + '@etude.example', status: 'active', etude: 'Étude ' + id });
const digestMails = (mailer) => mailer.sent.filter((m) => m.subject.includes('carnet'));

// La prémisse : sans elle, les tests suivants ne prouveraient rien.
test('POST /bids écrit bien createdAt comme une journée nue, pas comme un instant', () => {
  assert.match(HANDLER_SRC, /createdAt:\s*todayISO\b/,
    'le handler n’écrit plus createdAt: todayISO — la forme testée ici a changé');
  // Et cette forme, relue comme un instant, recule d'un jour à Québec.
  assert.equal(domain.businessDay('2026-09-06'), '2026-09-05',
    'témoin : une journée nue lue comme un instant doit reculer d’un jour');
});

test('une demande publiée hier — telle que la production l’écrit — entre dans le digest', async () => {
  const { mailer, summary } = await run(
    [bidCreatedOn('hier', YESTERDAY)],
    [activeNotary('n1')]
  );
  const digests = digestMails(mailer);
  assert.equal(digests.length, 1,
    'la demande d’hier n’a atteint aucun notaire : la journée nue a été relue comme un instant');
  assert.equal(summary.digest.sent, 1);
  assert.match(digests[0].subject, /1 nouvelle demande/);
});

test('une demande publiée aujourd’hui n’est pas encore du digest, et arrive dans celui de demain', async () => {
  // Aujourd'hui : elle n'y est pas — la fenêtre est `[hier, aujourd'hui[`.
  const jour1 = await run([bidCreatedOn('aujourdhui', TODAY)], [activeNotary('n1')]);
  assert.equal(digestMails(jour1.mailer).length, 0, 'le digest du jour ne doit pas contenir la demande du jour');

  // Demain : elle y est. C'était le cas manqué — publiée après le tour de 9 h,
  // elle n'apparaissait dans aucun digest, jamais.
  const demain = domain.addDays(TODAY, 1);
  const jour2 = await run([bidCreatedOn('aujourdhui', TODAY)], [activeNotary('n1')], demain);
  assert.equal(digestMails(jour2.mailer).length, 1,
    'la demande d’aujourd’hui n’est jamais arrivée : elle a manqué le digest du jour ET celui de demain');
});

// La forme instant doit continuer de fonctionner : le champ est écrit en
// journée nue par `POST /bids`, mais des enregistrements plus anciens et les
// fixtures existantes portent un instant complet.
test('la forme instant reste lue correctement', async () => {
  const { mailer } = await run(
    [bidCreatedOn('instant', YESTERDAY + 'T14:00:00.000Z')],
    [activeNotary('n1')]
  );
  assert.equal(digestMails(mailer).length, 1, 'un createdAt en instant complet a cessé d’être lu');
});

test('une demande trop vieille reste hors du digest quotidien', async () => {
  const { mailer } = await run(
    [bidCreatedOn('vieille', domain.addDays(TODAY, -3))],
    [activeNotary('n1')]
  );
  assert.equal(digestMails(mailer).length, 0, 'une demande de trois jours ne doit pas revenir dans le digest');
});
