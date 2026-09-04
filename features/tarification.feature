# language: fr
Fonctionnalité: Tarification et paliers de temps
  Le palier d'une enchère découle du nombre de jours qui séparent aujourd'hui
  de la date de signature souhaitée. Plus la date est proche, plus le palier est
  urgent : la veille commande ×3,5 et le jour même ×4 (milieux de bande ; le
  marché s'ajuste à l'intérieur de chacune). Cinq paliers, cinq situations —
  la veille et le jour même ne se confondent pas.

  Ce que l'urgence fait monter, ce sont les HONORAIRES du notaire : c'est lui
  qui déplace son agenda. Le prix du service de Nota, lui, ne bouge pas d'un
  cent (ADR 0031) — il ne dépend ni du notaire, ni de sa cote, ni de la valeur
  ni de l'urgence de l'acte. L'horloge est figée au 2026-08-12.

  Plan du scénario: le palier découle du nombre de jours
    Quand une signature est prévue dans <jours> jours
    Alors le palier est "<palier>"

    Exemples:
      | jours | palier      |
      | 0     | extreme     |
      | 1     | urgence     |
      | 2     | prioritaire |
      | 7     | prioritaire |
      | 8     | rapide      |
      | 14    | rapide      |
      | 15    | standard    |
      | 30    | standard    |

  Plan du scénario: le multiplicateur proposé monte à mesure que la date approche
    Quand une signature est prévue dans <jours> jours
    Alors le multiplicateur proposé est <multiplicateur>

    Exemples:
      | jours | multiplicateur |
      | 0     | 4              |
      | 1     | 3.5            |
      | 2     | 3              |

  # ADR 0031 — l'urgence est une raison de payer le NOTAIRE davantage, jamais
  # Nota. Un prix qui monterait avec l'urgence serait une part variable prise
  # sur un acte notarié, quel que soit le nom qu'on lui donne.
  Scénario: l'urgence fait monter les honoraires, jamais le prix de Nota
    Étant donné la facturation Stripe est configurée
    Quand un client publie une offre avec le courriel "calme@exemple.ca" pour "refinancement" à 2000 dans 30 jours
    Alors l'offre publiée porte le palier "standard"
    Et le montant porté à la carte du client est 2400 $
    Quand un client publie une offre avec le courriel "presse@exemple.ca" pour "refinancement" à 6000 dans 1 jours
    Alors l'offre publiée porte le palier "urgence"
    Et le montant porté à la carte du client est 6400 $
