'use strict';

/**
 * SEGMENTS — à qui Nota a le droit d'écrire, et pourquoi celui-là.
 *
 * Un opérateur doit pouvoir viser trois choses : une personne nommée, un
 * groupe de personnes, ou un segment CALCULÉ (« les notaires qui n'ont rien
 * retenu depuis trente jours » — la lutte contre l'attrition). Ce module fait
 * cela et rien d'autre : il RÉSOUT une audience et rend une liste de
 * destinataires. Il n'ouvre aucune socket, ne compose aucun gabarit, n'écrit
 * aucune ligne. L'envoi appartient à `notifications.js`.
 *
 * Le partage n'est pas cosmétique. Une résolution d'audience est une décision
 * juridique avant d'être une décision produit, et deux textes la commandent :
 *
 * **LCAP — Loi canadienne anti-pourriel (L.C. 2010, ch. 23), art. 6 et 10.**
 * Un message électronique COMMERCIAL exige trois choses : une base de
 * consentement (exprès ou tacite), l'identification de l'expéditeur, et un
 * mécanisme d'exclusion qui fonctionne. Les deux dernières sont déjà tenues
 * ailleurs — `emails.js` pose l'identité de l'expéditeur sur chaque gabarit,
 * `notifications.js` signe et honore le lien de retrait. La PREMIÈRE n'était
 * tenue nulle part, parce que rien ne distinguait un message transactionnel
 * d'un message commercial : confirmer une offre que le client vient de
 * déposer n'est pas une réclame ; le rappeler à un notaire parti depuis
 * quarante jours en est une. Chaque segment porte donc sa `nature`, et c'est
 * elle qui décide si une base de consentement est exigée.
 *
 * **Art. 56 1° du Code de déontologie des notaires** — est dérogatoire à la
 * dignité de la profession le fait « d'inciter quelqu'un de façon pressante ou
 * répétée à recourir à ses services professionnels » (texte officiel :
 * docs/legal/code-deontologie-notaires-texte-officiel.md). L'article vise le
 * notaire, pas Nota. Mais Nota écrit AUX notaires et écrit AUX clients en
 * s'appuyant sur eux : une plateforme qui relancerait un client trois fois la
 * même semaine ferait faire au notaire, par personne interposée, exactement
 * ce que l'article lui défend. Le plafond de fréquence de ce module est la
 * réponse produit à cet article — pas une politesse, une borne.
 *
 * Les garde-fous vivent ICI, dans la résolution, et non dans la console : une
 * garde qu'on contourne en appelant l'API directement n'est pas une garde.
 */

const domain = require('@nota/domain');

// --- Vocabulaire -----------------------------------------------------------

/** À qui un segment s'adresse — la source qu'il faut lire pour le calculer. */
const AUDIENCE = { NOTAIRE: 'notaire', CLIENT: 'client' };

/**
 * Ce qu'un message PRODUIT, au sens de la LCAP. Le mot n'est pas décoratif :
 * `COMMERCIAL` déclenche l'exigence de consentement et le plafond de
 * fréquence, `TRANSACTIONNEL` ne déclenche ni l'un ni l'autre. Se tromper de
 * drapeau, c'est soit envoyer un message illégal, soit retenir un avis de
 * service que le destinataire avait besoin de lire.
 */
const NATURE = { TRANSACTIONNEL: 'transactionnel', COMMERCIAL: 'commercial' };

/** Les bornes par défaut. Toutes surchargeables par appel — aucune n'est une loi. */
const GARDES = {
  // Au-delà, la résolution exige une confirmation explicite. Nota compte ses
  // notaires par dizaines : une audience de plusieurs centaines est presque
  // toujours un prédicat mal écrit, pas une intention.
  plafondAudience: 200,
  // Un mois entre deux messages commerciaux vers la même adresse. C'est le
  // chiffre qui répond à « pressante ou répétée » (art. 56 1°).
  fenetreHeures: 720,
  // Ce qu'un essai à blanc montre — assez pour reconnaître, trop peu pour
  // constituer une liste d'envoi.
  echantillon: 5,
};

/**
 * Les fenêtres du consentement TACITE, art. 10(10) LCAP : la relation
 * d'affaires en cours naît d'une transaction ou d'un contrat dans les deux
 * ans, ou d'une demande dans les six mois. Exprimées en mois parce que la loi
 * les exprime en mois.
 */
const CONSENTEMENT = { moisTransaction: 24, moisDemande: 6 };

// --- Petites lectures ------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v) => Number(v) || 0;

