# Veille concurrentielle — relevé C (3 septembre 2026)

**Périmètre.** Ce relevé complète `docs/go-to-market/concurrence.md` (1<sup>er</sup>
septembre) : il ne reprend pas Notairo, Soumissions Québec, Neolegal, Deeded,
Ownright, Bonjour-santé ni l'écosystème CNQ, sauf pour les corriger ou les
enrichir. Deux volets : **(1)** les acteurs absents du relevé précédent,
**(2)** un banc d'essai des marges (*take rate*) des plateformes qui donnent
accès à une profession réglementée, et ce que cela dit de la thèse « meilleure
marge de l'industrie ».

Méthode : recherches FR/EN (termes organiques et termes « Google Ads »), curl
des pages de prix et de conditions, rapports financiers (10-K, 6-K, communiqués),
articles de presse. Chaque chiffre est daté et sourcé ; ce qui n'a pas pu être
établi est dit tel quel.

---

## Cinq conclusions d'abord

1. **Leya et Notairo sont la même entreprise, ou presque.** Ryan Hillier est
   fondateur-PDG de Leya Technologies (Montréal, 2023) *et* de Notairo (lancé le
   9 octobre 2025). Leya (`leya.ca`) vend déjà « Deed of Sale or Refinance —
   **1 725 $ +** — *instantly book a notary online* » et se décrit comme *not a
   law firm* ; Notairo est la verticale immobilière du même opérateur. Le
   concurrent le plus proche a donc **deux vitrines, une équipe, un investisseur
   (Telegraph Hill Capital)** et un fondateur qui a déjà bâti et vendu une
   legaltech (Novalex → Delegatus, janvier 2024). C'est l'adversaire à prendre au
   sérieux, et il vend la **réservation instantanée** — la promesse la plus
   proche de « la date » de Nota.

2. **La correction à apporter à concurrence.md : l'urgence est déjà tarifée,
   mais en petits caractères.** Notairo affiche « Des frais additionnels peuvent
   s'appliquer dans certains cas particuliers (**urgence, signatures hors heures**,
   transactions complexes) ». Proof (ex-Notarize) facture les clôtures
   immobilières 45–150 $ la séance contre 25 $ le standard. Personne ne publie une
   *courbe* d'urgence ; tout le monde a un *supplément* d'urgence. La phrase
   juste n'est plus « aucun concurrent ne prix l'urgence » mais « **aucun
   concurrent n'affiche le prix de la date avant l'engagement** ».

3. **Le substitut bon marché au refinancement se referme — et c'est un vent
   arrière.** Avant la réforme de la *Loi sur le notariat*, les centres de
   traitement FCT/FNF préparaient les documents de transfert hypothécaire et le
   notaire les vérifiait pour **≈ 850 $** ; la Chambre lit désormais la loi comme
   un monopole du notaire sur toute la préparation, et le coût attendu passe à
   **≈ 1 500 $ (+75 %)**, litige en cours (Noovo, 29 août 2024 ; La Presse,
   26 août 2024). Le plancher de 2 000 $ de Nota paraît moins isolé dans un
   marché où le transfert « à 850 $ » disparaît.

4. **Le modèle « la plateforme facture le professionnel pour ses services » est
   documenté chez Deeded — et il est légal sous deux bacs à sable.** Les
   conditions de Deeded disent que Deeded « *may provide [administrative,
   clerical, technical, scheduling, software, customer service and marketing
   support] directly to the Legal Service Provider, in exchange for service fees
   from the Legal Service Provider* ». En Alberta, Deeded Inc. est par ailleurs
   **autorisée à exercer comme cabinet** sous le *Law Society of Alberta
   Innovation Sandbox*. Deux bacs à sable canadiens (Ontario A2I, Alberta) ont
   donc chacun admis une plateforme de clôture immobilière.

