# Plan PMF — 30 jours pour les premiers usagers

Date : 2026-09-02 · Horizon : 3 septembre → 3 octobre 2026 · Propriétaire de
chaque ligne : Anthony, sauf mention.

## 1. Le constat, tel que le code et l'infra le disent

| Domaine | État réel au 2 septembre |
| --- | --- |
| Produit | 216 commits, six couches de tests vertes (1 164 tests), carnet public, console notaire, console admin, 41 gabarits de courriel bilingues. |
| Usagers | **Zéro.** Un seul `NOTARY#` en production, en `@nota.ca` : un enregistrement de test. |
| Courriels | **Aucun courriel du produit n'est parti.** L'accès production SES est **accordé** (vérifié le 2026-09-03, quota 50 000/jour) : le bac à sable n'est pas le problème. Le problème est qu'**aucune identité de domaine n'existe** — pas de DKIM, pas de SPF aligné, expéditeur = adresse Gmail personnelle. Un lien magique notaire ou une confirmation client partirait techniquement, et atterrirait dans les indésirables. |
| Paiement | `STRIPE_SECRET_KEY` vide. Une offre se publie sans carte ; un notaire ne peut pas s'inscrire (503). |
| Domaine | Aucun. Le site vit sur `d1s1h4894dau0c.cloudfront.net` et affiche `nota.quebec` et `@nota.ca` selon la page. |
| Alertes | Huit alarmes CloudWatch, **zéro abonné** SNS. Logs conservés 1 jour. |
| Données | Le carnet public montre **16 offres de test** avec des noms fictifs (« Martin Gauthier », …), créées le 27 août. |
| GTM | 37 contacts dans le pipeline, **0 courriel envoyé, 0 entrevue** *(état au 2 septembre ; voir le tableau du § 7 pour le 4)*. Tout est suspendu à une adresse postale (LCAP). Le kit décrit encore le partage 85/95 retiré par l'ADR 0031. |

Et dans le tunnel lui-même, ce qui faisait fuir un premier visiteur *(constat du 2 septembre ; le « 400 $ » qui y apparaît est l'ancien prix unique, remplacé le 3 septembre par la grille par service de l'ADR 0034 — 199 $ / 249 $ plus la garantie de date)* :

- la page disait « Gratuit pour vous » ; le formulaire, trois clics plus loin, affichait « Service Nota 400 $ » ;
- « Réserver votre date » ouvrait **aujourd'hui** : 7 400 $ + 400 $ autorisés sur la carte comme première image ;
- le courriel du client était facultatif et caché : un client retenu pouvait être injoignable ;
- un notaire devait passer la vérification d'identité et bancaire de Stripe **avant** de voir une seule demande ;
- rien n'était mesuré avant la publication payée : impossible de savoir où ça casse ;
- l'autorisation de carte expire après ~7 jours alors qu'une date « standard » est à 15 jours et plus : toute offre standard se vide d'elle-même, sans un mot au client (reste à corriger, § 7).

## 2. La thèse : une seule mesure, et un opérateur derrière chaque demande

**Le PMF de Nota tient en un nombre : le taux de rétention** — offres retenues
par un notaire sur offres publiées par de vrais clients, au prix affiché. Le plan
d'affaires fixe le seuil : sous 40 % le marché ne se règle pas, au-dessus de
60 % la roue tourne. Tant qu'il n'y a pas dix demandes réelles, aucun autre
chiffre ne mérite une décision.

**L'approche : la place de marché conciergée.** Pendant 30 jours, Nota est une
vitrine, un formulaire, un encaissement — et un opérateur qui ferme chaque
demande à la main. Une offre publiée déclenche une alerte ; l'opérateur appelle
trois notaires du pipeline dans les quatre heures ouvrables ; l'un d'eux retient
depuis sa console. Le produit fait la prise de commande et le paiement ; l'humain
fait la liquidité. C'est le chemin le plus court vers la seule donnée qui compte
(un notaire prend-il un jeudi vide à ce prix ?) et il coûte zéro dollar
d'acquisition.

Deux promesses, jamais plus : « le notaire reçoit 100 % de votre offre » et
« vous n'êtes débité qu'à la signature ». Jamais « moins cher » (art. 32.1 1°),
jamais un témoignage sur un notaire nommé (art. 70), jamais un délai garanti.

