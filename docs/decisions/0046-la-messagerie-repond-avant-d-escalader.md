# 46. La messagerie répond d'abord, et n'escalade que ce qu'elle ne peut pas fonder

- Status: Accepted
- Date: 2026-09-06

## Contexte

La demande du propriétaire : « qu'on réponde tout de suite aux questions qu'on
sait répondre, et qu'on m'escalade le reste — je répondrai par courriel. Et que
ça sonne comme moi. »

L'ADR 0026 avait posé les rails : un fil, un jeton signé, un lien de réponse
dans la boîte de l'opérateur. Ce qui manquait n'était pas la plomberie, c'était
la première réponse. Trois choses en découlaient :

1. **La messagerie promettait ce qu'elle ne tenait pas.** L'entête disait « on
   vous répond en direct, ici même » et l'état vide « on vous répond en général
   en quelques minutes pendant les heures d'ouverture ». Aucune ligne de code
   ne tenait l'un ni l'autre — `docs/compliance/audit-des-affirmations.md` les
   avait d'ailleurs marquées invérifiables. Une personne seule ne peut pas être
   en ligne, et le dire quand même est une affirmation fausse de plus.
2. **Le panneau avait l'air cassé, et il l'avait pour une raison précise.**
   `.sup-ended` et `.sup-escalade` étaient inscrits dans la règle de « ligne
   réservée » (ADR 0039) : cachés, ils gardaient chacun leur ligne. Deux
   paragraphes invisibles réservaient 108 px de vide permanent au milieu d'un
   panneau de 380 px, sous un journal qui en réservait 96 de plus pour une
   phrase grise. Le visiteur ouvrait un grand trou.
3. **Chaque question réveillait l'opérateur**, y compris « combien ça coûte ? »,
   dont la réponse est dans le catalogue depuis le premier jour.

## Décision

Un assistant répond en premier, sur la fiche de faits du produit, et n'escalade
que ce qu'aucune fiche ne peut fonder.

### 1. La connaissance est CALCULÉE, jamais recopiée

`domain.supportFacts({ grille, bids })` produit la fiche à l'instant, depuis
`SERVICES`, `TIERS`, `prixAnnonce`, `DEPLACEMENTS`, `LENDERS` et les documents
de chaque acte. La couche API y ajoute ce que le domaine ne porte pas — le
barème d'annulation, la mécanique de la caution, l'hébergement, l'inscription
d'un notaire — parce que ces règles vivent dans la facturation (frontière
déontologique de l'ADR 0008).

C'est l'invariant central : **changer un prix dans le catalogue ou une case du
barème dans la console admin change ce que l'assistant répond, sans qu'une
seule phrase soit retouchée.** Une base de connaissances recopiée aurait
vieilli en silence et se serait mise à mentir au premier changement de grille ;
un test hostile (`packages/domain/test/support-assistant.test.mjs`) repasse la
grille et vérifie que la fiche a bougé avec elle.

Le modèle ne reçoit RIEN d'autre. L'invite lui interdit explicitement de
compléter avec ce qu'il croirait savoir du notariat, des hypothèques ou des
prix du marché — même s'il en est sûr, même si le visiteur insiste.

### 2. Trois niveaux, puis une personne

`SUPPORT_NIVEAUX` est une donnée, pas une suite de `if` :

| Niveau | Ce qu'il couvre |
|---|---|
| 1 — Le produit | ce qu'est Nota, les étapes, ce que « retenir » veut dire, le compte |
| 2 — Les chiffres | prix, dates, déplacement, documents, ce que le formulaire demandera |
| 3 — Les règles | paiement, annulation, confidentialité, inscription d'un notaire |

Au-delà, `SUPPORT_ESCALADE_MOTIFS` nomme les six classes de question qu'aucune
fiche ne peut fonder : un dossier ou une personne en particulier, une
exception, une question qui demande le jugement d'un notaire, une plainte, le
développement des affaires, et « la fiche ne dit rien là-dessus ».

### 3. Le modèle propose, le domaine dispose

`domain.validateSupportAnswer()` relit chaque réponse AVANT qu'elle n'atteigne
un visiteur, et ce qu'il refuse n'est pas rafistolé : c'est **jeté**, et
l'humain reprend la main. Le garde-fou refuse :

- **le vocabulaire de taux** — taux, palier, pourcentage, *rate*, le mot qui
  décrit un partage d'honoraires. Le prix annoncé est un total (ADR 0042) ;
  pour l'annulation, le mot du client est « plafond » ;
- **une cote nominative** — aucune note, moyenne, étoile ni classement d'un
  notaire désigné (art. 70 du Code de déontologie, ADR 0030) ;
- **le conseil** — « vous devriez », « je vous conseille », « à votre place ».
  Nota n'est pas notaire ;
- **le forfait** — le prix de Nota est une grille, jamais un prix fixe
  (ADR 0034) ;
