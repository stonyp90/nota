# Validation notaires — playbook

**But :** faire trancher, par des notaires en exercice, les hypothèses qui
décident du code — avant d'écrire la ligne suivante. Cible : **30 entrevues en
6 semaines**, dont **12 dans la cohorte pilote** à Québec (phase 1).

Ce document répond à trois questions : *quoi valider*, *où les trouver*,
*comment les faire entrer dans le cycle de développement*.

---

## 1. Ce qu'on valide (et rien d'autre)

Le plan d'affaires porte trois hypothèses. Deux se tranchent **côté notaire**,
et aucune ne se tranche par sondage — il faut la personne, son calendrier et
son prix.

| # | Hypothèse | Réfutée si | Question qui la tranche |
| --- | --- | --- | --- |
| **H1** | Le notaire a des plages vides qu'il vendrait | < 40 % déclarent ≥ 2 plages vides/semaine | « Cette semaine, combien d'heures de signature non vendues ? » |
| **H2** | Il vend sa disponibilité de dernière minute | < 1/3 acceptent un J-3 même à 2,2× | « Refinancement, jeudi dans 3 jours, 4 400 $. Vous prenez ? » |
| **H3** | Le modèle de rémunération ne l'expose pas | ≥ 1/3 nomment le partage d'honoraires spontanément | « Une plateforme vous amène ce dossier ; elle doit être payée. D'où doit venir cet argent ? » |

**Trois hypothèses secondaires, pas moins utiles :**

- **H4 — le décideur.** Le notaire ne tient souvent pas son propre agenda.
  Si l'adjointe/technicienne décide, la console notaire vise le mauvais
  utilisateur.
- **H5 — le logiciel d'étude.** Para-Maître (Avancie), ProNotaire / ProCardex
  (Acceo–Juris Concept), JurisÉvolution/JurisPRO. Si la double saisie est
  rédhibitoire, une intégration passe avant tout le reste du carnet.
- **H6 — l'art. 46.** Combien de fois par an refusent-ils une signature à
  distance faute de justification défendable ? C'est le dimensionnement direct
  de la phase 2.

> **Règle :** une opinion isolée ne change rien. Un changement de code exige
> **3 entrevues concordantes**, ou **1 arbitrage du notaire-conseil payé**.

---

## 2. Le modèle, tel qu'il est déployé (ADR 0031 et 0034)

> **Ce qui a été retiré, et pourquoi le kit le disait encore.** Jusqu'au
> 2026-09-01, ce document décrivait le partage de l'ADR 0028 : un total qui se
> partageait 85/15 à la signature, la part du notaire montant à 95 % avec une
> « cote sur 100 » publiée des deux côtés. **L'ADR 0031 a retiré ce partage**,
> l'ADR 0034 l'a remplacé par une grille de prix, et l'ADR 0030 a fermé
> l'affichage de toute cote sur un notaire nommé. Ce n'est pas seulement
> périmé : le partage d'honoraires avec un non-notaire tombe sous l'art. 32 du
> *Code de déontologie* et l'art. 32.1 de la *Loi sur le notariat*, et une cote
> visible du client sur un notaire nommé sous l'art. 70. **Aucun chiffre de
> l'ancien barème ne doit reparaître dans un texte destiné à un notaire.**

### Deux lignes, deux achats

- **Le notaire fixe ses honoraires et les garde en entier.** Nota ne prélève
  rien dessus, ni pourcentage, ni part, ni frais de piste. Le montant offert
  par le client *est* la rémunération du notaire.
- **Nota vend son propre service au client, à son propre prix, à côté.** Ce
  prix ne dépend ni du notaire, ni de la valeur de l'acte : c'est une grille
  publiée, la même pour tout le monde.
