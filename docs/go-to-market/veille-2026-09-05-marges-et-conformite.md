# Veille du 5 septembre 2026 : marge par acte et conformité, service par service

Relevé fait le 2026-09-05 par lecture directe des sites (`curl` et `fetch`,
catalogues Shopify `products.json`, pages de prix, conditions d'utilisation),
en complément des quatre rapports du 3 septembre dans `veille-2026-09-03/`.
Chaque prix ci-dessous a été relu ce jour. Les chiffres de Nota sont ceux du
code après l'ADR 0038 (grille 199 / 249 $, garantie de date 0 · 149 · 299 ·
449 · 549 $).

Deux questions, posées par le propriétaire : Nota tire-t-elle de chaque acte
autant que les services comparables, et sa structure tient-elle face aux
règles de la profession notariale ? Réponse courte : Nota tire moins par acte
que son comparable direct à cause du rail de paiement, pas du prix, et sa
structure est la plus sûre du marché québécois sur le partage des honoraires,
avec un point faible connu, le passage des honoraires par son compte.

## 1. Ce que chaque service facture, et à qui

| Service | Refinancement, prix client relevé | Qui paie la plateforme | Flux des honoraires | Revenu plateforme par acte |
| --- | --- | --- | --- | --- |
| **Nota** (Québec) | 2 000 $ d'honoraires (plancher, offert par le client) + 249 $ de service + garantie de date, taxes et débours en sus | Le client | Carte autorisée sur le compte de Nota, capture à la signature, honoraires virés au notaire | 249 $ (301 $ en moyenne pondérée), net Stripe 183 $ au standard |
| **Notairo** (Québec, Shopify) | « à partir de 949 $ + débours » en vitrine, forfaits réels 1 795 / 1 995 / 2 225 $ TTC débours inclus, prise en charge 295 $ | Le client | Deux produits : « prise en charge 295 $ » où les honoraires sont « payables directement au notaire à la signature », et des forfaits « avance d'honoraires et débours » encaissés par Notairo | 295 $, net Shopify ≈ 286 $ |
| **Leya** (même fondateur que Notairo) | « 1 725 $ + », « prices sourced across local vendors », « we are NOT a law firm » | Non publié | Non publié | Non publié |
| **prix.expert** (Legaluber) | 1 500 $ TTC « payable directement chez le notaire lors du rendez-vous » | Non publié, vraisemblablement le notaire | Jamais par la plateforme | Non publié |
| **Droit Légal** (Québec) | Ouverture de dossier 100 $, puis « dépôts en fidéicommis » vendus comme produits Shopify | Le client | La plateforme est un cabinet et encaisse en fidéicommis | Cabinet, pas de partage à divulguer |
| **Deeded** (Ontario, Alberta) | 999 $ + débours, taxes en sus | L'avocat, par « service fees » (administratif, technique, horaire, marketing) | Le client paie l'avocat | Non publié |
| **Ownright** (Ontario) | 1 179 $ + HST + débours de tiers | Personne, Ownright est le cabinet | Cabinet | 100 % de ses honoraires |
| **Axess Law** (ON, BC, AB) | 999 $ (ON, AB), 1 099 $ (BC) | Cabinet | Cabinet | Cabinet |
| **LawBooth** (Ontario) | 695 $ + taxes prêteur A, 895 $ prêteur B | Cabinet | Cabinet | Cabinet |
| **Philer** (Toronto) | 1 190 $ forfaitaire + débours et taxes | Cabinet | Cabinet | Cabinet |
| **Soumissions Québec / Maison** | Gratuit pour le client | Le notaire, 25 à 50 $ la piste | Jamais par la plateforme | 75 à 150 $ par acte gagné (une piste sur trois) |
| **JuriGo** | Gratuit pour le client | L'avocat, par dossier accepté (« 1 $ rapporte 10 à 12 $ ») | Jamais | ≈ 8 à 10 % implicite |
| **Habitam / XpertSource** | Gratuit pour le client | Le notaire, par proposition | Jamais | Non publié |

Lecture. Deux familles québécoises coexistent : celles qui facturent le
client leur propre service (Nota, Notairo) et celles qui facturent le notaire
l'accès à la demande (Soumissions, Habitam, JuriGo, vraisemblablement
prix.expert et Leya). Les cabinets intégrés de l'Ontario (Ownright, Axess,
LawBooth, Philer) n'ont pas d'équivalent possible au Québec sans détention
notariale, voir §3.

> **Le même jour, après ce relevé** : l'ADR 0042 a porté les lignes de service
> à 229 et 279 $ (la ligne « Nota, service à 279 $ » ci-dessous est devenue
> la grille), et l'ADR 0041 a remplacé les frais d'annulation fixés d'avance
> par une indemnité réclamée et justifiée. Le § 4 reste juste sur les
> structures ; la nuance sur l'art. 32.1 3° est dans
> `docs/legal/verification-juridique-2026-09-05-prix-et-frais.md`.

