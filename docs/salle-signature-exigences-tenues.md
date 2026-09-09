# La salle de signature — ce qui est TENU, et par quel test

Chaque exigence est **vérifiable**, et chacune nomme le test qui la tient. Une
exigence sans test est une intention ; il n'y en a pas dans cette liste.

La numérotation est stable : on n'en retire pas, on marque `retirée` avec la
date et la raison. La colonne « Tenue par » est la seule preuve qui compte.

> **Ce document et l'autre.** `signing-security-requirements.md` est la
> spécification VISÉE du flux juridique autorisé : elle est sourcée contre les
> textes de la Chambre, les RFC et le NIST, et elle décrit ce que le produit
> devra tenir. Celui-ci est la carte de ce qui est CONSTRUIT dans la salle
> (ADR 0047) et de la suite qui l'empêche de régresser. Les deux numérotations
> sont distinctes à dessein : `E1`, `I1`… là-bas ; `A1`…`G3` ici. Une exigence
> visée là-bas et non tenue ici n'est pas un écart caché, c'est la liste des
> points ouverts, plus bas.

---

## A — Le canal

| № | Exigence | Tenue par |
| --- | --- | --- |
| A1 | Le média circule **pair à pair**. Aucun serveur de Nota ne reçoit, ne relaie ni ne déchiffre l'image ou le son. | `e2e/salle-signature.spec.js` — la connexion établie est vérifiée `connected` avec des candidats `host`/`srflx`, et aucune requête média ne part vers l'API. |
| A2 | La signalisation ne transporte **jamais** de média, seulement SDP et candidats ICE, et elle est inutilisable sans les clés DTLS des pairs. | `apps/api/test/salle-signature.test.mjs` — tout corps de signalisation hors du gabarit accepté est refusé en 422. |
| A3 | Les deux pairs dérivent la **même chaîne d'authentification courte** des deux empreintes DTLS, et deux empreintes différentes donnent deux chaînes différentes. | `packages/domain/test/salle-signature.test.mjs` — `chaineAuthentification` est symétrique, déterministe, et change au moindre bit. |
| A4 | La porte `lien` reste fermée tant que le notaire n'a pas confirmé la concordance des chaînes. | `packages/domain/test/salle-signature.test.mjs` |
| A5 | Un participant qui n'est pas attendu dans la salle est refusé, même avec un jeton valide pour une autre offre. | `apps/api/test/salle-signature.test.mjs` |
| A6 | Les identifiants TURN sont **à durée limitée** (HMAC horodaté), jamais un mot de passe statique, et ne sont émis qu'à un participant déjà admis. | `apps/api/test/salle-signature.test.mjs` |

## B — Les personnes

| № | Exigence | Tenue par |
| --- | --- | --- |
| B1 | Les deux participants ont un **compte authentifié**. Un lien seul n'ouvre pas la salle. | `apps/api/test/salle-signature.test.mjs` — sans jeton, 401 ; avec un jeton d'une autre portée, 401. |
| B2 | L'identité légale est établie **hors du canal vidéo**, et l'attestation porte sa méthode, son heure et son vérificateur. | `packages/domain/test/salle-signature.test.mjs` — une attestation sans méthode ou sans horodatage n'ouvre pas la porte. |
| B3 | Le notaire est le **seul** à faire avancer la cérémonie. Une tentative du client est refusée en 403. | `apps/api/test/salle-signature.test.mjs` |
| B4 | Les étapes sont **ordonnées**. Aucun saut ; le retour en arrière est permis et consigné. | `packages/domain/test/salle-signature.test.mjs` |
| B5 | L'attestation d'identité entre au procès-verbal en nommant la partie et la **méthode** — jamais la pièce, jamais son numéro. | `features/salle_signature.feature` + `packages/domain/test/salle-signature.test.mjs` |

## C — La continuité

| № | Exigence | Tenue par |
| --- | --- | --- |
| C1 | Une interruption du lien au-delà du seuil **suspend** la salle ; la signature redevient impossible. | `packages/domain/test/salle-signature.test.mjs` |
| C2 | La reprise après suspension repart de **l'étape en cours**, jamais plus loin. | `packages/domain/test/salle-signature.test.mjs` + `features/salle_signature.feature` |
| C3 | Une piste coupée (caméra fermée, micro muet) referme la porte `presence` sans attendre la fin de l'appel. | `apps/web/test/salle-signature.test.mjs` |
| C4 | La suspension et la reprise sont **consignées** l'une et l'autre dans le procès-verbal. | `packages/domain/test/salle-signature.test.mjs` |
| C5 | Le lien qui revient ne redémarre **pas** la séance : la reprise est un geste du notaire, refusé tant que la présence n'est pas rétablie. | `features/salle_signature.feature` |

