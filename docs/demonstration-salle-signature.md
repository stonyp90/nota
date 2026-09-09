# La salle de signature — plan de démonstration et feuille de route

Ce document sert deux lecteurs : celui qui prépare la présentation à la Chambre
des notaires, et celui qui reprend le code après nous. La décision, elle, est
dans [l'ADR 0047](decisions/0047-la-salle-de-signature-est-une-ceremonie-prouvee.md) ;
ce qui est tenu, et par quel test, est dans
[`salle-signature-exigences-tenues.md`](salle-signature-exigences-tenues.md).

Le plan RÉGLEMENTAIRE, lui — le classement du rôle de Nota, les fournisseurs
autorisés, les textes de la Chambre et ce qu'il faut leur faire confirmer par
écrit — est dans [`secure-signing-plan.md`](secure-signing-plan.md). Il est
sourcé contre les documents publics ; ce document-ci ne l'est pas et ne le
remplace pas. C'est un scénario de présentation.

---

## 1. Ce que la Chambre doit entendre en une phrase

> Nota ne remplace ni la signature numérique officielle, ni le greffe. Nota
> donne au notaire la **preuve** de sa réception à distance — celle qu'il porte
> aujourd'hui de mémoire.

Tout le reste de la présentation sert cette phrase. La tentation, en montrant
une belle salle vidéo, est de laisser croire qu'on remplace la chaîne admise.
C'est la seule manière certaine de perdre la salle.

## 2. La démonstration — douze minutes

Deux appareils, deux comptes, un acte de financement fictif. Un notaire réel
si l'un accepte de tenir le rôle ; sinon le rôle est tenu par nous et annoncé
comme tel.

| Temps | Écran | Ce qui est dit |
| --- | --- | --- |
| 0:00 | Le carnet, la carte « Salle de signature · Bêta » | Là où Nota s'arrête aujourd'hui : le notaire retient, les parties se parlent, le dossier monte, et la signature se passe ailleurs. |
| 1:00 | La salle s'ouvre, plein écran, deux vidéos | Le lien est pair à pair. Il n'y a pas de serveur média. Nota ne peut pas écouter, parce que Nota n'est pas sur le chemin. |
| 2:00 | Le rail des quatre portes, trois fermées | Rien ne s'ouvre tout seul. Voilà ce qui manque, et pourquoi. |
| 3:00 | La porte `compte` s'ouvre | Deux comptes authentifiés, des deux côtés. Pas un porteur de lien. |
| 4:00 | La porte `identite` s'ouvre | L'identité est établie hors du canal vidéo, et l'attestation porte sa méthode et son heure. |
| 5:00 | Les deux chaînes d'authentification, lues à voix haute | Les deux écrans affichent la même chaîne. Si quelqu'un s'était interposé, elles différeraient. C'est le notaire qui confirme, pas le logiciel. |
| 6:00 | Le consentement | En mode strict il n'y a pas d'enregistrement, et on explique pourquoi : un enregistrement serveur exigerait un troisième déchiffreur. |
| 7:00 | La lecture, texte de conduite à l'écran | Ce que le notaire a à dire est écrit, et le procès-verbal note qu'il l'a dit. |
| 8:00 | **On débranche le réseau du client** | Le moment de la démonstration. La salle passe à `suspendue`, la signature redevient impossible. |
| 9:00 | La reprise | Elle repart de l'étape en cours, jamais plus loin. La coupure **et** la reprise sont au procès-verbal. |
| 10:00 | L'étape `signature` | Elle sort par un port vers le flux admis par la Chambre. En bêta, l'adaptateur de démonstration ne peut pas produire de minute, et il le dit. |
| 11:00 | Le procès-verbal scellé, son empreinte | On modifie une heure devant eux, l'empreinte change. Le notaire repart avec sa copie ; Nota garde la même empreinte dans un journal qu'il ne peut pas réécrire. |
| 12:00 | La question | « Quels critères devons-nous satisfaire pour que cette salle soit évaluée ? » |

**La dernière minute est la seule qui compte.** On ne demande pas une
approbation, on demande le chemin de l'évaluation.

### Ce qu'on ne fait pas pendant la démonstration

- On n'affirme aucune approbation, aucune conformité établie, aucune
  certification. Le bandeau bêta reste à l'écran d'un bout à l'autre.
- On ne reçoit aucun acte réel. L'adaptateur admis n'est pas branché, et le
  domaine refuse l'étape `signature` hors démonstration tant qu'il ne l'est pas.
- On ne montre pas de vérification d'identité d'un fournisseur qu'on n'a pas
  choisi. La porte `identite` est ouverte par une attestation de démonstration,
  annoncée comme telle.

### La panne, si elle arrive

Le risque réel est le réseau de la salle où l'on présente. Trois parades, dans
l'ordre : un partage de connexion mobile préparé d'avance ; la vidéo enregistrée
de la cérémonie complète (§5) ; et, si tout tombe, le procès-verbal scellé d'une
répétition, imprimé, avec son empreinte — la démonstration de la preuve n'a pas
besoin du réseau.

## 3. L'état réel du code

Ce qui est construit, dans ce dépôt, et couvert par des tests :

- la machine à états de la salle, les quatre portes, les huit étapes et leurs
  textes de conduite, les trois modes d'enregistrement, la chaîne d'empreintes
  — dans `packages/domain` ;
- la signalisation WebRTC par sondage, les routes de la salle, le scellé, les
  identifiants TURN à durée limitée, le port de signature — dans `apps/api` ;
- la salle plein écran, les deux vidéos, la chaîne d'authentification, le rail
  de conduite, la reprise après coupure, l'enregistrement chiffré côté
  navigateur, le bandeau bêta — dans `apps/web`, toujours sans dépendance
  d'exécution ;
- une connexion WebRTC **réelle** entre deux pairs, avec caméras simulées, dans
  `e2e/salle-signature.spec.js`.

Ce qui ne l'est pas, et qui est nommé dans les exigences : l'évaluation par la
Chambre, l'adaptateur du fournisseur admis, le fournisseur d'identité, le relais
TURN, l'audit externe.

## 4. La feuille de route

| Étape | Contenu | Bloqué par |
| --- | --- | --- |
| **Bêta** — faite | La salle, la preuve, la démonstration. Aucun acte réel. | — |
| **1. Le relais** | Provisionner TURN, brancher `NOTA_TURN_URL` / `NOTA_TURN_SECRET`. La salle marche alors sur tous les réseaux. | Un coût d'infrastructure à engager. |
| **2. L'identité** | Choisir le fournisseur de vérification, écrire l'adaptateur, remplacer l'attestation de démonstration. | Un choix du propriétaire, et l'avis de la Chambre sur ce qu'elle accepte. |
| **3. L'évaluation** | Présenter la salle contre les critères publiés, obtenir le chemin d'évaluation. | La démonstration. |
| **4. La signature admise** | Écrire l'adaptateur du fournisseur admis, brancher `NOTA_SIGNATURE_FOURNISSEUR`. | Une entente avec le fournisseur. |
| **5. L'audit** | Audit de sécurité externe de la salle et de la chaîne de preuve. | Un budget. |
| **GA** | Lever le bandeau bêta — et pas avant que 1 à 5 soient faits. | Tout ce qui précède. |

L'ordre n'est pas négociable sur un point : **le bandeau bêta ne se lève pas
avant l'étape 5.** Une salle de signature notariée qui se déclare prête sans
audit externe est un risque pour le notaire qui l'utilise, pas seulement pour
Nota.

## 5. La vidéo de démonstration

Elle est produite par le code, pas par une capture d'écran à la main :
`npm run demo:salle` joue la cérémonie complète dans deux navigateurs réels et
en sort un enregistrement. Le scénario, la narration, les chapitres et le texte
de publication sont dans
[`go-to-market/video-salle-signature.md`](go-to-market/video-salle-signature.md).

La vidéo porte la mention bêta en incrustation permanente, pas seulement dans
le titre : une capture d'écran d'une vidéo circule sans son titre.
