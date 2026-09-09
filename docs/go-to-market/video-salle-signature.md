# La vidéo de démonstration — la salle de signature (bêta)

Ce document est le plan de tournage, de montage et de publication de **la** vidéo
qui montre la salle de signature à distance. Elle a une seule audience et un
seul but : que la Chambre des notaires du Québec, et les notaires qui la
regarderont, aient envie de la voir de plus près.

Elle est **bêta**, et elle le dit partout — dans le titre, dans les premières
secondes, en incrustation permanente, et dans la description. La raison n'est
pas la prudence juridique : une salle de signature notariée qui se déclare prête
sans audit externe est un risque pour le notaire qui l'utilise, pas seulement
pour Nota.

---

## 1. Ce que la vidéo montre, et ce qu'elle ne dit pas

**Elle montre** une cérémonie complète : deux personnes se voient et s'entendent
par un lien pair à pair, le notaire conduit, l'identité s'établit hors du canal
vidéo, la chaîne d'authentification se lit à voix haute, la personne perd son
réseau et la séance se suspend d'elle-même, le notaire la reprend, la signature
se libère, le procès-verbal se scelle sur une empreinte.

**Elle ne dit pas**, et aucune ligne de narration ne doit le laisser entendre :

- que Nota est approuvée, certifiée, reconnue ou évaluée par la Chambre ;
- que la salle est conforme aux *Normes concernant l'acte notarié en minute sur
  un support technologique* ;
- que Nota appose une signature notariale, ou produit une minute ;
- que l'enregistrement, quand il existe, a une valeur probante particulière.

La phrase qui tient tout le reste, et qui est dite **deux fois** dans la vidéo :

> La cérémonie est de Nota. La signature juridique est du fournisseur admis par
> la Chambre. La preuve est de Nota, et elle est remise au notaire.

---

## 2. Comment on la tourne

Par le code, pas à la main :

```sh
npm run demo:salle
```

Deux navigateurs réels jouent la séance de bout en bout et déposent dans
`demo/sortie/` les deux points de vue, un master 1080p et l'horodatage de chaque
moment. Le détail est dans [`demo/README.md`](../../demo/README.md).

Deux conséquences, et ce sont les deux raisons de faire ainsi :

1. **Rien n'est mis en scène.** La connexion est un vrai lien pair à pair, la
   suspension est un vrai silence constaté par le serveur, l'empreinte est une
   vraie empreinte. Une capture d'écran retouchée ne survit pas à la première
   question technique ; celle-ci si.
2. **La vidéo se refait.** Quand la salle change, on relance la commande. Une
   démonstration qui coûte une journée de tournage ne se met jamais à jour, et
   finit par montrer un produit qui n'existe plus.

La caméra est la mire de Chromium — un motif de test. **Aucune personne réelle
n'est filmée pour une démonstration**, et surtout aucun acte réel n'est joué.
C'est une contrainte, pas un pis-aller : le tournage d'une fausse séance avec de
vrais visages produirait un document qui ressemble à un acte.

Un filigrane « bêta · démonstration · aucun acte réel » est incrusté **dans la
page**, donc dans la vidéo, donc dans toute capture d'écran qu'on en tirera. Une
capture circule sans son titre.

---

## 3. Le déroulé, minute par minute

Les temps sont ceux du fichier `chapitres.json` produit par la commande, arrondis
au montage. La colonne « on dit » est la narration, à lire telle quelle.

| Chapitre | On voit | On dit |
| --- | --- | --- |
| **Ce que vous regardez** | Carton d'ouverture, fond noir | « Ceci est une bêta. Aucun acte réel n'est reçu dans cette démonstration. La cérémonie que vous allez voir est de Nota ; la signature juridique, elle, passe par le flux admis par la Chambre des notaires. » |
| **Ouverture** | Deux navigateurs, la salle plein écran | « Le notaire ouvre la séance. La personne la rejoint depuis chez elle. » |
| **Le lien** | Deux vidéos, le rail de droite | « Le lien est pair à pair, chiffré de bout en bout par le navigateur. Il n'y a pas de serveur média chez Nota — pas parce qu'on l'a désactivé, parce qu'il n'y en a pas. » |
| **La chaîne d'authentification** | La chaîne, en grand, des deux côtés | « Les deux écrans affichent la même chaîne, dérivée des empreintes des deux navigateurs. On la lit à voix haute. Un intercepteur négocierait deux liens distincts : il ne pourrait pas faire dire le même mot aux deux côtés. Si les chaînes diffèrent, on arrête la séance. » |
| **L'identité** | Le notaire atteste, la porte s'ouvre | « L'identité s'établit hors du canal vidéo, et l'attestation porte sa méthode, son heure et son vérificateur. Une fenêtre vidéo n'est pas une pièce d'identité. » |
| **Le lien confirmé** | La porte « lien » passe au vert | « Le notaire confirme que les deux chaînes concordent. C'est lui qui le fait, et c'est consigné. » |
| **Consentement** | Les deux boutons, les deux réponses | « La question est posée à chacun séparément, et la réponse est horodatée. Ici, rien n'est enregistré : la preuve de la séance est le procès-verbal. » |
| **Lecture de l'acte** | Le texte de conduite dans le rail | « Ce que le notaire a à dire à chaque étape vient des règles du domaine, pas d'une maquette d'écran. » |
| **La coupure** ⟵ *le moment de la vidéo* | La personne perd le réseau ; la séance passe en « suspendue » | « Le notaire doit voir et entendre **pendant** toute la séance. Personne n'a cliqué : le serveur a constaté le silence, daté la coupure au dernier signe de vie, et la signature est redevenue impossible. » |
| **La reprise** | Le lien revient ; la séance reste suspendue ; le notaire clique | « Le lien qui revient ne redémarre pas un acte. La reprise est un geste du notaire, et elle repart de l'étape en cours — jamais plus loin. » |
| **La signature** | Les quatre portes ouvertes, le bouton s'active | « Les quatre portes sont ouvertes : compte, identité, lien, présence. Nota libère la signature vers le flux admis par la Chambre. L'acte prend sa forme définitive là, pas ici. » |
| **Le sceau** | L'empreinte, en entier, à l'écran | « Le procès-verbal se ferme sur une empreinte. Chaque entrée porte celle de la précédente : retirer une ligne, en ajouter une ou changer un mot casse la chaîne, et la casse se voit. La preuve tient sans qu'on ait à croire Nota sur parole. » |
| **Ce qui reste à faire** | Carton de fin, la liste | « Trois choses manquent avant un acte réel : l'évaluation par la Chambre, le fournisseur de signature admis, et le fournisseur de vérification d'identité. Elles sont écrites, publiquement, dans le dépôt. C'est pour cela que cette salle est en bêta. » |

