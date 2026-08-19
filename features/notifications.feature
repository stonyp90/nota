# language: fr
Fonctionnalité: Cycle de vie des notifications
  Chaque événement du marché Nota déclenche exactement les courriels attendus,
  et jamais un de trop. Un mailer factice capture chaque envoi (aucun réseau,
  aucun SDK) ; on vérifie le destinataire et le type de gabarit. Le consentement
  (CASL / Loi 25) est respecté : une adresse désabonnée ne reçoit rien, et un
  même envoi n'est jamais répété. L'horloge est figée au 2026-08-12.

  Scénario: publier une offre avec courriel notifie le client et l'opérateur
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "testament" à 700 dans 10 jours
    Alors la réponse a le statut 201
    Et le client "client@exemple.ca" reçoit le courriel "offer published"
    Et l'opérateur reçoit le courriel "nouveau lead"

  Scénario: publier une offre sans courriel réussit sans tenter d'email client
    Quand un client publie une offre sans courriel pour "testament" à 700 dans 10 jours
    Alors la réponse a le statut 201
    Et aucun courriel client n'est tenté
    Et l'opérateur reçoit le courriel "nouveau lead"

  Scénario: le webhook « checkout.session.completed » n'accueille pas de notaire (modèle à la commission)
    Quand un notaire "notaire@exemple.ca" complète son abonnement via le webhook "checkout.session.completed"
    Alors la réponse a le statut 200
    Et le notaire "notaire@exemple.ca" ne reçoit aucun courriel

  Scénario: un rappel est dû à 3 jours de la signature
    Étant donné une offre ouverte avec le courriel "relance@exemple.ca" pour "testament" à 700 dans 3 jours
    Quand le planificateur de rappels s'exécute
    Alors le client "relance@exemple.ca" reçoit le courriel "date approche"

  Scénario: aucun rappel n'est dû à 4 jours de la signature
    Étant donné une offre ouverte avec le courriel "loin@exemple.ca" pour "testament" à 700 dans 4 jours
    Quand le planificateur de rappels s'exécute
    Alors le client "loin@exemple.ca" ne reçoit aucun courriel "date approche"

  Scénario: une adresse désabonnée ne reçoit rien
    Étant donné l'adresse "client@exemple.ca" s'est désabonnée
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "testament" à 700 dans 10 jours
    Alors la réponse a le statut 201
    Et le client "client@exemple.ca" ne reçoit aucun courriel

  Scénario: une même offre republiée n'envoie jamais deux fois le même courriel
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "testament" à 700 dans 10 jours
    Et la même offre est republiée
    Alors le client "client@exemple.ca" reçoit exactement 1 courriel "offer published"
    Et l'opérateur reçoit exactement 1 courriel "nouveau lead"

  Scénario: un rappel dû n'est jamais renvoyé deux fois (idempotence du planificateur)
    Étant donné une offre ouverte avec le courriel "relance@exemple.ca" pour "testament" à 700 dans 3 jours
    Quand le planificateur de rappels s'exécute
    Et le planificateur de rappels s'exécute
    Alors le client "relance@exemple.ca" reçoit exactement 1 courriel "date approche"
