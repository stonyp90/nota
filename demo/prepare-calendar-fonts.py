"""Convert Nota's local web fonts to static TTFs for the SVG video renderer."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'output/calendar-runtime/python'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

destination = root / 'output/calendar-runtime/fonts'
destination.mkdir(parents=True, exist_ok=True)
for family, weights in [('inter', [400, 600, 700]), ('sora', [700])]:
    source = root / f'apps/web/public/fonts/{family}-latin.woff2'
    for weight in weights:
        target = destination / f'{family}-{weight}.ttf'
        if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
            continue
        font = instantiateVariableFont(TTFont(source), {'wght': weight}, inplace=True, updateFontNames=True)
        font.flavor = None
        font.save(target)
