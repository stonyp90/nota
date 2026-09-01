# 0030 — La déontologie prime : la cote ne se publie pas au client

Date : 2026-09-01

Statut : accepté — restreint l'[ADR 0021](0021-notary-sees-evaluations-nota-decides-bonus.md) et l'[ADR 0028](0028-la-cote-sur-100-decide-le-partage.md)

## Contexte

Le propriétaire, le 2026-09-01, après lecture de la veille des plateformes :

> « Ça serait de ne pas être à l'encontre du Code de déontologie des notaires.
> Ceci est primordial. »

C'est une hiérarchie, pas une préférence : la conformité déontologique passe
avant la valeur produit d'un signal de confiance.

La veille (`docs/go-to-market/veille-notation-plateformes.md`, §6.6) a mis au
dossier trois dispositions que l'ADR 0027 n'avait pas vues — il n'avait retenu
que le partage d'honoraires.

**Article 70 du Code de déontologie des notaires (N-3, r. 2).**

> « Le notaire ne peut, dans sa publicité, utiliser **ou permettre que soit
> utilisé** un témoignage d'appui ou de reconnaissance qui le concerne, à
> l'exception des prix d'excellence et autres mérites soulignant une
> contribution ou une réalisation dont l'honneur a rejailli sur la profession. »

Il n'y a **aucune exception pour les avis authentiques**. Et « permettre que
soit utilisé » atteint le notaire simplement listé sur une plateforme qui
affiche des évaluations le concernant : c'est nous qui le mettons en défaut,
pas lui.

**Le raisonnement d'Avvo.** L'avis 1132 du barreau de l'État de New York tient
qu'**afficher une note transforme un annuaire en recommandation** — et une
recommandation rémunérée est interdite. Notre cote n'est pas une décoration :
elle décide combien Nota prélève. Affichée au client, elle est exactement cela.

**Ce que le régulateur exigera de la cote elle-même.** La formulation la plus
claire vient du New Jersey : une distinction ne peut être citée que si celui
qui la décerne a enquêté sur la compétence, ne la vend pas, et publie « a
truthful, plain language description of the standard or methodology » ouverte à
l'inspection. Nota est la seule plateforme étudiée capable de satisfaire ce
critère — mais cela conditionne l'usage de la cote, cela ne l'autorise pas.

## Décision

**Aucune appréciation portant sur un notaire nommé ne voyage vers un client.**

Ce qui est retiré des vues client (`GET /client/bid` : bloc `notaire` et chaque
proposition, et les écrans web correspondants) :

- la moyenne d'étoiles et le nombre d'avis (`rating`) ;
- la cote sur 100 (`cote`) ;
- la phrase qui expliquait au client ce que la cote agrège.

Ce qui reste publiable, parce que ce sont des **faits vérifiables** et non des
témoignages :

- `cnq` — l'inscription au tableau de la Chambre des notaires, déjà l'autorité
  de l'ADR 0016, et `lienCNQ` une fois l'acte retenu ;
- `actes` — le nombre d'actes portés sur Nota. Un compte n'est pas une
  appréciation ; il ne dit pas que le notaire est bon, il dit ce qu'il a fait ;
- l'étude, le prix proposé, le délai, le déplacement, le prêteur.

Ce qui ne change pas :

- **Nota continue de recueillir les évaluations.** La collecte n'est pas la
  publication : l'invitation à évaluer part toujours après le règlement, et le
  registre `NOTARY#/EVAL#` (ADR 0021) reste écrit.
- **Le notaire voit tout de son propre dossier** — sa moyenne, chaque
  commentaire, sa cote, ses quatre axes, son palmarès par service. Son dossier
  n'est pas sa publicité.
- **Nota voit tout** (registre `/admin/notaries`) : c'est l'outil d'affectation
  et de qualité, un usage interne que rien dans le Code ne restreint.
- **La cote continue de décider le partage** (ADR 0028). Elle est communiquée
  au notaire, avant qu'il s'engage, avec le barème complet.

