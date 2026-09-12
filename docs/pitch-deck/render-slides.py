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
TOTAL_SLIDES = 9

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
PARTNER_COST = round(MODEL['partnerEconomics']['perCompletedAct'])
PARTNER_MARGIN = UNIT_REVENUE - UNIT_COST - PARTNER_COST
AMOUNTS += [YEAR_ONE_CASH, ADDITIONAL_CAPITAL, PARTNER_COST, PARTNER_MARGIN, MODEL['partnerEconomics']['clientReward'], MODEL['partnerEconomics']['notaryReward']]
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
        lines(x+28,y+h-(40 if h<230 else 82),detail,24,MUTED,int(w/13))],delay=delay)

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
      rect(0,0,W,H,BG,radius=3),eyebrow(72,108,kicker),t(1528,108,f'{number:02d} / {TOTAL_SLIDES:02d}',18,MUTED,600,'end'),
      display(72,196,title,54,WHITE,letter=-2.16),lines(72,251,subtitle,24,MUTED,112,34),
      *body,line(72,784,1528,784),lines(72,818,note,18,MUTED,152,25),
      source_footer(sources),'</svg>'])

def slide_1():
    b=[lines(72,378,tr('Un besoin urgent.\\nUne offre difficile à trouver.','An urgent need.\\nCapacity that is hard to find.').replace('\\n','\n'),42,WHITE,34,60,True),
       lines(72,576,tr('Nota relie la date du client\\nà la capacité du notaire.','Nota connects the client’s date\\nto the notary’s capacity.').replace('\\n','\n'),28,MUTED,43)]
    b += [group([rect(895,326,280,181,PANEL,LINE,8),eyebrow(923,370,tr('BESOIN CLIENT','CLIENT NEED')),t(923,455,tr('À temps.','On time.'),44,WHITE,700)],'route',100)]
    b += [group([rect(1243,510,285,185,PANEL_2,LINE,8),eyebrow(1271,554,tr('CAPACITÉ','CAPACITY')),t(1271,639,tr('Trouvée.','Matched.'),40,WHITE,700)],'capacity',600)]
    b += [rule(1175,414,1210,414,450),rule(1210,414,1210,602,850),rule(1210,602,1243,602,1250)]
    b += [group([rect(72,696,687,48,PANEL_2,radius=6),t(96,728,tr('01 Relier     02 Automatiser     03 Faire signer','01 Connect     02 Automate     03 Enable signing'),24,BLUE,600)],'match',1800)]
    return frame(1,tr('PHASE 1 · MISE EN RELATION','PHASE 1 · MATCHING'),tr('Le bon notaire. À temps.','The right notary. On time.'),tr('Transformer une urgence en relation durable.','Turn urgency into a lasting relationship.'),b,tr('Point de départ : financement et refinancement à Québec. L’insuffisance de capacité disponible doit être mesurée en pilote.','Starting point: financing and refinancing in Québec City. Available-capacity gaps must be measured in the pilot.'))

def slide_2():
    b=[]
    obs=MODEL['market']['observed']
    for i,(value,label,unit) in enumerate([(num(obs['quebecCmaSales']),tr('Québec · RMR','Québec City · CMA'),tr('ventes · 2025','sales · 2025')),(num(obs['quebecProvinceSales']),tr('Québec · province','Québec · province'),tr('ventes · 2025','sales · 2025')),(num(obs['canadaMlsSales']),'Canada',tr('ventes · 2025','sales · 2025')),(tr('≈ 50 000','≈ 50,000'),tr('Union européenne','European Union'),tr('notaires · CNUE 2024','notaries · CNUE 2024'))]):
        x=72+i*374;b += [group([t(x,397,value,59,WHITE,700),display(x,453,label,26),t(x,496,unit,22,MUTED)],'expand',i*350)]
    b += [group([rect(72,567,1456,171,PANEL_2,radius=8),t(100,654,'205',78,ORANGE,700),t(100,706,tr('actes / an visés','target acts / year'),25,WHITE),t(432,626,tr('25 % du bassin qualifiable','25% of the qualifiable pool'),33,WHITE,700),t(432,678,tr('10 271 × 10 % qualifiables × 25 % captés × 80 % terminés','10,271 × 10% qualifiable × 25% captured × 80% completed'),25,BLUE)],'qualify',1650)]
    return frame(2,tr('MARCHÉ ET PREMIÈRE PART','MARKET AND FIRST SHARE'),tr('Un ancrage local. Un métier mondial.','A local foothold. A global profession.'),tr('Une porte d’entrée mesurable pour un outil récurrent.','A measurable entry point for a recurring-use product.'),b,tr('Hypothèses locales : ≈ 2 % des ventes observées après complétion. Territoires non additionnables; bassin européen ≠ abonnements vendus.','Local assumptions: ≈ 2% of observed sales after completion. Nested territories are not additive; European notaries ≠ paid seats.'),['apciq','crea','cnue'])

