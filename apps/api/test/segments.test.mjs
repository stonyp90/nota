import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMemoryRepo } = require('../src/repo-memory.js');
const segments = require('../src/segments.js');

/**
 * Viser quelqu'un, et savoir POURQUOI on l'a visé.
 *
 * Ce module ne poste rien : il résout une audience. Les tests qui suivent
 * portent donc sur deux choses, et deux seulement — le catalogue est-il une
 * donnée lisible, et les garde-fous tiennent-ils quand on essaie de passer
 * outre. Le reste (le gabarit, l'envoi, la file) appartient à d'autres.
 *
 * Deux textes commandent ces garde-fous :
 *
 * - **LCAP** (Loi canadienne anti-pourriel, L.C. 2010, ch. 23, art. 6 et 10) —
 *   un message électronique COMMERCIAL exige une base de consentement, exprès
 *   ou tacite. Une relance anti-attrition en est un ; la veille d'une
 *   signature déjà retenue n'en est pas un.
 * - **Art. 56 1° du Code de déontologie des notaires** — est dérogatoire le
 *   fait « d'inciter quelqu'un de façon pressante ou répétée à recourir à ses
 *   services professionnels ». Le plafond de fréquence est la réponse produit
 *   à cet article : c'est lui qu'on teste, pas une bonne intention.
 */

const NOW = '2026-09-02T14:00:00.000Z'; // 10 h à Québec — le jour ouvrable est le 2
const JOUR = '2026-09-02';
const now = () => NOW;

// Un instant ISO à N jours du présent, pour dater createdAt / lastSeenAt.
function ilYA(jours) {
  return new Date(Date.parse(NOW) - jours * 86400000).toISOString();
}
function dans(jours) {
  return new Date(Date.parse(NOW) + jours * 86400000).toISOString().slice(0, 10);
}

// Un notaire « en règle » : actif, payable, fiche déclarée, vu ce matin. Chaque
// test ne dérange que le champ qu'il éprouve.
function notaire(id, over = {}) {
  return {
    id,
    email: id + '@etude.test',
    label: 'Étude ' + id,
    status: 'active',
    chargesEnabled: true,
    connectAccountId: 'acct_' + id,
    lienCNQ: 'https://www.cnq.org/notaire/' + id,
    lastSeenAt: ilYA(0),
    createdAt: ilYA(400),
    actsCompleted: 3,
    proposalsCount: 5,
    ...over,
  };
}

// Une offre vivante : ouverte, autorisée, avec un courriel joignable.
function offre(id, over = {}) {
  return {
    id,
    serviceId: 'refinancement',
    dateISO: dans(10),
    montant: 2400,
    status: 'ouverte',
    courriel: id + '@client.test',
    paymentStatus: 'authorized',
    createdAt: ilYA(5),
    prefixe: 'G1R',
    ...over,
  };
}

async function repoAvec({ notaires = [], offres = [], desabonnes = [] } = {}) {
  const repo = createMemoryRepo(offres);
  for (const n of notaires) await repo.putNotary(n);
  for (const e of desabonnes) await repo.putUnsubscribe(e, NOW);
  return repo;
}

const emails = (r) => r.destinataires.map((d) => d.email).sort();

// ---------------------------------------------------------------------------
// 1. Le catalogue est une DONNÉE
// ---------------------------------------------------------------------------

test('le catalogue déclare chaque segment comme une donnée complète', () => {
  assert.ok(Array.isArray(segments.SEGMENTS));
  assert.ok(segments.SEGMENTS.length >= 6, 'les six segments du besoin, au minimum');

  const vus = new Set();
  for (const s of segments.SEGMENTS) {
    assert.ok(s.id && !vus.has(s.id), 'un id, unique : ' + s.id);
    vus.add(s.id);
    assert.ok(s.libelle && s.libelle.fr && s.libelle.en, s.id + ' : un libellé FR et EN');
    assert.notEqual(s.libelle.fr, s.libelle.en, s.id + ' : deux langues, pas une copie');
    assert.ok(typeof s.vise === 'string' && s.vise.length > 20, s.id + ' : ce qu’il vise');
    assert.ok([segments.AUDIENCE.NOTAIRE, segments.AUDIENCE.CLIENT].includes(s.audience), s.id);
    assert.ok([segments.NATURE.COMMERCIAL, segments.NATURE.TRANSACTIONNEL].includes(s.nature), s.id);
    assert.equal(typeof s.match, 'function', s.id + ' : le prédicat qui le calcule');
    // Les seuils sont des PARAMÈTRES bornés, jamais des constantes enfouies.
    for (const [nom, p] of Object.entries(s.params || {})) {
      assert.equal(typeof p.defaut, 'number', s.id + '.' + nom);
      assert.ok(p.min <= p.defaut && p.defaut <= p.max, s.id + '.' + nom + ' : défaut dans ses bornes');
    }
  }

  // Les six segments que le besoin nomme.
  for (const id of [
    'notaires_jamais_actifs',
    'notaires_silencieux',
    'notaires_sans_paiement',
    'notaires_sans_cnq',
    'clients_offre_proche',
    'clients_offre_expiree',
  ]) {
    assert.ok(segments.segmentById(id), 'segment attendu : ' + id);
  }
});

