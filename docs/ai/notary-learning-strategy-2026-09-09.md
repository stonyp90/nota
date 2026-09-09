# Stratégie d’apprentissage supervisé de Nota pour les actes notariaux

**Québec · 9 septembre 2026 · branche `codex/ai-notary-lifecycle`**

Ce document transforme l’objectif de Nota en système vérifiable : réutiliser le
contexte fourni par le client, préparer la majorité des tâches répétitives,
faire valider chaque proposition importante par le notaire, puis apprendre des
résultats avec des signaux dont la force est explicite.

La cible de 90 % concerne la **préparation et l’orchestration administrative
définies dans une mesure de temps**, par exemple l’ouverture du dossier,
l’inventaire des pièces, l’extraction avec preuves, les demandes de suivi, les
comparaisons, les rappels et la préparation d’un brouillon. Elle ne signifie pas
que Nota remplace le jugement juridique, la vérification de l’identité, de la
qualité ou de la capacité, l’explication de l’acte, le consentement, la
signature, la publication, le décaissement ou la garde notariale. La cible n’est
pas encore mesurée et aucun gain professionnel de 90 % n’est déclaré.

## Décision produit

Nota suit un dossier comme une machine à états de preuve :

`déclaré → reçu → source identifiée → extrait → conflit détecté → vérifié par le notaire → brouillon approuvé → signé → publié ou inscrit → réconcilié → conservé`

Chaque flèche a son propriétaire et sa preuve. Une réponse du client aide à
prioriser une question, mais ne devient pas automatiquement un fait juridique.
Un fichier reçu n’est pas authentifié. Une citation de page rend une proposition
auditable, mais ne prouve ni l’authenticité ni la suffisance de la pièce. Une
sortie du modèle n’est donc jamais affichée comme « vérifiée » ou « prête à
signer » sans le contrôle humain approprié.

La couverture est codée dans `@nota/domain` et exposée dans chaque paquet privé
du notaire par `parameterCoverage.caseCoverage`. Elle couvre les quatre services
actifs : financement, refinancement, testament et procuration. La matrice
contient les cas courants et les branches sensibles; un cas inconnu, ambigu,
hors catalogue ou bloqué par une intégration est routé au notaire avant toute
automatisation aval. C’est la façon correcte de couvrir tous les cas **déclarés
dans le périmètre** sans prétendre connaître tous les cas futurs.

## Ce que le cycle apprend

Le programme `controlled_reinforcement_signals` sépare la nature du signal avant
de l’utiliser :

| Signal | Exemple | Force | Usage autorisé | Peut-il labelliser un champ juridique ? |
|---|---|---:|---|---|
| `notary_review` | accepté, corrigé ou rejeté avec index de champ | forte | préférence d’extraction, régression | Oui, après vérification séparée et autorisation hors ligne |
| `official_outcome` | publication, quittance, clôture ou réconciliation constatée | forte | résultat de workflow et régression d’intégration | Non; il ne réécrit pas une vérité juridique dans l’analyse |
| `customer_input` | réponse ajoutée, question complétée, consentement de traitement | faible | ordre des questions, friction d’intake | Non |
| `customer_behavior` | téléversement confirmé, accusé de lecture, réponse de suivi | faible | délais, relances, prévision de réouverture | Non |
| `communication` | direction, longueur, délai de réponse, langue | faible | clarté, priorité de suivi, escalade | Non |
| `client_feedback` | note et commentaire après l’acte | faible | expérience de service et communication | Non |
| `ai_output` | champs proposés, preuves, omissions, latence et usage | non labellisé | observation, coût, erreur, régression | Non |

Le comportement du client peut donc améliorer l’ordre des questions ou la
clarté des messages. Il ne peut pas récompenser un modèle parce qu’un client a
accepté une proposition, a cessé de répondre ou a donné une note élevée. Ces
événements indiquent une expérience; ils ne prouvent pas un nom, une capacité,
une dette, un titre, une radiation ou une volonté testamentaire.

Le client fait aussi partie du cycle de développement du produit. Le contrôleur
`apps/api/src/customer-improvement.js` lit chaque jour les compteurs agrégés du
parcours et ces signaux minimisés, compare deux fenêtres complètes, puis peut
activer ou retirer un seul mode de guidage public réversible. Le mode est exposé
avec le carnet dans `GET /bids`, et l’administration affiche la décision et ses
protections. La politique exige 20 ouvertures de formulaire et 10 tentatives de
publication; elle déclenche le guidage quand le blocage, le délai de réponse ou
la note basse indique une friction, puis retourne au mode standard si le taux
indicatif de publication baisse de plus de 20 % ou si les échecs augmentent de
plus de 10 points.

