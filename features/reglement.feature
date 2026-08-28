# language: fr
Fonctionnalité: Règlement de l'acte et évaluation du notaire
  Le client paie À LA SIGNATURE (ADR 0015) : la caution posée à la publication
  est capturée quand le notaire marque l'acte complété — Nota garde sa
  commission, le notaire reçoit le net. Le registre ACT# est write-once : la
  valeur d'acte est bornée avant d'y entrer, et compléter deux fois ne paie
  qu'une fois. L'évaluation du client s'ouvre seulement une fois l'acte réglé
  (ADR 0021). L'horloge est figée au 2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre

  Scénario: l'acte complété capture la caution, Nota garde 10 %, le notaire reçoit le net
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et la caution est capturée et le notaire reçoit 2520 $ net, Nota gardant 280 $
    Et le notaire "notaire@exemple.ca" reçoit le courriel "acte payé"

  Scénario: la valeur d'acte est bornée — un montant fou meurt avant le registre write-once
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 46004600
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "montant_hors_bornes"

  Scénario: seul le notaire qui a retenu l'acte peut le compléter
    Étant donné un notaire actif "intrus@exemple.ca"
    Quand le notaire "intrus@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 403
    Et la réponse contient le code d'erreur "acte_non_autorise"

  Scénario: compléter deux fois ne paie qu'une fois — le registre est write-once
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et la caution n'a été capturée qu'une seule fois

  Scénario: le client évalue son notaire une fois l'acte réglé
    Étant donné le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Quand le client évalue le notaire à 5 avec le commentaire "Impeccable, merci."
    Alors la réponse a le statut 201
    Et la note publique du notaire "notaire@exemple.ca" est 5.0 sur 1 avis

  Scénario: pas d'évaluation avant le règlement — l'acte signé ouvre la porte
    Quand le client évalue le notaire à 5 avec le commentaire "Trop tôt."
    Alors la réponse a le statut 409
    Et la réponse contient le code d'erreur "acte_non_complete"
