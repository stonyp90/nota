#!/usr/bin/env python3
"""Render the bilingual investor story as native, animatable SVG and print frames.
The SVG, accessible transcript and exported PDF share one content source.
Brand drawings and font scale follow the common Nota foundations.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path


OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
W, H = 1600, 900

# ADR 0048 dark canvas set (apps/web/public/styles.css :root:not([data-theme='light'])).
BG = "#101820"        # --bg
PANEL = "#0f2030"     # --surface
PANEL_2 = "#132b3f"   # --surface-inset
WHITE = "#f4f8fa"     # --ink, also --subtitle-ink on dark (kickers are ink, never blue)
MUTED = "#afc2cf"     # --ink-muted
LINE = "#294353"      # --border
# ADR 0048 ramp.
BLUE = "#78a9bf"      # --nota-blue-400, the text accent that reads on the dark canvas
SIGNAL = "#407598"    # --nota-blue-500, the signal square, badge ground, fills and strokes
STEEL = "#386888"     # --nota-blue-600
HALO = "#274a62"      # --nota-blue-800, the deep hover blue
MARK = "#264961"      # --nota-blue-900, the tile
ORANGE = "#f79009"    # --nota-orange-400: the ONE warm accent on dark, never the brand word

# ADR 0050: Sora 700 carries every title, Inter carries everything else.
DISPLAY = "Sora"
BODY = "Inter"
WEIGHT_DISPLAY = 700

# Type scale — apps/web/public/styles.css --type-* mapped to the frame. A 1600 px
# slide read across a room is a product page of ~1067 px held at arm's length, so
# every rung is the product token × 1.5 (h1 = its 36 px ceiling → 54; h2 24 → 36;
# h3 17 → 26; h4 15 → 22; lead 16 → 24; body 16 → 24; eyebrow 12 → 18). Line
# heights and tracking are the product's own (h1 1.12 / −.04em, h2 1.2 / −.035em,
# h3 1.3 / −.02em, eyebrow .1em). Large figures (48–78 px) are data display, not a
# text rung, and stay on Inter 700.
SCALE = W / 1066.67
TYPE = {
    "h1": round(36 * SCALE), "h2": round(24 * SCALE), "h3": round(17 * SCALE), "h4": round(15 * SCALE),
    "lead": round(16 * SCALE), "body": round(16 * SCALE), "eyebrow": round(12 * SCALE),
}
TRACK = {"h1": -.04, "h2": -.035, "h3": -.02, "h4": -.01, "eyebrow": .1}
H1_STEP = round(TYPE["h1"] * 1.12)

# Square-corner register: one radius scale (styles.css --radius-xs/sm/base/lg).
RADII = (3, 6, 8, 12)

# The five lockup ratios (ADR 0048, design 02 · layout 16), the badge's minimum size
# and its estimated width in em (Inter 800 caps + .1em tracking; rasterize-slides.mjs
# re-measures the text in Chromium and fits the ground to it).
LOCKUP = {"word": .48, "gap": .12, "badge_gap": .16, "badge_size": .16}
BADGE_MIN_PX = 9
BADGE_EM = 4.73
BADGE_PAD = (.55, .7)
BADGE_RADIUS = 3
WORD_VIEWBOX = (0, 3.5, 91.8, 28)   # the wordmark's cap band


def _brand_drawings() -> tuple[str, str]:
    """The decided lockup, read from the files that already draw it (never redrawn)."""
    mark_src = (OUT / "nota-mark.svg").read_text(encoding="utf-8")
    mark = re.search(r"<svg[^>]*>(.*)</svg>", mark_src, re.S)
    page = (ROOT / "docs" / "pitch-deck.html").read_text(encoding="utf-8")
    word = re.search(r'<svg class="brand-word" viewBox="0 3\.5 91\.8 28"[^>]*>(.*?)</svg>', page, re.S)
    if not mark or not word:
        sys.exit("render-slides: the lockup drawings were not found in nota-mark.svg / pitch-deck.html")
    inner = re.sub(r"<!--.*?-->", "", mark.group(1), flags=re.S).strip()
    return inner, word.group(1).strip()


MARK_SVG, WORD_SVG = _brand_drawings()


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def t(x: float, y: float, text: str, size: int = 28, color: str = WHITE,
      weight: int = 500, anchor: str = "start", letter: float = 0,
      font: str = BODY) -> str:
    return (f'<text x="{x}" y="{y}" fill="{color}" font-family="{font}" '
            f'font-size="{size}px" font-weight="{weight}" text-anchor="{anchor}" '
            f'letter-spacing="{letter}px">{esc(text)}</text>')


def display(x: float, y: float, text: str, size: int, color: str = WHITE,
            anchor: str = "start", letter: float = 0) -> str:
    """A title rung: the display face at the display weight."""
    return t(x, y, text, size, color, WEIGHT_DISPLAY, anchor, letter, DISPLAY)


def eyebrow(x: float, y: float, text: str, color: str = WHITE, anchor: str = "start") -> str:
    """The product's eyebrow: --type-eyebrow, .1em tracking, ink (never blue)."""
    return t(x, y, text.upper(), TYPE["eyebrow"], color, 700, anchor, TRACK["eyebrow"] * TYPE["eyebrow"])