Cela permet à Nota de s’améliorer sans intervention quotidienne d’un
développeur sur ce réglage d’expérience. Le contrôleur est déterministe,
idempotent à l’échelle d’une décision, peu coûteux et limité à une petite
configuration; il n’appelle pas de modèle par visite et n’a aucun droit
d’écriture sur un dossier, un acte, un prix, une règle, un contrôle de notaire
ou les poids d’un modèle. Une amélioration de produit est donc automatique,
tandis que l’entraînement des poids reste un job hors ligne autorisé, qualifié,
approuvé par un notaire et réversible.

## Données capturées dans l’application

Le module `apps/api/src/notary-learning.js` transforme les étapes du parcours en
événements append-only conservés dans un flux de signaux séparé de la piste de
transactions :

- `ai_output` après une préparation financement, refinancement, testament ou
  procuration réussie; il garde la version du modèle, du prompt et des
  connaissances, les identifiants de champs, les omissions, les conflits, les
  comptes d’usage, la latence et des empreintes d’entrée et de sortie;
- `notary_review` après la revue du notaire; il garde le champ visé, la décision,
  les compteurs, la durée et une préférence bornée d’extraction; les valeurs
  corrigées et les raisons sont seulement hachées;
- `customer_input` et `customer_behavior` après une mise à jour du dossier, un
  document confirmé ou un accusé de lecture; seuls les identifiants de champs,
  les compteurs et les drapeaux de parcours sont conservés;
- `communication` après chaque message client-notaire; le texte est haché en
  mémoire et le journal garde sa longueur, la direction, la langue, le numéro
  de tour et un délai borné;
- `official_outcome` au premier règlement de l’acte, avec des drapeaux de
  clôture et de réconciliation;
- `client_feedback` après l’évaluation, avec la note et l’empreinte du
  commentaire.

Le flux de signaux est séparé de la piste d’audit transactionnelle et n’est pas
un corpus d’entraînement automatique. Il permet de mesurer le produit sans
faire lire au worker quotidien les lignes d’audit qui portent des métadonnées de
pièces ou de conversations. Les pièces originales restent soumises à leur
propre politique de conservation, d’effacement et d’accès. Le module protège
aussi le parcours si la télémétrie est indisponible : une erreur
d’apprentissage ne fait pas échouer un dépôt de pièce, une revue, une
signature ou un règlement.

## Préférence notariale et méthode d’entraînement

Une paire de préférence exploitable contient une même entrée et deux sorties :

```text
entrée documentaire dé-identifiée
  ├─ rejected : proposition IA originale
  └─ chosen   : extraction vérifiée séparément par un notaire
```

Le constructeur `buildNotaryPreferenceDataset` n’émet une paire que si toutes
les conditions suivantes sont présentes :

1. l’utilisation des données est autorisée pour cette finalité;
2. les données sont dé-identifiées ou synthétiques;
3. un approbateur est identifié;
4. l’ensemble de qualification est gelé;
5. la qualification est passée;
6. un plan de retour arrière existe;
7. la sortie candidate et la sortie vérifiée passent exactement le contrat du
   service;
8. chaque proposition a une décision notariale complète;
9. la sortie vérifiée est séparée de la revue courante et est reliée à un
   notaire vérificateur;
10. toute valeur corrigée est soutenue par une preuve valide de la même entrée.

Même lorsque ces portes sont satisfaites, le résultat indique
`trainingEligible: true` pour le **jeu hors ligne**, mais
`weightUpdate: not_started`. Un responsable doit encore approuver le job, ses
partitions et son déploiement. Une paire contenant un texte non dé-identifié,
une conclusion juridique ou une correction sans preuve est rejetée.

