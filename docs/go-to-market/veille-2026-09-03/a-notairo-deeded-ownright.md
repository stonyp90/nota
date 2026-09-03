# Veille concurrentielle approfondie — Notairo · Deeded · Ownright

Relevé du 3 septembre 2026, par crawl direct (`curl`, sitemaps, `products.json`
Shopify, formulaires ouverts dans le navigateur sans rien soumettre) et
recherches web. Chaque fait porte l'URL d'où il vient. Le point de comparaison
est le produit Nota **tel qu'il est dans le dépôt aujourd'hui**
(`packages/domain/index.js`, `apps/web/public/index.html`, ADR 0015/0023/0031/0033).

---

## 0. Ce que Nota vend réellement (base de comparaison)

| Élément | Valeur dans le code | Source |
| --- | --- | --- |
| Catalogue | **Refinancement hypothécaire 2 000 $** · **Financement hypothécaire 1 800 $** (testament/procuration retirés) | `packages/domain/index.js` `SERVICES`, ADR 0010 |
| Suppléments de dossier | prêt > 300 k$ +150 · > 600 k$ +350 · > 1 M$ +600 ; approbation « en cours » +100 / « pas encore » +200 ; succession +400 ; co-emprunteur +150 ; certificat périmé +100 ; achat (financement) +200 ; prêteur privé +300 | idem, `pricing.criteria` |
| Déplacement | client ≤ 50 km +0 · ≤ 25 km +50 · < 10 km +100 · notaire chez le client ≤ 25 km +150 · ≤ 50 km +250 · **urgence 100 % en ligne +400** | `DEPLACEMENTS`, ADR 0017 |
| **Échelle d'urgence** (multiplicateur du prix plancher, médiane de bande) | standard 15 j+ **×1** · rapide 8–14 j **×2** · prioritaire 2–7 j **×3** · urgence veille **×3,5** · extrême jour même **×4** ; plafond ×5 | `TIERS`, `tierMultiplier`, `PREMIUM_CAP` |
| Prix de Nota | **400 $ fixe** par acte (`DEFAULT_PRIX_CENTS` = 40 000 ¢), identique pour tous, payé par le client à la signature ; le notaire reçoit 100 % de l'offre | ADR 0031 |
| Moment du paiement | carte **autorisée** à la publication (« Paiement autorisé. Votre offre est en cours de publication »), **capturée à la signature** ; l'autorisation Stripe expire ~7 j → repli créance hors plateforme | ADR 0015, ADR 0029, `i18n.js` l. 586 |
| Annulation | gratuite tant qu'aucun notaire n'a retenu ; ensuite 30 % (0–3 j) · 10 % (4–14 j) · 0 % (15 j+), **versés au notaire** | ADR 0023, ADR 0033 |
| Entonnoir | calendrier public → clic sur une date → un seul formulaire (`#offer-form` : service, date, curseur de montant, secteur postal, nom, courriel, téléphone, anonymat, code de parrainage) → autorisation de carte → publié. **Pas de compte requis** ; lien magique pour l'espace client | `index.html` l. 1386–1580, ADR 0024 |
| Exemple concret | refinancement ≤ 300 k$, approbation obtenue, client se déplace : **2 000 $ + 400 $ = 2 400 $** à 15 j+ ; **6 000 $ + 400 $ = 6 400 $** signé dans la semaine ; **8 000 $ + 400 $** le jour même | calcul `notaPrice × tierMultiplier + prixNota` |
| Débours | **non mentionnés** nulle part dans l'offre au client (frais du Registre foncier, copies, etc. restent à régler à l'étude) | absence dans `index.html` / domaine |
| Confiance | 0 avis, 1 notaire inscrit (`@nota.ca`, test), SES en bac à sable (aucun courriel réel), Stripe vide en prod, canonical = URL CloudFront (pas de domaine) | mémoire « Config prod incomplète », `index.html` l. 18 |
| SEO / a11y | title « Nota — le carnet public des actes notariés à Québec », 6 blocs JSON-LD (ProfessionalService, OfferCatalog, FAQPage, WebSite…), hreflang fr-CA/en-CA, `llms.txt`, `robots.txt` ouvert aux LLM ; sitemap **1 URL**, **0 billet de blogue** ; 245 attributs `aria-*`, lien d'évitement, `focus-visible`, `prefers-reduced-motion`, bilingue natif FR/EN | `apps/web/public/` |

