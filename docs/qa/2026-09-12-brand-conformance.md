# Conformité de marque — mesure du 2026-09-12

Instruction du propriétaire : « assure-toi que l'image de marque est la même
partout — admin, app, tout le reste. » Ce document ne répète pas l'affirmation :
il la **mesure**, surface par surface, contre l'ADR 0048 et ses trois
amendements (01 « Monogramme lié » → variante C → design 02 · layout 16 ·
détails 22 + 27 → lettres du 2026-09-12).

**Deux réserves de partage du travail**, à lire avant les chiffres.

1. Pendant cette passe, la session principale modifiait les **graisses des
   lettres** (le N s'épaissit, le O T A s'allège) sur les quatorze copies du
   dessin. Les fichiers de tracé étaient donc gelés pour moi : tout ce qui
   touche au dessin est **mesuré et rapporté**, jamais réécrit ici. Les
   nouvelles lettres ont été posées et les gardes repassent au vert — les
   chiffres ci-dessous sont ceux d'après.
2. Une session sœur, **`nota-c2`**, tient `docs/pitch-deck.html`,
   `docs/business-plan.html`, `docs/planning/render-business-plan.py`,
   `apps/admin/public/admin.css` et `apps/admin/public/index.html`. Ces cinq
   fichiers sont **sortis de mon périmètre en cours de route**. Ce que j'y avais
   déjà mesuré ou corrigé reste consigné ici — les corrections déjà posées sont
   signalées, et ce qui reste est adressé nommément à cette session au § 4.8.

---

## 1. Ce qui a été mesuré, et comment le relancer

### Les trois gardes

```sh
# 1. Le dépôt : le dessin épinglé dans la source
node --test apps/web/test/ux-nav.test.mjs apps/web/test/truthful-claims.test.mjs
npm run test:web            # la suite complète du carnet

# 2. La coquille des courriels (SVG impossible en courriel)
node --test apps/api/test/emails-brand.test.mjs
# ou : npm run test:api

# 3. Ce qui est réellement SERVI — DOM rendu, feuilles de style, actifs SVG,
#    échelle typographique, rampe de couleur, les deux thèmes, favicon
E2E_API_PORT=8831 E2E_WEB_PORT=4331 E2E_ADMIN_PORT=4332 E2E_DOCS_PORT=4333 \
  npx playwright test e2e/brand-conformance.spec.js --project=chromium
```

**Pourquoi des ports inhabituels.** Au moment de la passe, une autre session
tenait déjà `4311` (web) et `8811` (API) depuis plus d'une heure, et
`playwright.config.js` pose `reuseExistingServer: !CI`. Playwright aurait
mesuré les serveurs d'une autre session au lieu des siens — c'est exactement le
piège consigné dans *Stale local dev servers*. Les quatre ports ci-dessus sont
libres, donc la suite démarre sa propre pile. Sur un poste vierge,
`npx playwright test e2e/brand-conformance.spec.js --project=chromium` suffit.

Le même fichier mesure la production sans modification :

```sh
BRAND_WEB=https://gonota.ca BRAND_ADMIN=https://admin.gonota.ca \
BRAND_DOCS=https://gonota.ca npx playwright test e2e/brand-conformance.spec.js --project=chromium
```

### Les surfaces qu'aucune garde ne couvre

```sh
# Les rasters : rendre le SVG COURANT et comparer au PNG commis
rsvg-convert -w 192  -h 192 apps/web/public/favicon.svg -o /tmp/icon-192.png
rsvg-convert -w 512  -h 512 apps/web/public/favicon.svg -o /tmp/icon-512.png
rsvg-convert -w 180  -h 180 apps/web/public/favicon.svg -o /tmp/apple-touch-icon.png
rsvg-convert -w 1200 -h 630 apps/web/public/og.svg      -o /tmp/og.png
for n in icon-192 icon-512 og; do
  magick compare -metric RMSE apps/web/public/$n.png /tmp/$n.png null:; echo " $n"
done
# apple-touch-icon est OPAQUE par dessein (iOS pose son propre masque) :
magick /tmp/apple-touch-icon.png -background '#264961' -flatten /tmp/ati-flat.png
magick compare -metric RMSE apps/web/public/apple-touch-icon.png /tmp/ati-flat.png null:

# Les .pptx : la palette réellement embarquée
unzip -qo docs/nota-pitch-deck-brand-refresh-v3.pptx -d /tmp/deck
cat /tmp/deck/ppt/slides/*.xml | grep -o 'srgbClr val="[0-9A-Fa-f]*"' | sort | uniq -c | sort -rn

# Le générateur du plan d'affaires suit-il la source unique ?
python3 -c "import importlib.util,sys;s=importlib.util.spec_from_file_location('r','docs/planning/render-business-plan.py');m=importlib.util.module_from_spec(s);sys.modules['r']=m;s.loader.exec_module(m);print(m.brand_lockup())"
```

