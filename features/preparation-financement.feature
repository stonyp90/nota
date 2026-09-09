# language: fr
Fonctionnalité: Préparer le financement sans certifier la signature
  Scénario: Les renseignements utiles au notaire restent dans le dossier privé
    Quand je prépare les renseignements de refinancement
    Alors le dossier conserve les parties, le prêteur et les dettes garanties
    Et les champs inconnus ne certifient pas la signature

  Scénario: Un inventaire complet ne valide pas les conditions de signature
    Quand tous les éléments du refinancement sont déclarés
    Alors les vérifications du notaire restent à faire

  Scénario: Une extraction ne peut inventer une preuve dans le dossier
    Quand une extraction cite une page absente du dossier
    Alors la proposition de financement est refusée

  Scénario: Une révision ne donne pas une autorisation d’entraînement
    Quand le notaire accepte un champ extrait avec sa preuve
    Alors la révision reste privée et ne certifie pas la signature

  Scénario: Réutiliser les réponses du client dans le dossier de travail
    Quand le client a déjà indiqué son adresse et son prêteur
    Alors Nota prépare ces renseignements sans les redemander
    Et les vérifications officielles restent en attente
