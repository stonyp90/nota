# 0033 — La mise en relation est complète, et la conversation est le canal

Date : 2026-09-02

Statut : accepté — **étend l'ADR 0010 §4, l'ADR 0013 et l'ADR 0026 ; amende
l'ADR 0023 (§ argent) ; rend caduque la phrase « Messages send no email » de
l'ADR 0013**

## Contexte

Le propriétaire a demandé, le 2 septembre 2026, que l'expérience de connexion
entre un notaire et la personne qui demande un acte soit **très simple** : que
les informations du client et du notaire soient fournies, qu'ils se parlent
dans une messagerie **sur Nota**, que les notifications suivent, que les
annulations soient claires — qui paie quoi — et que **tout soit exposé au
notaire avant qu'il confirme** prendre l'acte. Il a ajouté qu'une section
illustrée devait rassurer les notaires, dans le film d'introduction, sur les
articles de loi qui encadrent la facturation.

Quatre cartographies du code (messagerie, rétention, annulation, notifications)
ont établi l'état réel, qui contredisait l'intention sur plusieurs points :

1. **Le notaire n'avait pas d'identité.** Son profil ne portait ni nom, ni
   téléphone, ni adresse d'étude ; l'« étude » montrée au client était, par
   défaut, **son adresse courriel** (`label = email`, et aucune route ne
   l'écrivait jamais). Un client qui avait choisi « je me déplace à l'étude »
   ne recevait jamais l'adresse de l'étude.
2. **Le client n'avait pas de nom.** L'offre est anonyme par défaut, et le
   formulaire ne demandait le nom qu'en mode non anonyme : le notaire recevait
   `nom: null` sur la plupart des dossiers, malgré le commentaire de l'API
   qui affirmait le contraire.
3. **Le notaire qui retenait n'était jamais avisé par courriel** (seul le
   client l'était, par un courriel qui ne nommait pas le notaire et pointait
   sur `#dossier`). Aucun courriel ne menait à l'acte lui-même, et le jeton
   client vivait uniquement dans le navigateur qui avait publié : sur un autre
   appareil, le lien du courriel ouvrait une page vide.
4. **Le bouton « Retenir » ne divulguait que le montant.** Ni le barème
   d'annulation, ni le droit de se désister, ni le prix que le client paie à
   Nota (`tarif` était reçu et jamais affiché), ni la liste des pièces
   manquantes.
5. **L'argent de l'annulation tardive allait à Nota.** Les frais (30 % / 10 %
   des honoraires offerts) étaient capturés sur la caution et gardés par la
   plateforme ; le notaire — celui qui avait bloqué la journée — ne recevait
   rien, n'était prévenu de rien, et son courriel d'annulation promettait
   « notre équipe vous écrit pour régulariser », ce qui n'arrivait jamais.
6. **La messagerie n'avait ni non-lu, ni heure, ni défilement, ni sondage
   côté client**, et le widget de soutien « Une question ? » n'avait ni
   indicateur de réponse, ni heure, ni nom d'expéditeur, et ses bulles
   n'étaient pas alignées (collision de classes CSS avec la messagerie
   retenue).

## Décision

### 1. Les deux parties se présentent — et le notaire ne peut retenir qu'une fois joignable

Le profil notaire porte **nom, étude, téléphone, adresse** (`validateNotaryProfile`,
domaine). Les trois champs `nom`, `telephone`, `adresse` forment
`NOTARY_CONTACT_REQUIRED` ; `notaryContactMissing(profile)` liste ce qui manque.
**Retenir et proposer exigent un profil complet** : l'API répond
`403 profil_incomplet` avec la liste, la console affiche la règle avant tout
clic et ouvre le profil à la place. La règle est du domaine : un client doit
pouvoir appeler son notaire et se présenter à son étude.

Le nom affiché au client est `notaryEtude(profile)` : l'étude déclarée, sinon
l'ancien libellé, sinon le nom, sinon le courriel — plus jamais un courriel
quand un nom existe.