## 2. Marge par acte : Nota contre son comparable direct

Sur un refinancement à préavis normal, en dollars par acte, avec Stripe à
2,9 % + 0,30 $ :

| Structure | Total client hors taxes | Revenu plateforme | Frais de carte | Net | Marge |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nota aujourd'hui (2 000 + 249, Nota encaisse tout) | 2 249 $ | 249 $ | 65,52 $ | 183,48 $ | 73,7 % |
| Notairo, prise en charge (1 700 estimé + 295, honoraires au notaire) | 1 995 $ | 295 $ | 8,86 $ | 286,14 $ | 97,0 % |
| Nota, honoraires payés directement au notaire | 2 249 $ | 249 $ | 7,52 $ | 241,48 $ | 97,0 % |
| Nota, idem, service à 279 $ | 2 279 $ | 279 $ | 8,39 $ | 270,61 $ | 97,0 % |
| Nota, plancher ramené à 1 500 $, Nota encaisse tout | 1 749 $ | 249 $ | 51,02 $ | 197,98 $ | 79,5 % |

Notairo gagne environ 100 $ de plus que Nota sur chaque acte tout en
demandant moins au client. L'écart tient à deux choses, et à deux seulement :
le rail (58 $ de frais de carte que Nota paie sur des honoraires qu'elle ne
garde pas) et 46 $ de prix. Le rail pèse plus que le prix.

## 3. Le tout-compris du client, et le plancher de Nota

Ce que le client sort réellement pour un refinancement standard, débours
d'environ 300 $ compris :

| Service | Estimation tout compris |
| --- | ---: |
| Nota (2 000 + 249, taxes 14,975 %, débours 300 $) | ≈ 2 886 $ |
| Notairo, forfait en personne, taxes et débours inclus | 1 995 $ |
| Notairo, forfait virtuel | 2 225 $ |
| prix.expert, taxes incluses | 1 500 $ |
| Ownright (1 179 $ + HST + débours) | ≈ 1 632 $ |
| Deeded (999 $ + HST + débours) | ≈ 1 429 $ |

Le prix de Nota n'est pas ce qui rend Nota chère. La ligne de Nota est sous
celle de Notairo. Ce qui rend Nota chère, c'est le plancher de 2 000 $
d'honoraires (`prixDepart`), posé par Nota et non par le marché, quand le
marché québécois vend le même acte 1 300 à 1 700 $ d'honoraires hors taxes.
Ce plancher a trois effets, tous contre Nota :

1. il coûte des conversions, sur une thèse (« la date se paie ») qu'aucune
   transaction ne soutient encore,
2. il fait payer à Nota plus de frais de carte sur un argent qu'elle ne garde
   pas (la marge de Nota monte de 73,7 % à 79,5 % si le plancher descend à
   1 500 $, sans toucher à sa ligne),
3. un plancher imposé à des professionnels indépendants par une plateforme se
   lit, de l'extérieur, comme un prix minimum concerté.

## 4. Conformité, structure par structure

Les textes sont ceux de `docs/legal/code-deontologie-notaires-texte-officiel.md`
et de la Loi sur le notariat. Six structures existent sur le marché. Une
seule est vraiment sûre au Québec, et Nota en est.