function msDe(stamp) {
  if (stamp == null || stamp === '') return null;
  const t = typeof stamp === 'number' ? stamp : Date.parse(String(stamp));
  return Number.isFinite(t) ? t : null;
}

/**
 * Combien de jours depuis `stamp`, ou `null` si l'on ne peut pas le mesurer.
 *
 * `cote.joursDepuis` lit délibérément une date absente comme « aujourd'hui »,
 * parce qu'une cote ne doit jamais inventer une ancienneté. Ici, la même
 * lecture serait un contresens : elle cacherait précisément les dormants qu'on
 * cherche. Un silence qu'on ne peut pas dater n'est pas un silence prouvé — et
 * on n'écrit à personne sur un motif non mesurable.
 */
function joursDepuis(stamp, nowMs) {
  const t = msDe(stamp);
  if (t === null) return null;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** L'instant limite d'une fenêtre exprimée en mois civils. */
function limiteMois(nowMs, mois) {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - mois);
  return d.getTime();
}

/** La dernière trace datée d'un notaire : sa visite, sinon son dossier. */
const derniereTrace = (n) => n.lastSeenAt || n.updatedAt || n.createdAt || null;

/**
 * Une offre qu'un être humain peut encore voir. Même règle que
 * `reminders.js` : ni retenue, ni annulée, et dont l'autorisation de carte a
 * abouti. Écrire au sujet d'une offre que personne ne voit, c'est parler d'un
 * marché qui n'existe pas.
 */
function offreVivante(b) {
  if (!b || b.status === domain.STATUS.RETENUE || b.status === domain.STATUS.ANNULEE) return false;
  return b.paymentStatus !== 'pending' && b.paymentStatus !== 'void';
}

/** Une offre a-t-elle été PAYÉE — une transaction, au sens de LCAP 10(10)a) ? */
const offrePayee = (b) => b.paymentStatus === 'authorized' || !!b.paymentIntentId;

const normEmail = (e) => String(e == null ? '' : e).trim().toLowerCase();

/** Reconnaissable, pas expédiable : `a•••@etude-roy.ca`. */
function masque(email) {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return email.slice(0, 1) + '•••' + email.slice(at);
}

// --- Le catalogue ----------------------------------------------------------
//
// La spécification EST cette liste. Ajouter un segment doit coûter une entrée,
// jamais une branche : le résolveur ci-dessous ne connaît aucun `id` en dur, il
// ne sait que lire `source`, `nature`, `params` et appeler `match`.
//
// `match(sujet, params, ctx)` rend `null` (hors cible) ou `{ raison }`. La
// raison est obligatoire et porte la MESURE, pas l'étiquette : « silencieux
// depuis 47 j » se vérifie, « dormant » ne se vérifie pas. Sans elle, une
// campagne est un tir dans le noir et personne ne peut auditer un envoi.

