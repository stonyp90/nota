# Nota — Sommaire exécutif du plan d’affaires

Contact : **info@gonota.ca**

Le plan complet en anglais est dans [`docs/business-plan.md`](business-plan.md). Le modèle financier reproductible est dans [`docs/planning/business-plan-model.json`](planning/business-plan-model.json) et la revue des corrections dans [`docs/planning/business-plan-review-2026-09-09.md`](planning/business-plan-review-2026-09-09.md).

## Proposition

Nota met en relation un client qui doit signer un acte notarié à une date donnée avec un notaire qui dispose d’une capacité adaptée. Le client décrit le service, la date, les faits utiles et les honoraires professionnels proposés. Le notaire peut retenir la demande, contre-proposer, demander des renseignements ou passer sans publier son agenda privé.

**Nota est une infrastructure de capacité pour les notaires, pas un remplacement des notaires.** Notre promesse est explicite : Nota ne cherche pas à briser la profession ni à supprimer des emplois de notaire. Nous réparons un marché déséquilibré où des clients avec une échéance trouvent difficilement un professionnel disponible, pendant que des notaires perdent de la capacité dans la découverte fragmentée, les plages vides et la préparation répétitive. Nota structure la demande qualifiée, rend la capacité disponible plus utile et laisse au notaire le jugement professionnel, le conseil au client et l’acte. Les causes précises du manque d’offre et la taille de la demande additionnelle restent des questions de validation, mesurées cohorte par cohorte.

La future couche dotée de modèles propriétaires suit la même limite. Sa cible est d’automatiser jusqu’à 80 % de l’accueil, des vérifications et de l’assemblage répétitifs validés, sous la revue du notaire, afin qu’une étude puisse accepter davantage de demandes qualifiées, augmenter son potentiel de revenu et contribuer à rétablir l’offre. Il s’agit d’un outil entre les mains du notaire, jamais d’un substitut à son jugement juridique indépendant. La cible sera mesurée par type d’acte, revue par des notaires et déployée seulement avec les contrôles juridiques, de sécurité et de qualité requis.

**Boucle d’amélioration et participation notariale.** Pour les actes notariaux simples pris en charge, les modèles de Nota peuvent s’améliorer dynamiquement à partir de signaux d’utilisation permis et agrégés, ainsi que des commentaires structurés des notaires. Les questions des utilisateurs, les corrections, les abandons et les étapes acceptées ou rejetées alimentent des versions évaluées par type d’acte. Il ne s’agit pas d’un apprentissage en direct qui modifierait silencieusement un dossier ou un modèle pendant son utilisation. Chaque évolution doit franchir des contrôles de confidentialité, de sécurité, de qualité, de revue notariale et de retour arrière. Aucun dossier client identifiable ne devient par défaut une donnée d’entraînement et aucun modèle ne remplace le jugement professionnel.

Les signaux de comportement servent à améliorer l’ordre des questions, la clarté et le guidage. Ils ne servent pas à tirer une conclusion juridique ni à étiqueter un fait légal. Les changements de modèle sont préparés hors ligne, testés sur des cas réservés et approuvés avant toute mise en production.

Un notaire qui contribue des commentaires, des cas limites ou du temps d’évaluation peut recevoir un **instrument potentiel d’equity**, selon des modalités écrites et sous réserve des avis juridiques, professionnels et financiers requis. Un notaire qui préfère ne pas contribuer directement peut utiliser la couche de modèles avec un **abonnement logiciel mensuel**. L’objectif est partagé : le client obtient des prochaines étapes plus claires, le notaire dispose d’un outil qui augmente sa capacité potentielle et Nota améliore le produit avec des preuves réelles. La participation demeure volontaire et ne transfère jamais la responsabilité juridique du notaire à Nota.

Le lancement commercial proposé demeure concentré sur le **financement et le refinancement hypothécaires dans la région de Québec**. Le code actuel comprend aussi le testament et la procuration; leur demande, leur tarification et leur validation professionnelle sont traitées séparément et ne financent pas le scénario de lancement.

Nota facture au client ses propres frais de service et de date, affichés séparément des honoraires professionnels. Le notaire doit recevoir les honoraires convenus en entier selon la structure de règlement actuelle. Cette structure n’est pas un avis juridique : l’avis professionnel, les taxes, les contrats, les paiements en production et les contrôles d’exploitation restent des conditions de lancement.

