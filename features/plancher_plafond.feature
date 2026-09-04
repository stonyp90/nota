# language: fr
Fonctionnalité: Plancher et plafond de l'offre
  Une offre doit valoir au moins le prix de base du service et ne peut dépasser
  5 fois ce prix (PREMIUM_CAP — le plafond de surprime, juste au-dessus du ×4
  qu'une signature le jour même commande). Réponses obligatoires valides,
  « refinancement » part à 2 000 $ (plafond 10 000 $) et « financement », sans
  ancienne hypothèque à radier, part à 1 800 $ (plafond 9 000 $).

  Le plancher et le plafond bornent les HONORAIRES DU NOTAIRE, et eux seuls.
  Depuis l'ADR 0031, le prix du service de Nota est une seconde ligne, payée par
  le client à côté : il s'ajoute à l'offre, il ne s'y retranche jamais. Un
  plancher qui devrait absorber le prix de Nota serait une réduction des
  honoraires du notaire — exactement ce que l'art. 32.1 1° de la Loi sur le
  notariat présume être une usurpation.

  L'horloge est figée au 2026-08-12.

  Scénario: une offre sous le prix de départ est refusée
    Soit le service "refinancement"
    Quand je valide une offre de 1500 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "sous_prix_depart" est présente

  Scénario: une offre au-dessus de 5x est refusée
    Soit le service "refinancement"
    Quand je valide une offre de 10001 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "plafond_depasse" est présente

  Scénario: une offre exactement à 5x est acceptée
    Soit le service "refinancement"
    Quand je valide une offre de 10000 $ pour une date valide
    Alors l'offre est acceptée
    Et le palier calculé n'est pas vide

  Scénario: le financement a son propre plancher, à 1 800 $
    Soit le service "financement"
    Quand je valide une offre de 1799 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "sous_prix_depart" est présente

  Scénario: une offre au plancher du financement est acceptée
    Soit le service "financement"
    Quand je valide une offre de 1800 $ pour une date valide
    Alors l'offre est acceptée
    Et le palier calculé n'est pas vide

  # ADR 0031 — le plancher est celui du NOTAIRE. Le prix de Nota le suit, il ne
  # le grignote pas : un client qui offre exactement le plancher fait bloquer
  # le plancher PLUS le prix de Nota, et le notaire touchera le plancher entier.
  Scénario: le prix de Nota s'ajoute au plancher, il ne s'y retranche pas
    Étant donné la facturation Stripe est configurée
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Alors la réponse a le statut 201
    Et le montant porté à la carte du client est 2299 $