const SEGMENTS = [
  {
    id: 'notaires_jamais_actifs',
    source: 'notaires',
    audience: AUDIENCE.NOTAIRE,
    // Une invitation à commencer à se servir de la plateforme : une réclame.
    nature: NATURE.COMMERCIAL,
    libelle: { fr: 'Notaires inscrits, jamais actifs', en: 'Registered notaries, never active' },
    vise:
      "Le notaire dont le compte existe mais qui n'a jamais rien fait : aucun acte réglé, aucune proposition, aucune acceptation, aucun déclin. Décliner compte comme une réponse — le Code impose au notaire de refuser un mandat qu'il ne peut pas porter, et le lui reprocher serait à l'envers.",
    params: {
      joursApresInscription: {
        defaut: 7, min: 0, max: 365,
        libelle: { fr: 'Délai de grâce après l’inscription (jours)', en: 'Grace period after signup (days)' },
      },
    },
    match(n, p, ctx) {
      const anciennete = ctx.joursDepuis(n.createdAt);
      if (anciennete === null || anciennete < p.joursApresInscription) return null;
      const reponses = num(n.proposalsCount) + num(n.acceptsCount) + num(n.declinesCount);
      if (num(n.actsCompleted) > 0 || reponses > 0) return null;
      return { raison: `inscrit depuis ${anciennete} j, aucun acte ni réponse` };
    },
  },

  {
    id: 'notaires_silencieux',
    source: 'notaires',
    audience: AUDIENCE.NOTAIRE,
    nature: NATURE.COMMERCIAL,
    libelle: { fr: 'Notaires silencieux', en: 'Silent notaries' },
    vise:
      "Le notaire qui n'a pas ouvert sa console depuis N jours. C'est le segment de l'attrition : la console est le seul geste que la plateforme observe vraiment, et son absence prolongée précède le départ.",
    params: {
      joursSilence: {
        defaut: 30, min: 7, max: 365,
        libelle: { fr: 'Jours sans visite de la console', en: 'Days without a console visit' },
      },
    },
    match(n, p, ctx) {
      const j = ctx.joursDepuis(derniereTrace(n));
      if (j === null || j < p.joursSilence) return null;
      return { raison: `aucune visite de la console depuis ${j} j` };
    },
  },

  {
    id: 'notaires_sans_paiement',
    source: 'notaires',
    audience: AUDIENCE.NOTAIRE,
    // TRANSACTIONNEL, et la distinction se défend : le message ne vante rien,
    // il informe le destinataire de l'état de SON compte dans une relation
    // déjà nouée — un notaire qui accepterait un acte demain ne pourrait pas
    // être payé. Retenir cet avis derrière un plafond de fréquence lui
    // nuirait ; c'est exactement ce que la LCAP écarte de la notion de MEC.
    nature: NATURE.TRANSACTIONNEL,
    libelle: { fr: 'Notaires sans compte de paiement', en: 'Notaries without a payout account' },
    vise:
      "Le notaire dont le compte Connect n'accepte pas les paiements — inscription inachevée, compte restreint, ou aucun compte du tout. Il ne peut pas être payé, donc il ne devrait rien accepter.",
    params: {
      joursApresInscription: {
        defaut: 2, min: 0, max: 365,
        libelle: { fr: 'Délai de grâce après l’inscription (jours)', en: 'Grace period after signup (days)' },
      },
    },
    match(n, p, ctx) {
      const anciennete = ctx.joursDepuis(n.createdAt);
      if (anciennete === null || anciennete < p.joursApresInscription) return null;
      if (n.chargesEnabled === true && n.connectAccountId) return null;
      return { raison: `compte de paiement non connecté (statut ${n.status || 'inconnu'})` };
    },
  },

  {
    id: 'notaires_sans_cnq',
    source: 'notaires',
    audience: AUDIENCE.NOTAIRE,
    // COMMERCIAL, et la frontière avec le segment précédent tient à ceci : la
    // fiche CNQ n'est nécessaire à aucune obligation déjà contractée, elle
    // rend le notaire plus visible sur le marché de Nota. C'est un argument de
    // vente, pas un avis de compte.
    nature: NATURE.COMMERCIAL,
    libelle: { fr: 'Notaires sans fiche CNQ', en: 'Notaries without a CNQ listing' },
    vise:
      "Le notaire qui n'a déclaré aucun lien vers sa fiche à la Chambre des notaires. Depuis l'ADR 0030, la fiche est le seul fait vérifiable que la carte publique peut porter à son sujet : sans elle, il n'a rien à montrer au client.",
    params: {
      joursApresInscription: {
        defaut: 7, min: 0, max: 365,
        libelle: { fr: 'Délai de grâce après l’inscription (jours)', en: 'Grace period after signup (days)' },
      },
    },
    match(n, p, ctx) {
      const anciennete = ctx.joursDepuis(n.createdAt);
      if (anciennete === null || anciennete < p.joursApresInscription) return null;
      if (n.lienCNQ) return null;
      return { raison: `aucune fiche CNQ déclarée (inscrit depuis ${anciennete} j)` };
    },
  },

  {
    id: 'clients_offre_proche',
    source: 'offres',
    audience: AUDIENCE.CLIENT,
    // Il s'agit de SA propre offre, déjà déposée et autorisée : le message
    // accompagne une transaction en cours, il n'en sollicite pas une nouvelle.
    nature: NATURE.TRANSACTIONNEL,
    libelle: { fr: 'Offres ouvertes, date proche', en: 'Open offers, date approaching' },
    vise:
      "Le client dont l'offre est encore ouverte alors que la date de signature approche. Aucun notaire ne l'a prise : relever le montant ou déplacer la date est encore possible, mais plus pour longtemps.",
    params: {
      joursAvant: {
        defaut: 3, min: 1, max: 60,
        libelle: { fr: 'Jours avant la date de signature', en: 'Days before the signing date' },
      },
    },
    match(b, p, ctx) {
      if (!offreVivante(b)) return null;
      const j = domain.daysBetween(ctx.jour, b.dateISO);
      if (!Number.isFinite(j) || j < 0 || j > p.joursAvant) return null;
      return { raison: j === 0 ? 'offre ouverte, signature aujourd’hui' : `offre ouverte, signature dans ${j} j` };
    },
  },

  {
    id: 'clients_offre_expiree',
    source: 'offres',
    audience: AUDIENCE.CLIENT,
    // Réactiver quelqu'un dont l'affaire est close, c'est solliciter.
    nature: NATURE.COMMERCIAL,
    libelle: { fr: 'Offres expirées sans preneur', en: 'Expired offers, no taker' },
    vise:
      "Le client dont la date est passée sans qu'aucun notaire ne retienne l'offre. Son besoin n'a pas disparu avec la date ; la borne haute existe pour qu'on ne réveille pas un dossier d'il y a deux ans.",
    params: {
      joursDepuisDate: {
        defaut: 30, min: 1, max: 365,
        libelle: { fr: 'Jours écoulés depuis la date manquée', en: 'Days since the missed date' },
      },
    },
    match(b, p, ctx) {
      if (!offreVivante(b)) return null;
      const j = domain.daysBetween(ctx.jour, b.dateISO);
      if (!Number.isFinite(j) || j >= 0) return null;
      const passe = -j;
      if (passe > p.joursDepuisDate) return null;
      return { raison: `offre expirée sans preneur depuis ${passe} j` };
    },
  },
];

