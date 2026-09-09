# 47. La salle de signature est une cérémonie prouvée, pas une visioconférence

- Status: Accepted
- Date: 2026-09-09

## Contexte

La demande du propriétaire : « une signature complète pour le client, en
face-à-face vidéo, chiffrée de bout en bout, en plein écran, où le notaire
dicte la loi et les règles, avec un enregistrement, et une signature finale
conforme. On la présente à la Chambre des notaires. Elle doit être en bêta,
visible dans l'application, et déployée. »

Nota s'arrête aujourd'hui à la **mise en relation** (ADR 0033) : le notaire
retient l'acte, les deux parties se parlent dans la messagerie, le dossier
monte, le notaire déclare l'acte complété (`/notary/acts/complete`). Entre la
dernière pièce déposée et cette déclaration, **il n'y a rien**. La signature
elle-même se passe ailleurs, hors de Nota, et Nota n'en sait rien d'autre que
la date que le notaire lui donne après coup.

Trois faits ont cadré la décision.

1. **La réception à distance existe déjà en droit québécois, et elle est
   encadrée.** L'acte notarié en minute sur support technologique est reçu par
   le notaire pendant que celui-ci **voit et entend chaque partie**, et que
   chaque partie **le voit et l'entend**, simultanément et en temps réel. La
   Chambre des notaires publie les *Normes concernant l'acte notarié en minute
   sur un support technologique* (refonte du 27 octobre 2023, modifiées le
   22 février 2024) et référence les fournisseurs de solutions technologiques
   admis. La clôture de l'acte se fait par la **signature numérique officielle**
   du notaire, et la minute est conservée dans le greffe numérique. Le fait
   qu'une personne signe à distance doit être **indiqué dans l'acte, à
   l'endroit où elle signe**.

2. **Nota ne peut pas se substituer à cette chaîne, et ne doit pas prétendre
   le faire.** La signature juridique, le certificat du notaire, la minute et
   le greffe appartiennent au fournisseur admis par la Chambre. Une session
   précédente, travaillée hors de ce dépôt, avait d'abord conclu que seul Teams
   était admis, puis s'était corrigée : la Chambre publie des **critères** pour
   un service de visioconférence, ce qui ouvre une porte à évaluer. Cette ADR
   ne tranche pas cette évaluation — elle n'appartient pas à Nota — mais elle
   construit la salle de manière à ce que la question posée à la Chambre soit
   **une question d'évaluation d'un service, pas une demande de dérogation**.

3. **Ce qui manque à la profession n'est pas une fenêtre vidéo.** Teams, Zoom
   et consorts donnent l'image et le son. Aucun ne donne au notaire ce que la
   réception à distance lui coûte vraiment : la **preuve**, reconstituable des
   années plus tard, qu'à l'instant de la signature il voyait et entendait la
   personne, qu'il l'avait identifiée, qu'il lui avait lu ce qu'il devait lui
   lire, qu'elle avait consenti, et que le lien n'avait pas été coupé entre
   deux. Aujourd'hui cette preuve est la mémoire du notaire et ses notes.

## Décision

Nota construit une **salle de signature** : une cérémonie conduite par le
notaire, en plein écran, sur un lien vidéo chiffré de bout en bout entre les
deux seuls participants, dont **chaque instant est consigné dans un
procès-verbal scellé** que ni Nota ni le notaire ne peuvent réécrire.

La ligne de partage, tenue partout dans le code et dans l'interface :

> **La cérémonie est de Nota. La signature juridique est du fournisseur admis
> par la Chambre. La preuve est de Nota, et elle est remise au notaire.**

### 1. Quatre portes, et aucune ne s'ouvre toute seule

La signature ne peut pas être libérée tant que les quatre ne sont pas ouvertes,
et le domaine (`salleReadiness`) est le seul à décider laquelle est ouverte :

| Porte | Ce qu'elle établit | Ce qui l'ouvre |
| --- | --- | --- |
| `compte` | Le participant est une personne authentifiée sur Nota, pas un porteur de lien. | Une session vérifiée des deux côtés (ADR 0044) — jeton `client` pour le client, `session` pour le notaire. |
| `identite` | L'identité légale a été vérifiée, avec une méthode et une heure. | Une attestation d'identité inscrite au dossier, portant sa méthode, son horodatage et son vérificateur. |
| `lien` | Le canal est privé et personne ne s'est interposé. | Les deux pairs affichent la **même chaîne d'authentification courte**, dérivée des deux empreintes DTLS, et le notaire confirme à voix haute qu'elles concordent. |
| `presence` | Le notaire voit et entend, sans interruption. | Les deux pistes vidéo et audio sont vivantes, et aucune coupure n'a dépassé le seuil de tolérance depuis l'ouverture de l'étape. |

