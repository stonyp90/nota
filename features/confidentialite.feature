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
