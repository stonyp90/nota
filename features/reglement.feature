# language: fr
Fonctionnalité: Règlement de l'acte — deux lignes, et le notaire garde les siennes
  Le client paie À LA SIGNATURE (ADR 0015), et depuis l'ADR 0031 il paie DEUX
  lignes distinctes : les honoraires offerts au notaire, et le prix du service
  de Nota. Depuis l'ADR 0034 ce prix est une GRILLE — 249 $ pour un
  refinancement, plus la garantie de date du palier (100 $ à échéance
  prioritaire), soit 349 $ ici. Il dépend du SERVICE et du DÉLAI, deux
  dimensions publiées, et de rien qui touche au notaire : ni sa cote, ni son
  historique, ni la valeur de l'acte. La carte du client autorise le TOTAL des
  deux ; la capture, à la signature, est PARTIELLE et porte exactement le
  règlement.

  Le notaire reçoit 100 % du montant qui lui a été offert. Ce n'est pas une
  générosité, c'est un mur : l'art. 32.1 2° de la Loi sur le notariat présume
  usurper les fonctions de notaire l'intermédiaire qui « obtient d'un notaire
  qu'il abandonne une partie de ses honoraires et frais », et l'art. 32 du Code
  de déontologie interdit au notaire la même opération prise par l'autre bout —
  partager ses honoraires avec un non-membre d'un ordre professionnel.

  Le registre ACT# est write-once : la valeur d'acte est bornée avant d'y
  entrer, et compléter deux fois ne paie qu'une fois. L'évaluation du client
  s'ouvre seulement une fois l'acte réglé (ADR 0021). L'horloge est figée au
  2026-08-12.

  Contexte:
    Étant donné un notaire actif "notaire@exemple.ca"
    Et la facturation Stripe est configurée
    Et le notaire "notaire@exemple.ca" est connecté à Stripe
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 3 jours
    Et la caution du client est autorisée
    Et le notaire "notaire@exemple.ca" retient l'offre

  Scénario: la carte autorise les deux lignes — l'offre du notaire ET le prix de Nota
    Alors la carte du client est bloquée pour 3149 $

  Scénario: l'acte complété capture les deux lignes, et le notaire garde les siennes
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Alors la réponse a le statut 200
    Et la capture porte 3149 $
    Et le notaire reçoit 2800 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 349 $
    Et le notaire "notaire@exemple.ca" reçoit le courriel "acte payé"

  # ART. 32.1 2° L.N. — « obtient d'un notaire qu'il abandonne une partie de ses
  # honoraires et frais ». Le blocage a été posé sur l'OFFRE ; le règlement est
  # prix sur la valeur DÉCLARÉE de l'acte, que le notaire peut fixer plus bas
  # (le domaine tolère 0,25×). Capturer le blocage entier tout en virant le net
  # inférieur laisserait la différence chez Nota — et cette différence est une
  # part des honoraires du notaire.
  Scénario: la capture ne prend jamais plus que le règlement — l'écart retourne au client
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2000
    Alors la réponse a le statut 200
    Et la carte du client est bloquée pour 3149 $
    Et la capture porte 2349 $
    Et le notaire reçoit 2000 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 349 $
    Et l'écart de 800 $ entre le blocage et le règlement ne reste pas chez Nota

  # Le même mur, pris par l'autre bout : un acte qui vaut plus cher ne fait pas
  # monter le prix de Nota d'un cent. Un prix indexé sur la valeur de l'acte
  # SERAIT une part des honoraires, quel que soit le nom qu'on lui donne.
  Scénario: le prix de Nota ne bouge pas avec la valeur de l'acte
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 5600
    Alors la réponse a le statut 200
    Et la capture porte 5949 $
    Et le notaire reçoit 5600 $ — la totalité du montant offert
    Et Nota ne garde que son prix : 349 $

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

  # Le relevé est une pièce écrite par Nota. Y présenter son prix comme une part
  # des honoraires décrirait l'opération que l'art. 32 C.déont. interdit au
  # notaire — Nota fabriquerait elle-même la preuve de l'infraction.
  Scénario: le relevé du notaire porte deux lignes, et jamais un taux
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le notaire "notaire@exemple.ca" consulte son relevé
    Alors le relevé porte 1 acte
    Et la ligne du relevé montre 2800 $ d'honoraires et 349 $ pour Nota
    Et aucune ligne du relevé ne porte de taux ni de cote

  Scénario: le client voit ce qu'il a payé, ligne par ligne
    Quand le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Et le client consulte son offre
    Alors le client voit son acte réglé en deux lignes : 2800 $ et 349 $, soit 3149 $

  Scénario: le client évalue son notaire une fois l'acte réglé
    Étant donné le notaire "notaire@exemple.ca" marque l'acte complété à 2800
    Quand le client évalue le notaire à 5 avec le commentaire "Impeccable, merci."
    Alors la réponse a le statut 201
    Et la note publique du notaire "notaire@exemple.ca" est 5.0 sur 1 avis

  Scénario: pas d'évaluation avant le règlement — l'acte signé ouvre la porte
    Quand le client évalue le notaire à 5 avec le commentaire "Trop tôt."
    Alors la réponse a le statut 409
    Et la réponse contient le code d'erreur "acte_non_complete"
