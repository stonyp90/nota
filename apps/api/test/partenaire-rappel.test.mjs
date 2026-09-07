/**
 * « J'ai perdu mon code » — la reprise du partenaire.
 *
 * Un partenaire n'avait AUCUN compte : son code, son lien et son type vivaient
 * dans un seul enregistrement `nota.partner.v1` du localStorage. Vider son
 * navigateur ou changer d'appareil perdait le tout, définitivement — la seule
 * reprise consistait à re-réclamer le MÊME code depuis la MÊME adresse, ce qui
 * suppose de se souvenir du code qu'on vient justement de perdre.
 *
 * `POST /partenaires/rappel` ferme la boucle : on donne son adresse, le code
 * repart par courriel. Rien de neuf n'est créé, rien n'est modifié — c'est un
 * rappel, pas une réclamation.
 *
 * Les mêmes gardes que les autres portes ouvertes : freinage par IP,
 * anti-énumération (la réponse ne dit jamais si l'adresse est partenaire), et
 * le courriel n'entre pas dans la piste d'audit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const TODAY = '2026-09-05';
const START = Date.parse('2026-09-05T12:00:00.000Z');
const parse = (res) => JSON.parse(res.body);

function harness(opts = {}) {
  let n = 0;
  const clock = { ms: START };
  const repo = createMemoryRepo();
  const envois = [];
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => clock.ms,
    newId: () => 'id-' + ++n,
    siteUrl: 'https://nota.example',
    notifier: {
      async onPartnerCodeReminder(msg) { envois.push(msg); return { ok: true }; },
    },
    ...opts,
  });
  return { app, repo, clock, envois };
}

const rappel = (app, courriel, ip = '9.9.9.9') =>
  app.handle({ method: 'POST', path: '/partenaires/rappel', query: {}, headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ courriel }) });

async function seedPartner(repo, { code = 'MARIE', courriel = 'marie@courtier.ca', type = 'courtier' } = {}) {
  await repo.createPartner({ code, type, courriel, createdAt: '2026-08-01T12:00:00.000Z', confirmedAt: '2026-08-01T12:05:00.000Z' });
}

test('un partenaire confirmé reçoit son code par courriel', async () => {
  const { app, repo, envois } = harness();
  await seedPartner(repo);

  const res = await rappel(app, 'marie@courtier.ca');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { ok: true });

  assert.equal(envois.length, 1, 'un rappel part');
  assert.equal(envois[0].courriel, 'marie@courtier.ca');
  assert.equal(envois[0].code, 'MARIE', 'son code, pas un neuf');
  assert.ok(String(envois[0].link || '').includes('MARIE'), 'et le lien de partage qui va avec');
});

test('la réponse ne dit JAMAIS si l’adresse est partenaire', async () => {
  const { app, repo, envois } = harness();
  await seedPartner(repo);

  const connue = await rappel(app, 'marie@courtier.ca', '1.1.1.1');
  const inconnue = await rappel(app, 'personne@nulle-part.ca', '2.2.2.2');

  assert.deepEqual(parse(connue), parse(inconnue), 'deux réponses indiscernables');
  assert.equal(envois.length, 1, 'mais un seul courriel réellement envoyé');
});

test('l’adresse est la clé : casse et espaces retrouvent la même personne', async () => {
  const { app, repo, envois } = harness();
  await seedPartner(repo);
  await rappel(app, '  Marie@Courtier.CA  ');
  assert.equal(envois.length, 1, 'la même personne, quelle que soit la graphie');
});

test('une réclamation NON confirmée ne se rappelle pas', async () => {
  // Un code seulement réclamé (défi posé, jamais vérifié) n'appartient à
  // personne : le rappeler ferait d'une réclamation en l'air une preuve.
  const { app, repo, envois } = harness();
  await repo.putPartnerClaim({ challengeId: 'c1', code: 'SQUAT', courriel: 'squat@ailleurs.ca', type: 'courtier', expiresAt: START + 60000, consumed: false });
  const res = await rappel(app, 'squat@ailleurs.ca');
  assert.equal(res.statusCode, 200);
  assert.equal(envois.length, 0, 'rien ne part');
});

test('une adresse invalide est refusée sans rien envoyer', async () => {
  const { app, envois } = harness();
  const res = await rappel(app, 'pas-une-adresse');
  assert.equal(res.statusCode, 422);
  assert.equal(parse(res).errors[0].code, 'courriel_invalide');
  assert.equal(envois.length, 0);
});

test('la porte est freinée par IP', async () => {
  const { app, repo } = harness();
  await seedPartner(repo);
  let dernier;
  for (let i = 0; i < 12; i++) dernier = await rappel(app, 'marie@courtier.ca', '7.7.7.7');
  assert.equal(dernier.statusCode, 429);
  assert.equal(parse(dernier).throttled, true);
});

test('le rappel ne CRÉE ni ne MODIFIE rien', async () => {
  const { app, repo } = harness();
  await seedPartner(repo);
  const avant = JSON.stringify(await repo.getPartner('MARIE'));
  await rappel(app, 'marie@courtier.ca');
  assert.equal(JSON.stringify(await repo.getPartner('MARIE')), avant, 'l’enregistrement est intact');
});

test('le rappel laisse une trace, sans le courriel en clair', async () => {
  const { app, repo } = harness();
  await seedPartner(repo);
  await rappel(app, 'marie@courtier.ca');
  const entrees = await repo.queryAuditByDay(TODAY);
  const actions = entrees.map((e) => e.action);
  assert.ok(actions.includes('partenaire_rappel'), 'la demande est journalisée');
  assert.ok(!JSON.stringify(entrees).includes('marie@courtier.ca'), 'le courriel n’entre pas dans la piste');
});