Côté client, le **nom est demandé toujours** (l'anonymat ne porte que sur le
carnet public — ce que l'API faisait déjà, et que le formulaire contredisait),
le **courriel est requis** dans le formulaire (c'est le seul canal qui prévient
le client qu'un notaire a retenu sa demande), le **téléphone est recommandé**
et validé par le domaine (`validateTelephone`, qui remplace la règle inline de
l'API). L'API reste tolérante sur `nom` et `courriel` (des offres existantes et
des appels d'intégration n'ont pas à casser) ; le formulaire est strict.

### 2. La conversation Nota est le canal, et chaque partie voit l'autre au-dessus du fil

Sur l'acte retenu, chaque partie voit d'abord une **fiche de contact** de
l'autre — nom, téléphone (lien `tel:`), courriel, et pour le notaire
l'adresse de l'étude (lien carte), la fiche CNQ et le nombre d'actes ; pour le
client le secteur, le déplacement choisi, le prêteur — puis la conversation.
Aucune note, moyenne ou cote sur un notaire nommé côté client (ADR 0030).

La messagerie gagne ce qui manquait à une conversation : **non-lu** (par
appareil, `nota.seen.v1` / `nota.nc.seen.v1`), heure sur chaque message,
défilement en bas, compteur, état d'envoi, erreur en ligne, **sondage côté
client** pendant que l'onglet est visible, et un sondage notaire qui ne
s'arrête plus indéfiniment quand le curseur est dans le champ.

### 3. Les notifications suivent — dans les deux sens, et jusqu'à l'acte

- **Le notaire qui retient reçoit un courriel** (`demandeRetenueNotaire`) avec
  la fiche du client, l'état du dossier et ce qui l'engage ; l'opérateur est
  avisé (`operatorDemandeRetenue`).
- **Le client reçoit un courriel qui nomme son notaire**, avec téléphone et
  adresse, qui dit que la conversation se tient dans Nota, que le notaire peut
  encore se désister, et ce que coûterait une annulation.
- **Chaque courriel mène à l'acte.** Les courriels du client portent un lien
  `#offre=<id>&d=<date>&cle=<jeton>` — un jeton de portée `CLIENT`, 30 jours,
  signé par l'API — qui rend la demande accessible depuis n'importe quel
  appareil ; les courriels du notaire portent `#notaires&acte=<id>`. Même
  classe de risque que le lien de réponse du soutien (ADR 0026) : une
  capacité sur UNE offre, à durée courte.
- **Une nouvelle demande peut prévenir instantanément** les notaires qui l'ont
  demandé : les préférences d'alerte (`alertes.pace`, `urgentOnly`) deviennent
  des données du profil côté serveur ; le résumé quotidien reste le défaut.
  L'interrupteur « texto » disparaît : aucun adaptateur SMS n'existe, et une
  interface ne promet pas ce qu'elle ne tient pas.
- L'ADR 0013 disait « les messages n'envoient pas de courriel » ; c'était faux
  depuis l'ADR 0018. Cet ADR le constate.

### 4. Tout est exposé au notaire avant qu'il confirme

« Retenir » ouvre une **feuille de confirmation** qui dit, avant le geste :
l'acte, la date, les honoraires (versés en entier à la signature — ADR 0031),
le prix que le client paie à Nota à côté (`conditions.tarifNota`), le
déplacement, le secteur et la distance, le prêteur, les pièces manquantes du
dossier, **le barème d'annulation en vigueur appliqué à ce montant** et à qui
vont les frais, le droit de se désister (gratuit, compté), et ce que chaque
partie recevra de l'autre à la rétention. Le barème voyage dans la réponse de
`GET /notary/bids` (`conditions`) : c'est une donnée d'exploitation (ADR 0023),
jamais une constante de l'interface.

### 5. Qui paie l'annulation — et qui la reçoit

**Le client paie**, sur la caution qu'il a déjà autorisée, selon le barème
(défaut : 30 % à 0–3 jours, 10 % à 4–14 jours, gratuit à 15 jours et plus),
et il le voit avant de confirmer (ADR 0023, inchangé).

**Le notaire reçoit ces frais en dédommagement** de la journée bloquée. Ce
n'est pas seulement une question d'équité : les frais sont calculés sur les
honoraires du notaire, et **une plateforme qui garderait une part calculée sur
les honoraires d'un notaire décrit précisément l'opération que l'art. 32.1 2°
de la *Loi sur le notariat* et l'art. 32 du *Code de déontologie* interdisent**
(ADR 0031). Nota ne garde rien de ces frais et ne facture pas son propre prix
sur un acte annulé. Mécanique : la capture partielle existante, puis un
virement Stripe au compte du notaire (`cancelfee-transfer:<bidId>`) ; quand ses
versements ne sont pas branchés, le montant est inscrit comme **dû au notaire**
(`dedommagementCentsDue`) — jamais comme un revenu de Nota. Le courriel du
notaire dit le montant qu'il reçoit ; celui du client dit ce qui a été retenu
et à qui cela va.

**Le notaire qui se désiste ne paie rien** — le Code lui impose de refuser un
mandat qu'il ne peut pas porter — mais le désistement est **compté à son
dossier** (`releasesCount`) et **l'opérateur est toujours prévenu**. Le client
garde sa date et son offre (ADR 0013).

### 6. Le film d'introduction rassure sur le droit

Le film notaire gagne une scène « Nota respecte les règles de votre
profession » : art. 32.1 L.N. (aucune réduction ni partage des honoraires — le
notaire reçoit 100 % du montant offert), art. 32 et 29.1 C.déont. (Nota facture
son propre prix au client, à côté ; aucune convention sur les honoraires), art.
49 (le prix est ce que le client offre pour sa date, son urgence et son
déplacement — jamais fixé par Nota). Les mêmes trois tuiles vivent sous la
porte de connexion de l'Espace notaire, hors du film.

## Conséquences

- Tous les tests qui font retenir un notaire seedent désormais un profil
  complet (`apps/api/test-support/notary-fixture.mjs`) ; le mode démo
  (`NOTA_DEMO_OPEN`) seed un notaire nommé.
- `GET /notary/bids` porte `profil.complet/manquants`, `conditions`, `fenetre`
  (les mois couverts, pour que la console retire les actes annulés qu'elle
  gardait en cache indéfiniment) et une prévision `annulation` par acte retenu.
- Les courriels changent de destination : plus de partage `#dossier` /
  `#t=profil` — l'acte, toujours.
- Décisions ouvertes, hors périmètre : reverser la récompense de parrainage
  d'une offre annulée (registre EARN write-once, ADR 0011) ; un acte retenu via
  proposition acceptée (`a_reautoriser`) s'annule encore sans frais (aucune
  caution vivante) — **fermé par l'ADR 0035 §3 bis : la carte enregistrée
  survit à la renégociation, donc les frais sont prélevés hors session et versés
  au notaire** ; le recouvrement des créances (ADR 0029) ; un lien magique
  client complet (le lien par courriel couvre le besoin réel : revenir à SON
  acte depuis n'importe quel appareil).