def require_fonts() -> None:
    """Refuse to render without the brand faces: ImageMagick falls back silently."""
    if shutil.which("fc-list") is None or shutil.which("magick") is None:
        sys.exit("render-slides: needs `magick` and `fc-list` (fontconfig) on PATH")
    missing = []
    for family in (DISPLAY, BODY):
        found = subprocess.run(["fc-list", f":family={family}", "family"], capture_output=True, text=True, check=True).stdout
        if not any(line.strip().split(",")[0] == family for line in found.splitlines()):
            missing.append(family)
    if missing:
        sys.exit(
            "render-slides: font family not installed: " + ", ".join(missing)
            + ". ImageMagick would substitute a generic sans without failing, so no PNG was written."
            + " Install the face (Google Fonts, e.g. `brew install --cask font-sora font-inter`) and run again,"
            + " or write the frames with --svg-out and rasterize them with rasterize-slides.mjs."
        )


def line(x1: float, y1: float, x2: float, y2: float, color: str = LINE,
         width: int = 2, dash: str | None = None) -> str:
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{extra} />'


def snap(radius: float) -> int:
    """Snap a corner to the square register's scale (3 / 6 / 8 / 12)."""
    return min(RADII, key=lambda step: abs(step - radius))


def rect(x: float, y: float, w: float, h: float, fill: str = PANEL,
         stroke: str = "none", radius: int = 12, opacity: float = 1) -> str:
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{snap(radius)}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="2" opacity="{opacity}" />')


def square(cx: float, cy: float, r: float, fill: str = "none",
           stroke: str = LINE, width: int = 2, opacity: float = 1) -> str:
    """A node of half-size `r`, centred — the square register's answer to a circle.
    Corners follow the size: 3 for a dot, 6 for a marker, 8 for a badge, 12 for a card."""
    radius = 3 if r <= 12 else 6 if r <= 40 else 8 if r <= 100 else 12
    return (f'<rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" rx="{radius}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{width}" opacity="{opacity}" />')


def path(d: str, fill: str = "none", stroke: str = LINE, width: int = 2,
         opacity: float = 1) -> str:
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" opacity="{opacity}" />'


def mark(x: float, y: float, tile: float) -> str:
    """The tile alone (nota-mark.svg, 64-unit drawing) at `tile` px."""
    return f'<g transform="translate({x:g} {y:g}) scale({tile / 64:g})">{MARK_SVG}</g>'


def lockup(x: float, y: float, tile: float, ink: str = WHITE) -> list[str]:
    """Tile + O T A + QUÉBEC badge, design 02 · layout 16, every length from `tile`."""
    out = [mark(x, y, tile)]
    cap = tile * LOCKUP["word"]
    ws = cap / WORD_VIEWBOX[3]
    wx = x + tile + tile * LOCKUP["gap"]
    wy = y + tile / 2 - cap / 2 - WORD_VIEWBOX[1] * ws
    out.append(f'<g transform="translate({wx:.2f} {wy:.2f}) scale({ws:.4f})">{WORD_SVG.replace("currentColor", ink)}</g>')
    size = max(BADGE_MIN_PX, tile * LOCKUP["badge_size"])
    pad_y, pad_x = BADGE_PAD[0] * size, BADGE_PAD[1] * size
    bx = wx + WORD_VIEWBOX[2] * ws + tile * LOCKUP["badge_gap"]
    bw, bh = BADGE_EM * size + 2 * pad_x, size + 2 * pad_y
    by = y + tile / 2 - bh / 2
    baseline = y + tile / 2 + .727 * size / 2   # Inter cap height ≈ .727em, centred
    out.append(
        f'<g data-badge="lockup"><rect x="{bx:.2f}" y="{by:.2f}" width="{bw:.2f}" height="{bh:.2f}" rx="{BADGE_RADIUS}" fill="{SIGNAL}" />'
        f'<text x="{bx + pad_x:.2f}" y="{baseline:.2f}" fill="#ffffff" font-family="{BODY}" font-size="{size:.2f}px" '
        f'font-weight="800" letter-spacing="{.1 * size:.2f}px">QUÉBEC</text></g>'
    )
    return out


HEADER_TILE = 64   # the header lockup's tile; the mark's native 64 units, so scale 1


SOURCES = json.loads((OUT / 'investor-sources.json').read_text())
MODEL = json.loads((ROOT / 'docs/planning/business-plan-model.json').read_text())
FACTS = SOURCES['sources']
LANG = 'fr'

def tr(fr, en):
    return fr if LANG == 'fr' else en

def num(n):
    return f'{n:,.0f}'.replace(',', ' ') if LANG == 'fr' else f'{n:,.0f}'

# Financial values come from the reproducible model, formatted by the domain.
UNIT_REVENUE = round(MODEL['baseline']['nota'])
UNIT_CONTRIBUTION = round(MODEL['years'][0]['contribution']/MODEL['years'][0]['completed'])
UNIT_COST = UNIT_REVENUE-UNIT_CONTRIBUTION
YEAR_ONE_CASH = round(MODEL['months'][-1]['closing'])
ADDITIONAL_CAPITAL = round(max(0, MODEL['assumptions']['protectedCash'] - MODEL['months'][-1]['closing'] - MODEL['years'][1]['operatingResult']))
AMOUNTS = [MODEL['assumptions']['openingCapital'], UNIT_REVENUE, UNIT_COST, UNIT_CONTRIBUTION, 96000, 70000, 67000, 17000]
AMOUNTS += [YEAR_ONE_CASH, ADDITIONAL_CAPITAL]
AMOUNTS += [round(m['closing']) for m in MODEL['months']]
AMOUNTS += [round(y[k]) for y in MODEL['years'] for k in ('revenue','operatingResult')]

