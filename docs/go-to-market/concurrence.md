# Veille concurrentielle — plateformes juridiques et notariales

Relevé du 1<sup>er</sup> septembre 2026, **corrigé le 3 septembre** par quatre
crawls directs consignés dans [`veille-2026-09-03/`](veille-2026-09-03/). Trois
conclusions d'abord, les fiches ensuite. Ce que le 3 septembre a démenti porte
la mention **corrigé le 3 septembre** et cite le relevé qui le démontre.

---

## Trois conclusions

### 1. Personne ne prélève un pourcentage des honoraires du professionnel

Toutes les plateformes qui ont levé du capital et qui opèrent aujourd'hui
facturent **le client**, à prix fixe, et paient le professionnel. Ce n'est pas
un hasard de marché : c'est la seule structure qui survit à la réglementation
professionnelle. Les seules qui facturent le professionnel le font **par
piste** (lead), pas par pourcentage d'acte.

**Corrigé le 3 septembre.** Le 1<sup>er</sup> septembre, ce constat servait à
valider l'ADR 0028 (un total qui se *partage* à la signature). L'ADR 0031 a
retiré ce partage le lendemain, et le crawl du 3 septembre a trouvé mieux : la
validation externe porte désormais sur l'ADR 0031, et elle est littérale.
Notairo vend sur sa boutique Shopify un produit nommé « **Frais de prise en
charge de dossier — 295 $** », dont la fiche dit que « les honoraires du notaire
et les débours seront payables directement au notaire lors du rendez-vous de
signature ». C'est mot pour mot la structure de l'ADR 0031, en vente au Québec.
Le prix fixe de Nota a donc un comparable direct — et il est **35 % plus cher**
(400 $ contre 295 $). Rapporté au total client, le 400 $ déployé pèse **16,7 %**
d'un refinancement standard (2 000 + 400) et **18,2 %** d'un financement
(1 800 + 400) : niveau Upwork (18 %), au-dessus d'Airbnb (13,6 %). Le prix fixe
est régressif — plus l'acte est petit, plus Nota pèse. Voir
[relevé A §1](veille-2026-09-03/a-notairo-deeded-ownright.md) et
[relevé C §2.2](veille-2026-09-03/c-decouverte-et-marges.md).

Sur le fil Stripe, en revanche, Nota est déjà dans la forme de la colonne de
gauche : le client paie la plateforme
(session Checkout sur le compte de Nota), et à la signature Nota garde sa part
et vire le net au notaire. Ce n'est pas un prélèvement sur un encaissement du
notaire. Ce que cela ne tranche pas, c'est la **qualification** au sens de
l'article 32.1 de la *Loi sur le notariat* : l'avis juridique écrit reste requis
avant la mise en service.

### 2. Nota est nettement plus cher côté client — et doit l'assumer

Un refinancement standard sur Nota : **2 000 $** d'honoraires + **400 $** de
service Nota = **2 400 $** (palier `standard`, prêt ≤ 300 k$, approbation
obtenue). Notairo affiche **949 $ + débours** pour le même acte.

**Corrigé le 3 septembre — deux fois, et dans les deux sens.** D'abord, le
949 $ n'est pas le prix de Notairo : son catalogue Shopify vend le refinancement
en forfaits « avance d'honoraires et de débours » à **1 795 / 1 995 / 2 225 $
taxes incluses**. Au palier `standard`, l'écart n'est donc pas de 40–60 % mais
de quelques centaines de dollars. Ensuite, l'écart réel est ailleurs : sous
14 jours, le curseur de Nota se pré-remplit à 4 000 $ (10 jours) ou 6 000 $
(5 jours), soit **×3 à ×5** les repères que le client lit ailleurs — 750 $ pour
une quittance et 1 300–1 600 $ pour une transaction chez Soumissions Québec.
Voir [relevé A §1](veille-2026-09-03/a-notairo-deeded-ownright.md) et
[relevé B, constat 5](veille-2026-09-03/b-generation-de-demandes-quebec.md).

