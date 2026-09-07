# language: fr
Fonctionnalité: Annulation d'une offre et indemnité de dernière minute
  Annuler une offre encore ouverte est gratuit, le marché n'a rien promis.
  Annuler une offre RETENUE près de la date de signature n'encaisse RIEN
  (ADR 0041) : l'art. 13 de la Loi sur la protection du consommateur interdit
  toute pénalité au montant ou au pourcentage fixé d'avance, et l'art. 2129
  C.c.Q. ne doit au notaire que ses frais réels et la valeur du travail
  accompli. Le barème (ADR 0023) n'ouvre qu'un PLAFOND : le notaire réclame,
  en justifiant et dans un délai, ou renonce, et sans réclamation rien n'est
  prélevé. Une indemnité réclamée se capture sur la caution posée à la
  publication, le reste étant libéré. Le barème et le délai sont décidés par
  Nota depuis la console admin, jamais dans le code. Un acte signé et réglé ne
  s'annule plus du tout. L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée

  Scénario: annuler une offre encore ouverte est gratuit et libère la caution
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 2 jours
    Et la caution du client est autorisée
    Quand le client annule son offre
    Alors la réponse a le statut 200
    Et l'annulation est gratuite
    Et la caution du client est libérée
    Et l'offre n'apparaît plus dans le carnet du mois "2026-08"

  Scénario: annuler une offre retenue à trois jours ouvre un plafond de 30 %, et la réclamation justifiée du notaire se capture sur la caution
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors la réponse a le statut 200
    Et l'annulation ouvre une indemnité plafonnée à 30 % du montant, soit 840 $
    Et rien n'est prélevé et la caution reste en place
    Quand le notaire "notaire@exemple.ca" réclame une indemnité de 500 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Alors la réponse a le statut 200
    Et l'indemnité de 500 $ est perçue
    Et seule cette part est capturée sur la caution, le reste étant libéré par Stripe

  Scénario: renoncer à l'indemnité libère la caution sans rien prélever
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le notaire "notaire@exemple.ca" renonce à toute indemnité
    Alors la réponse a le statut 200
    Et l'indemnité est close sans prélèvement
    Et la caution du client est libérée

  Scénario: une réclamation au-dessus du plafond, ou sans justification, est refusée
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le notaire "notaire@exemple.ca" réclame une indemnité de 900 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "montant_au_dessus_du_plafond"
    Quand le notaire "notaire@exemple.ca" réclame une indemnité de 300 $ avec la justification "court"
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "justification_requise"
    Et aucune capture n'a eu lieu

  Plan du scénario: le plafond suit le barème — la dernière minute plafonne haut, l'avance est gratuite
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans <jours> jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation ouvre une indemnité plafonnée à <taux> % du montant, soit <plafond> $
    Et rien n'est prélevé et la caution reste en place

    Exemples:
      | jours | taux | plafond |
      | 0     | 30   | 600     |
      | 1     | 30   | 600     |
      | 3     | 30   | 600     |
      | 4     | 10   | 200     |
      | 14    | 10   | 200     |

  Scénario: à quinze jours l'annulation d'une offre retenue est gratuite — et la caution est enfin libérée
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 15 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation est gratuite
    Et la caution du client est libérée

  Scénario: le client voit le plafond AVANT de confirmer — la divulgation précède le geste
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Alors le client voit un plafond d'indemnité de 840 $ avant de confirmer

  Scénario: une offre encore ouverte n'annonce aucuns frais d'annulation
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Alors le client ne voit aucuns frais d'annulation avant de confirmer

  Scénario: annuler deux fois n'ouvre qu'une fenêtre, et réclamer deux fois ne capture qu'une fois
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 1 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le client annule son offre
    Alors la réponse a le statut 200
    Et l'annulation ouvre une indemnité plafonnée à 30 % du montant, soit 600 $
    Quand le notaire "notaire@exemple.ca" réclame une indemnité de 600 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Et le notaire "notaire@exemple.ca" réclame une indemnité de 600 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Alors la réponse a le statut 409
    Et la caution n'a été capturée qu'une seule fois

  Scénario: un acte signé et réglé ne s'annule plus
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 2 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe
    Et le notaire "notaire@exemple.ca" retient l'offre
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Quand le client annule son offre
    Alors la réponse a le statut 409
    Et la réponse contient le code d'erreur "acte_complete"
    Et l'offre est toujours retenue par "notaire@exemple.ca"

  Scénario: l'annulation d'une demande retenue avise le notaire, le client et l'opérateur
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors le client "client@exemple.ca" reçoit le courriel "offre annulée"
    Et le notaire "notaire@exemple.ca" reçoit le courriel "demande annulée par le client"
    Et l'opérateur reçoit le courriel "annulation d'une demande retenue"

  # ADR 0041 — tant que l'indemnité est à décider, l'acte reste sur la console du
  # notaire (c'est là qu'il réclame ou renonce). Il en sort à la décision.
  Scénario: l'offre annulée quitte le fil et l'agenda du notaire une fois l'indemnité décidée
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le notaire "notaire@exemple.ca" renonce à toute indemnité
    Alors le notaire "notaire@exemple.ca" ne voit plus l'offre dans son fil

  Scénario: une offre annulée sort du radar — plus aucun rappel ne part
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Quand le client annule son offre
    Et le planificateur de rappels s'exécute
    Alors le client "client@exemple.ca" ne reçoit aucun courriel "date approche"

  Scénario: le barème est une donnée décidée par Nota, pas une constante du code
    Étant donné le barème d'annulation stocké est:
      | maxJours | taux |
      | 5        | 0.5  |
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 5 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation ouvre une indemnité plafonnée à 50 % du montant, soit 1000 $

  Scénario: un barème vide rend l'annulation gratuite partout — le kill-switch est une donnée
    Étant donné le barème d'annulation stocké est vide
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2000 dans 0 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation est gratuite
    Et la caution du client est libérée

  Scénario: sans caution autorisée, aucuns frais — on ne facture jamais hors du consentement Stripe
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 0 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors l'annulation est gratuite
    Et aucune capture n'a eu lieu

  # ADR 0033 — l'indemnité dédommage le NOTAIRE dont la journée était réservée.
  # Nota n'en garde rien : art. 32.1 de la Loi sur le notariat et art. 32 du
  # Code de déontologie interdisent toute part des honoraires à un non-membre.
  Scénario: l'indemnité réclamée est versée au notaire — Nota n'en garde rien
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le notaire "notaire@exemple.ca" réclame une indemnité de 840 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Alors l'indemnité de 840 $ est perçue
    Et les frais de 840 $ sont virés en entier au notaire "notaire@exemple.ca"

  Scénario: sans versements Stripe branchés, l'indemnité réclamée est due au notaire
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Et le notaire "notaire@exemple.ca" réclame une indemnité de 840 $ avec la justification "Journée bloquée à l'agenda, dossier ouvert et recherches au registre faites."
    Alors l'indemnité de 840 $ est perçue
    Et les frais de 840 $ sont dus au notaire "notaire@exemple.ca", faute de versements Stripe branchés

  Scénario: un désistement est compté au dossier du notaire et l'opérateur est prévenu
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" se désiste
    Alors la réponse a le statut 200
    Et le désistement ne coûte rien au notaire "notaire@exemple.ca"
    Et le désistement est compté au dossier du notaire "notaire@exemple.ca"
    Et l'opérateur est prévenu du désistement

  @decision
  Scénario: la récompense de parrainage d'une offre annulée est récupérée
    # Décision produit en attente (audit 2026-08-27) : le registre EARN est
    # write-once par conception (ADR 0011) — récupérer un 50 $ déjà acquis
    # demande son propre ADR. Scénario documenté, exclu de l'exécution.
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors la récompense de parrainage de cette offre est reprise
