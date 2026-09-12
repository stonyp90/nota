/**
 * LA PLANCHE DES CINQ MARQUES EST CONSTRUITE, PAS RECOPIÉE.
 *
 * `apps/web/public/brand-compose.html` monte la même marque cinq fois, en huit
 * pièces chacune : quarante panneaux au balisage identique dont SEUL
 * l'identifiant du dessin change. Écrit à la main, le fichier dériverait au
 * premier coup d'œil de travers — et c'est exactement ce qu'il ne doit pas
 * faire, puisque sa raison d'être est de rendre deux marques comparables.
 *
 * Ce générateur vit donc dans l'arbre, à côté de la page qu'il produit, comme
 * `docs/planning/render-business-plan.py` pour le plan d'affaires : la CI peut
 * le relancer, une autre session peut le corriger, et brand-compose.test.mjs
 * refuse tout écart entre la page servie et ce qu'il produit.
 *
 *   node apps/web/brand-compose.mjs                     écrit la page
 *   node --test apps/web/test/brand-compose.test.mjs    vérifie qu'elle est à jour
 *
 * LE O, LE T ET LE A NE SONT PAS RECOPIÉS ICI : ils sont lus dans le symbole
 * `#nota-wordmark` d'index.html, le dessin de référence que ux-nav.test.mjs
 * épingle. Le 2026-09-12, l'apex du A a été biseauté dans index.html et deux
 * planches de marque ont gardé l'ancien pendant des heures. Lire la source
 * rend ce décalage impossible : seules les trois formes NEUVES du N, qui
 * n'existent nulle part ailleurs, sont définies dans ce fichier.
 *
 * Les polices sont déclarées en quatre blocs (latin ET latin-ext, depuis
 * /fonts) : la page est inscrite dans polices-hebergees.test.mjs, qui tombe si
 * une réécriture les oublie.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

/** Les trois lettres de référence, dans l'ordre où le mot les pose. */
export function lettresDeReference() {
  const symbole = /<symbol id="nota-wordmark"[\s\S]*?<\/symbol>/.exec(lire('public/index.html'));
  if (!symbole) throw new Error('le symbole #nota-wordmark est introuvable dans index.html');
  const formes = [...symbole[0].matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  if (formes.length !== 3) throw new Error('index.html doit porter trois lettres (O, T, A), trouvé ' + formes.length);
  return formes;
}

/** Les trois N, neufs : tige de 7,3 et capitale de 28, les mesures exactes des
 *  lettres ci-dessus, pour que la lettre ajoutée pèse le même poids. */
const N = {
  plein: '<rect x="0" y="3.5" width="7.3" height="28"/>\n        <rect x="19.1" y="3.5" width="7.3" height="28"/>\n        <polygon points="0,3.5 7.8,3.5 26.4,31.5 18.6,31.5"/>',
  // La diagonale flotte : deux jours d'un millimètre la séparent des tiges.
  couture: '<rect x="0" y="3.5" width="7.3" height="28"/>\n        <rect x="19.1" y="3.5" width="7.3" height="28"/>\n        <polygon points="8.4,4.40 18.0,18.86 18.0,30.60 8.4,16.14"/>',
  // La diagonale dépasse la ligne de capitale en haut comme en bas.
  paraphe: '<rect x="0" y="3.5" width="7.3" height="28"/>\n        <rect x="19.1" y="3.5" width="7.3" height="28"/>\n        <polygon points="-2.6,-0.42 5.2,-0.42 29.0,35.42 21.2,35.42"/>',
};

/** Le point du mot. En bas, c'est un point ; en haut, c'est le signal que la
 *  tuile portait. Blanc dans les deux cas : la planche est monochrome. */
const POINT = { bas: '<rect x="87.4" y="27.1" width="4.4" height="4.4"/>', haut: '<rect x="84.0" y="3.5" width="7.3" height="7.3"/>' };

/** Un symbole dont le viewBox commence à 3,5 DANS un svg qui commence à 3,5
 *  décale le dessin de 3,5 et le rogne par le haut : les deux viewBox se
 *  composent. Tout part donc de l'origine, et la translation ramène le dessin. */
function symbole({ id, boite, cale, n, mot }) {
  const lettres = mot ? lettresDeReference().map((d) => '<path d="' + d + '"/>').join('\n        ') : null;
  return '    <symbol id="' + id + '" viewBox="' + boite + '">\n'
    + '      <g transform="translate(' + cale + ')">\n'
    + '      <g fill="currentColor">\n        ' + N[n] + '\n      </g>\n'
    + (mot ? '      <g fill="currentColor" fill-rule="evenodd" transform="translate(27.8 0)">\n        '
        + lettres + '\n        ' + POINT[mot] + '\n      </g>\n' : '')
    + '    </g>\n    </symbol>';
}

function dessins() {
  return [
    symbole({ id: 'n-plein',   boite: '0 0 26.4 28', cale: '0 -3.5',   n: 'plein' }),
    symbole({ id: 'n-couture', boite: '0 0 26.4 28', cale: '0 -3.5',   n: 'couture' }),
    symbole({ id: 'n-paraphe', boite: '0 0 31.6 38', cale: '2.6 1.42', n: 'paraphe' }),
    symbole({ id: 'w-plein',      boite: '0 0 119.6 28', cale: '0 -3.5', n: 'plein',   mot: 'bas' }),
    symbole({ id: 'w-couture',    boite: '0 0 119.6 28', cale: '0 -3.5', n: 'couture', mot: 'bas' }),
    symbole({ id: 'w-paraphe',    boite: '0 0 127.6 39', cale: '4 1.5',  n: 'paraphe', mot: 'bas' }),
    symbole({ id: 'w-point-haut', boite: '0 0 119.6 28', cale: '0 -3.5', n: 'plein',   mot: 'haut' }),
  ].join('\n');
}

const POLICES = "    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: swap;\n      src: url('/fonts/inter-latin-ext.woff2') format('woff2');\n      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }\n    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: swap;\n      src: url('/fonts/inter-latin.woff2') format('woff2');\n      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }\n    @font-face { font-family: 'Sora'; font-style: normal; font-weight: 100 800; font-display: swap;\n      src: url('/fonts/sora-latin-ext.woff2') format('woff2');\n      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }\n    @font-face { font-family: 'Sora'; font-style: normal; font-weight: 100 800; font-display: swap;\n      src: url('/fonts/sora-latin.woff2') format('woff2');\n      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }";

/** Les cinq marques. Le dessin change, tout le reste est identique. */
const MARQUES = [
  { num: "01", titre: "Le mot nu", mot: "w-plein", motBoite: "0 0 119.6 28", lettre: "n-plein", lettreBoite: "0 0 26.4 28", badge: "signal",
    pourquoi: "Le mot blanc et rien d’autre, le badge Québec gardant le bleu signal. C’est la marque la plus proche de celle d’aujourd’hui : on a retiré la tuile, pas la couleur." },
  { num: "02", titre: "Le mot nu, badge éteint", mot: "w-plein", motBoite: "0 0 119.6 28", lettre: "n-plein", lettreBoite: "0 0 26.4 28", badge: "nu",
    pourquoi: "Le même dessin, mais « Québec » perd sa pastille : capitales espacées, à l’encre de la barre. Un seul bloc de couleur reste dans l’écran, le bouton qui inscrit." },
  { num: "03", titre: "La couture", mot: "w-couture", motBoite: "0 0 119.6 28", lettre: "n-couture", lettreBoite: "0 0 26.4 28", badge: "nu",
    pourquoi: "La diagonale se détache des deux tiges. Le N garde sa forme mais respire, et l’icône d’app devient reconnaissable à un seul trait. Mesuré sur la planche : la couture tient jusqu’au favicon de 32 px, se referme à 16 px et le N y redevient plein." },
  { num: "04", titre: "Le paraphe", mot: "w-paraphe", motBoite: "0 0 127.6 39", lettre: "n-paraphe", lettreBoite: "0 0 31.6 38", badge: "nu",
    pourquoi: "La diagonale dépasse la ligne de capitale en haut comme en bas : un trait de plume qui traverse le mot. La plus parlante pour un acte signé, la plus exigeante en air autour." },
  { num: "05", titre: "Le point remonte", mot: "w-point-haut", motBoite: "0 0 119.6 28", lettre: "n-plein", lettreBoite: "0 0 26.4 28", badge: "nu",
    pourquoi: "Le carré de signal ne disparaît pas : il devient le point du mot et monte à la hauteur de capitale, dans le coin exact où la tuile le portait. La seule forme carrée qui survit à la tuile, et elle est blanche." },
];

const TETE = "<!doctype html>\n<html lang=\"fr-CA\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"robots\" content=\"noindex,nofollow\">\n  <title>Nota — les cinq marques, composées</title>\n  <style>\n    /* ==========================================================================\n       PLANCHE 06 · « Composer tous les brands » (propriétaire, 2026-09-12)\n\n       La planche 05 montrait cinq DESSINS. Celle-ci en fait cinq MARQUES : pour\n       chacune, le lockup sur nuit et sur papier, la version empilée, la lettre\n       seule en icône et en favicon, la barre d'accueil dans les deux thèmes, la\n       carte sociale et la signature de courriel. Un même bloc de balisage,\n       répété cinq fois, un seul identifiant de symbole qui change : ce qui\n       diffère d'une marque à l'autre est donc uniquement le dessin.\n\n       Page de référence interne, hors navigation, non indexée.\n       ========================================================================== */\n/*<<FACES>>*/\n\n    /* Jetons repris verbatim de styles.css (ADR 0048). Aucune couleur littérale\n       hors de ce bloc : le sombre ET le clair vivent ici, parce qu'une planche\n       montre les deux thèmes côte à côte au lieu d'en suivre un. */\n    :root {\n      color-scheme: dark;\n      --nota-blue-950:#101b26; --nota-blue-900:#264961; --nota-blue-800:#274a62;\n      --nota-blue-600:#386888; --nota-blue-500:#407598; --nota-blue-400:#78a9bf;\n      --nota-blue-50:#ebf1f5;\n      --midnight:#0d141b; --canvas:#101820; --surface:#152532; --line:#294353;\n      --ink:#f4f8fa; --muted:#afc2cf; --pure:#ffffff;\n      --paper:#fbfdfd; --ink-l:#101b26; --muted-l:#526b78; --line-l:#c5d8df; --wash-l:#ebf1f5;\n      --font-sans:'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;\n      --font-display:'Sora', var(--font-sans); --weight-display:700;\n      --type-h1:clamp(26px, 2.25vw, 36px); --type-h1-lh:1.12; --type-h1-ls:-.04em;\n      --type-h3:17px; --type-h3-lh:1.3; --type-h3-ls:-.02em;\n      --type-body:16px; --type-body-lh:1.5;\n      --radius-xs:3px; --radius-sm:6px; --radius:8px; --radius-lg:12px;\n      --header-h:52px;\n    }\n    * { box-sizing:border-box; }\n    body { margin:0; background:var(--canvas); color:var(--ink); font:var(--type-body)/var(--type-body-lh) var(--font-sans); }\n    main { width:min(1240px, calc(100% - 40px)); margin:0 auto; padding:52px 0 80px; }\n    h1, h2 { font-family:var(--font-display); font-weight:var(--weight-display); }\n    h1 { margin:10px 0 10px; font-size:var(--type-h1); letter-spacing:var(--type-h1-ls); line-height:var(--type-h1-lh); }\n    h2 { margin:0; font-size:var(--type-h3); letter-spacing:var(--type-h3-ls); line-height:var(--type-h3-lh); }\n    /* Le registre d'encre (ADR 0048) nomme le sur-titre : un eyebrow EST un\n       titre, donc il se peint \u00e0 l'encre, jamais au bleu de marque. Le bleu ne\n       fait que mentionner une information. */\n    .eyebrow { display:inline-block; font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--ink); }\n    .lede { max-width:700px; color:var(--muted); margin:0; }\n\n    /* Une marque = une planche : un en-tête, puis huit pièces. */\n    .marque { margin-top:44px; padding-top:26px; border-top:1px solid var(--line); }\n    .marque-head { display:flex; justify-content:space-between; gap:20px; align-items:baseline; margin-bottom:16px; }\n    .num { font-size:12px; font-weight:800; letter-spacing:.08em; color:var(--muted); }\n    .why { margin:0; max-width:560px; color:var(--muted); font-size:13px; text-align:right; }\n    .compo { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; }\n    .wide { grid-column:1 / -1; }\n\n    /* Chaque pièce : un cadre, une légende en pied. */\n    .piece { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }\n    .piece .body { flex:1; display:grid; place-items:center; gap:16px; padding:30px 22px; background:var(--midnight); }\n    .piece .cap { padding:9px 14px; background:var(--surface); border-top:1px solid var(--line); font-size:11px; letter-spacing:.06em; color:var(--muted); }\n    .piece.clair .body { background:var(--paper); color:var(--ink-l); }\n    .piece.clair .cap { background:var(--wash-l); border-top-color:var(--line-l); color:var(--muted-l); }\n\n    /* Le lockup : le mot, un badge. Une seule mesure, --cap, commande tout. */\n    .lock { --cap:34px; display:flex; align-items:center; gap:calc(var(--cap) * .42); color:var(--pure); }\n    .piece.clair .lock { color:var(--ink-l); }\n    .lock svg { display:block; height:var(--cap); width:auto; }\n    .badge { font-size:calc(var(--cap) * .3); font-weight:800; letter-spacing:.1em; text-transform:uppercase; white-space:nowrap;\n      padding:.55em .7em; border-radius:var(--radius-xs); background:var(--nota-blue-500); color:var(--pure); }\n    .badge.nu { background:none; padding:.55em 0; color:var(--nota-blue-400); }\n    /* Le paraphe déborde sa ligne de capitale : son viewBox fait 39 de haut\n       pour 28 de capitale. Sans compensation, régler une hauteur de svg\n       réglerait la BOÎTE et non la lettre, et le mot paraîtrait 28 % plus\n       petit que les quatre autres. 39 / 28 = 1,393, appliqué partout où une\n       hauteur est posée. */\n    .marque.haut .lock svg, .marque.haut .empile svg { height:calc(var(--cap, 38px) * 1.393); }\n    .marque.haut .empile svg { height:calc(38px * 1.393); }\n    .marque.haut .icone svg { height:64%; }\n    .marque.haut .fav svg { height:81%; }\n    .piece.clair .badge.nu { color:var(--nota-blue-600); }\n\n    /* Empilé : le mot, un filet, le lieu au pas très ouvert. */\n    .empile { display:grid; justify-items:center; gap:11px; color:var(--pure); }\n    .empile svg { display:block; height:38px; width:auto; }\n    .empile .filet { width:100%; height:1px; background:currentColor; opacity:.3; }\n    .empile .lieu { font-size:11px; font-weight:800; letter-spacing:.42em; text-indent:.42em; text-transform:uppercase; color:var(--nota-blue-400); }\n\n    /* La lettre : trois fonds, puis les deux favicons à leur taille réelle. */\n    .lettres { display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap; }\n    .icone { display:grid; place-items:center; width:76px; height:76px; border-radius:16px; background:var(--nota-blue-900); color:var(--pure); }\n    .icone.nuit { background:var(--midnight); box-shadow:inset 0 0 0 1px var(--line); }\n    .icone.signal { background:var(--nota-blue-500); }\n    .icone svg { display:block; height:46%; width:auto; }\n    .fav { display:grid; place-items:center; background:var(--nota-blue-900); color:var(--pure); border-radius:4px; }\n    .fav.px32 { width:32px; height:32px; } .fav.px16 { width:16px; height:16px; border-radius:2px; }\n    .fav svg { display:block; height:58%; width:auto; }\n\n    /* La barre : réplique de .site-header (hauteur, gouttières, tailles). */\n    .bande { background:var(--midnight); }\n    .bande.clair { background:var(--paper); }\n    .bande .wrap { display:flex; align-items:center; gap:12px; height:var(--header-h); padding-inline:16px; }\n    .bande .nav { display:flex; align-items:center; gap:4px; margin-inline:auto; }\n    .bande .tab { padding:7px 11px; border-radius:var(--radius-sm); font-size:13px; font-weight:700; color:var(--muted); white-space:nowrap; }\n    .bande .tab.on { color:var(--ink); box-shadow:inset 0 0 0 1px var(--line); }\n    .bande .droite { display:flex; align-items:center; gap:10px; font-size:12px; font-weight:700; color:var(--muted); }\n    .bande .cta { padding:6px 12px; border-radius:var(--radius-sm); background:var(--nota-blue-500); color:var(--pure); }\n    .bande.clair .tab { color:var(--muted-l); } .bande.clair .tab.on { color:var(--ink-l); box-shadow:inset 0 0 0 1px var(--line-l); }\n    .bande.clair .droite { color:var(--muted-l); } .bande.clair .cta { color:var(--pure); }\n    .bande .lock { --cap:19px; }\n    .bande.clair .lock { color:var(--ink-l); }\n\n    /* La carte sociale, au format que servent les réseaux (1200 × 630). */\n    .og { aspect-ratio:1200 / 630; display:grid; place-items:center; align-content:center; gap:18px; padding:26px; background:var(--midnight); text-align:center; }\n    .og .lock { --cap:clamp(26px, 4.4vw, 44px); }\n    .og .phrase { font:var(--weight-display) clamp(15px, 1.9vw, 22px)/1.15 var(--font-display); letter-spacing:-.04em; color:var(--ink); }\n    .og .pied { font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--nota-blue-400); }\n\n    /* La signature de courriel : ce que voit un notaire dans sa boîte. */\n    .sig { display:flex; gap:16px; align-items:center; padding:20px 22px; background:var(--paper); color:var(--ink-l); width:100%; }\n    .sig .trait { width:2px; align-self:stretch; background:var(--nota-blue-500); flex:none; }\n    .sig .lock { --cap:22px; color:var(--ink-l); }\n    .sig .qui { font-size:13px; line-height:1.45; }\n    .sig .nom { font-weight:800; letter-spacing:-.01em; }\n    .sig .role, .sig .coord { color:var(--muted-l); }\n    .sig .coord a { color:var(--nota-blue-600); text-decoration:none; }\n\n    @media (max-width:820px) {\n      .marque-head { display:block; } .why { text-align:left; margin-top:8px; }\n      .compo { grid-template-columns:1fr; } .bande .nav { display:none; }\n    }\n  </style>\n</head>\n<body>\n  <!-- ══ Les sept dessins, une seule fois ═════════════════════════════════════\n       Le N est neuf : tiges de 7,3 et capitale de 28, les mesures exactes du\n       « OTA. » d'origine. Le groupe « OTA. » est translaté de 27,8 (26,4 de N\n       + 1,4 d'approche). Chaque symbole porte un viewBox à l'origine zéro :\n       un symbole dont le viewBox commence à 3,5 dans un svg qui commence à 3,5\n       décale le dessin de 3,5 et le rogne par le haut.\n       ════════════════════════════════════════════════════════════════════════ -->\n  <svg aria-hidden=\"true\" focusable=\"false\" width=\"0\" height=\"0\" style=\"position:absolute\">\n    __DEFS__\n  </svg>\n\n  <main>\n    <div class=\"eyebrow\">Explorations 06 · Nota</div>\n    <h1>Les cinq marques, composées.</h1>\n    <p class=\"lede\">Un dessin n'est pas une marque. Chacune des cinq pistes est ici montée en entier : le lockup sur nuit et sur papier, la version empilée, la lettre en icône et en favicon, la barre d'accueil dans les deux thèmes, la carte sociale et la signature de courriel. Le balisage est identique d'une planche à l'autre, seul l'identifiant du dessin change.</p>\n";
const PLANCHE = "\n    <section class=\"marque __CLS__\">\n      <div class=\"marque-head\">\n        <div><div class=\"num\">__NUM__</div><h2>__TITRE__</h2></div>\n        <p class=\"why\">__POURQUOI__</p>\n      </div>\n      <div class=\"compo\">\n\n        <div class=\"piece\">\n          <div class=\"body\"><span class=\"lock\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg><span class=\"badge __BADGE__\">Québec</span></span></div>\n          <div class=\"cap\">Lockup · fond nuit</div>\n        </div>\n\n        <div class=\"piece clair\">\n          <div class=\"body\"><span class=\"lock\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg><span class=\"badge __BADGE__\">Québec</span></span></div>\n          <div class=\"cap\">Lockup · fond papier</div>\n        </div>\n\n        <div class=\"piece\">\n          <div class=\"body\"><span class=\"empile\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg><span class=\"filet\"></span><span class=\"lieu\">Québec</span></span></div>\n          <div class=\"cap\">Empilé · pour un carré ou un pied de page</div>\n        </div>\n\n        <div class=\"piece\">\n          <div class=\"body\"><span class=\"lettres\">\n            <span class=\"icone\"><svg viewBox=\"__LV__\"><use href=\"#__L__\"/></svg></span>\n            <span class=\"icone nuit\"><svg viewBox=\"__LV__\"><use href=\"#__L__\"/></svg></span>\n            <span class=\"icone signal\"><svg viewBox=\"__LV__\"><use href=\"#__L__\"/></svg></span>\n            <span class=\"fav px32\"><svg viewBox=\"__LV__\"><use href=\"#__L__\"/></svg></span>\n            <span class=\"fav px16\"><svg viewBox=\"__LV__\"><use href=\"#__L__\"/></svg></span>\n          </span></div>\n          <div class=\"cap\">La lettre seule · icône d’app, puis favicons à 32 et 16 px</div>\n        </div>\n\n        <div class=\"piece wide\">\n          <div class=\"bande\"><div class=\"wrap\">\n            <span class=\"lock\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg><span class=\"badge __BADGE__\">Québec</span></span>\n            <span class=\"nav\"><span class=\"tab\">Carnet</span><span class=\"tab on\">Espace notaire</span><span class=\"tab\">Partenaires</span><span class=\"tab\">Signature</span></span>\n            <span class=\"droite\"><span>FR | EN</span><span>Se connecter</span><span class=\"cta\">S’inscrire</span></span>\n          </div></div>\n          <div class=\"cap\">Barre d’accueil · thème sombre</div>\n        </div>\n\n        <div class=\"piece wide clair\">\n          <div class=\"bande clair\"><div class=\"wrap\">\n            <span class=\"lock\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg><span class=\"badge __BADGE__\">Québec</span></span>\n            <span class=\"nav\"><span class=\"tab\">Carnet</span><span class=\"tab on\">Espace notaire</span><span class=\"tab\">Partenaires</span><span class=\"tab\">Signature</span></span>\n            <span class=\"droite\"><span>FR | EN</span><span>Se connecter</span><span class=\"cta\">S’inscrire</span></span>\n          </div></div>\n          <div class=\"cap\">Barre d’accueil · thème clair</div>\n        </div>\n\n        <div class=\"piece\">\n          <div class=\"og\">\n            <span class=\"lock\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg></span>\n            <span class=\"phrase\">Votre projet. Votre notaire.</span>\n            <span class=\"pied\">Québec</span>\n          </div>\n          <div class=\"cap\">Carte sociale · 1200 × 630</div>\n        </div>\n\n        <div class=\"piece clair\">\n          <div class=\"body\" style=\"padding:0\">\n            <span class=\"sig\">\n              <span class=\"trait\"></span>\n              <span class=\"qui\">\n                <span class=\"lock\" style=\"margin-bottom:8px\"><svg viewBox=\"__WV__\"><use href=\"#__W__\"/></svg></span>\n                <div class=\"nom\">Anthony Paquet</div>\n                <div class=\"role\">Nota · Québec</div>\n                <div class=\"coord\"><a href=\"#\">anthony@nota.quebec</a></div>\n              </span>\n            </span>\n          </div>\n          <div class=\"cap\">Signature de courriel</div>\n        </div>\n\n      </div>\n    </section>\n";

export function build() {
  const blocs = MARQUES.map((m) => PLANCHE
    .replaceAll('__NUM__', m.num)
    .replaceAll('__TITRE__', m.titre)
    .replaceAll('__POURQUOI__', m.pourquoi)
    .replaceAll('__WV__', m.motBoite)
    .replaceAll('__W__', m.mot)
    .replaceAll('__LV__', m.lettreBoite)
    .replaceAll('__L__', m.lettre)
    .replaceAll('__BADGE__', m.badge)
    // Le paraphe déborde sa capitale : sa boîte fait 39 de haut pour 28 de
    // lettre, et la classe compense ce rapport partout où une hauteur est posée.
    .replaceAll('__CLS__', m.motBoite.endsWith('39') ? 'haut' : ''));
  return TETE.replace('/*<<FACES>>*/', POLICES).replace('__DEFS__', dessins())
    + blocs.join('') + '  </main>\n</body>\n</html>\n';
}

export const CIBLE = fileURLToPath(new URL('public/brand-compose.html', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(CIBLE, build());
  console.log('écrit ' + CIBLE);
}
