# language: fr
Fonctionnalité: Format monétaire québécois
  Tout montant présenté à un client passe par money(), qui applique le
  format du Québec : une espace INSÉCABLE comme séparateur des milliers et avant
  le symbole, pour qu'un montant ne soit jamais coupé en fin de ligne.

  Plan du scénario: money() met en forme un montant
    Quand je formate le montant <dollars>
    Alors l'affichage est "<affichage>"

    Exemples:
      | dollars | affichage |
      | 0       | 0 $       |
      | 495     | 495 $     |
      | 950     | 950 $     |
      | 1350    | 1 350 $   |
      | 4950    | 4 950 $   |
      | 12000   | 12 000 $  |

  Scénario: le séparateur est une espace insécable, jamais une espace ordinaire
    Quand je formate le montant 1350
    Alors l'affichage n'utilise aucune espace sécable
