# 0044. Le compte existe des deux côtés, et la porte d'inscription dit la vérité

Date : 2026-09-05

Statut : accepté. **Rouvre une décision que l'ADR 0033 avait explicitement
laissée ouverte ; ne retire rien à l'ADR 0009, 0024, 0026 ni 0030.**

## Contexte

Trois surfaces portaient le mot « compte » sans en tenir la promesse, et la
porte d'entrée mentait à celui qui frappait.

**1. L'inscription du notaire était un cul-de-sac.** `authSubmitEmail` appelait
`ncSignIn` quel que soit le mode. Or `/notary/session/request` est
volontairement anti-énumération : pour une adresse qui n'est pas encore
notaire, elle répond `200` et **n'envoie rien**. L'écran affirmait pourtant
« Nous venons d'envoyer un lien de connexion sécurisé à … ». Aucun courriel
n'arrivait jamais. Le bouton « Créer mon compte gratuit » aggravait la chose :
il appelait `/notaries/connect`, qui rend `503` tant que la facturation n'est
pas configurée — l'état de la production. `POST /notaries/signup`, la porte
SANS Stripe, était construite et testée (14 tests) et **n'avait aucun appelant
web**. `POST /admin/notaries/{id}/activer`, qui seule pose `approuveLe` et
ouvre la console, **n'avait aucun appelant admin**. Un notaire ne pouvait donc
littéralement pas s'inscrire, et rien n'aurait vidé la file s'il l'avait pu.

**2. Le client n'avait de dossier que sur un appareil.** Ses offres et les
jetons qui les ouvrent vivaient dans le `localStorage`. Vider son navigateur ou
changer de téléphone vidait « Mes offres » — alors que le serveur tenait le
dossier depuis toujours : l'index `CLIENT#<courriel>` est écrit à CHAQUE
publication et relu par une Query bornée. Son unique lecteur était la console
d'opérateur (droit d'accès Loi 25).

**3. Le partenaire n'avait pas de reprise.** Son code, son type et son lien ne
vivaient que dans `nota.partner.v1`. Les perdre était définitif : la seule
reprise consistait à re-réclamer le MÊME code, celui qu'on venait de perdre.

Le verrou à ne pas forcer : `/client/welcome` accepte n'importe quelle adresse,
sans preuve ni freinage. Rendre les offres sur une adresse nue aurait fait de
l'index `CLIENT#` une porte d'ÉNUMÉRATION (« qui est client ? ») et de reprise
de compte.

## Décision

**Le mode décide, parce que l'API ne le peut pas.** « Se connecter » demande un
lien ; « S'inscrire » dépose un dossier. Ce sont deux gestes, plus un seul.

**Côté notaire.** L'inscription ouvre l'étape d'inscription, jamais l'écran
« vérifiez votre boîte ». Elle appelle `/notaries/signup` — aucun Stripe sur ce
chemin : l'accès à la console est l'approbation de l'OPÉRATEUR (`approuveLe`),
et les versements se branchent plus tard, depuis la console. Une quatrième
étape dit la vérité de ce que la route fait (`status: 'en_attente'`) : le
dossier est déposé, l'Ordre est vérifié, un courriel suivra. Elle ne promet
aucune ouverture immédiate. La console d'opérateur reçoit la file
d'approbation qui manquait — au-dessus du tableau d'honneur, car approuver est
le geste du jour et le classement n'est qu'une vue.

**Côté client.** Une poignée de main en deux temps, calquée sur le lien magique
du notaire et du soutien (ADR 0026) :

- `POST /client/session/request` — freinée par IP (échoue OUVERT),
  anti-énumération : une adresse connue et une inconnue rendent le MÊME corps,
  et un défi est posé dans les deux cas pour que les deux coûtent le même temps.
- `POST /client/session/verify` — consomme le défi à usage unique et rend les
  offres, **chacune avec un jeton CLIENT frais**.

**Ce qu'on ne fabrique PAS : une portée « personne ».** `requireClient` exige
toujours `sub === bid.id`. Le lien prouve la BOÎTE et rend les capacités que le
client possédait déjà — une par offre, courtes, révocables par expiration. La
frontière de sécurité dont dépend chaque route `/client/*` ne bouge pas d'un
pouce.