5. **« Meilleure marge de l'industrie » n'est pas crédible tel quel — et le
   défaut déployé le contredit.** Le taux retenu par Nota (5–15 % selon l'ADR
   0028, retiré par l'ADR 0031) se situait dans le *bas* du marché ; mais le
   prix fixe déployé (`NOTA_PRIX_CENTS` = **400 $**) représente **16,7 % du
   total client** sur un refinancement standard (2 000 $ + 400 $) et **18,2 %**
   sur un financement (1 800 $ + 400 $) — au niveau d'Upwork (18 %), au-dessus
   d'Airbnb (13,6 %), et sans avantage démontrable sur la génération de pistes
   (≈ 4–8 % effectifs). La reformulation crédible et licite est ailleurs :
   « **le notaire garde 100 % de ses honoraires** ; Nota facture au client un prix
   fixe, publié, de X $ ». Voir §3.

---

## 1. Découverte — acteurs absents du relevé du 1<sup>er</sup> septembre

### 1.1 Québec — concurrents directs ou proches

| Acteur | Domaine · pays | Ce qu'il vend | À qui | Prix affiché | Modèle | Concurrence avec Nota |
| --- | --- | --- | --- | --- | --- | --- |
| **Leya** (Leya Technologies) | leya.ca · Montréal, 2023 | Réservation *instantanée* d'avocats et de notaires ; acte de vente / refinancement ; testaments ; forfaits familiaux | Consommateurs ; « Leya for Organizations » ; « Join our Provider Network » | **Acte de vente ou refinancement 1 725 $ +** ; consult. 25/60 min 85–250 $ ; testament devant témoins 49 $ ; testament notarié 399 $ + ; séparation 999 $ + | Plateforme (« *Leya is not a law firm* ») ; « *Leya sources availability and price across vendors* » ; rémunération côté fournisseur non publiée | **Directe.** Même actes, promesse de vitesse, fondateur commun avec Notairo |
| **Notairo** (complément) | notairo.com · Montréal, lancé 2025-10-09 | Préparation en ligne de la transaction, signature en personne | Consommateurs, courtiers, prêteurs | Refi/transfert **949 $ + débours** ; acte de vente 1 099 $ + débours ; boutique Shopify : « Acte de vente » **1 795 / 1 995 / 2 225 $** ; **frais additionnels « urgence, signatures hors heures »** | Le client paie Notairo ; part du notaire inconnue ; investisseur Telegraph Hill Capital | **Directe** (déjà fiché) — l'urgence est tarifée en supplément |
| **prix.expert** (Services Professionnels **Legaluber** inc.) | prix.expert · Rive-Sud (Brossard, St-Jean) | « Forfaits » juridiques réservés en ligne, exécutés par des notaires partenaires | Consommateurs | **Refinancement taxes et débours inclus : à partir de 1 500 $** (unifamiliale, banque à charte) ; testament notarié 395 $ ; 2 testaments + 2 mandats 1 180 $ ; garantie « 50 $ si moins cher ailleurs » ; premier rendez-vous en **7–10 jours** | « **Cabinet de référencement** » : le client réserve le prix, paie le notaire au rendez-vous | **Directe sur le prix du refinancement**, nulle sur la date ; portée régionale |
| **Droit Légal** | droit.legal · Montréal, 2016 | « Plus gros cabinet juridique en ligne du Québec » ; avocats + notaires, 100 % à distance | Consommateurs | Refinancement : **ouverture de dossier 152,21 $ (175 $ taxes incl.)**, solde à la signature par visioconférence ; testaments ; incorporation 770–1 325 $ | **Entité professionnelle** (cabinet) | Directe sur le refinancement à distance ; prix total non affiché |
| **Galaxie « Soumissions »** — Soumissions Québec, Maison, Montréal, Rive-Sud, Testament, Avocat, Entreprises | soumissions*.ca | 3 soumissions gratuites en 24–48 h | Client gratuit ; le pro paie | **Le prix par piste est publié chez Soumissions Entreprises : 25 à 50 $ la demande**, vendue par lots de 50/100/500 ; réseau « 300+ partenaires, 70–75 000 soumissions depuis 2015 » ; Soumissions Avocat : 500+ avocats | Génération de pistes, même numéros de téléphone d'un site à l'autre (1 581 702-8828 / 1 514 612-3612) | Adjacente-directe : c'est le coût d'acquisition que le notaire paie déjà |
| **Habitam** (absorbe XpertSource) | habitam.ca · Québec | 3 propositions d'experts préqualifiés en 24 h (notaires, courtiers, inspecteurs…) | Client gratuit ; l'expert paie par proposition | Non publié ; « si la collaboration n'est pas rentable, nous vous remboursons » | Pistes, avec garantie de rentabilité | Adjacente-directe (pistes) |
| **JuriGo** | jurigo.ca · QC + ON | Références d'avocats ; **800+ avocats, 50 000 dossiers en 2023** | Client gratuit ; l'avocat paie | « Vous ne payez que pour les dossiers que vous acceptez » (blocs) ; promesse « 1 $ investi = 10–12 $ d'honoraires » | Pistes par dossier accepté | Adjacente (avocats) ; référence de modèle « payé au dossier » |
| **Emma** | emma.ca · Montréal | Insurtech ; « testament gratuit en 10 minutes » + pages SEO « Notaire [ville] » | Consommateurs | Gratuit (produit d'appel assurance) | Assurance ; annuaire de notaires en SEO | Adjacente ; occupe les requêtes « notaire + ville » |
| **Concilium notaire** | conciliumnotaire.ca · Québec | 2 notaires **à domicile**, rencontres virtuelles | Consommateurs | Non publié | Étude | Adjacente : vend le déplacement, ce que l'ADR 0017 tarife |
| Études à positionnement web (Réseau Notaires, Lexia « notaire pas cher Montréal », Me Lincà, montrealnotary.ca, notaire-saindon.com « évaluation dossier refinancement », KBN, Bessette) | — | Actes, signature à distance | Consommateurs | Rarement publié | Études | Concurrentes sur les mots-clés, pas sur le mécanisme |
| **NotaryPro** (page Montréal) | notarypro.ca · Canada | Notarisation en ligne par *notary public* / commissaire | Particuliers, entreprises | 38,95–45,95 $ le document ; 500 k$ d'amorçage (2022) | Prix fixe au client | **Nulle** sur l'acte notarié québécois (un *notary public* n'est pas un notaire) |

**Substitut à surveiller — les centres de traitement FCT/FNF.** Ce n'est pas une
plateforme, mais c'était le canal le moins cher du transfert hypothécaire
(≈ 850 $ avec vérification notariale). La Chambre soutient que la réforme lui
donne le monopole de la préparation ; l'IEDM et les centres contestent ; coût
anticipé ≈ 1 500 $. Prêteurs non bancaires (First National, Manuvie) touchés.
À citer en entrevue : c'est précisément le segment « transfert/refinancement »
où Nota entre.

**Ce qui n'existe pas ou n'est pas ce qu'on croit.** *Juridoc* : aucune entité
québécoise trouvée. *Legal Logik* : cabinet montréalais à prix fixes (2011),
pas une plateforme. *Avocat.ca* : injoignable, pas de plateforme. *Blocknote* et
*Notarius* : outillage côté notaire, déjà fichés.

### 1.2 Canada hors Québec — analogues à prix fixe

| Acteur | Domaine · province | Prix (avant débours et taxes) | Structure | Note |
| --- | --- | --- | --- | --- |
| **Deeded** (complément) | deeded.ca · ON, AB | ON : achat 1 199 $, vente 1 099 $ ; AB : 999 / 899 $ ; **refinancement ou transfert 999 $** ; conseil indépendant 599 $ | ON : plateforme + avocats indépendants qui **paient des frais de service à Deeded** ; AB : **cabinet autorisé sous le Innovation Sandbox** | Le modèle de revenu est enfin lisible dans les conditions |
| **Ownright** (ex-Doormat) | ownright.com · ON | Achat 1 179 $, vente 1 079 $, **refinancement 1 179 $** ; certificat d'état gratuit | Cabinet affilié « Ownright Law » ; 2<sup>e</sup> participant du programme A2I du Barreau ontarien ; 4,5 M$ d'amorçage, 6,5 M$ cumulés, 750 M$ de transactions | Entité professionnelle, aucun partage à justifier |
| **Philer** | philer.ai · ON | Clôture Toronto **1 190 $** ; à distance par défaut | Cabinet à saveur logicielle | — |
| **Axess Law** | axesslaw.com · ON | Achat 999,99 $, vente 799,99 $, **refinancement 799,99 $**, transfert de titre 649 $ | Cabinet | — |
| **LawBooth** | lawbooth.ca · ON | Achat 895–995 $, **refinancement 695 $ (prêteur A) / 895 $ (prêteur B)** | Cabinet, calculateur public | Prix plancher du marché ontarien |
| SLC Lawyer, Zinati Kay, realestatelawyers.ca | ON | ≈ 999 $ | Cabinets | Signature vidéo incluse |
| Notarize.ca, Notary Link, Downtown Notary, Notary on the Go | ON | 25–60 $ le document | *Notary public* | Adjacent |

Lecture : hors Québec, le **refinancement à distance se vend 695–1 190 $** de
frais professionnels. Le 2 000 $ de Nota est un prix québécois *et* un prix de
date ; les deux écarts se cumulent et doivent être assumés dans le discours.

### 1.3 États-Unis et Europe — notarisation à distance et plateformes de notaires

| Acteur | Pays | Prix client | Ce que garde la plateforme | Source |
| --- | --- | --- | --- | --- |
| **Proof** (ex-Notarize) | US | 25 $ la séance réseau (+10 $ sceau, +5 $ signataire, +10 $ témoin) ; clôtures immobilières **45–150 $** la séance ; ≈ 80 M$ de revenus 2023 (Sacra) | Le notaire « à la demande » reçoit **5 $** par notarisation → **≈ 80 %** retenus ; transactions apportées par le notaire : Proof déduit 10 $ + 3 $/sceau | proof.com/pricing ; support.proof.com |
| **OneNotary** | US | 25 $ | Notaire 10 $ (+3 $) → **≈ 60 %** ; 4,75 M$ levés (fév. 2025) | usanotary.net (calcul) |
| **BlueNotary** | US | 25 $ | 10 $ de plateforme → **40 %** ; appels ouverts 5–10 $ | usanotary.net |
| NotaryCam, Docusign Notary | US | 25–50 $ ; clôtures 199 $ | Non publié | — |
| **NeoNotario** | France | Gratuit (17 000 notaires, émoluments réglementés) | Abonnement étude | Pas de présence au Québec |
| **Notarity** | Autriche/UE | **144 € par notarisation** (TVA incl.), apostille 120 € | « *notarity charges its services to its partner notaries* » ; partage non publié | help.notarity.com |
| Beglaubigt.de (Openlaw), Notario.org, LawX | DE/IT | Tarifs réglementés + frais de service | 3,3 M$ / 2,5 M€ / 7,5 M€ levés (2025–2026) | Adjacent |

Lecture : les plateformes RON gardent **40 à 80 %** d'un ticket de 25 $. C'est
une profession *non* réglementée sur le partage (notary public) — la
comparaison sert à situer l'extrême, pas à imiter.

---

## 2. Banc d'essai des marges

### 2.1 Définitions

- **Take rate** : part de ce que paie le client que la plateforme conserve
  (revenu net ÷ volume brut).
- **Marge brute** : revenu net moins coût des revenus (Stripe, hébergement,
  personnel de livraison). Une place de marché en flux « pass-through » a
  presque toujours **80–90 %** de marge brute — ce n'est pas un avantage
  compétitif, c'est la forme comptable.
- **Prix par piste** : payé par le professionnel, converti ou non ; s'exprime
  en % d'un acte seulement une fois divisé par le taux de conversion.

### 2.2 Le tableau

| Plateforme | Profession | Modèle | Take rate (ou équivalent) | Source |
| --- | --- | --- | --- | --- |
| **Nota — ADR 0028 (retiré 2026-09-01)** | Notaires QC | % du total client, indexé sur la cote | **15 % de départ → 10 % à 70 → 5 % au-dessus de 90** | `docs/decisions/0028` |
| **Nota — ADR 0031 (déployé)** | Notaires QC | Prix fixe de Nota ajouté aux honoraires ; le notaire garde 100 % | **400 $ par défaut** = 16,7 % du total sur un refi 2 000 $ ; 18,2 % sur un financement 1 800 $ ; 14,3 % si l'urgence porte les honoraires à 2 400 $ | `apps/api/src/prix-nota-config.js` (`DEFAULT_PRIX_CENTS = 40000`), `infra/variables.tf` |
| **Nota — plan d'affaires §8.2** | — | 10 % côté client | Marge brute **89–91 %** ; CAC client 164 → 40 $ ; revenu net/acte 106–145 $ | `docs/business-plan.md` |
| Notairo | Notaires QC | Prix fixe au client | **Non divulgué** (part du notaire inconnue) | notairo.com |
| Leya | Notaires/avocats QC | Prix fixe au client ; réseau de fournisseurs | **Non divulgué** | leya.ca |
| Deeded (ON) | Avocats | Prix fixe au client + **frais de service facturés à l'avocat** | Non divulgué ; nature des frais énumérée (admin, technique, horaire, marketing) | deeded.ca/terms |
| Ownright | Avocats | Est le cabinet | 100 % (pas de partage) | ownright.com ; BetaKit |
| Neolegal, Droit Légal, Legal Logik | Avocats/notaires QC | Cabinets ; collaborateurs payés « un pourcentage fixe du prix payé par les consommateurs » | % non divulgué | Droit-inc (poursuite Guèvremont) |
| **Soumissions Québec / Entreprises** | Notaires et 20 secteurs QC | Par piste | **25–50 $ la demande** ; si 1 gagnant sur 3 : ≈ 75–150 $ par acte gagné = **4–8 % d'un acte de 2 000 $**, 8–15 % d'un acte de 1 000 $ | soumissionsentreprises.ca/devenir-partenaire |
| JuriGo | Avocats QC/ON | Par dossier accepté | Promesse « 1 $ → 10–12 $ d'honoraires » ⇒ **≈ 8–10 %** implicite | jurigo.ca |
| Habitam / XpertSource | Notaires, courtiers QC | Par proposition, remboursement si non rentable | Non divulgué | habitam.ca |
| Bark (Canada) | Pros locaux | Crédits par piste, « no commission » | ≈ 15–30 $ la piste | bark.com/en/ca/sellers/pricing |
| **Thumbtack** | Pros locaux US | Par piste 10–100 $ ; abonnement | **≈ 15–20 % implicite** (400 M$ de revenus 2024 sur > 2 G$ de GMV) | Fast Company ; Contrary Research |
| **Avvo Legal Services** († 2018) | Avocats US | Prix fixe au client, « marketing fee » repris à l'avocat | **149 $ → 40 $ = 27 %** ; fermé après 8 avis déontologiques d'États (partage d'honoraires) | ABA Journal ; JD Supra |
| **UpCounsel** | Avocats US | Frais sur le paiement de l'avocat | **3,5 % → 15 %** | support.upcounsel.com |
| Rocket Lawyer | Avocats US | Abonnement 39,99 $/mois ; l'avocat consent 40 % de rabais ou 125 $/h min. | **0 %** des honoraires | Daily Journal ; rocketlawyer.com |
| **LegalZoom** | Avocats US | Abonnements + transactions ; cabinets payés un forfait administratif par membre | Marge brute **67 % (T4 2024) → 71 % non-GAAP (T2 2026)** ; 681,9 M$ de revenus 2024, 64 % en abonnement | investors.legalzoom.com ; 10-K FY2024 |
| Proof / OneNotary / BlueNotary | Notary public US | Prix fixe au client, notaire payé à la pièce | **80 % / 60 % / 40 %** | §1.3 |
| **Zocdoc** | Médecins US | Frais par nouveau patient | **35–110 $ par réservation** ⇒ ≈ 15–40 % d'une première visite ; 0 sur les suivantes | zocdoc.com/provider-help |
| **Doctolib** | Médecins FR/DE | Abonnement ≈ 139 €/mois | **0 %** ; ≈ 85 % du revenu en abonnement | Contrary Research |
| Practo | Médecins Inde | Commission sur téléconsultation + SaaS | **15–25 %** (sources secondaires) | Appscrip, Medium |
| **Maple** | Médecins CA | Prix fixe au patient (69–95 $ ; **210 $ la visite au Québec**) | « *fee-per-consultation is net of platform fees* » — % non divulgué ; « modèle Uber » | getmaple.ca ; CBC |
| Dialogue | Cliniciens CA (B2B) | Emploie ses cliniciens | Marge brute **57–60 %** (T1–T2 2023) | Communiqués Dialogue |
| Bonjour-santé | Cliniques QC | 17,25 $ au patient ; 0 $ aux cliniques | 100 % de son propre service ; action collective en cours | Radio-Canada ; clinique.bonjour-sante.ca |
| Airbnb | — | Frais hôte + voyageur | **13,6 %** (11,1 G$ / 81 G$, 2024) | 10-K FY2024 |
| Booking | — | Commission | **≈ 14 %** (agency) | 10-K FY2024 |
| DoorDash | — | Commission + frais | **13,5 %** de marge nette de revenu (T4 2024) | ir.doordash.com |
| Uber | — | Commission | **≈ 27 %** blended 2024 (44,1 / 162,8 G$) ; mobilité ≈ 28–33 % | 10-K FY2024 |
| Upwork | — | 10 % fixe côté freelance + frais client | **18,0 %** (2024) | 10-K FY2024 |
| Fiverr | — | 20 % vendeur + frais acheteur | **32,3 %** (2024) | 6-K FY2024 |

### 2.3 Ce que le tableau dit

**Trois familles, pas une échelle.**

1. **Pourcentage de la transaction** — Airbnb 13,6 %, Upwork 18 %, Uber 27 %,
   Fiverr 32 %, Practo 15–25 %, UpCounsel ≤ 15 %, RON 40–80 %. Toutes hors
   professions à partage interdit, sauf UpCounsel (frais « de traitement »
   contestés en justice) et Avvo (mort).
2. **Par piste ou par dossier** — Soumissions 25–50 $, Bark, Thumbtack, JuriGo,
   Zocdoc, Habitam. Le pro paie l'*accès*, pas le résultat ; ramené à l'acte
   gagné, cela fait **4–10 %** — soit exactement la zone de l'ADR 0028.
3. **Abonnement ou prix-plateforme au client, 0 % des honoraires** — Doctolib,
   Rocket Lawyer, LegalZoom (forfait administratif), Bonjour-santé, Maple (prix
   fixe au patient), Notairo/Leya/Deeded (prix fixe au client). C'est la seule
   famille qui survit à un ordre professionnel.

**Où Nota se situe.**

- En **taux** : l'ADR 0028 (5–15 %) plaçait Nota dans le bas du marché — sous
  Upwork, au niveau d'Airbnb/DoorDash au départ, sous tout le monde au sommet.
  L'ADR 0031 déployé à **400 $ fixes** place Nota à **14–18 % du total client**
  sur les actes standard : niveau Upwork, au-dessus d'Airbnb, et il **remonte**
  quand l'acte est petit. Le prix fixe est régressif ; c'est la propriété qu'il
  faut soit assumer, soit corriger (§3).
- En **marge brute** : 89–91 % au plan d'affaires. Mais la session Checkout est
  sur le compte de Nota et Stripe prélève ≈ 2,9 % + 0,30 $ **sur le total**
  (2 400 $ → ≈ 70 $), soit ≈ 17,6 % des 400 $ de Nota : marge brute réelle
  **≈ 82 %**, avant frais Connect. Comparable à Airbnb (≈ 83 %), Fiverr (≈ 82 %),
  LegalZoom (71 %). Élevée, banale.
- Face aux **comparables directs** (Notairo, Leya, Deeded) : leur partage est
  inconnu ; toute affirmation de supériorité est **invérifiable** aujourd'hui.
- Face à la **génération de pistes** : Nota n'est pas moins cher pour le
  notaire (400 $ contre ≈ 75–150 $ par acte gagné) ; ce qui diffère, c'est que
  le coût est **contingent** (0 $ tant qu'aucun acte n'est retenu) et **connu**.

**Verdict sur « meilleure marge de l'industrie ».** Pas crédible tel quel :
(a) la marge brute élevée est structurelle à toute place de marché,
(b) le taux effectif déployé est médian, pas minimal, (c) les comparables directs
ne publient rien, et (d) au Québec la notion même de *take rate* sur des
honoraires est proscrite (art. 32.1 2° *Loi sur le notariat* ; art. 32, 33 et
29.1 du *Code de déontologie*), donc le chiffre qu'on voudrait vanter est celui
qu'on ne peut pas avoir. La leçon d'Avvo est exactement celle-là : 27 % rebaptisé
« marketing fee », huit avis déontologiques, fermeture.

---

## 3. Ce qui rendrait la thèse crédible — sans toucher aux honoraires

Les quatre murs sont connus (`docs/legal/code-deontologie-notaires-texte-officiel.md`) :
art. 32 (« ne peut partager ses honoraires avec une personne qui n'est pas
membre d'un ordre »), art. 33 (« ne peut […] verser ou recevoir tout autre
avantage »), art. 29.1 (aucune convention mettant en péril le désintéressement),
et art. 32.1 2° de la Loi (l'intermédiaire qui « obtient d'un notaire qu'il
abandonne une partie de ses honoraires », 2 500 à 125 000 $). Tout ce qui suit
reste du bon côté.

1. **Changer la phrase, pas le modèle.** La revendication licite et vérifiable
   est : « **Le notaire garde 100 % de ses honoraires. Nota facture au client un
   prix fixe et publié de X $.** » Aucun comparable qui rémunère un professionnel
   au pourcentage (Neolegal, Avvo, UpCounsel, Practo, RON) ne peut l'écrire ;
   Notairo et Leya ne l'écrivent pas. C'est *là* la « meilleure marge » — celle
   du notaire, pas celle de Nota. L'ADR 0031 la rend vraie ; il reste à
   l'afficher sur le devis, le reçu et le carnet (art. 71–72 : présentation des
   prix). Ne jamais employer « commission » (le domaine ne le contient pas ;
   garder ce mot hors du marketing aussi).

2. **Rendre le prix de Nota proportionné et non régressif — par service, jamais
   par notaire.** À 400 $ fixes, Nota pèse 18 % d'un financement de 1 800 $ et
   9 % d'un acte à 4 000 $. Une **grille fixe par service** (p. ex. 199 $
   financement, 249 $ refinancement, palier « date rapprochée » de Nota en sus)
   ramène le poids à ≈ 10–12 % sur le standard et ne dépend d'aucune cote
   (art. 29.1 respecté). Le supplément d'urgence de Nota est **le prix de Nota
   pour la garantie de date** ; il ne se confond pas avec le droit du notaire de
   tenir compte de l'urgence dans ses honoraires (art. 49 4°) — deux lignes,
   deux justifications, ce que l'ADR 0031 impose déjà.

3. **Décrire le service en une phrase vérifiable.** Le risque Bonjour-santé est
   consumériste, pas disciplinaire : « que vend la plateforme ? ». Réponse à
   tenir : *sourçage d'un notaire disponible à la date, assemblage et validation
   du dossier, séquestre du paiement, garantie de date, messagerie et dépôt de
   documents (ADR 0032), mise en relation complète (ADR 0033)*. Chaque élément
   doit exister dans le produit le jour où la phrase est publiée.

4. **Monétiser le côté notaire à sa juste valeur — pas gratuitement (art. 33),
   pas en pourcentage (art. 32).** Un abonnement d'outillage (agenda par date,
   flux webcal, boîte dossier, couche d'exceptions) est le modèle Doctolib
   (0 % de prise, 139 €/mois) et le modèle ADR 0001 réintroduit là où il est
   sûr. Deeded documente la même chose : des « frais de service » pour du
   soutien administratif, technique, d'horaire et de marketing. C'est la
   deuxième ligne de revenu qui améliore la marge sans toucher un dollar
   d'honoraires.

5. **Les frais d'annulation vont au notaire (ADR 0033) ; Nota n'en garde rien.**
   Toute part de Nota sur ce flux serait un « avantage » au sens de l'art. 33 et
   un partage au sens de l'art. 32.

6. **Ouvrir le canal prêteur/courtier comme ligne B2B, pas comme ristourne.**
   L'AMF encadre le paiement des frais de notaire par le prêteur ; Deeded et
   Ownright vivent du canal courtier (« *Refer a Deal* »). Un prix de plateforme
   facturé au prêteur ou au courtier pour le dossier (et non au notaire, et non
   proportionnel aux honoraires) baisse le prix client sans toucher aux quatre
   murs. À valider dans l'avis juridique.

7. **Demander le bac à sable, comme Deeded et Ownright l'ont fait.** Deux ordres
   canadiens ont admis une plateforme de clôture immobilière ; l'un l'a même
   autorisée comme cabinet. Le projet pilote (`docs/legal/projet-pilote-198-1.md`)
   est la bonne posture — et la seule voie par laquelle un modèle *autre* que le
   prix fixe au client pourrait un jour être testé légalement.

8. **Mesurer, puis parler.** Deux chiffres à produire dès la phase 1 avant toute
   affirmation : le **poids réel de Nota dans le total client** (prixNota ÷
   total, médiane par service et par palier) et le **coût par acte gagné** payé
   par les notaires du réseau chez Soumissions/Habitam (question d'entrevue, cf.
   concurrence.md). Sans ces deux nombres, « meilleure marge » reste une
   promesse ; avec eux, elle devient une comparaison.

---

## 4. Ce qu'il reste à établir

- Le partage **Notairo/Leya ↔ notaire** et la structure juridique du réseau
  (indépendants ? salariés ? une étude affiliée à la façon d'Ownright Law ?).
  Un notaire du réseau reste l'entrevue la plus précieuse — il y a maintenant
  deux vitrines pour le trouver.
- Le montant des **frais de service Deeded** facturés à l'avocat (par dossier ?
  mensuels ?) — une demande de démo côté courtier suffit probablement.
- Le **solde** du forfait refinancement de Droit Légal et le prix « tout inclus »
  réel de prix.expert sur un dossier type (soumission officielle).
- L'issue du **litige FCT/FNF ↔ Chambre** sur la préparation des transferts :
  il fixe le plancher de marché du refinancement pour les trois prochaines
  années.
- Le **prix par proposition** de Habitam et la conversion réelle des pistes
  Soumissions chez un notaire (entrevue).

---

## Sources

**Québec.** [Leya — real estate](https://leya.ca/real-estate) · [Leya — about](https://leya.ca/about) · [Ryan Hillier — The Org (Leya)](https://theorg.com/org/leya-ca/org-chart/ryan-hillier) · [Ryan Hillier — LinkedIn (Notairo)](https://ca.linkedin.com/in/ryan-hillier-89729411) · [Notairo — accueil](https://notairo.com/) · [Notairo — communiqué de lancement](https://notairo.com/en/blogs/presse-et-medias/notairo-lance-la-premiere-plateforme-quebecoise-pour-preparer-les-transactions-immobilieres-en-ligne) · [Notairo — PitchBook](https://pitchbook.com/profiles/company/1406308-15) · [prix.expert — refinancement](https://prix.expert/products/refinancement-taxes-incluses) · [prix.expert — fonctionnement](https://prix.expert/) · [Droit Légal — refinancement](https://droit.legal/products/ouverture-de-dossier-pour-documents-notaries-pour-refinancement-hypothecaire) · [Soumissions Entreprises — devenir partenaire (25–50 $)](https://soumissionsentreprises.ca/devenir-partenaire/) · [Soumissions Québec — notaires](https://soumissionsquebec.ca/notaires/) · [Soumissions Montréal — notaires](https://soumissionsmontreal.ca/notaires/) · [Soumissions Testament](https://soumissionstestament.ca/) · [Soumissions Avocat](https://soumissionsavocat.ca/) · [Habitam — notaire](https://habitam.ca/services/notaire) · [JuriGo — référencement](https://jurigo.ca/referencement-avocats-leads/) · [Emma — notaire Québec](https://emma.ca/notaire/quebec) · [Concilium notaire](https://www.conciliumnotaire.ca/) · [NotaryPro — prix](https://www.notarypro.ca/our-prices/) · [Noovo — frais de notaire et transferts hypothécaires](https://www.noovo.info/nouvelle/renouvellement-hypothecaire-des-frais-de-notaire-sur-le-point-de-grandement-augmenter-au-quebec.html) · [La Presse — renouvellements, tempête à l'horizon](https://www.lapresse.ca/affaires/marche-immobilier/2024-08-26/renouvellements-hypothecaires/tempete-a-l-horizon.php) · [AMF — paiement des frais de notaire par le prêteur](https://lautorite.qc.ca/professionnels/transfert-de-lencadrement-du-courtage-hypothecaire-a-lautorite-le-1er-mai-2020/paiement-des-frais-de-notaires-lies-a-la-conclusion-dun-pret-garanti-par-hypotheque-immobiliere) · [Droit-inc — Neolegal poursuivi](https://droit-inc.com/conseils-carriere/nouvelles/un-cabinet-poursuivi-plusieurs-fois-en-justice) · [Radio-Canada — action collective Bonjour-santé](https://ici.radio-canada.ca/nouvelle/1125306/action-recours-collective-deposee-contre-bonjour-sante-clinique-docteur-rendezvous)

**Canada.** [Deeded — pricing](https://www.deeded.ca/pricing) · [Deeded — terms (frais de service ; Alberta sandbox)](https://www.deeded.ca/terms) · [Ownright — pricing](https://ownright.com/pricing) · [Ownright — A2I](https://ownright.com/blog/company-news/announcing-our-participation-in-the-law-societys-access-to-innovation) · [BetaKit — Ownright 4,5 M$](https://betakit.com/doormat-becomes-ownright-closes-4-5-million-to-help-more-ontarians-seal-real-estate-deals/) · [Philer — Toronto](https://philer.ai/real-estate-lawyer/toronto/) · [Axess Law — pricing](https://www.axesslaw.com/pricing/) · [LawBooth — calculateur](https://www.lawbooth.ca/legal-fee-calculator) · [Maple — pricing Québec](https://www.getmaple.ca/for-you-family/pricing/) · [Maple — providers](https://www.getmaple.ca/become-a-provider/) · [CBC — Maple, « Uber model »](https://www.cbc.ca/news/health/virtual-medical-consults-1.4200397) · [Dialogue — T2 2023](https://investors.dialogue.co/English/news/news-details/2023/Dialogue-Health-Technologies-Reports-Second-Quarter-2023-Results/default.aspx) · [Bark Canada — pricing](https://www.bark.com/en/ca/sellers/pricing/)

**États-Unis / Europe.** [Proof — pricing](https://www.proof.com/pricing) · [Proof — pay structure on-demand notaries](https://support.proof.com/hc/en-us/articles/360057055154-Pay-Structure-and-Payout-Guide-for-On-Demand-Notaries) · [Proof — notary-sourced fees](https://support.proof.com/hc/en-us/articles/19239738708375-Notary-Sourced-Transaction-Pricing-Notary-Payment) · [Sacra — Notarize](https://sacra.com/c/notarize/) · [USA Notary — OneNotary vs BlueNotary](https://www.usanotary.net/for-notaries/onenotary-vs-bluenotary) · [UpCounsel — how it gets paid](https://support.upcounsel.com/how-does-upcounsel-get-paid) · [ABA Journal — avis NY sur Avvo](https://www.abajournal.com/news/article/new_york_ethics_opinion_lawyers_avvo) · [JD Supra — Avvo ferme](https://www.jdsupra.com/legalnews/avvo-shuts-down-its-legal-services-52787/) · [Daily Journal — Rocket Lawyer On Call](https://www.dailyjournal.com/articles/270558-rocket-lawyers-on-call) · [LegalZoom — T4 2024](https://investors.legalzoom.com/news-releases/news-release-details/legalzoom-reports-fourth-quarter-and-full-year-2024-financial) · [LegalZoom — T2 2026](https://investors.legalzoom.com/news-releases/news-release-details/legalzoom-reports-second-quarter-2026-financial-results) · [Zocdoc — pricing & billing](https://www.zocdoc.com/provider-help/en/articles/10859404-understanding-zocdoc-pricing-and-billing) · [Contrary — Doctolib](https://research.contrary.com/company/doctolib) · [Contrary — Thumbtack](https://research.contrary.com/company/thumbtack) · [Fast Company — Thumbtack 400 M$](https://www.fastcompany.com/91311830/home-services-company-thumbtack-is-thriving-even-as-the-real-estate-market-stays-slow) · [Airbnb — 10-K 2024](https://www.sec.gov/Archives/edgar/data/1559720/000155972025000010/abnb-20241231.htm) · [Uber — 10-K 2024](https://www.sec.gov/Archives/edgar/data/1543151/000154315125000008/uber-20241231.htm) · [Upwork — 10-K 2024](https://www.sec.gov/Archives/edgar/data/1627475/000162747525000011/upwk-20241231.htm) · [Fiverr — 6-K 2024](https://www.sec.gov/Archives/edgar/data/1762301/000117891324000681/exhibit_99-1.htm) · [DoorDash — T4 2024](https://ir.doordash.com/news/news-details/2025/DoorDash-Releases-Fourth-Quarter-and-Full-Year-2024-Financial-Results/default.aspx) · [Booking — 10-K 2024](https://www.sec.gov/Archives/edgar/data/1075531/000107553125000010/bkng-20241231.htm) · [NeoNotario](https://www.neonotario.com/) · [Notarity — prix](https://help.notarity.com/pricing) · [Openlaw / Beglaubigt.de — amorçage](https://tech.eu/2026/04/16/yc-backed-openlaw-closes-33m-seed-to-digitise-europes-notary-nightmare/)

**Dépôt.** `docs/decisions/0028-la-cote-sur-100-decide-le-partage.md` · `docs/decisions/0031-le-prix-de-nota-est-celui-de-nota.md` · `docs/business-plan.md` §8 et §12.2 · `apps/api/src/prix-nota-config.js` · `apps/api/src/billing.js` · `infra/variables.tf` · `docs/legal/code-deontologie-notaires-texte-officiel.md` · `docs/legal/projet-pilote-198-1.md`
