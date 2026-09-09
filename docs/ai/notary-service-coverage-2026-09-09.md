# Audit des obligations notariales et des intégrations par service Nota

La boucle d’apprentissage contrôlé qui collecte les interactions sans les
transformer en vérité juridique est détaillée dans
[`notary-learning-strategy-2026-09-09.md`](notary-learning-strategy-2026-09-09.md).

**Québec · 9 septembre 2026 · document de recherche et de cadrage produit**

Ce document répond à une question précise : qu'est-ce que le notaire doit réellement faire pour chacun des services actuellement exposés par Nota, quelle preuve doit soutenir chaque étape, quel système doit être intégré et quelle partie peut être préparée par l'IA.

Le périmètre du catalogue Nota étudié ici est : **financement hypothécaire**, **refinancement hypothécaire**, **testament notarié** et **procuration notariée**. Le catalogue et les champs d'accueil de Nota restent la source du périmètre produit; ce document ajoute l'audit juridique, opérationnel et d'intégration. Il ne remplace pas la validation d'un notaire québécois responsable de la pratique.

Les énoncés marqués **Droit ou pratique officielle** sont appuyés par une source primaire. Les énoncés marqués **Décision Nota** sont des recommandations de conception. L'objectif de 90 % est un objectif de préparation et d'orchestration mesurable; il ne signifie pas que Nota exerce seule la fonction de notaire, donne un avis juridique, valide la capacité ou autorise la signature et le décaissement.

## Décision de conception

Nota doit être construit comme un **dossier de preuve et d'orchestration supervisé par un notaire**, avec un état explicite pour chaque élément :

`demandé → recueilli → source identifiée → extrait → vérifié par le notaire → brouillon approuvé → signé → publié ou inscrit → réconcilié → conservé`

Le dossier doit toujours distinguer les événements suivants :

- une déclaration du client n'est pas une preuve officielle;
- un fichier téléversé n'est pas un document authentifié;
- une extraction OCR n'est pas une validation;
- un brouillon n'est pas un acte final;
- une signature n'est pas une publication;
- une publication n'est pas un financement;
- un calcul de remboursement n'est pas un état officiel du créancier.

Cette séparation est la condition pour automatiser 90 % du travail administratif et préparatoire sans transformer une suggestion du modèle en conclusion juridique.

## Ce que la loi réserve au notaire

**Droit ou pratique officielle.** La Loi sur le notariat décrit le notaire comme conseiller juridique et officier public. Dans cette fonction, il doit notamment vérifier l'identité, la qualité et la capacité des parties, s'assurer de leur consentement libre et éclairé, les conseiller et agir avec impartialité.[^1] La même loi réserve au notaire la préparation de certains actes de forme notariée, les actes immobiliers qui doivent être publiés ou radiés et les avis juridiques; elle réserve aussi la validation des énonciations de fait contenues dans un acte notarié et les actes intrinsèquement liés à sa mission d'officier public, sous réserve des exceptions prévues par la loi.[^2]

**Décision Nota.** Le système peut préparer, classer, comparer, extraire, demander, rappeler, calculer une échéance, repérer une incohérence et assembler un brouillon contrôlé. Il ne doit pas afficher « prêt à signer », « titre clair », « capacité confirmée », « hypothèque de premier rang », « remboursement exact » ou « fonds libérables » sans décision humaine liée à une preuve et à une étape de workflow du notaire.

Pour tout acte reçu en minute, la signature doit respecter les formalités de présence, de lecture et de signature prévues par la Loi sur le notariat. La signature à distance n'est permise qu'exceptionnellement lorsque les circonstances l'exigent et que les droits et intérêts des parties sont respectés.[^3] Nota peut préparer la cérémonie, les documents et la checklist; le notaire garde la maîtrise de l'explication, de la lecture, du consentement et de l'exécution.

## Modèle commun de contrôle

### Fiche de preuve minimale

Chaque pièce ou réponse doit être enregistrée avec les champs suivants :

| Champ | Raison | Exemple de valeur |
|---|---|---|
| Dossier, service, partie et propriété | Empêcher le mélange entre clients, immeubles et actes | `REF-2026-001`, emprunteur A, lot X |
| Type, émetteur, date d'émission et date d'effet | Déterminer si la pièce est pertinente et actuelle | état de remboursement de Banque Y, valide au 30 septembre |
| Source et canal | Distinguer client, institution, registre et extraction | portail du prêteur, upload client, registre foncier |
| Version, empreinte et document parent | Éviter l'utilisation d'un formulaire remplacé ou d'une page modifiée | version prêteur 2026-03, hash |
| Pages, champs et extrait | Permettre au notaire de revenir au passage exact | PDF p. 4, paragraphe « décharge » |
| Niveau de confiance et statut | Rendre l'incertitude visible | extrait, corroboré, conflit, expiré, refusé |
| Auteur de la décision et moment | Imputer la validation au bon professionnel | notaire N, 2026-09-09 14:32 |
| Événement d'invalidation | Reprendre le dossier lorsqu'un fait change | nouveau prêt, mariage, décès, nouvelle instruction |

**Décision Nota.** Une sortie d'IA sans citation de la pièce, page ou réponse structurée qui la soutient doit être `inconnue` et non `vraie`. La suppression ou le remplacement d'une preuve doit créer un historique; elle ne doit pas effacer silencieusement la décision précédente.

### Garde-fous transversaux

Avant de préparer un acte, Nota doit faire passer les contrôles suivants :

1. **Mandat et portée.** Le demandeur, le client, le propriétaire, l'emprunteur, le garant, le conjoint, le mandataire, le témoin et le représentant d'une société sont des rôles distincts.
2. **Identité, qualité et capacité.** La plateforme collecte et compare les pièces; le notaire décide si la personne est bien celle qui doit agir et si elle peut comprendre et consentir.
3. **Langue, accessibilité et conflit.** Le système repère une langue, un interprète, une aide à la communication, un conflit ou une rencontre privée nécessaire; le notaire tranche.
4. **Preuve actuelle.** Une pièce expirée, contradictoire, issue d'une source inconnue ou reçue avant un changement important bloque l'automatisation aval.
5. **Forme et version de l'acte.** Le modèle doit correspondre au service, au prêteur, au type de propriété, aux parties et à la procédure technologique autorisée.
6. **Lecture, explication et consentement.** Nota prépare la version de travail et les questions ouvertes; le notaire explique et reçoit le consentement.
7. **Signature, publication et conservation.** Chaque étape doit recevoir son propre statut et son propre justificatif.
8. **Argent et confiance.** Nota peut préparer une réconciliation et signaler un écart; il ne doit pas déplacer, libérer ou retourner des fonds sans contrôle humain et procédure du notaire.

