/**
 * LE DOSSIER D'UNE PERSONNE — accès, portabilité, effacement (Loi 25).
 *
 * L'audit du 2026-09-05 : « un opérateur ne peut pas répondre à “que détenez-vous
 * sur moi ?”, qui est la première question que la Loi 25 donne à tout résident
 * du Québec ». Il avait raison, et le trou était plus profond qu'annoncé —
 * l'index CLIENT#, que les commentaires du dépôt désignent comme ce qui rend une
 * demande d'accès EXÉCUTABLE, était implémenté, testé, et n'avait NI LECTEUR NI
 * ÉCRIVAIN : aucune offre publiée ne s'y indexait. Il était vide en production.
 *
 * Ce que cette suite tient, dans l'ordre où ça compte :
 *   1. publier une offre INDEXE la personne — sans ça, tout le reste est vide ;
 *   2. le dossier s'assemble par une Query sur l'index, jamais par un balayage ;
 *   3. sans 'pii:read', ce qui nomme quelqu'un est MASQUÉ, comme au registre des
 *      destinataires de campagne ;
 *   4. l'export est structuré, complet, et laisse une trace de QUI a exporté ;
 *   5. l'effacement N'EST PAS INCONDITIONNEL, il ne ment jamais sur ce qu'il a
 *      fait, et il ne détruit jamais ce que la loi oblige à garder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const keys = require('../src/keys.js');
const { createApp } = require('../src/handler.js');
const { createAdminApp } = require('../src/admin-handler.js');
const { createAdmin } = require('../src/admin.js');
const { createAnalytics } = require('../src/analytics.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const authDefaults = require('../src/admin-auth.js');

const START = Date.parse('2026-09-05T12:00:00.000Z');
const TODAY = '2026-09-05';
const parse = (res) => JSON.parse(res.body);
const COURRIEL = 'roy@exemple.ca';

const OFFRE = {
  serviceId: 'refinancement',
  dateISO: '2026-12-01',
  montant: 2000,
  nom: 'Éveline Roy',
  courriel: COURRIEL,
  telephone: '418 555-0100',
  prefixe: 'G1R',
  pricing: { valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', deplacement: 'client_50' },
};

// --- Les deux applications, sur le MÊME dépôt -------------------------------
// La console lit ce que l'API publique a écrit : c'est tout l'intérêt.
function make() {
  const repo = createMemoryRepo();
  const clock = { ms: START };
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => clock.ms,
    config: { allowlist: ['ops@nota.ca', 'analyst@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const app = createAdminApp(repo, {
    admin,
    analytics: createAnalytics({ repo, now: () => TODAY }),
    adminBaseUrl: 'https://admin.nota.ca',
    now: () => TODAY,
    nowMs: () => clock.ms,
  });
  const publique = createApp(repo, { now: () => TODAY, nowMs: () => clock.ms });
  const call = (method, path, { bearer, query, body } = {}) =>
    app.handle({
      method,
      path,
      query: query || {},
      headers: bearer ? { authorization: `Bearer ${bearer}`, 'x-forwarded-for': '1.2.3.4' } : { 'x-forwarded-for': '1.2.3.4' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, admin, app, publique, clock, call };
}

async function login(h, email = 'ops@nota.ca') {
  const req = parse(await h.app.handle({ method: 'POST', path: '/admin/auth/request', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ email }) }));
  const token = decodeURIComponent(req.devLink.split('token=')[1]);
  return parse(await h.app.handle({ method: 'POST', path: '/admin/auth/verify', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ token }) })).session;
}

// Un opérateur SANS 'pii:read' : il porte les deux clés du dossier, et rien de
// plus. C'est le cas qui doit masquer.
async function loginSansPii(h) {
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false,
    createdAt: new Date(START).toISOString(), permissions: ['subjects:read', 'subjects:erase'],
  });
  return login(h, email);
}

async function publier(h, extra = {}) {
  const res = await h.publique.handle({
    method: 'POST', path: '/bids', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ ...OFFRE, ...extra }),
  });
  assert.equal(res.statusCode, 201, res.body);
  return parse(res).bid;
}

// ===========================================================================
// 1. LA COLONNE VERTÉBRALE : publier indexe la personne
// ===========================================================================

test('publier une offre INDEXE la personne — sans écrivain, l’index est vide et le droit d’accès est théorique', async () => {
  const h = make();
  const bid = await publier(h);
  const offres = await h.repo.listClientBids(COURRIEL);
  assert.deepEqual(offres.map((o) => o.bidId), [bid.id]);
  assert.equal(offres[0].dateISO, OFFRE.dateISO);
});

test('le pointeur d’index meurt AVEC l’offre qu’il indexe', async () => {
  const h = make();
  const bid = await publier(h);
  const stocke = await h.repo.get(bid.id, OFFRE.dateISO);
  const [pointeur] = await h.repo.listClientBids(COURRIEL);
  assert.equal(pointeur.ttl, stocke.ttl, 'l’index et l’offre n’expirent pas ensemble');
  assert.equal(pointeur.ttl, keys.bidTtl(OFFRE.dateISO));
});

test('l’adresse est la CLÉ : la casse et les espaces ne créent pas deux personnes', async () => {
  const h = make();
  await publier(h, { courriel: '  Roy@Exemple.CA  ' });
  assert.equal((await h.repo.listClientBids(COURRIEL)).length, 1);
});

test('une offre SANS adresse ne fait pas tomber la publication', async () => {
  // L'index est un service, pas une condition : une offre sans courriel se
  // publie, elle n'est simplement pas retrouvable par adresse.
  const h = make();
  const res = await h.publique.handle({
    method: 'POST', path: '/bids', query: {}, headers: { 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ ...OFFRE, courriel: undefined }),
  });
  assert.equal(res.statusCode, 201, res.body);
});

// ===========================================================================
// 2. LE DOSSIER
// ===========================================================================

test('le dossier ouvre UNE personne et rassemble ce qui la concerne', async () => {
  const h = make();
  const bid = await publier(h);
  const session = await login(h);

  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);

  assert.equal(body.courriel, COURRIEL);
  assert.equal(body.enClair, true, 'un super_admin porte pii:read');
  assert.deepEqual(body.offres.map((o) => o.id), [bid.id]);

  const dossier = body.offres[0];
  assert.equal(dossier.nom, 'Éveline Roy');
  assert.equal(dossier.telephone, '418 555-0100');
  assert.equal(dossier.montant, 2000);
  // Les registres qui n'ont rien pour cette personne répondent VIDE, pas absent :
  // « nous n'avons rien » et « nous n'avons pas regardé » ne se confondent pas.
  assert.ok(Array.isArray(body.journalConsentement));
  assert.ok(Array.isArray(body.journalEnvois));
  assert.ok(Array.isArray(body.journalAudit));
  assert.equal(body.desabonne, false);
  assert.equal(body.effacement, null);
});

test('une porte du dossier ne résout la session QU’UNE FOIS', async () => {
  // Deux résolutions par requête, c'est deux lectures d'identité, deux lectures
  // de session et DEUX glissements de la fenêtre d'inactivité pour un seul
  // geste — une session inactive resterait vivante plus longtemps qu'annoncé.
  const h = make();
  await publier(h);
  const session = await login(h);
  let touches = 0;
  const vrai = h.repo.touchAdminSession;
  h.repo.touchAdminSession = async (...args) => { touches += 1; return vrai(...args); };
  await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  assert.equal(touches, 1, 'la session a été résolue plusieurs fois pour une seule requête');
});

test('le dossier rend la CONVERSATION, pas seulement son décompte', async () => {
  // L'art. 27 donne accès aux renseignements, pas à leur total : « vous avez
  // échangé 3 messages » ne répond pas à « que détenez-vous sur moi ? ».
  const h = make();
  const bid = await publier(h);
  const vivante = await h.repo.get(bid.id, OFFRE.dateISO);
  await h.repo.update({
    ...vivante,
    messages: [{ id: 'm1', de: 'client', texte: 'Bonjour, quand signons-nous ?', createdAt: '2026-09-05T13:00:00.000Z' }],
  });
  const session = await login(h);
  const body = parse(await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session }));
  const o = body.offres[0];
  assert.equal(o.messagesCount, 1);
  assert.equal(o.messages[0].texte, 'Bonjour, quand signons-nous ?');
});

test('sans « pii:read », la conversation est retirée mais son EXISTENCE est dite', async () => {
  // Cacher jusqu'au fait qu'une conversation existe ferait croire à l'opérateur
  // que Nota n'en détient aucune.
  const h = make();
  const bid = await publier(h);
  const vivante = await h.repo.get(bid.id, OFFRE.dateISO);
  await h.repo.update({
    ...vivante,
    messages: [{ id: 'm1', de: 'client', texte: 'Un secret', createdAt: '2026-09-05T13:00:00.000Z' }],
  });
  const session = await loginSansPii(h);
  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  const o = parse(res).offres[0];
  assert.equal(o.messagesCount, 1, 'l’existence de la conversation doit rester visible');
  assert.equal(o.messages, null);
  assert.equal(res.body.includes('Un secret'), false, 'le contenu d’un message a fui');
});

test('le dossier NOMME ses sources, y compris celles qu’il ne peut pas encore joindre', async () => {
  // Un dossier qui tait ce qu'il n'a pas regardé ment par omission : l'opérateur
  // croirait avoir tout vu.
  const h = make();
  await publier(h);
  const session = await login(h);
  const body = parse(await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session }));

  assert.ok(Array.isArray(body.sources) && body.sources.length > 0, 'le dossier ne dit pas d’où il vient');
  for (const s of body.sources) {
    assert.ok(s.famille, 'une source sans famille');
    assert.equal(typeof s.joignable, 'boolean', 'une source doit dire si elle est joignable par sujet');
    if (!s.joignable) assert.ok(s.note, 'une source non joignable doit dire pourquoi');
  }
  const soutien = body.sources.find((s) => s.famille === 'fil_soutien');
  assert.ok(soutien && soutien.joignable === false, 'les fils de soutien n’ont pas d’index par sujet : il faut le DIRE');
});

test('une lecture d’audit TRONQUÉE le dit — sinon elle passerait pour complète', async () => {
  // Le journal est partitionné par jour, et chaque journée coûte quatre Query :
  // la lecture est bornée. Une lecture partielle qui se présente comme complète
  // est exactement le mensonge que la liste des sources existe pour empêcher.
  const h = make();
  // Assez d'offres, sur assez de journées distinctes, pour dépasser la borne.
  for (let i = 0; i < 20; i += 1) {
    const jour = `2026-1${i < 10 ? '0' : '1'}-${String((i % 20) + 1).padStart(2, '0')}`;
    await publier(h, { dateISO: jour });
  }
  const session = await login(h);
  const body = parse(await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session }));
  const audit = body.sources.find((s) => s.famille === 'journal_audit');
  assert.equal(audit.joignable, false, 'une lecture tronquée est annoncée comme joignable');
  assert.match(audit.note, /n’ont PAS été relues/);
});

test('une personne inconnue rend un dossier VIDE, jamais une erreur', async () => {
  const h = make();
  const session = await login(h);
  const res = await h.call('GET', '/admin/usagers/inconnue%40exemple.ca', { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.deepEqual(body.offres, []);
  assert.equal(body.effacement, null);
});

test('une adresse mal formée est refusée avant de toucher au dépôt', async () => {
  const h = make();
  const session = await login(h);
  const res = await h.call('GET', '/admin/usagers/%20', { bearer: session });
  assert.equal(res.statusCode, 422, res.body);
});

// ===========================================================================
// 3. RBAC et masquage
// ===========================================================================

test('sans session, le dossier est fermé', async () => {
  const h = make();
  assert.equal((await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`)).statusCode, 401);
});

test('sans « subjects:read », le dossier est INTERDIT — pas masqué, interdit', async () => {
  const h = make();
  await publier(h);
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false, createdAt: new Date(START).toISOString() });
  const session = await login(h, email);
  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  assert.equal(res.statusCode, 403, res.body);
});

test('avec « subjects:read » mais SANS « pii:read », tout ce qui nomme est MASQUÉ', async () => {
  const h = make();
  await publier(h);
  const session = await loginSansPii(h);
  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);

  assert.equal(body.enClair, false);
  // Reconnaissable, jamais expédiable — exactement le masque du registre des
  // destinataires de campagne.
  assert.notEqual(body.courriel, COURRIEL);
  assert.match(body.courriel, /^r•••@exemple\.ca$/);

  const o = body.offres[0];
  assert.notEqual(o.nom, 'Éveline Roy', 'le nom en clair a fui');
  assert.notEqual(o.telephone, '418 555-0100', 'le téléphone en clair a fui');
  assert.equal(o.dossier, null, 'le dossier du client a fui');
  // Ce qui ne nomme personne reste lisible : sans ça l'écran ne sert à rien.
  assert.equal(o.montant, 2000);
  assert.equal(o.dateISO, OFFRE.dateISO);
  // Le SECTEUR POSTAL reste lisible : le carnet public l'affiche sur chaque
  // offre. Le masquer ici ferait croire que Nota le garde secret.
  assert.equal(o.prefixe, 'G1R');
});

test('aucune valeur nominative en clair ne traverse la réponse masquée', async () => {
  // Le filet : plutôt que d'énumérer les champs, on relit TOUTE la réponse.
  const h = make();
  await publier(h);
  const session = await loginSansPii(h);
  const brut = (await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session })).body;
  for (const secret of [COURRIEL, 'Éveline Roy', '418 555-0100']) {
    assert.equal(brut.includes(secret), false, `« ${secret} » a fui dans une réponse masquée`);
  }
});

// ===========================================================================
// 4. L'EXPORT (droit à la portabilité)
// ===========================================================================

test('l’export rend une structure lisible par une machine, complète et datée', async () => {
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  const res = await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}/export`, { bearer: session });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);

  assert.equal(body.courriel, COURRIEL);
  assert.equal(body.genereLe, new Date(START).toISOString());
  assert.equal(body.format, 'nota.dossier-usager.v1', 'un export sans version ne se relit pas dans dix ans');
  assert.deepEqual(body.dossier.offres.map((o) => o.id), [bid.id]);
  // La politique voyage AVEC l'export : la personne doit pouvoir lire combien de
  // temps chaque chose est gardée, sans avoir à demander.
  assert.ok(Array.isArray(body.conservation) && body.conservation.length > 0);
  assert.ok(body.conservation.every((l) => l.famille && (l.jours === null || l.jours > 0)));
});

test('un export laisse une trace : qui, quoi, quand', async () => {
  const h = make();
  await publier(h);
  const session = await login(h);
  await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}/export`, { bearer: session });

  const entrees = await h.repo.queryAuditByDay(TODAY);
  const trace = entrees.find((e) => e.action === 'dossier_usager_exporte');
  assert.ok(trace, 'un export sans trace est un export qu’on ne peut pas reprocher');
  assert.equal(trace.email, 'ops@nota.ca');
  assert.equal(trace.meta.offres, 1, 'la trace doit dire COMBIEN a été exporté');
  // Le sujet est nommé par une EMPREINTE : la trace prouve l'export sans faire
  // du journal d'audit un second annuaire d'adresses (le journal se lit avec
  // 'audit:read', délibérément distinct de 'pii:read').
  assert.ok(trace.meta.sujet && !String(trace.meta.sujet).includes('@'), 'l’adresse en clair a fui dans le journal');
});

test('l’export exige la même permission que le dossier', async () => {
  const h = make();
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({ id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false, createdAt: new Date(START).toISOString() });
  const session = await login(h, email);
  assert.equal((await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}/export`, { bearer: session })).statusCode, 403);
});

// ===========================================================================
// 5. L'EFFACEMENT
// ===========================================================================

test('l’effacement se PRÉVISUALISE avant de s’exécuter — on ne détruit pas à l’aveugle', async () => {
  const h = make();
  await publier(h);
  const session = await login(h);
  const res = await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: {} });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.execute, false, 'sans confirmation, RIEN ne doit être détruit');
  assert.ok(body.plan, 'la prévisualisation doit rendre le plan');
  assert.equal(await h.repo.getErasure(COURRIEL), null, 'une prévisualisation a laissé une marque');
});

test('l’effacement confirmé efface l’offre effaçable et laisse sa marque', async () => {
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  const res = await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } });
  assert.equal(res.statusCode, 200, res.body);
  const body = parse(res);
  assert.equal(body.execute, true);

  const efface = await h.repo.get(bid.id, OFFRE.dateISO);
  assert.equal(efface.courriel, null);
  assert.equal(efface.nom, null);
  assert.equal(efface.telephone, null);
  assert.equal(efface.dossier, null);
  assert.equal(efface.efface, true);
  assert.equal(efface.effaceLe, new Date(START).toISOString());
  // Ce qui ne nomme personne survit : le carnet et les compteurs ne se trouent pas.
  assert.equal(efface.montant, 2000);
  assert.equal(efface.ttl, keys.bidTtl(OFFRE.dateISO), 'l’offre effacée est devenue ÉTERNELLE');

  const marque = await h.repo.getErasure(COURRIEL);
  assert.ok(marque, 'aucune marque d’effacement');
  assert.equal(marque.at, new Date(START).toISOString());
});

test('un ACTE RÉGLÉ n’est PAS effacé, et la réponse le dit franchement', async () => {
  const h = make();
  const bid = await publier(h);
  await h.repo.markActCompleted(bid.id, { bidId: bid.id, actAmount: 2000, at: new Date(START).toISOString() });
  const session = await login(h);
  const body = parse(await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } }));

  assert.equal(body.plan.complet, false, 'un effacement partiel doit se déclarer partiel');
  const garde = body.plan.conserve.find((l) => l.famille === 'offre');
  assert.ok(garde && garde.ids.includes(bid.id));
  assert.ok(garde.motif && garde.base, 'une conservation doit se motiver');

  // Et surtout : l'offre est INTACTE. Le mensonge à ne jamais commettre est
  // d'annoncer un effacement complet en ayant tout gardé.
  const intacte = await h.repo.get(bid.id, OFFRE.dateISO);
  assert.equal(intacte.courriel, COURRIEL);
  assert.equal(intacte.efface, undefined);
  assert.deepEqual(body.effacees, [], 'aucune offre ne devait être effacée');
});

test('l’effacement ne prétend jamais avoir effacé ce qu’il n’a pas pu effacer', async () => {
  // Le dépôt refuse l'écriture (en production : le rôle IAM de la console est
  // en LECTURE SEULE sur la table client). La réponse doit dire « en attente »,
  // jamais « effacé ».
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  const casse = { ...h.repo, update: async () => { throw new Error('AccessDeniedException'); } };
  const admin2 = createAdmin({
    repo: casse, mailer: { send: async () => {} }, newId: () => 'x', nowMs: () => START,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true },
  });
  const res = await admin2.eraseUserFile(session, COURRIEL, { confirmer: true, ip: '1.2.3.4' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.effacees, [], 'une offre non écrite est annoncée effacée');
  assert.deepEqual(res.enAttente, [bid.id]);
  assert.ok(res.avertissement, 'un effacement partiellement exécuté doit le DIRE');
});

test('l’effacement laisse une entrée d’audit qui dit qui, quoi, quand', async () => {
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } });

  const trace = (await h.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'dossier_usager_efface');
  assert.ok(trace, 'un effacement sans trace est ineffaçable à prouver');
  assert.equal(trace.email, 'ops@nota.ca');
  assert.deepEqual(trace.meta.effacees, [bid.id]);
  assert.ok(!String(trace.meta.sujet).includes('@'), 'l’adresse en clair a fui dans le journal');
});

test('effacer demande « subjects:erase » — lire n’autorise pas à détruire', async () => {
  const h = make();
  await publier(h);
  const email = 'analyst@nota.ca';
  await h.repo.putAdmin({
    id: authDefaults.adminIdForEmail(email), email, role: 'analyst', disabled: false,
    createdAt: new Date(START).toISOString(), permissions: ['subjects:read'],
  });
  const session = await login(h, email);
  const res = await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } });
  assert.equal(res.statusCode, 403, res.body);
});

test('un second effacement est sans effet et ne repousse pas la première date', async () => {
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } });
  h.clock.ms = START + 60000; // une minute : assez pour bouger l’horloge, pas assez pour expirer la session
  const body = parse(await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } }));

  const offre = await h.repo.get(bid.id, OFFRE.dateISO);
  assert.equal(offre.effaceLe, new Date(START).toISOString(), 'la date du premier effacement a bougé');
  assert.deepEqual(body.effacees, [], 'une offre déjà effacée est recomptée comme effacée');
});

test('après effacement, le dossier DIT qu’il a été effacé — « effacé » ≠ « jamais connu »', async () => {
  const h = make();
  await publier(h);
  const session = await login(h);
  await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } });

  const body = parse(await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session }));
  assert.ok(body.effacement, 'la marque d’effacement n’apparaît pas au dossier');
  assert.equal(body.effacement.at, new Date(START).toISOString());
  assert.equal(body.offres[0].efface, true);
});

test('le plan d’effacement rendu par la route EST celui du domaine', async () => {
  // La console ne réinvente aucune règle : la frontière est au domaine, testée
  // là-bas, et la route la rend telle quelle.
  const h = make();
  const bid = await publier(h);
  const session = await login(h);
  const body = parse(await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: {} }));
  const attendu = domain.erasurePlan({
    courriel: COURRIEL,
    offres: [{ id: bid.id, dateISO: OFFRE.dateISO, status: 'ouverte', acteComplete: false }],
    at: new Date(START).toISOString(),
  });
  assert.deepEqual(body.plan, attendu);
});

// ===========================================================================
// 6. CE QUE L'EFFACEMENT NE SAIT PAS FAIRE — prouvé par le dépôt
// ===========================================================================

test('un effacement « exécuté » laisse l’adresse en clair dans les registres hors de portée — et le plan le DIT', async () => {
  // LA RÉGRESSION QUE CE TEST GARDE. Le plan rangeait `avis`, `journal_sujet` et
  // `destinataire_campagne` sous « ce qui sera effacé », se déclarait COMPLET, et
  // la console disait « Dossier effacé » — alors qu'aucune porte de suppression
  // n'existe pour ces familles dans l'un ou l'autre adaptateur. L'assertion se
  // fait sur le DÉPÔT, pas sur la réponse : c'est la survie réelle qui compte.
  const h = make();
  const bid = await publier(h);
  const quand = new Date(START).toISOString();
  await h.repo.appendNotification({ id: 'n1', sujet: keys.clientNotifSubject(bid.id), kind: 'proposition', titre: 'Une proposition', at: quand });
  await h.repo.appendSubjectEvent({ id: 'e1', sujet: COURRIEL, kind: 'transactionnel', templateKey: 'j0', at: quand });
  await h.repo.appendCampaignRecipient({ campagneId: 'c1', courriel: COURRIEL, templateKey: 'promo', nature: 'commercial', at: quand });

  const session = await login(h);
  const body = parse(await h.call('POST', `/admin/usagers/${encodeURIComponent(COURRIEL)}/effacement`, { bearer: session, body: { confirmer: true } }));

  // L'offre, elle, part vraiment.
  assert.deepEqual(body.effacees, [bid.id]);

  // Ce qui survit, survit EN CLAIR — et c'est pourquoi le plan n'a pas le droit
  // de se déclarer complet.
  assert.equal(body.plan.complet, false, 'un effacement après lequel l’adresse survit s’est déclaré complet');
  const survivants = body.plan.residus.map((l) => l.famille).sort();
  assert.deepEqual(survivants, ['destinataire_campagne', 'index_client', 'journal_sujet']);

  const journal = await h.repo.listSubjectEvents(COURRIEL);
  assert.equal(journal.length, 1, 'le journal des envois a été vidé : ce test ne garde plus rien');
  assert.equal(journal[0].sujet, COURRIEL, 'l’adresse ne survit plus en clair : le plan peut être rendu exécutable');

  const pointeurs = await h.repo.listClientBids(COURRIEL);
  assert.equal(pointeurs.length, 1, 'l’index par adresse a été vidé : le plan peut être rendu exécutable');

  const destinataires = await h.repo.listCampaignRecipients('c1');
  assert.equal(destinataires.destinataires.length, 1);
  assert.equal(destinataires.destinataires[0].courriel, COURRIEL);

  // Et chaque ligne hors de portée dit POURQUOI : un opérateur qui instruit une
  // demande d'accès doit savoir ce qu'il lui reste à faire à la main.
  for (const ligne of body.plan.efface.filter((l) => l.executable === false)) {
    assert.ok(ligne.note, `« ${ligne.famille} » est hors de portée sans dire pourquoi`);
  }
});

test('OUVRIR un dossier laisse une trace, comme l’exporter — sinon la trace est facultative', async () => {
  // Les deux portes rendent le MÊME dossier. Tracer l'export seulement rendait
  // l'audit contournable : il suffisait d'ouvrir au lieu d'exporter.
  const h = make();
  await publier(h);
  const session = await login(h);
  await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });

  const trace = (await h.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'dossier_usager_consulte');
  assert.ok(trace, 'ouvrir le dossier d’une personne n’a laissé aucune trace');
  assert.equal(trace.email, 'ops@nota.ca');
  assert.equal(trace.meta.offres, 1);
  assert.equal(trace.meta.enClair, true, 'la trace doit dire si les valeurs nominatives ont été VUES');
  assert.ok(!String(trace.meta.sujet).includes('@'), 'l’adresse en clair a fui dans le journal');
});

test('une lecture MASQUÉE se distingue d’une lecture en clair au journal', async () => {
  const h = make();
  await publier(h);
  const session = await loginSansPii(h);
  await h.call('GET', `/admin/usagers/${encodeURIComponent(COURRIEL)}`, { bearer: session });
  const trace = (await h.repo.queryAuditByDay(TODAY)).find((e) => e.action === 'dossier_usager_consulte');
  assert.ok(trace);
  assert.equal(trace.meta.enClair, false);
});
