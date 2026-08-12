# language: fr
Fonctionnalité: Tarification et paliers de temps
  Le palier d'une enchère découle du nombre de jours qui séparent
  aujourd'hui de la date de signature souhaitée. Plus la date est proche,
  plus le palier est urgent.

  Plan du scénario: le palier découle du nombre de jours
    Quand une signature est prévue dans <jours> jours
    Alors le palier est "<palier>"

    Exemples:
      | jours | palier      |
      | 0     | extreme     |
      | 1     | extreme     |
      | 2     | urgence     |
      | 3     | urgence     |
      | 4     | prioritaire |
      | 7     | prioritaire |
      | 8     | rapide      |
      | 14    | rapide      |
      | 15    | standard    |
      | 30    | standard    |
