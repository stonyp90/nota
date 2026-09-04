# Entrevue notaire — 20 minutes

**Objectif :** repartir avec **des chiffres**, pas des impressions. Une entrevue
qui ne produit aucun nombre est une entrevue ratée.

**Posture :** vous ne présentez pas Nota. Vous ne le nommez qu'à la question 10,
et seulement s'il reste du temps. Dès que vous décrivez le produit, l'interlocuteur
devient poli et cesse d'être informatif.

**Enregistrement :** demander la permission, sinon prendre des notes. Ne jamais
noter le nom d'un client, d'un dossier ou d'un prêteur nommément — secret
professionnel.

---

## Ouverture (1 min)

> « Merci. Je ne vous vends rien : je mesure une chose que personne n'a mesurée.
> Je vais vous poser huit questions, ça prend vingt minutes, et je vous envoie
> ce que j'apprends de l'ensemble des entrevues. Si une question touche à un
> dossier, on la saute. »

---

## Les questions

### Bloc capacité — H1

**1.** « Décrivez-moi votre semaine dernière. Combien de signatures ? »
→ *note : nombre*

**2.** « Sur ces plages-là, combien étaient vides au lundi matin et le sont
restées ? »
→ *note : nombre. **C'est H1.** < 2 par semaine, en moyenne, sur 30 entrevues,
et le côté offre du marché n'existe pas.*

**3.** « Quand une plage se libère à trois jours d'avis — un client annule —
qu'est-ce qui arrive à cette plage ? »
→ *écouter s'il dit « rien » ou « j'appelle ma liste d'attente ». La liste
d'attente est le concurrent réel de Nota.*

### Bloc prix — H2 (le cœur)

**4.** « Un refinancement standard chez vous, honoraires tout compris, on parle
de combien ? »
→ *note : montant. Sert de base au multiplicateur.*

**5.** — la question qui tranche —
« Jeudi prochain, dans trois jours. Vous avez la plage. Un client que vous ne
connaissez pas, dossier complet, offre **[2,2 × la réponse en 4]**.
Vous prenez ou vous refusez ? »
→ *note : oui / non. **C'est H2.** Puis :*
« Et à **[1,5 ×]** ? Et à **[4 ×]** ? »
→ *note : le point de bascule. C'est la donnée la plus précieuse de tout ce
programme — c'est littéralement la courbe que la phase 1 doit produire.*

**6.** « Ce qui vous ferait refuser, dans ce scénario : c'est le prix, le fait
de ne pas connaître le client, le prêteur, le déplacement, ou autre chose ? »
→ *classer. Si « prix » n'arrive pas en tête, le marché n'est pas tarifaire et
tout le modèle doit être revu.*

### Bloc modèle — H3

**7.** « Une plateforme vous amène ce dossier. Elle doit être payée. D'où doit
venir cet argent, selon vous ? »
→ *question ouverte, jamais fermée. **C'est H3.** Compter combien nomment
spontanément le partage d'honoraires. S'ils ne le nomment pas :*
« Si elle prenait un pourcentage de vos honoraires — ça change quoi ? »
→ *note : la réaction brute, mot pour mot.*

*Puis, et seulement une fois les deux réponses notées, le modèle réel (ADR
0031 et 0034) :* « Chez nous, vos honoraires restent entièrement les vôtres —
on ne prend rien dessus. Nota facture son propre service au client, à côté :
199 $ pour un financement, 249 $ pour un refinancement, plus une ligne de
garantie de date de 0 à 300 $ selon le préavis. Vous en pensez quoi ? »
→ *note : accepte / hésite / refuse, et **le prix qu'il trouverait juste**. Ne
pas défendre les 199/249 $ — on est venu les mesurer, pas les vendre.*

*Puis la question qui vaut le déplacement :* « Si le client voit ce prix-là à
côté de vos honoraires, avant de s'engager — est-ce que ça vous met mal à
l'aise, ou est-ce que c'est mieux que de ne pas savoir ? »
→ *note : à l'aise / mal à l'aise, et **pourquoi**. C'est la seule chose que
l'entrevue peut trancher que le code ne peut pas.*

> **Attention — ce qu'il ne faut plus dire.** Une version antérieure de cette
> grille scriptait « 85 % pour vous, 15 % pour Nota, jusqu'à 95 % avec votre
> cote sur 100 ». C'est un partage d'honoraires avec un non-notaire et une cote
> visible du client sur un notaire nommé : retiré par les ADR 0031, 0034 et
> 0030, et interdit par les art. 32 C.déont., 32.1 *Loi sur le notariat* et 70
> C.déont. Ne jamais le prononcer, même comme hypothèse.