| Structure | Qui la pratique | Art. 32.1 L.N. (usurpation par l'intermédiaire) | Art. 32 et 33 C.déont. (partage, avantage) | Art. 29.1 (indépendance) | Autres murs |
| --- | --- | --- | --- | --- | --- |
| **A. Le client paie à la plateforme son propre service, les honoraires vont directement au notaire** | Notairo (295 $), prix.expert | Tient : aucune réduction promise, aucun abandon d'honoraires, la plateforme n'assume rien sur les honoraires et ne prétend pas le faire | Tient : rien n'est partagé, rien n'est versé au notaire ni reçu de lui | Tient si le prix ne dépend pas du notaire | LPC : le total doit être affiché avant l'engagement |
| **B. Le client paie tout à la plateforme, qui vire les honoraires** | Nota, forfaits « avance d'honoraires » de Notairo | Tient sur 1° et 2°. Sur 3°, la plateforme assume la responsabilité des honoraires, ce que Nota fait exprès. Le risque est la qualification : des honoraires notariés encaissés par un non-notaire hors compte en fidéicommis | Tient, à condition que le net viré soit le montant offert au cent près | Tient | Règlement sur la comptabilité en fidéicommis des notaires, à faire trancher par l'avis juridique |
| **C. Le professionnel paie des frais de service à la plateforme** | Deeded en Ontario, Leya probablement | Tient si les frais sont indépendants des honoraires | Tient seulement si les frais sont facturés à leur valeur et jamais proportionnels ni contingents. Un frais par dossier gagné est un partage déguisé | Fragile si les frais montent avec le volume apporté | Avvo est mort de cette structure aux États-Unis |
| **D. La plateforme est le cabinet** | Ownright, Axess, LawBooth, Philer, Droit Légal | Sans objet | Sans objet | Sans objet | Impossible pour Nota : N-3, r. 7 exige la détention et le contrôle par des membres d'ordres. Aucun notaire actionnaire de Nota, par décision |
| **E. Le notaire achète des pistes à prix fixe** | Soumissions, Habitam, Bark | Tient | Tient tant que la piste est vendue au même prix convertie ou non, comme de la publicité | Tient | Aucun contrôle de la Chambre sur la qualité des pistes |
| **F. Le professionnel paie par dossier accepté ou en pourcentage** | JuriGo, Neolegal (collaborateurs), UpCounsel, Avvo | Ne tient pas : l'intermédiaire obtient une part des honoraires (2°) | Ne tient pas : partage d'honoraires avec un non-membre | Ne tient pas si la part varie | La structure des ADR 0027 et 0028, retirée le 2026-09-01 |

Ce que Nota fait déjà bien, et que le relevé confirme comme rare :

- deux lignes, le notaire reçoit 100 % de l'offre, le prix de Nota ne dépend
  ni du notaire, ni de sa cote, ni de la valeur de l'acte (art. 29.1, testé),
- la garantie de date est distincte de la prime d'urgence que l'art. 49 4°
  réserve au notaire, deux objets, deux lignes,
- 0 $ facturé au notaire, ni piste, ni abonnement offert, ni pourcentage,
- les frais d'annulation vont au notaire en entier (ADR 0033),
- aucune cote ni avis publié sur un notaire nommé (art. 70, ADR 0030),
- aucune comparaison de prix ni « moins cher » (art. 32.1 1°, gardé par
  `truthful-claims`),
- les récompenses de parrainage excluent les notaires (art. 33).

Ce qui reste exposé chez Nota :

1. **Le passage des honoraires par le compte Stripe de Nota** (structure B).
   C'est le seul point où un syndic pourrait requalifier. Notairo porte le
   même risque sur ses forfaits, et l'évite sur son produit à 295 $.
2. **Le plancher de 2 000 $** (§3), un prix minimum posé par la plateforme.
3. **Taxes et débours non chiffrés** au devis. L'art. 71 3° exige de dire
   s'ils sont inclus, ce qui est fait, et la LPC veut un total. Notairo et
   prix.expert affichent des forfaits TTC.

## 5. Ce qui maximise la marge sans rouvrir un mur

Par ordre de gain, tout en restant dans la structure A ou B :

| Geste | Gain par acte | Effet sur la conformité | Qui décide |
| --- | ---: | --- | --- |
| Honoraires payés directement au notaire à la signature (structure A, celle de Notairo), Nota ne capture que ses lignes et les frais d'annulation | + 58 $ au standard, jusqu'à + 250 $ à l'urgence | Éteint le risque de qualification de la structure B | Propriétaire, plus avis juridique. Change l'ADR 0035 : la caution ne couvre plus que les frais d'annulation, ou reste une autorisation sans capture des honoraires |
| Débit préautorisé au règlement, carte gardée en garantie | + 60 $ environ | Neutre : les honoraires passent encore par Nota | Propriétaire |
| Grille de date de l'ADR 0038 | + 43 $ | Neutre | Fait |
| Service à 279 $ refinancement et 229 $ financement | + 29 $ | Neutre, reste sous 295 $ | Propriétaire |
| Plancher d'honoraires ramené vers le marché (1 500 $) | + 15 $ par acte pour Nota, et des actes en plus | Retire l'apparence de prix minimum concerté | Propriétaire |
| Outillage notaire payant à sa valeur (agenda, webcal, dossier), modèle Doctolib | Nouvelle ligne | Tient si facturé à sa valeur, jamais offert (art. 33) | Plus tard, après la vague 1 |

À ne jamais faire, quel que soit le gain : frais au notaire par dossier
gagné, frais proportionnels aux honoraires, abonnement offert contre une
exclusivité, part sur les frais d'annulation. Ce sont les structures C
dégradée et F, et chacune rouvre un mur.

## 6. Ce qui reste à établir

- Le mode de rémunération de Leya et de prix.expert côté professionnel, à
  obtenir en entrevue avec un notaire de leur réseau.
- Le montant des frais de service Deeded par dossier.
- Le prix par proposition d'Habitam et la conversion réelle des pistes
  Soumissions, question d'entrevue de `entrevue-notaire.md`.
- L'avis juridique écrit sur la structure B, question déjà posée par
  l'ADR 0031, et qui devient plus simple si Nota passe à la structure A.

Sources relues le 2026-09-05 : notairo.com/products.json et
/products/frais-de-prise-en-charge-de-dossier, leya.ca/real-estate et
/terms, prix.expert/products.json, droit.legal/products.json,
deeded.ca/pricing, ownright.com/pricing, axesslaw.com/pricing,
lawbooth.ca/legal-fee-calculator, philer.ai/real-estate-lawyer/toronto.
