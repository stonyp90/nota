# Audit des affirmations — ce que Nota dit vs ce que Nota fait

> ⚠️ **PÉRIMÉ SUR UN POINT — corrigé le 2026-09-02.** Ce document décrit le
> partage d'honoraires (« Nota conserve au plus 15 %, le notaire garde de 85 %
> à 95 % selon sa cote ») comme s'il était en vigueur. **Il ne l'est plus.**
> L'[ADR 0031](../decisions/0031-le-prix-de-nota-est-celui-de-nota.md) l'a
> retiré : le notaire reçoit 100 % du montant offert, et Nota facture au client
> un **prix publié d'avance** pour son propre service (une grille par service depuis l'[ADR 0034](../decisions/0034-le-prix-de-nota-est-une-grille-par-service.md)). Les art. 32 et 32.1 2° condamnaient
> la mécanique décrite ici. Tout le reste du document tient ; ne citez pas ses
> passages sur le partage sans lire l'ADR 0031 d'abord.

**Date :** 2026-09-01 · **Commit de référence :** `6758c53` (arbre de travail modifié)
**Portée :** copie client (`apps/web/public/`), courriels (`apps/api/src/emails.js`), chiffres publics, promesses au notaire, mentions de conformité et de sécurité.
**Ce document ne constate que des écarts entre le dit et le fait. Aucun avis juridique.**

## Définition retenue

Est *légitime* une affirmation que le code, l'infrastructure ou un fait vérifiable soutient. Est un défaut toute affirmation invérifiable, périmée, exagérée ou contredite par l'implémentation — même de bonne foi.

Quatre verdicts :

| Verdict | Sens |
|---|---|
| **VRAI** | Le code fait ce qui est dit. |
| **TROMPEUR** | Vrai à la lettre, faux dans l'impression laissée ; ou vrai sur un chemin, faux sur l'autre. |
| **FAUX** | Le code fait autre chose, ou ne fait rien. |
| **INVÉRIFIABLE** | Ni confirmé ni infirmé depuis le dépôt ; la vérification requise est nommée. |

## Avertissement sur les numéros de ligne

`index.html` et `app.js` étaient **modifiés en parallèle pendant l'audit**. Les numéros ci-dessous valent pour ces empreintes ; en cas d'écart, la citation exacte du texte fait foi.

| Fichier | MD5 au moment de l'audit |
|---|---|
| `apps/web/public/index.html` | `edae10e65206befa29a942426e38dde0` |
| `apps/web/public/app.js` | `1b7057f2d76db5d831b6310b6ce9fedd` |
| `apps/api/src/emails.js` | `1e3aa5efe0c38f6896c9a4f563fd95cf` |
| `packages/domain/index.js` | `8d3209d856cb45dfcb194bfcd7ff354e` |

## Une réserve qui traverse tout l'audit

Le seul état d'infrastructure enregistré dans le dépôt (`infra/terraform.tfstate`, ligne 3437-3447, Lambda `nota-api`, `NODE_ENV: "production"`) montre :

```
"NOTA_BASE_URL": "",
"NOTA_FROM_EMAIL": "",
"NOTA_OPERATOR_EMAIL": "",
"STRIPE_SECRET_KEY": "",
"STRIPE_WEBHOOK_SECRET": "",
```

Or :

- `apps/api/src/handler.js:168` — `if (!process.env.NOTA_FROM_EMAIL) return null;` : **aucun courriel n'est envoyé** quand la variable est vide.
- `apps/api/src/handler.js:149-151` — `billingConfigured` est faux sans les deux clés Stripe : **aucune autorisation de carte, aucun virement, aucun frais d'annulation**.
- `apps/api/src/handler.js:1111` → `stripe-port.js:35` lève `Error('secretKey is required')` : le bouton **« Créer mon compte gratuit »** du notaire renvoie une 500.
- Le workflow `.github/workflows/deploy.yml:137-150` ne fait qu'un `aws lambda update-function-code` : il ne modifie **jamais** les variables d'environnement. Elles ne changent que par un `terraform apply` local.

