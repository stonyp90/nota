# language: fr
Fonctionnalité: Plancher et plafond de l'offre
  Une offre doit valoir au moins le prix de départ du service et ne peut
  dépasser 10 fois ce prix (le plafond de surprime). Le service "testament"
  a un prix de départ de 1 250 $, donc un plafond de 12 500 $.

  Scénario: une offre sous le prix de départ est refusée
    Soit le service "testament"
    Quand je valide une offre de 400 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "sous_prix_depart" est présente

  Scénario: une offre au-dessus de 10x est refusée
    Soit le service "testament"
    Quand je valide une offre de 12501 $ pour une date valide
    Alors l'offre est refusée
    Et l'erreur "plafond_depasse" est présente

  Scénario: une offre exactement à 10x est acceptée
    Soit le service "testament"
    Quand je valide une offre de 12500 $ pour une date valide
    Alors l'offre est acceptée
    Et le palier calculé n'est pas vide