**Côté partenaire.** `POST /partenaires/rappel` renvoie le code par courriel.
C'est un rappel, pas une réclamation : rien n'est créé, rien n'est modifié, et
un code seulement réclamé (jamais confirmé) n'est pas rappelé — ce serait
transformer une réclamation en l'air en preuve.

**Côté vérité de la console notaire.** « Vos revenus » lisait le cache local,
semé par la fenêtre de quatre mois VERS L'AVANT du fil : un notaire chevronné
sur un navigateur neuf lisait « 0 $ ». Les tuiles lisent désormais les `totaux`
de `/notary/acts` — le registre `ACT#`, qui fait foi. Le relevé part donc avec
la console, plus au dépli du panneau. Une panne ne dit jamais « zéro ».

## Conséquences

- **La piste d'audit nomme sans exposer.** `client_lien_demande`,
  `client_espace_ouvert` et `partenaire_rappel` portent un identifiant DÉRIVÉ
  (`clientIdForEmail`, SHA-256), jamais l'adresse en clair : un journal
  conservé des années ne doit pas être un carnet d'adresses.
- **Une liste vide est un 200, jamais un 404.** La personne a prouvé sa boîte ;
  elle n'a simplement rien publié. Un 404 dirait qui est client.
- **La réhydratation FUSIONNE.** Le jeton du serveur gagne (il est neuf), mais
  le progrès local — « retenue », l'étude, un montant renégocié — survit. Un
  remplacement pur ferait régresser un appareil déjà à jour.
- **Le jeton ne survit jamais dans l'URL.** `#cauth=` est retiré AVANT le
  réseau : une barre d'adresse se copie, se partage et entre dans l'historique.
- **`/partenaires/rappel` parcourt le registre** (`listPartners`, une Query
  bornée sur GSI1, jamais un Scan) et filtre par adresse. C'est le même chemin
  d'accès que l'analytique ; si le registre grossit, il faudra un index par
  adresse.
- **Le courriel devient testable en local.** La pile locale n'avait AUCUN
  mailer : `notifier()` rendait `null`, donc rien de ce qui passe par le
  courriel n'était exerçable ici. `createFileMailer` écrit chaque message dans
  `.local-mail/` et imprime le lien dans la console. `NOTA_SITE_URL` manquait
  aussi : les liens partaient VIDES.
- **Pas de Keycloak, pas de mot de passe.** La vérification du courriel est
  INTRINSÈQUE au lien — posséder la boîte EST la preuve. Un mot de passe
  ajouterait une créance de sécurité (Loi 25) que Nota n'a pas aujourd'hui, un
  service avec état devant une pile Lambda + DynamoDB, et une SIXIÈME mécanique
  d'authentification à côté des cinq déjà sans mot de passe (notaire, admin,
  partenaire, soutien, client). Si un jour une étude exige un SSO d'entreprise,
  c'est devant la console NOTAIRE qu'il se poserait, en s'ajoutant.

## Complété le 6 septembre

Trois manques nommés le 5 ont été fermés, parce qu'ils rendaient la reprise
incomplète ou le mot « déconnexion » faux :

- **Le dossier revient avec l'offre.** `/client/bid` ne rendait que
  `readiness` — un COMPTE dérivé du dossier — jamais le dossier lui-même : la
  reprise redonnait la demande et une liste de documents vide. Il est désormais
  rendu, et replié côté appareil par FUSION : le serveur ne connaît que ce qu'on
  lui a poussé, donc un objet vide ne vaut jamais « efface tout », et une
  réponse déjà présente sur l'appareil gagne.
- **La déconnexion efface vraiment.** Elle promettait « vos coordonnées, vos
  offres publiées, votre dossier et vos notifications » et n'effaçait que
  quatre clés sur la dizaine que le client possède. Restaient
  `nota.offerstatus.v1` — le nom et le courriel du notaire retenu, le CORPS des
  messages, l'état de la caution, les chiffres d'annulation — et
  `nota.docitems.v1`, qui nomme les documents. Sur un poste partagé, tout cela
  restait. Les dix clés de la session client partent maintenant ensemble, la
  phrase nomme les échanges, et ce qui n'appartient pas à cette session (la
  session notaire, le code partenaire) n'est pas touché.
