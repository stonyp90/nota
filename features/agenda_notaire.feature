# language: fr
Fonctionnalité: L'agenda du notaire, le rythme de ses alertes et son registre d'évaluations
  Le notaire ne travaille pas avec une liste : il travaille avec des JOURNÉES.
  Son fil se lit donc par date (ADR 0019/0020) — une seule lecture, les jours
  du plus proche au plus lointain, la meilleure demande en tête de sa journée —
  et le détail d'une demande ne s'ouvre qu'à celui qui l'a retenue.

  « Recevez vos demandes à votre rythme » (ADR 0033 §7) est une donnée du
  serveur, pas une phrase d'écran : le rythme réglé depuis la console décide
  vraiment de ce qui parvient au notaire, tout de suite ou dans le digest.

  Et le registre des évaluations appartient au notaire (ADR 0021) : c'est SA
  feuille de route, elle lui revient en entier — jamais à un autre notaire, et
  jamais au client, à qui l'art. 70 du Code de déontologie interdit qu'on
  montre la moindre appréciation (ADR 0030).

  L'horloge est figée au 2026-08-12, un MERCREDI.

  Contexte:
    Étant donné un notaire actif "agenda@etude.ca"

  Scénario: L'agenda se lit par date, en une seule passe
    Étant donné un client publie une demande de 2400 $ dans 8 jours
    Et un client publie une demande de 2900 $ dans 8 jours
    Et un client publie une demande de 2100 $ dans 12 jours
    Quand le notaire "agenda@etude.ca" lit son agenda une seule fois
    Alors son agenda porte 2 journées, de la plus proche à la plus lointaine
    Et la journée dans 8 jours porte 2 demandes pour un total de 5300 $
    Et la meilleure demande de la journée dans 8 jours est celle de 2900 $
    Et la journée dans 12 jours porte 1 demande pour un total de 2100 $

  # ADR 0010 §4 — rien du client ne voyage avant la rétention, et le dossier
  # s'ouvre au notaire qui a retenu, à lui seul.
  Scénario: Le fil ouvert ne divulgue rien du client ; le dossier ne s'ouvre qu'au notaire qui retient
    Étant donné un notaire actif "voisin@etude.ca"
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2500 dans 10 jours
    Quand le notaire "agenda@etude.ca" lit son agenda une seule fois
    Alors aucune demande de son agenda ne porte le courriel ni le dossier du client
    Et le dossier de la demande est refusé au notaire "agenda@etude.ca"
    Quand le notaire "agenda@etude.ca" retient l'offre
    Alors le dossier de la demande nomme le client au notaire "agenda@etude.ca"
    Et le dossier de la demande est refusé au notaire "voisin@etude.ca"

  # Le rythme est un catalogue fermé de quatre mots : ce qui n'en fait pas
  # partie est refusé à la porte d'écriture, avec un code typé.
  Scénario: Le rythme d'alerte est un catalogue fermé
    Alors les rythmes d'alerte offerts sont "instant, daily, weekly, off"
    Et régler ses alertes sur "hourly" est refusé au notaire "agenda@etude.ca"

  # Le mercredi 2026-08-12 n'est pas un lundi : le rythme « weekly » ne parle
  # donc pas aujourd'hui — et c'est exactement ce que « à votre rythme » promet.
  Plan du scénario: Le rythme réglé depuis la console décide de ce qui parvient au notaire
    Étant donné le notaire "agenda@etude.ca" règle ses alertes sur "<rythme>" depuis sa console
    Quand un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2500 dans 10 jours
    Alors le notaire "agenda@etude.ca" a reçu <immediat> avis de nouvelle demande
    Quand la demande a été publiée hier
    Et le planificateur de rappels s'exécute
    Alors le notaire "agenda@etude.ca" a reçu <digest> digest du carnet

    Exemples:
      | rythme  | immediat | digest |
      | instant | 1        | 0      |
      | daily   | 0        | 1      |
      | weekly  | 0        | 0      |
      | off     | 0        | 0      |

  # ADR 0021 — la feuille de route appartient au notaire ; ADR 0030 — elle ne
  # se publie pas.
  Scénario: Le registre d'évaluations revient au notaire, et rien n'en parvient au client
    Étant donné la facturation Stripe est configurée
    Et un notaire actif "voisin@etude.ca"
    Et un client publie une offre avec le courriel "client@exemple.ca" pour "refinancement" à 2800 dans 10 jours
    Et la caution du client est autorisée
    Et le notaire "agenda@etude.ca" est connecté à Stripe
    Et le notaire "agenda@etude.ca" retient l'offre
    Et le notaire "agenda@etude.ca" marque l'acte complété à 2800
    Quand le client évalue le notaire à 5 avec le commentaire "Signé à l'heure, tout expliqué."
    Alors le notaire "agenda@etude.ca" lit 1 évaluation notée 5 portant "Signé à l'heure, tout expliqué."
    Et la moyenne du notaire "agenda@etude.ca" est de 5 sur 1 avis
    Et le notaire "voisin@etude.ca" ne lit aucune évaluation
    Quand le client consulte son offre
    Alors rien de la cote ni des évaluations du notaire ne parvient au client
    Et le client ne lit du notaire que des faits vérifiables

  Scénario: Lire tous les paramètres de l’offre avant de la retenir
    Étant donné un client publie une demande de 2400 $ dans 8 jours
    Quand le notaire "agenda@etude.ca" lit son agenda une seule fois
    Alors les paramètres de son offre montrent le prêt et les réponses sans complexité
    Et aucune demande de son agenda ne porte le courriel ni le dossier du client