**Une porte qui se referme suspend la cérémonie.** Ce n'est pas un avertissement :
`salleReadiness` fait passer la salle à `suspendue`, la signature redevient
impossible, et la reprise repart de l'étape en cours — jamais plus loin. Une
coupure de vingt secondes pendant la lecture des obligations fait relire les
obligations.

### 2. Le chiffrement de bout en bout est structurel, pas une option

Le média circule en **WebRTC pair à pair**, chiffré par DTLS-SRTP. Il n'y a
**aucun serveur média** : pas de SFU, pas de MCU, pas de pont d'enregistrement.
Nota ne peut pas déchiffrer la cérémonie, parce que Nota n'est jamais sur le
chemin du média — la seule chose qui transite par le serveur est la
signalisation (SDP et candidats ICE), et elle est inutile à qui n'a pas les
clés.

La conséquence est assumée et elle est écrite dans l'interface : **en mode
strict, il n'y a pas d'enregistrement.** Un enregistrement côté serveur
exigerait un troisième déchiffreur, et il n'y a pas de manière honnête
d'appeler « bout en bout » un canal à trois. L'enregistrement existe, il est
décrit au §4, et il ne vit pas au même endroit.

### 3. Le notaire conduit, et ce qu'il dit est écrit d'avance

La cérémonie est une suite d'étapes ordonnées, définies dans le domaine
(`CEREMONIE_ETAPES`), que seul le notaire fait avancer :

1. `accueil` — les parties se voient, le notaire se nomme et nomme l'acte ;
2. `identite` — vérification de l'identité de chaque partie ;
3. `lien` — les deux chaînes d'authentification sont lues à voix haute et
   confirmées ;
4. `consentement` — la portée de l'enregistrement et du procès-verbal est
   annoncée, et chaque partie répond ;
5. `lecture` — le notaire lit l'acte et les obligations qui s'y rattachent ;
6. `questions` — la partie pose ses questions et le notaire y répond ;
7. `signature` — la signature est libérée vers le flux admis par la Chambre ;
8. `cloture` — le procès-verbal est scellé et remis.

Chaque étape porte son **texte de conduite** en français canonique — ce que le
notaire a à dire, et ce qu'il doit constater avant de passer à la suivante. Ce
texte est du domaine, pas de la maquette : il est traduit comme le reste
(règle 3 de `AGENTS.md`) et il est le même dans l'interface, dans le
procès-verbal et dans les tests.

Le notaire ne peut pas sauter une étape. Il peut **revenir en arrière**, et le
retour est lui aussi consigné : une lecture reprise est un fait, pas une
correction.

### 4. L'enregistrement est un choix des deux parties, jamais un défaut

Trois modes, portés par le domaine, choisis avant l'ouverture de la salle :

- `strict` — **défaut**. Bout en bout, aucun enregistrement. La preuve est le
  procès-verbal.
- `temoin` — la cérémonie est enregistrée **localement dans le navigateur du
  notaire**, chiffrée dans le navigateur avant tout envoi, puis déposée dans le
  seau des documents. Nota conserve les octets sans pouvoir les lire ; la clé
  est remise au notaire et à lui seul. Exige le consentement explicite et
  horodaté des deux parties, recueilli à l'étape `consentement`.
- `aucun` — ni enregistrement, ni procès-verbal scellé. Réservé aux
  répétitions et à la démonstration ; **une salle en mode `aucun` ne peut pas
  atteindre l'étape `signature`**.

Le consentement se retire. Un retrait pendant la cérémonie arrête
l'enregistrement à l'instant, et l'arrêt est consigné.

### 5. Le procès-verbal est une chaîne, et il est scellé

Chaque fait de la cérémonie — porte ouverte, porte refermée, étape franchie,
consentement donné ou retiré, coupure et reprise, signature libérée — devient
une **entrée chaînée** : `empreinte(n) = SHA-256(empreinte(n-1) ‖ entrée(n))`.
La clôture scelle la chaîne et publie son empreinte finale.

Ce que cela donne, et qui n'existe nulle part ailleurs dans le produit :
retirer une entrée, en insérer une, ou déplacer une heure change l'empreinte
finale. Le notaire repart avec le procès-verbal **et** son empreinte ; Nota
garde la même empreinte dans la piste d'audit inaltérable (ADR 0036). Deux
copies indépendantes de la même vérité, et il n'est au pouvoir d'aucune des
deux parties de les faire concorder après coup sur un mensonge.

Le procès-verbal ne contient **jamais** le contenu de l'acte, ni ce qui a été
dit. Il contient ce qui s'est passé, quand, et qui l'a constaté.

### 6. La signature juridique sort par la porte admise

`signature-port.js` est un **port**, à l'image de `stripe-port` et de
`storage-port`. Il expose une seule opération : remettre l'acte et le
procès-verbal au flux de signature admis par la Chambre, et recevoir en retour
la référence de la minute.

Deux adaptateurs :