---

## 1. Notairo — notairo.com

### Identité

- Startup montréalaise, **lancée le 9 octobre 2025** ; fondateur et PDG **Ryan Hillier** ; « première plateforme québécoise pour préparer les transactions immobilières en ligne » ; réclame un marché de **160 000 transactions/an, ~150 M$** au Québec. Contact médias info@notairo.com, (514) 295-8255. — https://notairo.com/blogs/presse-et-medias/notairo-lance-la-premiere-plateforme-quebecoise-pour-preparer-les-transactions-immobilieres-en-ligne
- **C'est une boutique Shopify** (thème `t/9`, `robots.txt` « Shopify storefront », `agents.md`, endpoints UCP/MCP pour agents acheteurs). — https://notairo.com/robots.txt · https://notairo.com/agents.md · https://notairo.com/.well-known/ucp
- Aucun financement annoncé, aucune page LinkedIn d'entreprise retrouvée ; seule presse = communiqué auto-publié. Effectif inconnu.

### Offre et prix affichés

Page d'accueil et pages services (identiques) : https://notairo.com/ · https://notairo.com/pages/services · https://notairo.com/pages/refinancement-et-transfert-hypothecaire

| Acte | « À partir de » | Inclus | Exclu |
| --- | --- | --- | --- |
| Achat résidentiel / acte de vente | **1 099 $ + débours** | rédaction et signature, vérification des titres, enregistrement au registre foncier | taxes, débours |
| Refinancement ou transfert hypothécaire | **949 $ + débours** | acte hypothécaire, radiation de l'ancienne hypothèque, publication | taxes, débours |
| Conseils juridiques indépendants | **299 $**, aucuns débours | jusqu'à 1 h | — |

Mention légale sous le tableau : « estimations pour une transaction standard… Des frais additionnels peuvent s'appliquer dans certains cas particuliers (**urgence, signatures hors heures**, transactions complexes) ».

### Ce que le catalogue Shopify révèle (prix réels, non affichés en vitrine)

`https://notairo.com/products.json` (19 produits, tous « Service Notaire ») :

| Produit (handle) | Prix | Note |
| --- | --- | --- |
| `frais-de-prise-en-charge-de-dossier` | **295 $** (non taxable) | « couvrent la prise en charge de votre dossier par Notairo, la coordination avec le notaire instrumentant, et le suivi jusqu'à la signature. **Les honoraires du notaire et les débours seront payables directement au notaire lors du rendez-vous de signature.** » — https://notairo.com/products/frais-de-prise-en-charge-de-dossier |
| `refinancement-transfert-hypothecaire` / `-2` / `-2225` / `-virtuel` / `-en-personne` | **1 795 $ · 1 995 $ · 2 225 $** | « Avance d'honoraires et de débours pour forfait de refinancement ou transfert hypothécaire notarié (**taxes incluses**) » ; variante « virtuel » = 2 225 $, « en personne » = 1 995 $ |
| `acte-de-vente` / `-2` / `-2225` / `-en-personne` | **1 795 $ · 1 995 $ · 2 225 $** | idem, taxes et débours inclus |
| `acte-de-vente-debours-exclus` | **2 495 $** (taxable) | débours exclus |
| `conseils-juridiques` · `consultation-juridique` | 345 $ (1 h) · 295 $/h | la page dit 299 $/h |
| `opinion-juridique-sur-droits-de-passage-et-servitudes-me-francis-langlois-notaire` | 1 500 $ | un notaire nommé — indice d'un notaire du réseau |
| `refinancement-765` + `debourses-non-taxables` | **8 863,05 $ + 1 959,46 $ = 12 149,75 $** | **facture d'un client réel** (immeuble 765, rue Nobel, Saint-Jérôme, prêts Desjardins + Financière agricole, quittance BNC), publiée comme produit et **indexée dans le sitemap** — https://notairo.com/pages/refinancement-765 · https://notairo.com/products/refinancement-765 |

**Lecture :** le modèle opérationnel de Notairo est **exactement la forme de l'ADR 0031** — la plateforme vend son propre service au client (295 $ de prise en charge), le notaire encaisse ses honoraires directement à la signature. Les forfaits « avance d'honoraires et débours » à 1 795–2 225 $ TTC montrent que le **prix réel d'un refinancement chez Notairo est ~1 800–2 200 $ tout compris**, pas 949 $. La facture de 12 149,75 $ pour un refinancement multi-prêteurs prouve aussi qu'un dossier complexe est facturé au temps, sans plafond.