---

## 2. Résultat par surface

### Gardes

| Garde | Résultat |
| --- | --- |
| `ux-nav.test.mjs` + `truthful-claims.test.mjs` | **78 / 78 verts** |
| `emails-brand.test.mjs` | **87 / 87 verts** |
| `npm run test:web` | 1030 verts, **4 rouges — aucun de marque** (voir § 4.6) |
| `brand-conformance.spec.js` (chromium) | **14 / 14** (13 / 14 à la première mesure, § 4.2) |

### Les quatorze surfaces servies

| Surface | Verdict |
| --- | --- |
| carnet | conforme |
| espace notaire | conforme |
| partenaires | conforme |
| **signature bêta** | **dérive corrigée** — la garde ne l'atteignait plus (§ 3) |
| salle de signature | conforme |
| guide de marque (`brand.html`) | conforme |
| planche d'explorations | conforme — rattrapée pendant la passe (§ 4.2) |
| acquisition · refinancement (fr) | conforme |
| acquisition · financement (fr) | conforme |
| acquisition · refinancing (en) | conforme |
| acquisition · financing (en) | conforme |
| console d'administration | conforme |
| pitch deck (`docs/pitch-deck.html`) | conforme, **rayon du badge corrigé** |
| plan d'affaires (`docs/business-plan.html`) | conforme, **rayon du badge corrigé** |

Sur chacune : le tracé décidé présent, aucun dessin retiré (point rond, tuile
`rx 12`, O arrondi, T droit, mot en contour, filet de signature), aucun mot du
vocabulaire retiré (`--nota-teal` / `--nota-midnight` / `--nota-coral` /
`--nota-saffron`), `--type-h1` = `clamp(30px, 2.6vw, 44px)`, `--nota-blue-900`
= `#264961`, `--nota-blue-500` = `#407598`, tous les titres visibles en Sora,
et les deux thèmes qui répondent.

### Les surfaces hors gardes

