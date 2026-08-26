# language: fr
Fonctionnalité: Plancher et plafond de l'offre
  Une offre doit valoir au moins le prix de base du service et ne peut
  dépasser 10 fois ce prix (le plafond de surprime). Réponses obligatoires
  valides, "refinancement" part à 2 000 $ (plafond 20 000 $) et
  "financement", sans ancienne hypothèque à radier, part à 1 800 $.

  Scénario: une offre sous le prix de départ est refusée
    Soit le service "refinancement"
    Quand je valide une offre de 1500 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "sous_prix_depart" est présente

  Scénario: une offre au-dessus de 10x est refusée
    Soit le service "refinancement"
    Quand je valide une offre de 20001 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "plafond_depasse" est présente

  Scénario: une offre exactement à 10x est acceptée
    Soit le service "refinancement"
    Quand je valide une offre de 20000 $ pour une date valide
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
