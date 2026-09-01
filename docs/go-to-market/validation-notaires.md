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
| **H3** | Le modèle de rémunération ne l'expose pas | ≥ 1/3 nomment le partage d'honoraires spontanément | « Nota prélève X. D'où doit venir le X ? » |

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

## 2. Le modèle, tel qu'il est décidé (ADR 0028)

Le partage est facturé **côté client**, et il penche vers le notaire :

- le montant offert par le client est un **total tout compris** — rien ne s'y
  ajoute ;
- **Nota garde au plus 15 %** en frais de service — trouver le notaire, monter
  et valider le dossier, opérer la transaction et le séquestre ;
- **le notaire garde donc 85 % au départ, et jusqu'à 95 %** au mieux : 15 %,
  c'est le point de départ d'un notaire sans historique, 5 % est le plancher ;
- le levier est **une seule mesure, publiée des deux côtés : la cote sur 100**
  — satisfaction des clients (40), services rendus (25), disponibilité (20),
  présence sur Nota (15). Elle ne déplace la ligne que vers le notaire, jamais
  l'inverse.

| Cote atteinte | Nota garde | Le notaire garde |
| ---: | ---: | ---: |
| — (départ) | 15 % | **85 %** |
| 60 | 12 % | **88 %** |
| 70 | 10 % | **90 %** |
| 80 | 8 % | **92 %** |
| 90 | 5 % | **95 %** |

Quelques repères, pour parler juste en entrevue : un notaire neuf au profil
complet est déjà autour de **46** ; quatre mois d'activité, huit actes et six
avis à 4,6 le placent vers **66** ; un établi — treize mois, vingt-cinq actes
sur les deux services, dix-huit avis à 4,7 — atteint **86** ; un chevronné
(80 actes, 40 avis à 4,9, urgences en ligne) frôle **99**.

Deux points de discipline pour tout ce qui s'écrit à un notaire.

**Ne jamais présenter Nota comme prenant une part des honoraires.** La
structure est un frais payé par le client pour un service rendu au client.
C'est la formulation exacte, et c'est aussi la seule que la concurrence
utilise — voir [`concurrence.md`](concurrence.md).

**Ne pas défendre le 15 % : le mesurer.** C'est une hypothèse (le plan
modélisait 10 %), et H3 est précisément là pour la trancher. Un notaire qui
trouve le taux élevé n'est pas une objection à réfuter, c'est la donnée qu'on
est venu chercher. Les quatre pondérations de la cote (40/25/20/15) sont, elles
aussi, un jugement calibré sur des profils plausibles et jamais confronté à un
notaire réel — la phase 1 doit les mesurer au même titre que le taux.

**Ce qu'il faut savoir avant d'en parler.** Sur le fil Stripe, le client paie
**la plateforme** : la caution est une session Checkout sur le compte de Nota,
et à la signature Nota capture, garde sa part et vire le net au notaire. La
part de Nota n'est donc pas un prélèvement sur un encaissement du notaire —
c'est la structure de Notairo, Deeded et Ownright. Mais cela ne tranche pas la
**qualification** : l'article 32.1 de la *Loi sur le notariat* (2023) présume
usurpation des fonctions de notaire chez l'intermédiaire qui obtient d'un
notaire l'abandon d'une partie de ses honoraires (2 500 $ à 125 000 $), et
l'article 70 du *Code de déontologie* touche l'affichage public des évaluations.
**L'avis juridique écrit (20 000 $ budgétés) reste requis avant la mise en
service** — et en entrevue, on décrit l'économie et on ne promet rien sur la
mécanique.

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
jamais écrire « commission ».

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