### Promesse de délai

- FAQ : « Achat/vente : 3 à 4 semaines après l'acceptation de l'offre — **Refinancement : 1 à 2 semaines, parfois moins** — Vente rapide : possible, selon la disponibilité et la rapidité à fournir les documents ». — https://notairo.com/pages/foire-aux-questions
- Accueil : « Est-il possible d'obtenir un rendez-vous rapide ou urgent ? **Oui ! Nous priorisons les dossiers en fonction de la date de signature prévue.** » — https://notairo.com/
- Blogue : « La plupart des clients signent en 30 minutes ou moins ». — https://notairo.com/blogs/news/comment-ca-fonctionne-le-processus-notairo-etape-par-etape
- **Aucun prix d'urgence chiffré** ; seulement la clause « frais additionnels (urgence…) ».

### Entonnoir (compté dans le navigateur, rien soumis)

1. Accueil → « Obtenez votre soumission gratuite » → https://notairo.com/pages/soumission-notaire (formulaire **Globo Form Builder**, 9 pages).
2. Page 1 : type de service (achat, vente, **refinancement**, transfert, conseils). Page 2 : type de propriété (maison/condo/plex/terrain), adresse, ville, code postal — tous obligatoires. Pages suivantes (lues dans le DOM) : **date de signature**, prix d'achat/vente, montant refinancé, hypothèque actuelle, prêteur actuel, institution financière, nom du courtier hypothécaire, prénom, nom, téléphone, courriel, ville de résidence, deux oui/non.
3. La « soumission gratuite et instantanée » de la vitrine est en fait **envoyée par l'équipe** (« vous recevez une soumission détaillée… Une fois la soumission acceptée, vous êtes guidé(e) » — blogue ci-dessus).
4. Paiement : **Shopify Checkout, avant acceptation** (« Nous devons recevoir et traiter votre paiement avant que votre commande ne soit acceptée… Notairo peut ne pas être en mesure de répondre aux demandes d'annulation après l'acceptation ») — https://notairo.com/policies/terms-of-service ; la page « Politique de remboursement » est un **404** — https://notairo.com/policies/refund-policy
5. Compte : client Shopify optionnel (« Connectez-vous pour payer plus vite »). Ensuite portail de dossier, puis rendez-vous en personne.

Compte tenu de l'aller-retour humain pour la soumission, **≈ 12 écrans + une attente** avant d'avoir un prix ferme.

### Rémunération et recrutement du notaire

- « Notairo vous propose un notaire de confiance, situé près de chez vous » ; « notaire accrédité ». Aucun partage divulgué. Le produit à 295 $ dit que **le notaire est payé directement à la signature** (pas de flux via Notairo pour les honoraires — mais les forfaits « avance d'honoraires » contredisent partiellement : là, Notairo encaisse tout d'avance).
- Recrutement : `/pages/notaires` est une **copie de la page consommateur** (aucun contenu notaire). Le seul appel est un paragraphe sur `/pages/propos` et `/pages/contact` : « un flot constant de clients qualifiés… Écrivez-nous à info@notairo.com ». — https://notairo.com/pages/propos
- Programme « Référer quelqu'un » (courtiers) : simple formulaire. — https://notairo.com/pages/reference

### Signaux de confiance

- 3 témoignages sur site (prénoms, villes), **aucune présence retrouvée sur Google Reviews, Trustpilot ou Reddit** (recherches multiples).
- Pas d'assurance, de garantie ni de mention de la Chambre au-delà de « notaire accrédité » ; sécurité : « infrastructure numérique sécurisée » (générique).
- Affirmation à vérifier : « **Au Québec, la loi exige que les actes notariés soient signés en personne** » (FAQ). Le régime de l'acte notarié technologique et de la clôture à distance (modernisation de la pratique notariale, 2023) rend cette phrase au minimum discutable — c'est précisément l'option « urgence 100 % en ligne » que Nota vend. À faire trancher par l'avis juridique déjà prévu.

### Langues, mobile, accessibilité, SEO

