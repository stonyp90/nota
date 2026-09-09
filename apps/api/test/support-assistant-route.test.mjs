// La messagerie assistée, de bout en bout (ADR 0046).
//
// Ce que le propriétaire a demandé, en une phrase : « répondez tout de suite
// à ce qu'on sait répondre, et escaladez-moi le reste par courriel ». Cette
// suite tient les DEUX moitiés de cette phrase sur la vraie route, parce que
// c'est là que l'une pourrait silencieusement manger l'autre :
//
//   · une réponse propre part avec la requête ET NE RÉVEILLE PERSONNE ;
//   · tout le reste réveille le propriétaire, avec le fil et un lien pour
//     répondre d'un geste ;
//   · un fil escaladé reste « à répondre » tant qu'un humain n'a pas parlé —
//     une machine ne vide pas la boîte de quelqu'un d'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createFakeMailer, createFakeAssistant: _unused } = require('../src/notify-port.js');
const { createNotifier } = require('../src/notifications.js');
const { createFakeAssistant } = require('../src/assistant-port.js');

const TODAY = '2026-08-12';
const NOW_MS = 1_760_000_000_000;
const BASE = 'https://nota.example';

function app({ scenario, ...opts } = {}) {
  let n = 0;
  const repo = createMemoryRepo([]);
  const mailer = createFakeMailer();
  const notifier = createNotifier({ repo, mailer, baseUrl: BASE, operatorEmail: 'ops@nota.ca', now: () => TODAY });
  const port = scenario === undefined ? undefined : scenario === null ? null : createFakeAssistant(scenario);
  return {
    ...createApp(repo, {
      now: () => TODAY,
      nowMs: () => NOW_MS,
      newId: () => 'id-' + ++n,
      notifier,
      supportUrl: BASE,
      env: { ...process.env, NOTA_OPERATOR_NAME: 'Anthony', NOTA_OPERATOR_EMAIL: 'ops@nota.ca' },
      ...(port ? { assistantPort: port } : {}),
      ...opts,
    }),
    repo,
    mailer,
    port,
  };
}

const parse = (res) => JSON.parse(res.body);
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};
const ask = (a, texte, extra = {}, token) =>
  a.handle({
    method: 'POST',
    path: '/support/messages',
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: JSON.stringify({ texte, ...extra }),
  });

const REPOND = {
  repond: true, niveau: 2, motif: null,
  texte: 'Le prix affiché est le total : les honoraires du notaire et le service de Nota. Vous ne payez qu’à la signature.',
};
const ESCALADE = { repond: false, niveau: null, motif: 'dossier_precis', texte: 'Je passe la question à Anthony.' };

// --- 1. La moitié « on répond tout de suite » --------------------------------

test('une question couverte reçoit sa réponse DANS la requête, et ne réveille personne', async () => {
  const a = app({ scenario: REPOND });
  const res = await ask(a, 'Le prix comprend quoi ?');
  assert.equal(res.statusCode, 201);
  const body = parse(res);
  assert.equal(body.reponse.de, domain.SUPPORT_FROM.ASSISTANT);
  assert.equal(body.reponse.texte, REPOND.texte);
  assert.equal(body.escalade, false);
  await flush();
  assert.equal(a.mailer.sent.length, 0, 'le propriétaire n’est PAS dérangé pour une question couverte');
});