## D — L'enregistrement

| № | Exigence | Tenue par |
| --- | --- | --- |
| D1 | Le mode par défaut est `strict` : **aucun enregistrement**. | `packages/domain/test/salle-signature.test.mjs` |
| D2 | L'enregistrement exige le consentement **explicite et horodaté des deux parties**, recueilli dans la salle. | `packages/domain/test/salle-signature.test.mjs` |
| D3 | Le retrait du consentement arrête l'enregistrement à l'instant, et l'arrêt est consigné. | `packages/domain/test/salle-signature.test.mjs` |
| D4 | Les octets enregistrés sont chiffrés **dans le navigateur** avant tout envoi ; Nota ne détient pas la clé. | `apps/web/test/salle-signature.test.mjs` |
| D5 | Une salle en mode `aucun` **ne peut pas atteindre** l'étape `signature`. | `packages/domain/test/salle-signature.test.mjs` |

## E — La preuve

| № | Exigence | Tenue par |
| --- | --- | --- |
| E1 | Chaque fait de la cérémonie entre dans une **chaîne d'empreintes** ; modifier, retirer ou réordonner une entrée change l'empreinte finale. | `packages/domain/test/salle-signature.test.mjs` |
| E2 | Le procès-verbal ne contient **ni le contenu de l'acte, ni ce qui a été dit**. | `packages/domain/test/salle-signature.test.mjs` — le scellé est comparé à une liste blanche de champs. |
| E3 | L'empreinte finale est écrite dans la piste d'audit inaltérable (ADR 0036), et elle y est la même que celle remise au notaire. | `apps/api/test/salle-signature.test.mjs` |
| E4 | Un procès-verbal de démonstration porte la mention en tête, **dans une entrée chaînée** : il ne peut pas être présenté comme un procès-verbal réel. | `packages/domain/test/salle-signature.test.mjs` |

## F — La signature juridique

| № | Exigence | Tenue par |
| --- | --- | --- |
| F1 | La signature juridique sort par un **port**, jamais réimplémentée dans Nota. | `apps/api/test/salle-signature.test.mjs` |
| F2 | Avec l'adaptateur `demonstration`, l'étape `signature` est **refusée** sur une salle qui n'est pas marquée `demonstration`. | `packages/domain/test/salle-signature.test.mjs` |
| F3 | Aucune surface du produit n'affirme une approbation de la Chambre. | `apps/web/test/salle-signature.test.mjs` + `docs/compliance/audit-des-affirmations.md` |

## G — La page

| № | Exigence | Tenue par |
| --- | --- | --- |
| G1 | La `Permissions-Policy` de production autorise `camera` et `microphone` **sur l'origine de Nota seulement**. | `e2e/document-csp.spec.js` |
| G2 | La CSP autorise `media-src blob:` et le relais TURN configuré, et **rien de plus** que ce qui existait avant. | `e2e/document-csp.spec.js` |
| G3 | Le bandeau bêta est présent dans la salle et ne peut pas être masqué. | `apps/web/test/salle-signature.test.mjs` |

---

## La même chose, en langue d'affaires

`features/salle_signature.feature` rejoue A3, A4, B1 à B5, C1 à C5, D5, E1 à E4,
F2 et F3 en Gherkin, à travers les **vraies routes** et avec une horloge que le
scénario avance lui-même. Ce fichier n'ajoute aucune règle : il dit les mêmes
règles dans une langue qu'un lecteur de la Chambre peut vérifier sans lire de
JavaScript, et il tombe si le code cesse de les tenir.

---

## Ce qui n'est pas tenu, et qui doit l'être avant un acte réel

Ces points sont **ouverts**. Ils sont ici pour que personne ne les découvre le
jour de la présentation.

1. **L'évaluation par la Chambre.** La conformité d'un service de
   visioconférence s'établit contre les critères publiés, par la Chambre. Rien
   dans ce dépôt ne la remplace.
2. **L'adaptateur du fournisseur admis** n'est pas écrit. L'interface l'est.
3. **Le fournisseur de vérification d'identité** n'est pas choisi. La porte
   `identite` accepte une attestation ; sa provenance reste à décider.
4. **Le relais TURN n'est pas provisionné.** Sans lui, un réseau à NAT
   symétrique ne peut pas établir le lien. L'échec est propre et nommé, mais
   c'est un échec.
5. **Aucun audit de sécurité externe** n'a été conduit. Une salle qui porte une
   signature notariée en mérite un.