test('la description du catalogue est sérialisable — aucun prédicat sur le fil', () => {
  const vue = segments.describeSegments();
  const aller = JSON.parse(JSON.stringify(vue));
  assert.deepEqual(aller, vue, 'ce que la console reçoit doit survivre à un JSON');
  const silence = vue.find((s) => s.id === 'notaires_silencieux');
  assert.equal(silence.params.joursSilence.defaut, 30);
  assert.equal(silence.match, undefined, 'le prédicat ne quitte jamais le module');
});

// ---------------------------------------------------------------------------
// 2. Les trois formes
// ---------------------------------------------------------------------------

test('un utilisateur nommé : un destinataire, une raison', async () => {
  const repo = await repoAvec({ notaires: [notaire('roy')] });
  const r = await segments.resolveAudience({ type: 'user', email: 'Roy@Etude.test' }, { repo, now });

  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.total, 1);
  assert.equal(r.destinataires[0].email, 'roy@etude.test', 'normalisé en minuscules');
  assert.equal(r.destinataires[0].audience, 'notaire', 'reconnu dans le registre notaire');
  assert.match(r.destinataires[0].raison, /nommément/);
});

test('un utilisateur nommé est COMMERCIAL par défaut — le doute joue contre l’envoi', async () => {
  const repo = await repoAvec({ notaires: [notaire('roy')] });
  const r = await segments.resolveAudience({ type: 'user', email: 'roy@etude.test' }, { repo, now });
  assert.equal(r.nature, segments.NATURE.COMMERCIAL);
  assert.ok(r.destinataires[0].consentement, 'une base de consentement a dû être établie');
});

test('un courriel qui n’en est pas un est refusé, typé', async () => {
  const repo = await repoAvec({});
  const r = await segments.resolveAudience({ type: 'user', email: 'pas-un-courriel' }, { repo, now });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'courriel_invalide');
  assert.deepEqual(r.destinataires, []);
});

test('un groupe nommé rend ses membres', async () => {
  const repo = await repoAvec({ notaires: [notaire('roy'), notaire('lavoie')] });
  repo.getAudienceGroup = async (id) =>
    id === 'pilote'
      ? { id: 'pilote', libelle: 'Pilote 198.1', audience: 'notaire', membres: ['roy@etude.test', 'lavoie@etude.test'] }
      : null;

  const r = await segments.resolveAudience({ type: 'group', groupId: 'pilote' }, { repo, now });
  assert.equal(r.ok, true);
  assert.deepEqual(emails(r), ['lavoie@etude.test', 'roy@etude.test']);
  assert.match(r.destinataires[0].raison, /pilote/);
});

test('un groupe inconnu — ou un dépôt sans porte de groupes — est refusé, jamais silencieux', async () => {
  const sansPorte = await repoAvec({});
  const a = await segments.resolveAudience({ type: 'group', groupId: 'pilote' }, { repo: sansPorte, now });
  assert.equal(a.ok, false);
  assert.equal(a.errors[0].code, 'groupe_inconnu');

  const avecPorte = await repoAvec({});
  avecPorte.getAudienceGroup = async () => null;
  const b = await segments.resolveAudience({ type: 'group', groupId: 'fantome' }, { repo: avecPorte, now });
  assert.equal(b.ok, false);
  assert.equal(b.errors[0].code, 'groupe_inconnu');
});

