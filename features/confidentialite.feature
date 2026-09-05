# language: fr
Fonctionnalité: Confidentialité de l'enchère
  Le carnet public ne doit jamais divulguer le nom d'une enchère anonyme,
  quel que soit le nom envoyé par le client. Une enchère nominative, elle,
  affiche son nom. Le préfixe postal reste visible dans les deux cas.

  Scénario: une enchère anonyme masque le nom mais montre le préfixe
    Quand je publie une enchère anonyme au nom de "Marie Tremblay" avec préfixe "G1R" pour "refinancement" le "2026-08-20" à 2500
    Alors la réponse a le statut 201
    Et dans le carnet du mois "2026-08", l'enchère n'expose aucun nom
    Et dans le carnet du mois "2026-08", l'enchère expose le préfixe "G1R"

  Scénario: une enchère nominative affiche le nom
    Quand je publie une enchère nominative au nom de "Luc Gagné" avec préfixe "G2B" pour "refinancement" le "2026-08-20" à 2200
    Alors la réponse a le statut 201
    Et dans le carnet du mois "2026-08", l'enchère expose le nom "Luc Gagné"

  # --- Loi 25 : accès et effacement (2026-09-05) -----------------------------
  # Le droit d'accès de l'art. 27 n'existe que si l'on peut RETROUVER une
  # personne. L'index par adresse existait, testé, et personne ne l'écrivait :
  # il était vide en production, et le droit était théorique.

  Scénario: publier une enchère rend la personne retrouvable par son adresse
    Quand je publie une enchère au courriel "luc@exemple.ca" pour "refinancement" le "2026-08-20" à 2200
    Alors la réponse a le statut 201
    Et l'adresse "luc@exemple.ca" retrouve 1 enchère
    Mais le carnet public n'expose jamais l'adresse du client

  Scénario: la casse de l'adresse ne crée pas deux personnes
    Quand je publie une enchère au courriel "Luc.Gagne@Exemple.CA" pour "refinancement" le "2026-08-20" à 2200
    Et je publie une enchère au courriel "luc.gagne@exemple.ca" pour "refinancement" le "2026-08-21" à 2300
    Alors l'adresse "luc.gagne@exemple.ca" retrouve 2 enchères

  Scénario: une enchère sans adresse se publie quand même
    Quand je publie une enchère sans courriel pour "refinancement" le "2026-08-20" à 2200
    Alors la réponse a le statut 201

  # --- La frontière de l'effacement (art. 28) --------------------------------
  # L'effacement n'est pas inconditionnel, et un produit qui le laisse croire
  # ment deux fois : au client, et au notaire dont il détruirait la preuve.

  Scénario: une enchère sans acte réglé s'efface
    Étant donné une enchère "b1" du "2026-08-20" au statut "annulee" sans acte réglé
    Quand je prépare l'effacement de "luc@exemple.ca"
    Alors le plan efface l'enchère "b1"

  # Le plan ne peut PAS se déclarer complet aujourd'hui, et le dire est la
  # moitié honnête du droit à l'effacement : trois registres rangent l'adresse
  # en clair — le journal des envois, les lignes de destinataire de campagne et
  # l'index par adresse — et aucun adaptateur ne sait les vider. Les annoncer
  # « effacés » ferait dire à la console « Dossier effacé » sur une adresse
  # toujours en clair.
  Scénario: ce que le code ne sait pas détruire est nommé, jamais annoncé effacé
    Étant donné une enchère "b1" du "2026-08-20" au statut "annulee" sans acte réglé
    Quand je prépare l'effacement de "luc@exemple.ca"
    Alors le plan se déclare partiel
    Et le plan laisse hors de portée la famille "journal_sujet"
    Et le plan laisse hors de portée la famille "destinataire_campagne"
    Et le plan laisse hors de portée la famille "index_client"

  Scénario: une enchère dont l'acte est réglé est CONSERVÉE, et le plan le dit
    Étant donné une enchère "b2" du "2026-06-15" au statut "retenue" avec acte réglé le "2026-06-15T14:00:00Z"
    Quand je prépare l'effacement de "luc@exemple.ca"
    Alors le plan conserve l'enchère "b2"
    Et le motif de conservation de l'enchère "b2" mentionne "pièce comptable"
    Et le plan se déclare partiel

  Scénario: le journal d'audit survit à tout effacement
    Quand je prépare l'effacement de "luc@exemple.ca"
    Alors le plan conserve la famille "journal_audit"
    Et le plan n'efface jamais la famille "journal_audit"
