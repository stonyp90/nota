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

  # Un document peut dépendre d'une réponse tarifaire (prédicat `si`). Sans les
  # réponses, la liste est complète — comme avant ; avec elles, seuls les
  # documents qui concernent CE client sont demandés.
  Scénario: sans les réponses tarifaires, tous les documents sont demandés
    Étant donné un dossier "financement" avec les réponses tarifaires obligatoires
    Quand j'évalue l'état du dossier
    Alors le document "promesse_achat" est demandé
    Et le document "testament_transmission" est demandé

  Scénario: un document conditionnel n'est pas demandé quand la réponse l'exclut
    Étant donné un dossier "financement" avec les réponses tarifaires obligatoires
    Et le consentement au partage du dossier
    Quand j'évalue l'état du dossier selon les réponses tarifaires
    Alors la demande est prête
    Et le document "promesse_achat" n'est pas demandé
    Et le document "testament_transmission" n'est pas demandé
    Et le document "piece_identite" est demandé

  Scénario: l'achat d'une propriété appelle la promesse d'achat acceptée
    Étant donné un dossier "financement" avec les réponses tarifaires obligatoires
    Et la réponse tarifaire "contexte" vaut "achat"
    Quand j'évalue l'état du dossier selon les réponses tarifaires
    Alors le document "promesse_achat" est demandé

  Scénario: un certificat de localisation périmé n'appelle aucun téléversement
    Étant donné un dossier "refinancement" avec les réponses tarifaires obligatoires
    Et la réponse tarifaire "certificat_localisation" vaut "perime"
    Quand j'évalue l'état du dossier selon les réponses tarifaires
    Alors le document "certificat_localisation" n'est pas demandé
    Et la liste du dossier porte une note pour "certificat_localisation"
