/**
 * ADR 0047 — LA SALLE DE SIGNATURE, côté API.
 *
 * Le domaine décide ; ces tests vérifient que les routes appliquent le verdict
 * sans le contourner, et que trois choses qui n'existent que dans cette couche
 * tiennent : QUI entre, ce que la signalisation accepte, et la course de deux
 * pairs qui écrivent sur la même séance.
 *
 * Ils exercent le handler par `app.handle()`, comme les autres suites d'ici :
 * pas de serveur, pas de réseau, une horloge injectée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { signToken, SCOPES } = require('../src/notary-auth.js');

const DATE = '2026-09-30';
const NOTARY = 'N-anne';
const BID = 'b-salle';
const T0 = Date.parse('2026-09-09T14:00:00.000Z');

const retenue = (over = {}) => ({
  id: BID, serviceId: 'financement', dateISO: DATE, montant: 2400, tier: 'confort',
  status: domain.STATUS.RETENUE, notaryId: NOTARY, etude: 'Étude Anne Roy',
  anonyme: true, courriel: 'client@example.ca', createdAt: '2026-09-01', dossierReady: true,
  ...over,
});

// Une horloge qu'on avance à la main : la continuité se mesure en secondes, et
// une suite qui dort vraiment dix secondes ne se relit pas.
function harnais({ bid = retenue(), env = {} } = {}) {
  const repo = createMemoryRepo([bid]);
  let horloge = T0;
  const app = createApp(repo, {
    now: () => '2026-09-09',
    nowMs: () => horloge,
    env: { NOTA_SIGNATURE_FOURNISSEUR: 'demonstration', ...env },
  });
  const jetonNotaire = signToken(NOTARY, T0 + 3600e3, SCOPES.SESSION);
  const jetonClient = signToken(BID, T0 + 3600e3, SCOPES.CLIENT);

  const appel = (partie, method, path, body, query) =>
    app.handle({
      method, path,
      headers: { authorization: 'Bearer ' + (partie === 'notaire' ? jetonNotaire : partie === 'client' ? jetonClient : String(partie)) },
      body: body === undefined ? undefined : JSON.stringify({ id: BID, dateISO: DATE, ...body }),
      query: { id: BID, dateISO: DATE, ...(query || {}) },
    }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));

  return {
    repo, app, jetonNotaire, jetonClient,
    avancerHorloge: (ms) => { horloge += ms; },
    maintenant: () => horloge,
    poste: (partie, path, body) => appel(partie, 'POST', path, body || {}),
    lit: (partie, path, query) => appel(partie, 'GET', path, undefined, query),
  };
}

// Amène une séance jusqu'à l'étape voulue, portes ouvertes. Chaque geste passe
// par une route : rien n'est écrit dans le dos du handler.
async function ouvrirTout(h, { mode = 'strict', jusqua = 'questions' } = {}) {
  await h.poste('notaire', '/salle/rejoindre', { empreinte: 'AA:BB:CC:DD', mode, demonstration: true });
  await h.poste('client', '/salle/rejoindre', { empreinte: '11:22:33:44' });
  await h.poste('notaire', '/salle/pistes', { video: true, audio: true });
  await h.poste('client', '/salle/pistes', { video: true, audio: true });
  for (const partie of ['notaire', 'client']) {
    await h.poste('notaire', '/salle/identite', {
      partie,
      attestation: { methode: 'demonstration', verifieeLe: new Date(h.maintenant()).toISOString(), verifieePar: NOTARY },
    });
  }
  const etat = await h.lit('notaire', '/salle');
  await h.poste('notaire', '/salle/lien', { sas: etat.body.salle.sas });
  const enregistrement = mode === 'temoin';
  await h.poste('notaire', '/salle/consentement', { enregistrement });
  await h.poste('client', '/salle/consentement', { enregistrement });
  for (const e of ['identite', 'lien', 'consentement', 'lecture', 'questions', 'signature', 'cloture']) {
    const r = await h.poste('notaire', '/salle/etape', { versEtape: e });
    if (e === jusqua) return r;
    if (r.status !== 200) return r;
    if (e === 'cloture') return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// B1, B3, A5 — qui entre, et qui conduit
// ---------------------------------------------------------------------------

test('B1 · sans jeton, la salle n’existe pas', async () => {
  const h = harnais();
  const r = await h.poste('aucun-jeton', '/salle/rejoindre', {});
  assert.equal(r.status, 401);
  assert.equal(r.body.errors[0].code, 'non_autorise');
});

test('A5 · un jeton client valide pour une AUTRE offre est refusé', async () => {
  const h = harnais();
  const autre = signToken('une-autre-offre', T0 + 3600e3, SCOPES.CLIENT);
  const r = await h.app.handle({
    method: 'POST', path: '/salle/rejoindre',
    headers: { authorization: 'Bearer ' + autre },
    body: JSON.stringify({ id: BID, dateISO: DATE }),
  });
  assert.equal(r.statusCode, 401);
});

test('A5 · un notaire qui n’a pas retenu l’acte ne peut pas entrer', async () => {
  const h = harnais();
  const intrus = signToken('N-quelqu-un-dautre', T0 + 3600e3, SCOPES.SESSION);
  const r = await h.app.handle({
    method: 'POST', path: '/salle/rejoindre',
    headers: { authorization: 'Bearer ' + intrus },
    body: JSON.stringify({ id: BID, dateISO: DATE }),
  });
  assert.equal(r.statusCode, 403);
  assert.equal(JSON.parse(r.body).errors[0].code, 'interdit');
});

test('B3 · le client ne conduit pas : les quatre gestes du notaire lui sont fermés', async () => {
  const h = harnais();
  await ouvrirTout(h, { jusqua: 'lecture' });
  for (const [path, body] of [
    ['/salle/etape', { versEtape: 'signature' }],
    ['/salle/lien', { sas: 'AAAA-BBBB' }],
    ['/salle/identite', { partie: 'client', attestation: {} }],
    ['/salle/sceau', {}],
  ]) {
    const r = await h.poste('client', path, body);
    assert.equal(r.status, 403, path + ' devrait être fermé au client');
    assert.equal(r.body.errors[0].code, 'interdit');
  }
});

test('une séance ne s’ouvre pas sur un acte que personne n’a retenu', async () => {
  const h = harnais({ bid: retenue({ status: domain.STATUS.OUVERTE, notaryId: null }) });
  const r = await h.app.handle({
    method: 'POST', path: '/salle/rejoindre',
    headers: { authorization: 'Bearer ' + h.jetonClient },
    body: JSON.stringify({ id: BID, dateISO: DATE }),
  });
  assert.equal(r.statusCode, 422);
  assert.equal(JSON.parse(r.body).errors[0].code, 'acte_non_retenu');
});

test('une offre annulée referme la séance avec le même 410 que le reste du produit', async () => {
  const h = harnais({ bid: retenue({ status: domain.STATUS.ANNULEE }) });
  const r = await h.poste('client', '/salle/rejoindre', {});
  assert.equal(r.status, 410);
  assert.equal(r.body.errors[0].code, 'offre_annulee');
});

// ---------------------------------------------------------------------------
// A2 — la signalisation, et ce qu'elle refuse
// ---------------------------------------------------------------------------

test('A2 · la signalisation achemine offre, réponse et candidats — et rien d’autre', async () => {
  const h = harnais();
  await h.poste('notaire', '/salle/rejoindre', { empreinte: 'AA:BB' });
  await h.poste('client', '/salle/rejoindre', { empreinte: 'CC:DD' });

  const depose = await h.poste('notaire', '/salle/signal', { type: 'offre', charge: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' });
  assert.equal(depose.status, 200);
  assert.equal(depose.body.n, 1);

  // Le message attend le CLIENT, pas son auteur : sans cela chaque pair se
  // relirait lui-même et la négociation ne finirait jamais.
  const cotéNotaire = await h.lit('notaire', '/salle', { depuis: 0 });
  assert.deepEqual(cotéNotaire.body.signaux, []);
  const cotéClient = await h.lit('client', '/salle', { depuis: 0 });
  assert.equal(cotéClient.body.signaux.length, 1);
  assert.equal(cotéClient.body.signaux[0].type, 'offre');
  assert.equal(cotéClient.body.signaux[0].de, 'notaire');

  // Le curseur ne rejoue pas ce qui a été lu.
  const encore = await h.lit('client', '/salle', { depuis: cotéClient.body.curseur });
  assert.deepEqual(encore.body.signaux, []);
});

test('A2 · ce qui n’est pas de la signalisation est refusé — la salle n’est pas un tuyau', async () => {
  const h = harnais();
  await h.poste('notaire', '/salle/rejoindre', {});
  const type = await h.poste('notaire', '/salle/signal', { type: 'fichier', charge: 'x' });
  assert.equal(type.status, 422);
  assert.equal(type.body.errors[0].code, 'signal_inconnu');

  const gros = await h.poste('notaire', '/salle/signal', { type: 'candidat', charge: 'x'.repeat(20000) });
  assert.equal(gros.status, 422);
  assert.equal(gros.body.errors[0].code, 'signal_trop_gros');
});

test('deux pairs qui signalent en même temps ne se perdent pas l’un l’autre', async () => {
  // La course qui compte : pendant l'établissement, les deux navigateurs
  // poussent des candidats ICE sur le MÊME item. Une écriture perdue ne
  // produit aucune erreur — seulement une connexion qui ne monte jamais.
  const h = harnais();
  await h.poste('notaire', '/salle/rejoindre', {});
  await h.poste('client', '/salle/rejoindre', {});

  await Promise.all([
    ...Array.from({ length: 6 }, (_, i) => h.poste('notaire', '/salle/signal', { type: 'candidat', charge: 'n' + i })),
    ...Array.from({ length: 6 }, (_, i) => h.poste('client', '/salle/signal', { type: 'candidat', charge: 'c' + i })),
  ]);

  const versClient = await h.lit('client', '/salle', { depuis: 0 });
  const versNotaire = await h.lit('notaire', '/salle', { depuis: 0 });
  assert.equal(versClient.body.signaux.length, 6, 'des candidats du notaire ont été perdus');
  assert.equal(versNotaire.body.signaux.length, 6, 'des candidats du client ont été perdus');
  assert.deepEqual(versClient.body.signaux.map((s) => s.charge).sort(), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
});

// ---------------------------------------------------------------------------
// A6 — les identifiants du relais
// ---------------------------------------------------------------------------

test('A6 · sans TURN configuré, il n’y a que STUN ; avec, l’identifiant est horodaté', async () => {
  const sansRelais = harnais();
  await sansRelais.poste('notaire', '/salle/rejoindre', {});
  const nu = await sansRelais.lit('notaire', '/salle/ice');
  assert.equal(nu.status, 200);
  assert.ok(nu.body.ice.every((s) => !s.username), 'un serveur STUN n’a pas d’identifiant');

  const avecRelais = harnais({ env: { NOTA_TURN_URL: 'turn:relais.nota.ca:3478', NOTA_TURN_SECRET: 'secret-de-relais' } });
  await avecRelais.poste('notaire', '/salle/rejoindre', {});
  const r = await avecRelais.lit('notaire', '/salle/ice');
  const turn = r.body.ice.find((s) => s.username);
  assert.ok(turn, 'le relais devrait être offert');
  // La forme coturn : l'utilisateur EST l'expiration. Un identifiant volé meurt
  // tout seul, ce qu'un mot de passe statique ne fait jamais.
  const expire = Number(String(turn.username).split(':')[0]);
  assert.ok(Number.isFinite(expire), 'le nom d’utilisateur porte son expiration');
  assert.ok(expire * 1000 > T0, 'l’identifiant est déjà expiré à l’émission');
  assert.ok(expire * 1000 <= T0 + 86400e3, 'un identifiant de relais ne vit pas des jours');
  assert.match(turn.credential, /^[A-Za-z0-9+/]+=*$/);

  // Et il faut être admis dans la séance pour en obtenir un.
  const anonyme = await avecRelais.app.handle({ method: 'GET', path: '/salle/ice', query: { id: BID, dateISO: DATE }, headers: {} });
  assert.equal(anonyme.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Les portes, de bout en bout
// ---------------------------------------------------------------------------

test('les quatre portes s’ouvrent une à une, et la signature attend la dernière', async () => {
  const h = harnais();
  await h.poste('notaire', '/salle/rejoindre', { empreinte: 'AA:BB:CC:DD', demonstration: true });

  let etat = await h.lit('notaire', '/salle');
  assert.deepEqual(etat.body.salle.fermees.sort(), ['compte', 'identite', 'lien', 'presence']);

  await h.poste('client', '/salle/rejoindre', { empreinte: '11:22:33:44' });
  etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.portes.compte.ouverte, true, 'les deux comptes sont là');

  await h.poste('notaire', '/salle/pistes', { video: true, audio: true });
  await h.poste('client', '/salle/pistes', { video: true, audio: true });
  etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.portes.presence.ouverte, true);

  // Le lien : les deux écrans montrent la même chaîne, et seul le notaire
  // confirme. Une chaîne inventée est refusée.
  assert.match(etat.body.salle.sas, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const cotéClient = await h.lit('client', '/salle');
  assert.equal(cotéClient.body.salle.sas, etat.body.salle.sas, 'les deux côtés doivent lire la MÊME chaîne');
  const fausse = await h.poste('notaire', '/salle/lien', { sas: 'ZZZZ-ZZZZ' });
  assert.equal(fausse.status, 422);
  assert.equal(fausse.body.errors[0].code, 'sas_discordant');
  await h.poste('notaire', '/salle/lien', { sas: etat.body.salle.sas });

  // L'identité, avec sa méthode et son heure.
  const nue = await h.poste('notaire', '/salle/identite', { partie: 'client', attestation: { methode: 'demonstration' } });
  assert.equal(nue.status, 422);
  for (const partie of ['notaire', 'client']) {
    await h.poste('notaire', '/salle/identite', {
      partie, attestation: { methode: 'demonstration', verifieeLe: new Date(h.maintenant()).toISOString(), verifieePar: NOTARY },
    });
  }
  etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.toutesOuvertes, true);
});

test('C1/C2 · le silence d’un pair suspend la séance, et la reprise repart de l’étape en cours', async () => {
  const h = harnais();
  await ouvrirTout(h, { jusqua: 'lecture' });
  let etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.etape, 'lecture');
  assert.equal(etat.body.salle.statut, 'ouverte');

  // Le client débranche. Il n'envoie rien qui le dise : c'est son SILENCE qui
  // doit être remarqué.
  h.avancerHorloge(60_000);
  etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.statut, 'suspendue');
  assert.equal(etat.body.salle.portes.presence.ouverte, false);

  // Suspendue, la séance n'avance plus.
  const bloque = await h.poste('notaire', '/salle/etape', { versEtape: 'questions' });
  assert.equal(bloque.status, 422);
  assert.ok(bloque.body.errors.some((e) => e.code === 'salle_suspendue'));

  // Le client revient ; la reprise ne saute rien.
  await h.poste('client', '/salle/pistes', { video: true, audio: true });
  const reprise = await h.poste('notaire', '/salle/etape', { reprendre: true });
  assert.equal(reprise.status, 200);
  assert.equal(reprise.body.salle.statut, 'ouverte');
  assert.equal(reprise.body.salle.etape, 'lecture', 'la reprise a sauté une étape');

  // La coupure ET la reprise sont au procès-verbal (exigence C4).
  const faits = reprise.body.salle.pv.map((e) => e.fait);
  assert.ok(faits.includes('lien_coupe'), 'la coupure n’est pas consignée');
  assert.ok(faits.includes('salle_suspendue'));
  assert.ok(faits.includes('lien_repris'), 'la reprise n’est pas consignée');
  assert.ok(faits.includes('salle_reprise'));
});

// ---------------------------------------------------------------------------
// F1, F2, E3 — la signature et le scellé
// ---------------------------------------------------------------------------

test('F2 · l’adaptateur de démonstration refuse une séance réelle, et le refus vient du domaine', async () => {
  const h = harnais();
  // Une séance ouverte sans `demonstration` — mais le handler la force quand le
  // fournisseur admis n'est pas configuré, ce qui est le comportement voulu :
  // c'est la seule chose qui puisse être ouverte honnêtement.
  await h.poste('notaire', '/salle/rejoindre', { empreinte: 'AA:BB', demonstration: false });
  const etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.demonstration, true, 'sans fournisseur admis, la séance est de démonstration');
});

test('F1 · la signature sort par le port, et le port dit qu’il ne produit pas de minute', async () => {
  const h = harnais();
  const r = await ouvrirTout(h, { jusqua: 'signature' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sig = r.body.salle.signature;
  assert.equal(sig.fournisseur, 'demonstration');
  assert.equal(sig.minute, null, 'une démonstration ne crée pas de minute');
  assert.match(sig.avis, /démonstration/i);
  assert.match(sig.reference, /^DEMO-/);
});

test('E3 · le scellé publie une empreinte, et la MÊME part dans la piste d’audit', async () => {
  const h = harnais();
  await ouvrirTout(h, { jusqua: null }); // jusqu'à la clôture
  const sceau = await h.poste('notaire', '/salle/sceau', {});
  assert.equal(sceau.status, 200, JSON.stringify(sceau.body));
  const scelle = sceau.body.scelle;
  assert.match(scelle.empreinte, /^[0-9a-f]{64}$/);
  assert.equal(domain.verifierProcesVerbal(scelle).ok, true, 'le scellé rendu ne se vérifie pas lui-même');

  const journal = await h.repo.queryTxAuditByDay('2026-09-09');
  const entree = (journal.items || journal).find((e) => e.action === 'salle_scellee');
  assert.ok(entree, 'le scellé n’a pas laissé de trace inaltérable');
  assert.equal(entree.meta.empreinte, scelle.empreinte, 'les deux copies de la vérité ne concordent pas');
  assert.equal(entree.meta.demonstration, true);

  // On ne scelle pas deux fois.
  const encore = await h.poste('notaire', '/salle/sceau', {});
  assert.equal(encore.status, 409);
  assert.equal(encore.body.errors[0].code, 'deja_scellee');
});

test('on ne scelle pas une séance qui n’a pas atteint la signature', async () => {
  const h = harnais();
  await ouvrirTout(h, { jusqua: 'lecture' });
  const r = await h.poste('notaire', '/salle/sceau', {});
  assert.equal(r.status, 409);
  assert.equal(r.body.errors[0].code, 'signature_absente');
});

// ---------------------------------------------------------------------------
// D — l'enregistrement
// ---------------------------------------------------------------------------

test('D2/D3 · l’enregistrement démarre sur deux accords et s’arrête sur un retrait', async () => {
  const h = harnais();
  await ouvrirTout(h, { mode: 'temoin', jusqua: 'lecture' });
  let etat = await h.lit('notaire', '/salle');
  assert.equal(etat.body.salle.enregistre, true);
  assert.ok(etat.body.salle.pv.some((e) => e.fait === 'enregistrement_demarre'));

  const retrait = await h.poste('client', '/salle/consentement', { retire: true });
  assert.equal(retrait.status, 200);
  assert.equal(retrait.body.salle.enregistre, false);
  assert.ok(retrait.body.salle.pv.some((e) => e.fait === 'consentement_retire'));
  assert.ok(retrait.body.salle.pv.some((e) => e.fait === 'enregistrement_arrete'));

  // Et la signature n'est plus libérable.
  await h.poste('notaire', '/salle/etape', { versEtape: 'questions' });
  const refus = await h.poste('notaire', '/salle/etape', { versEtape: 'signature' });
  assert.equal(refus.status, 422);
  assert.ok(refus.body.errors.some((e) => e.code === 'consentement_incomplet'));
});

// ---------------------------------------------------------------------------
// La configuration
// ---------------------------------------------------------------------------

test('un fournisseur de signature nommé mais non implémenté fait échouer la salle, franchement', async () => {
  // Le pire scénario possible serait une bascule SILENCIEUSE vers la
  // démonstration : le notaire croirait recevoir un acte, et rien ne le
  // recevrait. La salle refuse de s'ouvrir plutôt que de mentir.
  const h = harnais({ env: { NOTA_SIGNATURE_FOURNISSEUR: 'consigno' } });
  const r = await h.poste('notaire', '/salle/rejoindre', {});
  assert.equal(r.status, 503);
  assert.equal(r.body.errors[0].code, 'signature_indisponible');
  assert.match(r.body.errors[0].message, /n’est pas implémenté/);

  const inconnu = harnais({ env: { NOTA_SIGNATURE_FOURNISSEUR: 'quelque-chose' } });
  const r2 = await inconnu.poste('notaire', '/salle/rejoindre', {});
  assert.equal(r2.status, 503);
});

test('une séance s’adresse par son offre et sa date, sinon elle n’existe pas', async () => {
  const h = harnais();
  const r = await h.app.handle({
    method: 'POST', path: '/salle/rejoindre',
    headers: { authorization: 'Bearer ' + h.jetonNotaire },
    body: JSON.stringify({ id: BID }),
  });
  assert.equal(r.statusCode, 400);
  assert.equal(JSON.parse(r.body).errors[0].code, 'salle_adresse');
});

test('une route inconnue sous /salle ne tombe pas dans le reste de l’API', async () => {
  const h = harnais();
  const r = await h.poste('notaire', '/salle/enregistrement/telecharger', {});
  assert.equal(r.status, 404);
  assert.equal(r.body.errors[0].code, 'route_inconnue');
});
