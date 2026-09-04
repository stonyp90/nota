# Conditions d'utilisation — client

> **BROUILLON NON RÉVISÉ.** Rédigé à partir du code, non par un juriste. Ne pas
> publier ni opposer à un client avant revue juridique. Voir
> [`README.md`](README.md).

**Version : 0.1 (brouillon) · Date d'entrée en vigueur : à déterminer**

*(Les conditions actuellement affichées ne portent ni version ni date —
`apps/web/public/index.html:1153`. Il en faut une : c'est ce qui permet de
prouver quelle version un client a acceptée.)*

---

## 1. Ce que Nota est, et n'est pas

Nota exploite une **place de marché** qui met en relation des personnes ayant
besoin d'un acte notarié au Québec et des notaires membres de la Chambre des
notaires du Québec.

**Rôle de Nota.** Nota fournit une plateforme de mise en relation. Nota **ne
rédige pas d'actes**, ne donne **aucun conseil juridique, fiscal ou financier**,
et **n'est pas partie au mandat** entre vous et le notaire.

**Indépendance du notaire.** Le notaire qui retient votre demande agit en toute
indépendance : il fixe la portée de son mandat, vérifie votre identité et rédige
l'acte selon la loi. **Nota n'intervient jamais dans l'acte notarié.**

*(Reprise fidèle du texte déjà publié, `index.html:1142-1143`.)*

**Nota ne vérifie pas votre identité.** Cette vérification appartient au notaire,
au moment de la signature, comme la loi l'exige (`index.html:1107`).

---

## 2. Ce que vous publiez, et ce qui devient public

Publier une offre est **gratuit**.

Deviennent **publics** sur le carnet : la date de signature souhaitée, le service
demandé, le montant offert et les **trois premiers caractères** de votre code
postal. Rien d'autre.

Restent **privés** : votre nom (sauf si vous choisissez explicitement de le rendre
public), votre courriel, votre téléphone, le contenu de votre dossier et, le cas
échéant, le code du partenaire qui vous a référé.

*(Comportement vérifié : `apps/api/src/handler.js:730` — l'anonymat est le défaut ;
`handler.js:739-773` — courriel, téléphone, dossier et code partenaire sont
marqués privés et exclus de la projection publique.)*

Votre offre est validée côté serveur : le montant que vous proposez est
recalculé contre un plancher que Nota fixe par service, par date et par secteur.
Une offre sous ce plancher est refusée (`apps/api/src/handler.js:681-693`).

---

## 3. Le prix : deux lignes, jamais un partage

**Vous payez deux choses, et vous les voyez séparément avant de vous engager :**

| Ligne | Qui l'encaisse | Ce que c'est |
| --- | --- | --- |
| **Les honoraires du notaire** | **Le notaire, en entier** | Le montant que vous offrez |
| **Le prix de Nota** | Nota | Un prix publié d’avance, déterminé par le service demandé et par le délai avant la signature — jamais par le notaire, sa cote ou le montant que vous offrez |

**Le notaire reçoit la totalité de ce que vous lui offrez.** Nota ne prélève
rien sur ses honoraires : elle vend son propre service, à son propre prix.
C'est une obligation, pas un choix commercial — l'art. 32 du *Code de
déontologie des notaires* interdit au notaire de partager ses honoraires avec
une personne qui n'est pas membre d'un ordre professionnel, et l'art. 32.1 de la
*Loi sur le notariat* vise l'intermédiaire qui « obtient d'un notaire qu'il
abandonne une partie de ses honoraires et frais ».

**Le prix de Nota ne dépend jamais du notaire** — ni de sa cote, ni de son
historique, ni de la valeur de l'acte. Un notaire chevronné et un notaire qui
débute vous coûtent exactement la même chose en frais de plateforme.

**La grille en vigueur.** Le prix de Nota se lit sur deux lignes que vous voyez
avant de vous engager :

| Prix de Nota | Financement hypothécaire | Refinancement hypothécaire |
| --- | ---: | ---: |
| Le service | **199 $** | **249 $** |

| Garantie de date, ajoutée au prix ci-dessus | 15 jours et plus | 8 à 14 jours | 2 à 7 jours | Demain | Aujourd'hui |
| --- | ---: | ---: | ---: | ---: | ---: |
| | 0 $ | **50 $** | **100 $** | **200 $** | **300 $** |

Nota peut modifier cette grille, mais **jamais rétroactivement** : les deux
lignes sont figées sur votre offre au moment où votre carte est engagée, et
c'est ce total-là qui sera prélevé.

*(Décisions : `docs/decisions/0031-le-prix-de-nota-est-celui-de-nota.md` et
`docs/decisions/0034-le-prix-de-nota-est-une-grille-par-service.md`.)*

