# language: fr
Fonctionnalité: Le prix avant les documents
  Une demande est prête dès que le client a répondu aux questions tarifaires
  obligatoires et consenti au partage du dossier. Les documents sont un
  progrès de préparation, jamais une barrière — et un document déjà transmis
  par un autre canal compte comme fourni.

  Scénario: réponses obligatoires et consentement suffisent, sans aucun document
    Étant donné un dossier "refinancement" avec les réponses tarifaires obligatoires
    Et le consentement au partage du dossier
    Quand j'évalue l'état du dossier
    Alors la demande est prête
    Et aucun document n'est fourni

  Scénario: sans réponse tarifaire obligatoire, la demande n'est pas prête
    Étant donné un dossier "refinancement" sans réponse tarifaire
    Et le consentement au partage du dossier
    Quand j'évalue l'état du dossier
    Alors la demande n'est pas prête

  Scénario: sans consentement, la demande n'est pas prête même bien répondue
    Étant donné un dossier "refinancement" avec les réponses tarifaires obligatoires
    Quand j'évalue l'état du dossier
    Alors la demande n'est pas prête

  Scénario: un document transmis par un autre canal compte comme fourni
    Étant donné un dossier "refinancement" avec les réponses tarifaires obligatoires
    Et le consentement au partage du dossier
    Et le document "piece_identite" marqué "transmis_autrement"
    Quand j'évalue l'état du dossier
    Alors la demande est prête
    Et exactement 1 document est fourni
