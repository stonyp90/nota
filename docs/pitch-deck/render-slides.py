#!/usr/bin/env python3
"""Build concise, dark Nota deck images for the interactive web presentation.

The detailed business plan remains the evidence source. These slides expose only
the decision-sized facts and label planning targets or hypotheses explicitly.

Brand contract (docs/decisions/0048-nota-brand-lockup.md, design 02 · layout 16):

- the lockup is NOT redrawn here: the tile is read from docs/pitch-deck/nota-mark.svg
  and the O T A word from the `<svg class="brand-word">` of docs/pitch-deck.html —
  the very drawings the deck page shows above the stage — and placed with the five
  lockup ratios (word cap height .60 × tile, centred; tile→word gap .12; word→badge
  gap .16; QUÉBEC badge font .16 × tile, never under 9 px, Inter 800, .1em tracking,
  padding .55em .7em, radius 4, on --nota-blue-500 with white text);
- colours are the ADR 0048 ramp on the dark canvas of apps/web/public/styles.css
  (`:root:not([data-theme='light'])`): the stage is a dark room by design; orange
  is the ONE warm accent and never the brand word;
- type is ADR 0050: Sora 800 for every title, Inter for everything else, on the
  product's --type-* scale mapped to the 1600 × 900 frame (see TYPE below);
- the square-corner register (ADR 0048 amendment; --radius 8 / 6 / 3 / 12): no
  circle anywhere — nodes are squares, panel radii snap to the token scale.

The fonts must be installed locally (fontconfig) for the ImageMagick path:
ImageMagick substitutes a generic sans silently when a family is missing, so the
build refuses to run rather than bake a fallback face into 32 PNGs. Without the
faces installed, write the SVG frames and rasterize them in Chromium instead:

    python3 docs/pitch-deck/render-slides.py --svg-out /tmp/slides
    node docs/pitch-deck/rasterize-slides.mjs /tmp/slides

Run (fonts installed):  python3 docs/pitch-deck/render-slides.py
"""
from __future__ import annotations

import html
import re
import shutil
import subprocess
import sys
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

# ADR 0050: Sora 800 carries every title, Inter carries everything else.
DISPLAY = "Sora"
BODY = "Inter"
WEIGHT_DISPLAY = 800

# Type scale — apps/web/public/styles.css --type-* mapped to the frame. A 1600 px
# slide read across a room is a product page of ~1067 px held at arm's length, so
# every rung is the product token × 1.5 (h1 = its 44 px ceiling → 66; h2 26 → 39;
# h3 17 → 26; h4 15 → 22; lead 17 → 26; body 16 → 24; eyebrow 12 → 18). Line
# heights and tracking are the product's own (h1 1.02 / −.055em, h2 1.15 / −.045em,
# h3 1.3 / −.02em, eyebrow .1em). Large figures (48–78 px) are data display, not a
# text rung, and stay on Inter 700.
SCALE = W / 1066.67
TYPE = {
    "h1": round(44 * SCALE), "h2": round(26 * SCALE), "h3": round(17 * SCALE), "h4": round(15 * SCALE),
    "lead": round(17 * SCALE), "body": round(16 * SCALE), "eyebrow": round(12 * SCALE),
}
TRACK = {"h1": -.055, "h2": -.045, "h3": -.02, "h4": -.01, "eyebrow": .1}
H1_STEP = round(TYPE["h1"] * 1.02)

# Square-corner register: one radius scale (styles.css --radius-xs/sm/base/lg).
RADII = (3, 6, 8, 12)

# The five lockup ratios (ADR 0048, design 02 · layout 16), the badge's minimum size
# and its estimated width in em (Inter 800 caps + .1em tracking; rasterize-slides.mjs
# re-measures the text in Chromium and fits the ground to it).
LOCKUP = {"word": .60, "gap": .12, "badge_gap": .16, "badge_size": .16}
BADGE_MIN_PX = 9
BADGE_EM = 4.73
BADGE_PAD = (.55, .7)
BADGE_RADIUS = 4
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