## 3. Semaine 0 (3–5 septembre) — ouvrir les portes

Sept gestes du propriétaire. Aucun n'est du code ; tous bloquent le premier usager.

| # | Geste | Comment |
| --- | --- | --- |
| 1 | **Choisir un domaine** — un seul. Le film dit `nota.quebec`, les courriels `@nota.ca`. | Acheter, créer la zone Route53, poser `domain_name` et `hosted_zone_id` dans `infra/terraform.tfvars`. `acm.tf` et le nouveau `ses-domain.tf` font le reste. |
| 2 | **SES : poser l'identité de domaine** — l'accès production est **déjà accordé** (vérifié le 2026-09-03, quota 50 000/jour). Le blocage n'a jamais été le bac à sable : c'est qu'**aucun domaine n'est vérifié**, donc aucune signature DKIM, aucun SPF aligné, et un envoi depuis une adresse Gmail personnelle qui tombe dans les indésirables. | `from_email = "bonjour@<domaine>"` ; `terraform apply` crée l'identité, DKIM, MAIL FROM, DMARC et le rattachement des rebonds au sujet d'alertes. Puis publier les enregistrements DNS et attendre la vérification (minutes à quelques heures). Aucune demande au support AWS n'est requise. Dépend du geste 1. |
| 3 | **Stripe en mode live** | `stripe_secret_key`, `stripe_webhook_secret` ; point de terminaison `https://<domaine>/api/stripe/webhook` avec les événements `account.updated`, `account.application.deauthorized`, `checkout.session.completed`, `checkout.session.expired`, `payment_intent.canceled`. |
| 4 | **Les trois adresses** | `operator_email` (sans elle, six alertes sont muettes), `sender_address` (adresse postale, exigée par la LCAP sur chaque courriel), `alert_email` (puis confirmer l'abonnement SNS reçu par courriel). `log_retention_days = 14`. |
| 5 | **Purger les données de test** | Annexe B. Un notaire de la vague 1 qui verrait « Martin Gauthier » retenir une offre fantôme ne reviendrait pas. |
| 6 | **Déployer** | `git push` (le site et l'API partent seuls) ; `gh workflow run deploy-admin.yml` pour la console admin. L'activation d'un notaire inscrit passe encore par l'API, pas par un bouton (§ 7). |
| 7 | **Envoyer Gamache, puis la vague 1** | L'adresse postale du geste 4 débloque le kit. Neuf courriels individuels (`vague-1-neuf-notaires.md`), 20 par jour maximum, colonne `e1_envoye` remplie le jour même. |

## 4. Semaines 1–2 (8–19 septembre) — dix notaires actifs

- **L'inscription sans Stripe : côté serveur seulement.** Le modèle visé est
  celui-ci — un notaire entre son courriel professionnel et, s'il veut, le lien
  de sa fiche au Tableau ; il reçoit « Inscription reçue » ; l'opérateur vérifie
  la fiche (une à la fois, jamais d'extraction du bottin) et l'active dans la
  console admin ; les versements Stripe se branchent plus tard, avant le premier
  acte signé. **Les deux routes existent et sont testées, aucun écran ne les
  appelle** (§ 7). Deux petits chantiers avant que la vague 1 puisse s'inscrire
  seule : un formulaire d'inscription sur le site, et un bouton « Activer » dans
  la console admin. D'ici là, l'opérateur inscrit et active à la main.
- **Objectif chiffré :** 10 comptes activés, dont 5 qui ont ouvert le fil deux fois ; 5 entrevues de 20 minutes (grille `entrevue-notaire.md`). La question qui décide tout est H2 : « à quel prix prenez-vous un refinancement jeudi prochain ? » — une réponse en chiffres par notaire, consignée dans `pipeline-notaires.csv`.
- **Mettre le kit au modèle réel** (`validation-notaires.md`, `courriels-notaires.md` E4, `entrevue-notaire.md`) : deux lignes, 100 % au notaire, prix de Nota publié d'avance (199 $ / 249 $ par service, plus la garantie de date — ADR 0034). Le premier notaire à qui l'on parle ne doit pas entendre un chiffre que quatre textes condamnent.
- **Réseaux démultiplicateurs**, après les neuf : AJNQ (porte principale des jeunes notaires), PME INTER, Jurisconseil ; l'APNQ pour le colloque des 23–24 octobre.

## 5. Semaines 2–4 (15 septembre – 3 octobre) — dix demandes réelles

Trois canaux, dans l'ordre du coût d'acquisition :

1. **Courtiers hypothécaires** — ils tiennent le client à J-15 de la signature, exactement le moment où Nota vaut quelque chose. Cinq courtiers de la région, un code partenaire chacun (50 $ par client retenu, ADR 0011), un message : « votre client choisit sa date, il voit le prix, vous ne faites rien de plus ». Le versement des 50 $ n'a pas encore de rail : le dire, et payer à la main le premier mois.
2. **Recherche payante sur l'urgence** — dix requêtes (« notaire refinancement rapide Québec », « notaire cette semaine Québec », « signer refinancement vite »), budget 500 $, page d'arrivée = le carnet ouvert sur la première date standard. C'est le seul endroit où une date rapprochée a un prix : la requête et la promesse coïncident.
3. **Le réseau direct** — LinkedIn, groupes locaux, entourage : une annonce honnête (« nous cherchons nos dix premiers clients ; le notaire reçoit 100 % de votre offre »), un lien, rien d'autre.

**Conciergerie, règle interne :** chaque offre publiée est rappelée en moins de
quatre heures ouvrables (l'alerte opérateur porte le courriel du client) ; si
aucun notaire n'a retenu à J-3, le client est prévenu par un humain et peut
retirer sans frais. Cette règle ne s'écrit pas sur le site tant qu'elle n'est pas
tenue dix fois.

## 6. Ce qui se mesure, chaque lundi

L'entonnoir vit désormais dans la console admin (`GET /admin/metrics/overview`,
bloc « Entonnoir »), alimenté par des balises sans identifiant et par les
écritures serveur :

`visites → dates ouvertes → formulaires commencés → offres publiées → cartes
autorisées → retenues → actes signés`, plus `notaires inscrits → activés`.

| Mesure | Seuil à 30 jours | Si c'est sous le seuil |
| --- | --- | --- |
| Notaires activés | 10 | Le canal est le problème : passer par l'AJNQ avant d'écrire une ligne de code. |
| Demandes réelles publiées | 10 | La demande est le problème : doubler les courtiers, couper la recherche payante si son coût par formulaire dépasse 50 $. |
| Taux de rétention | > 40 % | Le prix ou le délai est le problème : lire les contre-offres (`/notary/bids/propose`) — elles disent le prix réel. |
| Délai publication → rétention | < 2 jours ouvrables | L'opérateur ne tient pas la règle des quatre heures. |
| Formulaires → publiées | > 50 % | Le formulaire fait fuir : regarder quelle question du notaire arrête les gens. |

Le même lundi sert au triage des demandes d'amélioration reçues des premiers
usagers : le dispositif — conseil de dix, cadence de 30 minutes, chemin d'une
demande jusqu'à la note de version — est décrit dans
[`les-usagers-dans-le-cycle-de-developpement.md`](les-usagers-dans-le-cycle-de-developpement.md),
et il se mesure au même taux de rétention.

## 7. Livré aujourd'hui (code) et ce qu'il reste

**Livré, testé et déployé — côté serveur ; lire chaque ligne jusqu'au bout, l'une d'elles n'a pas de surface** (commits `9db4b79` → `8de32a9`, six couches vertes :
domaine 239 · api 828, les 22 tests de contrat compris · web 483 · admin 99,
soit 1 649 tests, plus 137 scénarios BDD — 717 pas — et 10 parcours Playwright ;
déploiements web et admin verts) :

- inscription notaire par courriel + fiche CNQ : **l'API existe, la surface n'existe pas.** Les deux routes sont écrites et couvertes par des tests (`POST /notaries/signup` dans `handler.js`, `POST /admin/notaries/{id}/activer` dans `admin-handler.js`, `apps/api/test/notary-signup.test.mjs`), et `approuveLe` fait bien survivre l'accès à tout l'onboarding Stripe ultérieur. Mais **aucune interface ne les appelle** : ni `apps/web/public/app.js`, ni `apps/admin/public/admin.js` ne contient un seul appel à ces deux routes — le parcours notaire du site passe encore par l'onboarding Stripe Connect. Vérifié le 2026-09-04. Tant que les deux écrans ne sont pas écrits, l'inscription sans Stripe se fait au `curl`, par l'opérateur, ou pas du tout ;
- page d'accueil honnête (« le notaire reçoit 100 % de votre offre ; le service Nota se paie seulement à la signature — devenu depuis une grille publiée par service, ADR 0034 »), CTA qui ouvre la première date standard, choix de date dans le formulaire, écran de publication qui dit la vérité ; nom et courriel du client requis (ADR 0033) ;
- entonnoir de conversion : catalogue d'événements dans le domaine (`FUNNEL_EVENTS`), `POST /events` en `fetch` sans identifiant, compteurs par jour, bloc « entonnoir » dans la console admin ;
- Terraform de l'identité de domaine SES (`infra/ses-domain.tf` : DKIM, MAIL FROM, DMARC, rebonds vers les alertes), inactif tant qu'aucun domaine n'est posé.

**Livré ensuite, les 3 et 4 septembre** (commits `18e017e` → `5e68c59`, sept
couches vertes sur l'arbre combiné : domaine 294 · api 1 066 · contrat 22 ·
web 628 · admin 144 · BDD 153 scénarios · Playwright 26) :

- **Partenaires, deux passes** : estimateur « clients par mois → par année » (`D.referralProjection`), message prêt à envoyer au client avec le lien du partenaire, « Copié ✓ » seulement sur copie réussie ; puis le sélecteur « Vous êtes… » (courtier immobilier · courtier hypothécaire · autre professionnel) avec, pour chaque métier, le bon moment pour référer, porté par le domaine, et la puce du formulaire synchronisée dans les deux sens. « Agent immobilier » est devenu « Courtier immobilier », le titre de l'OACIQ.
- **ADR 0034** : le prix de Nota est une grille publiée par service (199 $ financement, 249 $ refinancement) plus la garantie de date sur sa propre ligne ; « prix fixe » est retiré de toute la copie et un garde-fou (art. 68) refuse le mot.
- **ADR 0035** : la caution remplace l'autorisation de carte à sept jours — carte enregistrée à la publication, blocage posé deux jours avant la signature, au devis gelé. Le point 1 de la liste ci-dessous est réglé.
- **ADR 0037** : la récompense de parrainage est acquise à la rétention et versée à la signature ; cartes, FAQ, courriel et colonne admin « payable » alignés.
- **Geste 4, aux deux tiers** : courriel opérateur sur les deux Lambdas, abonnements SNS créés (à confirmer par le clic dans les deux courriels AWS), journaux conservés 14 jours. Manque l'adresse postale LCAP.

**Ce que le code ne peut pas faire à votre place :** les sept gestes du § 3.
Tant qu'ils ne sont pas faits, tout ce qui précède tourne à vide.

| Geste | État au 4 septembre |
| --- | --- |
| 1 Domaine | À faire — le film dit encore `nota.quebec`, les courriels `@nota.ca`. |
| 2 SES | À faire — **mais pas ce qu'on croyait** : l'accès production est accordé (50 000/jour, vérifié le 2026-09-03) ; ce qui manque est l'identité de domaine. Terraform prêt (`ses-domain.tf`), en attente du geste 1. L'annexe A est sans objet. |
| 3 Stripe live | À faire — la caution (ADR 0035) attend les clés. |
| 4 Adresses | Aux deux tiers — opérateur et alertes posés ; confirmer les deux abonnements SNS ; **adresse postale manquante, et c'est elle qui retient les neuf courriels de la vague 1**. |
| 5 Purge des données de test | À faire — annexe B ; les 16 offres fictives sont toujours au carnet. |
| 6 Déployer | Fait en continu — web et admin partent à chaque poussée sur `main`. |
| 7 Gamache + vague 1 | **Amorcé.** Gamache : courriel envoyé le 2026-09-02 (1 ligne `contacte`). Vague 1 : les neuf brouillons Gmail sont créés le 2026-09-03 et **aucun n'est envoyé** (9 lignes `brouillon_gmail`), faute d'adresse postale. 27 contacts restent à rédiger. 0 entrevue tenue. |

**À faire ensuite, par ordre d'importance :**

1. ~~**L'autorisation de carte qui expire à 7 jours**~~ — réglé le 4 septembre par l'ADR 0035 (caution différée, `5e68c59`).
2. **Un seul interstitiel.** Garder le film à la première visite, retirer le guide à la deuxième : deux écrans bloquants de 15 à 20 s sur deux visites, c'est deux occasions de partir. Décision du propriétaire.
3. **Filet « aucun notaire »** : à J-3 sans rétention, courriel au client et alerte opérateur — la règle de conciergerie, automatisée.
4. **Pages par acte** (refinancement, financement) avec le prix de départ et les prochaines dates : c'est ce que la recherche payante et les IA citent.
5. ~~**Kit GTM au modèle ADR 0031**~~ — fait le 2026-09-04 : `validation-notaires.md` § 2, `courriels-notaires.md` (E4 et le bloc « La grille »), `entrevue-notaire.md` (bloc H3 et fiche de prix) et la veille portent la grille des ADR 0031/0034 ; l'ancien barème 85/95 et la cote publiée sont marqués retirés partout où ils survivaient.
6. **Les deux écrans de l'inscription notaire** — formulaire d'inscription au site, bouton « Activer » à la console admin. Les routes existent depuis le 3 septembre et personne ne peut les atteindre (§ 7).

## Annexe A — demande de sortie du bac à sable SES *(sans objet)*

> **Périmée.** Vérifié le 2026-09-03 : le compte a **déjà l'accès production
> SES** en ca-central-1, avec un quota de 50 000 messages/jour. Cette demande
> n'a plus à être déposée. Le texte reste ici parce qu'il décrit correctement
> l'usage, les destinataires et le traitement des rebonds — c'est la matière
> d'une éventuelle demande de hausse de quota, ou d'une question de la Chambre.


À déposer dans la console AWS (Support → Service limit increase → SES Sending
Limits, région ca-central-1), en anglais :

> **Use case:** Nota (nota.quebec) is a Québec marketplace where homeowners post
> the date they need a mortgage refinancing signed and notaries retain the
> request. All email is **transactional and triggered by a user action**:
> offer confirmation to the client, magic sign-in link and new-request alert to
> a registered notary, operator alerts. No marketing lists, no purchased
> addresses. Expected volume: under 500 emails/month for the first quarter.
>
> **Recipients:** only people who entered their address on our site (clients)
> or created an account (notaries). Every message carries our postal address
> and a one-click unsubscribe link signed server-side (`/api/unsubscribe`).
>
> **Bounces and complaints:** the domain identity uses Easy DKIM, a custom
> MAIL FROM and DMARC (quarantine). Bounce, complaint and reject events are
> routed through an SES configuration set to an SNS topic monitored by the
> operator; a suppressed address (`UNSUB#` ledger) is never emailed again, and
> hard bounces are added to the same ledger.
>
> **Requested:** production access and a sending quota of 1 000/day.

## Annexe B — purger les données de test en production

Cinquante-six éléments dans `nota-main`, tous de test. Lister d'abord, effacer
ensuite ; jamais l'inverse. Utiliser le binaire brut (`/opt/homebrew/bin/aws`),
pas l'enveloppe `rtk` qui condense la sortie JSON.

```bash
/opt/homebrew/bin/aws dynamodb scan --table-name nota-main --region ca-central-1 \
  --projection-expression 'PK,SK' --output json > /tmp/nota-main-keys.json
jq '.Items | group_by(.PK.S | split("#")[0]) | map({prefix: .[0].PK.S | split("#")[0], n: length})' /tmp/nota-main-keys.json
```

Si la liste ne contient que `MONTH#`, `STATS#` et le `NOTARY#` de test (courriel
en `@nota.ca`), effacer :

```bash
jq -c '.Items[] | {PK: .PK, SK: .SK}' /tmp/nota-main-keys.json | while read -r key; do
  /opt/homebrew/bin/aws dynamodb delete-item --table-name nota-main --region ca-central-1 --key "$key"
done
```

Les compteurs `STATS#` repartent de zéro avec la première vraie offre ; le
carnet vide affiche « dès 2 000 $ » sur chaque date, ce qui est exactement la
vérité.