- `demonstration` — le seul actif en bêta. Il produit une référence de
  démonstration, marquée comme telle dans chaque écran, chaque courriel et
  chaque procès-verbal. **Il ne peut pas produire de minute.**
- l'adaptateur du fournisseur admis — l'interface est écrite, la configuration
  est prévue (`NOTA_SIGNATURE_FOURNISSEUR`), et il n'est **pas** implémenté
  dans cette ADR. Le brancher est une décision du propriétaire, prise après
  l'entente avec le fournisseur et la Chambre.

**Aucun acte réel ne peut être reçu dans la salle tant que l'adaptateur admis
n'est pas configuré.** Ce n'est pas une consigne : le domaine refuse l'étape
`signature` quand le fournisseur est `demonstration` et que la salle n'est pas
marquée `demonstration`.

### 7. La bêta se dit bêta, partout

La salle est visible dans l'application dès maintenant, et elle porte son état :

- une pastille « Bêta » sur la carte du carnet et dans l'espace notaire ;
- un bandeau permanent dans la salle : *« Bêta — démonstration. Aucun acte
  notarié n'est reçu ici. La signature juridique passe par le flux admis par
  la Chambre des notaires. »* ;
- le procès-verbal d'une salle de démonstration porte la mention en tête, et
  son empreinte est calculée sur une entrée qui la contient : un procès-verbal
  de démonstration ne peut pas être présenté comme autre chose.

## Ce que cette ADR ne décide pas

- **Elle ne prétend pas que Nota est conforme.** La conformité d'un service de
  visioconférence aux normes de la Chambre s'établit par une évaluation, contre
  les critères publiés, par la Chambre. Cette ADR construit le dossier de cette
  évaluation ; elle ne la remplace pas. Aucune surface du produit n'affirme
  une approbation qui n'existe pas.
- **Elle ne choisit pas le fournisseur de vérification d'identité.** La porte
  `identite` accepte une attestation ; d'où elle vient est une décision
  ultérieure. La liste d'un fournisseur chez un tiers ne vaut pas approbation
  de ses vérifications par la Chambre.
- **Elle ne provisionne pas de serveur TURN.** La traversée de NAT symétrique
  exige un relais. Le code mint des identifiants TURN à durée limitée dès que
  `NOTA_TURN_URL` et `NOTA_TURN_SECRET` sont configurés ; l'infrastructure du
  relais est un coût que le propriétaire décide d'engager. Sans lui, la salle
  fonctionne sur la majorité des réseaux domestiques et échoue proprement, avec
  un message qui nomme la cause, sur les autres.

## Conséquences

- `packages/domain` gagne la machine à états de la salle, les quatre portes,
  les étapes et leurs textes de conduite, les modes d'enregistrement et la
  chaîne d'empreintes. Aucune de ces règles n'est réécrite ailleurs.
- `apps/api` gagne la signalisation (par sondage sur le Lambda existant — il
  n'y a pas de WebSocket dans cette infrastructure, et une poignée de messages
  SDP/ICE n'en exige pas), les routes de la salle, le scellé, et le port de
  signature.
- `apps/web` gagne un mode plein écran, deux vidéos, le rail de conduite du
  notaire, la confirmation de la chaîne d'authentification et la reprise après
  coupure. Toujours zéro dépendance d'exécution : WebRTC, `MediaRecorder`,
  `crypto.subtle` sont des interfaces du navigateur.
- `infra` doit rouvrir ce qu'il avait fermé : `Permissions-Policy` interdit
  aujourd'hui `camera` et `microphone` sur tout le domaine, et la CSP n'autorise
  ni `media-src blob:` ni le relais TURN. Une salle de signature sur une page
  qui interdit la caméra est une page blanche.

## Références

- *Normes concernant l'acte notarié en minute sur un support technologique*,
  Chambre des notaires du Québec, refonte du 27 octobre 2023, modifiée le
  22 février 2024.
- *Fournisseurs de solutions technologiques aux notaires*, Chambre des notaires
  du Québec — la liste des solutions admises et les critères d'un service de
  visioconférence.
- *Loi concernant le cadre juridique des technologies de l'information* — la
  valeur juridique d'un document technologique et l'exigence d'intégrité qui la
  porte.
- ADR 0033 — la mise en relation est complète, et la conversation est le canal.
- ADR 0036 — la piste d'audit nomme son acteur.
- ADR 0044 — le compte existe des deux côtés.

> Les renvois d'article précis aux *Normes* et à la *Loi sur le notariat* sont
> délibérément absents de ce document. Ils n'ont pas pu être vérifiés contre le
> texte officiel depuis cet environnement, et une ADR qui cite un article qu'elle
> n'a pas lu est pire qu'une ADR qui n'en cite aucun. Ils sont à ajouter, contre
> le texte, avant la présentation à la Chambre.
