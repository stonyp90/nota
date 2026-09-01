# language: fr
Fonctionnalité: La cote sur 100 du notaire décide le partage
  Décision du propriétaire (ADR 0028, 2026-09-01) : le montant offert par le
  client est un total tout compris qui se partage à la signature. Nota garde
  AU PLUS 15 %, et seulement 5 % pour les meilleurs — un notaire dont la cote
  dépasse 90 garde 95 % de ce que le client paie. Le levier est une seule
  mesure, publiée des deux côtés : la cote sur 100, somme de quatre axes —
  satisfaction des clients, services rendus, disponibilité, présence sur Nota.
  L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe

  Scénario: un notaire sans historique part à 85 % — jamais moins
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote est inférieure à 60
    Et il garde 85 % de ce que le client paie
    Et le prochain palier lui est nommé avec les points qui lui manquent

  Scénario: la cote est la somme de ses quatre axes, et rien d'autre
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote détaille les axes "satisfaction, services, disponibilite, presence"
    Et la somme des axes égale la cote affichée
    Et le total des maximums est 100

  Scénario: le sommet du propriétaire — au-dessus de 90, le notaire garde 95 %
    Étant donné que le dossier du notaire "notaire@exemple.ca" est:
      | note | avis | actes | refinancement | financement | repondu | declinees | rayonKm | urgences | fiche | secteur | membreDepuis |
      | 4.9  | 40   | 80    | 50            | 30          | 60      | 3         | 50      | oui      | oui   | G1R     | 2025-01-01   |
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote est supérieure à 90
    Et il garde 95 % de ce que le client paie
    Et aucun palier ne reste à atteindre

  Scénario: le barème complet est publié — un palier n'est jamais une règle cachée
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors l'échelle publiée est:
      | cote | garde |
      | 60   | 88    |
      | 70   | 90    |
      | 80   | 92    |
      | 90   | 95    |

  Scénario: chaque commission est divulguée ligne à ligne dans le relevé
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le notaire "notaire@exemple.ca" consulte son relevé
    Alors le relevé porte 1 acte
    Et la ligne du relevé montre 2800 $ payés, 15 % retenus, 420 $ à Nota et 2380 $ au notaire
    Et la ligne du relevé nomme la cote qui a mérité ce taux

  Scénario: le règlement laisse une piste d'audit
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors une entrée d'audit "acte_regle" existe avec 2800 $, un taux et une cote

  Scénario: le client ne voit AUCUNE appréciation du notaire — art. 70 du Code de déontologie
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Quand le notaire "notaire@exemple.ca" propose 2400 sur l'offre
    Et le client consulte son offre
    Alors la proposition ne porte ni note, ni avis, ni cote
    Et la proposition porte des faits vérifiables : l'Ordre et le nombre d'actes

  Scénario: le parcours complet — l'urgence fixe le prix, l'acte livré paie, l'évaluation fait monter la cote
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 6000 dans 1 jours
    Et la caution du client est autorisée
    Alors l'offre publiée porte le palier "urgence"
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 6000
    Alors la caution est capturée et le notaire reçoit 5100 $ net, Nota gardant 900 $
    Et une entrée d'audit "acte_regle" existe avec 6000 $, un taux et une cote
    Quand le client évalue le notaire à 5 avec le commentaire "Signé la veille, impeccable."
    Et le notaire "notaire@exemple.ca" consulte son espace
    Alors sa satisfaction pèse plus que celle d'un notaire sans avis
    Et son axe "services" compte 1 acte

  Scénario: le taux promis à l'engagement est un plafond — une cote qui baisse ne renchérit rien
    Étant donné que le dossier du notaire "notaire@exemple.ca" est:
      | note | avis | actes | refinancement | financement | repondu | declinees | rayonKm | urgences | fiche | secteur | membreDepuis |
      | 4.6  | 20   | 22    | 16            | 6           | 26      | 6         | 50      | non      | oui   | G1R     | 2025-06-01   |
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Et la caution du client est autorisée
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Alors l'offre porte le taux de l'engagement
    Quand la cote du notaire "notaire@exemple.ca" s'effondre
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 2000
    Alors la caution est capturée et le notaire reçoit 1840 $ net, Nota gardant 160 $
