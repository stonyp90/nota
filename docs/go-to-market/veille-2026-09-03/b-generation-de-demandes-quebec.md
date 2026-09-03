# Concurrence B — plateformes québécoises de génération de demandes notariales

Relevé du 3 septembre 2026, par crawl direct (`curl`) des sites, de leurs
sitemaps, de leurs pages « devenir partenaire », conditions et guides de prix,
plus Similarweb, Trustpilot et Birdeye pour les avis et le trafic. Complète
`docs/go-to-market/concurrence.md` (relevé du 1er septembre), qui n'avait
qu'un paragraphe par acteur.

**Limites de la méthode.** Trustpilot et Reddit refusent le crawler (403) ;
seuls Neolegal (Trustpilot, Birdeye) et Soumissions Maison (témoignages
auto‑publiés) ont des avis lisibles. Similarweb sous‑estime les petits sites ;
ses chiffres servent à comparer les acteurs entre eux, pas à établir un volume.
Aucun prix « par piste » payé par le notaire n'est publié nulle part — ce
nombre reste à obtenir en entrevue.

---

## 0. Le point de référence : ce que Nota fait réellement aujourd'hui

Lu dans `apps/web/public/index.html`, `apps/web/public/app.js`,
`packages/domain/index.js`, `apps/api/src/billing.js`,
`apps/api/src/prix-nota-config.js`.