| Surface | Verdict |
| --- | --- |
| `docs/business-plan.html` | rampe ADR 0048 **exacte** (les 8 barreaux) ; lockup à jour ; badge remis sur le jeton |
| `docs/pitch-deck.html` | rampe ADR 0048 **exacte** ; mot dessiné à jour ; badge remis sur le jeton |
| `docs/planning/render-business-plan.py` | **dérive corrigée** — il regénérait l'ancien A |
| `docs/pitch-deck/nota-mark.svg` | conforme (tracé courant) |
| **les 8 `.pptx` de `docs/`** | **tous périmés** — détail ci-dessous |
| `apps/api/src/emails.js` | conforme — rampe claire aplatie exacte, badge sur `#407598`, rayons 12/8/6/3 px ; **deux commentaires périmés corrigés** |
| `docs/signature-courriel.html` | conforme (OTA, badge `#407598`, rayon 3 px) |
| `apps/web/public/signature.html` | conforme — les trois lockups sont des `<use>` |
| `apps/web/public/brand.html` | conforme — cinq `<use>`, aucun mot vivant |
| `apps/web/seo-pages.mjs` | **exemplaire** — il lit le bloc `<symbol>` de `index.html` et **lève une erreur** si les symboles disparaissent |
| `manifest.webmanifest` / `manifest.en.webmanifest` | conformes — `theme_color #386888`, `background_color #101820` |
| `favicon.svg` (web et admin) | dessin identique (l'admin ne diffère que par son `aria-label`) |
| `icon-192.png`, `icon-512.png`, `og.png` | **à jour** — RMSE ≈ 0 contre un rendu frais du SVG courant |
| `apple-touch-icon.png` | **à jour** — RMSE **exactement 0** une fois le rendu frais aplati sur `#264961` ; les coins pleins sont voulus (iOS pose son propre masque) |
| `apps/web/public/brand-blanc.html` | **non mesuré et périmé** (§ 4.2) |

#### Les rasters : à jour, mais ils l'ont été de justesse

La mesure ci-dessus est prise **après** la reprise de la session principale.
L'histoire compte, parce que le trou qu'elle révèle est toujours là :

- **les trois rasters PWA étaient bel et bien périmés à `HEAD`** — ils
  portaient encore **le point signal ROND et la tuile `rx 12`**, deux dessins
  retirés. Ils ont été re-rendus depuis `favicon.svg` à 03 h 18, et
  `apple-touch-icon.png` est désormais aplati sur la couleur de la tuile pour
  qu'iOS ne peigne pas du noir dans les coins transparents ;
- **`og.svg` peignait sa ligne de soutien en `#607986`**, l'encre atténuée que
  `styles.css` a explicitement retirée à 4,49:1. Corrigée en `#526b78`, et le
  condensat ré-épinglé dans `truthful-claims.test.mjs` ;
- l'écart d'encre du mot entre `og.svg` (`#101b26`) et la page
  (`--brand-word-ink`, blue-800) **n'est pas une dérive** : l'ADR 0048 veut que
  le mot prenne l'encre existante de la page à l'intérieur d'`og.svg`. À ne pas
  « corriger ».

**Le trou reste ouvert :** rien ne régénère ces quatre PNG et **aucun test ne
les lit**. Une garde qui rastérise `favicon.svg` / `og.svg` et compare au PNG
commis (les commandes du § 1 font exactement cela) fermerait la brèche. C'est
la seule partie de la marque où le dépôt ne se surveille pas lui-même.

#### Les huit `.pptx`

Aucun n'est régénéré ici, comme demandé. Deux familles :

| Fichier | Palette embarquée | État |
| --- | --- | --- |
| `nota-pitch-deck.pptx` | `#10233F` `#1B3A63` `#E5A13A` | palette d'avant l'ADR |
| `nota-pitch-deck-learning-loop.pptx` | `#1D4772` `#F0A45D` `#DDEAF2` | palette d'avant l'ADR |
| `nota-pitch-deck-learning-loop-v2.pptx` | `#10233F` `#33415C` | palette d'avant l'ADR |
| `nota-pitch-deck-learning-loop-v3.pptx` | `#10233F` `#33415C` | palette d'avant l'ADR |
| `nota-pitch-deck-learning-loop-final.pptx` | `#10233F` `#1B3A63` `#E5A13A` | palette d'avant l'ADR |
| `nota-pitch-deck-legal.pptx` | `#1D4772` `#234767` `#F0A45D` | palette d'avant l'ADR |
| `nota-pitch-deck-brand-refresh.pptx` | `#365B62` `#162A32` `#466C72` | **le vert-sarcelle retiré** |
| `nota-pitch-deck-brand-refresh-v3.pptx` | `#386888` `#274A62` `#101B26` `#407598` | rampe **juste**, mais son `image.png` embarqué dessine **la tuile arrondie et le point ROND** — le dessin retiré |

Autrement dit : sept sur huit sont faux sur la couleur, et le huitième — le
seul « brand refresh » abouti — est faux sur le dessin. Tous précèdent le
2026-09-11. Ils demandent une régénération complète, pas une retouche.

---

## 3. Les correctifs appliqués

| Fichier | Ce qui a changé |
| --- | --- |
| `e2e/brand-conformance.spec.js` | la porte « signature bêta » est fermée aux visiteurs anonymes depuis le 2026-09-12 (`GATED_PANES` dans `app.js`) : la garde atterrissait sur le carnet, ne mesurait donc jamais la bêta, et la feuille de connexion avalait le clic sur l'interrupteur de thème. Un drapeau `account: true` sème le profil client qui ouvre la porte. **Aucune assertion n'a été affaiblie.** |
| `docs/planning/render-business-plan.py` | `brand_lockup()` **lit** désormais les deux `<symbol>` de `apps/web/public/index.html` (nouvelle fonction `symbol_drawing`, constante `LOCKUP_SOURCE`) au lieu d'en garder une copie à la main — copie qui portait encore le A à sommet carré, d'avant le 2026-09-12. Le script s'arrête net si les symboles disparaissent. |
| `docs/planning/render-business-plan.py` | `.plan-brand-region` : `border-radius:4px` → `var(--radius-xs,3px)` — le badge QUÉBEC est au barreau de 3 px du registre carré, pas à un `4px` en dur qui n'est sur aucun barreau |
| `docs/pitch-deck.html` | idem : `--radius-xs:3px` déclaré dans le bloc de jetons, `.brand-region` posée dessus |
| `apps/api/src/emails.js` | deux commentaires décrivaient encore **le badge pâle retiré** (`--nota-blue-50` sur texte `--nota-blue-800`) alors que le code rend bien le badge sur `#407598` en blanc. Le code n'a pas changé ; la description, oui. |

Les trois premières lignes touchent des fichiers passés depuis à `nota-c2` ;
elles sont posées, mesurées et vertes, et le § 4.8 dit ce qui reste à y faire.

Mesuré après coup : les deux badges de `docs/` calculent **3 px** dans le
navigateur ; le générateur du plan rend maintenant le A à sommet coupé et les
jambages du N à `8.5` ; `emails-brand.test.mjs` reste à 87 / 87 ;
`brand-conformance.spec.js` est à **14 / 14**.

---

## 4. Ce qui reste ouvert et exige une décision du propriétaire

### 4.1 La question de copie de l'ADR est **déjà réglée dans l'arbre**

L'ADR 0048 laisse ouvert, sous « Still open », trois lockups qui posaient la
marque à côté du texte vivant « nota. » — le N était dit deux fois et un point
s'ajoutait. **Ce n'est plus vrai d'aucun des trois.** Mesuré aujourd'hui :

| Endroit | Ce que ça épelle aujourd'hui |
| --- | --- |
| `apps/web/public/signature.html:46` (en-tête de la salle) | `<use href="#nota-logomark">` + `<use href="#nota-wordmark">` — le mot **dessiné**. Aucun texte vivant. |
| `apps/web/public/signature.html:76` (bandeau vidéo) | idem |
| `apps/web/public/signature.html:96` (pied de page) | idem |
| `apps/web/public/brand.html` (lignes 231, 261, 262, 311) | cinq `<use href="#nota-logomark">` ; aucun « nota. » vivant nulle part |
| `apps/api/src/emails.js` (`logoHeader`, ligne ~296) | la tuile épelle **`N`** suivi du carré signal `■`, puis le mot épelle **`OTA`** suivi du point dans la couleur signal. Lu bout à bout : **`N OTA.`** — jamais « nota. ». |

Les trois `aria-label` de la salle disent `« Nota »` (le nom accessible, pas de
la copie visible) et le courriel expose une seule image nommée
`« Nota Québec »`.

**Décision demandée :** une phrase pour retirer le paragraphe « Still open » de
l'ADR 0048, qui décrit un état que le code n'a plus.

### 4.2 Les fichiers de dessin en retard

- `apps/web/public/brand-explorations.html` — **rattrapé pendant la passe**. À
  la première mesure, la tuile 01 « Monogramme lié », qui est la production,
  portait encore l'ancien A, et c'était l'unique échec de
  `brand-conformance.spec.js` (`« missing the A wears the cut apex »`). La
  session principale a posé les nouvelles graisses : dernière mesure **14 / 14
  au vert**. Rien à faire.
- `apps/web/public/brand-blanc.html` — **toujours en retard**. Fichier non
  suivi par git, servi depuis `public/`, et **absent de la liste des surfaces**
  de la garde : personne ne le mesure. Il porte encore l'ancien O, l'ancien T
  et les jambages du N à `7.5`. À rattacher à `SURFACES` dans
  `brand-conformance.spec.js` — c'est ce qui l'aurait attrapé — ou à retirer
  s'il n'est pas destiné à être servi.

### 4.2 bis Le trou des rasters

Rien ne régénère `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` et
`og.png`, et aucun test ne les lit. Ils étaient périmés ce matin encore (§ 2).
**Décision demandée :** ajouter une garde qui rastérise `favicon.svg` et
`og.svg` et compare aux PNG commis — c'est une dizaine de lignes, et c'est le
dernier endroit de la marque qui ne se surveille pas.

### 4.3 Un même rôle, trois noms de jeton

Le blanc posé sur un aplat saturé (le texte du badge QUÉBEC) s'appelle :

- `--on-accent` dans `styles.css` et `admin.css` — le nom que l'ADR emploie ;
- `--on-fill` dans `docs/business-plan.html` ;
- `--on-signal` dans `docs/pitch-deck.html`.

Même valeur (`#ffffff`), même rôle, trois vocabulaires. Rien n'est cassé ; la
règle « la couleur est assignée par rôle » l'est un peu. Non corrigé : c'est un
renommage transversal, pas une dérive de rendu.

### 4.4 La console d'administration n'a pas de `theme-color` sombre

`apps/web/public/index.html` porte les deux métas (`#386888` clair, `#101820`
sombre) ; `apps/admin/public/index.html` n'en porte qu'une, la claire, alors
que la console a bel et bien un thème sombre qui répond à la mesure. L'ADR dit
que la chrome du navigateur suit le canevas. `ux-nav.test.mjs` ne mesure que le
web, donc rien ne l'a vu. Non corrigé : le fichier était gelé.

### 4.5 Les huit `.pptx`

À régénérer depuis la marque courante, ou à archiver. Voir le tableau du § 2.

### 4.6 Quatre tests rouges qui ne sont pas de la marque

`npm run test:web` finit à 1030 verts / 4 rouges. Les quatre viennent
d'**éditions non commises de `apps/web/public/index.html`** faites par une
session parallèle dans le même arbre de travail, pas de la marque et pas de
cette passe :

| Test | Cause |
| --- | --- |
| `partners-referral.test.mjs` — « the pane stays strict… » | une bande animée `pr-vig` est réapparue dans le volet partenaires (0 occurrence à `HEAD`, 15 dans l'arbre) |
| `partners-referral.test.mjs` — « the page reads hero → story… » | même cause |
| `smoke.test.mjs` — « notary landing presents… a truthful free beta » | « système spécialisé » réécrit en « Notre IA propriétaire » dans l'arbre, sans mise à jour du test |
| `smoke.test.mjs` — « notary beta notice translates in English… » | même cause |

Un cinquième test, `ux-nav.test.mjs` « Beta opens from the footer », est
**instable sous concurrence** : rouge dans la suite complète, vert seul et vert
en relance. À surveiller, pas à corriger à l'aveugle.

### 4.7 Deux coquilles de domaine croisées en chemin

Hors marque, mais visibles par un lecteur externe :

- `docs/business-plan.html` (et `docs/business-plan.md`) annoncent
  **`https://plan.gonata.ca/`** — `gonata`, pas `gonota` ;
- `apps/web/public/brand.html:247` porte le sur-titre **`brand.nota.ca · Nota`**
  alors que `nota.ca` appartient à un tiers depuis 2014 et que l'hôte réel est
  `brand.gonota.ca`.

### 4.8 Note adressée à la session `nota-c2`

Cinq fichiers sont passés sous ta main pendant cette passe : `pitch-deck.html`,
`business-plan.html`, `render-business-plan.py`, `admin.css`,
`admin/public/index.html`. Voici ce que j'y avais mesuré, pour que tu n'aies pas
à le redécouvrir.

**Déjà posé et vert — à conserver, pas à refaire :**

1. `render-business-plan.py` — `brand_lockup()` **ne garde plus de copie du
   dessin**. Il lit les deux `<symbol>` de `apps/web/public/index.html`
   (fonction `symbol_drawing`, constante `LOCKUP_SOURCE`) et s'arrête net s'ils
   disparaissent. C'était une vraie dérive : la copie à la main portait encore
   le A à sommet carré, et **la régénération du plan aurait réécrit l'ancien A
   par-dessus le nouveau**. C'est le même motif que `seo-pages.mjs`, qui est
   exemplaire sur ce point.
2. `pitch-deck.html` — `--radius-xs:3px` déclaré, `.brand-region` posée dessus.
3. `render-business-plan.py` — `.plan-brand-region` sur `var(--radius-xs,3px)`.

**Ce qui reste à faire chez toi :**

- **le repli `,3px` de `.plan-brand-region` est provisoire.** Le plan a été
  régénéré pendant la passe avec un nouveau bloc de jetons (polices embarquées
  en base64), et ce bloc **ne déclare pas `--radius-xs`**. Déclare
  `--radius-xs:3px` dans le `:root` du plan, puis retire le repli. Sans lui, le
  badge QUÉBEC retomberait à `0` — un carré vif, pas le barreau de 3 px du
  registre.
- **`apps/admin/public/index.html` n'a qu'une méta `theme-color`**, la claire
  (`#386888`). Le web en porte deux (`#386888` clair, `#101820` sombre) et la
  console a bel et bien un thème sombre qui répond. `ux-nav.test.mjs` ne mesure
  que le web : personne ne l'a vu.
- `--on-fill` (plan) et `--on-signal` (deck) nomment le rôle que l'ADR appelle
  `--on-accent` — voir § 4.3.
- Les deux surfaces `docs/` passent `brand-conformance.spec.js` : rampe ADR 0048
  exacte sur les huit barreaux, mot dessiné à jour, les deux thèmes qui
  répondent. Rien d'autre à y corriger côté marque.