- FR + EN (localisation Shopify `/en`, 3 `hreflang`). Thème Shopify récent : responsive, lien « Ignorer et passer au contenu ».
- **Title de l'accueil = « Notairo »** (faible) ; meta description correcte ; 1 bloc JSON-LD ; **19 pages locales** (notaire-montreal, -laval, -longueuil, -brossard, -westmount…) toutes identiques ; **18 billets de blogue** + communiqués. — https://notairo.com/sitemap_pages_1.xml · https://notairo.com/sitemap_blogs_1.xml
- Prêt pour le commerce par agents (UCP/MCP, `agents.md`) — inhabituel et à surveiller.

### Proxys de trafic

Lancement il y a 11 mois, aucune levée, pas de profil LinkedIn d'entreprise ; effectif inconnu. Aucune estimation Similarweb indexée. Volume probablement faible (0 avis tiers en 11 mois).

### Faiblesses ressenties par un utilisateur

- Aucun avis tiers vérifiable ; la seule preuve sociale est auto-hébergée.
- « **soumission gratuite et instantanée** » (accueil) vs formulaire de 9 pages puis attente d'une soumission humaine.
- « **À partir de 949 $** » vs forfaits réels à 1 795–2 225 $ TTC ; « frais additionnels (urgence…) » jamais chiffrés.
- Politique de remboursement en 404 ; conditions Shopify génériques (« sans garantie », commande non annulable après acceptation).
- Une facture client de 12 149,75 $ avec adresse civique **publiquement indexée**.

### Nota vs Notairo

**Nota est meilleur :**
- La date a un prix : cinq paliers chiffrés (×1 → ×4) là où Notairo écrit « frais additionnels » sans montant. Notairo *priorise* selon la date mais ne la vend pas.
- Prix calculé à l'écran **avant** toute donnée personnelle (un formulaire, pas de compte) contre 9 pages + attente.
- Le notaire choisit et propose (marché) ; chez Notairo il est assigné.
- Annulation chiffrée et publique ; rien de tel chez Notairo (404).
- Console notaire (agenda par date, flux webcal, messagerie avec documents, registre) vs un courriel à info@.
- JSON-LD, `llms.txt`, bilinguisme natif, accessibilité mesurée.
- **Validation externe** : le produit « frais de prise en charge 295 $ » de Notairo est la même structure que le prix fixe Nota de 400 $ — le marché québécois l'a déjà adoptée.

**Nota est pire :**
- **Prix** : 2 400 $ (2 000 + 400) au palier standard vs ~1 800–2 200 $ TTC débours inclus chez Notairo ; et **6 400 $** pour une signature dans la semaine, alors que Notairo affirme boucler un refinancement en « 1 à 2 semaines, parfois moins » sans surprime affichée. L'échelle ×3/×4 n'a **aucune transaction** pour la soutenir.
- Nota n'annonce **ni taxes ni débours** : le « total » du client n'est pas un total ; Notairo écrit « + débours » partout et vend des forfaits taxes-et-débours inclus.
- Catalogue : Nota n'a **pas d'acte de vente/achat** (le gros du volume, 1 099 $ chez Notairo) ni de conseils juridiques.
- Couverture : « un notaire de **Québec** » vs Montréal, Laval, Rive-Sud, West Island.
- Preuve sociale : 0 vs 3 témoignages + un lancement médiatisé ; Nota n'a ni domaine, ni SES hors bac à sable, ni Stripe en prod.
- Contenu : 0 billet vs 18 + 19 pages locales.
- Notairo encaisse **avant** (Shopify) ; Nota autorise une carte qui **expire en 7 jours** pour des dates à 15 j+ — le chantier connu.

---

## 2. Deeded — deeded.ca

### Identité

- Deeded Inc., **Oakville (ON)**, fondée **2020**, PDG et cofondateur **Reuven Gorsht** (COO Rebecca Hundert) ; amorçage mené par **AV8 Ventures** avec Overlook VC, **montant non divulgué** ; 11–50 employés (LinkedIn), 10 663 abonnés LinkedIn. — https://www.crunchbase.com/organization/deeded · https://www.cbinsights.com/company/deeded · https://ca.linkedin.com/company/deeded
- **Deux régimes réglementaires** : participant *Access to Innovation* (A2I) du Barreau de l'Ontario (approuvé sept. 2024) et **Innovation Sandbox du Law Society of Alberta**, où « Deeded Inc. is authorized to carry on business as a law firm in Alberta » avec des « lawyers who are **employed by Deeded** ». En Ontario : « Deeded is not a law firm ». — https://www.deeded.ca/blog/deeded-joins-the-law-society-of-ontario-a2i · https://www.deeded.ca/terms
- SOC 2 Type 2. — https://www.deeded.ca/about-us

