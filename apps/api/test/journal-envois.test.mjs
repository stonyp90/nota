/**
 * « Ce que Nota vous a envoyé » — le journal du dossier Loi 25.
 *
 * `appendSubjectEvent` / `listSubjectEvents` existaient dans les DEUX
 * adaptateurs, testés, et `assemblerDossier` les lisait pour bâtir la section
 * `journalEnvois` du droit d'accès. Mais AUCUN chemin de production n'écrivait
 * jamais : `grep` hors adaptateurs ne rendait que des tests. Le journal était
 * donc vide en production, et le dossier remis à un usager qui exerce son droit
 * d'accès affirmait, en creux, que Nota ne lui avait rien envoyé.
 * Exactement le défaut que l'index `CLIENT#` portait avant le 5 septembre.
 * Voir [[code-teste-sans-appelant]].
 *
 * Le point d'écriture est `sendOnce` : le seul endroit par lequel passe tout
 * courriel dédoublonné. On y consigne APRÈS l'envoi réussi — un journal
 * d'envois ne doit pas prétendre qu'un message parti en erreur est parti.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNotifier } = require('../src/notifications.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const ADRESSE = 'roy@exemple.ca';

function harness({ mailer } = {}) {
  const repo = createMemoryRepo();
  const envois = [];
  const notifier = createNotifier({
    repo,
    mailer: mailer || { async send(msg) { envois.push(msg); return { id: 'm' + envois.length }; } },
    baseUrl: 'https://nota.example',
  });
  return { repo, notifier, envois };
}

test('un courriel envoyé s’inscrit au journal de son destinataire', async () => {
  const { repo, notifier } = harness();
  await notifier.onClientSignup(ADRESSE);

  const journal = await repo.listSubjectEvents(ADRESSE);
  assert.ok(journal.length >= 1, 'le journal n’est plus vide');
  const entree = journal[0];
  assert.ok(entree.kind || entree.templateKey, 'l’entrée nomme le message');
  assert.ok(entree.at, 'et le moment');
});

test('le journal nomme le GABARIT, pas seulement un genre', async () => {
  // Un auditeur doit pouvoir remonter au contenu exact : `templateKey` est ce
  // qui rejoint emails.js, donc le texte réellement reçu.
  const { repo, notifier } = harness();
  await notifier.onClientSignup(ADRESSE);
  const [entree] = await repo.listSubjectEvents(ADRESSE);
  assert.equal(entree.templateKey, 'clientWelcome');
});

test('un envoi DÉDOUBLONNÉ ne s’inscrit pas deux fois', async () => {
  // sendOnce refuse le second envoi : le journal doit refléter ce qui est
  // PARTI, pas ce qui a été demandé.
  const { repo, notifier } = harness();
  await notifier.onClientSignup(ADRESSE);
  await notifier.onClientSignup(ADRESSE);
  const journal = await repo.listSubjectEvents(ADRESSE);
  assert.equal(journal.filter((e) => e.templateKey === 'clientWelcome').length, 1);
});

test('un envoi qui ÉCHOUE ne s’inscrit pas', async () => {
  // Un journal d'envois qui consigne un message jamais parti est pire que
  // vide : il fait dire à Nota qu'elle a écrit quand elle n'a pas écrit.
  const { repo, notifier } = harness({ mailer: { async send() { throw new Error('SES down'); } } });
  try { await notifier.onClientSignup(ADRESSE); } catch { /* au mieux */ }
  const journal = await repo.listSubjectEvents(ADRESSE);
  assert.equal(journal.length, 0, 'rien n’est consigné');
});

test('le journal est celui du DESTINATAIRE, pas un registre commun', async () => {
  const { repo, notifier } = harness();
  await notifier.onClientSignup(ADRESSE);
  await notifier.onClientSignup('autre@exemple.ca');

  const mien = await repo.listSubjectEvents(ADRESSE);
  const sien = await repo.listSubjectEvents('autre@exemple.ca');
  assert.equal(mien.length, 1);
  assert.equal(sien.length, 1);
  assert.notDeepEqual(mien[0].id, sien[0].id, 'deux entrées distinctes');
});

test('l’adresse est la clé : casse et espaces ne font pas deux journaux', async () => {
  const { repo, notifier } = harness();
  await notifier.onClientSignup('  Roy@Exemple.CA  ');
  assert.equal((await repo.listSubjectEvents(ADRESSE)).length, 1);
});

test('une panne du journal ne fait PAS échouer l’envoi', async () => {
  // Le courriel est le service ; le journal est la trace. Perdre la trace est
  // grave, refuser d'écrire au client parce que la trace échoue l'est plus.
  const { repo, notifier, envois } = harness();
  repo.appendSubjectEvent = async () => { throw new Error('journal indisponible'); };
  const r = await notifier.onClientSignup(ADRESSE);
  assert.ok(envois.length >= 1, 'le courriel est bien parti');
  assert.ok(r && r.ok !== false, 'et la réponse ne se casse pas dessus');
});
