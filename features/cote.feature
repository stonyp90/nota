# language: fr
Fonctionnalité: La cote sur 100 mesure le notaire — et ne décide plus un dollar
  L'ADR 0028 avait fait de la cote le levier de la rémunération : Nota gardait
  de 15 % à 5 % des honoraires selon la note qu'elle attribuait elle-même au
  notaire. L'ADR 0031 a retiré cette mécanique, et l'article qui l'a condamnée
  est l'art. 29.1 du Code de déontologie : « Le notaire ne peut conclure aucune
  convention ayant pour effet de mettre en péril l'indépendance, le
  désintéressement, l'objectivité et l'intégrité requis pour l'exercice de la
  profession de notaire. » Un revenu indexé sur une note attribuée par une
  entreprise privée est exactement une telle convention.

  Ce qui SURVIT : le calcul. `domain.notaryScore` additionne quatre axes —
  satisfaction des clients, services rendus, disponibilité, présence sur Nota —
  pour une cote sur 100, et cette cote est montrée au notaire dans son propre
  espace. Ce qui est RETIRÉ : tout ce qu'elle commandait. Aujourd'hui, dans le
  code, la cote ne fixe aucun prix, ne classe aucun fil, n'ouvre aucune porte.
  Elle mesure, et c'est tout.

  Ce qui ne change pas non plus : la cote ne descend JAMAIS vers un client
  (ADR 0030, art. 70 C.déont.). L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe

  Scénario: la cote est la somme de ses quatre axes, et rien d'autre
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote détaille les axes "satisfaction, services, disponibilite, presence"
    Et la somme des axes égale la cote affichée
    Et le total des maximums est 100

  # Ce que la console montrait hier : « vous gardez 85 % de ce que le client
  # paie, et 95 % au-dessus de 90 ». Montrer un tel barème à un notaire, c'est
  # lui proposer la convention que l'art. 29.1 lui interdit de conclure.
  Scénario: un notaire sans historique a déjà une cote — et elle ne lui coûte rien
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote est inférieure à 60
    Et sa console ne porte aucun barème : ni taux, ni part, ni palier

  Scénario: un dossier chevronné dépasse 90 — et ne lui rapporte toujours aucun taux
    Étant donné que le dossier du notaire "notaire@exemple.ca" est:
      | note | avis | actes | refinancement | financement | repondu | declinees | rayonKm | urgences | fiche | secteur | membreDepuis |
      | 4.9  | 40   | 80    | 50            | 30          | 60      | 3         | 50      | oui      | oui   | G1R     | 2025-01-01   |
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa cote est supérieure à 90
    Et sa console ne porte aucun barème : ni taux, ni part, ni palier

  # Ce que le notaire doit voir à la place d'un pourcentage : le prix que le
  # CLIENT paie à Nota. C'est une ligne du client, jamais une retenue sur les
  # siennes — et la console doit pouvoir le dire sans jamais l'exprimer en part.
  Scénario: la console dit au notaire ce que le client paie à Nota, jamais ce qu'il abandonne
    Quand le notaire "notaire@exemple.ca" consulte son espace
    Alors sa console annonce le prix que le CLIENT paie à Nota : 400 $

  # ART. 29.1 pris dans le temps : la cote peut monter ou s'effondrer entre
  # l'engagement du notaire et la signature. Avant l'ADR 0031, la rétention
  # gravait un taux sur l'offre parce qu'il FALLAIT s'en protéger. Aujourd'hui
  # il n'y a plus rien à graver : le prix ne dépend pas du notaire.
  Scénario: une cote qui s'effondre entre l'engagement et la signature ne change pas un cent
    Étant donné que le dossier du notaire "notaire@exemple.ca" est:
      | note | avis | actes | refinancement | financement | repondu | declinees | rayonKm | urgences | fiche | secteur | membreDepuis |
      | 4.6  | 20   | 22    | 16            | 6           | 26      | 6         | 50      | non      | oui   | G1R     | 2025-06-01   |
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Et la caution du client est autorisée
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Et la cote du notaire "notaire@exemple.ca" s'effondre
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 2000
    Alors la capture porte 2400 $
    Et le notaire reçoit 2000 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 400 $

  # ADR 0030 — art. 70 C.déont. : « Le notaire ne peut, dans sa publicité,
  # utiliser ou permettre que soit utilisé un témoignage d'appui ou de
  # reconnaissance qui le concerne. » Une note affichée transforme un annuaire
  # en recommandation. Restent les FAITS : l'Ordre et le nombre d'actes.
  Scénario: le client ne voit AUCUNE appréciation du notaire — art. 70 du Code de déontologie
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Quand le notaire "notaire@exemple.ca" propose 2400 sur l'offre
    Et le client consulte son offre
    Alors la proposition ne porte ni note, ni avis, ni cote
    Et la proposition porte des faits vérifiables : l'Ordre et le nombre d'actes

  Scénario: le parcours complet — l'urgence fixe les honoraires, l'acte livré paie, l'évaluation fait monter la cote
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 6000 dans 1 jours
    Et la caution du client est autorisée
    Alors l'offre publiée porte le palier "urgence"
    Et la carte du client est bloquée pour 6400 $
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 6000
    Alors la capture porte 6400 $
    Et le notaire reçoit 6000 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 400 $
    Et l'entrée d'audit "acte_regle" porte 6000 $ d'honoraires et 400 $ pour Nota
    Quand le client évalue le notaire à 5 avec le commentaire "Signé la veille, impeccable."
    Et le notaire "notaire@exemple.ca" consulte son espace
    Alors sa satisfaction pèse plus que celle d'un notaire sans avis
    Et son axe "services" compte 1 acte