def base(num: int, title: str, subtitle: str, kicker: str, body: list[str]) -> list[str]:
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        f'<defs><radialGradient id="halo" cx="0" cy="0" r="1"><stop offset="0" stop-color="{HALO}" stop-opacity=".55"/><stop offset="1" stop-color="{BG}" stop-opacity="0"/></radialGradient></defs>',
        f'<rect width="{W}" height="{H}" fill="{BG}" />',
        '<ellipse cx="190" cy="80" rx="510" ry="360" fill="url(#halo)" opacity=".7" />',
        *lockup(72, 54, HEADER_TILE),
        t(1528, 91, f"{num:02d} / 16", TYPE["h4"], MUTED, 600, "end", 1),
        eyebrow(80, 170, kicker),
    ]
    title_lines = title.split("\n")
    for index, title_line in enumerate(title_lines):
        out.append(display(80, 236 + index * H1_STEP, title_line, TYPE["h1"], WHITE, "start", TRACK["h1"] * TYPE["h1"]))
    subtitle_y = 236 + (len(title_lines) - 1) * H1_STEP + TYPE["h1"]
    out.append(t(80, subtitle_y, subtitle, TYPE["lead"], MUTED, 450))
    out.extend(body)
    out.extend([line(80, 838, 1520, 838, LINE, 2), t(80, 870, "info@gonota.ca", TYPE["h4"], MUTED, 500), t(1520, 870, "Nota · capacity, clarity, trust", TYPE["h4"], MUTED, 500, "end")])
    out.append("</svg>")
    return out


