# language: fr
Fonctionnalité: Cohérence des calendriers et des espaces client et notaire
  Ces scénarios exercent les API Nota et les abonnements ICS existants.
  Ils ne constituent pas une validation de la synchronisation OAuth Google/Outlook.

  Contexte:
    Étant donné un notaire actif "agenda@exemple.ca"
    Et un notaire actif "autre-agenda@exemple.ca"
    Et un client publie une offre avec le prêteur "desjardins" à 2500 dans 8 jours

  Scénario: La publication est visible au notaire et au calendrier public
    Alors le fil du notaire "agenda@exemple.ca" nomme le prêteur "Desjardins"
    Et le calendrier public contient cette offre une fois
    Et le client voit le statut "ouverte" sans notaire

  Scénario: La rétention arrive dans les deux espaces et dans le calendrier privé
    Quand le notaire "agenda@exemple.ca" retient l'offre
    Alors le client voit le statut "retenue" avec le notaire "agenda@exemple.ca"
    Et le calendrier privé de "agenda@exemple.ca" contient cette offre une fois
    Et le calendrier privé de "autre-agenda@exemple.ca" ne contient pas cette offre
    Et le calendrier public contient cette offre une fois
    Et le client "client@exemple.ca" reçoit le courriel "offre retenue"

  Scénario: L'annulation client libère le calendrier du notaire
    Étant donné le notaire "agenda@exemple.ca" retient l'offre
    Quand le client annule son offre
    Alors la réponse a le statut 200
    Et le client voit le statut "annulee" sans notaire
    Et le calendrier privé de "agenda@exemple.ca" ne contient pas cette offre
    Et le calendrier public ne contient pas cette offre

  Scénario: Le désistement remet l'offre à disposition des autres notaires
    Étant donné le notaire "agenda@exemple.ca" retient l'offre
    Quand le notaire "agenda@exemple.ca" se désiste avec le motif "Indisponibilité imprévue."
    Alors la réponse a le statut 200
    Et le client voit le statut "ouverte" sans notaire
    Et le calendrier privé de "agenda@exemple.ca" ne contient pas cette offre
    Et le fil du notaire "autre-agenda@exemple.ca" nomme le prêteur "Desjardins"

  Plan du scénario: Un pointeur périmé ne maintient pas une signature dans un calendrier privé
    Étant donné le notaire "agenda@exemple.ca" retient l'offre
    Quand le pointeur du calendrier subsiste après "<changement>"
    Alors le calendrier privé de "agenda@exemple.ca" ne contient pas cette offre

    Exemples:
      | changement     |
      | annulation     |
      | désistement    |
      | réattribution  |
      | date modifiée  |
      | offre absente  |

  Scénario: Une panne de lecture ne ressemble pas à la suppression de toutes les signatures
    Étant donné le notaire "agenda@exemple.ca" retient l'offre
    Quand la lecture des offres du calendrier échoue
    Alors le calendrier privé de "agenda@exemple.ca" signale une indisponibilité temporaire
    Quand la lecture des offres du calendrier reprend
    Alors le calendrier privé de "agenda@exemple.ca" contient cette offre une fois

  Scénario: Le rejeu des pointeurs ne duplique pas les événements
    Étant donné le notaire "agenda@exemple.ca" retient l'offre
    Quand le calendrier retourne deux fois le même pointeur
    Alors le calendrier privé de "agenda@exemple.ca" contient cette offre une fois

  Scénario: Deux notaires ne peuvent pas retenir simultanément la même offre
    Quand les notaires "agenda@exemple.ca" et "autre-agenda@exemple.ca" retiennent simultanément l'offre
    Alors un seul notaire voit cette signature et le client voit ce même notaire