const SEGMENTS_BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));
const segmentById = (id) => SEGMENTS_BY_ID.get(String(id)) || null;

/**
 * Le catalogue tel qu'une console peut le recevoir : sérialisable, et sans le
 * prédicat. Un `match` sur le fil serait une fonction que personne ne peut
 * exécuter à l'autre bout, et une invitation à en évaluer une qui viendrait
 * d'ailleurs.
 */
function describeSegments() {
  return SEGMENTS.map((s) => ({
    id: s.id,
    libelle: { fr: s.libelle.fr, en: s.libelle.en },
    vise: s.vise,
    audience: s.audience,
    nature: s.nature,
    params: Object.fromEntries(
      Object.entries(s.params || {}).map(([nom, p]) => [
        nom,
        { defaut: p.defaut, min: p.min, max: p.max, libelle: { fr: p.libelle.fr, en: p.libelle.en } },
      ])
    ),
  }));
}

// --- Paramètres ------------------------------------------------------------

/**
 * Les seuils déclarés du segment, fusionnés avec ceux de l'opérateur. Bruyant
 * et typé, comme les validateurs du domaine : un seuil hors bornes est refusé,
 * jamais rabattu en silence sur le défaut. Une campagne partie sur un seuil
 * qu'on croyait avoir changé est pire qu'une campagne refusée.
 */
function resolveParams(segment, fournis) {
  const errors = [];
  const values = {};
  const declares = segment.params || {};

  for (const nom of Object.keys(fournis || {})) {
    if (!Object.prototype.hasOwnProperty.call(declares, nom)) {
      errors.push({
        code: 'parametre_inconnu', segmentId: segment.id, param: nom,
        message: `Le segment « ${segment.id} » ne déclare pas de paramètre « ${nom} ».`,
      });
    }
  }

  for (const [nom, decl] of Object.entries(declares)) {
    const brut = fournis && Object.prototype.hasOwnProperty.call(fournis, nom) ? fournis[nom] : undefined;
    if (brut === undefined || brut === null || brut === '') {
      values[nom] = decl.defaut;
      continue;
    }
    const v = Number(brut);
    if (!Number.isInteger(v) || v < decl.min || v > decl.max) {
      errors.push({
        code: 'parametre_invalide', segmentId: segment.id, param: nom,
        message: `« ${nom} » doit être un entier entre ${decl.min} et ${decl.max}.`,
      });
      continue;
    }
    values[nom] = v;
  }

  return { errors, values };
}

// --- Le consentement, art. 10 LCAP -----------------------------------------

