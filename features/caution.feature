# language: fr
Fonctionnalité: La caution tient jusqu'à la signature
  Une autorisation de carte Stripe vit environ 7 jours. Le palier « standard »
  du carnet, lui, commence à 15 jours : sur la majorité des dates publiées, une
  caution posée à la publication mourait avant la signature, et le notaire qui
  avait bloqué sa journée se retrouvait sans garantie — sans que personne ne
  soit prévenu.

  L'ADR 0035 sépare les deux gestes. À la publication, la carte du client est
  ENREGISTRÉE : la banque la valide, rien n'est réservé, et l'offre ne paraît au
  carnet qu'une fois cette validation faite. Deux jours avant la signature, le
  geste quotidien de Nota pose la caution hors session — assez tard pour qu'elle
  vive jusqu'à l'acte, assez tôt pour qu'un refus laisse le temps de réagir.

  Ce qui garantit le paiement du notaire tient donc en trois faits : aucune
  offre visible sans carte validée, une caution vivante à la signature, et un
  refus qui prévient les deux parties deux jours d'avance sans jamais lui
  retirer le dossier. L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe

  Scénario: une date lointaine enregistre la carte, elle ne bloque rien
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 30 jours
    Alors la réponse a le statut 201
    Et la carte du client est enregistrée, sans qu'aucune somme soit bloquée
    Et le montant porté à la carte du client est 2400 $

  # L'offre reste PENDING tant que le client n'a pas donné sa carte : un notaire
  # ne voit jamais une demande dont la banque n'a rien validé.
  Scénario: une offre sans carte reste invisible au carnet
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 30 jours
    Alors le carnet public du mois "2026-09" ne montre aucune offre
    Quand le client donne sa carte
    Alors le carnet public du mois "2026-09" montre 1 offre
    Et le client "client@exemple.ca" reçoit le courriel "carte enregistrée"

  Scénario: le geste quotidien pose la caution deux jours avant la signature
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 2 jours
    Et le client donne sa carte
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le planificateur de rappels s'exécute
    Alors la carte du client est bloquée pour 2400 $
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2000
    Alors la capture porte 2400 $
    Et le notaire reçoit 2000 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 400 $

  Scénario: trop tôt, la caution n'est pas posée — elle pourrirait avant l'acte
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 20 jours
    Et le client donne sa carte
    Quand le planificateur de rappels s'exécute
    Alors aucune caution n'est posée

  # Le refus est un fait d'exploitation, pas une panne : le lot de rappels ne
  # tombe pas, et les deux parties l'apprennent deux jours avant la date.
  Scénario: une carte refusée à J-2 prévient les deux parties et ne retire pas l'acte au notaire
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 2 jours
    Et le client donne sa carte
    Et le notaire "notaire@exemple.ca" retient l'offre
    Et la banque du client refuse la carte
    Quand le planificateur de rappels s'exécute
    Alors aucune caution n'est posée
    Et le client "client@exemple.ca" reçoit le courriel "carte refusée"
    Et le notaire "notaire@exemple.ca" reçoit le courriel "caution non posée"
    Et l'offre reste confiée au notaire "notaire@exemple.ca"

  # ADR 0023 + 0033 — le barème ne devient pas gratuit parce que la caution
  # n'est pas encore posée : les frais sont prélevés hors session sur la carte
  # enregistrée, et versés AU NOTAIRE.
  Scénario: annuler à 10 jours prélève quand même les frais, et le notaire les reçoit
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 10 jours
    Et le client donne sa carte
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation retient 10 % du montant, soit 200 $
    Et les frais sont prélevés hors session sur la carte enregistrée
    Et les frais de 200 $ sont virés en entier au notaire "notaire@exemple.ca"