### Offre et prix

https://www.deeded.ca/pricing (Webflow, publié 31 juil. 2026)

| Acte | Ontario | Alberta | Inclus |
| --- | --- | --- | --- |
| Achat | **from 1 199 $** | from 999 $ | tâches juridiques, **accès illimité** à l'avocat et à l'équipe, signature virtuelle, tableau de bord |
| Vente | from 1 099 $ | from 899 $ | idem |
| **Refinancement ou transfert** | **from 999 $** | from 999 $ | idem |
| Changement de propriété / conseil indépendant (ILA) | from 599 $ | from 599 $ | accès (non « illimité ») |

« + Disbursements » partout ; « All prices are estimates for a standard transaction and exclude applicable taxes and disbursements ». Les conditions ajoutent : « Any additional services, fees, disbursements or surcharges… are at the sole discretion of the Legal Service Provider ». Note : la fiche de septembre disait 1 099 $/999 $ ; l'Ontario est passé à 1 199 $/1 099 $.

### Promesse de délai

- Page d'entrée : « **Close within 5-7 days** & track your closing every step of the way ». — https://www.deeded.ca/1-start-closing
- Page hypothèque : « Need a quick turnaround? Deeded gets things done fast ». — https://www.deeded.ca/mortgage
- FAQ courtiers : « I've got an urgent closing. How quickly can you close? … we'll make every effort to accommodate ». — https://www.deeded.ca/pricing
- Témoignage : « Deeded was able to close my deal on an extremely tight schedule ». Aucune option ni prix « rush ».

### Entonnoir

1. « Start Closing » → **app.deeded.ca**, formulaire « Get Your Quote — **Page 1 of 3** » : service (5 choix) → adresse → prénom, nom, courriel, téléphone, date de clôture prévue. — https://app.deeded.ca/information/my-quote/new (vu dans le navigateur)
2. « we'll send you a detailed quote **within minutes** » (courriel), puis « Within minutes, we'll assign your lawyer ».
3. **Compte obligatoire** : « To use the Platform, you must register and create a personal user account » ; puis onboarding + **vérification d'identité** en ligne ; tableau de bord « pizza tracker » ; signature vidéo « a few days before your planned closing date ». — https://www.deeded.ca/terms
4. Contrat : « the User is required to review and electronically accept a separate engagement agreement with a Legal Service Provider ». Paiement à l'avocat (pas à Deeded), moment non affiché (usage : à la clôture, sur les fonds en fidéicommis).
5. Signature virtuelle **indisponible en C.-B.** (visite à domicile).

≈ 3 écrans pour la demande, puis compte + onboarding : **5–6 écrans** avant un dossier ouvert.

### Rémunération et recrutement du professionnel

- « a small and very select group of skilled independent Real Estate Lawyers ». — https://www.deeded.ca/mortgage
- **Le sens du flux d'argent est écrit noir sur blanc** : « Deeded may provide the following services… **in exchange for service fees from the Legal Service Provider**: administrative, clerical, technical, scheduling support; access to certain software and/or databases; customer service support; and marketing support. » → **l'avocat paie Deeded** des frais de service (Ontario). En Alberta, les avocats sont **salariés** de Deeded. Aucun barème public. — https://www.deeded.ca/terms
- Page avocats : « Increased clientele, decreased hustling… Virtual, so you can close from anywhere » → « Get in Touch ». — https://www.deeded.ca/lawyers · page Carrières = 404.

### Signaux de confiance

- **Google 4,9 / 695 avis** (miroir Birdeye, profil réclamé) ; le site affiche « 5.0 Google Reviews rating », « 500+ 5-Star Reviews », « 225+ years of combined experience », « Thousands of customers ». — https://reviews.birdeye.com/deeded-165524619508979 · https://www.deeded.ca/
- SOC 2 Type 2 ; A2I + Alberta sandbox ; processus de plainte écrit et « Responsible Lawyer and Compliance Officer » nommé (Alberta) ; avertissement « Deeded is not a law firm » ; Trustpilot bloqué (403).
- Tableau de bord partagé courtier/client (« Deeded Pro »), partenariat Insurely (assurance).

### Langues, mobile, accessibilité, SEO