**Monétisation future des modèles propriétaires.** Après une validation par des notaires sur des cas réservés par type d’acte et la fermeture des conditions commerciales et professionnelles, Nota pourra offrir une version dotée de ses modèles propriétaires contre un abonnement logiciel ou des frais d’utilisation distincts. Un notaire collaborateur pourra aussi être admissible à un instrument potentiel d’equity en échange d’une contribution structurée, sans garantie de valeur et sous réserve des modalités écrites et des avis requis. Cette couche ne vise pas à enlever les notaires. La cible est d’automatiser jusqu’à 80 % de l’accueil répétitif, des vérifications et de l’assemblage du dossier, tout en laissant au notaire son jugement juridique indépendant. Un notaire pourra ainsi traiter davantage de demandes qualifiées, augmenter sa capacité de revenu potentiel et contribuer à réparer le manque d’offre actuel. Le revenu réel dépendra toutefois de la demande, des actes acceptés et complétés, des coûts et des contrats finaux.

## Ce que les preuves permettent de dire

- Le produit public, l’API, les tests, l’administration, les flux Stripe de test et une répétition de salle de signature sont documentés.
- Les paiements réels en production ne sont pas encore établis : les secrets sont préparés, mais l’activation, les versements bancaires, les reprises d’erreur et la marque du marchand restent à vérifier.
- Les inscriptions fiscales de l’opérateur sont documentées, mais le calcul et la perception ne sont pas encore implémentés et la responsabilité fiscale des honoraires du notaire doit être tranchée.
- L’évaluation IA en direct est bloquée par l’accès et la facturation du fournisseur; les cas des quatre services sont synthétiques et non révisés par un notaire.
- Les demandes de recherche et de sitemap ne sont pas de la traction commerciale. Le plan ne présente aucun acte client vérifié comme traction.

## Économie et financement

Les valeurs par défaut actuelles du domaine sont : 229 $ pour le service de financement, 279 $ pour le refinancement, puis 0 / 149 / 299 / 449 / 549 $ pour le service de date selon le palier. Les frais de carte et de Connect sont calculés sur la somme encaissée, y compris les honoraires transférés au notaire. Le modèle ajoute 30 $ de coût de service et une provision de pertes de 0,5 % comme hypothèses à mesurer; elles ne sont pas des résultats observés.

Le scénario de base vise 534 demandes publiées, 307 retenues et 244 actes complétés en année 1, pour environ **80 813 $** de revenu Nota. Après paiements, coûts de service, pertes et budget d’exploitation de 250 000 $, le résultat opérationnel modélisé est d’environ **−204 623 $**. Le modèle annuel suggère environ **430 119 $** de capital incluant une réserve de 25 000 $; le financement proposé de 250 000 $ ne couvre donc pas automatiquement l’horizon des trois ans.

Les récompenses de référence du domaine sont de 50 $ pour un client et de 250 $ pour un notaire activé. Le registre actuel comptabilise la récompense client à la retenue et la récompense notaire lorsque `premierActe` est présent. Les conditions de règlement, d’annulation, de divulgation et de remboursement doivent être alignées avant le programme partenaire.

Le scénario financier de base n’inclut aucun revenu d’abonnement ou d’utilisation des modèles propriétaires. Ce revenu sera ajouté seulement après la validation de la performance, du coût par dossier, des droits sur les données, de la sécurité et de la conformité professionnelle.

## Séquence de décision

1. Fermer l’avis professionnel, la cartographie fiscale, l’identité des fournisseurs, la vérification du statut des notaires et l’assurance.
2. Vérifier la capture, le transfert, le versement bancaire, le remboursement, le litige et la réconciliation en production contrôlée.
3. Instrumenter le parcours : visite admissible → demande → retenue → dossier complet → acte payé, avec coûts et échecs par segment.
4. Libérer l’acquisition par tranches après une cohorte locale mûre et un résultat positif par visite admissible.
5. N’élargir le catalogue, la géographie, la signature à distance ou l’IA qu’avec les preuves et les contrats propres à chaque service.

Les cibles ne sont pas des résultats acquis. Le plan complet expose les hypothèses, les scénarios défavorables et favorables, les responsabilités et les décisions qui restent à prendre.