### Bloc produit — H4, H5, H6

**8.** « Qui, dans votre étude, décide qu'une plage est prise ? Vous, ou
quelqu'un d'autre ? »
→ *note : notaire / adjointe / technicienne. **C'est H4** — et ça décide pour
qui la console notaire est dessinée.*

**9.** « Quel logiciel de gestion ? Si un dossier arrive d'ailleurs, vous le
ressaisissez ? »
→ *note : Para-Maître / ProNotaire / ProCardex / JurisÉvolution / autre. **H5.***

**10.** « L'an dernier, combien de fois avez-vous refusé une signature à
distance parce que la justification de l'article 46 vous semblait trop mince ? »
→ *note : nombre. **H6** — dimensionne toute la phase 2.*

---

## Clôture (2 min)

> « Deux dernières choses. Un : est-ce que je peux vous réécrire quand j'aurai
> les résultats des trente entrevues ? Deux : y a-t-il un ou deux confrères à
> qui je devrais parler ? »

**La demande de référence est la seule chose qui fait passer la prospection de
linéaire à composée.** Ne jamais l'oublier.

---

## Grille de saisie (une par entrevue)

Fichier : `docs/go-to-market/entrevues/AAAA-MM-JJ-nom.md`

```yaml
date:
notaire:            # initiales suffisent
ville:
annees_pratique:
taille_etude:       # solo / 2-5 / 6+
# H1
signatures_semaine:
plages_vides_semaine:
sort_plage_liberee:   # rien | liste attente | autre
# H2
prix_refinancement:
accepte_J3_x22:       # oui | non
accepte_J3_x15:
accepte_J3_x40:
point_bascule_x:
raison_refus_1:       # prix | client inconnu | preteur | deplacement | autre
# H3
source_remuneration_spontanee:
reaction_partage_honoraires:   # citation textuelle
reaction_prix_nota:            # accepte | hesite | refuse (199/249 $ + garantie de date)
prix_quil_trouverait_juste:    # $
prix_visible_au_client:        # a_laise | mal_a_laise
# H4-H6
qui_decide_agenda:
logiciel_etude:
refus_art46_par_an:
# suite
references_donnees:
interesse_cohorte:    # oui | peut-etre | non
```

---

## Seuils de décision (à 30 entrevues)

| Hypothèse | Tenue si | Conséquence si réfutée |
| --- | --- | --- |
| H1 | ≥ 40 % ont ≥ 2 plages vides/sem. | Il n'y a pas d'offre à agréger : le produit devient un outil pour clients, pas un marché |
| H2 | ≥ 1/3 acceptent à 2,2× | La prime d'urgence ne se paie pas côté offre : replancher toute la grille |
| H3 | ≤ 1/3 nomment le partage d'honoraires | Ne rien lancer avant l'avis écrit — le risque est perçu, pas seulement théorique |
| H4 | — | Si l'adjointe décide : la console notaire est refaite pour elle |
| H5 | — | Si la ressaisie est rédhibitoire : une intégration passe avant le reste |
| H6 | ≥ 5 refus/an/notaire | Confirme le dimensionnement de la phase 2 |

---

## La fiche de prix — à n'ouvrir que si le notaire la demande

La posture reste celle du haut de page : on ne présente pas Nota. Mais dès que
la question vient de lui, il faut répondre juste et du premier coup. Chiffres
vérifiés dans `packages/domain/index.js`, jamais recopiés d'un autre document.

| Service | Honoraires de départ du notaire | Prix de Nota, payé par le client |
| --- | ---: | ---: |
| Financement hypothécaire | 1 800 $ | **199 $** |
| Refinancement hypothécaire | 2 000 $ | **249 $** |

Garantie de date, sur sa propre ligne : standard (plus de 14 j) **0 $** ·
rapide (≤ 14 j) **50 $** · prioritaire (≤ 7 j) **100 $** · urgence (la veille)
**200 $** · extrême (le jour même) **300 $**. Taxes et débours en sus.

Ce que ça pèse, s'il pose la question : au palier standard, Nota fait
249 / 2 249 = **11,1 %** du total d'un refinancement et 199 / 1 999 = **10,0 %**
d'un financement — et cette part **baisse** quand la date porte une prime, parce
que les honoraires montent avec le palier et la ligne de Nota, non
(prioritaire : 6 000 + 349 = 6 349 $, soit **5,5 %**).

Trois choses à ne jamais dire : « commission », « partage », « moins cher ».