MONEY = json.loads(subprocess.check_output(['node','-e',
    "const d=require('@nota/domain');const n=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(Object.fromEntries(['fr','en'].map(l=>[l,Object.fromEntries(n.map(x=>[x,(l==='fr'?d.money:d.moneyEn)(x)]))]))));", json.dumps(AMOUNTS)],cwd=ROOT))

def money(n):
    return MONEY[LANG][str(n)]

def lines(x,y,content,size=24,color=MUTED,width=65,gap=None,heading=False):
    out=[]
    rows=[]
    for paragraph in content.split('\n'):
        rows += textwrap.wrap(paragraph,width=width,break_long_words=False,break_on_hyphens=False) or ['']
    for j,row in enumerate(rows):
        out.append((display if heading else t)(x,y+j*(gap or size*1.45),row,size,color))
    return ''.join(out)

def group(body, kind='reveal', delay=0):
    return f'<g data-motion="{kind}" style="--delay:{delay}ms">'+''.join(body)+'</g>'

def rule(x1,y1,x2,y2,delay=0):
    return group([f'<path d="M{x1} {y1} L{x2} {y2}" pathLength="1" fill="none" stroke="{BLUE}" stroke-width="3"/>'],'trace',delay)

def panel(x,y,w,h,kicker,title,detail='',delay=0):
    return group([rect(x,y,w,h,PANEL,LINE,8),eyebrow(x+28,y+42,kicker),
        lines(x+28,y+95,title,36,WHITE,int(w/21),43,True),
        lines(x+28,y+h-82,detail,24,MUTED,int(w/13))],delay=delay)

def source_footer(sources):
    if not sources:
        return t(72,871,tr('Vision et hypothèses de Nota · septembre 2026','Nota vision and assumptions · September 2026'),16,MUTED)
    short={'apciq':'APCIQ · 2025','crea':'CREA · 2025','cnq':'Chambre des notaires · 2024–2025, p. 11','cnue':'CNUE · 2024, p. 16','uinl':'UINL · 2026-09-12','signing':tr('Chambre des notaires · signature au bureau','Chambre des notaires · office signing'),'remote':tr('Chambre des notaires · signature à distance','Chambre des notaires · remote signing'),'csn':'CSN · 2026-07-09'}
    return ''.join(f'<a href="{esc(FACTS[key]["url"])}" target="_blank">'+t(72+i*(1456/len(sources)),871,short[key],16,MUTED)+'</a>' for i,key in enumerate(sources))

DECK=[]
def frame(number,kicker,title,subtitle,body,note,sources=()):
    alltext=' '.join(html.unescape(v) for v in re.findall(r'<text[^>]*>(.*?)</text>',''.join(body)))
    DECK.append({'title':title,'subtitle':subtitle,'note':note,'sources':list(sources),'transcript':alltext})
    footer=' · '.join(FACTS[s]['label'].replace(' · consulté le 12 septembre 2026','') for s in sources)
    if len(footer)>160: footer=' · '.join(FACTS[s]['label'].split(' · ')[0] for s in sources)+tr(' · détails et liens sous la diapositive',' · links and details below the slide')
    return '\n'.join([f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(title)}" data-frame="{number}">',
      rect(0,0,W,H,BG,radius=3),eyebrow(72,108,kicker),t(1528,108,f'{number:02d} / 16',18,MUTED,600,'end'),
      display(72,196,title,54,WHITE,letter=-2.16),lines(72,251,subtitle,24,MUTED,112,34),
      *body,line(72,784,1528,784),lines(72,818,note,18,MUTED,152,25),
      source_footer(sources),'</svg>'])

def slide_1():
    b=[lines(72,369,tr('L’urgence ouvre la porte.\nLe dossier crée la récurrence.', 'Urgency opens the door.\nThe workflow builds recurring use.'),42,WHITE,35,58,True),
       lines(72,542,tr('Une seule expérience, du besoin client\nà l’acte signé par le notaire.','One experience, from client need\nto the act signed by the notary.'),28,MUTED,47)]
    for i,(title,detail) in enumerate([(tr('Mettre en relation','Connect'),tr('Une date. Un notaire disponible.','A deadline. An available notary.')),(tr('Automatiser','Automate'),tr('La préparation répétitive.','Repeatable preparation.')),(tr('Faire signer','Enable signing'),tr('Un parcours électronique intégré.','An integrated electronic workflow.'))]):
        y=321+i*139
        b += [rule(894,y+37,894,y+170,200+i*400) if i<2 else '',group([rect(870,y+12,48,48,SIGNAL,radius=6),t(894,y+44,str(i+1),24,WHITE,700,'middle'),display(950,y+44,title,36),t(950,y+86,detail,24,MUTED)],'route',i*650)]
    return frame(1,tr('THÈSE D’INVESTISSEMENT','INVESTMENT THESIS'),tr('Le bon notaire. Au bon moment.','The right notary. At the right time.'),tr('Commencer par les échéances urgentes. Devenir le parcours de travail des études.','Start with urgent deadlines. Become the workflow behind notarial practices.'),b,tr('Trois étapes de développement. L’IA et la signature intégrée restent soumises aux validations de chaque phase.','Three development stages. AI and integrated signing depend on each stage’s validation.'))