- **Le client paie à la signature.** La carte est enregistrée à la publication,
  le blocage est posé deux jours avant la date, la capture se fait à l'acte
  (ADR 0015, amendé par l'ADR 0035).

### La grille, telle que le code la porte

Source unique : `packages/domain/index.js` (`SERVICES[].prixNotaCents` et
`TIERS[].prixNotaDateCents`). Ne jamais citer un autre document pour ces
chiffres.

| Service | Prix de Nota | Honoraires de départ du notaire |
| --- | ---: | ---: |
| Financement hypothécaire | **199 $** | 1 800 $ |
| Refinancement hypothécaire | **249 $** | 2 000 $ |

À quoi s'ajoute la **garantie de date**, sur sa propre ligne, quand le client
demande une date rapprochée :

| Palier | Préavis | Ligne de Nota |
| --- | --- | ---: |
| Standard | plus de 14 jours | **0 $** |
| Rapide | 14 jours ou moins | **50 $** |
| Prioritaire | 7 jours ou moins | **100 $** |
| Urgence | la veille | **200 $** |
| Extrême | le jour même | **300 $** |

Taxes et débours en sus, des deux côtés. Le prix de Nota n'est **pas** « fixe » :
c'est une grille par service, et le mot « fixe » est faux depuis l'ADR 0034.
La formulation juste est « **le prix de Nota, publié par service** ».

### Ce que ça pèse, arithmétique en clair

Un notaire demandera ce que Nota coûte au client par rapport à l'acte. Le
calcul, au palier standard :

- refinancement : 2 000 $ d'honoraires + 249 $ = **2 249 $**, dont Nota
  249 / 2 249 = **11,1 %** ;
- financement : 1 800 $ + 199 $ = **1 999 $**, dont Nota 199 / 1 999 = **10,0 %**.

Et cette part **descend** dès que la date porte une prime, parce que les
honoraires montent avec le palier tandis que la ligne de Nota monte de
quelques dizaines de dollars : au palier prioritaire (7 jours ou moins,
honoraires au multiple médian ×3), un refinancement fait 6 000 + 349 = 6 349 $,
dont Nota **5,5 %**. Le petit acte n'est donc plus le plus taxé — c'est
l'inverse de l'ancien prix unique de 400 $, qui pesait 16,7 % d'un
refinancement et 18,2 % d'un financement.

### La cote sur 100 : interne, et rien d'autre

Elle existe toujours dans le code, elle sert la console du notaire et le
jugement de Nota. Elle **ne décide plus d'aucun partage** — il n'y en a plus —
et **rien de ce qu'elle contient ne s'affiche au client sur un notaire nommé**
(ADR 0030). Côté client, il n'y a que des faits : numéro au Tableau de l'Ordre,
nombre d'actes. En entrevue, ne jamais promettre une réputation « visible » :
c'est exactement ce que l'art. 70 refuse.

### Trois points de discipline pour tout ce qui s'écrit à un notaire

**Ne jamais écrire que Nota prend une part des honoraires.** Ni « commission »,
ni « partage », ni « pourcentage ». La structure est un prix payé par le client
pour un service rendu au client — c'est aussi la seule que la concurrence
utilise, voir [`concurrence.md`](concurrence.md).

**Ne jamais écrire « moins cher ».** L'art. 32.1 1° du *Code de déontologie*
proscrit la publicité comparative sur le prix. La phrase qui tient est « le
seul endroit où une date rapprochée a un prix, affiché avant l'engagement ».

**Ne pas défendre la grille : la mesurer.** 199 $ et 249 $ sont un jugement du
propriétaire, jamais confronté à un notaire réel. H3 est là pour ça. Un notaire
qui trouve le prix élevé n'est pas une objection à réfuter, c'est la donnée
qu'on est venu chercher.

**Ce qu'il faut savoir avant d'en parler.** Sur le fil Stripe, le client paie
**la plateforme** : la caution est une session Checkout sur le compte de Nota,
et à la signature Nota capture le total, garde son prix en frais d'application
et vire au notaire exactement le montant qui lui a été offert. Ce n'est donc
pas un prélèvement sur un encaissement du notaire — c'est la structure de
Notairo, Deeded et Ownright. Mais cela ne tranche pas la **qualification** :
l'article 32.1 de la *Loi sur le notariat* (2023) présume usurpation des
fonctions de notaire chez l'intermédiaire qui obtient d'un notaire l'abandon
d'une partie de ses honoraires (2 500 $ à 125 000 $), et l'article 70 du *Code
de déontologie* touche l'affichage public des évaluations. **L'avis juridique
écrit (20 000 $ budgétés) reste requis avant la mise en service** — et en
entrevue, on décrit l'économie et on ne promet rien sur la mécanique.

## 3. Où les trouver — canaux classés par vitesse

**~3 900 notaires au Québec, ~400 dans la RMR de Québec.**

### A. Chaud — jours 1 à 3 (taux de réponse 40–60 %)

1. **Réseau direct et 2ᵉ degré LinkedIn.** Une intro vaut vingt courriels froids.
2. **Courtiers hypothécaires.** Chaque courtier travaille avec 2–5 notaires et
   les appelle par leur prénom. C'est le canal le plus sous-estimé : ils
   souffrent exactement du problème que Nota résout (trouver un notaire
   disponible pour une date de clôture). Demander une présentation, pas un lead.
3. **Prêteurs et directeurs hypothécaires** en caisse/banque — même logique.

### B. Froid ciblé — jours 3 à 14 (taux de réponse 8–15 %)

4. **Sites web des études.** *Source primaire recommandée.* Chaque étude publie
   les adresses de ses notaires sur son propre site, en évidence, pour être
   jointe dans le cadre de sa pratique — c'est exactement la condition de
   **consentement tacite** de la LCAP, et rien n'y restreint la reproduction.
   Recherche : `notaire "Québec" site officiel étude`, Google Maps « notaire »
   sur la RMR de Québec, puis Lévis, Charlesbourg, Sainte-Foy, Beauport.
5. **[Trouver un notaire](https://trouverunnotaire.cnq.org/) (CNQ).** Expose
   nom, adresse, téléphone, **courriel**, employeur, langues, champs de
   pratique. Deux limites, toutes deux importantes :
   - il ne contient **que les notaires qui souhaitent être référés au public**
     — un sous-ensemble restreint (une recherche « Québec » ville ne rend
     qu'une vingtaine de fiches, pas 400) ;
   - la **clause 7** des [modalités d'utilisation](https://www.cnq.org/modalites-et-conditions-d-utilisation/)
     interdit de reproduire le Contenu à des fins commerciales sans
     autorisation écrite. **Consultation unitaire : oui. Extraction en lot :
     non.** Le site est par ailleurs protégé par Cloudflare.
6. **LinkedIn.** Recherche `notaire` + Québec. Demande de connexion avec note
   (300 car.), pas de courriel. Segment le plus réactif : 2 à 8 ans de pratique.

### C. Volume et crédibilité — semaines 2 à 8

7. **[APNQ](https://www.apnq.qc.ca/) — Colloque 2026, 23–24 octobre.** Dans
   ~8 semaines. C'est la plus grosse fenêtre de l'année civile : demander
   *aujourd'hui* les modalités exposant/commanditaire. Le poste « acquisition
   notaires (terrain, congrès) — 15 000 $ » du plan est fait pour ça.
8. **[AJNQ](https://www.ajnq.org/) — jeunes notaires.** Le segment qui a des
   plages vides, pas de clientèle établie, et aucune aversion au numérique.
   C'est la cohorte pilote naturelle.
9. **Cours de perfectionnement du notariat** (CNQ, Centre des congrès de
   Québec). L'édition 2026 a eu lieu les 26–27 mars ; viser 2027, mais
   s'inscrire à la liste dès maintenant.
10. **[Chaire du notariat](https://www.chairedunotariat.qc.ca/) (UdeM).**
    Colloques et publications — canal d'autorité, pas de volume.

### D. La Chambre elle-même — à démarrer en parallèle, pas après

11. **Compte « partenaire d'affaires »** de l'Espace notaire (l'écran de
    connexion CNQ l'offre explicitement) : accès aux pages destinées aux
    fournisseurs.
12. **Homologation.** La CNQ tient une liste de
    [fournisseurs de solutions technologiques](https://www.cnq.org/fournisseurs-de-solutions-technologiques-aux-notaires/)
    qui s'engagent contractuellement sur la sécurité de l'information. Y
    figurer est un accélérateur de confiance énorme, et probablement une
    exigence de fait dès que Nota touche au transfert de documents de dossier.
    Question à poser à la CNQ : *Nota entre-t-il dans une catégorie
    déclarable ?*
13. **Dialogue déontologique.** Réception 514-879-1793 / 1-800-263-1793,
    101-2045 rue Stanley, Montréal. Note : la Chambre **ne donne pas d'opinion
    juridique** — l'avis écrit budgété (20 000 $) vient d'un cabinet, la
    Chambre se consulte pour la posture, pas pour l'absolution.

**À connaître avant la première rencontre — l'écosystème installé :** Notarius
(ConsignO Cloud-CNQ, CertifO — obligatoires), Avancie, Juris Concept, Acceo,
Blocknote, et **Lender Lawyer Connect de FCT**, qui opère déjà dans le couloir
prêt hypothécaire. Un notaire vous les nommera ; ne pas les connaître coûte la
crédibilité de l'entrevue.

---

## 4. Cadre légal de la prospection

**LCAP.** Un message dont l'objet est *réellement* de la recherche — aucune
offre, aucun lien d'inscription, aucune promotion — n'est pas un message
électronique commercial. C'est la posture de E1. Dès qu'un message invite à
essayer la plateforme (E4 et suivants), il devient un MEC et exige :

1. **consentement** — ici tacite : adresse publiée en évidence, message lié à
   l'exercice de la profession, aucune mention refusant les messages non
   sollicités à cette adresse ;
2. **identification** — nom, adresse postale, un moyen de joindre ;
3. **mécanisme de désabonnement** fonctionnel 60 jours.

Le fardeau de la preuve du consentement tacite repose sur l'expéditeur :
**conserver, par contact, l'URL et la date de la page où l'adresse a été
trouvée**. C'est une colonne du tracker, pas une note.

**Modalités CNQ.** Voir §3.5 — pas d'extraction en lot.

**Loi 25.** Le tracker est un fichier de renseignements personnels : finalité
déclarée, conservation bornée (24 mois), suppression sur demande. Le dire dans
le pied de courriel coûte deux lignes et vaut la tranquillité.

**Déontologie.** Ne jamais demander de signer quoi que ce soit au premier
contact. Ne jamais offrir de rétribution pour une référence de client. Ne
jamais écrire « commission », « partage » ni « pourcentage » : Nota ne prend
rien sur les honoraires, il vend son propre service au client (§2).

---

## 5. Cadence — 14 jours

| Jour | Action | Cible |
| --- | --- | --- |
| 1 | Tracker monté ; 40 adresses A+B sourcées ; APNQ contactée (exposant) | — |
| 2 | **E1** vague 1 — 20 envois, un par un, jamais en cc | 2–3 réponses |
| 3 | 10 demandes LinkedIn ; 3 courtiers hypothécaires appelés | — |
| 4 | Premières entrevues | — |
| 6 | **E2** relance vague 1 ; **E1** vague 2 — 20 envois | +2 |
| 8–10 | Entrevues ; premiers `.feature` écrits | 6–8 cumulées |
| 12 | **E3** clôture vague 1 ; **E2** vague 2 | +2 |
| 14 | **Revue** : H1–H6 tenues ou réfutées ; **E4** aux 5 plus chauds | 12 entrevues |

Volume : **20 courriels/jour maximum**, envoyés individuellement depuis la
boîte personnelle. Pas d'outil d'envoi en masse — la délivrabilité et le ton
comptent plus que le débit à cette échelle.

**Le seul indicateur qui compte à 14 jours :** le nombre de notaires qui ont
répondu à la question J-3 par un **chiffre**, pas par « ça dépend ».

---

## 6. Les faire entrer dans le cycle de développement

Trois niveaux d'engagement, du plus léger au plus lié :

**Niveau 1 — Répondant (30).** Une entrevue de 20 min. Sortie : des notes et,
si l'insight est net, un scénario dans `features/`. Rappel trimestriel.

**Niveau 2 — Notaire-conseil (1–2, rémunéré).** Les 25 000 $ déjà budgétés.
Mandat : arbitrer les ADR touchant à la pratique **avant** le merge, relire les
libellés destinés au public, trancher quand les entrevues se contredisent.
Cadence : 2 h/mois, plus les arbitrages ponctuels.

**Niveau 3 — Cohorte pilote (10–15, Québec).** Accès à
`https://d1s1h4894dau0c.cloudfront.net` avec un vrai carnet. L'indicateur
unique du plan — **le taux de rétention** — ne se mesure qu'ici.

### Le circuit, concrètement

```
entrevue → note (docs/go-to-market/entrevues/AAAA-MM-JJ-nom.md)
   ├─ contredit une règle métier ?  → scénario features/*.feature  → rouge → code
   ├─ change une frontière ?        → ADR docs/decisions/           → notaire-conseil valide
   └─ irritant d'usage ?            → backlog UX (règle des 3 clics)
```

Deux garde-fous : **rien ne se code sur une opinion isolée** (§1), et **toute
règle validée devient un scénario exécutable** — sinon l'entrevue s'évapore
dans un fichier de notes que personne ne relit.

À créer quand la cohorte démarre : un ADR « programme notaires-partenaires »
qui fixe qui entre, ce qu'il obtient, et ce qu'il doit en retour.

---

## Fichiers du kit

- [`courriels-notaires.md`](courriels-notaires.md) — les 6 gabarits, FR et EN
- [`entrevue-notaire.md`](entrevue-notaire.md) — guide d'entrevue 20 min + grille
- [`pipeline-notaires.csv`](pipeline-notaires.csv) — tracker (preuve LCAP incluse)