/**
 * La base de consentement d'UN destinataire, à partir du sujet qui l'a fait
 * entrer dans l'audience.
 *
 * Le dépôt ne stocke aujourd'hui AUCUN consentement au courriel commercial —
 * le seul `consent` qu'il connaisse est celui du dossier, c'est-à-dire
 * l'accord du client pour que le notaire retenu lise ses documents. Rien à
 * voir. Tant qu'un registre n'existe pas (`repo.getEmailConsent`), la seule
 * base honnête est le consentement TACITE que la relation d'affaires en cours
 * établit d'elle-même (art. 10(9)a) et 10(10) LCAP), et il faut la DÉDUIRE de
 * faits que le dépôt porte déjà :
 *
 *   - un compte Connect actif est un contrat en cours — pas besoin de dater
 *     quoi que ce soit, il l'est maintenant ;
 *   - une inscription récente est une « demande », fenêtre de six mois ;
 *   - une offre payée est une transaction, fenêtre de deux ans ;
 *   - une offre jamais autorisée n'est qu'une demande : six mois.
 *
 * Ce qui n'entre dans aucun de ces cas ne reçoit pas de message commercial.
 * L'inférence est volontairement étroite : on préfère taire un envoi
 * défendable que d'en justifier un après coup.
 */
function baseDeduite(sujet, audience, nowMs) {
  if (!sujet) return null;

  if (audience === AUDIENCE.NOTAIRE) {
    if (sujet.status === 'active' && sujet.connectAccountId) {
      return { base: 'tacite', motif: 'contrat_en_cours' };
    }
    const inscrit = msDe(sujet.createdAt);
    if (inscrit !== null && inscrit >= limiteMois(nowMs, CONSENTEMENT.moisDemande)) {
      return { base: 'tacite', motif: 'candidature_recente' };
    }
    return null;
  }

  const cree = msDe(sujet.createdAt);
  if (cree === null) return null;
  const mois = offrePayee(sujet) ? CONSENTEMENT.moisTransaction : CONSENTEMENT.moisDemande;
  if (cree < limiteMois(nowMs, mois)) return null;
  return { base: 'tacite', motif: offrePayee(sujet) ? 'transaction_recente' : 'demande_recente' };
}

// --- La résolution ---------------------------------------------------------

/**
 * `resolveAudience(spec, deps)` — les trois formes, et les gardes.
 *
 * `spec` est l'une de :
 *   { type: 'user',    email, nature? }
 *   { type: 'group',   groupId }
 *   { type: 'segment', segmentId, params? }
 * …ou un TABLEAU de celles-là, dont l'union est déduplicquée. C'est la forme
 * qui compte : viser « le groupe pilote ET les silencieux » est la demande
 * normale, et sans union la déduplication ne serait jamais éprouvée.
 *
 * `deps` : { repo, now, plafond, confirme, fenetreHeures, dryRun }.
 * `now` rend un INSTANT ISO (pas une journée) : le plafond de fréquence se
 * compte en heures, tandis que les dates d'offres se comparent au jour
 * OUVRABLE québécois — jamais à la date UTC de la machine.
 *
 * Rend :
 *   {
 *     ok, errors[], avertissements[], nature,
 *     destinataires: [{ email, audience, raison, origine, consentement }],
 *     total,
 *     exclus: { sansCourriel, doublons, desabonnes, sansConsentement, frequence },
 *     plafond: { limite, depasse, confirme },
 *     garde: { frequence, consentement },
 *     dryRun, echantillon[]
 *   }
 *
 * `total` est TOUJOURS le nombre réel de destinataires retenus, même quand la
 * liste est retenue (essai à blanc, plafond non confirmé) : on refuse en
 * disant combien, jamais en cachant combien.
 */