- **Le journal des envois a un écrivain.** `appendSubjectEvent` était présent
  dans les deux adaptateurs et lu par `assemblerDossier`, sans qu'aucun chemin
  de production n'écrive : le dossier remis à un usager qui exerce son droit
  d'accès affirmait donc, en creux, que Nota ne lui avait jamais écrit. L'appel
  est posé dans `sendOnce`, APRÈS l'envoi réussi — un envoi refusé ou en erreur
  ne s'inscrit pas — et au mieux : la trace cède, jamais l'envoi.

## Les portes sociales, annoncées (6 septembre)

Le 28 août, les boutons sociaux avaient été RETIRÉS : « No dead social doors —
they return the day OAuth is actually wired. » Le propriétaire les rouvre, sans
câbler OAuth. Ce qui rend la chose honnête plutôt que décorative :

- **Le courriel reste PREMIER.** La convention du web met les boutons sociaux
  en haut, mais elle suppose qu'ils fonctionnent. Trois boutons morts au-dessus
  du seul chemin qui marche feraient cliquer là d'abord, pour rien. Ils vivent
  donc sous le séparateur, et remonteront le jour où OAuth est câblé.
- **`aria-disabled`, jamais `disabled`.** L'attribut natif retire le bouton du
  parcours clavier : on ne peut pas découvrir ce qu'on ne peut pas atteindre.
  Chaque porte reste tabulable, porte son marqueur d'état, et pointe par
  `aria-describedby` vers la note qui dit quoi faire en attendant.
- **Le clic RÉPOND, et dans la modale.** Une `<dialog>` ouverte par
  `showModal()` occupe la couche supérieure du navigateur : un toast ajouté au
  `<body>` peindrait dessous, invisible là même où l'on vient de cliquer. La
  réponse est donc une ligne `role="status"` DANS la carte, ramenée à l'écran
  (`scrollIntoView`) — sans quoi, sur un écran court, elle naissait sous la
  pliure et le clic paraissait n'avoir rien fait.
- **Les marques gardent leurs couleurs**, parce que c'est ce qui les rend
  reconnaissables, et le « G » de Google reste multicolore sur une pastille
  blanche comme sa charte l'exige. Mais on ne reproduit PAS le bouton officiel
  « Sign in with Google » : sa forme exacte annonce une intégration qui
  fonctionne, et il n'y a rien au bout.
- **L'ordre suit le métier** : LinkedIn d'abord pour un notaire (réseau
  professionnel), Google d'abord pour un client.
- **Une bascule inscription ↔ connexion** vit désormais dans la modale, avec
  l'adresse déjà tapée et le rôle choisi. C'était le vrai manque de la porte :
  il fallait la fermer et viser l'autre bouton de l'en-tête.

Le jour où OAuth sera câblé, il restera à décider ce que Nota reçoit de chaque
fournisseur et à le faire consentir explicitement (Loi 25) — une porte sociale
transmet des renseignements personnels à un tiers, ce que le lien magique ne
fait pas.

## Ce qui reste ouvert

- Les préférences du client (les neuf interrupteurs de la cloche) restent sur
  l'appareil, alors que celles du notaire sont au serveur depuis l'ADR 0033 §3.
  Elles se rattacheraient naturellement à ce que cette décision met en place.
- `clientNotifSubject` reste calculé sur l'empreinte du JETON : deux jetons
  pour la même offre écrivent dans deux partitions différentes.
- **Les liens d'authentification ne sont pas au journal des envois**, parce
  qu'ils contournent `sendOnce` par construction (ils doivent repartir à chaque
  demande). C'est une frontière ASSUMÉE, pas un oubli : journaliser chaque lien
  magique remplirait le dossier d'un usager de ses tentatives de connexion,
  c'est-à-dire d'une trace de sécurité, là où la section répond à « quels
  messages m'avez-vous envoyés ».
