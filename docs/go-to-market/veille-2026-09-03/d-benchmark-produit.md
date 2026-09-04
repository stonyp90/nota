# Nota — benchmark produit (D) : sommes-nous les meilleurs, fonction par fonction ?

Date : 2026-09-03 · Périmètre : accès en ligne à un notaire du Québec pour un acte de financement / refinancement.
Méthode : inventaire du produit **réellement livré** (code du dépôt, pas les ADR ni le marketing), puis capture directe (`curl`, WebSearch, WebFetch) de dix références — quatre concurrents directs ou adjacents au Québec/Canada, six étalons internationaux du « réserver un professionnel réglementé en ligne ». Matrice, score, puis carnet « pour être n° 1 ».

Réserve importante : plusieurs ✅ de Nota sont **livrés dans le code mais pas vivants en production** (aucune identité de domaine SES — l'accès production, lui, est accordé —, Stripe vide, un seul notaire de test — voir mémoire « Config prod incomplète »). Le benchmark compare le produit tel que codé ; le plan PMF 30 jours reste le préalable.

> **Corrigé le 4 septembre 2026.** Deux lignes de cet inventaire décrivaient un
> modèle retiré la veille :
>
> - le **prix de Nota** est une **grille par service** depuis l'ADR 0034 —
>   199 $ financement, 249 $ refinancement, plus une garantie de date de 0 à
>   300 $ — et non plus un prix unique. Le devis du client compte donc
>   **quatre** lignes, pas trois ;
> - le **taux gagné de 85 % → 95 %** affiché à la console notaire décrivait le
>   partage de l'ADR 0028, **retiré par l'ADR 0031** : il n'y a plus de partage
>   du tout, le notaire garde 100 % de ses honoraires. La cote /100 survit comme
>   outil **interne** ; elle ne décide plus d'aucune part et ne s'affiche jamais
>   au client sur un notaire nommé (ADR 0030).
>
> Le score (Nota 36/58, premier de sa catégorie) ne dépend d'aucun de ces deux
> chiffres et reste valide.

---

## 1. Inventaire du produit Nota livré

### 1.1 Parcours client (`apps/web/public/index.html`, `app.js`, `packages/domain/index.js`, `openapi.yaml`)

| Étape | Ce qui est livré | Détail vérifié dans le code |
| --- | --- | --- |
| Arrivée | Film d'intro à deux portes (client / notaire), sautable ; trois portes plates (Carnet · Espace notaire · Partenaires) ; FR/EN et thème dans l'en-tête | `#intro-gate`, `.nav-tabs`, `#lang-toggle` |
| Carnet public | Calendrier par mois, chaque jour montre les offres (montant, service, secteur) ; filtres service / statut / montant min / tri ; « pulse » du mois ; sur téléphone le calendrier est centré (ADR 0022) | `#cal-grid`, `#filters`, `#carnet-pulse` |
| Réserver une date | **Un seul dialogue** `#day-dialog` : date → acte (chips : Refinancement 2 000 $ · Financement 1 800 $) → « Ce que d'autres offrent ce jour-là » + « Offrir autant » → critères → montant → secteur postal → identité → publier | `openDay`, `renderOfferCriteria`, `onAmountChange` |
| Critères de prix | Requis : montant du prêt (tranches), approbation bancaire, succession (refi) / contexte (financement), **prêteur** (17 institutions + « Autre » nommé), **déplacement** (6 bandes : à l'étude ≤ 50/25/10 km, chez moi ≤ 25/50 km, urgence 100 % en ligne +400 $). Optionnels : co-emprunteur, assurance habitation, certificat de localisation | `SERVICES[].pricing.criteria`, `LENDERS`, `DEPLACEMENTS` |
| Prix avant engagement | Paliers d'urgence dérivés de la date (standard 15 j+ ×1 → extrême J0 ≈ ×4), curseur borné [plancher, 5×], jauge « chances », **devis décomposé** : Honoraires du notaire · Service Nota (199 / 249 $) · Garantie de date (0 à 300 $) · Autorisé sur votre carte *(corrigé le 4 septembre : trois lignes avant l'ADR 0034)* | `TIERS`, `PREMIUM_CAP`, `renderDevis`, `prixNota` |
| Identité & vie privée | Nom + courriel requis, téléphone optionnel ; **anonyme par défaut** (« Client · G1R ») ; compte sans mot de passe optionnel ; code de référence ; ligne de consentement Loi 25 | `#o-anon`, `#o-account`, `#o-parrain`, `#consent-line` |
| Paiement | `POST /bids` renvoie `checkoutUrl` → **Stripe Checkout hébergé, pré-autorisation à capture manuelle** ; capture partielle à la signature ; le client paie la plateforme, Nota transfère le net au notaire (Connect) | `authorizeOffer`, `captureAndTransfer` |
| Après publication | Panneau de succès : ICS / Google Agenda / Outlook ; « Préparer mon dossier » → checklist de documents par acte avec aide, barre de progression, « Réutiliser », **fichiers jamais envoyés avant la mise en relation** | `#offer-success`, `renderDossier`, `dossierWire` |
| Attente | Rappels courriel J-7 / J-3 / J-1 / J0 + « dossier incomplet » — **uniquement pour une offre ouverte** ; un notaire peut **proposer un prix plus haut** (client accepte/refuse) ou **demander des documents** | `REMINDER_KINDS`, `/client/propositions/*`, `/client/dossier` |
| Retenue | Courriel « offre retenue » avec lien vers l'acte ; carte du notaire : nom, étude, téléphone, adresse, badge CNQ, nombre d'actes — **jamais de cote ni d'avis** (ADR 0030) ; **fil de messagerie par acte** avec **documents** (dépôt S3 pré-signé, ADR 0032) ; liens agenda | `notaireCard`, `chatThread`, `documentsBlock` |
| Annulation | Dialogue avec frais affichés avant confirmation : ouverte = gratuit ; retenue ≥ 15 j gratuit, 4–14 j 10 %, ≤ 3 j 30 %, **versés au notaire** ; acte réglé inannulable ; le notaire peut se désister sans frais (l'offre revient au carnet) | `#cancel-dialog`, `/client/bid/cancel`, `/notary/bids/release` |
| Signature | **Hors Nota** (à l'étude, chez le client, ou 100 % en ligne par les outils CNQ du notaire) ; le notaire « Marque complété » avec la valeur confirmée (bornes 0,25×–3×) → capture + transfert | `/notary/acts/complete` |
| Après signature | Courriel « acte payé » + invitation à évaluer ; note /5 + commentaire ; alimente la cote du notaire (jamais publiée) | `/client/evaluation`, `evaluationInvite` |
| Compte | Cloche compte + notifications (locales), profil (mes offres, documents, préférences de notifications, carte parrainage), pages Confidentialité / Conditions / Charte des droits | `#notif-panel`, `renderProfil` |

Nombre d'écrans/décisions jusqu'à l'offre publiée : 1 dialogue, ~8 décisions (date, acte, 5 critères requis, montant, secteur, identité) + Checkout Stripe. Le film promet « publiée en 2 minutes ». Le Playwright `client-booking.spec.js` couvre le parcours.

### 1.2 Parcours notaire

| Étape | Ce qui est livré |
| --- | --- |
| Découverte | Aperçu « Ouvertes en ce moment » sans connexion, abonnement webcal du carnet, section conformité (articles de loi) |
| Entrée | Courriel professionnel → lien magique ; première visite → inscription gratuite (courriel + code de parrain) → **approbation manuelle par Nota** (`approuveLe`, après vérification au Tableau de l'Ordre) → console |
| Profil | Bannière « profil incomplet » ; nom, étude, téléphone, adresse, lien fiche CNQ, rayon (0/25/50 km), secteur postal, opt-in urgences en ligne — **requis pour retenir** (`profil_incomplet`) |
| Fil des demandes | Filtré par portée réelle (`notaryCanServe`, distance FSA→centroïdes), vues compacte/détail, bandeau par jour, cartes : palier, prêteur, déplacement, complexité, préparation du dossier, distance ≈ km |
| Actions | **Retenir** (feuille qui expose montant, part Nota, déplacement, prêteur, pièces manquantes, barème d'annulation) · **Proposer un prix** · **Demander des documents** · Refuser |
| Alertes | Rythme (instantané / quotidien), urgentes seulement, prêteurs acceptés ; digest quotidien `newMatchingBids` |
| Dossiers retenus | Bloc client (nom, courriel, tél.), dossier, messagerie + documents, désistement, « Marquer complété » (confirmation armée) |
| Argent | Tuiles de revenus, **cote /100 en quatre axes** *(outil interne ; elle ne décide plus d'aucun partage — ADR 0031 — et ne s'affiche jamais au client sur un notaire nommé — ADR 0030 ; le « taux gagné 85 % → 95 % » décrivait l'ADR 0028, retiré)*, relevé des actes (`/notary/acts`), registre des évaluations, Stripe Connect Express (« Connecter mon compte de paiement ») |
| Agenda | Flux webcal hydraté (montant, déplacement, prêteur, client), ICS par acte, bilingue |

### 1.3 Transversal

- **Langues** : FR canonique + EN par `i18n.js` (traduction DOM, règles monétaires), courriels et flux bilingues, deux manifestes.
- **Mobile** : responsive, **PWA installable** (manifest, `sw.js` coquille hors ligne, icônes Apple) ; pas d'app native, pas de push.
- **Notifications** : ~40 gabarits courriel bilingues, sujets modifiables et interrupteur par l'admin (ADR 0018), désabonnement LCAP RFC 8058 ; **aucun SMS, aucun push**.
- **Support** : widget de clavardage en direct (réponse de l'opérateur par lien courriel, jeton 90 j, 20 msg/10 min), formulaire « Nous joindre » (« normalement le jour même »), `info@` / `confidentialite@` ; **pas de téléphone, pas d'heures affichées**.
- **Parrainage** : code partenaire vérifié par courriel, lien `?ref=`, 50 $ (client retenu) / 250 $ (premier acte d'un notaire), registre write-once.
- **Admin** : aperçu + entonnoir, courriels, campagnes, accès (RBAC), prix, annulation, registre des notaires (approbation), audit.
- **Conformité** : Loi 25 (ca-central-1, anonymat par défaut, suppression sur demande), déontologie (aucune cote publiée, commission hors domaine), `truthful-claims.test.mjs`.
- **Ce que Nota n'a pas** : disponibilité réelle des notaires, confirmation immédiate, vérification d'identité, signature électronique, jalons de l'acte après la rétention, avis publiés, SMS/push, téléphone/heures, garantie énoncée, débours dans le devis, rappels sur l'acte retenu, tableau de bord courtier.

---

## 2. Fiches des références

### 2.1 Notairo (notairo.com — Québec, vitrine Shopify)
- **Étapes** : 3 affichées (soumission gratuite instantanée → dossier en ligne → rendez-vous de signature en personne) ; l'article « étape par étape » en décrit 5. « Découvrez immédiatement si un notaire est disponible pour votre type de transaction dans votre région ».
- **Informations demandées** : transaction, date prévue, type de propriété, prêt ; puis documents (offre d'achat, info bancaire, pièces d'identité), courtiers, prêteur.
- **Prix** : **fixe et public** — refinancement / transfert **949 $** (+ débours + taxes), acte de vente dès 1 099 $ + débours, conseils juridiques 299 $ ; produits Shopify 1 795 / 1 995 / 2 225 $ (paiement en ligne d'avance) ; « frais additionnels : urgence, signatures hors heures, dossiers complexes ».
- **Disponibilité** : vérification « un notaire est-il disponible », notaire assigné près de chez vous, créneau choisi ensuite. **Aucun choix du notaire.**
- **Documents** : portail sécurisé. **Signature** : en personne (leur lecture de la loi). **Suivi** : « suivi en temps réel ». **Messagerie** : non visible. **Avis** : 3 témoignages. **App** : non. **Garantie** : aucune. **Support** : formulaire, infolettre. **Onboarding notaire** : pas de libre-service. Bilingue. Programme « Référer ». Urgence : « priorisée selon la date ».

### 2.2 Leya (leya.ca — Québec, place de marché juridique)
- Acte de vente **1 725 $+**, refinancement « prix selon votre situation » → demande de devis ; consultations 85–250 $ **réservables instantanément sur la disponibilité en temps réel des fournisseurs** ; « taux garantis et réponse rapide » ; rappels ; clavardage ; bilingue ; compte gratuit ; avis 4,5 en moyenne ; **réseau de fournisseurs en libre-service**. N'est pas un cabinet.

### 2.3 Deeded (deeded.ca — Ontario/Alberta/C.-B., pas au Québec)
- **4 étapes** : devis en ligne (« en quelques minutes ») → intégration avec **vérification d'identité** → suivi sur tableau de bord (« pizza tracker ») → **rencontre de signature en visio** 2–3 jours avant la clôture. Refinancement **dès 999 $** + débours + taxes ; 5–7 jours ouvrables typiques.
- Équipe dédiée assignée en minutes ; accès illimité à l'avocat ; **téléphone / courriel / texto** ; Google 5,0 ; **« Refer a deal » pour courtiers** (30 s) avec visibilité du courtier sur les dossiers ; pas d'app ; pas de garantie énoncée ; anglais seulement.

### 2.4 Ownright (ownright.com — Ontario/Alberta/C.-B.)
- Refinancement **1 179 $ fixe** (+ TVH + débours ; aucuns frais d'administration) ; étapes : partager l'info et clavarder → suivre les jalons → rencontrer l'avocat et **signer à distance** → notifications en temps réel.
- **Support illimité par clavardage / courriel / visio, « après les heures de bureau »** ; **1 500+ avis 5 étoiles** ; vérification d'identité dans le portail ; conseille 30 jours d'avance ; réseau partenaires ; procédure de plainte ; programme Access to Innovation du Barreau de l'Ontario.

### 2.5 Soumissions Québec (génération de prospects)
- Un formulaire (~15 champs : identité, tél., code postal, ville, date en tranches, service, prêteur, type de propriété, distance, maturité, ventes croisées) → **3 soumissions par téléphone/courriel en 24–48 h** ; gratuit ; 15 000+ demandes/an ; téléphone affiché ; **aucun prix, aucune réservation, aucun suivi, aucune app** ; le notaire paie pour être partenaire.

### 2.6 Zocdoc (étalon « réserver un professionnel »)
- Recherche (spécialité, lieu, assurance) → profil avec **avis vérifiés** (seulement après rendez-vous honoré) → **créneau en temps réel synchronisé dans les deux sens avec l'agenda du cabinet** → réservation instantanée écrite dans son calendrier ; ~⅓ des rendez-vous pris en < 48 h ; rappels SMS + courriel ; formulaires d'admission avant la visite ; app iOS/Android, re-réservation en secondes ; politique d'annulation par fournisseur ; classement par disponibilité réservable.

### 2.7 Maple (getmaple.ca — étalon canadien, bilingue)
- 3 étapes (décrire → connecté en minutes → traitement), **24/7**, texte / audio / vidéo ; Québec **210 $ la visite** ou 95 $/mois famille (médecins QC 6 h–23 h) ; app 4,8 (46 000 avis), Trustpilot 4,7 ; inscription gratuite ; notes de visite et ordonnances conservées ; livraison gratuite ; centre d'aide.

### 2.8 Rocket Lawyer
- Documents + **RocketSign** (signature électronique) ; « Ask an attorney » réponse écrite **sous 1 jour ouvrable** ; consultation en direct ; abonnements 149–349 $/an, essai 7 jours ; **téléphone / clavardage / courriel lun–ven 6 h–18 h PT** ; apps mobiles ; remboursement limité aux problèmes de facturation ; rappels juridiques.

### 2.9 LegalZoom
- Honoraires fixes ; réseau d'avocats ; **garantie de remboursement 60 jours** ; téléphone ; signature électronique ; page « Order status » ; 3,5 M+ documents successoraux.

### 2.10 Proof / Notarize (étalon « notaire en ligne », États-Unis)
- Réseau de notaires **24/7, attente < 1 s** ; **25 $** par notarisation (+10 $ sceau, +signataire) ; **vérification d'identité** (analyse du document + KBA + biométrie) ; témoins à la demande ; journal d'audit ; gabarits ; EasyLinks/QR ; marque blanche ; API ; Pro 0 $/mois, Pro+ 199 $/mois ; SOC 2, IAL2. Non valable pour un acte en minute au Québec.

---

## 3. Matrice

Légende : ✅ = livré et bon · ⚠️ = partiel ou friction · ❌ = absent · (n/a noté ⚠️ quand la capacité ne s'applique pas au modèle).
Colonnes : **Nota** · Notairo · Leya · Deeded · Ownright · SoumQc · Zocdoc · Maple · Rocket · LZ · Proof.

| # | Capacité | Nota | Notairo | Leya | Deeded | Ownright | SoumQc | Zocdoc | Maple | Rocket | LZ | Proof |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Prix visible avant engagement | ✅ devis 3 lignes | ✅ 949 $ fixe | ⚠️ refi sur devis | ✅ dès 999 $ | ✅ 1 179 $ fixe | ❌ devis 24–48 h | ⚠️ assurance, pas prix | ✅ 210 $ | ✅ grille | ✅ fixe | ✅ 25 $ |
| 2 | Devis instantané, sans attendre | ✅ calculé en direct | ✅ soumission instantanée | ⚠️ « réponse rapide » | ✅ en minutes | ✅ fixe | ❌ rappel humain | ⚠️ n/a | ✅ | ✅ | ✅ | ✅ |
| 3 | Décomposition honoraires / plateforme / **débours** | ⚠️ débours absents | ⚠️ « + débours » | ❌ | ⚠️ « + disbursements » | ✅ tiers seulement | ❌ | ⚠️ n/a | ⚠️ n/a | ⚠️ | ⚠️ | ⚠️ |
| 4 | Étapes jusqu'à la réservation | ⚠️ 1 dialogue, ~8 décisions + Stripe | ⚠️ 3–5 étapes | ⚠️ consult instant, refi devis | ⚠️ 4 étapes | ⚠️ 4 étapes | ❌ 15 champs puis téléphone | ✅ 3 clics | ✅ 3 étapes | ⚠️ | ⚠️ | ✅ upload → connect |
| 5 | Date de signature choisie dès le départ | ✅ le calendrier est le produit | ⚠️ date demandée, créneau après | ⚠️ | ⚠️ signature 2–3 j avant | ⚠️ | ❌ tranches | ✅ | ✅ maintenant | ⚠️ | ❌ | ✅ maintenant |
| 6 | Disponibilité réelle des pros en temps réel | ❌ implicite, aucune | ⚠️ « un notaire est-il dispo » | ✅ temps réel | ⚠️ équipe en minutes | ⚠️ | ❌ | ✅ sync agenda 2 sens | ✅ minutes | ⚠️ | ⚠️ | ✅ < 1 s |
| 7 | Confirmation immédiate (vs attente d'acceptation) | ❌ attend qu'un notaire retienne | ⚠️ assigné après soumission | ⚠️ instant sauf refi | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Inscription sans friction | ✅ sans mot de passe, sans compte | ⚠️ compte Shopify | ⚠️ compte gratuit | ⚠️ | ⚠️ | ✅ aucun compte | ⚠️ | ⚠️ | ⚠️ essai | ⚠️ | ⚠️ |
| 9 | Téléversement sécurisé de documents | ✅ après mise en relation | ✅ portail | ⚠️ | ✅ | ✅ portail | ❌ | ⚠️ admission | ✅ | ✅ | ✅ | ✅ |
| 10 | Checklist de documents guidée par acte | ✅ aide, progression, réutiliser | ⚠️ guide + portail | ❌ | ✅ liste refi | ✅ tâches | ❌ | ⚠️ | ⚠️ n/a | ❌ | ⚠️ | ⚠️ |
| 11 | Vérification d'identité en ligne | ❌ collecte, ne vérifie pas | ❌ au rendez-vous | ❌ | ✅ à l'intégration | ✅ portail | ❌ | ❌ | ⚠️ carte santé | ❌ | ❌ | ✅ doc + KBA + bio |
| 12 | Signature à distance / électronique | ⚠️ « urgence en ligne » hors produit | ❌ en personne | ❌ | ✅ visio | ✅ à distance | ❌ | ⚠️ télésanté | ✅ vidéo | ✅ RocketSign | ✅ eSign | ✅ RON |
| 13 | Jalons de l'acte (tracker) | ⚠️ statuts offre, pas de jalons | ✅ suivi temps réel | ❌ | ✅ pizza tracker | ✅ jalons + notifs | ❌ | ⚠️ visites à venir | ⚠️ historique | ⚠️ | ✅ order status | ✅ audit |
| 14 | Messagerie in-app avec le professionnel | ✅ fil par acte + docs | ❌ non visible | ⚠️ chat support | ⚠️ tél/courriel/texto | ✅ chat/courriel/visio | ❌ | ⚠️ | ✅ texte/vidéo | ✅ Ask | ⚠️ | ⚠️ |
| 15 | Notifications multi-canal (courriel/SMS/push) | ⚠️ courriel seul | ⚠️ courriel | ⚠️ rappels | ✅ + texto | ✅ temps réel | ❌ | ✅ SMS+push | ✅ push | ⚠️ | ⚠️ | ⚠️ |
| 16 | Rappels avant la date | ⚠️ J-7/3/1/0 **offres ouvertes seulement** | ⚠️ RDV | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ |
| 17 | Avis vérifiés publiés | ❌ collectés, jamais publiés (art. 70) | ⚠️ 3 témoignages | ⚠️ 4,5 moy. | ✅ Google 5,0 | ✅ 1 500+ | ❌ | ✅ vérifiés | ✅ 46 000 | ✅ | ✅ | ⚠️ |
| 18 | Fiche du professionnel (identité, ordre, expérience) | ⚠️ faits, **après rétention** | ⚠️ notaire proposé | ✅ parcourir | ⚠️ équipe assignée | ⚠️ | ❌ | ✅ profil complet | ✅ | ✅ | ✅ annuaire | ❌ |
| 19 | Choix du professionnel par le client | ❌ le notaire choisit | ❌ assigné | ✅ | ❌ assigné | ❌ | ⚠️ 3 devis | ✅ | ⚠️ prochain dispo | ⚠️ | ✅ | ❌ |
| 20 | App mobile / PWA | ⚠️ PWA, pas de push | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ iOS/Android | ✅ 4,8 | ✅ | ⚠️ | ⚠️ |
| 21 | Bilingue FR/EN | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ FR | ❌ | ✅ | ⚠️ site FR séparé | ❌ | ❌ |
| 22 | Garantie / remboursement énoncés | ⚠️ hold libéré, rien d'énoncé | ❌ | ⚠️ « taux garantis » | ❌ | ⚠️ plaintes | ⚠️ n/a | ❌ | ❌ | ⚠️ limité | ✅ 60 jours | ❌ |
| 23 | Annulation : barème clair des deux côtés | ✅ 3 paliers, avant confirmation | ❌ | ❌ | ❌ | ❌ | ⚠️ n/a | ⚠️ par fournisseur | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 24 | Support : canaux + heures affichées | ⚠️ chat/courriel, ni tél. ni heures | ⚠️ formulaire | ⚠️ chat | ✅ tél/courriel/texto | ✅ « après le travail » | ✅ téléphone | ⚠️ centre d'aide | ✅ 24/7 | ✅ 6 h–18 h PT | ✅ tél. | ⚠️ |
| 25 | Paiement en ligne et moment du paiement | ⚠️ payé à la signature, **hold 7 j fragile** | ✅ d'avance (Shopify) | ⚠️ | ⚠️ fiducie | ⚠️ | ❌ | ⚠️ au cabinet | ✅ | ✅ | ✅ | ✅ |
| 26 | Canal courtiers / parrainage | ✅ codes 50 $/250 $ | ⚠️ « Référer » | ❌ | ✅ Refer a deal + visibilité | ✅ réseau | ⚠️ | ❌ | ⚠️ employeurs | ⚠️ | ⚠️ | ⚠️ |
| 27 | Onboarding professionnel | ⚠️ approbation manuelle, profil 6 champs, Connect | ❌ pas de libre-service | ✅ libre-service | ❌ interne | ❌ cabinet | ⚠️ payant | ⚠️ contrat + intégration | ⚠️ | ⚠️ | ⚠️ | ✅ libre-service |
| 28 | Urgence / même jour | ✅ paliers jusqu'à J0 + en ligne | ⚠️ priorisé, frais | ⚠️ « demain » | ⚠️ anecdotique | ❌ 30 j conseillés | ❌ | ✅ ⅓ < 48 h | ✅ minutes | ⚠️ 1 j ouvrable | ❌ | ✅ |
| 29 | Sync agenda (ICS / webcal) | ✅ client + notaire | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ |

### Score (✅ = 2, ⚠️ = 1, ❌ = 0 ; maximum 58)

| Rang | Produit | Score | Lecture |
| --- | --- | --- | --- |
| 1 | Maple | 44 | 24/7, connecté en minutes, app 4,8, bilingue |
| 2 | Rocket Lawyer | 38 | e-signature, support 3 canaux avec heures |
| 3 | Ownright | 37 | jalons + notifs, support illimité, 1 500 avis |
| 3 | Proof | 37 | attente < 1 s, identité vérifiée, audit |
| 5 | **Nota** | **36** | prix avant engagement, date choisie, messagerie + documents, annulation claire, agenda, bilingue |
| 5 | LegalZoom | 36 | garantie 60 j, statut de commande |
| 7 | Deeded | 35 | tracker, visio, courtiers |
| 7 | Zocdoc | 35 | disponibilité temps réel, avis vérifiés |
| 9 | Notairo | 26 | prix fixe public, suivi, mais assigné et sans messagerie |
| 9 | Leya | 26 | dispo temps réel, choix du pro, mais refi sur devis |
| 11 | Soumissions Québec | 10 | formulaire → téléphone |

**Dans sa catégorie (Québec, accès en ligne à un notaire pour un acte de financement), Nota est déjà premier — 36 contre 26 pour Notairo et Leya.** Nota gagne sur 9 lignes que personne au Québec n'a : devis en trois lignes, date choisie, checklist guidée, messagerie + documents, barème d'annulation exposé aux deux parties, paliers d'urgence jusqu'à J0, agenda synchronisé, parrainage à deux voies, entrée sans mot de passe.

**Mais Nota n'est pas « sans ambiguïté au-dessus » :** les clôtureurs ontariens (Ownright, Deeded) le battent sur cinq lignes structurantes — vérification d'identité, signature à distance, jalons de l'acte, avis publiés, support multicanal avec heures — et les étalons (Zocdoc, Maple, Proof) le battent sur la ligne la plus lourde en conversion : **disponibilité réelle + confirmation immédiate**. Le modèle inversé de Nota (le client publie, le notaire retient) crée une attente sans promesse, là où tous les étalons confirment en secondes ou en minutes.

---

## 4. Carnet « pour être n° 1 »

Classement par impact (1–5, conversion + rétention) ÷ effort (S = 1, M = 2, L = 3). Chaque ligne : où Nota est battu, la spécification en une ligne, l'estimation.

| Rang | Ratio | Capacité (battu par) | Spécification en une ligne | Taille |
| --- | --- | --- | --- | --- |
| 1 | 4,0 | **Rappels + jalons de l'acte retenu** (Deeded, Ownright, Zocdoc) | Étendre `remindersDue` aux offres **retenues** (J-3/J-1/J0 aux deux parties) et ajouter un tracker à 5 jalons dans la bande de l'offre et la carte notaire : Retenue → Documents fournis → Rendez-vous confirmé → Signé → Réglé ; chaque jalon émet un courriel existant. Aujourd'hui `REMINDER_KINDS` exclut explicitement une offre retenue. | S |
| 2 | 4,0 | **Preuve sociale conforme à l'art. 70** (Ownright 1 500 avis, Deeded 5,0) | Afficher des **faits agrégés sur Nota, jamais sur un notaire nommé** : actes signés via Nota, délai médian de rétention par palier, notaires actifs, note Google/Trustpilot **de la plateforme** ; alimentés par `/admin/metrics/overview`, gardés par `truthful-claims.test.mjs`. | S |
| 3 | 4,0 | **Délai d'appariement visible** (Zocdoc, Maple, Proof) | Remplacer la phrase statique `#day-chance` par la mesure : « Ce mois-ci, les offres standard sont retenues en médiane en N h » par palier (calcul dans `stats.js` à partir de `retenueAt − createdAt`) ; afficher aussi « N notaires couvrent G1R » (profils avec rayon/secteur). | S |
| 4 | 3,0 | **Push web** (Zocdoc, Maple) | Le `sw.js` existe : ajouter Web Push (VAPID) pour « offre retenue », « message du notaire », J-1 ; port `notifications` déjà en place, nouvel adaptateur push à côté de SES. | S/M |
| 5 | 3,0 | **SMS aux moments critiques** (Deeded, Ownright, Zocdoc) | Nouveau port `sms` (SNS ou Twilio) branché sur trois `kind` : `offerRetained`, `messageDuNotaire`, `j1` ; opt-in au téléphone déjà collecté (`#o-telephone`). | S |
| 6 | 3,0 | **Débours dans le devis** (Ownright « third-party only ») | Ajouter au domaine une ligne « Débours estimés (registre foncier, copies) » par service, affichée en 4ᵉ ligne du devis et dans la feuille Retenir, pour que « Autorisé sur votre carte » soit vraiment tout compris ; battre Notairo/Deeded qui écrivent « + débours » sans chiffre. | S |
| 7 | 3,0 | **Support : heures + téléphone/texto** (Ownright, Deeded, Rocket, LZ) | Afficher des heures et un délai (« lun–ven 8 h–18 h, réponse < 2 h ») sur le widget et le formulaire ; ajouter un numéro (renvoi) et un texto ; valeurs en config, pas en dur. | S |
| 8 | 3,0 | **Garantie énoncée** (LegalZoom 60 j) | Écrire ce qui est déjà vrai — « aucun notaire ne retient : vous ne payez rien, la carte est libérée » — et ajouter « service Nota remboursé » (la part Nota seulement, jamais les honoraires) après la signature sur demande ; chemin de remboursement partiel via Stripe. | S |
| 9 | 3,0 | **Onboarding notaire < 10 min** (Leya, Proof libre-service) | Ouvrir le fil en lecture seule dès l'inscription, valider automatiquement le lien CNQ (fetch + nom), reporter Stripe Connect au premier « Retenir », afficher « activation médiane : N h » ; l'approbation `approuveLe` reste, mais n'aveugle plus. | S |
| 10 | 2,7 | **Disponibilité déclarée du notaire** (Zocdoc, Leya) | Premier pas sans OAuth : le notaire coche ses **jours bloqués** dans la console ; le carnet montre « N notaires disponibles » par jour et la feuille de réservation le confirme avant de publier. | S/M |
| 11 | 2,5 | **Pré-autorisation qui tient jusqu'à la signature** (Notairo paie d'avance) | Le hold Stripe expire en ~7 j alors que le palier standard est à 15 j+ : passer à SetupIntent (carte enregistrée) + PaymentIntent à J-2, ou ré-autoriser J-5 ; sinon le « payé à la signature » casse sur la majorité des dates. | M |
| 12 | 2,5 | **Promesse d'appariement (concierge)** (tous les étalons confirment) | « Un notaire répond sous 24 h ouvrables — sinon Nota s'en occupe » : escalade automatique à l'opérateur (`operatorNewLead` existe) après N h sans réponse, relance ciblée des notaires dans le rayon, et un statut « Nota cherche pour vous » visible au client. Cohérent avec la place de marché conciergée du plan PMF. | M |
| 13 | 2,0 | **Comparer les propositions avec la fiche du notaire** (Leya, Zocdoc) | Attacher à chaque proposition la carte de faits (étude, secteur, CNQ, nb d'actes, rayon) — autorisée par l'ADR 0030 — pour que le client choisisse entre plusieurs notaires au lieu de subir le premier « Retenir ». | M |
| 14 | 2,0 | **Tableau de bord courtier** (Deeded « Refer a deal ») | Le partenaire saisit un client en 30 s (pré-remplissage du dialogue de réservation) et voit l'état de ses dossiers référés (publié / retenu / signé) ; s'appuie sur le registre de parrainage existant. | M |
| 15 | 1,5 | **Signature à distance guidée** (Deeded, Ownright) | Pour « urgence en ligne » et à la demande du notaire : Nota planifie la visio (Teams selon la CNQ), envoie le lien et la checklist de l'acte technologique, et le jalon « Signé » se coche depuis la réunion. | M |
| 16 | 1,5 | **Vérification d'identité en ligne** (Deeded, Ownright, Proof) | Port `identity` (Stripe Identity ou équivalent canadien) déclenché après rétention : capture + vivacité, résultat visible au notaire comme **aide** (la vérification légale reste la sienne). | M |
| 17 | 1,3 | **Sync agenda bidirectionnelle** (Zocdoc) | OAuth Google/Microsoft côté notaire pour lire les plages occupées et alimenter « N notaires disponibles » automatiquement ; remplace le rang 10 à terme. | L |
| 18 | 0,7 | **App native** (Zocdoc, Maple, Rocket) | Après le push web : enveloppe Capacitor de la PWA pour les magasins ; peu de gain tant que le push web n'est pas là. | L |

### Ce qu'il faut garder tel quel (Nota déjà au-dessus de tous)
Devis décomposé avant engagement (honoraires · service Nota · garantie de date) · date choisie par le client et paliers jusqu'à J0 · checklist de documents avec fichiers qui restent sur l'appareil · messagerie par acte avec dépôt de documents · barème d'annulation exposé aux deux parties et versé au notaire · agenda ICS/webcal des deux côtés · bilingue partout · entrée sans mot de passe · cote /100 visible au notaire dans sa propre console · déontologie d'abord (aucune cote publiée sur un notaire nommé).

### Séquence recommandée
- **Semaine 1 (tout en S, ~6 items)** : rangs 1, 2, 3, 6, 7, 8 — jalons + rappels sur l'acte retenu, faits agrégés, délai d'appariement mesuré, débours, heures de support, garantie énoncée. Aucun changement de modèle, tout est copie + domaine + un calcul de stats.
- **Semaines 2–3** : rangs 4, 5, 9, 10, 11 — push web, SMS, onboarding notaire, jours bloqués, hold Stripe.
- **Après les premiers notaires réels** : rangs 12–16 — concierge, comparaison des propositions, courtiers, visio, identité.

---

## 5. Sources capturées (2026-09-03)
- Notairo : https://notairo.com/ · https://notairo.com/pages/ressources · https://notairo.com/blogs/news/comment-ca-fonctionne-le-processus-notairo-etape-par-etape · https://notairo.com/blogs/news/est-ce-qu-un-notaire-peut-travailler-a-distance-au-quebec · https://notairo.com/blogs/news/frais-de-notaire-au-quebec-en-2026-a-quoi-s-attendre
- Leya : https://leya.ca/ · https://leya.ca/real-estate
- Deeded : https://www.deeded.ca/ · https://www.deeded.ca/pricing · https://www.deeded.ca/mortgage-pros · https://www.deeded.ca/blog/closing-guide-for-refinancing-your-mortgage
- Ownright : https://ownright.com/ · https://ownright.com/pricing · https://ownright.com/faq · https://reviews.birdeye.com/ownright-169737745302566
- Soumissions Québec / Maison : https://soumissionsquebec.ca/notaires/ · https://www.soumissionsmaison.com/notaires/comparateur/
- Zocdoc : https://www.zocdoc.com/blog/facts/real-time-availability-instant-booking/ · https://www.zocdoc.com/patient-help/en/articles/8814211-what-is-zocdoc-s-cancellation-and-no-show-policy · https://www.zocdoc.com/about/verifiedreviews/ · https://www.capterra.com/p/10032407/Zocdoc/
- Maple : https://www.getmaple.ca/ · https://www.getmaple.ca/for-you-family/how-it-works/ · https://www.getmaple.ca/pricing-quebec/ · https://helpdesk.getmaple.ca/en/articles/5375023-pricing
- Rocket Lawyer : https://www.rocketlawyer.com/ · https://www.forbes.com/advisor/business/rocketlawyer-vs-legalzoom/
- LegalZoom : https://www.legalzoom.com/country/ca · https://www.zenbusiness.com/rocket-lawyer-vs-legalzoom/
- Proof : https://www.proof.com/pricing · https://www.proof.com/product/notarize · https://support.proof.com/hc/en-us/articles/22372310048919-How-Much-Does-Notarization-Cost-on-the-Proof-Platform
- Cadre québécois de la signature à distance : https://www.cnq.org/en/the-chambre-and-your-protection/news-press-room/technological-notary-deed-and-remote-signature/ · https://www.protegez-vous.ca/partenaires/chambre-des-notaires-du-quebec/l-acte-notarie-technologique
- Nota (code) : `apps/web/public/index.html`, `apps/web/public/app.js`, `packages/domain/index.js`, `apps/api/openapi.yaml`, `apps/api/src/{handler,notifications,reminders,billing,stripe-port,emails}.js`, `apps/admin/public/admin.js`, `docs/decisions/0001–0033`, `README.md`.
