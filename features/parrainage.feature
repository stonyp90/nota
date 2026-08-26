# language: fr
Fonctionnalité: Parrainage des partenaires
  Les professionnels qui savent qu'un propriétaire a besoin d'un notaire
  aujourd'hui (courtier hypothécaire, agent immobilier) réfèrent des clients
  par un lien ?ref=CODE. L'attribution est privée : le code vit sur la
  demande, jamais sur le carnet public. La récompense est plate, jamais une
  part des honoraires, et suit deux volets : 50 $ quand la demande d'un
  client référé est RETENUE par un notaire, 250 $ quand un notaire référé
  retient son PREMIER acte. Le registre est toujours dérivé des dossiers,
  jamais tenu comme un état à part.

  Scénario: le code d'un partenaire est normalisé avant d'être attribué
    Quand un client arrive avec le code de parrainage "eve-roy"
    Alors le code attribué est "EVEROY"
    Et le code est reconnu comme un code de parrainage valide

  Scénario: un code invalide ne bloque jamais une réservation
    Quand je publie une enchère parrainée par "x!" pour "refinancement" le "2026-08-20" à 2500
    Alors la réponse a le statut 201
    Et le code "x!" n'est pas reconnu comme un code de parrainage

  Scénario: un code donné de vive voix se saisit à la main, peu importe la casse ou les espaces
    Quand je publie une enchère parrainée par " eve roy " pour "refinancement" le "2026-08-20" à 2500
    Alors la réponse a le statut 201
    Et la demande publiée porte le parrainage "EVEROY"

  Scénario: une auto-référence ne compte jamais
    Étant donné le partenaire inscrit "EVEROY" avec le courriel "eve@agence.ca"
    Quand je publie une enchère parrainée par "EVEROY" avec le courriel "eve@agence.ca" pour "refinancement" le "2026-08-20" à 2500
    Alors la réponse a le statut 201
    Et la demande publiée ne porte aucun parrainage

  Scénario: le code de parrainage n'apparaît jamais sur le carnet public
    Quand je publie une enchère parrainée par "EVEROY" pour "refinancement" le "2026-08-20" à 2500
    Alors la réponse a le statut 201
    Et dans le carnet du mois "2026-08", aucune enchère n'expose de parrainage

  Scénario: une demande référée encore ouverte ne rapporte rien
    Étant donné le carnet de parrainage suivant:
      | parrain | statut  | acte |
      | EVEROY  | ouverte | non  |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" compte 1 demande et un dû de 0 $

  Scénario: une demande référée retenue rapporte 50 $, avant même que l'acte se complète
    Étant donné le carnet de parrainage suivant:
      | parrain | statut  | acte |
      | EVEROY  | retenue | non  |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" compte 1 demande et un dû de 50 $

  Scénario: le registre totalise par code, un code écrit différemment restant le même parrain
    Étant donné le carnet de parrainage suivant:
      | parrain   | statut  | acte |
      | EVEROY    | retenue | non  |
      | eve-roy   | retenue | oui  |
      | EVEROY    | ouverte | non  |
      | COURTIER1 | retenue | non  |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" compte 3 demandes et un dû de 100 $
    Et le code "COURTIER1" compte 1 demande et un dû de 50 $

  Scénario: un notaire parrainé qui n'a pas encore retenu d'acte ne rapporte rien
    Étant donné les notaires parrainés suivants:
      | parrain | premier_acte |
      | EVEROY  | non          |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" a un dû de 0 $

  Scénario: le premier acte d'un notaire parrainé rapporte exactement 250 $
    Étant donné les notaires parrainés suivants:
      | parrain | premier_acte |
      | EVEROY  | oui          |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" a un dû de 250 $

  Scénario: un même code cumule le volet client et le volet notaire
    Étant donné le carnet de parrainage suivant:
      | parrain | statut  | acte |
      | EVEROY  | retenue | oui  |
      | EVEROY  | retenue | non  |
    Et les notaires parrainés suivants:
      | parrain | premier_acte |
      | EVEROY  | oui          |
    Quand je consulte le registre de parrainage
    Alors le code "EVEROY" a un dû de 350 $
