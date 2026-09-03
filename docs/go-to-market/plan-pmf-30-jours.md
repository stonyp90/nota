# Plan PMF — 30 jours pour les premiers usagers

Date : 2026-09-02 · Horizon : 3 septembre → 3 octobre 2026 · Propriétaire de
chaque ligne : Anthony, sauf mention.

## 1. Le constat, tel que le code et l'infra le disent

| Domaine | État réel au 2 septembre |
| --- | --- |
| Produit | 216 commits, six couches de tests vertes (1 164 tests), carnet public, console notaire, console admin, 41 gabarits de courriel bilingues. |
| Usagers | **Zéro.** Un seul `NOTARY#` en production, en `@nota.ca` : un enregistrement de test. |
| Courriels | **Zéro parti.** SES en bac à sable, expéditeur = adresse Gmail personnelle, aucun domaine vérifié. Ni lien magique notaire, ni confirmation client, ni alerte opérateur ne peut atteindre qui que ce soit. |
| Paiement | `STRIPE_SECRET_KEY` vide. Une offre se publie sans carte ; un notaire ne peut pas s'inscrire (503). |
| Domaine | Aucun. Le site vit sur `d1s1h4894dau0c.cloudfront.net` et affiche `nota.quebec` et `@nota.ca` selon la page. |
| Alertes | Huit alarmes CloudWatch, **zéro abonné** SNS. Logs conservés 1 jour. |
| Données | Le carnet public montre **16 offres de test** avec des noms fictifs (« Martin Gauthier », …), créées le 27 août. |
| GTM | 37 contacts dans le pipeline, **0 courriel envoyé, 0 entrevue**. Tout est suspendu à une adresse postale (LCAP) et à l'envoi du courriel Gamache. Le kit décrit encore le partage 85/95 retiré par l'ADR 0031. |

Et dans le tunnel lui-même, ce qui faisait fuir un premier visiteur :

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
| 2 | **SES : domaine + sortie du bac à sable** | `from_email = "bonjour@<domaine>"` ; `terraform apply` crée l'identité, DKIM, MAIL FROM, DMARC et le rattachement des rebonds au sujet d'alertes. Puis la demande au support AWS (texte en annexe A). Délai AWS : 24 à 48 h — c'est le chemin critique, à lancer le jour 1. |
| 3 | **Stripe en mode live** | `stripe_secret_key`, `stripe_webhook_secret` ; point de terminaison `https://<domaine>/api/stripe/webhook` avec les événements `account.updated`, `account.application.deauthorized`, `checkout.session.completed`, `checkout.session.expired`, `payment_intent.canceled`. |
| 4 | **Les trois adresses** | `operator_email` (sans elle, six alertes sont muettes), `sender_address` (adresse postale, exigée par la LCAP sur chaque courriel), `alert_email` (puis confirmer l'abonnement SNS reçu par courriel). `log_retention_days = 14`. |
| 5 | **Purger les données de test** | Annexe B. Un notaire de la vague 1 qui verrait « Martin Gauthier » retenir une offre fantôme ne reviendrait pas. |
| 6 | **Déployer** | `git push` (le site et l'API partent seuls) ; `gh workflow run deploy-admin.yml` pour la console admin, qui reçoit désormais les inscriptions notaires à activer. |
| 7 | **Envoyer Gamache, puis la vague 1** | L'adresse postale du geste 4 débloque le kit. Neuf courriels individuels (`vague-1-neuf-notaires.md`), 20 par jour maximum, colonne `e1_envoye` remplie le jour même. |

## 4. Semaines 1–2 (8–19 septembre) — dix notaires actifs

- **L'inscription ne demande plus Stripe.** Un notaire entre son courriel professionnel et, s'il veut, le lien de sa fiche au Tableau ; il reçoit « Inscription reçue » ; l'opérateur vérifie la fiche (une à la fois, jamais d'extraction du bottin) et clique « Activer » dans la console admin ; le notaire reçoit son accès. Les versements Stripe se branchent plus tard, seulement avant le premier acte signé.
- **Objectif chiffré :** 10 comptes activés, dont 5 qui ont ouvert le fil deux fois ; 5 entrevues de 20 minutes (grille `entrevue-notaire.md`). La question qui décide tout est H2 : « à quel prix prenez-vous un refinancement jeudi prochain ? » — une réponse en chiffres par notaire, consignée dans `pipeline-notaires.csv`.
- **Mettre le kit au modèle réel** (`validation-notaires.md`, `courriels-notaires.md` E4, `entrevue-notaire.md`) : deux lignes, 100 % au notaire, prix fixe de Nota. Le premier notaire à qui l'on parle ne doit pas entendre un chiffre que quatre textes condamnent.
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

## 7. Livré aujourd'hui (code) et ce qu'il reste

**Livré, testé, prêt à pousser :**

- inscription notaire par courriel + fiche CNQ, activation manuelle dans la console admin, accès qui survit à tout l'onboarding Stripe ultérieur ;
- page d'accueil honnête (prix en deux lignes, calculé, jamais écrit en dur), CTA qui ouvre la première date standard, choix de date dans le formulaire, courriel visible et requis, écran de publication qui dit la vérité ;
- entonnoir de conversion : catalogue d'événements dans le domaine, `POST /events`, compteurs par jour, bloc dans la console admin ;
- Terraform de l'identité de domaine SES (DKIM, MAIL FROM, DMARC, rebonds vers les alertes), inactif tant qu'aucun domaine n'est posé.

**À faire ensuite, par ordre d'importance :**

1. **L'autorisation de carte qui expire à 7 jours** (`stripe-port.js`, `billing.js`) : passer Checkout en mode `setup` (carte enregistrée, aucun blocage) et débiter à la signature. Sans ça, toute offre à plus de sept jours disparaît du carnet sans prévenir. Effort moyen ; c'est le prochain chantier de plomberie.
2. **Un seul interstitiel.** Garder le film à la première visite, retirer le guide à la deuxième : deux écrans bloquants de 15 à 20 s sur deux visites, c'est deux occasions de partir. Décision du propriétaire.
3. **Filet « aucun notaire »** : à J-3 sans rétention, courriel au client et alerte opérateur — la règle de conciergerie, automatisée.
4. **Pages par acte** (refinancement, financement) avec le prix de départ et les prochaines dates : c'est ce que la recherche payante et les IA citent.
5. **Kit GTM au modèle ADR 0031** (§ 4) — une heure, avant le premier appel.

## Annexe A — demande de sortie du bac à sable SES

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