Les dossiers et preuves notariales sont soumis à des exigences d'identification, de conservation, de sécurité et de mise à jour. Le règlement sur les dossiers exige notamment la vérification et la conservation de preuves d'identité, la conservation de pièces de publication ou radiation, des sauvegardes et une conservation minimale de dix ans, sous réserve des règles applicables.[^4] Les règles de confidentialité, de sécurité et de secret professionnel doivent également être appliquées aux fournisseurs technologiques.[^5]

## Service 1 — Refinancement hypothécaire

### Ce que le notaire doit accomplir

| Étape | Travail notarial à couvrir | Preuve ou sortie attendue | Automatisation Nota permise |
|---|---|---|---|
| 1. Qualifier le dossier | Confirmer s'il s'agit d'un nouveau prêt garanti, d'un remplacement de prêteur, d'une marge de crédit, d'une augmentation, d'une mainlevée ou d'une quittance; repérer un chevauchement avec une vente ou un achat | Typologie confirmée et exceptions ouvertes | Questionnaire adaptatif, classification, détection des mots-clés; aucune conclusion juridique autonome |
| 2. Établir les rôles | Identifier propriétaires, emprunteurs, cautions, conjoints, mandataires, société ou fiducie; vérifier qui a le pouvoir de signer | Matrice parties-rôles et pièces manquantes | Extraction des noms, rapprochement et demandes ciblées; le notaire valide la qualité et l'autorité |
| 3. Recevoir les instructions du prêteur | Utiliser la version actuelle des instructions et formulaires du prêteur; respecter les conditions, clauses, rapports, signatures et délais du mandat | Instruction datée, version, conditions et accusé de réception | Import structuré, contrôle de version, comparaison des champs et suivi des conditions; jamais utiliser un vieux formulaire ou modifier un formulaire verrouillé |
| 4. Examiner le titre | Vérifier la propriété, les droits, la capacité des propriétaires, la description exacte du lot et les charges publiées; rechercher les hypothèques non radiées, saisies, jugements, servitudes et hypothèques légales pertinentes | Recherche officielle, rapport de titre et liste des charges avec statut | Prélecture, extraction des numéros de lot et charges, comparaison à l'ancien dossier, file d'exception; le notaire rend l'opinion sur le titre |
| 5. Vérifier l'immeuble | Comparer le certificat de localisation, les changements à l'immeuble, les empiètements, servitudes, usage, assurance et taxes; faire une branche copropriété lorsque nécessaire | Certificat actuel ou décision documentée, taxes, assurance, dossier du syndicat | Contrôle de complétude, détection de document ancien, extraction des dates et montants, demandes automatiques |
| 6. Déterminer les dettes garanties | Recenser chaque prêt, marge et charge, y compris une marge à solde nul; demander un état officiel de remboursement avec date de validité, frais et instructions de paiement | États de remboursement officiels, valides à la date de clôture | Inventaire, rapprochement des numéros de compte, expiration et rappel; ne jamais calculer un montant à partir d'une capture d'écran |
| 7. Choisir la bonne extinction | Distinguer quittance et mainlevée selon la situation et les instructions; obtenir le document approprié et faire publier la radiation | Quittance ou mainlevée, preuve de dépôt et preuve de publication | Préparer la demande, vérifier la présence de la pièce et suivre le statut; le notaire choisit et autorise |
| 8. Préparer l'acte | Produire le projet d'acte hypothécaire en minute avec les données du dossier, les clauses du prêteur et la désignation exacte de l'immeuble | Projet versionné, liste des différences et questions au notaire | Fusion de données approuvées, contrôle des champs obligatoires, comparaison avec l'instruction; pas de rédaction finale autonome |
| 9. Recevoir l'acte | Vérifier identité, qualité, capacité et consentement; expliquer les obligations; lire ou faire lire selon les formalités; gérer témoin, interprète et présence | Décision de séance, signatures et mention des formalités | Préparer l'ordre de séance, vérifier les pièces, signaler un blocage et déposer l'audit de signature |
| 10. Fermer et publier | S'assurer que les conditions de fonds sont respectées, obtenir les fonds selon la procédure du prêteur, publier la nouvelle hypothèque et les radiations nécessaires | Réquisitions, accusés, numéros de publication, rapport de clôture | Orchestration des tâches, contrôle des préconditions, rapprochement des accusés; jamais décaissement autonome |
| 11. Réconcilier et conserver | Vérifier paiements, ajustements, frais, remboursements, engagements et copie finale; conserver le dossier sécurisé | Réconciliation, reçu, copie signée, pièces de registre et clôture | Calculs contrôlables, détection d'écarts, indexation et rappel de conservation |

La CNQ décrit le rôle du notaire immobilier comme un contrôle préventif : l'examen du titre vise notamment le véritable propriétaire, la capacité de disposer et les droits publiés; le certificat de localisation sert à vérifier les dimensions, constructions, empiètements, servitudes et contraintes pertinentes.[^6] Le Code civil exige qu'une hypothèque immobilière soit constituée par acte notarié en minute, à défaut de quoi elle est absolument nulle, et exige une désignation précise de l'immeuble.[^7]

Pour une dette existante, le notaire doit obtenir et publier la radiation appropriée. La CNQ explique la différence entre quittance et mainlevée; le gouvernement du Québec indique qu'une radiation est souvent nécessaire lorsqu'un prêt est remplacé par un nouveau financement ou lorsqu'un immeuble est vendu.[^8] Le système doit donc traiter la **validité temporelle** de l'état de remboursement comme une contrainte bloquante.