- **la comparaison de prix** avec un notaire hors plateforme (art. 32.1 1°) ;
- **« tout compris »** — les taxes et les débours ne le sont pas (art. 71 3°) ;
- **une caution de la Chambre** — aucune n'a été obtenue ;
- **une promesse de délai**, pour signer comme pour répondre ;
- **une statistique** — chances d'obtenir un notaire, médiane, ordre de
  grandeur : rien de tout cela n'est mesuré.

Chacune de ces lignes a déjà été écrite quelque part sur le site, puis retirée.
Une machine qui rédige est exactement ce qui les ferait revenir : le garde-fou
est ce qui l'en empêche, et il est testé sur les formulations retirées
elles-mêmes.

### 4. La voix est celle de la maison ; l'étiquette dit la vérité

Le ton demandé — direct, concret, sans formule creuse — est celui de l'invite.
Mais `SUPPORT_FROM` distingue désormais `nota` (une personne, depuis sa boîte)
de `assistant` (le modèle), et le widget écrit « Assistant Nota » sous sa
bulle. Se faire passer pour une personne aurait été un procédé, dans un produit
dont la valeur tient à ce qu'il n'affirme rien qu'il ne tienne. L'assistant dit
qu'il est l'assistant, et nomme la personne qui reprend.

### 5. L'escalade est un état du FIL, pas d'un message

`escaladeLe` / `escaladeMotif` vivent sur le fil, et
`supportThreadSummary` en dérive `escalade`. Deux conséquences :

- **une réponse de l'assistant ne marque JAMAIS un fil « répondu »** — seul un
  humain le fait. Sans cela, chaque question se serait classée toute seule et
  la boîte de l'opérateur se serait vidée de fils que personne n'a lus ;
- la question « l'humain a-t-il parlé depuis ? » se tranche sur l'**ordre** des
  messages, jamais sur leurs horodatages. Un fil est append-only, et deux
  messages peuvent porter la même seconde — comparer des chaînes de temps
  laissait un fil escaladé le rester après la réponse du propriétaire.

### 6. Le courriel ne part QUE sur escalade

C'est le cœur de la demande. `operatorSupportEscalade` remplace l'alerte à
chaque message et porte ce qu'il faut pour répondre sans rien ouvrir : la
raison de l'escalade, le fil entier avec ses émetteurs, l'adresse du visiteur,
et le lien de réponse signé de l'ADR 0026. `NOTA_ASSISTANT_COPY_ALL=1` rend
l'ancien comportement à qui veut lire par-dessus l'épaule de l'assistant.

### 7. Le panneau montre ce qu'il sait faire

Le vide de 96 px est remplacé par quatre questions d'amorce bâties depuis
`SUPPORT_QUESTIONS_SUGGEREES` — elles disent au visiteur ce que l'assistant
sait traiter au lieu de le lui faire deviner, et disparaissent au premier
message. `.sup-ended` et `.sup-escalade` sortent de la règle de ligne réservée :
une **note de situation** change une fois par conversation, alors qu'un message
de **validation** apparaît sous le doigt — seule la seconde a besoin que sa
ligne lui soit gardée. Un témoin « l'assistant écrit… » occupe les secondes du
modèle, et l'escalade se dit au visiteur au moment où son courriel devient le
canal qui compte.

### 8. La clé ne passe pas par Terraform

Terraform écrit la valeur de **chaque** variable dans son fichier d'état, en
clair — `sensitive = true` ne masque que la sortie de la console. L'état de ce
dépôt est **local** (`infra/terraform.tfstate`, plus son `.backup`). Une clé
d'API en variable Terraform est donc une clé déposée en clair sur le disque,
dans un fichier de 230 ko que personne ne relit.

La clé vit dans **SSM Parameter Store**, en `SecureString`. Terraform n'en
connaît que le NOM (`var.assistant_key_param`) et accorde à la Lambda
`ssm:GetParameter` sur **ce seul ARN**, plus un `kms:Decrypt` conditionné à
`kms:ViaService = ssm`. Le palier standard de Parameter Store est gratuit, là
où Secrets Manager coûterait 0,40 $ par mois et par secret — sur un compte où
ce projet vise 0 $, la différence n'est pas cosmétique.

`apps/api/test/assistant-secret.test.mjs` lit la source Terraform elle-même et
refuse le retour d'une variable qui porterait la valeur : une variable « juste
pour dépanner » est exactement la façon dont ce genre de règle se perd.
`ANTHROPIC_API_KEY` reste accepté en premier pour le développement local et le
conteneur docker, où il n'y a ni SSM ni état à protéger.

### 9. Ce que l'assistant fait est compté, et mesuré

Deux surfaces, parce qu'« il marche » et « on SAIT qu'il marche » sont deux
choses différentes :