> **Ce qui a changé.** Jusqu'au 1<sup>er</sup> septembre 2026, ces conditions
> annonçaient que Nota conservait de 5 % à 15 % de votre montant, selon la cote
> du notaire. **Ce modèle est retiré**, et le texte ci-dessus le remplace.
> Aucun acte n'a été porté sur la plateforme sous l'ancien modèle.

> **Ce que ce prix ne comprend pas, et qui reste à trancher.** Les **taxes**
> (TPS/TVQ) et les **débours** — droits de publication au registre foncier,
> RDPRM, radiations — n'apparaissent aujourd'hui **nulle part dans le
> produit**. Ni le montant que vous offrez ni le prix de Nota n'en portent.
> Tant que ce point n'est pas réglé, aucune surface ne doit affirmer que le
> montant est « tout compris » : l'art. 71 3° du *Code de déontologie* exige
> d'indiquer si les débours et les taxes sont ou non inclus, et l'art. 68
> interdit la publicité incomplète.

---

## 4. Comment vous payez

**Vous payez Nota.** Votre carte est débitée une fois, pour le total des deux
lignes ; Nota vire ensuite au notaire ses honoraires, en entier.

1. **À la publication**, votre carte est **autorisée**, pas débitée. Le montant
   réservé est le **total des deux lignes** — vos honoraires offerts plus le
   prix de Nota (`apps/api/src/handler.js`, route `POST /bids` ;
   `apps/api/src/stripe-port.js:85-116` : session de paiement au nom de Nota,
   capture manuelle).
2. **Si personne ne retient votre demande**, la réservation prend fin d'elle-même,
   **sans frais**.
3. **À la signature de l'acte**, Nota capture **exactement le montant du
   règlement, jamais davantage** (`amount_to_capture`,
   `apps/api/src/stripe-port.js`, `captureAndTransfer`), et vire au notaire ses
   honoraires entiers. Si l'acte vaut finalement moins que ce que vous aviez
   offert, vous êtes débité de moins : l'écart n'est jamais conservé.

**Nota ne voit jamais votre numéro de carte.** Le paiement est hébergé par
Stripe (`apps/api/src/stripe-port.js:14`).

**Une fois l'acte réglé, vous voyez les deux lignes de ce que vous avez payé** —
les honoraires du notaire et le prix de Nota, côte à côte. Les chiffres viennent
du registre d'écriture unique, pas d'un calcul refait après coup
(`apps/api/src/handler.js`, `GET /client/bid`, champ `acte`).

**Nota ne voit jamais votre numéro de carte.** Le paiement est hébergé par
Stripe (`apps/api/src/stripe-port.js:14`).

**Une fois l'acte réglé, vous voyez comment votre montant s'est partagé** — les
chiffres viennent du registre d'écriture unique, pas d'un calcul refait après
coup (`apps/api/src/handler.js:1806-1809`).

Si un notaire vous propose un **autre montant** que celui que vous avez offert et
que vous l'acceptez, la réservation initiale est libérée : elle ne peut pas régler
un montant différent.

---

## 5. Annulation et frais

Tant que votre offre **n'a pas été retenue**, vous la retirez du carnet **sans
frais**.

Une fois votre offre **retenue par un notaire**, l'annulation entraîne des frais,
prélevés sur la réservation déjà posée sur votre carte :

| Vous annulez | Frais retenus |
| --- | ---: |
| à 3 jours ou moins de la date de signature | **30 %** du montant convenu |
| entre 4 et 14 jours | **10 %** |
| à plus de 14 jours | **aucun** |

Le reste de la réservation vous est libéré immédiatement.

*(Source : `apps/api/src/cancellation-config.js:25-28`. Le prélèvement est une
capture partielle, `apps/api/src/stripe-port.js:166-174`.)*

> ⚠️ **À corriger.** Ce barème **n'apparaît nulle part dans les conditions
> affichées** : le client ne le découvre qu'au moment d'annuler
> (`apps/web/public/app.js:3534-3535`). Un frais doit être divulgué **avant**
> l'engagement, pas au moment de le rompre.

**Un acte signé et réglé ne peut plus être annulé** (`handler.js:1843-1846`).

---

## 6. Votre dossier

Les réponses que vous inscrivez à votre dossier accompagnent votre offre. **Les
documents eux-mêmes ne sont partagés qu'après qu'un notaire a retenu votre
demande**, et seulement si vous avez coché le consentement de partage.

**Les fichiers que vous joignez ne quittent jamais votre appareil.** Nota
n'enregistre que le **nom** du document, assaini
(`packages/domain/index.js:1821-1830`). C'est vous qui transmettez le document au
notaire, de manière sécurisée, une fois la mise en relation faite.

---

## 7. Évaluation — et pourquoi Nota n'affiche pas de notes