Une copropriété doit déclencher une branche spécifique. Le dossier peut exiger la déclaration de copropriété et ses modifications, le certificat du syndicat, les fonds de prévoyance et d'assurance, les contributions, travaux, litiges, procès-verbaux, charges communes et autres documents pertinents. La CNQ recommande de prévoir un délai raisonnable, souvent de sept à dix jours, pour obtenir et étudier ces documents.[^9]

Le financement peut aussi être affecté par la résidence familiale, une société ou des actifs mobiliers. Le système doit ouvrir une exception plutôt que supposer que la personne qui demande le refinancement peut seule hypothéquer l'immeuble. Les hypothèques légales et, pour les biens meubles d'une entreprise, le RDPRM doivent être traités dans leur registre respectif.[^10]

### Intégrations nécessaires au refinancement

- **Dossier de preuve Nota — obligatoire, système interne.** Graphe des personnes, lots, prêts, charges, versions, échéances, décisions et exceptions.
- **Intake sécurisé et OCR — obligatoire, données entrantes.** Téléversement chiffré, extraction avec page et empreinte; Textract en région canadienne est un candidat d'OCR, sous réserve de l'EFVP et de l'approbation du cabinet.[^11]
- **Instructions du prêteur et remboursement — priorité P0.** Assyst/Unity ou Paiements immobiliers de Dye & Durham sont des candidats commerciaux à évaluer avec le prêteur, le cabinet et les droits d'accès; ce ne sont pas des accès que Nota peut présumer.[^12]
- **Registre foncier et SLRI — priorité P0.** Recherche, préparation de réquisition, suivi du statut et récupération du reçu par une interface officiellement autorisée ou une étape humaine dans le portail. Le registre foncier n'est pas remplacé par une copie remise par le client.[^13]
- **Taxes, arpentage, assurance et copropriété — P1.** Connecteur institutionnel lorsqu'il est disponible; sinon demande sécurisée et validation humaine. Il faut conserver l'émetteur et la date, pas seulement le montant extrait.
- **Système de pratique notariale — P1.** Adaptateur vers un fournisseur autorisé par la CNQ, en commençant par un pilote contractuel avec ParaMaitre/Avancie si le cabinet l'utilise; mapping réversible et journalisé.[^14]
- **Signature, garde et copie — P1.** Pour un acte technologique en minute, suivre la procédure CNQ et l'environnement ConsignO Cloud-CNQ/CertifO applicable; Nota prépare et transmet le dossier, le notaire contrôle la cérémonie et la copie.[^15]
- **Fiducie et rapprochement — P1.** Importer les confirmations, préparer la réconciliation et signaler les écarts. La gestion du compte en fidéicommis, la source des fonds et le retour d'argent demeurent sous le contrôle du notaire.[^16]

## Service 2 — Financement hypothécaire

Le financement partage la plupart des contrôles du refinancement, avec une branche supplémentaire lorsque le prêt accompagne un achat. La promesse d'achat, les conditions de financement, le vendeur, le prix, le dépôt, la date de possession, les ajustements de taxes et la remise des fonds doivent être synchronisés avec l'acte de vente et l'acte hypothécaire.

| Étape | Travail notarial à couvrir | Preuve ou sortie attendue | Automatisation Nota permise |
|---|---|---|---|
| 1. Définir la transaction | Distinguer achat d'un immeuble, nouvelle hypothèque sur un immeuble déjà détenu et financement qui remplace une dette existante | Type de transaction, parties et dates critiques | Triage et questionnaire; ouverture automatique d'une branche vente si nécessaire |
| 2. Lire les instructions actuelles | Recevoir le mandat du prêteur, confirmer montant, conditions, forme de sûreté, rapports et date d'expiration | Instruction et version du prêteur | Import, extraction, comparaison et rappels; pas d'acceptation automatique |
| 3. Vérifier la promesse et la propriété | Contrôler adresse, lot, prix, conditions, identité et pouvoir de vendre; effectuer l'examen du titre et du certificat de localisation | Promesse, titre, lot, certificat, exceptions | Extraction et rapprochement; décision notariale sur qualité du titre |
| 4. Vérifier l'immeuble | Taxes, assurance, copropriété, construction, servitudes, travaux et exigences du prêteur | Dossier immobilier complet | Checklist conditionnelle et relances |
| 5. Préparer vente et hypothèque | Coordonner les actes, ajustements, dépôt, garanties, procurations et documents du prêteur | Projets cohérents et état des questions | Fusion de données autorisées et détection de contradictions |
| 6. Recevoir les signatures | Identité, qualité, capacité, explication, lecture et consentement de chaque signataire; gérer témoin ou interprète | Actes signés et mentions requises | Préparation de séance et audit; aucune décision de capacité |
| 7. Obtenir et affecter les fonds | Satisfaire toutes les conditions avant la demande de fonds; appliquer la procédure du prêteur et de la fiducie | Demande de fonds, preuve de réception et réconciliation | Préparer la demande, vérifier les conditions, signaler une différence; pas d'envoi ou de libération autonome |
| 8. Publier et clôturer | Publier les actes, traiter les radiations existantes si elles existent, obtenir les reçus et produire le rapport final | Numéros de publication, copies et rapport | Suivi d'état, contrôle de séquence et indexation |

Les instructions de prêteur sont des obligations contractuelles propres à l'institution et peuvent évoluer. À titre de référence opérationnelle, les formulaires québécois actuels de RBC prévoient une réception électronique dans une plateforme, l'utilisation des documents courants, une demande de fonds au moins trois jours avant la clôture dans la procédure indiquée, une hypothèque de premier rang et, lorsque nécessaire, un engagement de radier l'hypothèque existante avant le décaissement.[^17] Nota doit donc stocker la **source et la version de chaque instruction**, et non généraliser une règle RBC à tous les prêteurs.

**Intégrations prioritaires.** Le financement nécessite l'intake et le dossier de preuve, l'instruction prêteur, le registre foncier, les taxes/assurance/copropriété, le système de pratique, la signature autorisée, la fiducie et la coordination du vendeur ou de son notaire. Le module de remboursement et de quittance est conditionnel, mais il doit exister dès le premier jour dans le modèle de données afin que le financement puisse se transformer en refinancement sans recréer le dossier.

