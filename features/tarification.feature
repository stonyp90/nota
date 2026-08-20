# language: fr
Fonctionnalité: Tarification et paliers de temps
  Le palier d'une enchère découle du nombre de jours qui séparent
  aujourd'hui de la date de signature souhaitée. Plus la date est proche,
  plus le palier est urgent. Les trois derniers jours avant une signature
  forment une seule situation, et non trois.

  Plan du scénario: le palier découle du nombre de jours
    Quand une signature est prévue dans <jours> jours
    Alors le palier est "<palier>"

    Exemples:
      | jours | palier      |
      | 0     | extreme     |
      | 1     | urgence     |
      | 2     | prioritaire |
      | 3     | prioritaire |
      | 4     | rapide      |
      | 14    | rapide      |
      | 15    | standard    |
      | 30    | standard    |

  Plan du scénario: le multiplicateur proposé monte à mesure que la date approche
    Quand une signature est prévue dans <jours> jours
    Alors le multiplicateur proposé est <multiplicateur>

    Exemples:
      | jours | multiplicateur |
      | 0     | 9              |
      | 1     | 7              |
      | 2     | 3.5            |
