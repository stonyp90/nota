# Le royaume « nota » — ce que Keycloak a le droit de savoir

**ADR 0045.** Le fournisseur d'identité ne capte qu'une chose : le courriel.
Tout le reste vit dans DynamoDB.

Ce fichier explique `realm-nota.json`, qui ne peut pas se commenter lui-même :
l'importateur de Keycloak rejette tout champ qu'il ne connaît pas, **y compris
un `_comment`**, et le conteneur refuse alors de démarrer. Le royaume reste donc
nu, et les raisons sont ici.

## Les trois réglages qui portent la décision

**`verifyEmail: false`.** Keycloak sait vérifier une adresse ; on le lui
interdit. La vérification est un fait de NOTRE base — l'item `IDENTITY#<sub>`
porte `courrielVerifieLe`. Deux raisons, et aucune n'est théorique :

1. **Loi 25.** Nota doit pouvoir répondre « voici quand et comment cette adresse
   a été prouvée » dans un droit d'accès. Un booléen posé par un service tiers,
   sans horodatage ni méthode dans notre dossier, n'est pas une réponse que Nota
   peut produire.
2. **Un fournisseur se remplace.** Le jour où Keycloak cède la place au SSO
   d'une étude, la vérification ne doit pas partir avec lui.

Le jeton d'identité porte bien un `email_verified`. `verificationDecision()` le
lit, le reporte dans `selonLeFournisseur` pour la trace, et **ne le laisse
jamais entrer dans `verifie`**. Un fournisseur qui se mettrait à répondre `true`
pour tout le monde ne changerait rien aux droits accordés par Nota.

**`registrationEmailAsUsername: true` et `editUsernameAllowed: false`.** Le
compte Keycloak n'a aucun autre attribut que l'adresse : ni nom, ni téléphone,
ni rôle, ni profil. C'est ce qui rend le fournisseur remplaçable — il ne détient
rien qu'on ne puisse reconstruire. `claimsToLink()` applique la même discipline
côté API : elle ne retient que `sub` et `email`, et un test le vérifie.

**Client public avec PKCE.** `nota-web` est public, donc aucun secret ne part
dans un navigateur, et `pkce.code.challenge.method: S256` fait que le code
d'autorisation ne vaut rien sans le vérificateur qui ne quitte jamais
l'appareil.

## Le port

Le royaume écoute sur **8081**, pas 8080 : sur une machine de développement le
port 8080 est déjà pris par Docker Desktop, et un port occupé fait échouer
`docker compose up` sans dire pourquoi.

L'émetteur que l'API exige est `http://localhost:8081/realms/nota`, c'est-à-dire
l'adresse **publique**, celle que le navigateur atteint. C'est elle qui signe la
claim `iss` du jeton, donc c'est elle que la vérification doit exiger. Même
distinction que `NOTA_DOCS_PUBLIC_ENDPOINT` : l'adresse interne du conteneur et
l'adresse publique ne sont pas la même chose, et c'est l'émetteur du jeton qui
fait foi.

## L'usager de démonstration

`demo@nota.test` / `demo`, avec `emailVerified: false` **à dessein** : la pile
locale doit montrer le cas normal, celui où Keycloak ne prouve rien et où c'est
Nota qui prouve.

## Ce que Keycloak ne remplace pas

Le lien magique de l'ADR 0026 reste la porte des cinq autres mécaniques
(notaire, admin, partenaire, soutien, client). Aucun service de la pile ne
dépend de Keycloak : quand `NOTA_KEYCLOAK_ISSUER` n'est pas configuré, les
routes `/auth/keycloak/*` répondent 503 et tout le reste continue.

## Repartir de zéro

    docker compose down -v && docker compose up -d

Le volume `keycloak-data` garde le royaume entre deux redémarrages ; `-v` est la
façon explicite de le jeter et de réimporter `realm-nota.json`.
