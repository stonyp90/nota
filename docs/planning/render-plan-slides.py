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
    return svg.replace(f'{n:02d} / 16',f'{n:02d} / 08')

def draw(n):
    t=d.tr;b=[]
    if n==1:
        for i,(title,detail) in enumerate([(t('Mise en relation','Matching'),t('Une demande structurée.\nUne capacité appropriée.','A structured request.\nSuitable capacity.')),(t('Automatisation','Automation'),t('Le travail répétitif devient\nune préparation assistée.','Repeatable work becomes\nassisted preparation.')),(t('Signature','Signing'),t('La continuité du dossier\njusqu’à sa conclusion.','File continuity\nthrough to completion.'))]):
            x=72+i*497;b += [d.panel(x,347,461,273,f'0{i+1}',title,detail,i*700)]
            if i<2:b += [d.rule(x+461,476,x+497,476,i*700+500)]
        b += [d.group([d.t(72,726,t('Urgence → première relation. Usage récurrent → ambition logicielle.','Urgency → first relationship. Recurring use → software ambition.'),28,d.BLUE,600)],'match',2300)]
        return frame(n,t('Trois étapes. Un même dossier.','Three stages. One connected file.'),t('Québec d’abord : financement et refinancement, puis expansion selon les preuves.','Québec City first: financing and refinancing, then expansion as evidence supports it.'),b,t('Modèle en développement. Les fonctionnalités démontrables et les services opérationnels sont distingués dans le détail.','Model under development. Demonstrable features and operational services are distinguished in the detail.'))
    if n==2:
        obs=d.MODEL['market']['observed']
        for i,(key,label) in enumerate([('quebecCmaSales',t('Québec · RMR','Québec City · CMA')),('quebecProvinceSales',t('Québec · province','Québec · province')),('canadaMlsSales','Canada')]):
            x=72+i*497;b += [d.group([d.t(x,404,d.num(obs[key]),76,d.WHITE,700),d.display(x,465,label,30)],'market',i*550)]
        b += [d.line(72,510,1528,510),d.eyebrow(72,563,t('SCÉNARIO LOCAL · À EXPLORER','LOCAL SCENARIO · EXPLORE')),
            d.t(72,628,'10 % × 25 % × 80 %',42,d.WHITE,700).replace('<text ','<text data-plan-formula="true" ',1),
            d.t(1100,647,'205',86,d.ORANGE,700,'end').replace('<text ','<text data-plan-result="true" ',1),d.t(1140,644,t('actes / an','acts / year'),28,d.WHITE),
            d.t(72,726,t('Faites varier les trois hypothèses sous la diapositive.','Adjust the three assumptions below the slide.'),26,d.BLUE,600)]
        return frame(n,t('Dimensionner le premier marché.','Size the starting market.'),t('Ventes résidentielles observées en 2025; les territoires sont imbriqués.','Observed residential sales in 2025; the territories are nested.'),b,t('Taux qualifiable, part captée et complétion supposés. Scénario annuel distinct des 244 actes du modèle A1.','Assumed qualification, capture and completion rates. Annual scenario separate from the 244 acts in the Y1 model.'),['apciq','crea'])
    if n==3:
        for i,(value,title,detail) in enumerate([(d.num(2659),t('Québec','Québec'),t('Notaires en étude ou cabinet.','Notaries in traditional practices.')),(t('≈ 50 000','≈ 50,000'),t('Union européenne','European Union'),t('Notaires des membres du CNUE.','Notaries across CNUE members.')),('93',t('Monde','Worldwide'),t('Notariats membres de l’UINL.','UINL member notariats.'))]):
            x=72+i*497;b += [d.group([d.t(x,413,value,72,d.WHITE,700),d.display(x,480,title,34),d.lines(x,536,detail,25,d.MUTED,35)],'expand',i*650)]
        b += [d.rule(72,627,1528,627,2200),d.t(72,699,t('Chaque territoire : partenaire local → actes pris en charge → intégrations autorisées.','Each jurisdiction: local partner → supported acts → authorized integrations.'),26,d.BLUE,600)]
        return frame(n,t('Déployer un métier, pays par pays.','Expand the workflow, country by country.'),t('Une profondeur internationale pour l’outil de préparation et de signature.','International depth for preparation and signing software.'),b,t('Bassins de référence, pas des sièges clients validés. Aucun revenu mondial n’est déduit de ces populations distinctes.','Reference pools, not validated customer seats. No global revenue is inferred from these different populations.'),['cnq','cnue','uinl'])
    if n==4:
        b=[d.t(72,423,'80 %',106,d.ORANGE,700),d.display(72,486,t('une cible à mesurer','a target to measure'),36),d.lines(72,547,t('1 − temps humain assisté\n÷ temps humain manuel.','1 − assisted human time\n÷ manual human time.'),28,d.WHITE,42),d.lines(72,660,t('Sur la préparation répétitive définie.\nRevue, erreurs et corrections incluses.','On defined repeatable preparation.\nReview, errors and corrections included.'),24,d.MUTED,48)]
        for i,(title,detail) in enumerate([(t('Référence','Baseline'),t('Dossiers et tâches comparables.','Comparable files and tasks.')),(t('Mesure','Measurement'),t('Temps complet et qualité des sorties.','Full time and output quality.')),(t('Décision','Decision'),t('Notaire réviseur et retour arrière.','Notary reviewer and rollback.'))]):
            y=336+i*133;b += [d.group([d.rect(907,y,621,113,d.PANEL,d.LINE,6),d.display(935,y+44,title,30),d.t(935,y+86,detail,24,d.MUTED)],'evidence',i*750)]
        return frame(n,t('Prouver le gain de préparation.','Prove the preparation saving.'),t('Le conseil, le jugement, l’approbation finale et la signature restent au notaire.','Advice, judgment, final approval and signing remain with the notary.'),b,t('Objectif non démontré. Proposition pilote : au moins 30 dossiers appariés par type d’acte, protocole à valider.','Unproven target. Proposed pilot: at least 30 matched files per act type, with a protocol to validate.'))
    if n==5:
        for i,(title,detail) in enumerate([(t('Identité','Identity'),t('Personnes vérifiées','Verified people')),(t('Consentement','Consent'),t('Acte compris et validé','Understood, approved act')),(t('Signature','Signature'),t('Moyen autorisé','Authorized method')),(t('Conservation','Preservation'),t('Preuve et copie authentique','Evidence and authentic copy'))]):
            x=72+i*374;b += [d.rule(x+22,382,x+396,382,i*650) if i<3 else '',d.group([d.rect(x,360,44,44,d.SIGNAL,radius=6),d.t(x+22,391,str(i+1),23,d.WHITE,700,'middle'),d.display(x,480,title,30),d.lines(x,539,detail,24,d.MUTED,24)],'sign-step',i*650)]
        b += [d.group([d.rect(72,650,1456,87,d.PANEL_2,radius=6),d.t(104,704,t('À valider : fournisseur, intégration, preuve, conservation et reprise après erreur.','Validate: provider, integration, evidence, preservation and error recovery.'),26,d.BLUE,600)],'seal',2400)]
        return frame(n,t('Relier la signature au dossier préparé.','Connect signing to the prepared file.'),t('Une intégration des moyens autorisés, dans le parcours du notaire.','An integration with authorized methods, within the notary’s workflow.'),b,t('La signature électronique existe déjà. La salle Nota actuelle est une répétition; la distance demeure encadrée.','Electronic signing already exists. The current Nota room is a rehearsal; remote signing remains regulated.'),['signing','remote'])
    if n==6:
        for i,(v,title,detail) in enumerate([('30',t('recrutés','recruited'),t('Première cohorte de notaires.','First notary cohort.')),('25',t('vérifiés','verified'),t('Capacité et processus validés.','Validated capacity and workflow.')),('244',t('actes terminés','completed acts'),t('Cible de première année.','Year 1 target.'))]):
            x=72+i*497;b += [d.group([d.t(x,428,v,90,d.WHITE,700),d.display(x,494,title,36),d.t(x,548,detail,25,d.MUTED)],'cohort',i*650)]
        b += [d.rule(72,611,1528,611,2000),d.t(72,690,t('Demande → qualification → acceptation → acte terminé → paiement.','Request → qualification → acceptance → completed act → payment.'),28,d.BLUE,600)]
        return frame(n,t('Tester une cohorte que l’on peut servir.','Test a cohort we can actually serve.'),t('La capacité active, la livraison à temps et la contribution déterminent l’expansion.','Active capacity, on-time delivery and contribution determine expansion.'),b,t('Cibles proposées, pas traction vérifiée. Les démos et les tests ne comptent pas comme revenus ou actes commerciaux.','Proposed targets, not verified traction. Demos and tests do not count as revenue or commercial acts.'))
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
        return frame(n,t('Des seuils clairs pour avancer.','Clear gates for moving forward.'),t('Débloquer chaque étape avec les professionnels responsables.','Unlock each stage with the responsible professionals.'),b,t('La divergence entre politique de commission et modèle de frais distincts doit être résolue avant le lancement concerné.','The conflict between commission policy and separate-fee planning must be resolved before the affected launch.'))

