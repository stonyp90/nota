'use strict';

/**
 * L'adaptateur de la cote (ADR 0028).
 *
 * Le domaine sait CALCULER une cote sur 100 à partir de quatre axes ; il ne
 * sait rien de la façon dont Nota range ses notaires. Ce module est le port :
 * il traduit UN enregistrement notaire (le seul document que la table porte
 * pour lui) en l'entrée que `domain.notaryScore` attend, et rien d'autre.
 *
 * Tous les signaux vivent donc sur le profil, et sont tenus à jour là où
 * l'événement se produit — la console qui s'ouvre, la proposition envoyée,
 * la demande déclinée, l'acte réglé. Aucun balayage de registre au moment de
 * facturer : la cote se calcule en mémoire, à partir d'un seul item.
 */

const domain = require('@nota/domain');

const DAY_MS = 24 * 60 * 60 * 1000;

// Combien de jours se sont écoulés depuis un horodatage ISO (ou en ms).
// Une valeur absente ou illisible se lit comme « aujourd'hui » côté ancienneté
// (0 jour) : jamais une ancienneté inventée, jamais une exception.
function joursDepuis(stamp, nowMs) {
  if (stamp == null || stamp === '') return 0;
  const t = typeof stamp === 'number' ? stamp : Date.parse(String(stamp));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** Le profil notaire, tel que le domaine veut le lire. */
function statsFor(notary, nowMs) {
  const n = notary || {};
  const derniereActivite = n.lastSeenAt || n.updatedAt || n.createdAt || null;
  return {
    evaluations: {
      note: domain.ratingAverage(n.ratingSum, n.ratingCount),
      avis: Number(n.ratingCount) || 0,
    },
    actes: {
      total: Number(n.actsCompleted) || 0,
      parService: n.actsByService && typeof n.actsByService === 'object' ? n.actsByService : {},
    },
    disponibilite: {
      // Répondre, c'est proposer un montant OU accepter la demande telle
      // quelle. Décliner, c'est la retirer de son fil — et c'est une RÉPONSE
      // comme une autre : le domaine additionne les deux et ne pénalise jamais
      // un déclin (ADR 0028, « deux sanctions déontologiquement à l'envers »).
      // Le Code impose au notaire de refuser un mandat qu'il ne peut pas
      // porter ; les deux compteurs restent séparés pour l'honnêteté du
      // détail, pas pour arbitrer entre eux.
      repondu: (Number(n.proposalsCount) || 0) + (Number(n.acceptsCount) || 0),
      declinees: Number(n.declinesCount) || 0,
      rayonKm: Number(n.rayonKm) || 0,
      urgences: n.urgences === true,
    },
    presence: {
      fiche: !!n.lienCNQ,
      secteur: !!n.prefixe,
      joursDepuisActivite: joursDepuis(derniereActivite, nowMs),
      joursMembre: joursDepuis(n.createdAt, nowMs),
    },
  };
}

/** La cote d'un notaire MAINTENANT : `{ cote, axes }`. */
function coteFor(notary, nowMs, ponderation) {
  return domain.notaryScore(statsFor(notary, nowMs), ponderation);
}

module.exports = { statsFor, coteFor, joursDepuis };
