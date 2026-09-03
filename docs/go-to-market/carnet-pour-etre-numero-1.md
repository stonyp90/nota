# Carnet — ce qu'il faut livrer pour être n° 1

Date : 2026-09-03 · Source : [relevé D §4](veille-2026-09-03/d-benchmark-produit.md),
reclassé par état d'avancement plutôt que par ratio.

Le relevé D a scoré 29 capacités produit sur onze références. **Nota est premier
dans sa catégorie** — accès en ligne à un notaire du Québec pour un acte de
financement — avec 36 points sur 58, contre 26 pour Notairo et 26 pour Leya.
Mais il est cinquième toutes références confondues : Maple 44, Rocket Lawyer 38,
Ownright et Proof 37. Les clôtureurs ontariens le battent sur cinq lignes
structurantes, et les étalons du « réserver un professionnel réglementé » le
battent sur la plus lourde en conversion : **disponibilité réelle et
confirmation immédiate**.

Ce carnet est la liste des lignes qui manquent. Trois tailles : **S** (copie,
domaine, un calcul — une journée à quelques jours), **M** (un port, un écran, un
état nouveau), **L** (une intégration tierce ou une distribution).

---

## 1. En chantier aujourd'hui — en cours (2026-09-03)

Quatre chantiers sont ouverts le jour même où ce carnet est écrit. Ils ne sont
pas à ordonnancer : ils sont en cours.

| Chantier | Ce qu'il change | Qui il dépasse | État |
| --- | --- | --- | --- |
| **Grille de prix par service** — ADR 0034 | Le prix de Nota cesse d'être un montant unique. À 400 $ fixes, Nota pèse **18,2 %** d'un financement de 1 800 $, **16,7 %** d'un refinancement de 2 000 $, et **9 %** d'un acte à 4 000 $ : le prix fixe est régressif, il frappe le plus petit dossier le plus fort. Une grille par service ramène le poids à ≈ 10–12 % sur le standard, et elle ne dépend d'aucune cote — l'art. 29.1 reste satisfait. | **Notairo**, dont le produit équivalent (« frais de prise en charge de dossier ») est à **295 $**, soit 35 % sous le 400 $ de Nota. La grille est la seule façon de fermer cet écart sans toucher aux honoraires du notaire. | **en cours (2026-09-03)** |
| **Caution Stripe qui tient jusqu'à la signature** — ADR 0035 | L'autorisation de carte expire en ~7 jours ; le palier `standard` commence à 15 jours. Aujourd'hui, **toute offre standard se vide d'elle-même du carnet**, sans un mot au client. SetupIntent (carte enregistrée) puis PaymentIntent à J-2, ou ré-autorisation à J-5. | **Notairo**, qui encaisse d'avance par Shopify Checkout et dont la page « Politique de remboursement » répond 404. La promesse « vous n'êtes débité qu'à la signature » n'est meilleure que si elle tient plus de sept jours. | **en cours (2026-09-03)** |
| **Couche de persistance : consentement, notifications en application, registre de campagne, index client** | Quatre états que le produit affiche déjà mais ne conserve nulle part. Sans registre de consentement, la ligne Loi 25 du formulaire n'a aucune preuve derrière elle ; sans notifications persistées, la cloche du compte repart vide à chaque appareil ; sans registre de campagne ni index client, l'admin ne peut ni retrouver un client par son courriel ni savoir ce qui lui a été envoyé. | Personne directement — c'est le plancher sous les six chantiers de la section 2. La porte « Proposer une amélioration » (voir [`les-usagers-dans-le-cycle-de-developpement.md`](les-usagers-dans-le-cycle-de-developpement.md)) et les jalons de l'acte s'y posent tous les deux. | **en cours (2026-09-03)** |

---

## 2. Les six chantiers de taille S — la première semaine

Le relevé D les met tous en semaine 1 : aucun ne change le modèle, tous tiennent
en copie, domaine et un calcul de statistiques. Deux d'entre eux comptent plus
que les quatre autres, et méritent d'être argumentés.

### 2.1 Rappels et jalons sur l'acte **retenu** — le trou le plus coûteux