def slide_2():
    b=[eyebrow(72,355,tr('LE CLIENT','THE CLIENT')),display(72,418,tr('Une date à respecter.','A deadline to meet.'),36),lines(72,477,tr('Des appels, des pièces à transmettre,\nun professionnel à trouver.','Calls to make, documents to send,\na professional to find.'),28,MUTED,40)]
    for i,label in enumerate([tr('Appeler','Call'),tr('Expliquer','Explain'),tr('Renvoyer','Resend')]):
        b += [group([rect(72+i*214,586,192,74,PANEL,LINE,6),t(168+i*214,632,label,26,WHITE,600,'middle')],'friction',i*450)]
    b += [line(786,332,786,713),eyebrow(863,355,tr('L’ÉTUDE','THE PRACTICE')),display(863,418,tr('Une capacité à dégager.','Capacity to unlock.'),36),lines(863,477,tr('Des disponibilités difficiles à découvrir.\nDes dossiers incomplets à reprendre.','Availability that is hard to discover.\nIncomplete files that need rework.'),28,MUTED,43)]
    for i in range(7):
        b += [group([rect(863+i*88,586,66,74,BLUE if i in (2,5) else PANEL,LINE,6)],'capacity',i*160)]
    b += [t(863,708,tr('Nota relie le besoin à la capacité utile.','Nota connects the need to usable capacity.'),24,BLUE,600)]
    return frame(2,tr('LE PROBLÈME','THE PROBLEM'),tr('L’échéance avance. Le dossier attend.','The deadline moves closer. The file waits.'),tr('La friction se trouve entre la demande du client et le travail de l’étude.','The friction sits between the client’s request and the practice’s workflow.'),b,tr('Scénario illustratif à valider en entrevue et en pilote. Aucune statistique de délai client n’est revendiquée.','Illustrative scenario to validate through interviews and a pilot. No measured customer delay is claimed.'))

def slide_3():
    b=[]
    steps=[(tr('DEMANDE','REQUEST'),tr('Date + dossier','Date + file'),tr('Besoin, pièces et prix clair.','Need, documents and clear pricing.')),(tr('CAPACITÉ','CAPACITY'),tr('Notaire admissible','Eligible notary'),tr('Accepte, précise ou contre-propose.','Accepts, clarifies or counteroffers.')),(tr('CONFIRMATION','CONFIRMATION'),tr('Prochaine étape','Next step'),tr('Un dossier suivi jusqu’à l’acte.','A file followed through to completion.'))]
    for i,(k,h,d) in enumerate(steps):
        x=72+i*497;b+=[panel(x,365,461,268,k,h,d,i*750)]
        if i<2:b+=[rule(x+461,499,x+497,499,i*750+500)]
    b+=[group([rect(72,677,1456,58,PANEL_2,radius=6),t(100,715,tr('À mesurer : délai de réponse · demandes retenues · actes terminés à temps','Measure: response time · retained requests · acts completed on time'),24,BLUE)],'match',2400)]
    return frame(3,tr('ÉTAPE 1 · MISE EN RELATION','STAGE 1 · MATCHING'),tr('Transformer l’urgence en rendez-vous.','Turn an urgent need into an appointment.'),tr('Financement et refinancement d’abord, dans la région de Québec.','Financing and refinancing first, in the Québec City region.'),b,tr('Le notaire confirme l’admissibilité et la faisabilité. Une date demandée n’est pas une garantie de signature.','The notary confirms eligibility and feasibility. A requested date is not a signing guarantee.'))

def slide_4():
    entries=[(tr('Québec · RMR','Québec City · CMA'),FACTS['apciq']['facts']['quebecCmaSales']),(tr('Québec · province','Québec · province'),FACTS['apciq']['facts']['quebecProvinceSales']),('Canada',FACTS['crea']['facts']['canadaMlsSales'])]
    b=[]
    for i,(label,value) in enumerate(entries):
        y=375+i*121
        b += [display(72,y,label,30),t(610,y,num(value),42,WHITE,700,'end'),line(690,y-15,1528,y-15),group([rect(690,y-33,838*value/470314,38,ORANGE if i==0 else SIGNAL,radius=3)],'market',i*650)]
    b += [t(72,737,tr('Même unité : ventes résidentielles enregistrées en 2025.','Same unit: recorded residential sales in 2025.'),26,BLUE,600)]
    return frame(4,tr('MARCHÉ · TRANSACTIONS OBSERVÉES','MARKET · OBSERVED TRANSACTIONS'),tr('Un départ local. Une base nationale.','A local entry point. A national base.'),tr('Le financement immobilier donne un premier bassin mesurable de besoins notariaux.','Real estate financing provides a measurable starting pool of notarial needs.'),b,tr('Centris au Québec; MLS au Canada. Périmètres imbriqués, non additionnables. Ce ne sont pas tous des dossiers urgents admissibles.','Centris in Québec; MLS across Canada. Nested areas must not be added. These are not all eligible urgent files.'),['apciq','crea'])