## Service 3 — Testament notarié

Un testament n'est pas un formulaire de répartition d'actifs. Le travail du notaire consiste à comprendre la volonté, à vérifier la capacité et le consentement, à conseiller sur les conséquences juridiques et à traduire cette volonté en clauses valides et claires.

| Étape | Travail notarial à couvrir | Preuve ou sortie attendue | Automatisation Nota permise |
|---|---|---|---|
| 1. Entendre le testateur | Identifier testateur(s), situation familiale, conjoint, enfants, personnes vulnérables, langue, besoins d'accessibilité et objectif de la rencontre | Questionnaire validé, besoins de séance, conflits ou rencontres privées signalés | Entretien structuré, résumé factuel, questions manquantes; ne pas déduire la capacité |
| 2. Chercher les changements importants | Relever mariage, union, séparation, divorce, naissance, décès, changement de résidence, entreprise, actifs hors Québec, assurance et testament antérieur | Chronologie et pièces pertinentes | Détection d'événements et rappels de mise à jour |
| 3. Comprendre les volontés | Bénéficiaires, parts, legs particuliers, liquidateur, fiducie testamentaire, protection d'un mineur ou d'une personne vulnérable, préférences et contraintes | Déclarations du client clairement attribuées | Structuration de réponses et détection de contradictions; pas de recommandation successorale finale |
| 4. Conseiller | Expliquer les options et limites de la loi, les dépendants, la fiducie, le liquidateur et les conséquences des clauses | Questions répondues et décision du notaire | Préparer les explications et une liste de points à couvrir; avis réservé au notaire |
| 5. Rédiger le projet | Traduire les volontés en projet clair et conforme, avec la bonne forme et les mentions nécessaires | Projet versionné, diff et questions ouvertes | Proposer un projet de faits et clauses à partir d'un modèle approuvé; aucun envoi final sans approbation |
| 6. Recevoir l'acte | Recevoir en minute, avec témoin(s) requis; lire ou faire lire; recueillir la déclaration du testateur et les signatures en présence requise; traiter les besoins particuliers | Minute signée et mentions de lecture, date, lieu, témoin et capacité apparente | Checklist de cérémonie et contrôle de présence; le notaire décide et agit |
| 7. Conserver et enregistrer | Garder l'original en lieu sûr et déclarer l'existence au registre approprié de la CNQ; donner la copie et les instructions de conservation | Copie, confirmation d'enregistrement et emplacement de l'original | Préparer le dossier et le rappel; la saisie au registre et la garde restent contrôlées par le notaire |
| 8. Revoir dans le temps | Proposer une révision lors des changements importants ou d'une modification de loi ou de situation | Rappel et nouvelle décision du client | Rappels contextualisés et comparaison avec le dernier dossier |

Le Code civil prévoit la forme du testament notarié : réception en minute par un notaire avec le ou les témoins requis, date et lieu, lecture, déclaration que l'acte exprime les dernières volontés et signatures en présence l'un de l'autre. Il prévoit aussi des formalités particulières pour certaines incapacités de communiquer et des limites de conflit pour le notaire.[^18]

La CNQ indique qu'un testament notarié n'a pas à être vérifié après le décès, que le notaire conseille sur la protection des dépendants, la fiducie testamentaire et les assurances, et qu'il conserve l'original et enregistre l'existence du testament au registre des dispositions testamentaires. Le registre ne contient pas le contenu du testament.[^19] Après un décès, la recherche des registres testamentaire et des mandats de protection est obligatoire pour établir le document applicable; cela appartient à un parcours de succession, et non à une promesse de la plateforme de préparer seule la succession.[^20]

### Intégrations et limites

- **Intake sécurisé et questionnaire adaptatif — P0.** Le système doit retenir la chronologie familiale, les volontés et les pièces uniquement avec l'autorisation du client; l'IA doit restituer les mots du client comme déclaration, sans les transformer en conclusion.
- **Système de pratique et modèles approuvés — P1.** La proposition de texte doit partir des modèles du cabinet et être comparée ligne par ligne; la génération libre d'une clause successorale est interdite dans le parcours automatisé.
- **Registre testamentaire CNQ — workflow contrôlé.** L'application peut préparer les données et rappeler l'enregistrement, mais elle ne doit pas stocker le contenu du testament dans un connecteur qui n'est pas destiné à ce registre ni appeler le registre avec des identifiants du notaire sans autorisation.
- **Signature et conservation CNQ — P1.** Utiliser l'environnement et la procédure autorisés pour l'acte technologique; conserver l'original et l'audit selon le système choisi par le notaire.
- **Parcours de succession — hors périmètre initial.** Les tâches du liquidateur, l'inventaire, les dettes, les déclarations fiscales et la distribution exigent un service distinct et un autre jeu de preuves.

## Service 4 — Procuration notariée

Le premier contrôle est de ne pas confondre **procuration ordinaire** et **mandat de protection**. Une procuration ordinaire sert à représenter le mandant dans des actes juridiques, généralement pour des biens ou des affaires et souvent pour une période ou une transaction donnée. Un mandat de protection vise une éventuelle inaptitude et ne devient effectif qu'après les constats requis et l'homologation judiciaire.[^21]

