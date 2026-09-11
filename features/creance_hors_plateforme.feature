# language: fr
Fonctionnalité: Un règlement hors plateforme est une créance, jamais un encaissement
  ADR 0029. Quand la signature arrive sans caution vivante — carte enregistrée
  pour une date lointaine, autorisation expirée, blocage refusé — Nota n'a rien
  à capturer : ni client Stripe, ni moyen de paiement, ni autorisation. Le
  client a payé le notaire DIRECTEMENT, et la seule écriture honnête est une
  CRÉANCE : le prix du service de Nota est inscrit comme DÛ par le notaire.

  Avant le 1er septembre 2026 ce chemin appelait quand même Stripe, avec une
  intention de paiement sans moyen de paiement et sans confirmation : aucun
  dollar ne bougeait, et pourtant le registre, le cumul des sommes encaissées
  et le courriel « Acte payé » affirmaient tous les trois le contraire. Un
  registre qui atteste un paiement que personne n'a fait est pire qu'une
  facture impayée.

  Ces scénarios tiennent donc deux choses à la fois : ce qui est ÉCRIT (réglé,
  non payé, un montant dû) et ce qui a BOUGÉ (rien). L'horloge est figée au
  2026-08-12, et le prix du service « refinancement » à échéance normale est
  de 279 $.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe

  Scénario: un acte signé sans caution vivante s'inscrit réglé, non payé, et zéro dollar ne bouge
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et l'acte est inscrit réglé mais NON payé, avec 279 $ dus à Nota
    Et aucun dollar n'a bougé : ni capture, ni virement, ni frais prélevés
    Et la réponse ne prétend nulle part que l'acte a été payé

  Scénario: la créance suit le notaire, et le cumul des sommes encaissées ne bouge pas
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors le notaire "notaire@exemple.ca" doit 279 $ à Nota
    Et le cumul des sommes réellement encaissées par Nota reste à 0 $
    Et la console de Nota totalise 279 $ de créances

  Scénario: le relevé du notaire dit « à percevoir », et aucun courriel n'annonce un acte payé
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors le relevé du notaire "notaire@exemple.ca" porte 1 acte réglé hors plateforme, 279 $ à percevoir
    Et le notaire "notaire@exemple.ca" ne reçoit aucun relevé « Acte payé »

  Scénario: la piste d'audit du règlement écrit « dû », jamais « encaissé »
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la trace du règlement porte 2800 $ d'honoraires, 279 $ pour Nota, et la mention « non payé » avec 279 $ dus

  Scénario: régler deux fois le même acte n'inscrit qu'une seule créance
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 30 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et le notaire "notaire@exemple.ca" doit 279 $ à Nota
    Et la trace du règlement n'a été écrite qu'une seule fois

  Scénario: avec une caution vivante, l'argent bouge pour de vrai et aucune créance ne naît
    Étant donné un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 2 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et la capture porte 3378 $
    Et le notaire reçoit 2800 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 578 $
    Et le notaire "notaire@exemple.ca" doit 0 $ à Nota