def slide_5():
    b=[]
    values=[('10 271',tr('ventes · RMR','sales · CMA')),('10 %',tr('qualifiables','qualifiable')),('25 %',tr('captées par Nota','captured by Nota')),('80 %',tr('complétées','completed'))]
    for i,(value,label) in enumerate(values):
        x=72+i*280
        b += [group([t(x,422,value.replace(' ', ',') if LANG=='en' and i==0 else value,62,WHITE,700),t(x,471,label,24,MUTED)],'qualify',i*500)]
        if i<3:b += [t(x+240,419,'×',32,BLUE)]
    b += [group([rect(1225,339,303,179,PANEL_2,LINE,8),t(1376,421,'205',76,ORANGE,700,'middle'),t(1376,468,tr('actes / an','acts / year'),26,WHITE,500,'middle')],'result',2200),line(72,566,1528,566),
      lines(72,620,tr('Sensibilité au taux qualifiable :\n5 % → 103 actes     10 % → 205     20 % → 411','Sensitivity to the qualifiable share:\n5% → 103 acts     10% → 205     20% → 411'),28,WHITE,90),
      t(72,729,tr('Les trois taux sont des hypothèses de travail à tester localement.','All three rates are planning assumptions to test locally.'),26,BLUE,600)]
    return frame(5,tr('MARCHÉ · PART ACCESSIBLE','MARKET · ACCESSIBLE SHARE'),tr('Le marché se gagne dossier par dossier.','The market is won one file at a time.'),tr('Un exemple transparent, fondé sur les ventes de la région de Québec.','A transparent example based on sales in the Québec City region.'),b,tr('Scénario annuel illustratif de financement lié aux ventes, distinct de la prévision A1 de 244 actes incluant le refinancement.','Illustrative annual sale-linked financing scenario, separate from the Y1 forecast of 244 acts including refinancing.'),['apciq'])

def slide_6():
    values=[(num(2659),tr('notaires au Québec','notaries in Québec'),tr('En étude ou cabinet juridique.\n31 mars 2025.','In traditional legal practices.\nMarch 31, 2025.')),(tr('≈ 50 000','≈ 50,000'),tr('notaires dans l’UE','notaries across the EU'),tr('22 notariats membres du CNUE.\nRapport 2024.','22 CNUE member notariats.\n2024 report.')),('93',tr('notariats membres','member notariats'),tr('Réseau mondial de l’UINL.\nConsulté en septembre 2026.','The UINL’s worldwide network.\nAccessed September 2026.'))]
    b=[]
    for i,(value,label,detail) in enumerate(values):
        x=72+i*497
        b += [group([line(x,350,x+455,350),t(x,454,value,70,ORANGE if i==1 else WHITE,700),display(x,521,label,30),lines(x,585,detail,24,MUTED,37)],'expand',i*650)]
    b += [t(72,736,tr('L’outil de préparation peut servir les dossiers récurrents, au-delà de l’urgence.','Preparation software can serve recurring files beyond urgent requests.'),26,BLUE,600)]
    return frame(6,tr('EXPANSION · LOGICIEL NOTARIAL','EXPANSION · NOTARIAL SOFTWARE'),tr('L’ambition dépasse la mise en relation.','The ambition goes beyond matching.'),tr('Un bassin professionnel international pour les étapes 2 et 3.','An international professional base for stages 2 and 3.'),b,tr('Individus, non études clientes. Périmètres distincts : aucun total mondial ni revenu accessible n’est déduit de ces chiffres.','Individuals, not customer firms. Different scopes: no global total or accessible revenue is inferred from these figures.'),['cnq','cnue','uinl'])

def slide_7():
    b=[t(72,417,'80 %',106,ORANGE,700),display(72,481,tr('de préparation répétitive','of repeatable preparation'),36),t(72,526,tr('Objectif de réduction du temps humain','Target reduction in human time'),26,MUTED),
       lines(72,608,tr('Collecter → extraire → vérifier → assembler.\nLe notaire conseille, tranche et approuve.','Collect → extract → check → assemble.\nThe notary advises, decides and approves.'),26,WHITE,54)]
    b += [t(948,348,tr('TEMPS NORMALISÉ · BASE 100','NORMALIZED TIME · BASE 100'),18,MUTED,700),t(948,402,tr('Préparation manuelle','Manual preparation'),26,WHITE),rect(948,425,540,42,PANEL_2),group([rect(948,425,540,42,SIGNAL)],'baseline',0),t(1488,402,'100',26,WHITE,700,'end'),
       t(948,537,tr('Avec Nota · cible','With Nota · target'),26,WHITE),rect(948,560,540,42,PANEL_2),group([rect(948,560,108,42,ORANGE)],'compress',650),t(1056,641,'20',38,ORANGE,700,'end'),lines(948,694,tr('Revue et corrections incluses\ndans la mesure du gain.','Review and corrections included\nin the measured saving.'),24,MUTED,41)]
    return frame(7,tr('ÉTAPE 2 · AUTOMATISATION','STAGE 2 · AUTOMATION'),tr('Rendre du temps aux études.','Give practices their time back.'),tr('Une ambition précise : automatiser le travail répétitif, avec la revue du notaire.','A precise ambition: automate repeatable work, with notary review.'),b,tr('80 % est une cible non démontrée sur le périmètre répétitif défini, pas une réduction mesurée de 80 % du métier complet.','80% is an unproven target for the defined repeatable scope, not a measured 80% reduction across the entire profession.'))

