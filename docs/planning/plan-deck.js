/* Nota business plan: eight native slides with an auditable detail layer. */
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('plan-deck-data').textContent);
  const $ = id => document.getElementById(id);
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const themeQuery = matchMedia('(prefers-color-scheme: dark)');
  const read = key => { try { const value = localStorage.getItem(key); try { return JSON.parse(value); } catch { return value; } } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } };
  const sections = [...document.querySelectorAll('#plan-en .plan-section')].map(section => {
    const content = section.querySelector('.section-content').cloneNode(true);
    content.querySelectorAll('.focus-summary,.market-explorer').forEach(node => node.remove());
    return content.innerHTML;
  });
  const french = document.querySelector('#plan-fr .french-summary').cloneNode(true);
  french.querySelectorAll('.market-explorer').forEach(node => node.remove());
  const part = (text, from, to) => {
    const start = from ? text.search(new RegExp('<h3>' + from.replace('.', '\\.'))) : 0;
    const end = to ? text.search(new RegExp('<h3>' + to.replace('.', '\\.'))) : text.length;
    return start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
  };
  const combine = ids => ids.map(id => sections[id - 1]).join('');
  const details = {
    fr: french.innerHTML.split(/(?=<h2>)/).slice(1),
    en: [combine([1,2,3]), part(sections[4], null, '5.3'), part(sections[4], '5.3'),
      part(sections[9], null, '10.2') + part(sections[9], '10.3'),
      part(sections[9], '10.2', '10.3'), combine([4,6,11]), combine([8,12]), combine([7,9,13,14,15])]
  };
  const brand = document.querySelector('.plan-header .plan-brand').outerHTML;
  const main = document.querySelector('main');
  main.innerHTML = '<div class="plan-experience">' +
    '<div class="plan-deck-head"><div><h1 id="planTitle"></h1><p id="planSubtitle"></p></div><span class="plan-counter" id="planCounter" aria-live="polite"></span></div>' +
    '<div class="plan-stage" id="planStage" role="region"><div class="plan-fullscreen-brand">' + brand + '</div><div class="slide" id="planSlide"></div>' +
    '<div class="plan-fullscreen-controls"><button data-plan-fs="prev">←</button><button data-plan-fs="next">→</button><button data-plan-fs="replay"></button><button data-plan-fs="motion"></button><button data-plan-fs="exit"></button></div></div>' +
    '<div class="plan-controls"><button id="planPrevious">←</button><button id="planNext">→</button><button id="planReplay"></button><button id="planMotion" aria-pressed="false"></button><button id="planPlay" aria-pressed="false"></button><button id="planFullscreen"></button></div>' +
    '<nav class="plan-chapters" id="planChapters"></nav><p class="plan-evidence" id="planEvidence"></p><div class="plan-source-links" id="planSources"></div>' +
    '<div class="plan-interaction" id="planInteraction"></div><details class="plan-drilldown"><summary id="planDetailLabel"></summary><div class="plan-detail-content" id="planDetail"></div></details>' +
    '<details class="plan-transcript"><summary id="planTranscriptLabel"></summary><p id="planTranscript"></p></details></div>';
  const printContent = document.createElement('div'); printContent.className = 'plan-print-only'; main.append(printContent);
  const stage = $('planStage');
  const copy = {
    fr: {title:'Plan d’affaires', subtitle:'Une stratégie en trois étapes. Huit chapitres pour l’examiner.', chapter:'Chapitre',
      chapters:['Thèse','Marché local','International','Automatisation','Signature','Pilote','Financement','Gouvernance'],
      previous:'Chapitre précédent', next:'Chapitre suivant', replay:'Rejouer l’animation', pause:'Pause', resume:'Reprendre',
      disabled:'Animation désactivée', auto:'Défilement automatique', stop:'Arrêter le défilement', full:'Plein écran', exit:'Quitter le plein écran',
      detail:'Approfondir ce chapitre', transcript:'Lire le contenu de la diapositive', deck:'Présentation', theme:'Thème',
      assumption:'Vision, cibles ou hypothèses internes. Le détail de ce chapitre précise leurs limites.',
      calculator:'Explorer le scénario local', qualify:'Part qualifiable', capture:'Part captée', completion:'Taux de complétion',
      acts:'actes par année', calcNote:'Trois hypothèses à tester sur les 10 271 ventes observées dans la RMR de Québec en 2025. Ce résultat est distinct des 244 actes du modèle de première année.',
      cash:'Solde mensuel de trésorerie', month:'Mois', cashNote:'Scénario de base, après la levée initiale. Les obligations non modélisées et les variations réelles peuvent réduire ce solde.'},
    en: {title:'Business plan', subtitle:'A three-stage strategy. Eight chapters to examine it.', chapter:'Chapter',
      chapters:['Thesis','Local market','International','Automation','Signing','Pilot','Funding','Governance'],
      previous:'Previous chapter', next:'Next chapter', replay:'Replay animation', pause:'Pause', resume:'Resume',
      disabled:'Animation disabled', auto:'Auto-advance', stop:'Stop auto-advance', full:'Full screen', exit:'Exit full screen',
      detail:'Explore this chapter in detail', transcript:'Read the slide content', deck:'Pitch deck', theme:'Theme',
      assumption:'Internal vision, targets or assumptions. This chapter’s detail explains their limits.',
      calculator:'Explore the local scenario', qualify:'Qualifiable share', capture:'Captured share', completion:'Completion rate',
      acts:'acts per year', calcNote:'Three assumptions to test against the 10,271 observed 2025 sales in the Québec City CMA. This result is separate from the 244 acts in the Year 1 model.',
      cash:'Monthly closing cash balance', month:'Month', cashNote:'Base scenario, after the initial raise. Unmodeled obligations and actual variances may reduce this balance.'}
  };
  const requested = new URLSearchParams(location.search).get('lang');
  let language = [requested, read('nota.lang'), 'fr'].find(value => value === 'fr' || value === 'en');
  let current = 1, paused = false, timer = null, playing = false;
  let assumptions = [10,25,80], cashMonth = 12;
  const number = value => Math.round(value).toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA');
  function syncMotion() {
    const off = motionQuery.matches;
    stage.classList.toggle('motion-paused', paused || document.hidden);
    [$('planMotion'), stage.querySelector('[data-plan-fs=motion]')].forEach(button => {
      button.textContent = copy[language][off ? 'disabled' : paused ? 'resume' : 'pause'];
      button.disabled = off; button.setAttribute('aria-pressed', String(paused || off));
    });
    [$('planReplay'), stage.querySelector('[data-plan-fs=replay]')].forEach(button => { button.disabled = off; });
  }
  function setPlaying(value) {
    clearInterval(timer); timer = null; playing = value;
    if (value) timer = setInterval(() => current === 8 ? setPlaying(false) : setChapter(current + 1), 12000);
    $('planPlay').setAttribute('aria-pressed', String(value));
    $('planPlay').textContent = copy[language][value ? 'stop' : 'auto'];
  }
  function updateMarket() {
    const c = copy[language], base = data.market.observed.quebecCmaSales;
    const result = number(base * assumptions.reduce((total,value) => total * value / 100, 1));
    const formula = assumptions.map(value => value + ' %').join(' × ');
    $('planSlide').querySelector('[data-plan-formula]').textContent = formula;
    $('planSlide').querySelector('[data-plan-result]').textContent = result;
    const box = $('planInteraction');
    box.querySelector('[data-market-result]').textContent = result;
    box.querySelector('[data-market-equation]').textContent = number(base) + ' × ' + formula + ' = ' + result;
    box.querySelectorAll('output').forEach((output, i) => { output.textContent = assumptions[i] + ' %'; });
    $('planTranscript').textContent = data.editions[language][1].transcript + ' ' + number(base) + ' × ' + formula + ' = ' + result + ' ' + c.acts + '.';
  }
  function updateCash() {
    const value = data.months[cashMonth - 1].closing;
    const point = $('planSlide').querySelector('[data-cash-point]');
    point.setAttribute('x', String(825 + (cashMonth - 1) * 63 - 7));
    point.setAttribute('y', String(690 - value / 250000 * 330 - 7));
    const label = data.cashLabels[language][cashMonth - 1];
    $('planSlide').querySelector('[data-cash-value]').textContent = label;
    $('planCashLabel').textContent = copy[language].month + ' ' + cashMonth + ' · ' + label;
    $('planTranscript').textContent = data.editions[language][6].transcript + ' ' + copy[language].month + ' ' + cashMonth + ': ' + label + '.';
  }
  function renderInteraction() {
    const c = copy[language], target = $('planInteraction');
    target.replaceChildren();
    if (current === 2) {
      target.innerHTML = '<section class="market-explorer" data-market-lang="' + language + '" aria-labelledby="planCalcTitle"><h3 id="planCalcTitle">' + c.calculator + '</h3><p>' + c.calcNote + '</p><div class="market-inputs">' +
        ['qualify','capture','completion'].map((key,i) => '<label>' + c[key] + ' · <output>' + assumptions[i] + ' %</output><input type="range" min="0" max="100" step="5" value="' + assumptions[i] + '" data-assumption="' + i + '" aria-label="' + c[key] + '"></label>').join('') +
        '</div><div class="market-outcome" aria-live="polite"><strong data-market-result></strong><span>' + c.acts + '</span></div><p data-market-equation></p></section>';
      target.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
        setPlaying(false); assumptions[Number(input.dataset.assumption)] = Number(input.value); updateMarket();
      }));
      updateMarket();
    }
    if (current === 7) {
      target.innerHTML = '<div class="plan-cash-control"><label for="planCashMonth">' + c.cash + '</label><input id="planCashMonth" type="range" min="1" max="12" step="1" value="' + cashMonth + '"><p id="planCashLabel" aria-live="polite"></p><p>' + c.cashNote + '</p></div>';
      $('planCashMonth').addEventListener('input', () => { setPlaying(false); cashMonth = Number($('planCashMonth').value); updateCash(); });
      updateCash();
    }
  }
  function setChapter(value, writeHash = true) {
    current = Math.max(1, Math.min(8, Math.trunc(Number(value)) || 1));
    const item = data.editions[language][current - 1], c = copy[language];
    $('planSlide').innerHTML = item.svg;
    stage.setAttribute('aria-label', c.chapter + ' ' + current + ': ' + item.title);
    $('planCounter').textContent = String(current).padStart(2,'0') + ' / 08';
    $('planEvidence').textContent = item.note;
    $('planTranscript').textContent = item.title + '. ' + item.transcript;
    $('planDetail').innerHTML = details[language][current - 1] || '';
    $('planSources').replaceChildren();
    item.sources.forEach(id => {
      const source = data.sources[id], anchor = document.createElement('a');
      anchor.href = source.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = source.label;
      $('planSources').append(anchor);
    });
    if (!item.sources.length) $('planSources').textContent = c.assumption;
    [$('planPrevious'), stage.querySelector('[data-plan-fs=prev]')].forEach(button => { button.disabled = current === 1; });
    [$('planNext'), stage.querySelector('[data-plan-fs=next]')].forEach(button => { button.disabled = current === 8; });
    document.querySelectorAll('[data-plan-chapter]').forEach(button => button.setAttribute('aria-current', String(Number(button.dataset.planChapter) === current)));
    if (writeHash) history.replaceState(null, '', '#chapter-' + current);
    renderInteraction(); syncMotion();
  }
  function syncTheme() {
    const dark = (document.documentElement.dataset.theme || (themeQuery.matches ? 'dark' : 'light')) === 'dark';
    $('theme-toggle').setAttribute('aria-checked', String(dark));
    $('theme-toggle').setAttribute('aria-label', copy[language].theme);
  }
  function syncFullscreen() { $('planFullscreen').textContent = copy[language][document.fullscreenElement ? 'exit' : 'full']; }
  function setLanguage(lang) {
    language = lang; const c = copy[lang];
    printContent.innerHTML = '<h1>' + c.title + '</h1>' + details[lang].join('');
    document.documentElement.lang = lang === 'fr' ? 'fr-CA' : 'en-CA'; document.title = 'Nota · ' + c.title;
    const names = {planTitle:'title',planSubtitle:'subtitle',planReplay:'replay',planDetailLabel:'detail',planTranscriptLabel:'transcript'};
    Object.entries(names).forEach(([id,key]) => { $(id).textContent = c[key]; });
    [$('planPrevious'),stage.querySelector('[data-plan-fs=prev]')].forEach(button => button.setAttribute('aria-label',c.previous));
    [$('planNext'),stage.querySelector('[data-plan-fs=next]')].forEach(button => button.setAttribute('aria-label',c.next));
    stage.querySelector('[data-plan-fs=replay]').textContent = c.replay;
    stage.querySelector('[data-plan-fs=exit]').textContent = c.exit;
    $('planChapters').setAttribute('aria-label', c.title);
    $('planChapters').replaceChildren();
    c.chapters.forEach((title,i) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.planChapter = i + 1;
      const index = document.createElement('small'); index.textContent = String(i + 1).padStart(2,'0');
      const label = document.createElement('span'); label.textContent = title; button.append(index,label);
      button.addEventListener('click', () => { setPlaying(false); setChapter(i + 1); }); $('planChapters').append(button);
    });
    document.querySelectorAll('[data-plan-lang]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.planLang === lang)));
    const link = document.querySelector('.deck-link'); link.textContent = c.deck;
    link.href = (location.hostname === 'plan.gonota.ca' ? 'https://pitch.gonota.ca/' : '/pitch-deck.html') + '?lang=' + lang;
    save('nota.lang', lang); setPlaying(false); setChapter(current); syncTheme(); syncFullscreen();
  }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); } catch { /* Fullscreen may be unavailable in embedded viewers. */ } }
  const move = delta => { setPlaying(false); setChapter(current + delta); };
  $('planPrevious').addEventListener('click', () => move(-1));
  $('planNext').addEventListener('click', () => move(1));
  $('planReplay').addEventListener('click', () => { paused = false; setChapter(current); });
  $('planMotion').addEventListener('click', () => { paused = !paused; syncMotion(); });
  $('planPlay').addEventListener('click', () => setPlaying(!playing));
  $('planFullscreen').addEventListener('click', fullscreen);
  stage.querySelectorAll('[data-plan-fs]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.planFs;
    if (action === 'prev') move(-1); if (action === 'next') move(1); if (action === 'exit') fullscreen();
    if (action === 'replay') $('planReplay').click(); if (action === 'motion') $('planMotion').click();
  }));
  document.querySelectorAll('[data-plan-lang]').forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.planLang)));
  $('theme-toggle').addEventListener('click', () => {
    const next = $('theme-toggle').getAttribute('aria-checked') === 'true' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('nota.theme', JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
    syncTheme();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  themeQuery.addEventListener('change', syncTheme); motionQuery.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); syncMotion(); });
  const chapterFromHash = () => {
    const match = location.hash.match(/^#chapter-(\d+)$/);
    if (match) return Number(match[1]);
    const old = Number(location.hash.match(/^#section-(\d+)$/)?.[1]);
    return ({1:1,2:1,3:1,4:6,5:2,6:6,7:8,8:7,9:8,10:4,11:6,12:7,13:8,14:8,15:8})[old] || 1;
  };
  addEventListener('hashchange', () => { setPlaying(false); setChapter(chapterFromHash(), false); });
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable=true],summary')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key.toLowerCase() === 'f' && !event.target.closest('button,a')) fullscreen();
  });
  let touchX = null;
  stage.addEventListener('touchstart', event => { if (!event.target.closest('button,a')) touchX = event.changedTouches[0].clientX; }, {passive:true});
  stage.addEventListener('touchend', event => { if (touchX !== null) { const delta = event.changedTouches[0].clientX - touchX; if (Math.abs(delta) > 70) move(delta < 0 ? 1 : -1); } touchX = null; }, {passive:true});
  current = chapterFromHash(); setLanguage(language);
  document.querySelector('.plan-transcript').open = matchMedia('(max-width:600px)').matches;
})();