Une fois l'acte signé et réglé, vous pouvez évaluer le notaire. Votre évaluation
est **anonyme** pour lui : le registre qu'il consulte ne porte jamais votre
identité (`apps/api/src/handler.js:1474-1476`).

Votre évaluation influence la part que ce notaire recevra sur ses actes futurs
(section 3). Elle ne modifie jamais le montant que vous avez payé.

### Nota ne publie aucune note ni aucun avis sur un notaire

**Vous ne verrez jamais, sur Nota, une moyenne d'étoiles, un nombre d'avis ou une
note sur 100 concernant un notaire.** Ce n'est pas un manque : c'est une
obligation.

Le *Code de déontologie des notaires* (art. 70) interdit au notaire d'utiliser
« **ou de permettre que soit utilisé** » un témoignage d'appui qui le concerne —
**sans exception pour les avis authentiques**. Une plateforme qui afficherait des
évaluations mettrait ses propres notaires en défaut.

Ce que Nota vous montre à la place, ce sont des **faits vérifiables** :

- l'**appartenance à la Chambre des notaires du Québec**, et le lien vers la
  fiche officielle une fois le notaire retenu ;
- le **nombre d'actes** que ce notaire a portés sur Nota ;
- son étude, son prix, le délai et le déplacement proposés.

*(Comportement vérifié : `apps/api/src/handler.js:1763-1771` et `:1797-1801` ;
garanti par `apps/api/test/deontologie-avis.test.mjs` et
`apps/web/test/client-cote.test.mjs`, qui échouent si une note réapparaît.
Décision : `docs/decisions/0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md`.)*

Les évaluations continuent d'être **recueillies** : elles servent à Nota pour
l'affectation et la qualité, et au notaire pour son propre suivi. Elles ne sont
simplement jamais publiées.

---

## 8. Disponibilité et responsabilité

**Disponibilité.** Le service est fourni « tel quel ». Nota vise une haute
disponibilité sans garantir l'absence d'interruption, et peut suspendre ou
refuser une offre contraire aux présentes conditions.

**Responsabilité.** Dans la mesure permise par la loi, la responsabilité de Nota
se limite à la mise en relation. **La qualité, la validité et l'exécution de
l'acte relèvent du notaire.**

*(Reprise de `index.html:1150-1151`.)*

**Recours professionnel.** Le notaire qui vous sert doit être membre de la
Chambre des notaires du Québec et soumis à son *Code de déontologie*, à son inspection
professionnelle, à son syndic et au fonds d'indemnisation. Un différend portant
sur l'acte, les honoraires ou la conduite du notaire relève de ces mécanismes,
non de Nota.

> ⚠️ **À ajouter au produit.** Aucune de ces informations n'est aujourd'hui
> communiquée au client : la Chambre n'apparaît dans l'application que comme un
> lien de vérification sur la fiche du notaire (`index.html:790`). Aucune mention
> d'assurance responsabilité professionnelle, d'inspection, de syndic ni de fonds
> d'indemnisation n'existe dans le produit.

---

## 9. Renseignements personnels

Le traitement de vos renseignements est décrit dans la
[politique de confidentialité](politique-confidentialite.md), conforme à la
**Loi 25** du Québec. Vos données sont hébergées **au Canada** (Amazon Web
Services, région `ca-central-1`, Montréal).

---

## 10. Communications

En publiant une offre, vous acceptez de recevoir les courriels nécessaires au
suivi de votre demande. Chaque message porte l'identification de l'expéditeur et
un lien de désabonnement fonctionnel (`apps/api/src/emails.js:214-252`).

Se désabonner interrompt **tous** les envois à cette adresse, y compris ceux
relatifs à votre offre en cours (`apps/api/src/notifications.js:92`).

---

## 11. Modifications, droit applicable, contact

**Modifications.** Ces conditions peuvent évoluer. La version en vigueur est
celle affichée, avec son numéro et sa date. Les changements importants vous
seront signalés.

**Droit applicable.** Ces conditions sont régies par le droit du Québec. Tout
litige relève des tribunaux du district judiciaire de Québec.

**Acceptation.** En utilisant Nota, vous acceptez ces conditions.

> ⚠️ **À corriger.** L'acceptation n'est aujourd'hui **enregistrée nulle part** :
> aucune case, aucune version, aucun horodatage
> (recherche de `tos`, `cgu`, `termsAccepted`, `accepted_at` dans
> `apps/api/src/` → zéro résultat). Nota ne peut donc pas prouver qu'un client a
> accepté une version donnée. Il faut enregistrer, à la publication de la
> première offre, la version acceptée et son horodatage.

**Contact.** `bonjour@nota.ca` · Confidentialité : `confidentialite@nota.ca`
