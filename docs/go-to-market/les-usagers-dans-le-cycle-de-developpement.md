# Les usagers dans le cycle de développement

Date : 2026-09-03 · Tient en une page, parce qu'un dispositif qu'on ne relit pas
n'est pas suivi.

**Le principe.** Les dix premiers usagers de Nota ne sont pas une cible, ce sont
des collaborateurs. Le produit a déjà les trois portes par lesquelles ils
parlent — la messagerie de soutien, les évaluations, le dialogue « Nous
joindre » — et aucune ne mène nulle part une fois le message lu. Ce document
ferme la boucle : d'où vient une demande, qui la trie, quand elle est livrée,
et comment le demandeur l'apprend.

---

## 1. Le conseil des premiers usagers

**Cinq notaires et cinq clients.** Les notaires sortent des neuf de la
[vague 1](vague-1-neuf-notaires.md), par ordre d'usage réel : compte activé,
fil ouvert deux fois, au moins une décision prise (retenir, proposer, refuser).
Six des neuf sont à moins d'une heure de Québec et peuvent utiliser le produit
dès la phase 1 ; ce sont eux qu'on invite d'abord. Les clients sont les cinq
premiers à avoir publié une offre payante — pas les cinq plus satisfaits.

**Ce que le conseil reçoit** : un accès en avance aux changements, une réponse
nommée à chaque demande, et son nom dans la note de version quand la demande est
livrée. **Ce qu'il ne reçoit pas** : d'argent, de rabais, ni de place
privilégiée dans le fil. L'art. 33 du *Code de déontologie* interdit au notaire
de recevoir un avantage lié à l'exercice de sa profession ; un siège au conseil
n'est pas un avantage, un dossier prioritaire en serait un.

---

## 2. La cadence : trente minutes par semaine

| Quand | Quoi | Combien de temps |
| --- | --- | --- |
| Lundi matin | **Triage** de tout ce qui est arrivé dans la semaine (§ 3), en présence de personne : le propriétaire seul, avec la liste étiquetée. | 15 min |
| Mardi ou jeudi | **Un appel de 30 minutes** avec un membre du conseil, en rotation — dix membres, donc chacun toutes les dix semaines. Grille : ce que vous avez essayé, ce qui vous a arrêté, ce que vous auriez voulu. Pas de démonstration. | 30 min |
| Vendredi | **La note de version** de la semaine, écrite depuis les messages de commit (§ 5). | 15 min |

Une heure par semaine au total. Si la cadence saute deux semaines de suite, le
conseil est dissous et le dispositif redevient une bonne intention — le dire
d'avance vaut mieux que de le découvrir.

---

## 3. La porte « Proposer une amélioration »

**À ajouter au produit.** Une entrée dans le pied de page et dans la console
notaire, à côté de « Nous joindre » : *Proposer une amélioration*. Elle ouvre le
même dialogue que le soutien, avec une phrase d'amorce différente (« Qu'est-ce
qui vous a manqué ? ») et **une étiquette posée sur le message**.

Elle n'invente aucune plomberie : `POST /support/messages` existe, le fil de
soutien existe, et chaque message déclenche déjà `operatorSupportMessage` vers
la boîte de l'opérateur, avec le lien de réponse signé. L'étiquette
(`amelioration`) voyage avec le message, s'affiche dans le sujet du courriel
d'alerte et permet de retrouver la file. Elle a besoin de la couche de
persistance en cours (voir
[`carnet-pour-etre-numero-1.md`](carnet-pour-etre-numero-1.md) § 1) pour être
conservée.

Deux autres sources alimentent la même file, sans code nouveau : le commentaire
libre des **évaluations** après signature, et le dialogue **« Nous joindre »**
quand le message n'est pas une question mais une demande.

---

## 4. Le chemin d'une demande

1. **Réception.** Le message arrive étiqueté dans la boîte de l'opérateur.
   Accusé de réception le jour même, par la messagerie elle-même : le demandeur
   voit sa réponse dans le fil qu'il a ouvert.
2. **Triage du lundi.** Quatre issues, jamais cinq : *livrée cette semaine* ·
   *au carnet* (`carnet-pour-etre-numero-1.md`, avec sa taille) · *refusée, avec
   la raison écrite* · *déjà là, et voici où*. Une demande refusée reçoit sa
   raison dans le fil ; c'est la moitié du bénéfice du dispositif.
3. **ADR si elle change une règle.** Une demande qui touche un prix, un délai,
   un barème, une donnée conservée ou un devoir déontologique ne se code pas :
   elle devient une décision dans `docs/decisions/`, numérotée, avec son
   contexte et ses conséquences. C'est le cas de la plupart des demandes qui
   valent la peine.
4. **Livrée derrière la barrière existante.** Aucun chemin spécial : le
   changement passe `.github/workflows/deploy.yml`, dont le déploiement est
   conditionné par `needs: [test, e2e, terraform]`. Une demande d'usager ne
   justifie pas de contourner une suite rouge.
5. **Le demandeur est nommé.** La note de version dit « demandé par Me X » ou
   « demandé par une cliente de Sainte-Foy » — jamais un nom de client sans son
   accord explicite, et jamais un témoignage attribué à un notaire nommé
   (art. 70, ADR 0030). C'est une attribution de demande, pas un avis.

---

## 5. Le journal des changements, en public

Une page publique, alimentée par les **messages de commit** — le dépôt les écrit
déjà en français, une phrase par changement, dans la voix du produit. Le
vendredi, les commits de la semaine sont filtrés (`feat`, `fix`, `doc` visibles ;
`ci`, `chore`, `test` non), regroupés, et la mention du demandeur est ajoutée
quand il y en a un.

Deux raisons de la publier plutôt que de l'envoyer : un notaire qui hésite voit
que le produit bouge chaque semaine, et un client qui a demandé quelque chose
peut vérifier lui-même. Une seule règle de contenu : le journal ne promet rien
au futur. Il dit ce qui est livré, jamais ce qui s'en vient.

---

## 6. Ce que ça doit produire

La mesure ne change pas : c'est celle du [plan PMF](plan-pmf-30-jours.md), le
**taux de rétention — offres retenues sur offres publiées par de vrais clients,
au-dessus de 40 %**. Le conseil n'a pas sa propre métrique, et c'est voulu : un
dispositif d'écoute qui se mesure au nombre de réunions tenues finit par tenir
des réunions.

Trois signaux disent qu'il fonctionne, tous lisibles dans les données déjà
collectées :

| Signal | Où il se lit | Seuil |
| --- | --- | --- |
| Les demandes arrivent | File `amelioration` de la boîte de soutien | ≥ 5 par mois, dont au moins 2 de notaires |
| Elles sont livrées ou refusées, jamais suspendues | Triage du lundi | 0 demande de plus de 3 semaines sans issue écrite |
| Elles déplacent la mesure | Taux de rétention, console admin | Le taux monte le mois qui suit une livraison issue du conseil |

Si le taux de rétention reste sous 40 % pendant que les trois premiers signaux
sont verts, la conclusion n'est pas que le conseil échoue : c'est que le prix ou
le délai est le problème, et le [plan PMF § 6](plan-pmf-30-jours.md) dit déjà où
regarder — les contre-offres des notaires, qui disent le prix réel.
