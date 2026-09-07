# 0041. L'indemnité de résiliation est réclamée et justifiée, jamais fixée d'avance

Date : 2026-09-05

Statut : accepté. **Amende l'ADR 0023 et l'ADR 0033 (§ argent).** Le
mécanisme de capture partielle et le versement au notaire survivent. Ce qui
tombe, c'est le frais automatique.

## Contexte

Les ADR 0023 et 0033 retenaient, à l'annulation d'un acte retenu, 30 % du
montant convenu à 3 jours ou moins de la signature et 10 % de 4 à 14 jours,
capturés sur la caution et versés au notaire.

Deux textes relus à la source le 5 septembre l'interdisent.

L'art. 13 de la Loi sur la protection du consommateur : « Est interdite la
stipulation qui impose au consommateur, dans le cas de l'inexécution de son
obligation, le paiement de frais, de pénalités ou de dommages, dont le montant
ou le pourcentage est fixé à l'avance dans le contrat, autres que l'intérêt
couru. » L'art. 11.4 : « Est interdite la stipulation qui exclut en tout ou en
partie l'application des articles 2125 et 2129 du Code civil relatifs à la
résiliation des contrats d'entreprise ou de services. » L'art. 2125 C.c.Q.
donne au client le droit de résilier un contrat de service, et l'art. 2129 dit
ce qu'il doit alors : les frais et dépenses réels, la valeur des travaux
exécutés, jamais un pourcentage convenu d'avance. L'art. 12 LPC ajoute
qu'aucuns frais ne peuvent être réclamés sans que le contrat n'en mentionne le
montant précis, et les conditions client admettaient que le barème n'était
révélé qu'au moment d'annuler.

Que la somme aille au notaire ne change pas la nature de la clause.

## Décision

**Rien n'est prélevé à l'annulation. Le barème n'ouvre qu'un plafond, et le
notaire réclame, en justifiant, ou renonce.**

1. **Le `taux` d'un palier est un plafond**, la part la plus haute du montant
   convenu que le notaire peut réclamer. Les niveaux ne changent pas : 30 % à
   3 jours ou moins, 10 % de 4 à 14 jours, rien au-delà. Un barème vide reste
   le coupe-circuit.
2. **L'annulation d'un acte retenu dans la fenêtre ouvre une réclamation**
   (`bid.annulation.statut = en_attente`) avec son plafond, son délai et son
   échéance. La caution reste en place, l'acte reste sur la console du
   notaire, le client et le notaire sont prévenus par courriel.
3. **Le notaire décide** par `POST /notary/bids/indemnite` : un montant en
   dollars au plus égal au plafond, avec une justification écrite de 20 à
   600 caractères (frais engagés, travail accompli), ou zéro pour renoncer.
   Le domaine valide (`validateIndemnite`). Un montant réclamé se capture sur
   la caution vivante ou se porte hors session sur la carte enregistrée, et
   se vire au notaire en entier, exactement comme avant. Une carte qui refuse
   s'inscrit comme refus.
4. **Le délai de réclamation est une donnée d'exploitation** : 7 jours par
   défaut, `NOTA_INDEMNITE_DELAI_JOURS` en environnement, `delaiJours` sur le
   barème stocké, édité depuis la console admin avec les plafonds. Passé le
   délai, le geste quotidien clôt la réclamation, libère la caution et
   prévient le client.
5. **Le client lit tout cela avant de s'engager** : le devis porte les
   plafonds par préavis et le délai (art. 12 LPC), le dialogue d'annulation
   répète le plafond, le délai et ce qu'il advient de la somme réservée, et
   les conditions d'utilisation le disent en toutes lettres avec l'art. 2129.
6. **Chaque décision laisse une trace** : `annulation_frais` quand de l'argent
   a bougé ou a été refusé, avec la justification, et `annulation_indemnite`
   quand la réclamation se clôt sans argent (renonciation, échéance).

### Ce que le client voit, ce que le notaire voit

| Moment | Client | Notaire |
| --- | --- | --- |
| Au devis | Plafonds par préavis, délai, « rien n'est retenu sans réclamation » | Les mêmes plafonds sur la feuille Retenir, dits comme des plafonds |
| À l'annulation | Le plafond, le délai, la somme réservée qui reste en place | Une carte « Annulée par le client » avec le plafond, l'échéance, un montant, une justification, Réclamer ou Renoncer |
| À la décision | Ce qui a été réclamé et pourquoi, ou que rien n'est retenu | Un accusé de sa réclamation |

## Pourquoi cette forme tient

- **Art. 13 LPC** : aucun montant ni pourcentage n'est fixé d'avance. Le
  plafond borne une réclamation, il ne la constitue pas.
- **Art. 2125 et 2129 C.c.Q.** : le client résilie librement et doit les frais
  réels et la valeur du travail accompli, que le notaire justifie.
- **Art. 12 LPC** : les plafonds et le délai sont au contrat et au devis avant
  l'engagement.
- **Art. 32.1 L.N. et art. 32, 33 C.déont.** : l'indemnité va au notaire en
  entier, Nota n'en garde rien, comme l'ADR 0033 le posait.

## Ce que cet ADR ne règle pas

1. **Le contrôle de la justification est celui du notaire.** Nota n'apprécie
   pas si 500 $ de frais réels sont vrais : elle exige qu'ils soient écrits et
   les transmet au client. Un litige se règle entre eux, et l'art. 2129 en
   fixe la mesure.
2. **L'avis juridique écrit demeure requis**, avec la question posée en
   entier : la réclamation justifiée sous plafond satisfait-elle l'art. 13 aux
   yeux de l'Office de la protection du consommateur ?

## Conséquences

- `apps/api/src/cancellation-config.js` : `delaiFor`, `DEFAULT_DELAI_JOURS`,
  `feeFor` rend `plafond`.
- `apps/api/src/handler.js` : la route d'annulation ouvre la réclamation ;
  `POST /notary/bids/indemnite`, `cloreIndemnite` et `reclamerIndemnite`,
  `/notary/bids` garde l'acte en attente sur la console, `tarifNota()` porte
  `annulation.plafonds`.
- `apps/api/src/reminders.js` : les réclamations échues.
- `apps/api/src/emails.js` : `indemniteReclamee`, `indemniteClose`,
  `indemniteReclameeNotaire`, et les deux lettres d'annulation en attente.
- `apps/web` : devis, dialogue d'annulation, reçu, carte console, feuille
  Retenir, conditions.
- `apps/admin` : plafonds et délai à l'écran Annulation, libellé d'audit.
- Tests : `cancellation-fee`, `caution`, `audit-angles-morts`,
  `annulation.feature`, `caution.feature`, `cancel-fee`, `i18n-rules-live`,
  `notary-mise-en-relation`, `mise-en-relation-client`, admin `annulation`.
