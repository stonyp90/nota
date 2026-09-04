# language: fr
Fonctionnalité: Tarification et paliers de temps
  Le palier d'une enchère découle du nombre de jours qui séparent aujourd'hui
  de la date de signature souhaitée. Plus la date est proche, plus le palier est
  urgent : la veille commande ×3,5 et le jour même ×4 (milieux de bande ; le
  marché s'ajuste à l'intérieur de chacune). Cinq paliers, cinq situations —
  la veille et le jour même ne se confondent pas.

  Ce que l'urgence fait monter, ce sont d'abord les HONORAIRES du notaire :
  c'est lui qui déplace son agenda, et l'art. 49 4° du Code de déontologie lui
  reconnaît expressément le droit de tenir compte, dans SES honoraires, d'une
  « célérité exceptionnelle ». Depuis l'ADR 0034, l'urgence ajoute aussi une
  ligne à Nota — la garantie de date, c'est-à-dire ce que NOTA vend : trouver
  un notaire à courte échéance et tenir la date. Deux objets, deux
  justifications, deux lignes ; jamais un seul nombre faisant les deux
  travaux. Ce qui ne bouge toujours pas d'un cent, c'est le prix du SERVICE de
  Nota : il ne dépend ni du notaire, ni de sa cote, ni de la valeur de l'acte.
  L'horloge est figée au 2026-08-12.

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

  # ADR 0031 + ADR 0034 — l'urgence paie le NOTAIRE davantage (art. 49 4°), et
  # elle achète à Nota une garantie de date, sur SA propre ligne. Ce que
  # l'urgence ne fait jamais, c'est faire varier le prix du SERVICE de Nota ni
  # le lier à la valeur de l'acte : ce serait une part variable prise sur un
  # acte notarié, quel que soit le nom qu'on lui donne. Ci-dessous le
  # refinancement se tarife 249 $ dans les DEUX cas — l'acte triple, la ligne
  # de service ne bouge pas ; seule la garantie de date change, de 0 $ à
  # échéance normale à 200 $ pour une signature le lendemain.
  Scénario: l'urgence fait monter les honoraires et la garantie de date, jamais le prix du service
    Étant donné la facturation Stripe est configurée
    Quand un client publie une offre avec le courriel "calme@exemple.ca" pour "refinancement" à 2000 dans 30 jours
    Alors l'offre publiée porte le palier "standard"
    Et le montant porté à la carte du client est 2249 $
    Quand un client publie une offre avec le courriel "presse@exemple.ca" pour "refinancement" à 6000 dans 1 jours
    Alors l'offre publiée porte le palier "urgence"
    Et le montant porté à la carte du client est 6449 $