- Anglais + **français par Weglot** (traduction automatique, `hreflang` en/fr). — https://www.deeded.ca/
- Webflow responsive ; balises title descriptives ; **285 URL de blogue**, **28 pages « Real Estate Lawyer in <ville> »** (ON/AB/BC), calculateurs de droits de mutation et d'admissibilité premier acheteur ; 1 bloc JSON-LD sur l'accueil. — https://www.deeded.ca/sitemap.xml

### Proxys de trafic

10 663 abonnés LinkedIn ; « thousands of customers » ; 695 avis Google (≈ 2020→2026) ; canal principal = courtiers hypothécaires et agents (démo, « Refer a Deal »). Aucune estimation Similarweb indexée.

### Faiblesses ressenties (verbatim)

- « The entire closing process felt rushed and disorganized » — Stephanie K., Birdeye, il y a un an. — https://reviews.birdeye.com/deeded-165524619508979
- « critical details being handled at the last minute » — même avis (certificat de statut expiré signalé la veille, **240 $ de frais rush**).
- Deeded décline toute responsabilité sur le travail de l'avocat : « does not… supervise, direct, control, or evaluate the Legal Service Providers ». — https://www.deeded.ca/terms

### Nota vs Deeded

**Nota est meilleur :**
- La date est tarifée et visible dans un calendrier ; Deeded vend « 5–7 days » comme un trait, sans prix ni garantie.
- Pas de compte, pas d'engagement à accepter avant de voir le prix ; un seul formulaire.
- Français natif (Deeded : Weglot).
- Annulation chiffrée et publique.
- Transparence du flux : Nota déclare le prix fixe payé par le client ; Deeded fait payer l'avocat sans barème public — structure que l'art. 32.1 rendrait risquée au Québec.

**Nota est pire :**
- Refinancement **2 400 $** vs **999 $ + débours** (et 6 400 $ dans la semaine).
- 0 avis vs 695 à 4,9 ; SOC 2 ; deux régulateurs ; téléphone et heures affichés ; processus de plainte écrit.
- Pas de tableau de bord de jalons après rétention (Nota : courriels + messagerie), pas de vérification d'identité en ligne, pas de signature virtuelle standard.
- Pas de portail courtier ; Deeded a « Deeded Pro » (soumission de dossier en 30 s, visibilité courtier/client).
- 0 page de contenu vs 285 billets + 28 pages ville + outils.
- Catalogue : pas d'achat/vente, pas de transfert de titre, pas d'ILA.

---

## 3. Ownright (ex-Doormat) — ownright.com

### Identité

- Domaine réel **ownright.com** (ownright.ca sert le même site) ; Toronto, 545 King St W ; **fondée 2022** (Doormat Real Estate Services Inc.), lancée 2023, **renommée Ownright le 18 mars 2025**. Fondateurs **Robert Saunders** (PDG, ex-ingénieur Shopify), **Joel Fox** (COO), **Benjamin Berry** (CLO, avocat principal, LSO #72474T). — https://ownright.com/about · https://betakit.com/doormat-becomes-ownright-closes-4-5-million-to-help-more-ontarians-seal-real-estate-deals/
- Financement : **1,25 M$** pré-amorçage (juin 2023, Alate/Relay) + **4,5 M$** amorçage clos déc. 2024, co-mené par Alate Partners et Relay Ventures → **6,5 M$** au total. Équipe **19 → 25** visés (page « 20+ team members », 4 avocats LSO listés). — BetaKit ci-dessus
- **Second participant** approuvé au programme A2I du Barreau de l'Ontario (juin 2023) ; la structure « does not mandate ownership by a lawyer ». Les avocats exercent sous le cabinet partenaire **« Ownright Law »** ; sur la page équipe : « This team member is a LSO licensee and is **engaged by Ownright** to provide legal services ». — https://www.lawtimesnews.com/practice-areas/real-estate/ontario-regulator-approves-real-estate-legal-tech-firm-doormat-as-part-of-innovation-program/377793 · https://ownright.com/about
- Traction : **> 1 000 transactions, > 750 M$** (mars 2025), « hundreds of deals monthly », cap du **1 G$** visé fin 2025 ; **< 1 % du marché ontarien**. Expansion AB/C.-B. **reportée** en 2025 (BetaKit), mais le schéma et la FAQ affichent aujourd'hui « Ontario, Alberta, and British Columbia » tandis que le pied de page dit « all of Ontario with more provinces to come soon » — incohérent. — https://ownright.com/faq · https://ownright.com/service-areas

### Offre et prix

https://ownright.com/pricing

| Acte | Prix | Note |
| --- | --- | --- |
| Achat | **1 179 $** | « Transparent upfront pricing… regardless of the price of your property » |
| Vente | **1 079 $** | |
| **Refinancement hypothécaire** | **1 179 $** | |
| Revue de certificat de statut (condo) | **Gratuit** | produit d'appel |

« All prices are subject to HST and disbursements » ; débours = **frais de tiers seulement**, aucun frais d'administration refacturé (« we don't charge Administration Fees »). Law Times 2023 : « about 25 percent cheaper than the industry average ». La page partenaires affiche « Property closing 1 079 $ ». — https://ownright.com/partners

