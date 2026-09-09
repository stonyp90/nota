# language: fr
Fonctionnalité: Mesurer le parcours sans inventer de conversions
  Scénario: Les balises publiques ne créent pas de publications ni d'inscriptions
    Quand le navigateur déclare les événements "publie,notaire_inscrit,prix_vu"
    Alors le compteur de parcours "publie" vaut 0
    Et le compteur de parcours "notaire_inscrit" vaut 0
    Et le compteur de parcours "prix_vu" vaut 1

  Scénario: Un retour de paiement est une observation du navigateur
    Quand le navigateur déclare les événements "paiement_ok"
    Alors le compteur de parcours "paiement_ok" vaut 1
    Et le libellé du parcours "paiement_ok" est "Retours de paiement — succès"

  Scénario: Les appareils et sources sont des catégories, pas des profils individuels
    Quand un navigateur Android déclare une visite provenant de Google avec une URL privée
    Alors le segment "os" contient "android" avec 1 visite
    Et le segment "source" contient "google" avec 1 visite
    Et les statistiques du parcours ne contiennent pas l’URL privée