La littérature originale sur l’apprentissage par préférences décrit le schéma
RLHF comme une phase supervisée suivie de classements humains puis d’une
optimisation par renforcement; elle constate également que même un modèle
instructionnel peut encore produire des erreurs[^rlhf]. DPO montre qu’une
optimisation directe sur les préférences peut éviter une partie de la
complexité et de l’instabilité d’un pipeline RLHF complet[^dpo]. Pour Nota, la
première méthode raisonnable est donc une **optimisation de préférences hors
ligne**, plus simple à auditer et à arrêter. Le RL en ligne sur des clients
réels est désactivé : un score de clic, de silence ou de satisfaction pourrait
récompenser un raccourci dangereux. Les travaux sur le reward hacking et le
changement de distribution justifient cette prudence[^reward].

Le vecteur de récompense est séparé par finalité :

| Composante | Force | Ce qu’elle optimise | Barrière |
|---|---:|---|---|
| préférence de champ du notaire | forte | exactitude d’extraction et abstention | seulement paire vérifiée, par service et par langue |
| complétion du client | faible | ordre des questions et friction | aucun déblocage juridique |
| clarté de communication | faible | demande compréhensible et délai de réponse | aucun changement de champ |
| résultat de workflow | forte | rapprochement et orchestration | ne prouve pas le droit ou la capacité |
| sécurité | pénalité dure | faux support, fuite, prompt injection, action non autorisée | zéro tolérance sur les contrôles critiques |

## Boucle quotidienne contrôlée

« Apprendre chaque jour » signifie qu’un cycle quotidien produit une information
exploitable et une décision de déploiement; cela ne signifie pas que les poids
changent silencieusement chaque nuit.

1. **Collecter.** Ajouter les événements minimisés et les empreintes, avec la
   version du modèle, du prompt, de la connaissance et du contrat de service.
2. **Classer.** Séparer les signaux faibles, les sorties non labellisées, les
   corrections notariales et les résultats officiels. Rejeter les données dont
   la finalité ou la dé-identification est incertaine.
3. **Régresser.** Rejouer chaque jour les cas synthétiques, les cas de
   régression notariale autorisés et les cas d’intégration. Tester les quatre
   services, les deux langues, les versions de prêteur et les cas limites.
4. **Évaluer.** Mesurer la précision des champs, la fidélité des preuves,
   l’abstention, le faux support, la couverture des champs, la latence, les
   appels, les tokens et le coût par dossier accepté.
5. **Approuver.** Un notaire responsable examine le rapport, les nouveaux cas,
   les échantillons et les écarts de contrôle; les contrôles critiques restent
   en attente jusqu’à une décision explicite.
6. **Canariser.** Exposer une version qualifiée à un petit groupe de dossiers
   autorisés, avec le même modèle de revue et une comparaison à la version
   précédente.
7. **Retourner en arrière.** Désactiver la version, conserver l’empreinte du
   modèle et reprendre la dernière version qualifiée dès qu’un seuil critique
   est dépassé.

Le dossier garde toujours la version de connaissances et la provenance qui ont
produit une proposition. Cela rend possible une comparaison « avant/après » et
empêche de confondre une amélioration du prompt, un changement de modèle, une
nouvelle instruction de prêteur et une modification du formulaire.

## Couverture par service

La matrice exécutable et l’audit détaillé se trouvent dans
[`notary-service-coverage-2026-09-09.md`](notary-service-coverage-2026-09-09.md).
Les branches incluses dans le code sont les suivantes :

| Service | Cas préparables sous revue | Cas qui ouvrent une revue notariale ou un routage |
|---|---|---|
| Financement | dossier courant, achat et coordination, immeuble existant, copropriété, pièces manquantes | codébiteur ou caution, société/fiducie/succession, anomalie de titre, instruction périmée, système indisponible |
| Refinancement | dossier courant, plusieurs dettes, marge à solde nul, quittance/mainlevée, pièces manquantes | état expiré ou contradictoire, nouvelles et anciennes sûretés, société/fiducie/résidence familiale, anomalie de titre |
| Testament | testateur unique, volontés simples, inventaire, formalités de communication | plusieurs testateurs, famille recomposée ou mineur, bénéficiaire vulnérable/fiducie, testament existant, biens hors Québec, doute de capacité ou d’influence |
| Procuration | procuration ordinaire clairement délimitée, mandataires et durée déclarés | possible mandat de protection, pouvoirs bancaires ou immobiliers, révocation, soins personnels, doute de capacité ou de pression |

Le financement et le refinancement gardent des champs distincts pour le prix
d’achat, le montant du prêt, les dettes garanties, l’état de remboursement, sa
date de validité, le prêteur et sa personne-ressource. Le testament distingue
les volontés déclarées d’une conclusion juridique. La procuration distingue le
texte qui se décrit comme une procuration ordinaire d’un parcours possible de
mandat de protection. Dans les deux actes, l’IA ne conclut pas à la capacité.