### Promesse de délai

- FAQ : « engaging a real estate lawyer **less than a week ahead of closing would put your transaction at risk of delay**. We typically advise engaging us… **at least 30 days in advance** ». — https://ownright.com/faq
- Mais avis Google (3 mois) : « We had 2 DAYS to close and Ownright made it happen! … updated us on our closing **by the hour** ». — https://reviews.birdeye.com/ownright-169737745302566
- Aucune option ni prix « rush ».

### Entonnoir

1. « Get a quote » / « Start your refinance » → **clients.ownright.com/get-started/refinance** : écran 1 = adresse de l'immeuble (rue, unité, ville, code postal, province, pays) avec barre de progression **5 segments** et « Login to existing account ». (Vu dans le navigateur, rien saisi.)
2. Compte via accounts.ownright.com → tableau de bord → « Share your info and chat with our team » → vérification d'identité → « Meet your lawyer and sign documents remotely » (vidéo) → notifications temps réel. 4 étapes annoncées. — https://ownright.com/
3. Paiement : lettre d'engagement (« Engagement Letter »), débours « you reimburse at the transaction's close » ; honoraires vraisemblablement à la clôture. — https://ownright.com/legal
4. Programme partenaires (agents, courtiers) : portail partenaires (partners.ownright.com), « Get your clients started », plateforme développeur (dev.ownright.com).

≈ 5 écrans de wizard + compte avant dossier ouvert.

### Rémunération et recrutement du professionnel

- **Modèle intégré, pas de marché** : avocats engagés/salariés sous Ownright Law ; « Ownright is a digital real estate law firm » ; « taking a fee from every purchase, sale, or refinancing » (BetaKit). Aucun partage à divulguer : il n'y a pas deux parties. Recrutement = page « Join our team ».
- Croissance « largely driven by referrals from real estate agents and mortgage brokers » ; 27 partenaires individuels et 14 entreprises nommés (Condos.ca, Property.ca, Pine, Perch, Right at Home…). — https://ownright.com/partners

### Signaux de confiance

- **Google 5,0 / 1 768 avis** (Birdeye, profil non réclamé) ; TrustAnalytica 5,0 / 1 488 ; site « 1500+ 5-star reviews » ; **BBB accrédité A+** (page bloquée au crawl) ; « Recommended by agents from… » ; numéros LSO affichés ; processus de plainte décrit dans la FAQ ; « Proudly Canadian ». — https://reviews.birdeye.com/ownright-169737745302566 · https://trustanalytica.org/ca/on/toronto/reviews/ownright · https://www.bbb.org/ca/on/toronto/profile/real-estate-lawyer/ownright-inc-0107-1401026
- Assurance titres **exigée** des acheteurs (FAQ).

### Langues, mobile, accessibilité, SEO

- **Anglais seulement** (`availableLanguage: ["English"]`, aucun `hreflang`).
- Next.js responsive ; JSON-LD **riche** (Organization + LegalService + OfferCatalog + géo + horaires) ; titles descriptifs ; **~150 URL de blogue** (7 catégories), infolettre « Realty Check » avec archive, calculateur de droits de mutation, **50+ villes** dans service-areas. — https://ownright.com/sitemap.xml · https://ownright.com/

### Proxys de trafic

1 768 avis Google en ~3 ans (≈ 50/mois, cohérent avec « hundreds of deals monthly ») ; 6,5 M$ levés ; 19–25 employés ; deux portails (clients, partenaires) + API développeur. Aucune estimation Similarweb indexée.

### Faiblesses ressenties