def slide_3():
    b=[]
    for i,(title,detail) in enumerate([(tr('Courtiers et partenaires','Brokers and partners'),tr('Des clients au moment du besoin.','Clients at the moment of need.')),(tr('Réseau de notaires','Notary network'),tr('Une capacité réellement disponible.','Capacity that is actually available.'))]):
        y=334+i*228;b += [panel(72,y,603,173,f'0{i+1}',title,detail,i*550)]
    b += [group([f'<path d="M675 420 H822 L943 535 H1021 M675 648 H822 L943 535" pathLength="1" fill="none" stroke="{BLUE}" stroke-width="4"/>'],'trace',1100)]
    b += [group([rect(1021,425,507,225,PANEL_2,LINE,8),display(1051,482,tr('Un dossier attribué','An attributed file'),31),lines(1051,555,tr('Lien → suivi → acte\\n→ récompense','Link → tracking → act\\n→ reward').replace('\\n','\n'),29,WHITE,28,43)],'match',2000)]
    return frame(3,tr('ACQUISITION · PARTENARIATS','ACQUISITION · PARTNERSHIPS'),tr('Les partenaires ouvrent le marché.','Partners open the market.'),tr('Une distribution intégrée au travail des professionnels.','Distribution built into professionals’ everyday work.'),b,tr(f'Programme actuel : {money(MODEL["partnerEconomics"]["clientReward"])} par demande référée retenue; {money(MODEL["partnerEconomics"]["notaryReward"])} à la première rétention du notaire référé. Conditions à valider.',f'Current program: {money(MODEL["partnerEconomics"]["clientReward"])} per retained referred request; {money(MODEL["partnerEconomics"]["notaryReward"])} on a referred notary’s first retention. Terms require validation.'))

def slide_4():
    b=[t(72,423,'80 %',105,ORANGE,700),display(72,486,tr('de préparation en moins','less preparation time'),35),t(72,540,tr('Cible de temps humain','Human-time target'),25,MUTED),
       group([rect(72,600,570,28,LINE,radius=3)],'baseline',0),
       group([rect(72,646,114,28,SIGNAL,radius=3)],'compress',550),
       t(72,721,tr('La revue du notaire reste incluse.','Notary review remains included.'),26,BLUE,600)]
    b += [panel(853,328,675,185,tr('CONTRIBUER','CONTRIBUTE'),tr('Accès gratuit','Free access'),tr('Aider à améliorer le modèle.','Help improve the model.'),650),
          panel(853,551,675,185,tr('S’ABONNER','SUBSCRIBE'),tr('Usage sans contribution','Use without contributing'),tr('Payer, sans participer à l’amélioration.','Pay without participating in improvement.'),1200)]
    return frame(4,tr('PHASE 2 · CAPACITÉ PAR L’IA','PHASE 2 · CAPACITY THROUGH AI'),tr('Un outil qui grandit avec les notaires.','A tool that improves with notaries.'),tr('Automatiser la préparation répétitive; libérer l’expertise.','Automate repeatable preparation; free up expertise.'),b,tr('Objectif non démontré, périmètre et corrections inclus à mesurer. Offres proposées; conseil, jugement et approbation restent au notaire.','Unproven target; defined scope and correction time must be measured. Proposed offers; advice, judgment and approval remain with the notary.'))

