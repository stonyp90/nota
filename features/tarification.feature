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
      | 0     | prioritaire |
      | 1     | prioritaire |
      | 3     | prioritaire |
      | 4     | rapide      |
      | 14    | rapide      |
      | 15    | standard    |
      | 30    | standard    |

  Scénario: le palier prioritaire propose 3x le prix de départ
    Quand une signature est prévue dans 2 jours
    Alors le palier est "prioritaire"
    Et le multiplicateur proposé est 3
