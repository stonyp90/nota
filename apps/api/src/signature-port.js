'use strict';

/**
 * LE PORT DE SIGNATURE — un seul geste, et c'est délibéré (ADR 0047).
 *
 * La cérémonie est de Nota. La signature juridique ne l'est pas, et ne le sera
 * jamais : elle appartient au flux admis par la Chambre des notaires — la
 * signature numérique officielle du notaire, la minute, le greffe numérique.
 * Ce fichier est la frontière entre les deux, et il est étroit exprès.
 *
 * Un port large inviterait à réimplémenter, morceau par morceau, ce qui est
 * précisément ce que Nota ne doit pas faire. Il n'y a donc qu'un geste :
 *
 *     liberer({ salle, scelle }) -> { fournisseur, reference, minute, avis }
 *
 * `minute` est la référence de la minute chez le fournisseur, ou `null` quand
 * il n'y en a pas. `avis` est ce que l'interface DOIT afficher — un adaptateur
 * de démonstration s'y déclare, et l'écran ne peut pas l'omettre sans mentir.
 *
 * Le port ne reçoit ni la vidéo, ni le son, ni le contenu de l'acte. Il reçoit
 * l'identifiant de la séance et son procès-verbal scellé — de quoi rattacher
 * la signature à la cérémonie qui l'a précédée, et rien de plus.
 */

const SIGNATURE_PORT = ['liberer'];

// Les fournisseurs que la configuration peut nommer. `demonstration` est le
// seul écrit ; les autres sont des noms réservés, refusés tant que leur
// adaptateur n'existe pas — un nom accepté sans code derrière serait la
// manière la plus courte de croire qu'un acte réel est signé alors que rien
// ne l'est.
const FOURNISSEURS_CONNUS = ['demonstration', 'consigno'];

function fournisseurConfigure(env = process.env) {
  const nomme = String(env.NOTA_SIGNATURE_FOURNISSEUR || '').trim().toLowerCase();
  return nomme || 'demonstration';
}

/**
 * L'adaptateur de démonstration — le seul actif en bêta.
 *
 * Il ne produit PAS de minute, et il le dit dans sa réponse plutôt que dans un
 * commentaire : `minute: null` et un avis que l'interface affiche. Le refus de
 * signer une salle réelle n'est pas ici mais dans le domaine
 * (`peutAvancer`, code `fournisseur_demonstration`), pour que la règle vaille
 * même si quelqu'un appelle le port directement.
 */
function createDemonstrationSignature({ now = () => Date.now() } = {}) {
  let n = 0;
  return {
    nom: 'demonstration',
    liberer({ salle, scelle }) {
      n += 1;
      const horodatage = new Date(now()).toISOString();
      return Promise.resolve({
        fournisseur: 'demonstration',
        // La référence porte l'empreinte du procès-verbal : même une référence
        // de démonstration désigne UNE séance précise, pas « une séance ».
        reference: 'DEMO-' + String(scelle && scelle.empreinte ? scelle.empreinte : '').slice(0, 12).toUpperCase() + '-' + n,
        minute: null,
        signeeLe: horodatage,
        salleId: (salle && salle.id) || null,
        avis: 'Signature de démonstration. Aucun acte notarié n’a été reçu et aucune minute n’a été créée.',
      });
    },
  };
}

/**
 * L'adaptateur du fournisseur admis par la Chambre — NON implémenté.
 *
 * Il est ici en creux, et c'est la forme honnête : le brancher demande une
 * entente avec le fournisseur et l'avis de la Chambre, deux choses que le code
 * ne peut pas se donner à lui-même. Tant qu'il n'existe pas, le nommer dans
 * la configuration doit FAIRE ÉCHOUER le démarrage plutôt que retomber en
 * silence sur la démonstration : une bascule silencieuse vers un adaptateur
 * sans valeur juridique est exactement l'accident que cette ADR doit rendre
 * impossible.
 */
function createSignaturePort(env = process.env, deps = {}) {
  const nomme = fournisseurConfigure(env);
  if (nomme === 'demonstration') return createDemonstrationSignature(deps);
  if (!FOURNISSEURS_CONNUS.includes(nomme)) {
    throw new Error('NOTA_SIGNATURE_FOURNISSEUR inconnu : ' + nomme);
  }
  throw new Error(
    'NOTA_SIGNATURE_FOURNISSEUR = ' + nomme + ' : cet adaptateur n’est pas implémenté. ' +
    'Voir docs/decisions/0047-la-salle-de-signature-est-une-ceremonie-prouvee.md §6.'
  );
}

module.exports = {
  SIGNATURE_PORT,
  FOURNISSEURS_CONNUS,
  fournisseurConfigure,
  createDemonstrationSignature,
  createSignaturePort,
};