test('un segment inconnu est refusé, typé', async () => {
  const repo = await repoAvec({});
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'inexistant' }, { repo, now });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'segment_inconnu');
});

test('un type de cible inconnu est refusé', async () => {
  const repo = await repoAvec({});
  const r = await segments.resolveAudience({ type: 'tout_le_monde' }, { repo, now });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'type_inconnu');
});

// ---------------------------------------------------------------------------
// 3. Les segments, un par un
// ---------------------------------------------------------------------------

test('notaires_jamais_actifs : inscrit, rien fait — et pas celui d’hier', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('dormeur', { actsCompleted: 0, proposalsCount: 0, acceptsCount: 0, declinesCount: 0, createdAt: ilYA(60) }),
      notaire('frais', { actsCompleted: 0, proposalsCount: 0, acceptsCount: 0, declinesCount: 0, createdAt: ilYA(1) }),
      notaire('actif', { actsCompleted: 0, proposalsCount: 0, acceptsCount: 0, declinesCount: 2, createdAt: ilYA(60) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_jamais_actifs' }, { repo, now });

  assert.deepEqual(emails(r), ['dormeur@etude.test'], 'décliner EST une réponse ; un inscrit d’hier a droit à son délai');
  assert.match(r.destinataires[0].raison, /aucun acte/);
});

test('notaires_silencieux : l’attrition, mesurée en jours, seuil paramétrable', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('parti', { lastSeenAt: ilYA(45) }),
      notaire('tiede', { lastSeenAt: ilYA(20) }),
      notaire('present', { lastSeenAt: ilYA(1) }),
    ],
  });

  const defaut = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.deepEqual(emails(defaut), ['parti@etude.test'], '30 jours par défaut');
  assert.match(defaut.destinataires[0].raison, /45/, 'la raison porte la mesure, pas seulement l’étiquette');

  const abaisse = await segments.resolveAudience(
    { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence: 14 } },
    { repo, now }
  );
  assert.deepEqual(emails(abaisse), ['parti@etude.test', 'tiede@etude.test']);
});

test('notaires_silencieux : un notaire dont on ne peut RIEN dater n’est jamais visé', async () => {
  const repo = await repoAvec({
    notaires: [{ id: 'muet', email: 'muet@etude.test', status: 'active', chargesEnabled: true }],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.equal(r.total, 0, 'un silence non mesurable n’est pas un silence prouvé');
});

test('un seuil absurde est refusé — le paramètre est borné, pas décoratif', async () => {
  const repo = await repoAvec({ notaires: [notaire('parti', { lastSeenAt: ilYA(45) })] });

  for (const joursSilence of [0, -3, 100000, 'trente', 2.5]) {
    const r = await segments.resolveAudience(
      { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence } },
      { repo, now }
    );
    assert.equal(r.ok, false, 'refus attendu pour ' + JSON.stringify(joursSilence));
    assert.equal(r.errors[0].code, 'parametre_invalide');
    assert.equal(r.errors[0].param, 'joursSilence');
    assert.deepEqual(r.destinataires, []);
  }
});

test('notaires_sans_paiement : ceux qui ne peuvent pas être payés', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('bloque', { status: 'onboarding', chargesEnabled: false, connectAccountId: null, createdAt: ilYA(30) }),
      notaire('restreint', { status: 'restricted', chargesEnabled: false, createdAt: ilYA(30) }),
      notaire('payable'),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_paiement' }, { repo, now });

  assert.deepEqual(emails(r), ['bloque@etude.test', 'restreint@etude.test']);
  // C'est une nouvelle sur SON compte, pas une sollicitation : LCAP ne l'exige
  // pas commercial, et le plafond de fréquence ne doit pas la retenir.
  assert.equal(r.nature, segments.NATURE.TRANSACTIONNEL);
});