def slide_8():
    b=[]
    labels=[(tr('Dossier préparé','Prepared file'),tr('Sources et champs traçables.','Traceable sources and fields.')),(tr('Notaire réviseur','Notary reviewer'),tr('Accepte, corrige ou rejette.','Accepts, corrects or rejects.')),(tr('Version évaluée','Evaluated version'),tr('Cas réservés et retour arrière.','Held-out cases and rollback.'))]
    for i,(title,detail) in enumerate(labels):
        x=72+i*497;b += [panel(x,356,461,236,tr('CONTRÔLE','CONTROL')+f' {i+1}',title,detail,i*600)]
        if i<2:b += [rule(x+461,475,x+497,475,i*600+450)]
    b += [group([f'<path d="M1490 622 V686 H103 V622" pathLength="1" fill="none" stroke="{ORANGE}" stroke-width="3"/>'],'feedback',2000),t(800,732,tr('Une boucle d’amélioration documentée, approuvée et réversible.','A documented, approved and reversible improvement loop.'),26,BLUE,600,'middle')]
    return frame(8,tr('AVANTAGE À CONSTRUIRE','ADVANTAGE TO BUILD'),tr('Chaque correction rend l’outil plus utile.','Every correction can make the tool better.'),tr('Le savoir de l’étude devient une amélioration évaluée du produit.','Practice expertise becomes an evaluated product improvement.'),b,tr('Données autorisées seulement. Aucun entraînement automatique sur les dossiers identifiables; aucune décision juridique autonome.','Authorized data only. No automatic training on identifiable client files; no autonomous legal decisions.'))

def slide_9():
    b=[]
    for i,(title,detail) in enumerate([(tr('Identité','Identity'),tr('Personnes vérifiées','Verified people')),(tr('Consentement','Consent'),tr('Acte compris et validé','Understood, approved act')),(tr('Signature','Signature'),tr('Moyen autorisé','Authorized method')),(tr('Conservation','Preservation'),tr('Preuve et copie authentique','Evidence and authentic copy'))]):
        x=72+i*374
        b += [rule(x+22,398,x+396,398,i*650) if i<3 else '',group([rect(x,376,44,44,SIGNAL,radius=6),t(x+22,407,str(i+1),23,WHITE,700,'middle'),display(x,483,title,30),lines(x,540,detail,24,MUTED,25)],'sign-step',i*650)]
    b += [group([rect(72,652,1456,84,PANEL_2,radius=6),t(104,704,tr('La plus-value : conserver le fil du dossier jusqu’à sa conclusion.','The value: keep the file connected all the way to completion.'),28,BLUE,600)],'seal',2700)]
    return frame(9,tr('ÉTAPE 3 · SIGNATURE ÉLECTRONIQUE','STAGE 3 · ELECTRONIC SIGNING'),tr('Conclure dans un parcours continu.','Complete the act in one continuous workflow.'),tr('Intégrer les moyens de signature autorisés au dossier déjà préparé.','Connect authorized signing methods to the file already prepared.'),b,tr('La signature électronique notariale existe déjà. Nota doit valider ses intégrations; la signature à distance demeure encadrée.','Electronic notarial signing already exists. Nota must validate its integrations; remote signing remains regulated.'),['signing','remote'])

def slide_10():
    b=[]
    rows=[(tr('Annuaires et référence','Directories and referrals'),tr('Trouver un professionnel','Find a professional')),(tr('Logiciels d’étude et IA','Practice software and AI'),tr('Préparer et gérer le dossier','Prepare and manage the file')),(tr('Signature et conservation','Signing and preservation'),tr('Conclure et conserver la preuve','Complete and preserve evidence'))]
    for i,(a,btext) in enumerate(rows):
        y=365+i*109;b += [group([display(72,y,a,28),t(590,y,btext,25,MUTED),line(72,y+37,1048,y+37)],'compare',i*500)]
    b += [group([rect(1113,320,415,390,PANEL_2,LINE,8),eyebrow(1141,365,tr('POSITIONNEMENT NOTA','NOTA POSITIONING')),lines(1141,439,tr('Relier\nles trois.', 'Connect\nall three.'),44,WHITE,16,62,True),lines(1141,617,tr('Demande → préparation\n→ conclusion.','Demand → preparation\n→ completion.'),24,BLUE,25)],'integrate',1700)]
    return frame(10,tr('CONCURRENCE ET DIFFÉRENCIATION','COMPETITION AND DIFFERENTIATION'),tr('Gagner sur la continuité du dossier.','Win through continuity of the file.'),tr('Le signal de date attire la demande; le parcours intégré vise la rétention.','The date signal attracts demand; the integrated workflow aims to retain users.'),b,tr('Avantage visé, à prouver par l’usage. Le CSN a annoncé un partenariat IA en juillet 2026 : l’écosystème innove déjà.','Intended advantage, to be proven through usage. The CSN announced an AI partnership in July 2026: the ecosystem is already innovating.'),['csn','signing'])

