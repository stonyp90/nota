# Vérification juridique du 5 septembre 2026 : prix annoncé, prix variable, frais

Question posée par le propriétaire : « sommes-nous corrects légalement ? »,
après deux propositions du même jour, faire varier le prix de Nota selon des
paramètres, et le cacher au client tout en le montrant au notaire.

Textes relus à la source ce jour, et non depuis des résumés :

- Loi sur la protection du consommateur (P-40.1), art. 11.4, 12, 13, 224 c),
  225, 228, texte de legisquebec.gouv.qc.ca.
- Loi sur la concurrence (L.R.C. 1985, ch. C-34), art. 74.01 (1.1), texte de
  laws-lois.justice.gc.ca.
- Loi sur la protection des renseignements personnels dans le secteur privé
  (P-39.1), art. 12.1, texte de legisquebec.gouv.qc.ca.
- Code de déontologie des notaires, art. 49, 68, 71, 72, et Loi sur le
  notariat, art. 32.1, depuis `code-deontologie-notaires-texte-officiel.md`.
- Code civil, art. 2125 et 2129, cités par renvoi de l'art. 11.4 LPC, non
  relus à la source ce jour.

Ce document n'est pas un avis juridique. L'avis écrit demandé par l'ADR 0031
reste requis, et les points 1 et 2 ci-dessous devraient lui être soumis en
premier.

## Ce qui tient

| Point | Règle | État |
| --- | --- | --- |
| Deux lignes, le notaire reçoit 100 % de l'offre | Art. 32.1 2° L.N., art. 32 C.déont. | Tient, testé |
| Le prix de Nota ne dépend ni du notaire, ni de sa cote, ni de la valeur de l'acte | Art. 29.1 C.déont. | Tient, la signature `prixNota(serviceId, tierId, grille)` est gardée par un test d'arité |
| Garantie de date distincte de la prime d'urgence du notaire | Art. 49 4° C.déont. | Tient, deux lignes sur le devis |
| Aucune cote ni avis publié sur un notaire nommé | Art. 70 C.déont. | Tient (ADR 0030) |
| Aucun « moins cher », aucune réduction promise | Art. 32.1 1° L.N. | Tient, gardé par `truthful-claims` |
| Rien n'est facturé au notaire, rien ne lui est offert | Art. 33 C.déont. | Tient |
| Le devis est figé à l'autorisation et rejoué au règlement | Art. 12 LPC (montant précis au contrat), art. 224 c) LPC | Tient (ADR 0034, `prixNotaFige`) |
| Taxes et débours dits « en sus » | Art. 71 3° C.déont. | Tient pour la mention, pas pour le montant |

## Ce qui ne tient pas, ou pas encore

### 1. Le « à partir de 2 000 $ » est un prix partiel

L'art. 224 c) LPC interdit d'exiger un prix supérieur à celui annoncé, et
précise que « le prix annoncé doit comprendre le total des sommes que le
consommateur devra débourser pour l'obtention du bien ou du service », taxes
de vente exceptées, et que « le prix annoncé doit ressortir de façon plus
évidente que les sommes dont il est composé ». L'art. 74.01 (1.1) de la Loi
sur la concurrence dit la même chose au fédéral : « l'indication d'un prix qui
n'est pas atteignable en raison de frais obligatoires fixes qui s'y ajoutent
constitue une indication fausse ou trompeuse », sauf les montants imposés par
une loi. Le Bureau de la concurrence a sanctionné Cineplex en 2024 sur ce seul
fondement.

Trois surfaces annoncent aujourd'hui le plancher des honoraires seul :

- les lignes du pouls du carnet (`app.js`, `renderPulse`, « à partir de
  2 000 $ »),
- les options du sélecteur d'acte (« Refinancement hypothécaire, à partir de
  2 000 $ »),
- le libellé accessible des mêmes lignes.

Un client ne peut pas obtenir un refinancement par Nota à 2 000 $ : la ligne
de service de 249 $ est un frais obligatoire fixe. Le prix annoncé doit donc
être 2 249 $ (et 1 999 $ pour le financement), plus évident que ses
composantes, taxes en sus. Les débours peuvent rester en sus s'ils sont des
droits imposés par une loi (droits de publication, RDPRM) et nommés comme tels.
La ligne du héros, « le service Nota, à partir de 199 $ », est exacte pour ce
qu'elle annonce et peut rester.

