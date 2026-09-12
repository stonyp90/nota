"""Build the business plan's own eight-slide experience from common Nota drawings."""
import importlib.util
import json
from pathlib import Path
import re
spec=importlib.util.spec_from_file_location('deck',Path(__file__).parents[1]/'pitch-deck/render-slides.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
OUT=Path(__file__).parent

def frame(n,title,subtitle,body,note,sources=()):
    svg=d.frame(n,d.tr('PLAN D’AFFAIRES','BUSINESS PLAN'),title,subtitle,body,note,sources)
    return svg.replace(f'{n:02d} / {d.TOTAL_SLIDES:02d}',f'{n:02d} / 08')

def draw(n):
    t=d.tr;b=[]
    if n==1:
        for i,(title,detail) in enumerate([(t('Mise en relation','Matching'),t('Une demande structurée.\nUne capacité appropriée.','A structured request.\nSuitable capacity.')),(t('Automatisation','Automation'),t('Le travail répétitif devient\nune préparation assistée.','Repeatable work becomes\nassisted preparation.')),(t('Signature','Signing'),t('La continuité du dossier\njusqu’à sa conclusion.','File continuity\nthrough to completion.'))]):
            x=72+i*497;b += [d.panel(x,347,461,273,f'0{i+1}',title,detail,i*700)]
            if i<2:b += [d.rule(x+461,476,x+497,476,i*700+500)]
        b += [d.group([d.t(72,726,t('Urgence → première relation. Usage récurrent → ambition logicielle.','Urgency → first relationship. Recurring use → software ambition.'),28,d.BLUE,600)],'match',2300)]
        return frame(n,t('Trois étapes. Un même dossier.','Three stages. One connected file.'),t('Québec d’abord : financement et refinancement, puis expansion selon les preuves.','Québec City first: financing and refinancing, then expansion as evidence supports it.'),b,t('Modèle en développement. Les fonctionnalités démontrables et les services opérationnels sont distingués dans le détail.','Model under development. Demonstrable features and operational services are distinguished in the detail.'))
    if n in (2,3,4,5,6):
        generators={2:d.slide_2,3:d.slide_3,4:d.slide_4,5:d.slide_5,6:d.slide_6}
        svg=generators[n]()
        kicker={2:d.tr('MARCHÉ ET PREMIÈRE PART','MARKET AND FIRST SHARE'),3:d.tr('ACQUISITION · PARTENARIATS','ACQUISITION · PARTNERSHIPS'),4:d.tr('PHASE 2 · CAPACITÉ PAR L’IA','PHASE 2 · CAPACITY THROUGH AI'),5:d.tr('PHASE 3 · SIGNATURE EN LIGNE','PHASE 3 · ONLINE SIGNING'),6:d.tr('ÉCONOMIE · SCÉNARIO','ECONOMICS · SCENARIO')}[n]
        svg=svg.replace('>'+kicker+'</text>','>'+d.tr('PLAN D’AFFAIRES','BUSINESS PLAN')+'</text>').replace(f'{n:02d} / {d.TOTAL_SLIDES:02d}',f'{n:02d} / 08')
        if n==2:
            svg=re.sub(r'<text([^>]*)>205</text>',r'<text data-plan-result="true"\1>205</text>',svg)
            svg=re.sub(r'<text([^>]*)>(25 ?%[^<]*)</text>',r'<text data-plan-share="true"\1>\2</text>',svg)
            svg=re.sub(r'<text([^>]*)>(10[ ,]271 ×[^<]*)</text>',r'<text data-plan-formula="true"\1>\2</text>',svg)
        return svg
    if n==7:
        cash=[r['closing'] for r in d.MODEL['months']]; pts=[(825+i*63,690-v/250000*330) for i,v in enumerate(cash)]
        b=[d.t(72,412,d.money(250000),88,d.WHITE,700),d.display(72,479,t('enveloppe recherchée','funding ask'),34),d.lines(72,553,t('Budget d’exploitation de 12 mois.\nEmbauches futures conditionnelles.','12-month operating budget.\nLater hiring remains conditional.'),27,d.MUTED,41),d.t(72,704,t('La trésorerie pilote le rythme.','Cash determines the pace.'),30,d.BLUE,600),d.eyebrow(825,344,t('TRÉSORERIE · SCÉNARIO DE BASE','CASH · BASE SCENARIO'))]
        for v in (0,125000,250000):
            y=690-v/250000*330;b += [d.line(825,y,1518,y),d.t(811,y+5,d.num(v),16,d.MUTED,500,'end')]
        path='M'+' L'.join(f'{x} {y:.2f}' for x,y in pts)
        b += [d.group([f'<path d="{path}" pathLength="1" stroke="{d.BLUE}" stroke-width="4" fill="none"/>'],'trace',400)]
        for i,(x,y) in enumerate(pts):b += [d.t(x,723,str(i+1),18,d.MUTED,500,'middle')]
        x,y=pts[-1];b += [f'<rect data-cash-point x="{x-7}" y="{y-7}" width="14" height="14" rx="3" fill="{d.ORANGE}"/>',d.t(1518,406,d.money(round(cash[-1])),30,d.ORANGE,700,'end').replace('<text ','<text data-cash-value ',1)]
        return frame(n,t('Financer la preuve et protéger la suite.','Fund the proof and protect the next stage.'),t('Explorez le solde mensuel sous la diapositive; le scénario ne garantit pas la durée de vie.','Explore monthly balances below the slide; the scenario does not guarantee runway.'),b,t(f'A1 : 244 actes; {d.money(d.YEAR_ONE_CASH)} fin d’année. Capital additionnel de base : au moins {d.money(d.ADDITIONAL_CAPITAL)}, avant les éléments non modélisés.',f'Y1: 244 acts; {d.money(d.YEAR_ONE_CASH)} year-end cash. Base additional capital: at least {d.money(d.ADDITIONAL_CAPITAL)} before unmodeled items.'))
    if n==8:
        rows=[(t('Avant le pilote','Before the pilot'),t('Modèle commercial, contrats, taxes, paiements.','Commercial model, contracts, taxes, payments.')),(t('Avant l’automatisation','Before automation'),t('Données permises, qualité, revue professionnelle.','Permitted data, quality, professional review.')),(t('Avant la signature','Before signing'),t('Intégrations autorisées, preuve et conservation.','Authorized integrations, evidence, preservation.'))]
        for i,(title,detail) in enumerate(rows):
            y=371+i*124;b += [d.group([d.rect(72,y-23,30,30,d.SIGNAL,radius=3),d.display(130,y,title,32),d.t(688,y,detail,26,d.WHITE),d.line(130,y+48,1528,y+48)],'milestone',i*650)]
        b += [d.t(72,737,t('Responsables : fondateur · notaire conseiller · juridique · comptabilité.','Owners: founder · notary advisor · legal counsel · accounting.'),26,d.BLUE,600)]
        return frame(n,t('Des seuils clairs pour avancer.','Clear gates for moving forward.'),t('Débloquer chaque étape avec les professionnels responsables.','Unlock each stage with the responsible professionals.'),b,t('Frais Nota payés par le client. Programme partenaire, offres IA et protocole de signature : conditions et validations à finaliser.','Client-paid Nota fees. Partner program, AI offers and signing protocol: terms and validations to finalize.'))

payload={'cashLabels':{l:[d.MONEY[l][str(round(m['closing']))] for m in d.MODEL['months']] for l in ['fr','en']},'editions':{},'sources':d.FACTS,'months':d.MODEL['months'],'market':d.MODEL['market']}
for lang in ['fr','en']:
    d.LANG=lang;d.DECK=[];frames=[draw(n) for n in range(1,9)]
    payload['editions'][lang]=[{**meta,'svg':svg} for meta,svg in zip(d.DECK,frames)]
p=OUT.parent/'business-plan.html';s=p.read_text()
s=re.sub(r'<script type="application/json" id="plan-deck-data">.*?</script>','',s,flags=re.S)
s=re.sub(r'<style data-plan-deck>.*?</style>|<script data-plan-deck>.*?</script>','',s,flags=re.S)
s=s.replace('</head>','<script type="application/json" id="plan-deck-data">'+json.dumps(payload,ensure_ascii=False).replace('</','<\\/')+'</script>\n<style data-plan-deck>'+ (OUT/'plan-deck.css').read_text()+'</style></head>')
s=s.replace('</body>','<script data-plan-deck>'+ (OUT/'plan-deck.js').read_text()+'</script></body>')
s=re.sub(r'<script data-nota-presentation-controls>.*?</script>|<style data-nota-presentation-controls>.*?</style>','',s,flags=re.S)
s=s.replace('</head>','<script data-nota-presentation-controls>'+(OUT.parent/'presentation-controls.js').read_text()+'</script><style data-nota-presentation-controls>'+(OUT.parent/'presentation-controls.css').read_text()+'</style></head>')
p.write_text(d.normalize_chrome(s))
print('Wrote the eight-chapter interactive business plan in French and English')
