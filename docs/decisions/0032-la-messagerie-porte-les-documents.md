# 0032 — La messagerie porte les documents, et Nota n'en est que le dépositaire

Date : 2026-09-02

Statut : accepté — **étend l'ADR 0010 §4**, ne le renverse pas

## Contexte

L'ADR 0010 §4 dit que « Nota n'insiste pas pour être le tuyau » : après la mise
en relation, les documents circulent par le canal du notaire, et un item peut
être marqué *transmis autrement*. Aujourd'hui le produit tient cette position à
la lettre — **aucun octet ne quitte l'appareil du client**. `DOSSIER_FILE` ne
valide que le *nom déclaré* d'un fichier que le client a choisi
(`packages/domain/index.js:1798-1840`), et la messagerie retenue n'accepte que
du texte (`domain.validateChatMessage`).

Cela laisse les deux parties se débrouiller : courriel personnel, service de
transfert, clé USB à la signature. Un acte hypothécaire fait circuler un relevé
de prêt, un compte de taxes, un certificat de localisation et une pièce
d'identité — c'est-à-dire, précisément, ce qu'on ne met pas en pièce jointe d'un
courriel ordinaire.

Le propriétaire tranche : **la messagerie doit porter les documents, de façon
sécuritaire.**

## Décision

Nota offre un canal de transmission chiffré, adossé à la conversation qui existe
déjà entre le client et le notaire qui a retenu sa demande. **Le canal du
notaire reste valide** : l'ADR 0010 §4 n'est pas retiré, il gagne une option.
Marquer un document *transmis autrement* reste une réponse complète.

### 1. Nota est dépositaire, jamais destinataire

Nota conserve des octets ; elle ne lit pas les dossiers, n'en tire aucune donnée
et ne les montre à personne d'autre que les deux parties. Cette distinction
n'est pas rhétorique — elle décide de tout ce qui suit :

- **Aucun accès administrateur aux documents.** La console admin n'a ni route,
  ni permission de stockage. Un opérateur de Nota ne peut pas ouvrir la pièce
  d'identité d'un client. C'est la seule position tenable face aux **art. 35 à
  37** du *Code de déontologie* : le notaire est tenu au secret professionnel,
  et l'art. 12 lui impose de veiller au respect de la loi par les personnes qui
  collaborent avec lui. Une plateforme dont le personnel peut lire les dossiers
  de ses clients lui rend cette obligation intenable.
- **Aucune indexation, aucune analyse, aucun apprentissage** sur le contenu.

### 2. Les octets ne transitent JAMAIS par l'API

Le navigateur téléverse et télécharge **directement** vers le stockage, par une
autorisation signée à durée courte, émise par l'API. La Lambda ne voit jamais un
octet de document.

Ce n'est pas une optimisation, c'est la propriété de sécurité principale : ce
qui ne traverse pas un service ne peut pas fuir par ses journaux, sa mémoire,
ses traces d'erreur ni son observabilité. Et l'autorisation est **portée sur une
seule clé d'objet, pour une seule opération, pour quelques minutes**.

### 3. Un PORT, pas un fournisseur

`apps/api/src/storage-port.js` expose quatre gestes — `presignUpload`,
`presignDownload`, `remove`, `head` — et rien d'autre. C'est délibérément
**l'intersection** de ce que savent faire S3, Google Cloud Storage et Azure Blob
(URL signée en écriture et en lecture, expiration, type et taille contraints).
Un adaptateur S3 est fourni ; en écrire un autre ne demande aucune modification
du domaine ni des routes. C'est ce que « compatible avec les différents
fournisseurs infonuagiques » veut dire concrètement : la portabilité vit dans la
forme du port, pas dans une couche d'abstraction universelle qui finirait par
exposer le plus petit dénominateur de chacun.

Un adaptateur en mémoire sert les tests et le développement local — le dépôt
n'appelle aucun service infonuagique pour être vert.

### 4. L'accès se décide au serveur, jamais par le secret de l'URL

Une URL signée est un secret porteur : quiconque l'a l'utilise. Elle n'est donc
**jamais** la frontière d'autorisation. À chaque émission, le serveur vérifie
que le demandeur est soit le client titulaire du jeton de l'offre, soit le
notaire qui l'a retenue — la même règle que la messagerie
(`domain.validateChatMessage`) — et l'expiration est comptée en minutes.

Chaque téléversement et chaque téléchargement laisse une trace : qui, quel
document, quand.

### 5. Chiffré au repos, en transit, et effacé à date

Chiffrement géré par le fournisseur avec une clé propre à Nota, seau strictement
privé, TLS obligatoire, résidence canadienne (`ca-central-1`) comme le reste des
données (Loi 25). La conservation suit celle de l'offre — **12 mois au plus après
la date de signature**, puis effacement automatique ; une annulation efface
immédiatement.

### 6. Ce que le format contraint

Les mêmes règles que le dossier : PDF ou photo, 15 Mo, nom assaini. Le type
déclaré est **imposé dans l'autorisation elle-même** — une autorisation émise
pour un PDF ne peut pas servir à déposer autre chose — et le téléchargement
force une pièce jointe, jamais un rendu dans la page.

## Ce que cette décision ne règle pas

- **Aucune analyse antivirale.** Deux inconnus s'échangent des fichiers ; le
  produit s'appuie sur la restriction de format, le stockage inerte et le
  téléchargement en pièce jointe. C'est une atténuation, pas une réponse. Le
  jour où le volume le justifie, l'analyse s'insère derrière le port.
- **Pas de chiffrement de bout en bout.** Écarté délibérément : le notaire doit
  pouvoir ouvrir un document depuis n'importe lequel de ses appareils, et une
  clé perdue rendrait un dossier illisible au moment d'un acte. Le chiffrement
  côté fournisseur, avec une clé que Nota contrôle et dont l'usage est
  journalisé, est le compromis retenu — et il est explicitement dit au client.

## Alternatives écartées

- **Laisser le canal du notaire seul** (le statu quo). C'est ce que fait le
  produit ; le résultat est que les documents circulent par courriel ordinaire,
  hors de toute garantie. Ne rien offrir n'est pas neutre.
- **Faire transiter les octets par l'API.** Plus simple à écrire, et
  strictement pire : la Lambda entre dans le périmètre des données, la taille
  devient une limite de passerelle, et chaque trace d'erreur devient un risque.
- **Un lien public non signé, deviné difficilement.** L'obscurité n'est pas un
  contrôle d'accès.
