# 0045. Keycloak ne capte que le courriel, et la vérification reste chez nous

Date : 2026-09-06

Statut : accepté. **Renverse la conséquence « Pas de Keycloak » de l'ADR 0044.**
Ne retire rien à l'ADR 0026 (le lien magique), qui reste la porte des cinq
mécaniques existantes.

## Contexte

L'ADR 0044, accepté la veille, écartait Keycloak pour trois raisons : la
vérification du courriel est intrinsèque au lien magique, un mot de passe
ajouterait une créance de sécurité Loi 25, et ce serait une sixième mécanique
d'authentification. Ces trois raisons restent vraies.

Le propriétaire a néanmoins demandé Keycloak, et l'ADR 0044 laissait lui-même la
porte ouverte : « Si un jour une étude exige un SSO d'entreprise, c'est devant la
console NOTAIRE qu'il se poserait, en s'ajoutant. » La demande arrive plus tôt
que prévu, et elle est légitime : une étude notariale qui compte dix personnes
ne gérera pas dix boîtes séparées, et un acquéreur éventuel attend un
fournisseur d'identité standard plutôt qu'un mécanisme maison.

Le risque de l'exercice n'est donc pas d'ajouter Keycloak. C'est de le laisser
**devenir la source de vérité**. Un fournisseur d'identité qui détient les
profils, les rôles et l'état de vérification devient un second système de
dossiers, hors de la table unique, hors de la piste d'audit, et hors de ce que
Nota peut produire dans un droit d'accès.

## Décision

**Keycloak ne capte qu'une chose : le courriel.** Le royaume `nota` est
configuré pour n'avoir rien d'autre à détenir — l'adresse est l'identifiant
(`registrationEmailAsUsername`), elle n'est pas modifiable
(`editUsernameAllowed: false`), et aucun attribut de profil n'est demandé. Le
port `claimsToLink()` applique la même discipline du côté de l'API : il retient
`sub` et `email`, et **rien d'autre**. Un jeton qui porte un nom, un téléphone
ou des rôles voit ces claims ignorées, et un test le vérifie.

**La vérification du courriel est un fait de NOTRE base.** `verifyEmail` est à
`false` dans le royaume : on interdit à Keycloak de faire ce qu'il sait faire.
L'item `IDENTITY#<sub>` porte `courrielVerifieLe`, écrit par Nota, jamais copié
du fournisseur. `verificationDecision()` lit bien `email_verified` du jeton,
mais seulement pour le reporter dans `selonLeFournisseur` et nommer la
`divergence` ; cette claim n'entre jamais dans `verifie`.

Deux raisons, et aucune n'est théorique :

1. **Loi 25.** Nota doit pouvoir répondre « voici quand et comment cette adresse
   a été prouvée » dans un droit d'accès. Un booléen posé par un service tiers,
   sans horodatage ni méthode dans notre dossier, n'est pas une réponse que Nota
   peut produire.
2. **Un fournisseur se remplace.** Le jour où Keycloak cède la place au SSO
   d'une étude, la vérification ne doit pas partir avec lui.

**Nos jetons restent la frontière de sécurité.** Keycloak est une porte
d'entrée, pas une autorisation. Une fois le jeton d'identité vérifié et le lien
posé, l'API frappe son propre jeton HMAC par `signToken` — le même que le lien
magique. Conséquence directe : `requireClient`, `requireNotary` et toutes les
gardes existantes ne bougent pas d'une ligne, et aucune route ne fait confiance
à un jeton émis ailleurs que chez nous.

**Ports et adaptateurs.** `identity-port.js` est PUR : formes de clés et
décisions, aucune entrée-sortie, aucune dépendance à Keycloak ni à DynamoDB.
`keycloak-port.js` est l'adaptateur : découverte, échange de code, vérification
RS256. Remplacer le fournisseur ne touche pas une ligne de décision.

**Zéro dépendance ajoutée.** La vérification RS256 se fait avec `node:crypto`
seul. Ajouter une bibliothèque JWT pour trois appels aurait mis un tiers de plus
sur le chemin de l'authentification.

## Conséquences

- **Les clés vivent dans `identity-port.js`, pas dans `keys.js`.** `keys.js`
  était en cours d'édition par d'autres sessions au moment de l'écriture, et un
  ajout en fin de fichier partagé est exactement la zone d'append concurrent qui
  fait perdre du travail. Si ces clés doivent un jour rejoindre `keys.js`, ce
  sera un déplacement délibéré, pas un effet de bord.
- **Aucun service ne dépend de Keycloak.** Sans `NOTA_KEYCLOAK_ISSUER`, le port
  se déclare non configuré, les routes `/auth/keycloak/*` répondent 503, et le
  carnet, la console, la messagerie et les cinq mécaniques sans mot de passe
  continuent exactement comme avant.
- **Le royaume ne peut pas se commenter lui-même.** L'importateur de Keycloak
  rejette tout champ inconnu, `_comment` compris, et le conteneur refuse alors
  de démarrer. Les raisons sont dans `docker/keycloak/README.md`.
- **Le port est 8081, pas 8080.** Sur une machine de développement, 8080 est
  déjà pris par Docker Desktop, et un port occupé fait échouer `up` sans dire
  pourquoi.
- **L'émetteur exigé est l'adresse publique.** `http://localhost:8081/realms/nota`,
  celle que le navigateur atteint, parce que c'est elle qui signe la claim `iss`.
  Même distinction que `NOTA_DOCS_PUBLIC_ENDPOINT`.
- **PKCE est obligatoire.** Le client est public, donc le code d'autorisation ne
  vaut rien sans le vérificateur qui ne quitte jamais l'appareil.
- **La vérification échoue fermé sur tout** : signature, `alg: none`, émetteur,
  destinataire, expiration, clé inconnue. Chacune a son test d'échec, parce
  qu'une vérification qu'on ne teste pas en échec est une vérification dont on
  ne sait pas si elle vérifie.
- **Ce qui reste à faire.** Les routes HTTP `/auth/keycloak/start` et
  `/auth/keycloak/callback` ne sont pas encore branchées dans `handler.js` :
  ce fichier porte 486 lignes non commises d'autres sessions, et y toucher
  maintenant risquait leur travail. Les deux ports sont prêts, testés et
  exerçables ; le branchement est un geste ancré à faire quand l'arbre sera
  calme.