**Une seconde porte fermée le même jour : le parrainage.** Le programme de
l'ADR 0011 verse 50 $ pour un client amené et 250 $ pour un notaire amené qui
complète son premier acte. L'**article 33** interdit au notaire, hors la
rémunération et les commissions auxquelles il a droit, de verser ou de recevoir
« tout autre avantage » relatif à l'exercice de sa profession. Un notaire qui
réclamerait un code recevrait exactement cela — et là encore, c'est nous qui le
mettrions en défaut. `POST /partenaires` refuse désormais une réclamation dont
le courriel correspond à un notaire connu (`notaire_non_admissible`, 422), en
disant pourquoi — et `POST /partenaires/verify` refait le contrôle, parce que
c'est là qu'un code devient le **payeur de record** et que le profil notaire a
pu naître entre les deux étapes.

Le courriel est la seule clé dont Nota dispose, et il faut le dire : un notaire
qui réclame avec une adresse personnelle passe, et rien ne recoupe l'identité
contre le tableau de l'Ordre. Le contrôle porte aussi sur la réclamation, jamais
sur le versement — un parrain devenu notaire après coup continue d'accumuler.
Fermer ces angles suppose une vérification réelle de l'appartenance à l'Ordre,
c'est-à-dire le même chantier que le badge CNQ. Ce n'est donc pas un contrôle
infaillible : c'est celui qui ne coûte rien à un partenaire qui n'est pas
notaire, et qui ferme la porte la plus large.

## Conséquences

**Ce que Nota perd.** Le signal de confiance côté client. Un client qui compare
deux propositions voit deux études, deux prix, deux appartenances à l'Ordre et
deux volumes d'actes — pas deux notes. C'est un vrai coût produit, assumé.

**Ce que Nota garde.** Une cote qui reste le meilleur moteur d'affectation et de
rémunération du marché, et — parce qu'elle n'est plus affichée comme une
recommandation — un argument plus simple devant la Chambre : Nota ne classe pas
les notaires devant le public, il les rémunère selon un barème publié.

**Dans le code.** La frontière est marquée là où elle se franchirait :
`notaryRating` porte l'avertissement en commentaire, `notaryCote` a disparu du
handler public, et `apps/api/test/deontologie-avis.test.mjs` échoue si une
moyenne, un compte d'avis ou une cote réapparaît dans une réponse client. Côté
web, un test balaie le DOM des vues client et échoue sur une étoile, un « /100 »
ou le mot « cote ».

**Ce qui reste ouvert — et qui est plus lourd que ce que cet ADR règle.**

1. **L'article 32.1 de la *Loi sur le notariat*** (en vigueur le 24 octobre
   2023) présume usurper les fonctions de notaire l'intermédiaire qui « obtient
   d'un notaire qu'il abandonne une partie de ses honoraires » — 2 500 $ à
   125 000 $, doublé en récidive. Et la Chambre a prévenu le 25 janvier 2024
   qu'il est « proscrit […] de laisser un intermédiaire offrir vos services,
   dicter votre conduite ou la portée de votre mandat ou fixer ou partager vos
   honoraires ». Le modèle économique de l'ADR 0028 doit être qualifié contre
   ce texte. Ne pas afficher la cote n'y répond pas.
2. **L'article 32** interdit le partage d'honoraires avec un non-membre, la
   liste d'exceptions étant fermée ; l'**article 33** ferme le contournement
   (« tout autre avantage »).
3. **L'article 72** interdit au notaire d'accorder plus d'importance aux
   honoraires qu'au service professionnel — contrainte directe sur une
   interface qui est, par construction, un marché de prix et de dates.
4. **L'avis juridique écrit budgété (20 000 $) reste requis avant la mise en
   service**, et son mandat s'élargit : il ne couvre plus seulement le partage
   d'honoraires, mais aussi l'affichage des avis, la qualification de la cote,
   et la présentation des prix.

## Alternatives écartées

- **Publier la cote sans les avis.** Écarté : la cote est *dérivée* des avis à
  40 %, et le raisonnement d'Avvo porte sur la note affichée, pas sur sa
  matière première.
- **Publier les avis sous forme anonyme ou agrégée.** Écarté : l'article 70 vise
  le témoignage qui concerne le notaire, pas l'identité de son auteur.
- **Demander à chaque notaire son consentement à l'affichage.** Écarté : le Code
  interdit au notaire de *permettre* cet usage — un consentement le mettrait
  précisément en défaut.
- **Attendre l'avis juridique avant de retirer.** Écarté par le propriétaire :
  la conformité prime, et le retrait est réversible en une ligne si l'avis
  conclut autrement.