- **Des compteurs par jour** (`statsDeltasForAssistant`) : réponses,
  escalades, escalades **par motif** — pour savoir quoi documenter ensuite —
  et les jetons d'entrée, de sortie et *lus en cache*. Sans eux, la seule chose
  visible de l'assistant serait ce qu'il n'a PAS su traiter, c'est-à-dire
  précisément la moitié qui donne l'impression qu'il ne sert à rien. Les
  jetons sont la facture. Un motif hors catalogue ne crée jamais son compteur :
  un modèle ne peut pas minter une métrique.
- **Un jeu d'or et un évaluateur** (`apps/api/eval/`). 44 questions — les trois
  niveaux, toutes les classes d'escalade, et une section adverse
  (extraction d'un conseil, d'une cote, d'un délai, d'un rabais, injection
  d'invite, extraction de l'invite système). La notation est **entièrement
  mécanique** : a-t-il escaladé quand il le fallait, le bon chiffre est-il là,
  aucune ligne rouge n'a-t-elle été franchie. Aucun juge, donc aucun jugement
  à débattre. Les attentes chiffrées sont **résolues contre le domaine à
  l'exécution** (`prixAnnonce:refinancement`, pas « 2 279 $ ») : un test refuse
  tout montant recopié dans le jeu d'or, sinon celui-ci vieillirait comme la
  base de connaissances qu'on a refusé d'écrire. Le coût réel de chaque passe
  est imprimé, parce qu'une évaluation qu'on n'ose pas relancer n'en est pas
  une.

## Conséquences

- **L'appel au modèle est SYNCHRONE** : le visiteur lit la réponse dans la même
  requête. Le délai de la Lambda passe de 10 s à 30 s, et le port coupe de
  lui-même à `NOTA_ASSISTANT_TIMEOUT_MS` (12 s) pour qu'un dépassement devienne
  une escalade propre et jamais un 502 qui perdrait la question.
- **Sans clé, rien ne change.** `createAnthropicAssistant` rend `null`, le fil
  reste muet et chaque question part par courriel — exactement le comportement
  d'avant cet ADR. Une clé absente dégrade, elle ne casse pas. C'est aussi ce
  qui rend l'état non configuré testable, et il l'est.
- **Tout ce qui n'est pas une réponse propre est une escalade** : panne du
  modèle, corps illisible, refus de sécurité, garde-fou du domaine. Il n'existe
  aucun chemin où un visiteur reste sans réponse ET sans que personne ne le
  sache.
- **Le coût est borné par une limite qui existait déjà** — 20 messages par
  10 minutes et par IP (ADR 0033 §7). L'invite système est stable d'une
  question à l'autre (la fiche ne bouge qu'avec le catalogue) et porte donc un
  `cache_control` : seule la conversation est facturée plein tarif.
- **L'assistant ne lit aucun dossier.** Il n'a ni jeton client, ni accès au
  carnet, ni aux fils d'un acte retenu. « Où en est mon dossier ? » est une
  escalade par construction, pas par prudence — et les chiffres du carnet
  vivant lui sont interdits, le site pouvant afficher des données de
  démonstration en cas de panne.

## Ce que cet ADR ne règle pas

- **L'évaluation ne juge pas le STYLE.** Elle tient l'escalade, les faits et
  les lignes rouges — tout ce qui se vérifie mécaniquement. Savoir si une
  réponse est *bien tournée* demanderait un juge, et donc un jugement à
  débattre ; on s'en est passé, et la question reste ouverte.
- **Le jeu d'or est écrit, pas observé.** Ses 44 questions sont ce qu'on
  imagine qu'un visiteur demande. Les vraies questions arriveront par la
  messagerie : c'est d'elles que la deuxième version doit être faite.
- **La relecture n'a pas encore d'écran.** `listSupportThreads` existe des deux
  côtés du dépôt et l'index par mois est en place, mais AUCUNE route admin ne
  l'appelle : la boîte de soutien reste à construire. En attendant, la seule
  surface où l'on voit ce que l'assistant a répondu est le courriel d'escalade
  — donc seulement les fils qu'il n'a PAS su traiter. `NOTA_ASSISTANT_COPY_ALL=1`
  est le palliatif, et il devrait le rester peu de temps : c'est le premier
  chantier à ouvrir après celui-ci.
- **Le fil de « Nous joindre » n'est pas assisté.** Le formulaire promet une
  réponse par courriel et la tient ; l'y brancher demanderait de décider ce
  qu'un accusé de réception devient.
- **Rien n'est câblé côté notaire.** La console notaire a ses propres questions
  (périmètre, cote, versements) et sa propre frontière déontologique ; les y
  répondre demande une fiche distincte.
- **Le nom de l'opérateur est une variable d'exploitation** (`operator_name`).
  Vide, l'assistant dit « Nota » — ce qui est vrai, mais moins chaleureux que
  ce qui était demandé.