## Intégrations et ordre de construction

La recherche officielle de la Chambre des notaires rappelle que le notaire
conseille et rédige le testament, conserve l’original et inscrit l’existence de
l’acte au registre applicable[^cnq-will]. Pour une procuration, le notaire
explique la portée, les pouvoirs et les limites; une procuration ordinaire ne
sert pas à organiser les soins personnels ou médicaux, et une révocation doit
être communiquée aux personnes et institutions concernées[^cnq-poa].

Les intégrations doivent donc être construites dans cet ordre :

1. **Dossier et preuve Nota.** Graphe des personnes, rôles, immeubles, pièces,
   versions, dates, décisions, exceptions et propriétaires d’action.
2. **Intake et pièces sécurisées.** Stockage chiffré, contrôles d’accès,
   extraction avec page, empreinte et statut; le texte doit rester présenté
   comme non fiable tant que le notaire ne l’a pas vérifié.
3. **Canaux du prêteur et états de remboursement.** Connecteur contractuel ou
   étape guidée dans le portail du prêteur, avec version et date de validité.
4. **Registre foncier et SLRI.** Recherche, préparation de réquisition, suivi et
   reçu officiel; une copie client ne remplace pas la recherche autorisée.
5. **Taxes, assurance, arpentage et copropriété.** Demandes et rapprochements
   conditionnels, avec la date et l’émetteur.
6. **Système de pratique du cabinet.** Export/import réversible et mapping
   vérifiable vers le système retenu par l’étude.
7. **Signature, garde et registres CNQ.** Préparation de la séance et du paquet;
   le notaire contrôle la plateforme autorisée, la lecture, l’explication, le
   consentement, la signature et la conservation.
8. **Fiducie, paiements et clôture.** Calculs et rapprochements préparés par
   Nota, décision et décaissement sous le contrôle du notaire.

La CNQ indique que les notaires et les fournisseurs technologiques doivent
protéger les renseignements, et que certaines solutions de signature, de garde
ou d’acte technologique doivent être autorisées ou homologuées selon le cas.
Elle précise aussi qu’elle n’homologue pas la vérification d’identité : le
notaire doit évaluer la solution lui-même[^cnq-tech]. Nota doit enregistrer
`integrationCandidate` comme une piste de travail, jamais comme une connexion
active ou une autorisation.

## Coût et performance

Le chemin économique est déterministe d’abord :

- réutiliser une analyse quand le dossier, l’entrée, le service, le modèle, le
  prompt, la connaissance et la configuration sont identiques;
- partager une génération identique en vol dans le même worker;
- limiter les pages, caractères, champs, appels par notaire et appels quotidiens;
- utiliser un classifieur ou des règles pour le routage et réserver le modèle
  plus coûteux aux dossiers incertains;
- mettre en cache les connaissances versionnées et ne recalculer que les
  documents modifiés;
- envoyer des lots hors ligne dé-identifiés pour la régression et les
  préférences, sans appel modèle par événement;
- comparer le coût par dossier **accepté et vérifié**, pas seulement le coût par
  appel réussi;
- conserver les compteurs d’usage déclarés, la latence et le taux de réutilisation
  pour éviter de traiter une valeur inconnue comme zéro.

Le gain doit être démontré par dossier et par service. Pour chaque pilote,
mesurer un échantillon de dossiers comparables :

```text
réduction préparatoire =
  (minutes manuelles de préparation de référence
   − minutes notariales restantes avec Nota)
  / minutes manuelles de préparation de référence
```

Le dénominateur exclut la signature, l’explication, le conseil, la capacité,
la publication et le décaissement. Une revue plus courte qui augmente les
exceptions non détectées n’est pas une amélioration.

Les portes de progression recommandées sont : aucun faux déblocage sur un
contrôle critique; preuve de page valide pour chaque champ proposé; abstention
sur les champs non soutenus; taux de conflit visible; régression verte sur les
cas connus; latence et coût dans le budget; décision d’un notaire; plan de
retour arrière testé. La cible de 90 % ne peut être publiée qu’après une mesure
de référence et un pilote avec ces portes.

## Confidentialité, transparence et responsabilité