def slide_11():
    b=[]
    for i,(value,label,detail) in enumerate([('30',tr('notaires recrutés','recruited notaries'),tr('Dans une première cohorte ciblée.','In a focused first cohort.')),('25',tr('notaires vérifiés','verified notaries'),tr('Avec capacité et processus validés.','With verified capacity and workflow.')),('244',tr('actes terminés en A1','completed acts in Y1'),tr('Financement et refinancement.','Financing and refinancing.'))]):
        x=72+i*497;b += [group([t(x,423,value,92,WHITE,700),display(x,484,label,30),lines(x,548,detail,24,MUTED,35)],'cohort',i*650)]
    b += [rule(72,645,1528,645,2200),t(72,705,tr('Courtiers hypothécaires · recherche locale · recommandations conformes','Mortgage brokers · local search · compliant referrals'),27,BLUE,600)]
    return frame(11,tr('ACQUISITION · CIBLES DU PILOTE','ACQUISITION · PILOT TARGETS'),tr('Concentrer l’offre avant d’accélérer.','Concentrate supply before accelerating.'),tr('Une région, deux services de départ et une cohorte que l’on peut servir.','One region, two initial services and a cohort we can actually serve.'),b,tr('Cibles de gestion, non traction acquise. Définir la capacité active; vérifier les conditions des références avant toute rémunération.','Management targets, not achieved traction. Define active capacity; verify referral terms before any compensation.'))

def slide_12():
    b=[panel(72,349,699,307,tr('DÉJÀ DANS LE PRODUIT','BUILT INTO THE PRODUCT'),tr('Un parcours démontrable','A demonstrable workflow'),tr('Demande datée · offre du notaire\nPréparation assistée · répétition de signature','Dated request · notary offer\nAssisted preparation · signing rehearsal'),0),panel(805,349,723,307,tr('À PROUVER EN PILOTE','TO PROVE IN THE PILOT'),tr('L’usage qui se répète','Repeated use'),tr('Dossiers réellement payés et terminés\nTemps gagné · qualité · rétention','Actually paid and completed files\nTime saved · quality · retention'),700),group([t(72,728,tr('Les démonstrations prouvent le parcours. Les cohortes prouveront le marché.','Demos demonstrate the workflow. Cohorts will demonstrate the market.'),26,BLUE,600)],'evidence',1500)]
    return frame(12,tr('ÉTAT D’AVANCEMENT','READINESS'),tr('Le produit rend le pilote concret.','The product makes the pilot concrete.'),tr('Une base construite pour tester la demande, la qualité et l’économie réelle.','A built foundation to test demand, quality and real economics.'),b,tr('Aucun revenu ni volume commercial vérifié n’est fourni ici. Données de démonstration et tests ne constituent pas de la traction.','No verified commercial revenue or volume is supplied here. Demo data and tests are not traction.'))

def slide_13():
    b=[]
    for i,(v,l,d) in enumerate([(UNIT_REVENUE,tr('revenu Nota','Nota revenue'),tr('Moyenne du scénario de mix','Average of the assumed mix')),(UNIT_COST,tr('coûts variables','variable costs'),tr('Paiement, soutien et pertes','Payments, support and losses')),(UNIT_CONTRIBUTION,tr('contribution','contribution'),tr('Avant coûts fixes et acquisition','Before fixed costs and acquisition'))]):
        x=72+i*497;b += [group([t(x,443,money(v),88,ORANGE if i==2 else WHITE,700),display(x,512,l,34),lines(x,570,d,25,MUTED,32)],'economics',i*700)]
        if i<2:b += [t(x+423,434,'−' if i==0 else '=',38,BLUE)]
    b += [t(72,723,tr('Puis : abonnement logiciel et signature intégrée, à tarifer et à valider.','Next: software subscriptions and integrated signing, to price and validate.'),26,BLUE,600)]
    return frame(13,tr('MODÈLE ÉCONOMIQUE · SCÉNARIO','BUSINESS MODEL · SCENARIO'),tr('Monétiser le service, puis l’usage.','Monetize the service, then recurring use.'),tr('Économie moyenne par acte terminé dans le modèle actuel du plan.','Average economics per completed act in the plan’s current model.'),b,tr('CAD arrondis. Mix et frais supposés; modèle commercial soumis à revue. Honoraires du notaire exclus du revenu Nota.','Rounded CAD. Assumed mix and costs; commercial model subject to review. Notary fees are excluded from Nota revenue.'))

def slide_14():
    years=MODEL['years'];b=[]
    for i,y in enumerate(years):
        x=72+i*497; revenue=round(y['revenue']); result=round(y['operatingResult'])
        b += [group([eyebrow(x,363,tr('ANNÉE ','YEAR ')+str(i+1)),t(x,441,num(y['completed']),72,WHITE,700),t(x,481,tr('actes terminés','completed acts'),24,MUTED),t(x,551,money(revenue),43,BLUE,700),t(x,592,tr('revenu Nota','Nota revenue'),23,MUTED),line(x,626,x+440,626),t(x,674,money(result),34,WHITE,700),t(x,713,tr('résultat d’exploitation','operating result'),23,MUTED)],'projection',i*800)]
    return frame(14,tr('TRAJECTOIRE · HYPOTHÈSES','TRAJECTORY · ASSUMPTIONS'),tr('Une rampe explicite, à financer.','An explicit ramp that needs funding.'),tr('La croissance dépend de la capacité, de l’adoption et des capitaux disponibles.','Growth depends on capacity, adoption and available capital.'),b,tr('Scénarios, non prévisions validées. A3 exige une expansion provinciale ambitieuse; aucun revenu IA ou signature n’est inclus.','Scenarios, not validated forecasts. Y3 needs ambitious provincial expansion; AI and signing revenue is not included.'))

