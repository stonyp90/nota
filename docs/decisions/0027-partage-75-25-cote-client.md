# 0027 — Le partage 75/25, payé par le client, et la part qui monte au mérite

Date : 2026-09-01

> **REMPLACÉ le 2026-09-02** par l'[ADR 0031](0031-le-prix-de-nota-est-celui-de-nota.md).
> La mécanique de rémunération décrite ici — une part des honoraires du notaire,
> indexée sur sa cote — est **retirée** : elle tombait sous l'art. 32.1 2° de la
> *Loi sur le notariat*, l'art. 32 et l'art. 29.1 du *Code de déontologie*. Ce qui
> survit de l'ADR 0028, c'est la cote elle-même et ses quatre axes ; elle ne décide
> plus d'un dollar. Document conservé tel quel : une décision ne se réécrit pas.

Statut : accepté, puis **révisé par l'[ADR 0028](0028-la-cote-sur-100-decide-le-partage.md)**
le 2026-09-01.

> **Ce qui survit.** Le client paie un montant unique, tout compris, qui se
> partage à la signature — et la part du notaire ne bouge que vers le haut,
> jamais vers le bas.
>
> **Ce qui est remplacé.** Les pourcentages (75/25, plancher 15 %) et toute la
> mécanique du mérite : les paliers à trois axes simultanés (note, avis, actes)
> cèdent la place à **une cote sur 100**. Nota prend désormais au plus 15 % et
> au moins 5 % ; le notaire garde de 85 % à 95 %. Le reste de ce document est
> laissé tel quel — un ADR est un journal, pas un état courant.

## Contexte

Depuis l'ADR 0008, Nota prélève une commission de 10 % **sur les honoraires du
notaire**, encaissée comme frais d'application Stripe Connect au moment de la
complétion. L'en-tête de `apps/api/src/billing.js` porte l'avertissement depuis
le premier jour : une part d'un acte notarié est le partage d'honoraires que le
*Code de déontologie des notaires* restreint avec un non-notaire. Le plan
d'affaires budgète 20 000 $ pour un avis écrit avant le premier acte.

Deux choses ont changé le 1<sup>er</sup> septembre 2026.

**Le propriétaire a tranché l'économie.** Le partage est **75/25** : le notaire
garde 75 % de ce que le client paie, Nota conserve 25 %, et cette part **monte
avec la notoriété du notaire et le retour des clients sur son service**. La
plateforme doit supporter ce barème à 100 % et le rendre entièrement
transparent des deux côtés.

**La veille concurrentielle a tranché la structure.** Toutes les plateformes
comparables — au Québec comme ailleurs au Canada — facturent **le client**, à
prix fixe, et paient le professionnel :

| Plateforme | Marché | Structure |
| --- | --- | --- |
| Notairo | Québec | Le client paie Notairo (vente 1 099 $, refinancement 949 $ + débours) ; Notairo assigne un notaire |
| Deeded | ON, AB | Plateforme, pas un cabinet ; tarif fixe client 1 099 $ / 999 $ ; avocats indépendants |
| Ownright (ex-Doormat) | ON | Tarif fixe client ; admis au programme d'innovation du régulateur ontarien |
| Soumissions Québec / Notaire.Solutions | Québec | Génération de demandes : le notaire paie **par piste**, convertie ou non |

Aucune ne prélève un pourcentage des honoraires du professionnel. Ce n'est pas
un hasard : c'est la structure qui survit à la réglementation professionnelle.

## Décision

**L'économie du propriétaire, dans la structure qui tient.**

1. **Le montant offert par le client est un total, tout compris.** Il ne
   s'y ajoute rien. Il se partage à la signature.
2. **75 % vont au notaire** en honoraires — c'est son acte, c'est son prix.
3. **25 % vont à Nota** en frais de service, pour le travail que Nota exécute
   réellement : trouver le notaire, monter et valider le dossier, opérer la
   transaction et le séquestre.
