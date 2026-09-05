/**
 * LA POLITIQUE DE CONSERVATION, ET LA FRONTIÈRE DE L'EFFACEMENT.
 *
 * Deux règles d'affaires, une seule maison. Elles vivent dans le domaine parce
 * qu'elles ne dépendent d'aucun adaptateur : la durée pendant laquelle Nota
 * garde une famille d'enregistrements, et ce qu'une demande d'effacement
 * (Loi 25, art. 28) peut détruire SANS détruire ce que la loi oblige à garder.
 *
 * Ce que ces tests refusent, nommément :
 *   • une durée écrite en clair ailleurs que dans la politique — un littéral
 *     dispersé finit par diverger, et la divergence ne se voit qu'en production ;
 *   • une famille d'enregistrements SANS ligne dans la politique — un élément
 *     qui n'y figure pas est un élément que personne n'a décidé de conserver ;
 *   • un plan d'effacement qui annoncerait détruire ce qu'il conserve. Mentir
 *     sur un effacement est pire que ne pas l'offrir.
 *
 * Les attentes ci-dessous sont calculées depuis la politique, jamais recopiées
 * de ce que le code rend : c'est la leçon de `tests-alignes-sur-le-bug`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');

const JOUR = 86400;
const T = (iso) => Date.parse(iso);

// ---------------------------------------------------------------------------
// 1. La politique : une seule table, lisible, complète
// ---------------------------------------------------------------------------

test('la politique nomme chaque famille une seule fois, et chaque ligne se tient', () => {
  const familles = domain.RETENTION_FAMILIES;
  assert.ok(Array.isArray(familles) && familles.length > 0, 'la politique est vide');

  const vues = new Set();
  for (const f of familles) {
    assert.ok(f.famille, 'une ligne sans nom de famille');
    assert.equal(vues.has(f.famille), false, `famille en double : ${f.famille}`);
    vues.add(f.famille);

    // Une durée est un entier de jours, ou `null` — et `null` n'est jamais un
    // oubli : c'est une décision, qui DOIT porter son motif.
    if (f.jours === null) {
      assert.ok(f.motifIndefini, `${f.famille} : conservation indéfinie sans motif`);
    } else {
      assert.ok(Number.isInteger(f.jours) && f.jours > 0, `${f.famille} : durée invalide`);
    }
    // Chaque ligne dit POURQUOI elle dure ce qu'elle dure, et sous quelle clé
    // d'environnement l'exploitation peut la régler sans redéployer.
    assert.ok(f.motif, `${f.famille} : aucune justification`);
    assert.ok(f.cle && /^NOTA_[A-Z0-9_]+_RETENTION_DAYS$/.test(f.cle), `${f.famille} : clé de surcharge absente ou mal formée`);
  }
});

test('les familles que le code écrit déjà sont TOUTES dans la politique', () => {
  // Les six que l'audit du 2026-09-05 a trouvées sans borne, plus les trois qui
  // en avaient une. Aucune ne doit pouvoir disparaître de la politique en
  // silence : c'est la seule façon de rendre le document auto-exécutoire.
  const attendues = [
    'offre', 'index_client', 'avis', 'journal_sujet', 'journal_audit',
    'acte', 'evaluation', 'gain_parrainage', 'evenement_stripe',
    'profil_notaire', 'desabonnement', 'consentement', 'destinataire_campagne',
    'effacement', 'fil_soutien',
  ];
  const presentes = domain.RETENTION_FAMILIES.map((f) => f.famille);
  assert.deepEqual(attendues.filter((f) => !presentes.includes(f)), [], 'familles écrites mais non conservées par la politique');
});

test('l’offre garde SES 400 jours — la politique ne raccourcit rien en douce', () => {
  // 400 jours est ce que le code applique depuis toujours (handler.js). Une
  // politique qui l'abaisserait DÉTRUIRAIT des données ; elle ne fait que le
  // nommer à un seul endroit.
  assert.equal(domain.retentionDays('offre'), 400);
  // Le pointeur d'index doit MOURIR AVEC ce qu'il indexe : un index qui survit
  // à l'offre pointe dans le vide, un index qui meurt avant la rend
  // introuvable — et c'est l'index qui rend une demande d'accès exécutable.
  assert.equal(domain.retentionDays('index_client'), domain.retentionDays('offre'));
});

test('le journal d’audit reste à sept ans, et la politique le dit en jours entiers', () => {
  // La borne calendaire (`auditRetentionTtl`) reste la référence pour le ttl ;
  // la politique en donne la durée nominale pour que le tableau soit lisible.
  assert.equal(domain.retentionDays('journal_audit'), domain.AUDIT_RETENTION_YEARS * 365);
});

test('un refus ne s’oublie pas : désabonnement, consentement et effacement sont indéfinis', () => {
  for (const famille of ['desabonnement', 'consentement', 'effacement']) {
    assert.equal(domain.retentionDays(famille), null, `${famille} devrait être conservé indéfiniment`);
  }
});

test('une famille inconnue ne rend pas une durée par défaut — elle lève', () => {
  // Un `undefined` silencieux poserait un ttl `NaN`, donc AUCUN ttl : la donnée
  // deviendrait éternelle sans que rien ne le dise.
  assert.throws(() => domain.retentionDays('famille_inventee'), /inconnue/i);
});

// ---------------------------------------------------------------------------
// 2. Les surcharges : réglable, mais jamais cassable
// ---------------------------------------------------------------------------

test('une surcharge d’exploitation remplace la durée par défaut', () => {
  assert.equal(domain.retentionDays('avis', { NOTA_AVIS_RETENTION_DAYS: '90' }), 90);
});

test('une surcharge illisible est IGNORÉE — un déploiement ne tombe pas sur une variable mal tapée', () => {
  const defaut = domain.retentionDays('avis');
  for (const brut of ['', '   ', 'beaucoup', '-5', '0', null, undefined, NaN]) {
    assert.equal(domain.retentionDays('avis', { NOTA_AVIS_RETENTION_DAYS: brut }), defaut, `surcharge « ${brut} » aurait dû être ignorée`);
  }
});

test('une surcharge peut RENDRE indéfini, jamais par accident', () => {
  // « indefini » est le seul mot qui ouvre la conservation sans borne : il faut
  // l'écrire, on ne l'obtient pas en se trompant de valeur.
  assert.equal(domain.retentionDays('avis', { NOTA_AVIS_RETENTION_DAYS: 'indefini' }), null);
});

test('une famille indéfinie ne se borne PAS par surcharge — le refus resterait à oublier', () => {
  // Le seul sens interdit. Donner 30 jours au registre des désabonnements
  // ferait revenir, un mois plus tard, quelqu'un qui a dit non.
  assert.equal(domain.retentionDays('desabonnement', { NOTA_DESABONNEMENT_RETENTION_DAYS: '30' }), null);
});

// ---------------------------------------------------------------------------
// 3. Le ttl : ce que les adaptateurs posent
// ---------------------------------------------------------------------------

test('le ttl est l’ancre plus la durée, en SECONDES epoch', () => {
  const ancre = T('2026-09-05T00:00:00Z');
  assert.equal(domain.retentionTtl('offre', ancre), Math.floor(ancre / 1000) + 400 * JOUR);
});

test('les bornes de PREUVE se comptent en années civiles, jamais en 365 jours', () => {
  // La même règle que `auditRetentionTtl` défendait déjà pour le journal : sept
  // fois 365 jours expire DEUX JOURS TROP TÔT (2028 et 2032 sont bissextiles).
  // Sur une pièce comptable, arrondir vers le bas est la seule erreur qui coûte.
  const ancre = T('2026-06-15T14:00:00Z');
  for (const famille of ['journal_audit', 'acte', 'gain_parrainage']) {
    const ttl = domain.retentionTtl(famille, ancre);
    assert.equal(new Date(ttl * 1000).toISOString(), '2033-06-15T14:00:00.000Z', `${famille} : échéance non calendaire`);
    const naif = Math.floor(ancre / 1000) + 7 * 365 * JOUR;
    assert.equal(ttl - naif, 2 * JOUR, `${famille} : les deux jours bissextiles sont perdus`);
  }
  // Et l'échéance du journal reste EXACTEMENT celle que le domaine calculait
  // déjà : la politique enveloppe la règle, elle ne la remplace pas.
  assert.equal(domain.retentionTtl('journal_audit', ancre), domain.auditRetentionTtl(ancre));
});

test('une surcharge en JOURS reprend la main sur le compte en années', () => {
  const ancre = T('2026-06-15T14:00:00Z');
  assert.equal(domain.retentionTtl('acte', ancre, { NOTA_ACTE_RETENTION_DAYS: '30' }), Math.floor(ancre / 1000) + 30 * JOUR);
});

test('une famille indéfinie ne rend AUCUN ttl', () => {
  assert.equal(domain.retentionTtl('desabonnement', T('2026-09-05T00:00:00Z')), null);
});

test('une ancre illisible ne rend AUCUN ttl — mieux vaut pas d’expiration qu’une fausse', () => {
  // Un ttl calculé sur `NaN` serait `NaN` : DynamoDB l'ignorerait, ou pire,
  // l'accepterait comme une date de 1970 et détruirait l'élément le jour même.
  for (const ancre of [NaN, null, undefined, 'pas une date']) {
    assert.equal(domain.retentionTtl('offre', ancre), null);
  }
});

// ---------------------------------------------------------------------------
// 4. La frontière de l'effacement (Loi 25, art. 28)
// ---------------------------------------------------------------------------

const OFFRE_OUVERTE = { id: 'b-ouverte', dateISO: '2026-12-01', status: 'ouverte', acteComplete: false };
const OFFRE_ANNULEE = { id: 'b-annulee', dateISO: '2026-10-01', status: 'annulee', acteComplete: false };
const OFFRE_REGLEE = { id: 'b-reglee', dateISO: '2026-06-15', status: 'retenue', acteComplete: true, regleLe: '2026-06-15T14:00:00Z' };
const OFFRE_EN_COURS = { id: 'b-en-cours', dateISO: '2026-12-20', status: 'retenue', acteComplete: false };

const MAINTENANT = '2026-09-05T12:00:00Z';

test('un plan d’effacement ne compte jamais deux fois la même offre', () => {
  const plan = domain.erasurePlan({
    courriel: 'roy@exemple.ca',
    offres: [OFFRE_OUVERTE, OFFRE_ANNULEE, OFFRE_REGLEE, OFFRE_EN_COURS],
    at: MAINTENANT,
  });
  const effacees = plan.efface.filter((l) => l.famille === 'offre').flatMap((l) => l.ids);
  const conservees = plan.conserve.filter((l) => l.famille === 'offre').flatMap((l) => l.ids);
  const toutes = [...effacees, ...conservees].sort();
  assert.deepEqual(toutes, ['b-annulee', 'b-en-cours', 'b-ouverte', 'b-reglee']);
  assert.equal(new Set(toutes).size, toutes.length, 'une offre apparaît des deux côtés du plan');
});

test('une offre SANS acte réglé s’efface', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_OUVERTE, OFFRE_ANNULEE], at: MAINTENANT });
  const effacees = plan.efface.filter((l) => l.famille === 'offre').flatMap((l) => l.ids).sort();
  assert.deepEqual(effacees, ['b-annulee', 'b-ouverte']);
  assert.equal(plan.conserve.filter((l) => l.famille === 'offre').length, 0);
});

test('une offre dont l’ACTE EST RÉGLÉ est CONSERVÉE, et le plan dit pourquoi et jusqu’à quand', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_REGLEE], at: MAINTENANT });
  assert.equal(plan.efface.filter((l) => l.famille === 'offre').length, 0, 'un acte réglé ne s’efface pas');

  const ligne = plan.conserve.find((l) => l.famille === 'offre');
  assert.ok(ligne, 'l’offre réglée doit apparaître dans ce qui est conservé');
  assert.deepEqual(ligne.ids, ['b-reglee']);
  assert.ok(ligne.motif, 'une conservation sans motif est un refus non motivé');
  assert.ok(ligne.base, 'une conservation doit nommer sa base légale');
  // Sept ans après le RÈGLEMENT — la pièce comptable, pas la date de signature.
  const attendu = new Date(Date.UTC(2033, 5, 15, 14, 0, 0)).toISOString().slice(0, 10);
  assert.equal(ligne.jusqua, attendu);
});

test('un acte EN COURS est conservé : effacer le client à mi-mandat abandonnerait le notaire', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_EN_COURS], at: MAINTENANT });
  const ligne = plan.conserve.find((l) => l.famille === 'offre');
  assert.ok(ligne, 'un acte retenu non encore réglé doit être conservé');
  assert.deepEqual(ligne.ids, ['b-en-cours']);
  assert.match(ligne.motif, /en cours|mandat/i);
});

test('le journal d’audit n’est JAMAIS effacé, même quand rien d’autre ne reste', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [], at: MAINTENANT });
  const audit = plan.conserve.find((l) => l.famille === 'journal_audit');
  assert.ok(audit, 'le journal d’audit doit figurer dans ce qui survit');
  assert.equal(plan.efface.some((l) => l.famille === 'journal_audit'), false);
});

test('le désabonnement survit à l’effacement — sinon le refus serait oublié', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [], desabonne: true, at: MAINTENANT });
  const ligne = plan.conserve.find((l) => l.famille === 'desabonnement');
  assert.ok(ligne, 'un refus de sollicitation doit survivre');
  assert.match(ligne.motif, /refus|oubli/i);
});

test('le plan se déclare COMPLET seulement quand rien d’identifiant ne survit', () => {
  // AUCUN plan ne peut se déclarer complet aujourd'hui, et c'est un FAIT du
  // code, pas une opinion : trois registres gardent l'adresse en clair et
  // aucun adaptateur ne sait les vider. Le test le prouve par la porte plutôt
  // que de le supposer.
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_ANNULEE], at: MAINTENANT });
  assert.equal(plan.complet, false, 'un effacement dont l’adresse survit n’est pas complet');
  assert.deepEqual(
    plan.residus.map((l) => l.famille).sort(),
    ['destinataire_campagne', 'index_client', 'journal_sujet'],
    'les registres hors de portée doivent être NOMMÉS, pas tus'
  );

  // Le journal d'audit survit toujours, mais il ne porte plus ni adresse ni
  // courriel (politique §1) : il ne rend pas, LUI, l'effacement incomplet.
  const conserves = plan.conserve.map((l) => l.famille);
  assert.ok(conserves.includes('journal_audit'));
  assert.equal(plan.conserve.some((l) => l.famille === 'offre'), false, 'aucune offre ne devait être conservée ici');

  const partiel = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_REGLEE], at: MAINTENANT });
  assert.equal(partiel.complet, false, 'un acte réglé rend l’effacement PARTIEL, et il faut le dire');
});

test('le plan ne promet JAMAIS une destruction que le code ne sait pas faire', () => {
  // LA RÉGRESSION QUE CE TEST GARDE. Le plan poussait `avis`, `journal_sujet`
  // et `destinataire_campagne` dans « ce qui sera effacé » alors qu'aucune
  // porte de suppression n'existe pour elles, dans aucun des deux adaptateurs :
  // l'opérateur confirmait, la console disait « Dossier effacé », et l'adresse
  // restait en clair. Une ligne annoncée effacée doit dire si elle est
  // EXÉCUTABLE, et une ligne qui ne l'est pas doit dire pourquoi.
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_ANNULEE], at: MAINTENANT });
  for (const ligne of plan.efface) {
    assert.equal(typeof ligne.executable, 'boolean', `« ${ligne.famille} » n’annonce pas si elle est exécutable`);
    if (!ligne.executable) {
      assert.ok(ligne.note, `« ${ligne.famille} » est hors de portée sans dire pourquoi`);
      assert.equal(typeof ligne.identifiante, 'boolean', `« ${ligne.famille} » ne dit pas si le résidu NOMME encore la personne`);
    }
  }
  // La seule famille que l'exécutant sait détruire est l'offre.
  assert.deepEqual(plan.efface.filter((l) => l.executable).map((l) => l.famille), ['offre']);
  // Et un résidu qui ne nomme plus personne n'interdit pas le mot « complet ».
  const avis = plan.efface.find((l) => l.famille === 'avis');
  assert.equal(avis.identifiante, false, 'la partition des avis dérive du jeton de l’offre, pas de l’adresse');
  assert.equal(plan.residus.some((l) => l.famille === 'avis'), false);
});

test('sans adresse, il n’y a pas de sujet à effacer', () => {
  assert.throws(() => domain.erasurePlan({ offres: [] }), /adresse/i);
});

test('le plan porte l’adresse normalisée et son instant', () => {
  const plan = domain.erasurePlan({ courriel: '  Roy@Exemple.CA ', offres: [], at: MAINTENANT });
  assert.equal(plan.courriel, 'roy@exemple.ca');
  assert.equal(plan.at, MAINTENANT);
});

test('les familles nominatives sans obligation de garde sont NOMMÉES, avec ce qui leur manque', () => {
  const plan = domain.erasurePlan({ courriel: 'roy@exemple.ca', offres: [OFFRE_ANNULEE], at: MAINTENANT });
  const lignes = new Map(plan.efface.map((l) => [l.famille, l]));
  // Elles doivent figurer au plan — les taire laisserait croire que Nota ne les
  // détient pas. Mais aucune ne doit se présenter comme exécutable tant qu'il
  // n'existe aucune porte pour les vider.
  for (const famille of ['avis', 'journal_sujet', 'destinataire_campagne', 'index_client']) {
    const ligne = lignes.get(famille);
    assert.ok(ligne, `${famille} devrait figurer au plan`);
    assert.equal(ligne.executable, false, `${famille} s’annonce effaçable alors qu’aucune porte ne l’efface`);
  }
});

test('rien n’est à la fois effacé et conservé', () => {
  const plan = domain.erasurePlan({
    courriel: 'roy@exemple.ca',
    offres: [OFFRE_OUVERTE, OFFRE_REGLEE],
    desabonne: true,
    at: MAINTENANT,
  });
  const eff = new Set(plan.efface.map((l) => l.famille));
  const cons = plan.conserve.map((l) => l.famille);
  // « offre » est la seule famille légitimement des deux côtés (par identifiant,
  // vérifié plus haut) ; toute AUTRE famille des deux côtés est une contradiction.
  const contradictions = cons.filter((f) => f !== 'offre' && eff.has(f));
  assert.deepEqual(contradictions, [], 'une famille annoncée effacée ET conservée');
});

test('une clé de réglage HÉRITÉE garde la main — renommer ne doit rien détruire', () => {
  // « NOTA_NOTIF_RETENTION_DAYS » était la clé des avis avant que la politique
  // n'existe. Un déploiement réglé à 30 jours sous l'ancien nom qui retomberait
  // sur 180 verrait sa rétention ALLONGÉE sans que personne ne l'ait demandé.
  assert.equal(domain.retentionDays('avis', { NOTA_NOTIF_RETENTION_DAYS: '30' }), 30);
  // Les deux posées : la canonique tranche.
  assert.equal(domain.retentionDays('avis', { NOTA_AVIS_RETENTION_DAYS: '45', NOTA_NOTIF_RETENTION_DAYS: '30' }), 45);
});

// ---------------------------------------------------------------------------
// 5. Ce qu'une offre effacée devient
// ---------------------------------------------------------------------------

const OFFRE_NOMINATIVE = {
  id: 'b1',
  dateISO: '2026-10-01',
  serviceId: 'refinancement',
  montant: 2000,
  status: 'annulee',
  nom: 'Éveline Roy',
  courriel: 'roy@exemple.ca',
  telephone: '418 555-0100',
  prefixe: 'G1R',
  parrain: 'EVEROY',
  dossier: { adresse: '12 rue des Érables', piece: 'acte.pdf' },
  pricing: { valeur_pret: 250000, preteur: 'banque_nationale' },
  messages: [{ de: 'client', texte: 'Bonjour' }],
  createdAt: '2026-09-01',
  ttl: 1893456000,
};

test('une offre effacée ne porte plus RIEN qui nomme quelqu’un', () => {
  const nu = domain.redactedBid(OFFRE_NOMINATIVE, MAINTENANT);
  for (const champ of ['nom', 'courriel', 'telephone', 'dossier', 'pricing', 'parrain', 'messages']) {
    assert.equal(nu[champ], null, `« ${champ} » survit à l’effacement`);
  }
});

test('une offre effacée garde ce qui ne nomme personne — sinon le carnet et les comptes se trouent', () => {
  const nu = domain.redactedBid(OFFRE_NOMINATIVE, MAINTENANT);
  assert.equal(nu.id, 'b1');
  assert.equal(nu.dateISO, '2026-10-01');
  assert.equal(nu.serviceId, 'refinancement');
  assert.equal(nu.montant, 2000);
  assert.equal(nu.status, 'annulee');
  assert.equal(nu.ttl, OFFRE_NOMINATIVE.ttl, 'le ttl ne doit pas être perdu : l’élément deviendrait éternel');
});

test('une offre effacée le DIT — « effacé » et « jamais connu » ne se confondent pas', () => {
  const nu = domain.redactedBid(OFFRE_NOMINATIVE, MAINTENANT);
  assert.equal(nu.efface, true);
  assert.equal(nu.effaceLe, MAINTENANT);
});

test('effacer deux fois ne change rien la seconde fois', () => {
  const une = domain.redactedBid(OFFRE_NOMINATIVE, MAINTENANT);
  const deux = domain.redactedBid(une, '2027-01-01T00:00:00Z');
  assert.equal(deux.effaceLe, MAINTENANT, 'le premier effacement est le seul qui compte');
  assert.deepEqual(deux, une);
});

test('une offre absente ne se maquille pas en offre effacée', () => {
  assert.equal(domain.redactedBid(null, MAINTENANT), null);
});
