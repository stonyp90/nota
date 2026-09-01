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

*Puis, et seulement une fois les deux réponses notées, le chiffre réel (ADR
0028) :* « Le client paie un total. 85 % sont vos honoraires, les 15 % qui
restent sont les frais de service qu'il paie à Nota. Vous en pensez quoi ? »
→ *note : accepte / hésite / refuse, et **le taux qu'il nommerait**. Ne pas
défendre le 15 % — on est venu le mesurer, pas le vendre.*

*Puis l'hypothèse neuve, celle que rien n'a encore mesurée :* « Et si cette
part descendait — jusqu'à 5 %, donc 95 % pour vous — à mesure que monte une
cote sur 100 publique, que vos clients voient autant que vous ? Est-ce que ça
change ce que vous pensez du prélèvement ? »
→ *note : change / ne change rien, et **pourquoi**. Écouter séparément
l'objection à la cote elle-même — « je ne veux pas être noté publiquement » est
une réponse distincte de « le taux est trop haut », et les confondre ferait
lire deux fois la même donnée.*

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
reaction_85_15:                # accepte | hesite | refuse
taux_quil_nommerait:           # %
effet_cote_publique:           # change | ne change rien | refuse la cote
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