4. **La part du notaire monte au mérite, jamais l'inverse.** Le barème
   (`apps/api/src/commission-config.js`) porte trois paliers, et un palier
   exige **ses deux axes à la fois** :

   | Palier | Note | Avis | Actes complétés | Le notaire garde |
   | --- | ---: | ---: | ---: | ---: |
   | — | — | — | — | 75 % |
   | 1 | 4,5 | 5 | 10 | **78 %** |
   | 2 | 4,7 | 15 | 30 | **80 %** |
   | 3 | 4,8 | 30 | 75 | **85 %** (plancher) |

   Cinq évaluations complaisantes n'achètent pas le sommet ; trente actes à
   3,9 non plus. Le plancher de 15 % est ferme.
5. **Tout est visible, des deux côtés.** Le notaire voit ses honoraires en
   tête de sa console, la part de Nota à côté, son taux effectif, le palier
   suivant avec *chacune* de ses exigences, et le nombre d'actes qui lui
   manque encore. Le client voit le partage avant d'offrir.

## Conséquences

**Ce qui change dans le code.**

- `commission-config.js` : `DEFAULT_RATE` 0,10 → **0,25**, `DEFAULT_FLOOR`
  0,05 → **0,15**, et chaque palier gagne un axe `actes`. Un barème écrit
  avant cet ADR n'a pas la clé : elle se lit comme « aucune exigence d'actes »,
  donc les barèmes stockés continuent de tarifer exactement comme avant.
- `billing.js` : `commissionWith` exige les deux axes, retourne `part` (la
  part du notaire, calculée une seule fois plutôt que reconstituée par chaque
  appelant) et `actes`, et `prochain` nomme désormais `actes` et `part`.
  `completeAct` incrémente `actsCompleted` **sous la même garde write-once que
  l'argent** — une reprise ne gonfle jamais une notoriété.
- Garde-fou ajouté : le taux effectif est borné par le taux de base. Un
  plancher configuré au-dessus du taux (faute de frappe d'env, déploiement à
  moitié appliqué) ne doit jamais facturer **plus** que la base — le mérite ne
  déplace la ligne que dans un sens.
- `admin.js` et `repo-dynamo.js` : la projection du barème transporte `actes`.
- Web : le panneau des revenus mène par « Vos honoraires » ; les libellés
  publics énoncent le partage au lieu de dire que le notaire reçoit tout.

**Ce qui reste ouvert — et qui est le vrai risque.**

> **Correction du 2026-09-01 (soir).** Ce paragraphe affirmait que l'argent
> transitait par le compte connecté du notaire. C'était vrai du chemin de
> repli, retiré depuis (ADR 0029) ; ce n'est pas vrai du chemin réel. Voir la
> version corrigée ci-dessous, vérifiée dans `apps/api/src/stripe-port.js`.

Sur le fil Stripe, le client paie **la plateforme** : la caution est une
session Checkout ouverte sur le compte de Nota, sans compte connecté, sans
`on_behalf_of`. À la signature, Nota capture, garde sa part et **vire le net**
au notaire (`separate charges and transfers`). La part de Nota ne transite
jamais par le compte du notaire.

Ce que cela ne règle pas : la qualification juridique. L'article 32.1 de la
*Loi sur le notariat* (2023) présume usurpation des fonctions de notaire chez
l'intermédiaire qui « obtient d'un notaire qu'il abandonne une partie de ses
honoraires », et la direction du flux n'y répond pas à elle seule.
**L'avis juridique écrit budgété reste requis avant le premier acte réel** —
il est simplement mieux armé qu'on ne le croyait en écrivant cet ADR.

Le taux de 25 % est par ailleurs **une hypothèse, pas un fait** : le plan
d'affaires modélisait 10 %. C'est exactement ce que la question H3 du
programme de validation (`docs/go-to-market/entrevue-notaire.md`) va mesurer
auprès de trente notaires avant la mise en service.

## Alternatives écartées

- **Garder 10 % sur les honoraires.** Écarté : le propriétaire a tranché
  l'économie, et le taux n'était de toute façon pas le problème déontologique
  — la direction du flux l'était.
- **Facturer le notaire par piste, comme Soumissions Québec.** Écarté : le
  notaire paierait pour des pistes qui ne se concluent pas. L'argument de
  vente de Nota est exactement l'inverse — zéro dollar tant qu'il n'y a pas
  d'acte.
- **Un abonnement mensuel.** Écarté depuis l'ADR 0008 : un coût fixe tue
  l'inscription des jeunes notaires, qui sont la cohorte de départ.