| Étape | Travail notarial à couvrir | Preuve ou sortie attendue | Automatisation Nota permise |
|---|---|---|---|
| 1. Classer le besoin | Déterminer procuration ordinaire, mandat de protection, directive de soins ou autre service; ouvrir le bon parcours | Type de mandat et motif | Triage par scénarios et questions; blocage si le client décrit une incapacité future ou des soins personnels |
| 2. Identifier les rôles | Mandant(s), mandataire(s), remplaçant(s), institution ou tiers, bénéficiaire potentiel et personne à aviser | Matrice parties-rôles et coordonnées | Extraction et rapprochement; validation notariale de l'identité et de la qualité |
| 3. Délimiter les pouvoirs | Actes autorisés, immeuble, prêt, hypothèque, compte, entreprise, limite monétaire, durée, conditions, signature conjointe, reddition de compte et interdictions | Instructions structurées et pouvoirs expressément confirmés | Questionnaire guidé, détection de pouvoir absent ou trop large, rappel de durée; pas d'interprétation finale |
| 4. Vérifier l'existant | Procuration, mandat, résolution, convention, révocation ou exigence de la banque déjà en vigueur | Documents existants et statut | Comparaison, recherche de contradictions et demande de copie |
| 5. Conseiller et rédiger | Expliquer les effets, limites, révocation, obligations du mandataire et conséquences pratiques; produire un projet | Projet versionné et questions ouvertes | Fusion des faits autorisés, checklist et diff; le notaire conseille et approuve |
| 6. Recevoir l'acte | Vérifier identité, qualité, capacité et consentement; expliquer, lire, signer et traiter accessibilité ou interprète | Acte et mentions de séance | Préparer la séance et l'audit; aucune décision sur la capacité |
| 7. Remettre et notifier | Donner les copies, informer mandataire et institutions lorsque nécessaire; en cas de révocation, aviser le dépositaire, mandataire et tiers concernés | Copie, avis et accusés | Générer brouillons d'avis, suivi des accusés et rappels; aucun avis juridique ou bancaire envoyé sans instruction |
| 8. Enregistrer si le parcours l'exige | Pour un mandat de protection, suivre le registre et la procédure CNQ; ne pas supposer qu'une procuration ordinaire est automatiquement dans ce registre | Confirmation de l'enregistrement approprié | Préparer les données et suivre l'état, sous contrôle du notaire |

Le Code civil définit le mandat comme le contrat par lequel une personne donne le pouvoir de la représenter et appelle procuration l'écrit qui constate ce pouvoir. Un mandat peut être spécial ou général; les actes qui dépassent la simple administration nécessitent des pouvoirs exprès dans les cas prévus. Le mandat peut prendre fin notamment par révocation, renonciation, extinction du pouvoir, décès ou faillite, et le notaire dépositaire d'un acte en minute doit annoter l'original et les copies lors d'une terminaison communiquée selon les règles applicables.[^22]

La CNQ précise qu'une procuration ordinaire doit décrire clairement les pouvoirs, qu'elle ne couvre pas les soins personnels ou médicaux, qu'elle est distincte du mandat de protection et qu'elle peut être révoquée. Le mandat de protection suit un autre régime, notamment la constatation de l'inaptitude et l'homologation.[^23]

### Intégrations et limites

- **Intake de portée — P0.** Les pouvoirs doivent être des objets structurés avec type d'acte, propriété, institution, limites, durée et conditions; un champ libre ne suffit pas pour autoriser une hypothèque ou une vente.
- **Système de pratique et modèles — P1.** Le projet est produit dans le gabarit approuvé du cabinet et revient dans le dossier avec l'historique.
- **Institutions et prêteurs — P1 conditionnel.** Nota peut préparer une lettre ou une demande de confirmation; il ne doit pas agir à la banque ou signer à la place du mandataire.
- **Registre du mandat de protection — P1 conditionnel.** L'existence et l'état doivent être traités dans le parcours prévu par le notaire; ne pas envoyer au registre le contenu complet comme si le registre était un coffre documentaire.
- **Révocation — P1.** Gérer la liste des destinataires, les accusés et les événements d'invalidation; conserver une preuve de notification et laisser au notaire le choix de la forme appropriée.

## Carte des intégrations à construire

| Type d'intégration | Système ou candidat | Données échangées | Automatisation utile | Contrôle obligatoire |
|---|---|---|---|---|
| Dossier et preuve | Nota, source interne | Parties, lots, documents, versions, décisions, états | Graphe de dossier, règles, provenance, échéances | Isolation des dossiers, journal immuable, suppression contrôlée |
| Intake et documents | Portail Nota + OCR, Textract Canada Central comme candidat | PDF/images, champs, pages, hash, qualité | Classement, extraction, demandes manquantes | Consentement, chiffrement, révision de l'extrait, retrait des données inutiles |
| Prêteur | Assyst/Unity, Dye & Durham ou canal contractuel du prêteur | Instructions, formulaires, états de remboursement, statuts, reçus | Import, version, checklist et rapprochement | Accès autorisé, document courant, aucune modification d'un formulaire verrouillé |
| Titre immobilier | Registre foncier/SLRI ou opérateur autorisé | Recherche, lot, charges, réquisitions, accusés | Préparation et suivi | Notaire ou personnel autorisé interprète le titre et valide l'inscription |
| Biens meubles | RDPRM, uniquement si entreprise/garantie mobilière | Recherches, inscriptions, radiations | Déclencheur conditionnel et dossier de preuve | Accès authentifié et analyse notariale |
| Entreprises | Registraire des entreprises du Québec | NEQ, statut, administrateurs, bénéficiaires ultimes, pouvoirs publiés | Récupération et comparaison à la résolution | Ne pas conclure seul sur l'autorité; traiter les changements et informations non disponibles |
| Taxes, assurance, arpentage | Municipalité, commission scolaire, assureur, arpenteur, syndicat | États officiels, certificat, police, certificat de syndicat | Demandes, extraction et expiration | Source émettrice et date; branche manuelle en cas d'absence d'API |
| Pratique notariale | Fournisseur homologué ou déclaré à la CNQ, par exemple ParaMaitre/Avancie | Clients, dossiers, projets, pièces, tâches | Import/export idempotent, mapping, synchronisation d'état | Contrat, sécurité, choix du cabinet et possibilité de reprise manuelle |
| Signature et conservation | ConsignO Cloud-CNQ, CertifO, greffe numérique selon le cas | Projet, signataires, audit, copie, minute | Préparation, invitation sous contrôle, réception de l'audit | Notaire initie et reçoit l'acte; procédure CNQ; autorité du signataire non déduite du seul certificat |
| Fiducie et paiements | Système du cabinet et banque, sans mouvement autonome Nota | Demande, réception, paiements, solde, reçus | Réconciliation, écarts, checklist | Source des fonds, autorisation, décaissement, retour et trust accounting par le notaire |
| Communications | Courriel/SMS/calendrier du cabinet | Demandes, échéances, confirmations | Brouillons, rappels, escalades | Consentement, destinataire, contenu, envoi explicite pour les messages sensibles |
| Amélioration du modèle | Registre d'évaluations séparé | Correction, cause, version, preuve, résultat | Régression quotidienne, monitoring, rollback | Données autorisées, dé-identification, approbation notariale, aucune formation sur les sorties non vérifiées |