**Correctif** : une fonction unique du domaine qui rend le « à partir de »
tout compris (plancher d'honoraires + prix de Nota au palier standard), et
les trois surfaces qui la lisent. Un test qui interdit qu'un `prixDepart` soit
affiché seul comme prix.

**Fait le jour même, ADR 0042.** `prixAnnonce()` dans le domaine, les trois
surfaces et le JSON-LD le lisent, `truthful-claims` garde la porte.

### 2. Les frais d'annulation à pourcentage fixé d'avance

L'art. 13 LPC interdit « la stipulation qui impose au consommateur, dans le
cas de l'inexécution de son obligation, le paiement de frais, de pénalités ou
de dommages, dont le montant ou le pourcentage est fixé à l'avance dans le
contrat, autres que l'intérêt couru ». L'art. 11.4 interdit toute clause qui
exclut les art. 2125 et 2129 du Code civil, qui donnent au client le droit de
résilier un contrat de service et fixent ce qu'il doit alors : les frais et
dépenses réels, la valeur des travaux exécutés, jamais un pourcentage convenu
d'avance.

Les bandes de 30 % (3 jours ou moins) et 10 % (4 à 14 jours) des ADR 0023 et
0033 sont exactement une telle stipulation, et les conditions client notent
elles-mêmes que le client « ne le découvre qu'au moment d'annuler », ce que
l'art. 12 LPC interdit aussi (aucuns frais sans montant précis au contrat).
Que les frais soient versés au notaire ne change pas la nature de la clause.

**Correctif** : remplacer le pourcentage par ce que l'art. 2129 permet, une
indemnité que le notaire justifie (temps engagé, journée bloquée, débours
avancés), plafonnée, affichée avant l'engagement et inscrite au contrat. La
capture partielle reste le bon mécanisme, le barème fixe ne l'est pas. À
soumettre à l'avis juridique avant le premier acte réel.

**Fait le jour même, ADR 0041.** Le barème est devenu un plafond, le notaire
réclame et justifie dans un délai, rien n'est prélevé sans réclamation, le
devis et les conditions le disent avant l'engagement.

### 3. Un prix variable selon des paramètres

Licite, à deux conditions :

- **Le total est annoncé avant l'engagement et c'est lui qui est facturé**
  (art. 224 c) LPC, art. 12 LPC). Un prix qui bouge entre deux visites est
  permis. Un prix qui bouge après le devis ne l'est pas. Le devis figé le
  garantit déjà.
- **Aucun paramètre ne touche au notaire** (art. 29.1 C.déont., ADR 0031 et
  0034). Service, préavis, lieu de signature, complexité du dossier, tension
  du marché sur la date, région : oui. Cote, historique, volume du notaire,
  valeur de l'acte : non.

### 4. Cacher le prix au client, ou cacher la formule

Cacher le **prix** de Nota au client n'est pas possible : art. 224 c) (le
total), art. 228 (ne pas passer sous silence un fait important), art. 12 (le
montant précis au contrat), et art. 74.01 (1.1) C-34. Un total où la part de
Nota serait invisible ferait en plus de Nota le vendeur de l'acte notarié, ce
que l'art. 32.1 L.N. présume être une usurpation.

Cacher la **formule** est possible seulement en partie. L'art. 12.1 de la loi
P-39.1 (Loi 25) s'applique dès qu'une décision « fondée exclusivement sur un
traitement automatisé » de renseignements personnels est rendue : le prix
calculé depuis les réponses du client en est une. Nota doit alors informer la
personne au plus tard au moment de la décision, et lui donner sur demande
« les raisons, ainsi que les principaux facteurs et paramètres, ayant mené à
la décision », avec la possibilité de faire réviser la décision par un
humain. La formule peut donc ne pas être affichée, elle ne peut pas être
secrète.

**Correctif, si le prix devient paramétrique** : une phrase au devis (« prix
calculé automatiquement à partir de vos réponses, détail sur demande »), une
porte de support qui rend les facteurs, et un humain qui peut réviser.

### 5. Payer le notaire directement : un mur en remplace un autre

Le relevé du 5 septembre recommandait la structure de Notairo (le client paie
à Nota son service, les honoraires vont au notaire). Correction : cette
structure éteint le risque de qualification des honoraires encaissés hors
fidéicommis, mais elle expose l'art. 32.1 3° L.N., qui présume usurper
l'intermédiaire qui procure des services « sans aucune responsabilité de sa
part envers le notaire pour ses honoraires et frais ». L'ADR 0031 avait choisi
d'assumer cette responsabilité, et c'est pour cela que Nota encaisse.

La forme qui tient les deux bouts : les honoraires payés au notaire, et Nota
qui garde une responsabilité réelle envers lui, par exemple la garantie de
paiement posée sur la carte du client (ADR 0035) et déclenchée si le client ne
paie pas à la signature. À trancher par l'avis juridique, avec les deux
articles côte à côte.

### 6. Le plancher et les multiplicateurs

Le plancher de 2 000 $ et la prime pré-remplie jusqu'à ×4 sont des règles de
produit de Nota, pas une entente entre notaires. Deux réserves demeurent : un
notaire qui accepte 8 000 $ pour un refinancement le jour même doit pouvoir le
justifier au titre de l'art. 49 (honoraires « justes et raisonnables »,
« célérité exceptionnelle » en 4°), et un plancher au-dessus du marché lu de
l'extérieur ressemble à un prix minimum. Aucun texte ne l'interdit en soi,
mais c'est une raison de plus de rapprocher le plancher du marché.

## Ordre des correctifs

1. Le « à partir de » tout compris (point 1) : **fait, ADR 0042**.
2. Les frais d'annulation (point 2) : **fait, ADR 0041**. Reste à confirmer
   par l'avis juridique.
3. Si le prix devient paramétrique (points 3 et 4) : l'ADR 0039 porte les
   dimensions publiées et la mention Loi 25.
4. Le rail de paiement (point 5) : la question à poser en premier à l'avis
   juridique, art. 32.1 3° et comptabilité en fidéicommis côte à côte.