def slide_1(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Valoriser la date.\nLibérer la capacité." if fr else "Price the date.\nFree the capacity."
    subtitle = "Un réseau qui aligne demande, offre et confiance." if fr else "A network that aligns demand, supply and trust."
    body = [
        # The hero is the decided mark itself (the tile from nota-mark.svg), framed by
        # two square outlines on the register — the old « N in a circle » is retired.
        square(1180, 475, 210, "none", SIGNAL, 2, .45), square(1180, 475, 160, "none", BLUE, 2, .7),
        mark(1180 - 108, 475 - 108, 216),
        eyebrow(1180, 735, "CAPACITY INFRASTRUCTURE", BLUE, "middle"),
        t(1180, 770, "Not a replacement for notaries." if not fr else "Pas un remplacement des notaires.", 24, WHITE, 600, "middle"),
    ]
    return base(1, title, subtitle, "Nota / Québec", body)


def slide_2(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Un marché sans\nprix repère" if fr else "A market without\na price signal"
    subtitle = "La date varie. Le marché ne la valorise pas encore." if fr else "The date varies. The market still does not price it."
    body = [
        line(130, 505, 1450, 505, BLUE, 4),
        square(240, 505, 16, BLUE, "none", 0), square(800, 505, 16, ORANGE, "none", 0), square(1370, 505, 16, BLUE, "none", 0),
        t(240, 575, "1991", 48, WHITE, 700, "middle"),
        t(240, 612, "tarifs obligatoires abolis" if fr else "mandatory tariffs abolished", 21, MUTED, 500, "middle"),
        t(800, 575, "DATE", 42, BLUE, 700, "middle"),
        t(800, 612, "le vrai signal de valeur" if fr else "the value signal that moves", 21, MUTED, 500, "middle"),
        t(1370, 575, "PHONE", 42, BLUE, 700, "middle"),
        t(1370, 612, "la découverte actuelle" if fr else "today's discovery layer", 21, MUTED, 500, "middle"),
        rect(435, 690, 730, 68, PANEL_2, "none", 14),
        t(800, 734, "Demand and available time rarely meet." if not fr else "La demande et le temps disponible se rencontrent rarement.", 24, WHITE, 600, "middle"),
    ]
    return base(2, title, subtitle, "Problem", body)


def slide_3(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Deux côtés.\nUne capacité invisible." if fr else "Two sides.\nCapacity stays invisible."
    subtitle = "La demande est urgente. Les créneaux restent dispersés." if fr else "Demand is urgent. Available time stays fragmented."
    body = [
        rect(110, 425, 525, 245, PANEL, BLUE, 22), rect(965, 425, 525, 245, PANEL, SIGNAL, 22),
        t(150, 480, "CLIENT" if not fr else "CLIENT", 18, BLUE, 700, letter=3),
        t(150, 535, "Une date à respecter" if fr else "A deadline to meet", 34, WHITE, 700),
        t(150, 590, "Clarté · prix · prochaine étape" if fr else "Clarity · price · next step", 21, MUTED, 500),
        t(1005, 480, "NOTAIRE" if fr else "NOTARY", 18, BLUE, 700, letter=3),
        t(1005, 535, "Du temps à rendre utile" if fr else "Time to put to work", 34, WHITE, 700),
        t(1005, 590, "Capacité · jugement · honoraires" if fr else "Capacity · judgment · honoraires", 21, MUTED, 500),
        line(640, 548, 955, 548, BLUE, 4, "10 14"), square(800, 548, 22, BG, ORANGE, 4),
        t(800, 557, "→", 27, ORANGE, 700, "middle"),
        t(800, 735, "Nota rend la capacité trouvable." if fr else "Nota makes capacity findable.", 27, ORANGE, 650, "middle"),
    ]
    return base(3, title, subtitle, "Opportunity", body)


def slide_4(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "La date devient\nun signal de marché" if fr else "The date becomes\na market signal"
    subtitle = "Les paliers suivent les règles du domaine, puis le notaire valide." if fr else "Domain tiers set the signal. The notary still validates."
    labels = [("15+", "standard", BLUE), ("8–14", "rapide", BLUE), ("2–7", "prioritaire", ORANGE), ("1", "urgence", ORANGE), ("0", "extrême", ORANGE)]
    body: list[str] = [t(110, 420, "JOURS AVANT LA SIGNATURE" if fr else "DAYS TO SIGNING", 17, MUTED, 700, letter=2)]
    widths = [850, 680, 510, 340, 190]
    for i, ((days, name, color), width) in enumerate(zip(labels, widths)):
        y = 470 + i * 58
        body.extend([rect(110, y - 29, 126, 42, color, "none", 8), t(173, y, days, 23, BG, 700, "middle"), t(275, y, name, 22, WHITE, 600), rect(470, y - 16, 850, 19, PANEL_2, "none", 9), rect(470, y - 16, width, 19, color, "none", 9), t(1490, y, "PRICE SIGNAL" if not fr else "SIGNAL DE PRIX", 16, color, 700, "end", 1)])
    body.append(t(800, 790, "A signal, never a promise of safe completion." if not fr else "Un signal, jamais une promesse de réalisation sûre.", 22, MUTED, 500, "middle"))
    return base(4, title, subtitle, "Mechanism", body)


def slide_5(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Mesurer avant\nd’élargir" if fr else "Measure before\nwe expand"
    subtitle = "Le produit est une boucle de preuve, pas une promesse de traction." if fr else "The product is a proof loop, not a traction claim."
    cards = [("4", "services au catalogue" if fr else "services in code", BLUE), ("0", "dépendance runtime" if fr else "runtime dependencies", ORANGE), ("1", "flux de preuve" if fr else "evidence loop", SIGNAL)]
    body: list[str] = []
    for i, (num, label, color) in enumerate(cards):
        x = 110 + i * 490
        body.extend([rect(x, 420, 420, 210, PANEL, color, 20), t(x + 34, 480, num, 66, color, 700), t(x + 34, 540, label, 24, WHITE, 650), t(x + 34, 585, "Mesuré" if fr else "Measured", 17, MUTED, 700, letter=2)])
    body.extend([line(180, 720, 1400, 720, BLUE, 4), square(260, 720, 12, BLUE, "none", 0), square(800, 720, 12, ORANGE, "none", 0), square(1340, 720, 12, SIGNAL, "none", 0), t(260, 770, "REQUEST", 16, MUTED, 700, "middle", 2), t(800, 770, "ACT", 16, MUTED, 700, "middle", 2), t(1340, 770, "EVIDENCE", 16, MUTED, 700, "middle", 2)])
    return base(5, title, subtitle, "Product", body)


def slide_6(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Le cadre légal\nest une porte" if fr else "The legal frame\nis a gate"
    subtitle = "Le numérique existe. Chaque usage doit encore franchir ses conditions." if fr else "The digital rail exists. Each use still clears its conditions."
    body = [
        rect(140, 405, 360, 300, PANEL, BLUE, 22), t(320, 475, "2023", 58, BLUE, 700, "middle"), t(320, 535, "acte technologique" if fr else "technological act", 23, WHITE, 600, "middle"), t(320, 575, "permanent" if fr else "made permanent", 23, WHITE, 600, "middle"),
        path("M690 420 H1080 L1140 480 V705 H690 Z", PANEL, ORANGE, 3), line(740, 545, 1050, 545, ORANGE, 3), line(740, 595, 1010, 595, BLUE, 3), line(740, 645, 1050, 645, BLUE, 3), t(915, 485, "ART. 46", 18, ORANGE, 700, "middle", 2), t(915, 685, "exception · party request · reason", 19, MUTED, 500, "middle"),
        square(1320, 530, 105, "none", SIGNAL, 4), t(1320, 520, "CNQ", 33, SIGNAL, 700, "middle"), t(1320, 560, "gate", 23, WHITE, 600, "middle"),
        t(800, 785, "Law first. Product second." if not fr else "Le droit d’abord. Le produit ensuite.", 25, ORANGE, 650, "middle"),
    ]
    return base(6, title, subtitle, "Why now", body)


def slide_7(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Québec → Canada → monde" if fr else "Québec → Canada → global"
    subtitle = "La signature à distance et la validation CNQ précèdent l’expansion provinciale." if fr else "Remote signing and CNQ validation come before provincial expansion."
    # Abstract Québec silhouette, deliberately not a geographic claim.
    body = [
        path("M200 650 L285 560 L390 575 L450 505 L560 530 L625 470 L710 515 L695 625 L610 682 L480 665 L370 705 Z", PANEL, BLUE, 3),
        square(535, 575, 14, SIGNAL, "none", 0), t(535, 625, "Québec", 23, WHITE, 700, "middle"),
        line(745, 590, 920, 590, SIGNAL, 4, "8 12"),
    ]
    for step, (x, label, _, color, verb) in enumerate([(980, "QUÉBEC", "Prove", BLUE, "Prouver" if fr else "Prove"), (1220, "CANADA", "Expand", ORANGE, "Étendre" if fr else "Expand"), (1450, "GLOBAL", "Option", SIGNAL, "Option")], 1):
        body.extend([square(x, 590, 45, BG, color, 4), t(x, 584, str(step), 28, color, 700, "middle"), t(x, 690, label, 17, color, 700, "middle", 2), t(x, 726, verb, 20, WHITE, 600, "middle")])
    body.extend([
        t(800, 765, "SIGNATURE · SÉCURITÉ · VALIDATION CNQ" if fr else "SIGNING · SECURITY · CNQ VALIDATION", 17, ORANGE, 700, "middle", 2),
        t(800, 805, "110 000 actes de financement = hypothèse à valider" if fr else "110 000 financing acts = planning hypothesis to validate", 18, MUTED, 500, "middle"),
    ])
    return base(7, title, subtitle, "Phase 3 / Expansion", body)


def slide_8(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Un modèle qui\nprotège l’indépendance" if fr else "A model that\nprotects independence"
    subtitle = "Deux lignes de valeur. Un jugement professionnel qui reste au notaire." if fr else "Two value lines. Professional judgment stays with the notary."
    body = [
        rect(110, 420, 520, 220, PANEL, BLUE, 20), rect(970, 420, 520, 220, PANEL, ORANGE, 20),
        t(150, 475, "HONORAIRES", 18, BLUE, 700, letter=2), t(150, 535, "Entiers pour le notaire" if fr else "Full to the notary", 32, WHITE, 700), t(150, 585, "Le jugement et l’acte restent professionnels." if fr else "Judgment and the act stay professional.", 20, MUTED, 500),
        t(1010, 475, "FRAIS NOTA", 18, ORANGE, 700, letter=2), t(1010, 535, "Prix du service Nota" if fr else "Nota's disclosed fee", 32, WHITE, 700), t(1010, 585, "Séparé et visible au client." if fr else "Separate and visible to the client.", 20, MUTED, 500),
        line(630, 735, 970, 735, ORANGE, 4), t(800, 705, "NO FEE SHARE", 17, ORANGE, 700, "middle", 2),
        t(800, 790, "Structure à faire confirmer par avis professionnel." if fr else "Structure still requires a written professional opinion.", 21, MUTED, 500, "middle"),
    ]
    return base(8, title, subtitle, "Business model", body)


def slide_9(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Phase 1 : prouver\nla liquidité locale" if fr else "Phase 1: prove\nlocal liquidity"
    subtitle = "Un terrain étroit. Des résultats qui peuvent être vérifiés." if fr else "A narrow wedge. Results that can be verified."
    body = []
    for i, (num, label, color) in enumerate([("30", "notaires recrutés" if fr else "notaries recruited", BLUE), ("25", "vérifiés et configurés" if fr else "verified and configured", ORANGE), ("244", "actes ciblés en Y1" if fr else "target Y1 completions", SIGNAL)]):
        x = 110 + i * 490
        body.extend([rect(x, 430, 420, 190, PANEL, color, 20), t(x + 34, 510, num, 64, color, 700), t(x + 34, 565, label, 23, WHITE, 650), t(x + 34, 600, "CIBLE" if fr else "TARGET", 16, color, 700, letter=2)])
    body.extend([line(140, 710, 1450, 710, BLUE, 4), square(140, 710, 9, BLUE, "none", 0), square(800, 710, 9, ORANGE, "none", 0), square(1450, 710, 9, SIGNAL, "none", 0), t(140, 760, "MOIS 1", 16, MUTED, 700, "middle", 2), t(800, 760, "MOIS 6", 16, MUTED, 700, "middle", 2), t(1450, 760, "MOIS 12", 16, MUTED, 700, "middle", 2)])
    return base(9, title, subtitle, "Phase 1", body)


def slide_10(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Phase 2 : une boucle\nd’apprentissage contrôlée" if fr else "Phase 2: a controlled\nlearning loop"
    subtitle = "Le comportement usager réduit la friction. La revue notariale qualifie les changements." if fr else "User behavior improves guidance. Notary review qualifies model changes."
    nodes = [
        (190, "UTILISATEUR" if fr else "USER", "questions · usage" if fr else "questions · usage", BLUE),
        (550, "MODÈLE" if fr else "MODEL", "actes simples" if fr else "simple acts", ORANGE),
        (910, "REVUE NOTARIALE" if fr else "NOTARY REVIEW", "accepte · corrige · rejette" if fr else "accept · correct · reject", SIGNAL),
        (1270, "VERSION QUALIFIÉE" if fr else "QUALIFIED VERSION", "testée · réversible" if fr else "held-out · reversible", BLUE),
    ]
    body: list[str] = []
    for x, label, detail, color in nodes:
        body.extend([
            square(x, 500, 92, PANEL, color, 4),
            t(x, 492, label, 15 if len(label) > 12 else 20, color, 750, "middle", 1),
            t(x, 526, detail, 15, WHITE, 500, "middle"),
        ])
    for x1, x2 in [(282, 458), (642, 818), (1002, 1178)]:
        body.extend([line(x1, 500, x2, 500, ORANGE, 4, "10 12"), t((x1 + x2) / 2, 482, "→", 24, ORANGE, 700, "middle")])
    body.extend([
        path("M1270 612 C1270 744 190 744 190 612", "none", BLUE, 4, .85),
        t(730, 704, "BOUCLE HORS LIGNE" if fr else "OFFLINE QUALIFICATION", 17, BLUE, 750, "middle", 2),
        rect(80, 770, 700, 54, PANEL_2, "none", 12),
        rect(820, 770, 700, 54, PANEL_2, "none", 12),
        t(110, 805, "COLLABORER" if fr else "COLLABORATE", 17, ORANGE, 750, letter=1.5),
        t(360, 805, "Revoir → equity potentielle, modalités à approuver" if fr else "Review → potential equity, terms to approve", 16, WHITE, 600),
        t(850, 805, "S’ABONNER" if fr else "SUBSCRIBE", 17, SIGNAL, 750, letter=2),
        t(1055, 805, "Payer mensuellement → aucun feedback produit requis" if fr else "Pay monthly → no product feedback obligation", 17, WHITE, 600),
    ])
    return base(10, title, subtitle, "Phase 2 / Apprentissage" if fr else "Phase 2 / Learning", body)


def slide_11(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Notre différence :\nla date" if fr else "Our difference:\nthe date"
    subtitle = "Nous coordonnons un résultat, pas un document isolé." if fr else "We coordinate an outcome, not an isolated document."
    body = [
        rect(120, 430, 400, 190, PANEL, BLUE, 18), rect(600, 430, 400, 190, PANEL, ORANGE, 18), rect(1080, 430, 400, 190, PANEL, SIGNAL, 18),
        t(320, 495, "DOCUMENT", 18, BLUE, 700, "middle", 2), t(320, 550, "Préparer" if fr else "Prepare", 31, WHITE, 700, "middle"), t(320, 590, "valeur existante" if fr else "existing value", 20, MUTED, 500, "middle"),
        t(800, 495, "DATE", 18, ORANGE, 700, "middle", 2), t(800, 550, "Coordonner" if fr else "Coordinate", 31, WHITE, 700, "middle"), t(800, 590, "signal de Nota" if fr else "Nota's signal", 20, MUTED, 500, "middle"),
        t(1280, 495, "CAPACITÉ", 18, SIGNAL, 700, "middle", 2), t(1280, 550, "Rendre utile" if fr else "Put to work", 31, WHITE, 700, "middle"), t(1280, 590, "offre additionnelle" if fr else "incremental supply", 20, MUTED, 500, "middle"),
        t(800, 745, "Client · notaire · Nota", 28, WHITE, 650, "middle"), t(800, 785, "win-win-win", 20, ORANGE, 700, "middle", 2),
    ]
    return base(11, title, subtitle, "Positioning", body)


def slide_12(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Le modèle financier\nreste une hypothèse" if fr else "The financial model\nremains a hypothesis"
    subtitle = "Base case · financement seulement · résultats à gagner." if fr else "Base case · financing only · results still to earn."
    body = [
        rect(110, 430, 420, 210, PANEL, BLUE, 20), rect(590, 430, 420, 210, PANEL, ORANGE, 20), rect(1070, 430, 420, 210, PANEL, SIGNAL, 20),
        t(145, 500, "244", 62, BLUE, 700), t(145, 552, "actes complétés Y1" if fr else "Y1 completed acts", 22, WHITE, 650), t(145, 596, "cible modélisée" if fr else "modeled target", 17, MUTED, 700, letter=2),
        t(625, 500, "80 813 $", 52, ORANGE, 700), t(625, 552, "revenu Nota Y1" if fr else "Y1 Nota revenue", 22, WHITE, 650), t(625, 596, "cible modélisée" if fr else "modeled target", 17, MUTED, 700, letter=2),
        t(1105, 500, "−204 623 $", 48, SIGNAL, 700), t(1105, 552, "résultat opérationnel" if fr else "operating result", 22, WHITE, 650), t(1105, 596, "avant preuve commerciale" if fr else "before commercial proof", 17, MUTED, 700, letter=1),
        line(150, 730, 1450, 730, BLUE, 4),
        t(150, 780, "Y1", 18, BLUE, 700), t(800, 780, "Y2", 18, ORANGE, 700, "middle"), t(1450, 780, "Y3", 18, SIGNAL, 700, "end"),
        path("M180 715 C470 680 610 670 800 620 S1190 545 1420 470", "none", ORANGE, 5),
        t(800, 825, "Les chiffres sont des cibles de planification, pas de la traction." if fr else "Planning targets are not traction.", 19, MUTED, 500, "middle"),
    ]
    return base(12, title, subtitle, "Economics", body)


def slide_13(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "250 000 $ pour\n12 mois de preuve" if fr else "$250,000 for\n12 months of proof"
    subtitle = "Chaque dollar sert la distribution, la liquidité ou la conformité." if fr else "Every dollar serves distribution, liquidity or compliance."
    body = [
        t(230, 550, "250 000 $", 74, ORANGE, 700, "middle"), t(230, 600, "enveloppe proposée" if fr else "proposed envelope", 20, MUTED, 600, "middle"),
        t(550, 430, "RÉPARTITION DE PLANIFICATION" if fr else "PLANNING ALLOCATION", 17, MUTED, 700, letter=2),
    ]
    rows = [("Acquisition", 55000, BLUE, "notaires + clients" if fr else "notaries + clients"), ("Juridique + conseil", 45000, ORANGE, "avis + workflow" if fr else "opinion + workflow"), ("Produit + opérations", 150000, SIGNAL, "focus + résilience" if fr else "focus + resilience")]
    y = 485
    for label, amount, color, detail in rows:
        width = round(760 * amount / 150000)
        body.extend([t(550, y, label, 24, WHITE, 650), t(1450, y, f"{amount:,.0f} $".replace(",", " "), 23, color, 750, "end"), rect(550, y + 18, 760, 18, PANEL_2, "none", 8), rect(550, y + 18, width, 18, color, "none", 8), t(550, y + 68, detail, 18, MUTED, 500)])
        y += 112
    body.append(t(1000, 805, "Scope and quotes to be confirmed." if not fr else "Portée et devis à confirmer.", 20, MUTED, 500, "middle"))
    return base(13, title, subtitle, "Use of funds", body)


def slide_14(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Les jalons\nouvrent les portes" if fr else "Milestones\nopen the gates"
    subtitle = "On avance quand la preuve précédente est mesurée." if fr else "Advance when the previous proof is measured."
    body: list[str] = []
    gates = [("01", "30", "recrutés" if fr else "recruited", BLUE), ("02", "25", "vérifiés" if fr else "verified", ORANGE), ("03", "244", "complétés" if fr else "completed", SIGNAL)]
    for i, (step, num, label, color) in enumerate(gates):
        x = 110 + i * 490
        body.extend([square(x + 42, 455, 31, BG, color, 4), t(x + 42, 464, step, 18, color, 700, "middle"), t(x + 40, 555, num, 72, color, 700), t(x + 40, 610, label, 24, WHITE, 650), line(x + 40, 660, x + 395, 660, color, 4)])
    body.extend([t(150, 755, "GATE", 16, ORANGE, 700, letter=2), t(290, 755, "Positive contribution · on-time delivery · repeat supply" if not fr else "Contribution positive · livraison à temps · offre répétée", 22, WHITE, 600), t(800, 805, "No gate, no expansion." if not fr else "Pas de preuve, pas d’expansion.", 22, ORANGE, 700, "middle")])
    return base(14, title, subtitle, "Milestones", body)


def slide_15(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Le financement\nfranchit les jalons" if fr else "The raise\nclears the gates"
    subtitle = "Un pré-seed pour prouver la liquidité locale et fermer les conditions de lancement." if fr else "A pre-seed to prove local liquidity and close launch conditions."
    body = [
        t(245, 575, "250 000 $", 78, ORANGE, 700, "middle"), t(245, 630, "CAD · pré-seed" if fr else "CAD · pre-seed", 20, MUTED, 700, "middle", 2),
        rect(570, 425, 870, 78, PANEL, BLUE, 14), rect(570, 535, 870, 78, PANEL, ORANGE, 14), rect(570, 645, 870, 78, PANEL, SIGNAL, 14),
        t(610, 476, "LIQUIDITÉ", 18, BLUE, 700, letter=2), t(900, 476, "Québec City · demandes qualifiées", 26, WHITE, 650),
        t(610, 586, "CONFORMITÉ", 18, ORANGE, 700, letter=2), t(900, 586, "avis professionnel · paiements · assurance", 26, WHITE, 650),
        t(610, 696, "CAPACITÉ", 18, SIGNAL, 700, letter=2), t(900, 696, "preuve avant expansion", 26, WHITE, 650),
        t(1000, 805, "Instrument et investisseur principal à confirmer avec conseil." if fr else "Instrument and lead investor to be confirmed with counsel.", 19, MUTED, 500, "middle"),
    ]
    return base(15, title, subtitle, "The ask", body)


def slide_16(lang: str) -> list[str]:
    fr = lang == "fr"
    title = "Le notaire reste\nle décideur" if fr else "The notary\nremains the decision-maker"
    subtitle = "Chaque acte passe par la Chambre, le Code et les règles applicables." if fr else "Every act passes through the Chambre, the Code and the applicable rules."
    body = [
        square(300, 555, 136, "none", ORANGE, 5), path("M235 555 L280 600 L375 490", "none", ORANGE, 10), eyebrow(300, 730, "GATE", ORANGE, "middle"),
        rect(650, 420, 770, 78, PANEL, BLUE, 14), rect(650, 535, 770, 78, PANEL, ORANGE, 14), rect(650, 650, 770, 78, PANEL, SIGNAL, 14),
        t(690, 470, "CNQ", 20, BLUE, 700, letter=2), t(850, 470, "ordre et règles professionnelles", 25, WHITE, 650),
        t(690, 585, "CODE", 20, ORANGE, 700, letter=2), t(850, 585, "indépendance et honoraires", 25, WHITE, 650),
        t(690, 700, "ACTE", 20, SIGNAL, 700, letter=2), t(850, 700, "consentement, conseil, signature", 25, WHITE, 650),
        t(800, 805, "Nota augmente la capacité. Le notaire garde le jugement.", 23, ORANGE, 700, "middle") if fr else t(800, 805, "Nota expands capacity. The notary keeps judgment.", 23, ORANGE, 700, "middle"),
    ]
    return base(16, title, subtitle, "Legal framework", body)


SLIDES = [slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7, slide_8,
          slide_9, slide_10, slide_11, slide_12, slide_13, slide_14, slide_15, slide_16]


def render(lang: str, svg_dir: Path | None = None) -> None:
    """Rasterize with ImageMagick (needs Sora + Inter in fontconfig), or — with
    `svg_dir` — only write the SVGs there for rasterize-slides.mjs, which draws
    them in a headless Chromium that loads the faces from Google Fonts. The
    second path is what regenerates the committed PNGs on a machine without the
    fonts installed; both produce the same 1600×900 frames."""
    prefix = "dark-slide-fr-" if lang == "fr" else "dark-slide-"
    for number, fn in enumerate(SLIDES, 1):
        svg_path = (svg_dir or OUT) / f"{prefix}{number}.svg"
        svg_path.write_text("\n".join(fn(lang)), encoding="utf-8")
        if svg_dir is not None:
            continue
        png_path = OUT / f"{prefix}{number}.png"
        subprocess.run(["magick", "-background", "none", str(svg_path), "-density", "144", str(png_path)], check=True)
        svg_path.unlink()


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--svg-out":
        target = Path(sys.argv[2]).resolve()
        target.mkdir(parents=True, exist_ok=True)
        render("en", target)
        render("fr", target)
        print(f"wrote 32 SVG frames to {target} — rasterize with: node docs/pitch-deck/rasterize-slides.mjs {target}")
    else:
        require_fonts()
        OUT.mkdir(parents=True, exist_ok=True)
        render("en")
        render("fr")
        print(f"wrote concise English and French slides to {OUT}")