Durée cible du montage : **4 à 5 minutes**. La séance enregistrée en dure environ
100 secondes ; les respirations, les cartons et les arrêts sur image font le
reste. Ne pas dépasser six minutes : au-delà, une démonstration se regarde en
diagonale.

---

## 4. Le montage

- **Format.** 1920 × 1080, les deux points de vue côte à côte, le notaire à
  gauche. C'est le montage que produit `npm run demo:salle` quand `ffmpeg` est
  installé.
- **Titrage.** Chaque chapitre s'ouvre sur un tiers inférieur qui reprend son
  nom. Les noms sont ceux du tableau ci-dessus, mot pour mot.
- **Le filigrane reste**, toujours, sans exception, y compris sur les cartons.
- **Arrêts sur image** de deux secondes : sur la chaîne d'authentification, sur
  le passage en « suspendue », et sur l'empreinte du sceau. Ce sont les trois
  images qu'un spectateur mettra en pause.
- **Pas de musique** sous la narration. Une démonstration de sécurité avec une
  nappe de synthétiseur se regarde comme une publicité.
- **Sous-titres** en français, brûlés ou en piste. La version anglaise est un
  second fichier de sous-titres, pas un second tournage.

---

## 5. La publication

**Titre** — il porte la mention, parce qu'un titre voyage seul :

> Nota — la salle de signature notariale à distance (bêta)

**Visibilité.** Non répertoriée au premier envoi : la vidéo part par lien, dans
les courriels à la Chambre et aux notaires de la vague 1. Elle passe en publique
seulement une fois qu'un notaire l'a regardée et n'a rien trouvé à corriger.

**Miniature.** L'arrêt sur image de la chaîne d'authentification, avec le
bandeau bêta visible. Pas de visage, pas de flèche rouge, pas de « ENFIN ! ».

**Description** — à coller telle quelle :

```
Une cérémonie de signature à distance, de bout en bout, entre un notaire et
une personne. Fonctionnalité en BÊTA : aucun acte réel n'est reçu dans cette
démonstration.

Ce que vous voyez :
· un lien vidéo pair à pair, chiffré par le navigateur — Nota n'a pas de
  serveur média, donc rien à écouter ;
· une chaîne d'authentification lue à voix haute des deux côtés, qui détecte
  un interposé ;
· quatre conditions vérifiées avant toute signature : comptes authentifiés,
  identité vérifiée hors du canal vidéo, lien privé confirmé, présence
  continue ;
· une coupure de réseau qui SUSPEND la séance d'elle-même, et une reprise qui
  n'appartient qu'au notaire ;
· un procès-verbal scellé par une chaîne d'empreintes : modifier une ligne se
  voit.

Ce que Nota ne prétend pas :
Nota n'est ni approuvée ni évaluée par la Chambre des notaires du Québec. La
cérémonie est de Nota. La signature juridique est du fournisseur admis par la
Chambre. La preuve est de Nota, et elle est remise au notaire.

Ce qui manque avant un acte réel, et qui est écrit publiquement : l'évaluation
par la Chambre, l'adaptateur du fournisseur de signature admis, et le
fournisseur de vérification d'identité.

Chapitres
0:00 Ce que vous regardez
...
```

Les horodatages des chapitres se recopient depuis `demo/sortie/chapitres.json`
après le montage — ils bougent à chaque tournage, donc ils ne sont pas figés ici.

**Commentaires.** Ouverts, et surveillés. Une question technique sans réponse
sous une vidéo de sécurité vaut une objection non traitée en réunion.

---

## 6. Ce qui doit être vrai avant de publier

Une liste de refus, pas de souhaits. Si une ligne est fausse, la vidéo ne sort
pas.

- [ ] Le filigrane est visible sur **chaque** image, cartons compris.
- [ ] La narration ne contient aucune des quatre affirmations interdites (§1).
- [ ] La description porte le paragraphe « Ce que Nota ne prétend pas », entier.
- [ ] Aucun nom, courriel, adresse ou montant réel n'apparaît à l'écran.
- [ ] L'empreinte montrée est celle d'une séance de **démonstration** — le
      procès-verbal le porte en première entrée, dans la chaîne.
- [ ] Un notaire l'a regardée avant la Chambre.

---

## 7. Après

La vidéo n'est pas la fin, c'est une invitation. Elle finit sur une demande
précise — voir la salle en direct, trente minutes, avec le notaire qui répond —
et la présentation, elle, est scriptée dans
[`../secure-signing-plan.md`](../secure-signing-plan.md).