test('la réponse est dans le fil, à sa place, et le fil reste « à répondre »', async () => {
  const a = app({ scenario: REPOND });
  const { token, threadId } = parse(await ask(a, 'Le prix comprend quoi ?'));
  const fil = parse(await a.handle({ method: 'GET', path: '/support/thread', headers: { authorization: 'Bearer ' + token } }));
  assert.deepEqual(fil.messages.map((m) => m.de), [domain.SUPPORT_FROM.VISITEUR, domain.SUPPORT_FROM.ASSISTANT]);
  const stored = await a.repo.getSupportThread(threadId);
  // Le statut vit sur l'item stocké : une réponse de machine ne le bouge pas.
  assert.equal(stored.statut, domain.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(fil.escalade, false);
  assert.equal(fil.humain, false);
});

test('la langue du visiteur voyage jusqu’au modèle', async () => {
  const a = app({ scenario: REPOND });
  await ask(a, 'What does the price include?', { locale: 'en' });
  assert.equal(a.port.calls[0].locale, 'en');
});

test('l’historique du fil voyage, sans le message qu’on vient d’écrire', async () => {
  const a = app({ scenario: REPOND });
  const { token } = parse(await ask(a, 'Première question ?'));
  await ask(a, 'Deuxième question ?', {}, token);
  const deuxieme = a.port.calls[1];
  assert.equal(deuxieme.question, 'Deuxième question ?');
  assert.deepEqual(deuxieme.historique.map((m) => m.de), [domain.SUPPORT_FROM.VISITEUR, domain.SUPPORT_FROM.ASSISTANT]);
  assert.equal(deuxieme.historique[0].texte, 'Première question ?');
});

test('l’invite système que le modèle reçoit porte les prix vivants', async () => {
  const a = app({ scenario: REPOND });
  await ask(a, 'Combien ?');
  const invite = a.port.calls[0].systeme;
  for (const svc of domain.SERVICES) {
    assert.ok(invite.includes(String(domain.prixAnnonce(svc.id).totalCents)), `${svc.id}`);
  }
  assert.ok(invite.includes('Anthony'), 'et le nom de qui reprend la main');
});

// --- 2. La moitié « escaladez-moi le reste » ---------------------------------

test('une question non couverte réveille le propriétaire, avec le fil et un lien de réponse', async () => {
  const a = app({ scenario: ESCALADE });
  const res = parse(await ask(a, 'Où en est mon dossier 4821 ?', { courriel: 'client@example.ca' }));
  assert.equal(res.escalade, true);
  assert.equal(res.reponse.texte, ESCALADE.texte, 'le visiteur sait tout de suite qu’un humain reprend');
  await flush();
  assert.equal(a.mailer.sent.length, 1);
  const mail = a.mailer.sent[0];
  assert.equal(mail.to, 'ops@nota.ca');
  assert.match(mail.html, /#reponse=/, 'le lien de réponse signé est là');
  assert.match(mail.text, /Où en est mon dossier 4821/, 'la question est dans le courriel');
  assert.match(mail.text, /Assistant/, 'et ce que l’assistant a répondu');
  assert.match(mail.text, /client@example\.ca/, 'et l’adresse du visiteur');
});

test('un fil escaladé reste « à répondre » : une machine ne vide pas la boîte', async () => {
  const a = app({ scenario: ESCALADE });
  const { threadId } = parse(await ask(a, 'Où en est mon dossier ?'));
  const stored = await a.repo.getSupportThread(threadId);
  assert.equal(stored.statut, domain.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(stored.escalade, true);
  assert.equal(stored.escaladeMotif, 'dossier_precis');
});

test('la réponse de l’humain ferme l’escalade', async () => {
  const a = app({ scenario: ESCALADE });
  const { threadId } = parse(await ask(a, 'Où en est mon dossier ?'));
  await flush();
  const token = /#reponse=([^"'&\s]+)/.exec(a.mailer.sent[0].html)[1];
  const res = await a.handle({
    method: 'POST',
    path: '/support/reply',
    headers: { authorization: 'Bearer ' + decodeURIComponent(token) },
    body: JSON.stringify({ texte: 'Bonjour, c’est Anthony — je regarde ça.' }),
  });
  assert.equal(res.statusCode, 200);
  const stored = await a.repo.getSupportThread(threadId);
  assert.equal(stored.statut, domain.SUPPORT_STATUT.REPONDU);
  assert.equal(stored.escalade, false);
});

test('a pending handoff survives refresh and follow-up questions without another assistant answer', async () => {
  const a = app({ scenario: REPOND });
  const first = parse(await ask(a, 'Je veux parler à une personne.', { courriel: 'client@example.ca' }));
  assert.equal(first.escalade, true);
  assert.equal(first.humain, false);
  assert.equal(a.port.calls.length, 0, 'an explicit human request bypasses the model');
  const read = () => a.handle({ method: 'GET', path: '/support/thread', headers: { authorization: 'Bearer ' + first.token } }).then(parse);
  const before = await read();
  assert.equal(before.escalade, true, 'a refreshed widget can restore the pending handoff');
  assert.equal(before.humain, false);
  const initialReply = before.messages.find((message) => message.de === domain.SUPPORT_FROM.ASSISTANT);
  assert.ok(initialReply, 'the initial handoff is acknowledged');

  const next = parse(await ask(a, 'Le prix comprend quoi ?', {}, first.token));
  assert.equal(next.escalade, true);
  assert.equal(next.humain, false);
  assert.equal(next.reponse, undefined, 'the assistant does not rejoin while a person is expected');
  assert.equal(a.port.calls.length, 0, 'the follow-up costs no model request');
  const after = await read();
  assert.equal(after.escalade, true);
  assert.deepEqual(after.messages.map((message) => message.de), ['visiteur', 'assistant', 'visiteur']);
  await flush();
  const notices = a.mailer.sent.filter((mail) => mail.to === 'ops@nota.ca');
  assert.equal(notices.length, 2, 'the operator receives the follow-up, too');
  assert.match(notices[1].text, /Le prix comprend quoi/);
  assert.match(notices[1].text, /Je veux parler à une personne/);
});

test('a human keeps the conversation after replying, including questions the assistant could answer', async () => {
  const a = app({ scenario: ESCALADE });
  const first = parse(await ask(a, 'Où en est mon dossier ?', { courriel: 'client@example.ca' }));
  await flush();
  const opToken = decodeURIComponent(/#reponse=([^"'&\s]+)/.exec(a.mailer.sent[0].html)[1]);
  await a.handle({ method: 'POST', path: '/support/reply', headers: { authorization: 'Bearer ' + opToken }, body: JSON.stringify({ texte: 'Bonjour, je prends votre question en charge.' }) });
  const answered = parse(await a.handle({ method: 'GET', path: '/support/thread', headers: { authorization: 'Bearer ' + first.token } }));
  assert.equal(answered.escalade, false);
  assert.equal(answered.humain, true);
  const previousCalls = a.port.calls.length;
  const next = parse(await ask(a, 'Le prix comprend quoi ?', {}, first.token));
  assert.equal(next.escalade, false);
  assert.equal(next.humain, true);
  assert.equal(next.reponse, undefined);
  assert.equal(a.port.calls.length, previousCalls, 'no bot interruption after a real reply');
  await flush();
  assert.equal(a.mailer.sent.filter((mail) => mail.to === 'ops@nota.ca').length, 2);
  const stored = await a.repo.getSupportThread(first.threadId);
  assert.equal(stored.statut, domain.SUPPORT_STATUT.A_REPONDRE, 'the inbox still shows the new visitor question');
  assert.deepEqual(stored.messages.map((message) => message.de), ['visiteur', 'assistant', 'nota', 'visiteur']);
});

test('human ownership requires an actual operator message and ignores client-supplied status', async () => {
  const a = app({ scenario: REPOND });
  const result = parse(await ask(a, 'Le prix comprend quoi ?', { humain: true, escalade: true }));
  assert.equal(result.humain, false);
  assert.equal(result.escalade, false);
  assert.ok(result.reponse, 'a visitor cannot forge operator presence through the payload');
  assert.equal(a.port.calls.length, 1);
});

test('une panne du modèle escalade au lieu de perdre la question', async () => {
  const a = app({ scenario: { throw: 'timeout' } });
  const res = await ask(a, 'Bonjour ?');
  assert.equal(res.statusCode, 201, 'le visiteur ne voit jamais la panne');
  assert.equal(parse(res).escalade, true);
  await flush();
  assert.equal(a.mailer.sent.length, 1, 'et le propriétaire est prévenu');
});

test('a secret-resolution outage still saves the question and notifies a person', async () => {
  let secretReads = 0;
  const a = app({
    env: { NOTA_ASSISTANT_KEY_PARAM: '/nota/assistant-key', NOTA_OPERATOR_EMAIL: 'ops@nota.ca' },
    secrets: { async get() { secretReads++; throw new Error('secret backend unavailable'); } },
  });
  const result = await ask(a, 'Je voudrais une précision sur ce fonctionnement.');
  assert.equal(result.statusCode, 201);
  const body = parse(result);
  assert.equal(secretReads, 1);
  assert.equal(body.escalade, true);
  assert.equal(body.humain, false);
  assert.ok(body.reponse);
  assert.ok(!body.reponse.texte.includes('secret backend'), 'internal error details are not sent to the visitor');
  const saved = await a.repo.getSupportThread(body.threadId);
  assert.equal(saved.messages[0].texte, 'Je voudrais une précision sur ce fonctionnement.');
  assert.equal(saved.escalade, true);
  await flush();
  assert.equal(a.mailer.sent.filter((mail) => mail.to === 'ops@nota.ca').length, 1);
});

test('une réponse qui franchit une ligne est jetée : elle escalade au lieu de sortir', async () => {
  const a = app({
    scenario: { repond: true, niveau: 3, motif: null, texte: 'Vous devriez signer avant la fin du mois.' },
  });
  const res = parse(await ask(a, 'Je fais quoi ?'));
  assert.equal(res.escalade, true);
  assert.ok(!/vous devriez/i.test(res.reponse.texte), 'le conseil ne sort jamais du serveur');
  await flush();
  assert.equal(a.mailer.sent.length, 1);
});

// --- 3. Sans assistant configuré, rien ne change -----------------------------

test('sans clé, la messagerie se comporte exactement comme avant : pas de bulle, un courriel', async () => {
  const a = app({ scenario: undefined, env: { NOTA_OPERATOR_EMAIL: 'ops@nota.ca' } });
  const res = parse(await ask(a, 'Bonjour ?'));
  assert.equal(res.reponse, undefined, 'aucune bulle inventée');
  assert.equal(res.escalade, false, 'human-only mode is not an invented assistant handoff');
  assert.equal(res.humain, false, 'a person has not replied yet');
  const stored = await a.repo.getSupportThread(res.threadId);
  assert.equal(stored.messages.length, 1);
  assert.equal(stored.escalade, false, 'rien n’a examiné la question : ce n’est pas une escalade');
  await flush();
  assert.equal(a.mailer.sent.length, 1, 'et le propriétaire reçoit la question, comme avant');
});

// --- 4. Ce que l'assistant fait est COMPTÉ -----------------------------------

// Somme des fragments de la journée : le compteur global est réparti sur
// STATS_SHARDS partitions, et le côté lecture les additionne.
async function compteurs(a) {
  const { STATS_SHARDS, statsGlobalPK, statsDaySK } = require('../src/keys.js');
  const total = {};
  for (let i = 0; i < STATS_SHARDS; i++) {
    const items = await a.repo.queryStats(statsGlobalPK(i), statsDaySK(TODAY), statsDaySK(TODAY));
    for (const it of items) {
      for (const [k, v] of Object.entries(it)) {
        if (k.startsWith('assistant_')) total[k] = (total[k] || 0) + Number(v || 0);
      }
    }
  }
  return total;
}

test('une réponse et une escalade sont comptées séparément, avec le motif', async () => {
  // Sans ces compteurs, la seule chose que le propriétaire voit de l'assistant
  // est ce qu'il n'a PAS su traiter : exactement la moitié qui donne
  // l'impression qu'il ne sert à rien.
  const a = app({ scenario: REPOND });
  await ask(a, 'Le prix comprend quoi ?');
  const b = app({ scenario: ESCALADE });
  await ask(b, 'Où en est mon dossier ?');

  const ok = await compteurs(a);
  const esc = await compteurs(b);
  assert.equal(ok.assistant_repondu, 1, 'une réponse est comptée : ' + JSON.stringify(ok));
  assert.ok(!ok.assistant_escalade, 'et pas comme une escalade');
  assert.equal(esc.assistant_escalade, 1, 'une escalade est comptée : ' + JSON.stringify(esc));
  assert.equal(esc.assistant_motif_dossier_precis, 1, 'avec SON motif — pour savoir quoi documenter ensuite');
});

test('un motif inventé ne crée jamais son compteur', async () => {
  const a = app({ scenario: { repond: false, niveau: null, motif: 'motif_bidon', texte: 'Je passe.' } });
  await ask(a, '?');
  const c = await compteurs(a);
  assert.equal(c.assistant_escalade, 1);
  assert.ok(!Object.keys(c).some((k) => k.includes('bidon')), 'un modèle ne peut pas minter un compteur');
});

test('les jetons du modèle sont comptés : c’est la facture', async () => {
  const a = app({ scenario: { ...REPOND, usage: { in: 1200, out: 90, cacheRead: 1100 } } });
  await ask(a, 'Combien ?');
  const c = await compteurs(a);
  assert.equal(c.assistant_jetons_entree, 1200);
  assert.equal(c.assistant_jetons_sortie, 90);
  assert.equal(c.assistant_jetons_cache, 1100, 'la mise en cache de l’invite se voit, ou elle ne sert à rien');
});
