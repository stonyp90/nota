# language: fr
Fonctionnalité: Validation d'offre via l'API
  L'API POST /bids revalide chaque offre de façon autoritaire via le domaine.
  Une offre fautive renvoie 422 avec le code d'erreur correspondant ; une
  offre propre renvoie 201 et apparaît dans le carnet du mois. L'horloge est
  figée au 2026-08-12.

  Scénario: une date mal formée est refusée
    Quand je publie une enchère pour "testament" le "pas-une-date" à 700
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "date_invalide"

  Scénario: une date déjà passée est refusée
    Quand je publie une enchère pour "testament" le "2026-08-01" à 700
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "date_passee"

  Scénario: un service inconnu est refusé
    Quand je publie une enchère pour "inexistant" le "2026-08-20" à 700
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "service_inconnu"

  Scénario: une offre propre est acceptée et apparaît dans le carnet
    Quand je publie une enchère pour "testament" le "2026-08-20" à 700
    Alors la réponse a le statut 201
    Et l'enchère apparaît dans le carnet du mois "2026-08"
