'use strict';

/**
 * Le lien entre le fournisseur d'identité et NOTRE base (ADR 0045).
 *
 * Keycloak ne capte qu'une chose : le courriel. Tout le reste — le rôle, le
 * profil, l'état de vérification, la date du premier accès — vit ici, dans la
 * table unique. Ce fichier est la charnière, et il est PUR : aucune entrée-
 * sortie, aucune dépendance à Keycloak, aucune dépendance à DynamoDB. Il ne
 * fait que des formes de clés et des décisions. C'est ce qui permet de le
 * tester sans réseau et de remplacer le fournisseur sans le réécrire.
 *
 * LA DÉCISION QUI COMPTE : `courrielVerifieLe` est écrit ICI, jamais copié de
 * Keycloak. Le jeton d'identité porte bien un `email_verified`, et on l'ignore
 * délibérément (voir `verificationDecision`). Deux raisons, et aucune n'est
 * théorique :
 *
 *   1. Loi 25. Nota doit pouvoir répondre « voici quand et comment cette
 *      adresse a été prouvée » dans un droit d'accès. Un booléen posé par un
 *      service tiers, sans horodatage ni méthode dans notre dossier, n'est pas
 *      une réponse que Nota peut produire.
 *   2. Un fournisseur d'identité se remplace. Le jour où Keycloak cède la
 *      place à un SSO d'étude, la vérification ne doit pas partir avec lui.
 *
 * Pourquoi une clé DÉRIVÉE et pas l'adresse en clair : la piste d'audit et les
 * index vivent des années ; un journal ne doit jamais devenir un carnet
 * d'adresses. Même règle que `notaryIdForEmail` et `clientIdForEmail`.
 */

const crypto = require('node:crypto');

// --- Formes de clés ----------------------------------------------------------
//
// Elles vivent ici et NON dans keys.js à dessein : keys.js est un fichier
// partagé, en cours d'édition par d'autres sessions au moment où ceci est
// écrit. Un ajout en fin de fichier partagé est exactement la zone d'append
// concurrent qui fait perdre du travail. Si un jour ces clés doivent rejoindre
// keys.js, ce sera un déplacement délibéré, pas un effet de bord.
//
//   PK = IDENTITY#<sub>        SK = IDENTITY   (le lien, par sujet Keycloak)
//   PK = IDENTITYMAIL#<cid>    SK = IDENTITY   (l'index inverse, par adresse
//                                               DÉRIVÉE — jamais en clair)

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Identifiant dérivé et stable d'une adresse. Même patron que notaryIdForEmail. */
function identityIdForEmail(email) {
  return 'I' + crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 24);
}

function identityPK(sub) {
  return 'IDENTITY#' + String(sub);
}

function identityEmailPK(email) {
  return 'IDENTITYMAIL#' + identityIdForEmail(email);
}

const IDENTITY_SK = 'IDENTITY';

// --- Décisions ---------------------------------------------------------------

/**
 * Ce que Nota accepte de retenir d'un jeton d'identité — et rien de plus.
 *
 * On prend le sujet et l'adresse. On NE prend PAS le nom, le prénom, le
 * téléphone, les rôles ni les groupes : les stocker ferait de Keycloak une
 * source de vérité sur des données qui appartiennent au dossier Nota, et
 * dupliquerait des renseignements personnels dans un second système pour rien.
 *
 * Rend `null` si les claims ne portent pas les deux seules choses exigées.
 */
function claimsToLink(claims) {
  if (!claims || typeof claims !== 'object') return null;
  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  const email = normalizeEmail(claims.email);
  if (!sub) return null;
  if (!email || !email.includes('@')) return null;
  return { sub, email };
}

/**
 * LA frontière. Décide si l'adresse est vérifiée, en ne regardant QUE notre
 * dossier — `record.courrielVerifieLe`.
 *
 * `claims.email_verified`, s'il est présent, est reporté dans `selonLeFournisseur`
 * pour la trace et l'observabilité, mais il n'entre JAMAIS dans `verifie`. Un
 * fournisseur qui se mettrait à répondre `email_verified: true` pour tout le
 * monde ne changerait rien aux droits accordés par Nota.
 */
function verificationDecision(record, claims) {
  const verifieLe = record && typeof record.courrielVerifieLe === 'string' ? record.courrielVerifieLe : null;
  const selonLeFournisseur = !!(claims && claims.email_verified === true);
  return {
    verifie: !!verifieLe,
    verifieLe,
    selonLeFournisseur,
    // Vrai quand le fournisseur affirme une vérification que notre base n'a
    // pas. Ce n'est pas une erreur : c'est exactement le cas que l'ADR 0045
    // veut rendre visible plutôt que de le laisser décider à notre place.
    divergence: selonLeFournisseur && !verifieLe,
  };
}

/**
 * L'enregistrement à écrire au premier lien. `nowISO` est injecté (déterminisme).
 *
 * `courrielVerifieLe` est délibérément ABSENT : un compte fraîchement lié n'est
 * pas un compte dont l'adresse est prouvée. C'est le geste de vérification de
 * Nota — le lien cliqué dans la boîte — qui l'écrira.
 */
function newLinkRecord(link, nowISO) {
  return {
    sub: link.sub,
    email: link.email,
    identityId: identityIdForEmail(link.email),
    creeLe: nowISO,
    dernierAccesLe: nowISO,
  };
}

/** Fusion à chaque connexion : on ne touche qu'au dernier accès et à l'adresse. */
function touchRecord(record, link, nowISO) {
  return { ...record, email: link.email, dernierAccesLe: nowISO };
}

/** Le geste de vérification de Nota. Idempotent : une adresse déjà prouvée garde sa date. */
function markVerified(record, nowISO) {
  if (record && record.courrielVerifieLe) return record;
  return { ...record, courrielVerifieLe: nowISO };
}

module.exports = {
  normalizeEmail,
  identityIdForEmail,
  identityPK,
  identityEmailPK,
  IDENTITY_SK,
  claimsToLink,
  verificationDecision,
  newLinkRecord,
  touchRecord,
  markVerified,
};