Cet état est peut-être périmé (dérive connue de l'état local). **Toutes les affirmations de paiement et de notification par courriel sont donc marquées INVÉRIFIABLE tant que ceci n'est pas tranché :**

```
aws lambda get-function-configuration --function-name nota-api \
  --region ca-central-1 --query 'Environment.Variables'
```

Si le résultat confirme les valeurs vides, une douzaine d'affirmations passent de INVÉRIFIABLE à **FAUX**.

---

## 1. Copie visible côté client

| # | Affirmation (texte exact) | Emplacement | Ce que fait le code | Verdict |
|---|---|---|---|---|
| 1.1 | « Vos renseignements restent sur cet appareil. » | `index.html:1479` ; `app.js:874` | Le même formulaire appelle `clientWelcome()` (`app.js:926`) qui `POST` le courriel vers `/client/welcome`. `handler.js:1071-1084` le passe à `onClientSignup` (`notifications.js:570`), qui écrit un enregistrement `SENT#` **clé sur l'adresse** (`refId: to`) dans DynamoDB. Le courriel quitte l'appareil et est conservé côté serveur. | **FAUX** |
| 1.2 | « Elles ne quittent pas le pays. » (données) | `index.html:1126` ; EN `i18n.js:1058` « It never leaves the country. » | Le **stockage** est bien en `ca-central-1` (`infra/dynamodb.tf:9-11`). Mais : (a) CloudFront est en `PriceClass_100` (`infra/cloudfront.tf:139`) — points de présence en Amérique du Nord **et en Europe** ; tout le trafic `/api/*`, y compris courriel, téléphone et dossier, transite par un PoP hors Canada (`cloudfront.tf:186-204`) ; (b) chaque page charge la police depuis `https://rsms.me` (`index.html:54-55`) — l'IP du visiteur part chez un tiers non canadien à chaque visite, ce que la page Confidentialité ne mentionne pas ; (c) Stripe (société américaine) reçoit la carte du client et l'identité du notaire, ce que le site reconnaît par ailleurs (`index.html:742`). | **FAUX** |
| 1.3 | « Le courriel de notification est effacé dès que l'offre est close ou expirée. » | `index.html:1137` | **Aucun code n'efface `courriel`.** Recherche exhaustive de `courriel: null` / `delete …courriel` sur `apps/api/src/*.js` et `packages/domain/index.js` : un seul résultat, sans rapport (`handler.js:2147`, fil de messagerie). Le chemin d'annulation (`handler.js:2069`) écrit `{ ...bid, status: ANNULEE }` — le courriel est conservé tel quel jusqu'au TTL. | **FAUX** |
| 1.4 | « Une offre et son dossier sont conservés au plus **12 mois** après la date de signature, puis supprimés automatiquement. » | `index.html:1137` | Le TTL réel est de **400 jours ≈ 13,1 mois** : `handler.js:838` — `ttl: … + 400 * 86400`. `infra/dynamodb.tf:69-77` le dit d'ailleurs explicitement (« ~13 months »). Le TTL est bien actif en production (état vérifié : `ttl.enabled = true` sur `nota-main`). S'y ajoute la sauvegarde continue PITR de 35 jours (`dynamodb.tf:62-64`). | **TROMPEUR** (la suppression existe, la durée annoncée est sous-estimée) |
| 1.5 | « Ce que vous offrez est ce que le notaire reçoit. » | `index.html:1224` (Charte) ; EN `i18n.js:778` | Contredit **par la même page** : `index.html:1170` et `:1180` annoncent que Nota garde jusqu'à 15 %. `billing.js:110-152` prélève effectivement 5 % à 15 %. | **FAUX** |
| 1.6 | « aucun frais caché » | `index.html:1224` | Les frais d'annulation tardive (30 % / 10 %, `cancellation-config.js:25-28`) sont **réellement prélevés** par capture partielle (`stripe-port.js:169-177`) et ne sont divulgués **nulle part** avant l'annulation elle-même (`app.js:3673`). Absents des Conditions d'utilisation (`index.html:1176-1192`) et du formulaire d'offre. | **FAUX** |
| 1.7 | « En publiant, la date, le service, le montant et le secteur postal deviennent publics. Aucun document n'est transmis à cette étape. Données au Canada, supprimées sur demande (Loi 25). » (mention sous le bouton « Publier mon offre ») | `index.html:1348` | Exact sur ce qu'elle dit, **mais silencieuse sur l'essentiel** : le clic suivant redirige vers Stripe Checkout et **autorise la carte du client** (`app.js:3188-3194`, `handler.js:858-870`). Aucune mention de carte, de caution ou de paiement dans toute la copie statique du parcours client (recherche `carte|stripe|paiement|caution` sur `index.html` : aucun résultat côté client). | **TROMPEUR** |
| 1.8 | « Aucune obligation, aucun démarchage. Vous retirez une offre tant qu'elle n'est pas retenue, sans frais. » | `index.html:1212` | Vrai pour une offre **ouverte** : `handler.js:2078-2087` relâche l'autorisation. Muet sur l'offre **retenue**, où l'annulation coûte jusqu'à 30 %. | **TROMPEUR** |
| 1.9 | « Le montant que vous offrez est le total, tout compris : rien ne s'y ajoute. » | `index.html:1180` | Le produit **n'a aucune notion de taxes ni de déboursés** : recherche `tps|tvq|taxe|gst|qst|débours|registre foncier` sur `index.html`, `packages/domain/index.js` et `apps/api/src/billing.js` : **aucun résultat**. Un acte de financement réel porte des droits de publication et des taxes ; rien dans le code ne les modélise, ne les inclut ni ne les exclut. La plateforme ne peut donc pas tenir « tout compris ». | **INVÉRIFIABLE** — trancher en confirmant qui absorbe déboursés et TPS/TVQ, puis le dire |
| 1.10 | « Anonyme par défaut » / « Les offres sont affichées comme "Client · secteur postal" » | `index.html:1118` ; FAQ JSON-LD `index.html:125` | `index.html:1356` : la case `o-anon` est `checked`. `handler.js:346` : `nom: b.anonyme ? null : b.nom` dans `publicBid()`, qui est une liste blanche. | **VRAI** |
| 1.11 | « Nous ne vendons ni ne louons vos renseignements. Aucune donnée n'est monnayée. » | `index.html:1143` | Aucun traceur, aucun pixel, aucun analytique tiers. Les compteurs d'accueil restent locaux (`app.js:1028-1030`). Seuls tiers : AWS, Stripe, rsms.me (police). | **VRAI** |
| 1.12 | « Aucune offre n'est mise en avant contre paiement. » | `index.html:1227` | Aucun mécanisme de mise en avant payante dans le tri (`app.js`, tri par montant/date uniquement). | **VRAI** |
| 1.13 | « Nota ne vérifie pas votre identité. C'est le notaire qui […] vérifie votre identité au moment de la signature » | `index.html:1141` | Exact : aucun contrôle d'identité côté Nota. Affirmation honnête. | **VRAI** |
| 1.14 | « Vous pouvez demander l'accès, la rectification ou la suppression […] en écrivant à `confidentialite@nota.ca`. Nous répondons dans un délai de 30 jours. » | `index.html:1138` | **Aucune route de suppression** n'existe (liste exhaustive des routes de `handler.js` : aucune n'efface un dossier client). Le processus est manuel et repose sur une boîte aux lettres dont l'existence n'est pas vérifiable depuis le dépôt — d'autant que l'expéditeur SES configuré est une adresse Gmail personnelle (`infra/terraform.tfvars:8`). | **INVÉRIFIABLE** — vérifier que `confidentialite@nota.ca` est routée et relevée |
| 1.15 | Trois identités contradictoires : `nota.quebec` (`index.html:255, 301`), `info@nota.ca` (`index.html:1190, 1229`), `bonjour@nota.ca` (`packages/domain/index.js` CONTACT, `emails.js:47`) — le site étant servi depuis `d1s1h4894dau0c.cloudfront.net` (`index.html:16-20, 63-84`, `infra/terraform.tfvars:13`) | idem | `info@nota.ca` n'apparaît **nulle part** ailleurs dans le dépôt : ni dans le domaine, ni dans les courriels. Le JSON-LD `ProfessionalService` déclare une `PostalAddress` sans rue (`index.html:98-103`). | **INVÉRIFIABLE / incohérent** |
| 1.16 | « une personne de l'équipe vous répond à votre courriel, **normalement le jour même**. » | `index.html:1609` et `:1639` | Aucun mécanisme, aucune mesure, aucune astreinte dans le code. En outre le formulaire de contact n'alerte l'opérateur que si `NOTA_OPERATOR_EMAIL` est configuré — vide dans l'état enregistré. | **INVÉRIFIABLE** (et sans support si l'état Lambda est à jour) |
| 1.17 | « Écrivez-nous — **on vous répond en direct**, ici même. » | `index.html:1655` | Le mécanisme existe (courriel à l'opérateur + sondage à 8 s, `app.js:7936-7987`), mais il dépend d'un humain devant une boîte aux lettres. Aucun indicateur de présence, aucune plage horaire, aucun état « hors ligne ». | **TROMPEUR** |
| 1.18 | « L'inscription des notaires est aussi gratuite ; Nota se rémunère par une commission sur les actes complétés. » (FAQ, référencée par Google via JSON-LD) | `index.html:124` | Vrai sur le principe (aucun abonnement, voir §4.4), mais les **frais d'annulation** sont prélevés sur un acte **non complété**. | **TROMPEUR** |
| 1.19 | « Il est valide 15 minutes et à usage unique. » (lien de connexion notaire) | `index.html:718` | `handler.js:60` — `NOTARY_CHALLENGE_TTL_MS = 15 * 60 * 1000`, consommation conditionnelle (`repo-dynamo.js:703-705`). | **VRAI** |
| 1.20 | « Stripe vous demandera une pièce d'identité et un compte bancaire […] Nota ne les voit jamais. » | `index.html:742` | Onboarding Express hébergé chez Stripe (`stripe-port.js:48-79`) ; Nota ne reçoit qu'un identifiant de compte. | **VRAI** |
| 1.21 | Le film d'introduction : « Exemple — d'autres demandes s'affichent la même semaine » | `index.html:279` | **Corrigé pendant l'audit.** La formulation antérieure — « + 6 autres demandes cette semaine à Québec » — était un chiffre de marché inventé, codé en dur, montré à tout premier visiteur. La version actuelle est étiquetée « Exemple ». | **VRAI** (après correction) |

---

## 2. Courriels — identification LCAP et désabonnement

**41 gabarits**, tous construits par la même coquille (`emails.js:291` `layout()` → `emails.js:214` `footer()` ; version texte `emails.js:346`). Aucun envoi hors coquille dans `apps/api/src/`. L'identification est donc **uniforme** : ce qui est vrai d'un gabarit l'est des 41.

### 2.1 Le pied de page partagé

| Élément LCAP | Présent | Ligne | Contenu réel | Verdict |
|---|---|---|---|---|
| Nom de l'expéditeur | oui (41/41) | `emails.js:45`, `:227`, `:353` | `Nota` | **VRAI** |
| **Adresse postale** | oui (41/41) — **mais fictive** | `emails.js:46` | `Nota — 000, rue à confirmer, bureau 000, Québec (Québec) G0X 0X0, Canada` | **FAUX** |
| Moyen de contact | oui (41/41) | `emails.js:240-249`, `:355` | `bonjour@nota.ca`, `confidentialite@nota.ca`. Aucun téléphone, aucune URL. | **VRAI** |
| Lien de désabonnement | oui (41/41) | `emails.js:234-239`, `:354` | « Se désabonner / Unsubscribe » | voir 2.2 — **le lien ne fonctionne pas** |
| En-tête `List-Unsubscribe` | oui, conditionnel | `notify-port.js:40-41` | émis dès qu'une URL est fournie | **VRAI** |
| En-tête `List-Unsubscribe-Post` | oui, conditionnel | `notify-port.js:43-45` | émis si l'URL est `http(s)` | voir 2.2 |
| `Reply-To` | **absent** | — | aucune occurrence dans `apps/api/src/` | — |

**Sur l'adresse postale.** Le commentaire au-dessus l'assume : *« This is a PLACEHOLDER; replace with Nota's registered mailing address before go-live. »* (`emails.js:42-43`). `G0X 0X0` n'est pas un code postal attribuable. Conséquences concrètes :

1. **Les 41 gabarits** — courriels commerciaux (bienvenue client, digest notaire, relance win-back, bienvenue partenaire) comme transactionnels — portent une identification d'expéditeur fausse.
2. Un test verrouille sa **présence** sans vérifier sa **véracité** (`apps/api/test/emails-brand.test.mjs:57-58` : `out.html.includes(emails.SENDER.address)`). La suite verte donne une fausse assurance de conformité.
3. Un destinataire qui voudrait exercer un recours n'a aucune adresse réelle où écrire.

### 2.2 Le désabonnement ne fonctionne pas en production

C'est le défaut le plus grave de cette catégorie. Quatre défauts cumulés :

| # | Défaut | Preuve |
|---|---|---|
| a | **Le lien n'atteint jamais la Lambda.** L'URL construite est `<base>/unsubscribe?token=…` (`notifications.js:43-46`), sans préfixe `/api`. Or CloudFront ne route vers la Lambda que `/api/*` (`cloudfront.tf:186-204`) et la fonction `spa_router` réécrit tout chemin sans extension hors `/api` vers `/index.html` (`cloudfront.tf:111-131`). Le visiteur reçoit le SPA en **HTTP 200** : la page se charge, **l'opt-out n'est jamais enregistré**. | `notifications.js:45` vs `handler.js:684` (`replace(/^\/api(?=\/\|$)/, '')`) |
| b | **Le désabonnement un-clic (RFC 8058) échoue.** `List-Unsubscribe-Post` est émis, mais le comportement CloudFront par défaut n'autorise que `GET/HEAD/OPTIONS` (`cloudfront.tf:169`) → le `POST` de Gmail/Yahoo reçoit **403**. | `notify-port.js:43-45` + `cloudfront.tf:169` |
| c | **Le jeton n'est pas signé** — simple `base64url(email)` (`notifications.js:25-27`). N'importe qui peut désabonner n'importe quelle adresse, sans authentification ni limitation de débit. | `notifications.js:25-27`, `handler.js:1247-1261` |
| d | **Dégradation silencieuse.** `base = baseUrl \|\| ''` (`notifications.js:41`) : avec `NOTA_BASE_URL` vide — la valeur de l'état enregistré — l'URL devient `/unsubscribe?token=…`, relative : lien mort dans le client mail, en-tête `List-Unsubscribe` invalide. | `notifications.js:41` |

**Verdict : FAUX.** Le seul mécanisme de retrait offert aux destinataires ne retire personne.

### 2.3 Consentement

| Constat | Preuve | Verdict |
|---|---|---|
| **Aucun opt-in stocké.** Le seul état par destinataire est une suppression (`UNSUB#<email>`, `keys.js:66-69`, `repo-dynamo.js:368-382`). Le formulaire d'offre n'a aucune case de consentement courriel : `index.html:1364-1367` n'offre qu'un opt-in **de compte** et l'aide dit seulement « Sert à vous prévenir ». Le consentement est tacite, jamais horodaté. | `notifications.js:90-93` | constat |
| **Aucune granularité.** `sendOnce` (`notifications.js:92`) teste la suppression **avant tout** : un désabonnement coupe aussi les courriels transactionnels critiques — `offerRetained` (« un notaire a retenu votre demande »), `propositionRecue`, `documentsDemandes`, `actPaidNotary`. | `notifications.js:90-96` | constat |
| **Aucun réabonnement.** Recherche `deleteUnsubscribe\|resubscribe\|reabonn` sur `apps/api/src/` : aucun résultat. Le retrait est irréversible côté produit. | — | constat |
| **Le coupe-circuit admin est global, jamais par utilisateur.** `CONFIG#EMAIL` / `TPL#<key>` stocke `{ key, enabled, subjectFr, subjectEn }` — aucune dimension destinataire. | `admin.js:372-417`, `keys.js:266-271`, `notifications.js:95-96` | constat |
| Exceptions volontaires au filtre (envoyées même si désabonné) : liens magiques notaire, partenaire, admin. Documenté, défendable. | `notifications.js:932-948, 957-974` ; `admin.js:157-178` | **VRAI** |

### 2.4 L'adresse d'expédition réelle

`infra/terraform.tfvars:8` : `from_email = "anthonypaquet1508@gmail.com"`, injecté comme `NOTA_FROM_EMAIL` (`infra/lambda.tf:151`). **Tous les courriels client, notaire et partenaire partent aujourd'hui d'une adresse Gmail personnelle**, alors que le corps se présente comme « Nota » et invite à écrire à `bonjour@nota.ca`. L'identité SES est une identité **d'adresse**, pas de domaine (`infra/notifications.tf:48-51`) : pas de DKIM de domaine, alignement DMARC impossible. **Verdict : TROMPEUR.**

### 2.5 Affirmations factuelles fausses dans le corps des courriels

| # | Texte exact | Ligne | Réalité | Verdict |
|---|---|---|---|---|
| 2.5.1 | « Votre évaluation aide les prochains clients à choisir en confiance. » (au **client**) | `emails.js:1764` (EN `:1773`) | Le courriel envoyé **au notaire** dit l'inverse : « Elle n'est montrée à aucun client : le Code de déontologie interdit qu'un témoignage vous concernant soit utilisé publiquement » (`emails.js:1810`, ADR 0030). L'évaluation n'est **jamais** publiée. C'est précisément la promesse qui sert à l'obtenir. | **FAUX** |
| 2.5.2 | « À ce délai, **le marché se conclut généralement entre** 1,8× et 2,2× le prix de départ. » | `emails.js:510-512` (EN `:538-540`) | Les bornes viennent de `t.apercuMin`/`t.apercuMax` lus bruts (`emails.js:481`) dans un tableau **codé en dur** (`packages/domain/index.js:639-645`), dont le commentaire dit qu'il a été relevé par décision commerciale (« *multipliers raised hard* »). Ce ne sont pas des données de marché. Le domaine expose pourtant `tunedTierMultipliers` (`domain/index.js:1643`), apprise des offres réellement conclues — **le courriel ne l'utilise pas**. | **FAUX** |
| 2.5.3 | « utiliser Nota ne vous coûte rien de plus » | `emails.js:819`, `:823` | Contredit par les frais d'annulation (`billing.js:480-493`). | **FAUX** |
| 2.5.4 | « Vous payez le prix que vous avez affiché, **à la signature** » / « soyez payé à la signature » | `emails.js:819, 823, 831, 835, 916, 918, 927` | Le code capture **à l'acceptation** par le notaire (`billing.js:410, 428`), qui précède la date de signature. Contredit aussi par `emails.js:663` : « débité qu'au moment où un notaire retient votre demande ». Trois réponses différentes à « quand payez-vous ? ». | **TROMPEUR** |
| 2.5.5 | « toujours sans frais fixes, **une commission seulement sur les actes complétés** » | `emails.js:855` (EN `:864`) | (a) les frais d'annulation portent sur des actes non complétés ; (b) le taux n'est pas unique — il varie avec la cote (`commission-config.js`). Présente comme fixe une économie variable. | **TROMPEUR** |
| 2.5.6 | « 50,00 $ **vous sont crédités** » / « 250,00 $ vous sont crédités » | `emails.js:1511`, `:1540` | Les montants sont exacts (`domain/index.js:1884-1886`), mais **aucun mécanisme de versement au partenaire n'existe** : `referralLedger` (`domain/index.js:1905-1938`) n'est qu'un registre dérivé, et `billing.js` ne contient aucun transfert vers un partenaire. « Crédité » est plus fort que ce qui est implémenté. | **TROMPEUR** |
| 2.5.7 | « notre équipe vous écrit **sans délai** pour le régulariser » | `emails.js:1638` (EN `:1647`) | Le seul mécanisme est l'alerte `operatorOfferCancelled`, envoyée uniquement si `NOTA_OPERATOR_EMAIL` est configuré — **vide** dans l'état enregistré (`infra/notifications.tf:32-35`). La promesse repose sur un canal éteint. | **INVÉRIFIABLE / probablement FAUX** |
| 2.5.8 | « une demande prête est retenue **beaucoup plus vite** » et variantes | `emails.js:415, 423, 494, 617, 1209` | Aucune de ces corrélations n'est mesurée dans `analytics.js` ni `stats.js`. Arguments de vente formulés comme des faits, tous orientés vers une hausse du montant payé. | **INVÉRIFIABLE** |
| 2.5.9 | « le hold s'éteint de lui-même, sans frais » / « Le montant est simplement réservé sur votre carte » | `emails.js:663`, `:679` | L'expiration de l'autorisation dépend de Stripe, pas du code. L'audit interne du 2026-08-27 avait relevé un défaut de caution orpheline. | **INVÉRIFIABLE** — revalider avant de réaffirmer « sans frais » |
| 2.5.10 | « Le détail complet du versement figure sur votre relevé Stripe. Aucune action n'est requise. » | `emails.js:951-955` | **Bien fait** : ce courriel n'est envoyé que si un transfert réel a eu lieu (`handler.js:1207` `paye: result.netCents != null` ; `notifications.js:763-780`). | **VRAI** |

### 2.6 Sujets réels vs sujets affichés à l'admin

`TEMPLATE_META` (`emails.js:2070-2328`) sert de vérité à la console d'édition (`admin.js:358-367`) mais **ne décrit pas** le sujet réellement construit pour plusieurs gabarits :

| Clé | Sujet réel | `defaultSubject` déclaré | Conséquence |
|---|---|---|---|
| `referralRewardClient` | `emails.js:1503` — « 50,00 $ de référence gagnés… » | `:2258` — « Prime de référence gagnée… », avec `placeholders: ['montant', …]` | `{{montant}}` rendrait le montant **de l'acte**, pas la prime de 50 $ (`notifications.js:222`, `ctx = bidCtx(bid)`). Piège direct : l'admin peut publier un montant faux. |
| `referralRewardNotary` | `:1533` | `:2264` | idem |
| `actPaidNotary` | EN `:944` contient un montant | `:2226` ne l'annonce pas | perte d'information à la personnalisation |
| `dateApproaching` | `:492`, varie selon `days` | `:2093` fixe | aucun jeton `days` : impossible de reproduire le sujet réel |
| `operatorContactMessage` | `:1913`, inclut le sujet saisi | `:2307`, `placeholders: ['email']` | le sujet n'est pas un jeton disponible |

**Verdict : TROMPEUR** — un administrateur peut dégrader ou fausser l'information envoyée sans le moindre avertissement.

---

## 3. Les chiffres montrés au public — d'où viennent-ils

### 3.1 Le repli sur les données de démonstration — **non déclaré sur le site déployé**

C'est le défaut le plus grave de l'audit.

**Le mécanisme.** `apps/web/public/app.js:75-82` : `store.listMonth` retombe sur `D.makeFixtures(todayISO())` (`app.js:62`, `ensureSeed`) dès que l'API répond autre chose qu'un 2xx. Le test est `if (r.ok)` — pas seulement une panne réseau :

| Situation en production | Repli sur fixtures ? |
|---|---|
| Lambda en erreur, throttling, cold-start timeout (500/502/504) | **oui** |
| API Gateway 503 / 429 | **oui** |
| Comportement CloudFront `/api/*` cassé → 403/404 | **oui** |
| DynamoDB inaccessible → 500 | **oui** |
| Visiteur hors ligne | **oui** |
| Table vide mais API saine → `200 {bids:[]}` | non (carnet vide, médiane « — ») |

Le service worker **élargit** le cas : `apps/web/public/sw.js:38-48` intercepte `/api/*` et transforme lui-même un `fetch` rejeté en **503 JSON**. Chez un visiteur récurrent, le `catch` de `listMonth` ne se déclenche donc jamais — c'est toujours la branche `!r.ok` qui mène aux fixtures.

**Ce que le repli fabrique.** `packages/domain/index.js:1633-1667`, déterministe (graine fixe `FIXTURE_SEED = 0x4e6f7461`) : **34 offres**, dates toujours à venir (`today+1` à `today+27` — le carnet inventé a toujours l'air d'être « ce mois-ci »), montants de 2 150 $ à 8 630 $, 25 ouvertes / 9 retenues. Il en résulte une médiane refinancement de **4 165 $** et financement de **3 600 $**, une meilleure offre de **8 630 $**, un taux de rétention de **26 %**. S'y ajoutent :

- des **noms de clients inventés** affichés nommément au carnet (`domain/index.js:1630` : *Marie-Ève Tremblay, Luc Gagné, Sophie Bergeron, Jean Roy, Chantal Côté, Marc Fortin*) ;
- des **études inventées** (`:1631` : *Étude Laval, Notaires du Vieux-Québec, Cabinet Sainte-Foy*), affichées dans « Retenu · Cabinet Sainte-Foy » (`app.js:1789`) ;
- des secteurs postaux **authentiques** de Québec (`:1629` : G1R, G1K, G2B, G1V, G1S, G3J) et des prêteurs du catalogue réel.

Ces données sont **indistinguables d'un vrai marché**.

**L'état du site déployé.** Une déclaration existe dans l'arbre de travail — bannière `#demo-banner` (« **Données de démonstration** — […] Ces offres et ces montants sont **fictifs** », `index.html:499-502`), marque « démonstration » par région (`app.js:217-238`), écran de publication hors ligne (« **Rien n'a été publié.** […] aucun notaire ne la verra », `app.js:263`). **Elle n'est pas commitée** :

```
git show HEAD:apps/web/public/app.js    | grep -c "démonstration"   → 0
git show HEAD:apps/web/public/index.html | grep -c "demo-banner"     → 0
```

Le déploiement builde depuis le commit poussé (`.github/workflows/deploy.yml`) ; `apps/web/dist/` est gitignoré. **Le site en ligne aujourd'hui n'a donc aucune indication.** Au-dessus des chiffres inventés, les titres disent « **Ce que les clients offrent** » (`index.html:526`) et « **Ouvertes en ce moment** » (`index.html:647`).

**Verdict : FAUX sur le site déployé.** Le correctif en cours est le bon, il doit être poussé.

**Trois trous subsistent dans le correctif en cours :**

1. `DEMO_REGIONS` (`app.js:217-220`) ne couvre que `#carnet-pulse` et `#carnet-panel`. **Restent non marqués**, alors qu'ils affichent des chiffres tirés de `state.monthBids` :
   - `#notary-live` « Ouvertes en ce moment » (`index.html:647-654`, rendu `app.js:4993-5045`) — jusqu'à 12 cartes avec montant, date et « +N autres demandes » ;
   - `#day-dialog` (`index.html:1288`) — « à battre : X $ », le rang « 3e sur 12 », les chips « barre à battre » (`app.js:2006`), et surtout **le montant pré-rempli du formulaire d'offre** (`app.js:2825, 2873, 2911` via `D.recommendedAmount(…, state.monthBids)`) ;
   - `#onboarding-dialog` (`index.html:1487`) — « **34 demandes publiées ce mois-ci · 9 retenues** » et « 25 demandes ouvertes · N $ à retenir » (`app.js:1042-1053`). Le commentaire au-dessus dit « *Real counts for the client, real money for the notary* » : c'est faux en mode repli.
   - le film d'introduction `#intro-gate` (`index.html:175`).
2. **Course sur `state.demo`.** `app.js:6860-6864` : `store.online` est un drapeau unique muté par appel, et les appels de mois sont concurrents. Si le mois A échoue (fixtures) et que le mois B réussit **ensuite**, `online = true` : la bannière reste masquée alors que `monthBids` mélange offres réelles et offres inventées. Le commentaire de la ligne 6862 décrit une garantie que le code ne tient pas.
3. `D.makeFixtures(todayISO())` est appelé **à chaque chargement de page**, même en ligne (`app.js:2844`), pour en extraire un exemple de préfixe. Inoffensif, mais le générateur tourne toujours.

**Point sain :** la console notaire **ne retombe jamais** sur des fixtures — `ncLoadBids` (`app.js:4794-4808`) affiche « Impossible de charger les demandes (hors ligne). Réessayez. ». Le serveur non plus : `apps/api/index.js:11-15` n'instancie que `createDynamoRepo`, et `NOTA_DEMO_OPEN` est neutralisé en production (`handler.js:237`). Les seuls semis vivent dans `local-server.js` et `e2e/servers/api-server.js`.

### 3.2 La « médiane » n'est pas une médiane

`packages/domain/index.js:1501` :

```js
median: m == null ? null : Math.max(m, s.prixDepart),
```

La valeur affichée sous l'étiquette **« médiane »** (`app.js:1711-1714`) est la médiane réelle **rehaussée au prix plancher**. Le commentaire l'assume (`domain/index.js:1495-1500`) : « elle ne doit jamais s'afficher sous le prix de départ ». Le résultat reste une statistique retouchée présentée comme une mesure. S'y ajoute qu'aucun seuil d'effectif n'existe : avec une seule offre au carnet, cette unique offre est publiée comme « la médiane ».

**Verdict : TROMPEUR.** Corriger l'étiquette (« repère du mois », « à partir de ») ou lever le rehaussement.

### 3.3 Inventaire des nombres publics et de leur source

| Nombre affiché | Emplacement | Source réelle | Verdict |
|---|---|---|---|
| « à partir de » 2 000 $ / 1 800 $ | pouls du carnet, `app.js:1707-1709` ; FAQ JSON-LD `index.html:126-128` | `SERVICES[].prixDepart` (`domain/index.js:328`, `:412`) | **VRAI** |
| « médiane » | `app.js:1711-1714` | `carnetPulse` — médiane rehaussée (§3.2) | **TROMPEUR** |
| « N offres · N retenues » du mois | `app.js:1720-1721` | `carnetPulse` sur les offres réelles du mois (API) ou fixtures **avec la marque « démonstration »** | **VRAI** |
| Compteurs de la grille du calendrier, meilleure offre du jour | `app.js:1409-1415`, `:1989` | mêmes données, même marque | **VRAI** |
| Récompenses partenaires 50 $ / 250 $ | `app.js` `renderPartnerPane` | `D.REFERRAL.client` / `D.REFERRAL.notaire` (`domain/index.js:1884-1886`), jamais un littéral dans le balisage | **VRAI** |
| Clause partenaires des Conditions | `index.html:1182` → `#tos-partenaires` rempli par `renderPartnerPane()` | mêmes constantes du domaine — la page légale ne peut pas dériver | **VRAI** |
| Fourchettes « le marché se conclut entre 1,8× et 2,2× » dans les courriels | `emails.js:510-512` | constantes de tarification codées en dur (§2.5.2) | **FAUX** |
| Cote du notaire « X / 100 » | console notaire, `app.js` `ncRenderCote` | axes réels (`cote.js:32-64`, `domain/index.js:1233-1266`) alimentés par de vrais événements — **sauf** un a priori bayésien de 4,0/5 sur 5 avis fictifs (`domain/index.js:1280-1292`) qui donne **22,2 points sur 40** à un notaire sans aucune évaluation | **TROMPEUR** (le grand nombre ne dit pas que 22 points viennent d'avis inexistants ; le détail, lui, affiche `avis: 0`) |
| Écran d'introduction — montants et dates | `index.html:220-290` | mise en scène, étiquetée « Exemple » depuis la correction du 2026-09-01 | **VRAI** |
| « **Chances d'obtenir un notaire : 95 %** » | `app.js:1952`, réceptacle `index.html:1288`, EN `i18n.js:1455-1457` | Table **écrite à la main** : `OBTAIN_CHANCE = { standard: 95, rapide: 88, prioritaire: 62, urgence: 40, extreme: 25 }` (`domain/index.js:1738`), repli 60. **Jamais mesurée, aucun historique derrière.** C'est le seul pourcentage du site qui prétende décrire un comportement de marché, et il s'affiche au moment exact où le client choisit sa date. | **FAUX** |
| « publié en **2 minutes** » | `index.html:215`, `:255` (EN `i18n.js:1011, 1028`) | Aucune mesure de durée nulle part. À comparer à `index.html:729` (« ~2 min ») qui a au moins le tilde. | **INVÉRIFIABLE** |
| « Les offres nominatives sont **souvent retenues plus vite** » | `index.html:1441` (EN `i18n.js:824`) | Aucune corrélation mesurée. Allégation d'efficacité servie au moment précis où le client renonce à son anonymat. | **INVÉRIFIABLE** |
| « dès X $ » sur chaque case du calendrier, et le **montant pré-rempli** du formulaire | `app.js:1535` (`tierFromLabel` → `tierAmount`), `app.js:2825, 2873, 2911` (`D.recommendedAmount`) | `D.tierMultiplier(tierId, state.monthBids)` → `tunedTierMultipliers` (`domain/index.js:692-721`), médiane des primes **retenues**. En mode repli, **le prix suggéré au client est calibré sur des offres inventées**. | **TROMPEUR** (critique en mode repli) |
| Aucun `aggregateRating`, `ratingValue` ni `reviewCount` dans le JSON-LD | `index.html:57-170` | Le balisage structuré ne fabrique aucune note ni aucun avis. | **VRAI — point sain** |

**Duplication à surveiller.** Les 2 000 $ / 1 800 $ sont recopiés **neuf fois** dans `index.html` (`:111, :112, :126, :127, :128, :141, :145, :157, :161`) sans être générés depuis `domain/index.js:328, 412`. Un changement de `prixDepart` laissera silencieusement le JSON-LD indexé par Google sur l'ancien prix. Même schéma pour « au plus 15 % / 85 % à 95 % » (`index.html:1170, 1180` + `i18n.js:728, 751`, figés dans les **Conditions d'utilisation**) alors que la console notaire, elle, rend déjà ces taux dynamiquement (`app.js:6389-6390`). Le bon patron existe ; il n'est pas appliqué à la page légale.

**Sur `makeFixtures`.** Le correctif en cours (non déployé) couvre le pouls et le calendrier. Sur le site **actuellement en ligne**, tout chiffre du carnet — médianes, compteurs, « à battre », montant suggéré, noms de clients, noms d'études — peut être fabriqué sans aucune indication.

---

## 4. Ce que le produit promet au notaire

### 4.1 Le partage — la copie et le code concordent

| Élément | Copie | Code | Verdict |
|---|---|---|---|
| Taux de départ 15 % / notaire 85 % | `index.html:1170`, `:1180` | `commission-config.js:23` — `DEFAULT_RATE = 0.15` | **VRAI** |
| Plancher 5 % / notaire 95 % | idem | `commission-config.js:27` — `DEFAULT_FLOOR = 0.05` | **VRAI** |
| Paliers « selon sa cote sur 100 » | idem | `commission-config.js:32-37` — cote 60→12 %, 70→10 %, 80→8 %, 90→5 % | **VRAI** |
| Le 75/25 de l'ADR 0027 | — | **n'existe plus nulle part** dans le produit (aucune occurrence de « 75 % » / « 25 % » dans `apps/web/public/`, `apps/api/src/`, `packages/domain/`). L'ADR 0027 se déclare révisé par l'ADR 0028. La copie a suivi. | **VRAI** |

**Deux réserves sérieuses :**

1. **Le barème est modifiable par l'admin, la copie ne l'est pas.** `billing.js:89-96` relit `repo.getCommissionConfig()` à **chaque** tarification ; `commission-config.js:99-144` accepte n'importe quel `taux ∈ ]0,1[`. La console admin peut porter le taux de base à 60 % pendant que `index.html:1170` et `:1180` — du HTML statique — continuent d'afficher « au plus 15 % » aux clients. **Les Conditions d'utilisation deviennent fausses au premier changement de barème.** Deux garde-fous seulement : les paliers ne peuvent pas remonter (`commission-config.js:135-138`), et le taux gravé à l'engagement (`bid.tauxRetenu`, `handler.js:515-525`) protège les actes déjà retenus. Verdict : **VRAI aujourd'hui, structurellement fragile**.
2. **La fourchette « 85 % à 95 % » suggère un sommet plus accessible qu'il ne l'est.** D'après l'arithmétique des quatre axes (`domain/index.js:1266-1332`), atteindre la cote 90 exige environ 20 avis à 5/5, 50 actes réglés, 20 réponses, rayon 50 km, urgences acceptées, fiche CNQ et un an d'ancienneté. Un notaire neuf est à ≈ 29/100. Verdict : **TROMPEUR par omission**.

### 4.2 Le paiement — la promesse centrale

**Texte audité** (`index.html:902`) : « Le client autorise le paiement dès la publication ; le net vous est viré à la signature, commission Nota déduite. Jamais de frais fixes. »

Le code est **réellement écrit et cohérent** :

- autorisation manuelle : `handler.js:858-870` → `billing.js:370-380` → `stripe-port.js:98-129` (Checkout `mode:'payment'`, `capture_method: 'manual'`) ;
- capture + transfert : `handler.js:1153-1166` → `billing.js:394-468` → `stripe-port.js:139-159` (`paymentIntents.capture` puis `transfers.create` du net) ;
- la commission n'est pas un `application_fee` mais une soustraction du montant transféré (`stripe-port.js:146`) — économiquement identique et déontologiquement meilleur : la part de Nota ne transite jamais par le compte du notaire ;
- l'ancien chemin `chargeActCommission`, qui créait un PaymentIntent **sans moyen de paiement ni confirmation** — donc ne déplaçait aucun dollar tout en affirmant le contraire — a été retiré (ADR 0029).

**Mais deux écarts subsistent :**

| # | Écart | Preuve | Verdict |
|---|---|---|---|
| 4.2.a | **Tout est derrière un drapeau d'environnement vide** dans le seul état enregistré. Sans les clés Stripe : aucune autorisation, aucun virement, aucun frais d'annulation, et `/notaries/connect` renvoie une 500 — le bouton « Créer mon compte gratuit » est mort. Un notaire ne devient `active` que par le webhook `account.updated` (`billing.js:528-545`) : sans Stripe, jamais. Le hatch `NOTA_DEMO_OPEN` est désactivé en dur en production (`handler.js:237`). **La porte notaire ne s'ouvrirait pour personne.** | `terraform.tfstate:3444-3446` ; `handler.js:149-151, 237, 1111` ; `stripe-port.js:35` | **INVÉRIFIABLE** — trancher par la commande donnée en tête de document |
| 4.2.b | **Même avec Stripe branché, le repli contredit la copie.** Quand la capture est impossible, `completeAct` (`billing.js:288-361`) n'appelle **aucun** Stripe : il inscrit `commissionCentsDue` — une **créance de Nota contre le notaire** (`billing.js:335, 348`). Le notaire encaisse alors le client directement et **doit** sa commission. Rien dans `index.html:902` ne dit qu'un acte peut le laisser débiteur. Le relevé d'actes, lui, est honnête : « Réglé hors plateforme — X $ de frais Nota à percevoir » (`app.js:6558-6570`). | idem | **TROMPEUR** |

### 4.3 Panneau « Vos revenus » vs relevé d'actes — deux récits du même argent

`app.js:6244-6289` (`ncEarnings`) calcule « Vos honoraires » / « Payé par les clients » / « Frais de service Nota » depuis le **localStorage** (`LS_NC_RETAINED`), pas depuis le registre serveur. Deux conséquences :

1. changer de navigateur ou vider le stockage remet les revenus affichés à **zéro** ;
2. `handler.js:1431-1434` renvoie `completed`/`actAmount`/`commissionCents` mais **pas `paye`** — un acte réglé **hors plateforme** (créance impayée) est donc compté dans « Vos honoraires » et « Payé par les clients » alors que rien n'a été payé.

Le relevé voisin (`/notary/acts`, `handler.js:1536-1589`, rendu `app.js:6550-6600`) est parfaitement honnête. **Verdict : TROMPEUR.**

S'y ajoute un défaut voisin : `ncLoadBids` (`app.js:4798-4812`) n'a **aucune garde `r.ok`**. Le `catch` ne couvre que le rejet de `fetch` — or le service worker transforme une panne en 503 JSON (`sw.js:38-48`). Un 500/503 passe donc le `catch`, échoue le test `401`, puis `nc.open = j.bids || []` : le notaire voit « **Aucune demande ouverte pour l'instant.** » (`index.html:768`) au lieu d'une erreur. Et `nc.cote` / `nc.commission` ne sont pas réinitialisés — cote et taux périmés restent à l'écran sans avertissement. **Verdict : TROMPEUR.**

### 4.4 Les préférences de notification du notaire ne font rien

`index.html:861` : « Choisissez **comment** et **à quelle fréquence** Nota vous prévient des nouvelles demandes qui vous conviennent. Modifiable à tout moment. »

| Contrôle | Emplacement | Réalité | Verdict |
|---|---|---|---|
| **« Par texto (SMS) »** + champ « Mobile pour les textos » | `index.html:867-871` | **Aucun envoi SMS n'existe dans le produit.** Recherche `sms\|sns.*publish\|texto` sur `apps/api/src/notifications.js`, `notify-port.js`, `handler.js` et `packages/domain/index.js` : **zéro résultat**. Le seul transport est SES (`notify-port.js:25-65`). Un notaire peut activer les textos et saisir son mobile : aucun texto ne partira jamais. | **FAUX** |
| « À chaque demande » / « Résumé quotidien » / « Résumé hebdomadaire » | `index.html:875-878` | Le serveur envoie un digest quotidien fixe (`notifications.js:609-615`). Aucune préférence n'est lue. | **FAUX** |
| « Par courriel » (activer/désactiver) | `index.html:866` | idem | **FAUX** |
| Toute la persistance | `app.js:5389`, `:5406` — `ncPrefsSave` écrit dans `localStorage['nota.notary.prefs.v1']` | **Rien n'est envoyé à l'API** : aucune route `/notary/prefs` n'existe (liste exhaustive des routes de `handler.js`). Le serveur ignore l'existence de ces préférences. | **FAUX** |
| « ✓ Préférences enregistrées. » | `index.html:892` | Enregistrées sur **cet appareil seulement**, et sans effet. | **TROMPEUR** |
| Filtres actes / prêteurs | `index.html:880-889` | Ceux-là **fonctionnent** : `ncFilteredOpen` filtre le fil côté client. | **VRAI** |

Le commentaire du code le reconnaît (`app.js:5386-5388`) : *« local for the demo; a deployment would sync these to the API »*. Le panneau est resté visible en production.

### 4.5 Autres promesses au notaire

| Texte | Emplacement | Réalité | Verdict |
|---|---|---|---|
| « Jamais de frais fixes. » | `index.html:902` | Aucun code d'abonnement subsistant : recherche `subscription\|abonnement\|price_id\|invoice\|recurring` — uniquement des commentaires et des noms de clés historiques, plus un refus explicite des événements d'abonnement (`notifications.js:914-915`). `STRIPE_PRICE_ID` traîne dans l'état Terraform mais n'est référencé par aucun `.tf` ni aucune ligne de code. L'ADR 0005 est mort. | **VRAI** |
| « commission seulement sur ce qui se conclut » | `app.js:986` | `completeAct` / `payNotaryOnAccept` ne s'exécutent qu'au règlement. | **VRAI** |
| « La commission n'est prélevée qu'à la signature, sur la valeur confirmée » | `app.js:6293` | Bornée par `domain.validateActValue` (0,25×–3× de l'offre retenue). | **VRAI** |
| « Vous gardez X % … mérité par votre cote » / « Cote N → vous gardez Z % — il vous manque M points » | `app.js:6389-6390`, `:6423` | Conforme à `billing.js:138-149`. Garde-fou correct : `ncRenderCote` fait `if (!c) return;` — sans barème configuré, **aucun taux inventé**. | **VRAI** |
| « Vous gardez la main. Vous fixez vos honoraires » | `index.html:922` | Le notaire ne fixe rien : le client publie un montant, le notaire retient ou propose (`handler.js` `/notary/bids/propose`). La proposition existe, mais « vous fixez vos honoraires » surestime la latitude. | **TROMPEUR** |
| « Les clients voient un **badge « CNQ »** sur vos propositions » | `index.html:825` | Copie **périmée**. Depuis l'ADR 0030, le badge rendu s'intitule « Fiche déclarée » / « Fiche déclarée à la Chambre » avec le désaveu « Nota ne vérifie pas cette déclaration » (`app.js:640-646`). Le code a été corrigé ; la promesse faite au notaire ne l'a pas été. | **TROMPEUR** |

---

## 5. Mentions de conformité, de sécurité et de vérification

| # | Mention | Emplacement | Ce qui la fonde réellement | Verdict |
|---|---|---|---|---|
| 5.1 | « Nota **ne vérifie pas** votre identité » ; badge « **Fiche déclarée** […] Nota ne vérifie pas cette déclaration » | `index.html:1141` ; `app.js:640-646` | `validateNotaryProfile` (`domain/index.js`) ne contrôle que la **forme** de l'URL (https, hôte `cnq.org`). Personne ne confirme que la fiche existe, appartient à ce notaire, ou qu'il est en règle. **Le produit le dit exactement.** Le désaveu est identique en version courte et longue, et il est porté par `title` **et** `aria-label`. | **VRAI — modèle du genre** |
| 5.2 | « lien de connexion **sécurisé** » (notaire, admin) | `index.html:707`, `emails.js:983, 1023` | Jeton signé, à usage unique, consommation conditionnelle en base (`repo-dynamo.js:644, 703, 1004`), TTL 15 min, limitation de débit par IP (`repo-dynamo.js:657-670`). | **VRAI** |
| 5.3 | « compte de paiement **sécurisé** (Stripe) » | `index.html:729, 902` | Onboarding Express hébergé ; Nota ne voit ni pièce d'identité ni compte bancaire (`stripe-port.js:48-79`). | **VRAI** |
| 5.4 | « Les documents eux-mêmes sont échangés de façon **sécurisée** » | `index.html:1139` | HTTPS obligatoire (`redirect-to-https`, `cloudfront.tf:167`), HSTS 2 ans avec `preload`, CSP restrictive, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` (`cloudfront.tf` politique `security`). Chiffrement au repos DynamoDB par clé gérée AWS (aucun bloc `server_side_encryption` : clé propriété d'AWS, pas de CMK — noté « FUTURE IMPROVEMENT » dans `dynamodb.tf:19-21`). Aucune affirmation de « chiffrement de bout en bout » n'est faite : la formulation reste dans les limites du fondé. | **VRAI** |
| 5.5 | « **conformité à la Loi 25** » | `index.html:1226` ; pied de page « Données hébergées au Canada · Loi 25 » | Affirmation de conformité globale. Les éléments qui la soutiennent existent (hébergement `ca-central-1`, TTL, minimisation dans `publicBid()`, responsable nommé par adresse). Mais quatre affirmations de cette même page sont fausses ou inexactes (1.1, 1.2, 1.3, 1.4) et le mécanisme de retrait des courriels ne fonctionne pas (2.2). Une déclaration de conformité ne peut pas s'appuyer sur des énoncés faux. | **TROMPEUR** |
| 5.6 | « Une **personne responsable** de la protection des renseignements personnels supervise ces pratiques » | `index.html:1134` | Personne nommée : aucune. Adresse : `confidentialite@nota.ca`, dont le routage n'est pas vérifiable depuis le dépôt. | **INVÉRIFIABLE** |
| 5.7 | JSON-LD `ProfessionalService` avec `PostalAddress` (localité/région/pays, **sans rue**), `priceRange: "$$"`, `geo` aux coordonnées du centre-ville de Québec | `index.html:96-104` | Données structurées destinées aux moteurs de recherche. La `geo` désigne un point qui n'est pas une adresse d'affaires établie ; l'adresse postale est absente ici et fictive dans les courriels (§2.1). | **INVÉRIFIABLE / à corriger avec l'adresse réelle** |
| 5.8 | Aucune mention de « certifié », « approuvé », « agréé », « accrédité », « partenaire de la Chambre » n'a été trouvée. | recherche exhaustive sur `index.html`, `i18n.js`, `app.js`, `emails.js` | Rien à signaler. Le produit ne s'attribue aucune caution externe. | **VRAI — point sain** |

---

## Les dix corrections à faire en premier

Classées par gravité : une affirmation fausse montrée à un client passe avant une formulation maladroite dans un courriel interne.

### 1. Le site déployé peut afficher un marché entièrement fabriqué, sans le dire — `app.js:75-82`, `domain/index.js:1633-1667`

Dès que l'API répond autre chose qu'un 2xx — pas seulement hors ligne : 500, 502, 503, 429, 403 — le carnet se remplit de **34 offres inventées**, avec des noms de clients (« Marie-Ève Tremblay »), des noms d'études (« Cabinet Sainte-Foy »), des secteurs postaux authentiques de Québec, des médianes de 4 165 $ / 3 600 $ et un **montant pré-rempli** dans le formulaire d'offre, calibré dessus. Le service worker (`sw.js:38-48`) transforme même une panne réseau en 503, ce qui garantit ce chemin. Sur le commit déployé (`6758c53`), **aucune bannière, aucune marque, aucun avertissement** — et les titres au-dessus disent « Ce que les clients offrent » et « Ouvertes en ce moment ».

Le correctif existe déjà dans l'arbre de travail (bannière + marques par région + écran de publication hors ligne). **Il doit être poussé**, et complété sur trois points : les surfaces non couvertes (`#notary-live`, `#day-dialog` avec le montant pré-rempli, `#onboarding-dialog` avec ses « 34 demandes publiées ce mois-ci », le film d'intro), la course sur `state.demo` (`app.js:6864`), et une garde `r.ok` sur le chemin notaire (`app.js:4798`).

### 2. « Vos renseignements restent sur cet appareil » — `index.html:1479`, `app.js:874`

Faux au moment même où c'est affiché : le bouton juste dessous transmet le courriel au serveur, qui le conserve dans un enregistrement `SENT#` clé sur l'adresse. C'est une **affirmation de confidentialité démentie par le clic suivant**, sur l'écran d'inscription, en français comme en anglais (`i18n.js:229, 840`).

### 3. Le désabonnement ne désabonne personne — `notifications.js:45` vs `cloudfront.tf:111-131, 186-204`

Le lien renvoie le SPA en 200 sans rien enregistrer ; le un-clic RFC 8058 reçoit un 403 ; le jeton n'est pas signé, donc n'importe qui peut désabonner n'importe qui. C'est le **seul** mécanisme de retrait offert dans les 41 courriels. Correctif minimal : préfixer l'URL de `/api`, autoriser le `POST` sur ce chemin, signer le jeton.

### 4. « Elles ne quittent pas le pays » — `index.html:1126`, `i18n.js:1058`

Absolu que l'infrastructure contredit sur trois fronts : PoP CloudFront en Europe et aux États-Unis, police chargée depuis `rsms.me` à chaque visite, Stripe aux États-Unis. Écrire ce qui est vrai : *les données sont **stockées** au Canada (`ca-central-1`)*, et nommer les tiers.

### 5. « Chances d'obtenir un notaire : 95 % » — `app.js:1952`, `domain/index.js:1738`

Un pourcentage écrit à la main, jamais mesuré, présenté comme une probabilité observée — et affiché au moment exact où le client choisit sa date, donc son prix. C'est la statistique la plus décisive du parcours et la moins fondée. Soit la mesurer (le taux de rétention par palier est calculable depuis le registre), soit la remplacer par un énoncé qualitatif.

### 6. « Le courriel de notification est effacé dès que l'offre est close ou expirée » — `index.html:1137`

Aucun code ne l'efface. Soit implémenter l'effacement au passage en `ANNULEE`/expiration, soit retirer la phrase. Une promesse de suppression non tenue est le pire des deux mondes. Corriger dans la foulée « au plus 12 mois » (`:1137`), le TTL réel étant de 400 jours.

### 7. L'adresse postale des courriels est un placeholder — `emails.js:46`

`000, rue à confirmer […] G0X 0X0` sur les 41 gabarits, commerciaux compris, verrouillé par un test qui n'en vérifie que la présence (`emails-brand.test.mjs:57-58`). À remplacer par l'adresse réelle avant tout envoi de masse — et corriger le test pour qu'il refuse un placeholder. Régler au passage l'expéditeur : les courriels partent aujourd'hui d'une adresse Gmail personnelle (`terraform.tfvars:8`) tout en se signant « Nota ».

### 8. « Ce que vous offrez est ce que le notaire reçoit » + « aucun frais caché » — `index.html:1224`

Contredit par les deux énoncés de la même page (`:1170`, `:1180`) et par les frais d'annulation non divulgués. Deux corrections liées : réécrire la phrase de la Charte, et **divulguer le barème d'annulation (30 % / 10 % / gratuit) avant la publication de l'offre** — dans les Conditions et sous le bouton — pas seulement dans le dialogue d'annulation (`app.js:3673`). Dire aussi, à cet endroit, que publier autorise la carte.

### 9. Trancher l'état de Stripe et des courriels en production

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NOTA_FROM_EMAIL`, `NOTA_BASE_URL` et `NOTA_OPERATOR_EMAIL` sont vides dans le seul état enregistré. Si c'est exact, **une douzaine d'affirmations passent de INVÉRIFIABLE à FAUX** : « le client autorise le paiement dès la publication », « le net vous est viré », toute promesse « vous serez prévenu par courriel », et l'inscription notaire renvoie une 500 — la porte notaire ne s'ouvre alors pour personne. Une commande, une réponse. À faire avant toute autre correction de copie sur le paiement.

### 10. Deux promesses faites à des professionnels que le produit ne tient pas

- **Le panneau de préférences du notaire ne fait rien** (`index.html:861-892`, `app.js:5389-5406`) : le canal SMS n'existe nulle part dans le code, la cadence n'est jamais lue par le serveur, tout est en `localStorage`, et « ✓ Préférences enregistrées » le dissimule. Retirer la bascule SMS et la cadence, ou les brancher.
- **« Votre évaluation aide les prochains clients à choisir en confiance »** (`emails.js:1764, 1773`) : l'évaluation n'est montrée à aucun client (ADR 0030), et le courriel envoyé au notaire le dit explicitement (`emails.js:1810`). C'est pourtant la phrase qui **obtient** l'évaluation. Dire ce qui est vrai : elle entre dans la cote du notaire, donc dans sa part.

**Juste derrière**, deux statistiques décidées puis présentées comme mesurées : « le marché se conclut généralement entre 1,8× et 2,2× » (`emails.js:510-512`, tiré de multiplicateurs codés en dur `domain/index.js:639-645`, alors que `tunedTierMultipliers` existe et n'est pas utilisé), et la « médiane » rehaussée au prix plancher sans seuil d'effectif (`domain/index.js:1501`).

---

## Récapitulatif

| Verdict | Nombre |
|---|---|
| **VRAI** | 30 |
| **TROMPEUR** | 21 |
| **FAUX** | 17 |
| **INVÉRIFIABLE** | 9 |
| **Total audité** | **77** |

**Ce qui est déjà bien fait**, et qu'il faut préserver :

- le désaveu de vérification sur le badge CNQ (`app.js:640-646`) — le désaveu est identique en version courte et longue, porté par `title` **et** `aria-label` : Nota nomme le déclarant et refuse de laisser croire qu'elle a vérifié ;
- l'absence totale de caution externe revendiquée : aucun « certifié », « agréé », « approuvé », « partenaire de la Chambre » dans tout le produit ;
- aucune note ni aucun avis fabriqué : `ratingSpan` renvoie `null` sans avis (`app.js:617-623`), et le JSON-LD ne contient ni `aggregateRating` ni `reviewCount` ;
- aucun taux inventé quand la facturation est éteinte (`ncRenderCote`, `app.js:6417`) ;
- le courriel de versement qui ne part que si un transfert réel a eu lieu (`notifications.js:763-780`) ;
- le retrait de l'ancien chemin `chargeActCommission`, qui affirmait un mouvement d'argent inexistant (ADR 0029) ;
- la page Partenaires, qui ne contient aucun montant littéral — tout vient du domaine, y compris la clause des Conditions ;
- la console notaire et l'API de production, qu'aucune fixture ne touche ;
- le travail de déclaration des données de démonstration entamé dans l'arbre de travail, et la correction du compteur du film d'introduction — tous deux intervenus pendant cet audit.
