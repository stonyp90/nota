# language: fr
Fonctionnalité: Les murs déontologiques du modèle
  Nota n'est pas notaire. Elle est un INTERMÉDIAIRE entre un client et un
  notaire, et c'est ce statut qui la met sous surveillance. L'ADR 0031 a
  restructuré la rémunération pour sortir de quatre textes ; ce fichier
  transforme chacun d'eux en scénario, pour qu'un retour en arrière casse un
  test plutôt que de se découvrir chez un syndic.

  Chaque scénario nomme son article, et chaque article est cité au texte
  officiel (docs/legal/code-deontologie-notaires-texte-officiel.md). Ce qui est
  vérifié ici n'est pas une intention : c'est ce que le code répond.

  L'horloge est figée au 2026-08-12.

  # ART. 32 C.déont. — « Le notaire ne peut partager ses honoraires avec une
  # personne qui n'est pas membre d'un ordre professionnel régi par le Code des
  # professions. » Le module de DOMAINE — le calcul notarial : prix planchers,
  # paliers, validation des offres — ne doit jamais exposer un concept de
  # partage. Ce que Nota facture est une affaire de facturation, isolée dans la
  # couche billing ; les honoraires du notaire n'en savent rien.
  Scénario: le domaine n'expose aucun concept de commission ou de pourcentage
    Quand j'inspecte les exports du module de domaine
    Alors aucun export ne ressemble à une commission ou à un pourcentage
    Et il n'existe pas d'export "commission"
    Et il n'existe pas d'export "cut"
    Et il n'existe pas d'export "percentage"

  # ART. 68 C.déont. — « Le notaire ne doit faire ni permettre que soit faite,
  # par quelque moyen que ce soit, aucune publicité fausse, trompeuse,
  # INCOMPLÈTE ou susceptible d'induire en erreur. » La carte du client autorise
  # DEUX lignes. Tant que la seconde n'apparaît nulle part, le client la
  # découvre chez Stripe — et « incomplète » est le mot exact.
  #
  # ART. 71 3° C.déont. — quiconque annonce des honoraires doit « indiquer si
  # les débours et les taxes sont ou non inclus ». Aujourd'hui, ni TPS/TVQ ni
  # droits de publication n'existent nulle part dans le code : le produit doit
  # le DÉCLARER, et non laisser lire un « tout compris » qui n'en est pas un.
  Scénario: le prix de Nota est annoncé avant que le client n'autorise sa carte — art. 68 et 71 3°
    Quand le carnet public du mois "2026-08" est consulté
    Alors le carnet annonce le prix du service de Nota, 400 $
    Et le carnet déclare que ni les taxes ni les débours ne sont inclus

  # ART. 29.1 C.déont. — « Le notaire ne peut conclure aucune convention ayant
  # pour effet de mettre en péril l'indépendance, le désintéressement,
  # l'objectivité et l'intégrité requis pour l'exercice de la profession de
  # notaire. » Le test décisif : deux notaires aux antipodes de la cote règlent
  # le même acte, au même montant. Si le client paie un cent de différence, le
  # revenu du notaire est indexé sur une note attribuée par Nota.
  Scénario: deux notaires aux antipodes de la cote coûtent le même prix au client — art. 29.1
    Étant donné un notaire actif "chevronne@exemple.ca"
    Et un notaire actif "debutant@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "chevronne@exemple.ca" est connecté à Stripe
    Et le notaire "debutant@exemple.ca" est connecté à Stripe
    Et que le dossier du notaire "chevronne@exemple.ca" est:
      | note | avis | actes | refinancement | financement | repondu | declinees | rayonKm | urgences | fiche | secteur | membreDepuis |
      | 4.9  | 40   | 80    | 50            | 30          | 60      | 3         | 50      | oui      | oui   | G1R     | 2025-01-01   |
    Et un client publie une offre avec le courriel "un@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "chevronne@exemple.ca" retient l'offre
    Et le notaire "chevronne@exemple.ca" marque l'acte complété à 2800
    Et un client publie une offre avec le courriel "deux@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "debutant@exemple.ca" retient l'offre
    Quand le notaire "debutant@exemple.ca" marque l'acte complété à 2800
    Alors la cote de "chevronne@exemple.ca" dépasse celle de "debutant@exemple.ca" d'au moins 30 points
    Et les deux règlements coûtent exactement le même prix au client

  # Le même article, pris sur les PIÈCES. Une convention ne se juge pas
  # seulement à ce qu'elle transfère, mais à ce qu'elle écrit : un relevé ou une
  # piste d'audit qui nomme un taux et la cote qui l'a mérité DÉCRIT la
  # convention interdite, même si l'argent, lui, ne bouge plus.
  Scénario: aucune ligne d'argent ne porte de taux ni de cote — art. 29.1
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le notaire "notaire@exemple.ca" consulte son relevé
    Alors aucune ligne du relevé ne porte de taux ni de cote
    Et l'entrée d'audit "acte_regle" porte 2800 $ d'honoraires et 400 $ pour Nota
    Quand le client consulte son offre
    Alors le client voit son acte réglé en deux lignes : 2800 $ et 400 $, soit 3200 $

  # ART. 37 C.déont. — « Le notaire ne doit pas, à moins que la nature du cas ne
  # l'exige, révéler qu'une personne a fait appel à ses services. » Le carnet
  # est PUBLIC et sans authentification : y nommer l'étude à côté du secteur
  # postal du client, du montant et de la date, c'est révéler exactement cela,
  # et l'anonymat du client n'y change rien. La nature du cas n'exige rien de
  # tel — le signal de marché utile est « cette date est prise ».
  #
  # Le nom de l'étude reste dû au CLIENT qui a retenu ce notaire : il le reçoit
  # derrière son propre jeton, jamais sur la place publique.
  Scénario: le carnet public ne dit pas QUI a retenu, seulement que la date est prise — art. 37
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Alors le carnet du mois "2026-08" ne nomme aucune étude
    Et le carnet du mois "2026-08" dit seulement que la date est prise
    Quand le client consulte son offre
    Alors le client, lui, voit l'étude "Étude notaire@exemple.ca" qui a retenu son offre
