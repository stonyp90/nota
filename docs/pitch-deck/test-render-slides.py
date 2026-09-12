"""Check financial and market meaning in the generated investor story."""
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('nota_slides',Path(__file__).with_name('render-slides.py'))
slides=importlib.util.module_from_spec(spec);spec.loader.exec_module(slides)
NS={'s':'http://www.w3.org/2000/svg'}
def text(svg):
    return ' '.join(t.text or '' for t in ET.fromstring(svg).findall('.//s:text',NS))
class InvestorMeaningTest(unittest.TestCase):
    def test_financials_are_domain_formatted_in_both_editions(self):
        for lang,amount in [('fr','250 000 $'),('en','$250,000')]:
            slides.LANG=lang
            self.assertIn(amount,text(slides.slide_15()).replace('\xa0',' '))
            for year in slides.MODEL['years']:
                self.assertIn(slides.money(round(year['revenue'])),text(slides.slide_14()))
            self.assertNotIn('0 $ pour',text(slides.slide_15()))
    def test_market_scope_and_targets_are_not_traction(self):
        slides.LANG='fr'
        self.assertIn('10 271',text(slides.slide_4()))
        self.assertIn('non additionnables',text(slides.slide_4()))
        self.assertIn('hypothèses',text(slides.slide_5()))
        self.assertIn('cible non démontrée',text(slides.slide_7()))
        self.assertIn('électronique notariale existe déjà',text(slides.slide_9()))
        self.assertIn('ne constituent pas de la traction',text(slides.slide_12()))
    def test_all_frames_have_valid_sources_and_no_repeated_logo(self):
        for lang in ['fr','en']:
            slides.LANG=lang
            for fn in slides.SLIDES:
                frame=ET.fromstring(fn())
                self.assertEqual(frame.attrib['viewBox'],'0 0 1600 900')
                self.assertFalse(frame.findall('.//s:image',NS))
                for a in frame.findall('.//s:a',NS):
                    self.assertTrue(a.attrib['href'].startswith('https://'))
        self.assertEqual(len(slides.SLIDES),16)
if __name__=='__main__':unittest.main()