La Commission d’accès à l’information demande une évaluation des facteurs
relatifs à la vie privée dès le début du projet et pendant son évolution; elle
demande d’examiner la nécessité, la proportionnalité, les risques, les
fournisseurs infonuagiques et les communications hors Québec[^cai-efvp]. La
Loi 25 encadre aussi le profilage et les décisions fondées exclusivement sur un
traitement automatisé : la personne doit être informée, connaître les données,
les facteurs ou paramètres pertinents et pouvoir demander une intervention
humaine[^cai-law25]. Nota doit donc expliquer quand une suggestion IA a été
produite, permettre une correction par le notaire et garder la décision humaine
séparée de la sortie du modèle.

Le Commissariat à la protection de la vie privée du Canada signale pour
l’apprentissage IA les risques de collecte excessive, de consentement opaque,
d’inexactitude, de ré-identification, de mémorisation et de suppression
insuffisante[^opc-ai]. Les règles de Nota suivent cette direction : minimiser,
dé-identifier, hacher les événements, limiter la rétention, séparer la
production du corpus, ne jamais transformer une conversation brute en label
juridique et permettre l’effacement du dossier source selon la politique
applicable.

Le cadre NIST AI RMF fournit une structure volontaire pour intégrer la
fiabilité et la gestion des risques dans la conception, le développement,
l’utilisation et l’évaluation d’un système IA[^nist]. Le programme de Nota en
reprend les pratiques opérationnelles : gouvernance, mesure, revue humaine,
traçabilité, canari et retour arrière.

## État réel de la branche

La branche fournit maintenant :

- le catalogue détaillé des paramètres, documents, champs IA, contrôles et
  intégrations candidates pour les quatre services;
- la matrice des cas avec une règle de routage des cas inconnus;
- l’extraction avec preuve de page et la revue obligatoire par champ;
- la collecte quotidienne, dans un flux séparé et minimisé, de signaux de
  dossier, comportement, communication, sortie IA, revue notariale, résultat
  officiel et feedback client;
- un constructeur hors ligne de paires de préférences, fermé par défaut et
  protégé par des portes d’autorisation, dé-identification, qualification et
  retour arrière;
- des évaluations synthétiques et des tests de cycle complet.

Le modèle n’est pas présenté comme « entièrement entraîné », le fournisseur
réel n’est pas déclaré opérationnel sans une exécution validée, et aucun poids
ne se met à jour automatiquement à partir des clients. La prochaine étape
responsable est de recueillir des exemples autorisés et dé-identifiés, de les
faire vérifier par des notaires, de geler un jeu de qualification, puis de
comparer une version candidate en canari. Le but final — le notaire révise la
majeure partie du travail préparé par Nota — devient alors une hypothèse
mesurée service par service, avec une sortie sûre vers le notaire pour tout cas
inconnu ou critique.

## Sources

[^cnq-will]: Chambre des notaires du Québec, [Le testament](https://www.cnq.org/vos-services-notariaux/testament-et-succession/le-testament/).
[^cnq-poa]: Chambre des notaires du Québec, [La procuration](https://www.cnq.org/vos-services-notariaux/protection-des-personnes/la-procuration/) et [durée et révocation d’une procuration](https://www.cnq.org/la-chambre-et-votre-protection/faq/peut-on-limiter-la-duree-dune-procuration-et-peut-on-la-revoquer/).
[^cnq-tech]: Chambre des notaires du Québec, [Fournisseurs de solutions technologiques aux notaires](https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/).
[^cai-efvp]: Commission d’accès à l’information du Québec, [Guide d’évaluation des facteurs relatifs à la vie privée](https://www.cai.gouv.qc.ca/uploads/pdfs/CAI_GU_EFVP.pdf?gt=obligation).
[^cai-law25]: Commission d’accès à l’information du Québec, [Principaux changements liés à la Loi 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25).
[^opc-ai]: Commissariat à la protection de la vie privée du Canada, [Intelligence artificielle](https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/).
[^nist]: National Institute of Standards and Technology, [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework).
[^rlhf]: Ouyang et al., [Training language models to follow instructions with human feedback](https://arxiv.org/abs/2203.02155).
[^dpo]: Rafailov et al., [Direct Preference Optimization](https://arxiv.org/abs/2305.18290).
[^reward]: Amodei et al., [Concrete Problems in AI Safety](https://arxiv.org/abs/1606.06565).