- Aucun avis négatif retrouvé (Google/BBB/Reddit) ; les corpus sont uniformément positifs — la faiblesse est structurelle, pas vécue :
- « less than a week ahead of closing would put your transaction at risk » — FAQ Ownright (le délai court n'est pas un produit).
- « we typically advise engaging us… at least 30 days in advance » — FAQ Ownright.
- Anglais seulement ; incohérence Ontario-seul / ON-AB-BC ; profil Birdeye non réclamé.

### Nota vs Ownright

**Nota est meilleur :**
- Marché ouvert : plusieurs notaires voient et proposent ; Ownright est un cabinet à prix unique.
- La date est un prix ; Ownright demande 30 jours et fait le rush « à la faveur ».
- Bilingue, sans compte pour publier, prix avant identité.
- Rien à défendre sur le partage d'honoraires : Nota vend son service ; Ownright est le cabinet (l'autre voie légitime).

**Nota est pire :**
- Refinancement **2 400 $** vs **1 179 $ + HST + débours de tiers** (Ownright explicite même les débours qu'il absorbe).
- 0 avis vs 1 768 à 5,0 + BBB A+ + A2I ; 6,5 M$ vs 0 ; 25 employés vs propriétaire seul.
- Aucun réseau de partenaires actif (Nota a la porte Partenaires 50 $/250 $, mais pas de portail ni de nom affiché) vs 41 partenaires nommés et un portail.
- Pas de revue gratuite « produit d'appel », pas d'assurance titres, pas de lettre d'engagement publiée.
- Contenu : 0 vs ~150 billets + infolettre + calculateur ; JSON-LD comparable mais Nota n'a pas de domaine.
- Ownright suit le dossier « by the hour » avec des jalons ; Nota n'a pas de jalons visuels après rétention.

---

## 4. Synthèse transversale

### Ce que les trois font que Nota ne fait pas
1. **Achat et vente** (le volume) — Nota ne fait que financement/refinancement.
2. **Portail courtier/agent** avec soumission de dossier et visibilité partagée (Deeded Pro, Ownright partners, Notairo « Référer »).
3. **Tableau de bord de jalons** après l'ouverture (« pizza tracker », « by the hour »).
4. **Preuve sociale tierce** massive (695 / 1 768 avis Google) et **estampilles de régulateur** (A2I, Alberta sandbox) — Notairo n'a ni l'un ni l'autre : c'est le seul concurrent au même stade de confiance que Nota.
5. **Contenu SEO** en volume (18 / 285 / ~150 billets, pages ville).
6. **Débours annoncés** comme ligne séparée.

### Ce que Nota fait que personne ne fait
1. **Tarifer la date** (cinq paliers) et laisser **plusieurs notaires** répondre.
2. Afficher un prix calculé **avant** toute donnée personnelle, sans compte.
3. Publier une politique d'annulation chiffrée dont les frais vont au notaire.
4. Une console notaire par date (agenda, webcal, messagerie-documents, registre d'actes).
5. FR/EN natif au Québec (Notairo : oui aussi ; Deeded : machine ; Ownright : non).

### Les deux chiffres à assumer
- **Écart de prix** : Nota standard 2 400 $ vs 999–1 179 $ + débours (ON/AB) et ~1 800–2 200 $ TTC (Notairo). **Dans la semaine, Nota est à 6 400 $** — 3× le forfait TTC de Notairo, qui affirme livrer un refinancement en 1–2 semaines « parfois moins ». La thèse « on vend la date » n'a encore **aucune transaction** derrière elle ; les multiplicateurs ×3/×4 sont une opinion du 28 août, pas un prix de marché.
- **Déficit de confiance** : 0 avis, pas de domaine, courriels en bac à sable, 1 notaire test, aucune estampille — face à des concurrents qui affichent régulateur, SOC 2, BBB et des milliers d'avis. Notairo, sans avis tiers et avec une facture client indexée, montre que ce déficit est réel pour tout nouvel entrant québécois.

### Validation externe la plus forte
Le produit Shopify « **Frais de prise en charge de dossier — 295 $** » de Notairo, avec la phrase « les honoraires du notaire et les débours seront payables directement au notaire », est **l'ADR 0031 mise en vente** au Québec depuis décembre 2025. Le prix fixe Nota (400 $) a donc un comparable direct — et il est **35 % plus cher** que celui de Notairo.

---

**Fichiers de crawl** (HTML et texte bruts) : `/private/tmp/claude-501/-Users-tony-Github-nota/def4cf37-40d8-48e1-a3a9-c4952616de46/scratchpad/crawl/`