La CNQ publie une liste de solutions technologiques homologuées ou encadrées et indique que le notaire doit choisir une solution sécuritaire adaptée et déclarer l'utilisation de certaines solutions. Les fournisseurs doivent donc être traités comme des intégrations contractuelles et professionnelles, pas comme de simples endpoints publics.[^24] L'interopérabilité ParaMaitre–ConsignO annoncée par Avancie est un exemple de capacité à vérifier dans un pilote avec le cabinet; elle ne prouve ni l'accès de Nota ni la conformité d'un déploiement générique.[^25]

Le registre foncier permet la recherche et l'inscription de droits; les inscriptions sont généralement préparées ou présentées par un notaire ou un avocat, et la SLRI impose sa propre procédure de documents et de signature.[^26] Le RDPRM sert à publier ou consulter des droits sur des biens meubles et doit être activé seulement pour les dossiers qui ont une dimension mobilière ou d'entreprise.[^27] Le REQ donne des informations officielles sur l'entreprise, ses administrateurs et certaines personnes bénéficiaires, mais les données disponibles et les droits de consultation ne remplacent pas une résolution ou une analyse d'autorité.[^28]

## Audit de couverture du catalogue Nota

Les champs actuels de Nota couvrent déjà une bonne première collecte : parties, adresse, prêteur, échéance de taux, offre de prêt, état d'hypothèque, promesse d'achat, taxes, assurance, certificat de localisation, testament ou transmission; le parcours testament recueille famille, personnes à charge, volontés et actifs; le parcours procuration recueille mandants, mandataires, pouvoirs, durée et tiers.

Pour couvrir le travail réel du notaire, il faut ajouter les blocs suivants au graphe de dossier et aux règles de sortie :

1. **Rôles juridiques complets** : propriétaire, emprunteur, garant, conjoint, mandataire, représentant de société, bénéficiaire ultime, témoin et interprète.
2. **Identité et qualité** : pièces reçues, pièces vérifiées, méthode, date, résultat et raison d'un refus.
3. **Source officielle et version** : émetteur, canal, version du formulaire, date d'effet, empreinte et citation de page.
4. **Titre et lot** : numéro de lot, historique consulté, charges, rang, radiations attendues, hypothèques légales, saisies, jugements, servitudes et statut de chaque exception.
5. **Instructions du prêteur** : produit, montant, clauses, conditions de fonds, date limite, formulaire courant, demande de fonds et état des modifications.
6. **Remboursement** : chaque compte garanti, état officiel, date de validité, montant, frais, bénéficiaire du paiement, quittance ou mainlevée et preuve de publication.
7. **Branches immobilières** : copropriété, résidence familiale, société ou fiducie, travaux, assurance, taxes et biens meubles garantis.
8. **Cérémonie notariale** : lecture, explication, consentement, présence, témoin, interprète, capacité apparente et décision du notaire.
9. **Publication et conservation** : réquisition, statut, reçu, copie, emplacement de l'original, audit de signature et échéance de conservation.
10. **Fonds** : source, dépôt, conditions, affectation, rapprochement et personne qui autorise; jamais un simple champ « payé ».
11. **Procuration** : expiration, révocation, destinataires de l'avis et état de chaque notification.
12. **Routage** : mandat de protection, succession, vente, copropriété complexe, entreprise, actif hors Québec ou question fiscale doivent ouvrir un parcours approprié.

Le modèle actuel d'extraction de Nota doit donc continuer à produire des **faits proposés et des preuves**, avec les états `inconnu`, `conflit`, `à vérifier` et `refusé`. Pour les points ci-dessus, il ne faut pas le qualifier de capable de vérifier un titre, une qualité, une capacité, une autorité, une clause ou un droit de décaissement tant qu'un connecteur autorisé et un échantillon annoté par des notaires ne l'ont pas démontré.

## Plan d'intégration par priorité

### P0 — réduire immédiatement les délais sans déplacer le risque juridique

- Graphe de dossier et registre de preuve avec version, citation, statut et invalidation.
- Intake sécurisé bilingue, questions conditionnelles et conservation du contexte client.
- OCR et classement de pièces avec sortie bornée, preuve de page et repli manuel.
- Import des instructions prêteur, version et échéances.
- Suivi des états de remboursement et des documents manquants.
- File de recherche foncière et de publication avec remise contrôlée au notaire.
- Revue du notaire en une page : conflits, inconnus, expirations, pièces absentes, conditions de fonds.

### P1 — raccourcir le travail de production

- Adaptateur du système de pratique choisi par le cabinet.
- Mapping vers modèles approuvés et comparaison différentielle.
- ConsignO Cloud-CNQ/CertifO ou flux autorisé de signature et de conservation.
- Branches copropriété, société, résidence familiale, garantie mobilière et testament/protection.
- Réconciliation de clôture, rapport et rappels de publication.

### P2 — traiter les cas à forte valeur mais à forte variabilité

- Connecteurs contractuels par prêteur pour instructions, remboursements et radiations.
- Recherche REQ/RDPRM avec gestion des droits et interprétation humaine.
- Rappels de révision testamentaire et suivi des révocations de procuration.
- Mesure multi-cabinet, multi-prêteur et multi-type de document.
- Automatisation d'événements rejetés, reçus hors ordre, documents remplacés et doublons.

Avant de connecter des données personnelles à un nouveau système ou de transférer des données hors Québec, une évaluation des facteurs relatifs à la vie privée et des vérifications contractuelles sont nécessaires. La CAI vise notamment les projets d'acquisition, de développement ou de refonte d'un système qui traite des renseignements personnels, ainsi que les systèmes d'IA; la Loi sur l'accès impose aussi des conditions pour les transferts hors Québec.[^29]

## Apprentissage quotidien et qualité du modèle