test('notaires_sans_cnq : aucune fiche déclarée', async () => {
  const repo = await repoAvec({
    notaires: [notaire('sansfiche', { lienCNQ: null, createdAt: ilYA(30) }), notaire('avecfiche')],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_cnq' }, { repo, now });
  assert.deepEqual(emails(r), ['sansfiche@etude.test']);
  assert.match(r.destinataires[0].raison, /CNQ/);
});

test('clients_offre_proche : l’offre ouverte dont la date approche', async () => {
  const repo = await repoAvec({
    offres: [
      offre('demain', { dateISO: dans(1) }),
      offre('loin', { dateISO: dans(20) }),
      offre('retenue', { dateISO: dans(1), status: 'retenue' }),
      offre('morte', { dateISO: dans(1), paymentStatus: 'void' }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'clients_offre_proche' }, { repo, now });

  assert.deepEqual(emails(r), ['demain@client.test']);
  assert.equal(r.nature, segments.NATURE.TRANSACTIONNEL, 'la veille de SA propre signature n’est pas une réclame');
  assert.match(r.destinataires[0].raison, /1/);
});

test('clients_offre_expiree : la date est passée, personne ne l’a prise', async () => {
  const repo = await repoAvec({
    offres: [
      offre('rate', { dateISO: dans(-5) }),
      offre('vieux', { dateISO: dans(-200) }),
      offre('avenir', { dateISO: dans(5) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'clients_offre_expiree' }, { repo, now });

  assert.deepEqual(emails(r), ['rate@client.test'], '30 jours par défaut : au-delà, ce n’est plus une réactivation');
  assert.equal(r.nature, segments.NATURE.COMMERCIAL, 'réactiver, c’est solliciter');
});

test('une audience vide est une réponse, pas une erreur', async () => {
  const repo = await repoAvec({ notaires: [notaire('parfait')] });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_cnq' }, { repo, now });
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  assert.deepEqual(r.destinataires, []);
});

test('un sujet sans courriel est écarté et compté — jamais une adresse inventée', async () => {
  const repo = await repoAvec({
    notaires: [notaire('anonyme', { email: null, lienCNQ: null, createdAt: ilYA(30) })],
    offres: [],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_cnq' }, { repo, now });
  assert.equal(r.total, 0);
  assert.equal(r.exclus.sansCourriel, 1);
});

// ---------------------------------------------------------------------------
// 4. Les garde-fous
// ---------------------------------------------------------------------------

test('déduplication : présent dans un groupe ET dans un segment, écrit une fois', async () => {
  const repo = await repoAvec({ notaires: [notaire('parti', { lastSeenAt: ilYA(45) })] });
  repo.getAudienceGroup = async () => ({ id: 'pilote', audience: 'notaire', membres: ['PARTI@etude.test'] });

  const r = await segments.resolveAudience(
    [
      { type: 'group', groupId: 'pilote' },
      { type: 'segment', segmentId: 'notaires_silencieux' },
    ],
    { repo, now }
  );

  assert.equal(r.total, 1, 'une adresse, un envoi');
  assert.equal(r.exclus.doublons, 1);
  assert.match(r.destinataires[0].raison, /pilote/, 'la première raison rencontrée est celle qu’on garde');
});

test('le désabonnement l’emporte — écarté par la résolution, et compté', async () => {
  const repo = await repoAvec({
    notaires: [notaire('parti', { lastSeenAt: ilYA(45) }), notaire('sorti', { lastSeenAt: ilYA(45) })],
    desabonnes: ['sorti@etude.test'],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });

  assert.deepEqual(emails(r), ['parti@etude.test']);
  assert.equal(r.exclus.desabonnes, 1, 'l’opérateur doit voir ce qu’il n’a PAS atteint');
});

test('le désabonnement l’emporte aussi sur le transactionnel et sur une cible nommée', async () => {
  const repo = await repoAvec({ notaires: [notaire('sorti')], desabonnes: ['sorti@etude.test'] });

  const nomme = await segments.resolveAudience({ type: 'user', email: 'sorti@etude.test' }, { repo, now });
  assert.equal(nomme.total, 0);
  assert.equal(nomme.exclus.desabonnes, 1);

  const transactionnel = await segments.resolveAudience(
    { type: 'user', email: 'sorti@etude.test', nature: segments.NATURE.TRANSACTIONNEL },
    { repo, now }
  );
  assert.equal(transactionnel.total, 0, 'aucune nature ne rouvre une porte fermée par le destinataire');
});

test('tout le monde désabonné : ok, total 0, et le compte exact de ce qui a été perdu', async () => {
  const repo = await repoAvec({
    notaires: [notaire('a', { lastSeenAt: ilYA(45) }), notaire('b', { lastSeenAt: ilYA(45) })],
    desabonnes: ['a@etude.test', 'b@etude.test'],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  assert.equal(r.exclus.desabonnes, 2);
});

test('plafond de taille : au-delà, la résolution exige une confirmation explicite', async () => {
  const notaires = [];
  for (let i = 0; i < 12; i += 1) notaires.push(notaire('n' + i, { lastSeenAt: ilYA(45) }));
  const repo = await repoAvec({ notaires });

  const refus = await segments.resolveAudience(
    { type: 'segment', segmentId: 'notaires_silencieux' },
    { repo, now, plafond: 10 }
  );
  assert.equal(refus.ok, false);
  assert.equal(refus.errors[0].code, 'confirmation_requise');
  assert.deepEqual(refus.destinataires, [], 'rien d’envoyable tant que personne n’a confirmé');
  assert.equal(refus.total, 12, 'mais le décompte est dit : on refuse en connaissance de cause');
  assert.equal(refus.plafond.depasse, true);

  const confirme = await segments.resolveAudience(
    { type: 'segment', segmentId: 'notaires_silencieux' },
    { repo, now, plafond: 10, confirme: true }
  );
  assert.equal(confirme.ok, true);
  assert.equal(confirme.destinataires.length, 12);
  assert.equal(confirme.plafond.confirme, true);
});

test('un plafond illisible reprend le défaut — jamais un plafond de zéro', async () => {
  const repo = await repoAvec({ notaires: [notaire('parti', { lastSeenAt: ilYA(45) })] });
  for (const plafond of [null, '', undefined, 0, -5]) {
    const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now, plafond });
    assert.equal(r.ok, true, 'plafond ' + JSON.stringify(plafond));
    assert.equal(r.plafond.limite, segments.GARDES.plafondAudience);
    assert.equal(r.total, 1);
  }
});

test('mode dryRun : le décompte et un échantillon, rien d’envoyable', async () => {
  const notaires = [];
  for (let i = 0; i < 12; i += 1) notaires.push(notaire('n' + i, { lastSeenAt: ilYA(45) }));
  const repo = await repoAvec({ notaires });

  const r = await segments.resolveAudience(
    { type: 'segment', segmentId: 'notaires_silencieux' },
    { repo, now, plafond: 10, dryRun: true }
  );

  assert.equal(r.ok, true, 'un essai à blanc est justement comment on découvre qu’on dépasse');
  assert.equal(r.dryRun, true);
  assert.equal(r.total, 12);
  assert.deepEqual(r.destinataires, [], 'aucune liste d’envoi ne sort d’un essai à blanc');
  assert.equal(r.plafond.depasse, true, 'le dépassement est tout de même annoncé');
  assert.ok(r.echantillon.length > 0 && r.echantillon.length <= segments.GARDES.echantillon);
  for (const e of r.echantillon) {
    assert.match(e.email, /•/, 'l’échantillon est masqué : reconnaissable, pas expédiable');
    assert.ok(e.raison);
  }
});

test('plafond de fréquence : personne deux fois dans la même fenêtre (art. 56 1°)', async () => {
  const repo = await repoAvec({
    notaires: [notaire('recent', { lastSeenAt: ilYA(45) }), notaire('ancien', { lastSeenAt: ilYA(45) })],
  });
  // Le port dont le module a besoin : la dernière campagne COMMERCIALE reçue.
  repo.lastCampaignAtMany = async (adresses) => {
    const out = {};
    for (const a of adresses) out[a] = a === 'recent@etude.test' ? ilYA(2) : ilYA(200);
    return out;
  };

  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.deepEqual(emails(r), ['ancien@etude.test']);
  assert.equal(r.exclus.frequence, 1);
  assert.equal(r.garde.frequence, 'appliquee');

  // La fenêtre est un paramètre : élargie, elle retient aussi l'ancien.
  const large = await segments.resolveAudience(
    { type: 'segment', segmentId: 'notaires_silencieux' },
    { repo, now, fenetreHeures: 24 * 365 }
  );
  assert.equal(large.total, 0);
  assert.equal(large.exclus.frequence, 2);
});

test('plafond de fréquence : la porte de repli marche par adresse, une par une', async () => {
  const repo = await repoAvec({
    notaires: [notaire('recent', { lastSeenAt: ilYA(45) }), notaire('ancien', { lastSeenAt: ilYA(45) })],
  });
  // Un dépôt qui n'offre QUE la porte unitaire : c'est elle qu'on éprouve ici,
  // alors on retire celle que la résolution préfère.
  delete repo.lastCampaignAtMany;
  repo.lastCampaignAt = async (a) => (a === 'recent@etude.test' ? ilYA(2) : null);

  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.deepEqual(emails(r), ['ancien@etude.test']);
  assert.equal(r.garde.frequence, 'appliquee');
});

test('plafond de fréquence : sans registre, la garde le DIT au lieu de faire semblant', async () => {
  const repo = await repoAvec({ notaires: [notaire('parti', { lastSeenAt: ilYA(45) })] });
  // Les adaptateurs portent désormais le registre ; ce test décrit le dépôt qui
  // ne l'a PAS — un déploiement plus vieux, un adaptateur tiers — et le
  // fabrique donc explicitement en retirant les deux portes.
  delete repo.lastCampaignAtMany;
  delete repo.lastCampaignAt;
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });

  assert.equal(r.garde.frequence, 'non_verifiee');
  assert.equal(r.avertissements[0].code, 'frequence_non_verifiee');
  assert.equal(r.total, 1, 'la résolution reste utilisable — mais l’opérateur sait ce qui n’a pas été vérifié');
});

test('le transactionnel ne subit pas le plafond de fréquence : un service n’est pas une réclame', async () => {
  const repo = await repoAvec({
    notaires: [notaire('bloque', { status: 'onboarding', chargesEnabled: false, createdAt: ilYA(30) })],
  });
  repo.lastCampaignAtMany = async (adresses) => Object.fromEntries(adresses.map((a) => [a, ilYA(0)]));

  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_paiement' }, { repo, now });
  assert.equal(r.total, 1);
  assert.equal(r.exclus.frequence, 0);
});

test('cible mixte : le plafond de fréquence ne retient que la part commerciale', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('relance', { lastSeenAt: ilYA(45) }),
      notaire('bloque', { status: 'onboarding', chargesEnabled: false, createdAt: ilYA(30) }),
    ],
  });
  // Les deux ont reçu quelque chose ce matin.
  repo.lastCampaignAtMany = async (adresses) => Object.fromEntries(adresses.map((a) => [a, ilYA(0)]));

  const r = await segments.resolveAudience(
    [
      { type: 'segment', segmentId: 'notaires_silencieux' },
      { type: 'segment', segmentId: 'notaires_sans_paiement' },
    ],
    { repo, now }
  );

  assert.equal(r.nature, segments.NATURE.COMMERCIAL, 'la plus stricte des natures mène la campagne');
  assert.deepEqual(emails(r), ['bloque@etude.test'], 'l’avis de compte passe, la relance attend');
  assert.equal(r.exclus.frequence, 1);
});

// ---------------------------------------------------------------------------
// 5. LCAP — la base de consentement
// ---------------------------------------------------------------------------

test('LCAP : un commercial sans base de consentement est écarté, et compté', async () => {
  const repo = await repoAvec({
    notaires: [
      // Contrat en cours (compte Connect actif) : consentement tacite, LCAP 10(10).
      notaire('encours', { lastSeenAt: ilYA(45) }),
      // Ni contrat en cours, ni candidature récente : plus rien à invoquer.
      notaire('perdu', { status: 'restricted', chargesEnabled: false, lastSeenAt: ilYA(45), createdAt: ilYA(900) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });

  assert.deepEqual(emails(r), ['encours@etude.test']);
  assert.equal(r.exclus.sansConsentement, 1);
  assert.equal(r.destinataires[0].consentement.base, 'tacite');
  assert.match(r.destinataires[0].consentement.motif, /contrat/);
});

test('LCAP : une candidature récente vaut consentement tacite ; une vieille, non', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('candidat', { status: 'onboarding', chargesEnabled: false, lienCNQ: null, createdAt: ilYA(30) }),
      notaire('oublie', { status: 'onboarding', chargesEnabled: false, lienCNQ: null, createdAt: ilYA(300) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_cnq' }, { repo, now });

  assert.deepEqual(emails(r), ['candidat@etude.test'], 'la fenêtre « demande » de LCAP 10(10) est de 6 mois');
  assert.equal(r.exclus.sansConsentement, 1);
  assert.match(r.destinataires[0].consentement.motif, /candidature/);
});

test('LCAP : le transactionnel n’exige aucune base de consentement', async () => {
  const repo = await repoAvec({
    notaires: [
      notaire('perdu', { status: 'restricted', chargesEnabled: false, createdAt: ilYA(900) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_sans_paiement' }, { repo, now });
  assert.equal(r.total, 1);
  assert.equal(r.exclus.sansConsentement, 0);
  assert.equal(r.destinataires[0].consentement, null);
});

test('LCAP : un registre de consentement exprès, quand il existera, l’emporte', async () => {
  const repo = await repoAvec({
    notaires: [notaire('perdu', { status: 'restricted', chargesEnabled: false, lastSeenAt: ilYA(45), createdAt: ilYA(900) })],
  });
  repo.getEmailConsent = async (email) =>
    email === 'perdu@etude.test' ? { base: 'expres', at: ilYA(10), source: 'inscription' } : null;

  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.equal(r.total, 1);
  assert.equal(r.destinataires[0].consentement.base, 'expres');
  assert.equal(r.garde.consentement, 'registre');
});

test('LCAP : sans registre, la garde dit qu’elle a DÉDUIT la base', async () => {
  const repo = await repoAvec({ notaires: [notaire('encours', { lastSeenAt: ilYA(45) })] });
  // Le dépôt porte désormais la porte du registre ; c'est le dépôt qui ne l'a
  // PAS qu'on décrit ici, alors on la retire pour le fabriquer.
  delete repo.getEmailConsent;
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.equal(r.garde.consentement, 'deduit');
});

test('LCAP : le registre BRANCHÉ mais VIDE ne vaut pas une base — la déduction reprend la main', async () => {
  // La régression qu'on redoute : brancher `getEmailConsent` sur un adaptateur
  // ferait basculer la garde sur « registre », et un registre vide écarterait
  // alors TOUT LE MONDE. Il n'en est rien — un registre muet redescend sur la
  // déduction de l'art. 10(10), et seul ce qui n'entre dans aucun cas est
  // écarté.
  const repo = await repoAvec({
    notaires: [
      notaire('encours', { lastSeenAt: ilYA(45) }),
      notaire('perdu', { status: 'restricted', chargesEnabled: false, connectAccountId: null, lastSeenAt: ilYA(45), createdAt: ilYA(900) }),
    ],
  });
  const r = await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.equal(r.garde.consentement, 'registre');
  assert.deepEqual(emails(r), ['encours@etude.test']);
  assert.equal(r.exclus.sansConsentement, 1);
});

test('LCAP : un client dont l’offre a été payée garde 24 mois ; une offre jamais autorisée, 6', async () => {
  const repo = await repoAvec({
    offres: [
      offre('paye', { dateISO: dans(-5), createdAt: ilYA(500) }),
      offre('jamais', { dateISO: dans(-5), createdAt: ilYA(300), paymentStatus: undefined, paymentIntentId: null }),
    ],
  });
  const r = await segments.resolveAudience(
    { type: 'segment', segmentId: 'clients_offre_expiree', params: { joursDepuisDate: 30 } },
    { repo, now }
  );

  assert.deepEqual(emails(r), ['paye@client.test']);
  assert.equal(r.exclus.sansConsentement, 1);
  assert.match(r.destinataires[0].consentement.motif, /transaction/);
});

// ---------------------------------------------------------------------------
// 6. Le module ne fait RIEN d'autre que résoudre
// ---------------------------------------------------------------------------

test('la résolution n’écrit rien et n’envoie rien', async () => {
  const repo = await repoAvec({ notaires: [notaire('parti', { lastSeenAt: ilYA(45) })] });
  const ecritures = [];
  for (const nom of ['putNotary', 'put', 'update', 'markNotificationSent', 'putUnsubscribe', 'appendAudit']) {
    const original = repo[nom];
    repo[nom] = async (...a) => {
      ecritures.push(nom);
      return original.apply(repo, a);
    };
  }

  await segments.resolveAudience({ type: 'segment', segmentId: 'notaires_silencieux' }, { repo, now });
  assert.deepEqual(ecritures, [], 'résoudre une audience ne laisse aucune trace : l’envoi est le travail d’un autre');
});

test('sans dépôt, c’est une erreur de programmation — bruyante', async () => {
  await assert.rejects(() => segments.resolveAudience({ type: 'user', email: 'a@b.ca' }, {}), /repo/);
});
