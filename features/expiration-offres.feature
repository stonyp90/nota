# language: fr
Fonctionnalité: Échéance obligatoire des offres
  Scénario: Une offre cesse d’être disponible après son échéance
    Étant donné une offre publiée le "2026-09-09" pour signer le "2026-09-30"
    Alors son dernier jour de validité est le "2026-09-16"
    Et elle est indisponible le "2026-09-17"

  Scénario: La signature limite la validité
    Étant donné une offre publiée le "2026-09-09" pour signer le "2026-09-10"
    Alors son dernier jour de validité est le "2026-09-10"
    Et elle est indisponible le "2026-09-11"

  Scénario: Les anciennes offres sans échéance quittent le marché
    Étant donné une ancienne offre sans échéance
    Alors elle est indisponible le "2026-09-09"