Le modèle doit apprendre tous les jours par le **cycle d'évaluation**, et non par une modification automatique de ses poids après chaque dossier :

1. recueillir uniquement une correction autorisée du client, du personnel ou du notaire;
2. enregistrer la preuve, la version du document, le modèle, le prompt, la règle et le résultat;
3. classer la cause : collecte incomplète, OCR, mauvaise page, mapping, recherche, règle, modèle, intégration ou processus;
4. ajouter un cas synthétique ou dé-identifié à une suite de régression;
5. tester le correctif sur un jeu d'entraînement, un jeu de validation par prêteur/service et un jeu de test tenu à l'écart;
6. faire approuver par un notaire responsable les changements qui touchent un blocage, une clause ou une décision;
7. déployer une version canary avec retour arrière et surveiller erreurs, temps, coût, réouvertures et incidents;
8. réévaluer les pièces et instructions qui ont changé, même si le modèle n'a pas changé.

Les métriques prioritaires sont :

- exactitude champ par champ sur les champs critiques;
- rappel des blocages critiques et taux de faux déblocage;
- exactitude de la source et de la page citées;
- taux de documents classés avec succès et taux de repli humain;
- durée de préparation réellement économisée;
- coût par dossier, latence p50/p95 et volume de tokens;
- taux de réouverture après revue notariale;
- taux de publication ou de fonds retardé par une erreur de Nota;
- performance séparée par service, prêteur, langue, qualité documentaire, copropriété, société et présence de procuration.

Le cadre NIST AI RMF recommande de documenter les limites du modèle, la provenance des données, les rôles de supervision, les évaluations en conditions de déploiement et la surveillance continue. Cette discipline est particulièrement adaptée à Nota : un modèle peut être bon pour trouver une date dans un PDF et inacceptable pour conclure qu'une hypothèque est radiée.[^30]

Les données de clients ne doivent pas être utilisées directement pour entraîner un modèle général. Une offre de fournisseur peut promettre de ne pas utiliser les entrées pour entraîner son modèle de base, mais cela ne remplace ni la confidentialité notariale ni l'EFVP. Pour un modèle privé affiné, AWS indique notamment que les données d'affinage ne servent pas à améliorer le modèle de base, tout en avertissant qu'un modèle affiné peut reproduire des données d'entraînement; les documents confidentiels doivent donc être minimisés, filtrés et autorisés avant tout usage.[^31]

## Comment mesurer l'objectif de 90 %

**Décision Nota.** Le KPI doit être limité à un périmètre préenregistré de préparation admissible. Pour un dossier donné :

```text
R = 1 - (minutes humaines de préparation Nota + minutes de reprise) / minutes de préparation de référence
```

La référence doit inclure la réception, le classement, les demandes, la comparaison, la production du projet, la relance, le suivi des registres et la réconciliation, selon le service. Elle doit exclure le temps de décision juridique que le notaire doit légalement exercer dans tous les cas, mais elle ne doit pas exclure artificiellement le temps du personnel ou les retards causés par une information erronée.

Le chiffre « 90 % » ne peut être publié qu'après un pilote représentatif qui mesure aussi :

- les faux positifs qui laissent passer une pièce ou une condition manquante;
- les erreurs de version ou de prêteur;
- les corrections du notaire;
- le temps demandé au client et au prêteur;
- les dossiers qui sortent du périmètre;
- les incidents de confidentialité, d'envoi, de signature, de publication et de fonds.

Une barre de qualité doit précéder toute hausse d'autonomie : aucun faux « prêt à signer » ou « prêt à financer » sur le jeu de test critique, preuve obligatoire pour tout champ critique, et revue humaine pour toute exception. Une bonne économie de tokens ne justifie pas une automatisation qui augmente les reprises ou les risques.

## Conclusion opérationnelle

La meilleure première version de Nota n'essaie pas d'être un notaire autonome. Elle fait disparaître les temps morts et la reprise manuelle : elle recueille le bon contexte une seule fois, obtient la bonne pièce, la relie au bon rôle et au bon lot, vérifie sa fraîcheur, prépare le projet avec la version actuelle, présente au notaire une liste courte de décisions et ferme le dossier avec des reçus.

La séquence recommandée est donc : **dossier de preuve → intake/OCR → instructions prêteur → titre et registres → pièces immobilières conditionnelles → système de pratique → acte et signature autorisés → publication/fonds → réconciliation et conservation**. Les parcours testament et procuration utilisent le même socle, mais avec des contrôles propres à la capacité, au consentement, aux témoins, aux registres et au routage vers le mandat de protection.

## Sources primaires consultées

Consultées le 9 septembre 2026. Les liens officiels sont privilégiés; les pages de fournisseurs servent uniquement à documenter une capacité d'intégration annoncée, jamais une obligation légale ni un accès déjà obtenu par Nota.

