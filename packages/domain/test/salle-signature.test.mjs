/**
 * ADR 0047 — LA SALLE DE SIGNATURE.
 *
 * Ce fichier tient les règles qui décident si une signature peut être libérée.
 * Elles ne se testent pas contre ce que le code imprime : chaque attente est
 * calculée depuis le domaine, et l'empreinte SHA-256 est confrontée à
 * `node:crypto`, qui n'a aucune raison d'être d'accord par accident.
 *
 * La table des exigences est dans docs/signing-security-requirements.md ; les
 * numéros cités (A3, C1, E1…) y renvoient.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const T0 = Date.parse('2026-09-09T14:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// Une attestation d'identité valide, construite depuis le domaine.
const attestation = (partie, ms = T0) => ({
  methode: D.IDENTITE_METHODES[0].id,
  verifieeLe: iso(ms),
  verifieePar: partie === 'notaire' ? 'N-demo' : 'N-demo',
  reference: null,
});

// Une salle prête à signer, assemblée porte par porte. Chaque test la casse
// sur un seul point : ce qui échoue nomme donc sa cause.
function salleComplete(over = {}) {
  const empreinteNotaire = 'AA:BB:CC:DD:EE:FF:00:11';
  const empreinteClient = '11:22:33:44:55:66:77:88';
  const base = {
    id: 'S-1', bidId: 'o1', dateISO: '2026-09-25', notaryId: 'N-demo',
    mode: 'strict', demonstration: true,
    statut: D.SALLE_STATUT.OUVERTE,
    etape: 'questions',
    parties: {
      notaire: { authentifie: true, pistes: { video: true, audio: true } },
      client: { authentifie: true, pistes: { video: true, audio: true } },
    },
    identites: { notaire: attestation('notaire'), client: attestation('client') },
    lien: {
      empreinteNotaire, empreinteClient,
      confirmeLe: iso(T0 + 60000),
      confirmePour: D.chaineAuthentification(empreinteNotaire, empreinteClient),
    },
    consentements: {
      notaire: { donneLe: iso(T0 + 90000), enregistrement: false, retireLe: null },
      client: { donneLe: iso(T0 + 95000), enregistrement: false, retireLe: null },
    },
    presence: { coupeeA: null, repriseA: null },
    pv: [],
    scelle: null,
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------------------
// L'empreinte — la fondation de toute la preuve
// ---------------------------------------------------------------------------

test('sha256Hex répond exactement ce que node:crypto répond', () => {
  // Le domaine ne peut dépendre ni de node:crypto ni de crypto.subtle (ADR
  // 0047). Il porte donc son propre SHA-256, et cette égalité est la seule
  // chose qui sépare « une chaîne de preuve » de « une suite de caractères ».
  const cas = [
    '',
    'abc',
    'The quick brown fox jumps over the lazy dog',
    'acte notarié — procès-verbal scellé',       // accents, tiret cadratin
    '🧾'.repeat(37),                              // hors du plan multilingue de base
    'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(57), // les trois bords du bourrage
    'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), // et la frontière de bloc
    'x'.repeat(4096),
  ];
  for (const c of cas) {
    assert.equal(D.sha256Hex(c), createHash('sha256').update(c, 'utf8').digest('hex'), JSON.stringify(c.slice(0, 24)));
  }
});

// ---------------------------------------------------------------------------
// A3, A4 — la chaîne d'authentification courte
// ---------------------------------------------------------------------------

test('A3 · la chaîne d’authentification est symétrique, déterministe, et change au moindre bit', () => {
  const a = 'AA:BB:CC:DD', b = '11:22:33:44';
  const sas = D.chaineAuthentification(a, b);
  // Symétrique : chaque pair connaît les deux empreintes dans l'ordre inverse
  // de l'autre. Si l'ordre comptait, les deux écrans n'afficheraient jamais la
  // même chose et la vérification serait un théâtre.
  assert.equal(sas, D.chaineAuthentification(b, a));
  assert.equal(sas, D.chaineAuthentification(a, b));
  // Lisible à voix haute : pas de 0/O/1/I/L, deux groupes de quatre.
  assert.match(sas, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  // Un intercepteur négocie DEUX sessions : il ne peut pas présenter la même
  // chaîne des deux côtés.
  assert.notEqual(sas, D.chaineAuthentification('AA:BB:CC:DE', b));
  assert.equal(D.chaineAuthentification('', b), null);
  assert.equal(D.chaineAuthentification(a, null), null);
});

test('A4 · la porte du lien reste fermée tant que le notaire n’a pas confirmé', () => {
  const salle = salleComplete({ lien: { ...salleComplete().lien, confirmeLe: null } });
  const r = D.salleReadiness(salle, { nowMs: T0 + 120000 });
  assert.equal(r.portes.lien.ouverte, false);
  assert.equal(r.portes.lien.raison, 'lien_non_confirme');
  // Elle ne peut pas s'ouvrir sans les deux empreintes non plus.
  const sansLien = D.salleReadiness(salleComplete({ lien: { empreinteNotaire: null, empreinteClient: null } }), { nowMs: T0 });
  assert.equal(sansLien.portes.lien.raison, 'lien_inconnu');
});

test('A4 · une renégociation qui change les empreintes referme la porte déjà confirmée', () => {
  // Le cas qui compte : le lien a été confirmé, puis renégocié. La confirmation
  // portait sur l'ANCIENNE chaîne ; la laisser valoir serait exactement le trou
  // que la vérification est censée fermer.
  const salle = salleComplete();
  salle.lien.empreinteClient = '99:88:77:66:55:44:33:22';
  const r = D.salleReadiness(salle, { nowMs: T0 + 120000 });
  assert.equal(r.portes.lien.ouverte, false);
  assert.equal(r.portes.lien.raison, 'lien_change');
});

// ---------------------------------------------------------------------------
// B1, B2 — les personnes
// ---------------------------------------------------------------------------

test('B1 · une partie non authentifiée ferme la porte des comptes, et la nomme', () => {
  const salle = salleComplete();
  salle.parties.client.authentifie = false;
  const r = D.salleReadiness(salle, { nowMs: T0 });
  assert.equal(r.portes.compte.ouverte, false);
  assert.match(r.portes.compte.message, /client/i);
  assert.deepEqual(r.fermees, ['compte']);
});

test('B2 · une attestation d’identité sans méthode, sans heure ou sans vérificateur n’ouvre rien', () => {
  const bonne = D.validateAttestationIdentite(attestation('client'));
  assert.equal(bonne.ok, true);
  assert.equal(bonne.attestation.methode, D.IDENTITE_METHODES[0].id);

  const champs = ['methode', 'verifieeLe', 'verifieePar'];
  for (const champ of champs) {
    const amputee = { ...attestation('client') };
    delete amputee[champ];
    const v = D.validateAttestationIdentite(amputee);
    assert.equal(v.ok, false, 'sans ' + champ + ' l’attestation devrait être refusée');
    assert.ok(v.errors.some((e) => e.field === champ), 'l’erreur nomme ' + champ);
  }
  // Une heure qui n'est pas un instant ISO ne dit pas QUAND.
  assert.equal(D.validateAttestationIdentite({ ...attestation('client'), verifieeLe: '2026-09-09' }).ok, false);
  // Et la salle refuse de s'ouvrir sur une identité manquante.
  const salle = salleComplete();
  salle.identites.notaire = null;
  const r = D.salleReadiness(salle, { nowMs: T0 });
  assert.equal(r.portes.identite.ouverte, false);
  assert.match(r.portes.identite.message, /notaire/);
});

test('B4 · les étapes sont ordonnées : on n’en saute pas, on peut revenir', () => {
  const salle = salleComplete({ etape: 'accueil' });
  // La suivante passe.
  assert.equal(D.peutAvancer(salle, 'identite', { nowMs: T0 }).ok, true);
  // Deux d'un coup, non — et le refus nomme l'étape attendue.
  const saut = D.peutAvancer(salle, 'consentement', { nowMs: T0 });
  assert.equal(saut.ok, false);
  assert.ok(saut.errors.some((e) => e.code === 'etape_sautee'));
  assert.match(saut.errors.find((e) => e.code === 'etape_sautee').message, /identité/i);
  // Revenir en arrière est permis, et se déclare comme un retour.
  const retour = D.peutAvancer(salleComplete({ etape: 'lecture' }), 'accueil', { nowMs: T0 });
  assert.equal(retour.ok, true);
  assert.equal(retour.retour, true);
  // Une étape inventée n'existe pas.
  assert.equal(D.peutAvancer(salle, 'signature-express', { nowMs: T0 }).ok, false);
});

test('B4 · le retour en arrière n’exige pas ce qu’exigeait l’étape quittée', () => {
  // Le lien saute pendant la signature : le notaire doit pouvoir revenir à la
  // lecture. Si le retour réappliquait les exigences de l'étape cible, une
  // salle cassée deviendrait une salle bloquée.
  const salle = salleComplete({ etape: 'signature' });
  salle.lien.confirmeLe = null;
  const r = D.peutAvancer(salle, 'lecture', { nowMs: T0 });
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  assert.equal(r.retour, true);
});

// ---------------------------------------------------------------------------
// C1..C4 — la continuité
// ---------------------------------------------------------------------------

test('C3 · une piste coupée referme la porte de présence sans attendre la fin de l’appel', () => {
  for (const [partie, piste, motif] of [['client', 'video', 'piste_video'], ['notaire', 'audio', 'piste_audio']]) {
    const salle = salleComplete();
    salle.parties[partie].pistes[piste] = false;
    const r = D.salleReadiness(salle, { nowMs: T0 });
    assert.equal(r.portes.presence.ouverte, false);
    assert.equal(r.portes.presence.raison, motif);
  }
});

test('C1 · une coupure au-delà de la tolérance suspend la séance ; en deçà, non', () => {
  const court = salleComplete({ presence: { coupeeA: T0, repriseA: null } });
  assert.equal(D.doitSuspendre(court, T0 + D.PRESENCE_TOLERANCE_MS - 1), false);
  assert.equal(D.doitSuspendre(court, T0 + D.PRESENCE_TOLERANCE_MS + 1), true);
  // Une coupure déjà reprise ne suspend pas : elle est au procès-verbal, ce
  // qui est précisément le point.
  const reprise = salleComplete({ presence: { coupeeA: T0, repriseA: T0 + 60000 } });
  assert.equal(D.doitSuspendre(reprise, T0 + 120000), false);
  // Une salle déjà suspendue ne se re-suspend pas.
  const deja = salleComplete({ statut: D.SALLE_STATUT.SUSPENDUE, presence: { coupeeA: T0, repriseA: null } });
  assert.equal(D.doitSuspendre(deja, T0 + 999999), false);
});

test('C1 · une séance suspendue ne peut plus avancer, et le refus le dit', () => {
  const salle = salleComplete({ statut: D.SALLE_STATUT.SUSPENDUE, etape: 'lecture' });
  const r = D.peutAvancer(salle, 'questions', { nowMs: T0 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'salle_suspendue'));
});

test('C1 · le lien coupé referme la porte de présence, avec la durée', () => {
  const salle = salleComplete({ presence: { coupeeA: T0, repriseA: null } });
  const r = D.salleReadiness(salle, { nowMs: T0 + 25000 });
  assert.equal(r.portes.presence.ouverte, false);
  assert.equal(r.portes.presence.raison, 'lien_coupe');
  assert.match(r.portes.presence.message, /25 s/);
});

// ---------------------------------------------------------------------------
// D1..D5 — l'enregistrement
// ---------------------------------------------------------------------------

test('D1 · le mode par défaut n’enregistre pas', () => {
  assert.equal(D.SALLE_MODE_DEFAUT, 'strict');
  assert.equal(D.salleModeById('strict').enregistre, false);
  assert.equal(D.salleModeById('temoin').enregistre, true);
  assert.equal(D.salleModeById('aucun').enregistre, false);
  assert.equal(D.enregistrementActif(salleComplete()), false);
});

test('D2 · l’enregistrement exige l’accord horodaté des DEUX parties', () => {
  const salle = salleComplete({ mode: 'temoin' });
  salle.consentements.notaire.enregistrement = true;
  salle.consentements.client.enregistrement = true;
  assert.equal(D.enregistrementActif(salle), true);

  // Un accord au procès-verbal ne vaut pas accord à l'enregistrement.
  const partiel = salleComplete({ mode: 'temoin' });
  partiel.consentements.notaire.enregistrement = true;
  assert.equal(D.enregistrementActif(partiel), false);
  assert.deepEqual(D.consentementEtat(partiel).manquants, ['client']);

  // Un accord sans heure n'est pas un accord.
  const sansHeure = salleComplete({ mode: 'temoin' });
  sansHeure.consentements.client = { donneLe: 'hier', enregistrement: true };
  assert.equal(D.consentementEtat(sansHeure).complet, false);
});

test('D3 · un retrait arrête l’enregistrement à l’instant', () => {
  const salle = salleComplete({ mode: 'temoin' });
  salle.consentements.notaire.enregistrement = true;
  salle.consentements.client.enregistrement = true;
  assert.equal(D.enregistrementActif(salle), true);
  salle.consentements.client.retireLe = iso(T0 + 300000);
  assert.equal(D.enregistrementActif(salle), false);
  assert.deepEqual(D.consentementEtat(salle).retires, ['client']);
  // Et la signature ne peut plus être libérée.
  const r = D.peutAvancer({ ...salle, etape: 'questions' }, 'signature', { nowMs: T0 + 400000, fournisseur: 'demonstration' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'consentement_incomplet'));
});

test('D5 · une répétition ne peut pas atteindre la signature', () => {
  const salle = salleComplete({ mode: 'aucun', etape: 'questions' });
  const r = D.peutAvancer(salle, 'signature', { nowMs: T0, fournisseur: 'demonstration' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'repetition'));
  // Une répétition n'exige en revanche aucun consentement : elle ne vaut rien,
  // donc elle ne recueille rien.
  assert.equal(D.consentementEtat(salle).requis, false);
  assert.equal(D.consentementEtat(salle).complet, true);
});

// ---------------------------------------------------------------------------
// F2 — la porte du fournisseur
// ---------------------------------------------------------------------------

test('F2 · l’adaptateur de démonstration ne peut pas signer une salle réelle', () => {
  const reelle = salleComplete({ demonstration: false, etape: 'questions' });
  const refus = D.peutAvancer(reelle, 'signature', { nowMs: T0, fournisseur: 'demonstration' });
  assert.equal(refus.ok, false);
  assert.ok(refus.errors.some((e) => e.code === 'fournisseur_demonstration'));

  // La même salle, marquée démonstration, passe.
  const demo = salleComplete({ demonstration: true, etape: 'questions' });
  assert.equal(D.peutAvancer(demo, 'signature', { nowMs: T0, fournisseur: 'demonstration' }).ok, true);

  // Et la salle réelle passe dès que le fournisseur admis est configuré.
  assert.equal(D.peutAvancer(reelle, 'signature', { nowMs: T0, fournisseur: 'consigno' }).ok, true);
});

test('une porte fermée bloque la signature et se nomme dans l’erreur', () => {
  const salle = salleComplete({ etape: 'questions' });
  salle.parties.client.pistes.video = false;
  salle.identites.client = null;
  const r = D.peutAvancer(salle, 'signature', { nowMs: T0, fournisseur: 'demonstration' });
  assert.equal(r.ok, false);
  const champs = r.errors.filter((e) => e.code === 'porte_fermee').map((e) => e.field).sort();
  assert.deepEqual(champs, ['identite', 'presence']);
});

// ---------------------------------------------------------------------------
// E1, E2, E4 — le procès-verbal
// ---------------------------------------------------------------------------

const entree = (fait, a, detail = {}, par = 'notaire') => ({ fait, par, a: iso(a), detail });

test('E2 · le procès-verbal refuse tout champ hors de sa liste blanche', () => {
  const bonne = D.validateEntreePv(entree('etape_franchie', T0, { etape: 'lecture' }));
  assert.equal(bonne.ok, true);
  // Ce qui est refusé, c'est exactement le trou par lequel le contenu de l'acte
  // entrerait : un champ libre.
  const fuite = D.validateEntreePv(entree('etape_franchie', T0, { etape: 'lecture', texte: 'le prêt est de 350 000 $' }));
  assert.equal(fuite.ok, false);
  assert.ok(fuite.errors.some((e) => e.field === 'detail.texte' && e.code === 'champ_interdit'));
  // Un fait inconnu, un acteur inconnu, une heure absente : trois refus.
  assert.equal(D.validateEntreePv(entree('quelque_chose', T0)).ok, false);
  assert.equal(D.validateEntreePv({ ...entree('etape_franchie', T0), par: 'greffier' }).ok, false);
  assert.equal(D.validateEntreePv({ ...entree('etape_franchie', T0), a: null }).ok, false);
});

test('E1 · la chaîne d’empreintes se rompt si on retire, insère, réordonne ou retouche', () => {
  const brut = [
    entree('salle_ouverte', T0, {}, 'systeme'),
    entree('porte_ouverte', T0 + 1000, { porte: 'compte' }, 'systeme'),
    entree('etape_franchie', T0 + 2000, { etape: 'identite' }),
    entree('lien_confirme', T0 + 3000, { sas: 'AB12-CD34' }),
    entree('signature_liberee', T0 + 4000, { fournisseur: 'demonstration' }),
  ];
  const chaine = D.chainerProcesVerbal(brut);
  assert.equal(chaine.length, 5);
  assert.deepEqual(chaine.map((e) => e.n), [1, 2, 3, 4, 5]);

  // La première empreinte se recalcule à la main depuis la genèse : la chaîne
  // n'est pas un identifiant opaque, elle est reproductible par un tiers.
  // Les clés sont écrites ici dans l'ordre alphabétique, celui que la
  // sérialisation canonique impose — c'est ce qui rend l'empreinte
  // reproductible sur une autre machine, dans un autre langage.
  const attendue = D.sha256Hex(D.PV_GENESE + '\n' + JSON.stringify({
    a: chaine[0].a, detail: {}, fait: 'salle_ouverte', n: 1, par: 'systeme',
  }));
  assert.equal(chaine[0].empreinte, attendue);

  const finale = chaine[chaine.length - 1].empreinte;
  const empreinteDe = (liste) => D.chainerProcesVerbal(liste).slice(-1)[0].empreinte;
  // Retirer.
  assert.notEqual(empreinteDe(brut.filter((_, i) => i !== 2)), finale);
  // Insérer.
  assert.notEqual(empreinteDe([...brut.slice(0, 3), entree('porte_ouverte', T0 + 2500, { porte: 'lien' }, 'systeme'), ...brut.slice(3)]), finale);
  // Réordonner.
  assert.notEqual(empreinteDe([brut[1], brut[0], ...brut.slice(2)]), finale);
  // Déplacer une heure d'une seconde.
  const retouche = brut.map((e, i) => (i === 3 ? entree('lien_confirme', T0 + 3001, { sas: 'AB12-CD34' }) : e));
  assert.notEqual(empreinteDe(retouche), finale);
  // Rejouer la même liste donne la même empreinte : sans cela, rien n'est
  // vérifiable.
  assert.equal(empreinteDe(brut.map((e) => ({ ...e }))), finale);
});

test('E1 · verifierProcesVerbal retrouve une chaîne intacte et nomme l’entrée rompue', () => {
  const salle = salleComplete({
    demonstration: false,
    pv: [entree('salle_ouverte', T0, {}, 'systeme'), entree('etape_franchie', T0 + 1000, { etape: 'identite' })],
  });
  const scelle = D.scellerProcesVerbal(salle, { a: iso(T0 + 5000) });
  assert.equal(D.verifierProcesVerbal(scelle).ok, true);
  assert.equal(D.verifierProcesVerbal(scelle).empreinte, scelle.empreinte);

  // Quelqu'un déplace une heure dans sa copie et laisse les empreintes en
  // place : la vérification nomme l'entrée où la chaîne cesse de concorder.
  const falsifie = JSON.parse(JSON.stringify(scelle));
  falsifie.entrees[1].a = iso(T0 + 9999);
  const v = D.verifierProcesVerbal(falsifie);
  assert.equal(v.ok, false);
  assert.equal(v.rompueA, 2);
});

test('E4 · un procès-verbal de démonstration porte sa mention DANS la chaîne', () => {
  const pv = [entree('salle_ouverte', T0, {}, 'systeme'), entree('etape_franchie', T0 + 1000, { etape: 'identite' })];
  const demo = D.scellerProcesVerbal(salleComplete({ demonstration: true, pv }), { a: iso(T0 + 5000) });
  const reel = D.scellerProcesVerbal(salleComplete({ demonstration: false, pv }), { a: iso(T0 + 5000) });

  assert.equal(demo.entrees[0].fait, 'mention_demonstration');
  assert.equal(demo.demonstration, true);
  // Retirer la mention pour faire passer la démonstration pour un acte réel
  // casse l'empreinte : c'est toute la valeur de la mettre dans la chaîne.
  assert.notEqual(demo.empreinte, reel.empreinte);
  const ampute = { ...demo, entrees: demo.entrees.slice(1) };
  assert.equal(D.verifierProcesVerbal(ampute).ok, false);
});

test('E2 · le scellé ne porte que ce qu’il a le droit de porter', () => {
  const scelle = D.scellerProcesVerbal(salleComplete({ pv: [entree('salle_ouverte', T0, {}, 'systeme')] }), { a: iso(T0) });
  assert.deepEqual(Object.keys(scelle).sort(), ['bidId', 'demonstration', 'empreinte', 'entrees', 'mode', 'salleId', 'scelleLe']);
  for (const e of scelle.entrees) {
    assert.deepEqual(Object.keys(e).sort(), ['a', 'detail', 'empreinte', 'fait', 'n', 'par']);
    for (const cle of Object.keys(e.detail)) assert.ok(D.PV_DETAIL_CHAMPS.includes(cle), cle);
  }
  // Un procès-verbal vide a l'empreinte de la genèse : il ne prétend rien.
  assert.equal(D.scellerProcesVerbal({ id: 'S-0' }, {}).empreinte, D.PV_GENESE);
});

// ---------------------------------------------------------------------------
// L'ouverture
// ---------------------------------------------------------------------------

test('une salle ne s’ouvre que sur un acte retenu, et naît toutes portes fermées', () => {
  const ouverte = { id: 'o1', dateISO: '2026-09-25', status: D.STATUS.OUVERTE };
  assert.equal(D.validateSalleOuverture(ouverte, {}).ok, false);

  const retenue = { id: 'o1', dateISO: '2026-09-25', status: D.STATUS.RETENUE, notaryId: 'N-demo' };
  const v = D.validateSalleOuverture(retenue, { demonstration: true });
  assert.equal(v.ok, true);
  assert.equal(v.salle.mode, D.SALLE_MODE_DEFAUT);
  assert.equal(v.salle.statut, D.SALLE_STATUT.PREVUE);
  assert.equal(v.salle.etape, D.CEREMONIE_PREMIERE_ETAPE);
  // Aucune porte n'est ouverte à la naissance — pas même celle des comptes.
  const r = D.salleReadiness(v.salle, { nowMs: T0 });
  assert.deepEqual(r.ouvertes, []);
  assert.equal(r.toutesOuvertes, false);

  assert.equal(D.validateSalleOuverture(retenue, { mode: 'express' }).ok, false);
});

test('les huit étapes sont ordonnées, nommées, et portent chacune sa conduite', () => {
  assert.equal(D.CEREMONIE_ETAPES.length, 8);
  D.CEREMONIE_ETAPES.forEach((e, i) => {
    assert.equal(e.ordre, i + 1, e.id + ' est à sa place');
    assert.ok(e.nom && e.conduite && e.constat, e.id + ' porte son texte de conduite');
    assert.equal(D.etapeById(e.id), e);
  });
  assert.equal(D.etapeById('inconnue'), null);
  assert.equal(D.etapeOrdre('signature'), 7);
  // La signature vient avant la clôture : on ne scelle pas ce qui n'est pas
  // signé.
  assert.ok(D.etapeOrdre('signature') < D.etapeOrdre('cloture'));
});