*Dépasse : Deeded (« pizza tracker »), Ownright (jalons et notifications en
temps réel), Zocdoc (rappels jusqu'à la visite). Taille : S.*

**Le fait, dans le code.** `dueReminders`, dans `packages/domain/index.js`,
commence par `if (!isOpenBid(bid)) return due;`. Toute la cadence — J-7, J-3,
J-1, J0 et le rappel « dossier incomplet » — ne s'applique qu'à une offre
**ouverte**. Dès qu'un notaire retient, `REMINDER_KINDS` n'a plus rien à
émettre.

**Ce que ça produit.** Le comportement est exactement inversé. Nota parle
beaucoup au client qui n'a encore personne, et **plus du tout** à celui qui a un
notaire, une date et une carte autorisée. Entre la rétention et la signature —
la période où le client a le plus d'argent engagé et le plus de questions — le
produit est muet, sauf si le notaire écrit le premier dans la messagerie. Le
courriel « offre retenue » est le dernier signal automatique avant « acte
payé ».

**Pourquoi c'est le plus coûteux.** Neolegal est le seul acteur québécois du lot
qui ait des avis indépendants : **29 % à une étoile**, et les verbatims disent
« documents jamais livrés », « facturation immédiate ». Le silence après
paiement est ce qui fabrique ces avis. Nota n'a encore aucun avis ; ce chantier
décide de la couleur des premiers.

**Ce que ça coûte à livrer.** Rien de neuf, ou presque : les ~40 gabarits
bilingues existent, le registre d'envoi (idempotence) existe, la cadence existe.
Il faut étendre `dueReminders` aux offres retenues (J-3, J-1, J0 aux **deux**
parties) et poser cinq jalons dans la bande de l'offre et la carte du notaire —
Retenue → Documents fournis → Rendez-vous confirmé → Signé → Réglé — chacun
émettant un courriel qui existe déjà. C'est du domaine et un bandeau.

### 2.2 Les débours dans le devis — la quatrième ligne qui manque

*Dépasse : Ownright (le seul qui précise que ses débours sont des frais de tiers
et qu'il n'ajoute aucun frais d'administration), Notairo et Deeded (qui écrivent
« + débours » sans chiffre). Taille : S.*

**Le fait.** Le devis de Nota a trois lignes : honoraires du notaire, service
Nota, autorisé sur votre carte. Les débours — droits du Registre foncier,
copies, index aux immeubles — n'apparaissent **nulle part**, ni dans le
formulaire, ni dans le domaine, ni dans la feuille « Retenir » du notaire. Le
client les découvre à l'étude.

**Ce que font les autres.** Notairo écrit « 949 $ + débours » sur chaque acte.
Deeded écrit « + disbursements » et le répète dans ses conditions. Ownright va
plus loin : « subject to HST and disbursements », les débours étant **des frais
de tiers seulement**, « we don't charge Administration Fees ». Les trois disent
au client qu'il reste quelque chose à payer.

**Pourquoi c'est la ligne à prendre.** Nota a construit le seul devis décomposé
du marché québécois, et l'a laissé incomplet : « Autorisé sur votre carte » se
lit comme un total, et n'en est pas un. C'est la seule ligne du benchmark où
Nota est en retard **sur sa propre force**. Et c'est aussi la plus facile à
gagner franchement : personne ne met un **chiffre** en face des débours. Une
ligne « Débours estimés (Registre foncier, copies) » par service, portée par le
domaine, affichée en quatrième ligne du devis et dans la feuille Retenir, fait
de Nota le seul qui annonce le vrai total.

**Deux gardes-fous.** L'estimation doit se dire estimation, et elle doit rester
**encaissée par le notaire ou par le Registre** — un débours qui transiterait
par Nota deviendrait un avantage au sens de l'art. 33.

### 2.3 Les quatre autres

| Chantier | Spécification | Qui il dépasse |
| --- | --- | --- |
| **Preuve sociale conforme à l'art. 70** | Afficher des faits agrégés **sur Nota, jamais sur un notaire nommé** : actes signés via Nota, délai médian de rétention par palier, notaires actifs, note publique de la plateforme. Alimentés par `/admin/metrics/overview`, gardés par `truthful-claims.test.mjs`. | **Ownright** (1 768 avis à 5,0) et **Deeded** (695 à 4,9) — que Nota ne peut pas imiter sans violer l'art. 70. Les faits agrégés sont la seule forme licite, et personne d'autre ne les publie. |
| **Délai d'appariement visible** | Remplacer la phrase statique de `#day-chance` par la mesure : « ce mois-ci, les offres standard sont retenues en médiane en N h », par palier, calculée dans `stats.js` (`retenueAt − createdAt`). Ajouter « N notaires couvrent G1R ». | **Zocdoc** (⅓ des rendez-vous en moins de 48 h, affiché), **Maple** (« connecté en minutes »), **Proof** (« attente < 1 s »). Tous vendent un délai mesuré ; Nota n'en promet aucun — mais peut en **constater** un. |
| **Support : heures et deuxième canal** | Afficher des heures et un délai de réponse sur le widget et le dialogue « Nous joindre » (« lun–ven 8 h–18 h, réponse < 2 h »), ajouter un numéro de renvoi et un texto. Valeurs en configuration, jamais en dur. | **Ownright** (« après les heures de bureau »), **Deeded** (téléphone, courriel, texto), **Rocket Lawyer** (« 6 h–18 h PT »). Nota affiche un clavardage sans heures ni téléphone. |
| **Garantie énoncée** | Écrire ce qui est déjà vrai — « aucun notaire ne retient : vous ne payez rien, la carte est libérée » — et ajouter, sur demande après signature, le remboursement du **service Nota seul** (jamais des honoraires). Chemin de remboursement partiel côté Stripe. | **LegalZoom** (60 jours). Notairo n'a aucune garantie et sa page de remboursement est en 404 ; Deeded et Ownright n'en énoncent pas. |

---

## 3. Le reste, par taille

Chaque ligne nomme le concurrent qu'elle dépasse.

### Taille S

| Chantier | Spécification | Dépasse |
| --- | --- | --- |
| **SMS aux moments critiques** | Nouveau port `sms` (SNS ou Twilio) branché sur trois `kind` : `offerRetained`, message du notaire, J-1. Le téléphone est déjà collecté ; l'opt-in va avec. | **Deeded** (texto), **Ownright**, **Zocdoc** (SMS + push). |
| **Onboarding notaire sous 10 minutes** | Ouvrir le fil en lecture seule dès l'inscription, valider le lien CNQ automatiquement, reporter Stripe Connect au premier « Retenir », afficher « activation médiane : N h ». L'approbation manuelle reste, mais n'aveugle plus. | **Leya** (réseau de fournisseurs en libre-service) et **Proof** (inscription notaire en libre-service). Notairo n'a **aucune** porte notaire : `/pages/notaires` est une copie de la page consommateur. |

### Taille S/M

| Chantier | Spécification | Dépasse |
| --- | --- | --- |
| **Push web** | `sw.js` existe déjà : ajouter Web Push (VAPID) pour « offre retenue », « message du notaire » et J-1. Le port `notifications` est en place ; c'est un adaptateur de plus à côté de SES. | **Zocdoc** et **Maple**, seuls du lot à pousser. Nota est déjà installable en PWA et ne pousse rien. |
| **Disponibilité déclarée du notaire** | Premier pas sans OAuth : le notaire coche ses **jours bloqués** dans la console ; le carnet affiche « N notaires disponibles » par jour et la feuille de réservation le confirme avant publication. | **Leya** (« *instantly book a notary* », disponibilité en temps réel) et **Zocdoc**. C'est la ligne où Nota perd le plus de points : aujourd'hui, chaque date est offerte sans qu'aucune disponibilité ne soit connue. |

### Taille M

| Chantier | Spécification | Dépasse |
| --- | --- | --- |
| **Promesse d'appariement (concierge)** | « Un notaire répond sous 24 h ouvrables — sinon Nota s'en occupe » : escalade automatique à l'opérateur après N heures sans réponse (`operatorNewLead` existe), relance ciblée des notaires du rayon, statut « Nota cherche pour vous » visible au client. | **Tous les étalons**, qui confirment en secondes ou en minutes. C'est l'automatisation de la règle de conciergerie du [plan PMF §5](plan-pmf-30-jours.md), et la seule réponse au « le client publie, puis attend ». |
| **Comparer les propositions avec la fiche du notaire** | Attacher à chaque proposition la carte de faits (étude, secteur, fiche CNQ, nombre d'actes, rayon) — autorisée par l'ADR 0030 — pour que le client **choisisse** entre plusieurs notaires au lieu de subir le premier « Retenir ». | **Leya** (le client parcourt les fournisseurs) et **Zocdoc** (profil complet avant réservation). Notairo, Deeded et Ownright **assignent** le professionnel : c'est une ligne où le modèle de Nota gagne, à condition de la livrer. |
| **Tableau de bord courtier** | Le partenaire saisit un client en 30 secondes (pré-remplissage du dialogue de réservation) et suit l'état de ses dossiers référés : publié, retenu, signé. Le registre de parrainage existe déjà. | **Deeded** (« Refer a Deal » en 30 s, avec visibilité du courtier) et **Ownright** (41 partenaires nommés, portail dédié). Nota a les codes 50 $/250 $ et aucun portail. |
| **Signature à distance guidée** | Pour l'« urgence 100 % en ligne » et à la demande du notaire : Nota planifie la visioconférence, envoie le lien et la checklist de l'acte technologique, et le jalon « Signé » se coche depuis la rencontre. | **Deeded** (visio) et **Ownright** (à distance par défaut). Notairo affirme que la loi impose la signature en personne — affirmation que le régime de l'acte notarié technologique rend au minimum discutable. Nota **vend** déjà cette option à +400 $ sans l'outiller. |
| **Vérification d'identité en ligne** | Port `identity` (Stripe Identity ou équivalent canadien) déclenché après rétention : capture et vivacité, résultat visible au notaire **comme aide** — la vérification légale reste la sienne. | **Deeded** et **Ownright** (à l'intégration), **Proof** (document + KBA + biométrie). Nota collecte une identité et ne la vérifie pas. |

### Taille L

| Chantier | Spécification | Dépasse |
| --- | --- | --- |
| **Synchronisation d'agenda bidirectionnelle** | OAuth Google/Microsoft côté notaire pour lire les plages occupées et alimenter « N notaires disponibles » sans saisie. Remplace à terme les jours bloqués. | **Zocdoc**, seul du lot à synchroniser dans les deux sens avec l'agenda du cabinet. |
| **Application native** | Enveloppe Capacitor de la PWA pour les magasins — **après** le push web, pas avant : sans notifications, une application native n'apporte rien. | **Zocdoc**, **Maple** (4,8 sur 46 000 avis), **Rocket Lawyer**. Aucun concurrent canadien de la clôture n'a d'application ; ce n'est pas la ligne qui presse. |

---

## 4. Ce qu'il faut garder tel quel

Nota est au-dessus des onze références sur ces lignes. Aucune ne se touche sans
raison écrite.

Devis décomposé avant tout engagement · date choisie par le client et paliers
jusqu'au jour même · checklist de documents dont les fichiers ne quittent pas
l'appareil avant la mise en relation · messagerie par acte avec dépôt de
documents (ADR 0032) · barème d'annulation exposé aux deux parties et **versé au
notaire** (ADR 0033) · agenda ICS/webcal des deux côtés · bilinguisme natif ·
entrée sans mot de passe · cote sur 100 et taux visibles au notaire avant qu'il
retienne · la déontologie d'abord : aucune cote publiée sur un notaire nommé
(ADR 0030).

---

## 5. Hors carnet produit

Deux retards mesurés par la veille ne se règlent pas par une fonctionnalité, et
n'ont donc pas leur place ci-dessus. Ils appartiennent au
[plan PMF](plan-pmf-30-jours.md).

- **Le contenu indexé.** 1 URL et 0 article, sur une URL CloudFront, contre 524
  billets chez Soumissions Maison, 285 chez Deeded, ~150 chez Ownright, 18 plus
  19 pages de ville chez Notairo. Les données structurées de Nota sont les
  meilleures du lot ; elles n'ont rien à structurer. Premier geste : le domaine,
  puis les pages par acte.
- **Le catalogue.** Nota ne vend ni achat ni vente — le gros du volume, à
  1 099–1 199 $ chez les concurrents. C'est un choix de segment, pas un oubli ;
  il se rediscute après dix actes signés, pas avant.

---

## 6. L'ordre

1. **Ce qui est en cours** (section 1) se termine avant qu'autre chose commence :
   sans caution qui tient 15 jours, aucune offre standard ne survit assez
   longtemps pour qu'un jalon ait un sens.
2. **Les six S** (section 2), dans l'ordre : rappels et jalons sur l'acte
   retenu, débours, faits agrégés, délai d'appariement, heures de support,
   garantie énoncée.
3. **Après les premiers notaires réels** : SMS, onboarding notaire, push web,
   jours bloqués.
4. **Après les dix premières demandes** : concierge, comparaison des
   propositions, portail courtier, visioconférence, identité.

La mesure qui décide reste celle du [plan PMF](plan-pmf-30-jours.md) : le taux
de rétention. Sous 40 %, aucun de ces chantiers n'est le bon.
