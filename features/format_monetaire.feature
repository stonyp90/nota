# language: fr
Fonctionnalité: Format monétaire québécois
  Tout montant présenté à un client passe par money(), qui applique le
  format du Québec : espace comme séparateur des milliers et " $" en suffixe.

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