async function resolveAudience(spec, deps = {}) {
  const repo = deps.repo;
  if (!repo) throw new Error('resolveAudience: repo is required');

  const horloge = deps.now || (() => new Date().toISOString());
  const brut = String(horloge());
  // Une horloge qui rend déjà une journée (`YYYY-MM-DD`) est acceptée telle
  // quelle : la lire comme un instant la placerait à minuit UTC, donc la
  // VEILLE à Québec, et décalerait toutes les fenêtres d'un jour.
  const estJour = /^\d{4}-\d{2}-\d{2}$/.test(brut);
  const jour = estJour ? brut : domain.businessDay(brut, process.env.NOTA_TIMEZONE);
  const nowMs = Number.isFinite(Date.parse(brut)) ? Date.parse(brut) : Date.now();

  // Une borne illisible (null, '', NaN) reprend le défaut. `Number(null)` vaut
  // zéro : la lire telle quelle ferait d'un plafond absent un plafond de zéro,
  // c'est-à-dire d'une garde une panne.
  const borne = (v, defaut) => {
    const n = Number(v);
    return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? n : defaut;
  };
  const plafondLimite = borne(deps.plafond, GARDES.plafondAudience);
  const fenetreHeures = borne(deps.fenetreHeures, GARDES.fenetreHeures);
  const dryRun = deps.dryRun === true;
  const confirme = deps.confirme === true;

  const errors = [];
  const avertissements = [];
  const exclus = { sansCourriel: 0, doublons: 0, desabonnes: 0, sansConsentement: 0, frequence: 0 };
  const ctx = { jour, nowMs, joursDepuis: (s) => joursDepuis(s, nowMs) };

  // Les deux registres, lus au plus une fois et seulement si quelqu'un les
  // demande. `listNotaries` (et non `listActiveNotaries`) : un notaire en
  // inscription est justement la cible de la moitié du catalogue.
  let _notaires = null;
  async function notaires() {
    if (_notaires) return _notaires;
    if (typeof repo.listNotaries === 'function') _notaires = await repo.listNotaries();
    else if (typeof repo.listActiveNotaries === 'function') _notaires = await repo.listActiveNotaries();
    else _notaires = [];
    return _notaires;
  }
  let _offres = null;
  async function offres() {
    if (_offres) return _offres;
    // `listOpenBids` est la bonne porte : l'index n'y range que les offres
    // ouvertes, quelle que soit leur date — une offre expirée sans preneur y
    // est donc encore, ce qu'un `listByMonth(mois)` n'aurait dit que mois par
    // mois. Le coût suit le nombre d'offres ouvertes, pas la table.
    _offres = typeof repo.listOpenBids === 'function' ? await repo.listOpenBids() : [];
    return _offres;
  }

  // Retrouver le SUJET derrière une adresse citée nommément (ou listée dans un
  // groupe) : sans lui, aucune base de consentement ne peut être établie.
  let _indexNotaires = null;
  async function sujetNotaire(email) {
    if (!_indexNotaires) {
      _indexNotaires = new Map();
      for (const n of await notaires()) if (n && n.email) _indexNotaires.set(normEmail(n.email), n);
    }
    return _indexNotaires.get(email) || null;
  }
  let _indexClients = null;
  async function sujetClient(email) {
    if (!_indexClients) {
      _indexClients = new Map();
      for (const b of await offres()) if (b && b.courriel) _indexClients.set(normEmail(b.courriel), b);
    }
    return _indexClients.get(email) || null;
  }

  // --- 1. Les candidats, spec par spec, dans l'ordre donné -------------------
  const candidats = [];
  const specs = Array.isArray(spec) ? spec : [spec];
  let commercial = false;

  for (const s of specs) {
    if (!s || typeof s !== 'object' || !s.type) {
      errors.push({ code: 'spec_invalide', message: 'Une cible doit porter un « type ».' });
      continue;
    }

    if (s.type === 'user') {
      const email = normEmail(s.email);
      if (!domain.isEmail(email)) {
        errors.push({ code: 'courriel_invalide', message: 'Le courriel n’est pas valide.' });
        continue;
      }
      // Par défaut COMMERCIAL : le doute joue contre l'envoi, et un opérateur
      // qui sait que son message est transactionnel peut toujours le dire.
      const nature = s.nature === NATURE.TRANSACTIONNEL ? NATURE.TRANSACTIONNEL : NATURE.COMMERCIAL;
      if (nature === NATURE.COMMERCIAL) commercial = true;
      const sujet = await sujetNotaire(email);
      candidats.push({
        email,
        audience: sujet ? AUDIENCE.NOTAIRE : AUDIENCE.CLIENT,
        raison: 'ciblé nommément par l’opérateur',
        origine: { type: 'user', id: email },
        nature,
        sujet,
      });
      continue;
    }

    if (s.type === 'group') {
      const groupe =
        typeof repo.getAudienceGroup === 'function' ? await repo.getAudienceGroup(String(s.groupId)) : null;
      if (!groupe || !Array.isArray(groupe.membres)) {
        // Un groupe introuvable est une erreur, jamais une audience vide : un
        // opérateur qui a tapé le mauvais identifiant doit l'apprendre ici.
        errors.push({
          code: 'groupe_inconnu', groupId: s.groupId,
          message: `Aucun groupe « ${s.groupId} ».`,
        });
        continue;
      }
      const audience = groupe.audience === AUDIENCE.CLIENT ? AUDIENCE.CLIENT : AUDIENCE.NOTAIRE;
      const nature = groupe.nature === NATURE.TRANSACTIONNEL ? NATURE.TRANSACTIONNEL : NATURE.COMMERCIAL;
      if (nature === NATURE.COMMERCIAL) commercial = true;
      for (const membre of groupe.membres) {
        const email = normEmail(membre);
        if (!domain.isEmail(email)) {
          exclus.sansCourriel += 1;
          continue;
        }
        candidats.push({
          email,
          audience,
          raison: `membre du groupe « ${groupe.id || s.groupId} »`,
          origine: { type: 'group', id: String(groupe.id || s.groupId) },
          nature,
          sujet: audience === AUDIENCE.NOTAIRE ? await sujetNotaire(email) : await sujetClient(email),
        });
      }
      continue;
    }

    if (s.type === 'segment') {
      const segment = segmentById(s.segmentId);
      if (!segment) {
        errors.push({
          code: 'segment_inconnu', segmentId: s.segmentId,
          message: `Aucun segment « ${s.segmentId} ».`,
        });
        continue;
      }
      const p = resolveParams(segment, s.params);
      if (p.errors.length) {
        errors.push(...p.errors);
        continue;
      }
      if (segment.nature === NATURE.COMMERCIAL) commercial = true;

      const sujets = segment.source === 'offres' ? await offres() : await notaires();
      const champ = segment.audience === AUDIENCE.CLIENT ? 'courriel' : 'email';
      for (const sujet of sujets) {
        if (!sujet) continue;
        const hit = segment.match(sujet, p.values, ctx);
        if (!hit) continue;
        const email = normEmail(sujet[champ]);
        if (!domain.isEmail(email)) {
          // Un sujet dans la cible mais injoignable : compté, jamais deviné.
          exclus.sansCourriel += 1;
          continue;
        }
        candidats.push({
          email,
          audience: segment.audience,
          raison: hit.raison,
          origine: { type: 'segment', id: segment.id },
          nature: segment.nature,
          sujet,
        });
      }
      continue;
    }

    errors.push({ code: 'type_inconnu', type: s.type, message: `Type de cible inconnu : « ${s.type} ».` });
  }

  // La nature de la campagne est la plus stricte de ses parties : mêler une
  // relance à un avis de service ne blanchit pas la relance.
  const nature = commercial ? NATURE.COMMERCIAL : NATURE.TRANSACTIONNEL;

  const vide = {
    ok: false,
    errors,
    avertissements,
    nature,
    destinataires: [],
    total: 0,
    exclus,
    plafond: { limite: plafondLimite, depasse: false, confirme },
    garde: { frequence: 'sans_objet', consentement: 'sans_objet' },
    dryRun,
    echantillon: [],
  };
  if (errors.length) return vide;

  // --- 2. Déduplication ------------------------------------------------------
  // Stricte, par adresse normalisée. La PREMIÈRE raison rencontrée est celle
  // qu'on garde : l'ordre des cibles est l'intention de l'opérateur.
  const parEmail = new Map();
  for (const c of candidats) {
    if (parEmail.has(c.email)) {
      exclus.doublons += 1;
      // Une adresse vue une seconde fois sous une nature commerciale tire la
      // campagne vers la règle stricte, même si la première ne l'était pas.
      if (c.nature === NATURE.COMMERCIAL) parEmail.get(c.email).nature = NATURE.COMMERCIAL;
      continue;
    }
    parEmail.set(c.email, { ...c });
  }

  // --- 3. Le désabonnement l'emporte ----------------------------------------
  // Toujours, et pour toutes les natures. La LCAP n'exigerait la suppression
  // que du commercial ; `sendOnce` supprime déjà tout, et ce module s'aligne :
  // une adresse retirée est retirée, et l'opérateur voit ce qu'il n'a pas
  // atteint plutôt que de croire son audience plus large qu'elle n'est.
  let retenus = [];
  for (const c of parEmail.values()) {
    if (typeof repo.isUnsubscribed === 'function' && (await repo.isUnsubscribed(c.email))) {
      exclus.desabonnes += 1;
      continue;
    }
    retenus.push(c);
  }

  // --- 4. La base de consentement (commercial seulement) --------------------
  const registre = typeof repo.getEmailConsent === 'function';
  let gardeConsentement = 'sans_objet';
  if (nature === NATURE.COMMERCIAL) {
    gardeConsentement = registre ? 'registre' : 'deduit';
    const avecBase = [];
    for (const c of retenus) {
      if (c.nature === NATURE.TRANSACTIONNEL) {
        avecBase.push({ ...c, consentement: null });
        continue;
      }
      let base = null;
      if (registre) {
        try {
          const stocke = await repo.getEmailConsent(c.email);
          if (stocke && stocke.base) base = { base: stocke.base, motif: stocke.source || 'registre', at: stocke.at || null };
        } catch { /* un registre en panne ne vaut pas une base : on redescend sur la déduction */ }
      }
      if (!base) base = baseDeduite(c.sujet, c.audience, nowMs);
      if (!base) {
        exclus.sansConsentement += 1;
        continue;
      }
      avecBase.push({ ...c, consentement: base });
    }
    retenus = avecBase;
  } else {
    retenus = retenus.map((c) => ({ ...c, consentement: null }));
  }

  // --- 5. Le plafond de fréquence (art. 56 1°) ------------------------------
  // Ne s'applique QU'AU commercial : retenir un avis de service parce qu'une
  // campagne est passée hier nuirait au destinataire, et l'article vise la
  // sollicitation, pas le service. Côté envoi, la répétition d'un
  // transactionnel reste bornée par le registre `(refId, kind)` de `sendOnce`.
  let gardeFrequence = 'sans_objet';
  if (nature === NATURE.COMMERCIAL && retenus.length) {
    const adresses = retenus.map((c) => c.email);
    let derniers = null;
    if (typeof repo.lastCampaignAtMany === 'function') {
      const out = await repo.lastCampaignAtMany(adresses);
      derniers = out instanceof Map ? out : new Map(Object.entries(out || {}));
    } else if (typeof repo.lastCampaignAt === 'function') {
      derniers = new Map();
      for (const a of adresses) derniers.set(a, await repo.lastCampaignAt(a));
    }

    if (!derniers) {
      // Une garde qui ne peut pas s'exercer le DIT. Elle ne fait pas semblant
      // d'avoir vérifié, et elle ne bloque pas non plus une campagne que
      // l'opérateur n'a aucun moyen de débloquer : elle rend la lacune
      // lisible, dans la réponse, à l'endroit où elle sera relue.
      gardeFrequence = 'non_verifiee';
      avertissements.push({
        code: 'frequence_non_verifiee',
        message:
          'Aucun registre de campagnes (repo.lastCampaignAt / lastCampaignAtMany) : le plafond de fréquence n’a pas pu être appliqué.',
      });
    } else {
      gardeFrequence = 'appliquee';
      const seuil = nowMs - fenetreHeures * 60 * 60 * 1000;
      const sous = [];
      for (const c of retenus) {
        // Dans une cible mixte, l'exemption se juge destinataire par
        // destinataire : l'avis de compte d'un notaire ne devient pas une
        // sollicitation parce qu'une relance voyage dans la même résolution.
        if (c.nature === NATURE.TRANSACTIONNEL) {
          sous.push(c);
          continue;
        }
        const t = msDe(derniers.get(c.email));
        if (t !== null && t >= seuil) {
          exclus.frequence += 1;
          continue;
        }
        sous.push(c);
      }
      retenus = sous;
    }
  }

  // --- 6. Le plafond de taille ----------------------------------------------
  const total = retenus.length;
  const depasse = total > plafondLimite;

  const echantillon = retenus.slice(0, GARDES.echantillon).map((c) => ({
    email: masque(c.email),
    audience: c.audience,
    raison: c.raison,
  }));

  const base = {
    errors,
    avertissements,
    nature,
    total,
    exclus,
    plafond: { limite: plafondLimite, depasse, confirme },
    garde: { frequence: gardeFrequence, consentement: gardeConsentement },
    dryRun,
    echantillon,
  };

  // Un essai à blanc rend le décompte et l'échantillon, jamais la liste — et il
  // passe AVANT le plafond, puisque c'est justement ainsi qu'on découvre qu'on
  // le dépasse.
  if (dryRun) return { ...base, ok: true, destinataires: [] };

  if (depasse && !confirme) {
    return {
      ...base,
      ok: false,
      errors: [
        ...errors,
        {
          code: 'confirmation_requise',
          total,
          limite: plafondLimite,
          message: `Cette audience compte ${total} destinataires (plafond : ${plafondLimite}). Confirmez explicitement pour la résoudre.`,
        },
      ],
      destinataires: [],
    };
  }

  // Le sujet reste dans le module : il a servi à établir la base de
  // consentement, il n'a rien à faire dans une liste d'envoi.
  return {
    ...base,
    ok: true,
    destinataires: retenus.map((c) => ({
      email: c.email,
      audience: c.audience,
      raison: c.raison,
      origine: c.origine,
      consentement: c.consentement,
    })),
  };
}

module.exports = {
  AUDIENCE,
  NATURE,
  GARDES,
  CONSENTEMENT,
  SEGMENTS,
  segmentById,
  describeSegments,
  resolveAudience,
};