def slide_15():
    labels=[tr('Équipe fondatrice','Founding team'),tr('Produit, expertise, conformité','Product, expertise, compliance'),tr('Acquisition + infrastructure','Acquisition + infrastructure'),tr('Imprévus','Contingency')]; amounts=[96000,70000,67000,17000]
    b=[t(72,427,money(250000),96,WHITE,700),display(72,490,tr('pour lancer le pilote','to launch the pilot'),36),lines(72,563,tr('Obtenir les validations.\nServir une cohorte réelle.\nMesurer les gains de préparation.','Obtain approvals.\nServe a real cohort.\nMeasure preparation savings.'),28,MUTED,45)]
    for i,(label,amount) in enumerate(zip(labels,amounts)):
        y=350+i*93;b += [t(884,y,label,24,WHITE),t(1528,y,money(amount),25,WHITE,700,'end'),group([rect(884,y+17,644*amount/96000,14,ORANGE if i==0 else SIGNAL,radius=3)],'budget',i*600)]
    return frame(15,tr('FINANCEMENT RECHERCHÉ','FUNDING ASK'),tr('Financer la preuve qui ouvre la suite.','Fund the proof that unlocks what comes next.'),tr('Une enveloppe d’exploitation de 12 mois, répartie selon le plan.','A 12-month operating envelope allocated according to the plan.'),b,tr(f'Scénario de base : {money(YEAR_ONE_CASH)} à la fin d’A1; au moins {money(ADDITIONAL_CAPITAL)} additionnels à prévoir avant les obligations non modélisées.',f'Base scenario: {money(YEAR_ONE_CASH)} at Y1 end; at least {money(ADDITIONAL_CAPITAL)} in additional capital before unmodeled obligations.'))

def slide_16():
    b=[]
    rows=[(tr('Mise en relation','Matching'),tr('Une demande réellement servie','A request actually fulfilled')),(tr('Automatisation','Automation'),tr('Du temps gagné, qualité maintenue','Time saved, quality maintained')),(tr('Signature électronique','Electronic signing'),tr('Un dossier conclu et traçable','A completed, traceable file'))]
    for i,(a,d) in enumerate(rows):
        y=356+i*108;b += [group([rect(72,y-22,28,28,SIGNAL,radius=3),display(124,y,a,32),t(733,y,d,29,WHITE),line(124,y+40,1528,y+40)],'milestone',i*650)]
    b += [group([t(72,731,tr('Construisons le parcours notarial de demain.','Build the next notarial workflow with us.'),36,ORANGE,700),t(1528,728,'info@gonota.ca',28,WHITE,600,'end')],'invitation',2300)]
    return frame(16,tr('PARTENAIRES ET INVESTISSEURS','PARTNERS AND INVESTORS'),tr('Une entrée urgente. Une ambition durable.','An urgent entry point. A lasting ambition.'),tr('Nota veut augmenter la capacité de la profession, avec les notaires.','Nota aims to expand the profession’s capacity, together with notaries.'),b,tr('Prochaine étape : démonstration, revue du plan et discussion des conditions du pilote et du financement.','Next step: a demonstration, plan review and discussion of pilot and funding terms.'))

SLIDES=[slide_1,slide_2,slide_3,slide_4,slide_5,slide_6,slide_7,slide_8,slide_9,slide_10,slide_11,slide_12,slide_13,slide_14,slide_15,slide_16]

def render_all(target):
    global LANG,DECK
    payload={'reviewed':SOURCES['reviewed'],'sources':FACTS,'editions':{}}
    for lang in ('fr','en'):
        LANG=lang;DECK=[];frames=[fn() for fn in SLIDES]
        prefix='dark-slide-fr-' if lang=='fr' else 'dark-slide-'
        for n,svg in enumerate(frames,1):
            (target/f'{prefix}{n}.svg').write_text(svg)
            DECK[n-1]['svg']=svg
        payload['editions'][lang]=DECK
    page=ROOT/'docs/pitch-deck.html'; source=page.read_text()
    data=json.dumps(payload,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
    block='<script type="application/json" id="deck-data">'+data+'</script>'
    if 'id="deck-data"' in source:
        source=re.sub(r'<script type="application/json" id="deck-data">.*?</script>',lambda _:block,source,flags=re.S)
    else: source=source.replace('</head>',block+'\n</head>')
    page.write_text(source)
    print(f'Wrote 32 native SVG frames and bilingual viewer data: {target}')

if __name__=='__main__':
    target=Path(sys.argv[2]).resolve() if len(sys.argv)>2 and sys.argv[1]=='--svg-out' else OUT/'rendered'
    target.mkdir(parents=True,exist_ok=True);render_all(target)