def slide_5():
    b=[]
    for i,(title,detail) in enumerate([(tr('Identité','Identity'),tr('Vérifiée','Verified')),(tr('Consentement','Consent'),tr('Éclairé','Informed')),(tr('Signature','Signing'),tr('Intègre','Integrity')),(tr('Conservation','Preservation'),tr('Preuve durable','Durable evidence'))]):
        x=72+i*374
        if i<3:b += [rule(x+22,370,x+396,370,i*500)]
        b += [group([rect(x,348,44,44,SIGNAL,radius=6),t(x+22,379,str(i+1),23,WHITE,700,'middle'),display(x,471,title,30),t(x,522,detail,25,MUTED)],'sign-step',i*500)]
    b += [group([rect(72,613,1456,123,PANEL_2,LINE,8),display(104,662,tr('Protocole Nota → Chambre des notaires','Nota protocol → Chambre des notaires'),34),t(104,706,tr('Concevoir. Présenter. Faire valider.','Design. Present. Obtain validation.'),25,BLUE,600)],'seal',2200)]
    return frame(5,tr('PHASE 3 · SIGNATURE EN LIGNE','PHASE 3 · ONLINE SIGNING'),tr('Une chaîne de preuve propre à Nota.','A chain of evidence designed for Nota.'),tr('Du dossier préparé à sa conclusion, dans un même parcours.','From prepared file to completion in one workflow.'),b,tr('Protocole envisagé, aucune acceptation acquise. La signature électronique existe déjà; la signature à distance reste encadrée.','Proposed protocol, with no acceptance secured. Electronic signing already exists; remote signing remains regulated.'),['signing','remote'])

def slide_6():
    b=[]
    for i,(value,label,detail) in enumerate([(UNIT_REVENUE,tr('Frais Nota','Nota fees'),tr('Moyenne du mix','Average mix')),(UNIT_COST,tr('Coûts variables','Variable costs'),tr('Paiement · soutien · pertes','Payments · support · losses')),(PARTNER_COST,tr('Partenariats','Partnerships'),tr('Allocation maximale A1','Maximum Y1 allocation')),(PARTNER_MARGIN,tr('Contribution','Contribution'),tr('Après récompenses','After rewards'))]):
        x=72+i*374;b += [group([t(x,436,money(value),65,ORANGE if i==3 else WHITE,700),display(x,502,label,28),lines(x,556,detail,23,MUTED,27)],'economics',i*650)]
        if i<3:b += [t(x+330,425,'=' if i==2 else '−',32,BLUE)]
    b += [group([rect(72,658,1456,78,PANEL_2,radius=6),t(104,708,tr('Une marge positive par acte pour soutenir la distribution.','Positive contribution per act to support distribution.'),30,BLUE,600)],'result',2400)]
    return frame(6,tr('ÉCONOMIE · SCÉNARIO','ECONOMICS · SCENARIO'),tr('La marge finance la distribution.','Contribution funds distribution.'),tr('Frais Nota payés par le client; honoraires du notaire préservés.','Client-paid Nota fees; notary fees are preserved.'),b,tr('CAD arrondis, scénario A1. Récompenses déjà dans le budget d’acquisition. Contribution par acte ≠ bénéfice net de l’entreprise.','Rounded CAD, Y1 scenario. Rewards are already in acquisition budgets. Contribution per act ≠ company net profit.'))

def slide_7():
    b=[]
    for i,y in enumerate(MODEL['years']):
        x=72+i*497
        b += [group([eyebrow(x,357,tr('ANNÉE ','YEAR ')+str(i+1)),t(x,437,num(y['completed']),79,WHITE,700),t(x,481,tr('actes terminés','completed acts'),24,MUTED),line(x,530,x+442,530),t(x,607,money(round(y['operatingResult'])),43,ORANGE if i==2 else WHITE,700),t(x,657,tr('résultat d’exploitation','operating result'),24,MUTED)],'projection',i*800)]
    b += [t(72,737,tr('Capacité vérifiée → acquisition mesurée → expansion financée.','Verified capacity → measured acquisition → funded expansion.'),27,BLUE,600)]
    return frame(7,tr('PASSAGE À L’ÉCHELLE','SCALING'),tr('Grandir avec la capacité.','Grow with capacity.'),tr('Concentrer Québec, puis élargir selon les preuves.','Concentrate on Québec City, then expand as evidence supports it.'),b,tr('Scénarios, pas traction. A3 exige une forte expansion provinciale. Aucun revenu IA ou signature inclus; financement additionnel nécessaire.','Scenarios, not traction. Y3 requires substantial provincial expansion. No AI or signing revenue included; additional funding is needed.'))