[^1]: LégisQuébec, *Loi sur le notariat*, art. 10–11, https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3
[^2]: LégisQuébec, *Loi sur le notariat*, art. 15 et 15.0.1, https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3
[^3]: LégisQuébec, *Loi sur le notariat*, art. 46–49, https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3
[^4]: LégisQuébec, *Règlement sur la tenue des dossiers et des études des notaires*, notamment art. 5–6, 14, 16, 19–20, https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3%2C%20r.%2017
[^5]: Chambre des notaires du Québec, *Guide sur les obligations des notaires et des fournisseurs de solutions technologiques*, https://www.cnq.org/wp-content/uploads/2022/12/533654-2022_11_28_guide_obligations_notaires_fournisseurs_v2.0.pdf
[^6]: Chambre des notaires du Québec, *Immobilier*, https://www.cnq.org/vos-services-notariaux/immobilier/
[^7]: LégisQuébec, *Code civil du Québec*, art. 2693–2694, https://www.legisquebec.gouv.qc.ca/fr/pdf/lc/CCQ-1991.pdf
[^8]: Chambre des notaires du Québec, *Facturation*, https://www.cnq.org/vos-services-notariaux/immobilier/facturation/; Gouvernement du Québec, *Fin de l'hypothèque*, https://www.quebec.ca/habitation-territoire/achat-vente/fin-hypotheque; Chambre des notaires du Québec, *Pourquoi une mainlevée et non une quittance...*, https://www.cnq.org/la-chambre-et-votre-protection/faq/pourquoi-une-mainlevee-et-non-une-quittance-lorsque-les-sommes-dues-en-vertu-dune-marge-de-credit-sont-totalement-acquittees-et-la-marge-fermee/
[^9]: Chambre des notaires du Québec, *Condo : la copropriété divise*, https://www.cnq.org/vos-services-notariaux/immobilier/condo-la-copropriete-divise/
[^10]: LégisQuébec, *Code civil du Québec*, art. 2724, https://www.legisquebec.gouv.qc.ca/fr/pdf/cs/CCQ-1991.pdf; Chambre des notaires du Québec, *La résidence familiale*, https://www.cnq.org/vos-services-notariaux/immobilier/la-residence-familiale/
[^11]: AWS, *Amazon Textract endpoints and quotas*, https://docs.aws.amazon.com/general/latest/gr/textract.html
[^12]: Dye & Durham, *Paiements immobiliers*, https://dyedurham.ca/fr/solution/paiements-immobiliers/; Assyst, *About assyst Real Estate*, https://login.assystrealestate.com/rei/help/about_assyst_real_estate.htm
[^13]: Gouvernement du Québec, *Utilisation possible du registre foncier*, https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier/utilisation-possible; Gouvernement du Québec, *Inscrire une transaction au registre foncier*, https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier/inscrire-transaction
[^14]: Chambre des notaires du Québec, *Fournisseurs de solutions technologiques aux notaires*, https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/
[^15]: Chambre des notaires du Québec, *Fournisseurs de solutions technologiques aux notaires*, https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/; Notarius, *Utilisation de ConsignO Cloud pour les actes en minute*, https://support.notarius.com/guide/ht60101/?blsc=true
[^16]: Chambre des notaires du Québec, *Votre argent confié au notaire est-il détenu en toute sécurité?*, https://www.cnq.org/la-chambre-et-votre-protection/faq/votre-argent-confie-au-notaire-est-il-detenu-en-toute-securite/
[^17]: RBC Banque Royale, *Formulaires juridiques — Québec/Nouveau-Brunswick*, https://www.rbcroyalbank.com/legalforms/index.html; formulaire courant de sûreté collatérale, https://www.rbcroyalbank.com/RBC:abPjhoOOrJeW6Q2Zfwla2gAAAHE/legalforms/download/collateral/3915_QCNB.pdf
[^18]: LégisQuébec, *Code civil du Québec*, art. 716–724, https://www.legisquebec.gouv.qc.ca/fr/document/lc/CCQ-1991/20240221
[^19]: Chambre des notaires du Québec, *Le testament*, https://www.cnq.org/vos-services-notariaux/testament-et-succession/le-testament/
[^20]: Gouvernement du Québec, *Recherche d'un testament ou d'un mandat de protection*, https://www.quebec.ca/justice-et-etat-civil/testament-succession/succession/a-faire/recherche-testament; Chambre des notaires du Québec, *Recherche aux registres*, https://www.cnq.org/la-chambre-et-votre-protection/services-de-la-chambre/recherche-aux-registres/
[^21]: Chambre des notaires du Québec, *La procuration*, https://www.cnq.org/vos-services-notariaux/protection-des-personnes/la-procuration/; Chambre des notaires du Québec, *Le mandat de protection*, https://www.cnq.org/vos-services-notariaux/protection-des-personnes/le-mandat-de-protection/; LégisQuébec, *Code civil du Québec*, art. 2166, https://www.legisquebec.gouv.qc.ca/fr/version/lc/ccq-1991?code=se%3A2166&history=20251027
[^22]: LégisQuébec, *Code civil du Québec*, art. 2130, 2135, 2175–2176, https://www.legisquebec.gouv.qc.ca/fr/pdf/cs/CCQ-1991.pdf
[^23]: Chambre des notaires du Québec, *La procuration*, https://www.cnq.org/vos-services-notariaux/protection-des-personnes/la-procuration/; Chambre des notaires du Québec, *Peut-on limiter la durée d'une procuration et peut-on la révoquer?*, https://www.cnq.org/la-chambre-et-votre-protection/faq/peut-on-limiter-la-duree-dune-procuration-et-peut-on-la-revoquer/
[^24]: Chambre des notaires du Québec, *Fournisseurs de solutions technologiques aux notaires*, https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/
[^25]: Avancie, *Intégrations et actes notariaux technologiques*, https://avancie.com/integrations/actes-notaries-technologiques/
[^26]: Gouvernement du Québec, *Inscrire une transaction au registre foncier*, https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier/inscrire-transaction; Registre foncier du Québec, *SLRI*, https://www.registrefoncier.gouv.qc.ca/sirf/guide/pf_info_slri.htm
[^27]: Registre des droits personnels et réels mobiliers, *Accueil et consultation*, https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil2.html; Gouvernement du Québec, *Structure du RDPRM*, https://servicesclients.rdprm.gouv.qc.ca/depot/aide/manuelinscription/MIC/MIC_Consult/MIC_STRUCT_RDPRM/4_1_Struct_rdprm.htm
[^28]: Gouvernement du Québec, *Rechercher une entreprise au registre des entreprises*, https://www.quebec.ca/entreprises-et-travailleurs-autonomes/obtenir-renseignements-entreprise/recherche-registre-entreprises
[^29]: Commission d'accès à l'information du Québec, *Principaux changements de la Loi 25*, https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25; LégisQuébec, *Loi sur l'accès aux documents des organismes publics et sur la protection des renseignements personnels*, art. 17, https://www.legisquebec.gouv.qc.ca/fr/pdf/lc/P-39.1.pdf
[^30]: National Institute of Standards and Technology, *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*, https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10; NIST AI RMF Playbook, https://airc.nist.gov/airmf-resources/playbook/
[^31]: AWS, *Amazon Bedrock documentation overview*, https://aws.amazon.com/documentation-overview/bedrock/; AWS, *Encryption of custom model training jobs*, https://docs.aws.amazon.com/bedrock/latest/userguide/encryption-custom-job.html
