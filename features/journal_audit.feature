# language: fr
Fonctionnalité: Le journal d'audit nomme son acteur, se conserve sept ans, et crie quand il casse
  ADR 0036. Un journal d'audit qui existe mais ne répond à aucune question
  qu'un litige lui poserait ne vaut rien. Trois promesses le rendent utile, et
  chacune se vérifie ici sur le vrai chemin d'écriture — jamais sur une entrée
  fabriquée par le test.

  QUI. L'enveloppe codait en dur « adminId: null, email: null » pour tous les
  événements publics : le journal savait qu'un acte avait été réglé, jamais par
  qui. Chaque entrée porte désormais un acteur sur un vocabulaire fermé
  (notaire, client, partenaire, système), nommé par l'identifiant interne que le
  système possède déjà — jamais par une adresse courriel, jamais par une adresse
  d'origine : ce registre est gardé sept ans et s'ouvre sans la permission de
  lever l'anonymat.

  COMBIEN DE TEMPS. Sept ans, comptés en CALENDRIER depuis l'horodatage de
  l'entrée elle-même. Sept fois 365 jours expirerait deux jours trop tôt à cause
  des années bissextiles, et sur une borne de preuve, arrondir vers le bas est
  la seule erreur qui coûte cher.

  QUAND ÇA CASSE. La règle « l'audit ne bloque jamais l'argent » est conservée :
  un notaire ne doit pas rester impayé parce qu'une trace n'a pas pu s'écrire.
  Ce qui change, c'est qu'un puits d'audit cassé n'est plus indistinguable d'une
  journée calme — il émet la ligne que l'alarme compte.

  L'horloge est figée au 2026-08-12, à 14 h 00 UTC.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe

  Scénario: le règlement d'un acte nomme le notaire qui l'a signé, pas « le système »
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la trace "acte_retenu" est signée par le notaire "notaire@exemple.ca"
    Et la trace "acte_regle" est signée par le notaire "notaire@exemple.ca"
    Et aucune trace du jour n'est signée par « le système »

  Scénario: les gestes du client sont signés par son dossier, jamais par son adresse
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Alors la trace "client_jeton_emis" est signée par le client, nommé par son dossier
    Et la trace "caution_demandee" est signée par le client, nommé par son dossier
    Et aucune trace du jour ne porte d'adresse courriel ni d'adresse d'origine

  Scénario: chaque trace expire sept ans plus tard, jour pour jour
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors chaque trace du jour expire le "2033-08-12T14:00:00.000Z"
    Et cette échéance est comptée depuis l'horodatage de la trace elle-même
    Et elle est calendaire : elle tombe deux jours après un compte de sept fois 365 jours

  Scénario: une trace perdue crie, et l'argent passe quand même
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Et le puits d'audit tombe en panne
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et l'acte est réglé malgré tout, et inscrit au registre
    Et une alerte "audit_write_failed" a été émise pour l'action "acte_regle"
    Et cette alerte nomme le type de l'acteur, sans jamais recopier la trace perdue