def slide_8():
    b=[]
    for i,(title,detail) in enumerate([(tr('Client','Client'),tr('Un besoin pris en charge.\\nUne prochaine étape claire.','A need addressed.\\nA clear next step.')),(tr('Notaire','Notary'),tr('Du travail qualifié.\\nDu temps pour son expertise.','Qualified work.\\nTime for professional expertise.')),(tr('Partenaire','Partner'),tr('Une référence suivie.\\nUne récompense attribuée.','A tracked referral.\\nAn attributed reward.'))]):
        x=72+i*497;b += [panel(x,335,461,242,f'0{i+1}',title,detail.replace('\\n','\n'),i*500)]
    b += [group([f'<path d="M301 611 V649 H1299 V611 M799 649 V691" pathLength="1" fill="none" stroke="{BLUE}" stroke-width="3"/>'],'feedback',1800),
          group([t(800,731,tr('Demande + retours professionnels → capacité accrue → usage récurrent','Demand + professional feedback → more capacity → recurring use'),28,BLUE,600,'middle')],'integrate',2400)]
    return frame(8,tr('DIFFÉRENCIATION · TROIS GAGNANTS','DIFFERENTIATION · THREE WINNERS'),tr('La valeur se renforce avec l’usage.','Value grows through use.'),tr('Relier la distribution, l’apprentissage et la conclusion du dossier.','Connect distribution, learning and file completion.'),b,tr('Avantage visé, à mesurer en cohorte. Retours volontaires et autorisés. Nota se finance par ses frais et, à terme, l’abonnement logiciel.','Intended advantage, to measure in cohorts. Voluntary, authorized feedback. Nota earns its own fees and, later, software subscriptions.'),['csn'])

def slide_9():
    b=[t(72,435,money(MODEL['assumptions']['openingCapital']),100,WHITE,700),display(72,500,tr('pour lancer le pilote','to launch the pilot'),36),
       lines(72,588,tr('12 mois pour transformer\\nle produit en preuves.','12 months to turn\\nthe product into evidence.').replace('\\n','\n'),29,MUTED,38)]
    for i,(label,detail) in enumerate([(tr('Livrer','Deliver'),tr('Une cohorte et des actes réels.','A cohort and actual completed acts.')),(tr('Mesurer','Measure'),tr('Le gain de préparation et la marge.','Preparation savings and contribution.')),(tr('Faire valider','Validate'),tr('Le protocole et ses conditions.','The protocol and its requirements.'))]):
        y=338+i*136;b += [group([rect(909,y,619,113,PANEL,LINE,6),display(937,y+44,label,30),t(937,y+86,detail,24,MUTED)],'milestone',i*700)]
    return frame(9,tr('INVESTISSEMENT','INVESTMENT'),tr('Financer la preuve. Ouvrir la suite.','Fund the proof. Open the next stage.'),tr('Un premier marché, un moteur de capacité, une ambition internationale.','An initial market, a capacity engine, an international ambition.'),b,tr(f'Base : {money(YEAR_ONE_CASH)} fin A1; au moins {money(ADDITIONAL_CAPITAL)} additionnels avant obligations non modélisées. info@gonota.ca',f'Base: {money(YEAR_ONE_CASH)} at Y1 end; at least {money(ADDITIONAL_CAPITAL)} more before unmodeled obligations. info@gonota.ca'))

SLIDES=[slide_1,slide_2,slide_3,slide_4,slide_5,slide_6,slide_7,slide_8,slide_9]


def normalize_chrome(source):
    """Keep the shared foundation last so document regeneration stays stable."""
    for pattern, closing in [
        (r'<style data-nota-foundations>.*?</style>', '</head>'),
        (r'<script data-nota-navigation>.*?</script>', '</body>'),
    ]:
        match = re.search(pattern, source, re.S)
        if match:
            source = source[:match.start()] + source[match.end():].lstrip()
            source = source.replace(closing, match.group(0) + chr(10) + closing)
    return source

def render_all(target):
    for old in target.glob("dark-slide-*.svg"):
        match = re.fullmatch(r"dark-slide-(?:fr-)?([0-9]+)[.]svg", old.name)
        if match and int(match.group(1)) > TOTAL_SLIDES:
            old.unlink()
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
    source=re.sub(r'<script data-nota-presentation-controls>.*?</script>|<style data-nota-presentation-controls>.*?</style>','',source,flags=re.S)
    shared='<script data-nota-presentation-controls>'+(ROOT/'docs/presentation-controls.js').read_text()+'</script><style data-nota-presentation-controls>'+(ROOT/'docs/presentation-controls.css').read_text()+'</style>'
    source=source.replace('</head>',shared+'</head>')
    page.write_text(normalize_chrome(source))
    print(f'Wrote 18 native SVG frames and bilingual viewer data: {target}')

if __name__=='__main__':
    target=Path(sys.argv[2]).resolve() if len(sys.argv)>2 and sys.argv[1]=='--svg-out' else OUT/'rendered'
    target.mkdir(parents=True,exist_ok=True);render_all(target)