payload={'cashLabels':{l:[d.MONEY[l][str(round(m['closing']))] for m in d.MODEL['months']] for l in ['fr','en']},'editions':{},'sources':d.FACTS,'months':d.MODEL['months'],'market':d.MODEL['market']}
for lang in ['fr','en']:
    d.LANG=lang;d.DECK=[];frames=[draw(n) for n in range(1,9)]
    payload['editions'][lang]=[{**meta,'svg':svg} for meta,svg in zip(d.DECK,frames)]
p=OUT.parent/'business-plan.html';s=p.read_text()
s=re.sub(r'<script type="application/json" id="plan-deck-data">.*?</script>','',s,flags=re.S)
s=re.sub(r'<style data-plan-deck>.*?</style>|<script data-plan-deck>.*?</script>','',s,flags=re.S)
s=s.replace('</head>','<script type="application/json" id="plan-deck-data">'+json.dumps(payload,ensure_ascii=False).replace('</','<\\/')+'</script>\n<style data-plan-deck>'+ (OUT/'plan-deck.css').read_text()+'</style></head>')
s=s.replace('</body>','<script data-plan-deck>'+ (OUT/'plan-deck.js').read_text()+'</script></body>')
p.write_text(s)
print('Wrote the eight-chapter interactive business plan in French and English')
