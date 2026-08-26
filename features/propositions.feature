# language: fr
Fonctionnalité: Propositions de prix et demandes de documents
  Un notaire peut répondre à une offre ouverte par une proposition de prix
  (un montant supérieur à celui du client) ou par une demande de documents.
  Le client, qui n'a pas de compte, reçoit un courriel et répond avec le jeton
  de son offre. Les règles (proposition supérieure, plafond, documents connus)
  vivent dans le domaine ; l'API est autoritaire. L'horloge est figée au
  2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2500 dans 10 jours

  Scénario: un notaire propose un prix supérieur et le client en est avisé
    Quand le notaire "notaire@exemple.ca" propose 2800 sur l'offre
    Alors la réponse a le statut 200
    Et la proposition est en attente avec un écart de 300
    Et le client "client@exemple.ca" reçoit le courriel "proposition reçue"

  Scénario: une proposition inférieure à l'offre du client est refusée
    Quand le notaire "notaire@exemple.ca" propose 2300 sur l'offre
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "proposition_inferieure"
    Et le client "client@exemple.ca" ne reçoit aucun courriel "proposition reçue"

  Scénario: le client accepte et l'offre est retenue par ce notaire au nouveau montant
    Étant donné le notaire "notaire@exemple.ca" propose 2800 sur l'offre
    Quand le client accepte la proposition
    Alors la réponse a le statut 200
    Et l'offre est retenue par "notaire@exemple.ca" à 2800
    Et le notaire "notaire@exemple.ca" reçoit le courriel "proposition acceptée"
    Et le client "client@exemple.ca" reçoit le courriel "offre retenue"

  Scénario: le notaire demande des documents et le client en reçoit la liste
    Quand le notaire "notaire@exemple.ca" demande les documents "offre_preteur, releve_hypotheque" sur l'offre
    Alors la réponse a le statut 200
    Et la demande porte sur 2 documents non fournis
    Et le client "client@exemple.ca" reçoit le courriel "documents demandés"
    Et le courriel "documents demandés" reçu par "client@exemple.ca" nomme chaque document demandé