Ce n'est pas une faille à corriger par une baisse de prix : c'est la thèse.
Notairo, Deeded et Ownright vendent **moins cher**. Nota vend **la date**. Le
palier `standard` de Nota n'a aucun avantage concurrentiel et n'a pas à en
avoir — c'est le plancher d'une échelle dont la valeur commence à `rapide` et
se réalise à `urgence`.

**Corrigé le 3 septembre : l'urgence EST déjà tarifée partout, mais en petits
caractères.** Notairo écrit sous son tableau de prix que « des frais
additionnels peuvent s'appliquer dans certains cas particuliers (**urgence,
signatures hors heures**, transactions complexes) » et répond « Oui ! Nous
priorisons les dossiers en fonction de la date de signature prévue ». Proof
facture les clôtures immobilières 45–150 $ la séance contre 25 $ le standard.
Deeded a facturé 240 $ de frais rush dans un dossier documenté par un avis
Birdeye. Soumissions Québec et Soumissions Maison capturent la date (« le plus
rapidement possible / d'ici 2 semaines / 30 jours ») pour qualifier la piste.
Personne ne publie une *courbe* ; tout le monde a un *supplément*.

La phrase juste n'est donc plus « aucun concurrent ne prix l'urgence », mais :
**aucun concurrent n'affiche le prix de la date avant l'engagement.** C'est
elle qu'il faut tenir, parce qu'elle reste vraie après vérification —
[relevé C, conclusion 2](veille-2026-09-03/c-decouverte-et-marges.md).

**Conséquence de positionnement :** ne jamais présenter Nota comme « moins
cher ». La phrase est « le seul endroit où une date rapprochée a un prix ».

### 3. Le corridor du prêt hypothécaire est déjà occupé

**Lender Lawyer Connect de FCT** figure sur la liste des fournisseurs
technologiques de la Chambre pour le « traitement de prêts hypothécaires et de
radiations ». C'est le tuyau par lequel les prêteurs institutionnels envoient
déjà leurs instructions aux notaires. Nota entre par le client ; LLC entre par
le prêteur. Un notaire qui fait du refinancement connaît LLC — l'ignorer en
entrevue coûte la crédibilité.

---

## Relevé du 3 septembre 2026

Quatre crawls directs (`curl`, sitemaps, `products.json`, formulaires ouverts
dans le navigateur sans rien soumettre), chaque fait portant son URL. Ce sont
les pièces ; ce document en est la synthèse.

| Fichier | Ce qu'il couvre | Ce qu'il a corrigé ici |
| --- | --- | --- |
| [`a-notairo-deeded-ownright.md`](veille-2026-09-03/a-notairo-deeded-ownright.md) | Les trois concurrents financés, ligne par ligne : identité, prix réels, entonnoir compté, rémunération du professionnel, confiance, SEO | Notairo est une boutique Shopify ; le refinancement s'y vend 1 795–2 225 $ TTC, pas 949 $ ; le produit « prise en charge 295 $ » est l'ADR 0031 en vente ; Deeded est un cabinet en Alberta ; Ownright a levé 6,5 M$ |
| [`b-generation-de-demandes-quebec.md`](veille-2026-09-03/b-generation-de-demandes-quebec.md) | Les quatre apparieurs québécois (Soumissions Québec, Maison, Notaire.Solutions, NotaireLocal) + Neolegal : volumes, entonnoirs, trafic Similarweb, avis | Le « 10 000 demandes notariales » est un chiffre tous secteurs ; l'écart de prix sous 14 jours est de ×3 à ×5, pas de 40–60 % ; deux acteurs visent déjà le refinancement à Québec |
| [`c-decouverte-et-marges.md`](veille-2026-09-03/c-decouverte-et-marges.md) | Les acteurs absents du premier relevé (Leya, prix.expert, Droit Légal, Habitam, JuriGo…) et un banc d'essai des marges de 30 plateformes | Leya et Notairo partagent leur fondateur ; l'urgence est tarifée partout en petits caractères ; le prix par piste est publié à 25–50 $ ; le 400 $ pèse 16,7–18,2 % du total client |
| [`d-benchmark-produit.md`](veille-2026-09-03/d-benchmark-produit.md) | 29 capacités produit × 11 références (4 concurrents, 6 étalons internationaux du « réserver un professionnel réglementé »), scorées ; carnet de rattrapage | Donne le tableau ci-dessous, et le carnet [`carnet-pour-etre-numero-1.md`](carnet-pour-etre-numero-1.md) |

### Où Nota est devant, où Nota est derrière

Score du relevé D : **Nota 36 sur 58**, cinquième de onze **à égalité avec
LegalZoom (36)**, derrière Maple (44), Rocket Lawyer (38), Ownright et Proof
(37). **Dans sa catégorie — accès en ligne
à un notaire du Québec pour un acte de financement — Nota est premier : 36
contre 26 pour Notairo et pour Leya.** Le tableau dit pourquoi, et ce que ça
coûte.

| | Capacité | Nota | Le meilleur du lot | Écart |
| --- | --- | --- | --- | --- |
| **Devant** | Prix de la date avant tout engagement | 5 paliers chiffrés, ×1 → ×4, calculés à l'écran | Notairo : « frais additionnels (urgence) », sans montant | Personne n'affiche le prix de la date |
| | Devis décomposé avant l'identité | 3 lignes (honoraires · service Nota · autorisé) | Notairo : 9 pages puis une soumission humaine | ≈ 12 écrans d'avance |
| | Date de signature choisie au départ | Le calendrier *est* le produit | Deeded : signature 2–3 j avant la clôture | Seul à la vendre |
| | Barème d'annulation des deux côtés | 3 paliers, avant confirmation, **versés au notaire** | Aucun des dix autres ne le publie | Seul |
| | Messagerie par acte + dépôt de documents | Fil par acte, S3 pré-signé (ADR 0032) | Ownright : clavardage/visio | À égalité, sans le cabinet |
| | Checklist de documents guidée | Aide, progression, « Réutiliser », fichiers qui **ne quittent pas l'appareil** | Ownright : liste de tâches | Devant |
| | Agenda synchronisé (ICS / webcal) | Client **et** notaire, bilingue, hydraté | Aucun des dix | Seul |
| | Entrée sans compte ni mot de passe | Publier sans compte | Soumissions Québec (mais sans prix) | Deeded et Ownright exigent un compte |
| | Bilingue FR/EN natif | Source française, i18n, courriels et flux | Deeded : Weglot (machine) ; Ownright : anglais seul | Devant au Québec |
| **Derrière** | Disponibilité réelle des notaires | **Aucune** — implicite, chaque date est offerte | Zocdoc : agenda synchronisé deux sens ; Leya : temps réel ; Proof : < 1 s | La ligne la plus lourde en conversion |
| | Confirmation immédiate | Le client publie, puis **attend** qu'un notaire retienne | Deeded, Ownright, Maple, Zocdoc confirment en secondes ou minutes | Une attente sans promesse |
| | Jalons après la rétention | Statuts d'offre, pas de jalons | Deeded « pizza tracker » ; Ownright « by the hour » | Absent |
| | Rappels sur l'acte **retenu** | `dueReminders` sort vide dès qu'une offre est retenue | Deeded, Ownright, Zocdoc rappellent jusqu'à la signature | Le client qui a un notaire n'entend plus rien |
| | Preuve sociale | 0 avis, 0 acte, 0 compteur | Ownright 1 768 avis à 5,0 ; Deeded 695 à 4,9 | Le déficit de confiance, chiffré |
| | **Montant** des débours | Mention « en sus » servie par `deboursInclus: false` (art. 71 3°), **aucun montant** | Ownright : débours = frais de tiers seulement, aucun frais d'administration | À égalité : personne ne chiffre — la seule ligne « derrière » où tout le lot l'est aussi |
| | Vérification d'identité en ligne | Collectée, jamais vérifiée | Deeded et Ownright à l'intégration ; Proof (doc + KBA + biométrie) | Absent |
| | Signature à distance guidée | Hors Nota (outils CNQ du notaire) | Deeded : visio ; Ownright : à distance par défaut | Vendu (« urgence en ligne +400 $ »), pas outillé |
| | Notifications multicanal | Courriel seul | Zocdoc, Maple : SMS + push ; Deeded : texto | PWA installée, aucun push |
| | Support : canaux et heures | Clavardage et courriel, **ni téléphone ni heures** | Ownright « après les heures » ; Rocket « 6 h–18 h PT » | Rien d'affiché |
| | Contenu indexé | **1 URL, 0 article**, sur une URL CloudFront | Soumissions Maison 524 billets ; Deeded 285 ; Ownright ~150 ; Notairo 18 + 19 pages ville | Le trou le plus large |
| | Catalogue | Financement et refinancement seulement | Tous vendent l'achat et la vente — le gros du volume | Segment volontairement étroit |
| | Prix | 2 400 $ au standard ; 6 400 $ dans la semaine | Ownright 1 179 $ + débours ; Notairo ~1 800–2 200 $ TTC | Assumé — c'est la thèse, elle n'a **aucune transaction** derrière elle |

Le carnet de rattrapage, avec les tailles et l'ordre, est dans
[`carnet-pour-etre-numero-1.md`](carnet-pour-etre-numero-1.md).

---

## Québec — concurrents directs

### Notairo — le plus proche

Plateforme québécoise de transaction immobilière « 100 % en ligne », signature
en personne. **Le client paie Notairo**, prix fixe affiché : vente résidentielle
à partir de 1 099 $ + débours, **refinancement / transfert hypothécaire à partir
de 949 $ + débours**, conseil juridique à partir de 299 $. Notairo apparie le
client avec un notaire accrédité près de chez lui et opère le processus
numérique ; le notaire fait l'acte.

**Corrigé le 3 septembre.** Le crawl a établi cinq choses que la vitrine ne dit
pas ([relevé A §1](veille-2026-09-03/a-notairo-deeded-ownright.md)) :

- **C'est une boutique Shopify**, lancée le **9 octobre 2025**, fondée et
  dirigée par **Ryan Hillier**. Le `products.json` est ouvert : 19 produits.
- Le prix réel d'un refinancement n'est pas 949 $ mais **1 795 / 1 995 /
  2 225 $ taxes incluses** (« avance d'honoraires et de débours » ; variante
  « virtuel » 2 225 $, « en personne » 1 995 $).
- Le produit « **Frais de prise en charge de dossier — 295 $** » sépare
  explicitement le service de la plateforme des honoraires du notaire : c'est
  l'ADR 0031 en vente, et le comparable direct du prix fixe de Nota.
- La « soumission gratuite et instantanée » est un formulaire de **9 pages**
  suivi d'une soumission envoyée par l'équipe : ≈ 12 écrans et une attente
  avant un prix ferme. Le paiement se fait par Shopify Checkout, **d'avance**,
  et la page « Politique de remboursement » répond **404**.
- Aucun avis tiers (ni Google, ni Trustpilot) en 11 mois ; 3 témoignages maison.
  Une **facture client de 12 149,75 $** avec adresse civique est publiée comme
  produit et indexée au sitemap.

*Ce que ça nous dit :* la structure de l'ADR 0031 existe déjà au Québec et se
vend. Et le prix plancher du marché en ligne est connu.

*Ce qu'on ne sait pas :* le partage Notairo/notaire. À demander en entrevue —
un notaire du réseau Notairo est l'interlocuteur le plus précieux de tout le
programme de validation. Il y a maintenant deux vitrines pour le trouver
(ci-dessous).

### Leya — la seconde vitrine du même opérateur

**Ryan Hillier est fondateur-PDG de Leya Technologies (Montréal, 2023) *et* de
Notairo.** Leya (`leya.ca`) n'est pas un cabinet (« *Leya is not a law firm* »)
et vend un acte de vente ou un refinancement **1 725 $ +**, des consultations
de 25 à 60 minutes à 85–250 $, un testament notarié à 399 $ — le tout avec la
promesse « ***instantly book a notary online*** », sur la **disponibilité en
temps réel** des fournisseurs de son réseau, en libre-service.

*Ce que ça nous dit :* le concurrent le plus proche n'est pas une vitrine mais
deux, avec une équipe, un investisseur (Telegraph Hill Capital) et un fondateur
qui a déjà bâti et vendu une legaltech (Novalex → Delegatus, janvier 2024). Et
il vend la **réservation instantanée**, c'est-à-dire la promesse la plus proche
de « la date » de Nota — sans en afficher le prix pour le refinancement, qui
reste « sur devis ». [Relevé C §1.1](veille-2026-09-03/c-decouverte-et-marges.md).

### Soumissions Québec · Soumissions Maison · Notaire.Solutions · NotaireLocal

Génération de demandes. Le client remplit un formulaire, reçoit 3 à 5
soumissions de notaires partenaires en 24–48 h.

**Corrigé le 3 septembre — le volume et le prix par piste**
([relevé B](veille-2026-09-03/b-generation-de-demandes-quebec.md),
[relevé C §1.1](veille-2026-09-03/c-decouverte-et-marges.md)) :

- Le « 10 000 demandes notariales par année » ne tient pas : le bandeau du site
  annonce « 15 000+ demandes pour des notaires dans la dernière année » *et*
  « plus de 10 000 demandes de soumissions en ligne en 2024 », tous secteurs
  confondus. Il faut lire **≈ 10 000 demandes tous secteurs sur ce seul site**,
  et le réseau (Maison, Testament, Montréal…) pour le reste. **L'inférence
  « 3 % du marché adressable » tombe avec le chiffre.**
- Similarweb donne ≈ **4,5 K visites sur 3 mois, −44 %** d'un mois à l'autre —
  un ordre de grandeur sous les « 300 000 visiteurs en 2024 » revendiqués.
- **Le prix par piste n'est plus introuvable.** Soumissions Entreprises, du même
  réseau, le publie : **25 à 50 $ la demande**, par lots de 50/100/500. À un
  gagnant sur trois, cela fait ≈ 75–150 $ par acte gagné, soit **4–8 %** d'un
  acte de 2 000 $ — exactement la zone que l'ADR 0028 visait, et **moins** que
  les 400 $ de Nota. Ce qui distingue Nota n'est donc pas le montant : c'est
  que le coût est **contingent** (0 $ tant qu'aucun acte n'est retenu) et
  **connu d'avance**.
- Deux acteurs visent déjà exactement le segment de Nota : Soumissions Maison a
  une page « refinancer une hypothèque » ; **Notaire.Solutions** est un clone
  léger (React/Lovable + Supabase, exploitant non nommé) dont la liste de villes
  est faite des quartiers de Québec, et dont le formulaire tient en **5 champs**.

*Ce que ça nous dit :* la désintermédiation du choix du notaire est déjà
acceptée par le public québécois. Le marché n'a pas à être créé. Et le notaire
paie **par piste**, convertie ou non — l'argument de vente de Nota n'est pas
« moins cher », c'est *zéro dollar tant qu'aucun acte ne se conclut*.

### Neolegal

Services juridiques en ligne à prix fixe, sans taux horaire, par des avocats du
Barreau. Montréal. Adjacent, pas concurrent : couvre le juridique général, pas
l'acte notarié.

*Ajouté le 3 septembre :* c'est le **seul acteur québécois du lot qui ait des
avis indépendants** — Trustpilot 3,9 sur 342 avis, dont **29 % à une étoile**,
Birdeye 4,2 sur 2 876. Les thèmes récurrents sont « documents jamais livrés » et
« facturation immédiate ». C'est le risque de Nota en une image : une plateforme
juridique qui vend vite et livre lentement récolte un avis sur trois à une
étoile. La messagerie post-rétention est ce qui décide de ce chiffre.

### Notaire+Web · Notaire Direct

Outillage et portail. Ni marché ni appariement.

---

## Canada — les analogues qui ont levé du capital

### Deeded (ON, AB)

Clôture immobilière en ligne, Oakville, fondée en 2020 par Reuven Gorsht,
11–50 employés, amorçage mené par AV8 Ventures (montant non divulgué). Tarif
fixe au client, tableau de bord de suivi, signature en visioconférence.

**Corrigé le 3 septembre — sur les trois points**
([relevé A §2](veille-2026-09-03/a-notairo-deeded-ownright.md)) :

- **« N'est pas un cabinet » n'est vrai qu'en Ontario.** En Alberta, Deeded Inc.
  est **autorisée à exercer comme cabinet** sous l'*Innovation Sandbox* du Law
  Society of Alberta, avec des avocats **salariés**. Deux ordres canadiens ont
  donc chacun admis une plateforme de clôture immobilière, et l'un l'a
  autorisée comme cabinet.
- **Les prix ont bougé et ne sont pas « tout inclus »** : Ontario achat
  1 199 $, vente 1 099 $, **refinancement ou transfert 999 $** ; Alberta 999 /
  899 / 999 $ ; conseil indépendant 599 $. Partout « **+ disbursements** », et
  « exclude applicable taxes and disbursements ».
- **Le sens du flux d'argent est écrit dans les conditions** : Deeded fournit
  du soutien administratif, technique, d'horaire et de marketing « *in exchange
  for service fees from the Legal Service Provider* » — **l'avocat paie la
  plateforme**. Barème non publié.

*Ce n'est donc pas le modèle de l'ADR 0031, c'en est l'inverse* : au Québec,
faire payer le notaire pour l'accès au client est précisément ce que
l'art. 32.1 de la *Loi sur le notariat* rend risqué. Reste : SOC 2 Type 2,
**Google 4,9 sur 695 avis**, clôture annoncée en 5–7 jours, tableau de bord de
jalons et portail courtier (« Deeded Pro »).

### Ownright, ex-Doormat (ON)

Avocat immobilier en ligne, ~25 % sous la moyenne du marché, entièrement à
distance. 1,25 M$ (juin 2023) puis **4,5 M$ en amorçage** (décembre 2024) —
**6,5 M$ au total** ; rebaptisée le 18 mars 2025.

**Corrigé le 3 septembre** ([relevé A §3](veille-2026-09-03/a-notairo-deeded-ownright.md)) :
prix fixes **1 179 $ achat, 1 079 $ vente, 1 179 $ refinancement**, « subject to
HST and disbursements », les débours étant **des frais de tiers seulement**
(« we don't charge Administration Fees ») — c'est le seul du lot qui explicite
ce qu'il n'ajoute pas. **Google 5,0 sur 1 768 avis**, BBB A+, ~25 employés,
plus de 1 000 transactions et plus de 750 M$ (mars 2025), 41 partenaires
nommés, ~150 billets de blogue. Anglais seulement. Et sa FAQ conseille
d'engager l'avocat
**au moins 30 jours d'avance** : le délai court n'est pas un produit chez eux.

**Le fait le plus important de tout ce document :** Doormat a été **admise au
programme d'innovation du régulateur ontarien** (A2I, deuxième participant,
juin 2023). Un cadre réglementaire d'expérimentation existe pour la legaltech
en Ontario, et une plateforme y est passée.

*Action :* demander à la Chambre s'il existe — ou peut exister — un équivalent
québécois. C'est une question de posture bien plus intelligente que « est-ce
que notre modèle est permis ? », et elle place Nota du côté de l'innovation
encadrée plutôt que du côté du contournement.

---

## L'écosystème installé (à connaître avant toute rencontre)

Fournisseurs listés par la Chambre. Les trois premiers sont **obligatoires** :
un notaire les utilise tous les jours.

| Catégorie | Fournisseur |
| --- | --- |
| Clôture et conservation de l'acte technologique | **ConsignO Cloud-CNQ** (Notarius), Greffe central numérique |
| Signature officielle numérique | **CertifO** (Notarius) |
| Gestion d'étude | Para-Maître (Avancie) · ProNotaire, ProCardex (Acceo, opérés par Juris Concept) · JurisÉvolution, JurisPRO |
| Transfert sécurisé | Docurium, Todoc, Votre transfert, Votre courriel (Avancie) · Convoflo · JurisZone · Secure Exchanges |
| Transaction immobilière | **Blocknote** |
| Prêts hypothécaires et radiations | **Lender Lawyer Connect** (FCT) |
| Testaments, mandats, procurations | Clause Testament (Thomson Reuters / Yvon Blais) |

Deux implications pour le produit :

1. **H5 du programme de validation** (la double saisie) se joue contre
   Para-Maître, ProNotaire et JurisÉvolution. Si la ressaisie est
   rédhibitoire, l'intégration passe avant le reste du carnet.
2. **L'homologation est une porte réelle, mais elle est fermée en ce moment.**
   La Chambre publie sa procédure — vérification de conformité **aux frais du
   fournisseur**, certification ISO/IEC 27001 ou SOC 2 Type II « en atout »,
   présentation de la solution, entente signée — et précise que la soumission
   d'une demande est **momentanément suspendue**. Deux implications : le coût
   de la vérification n'est budgété nulle part, et une certification de ce
   calibre est un chantier de plusieurs mois qui devrait commencer avant la
   réouverture, pas après. Porte d'entrée : `techno@cnq.org`.

---

## Ce qu'il reste à établir

*Mis à jour le 3 septembre : deux lignes de cette liste ont trouvé leur réponse.*

- ~~Le prix par piste de Soumissions Québec~~ — **répondu** : le même réseau le
  publie chez Soumissions Entreprises, **25 à 50 $ la demande**, par lots.
- ~~L'existence d'un bac à sable réglementaire~~ — **répondu pour le Canada** :
  deux ordres (Ontario A2I, Alberta Innovation Sandbox) ont chacun admis une
  plateforme de clôture immobilière, et l'Alberta a autorisé Deeded comme
  cabinet. Reste à établir s'il existe un équivalent **québécois** ; c'est la
  posture du projet pilote (`docs/legal/projet-pilote-198-1.md`).
- Le partage **Notairo / Leya ↔ notaire** et la structure juridique du réseau
  (indépendants ? salariés ? une étude affiliée à la façon d'Ownright Law ?).
  **Ce nombre se demande en entrevue**, pas sur le web — et il y a maintenant
  deux vitrines pour trouver un notaire du réseau.
- Le montant des **frais de service Deeded** facturés à l'avocat (par dossier ?
  mensuels ?).
- Le **taux de conversion piste → acte** qu'un notaire acheteur observe chez
  Soumissions ou Habitam : sans lui, les 25–50 $ la piste ne se comparent pas
  aux 400 $ de Nota.
- L'issue du **litige FCT/FNF ↔ Chambre** sur la préparation des transferts
  hypothécaires. Avant la réforme, les centres de traitement préparaient les
  documents et le notaire vérifiait pour ≈ **850 $** ; la Chambre lit désormais
  la loi comme un monopole du notaire, et le coût attendu passe à ≈ **1 500 $**.
  C'est le plancher de marché du refinancement pour les trois prochaines années,
  dans le segment exact où Nota entre.

---

**Relevés du 3 septembre 2026 (les pièces, avec leurs URL) :**
[A — Notairo · Deeded · Ownright](veille-2026-09-03/a-notairo-deeded-ownright.md) ·
[B — génération de demandes au Québec](veille-2026-09-03/b-generation-de-demandes-quebec.md) ·
[C — découverte et marges](veille-2026-09-03/c-decouverte-et-marges.md) ·
[D — benchmark produit](veille-2026-09-03/d-benchmark-produit.md)

**Sources :** [Notairo](https://notairo.com/) ·
[Notairo — catalogue Shopify](https://notairo.com/products.json) ·
[Leya — immobilier](https://leya.ca/real-estate) ·
[Soumissions Québec](https://soumissionsquebec.ca/notaires/) ·
[Soumissions Entreprises — prix par piste](https://soumissionsentreprises.ca/devenir-partenaire/) ·
[Notaire.Solutions](https://notairesolutions.ca/) ·
[NotaireLocal](https://www.notairelocal.com/) ·
[Neolegal](https://www.neolegal.ca/) ·
[Deeded](https://www.deeded.ca/) ·
[Deeded — conditions (frais de service ; bac à sable albertain)](https://www.deeded.ca/terms) ·
[Ownright — prix](https://ownright.com/pricing) ·
[Ownright — Law Times sur l'admission au programme d'innovation](https://www.lawtimesnews.com/practice-areas/real-estate/ontario-regulator-approves-real-estate-legal-tech-firm-doormat-as-part-of-innovation-program/377793) ·
[Ownright — levée de 4,5 M$](https://www.fintech.ca/2025/03/18/ownright-digital-real-estate-law-services/) ·
[Fournisseurs technologiques CNQ](https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/)

---

## Les comparables hors notariat — enquête du 1<sup>er</sup> septembre

Le bon angle n'est pas « qui fait la même chose » mais **comment une plateforme
est payée quand elle donne accès à une profession réglementée**. Élargi aux
autres professions, le paysage devient beaucoup plus net.

### L'interdiction n'est pas une particularité notariale

**Code de déontologie des avocats, art. 107** — l'avocat ne peut partager ses
honoraires qu'avec un membre du Barreau, un barreau hors Québec, le cabinet où
il exerce, ou une personne avec qui il est autorisé à exercer. **Art. 106** — il
ne peut verser à un non-avocat « une ristourne, une commission ou un autre
avantage » lié au mandat d'un client.

C'est mot pour mot la même architecture que les art. 32 et 33 du Code des
notaires. **Aucune plateforme québécoise ne peut prélever un pourcentage des
honoraires d'un professionnel réglementé, quelle que soit la profession.** Ce
n'est donc pas un obstacle à contourner par une meilleure rédaction : c'est le
socle du système professionnel québécois.

D'où le constat qui traverse tous les comparables : **chaque survivant fait
l'une de deux choses** — il facture le client pour son propre service, ou il
*est* l'entité professionnelle. Il n'existe pas de troisième voie.

### Bonjour-santé — le comparable le plus proche, et le plus instructif

PME de Boucherville. Le patient cherche gratuitement un rendez-vous médical ;
si aucun n'est disponible dans sa clinique habituelle, Bonjour-santé facture
**17,25 $ au patient**. Le médecin, lui, est payé par la RAMQ — sa rémunération
n'est jamais touchée.

C'est exactement la structure de l'ADR 0031 : le professionnel encaisse
intégralement, la plateforme vend son propre service au client. Et ça opère au
Québec depuis des années, contre une profession réglementée.

**Mais** — et c'est la trouvaille qui compte — Bonjour-santé fait l'objet d'une
**action collective** visant à faire cesser la pratique et à récupérer les frais
« perçus illégalement ». Le reproche n'est pas déontologique : c'est que les
cliniques sont déjà rémunérées par l'État, donc facturer le patient pour l'accès
serait indu.

**Deux leçons pour Nota :**

1. **Le risque ne disparaît pas avec la restructuration — il se déplace.** Il
   quitte le terrain disciplinaire pour celui du droit de la consommation.
   Nota est mieux placé sur cet axe précis : les honoraires notariaux ne sont
   pas publics, il n'y a pas de RAMQ, et le client n'a droit à aucune date en
   particulier. Mais la question « que vend exactement la plateforme ? » doit
   pouvoir se répondre en une phrase vérifiable.
2. **La critique du « système à deux vitesses » vise Nota directement.** On
   reproche à Bonjour-santé que ses abonnés voient plus de disponibilités que
   les autres. C'est exactement ce qu'un classement piloté par la cote
   produirait s'il devenait visible du client. L'ADR 0030 a déjà fermé
   l'affichage ; le classement, lui, reste à examiner sous cet angle.

### Ownright — le cabinet lui-même (confirmé le 3 septembre)

« All transactions are handled by lawyers, and correspondences come directly
from members of their legal team. » Ce n'est pas le langage d'une place de
marché : c'est celui d'un cabinet. **Le crawl du 3 septembre le confirme** : les
avocats exercent sous le cabinet partenaire « **Ownright Law** », et la page
équipe écrit de chacun qu'il est « *a LSO licensee and is engaged by Ownright
to provide legal services* ». Aucun partage n'a à être justifié quand il n'y a
pas deux parties.

La structure de rémunération de **Deeded** est désormais établie, et elle est
l'inverse : ses conditions publiques disent que l'avocat lui verse des
« *service fees* » pour du soutien administratif, technique, d'horaire et de
marketing. C'est la troisième voie apparente — et au Québec, c'est exactement
celle que l'art. 32.1 3° de la *Loi sur le notariat* vise.

### Ce que ça confirme pour l'ADR 0031

Le virage était le bon, et il est le seul disponible : **facturer le client pour
le service de Nota**. Reste à rendre ce service décrit, distinct et démontrable
— parce que c'est là, et non plus sur le partage d'honoraires, que la prochaine
contestation viendra.
