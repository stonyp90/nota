# language: fr
Fonctionnalité: Le prêteur hypothécaire — liste, nom libre et droit de refus du notaire
  Le prêteur qui accorde le prêt est une information du dossier : un notaire
  ne ferme qu'avec les institutions qu'il connaît, et un prêteur virtuel
  (sans succursale) est signalé pour la coordination qu'il demande — sans
  majorer le prix. Seul le prêteur privé garde sa majoration. Le catalogue
  des prêteurs vit dans le domaine ; chaque offre doit nommer le sien, et un
  prêteur absent de la liste est ajouté par son nom (« Autre prêteur »).
  Une fois l'acte retenu, client et notaire conversent dans Nota — et le
  notaire peut encore se désister si un détail rend le dossier impossible de
  son côté : l'offre revient alors au carnet telle que publiée.

  Scénario: le catalogue nomme les prêteurs habituels et signale les virtuels
    Alors le catalogue des prêteurs contient "banque_nationale" non virtuel
    Et le catalogue des prêteurs contient "desjardins" non virtuel
    Et le catalogue des prêteurs contient "tangerine" virtuel
    Et le catalogue des prêteurs contient "first_national" virtuel
    Et aucun prêteur du catalogue ne majore le prix, sauf le prêteur privé

  Scénario: une offre sans prêteur est refusée
    Étant donné le service "refinancement"
    Quand je valide une offre à 2500 $ sans nommer de prêteur
    Alors l'offre est refusée
    Et l'erreur "parametre_requis" est présente

  Scénario: choisir son prêteur ne coûte rien — sauf un prêteur privé
    Alors le prix de base "refinancement" avec le prêteur "desjardins" est 2000
    Et le prix de base "refinancement" avec le prêteur "tangerine" est 2000
    Et le prix de base "refinancement" avec le prêteur "prive" est 2300

  Scénario: « Autre prêteur » exige son nom
    Étant donné le service "refinancement"
    Quand je valide une offre à 2500 $ avec le prêteur "autre" sans nom
    Alors l'offre est refusée
    Et l'erreur "parametre_requis" est présente

  Scénario: le prêteur ajouté par le client est nommé dans le fil du notaire
    Étant donné un notaire actif "notaire@exemple.ca"
    Quand un client publie une offre avec le prêteur "autre" nommé "Fiducie Familiale Roy" à 2900 dans 8 jours
    Alors le fil du notaire "notaire@exemple.ca" nomme le prêteur "Fiducie Familiale Roy"

  Scénario: le notaire voit le prêteur de chaque demande de son fil
    Étant donné un notaire actif "notaire@exemple.ca"
    Quand un client publie une offre avec le prêteur "tangerine" à 2900 dans 8 jours
    Alors le fil du notaire "notaire@exemple.ca" nomme le prêteur "Tangerine" virtuel

  Scénario: la conversation s'ouvre à la rétention, dans les deux sens
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un client publie une offre avec le prêteur "tangerine" à 2900 dans 8 jours
    Quand le notaire "notaire@exemple.ca" retient l'offre
    Et le notaire "notaire@exemple.ca" écrit "Avez-vous les instructions du prêteur ?"
    Et le client répond "Oui, reçues hier."
    Alors la conversation de l'offre compte 2 messages

  Scénario: pas de conversation avant la rétention
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un client publie une offre avec le prêteur "desjardins" à 2500 dans 8 jours
    Quand le client répond "Bonjour ?"
    Alors la réponse a le statut 422
    Et la réponse contient le code d'erreur "offre_non_retenue"

  Scénario: le notaire se désiste après avoir retenu — l'offre revient au carnet
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un client publie une offre avec le prêteur "prive" à 3200 dans 8 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "notaire@exemple.ca" se désiste avec le motif "Prêteur privé hors de mes habitudes."
    Alors la réponse a le statut 200
    Et l'offre est revenue au carnet telle que publiée à 3200
    Et le notaire "notaire@exemple.ca" ne voit plus l'offre dans son fil

  Scénario: seul le notaire qui a retenu peut se désister
    Étant donné un notaire actif "notaire@exemple.ca"
    Et un notaire actif "autre@exemple.ca"
    Et un client publie une offre avec le prêteur "desjardins" à 2500 dans 8 jours
    Et le notaire "notaire@exemple.ca" retient l'offre
    Quand le notaire "autre@exemple.ca" se désiste avec le motif "Pas le mien."
    Alors la réponse a le statut 403
