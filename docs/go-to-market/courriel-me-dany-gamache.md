# Courriel d'introduction — Me Dany Gamache

**À :** dgamache@gamachenotaires.com
**Objet :** Référé par Antoine Leclerc — rencontre ?
**État :** brouillon Gmail, non envoyé

---

Bonjour Me Gamache,

Antoine Leclerc, mon associé de Stein Monast, m'a suggéré de vous écrire.

Je suis Anthony Paquet, entrepreneur et développeur logiciel. J'ai développé
Nota, une plateforme qui met en relation les clients et les notaires en fonction
de l'urgence du besoin. Le client publie gratuitement sa demande — service, date
souhaitée, secteur, montant offert. Les notaires inscrits consultent les
demandes qui correspondent à leurs disponibilités et peuvent accepter, faire une
contre-offre ou passer leur tour.

En une phrase : rééquilibrer l'offre et la demande des actes notariaux simples.

Publier ne coûte rien au client : il choisit une date et nomme son prix, à
partir d'un tarif de base propre à chaque acte, ajusté par quelques facteurs
objectifs. Plus l'échéance est courte, plus l'offre monte — jusqu'à un plafond
de cinq fois le tarif de départ, au-delà duquel Nota refuse la demande. C'est
précisément le facteur que nomme l'art. 49 (4°) : une célérité exceptionnelle.

Nota n'expose que des actes simples et bien cadrés — financement et
refinancement — et cible les notaires par code postal, selon le périmètre que
chacun accepte de desservir.

Un point d'emblée, parce que c'est la première question qui vient : les
honoraires demeurent entièrement les vôtres. Nota facture son propre service,
séparément, au client. C'est une contrainte de conception (art. 32 du Code de
déontologie, art. 32.1 de la Loi sur le notariat), pas une politique
commerciale.

À terme, je veux démontrer à la Chambre qu'un tel dossier peut se mener à
distance de bout en bout, en toute sécurité. C'est la phase deux — et c'est le
sujet sur lequel votre avis me serait le plus utile.

Je cherche quelques notaires partenaires pour en décider la forme avant
l'ouverture au public. Antoine a pensé à vous : avec Québec et la
Côte-de-Beaupré, vous couvrez déjà un territoire étendu — exactement là où le
hasard des appels coûte le plus cher.

Auriez-vous vingt minutes cette semaine ou la suivante ? Je me déplace à
Loretteville sans problème.

Bien à vous,

**Anthony Paquet**
Fondateur, Nota — rééquilibrer l'offre et la demande des actes notariaux simples
anthonypaquet.com

---

## Chiffres cités, vérifiés dans le code

| Affirmation | Source |
| --- | --- |
| Plafond de **cinq fois** le tarif de départ | `PREMIUM_CAP = 5`, appliqué client **et** serveur |
| Tarif de base refinancement **2 000 $** | `SERVICES.refinancement.prixDepart` |
| Tarif de base financement **1 800 $** | `SERVICES.financement.prixDepart` |
| Accepter / contre-offre / passer | routes `/notary/bids/{accept,propose,decline}` |
| Honoraires entiers au notaire | ADR 0031 — `honorairesCents` vs `prixNotaCents` |
| Ciblage par code postal | `prefixe` + `rayonKm` du profil notaire |

**Non cité volontairement** (matière à rencontre, pas à courriel) : succession
+400 $, prêteur privé +300 $, échelle de déplacement 0 → +400 $, tranches de
valeur du prêt 0/+150/+350/+600 $.