| Rubrique | Nota (code du 3 sept. 2026) |
| --- | --- |
| Offre au client | Publier est gratuit. Le client **fixe la date et le montant** ; le notaire accepte, contre‑propose ou passe. Le montant offert va au notaire **en entier** ; Nota facture séparément un **prix fixe de 400 $** (`DEFAULT_PRIX_CENTS = 40000`, modifiable par l'admin ou `NOTA_PRIX_CENTS`). Les deux lignes sont affichées avant paiement (« Honoraires du notaire » / « Service Nota » / « Autorisé sur votre carte »). |
| Ce que paie le notaire | **0 $.** Aucun abonnement, aucune piste, aucun pourcentage. |
| Prix de départ | Refinancement **2 000 $**, financement **1 800 $** (Ville de Québec). Critères qui montent le plancher : montant du prêt (+0/150/350/600), approbation bancaire (+0/100/200), succession (+400), déplacement (+0 à +400, « urgence 100 % en ligne » = +400), co‑emprunteur (+150), certificat périmé (+100). |
| Prime d'urgence | Multiplicateur par palier, **pré‑rempli** dans le curseur : standard ≥ 15 j ×1,0 · rapide 8–14 j ×1,8–2,2 · prioritaire 2–7 j ×2,7–3,3 · urgence la veille ×3,3–3,7 · extrême le jour même ×3,7–4,3 (plafond ×5). Concrètement, un refinancement à 10 jours est pré‑rempli à **≈ 4 000 $ + 400 $** ; à 5 jours ≈ 6 000 $ + 400 $. |
| Délai promis | Aucun. FAQ : « Nota ne garantit aucun délai. » |
| Entonnoir | Porte d'intro (1 clic : « Entrer sur le site » ou une porte) → calendrier → clic sur une date (1) → dialogue : acte (1) → 3 questions obligatoires (montant, approbation, prêteur ; succession et déplacement pré‑répondus) → curseur pré‑rempli → secteur postal (3 caractères), nom, courriel, téléphone (recommandé) → « Publier mon offre » (1) → **page Stripe hébergée pour autoriser la carte** (quand l'API renvoie un `checkoutUrl` ; l'offre n'atteint le carnet qu'après le webhook). ≈ 5–7 clics + 4 champs + carte. **Aucun compte requis** (option sans mot de passe). |
| Confiance | Tuiles de conformité (art. 32.1 Loi ; art. 32, 29.1, 49 C. déont.) ; « Nota n'est pas un notaire » ; profil notaire = lien CNQ + nom/tél/adresse obligatoires (ADR 0033) ; anonymat par défaut (« Client · secteur postal ») ; phrase Loi 25. **Aucun avis, aucun compteur, aucun nombre d'actes** — il n'y a encore aucun acte conclu. |
| Langues / mobile / SEO | FR‑CA + EN (`hreflang`, 1 652 chaînes i18n) ; PWA (manifest, `sw.js`) ; JSON‑LD Organization + ProfessionalService + FAQPage + 2 Service (le seul du lot avec des données structurées de service) ; `llms.txt` ; robots ouvert aux crawlers IA. **Sitemap = 1 URL, 0 article**, hébergé sur une URL CloudFront (`d1s1h4894dau0c.cloudfront.net`) — le domaine `nota.quebec` cité dans le film n'est pas en service. |
| Incohérence interne | Le film d'intro montre une « enchère » de 1 800 $ → 2 200 $ pour une signature le 12 sept. (9 jours), alors que le domaine pré‑remplit ce même cas au palier prioritaire, soit ≈ 6 000 $. Le film vend une échelle que le curseur ne propose pas. |

---

## 1. Soumissions Québec — soumissionsquebec.ca/notaires/

**Nature.** Générateur de pistes multi‑secteurs (+50 secteurs : assurances,
rénovation, déménagement, courtiers…), WordPress/Elementor/Gravity Forms.
Cofondateurs Jimmy Lecours et Julian G. Jimenez ; contenu rédigé par deux
« gestionnaires de contenu » (5 000–6 000 articles chacun, toutes plateformes).
Téléphone 1 (581) 701‑7611. Même réseau que Soumissions Maison, Soumissions
Testament, Soumissions Montréal (« Nous gérons des centaines de sites web »).
Sources : [qui‑est](https://soumissionsquebec.ca/qui-est-soumissions-quebec/),
[annoncez](https://soumissionsquebec.ca/annoncez-avec-nous/).

### Offre et prix
- **Client : gratuit, sans engagement.** « Comparez 3 soumissions de notaires au Québec ». Aucun prix affiché ; un guide de prix indicatifs sur la page (testament dès 350 $, transaction immobilière 1 300–1 600 $, quittance et mainlevée ≈ 750 $, acte de vente 1 200–1 600 $). Source : [/notaires/](https://soumissionsquebec.ca/notaires/).
- **Notaire : achète des pistes.** La page annonceurs le dit sans détour : « vente de leads qualifiés à nos partenaires », « Vous souhaitez acheter des demandes de soumissions provenant de prospects qualifiés ? ». Vend aussi des articles promotionnels et des bannières. **Prix par piste non publié** ; le formulaire partenaire promet qu'« Quelqu'un prendra rapidement contact avec vous pour vous expliquer le fonctionnement ». Sources : [annoncez](https://soumissionsquebec.ca/annoncez-avec-nous/), [devenir‑partenaire](https://soumissionsquebec.ca/devenir-partenaire/).
- **Volumes revendiqués** (bandeau de toutes les pages) : « 15 000+ demandes pour des notaires dans la dernière année. À votre service depuis 2015 ». Page annonceurs : « 300 000+ visiteurs en 2024 », « Plus de 10 000 demandes de soumissions en ligne en 2024 », « plus de 120 000 leads » depuis 2015. **Contradiction** : 15 000 demandes notariales par an ne tiennent pas dans 10 000 demandes totales en 2024 — le 15 000 agrège vraisemblablement tout le réseau (Maison, Testament, Montréal…). Le brief du 1er septembre a repris le « 10 000 demandes notariales » ; il faut le lire comme « ≈ 10 000 demandes tous secteurs sur ce seul site ».

### Délai et urgence
- « Remplissez le formulaire pour recevoir vos soumissions par téléphone ou e‑mail dans les 24 à 48h. » « Moins de 2 minutes à remplir. » Source : [/notaires/](https://soumissionsquebec.ca/notaires/).
- **L'urgence est captée mais pas vendue** : champ « Date prévue » à cinq cases — *le plus rapidement possible · d'ici 2 semaines · d'ici 30 jours · d'ici 2 mois · plus tard*. Elle qualifie la piste pour le notaire acheteur ; elle n'a aucun effet sur le prix ni sur une quelconque garantie.

### Entonnoir
- **0 clic de navigation** : la page d'atterrissage *est* le formulaire (une page, Gravity Forms), 1 clic de soumission.
- **≈ 13–15 champs** pour un financement : Nom, Prénom, Email, Téléphone, Code postal, Ville (12 régions), Date prévue, catégorie (Personnel / Affaires / Immobilier / Avocat litige successoral / Autres), sous‑service immobilier (*Consultation avant achat · Achat ou vente · Examen des titres · Financement hypothécaire · Déclaration de copropriété*), « Avez‑vous déjà un prêteur hypothécaire », **« Aimeriez‑vous qu'un courtier hypothécaire vous contacte ? »** (vente croisée), Nom du prêteur, Type de propriété, Date de prise de possession, distance acceptée (5 à 50 km), **« Vous en êtes où ? »** (prêt à engager / bientôt / juste les tarifs), autres soumissions (courtiers, déménageurs, alarmes, inspecteurs, entrepreneurs), Description, « J'accepte d'être servi à distance ». Champs cachés de tracking LinkedIn/Facebook.
- Aucun compte. Aucune confirmation de prix. Le client attend l'appel.

### Signaux de confiance
- **Aucun avis** sur le site, aucun widget Google, page Trustpilot inexistante (404). Les conditions désengagent tout : « ne peut garantir leur qualification, les prix proposés, la qualité des services ou les résultats obtenus » ; « n'offre aucun service de recommandation » ; « ne procède à aucune vérification systématique des données ». Source : [termes](https://soumissionsquebec.ca/termes-et-conditions/) (mise à jour 6 avril 2026).
- La Chambre des notaires est citée dans les articles comme référence, jamais comme partenaire.

### Langues, mobile, SEO, trafic
- FR seulement ; `<html lang="en">` sur un site français (erreur d'attribut de langue). Viewport OK ; page de 365 Ko.
- JSON‑LD Yoast (WebPage, Organization, BreadcrumbList) — pas de FAQ, Service ni AggregateRating. **157 billets** dans `post-sitemap.xml`, blogue « Page 6 of 38 » ; page notaires publiée 2017, modifiée 2026‑06‑04. Source : [page‑sitemap](https://soumissionsquebec.ca/page-sitemap.xml).
- Similarweb (WebFetch, juillet 2026) : ≈ 4,5 K visites sur 3 mois, **−44 % d'un mois à l'autre**, rebond 53,8 %, 1,54 page, 18 s, 80 % organique, rang Canada #235 316, catégorie « Home and Garden ». À rapprocher des « 300 000 visiteurs en 2024 » revendiqués (≈ 25 K/mois) : un écart de 10×, même en tenant compte de la sous‑estimation de Similarweb.

### Faiblesses ressenties par l'utilisateur
Aucun avis indépendant trouvé (Trustpilot 404 ; Reddit inaccessible au crawler). Ce qui se ressent à la lecture : long formulaire, aucun prix avant contact, 24–48 h d'attente, réponse par téléphone, vente croisée vers un courtier hypothécaire et cinq autres métiers, et des conditions qui refusent toute responsabilité sur la qualification des notaires.

### Nota face à Soumissions Québec
- **Mieux** : prix connu avant tout contact ; le client décide, personne ne l'appelle ; 0 $ pour le notaire tant que rien ne se signe ; anonymat + Loi 25 (SQ revend la piste à plusieurs acheteurs et cross‑sell) ; date ferme au lieu d'une case « le plus rapidement possible » ; données structurées Service/FAQ.
- **Pire** : SQ a 11 ans, un réseau, 157 articles et un trafic organique réel ; Nota a 1 URL, 0 article, pas de domaine, 0 acte conclu, 1 notaire en `@nota.ca`. SQ couvre 17 régions ; Nota, la Ville de Québec. Le total client de Nota (offre + 400 $, ×2 à ×4 sous 14 jours) est loin au‑dessus des repères que SQ publie (750 $ quittance, 1 300–1 600 $ transaction).
- **À emprunter** : le qualificatif « Vous en êtes où ? » (intention) ; la case « Date prévue » comme chemin doux vers le calendrier ; la promesse « Moins de 2 minutes ».

---

## 2. Soumissions Maison — soumissionsmaison.com/notaires/

**Nature.** Même réseau que SQ (mêmes champs Gravity `gpuid_existing_value`,
même arborescence de services, indicatif 581) ; positionnement « tous les
professionnels de l'immobilier sous un seul toit ». Téléphones 1 (581) 702‑8828
et 1 (514) 612‑3612. Source : [/notaires/](https://www.soumissionsmaison.com/notaires/).

### Offre et prix
- **Client : gratuit.** « Recevez 3 soumissions gratuites », « Des soumissions de qualité en quelques minutes ». Guide de prix séparé, avec une section « Quel prix pour obtenir une quittance immobilière, une mainlevée ou refinancer une hypothèque ? » — c'est la seule page du lot qui parle explicitement de refinancement au client. Source : [prix‑notaire‑quebec](https://www.soumissionsmaison.com/notaires/prix-notaire-quebec/).
- **Notaire : partenariat payant**, prix non publié ; page d'inscription = simple formulaire (nom, courriel, tél, code postal, profession). Source : [inscription‑partenaire](https://www.soumissionsmaison.com/inscription-comme-partenaire/).
- **Volumes revendiqués** (page comparateur) : « 300+ entreprises partenaires », « 70 000+ soumissions depuis 2015 », « 225 articles », « 65 000 visiteurs par mois » ; page d'accueil : « + de 500 partenaires au Québec ». Source : [comparateur](https://www.soumissionsmaison.com/notaires/comparateur/).

### Délai et urgence
- « Vous recevrez 3 offres de 3 entreprises locales en 24h » ; « 3 professionnels réputés vous contacteront dans les plus brefs délais » ; formulaire « 24h/24, 7j/7 ». Source : [notaires‑pour‑immobilier](https://www.soumissionsmaison.com/notaires-pour-immobilier/).
- Même case « Date prévue » que SQ. Particularité : **le client donne trois plages de rappel** (« Date 1 / Heure 1 », 8:00–16:00, ×3) « pour parler avec un notaire » — le modèle est un appel téléphonique, pas une réservation.

### Entonnoir
- Version longue (`/notaires/`) : ≈ 18 champs (ceux de SQ + 3 dates + 3 heures). Version « 3 petites étapes » (`/notaires/comparateur/`) : service → date/description/distance → région/code postal → coordonnées, avec une question **préarrangements funéraires** (« Oui svp ! / Non, merci ! ») glissée avant les coordonnées.
- Champs cachés Taboola, Outbrain, Facebook, Bing, Adword → acquisition payée, pistes revendues.
- Aucun compte. Page de confirmation dédiée (`/confirmation-notaires/`).

### Signaux de confiance
- Témoignages **auto‑publiés** sur la page comparateur, sans date ni lien : M. Sylvain Bernier — « j'ai reçu la première soumission à 7:40 le lendemain » ; M. JP Lupien — « Très bonne vulgarisation pour me permettre de comprendre mes choix » ; Mme Josée Lépine — « les compagnies référées ont répondu très vite et bien ». Aucun avis indépendant ; Trustpilot 404 ; aucun widget Google.
- « Les partenaires… sont membres de la Chambre des notaires du Québec » (affirmé, non vérifiable).

### Langues, mobile, SEO, trafic
- FR seulement ; `<html lang="en">` là aussi. WordPress + Elementor + WPBakery ; page d'accueil 205 Ko.
- **524 billets** dans `post-sitemap.xml` (dont 6 URL « notaire ») ; page‑sitemap avec `notaires-immobilier`, `sondage-partenaires`, `proposition-de-consommateur`. Source : [sitemap_index](https://www.soumissionsmaison.com/sitemap_index.xml).
- Similarweb : pas de chiffre de visites publié, **−68 % d'un mois à l'autre**, rebond 14,5 %, 1,70 page, 2 min 48 ; canaux Display / Direct / Mail. Le « 65 000 visiteurs par mois » n'est pas corroboré.

### Nota face à Soumissions Maison
- **Mieux** : tout ce qui vaut contre SQ, plus : Nota ne demande ni trois plages de rappel ni un préarrangement funéraire ; le notaire reçoit une demande fermée (date, montant, secteur, prêteur, déplacement) au lieu d'un appel à planifier.
- **Pire** : 524 articles contre 0 ; un réseau de 300–500 partenaires ; une page « refinancement » que le client trouve sur Google. Les trois plages horaires de SM répondent à une vraie question que Nota n'a pas posée : *quand puis‑je vous parler ?* — sur Nota le contact commence après la rétention, par la messagerie.
- **À emprunter** : les « 3 petites étapes » comme cadence ; une page de confirmation qui dit ce qui va se passer.

---

## 3. Notaire.Solutions — notairesolutions.ca

**Nature.** Application React générée avec **Lovable** (image OpenGraph par
défaut `lovable.dev/opengraph-image-p98pqg.png`, `twitter:site @Lovable`),
backend **Supabase** (`ywcwzgzklkkbfghzsbmh.supabase.co`, table `submissions`,
fonction `submit-form`), routes `/`, `/concept`, `/confidentialite`,
`/contact`, `/merci`, **`/login`, `/admin`** — un tableau de bord manuel de
répartition des pistes. Téléphone (877) 376‑8993. Aucun nom d'exploitant
nulle part. Source : [bundle JS](https://notairesolutions.ca/assets/index-qhjDzjx7.js).

### Offre et prix
- **Client : gratuit.** « Comparez 5 propositions de 5 notaires de votre région. Rapide et gratuit. » « Jusqu'à 5 notaires qualifiés de votre région vous contactent avec leurs meilleures offres. » Seule page de prix : testament (« Coût de base pour un couple, avec mandats d'inaptitude (4 documents) : 900$ à 1400$ »).
- **Notaire : rien de publié.** Pas de page partenaire, pas de conditions ; le modèle « jusqu'à 5 notaires vous contactent » est celui de la piste revendue.
- **Trois services seulement** dans le formulaire : *Testament notarié · Achat d'une propriété · Refinancement hypothécaire*. C'est, avec SM, le seul acteur qui nomme le refinancement au client. Villes : quartiers de Québec (Ancienne‑Lorette, Cap‑Rouge, Charlesbourg, Lac‑Beauport, Lebourgneuf, Limoilou, Loretteville, Sillery, St‑Roch, Ste‑Foy, Val‑Bélair, Vanier, Vieux‑Québec), Trois‑Rivières, Saint‑Jérôme, Sainte‑Thérèse — **le seul du lot dont la liste est centrée sur la Ville de Québec, comme Nota.**

### Délai et urgence
- « Remplissez notre formulaire en moins de 2 minutes et recevez jusqu'à 5 propositions gratuitement. » « Recevez plusieurs propositions en quelques heures au lieu de contacter individuellement chaque notaire. » Aucune case de date, aucune urgence.

### Entonnoir
- **1 page, 5 champs** : Service(s) recherché(s) (multi), Votre ville de résidence, Votre nom complet, Votre adresse courriel, Votre numéro de téléphone. Validation « Veuillez sélectionner au moins un service ». Confirmation : « Un courriel de confirmation vous a été envoyé. » puis « Vous recevrez sous peu jusqu'à 5 propositions de notaires de votre région. » Le formulaire le plus court du lot.

### Signaux de confiance
- Étiquettes : « Notaires vérifiés » ; « Tous les notaires de notre réseau sont membres en règle de la Chambre des notaires du Québec » ; « Vos informations personnelles sont protégées et transmises uniquement aux notaires sélectionnés de votre région. » Rien de vérifiable : aucun avis, aucun nom, aucune adresse, aucun compteur.

### Langues, mobile, SEO, trafic
- FR seulement, `<html lang="en">`. Viewport OK. **Pas de sitemap (404), pas de JSON‑LD, pas de blogue, pas de `hreflang`**, image OG d'un autre produit.
- Similarweb : rang mondial #6 297 811, Canada #359 981, **rebond 94 %, 1,25 page, 14 s, −67 % d'un mois à l'autre**, source principale « Display ». Un site qui achète des affichages et ne retient personne.

### Nota face à Notaire.Solutions
- **Mieux** : à peu près tout — identité, conformité, prix, structure, données structurées, bilinguisme. Nota est aussi un site jeune, mais il dit qui il est et ce qu'il fait payer.
- **Pire** : 5 champs contre ≈ 7 clics + 4 champs + carte. Un client qui compare les deux formulaires trouve celui de Nota deux fois plus long, et le seul qui demande une carte.
- **À surveiller** : c'est le concurrent qui vise exactement le même segment (refinancement, quartiers de Québec) avec le même outillage (SPA + Supabase) — vraisemblablement une personne seule. L'identité de l'exploitant vaut un appel au (877) 376‑8993.

---

## 4. NotaireLocal — notairelocal.com

**Nature.** **Annuaire**, pas un générateur de demandes. Propriété d'Adik
Média inc. (« division Regroupement »), 2017–2026, téléphone 1 877 604‑0786 ;
vend aussi des sites web et du référencement aux notaires. Sources :
[à‑propos](https://www.notairelocal.com/a-propos/),
[conception](https://www.notairelocal.com/conception-site-web/).

### Offre et prix
- **Client : gratuit** — « L'utilisation de NotaireLocal.com est entièrement gratuite pour les internautes. » Recherche par code postal → page de ville → fiches avec téléphone, courriel, site.
- **Notaire : frais contractuels** — « Des frais s'appliquent aux partenaires commerciaux selon une entente de service signée avec eux. » Montant non publié ; l'argument est « vous afficher sur cette plateforme afin de récolter de nouveaux clients à tous les mois » plus des « Sites web vitrine ultra‑abordables ». Source : [conditions](https://www.notairelocal.com/conditions-utilisation/).
- **Inventaire réel (comptage des fiches)** : Montréal 8, Laval 4, **Québec 3** (Me Stéphanie Langlois, Notavi Notaires, S&V Notaires), Sherbrooke 2, Lévis 1. 127 URL au sitemap, dont 25 villes et quelques articles (« Comment choisir son notaire », novembre 2019). Source : [sitemap](https://www.notairelocal.com/sitemap.xml), [/quebec/](https://www.notairelocal.com/quebec/).

### Délai, urgence, entonnoir
- Aucun formulaire de demande, aucun prix, aucun délai : le client appelle lui‑même. Entonnoir = code postal (1) → fiche (1) → appel.

### Signaux de confiance
- Contradiction interne : le pied de page dit « NotaireLocal.com n'est pas lié à la Chambre des notaires du Québec ni à aucune association » et « n'est pas responsable de ses partenaires », tandis que la page Québec affirme « Les notaires affichés dans cette page sont tous reconnus par la Chambre des notaires du Québec ». Conditions : « NotaireLocal.com n'intervient JAMAIS dans le cadre d'une transaction ». Aucun avis.

### Langues, mobile, SEO, trafic
- FR seulement (`lang="fr"`, correct). Pas de JSON‑LD, pas de `hreflang` ; site qui exige JavaScript. Similarweb : ≈ 4,2 K visites / 3 mois, −8 %, rebond 37 %, 1,97 page, 30 s, **97 % organique** — le seul du lot qui vit vraiment du référencement, sur des requêtes « notaire + ville ».

### Nota face à NotaireLocal
- **Mieux** : Nota met en relation ; NL affiche une liste. Nota a 2 000 $ de prix visible ; NL n'a rien. Nota répond à « quand ? » ; NL, à « qui ? ».
- **Pire** : NL se classe sur « notaire Québec », « notaire Sainte‑Foy » avec 127 pages ; Nota n'existe pas sur ces requêtes. Trois études de Québec y sont déjà — ce sont des noms à démarcher (Notavi fait explicitement « refinancement »).

---

## 5. Neolegal — neolegal.ca

**Nature.** Services juridiques à forfait par des **avocats du Barreau** — pas
des notaires. Fondée 2016, site mai 2017 ; 420 Notre‑Dame O., Montréal ; 1 (855)
996‑9695 ; sélecteur de 13 provinces/territoires. Portail client `neodoc.app`.
Source : [particuliers](https://www.neolegal.ca/particuliers),
[fonctionnement](https://www.neolegal.ca/fonctionnement).

### Offre et prix
- **Client paie, prix fixe, d'avance.** Ex. « Testament devant témoins » **199 $ plus taxes** (testament automatisé, non notarié). Autres produits : mise en demeure, petites créances, TAL, infractions routières, incorporation, « Parler à un avocat ». Aucun acte notarié, aucune clôture immobilière → **pas un concurrent du refinancement**, adjacent sur le testament. Source : [service 20079](https://www.neolegal.ca/service/20079/testament-automatise-devant-temoins).
- **Professionnel :** programme « Avocats collaborateurs » — « Les clients vous sont envoyés automatiquement par Neolegal », mandats « adaptés à vos préférences et à votre horaire » ; l'avocat paie en s'outillant (Suite Neolegal Affaires). Page partenaires : « Bénéficiez d'une cote sur la vente » pour les cabinets qui réfèrent — une ristourne de référence, à lire à côté de l'art. 106 du Code des avocats cité dans le brief du 1er septembre. Sources : [avocats](https://www.neolegal.ca/avocats), [partenaires](https://www.neolegal.ca/partenaires).
- Compteurs de la page particuliers rendus à « 0 Clients / 0 Forfaits complétés / 0 Taux de satisfaction » sans JavaScript.

### Délai et urgence
- « Zéro déplacement et zéro papier » ; avocat attribué et rendez‑vous téléphonique planifié après paiement ; signature électronique. « Garantie Zéro Stress » : remboursement si le produit ne convient pas. Aucune option d'urgence.

### Entonnoir
- **Compte obligatoire** (courriel, mot de passe, téléphone, adresse postale) et **paiement avant tout contact** (carte, Interac, PayPal, virement, ou par téléphone). Puis portail, formulaire, documents, appel. Le plus lourd du lot, mais le seul qui livre un produit.

### Signaux de confiance
- Trustpilot : **3,9 / 5, 342 avis**, 67 % à 5 ★ et **29 % à 1 ★** (polarisé). Birdeye : **4,2 / 5, 2 876 avis**. Sources : [Trustpilot](https://www.trustpilot.com/review/www.neolegal.ca), [Birdeye](https://reviews.birdeye.com/neolegal-168924399270046).
- Passages LCN et podcasts en page d'accueil.

### Langues, mobile, SEO, trafic
- **Bilingue** (`/en`, 6 `hreflang`), React + Bootstrap, 3 conteneurs GTM + pixel Facebook. Similarweb : **30,9 K visites / 3 mois, +61 %**, Canada #32 594, catégorie Legal #118, rebond 46 %, 3,14 pages, 1 min 03 ; **recherche payante 31,6 %, 76 % des mots‑clés sont payés**. Un acteur qui achète son trafic.

### Faiblesses ressenties (avis, < 15 mots chacun)
- Spencer Young, Trustpilot, avr. 2025 : « paid 2k five months ago and still have yet to recieve my legal documents ».
- Donna, Trustpilot, juin 2025 : « They are very quick to take your money but offer no service in return! »
- Dany Lemyre, Birdeye, ~déc. 2025 : « 600$ pour absolument rien pour me charger encore plus cher. »
- Thèmes récurrents : documents jamais livrés, remboursement refusé ou en crédit, portail imposé, facturation immédiate.

### Nota face à Neolegal
- **Mieux** : Nota ne prend pas l'argent d'avance (autorisation, capture à la signature) ; pas de compte ; pas de portail obligatoire ; l'humain est un notaire nommé, avec lien CNQ.
- **Pire** : Neolegal a 3 000 avis, une marque, de la télé, du trafic ; Nota n'a rien de mesuré. Neolegal montre ce que devient une plateforme juridique qui vend vite et livre lentement : ses 29 % de 1 ★ sont le risque de Nota si la messagerie post‑rétention ne tient pas.

---

## 6. Notaire Direct — notaire-direct.com

**Nature.** **Une étude notariale** (Notaire‑direct inc., « partenaire de
confiance… depuis plus de 35 ans », site © 2004‑2025), équipe nommée (Me
François Forget, Me Nathalie Pedneault, Me Marie‑Ève Bouchard‑Angers, Me To
Uyen Dinh, Me Gregory Leone), portail d'information juridique par domaine
(succession, immobilier, copropriété, propriété intellectuelle, codes
sources, droit maritime…). Partenaire affiché : **scriptalegal.com** (documents
en libre‑service lancés en 2011). Bilingue FR/EN, aucun prix, aucun formulaire,
aucun avis, aucune donnée structurée. Sources :
[accueil](https://www.notaire-direct.com/),
[qui‑sommes‑nous](https://www.notaire-direct.com/NousSommes.html),
[immobilier](https://www.notaire-direct.com/SubIndex/hub/Immobilier).
**Ni marché ni appariement** — le brief du 1er septembre avait raison de
l'écarter. Les domaines `notairedirect.ca/.com` ne répondent pas.

## 7. Notaire+Web — notaire-web.ca

**Nature.** Sites web en abonnement pour notaires, « en collaboration avec
l'Association professionnelle des notaires du Québec (APNQ) ». **Prix
publiés** : unilingue FR 39,99 $/mois, bilingue 44,99 $ (membre APNQ) / 49,99 $
(non‑membre), intégration complète 300 $ / 400 $ en option ; hébergement,
domaine, SSL, CMS inclus. WooCommerce + WPML (FR/EN). Pas un concurrent ; **un
signal de canal** : l'APNQ prête son nom à des outils fournisseurs — c'est la
porte que le kit de validation (mémoire « AJNQ = porte principale ») pointe
déjà. Source : [notaire‑web.ca](https://notaire-web.ca/).

---

## Grille comparative

| | Soumissions Québec | Soumissions Maison | Notaire.Solutions | NotaireLocal | Neolegal | **Nota** |
| --- | --- | --- | --- | --- | --- | --- |
| Modèle | Piste vendue à 3 notaires | Piste vendue à 3 notaires | Piste « jusqu'à 5 » | Annuaire payé par le notaire | Cabinet d'avocats à forfait | Marché : client fixe date + prix |
| Client paie | 0 $ | 0 $ | 0 $ | 0 $ | Forfait d'avance (199 $+) | Offre (dès 2 000 $) + **400 $ fixe**, capturés à la signature |
| Notaire paie | Par piste (prix caché) | Par piste (prix caché) | Inconnu | Entente signée (prix caché) | s.o. | **0 $** |
| Refinancement nommé au client | Oui (« Financement hypothécaire ») | Oui (+ page prix mainlevée/refi) | Oui | Non | Non | Oui, seul service |
| Prix visible avant contact | Fourchettes éditoriales | Fourchettes éditoriales | Testament seulement | Non | Oui, fixe | **Oui, exact, deux lignes** |
| Urgence | Case « Date prévue », sans effet | Idem + 3 plages de rappel | Non | Non | Non | **Date ferme, prime ×1 → ×4** |
| Délai promis | 24–48 h | 24 h | « quelques heures » | — | RDV après paiement | **Aucun** |
| Champs / clics | ≈ 13–15 champs, 1 page | ≈ 18 champs | **5 champs** | 1 code postal | Compte + paiement | ≈ 7 clics + 4 champs + **carte** |
| Compte | Non | Non | Non | Non | **Oui** | Non (optionnel) |
| Avis indépendants | Aucun | Aucun (témoignages maison) | Aucun | Aucun | 342 TP (3,9) · 2 876 Birdeye (4,2) | Aucun |
| Langues | FR (`lang=en`) | FR (`lang=en`) | FR (`lang=en`) | FR | **FR/EN** | **FR/EN** |
| Données structurées | WebPage/Org | WebPage/Org | Aucune | Aucune | Aucune | **Org + Service ×2 + FAQ** |
| Articles indexés | 157 | 524 | 0 | ≈ 100 (villes) | Blogue | **0** |
| Trafic (Similarweb, 3 mois) | ≈ 4,5 K, −44 % | n/d, −68 % | rebond 94 %, −67 % | ≈ 4,2 K, 97 % org. | 30,9 K, +61 %, 76 % payé | n/d (URL CloudFront) |
| Fondé | 2015 | 2015 | ≈ 2025 (Lovable) | 2017 | 2017 | 2026 |

---

## Sept constats transversaux

1. **Personne ne vend la date ; deux la captent.** SQ et SM demandent « le plus rapidement possible / d'ici 2 semaines / 30 jours » et revendent la réponse à trois notaires. La thèse de Nota (une date rapprochée a un prix) n'a pas de concurrent — mais elle n'a pas non plus de preuve : le marché installé traite l'urgence comme une qualification de piste, jamais comme une prime.
2. **Le prix par piste reste introuvable sur le web.** Trois acteurs le vendent (SQ, SM, NL), aucun ne l'affiche. À obtenir en entrevue, avec un notaire acheteur de pistes — c'est le nombre qui donne sa valeur au « 0 $ pour le notaire » de Nota.
3. **Aucun des quatre apparieurs québécois n'a un seul avis indépendant.** Trustpilot 404 pour SQ et SM, rien pour NS et NL. Le seul acteur noté (Neolegal) l'est à 29 % de 1 ★. Le marché n'a pas encore de référence de confiance ; Nota n'en a pas non plus, mais c'est la première place vide à prendre — avec des faits (nombre d'actes, CNQ), pas des cotes (ADR 0030).
4. **Le formulaire de Nota est le plus long du lot après Neolegal, et le seul qui demande une carte.** Notaire.Solutions tient en 5 champs. La carte à la publication est le prix de « payé à la signature » ; il faut que l'écran le dise aussi clairement que le devis (« Autorisé, non débité »).
5. **Le total client de Nota est hors de l'échelle que ses concurrents publient.** SQ affiche 750 $ pour quittance/mainlevée et 1 300–1 600 $ pour une transaction ; Nota pré‑remplit 4 000–8 000 $ + 400 $ sous 14 jours. Le brief du 1er septembre disait déjà « ne jamais présenter Nota comme moins cher » ; ce relevé ajoute : sous 14 jours, l'écart n'est pas de 40–60 %, il est de ×3 à ×5 par rapport aux repères que le client lit ailleurs. Le film d'intro (1 800 → 2 200 $) est la seule échelle du site que ces repères rendent crédible — et le domaine ne la propose pas.
6. **Le SEO est le trou le plus large de Nota.** 157 et 524 articles chez SQ/SM, 127 pages de villes chez NL, contre 1 URL et 0 article chez Nota, sur une URL CloudFront. Les données structurées de Nota sont les meilleures du lot ; elles n'ont rien à structurer.
7. **Deux acteurs visent déjà exactement le segment de Nota** : Soumissions Maison (page « refinancer une hypothèque ») et Notaire.Solutions (formulaire à trois services dont « Refinancement hypothécaire », villes = quartiers de Québec). Le second est un clone léger sans exploitant nommé ; le premier a dix ans de contenu.

## Ce qu'il faut demander en entrevue (inchangé + ajouts)

- Le **prix par piste** de Soumissions Québec / Maison, et le taux de conversion piste → acte qu'un notaire acheteur observe.
- Ce que **Notavi, S&V Notaires et Me Langlois** (les trois fiches Québec de NotaireLocal) paient à Adik Média, et ce que ça leur rapporte.
- Qui exploite **Notaire.Solutions** — (877) 376‑8993.
- Si la case « le plus rapidement possible » de SQ produit des dossiers qu'un notaire refuse faute d'agenda : c'est le cas d'usage de Nota, et il est mesurable chez eux.

---

**Sources crawlées le 3 septembre 2026 :**
[soumissionsquebec.ca/notaires/](https://soumissionsquebec.ca/notaires/) ·
[devenir‑partenaire](https://soumissionsquebec.ca/devenir-partenaire/) ·
[annoncez‑avec‑nous](https://soumissionsquebec.ca/annoncez-avec-nous/) ·
[qui‑est](https://soumissionsquebec.ca/qui-est-soumissions-quebec/) ·
[termes](https://soumissionsquebec.ca/termes-et-conditions/) ·
[tarifs notaires](https://soumissionsquebec.ca/tarifs-et-prix-notaires-a-quebec/) ·
[soumissionsmaison.com/notaires/](https://www.soumissionsmaison.com/notaires/) ·
[comparateur](https://www.soumissionsmaison.com/notaires/comparateur/) ·
[notaires‑pour‑immobilier](https://www.soumissionsmaison.com/notaires-pour-immobilier/) ·
[prix‑notaire‑quebec](https://www.soumissionsmaison.com/notaires/prix-notaire-quebec/) ·
[inscription‑partenaire](https://www.soumissionsmaison.com/inscription-comme-partenaire/) ·
[notairesolutions.ca](https://notairesolutions.ca/) et son [bundle](https://notairesolutions.ca/assets/index-qhjDzjx7.js) ·
[notairelocal.com](https://www.notairelocal.com/) · [/quebec/](https://www.notairelocal.com/quebec/) · [à‑propos](https://www.notairelocal.com/a-propos/) · [conception](https://www.notairelocal.com/conception-site-web/) · [conditions](https://www.notairelocal.com/conditions-utilisation/) ·
[neolegal.ca](https://www.neolegal.ca/) · [fonctionnement](https://www.neolegal.ca/fonctionnement) · [particuliers](https://www.neolegal.ca/particuliers) · [avocats](https://www.neolegal.ca/avocats) · [partenaires](https://www.neolegal.ca/partenaires) · [Trustpilot](https://www.trustpilot.com/review/www.neolegal.ca) · [Birdeye](https://reviews.birdeye.com/neolegal-168924399270046) ·
[notaire‑direct.com](https://www.notaire-direct.com/) · [notaire‑web.ca](https://notaire-web.ca/) ·
Similarweb : [soumissionsquebec.ca](https://www.similarweb.com/website/soumissionsquebec.ca/) · [soumissionsmaison.com](https://www.similarweb.com/website/soumissionsmaison.com/) · [notairesolutions.ca](https://www.similarweb.com/website/notairesolutions.ca/) · [notairelocal.com](https://www.similarweb.com/website/notairelocal.com/) · [neolegal.ca](https://www.similarweb.com/website/neolegal.ca/)
