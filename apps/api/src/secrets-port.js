'use strict';

/**
 * Port des secrets — résoudre une valeur sensible SANS la faire transiter par
 * une variable Terraform (ADR 0046).
 *
 * POURQUOI CE FICHIER EXISTE. Terraform écrit la valeur de CHAQUE variable
 * dans son fichier d'état, en clair, `sensitive = true` compris : le marqueur
 * ne masque que la sortie de la console, jamais l'état. L'état de ce dépôt est
 * LOCAL (`infra/terraform.tfstate`, à côté du code). Poser une clé d'API dans
 * une variable revient donc à la déposer en clair sur le disque du
 * propriétaire, dans un fichier de 230 ko que personne ne relit — et à la
 * recopier dans `terraform.tfstate.backup` à chaque application.
 *
 * La clé vit donc dans SSM Parameter Store, en `SecureString` :
 *
 *   • Terraform ne connaît que le NOM du paramètre, jamais sa valeur. Il
 *     accorde à la Lambda le droit de le lire, et rien de plus.
 *   • Le propriétaire pose la valeur lui-même, une fois, par la console ou par
 *     `aws ssm put-parameter`. Elle ne traverse ni le dépôt, ni l'état, ni une
 *     conversation.
 *   • Parameter Store en palier standard est GRATUIT (Secrets Manager coûte
 *     0,40 $ par secret et par mois) — sur un compte dont ce projet vise
 *     0 $, la différence n'est pas cosmétique.
 *
 * La surface du port est une méthode :
 *
 *   get(nom) -> string | null
 *
 * Un secret introuvable rend `null` plutôt que de lever : côté assistant, une
 * clé absente DÉGRADE (chaque question part à l'humain), elle ne casse pas.
 */

/**
 * L'adaptateur SSM. Le SDK n'est requis que PARESSEUSEMENT, comme SES, Stripe
 * et DynamoDB, pour que la suite de tests n'ait ni le paquet ni le réseau dans
 * son graphe.
 *
 * Le cache est le point important en Lambda : un conteneur sert des milliers
 * de requêtes, et sans lui CHAQUE message de la messagerie paierait un
 * aller-retour SSM (latence, et une facture d'appels d'API là où il n'en faut
 * qu'un par démarrage à froid). On mémorise donc la valeur ET l'échec : une
 * clé absente ne doit pas non plus être redemandée à chaque question.
 */
function createSsmSecrets({ region, ttlMs } = {}) {
  const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
  const client = new SSMClient({ ...(region ? { region } : {}) });
  const cache = new Map(); // nom -> { valeur, at }
  // Une rotation doit finir par être vue sans redéployer. Un quart d'heure est
  // long devant un démarrage à froid et court devant une rotation.
  const TTL = ttlMs == null ? 15 * 60 * 1000 : ttlMs;

  return {
    async get(name) {
      if (!name) return null;
      const hit = cache.get(name);
      if (hit && Date.now() - hit.at < TTL) return hit.valeur;
      let valeur = null;
      try {
        const out = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
        valeur = (out && out.Parameter && out.Parameter.Value) || null;
      } catch {
        // Paramètre absent, droit manquant, SSM indisponible : dans les trois
        // cas le secret n'est pas là. C'est à l'appelant de dégrader.
        valeur = null;
      }
      cache.set(name, { valeur, at: Date.now() });
      return valeur;
    },
  };
}

/**
 * L'adaptateur de test et de développement : une carte en mémoire. Même
 * surface — l'appelant ne distingue pas les deux.
 */
function createEnvSecrets(map) {
  const table = map || {};
  const asked = [];
  return {
    asked,
    async get(name) {
      asked.push(name);
      return name && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
    },
  };
}

module.exports = { createSsmSecrets, createEnvSecrets };
