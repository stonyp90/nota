/* =============================================================================
   Nota web app. Vanilla, zero runtime dependencies.
   Business rules come from window.NotaDomain (@nota/domain) — never duplicated.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.NotaDomain;
  if (!D) { console.error('NotaDomain missing'); return; }

  // API base: same-origin /api in production (CloudFront routes it to Lambda);
  // the standalone dev API on :8788 in local development.
  var API_BASE =
    window.__NOTA_API__ ||
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8788'
      : '/api');

  var todayISO = function () { return new Date().toISOString().slice(0, 10); };

  // ---------------------------------------------------------------------------
  // store shim. Interface: listMonth(month) -> [bid]; createBid(payload) -> res.
  // Backing is the API when reachable, else localStorage seeded with domain
  // fixtures so the carnet is populated offline. Replacing the backing must not
  // change this interface — apps/web depends only on these two methods.
  // ---------------------------------------------------------------------------
  var LS_BIDS = 'nota.bids.v1';

  function lsLoad(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ensureSeed() {
    var a = lsLoad(LS_BIDS);
    if (!a) { a = D.makeFixtures(todayISO()); lsSave(LS_BIDS, a); }
    return a;
  }

  var store = {
    online: false,
    async listMonth(month) {
      try {
        var r = await fetch(API_BASE + '/bids?month=' + encodeURIComponent(month), {
          headers: { accept: 'application/json' },
        });
        if (r.ok) { this.online = true; var j = await r.json(); return j.bids || []; }
      } catch (e) { /* offline */ }
      this.online = false;
      return ensureSeed().filter(function (b) { return b.dateISO.slice(0, 7) === month; });
    },
    async createBid(payload) {
      var v = D.validateOffer({
        serviceId: payload.serviceId, dateISO: payload.dateISO,
        montant: payload.montant, todayISO: todayISO(),
      });
      if (!v.ok) return { ok: false, errors: v.errors };

      if (this.online) {
        try {
          var r = await fetch(API_BASE + '/bids', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          });
          var j = await r.json();
          if (r.status === 201) return { ok: true, bid: j.bid };
          return { ok: false, errors: j.errors || [{ code: 'erreur', message: 'Erreur serveur.' }] };
        } catch (e) { /* fall back to local */ }
      }
      var anonyme = payload.anonyme !== false;
      var bid = {
        id: 'loc-' + Date.now() + '-' + Math.floor(Math.random() * 1e5),
        serviceId: payload.serviceId, dateISO: payload.dateISO, montant: v.montant,
        tier: v.tier, premium: v.premium, anonyme: anonyme,
        nom: anonyme ? null : (payload.nom || null),
        prefixe: (payload.prefixe || '').toUpperCase().slice(0, 3) || null,
        status: D.STATUS.OUVERTE, etude: null, createdAt: todayISO(),
      };
      var all = ensureSeed(); all.push(bid); lsSave(LS_BIDS, all);
      return { ok: true, bid: bid };
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var state = {
    anchor: firstOfMonth(todayISO()),
    monthBids: [],
    filters: { service: '', statut: '', min: null, max: null, sort: 'montant-desc' },
    selectedDate: null,
    focusDate: todayISO(),
    tab: 'carnet',
    tts: false,
    offer: { serviceId: '', dateISO: '', montant: 0, anonyme: true },
  };

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  function firstOfMonth(iso) { return iso.slice(0, 7) + '-01'; }
  function monthKey(iso) { return iso.slice(0, 7); }
  function addMonths(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1 + n, 1)).toISOString().slice(0, 10);
  }
  function mondayIndex(iso) { return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; }
  function daysInMonth(anchor) {
    var p = anchor.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  }
  var fmtMonth = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  var fmtDayLong = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function monthTitle(anchor) { return fmtMonth.format(new Date(anchor + 'T00:00:00Z')); }
  function dayTitle(iso) { return fmtDayLong.format(new Date(iso + 'T00:00:00Z')); }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------------------
  // Text to speech (Web Speech API)
  // ---------------------------------------------------------------------------
  var ttsSupported = 'speechSynthesis' in window;
  var SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  function pickVoice() {
    if (!ttsSupported) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    return vs.find(function (v) { return v.lang === 'fr-CA'; }) ||
           vs.find(function (v) { return /^fr/.test(v.lang); }) || null;
  }
  // On-demand read-aloud. Any control with [data-speak] or [data-speak-target]
  // triggers it (see the delegated listener in wire()). No global toggle.
  function speak(text) {
    if (!ttsSupported || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-CA';
      var v = pickVoice(); if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Filtering / sorting
  // ---------------------------------------------------------------------------
  function applyFilters(bids) {
    var f = state.filters;
    var out = bids.filter(function (b) {
      if (f.service && b.serviceId !== f.service) return false;
      if (f.statut && b.status !== f.statut) return false;
      if (f.min != null && b.montant < f.min) return false;
      if (f.max != null && b.montant > f.max) return false;
      return true;
    });
    var s = f.sort;
    out.sort(function (a, b) {
      if (s === 'montant-desc') return b.montant - a.montant || a.dateISO.localeCompare(b.dateISO);
      if (s === 'montant-asc') return a.montant - b.montant || a.dateISO.localeCompare(b.dateISO);
      if (s === 'date-asc') return a.dateISO.localeCompare(b.dateISO) || b.montant - a.montant;
      return b.dateISO.localeCompare(a.dateISO) || b.montant - a.montant;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Calendar rendering
  // ---------------------------------------------------------------------------
  var DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

  function renderCalendar() {
    $('cal-title').textContent = monthTitle(state.anchor);
    var grid = $('cal-grid'); clear(grid);

    // Weekday header: a role="row" of role="columnheader" cells, so the
    // surrounding role="grid" is well-formed for assistive technology.
    var head = el('div', 'cal-row cal-dow-row');
    head.setAttribute('role', 'row');
    DOW.forEach(function (d) {
      var h = el('div', 'cal-dow', d);
      h.setAttribute('role', 'columnheader');
      head.appendChild(h);
    });
    grid.appendChild(head);

    var visible = applyFilters(state.monthBids);
    updateFilterSummary(visible.length);
    var byDay = {};
    visible.forEach(function (b) { (byDay[b.dateISO] = byDay[b.dateISO] || []).push(b); });
    var maxCount = 1;
    Object.keys(byDay).forEach(function (k) { maxCount = Math.max(maxCount, byDay[k].length); });

    var lead = mondayIndex(state.anchor);
    var dim = daysInMonth(state.anchor);
    var today = todayISO();

    // Each week is its own role="row" of exactly 7 cells. Leading/trailing
    // blanks are empty gridcells so every row stays a full 7 columns.
    var week = null;
    function openRow() { week = el('div', 'cal-row'); week.setAttribute('role', 'row'); grid.appendChild(week); }
    function blank() { var b = el('div', 'cal-cell is-out'); b.setAttribute('role', 'gridcell'); week.appendChild(b); }
    var slot = 0;
    openRow();
    for (var i = 0; i < lead; i++) { blank(); slot++; }

    for (var day = 1; day <= dim; day++) {
      if (slot > 0 && slot % 7 === 0) openRow();
      var iso = state.anchor.slice(0, 8) + String(day).padStart(2, '0');
      var cell = el('button', 'cal-cell');
      cell.type = 'button';
      cell.setAttribute('role', 'gridcell');
      cell.dataset.date = iso;
      cell.tabIndex = iso === state.focusDate ? 0 : -1;
      cell.setAttribute('aria-label', dayTitle(iso));
      if (iso === today) cell.classList.add('is-today');
      if (iso === state.selectedDate) cell.classList.add('is-selected');

      cell.appendChild(el('span', 'cal-daynum', String(day)));

      // Cells stay essential: count + the single headline figure. All the
      // detail lives in the day modal (click / Enter). The aria-label carries
      // the same summary sighted users read from the badge and figure.
      var dayBids = byDay[iso] || [];
      if (dayBids.length) {
        cell.classList.add('has-bids');
        cell.appendChild(el('span', 'cal-count', String(dayBids.length)));

        var n = dayBids.length;
        var plural = n > 1 ? 's' : '';
        var open = dayBids.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
        if (open.length) {
          var top = Math.max.apply(null, open.map(function (b) { return b.montant; }));
          cell.appendChild(el('span', 'cal-top', D.money(top)));
          cell.setAttribute('aria-label', dayTitle(iso) + ', ' + n + ' offre' + plural + ', meilleure ' + D.money(top));
        } else {
          // Everything taken: show what cleared, struck through — more useful to
          // the next bidder than an em-dash.
          var cleared = Math.max.apply(null, dayBids.map(function (b) { return b.montant; }));
          cell.appendChild(el('span', 'cal-top is-cleared', D.money(cleared)));
          cell.setAttribute('aria-label', dayTitle(iso) + ', ' + n + ' offre' + plural + ' retenue' + plural + ', ' + D.money(cleared) + ' obtenu');
        }

        var dens = el('div', 'cal-density');
        dens.style.opacity = String(0.18 + 0.6 * (dayBids.length / maxCount));
        cell.appendChild(dens);
      }

      cell.addEventListener('click', function () { openDay(this.dataset.date); });
      week.appendChild(cell);
      slot++;
    }

    // Pad the final week so it, too, holds a full 7 columns.
    while (slot % 7 !== 0) { blank(); slot++; }
  }

  function renderLegend() {
    var lg = $('legend'); clear(lg);
    D.TIERS.forEach(function (t) {
      var item = el('span', 'legend-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--tier-' + t.id + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(t.nom));
      lg.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Agenda rendering
  // ---------------------------------------------------------------------------
  function renderAgenda() {
    var ag = $('agenda'); clear(ag);
    var visible = applyFilters(state.monthBids);
    if (state.selectedDate) visible = visible.filter(function (b) { return b.dateISO === state.selectedDate; });

    if (!visible.length) {
      ag.appendChild(el('div', 'agenda-day', state.selectedDate
        ? 'Aucune offre le ' + dayTitle(state.selectedDate) + '.'
        : 'Aucune offre pour ce filtre.'));
      return;
    }

    // Group by day (agenda always reads chronologically within the current sort's day order)
    var order = [];
    var groups = {};
    visible.forEach(function (b) { if (!groups[b.dateISO]) { groups[b.dateISO] = []; order.push(b.dateISO); } groups[b.dateISO].push(b); });
    if (state.filters.sort.indexOf('date') === 0) order.sort(state.filters.sort === 'date-asc' ? undefined : function (a, b) { return b.localeCompare(a); });
    else order.sort();

    order.forEach(function (iso) {
      ag.appendChild(el('div', 'agenda-day', dayTitle(iso)));
      groups[iso]
        .sort(function (a, b) { return b.montant - a.montant; })
        .forEach(function (b) { ag.appendChild(bidRow(b)); });
    });
  }

  function bidRow(b) {
    var row = el('div', 'bid-row' + (b.status === D.STATUS.RETENUE ? ' is-retenue' : ''));
    row.appendChild(el('span', 'bid-amount', D.money(b.montant)));

    var meta = el('div', 'bid-meta');
    var who = el('div', 'bid-who');
    who.textContent = D.bidLabel(b);
    if (b.anonyme) { var tag = el('span', 'tag-anon', 'anonyme'); tag.style.marginLeft = '6px'; who.appendChild(tag); }
    meta.appendChild(who);

    var svc = D.serviceById(b.serviceId);
    var rk = D.rankOf(b, state.monthBids);
    var sub = svc ? svc.nom : b.serviceId;
    if (rk.rang && rk.total > 1) sub += ' · ' + rk.rang + 'e sur ' + rk.total;
    if (b.status === D.STATUS.RETENUE && b.etude) sub += ' · retenue par ' + b.etude;
    meta.appendChild(el('div', 'bid-sub', sub));
    row.appendChild(meta);

    if (b.status === D.STATUS.RETENUE) {
      row.appendChild(el('span', 'pill pill-retenue', 'retenue'));
    } else {
      var pill = el('span', 'pill', D.tierById(b.tier ? b.tier : 'standard').nom);
      pill.dataset.tier = b.tier || 'standard';
      row.appendChild(pill);
    }
    return row;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  function selectDate(iso) {
    state.selectedDate = state.selectedDate === iso ? null : iso;
    state.focusDate = iso;
    if (state.selectedDate) {
      // Prefill the offer form's date with the clicked day.
      $('o-date').value = iso; onOfferDateChange();
    }
    writeHash();
    renderCalendar(); renderAgenda();
    var c = document.querySelector('.cal-cell[data-date="' + iso + '"]');
    if (c) c.focus();
  }

  // Enlarged day view: click/Enter a cell to see every offer for that day over
  // a dimmed backdrop. Cells stay minimal; all detail lives here.
  function openDay(iso) {
    state.focusDate = iso;
    state.selectedDate = iso;
    var all = state.monthBids.filter(function (b) { return b.dateISO === iso; });
    var f = state.filters;
    var shown = all.filter(function (b) {
      if (f.service && b.serviceId !== f.service) return false;
      if (f.statut && b.status !== f.statut) return false;
      return true;
    }).sort(function (a, b) { return b.montant - a.montant; });

    $('day-title').textContent = dayTitle(iso);
    var days = D.daysBetween(todayISO(), iso);
    var when = days < 0 ? 'passé' : days === 0 ? 'aujourd’hui' : 'dans ' + days + ' jour' + (days > 1 ? 's' : '');
    $('day-sub').textContent = shown.length
      ? shown.length + ' offre' + (shown.length > 1 ? 's' : '') + ' · ' + when
      : 'Aucune offre · ' + when + ' · soyez le premier';

    var list = $('day-bids'); clear(list);
    shown.forEach(function (b) { list.appendChild(bidRow(b)); });

    var open = shown.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    $('day-best').textContent = open.length
      ? D.money(Math.max.apply(null, open.map(function (b) { return b.montant; })))
      : '—';

    renderCalendar();
    var dlg = $('day-dialog');
    if (dlg.showModal && !dlg.open) dlg.showModal();
  }

  function offerForDay() {
    var iso = state.selectedDate || state.focusDate;
    $('day-dialog').close();
    setTab('carnet', { scroll: false });
    if (D.serviceById(state.filters.service)) $('o-service').value = state.filters.service;
    onOfferServiceChange();
    $('o-date').value = iso; onOfferDateChange();
    var amt = $('o-amount'); if (!amt.disabled) amt.focus();
    amt.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation (roving tabindex on the grid)
  // ---------------------------------------------------------------------------
  function onGridKey(e) {
    var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(map[e.key]);
    } else if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'Home') { e.preventDefault(); state.focusDate = todayISO(); state.anchor = firstOfMonth(state.focusDate); refreshMonth(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(state.focusDate); }
    else if (e.key === 'Escape') { e.preventDefault(); resetFilters(); }
  }
  function moveFocus(delta) {
    var next = D.addDays(state.focusDate, delta);
    if (monthKey(next) !== monthKey(state.anchor)) { state.anchor = firstOfMonth(next); }
    state.focusDate = next;
    refreshMonth();
    var c = document.querySelector('.cal-cell[data-date="' + next + '"]');
    if (c) c.focus();
  }
  function step(months) {
    state.anchor = addMonths(state.anchor, months);
    state.focusDate = state.anchor;
    refreshMonth();
  }

  // ---------------------------------------------------------------------------
  // Filters UI <-> URL hash
  // ---------------------------------------------------------------------------
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.has('svc')) state.filters.service = h.get('svc');
    if (h.has('statut')) state.filters.statut = h.get('statut');
    if (h.has('min')) state.filters.min = num(h.get('min'));
    if (h.has('max')) state.filters.max = num(h.get('max'));
    if (h.has('tri')) state.filters.sort = h.get('tri');
    if (h.has('jour')) { state.selectedDate = h.get('jour'); state.focusDate = h.get('jour'); state.anchor = firstOfMonth(h.get('jour')); }
  }
  function writeHash() {
    var h = new URLSearchParams();
    var f = state.filters;
    if (f.service) h.set('svc', f.service);
    if (f.statut) h.set('statut', f.statut);
    if (f.min != null) h.set('min', f.min);
    if (f.max != null) h.set('max', f.max);
    if (f.sort && f.sort !== 'montant-desc') h.set('tri', f.sort);
    if (state.selectedDate) h.set('jour', state.selectedDate);
    var s = h.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname);
  }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }

  function setGroupActive(group, btn) {
    group.querySelectorAll('.chip, .seg-btn').forEach(function (x) {
      var on = x === btn;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setGroupVal(groupId, attr, val) {
    var g = $(groupId); if (!g) return;
    g.querySelectorAll('[data-' + attr + ']').forEach(function (x) {
      var on = (x.dataset[attr] || '') === (val || '');
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function syncFilterChips() {
    setGroupVal('chips-service', 'svc', state.filters.service || '');
    setGroupVal('seg-statut', 'statut', state.filters.statut || '');
    setGroupVal('chips-montant', 'min', state.filters.min == null ? '' : String(state.filters.min));
    setGroupVal('seg-sort', 'sort', state.filters.sort || 'montant-desc');
  }
  function afterFilterChange() { writeHash(); renderCalendar(); renderAgenda(); }
  function filtersActive() {
    var f = state.filters;
    return !!(f.service || f.statut || f.min != null || f.max != null || (f.sort && f.sort !== 'montant-desc'));
  }
  function updateFilterSummary(count) {
    var rc = $('result-count');
    if (rc) rc.textContent = count + ' offre' + (count === 1 ? '' : 's') + ' ce mois';
    var rb = $('filters-reset');
    if (rb) rb.hidden = !filtersActive();
  }
  function resetFilters() {
    state.filters = { service: '', statut: '', min: null, max: null, sort: 'montant-desc' };
    state.selectedDate = null;
    syncFilterChips(); writeHash();
    renderCalendar(); renderAgenda();
    toast('Filtres réinitialisés.');
  }

  // ---------------------------------------------------------------------------
  // Offer form
  // ---------------------------------------------------------------------------
  function populateServiceSelects() {
    ['o-service', 'd-service'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      D.SERVICES.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.nom + ' — ' + D.money(s.prixDepart);
        sel.appendChild(o);
      });
    });
  }

  function buildServiceChips() {
    var wrap = $('chips-service'); if (!wrap) return; clear(wrap);
    var all = el('button', 'chip is-on', 'Tous');
    all.type = 'button'; all.dataset.svc = ''; all.setAttribute('aria-pressed', 'true');
    wrap.appendChild(all);
    D.SERVICES.forEach(function (s) {
      var b = el('button', 'chip', s.nom.split(' ')[0]);
      b.type = 'button'; b.dataset.svc = s.id; b.setAttribute('aria-pressed', 'false');
      wrap.appendChild(b);
    });
  }

  function onOfferServiceChange() {
    var svc = D.serviceById($('o-service').value);
    state.offer.serviceId = svc ? svc.id : '';
    $('o-service-help').textContent = svc ? svc.description : '';
    var amt = $('o-amount');
    if (svc) {
      amt.min = svc.prixDepart; amt.max = svc.prixDepart * D.PREMIUM_CAP; amt.step = 5;
      amt.value = svc.prixDepart; amt.disabled = false;
    } else { amt.disabled = true; amt.value = 0; }
    onAmountChange();
  }

  function onOfferDateChange() {
    var date = $('o-date').value;
    state.offer.dateISO = date;
    var tp = $('tier-preview');
    if (D.isISODate(date)) {
      var days = D.daysBetween(todayISO(), date);
      var tierId = D.tierForDays(Math.max(0, days));
      var t = D.tierById(tierId);
      tp.hidden = false;
      var pill = $('tp-pill'); pill.textContent = t.nom; pill.dataset.tier = t.id;
      var when = days <= 0 ? 'aujourd’hui' : ('dans ' + days + ' jour' + (days > 1 ? 's' : ''));
      $('tp-text').textContent = 'Signature ' + when + ' · le marché se conclut ici entre ' +
        t.apercuMin.toFixed(1) + '× et ' + t.apercuMax.toFixed(1) + '×.';
    } else { tp.hidden = true; }
    onAmountChange();
  }

  function onAmountChange() {
    var svc = D.serviceById(state.offer.serviceId);
    var amt = Number($('o-amount').value);
    state.offer.montant = amt;
    $('o-amount-display').textContent = svc ? D.money(amt) : '—';

    if (svc && amt) {
      // Screen readers otherwise announce the raw slider number (e.g. "2000");
      // aria-valuetext gives the formatted amount ("2 000 $").
      $('o-amount').setAttribute('aria-valuetext', D.money(amt));
      var mult = amt / svc.prixDepart;
      $('o-mult').textContent = mult.toFixed(2) + '× le prix de départ (' + D.money(svc.prixDepart) + ')';
      if (D.isISODate(state.offer.dateISO)) {
        var tierId = D.tierForDays(Math.max(0, D.daysBetween(todayISO(), state.offer.dateISO)));
        var g = acceptance(mult, tierId);
        $('gauge-fill').style.width = g.pct + '%';
        $('gauge-label').textContent = g.label;
      } else {
        $('gauge-fill').style.width = '0%';
        $('gauge-label').textContent = 'Choisissez d’abord une date.';
      }
    } else {
      $('o-amount').removeAttribute('aria-valuetext');
      $('o-mult').textContent = '—';
      $('gauge-fill').style.width = '0%';
      $('gauge-label').textContent = 'Choisissez une date et un montant.';
    }
    validateOfferUI();
  }

  function acceptance(mult, tierId) {
    var t = D.tierById(tierId) || D.tierById('standard');
    var top = t.apercuMax * 1.25;
    var pct = Math.max(4, Math.min(100, ((mult - 1) / (top - 1)) * 100));
    var label;
    if (mult < t.apercuMin) label = 'Sous la fourchette du marché — peu susceptible d’être retenue.';
    else if (mult <= t.apercuMax) label = 'Dans la fourchette qui se conclut à ce délai.';
    else label = 'Offre généreuse — susceptible d’être retenue rapidement.';
    return { pct: pct, label: label };
  }

  function validateOfferUI() {
    var o = state.offer;
    var courriel = ($('o-courriel') && $('o-courriel').value || '').trim();
    var v = D.validateOffer({ serviceId: o.serviceId, dateISO: o.dateISO, montant: o.montant, courriel: courriel, todayISO: todayISO() });
    $('offer-submit').disabled = !v.ok;
    return v;
  }

  function onAnonToggle() {
    var anon = $('o-anon').checked;
    if (!anon) {
      // Going public is a deliberate act — confirm first.
      var dlg = $('reveal-dialog');
      if (dlg.showModal) {
        dlg.showModal();
      } else { commitAnon(false); }
      return;
    }
    commitAnon(true);
  }
  function commitAnon(anon) {
    state.offer.anonyme = anon;
    $('o-anon').checked = anon;
    // role="switch" overrides the native checkbox role, so aria-checked must be
    // kept in sync by hand (WCAG 4.1.2).
    $('o-anon').setAttribute('aria-checked', anon ? 'true' : 'false');
    $('name-row').hidden = anon;
    $('anon-help').textContent = anon
      ? 'Affichée comme « Client · secteur postal ».'
      : 'Votre nom sera visible publiquement sur le carnet.';
  }

  async function onOfferSubmit(e) {
    e.preventDefault();
    var o = state.offer;
    var payload = {
      serviceId: o.serviceId, dateISO: o.dateISO, montant: o.montant,
      anonyme: o.anonyme,
      nom: o.anonyme ? null : ($('o-name').value || '').trim(),
      prefixe: ($('o-prefix').value || '').trim().toUpperCase().slice(0, 3),
      // Private: used only for notifications, never shown on the carnet.
      courriel: ($('o-courriel').value || '').trim(),
    };
    // Attach the structured dossier snapshot the client assembled for THIS
    // service (field values + document filenames + consent), so an accepting
    // notary sees real data. Stored privately by the API; never in publicBid().
    // The files themselves are not sent here — only the values already saved.
    var snapshot = dossierFor(o.serviceId);
    if (snapshot && Object.keys(snapshot).length) payload.dossier = snapshot;
    var res = await store.createBid(payload);
    var errBox = $('offer-errors');
    if (!res.ok) {
      clear(errBox); errBox.hidden = false;
      res.errors.forEach(function (er) { errBox.appendChild(el('li', null, er.message)); });
      return;
    }
    errBox.hidden = true;
    toast('Offre publiée : ' + D.money(payload.montant) + (store.online ? '' : ' (démo locale)'));
    buildCalendarLinks(res.bid);
    $('offer-success').hidden = false;
    state.selectedDate = payload.dateISO;
    await refreshMonthData();
    renderCalendar(); renderAgenda();
  }

  // ---------------------------------------------------------------------------
  // Calendar deeplinks (.ics + Google + Outlook), all-day event
  // ---------------------------------------------------------------------------
  function buildCalendarLinks(bid) {
    var svc = D.serviceById(bid.serviceId);
    var title = 'Signature notariée — ' + (svc ? svc.nom : bid.serviceId);
    var startCompact = bid.dateISO.replace(/-/g, '');
    var endCompact = D.addDays(bid.dateISO, 1).replace(/-/g, '');
    var details = 'Offre publiée sur Nota : ' + D.money(bid.montant) + '.';

    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nota//FR-CA//',
      'BEGIN:VEVENT', 'UID:' + bid.id + '@nota',
      'DTSTART;VALUE=DATE:' + startCompact, 'DTEND;VALUE=DATE:' + endCompact,
      'SUMMARY:' + title, 'DESCRIPTION:' + details, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    $('ics-link').href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);

    $('gcal-link').href = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) +
      '&dates=' + startCompact + '/' + endCompact +
      '&details=' + encodeURIComponent(details);

    $('outlook-link').href = 'https://outlook.live.com/calendar/0/deeplink/compose?subject=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(details) +
      '&startdt=' + bid.dateISO + '&enddt=' + D.addDays(bid.dateISO, 1) + '&allday=true';
  }

  // ---------------------------------------------------------------------------
  // Dossier (document intake)
  // ---------------------------------------------------------------------------
  var LS_DOSSIER = 'nota.dossier.v1';
  function dossierState() { return lsLoad(LS_DOSSIER) || {}; }
  function dossierFor(sid) { var d = dossierState(); return d[sid] || {}; }
  function dossierSet(sid, key, val) {
    var d = dossierState(); d[sid] = d[sid] || {};
    if (val) d[sid][key] = val; else delete d[sid][key];
    lsSave(LS_DOSSIER, d);
  }
  function dossierItems(svc) {
    var items = [];
    svc.documents.forEach(function (x) { items.push({ kind: 'doc', id: x.id, nom: x.nom, aide: x.aide }); });
    svc.champs.forEach(function (x) { items.push({ kind: 'field', id: x.id, nom: x.label, aide: x.aide }); });
    return items;
  }

  function renderDossier() {
    var svc = D.serviceById($('d-service').value) || D.SERVICES[0];
    $('d-service').value = svc.id;
    var list = $('dossier-list'); clear(list);
    var saved = dossierFor(svc.id);

    dossierItems(svc).forEach(function (it) {
      var row = el('div', 'dossier-item');

      var check = el('div', 'dossier-check', '✓');
      check.dataset.on = saved[it.id] ? 'true' : 'false';

      var body = el('div', 'dossier-body');
      body.appendChild(el('div', 'dossier-name', it.nom));
      body.appendChild(el('div', 'help', it.aide));

      var input;
      if (it.kind === 'doc') {
        input = document.createElement('input'); input.type = 'file';
        input.addEventListener('change', function () {
          var name = this.files && this.files[0] ? this.files[0].name : '';
          dossierSet(svc.id, it.id, name);
          check.dataset.on = name ? 'true' : 'false';
          updateDossierBar();
        });
        body.appendChild(input);
        if (saved[it.id]) { var fn = el('div', 'file-note', 'Sélectionné : ' + saved[it.id] + ' — le fichier reste sur votre appareil à cette étape.'); body.appendChild(fn); }
      } else {
        input = document.createElement('input'); input.type = 'text';
        input.value = saved[it.id] || '';
        input.placeholder = 'Votre réponse';
        input.addEventListener('input', function () {
          dossierSet(svc.id, it.id, this.value.trim());
          check.dataset.on = this.value.trim() ? 'true' : 'false';
          updateDossierBar();
        });
        body.appendChild(input);
      }
      // Dynamically generated inputs carry no <label>, so name them explicitly.
      input.setAttribute('aria-label', it.nom);
      var read = el('button', 'read-btn');
      read.innerHTML = SPEAKER_SVG;
      read.type = 'button';
      read.title = 'Lire à voix haute';
      read.setAttribute('aria-label', 'Lire : ' + it.nom);
      read.addEventListener('click', function () { speak(it.nom + '. ' + it.aide); });

      row.appendChild(check); row.appendChild(body); row.appendChild(read);
      list.appendChild(row);
    });

    // Consent to share the completed dossier with the retained notary (Law 25).
    // Required before a lead is "sellable"; the notary verifies identity at signing.
    var savedC = dossierFor(svc.id);
    var crow = el('div', 'dossier-item dossier-consent');
    var ccheck = el('div', 'dossier-check', '✓'); ccheck.dataset.on = savedC.__consent ? 'true' : 'false';
    var cbody = el('div', 'dossier-body');
    cbody.appendChild(el('div', 'dossier-name', 'Consentement de partage'));
    cbody.appendChild(el('div', 'help', 'Le notaire qui retient votre demande vérifiera votre identité à la signature. Rien n’est transmis avant.'));
    var clabel = el('label', 'consent-toggle');
    var cinput = document.createElement('input'); cinput.type = 'checkbox'; cinput.checked = !!savedC.__consent;
    cinput.setAttribute('aria-label', 'J’autorise le partage de mon dossier avec le notaire retenu.');
    cinput.addEventListener('change', function () {
      dossierSet(svc.id, '__consent', this.checked ? '1' : '');
      ccheck.dataset.on = this.checked ? 'true' : 'false';
      updateDossierBar();
    });
    clabel.appendChild(cinput);
    clabel.appendChild(document.createTextNode(' J’autorise le partage de mon dossier avec le notaire retenu.'));
    cbody.appendChild(clabel);
    crow.appendChild(ccheck); crow.appendChild(cbody);
    list.appendChild(crow);

    updateDossierBar();
  }

  // Update only the progress DOM — never re-render the list, which would steal
  // focus from the field being typed in.
  function updateDossierBar() {
    var svc = D.serviceById($('d-service').value) || D.SERVICES[0];
    var items = dossierItems(svc);
    var saved = dossierFor(svc.id);
    var done = items.filter(function (it) { return saved[it.id]; }).length;
    var total = items.length;
    var r = D.leadReadiness(svc.id, saved);
    $('dossier-count').textContent = done + ' / ' + total;
    $('dossier-fill').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';

    var m = $('dossier-missing');
    if (r.ready) {
      m.textContent = '✓ Prêt à être retenu par un notaire — votre identité sera vérifiée à la signature.';
      m.dataset.ready = 'true';
    } else {
      var parts = [];
      if (r.missing.length) parts.push('à compléter : ' + r.missing.join(', '));
      if (!r.consent) parts.push('consentement de partage requis');
      m.textContent = parts.join(' · ') + '.';
      m.dataset.ready = 'false';
    }

    var badge = $('dossier-badge');
    badge.hidden = false;
    badge.textContent = done + '/' + total;
    badge.dataset.complete = r.ready ? 'true' : 'false';
  }

  function readAllDossier() {
    var svc = D.serviceById($('d-service').value) || D.SERVICES[0];
    var text = 'Dossier pour ' + svc.nom + '. ' +
      dossierItems(svc).map(function (it) { return it.nom + '. ' + it.aide; }).join(' ');
    speak(text);
  }

  // ---------------------------------------------------------------------------
  // Notary form
  // ---------------------------------------------------------------------------
  function onNotarySubmit(e) {
    e.preventDefault();
    var errs = [];
    var name = $('n-name').value.trim();
    var etude = $('n-etude').value.trim();
    var email = $('n-email').value.trim();
    if (!name) errs.push('Le nom est requis.');
    if (!etude) errs.push('L’étude est requise.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.push('Courriel invalide.');
    var box = $('notary-errors');
    if (errs.length) { clear(box); box.hidden = false; errs.forEach(function (m) { box.appendChild(el('li', null, m)); }); return; }
    box.hidden = true;
    var list = lsLoad('nota.notaires') || [];
    list.push({ name: name, etude: etude, email: email, at: todayISO() });
    lsSave('nota.notaires', list);
    $('notary-form').reset();
    toast('Merci. Nous vous écrirons à ' + email + '.');
  }

  // ---------------------------------------------------------------------------
  // Notary console (consumes /notary/* API). Token lives in localStorage; every
  // call handles 401/403/409 gracefully via toasts. Retained dossiers are kept
  // per-email so a reload restores the "Dossiers retenus" section. Never runs a
  // fetch on boot unless a token is already stored (ncRestore).
  // ---------------------------------------------------------------------------
  var LS_NC_TOKEN = 'nota.notary.token';
  var LS_NC_FEED_TOKEN = 'nota.notary.feedtoken';
  var LS_NC_EMAIL = 'nota.notary.email';
  var LS_NC_RETAINED = 'nota.notary.retained.v1';

  // token   -> SESSION scope, sent in the Authorization header (never a URL).
  // feedToken -> FEED scope (read-only), the only token placed in the webcal URL.
  var nc = { token: null, feedToken: null, email: null, open: [] };

  function ncRetainedAll() { return lsLoad(LS_NC_RETAINED) || {}; }
  function ncRetainedFor(email) { var a = ncRetainedAll(); return a[email] || []; }
  function ncRetainedSave(email, list) { var a = ncRetainedAll(); a[email] = list; lsSave(LS_NC_RETAINED, a); }
  function ncRetainedAdd(email, entry) {
    var list = ncRetainedFor(email).filter(function (e) { return e.id !== entry.id; });
    list.push(entry); ncRetainedSave(email, list);
  }

  // Build the webcal:// subscription URL from the API base. A relative '/api'
  // base is resolved against the current origin first, then the scheme swapped.
  // `token` must be the read-only FEED token — never the session token.
  function ncFeedUrl(token) {
    var base = API_BASE;
    if (base.indexOf('http') !== 0) base = location.origin + base;
    var httpUrl = base + '/notary/feed.ics?token=' + encodeURIComponent(token);
    return httpUrl.replace(/^https?:\/\//, 'webcal://');
  }

  function ncSetErrors(msgs) {
    var box = $('notary-console-errors'); if (!box) return;
    clear(box);
    if (!msgs || !msgs.length) { box.hidden = true; return; }
    box.hidden = false;
    msgs.forEach(function (m) { box.appendChild(el('li', null, m)); });
  }

  // 401 -> the token is dead: drop it and return to the sign-in gate.
  function ncExpire(msg) {
    nc.token = null; nc.feedToken = null; nc.email = null; nc.open = [];
    try {
      localStorage.removeItem(LS_NC_TOKEN);
      localStorage.removeItem(LS_NC_FEED_TOKEN);
      localStorage.removeItem(LS_NC_EMAIL);
    } catch (e) {}
    ncRenderAuthState();
    if (msg) toast(msg);
  }

  async function ncSignIn(email) {
    email = (email || '').trim();
    var r;
    try {
      r = await fetch(API_BASE + '/notary/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
    } catch (e) { ncSetErrors(['Console indisponible hors ligne. Réessayez une fois en ligne.']); return { ok: false }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      ncSetErrors((j.errors || [{ message: 'Connexion refusée.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    ncSetErrors([]);
    nc.token = j.token; nc.feedToken = j.feedToken || null; nc.email = email;
    lsSave(LS_NC_TOKEN, j.token); lsSave(LS_NC_FEED_TOKEN, nc.feedToken); lsSave(LS_NC_EMAIL, email);
    ncRenderAuthState();
    await ncLoadBids();
    toast('Console ouverte pour ' + email + '.');
    return { ok: true };
  }

  async function ncLoadBids() {
    if (!nc.token) return;
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids', {
        headers: { accept: 'application/json', authorization: 'Bearer ' + nc.token },
      });
    } catch (e) { toast('Impossible de charger les demandes (hors ligne).'); return; }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    nc.open = j.bids || [];
    ncRenderOpen();
  }

  async function ncAccept(id, dateISO, bidMeta) {
    if (!nc.token) return;
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify({ id: id, dateISO: dateISO }),
      });
    } catch (e) { toast('Action impossible (hors ligne).'); return; }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 409) { toast('Cette offre a déjà été retenue par un autre notaire.'); ncDropOpen(id); ncRenderOpen(); return; }
    if (r.status === 404) { toast('Offre introuvable — elle a peut-être expiré.'); ncDropOpen(id); ncRenderOpen(); return; }
    if (r.status !== 200) { toast('Échec de la prise en charge.'); return; }
    var entry = {
      id: j.id, dateISO: dateISO, serviceId: bidMeta.serviceId, montant: bidMeta.montant,
      tier: bidMeta.tier, prefixe: bidMeta.prefixe || null,
      courriel: j.courriel || null, dossier: j.dossier || null,
    };
    ncRetainedAdd(nc.email, entry);
    ncDropOpen(id);
    ncRenderOpen(); ncRenderRetained();
    toast('Demande retenue. Dossier du client débloqué.');
  }

  async function ncDecline(id, dateISO) {
    if (!nc.token) return;
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids/decline', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify({ id: id, dateISO: dateISO }),
      });
    } catch (e) { toast('Action impossible (hors ligne).'); return; }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    if (r.status !== 200) { toast('Échec du refus.'); return; }
    ncDropOpen(id);
    ncRenderOpen();
    toast('Demande déclinée.');
  }

  function ncDropOpen(id) { nc.open = nc.open.filter(function (b) { return b.id !== id; }); }

  function ncRenderAuthState() {
    var authed = !!nc.token;
    var form = $('notary-auth-form'); var view = $('notary-authed');
    if (form) form.hidden = authed;
    if (view) view.hidden = !authed;
    if (authed) {
      var lbl = $('notary-email-label'); if (lbl) lbl.textContent = nc.email || '';
      // The webcal URL carries ONLY the read-only feed token, never the session
      // token — a leaked calendar URL must not authorize accept/dossier.
      var wc = $('notary-webcal');
      if (wc) { if (nc.feedToken) { wc.href = ncFeedUrl(nc.feedToken); wc.hidden = false; } else { wc.hidden = true; } }
      ncRenderRetained();
    }
  }

  function ncReadyBadge(ready) {
    var b = el('span', 'nc-ready', ready ? 'Dossier complet' : 'Dossier incomplet');
    b.dataset.ready = ready ? 'true' : 'false';
    return b;
  }
  function ncTierPill(tier) {
    var t = D.tierById(tier || 'standard') || D.tierById('standard');
    var pill = el('span', 'pill', t.nom); pill.dataset.tier = t.id || 'standard';
    return pill;
  }

  function ncOpenCard(b) {
    var svc = D.serviceById(b.serviceId);
    var card = el('div', 'nc-card'); card.dataset.id = b.id;

    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', svc ? svc.nom : b.serviceId));
    head.appendChild(el('div', 'nc-card-amount', D.money(b.montant)));
    card.appendChild(head);

    var meta = el('div', 'nc-card-meta');
    meta.appendChild(el('span', 'nc-date', dayTitle(b.dateISO)));
    if (b.prefixe) meta.appendChild(el('span', 'nc-prefixe', b.prefixe));
    meta.appendChild(ncTierPill(b.tier));
    meta.appendChild(ncReadyBadge(b.ready));
    card.appendChild(meta);

    var actions = el('div', 'nc-card-actions');
    var acc = el('button', 'btn btn-sm btn-primary nc-accept', 'Accepter'); acc.type = 'button';
    var dec = el('button', 'btn btn-sm nc-decline', 'Décliner'); dec.type = 'button';
    actions.appendChild(acc); actions.appendChild(dec);
    card.appendChild(actions);
    return card;
  }

  function ncRenderOpen() {
    var list = $('notary-open-list'); if (!list) return; clear(list);
    var empty = $('notary-open-empty');
    if (!nc.open.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    nc.open.forEach(function (b) { list.appendChild(ncOpenCard(b)); });
  }

  function ncDossierBlock(entry) {
    var wrap = el('div', 'nc-dossier');
    wrap.appendChild(el('div', 'nc-dossier-h', 'Dossier du client'));
    var svc = D.serviceById(entry.serviceId);
    var rows = el('dl', 'nc-kv');
    function kv(k, v) { rows.appendChild(el('dt', null, k)); rows.appendChild(el('dd', null, v)); }
    kv('Courriel', entry.courriel || '—');
    var d = entry.dossier || {};
    if (svc) {
      svc.champs.forEach(function (c) { if (d[c.id]) kv(c.label, String(d[c.id])); });
      svc.documents.forEach(function (doc) { if (d[doc.id]) kv(doc.nom, String(d[doc.id]) + ' · transmis à la signature'); });
    }
    kv('Consentement de partage', d.__consent ? 'Oui' : 'Non');
    wrap.appendChild(rows);
    return wrap;
  }

  function ncRetainedCard(entry) {
    var svc = D.serviceById(entry.serviceId);
    var card = el('div', 'nc-card is-retained'); card.dataset.id = entry.id;
    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', svc ? svc.nom : entry.serviceId));
    head.appendChild(el('div', 'nc-card-amount', D.money(entry.montant)));
    card.appendChild(head);
    var meta = el('div', 'nc-card-meta');
    meta.appendChild(el('span', 'nc-date', dayTitle(entry.dateISO)));
    if (entry.prefixe) meta.appendChild(el('span', 'nc-prefixe', entry.prefixe));
    meta.appendChild(ncTierPill(entry.tier));
    meta.appendChild(el('span', 'pill pill-retenue', 'retenue'));
    card.appendChild(meta);
    card.appendChild(ncDossierBlock(entry));
    return card;
  }

  function ncRenderRetained() {
    var list = $('notary-retained-list'); if (!list) return; clear(list);
    var empty = $('notary-retained-empty');
    var items = nc.email ? ncRetainedFor(nc.email) : [];
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.slice().sort(function (a, b) { return a.dateISO.localeCompare(b.dateISO); })
      .forEach(function (e) { list.appendChild(ncRetainedCard(e)); });
  }

  function ncSignOut() { ncExpire('Déconnecté.'); }

  function ncRestore() {
    var tok = lsLoad(LS_NC_TOKEN); var feed = lsLoad(LS_NC_FEED_TOKEN); var em = lsLoad(LS_NC_EMAIL);
    if (typeof tok === 'string' && typeof em === 'string') {
      nc.token = tok; nc.feedToken = typeof feed === 'string' ? feed : null; nc.email = em;
      ncRenderAuthState();
      ncLoadBids();
    } else {
      ncRenderAuthState();
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function setTab(tab, opts) {
    opts = opts || {};
    state.tab = tab;
    document.querySelectorAll('.nav-tab').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    ['carnet', 'dossier', 'notaires', 'confidentialite'].forEach(function (t) {
      var pane = $('pane-' + t);
      var active = t === tab;
      pane.classList.toggle('is-active', active);
      pane.hidden = !active;
    });
    if (tab === 'dossier') renderDossier();
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    lsSave('nota.theme', theme);
  }

  // ---------------------------------------------------------------------------
  // Data refresh
  // ---------------------------------------------------------------------------
  async function refreshMonthData() {
    state.monthBids = await store.listMonth(monthKey(state.anchor));
  }
  function refreshMonth() { renderCalendar(); renderAgenda(); }
  async function reloadAndRender() { await refreshMonthData(); refreshMonth(); }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function wire() {
    // Tabs
    document.querySelectorAll('.nav-tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(this.dataset.tab); });
    });
    $('theme-toggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
    // Read-aloud: any [data-speak] / [data-speak-target] control speaks on click.
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-speak], [data-speak-target]');
      if (!b) return;
      var text = b.getAttribute('data-speak');
      if (!text && b.dataset.speakTarget) {
        var t = $(b.dataset.speakTarget);
        text = t ? (t.innerText || t.textContent) : '';
      }
      if (text) speak(text.trim());
    });

    // Calendar
    $('cal-prev').addEventListener('click', function () { step(-1); });
    $('cal-next').addEventListener('click', function () { step(1); });
    $('cal-today').addEventListener('click', function () { state.anchor = firstOfMonth(todayISO()); state.focusDate = todayISO(); reloadAndRender(); });
    $('cal-grid').addEventListener('keydown', onGridKey);

    // Filters — chip + segmented groups, single-select each
    $('chips-service').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; setGroupActive(this, b); state.filters.service = b.dataset.svc; afterFilterChange(); });
    $('chips-montant').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; setGroupActive(this, b); state.filters.min = b.dataset.min ? Number(b.dataset.min) : null; afterFilterChange(); });
    $('seg-statut').addEventListener('click', function (e) { var b = e.target.closest('.seg-btn'); if (!b) return; setGroupActive(this, b); state.filters.statut = b.dataset.statut; afterFilterChange(); });
    $('seg-sort').addEventListener('click', function (e) { var b = e.target.closest('.seg-btn'); if (!b) return; setGroupActive(this, b); state.filters.sort = b.dataset.sort; afterFilterChange(); });
    $('filters-reset').addEventListener('click', resetFilters);

    // Privacy (Law 25) — opens the dedicated confidentialité view.
    var pv = $('privacy-link');
    if (pv) pv.addEventListener('click', function (e) {
      e.preventDefault();
      setTab('confidentialite');
    });

    // Offer form
    $('o-service').addEventListener('change', onOfferServiceChange);
    $('o-date').addEventListener('change', onOfferDateChange);
    $('o-date').addEventListener('input', onOfferDateChange);
    $('o-amount').addEventListener('input', onAmountChange);
    $('o-anon').addEventListener('change', onAnonToggle);
    $('o-prefix').addEventListener('input', validateOfferUI);
    $('o-courriel').addEventListener('input', validateOfferUI);
    $('offer-form').addEventListener('submit', onOfferSubmit);
    $('o-date').setAttribute('min', todayISO());

    // Day dialog
    $('day-close').addEventListener('click', function () { $('day-dialog').close(); });
    $('day-offer').addEventListener('click', offerForDay);
    $('day-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });

    // Reveal dialog
    $('reveal-confirm').addEventListener('click', function () { $('reveal-dialog').close(); commitAnon(false); });
    $('reveal-cancel').addEventListener('click', function () { $('reveal-dialog').close(); commitAnon(true); });
    $('reveal-dialog').addEventListener('cancel', function () { commitAnon(true); });

    // Dossier
    $('d-service').addEventListener('change', renderDossier);
    $('dossier-read-all').addEventListener('click', readAllDossier);

    // Notary
    $('notary-form').addEventListener('submit', onNotarySubmit);

    // Notary console
    var ncForm = $('notary-auth-form');
    if (ncForm) ncForm.addEventListener('submit', function (e) { e.preventDefault(); ncSignIn($('nc-email').value); });
    var ncOut = $('notary-signout'); if (ncOut) ncOut.addEventListener('click', ncSignOut);
    var ncRef = $('notary-refresh'); if (ncRef) ncRef.addEventListener('click', function () { ncLoadBids(); toast('Demandes rafraîchies.'); });
    var ncOpenList = $('notary-open-list');
    if (ncOpenList) ncOpenList.addEventListener('click', function (e) {
      var card = e.target.closest('.nc-card'); if (!card) return;
      var id = card.dataset.id;
      var b = nc.open.filter(function (x) { return x.id === id; })[0]; if (!b) return;
      if (e.target.closest('.nc-accept')) ncAccept(id, b.dateISO, b);
      else if (e.target.closest('.nc-decline')) ncDecline(id, b.dateISO);
    });

    // Hero CTAs — orient the buyer immediately
    var ctaR = $('cta-reserver');
    if (ctaR) ctaR.addEventListener('click', function () {
      setTab('carnet', { scroll: false });
      var svc = $('o-service'); if (svc) svc.focus();
      var side = document.querySelector('.side');
      if (side) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var ctaV = $('cta-voir');
    if (ctaV) ctaV.addEventListener('click', function () {
      var cal = $('cal-grid');
      if (cal) cal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    populateServiceSelects();
    buildServiceChips();
    readHash();
    syncFilterChips();
    renderLegend();
    wire();

    // Restore theme preference
    var savedTheme = lsLoad('nota.theme'); if (savedTheme) setTheme(savedTheme);

    // Initialize offer form
    onOfferServiceChange();
    if (state.selectedDate) { $('o-date').value = state.selectedDate; onOfferDateChange(); }

    await refreshMonthData();
    renderCalendar(); renderAgenda();

    // Restore a stored notary session (no fetch unless a token is present).
    ncRestore();

    // scroll:false so loading on a phone never scrolls past the calendar.
    setTab(state.tab, { scroll: false });

    // Register the service worker (installable PWA + offline shell). Skip on
    // localhost so the dev server's live edits aren't served from cache, and on
    // file:// where SWs are unavailable.
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
  }

  // Documented handle for tests and the future notary console. `const`/`let` at
  // script scope are lexical globals invisible on window — this is the one way in.
  window.Nota = {
    state: state,
    store: store,
    domain: D,
    setTab: setTab,
    selectDate: selectDate,
    reload: reloadAndRender,
    dossierState: dossierState,
    // Notary console hooks for tests and future integration.
    notary: {
      state: nc,
      signIn: ncSignIn,
      signOut: ncSignOut,
      loadBids: ncLoadBids,
      accept: ncAccept,
      decline: ncDecline,
      feedUrl: ncFeedUrl,
      retainedFor: ncRetainedFor,
    },
    _internals: { applyFilters: applyFilters, acceptance: acceptance, buildCalendarLinks: buildCalendarLinks },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
