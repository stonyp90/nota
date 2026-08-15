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

  // Absolute API base: a relative '/api' resolved against the current origin.
  function apiBaseAbs() { return API_BASE.indexOf('http') === 0 ? API_BASE : location.origin + API_BASE; }
  // Swap an http(s) URL to the webcal:// scheme that calendar apps subscribe to.
  function toWebcal(httpUrl) { return httpUrl.replace(/^https?:\/\//, 'webcal://'); }

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
        montant: payload.montant, pricing: payload.pricing, todayISO: todayISO(),
      });
      if (!v.ok) return { ok: false, errors: v.errors };

      if (this.online) {
        var r = null;
        try {
          r = await fetch(API_BASE + '/bids', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          });
        } catch (e) { r = null; /* only a rejected fetch (true offline) falls back to local */ }
        if (r) {
          // Guard the parse: an empty/non-JSON error body must NOT be swallowed
          // into the local-demo path (which would falsely report success).
          var j = {};
          try { j = await r.json(); } catch (e) { /* empty or non-JSON body */ }
          if (r.status === 201) return { ok: true, bid: j.bid };
          return { ok: false, errors: (j && j.errors) || [{ code: 'erreur', message: 'Erreur serveur. Réessayez.' }] };
        }
      }
      var anonyme = payload.anonyme !== false;
      var bid = {
        id: 'loc-' + Date.now() + '-' + Math.floor(Math.random() * 1e5),
        serviceId: payload.serviceId, dateISO: payload.dateISO, montant: v.montant,
        tier: v.tier, premium: v.premium, anonyme: anonyme,
        nom: anonyme ? null : (payload.nom || null),
        prefixe: (payload.prefixe || '').toUpperCase().slice(0, 3) || null,
        pricing: payload.pricing || null,
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
    filters: { service: '', statut: '', min: null, max: null, sort: 'montant-desc', prefixe: '' },
    selectedDate: null,
    focusDate: todayISO(),
    tab: 'carnet',
    view: 'calendrier',
    offer: { serviceId: '', dateISO: '', montant: 0, anonyme: true, pricing: {} },
  };

  // Carnet view ids (segmented switcher) + the sentinel key for offers with no
  // postal sector, used by the Carte grouping and the prefixe filter.
  var VIEWS = ['calendrier', 'liste', 'carte'];
  var NO_FSA = '∅';

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
  var fmtDayShort = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function monthTitle(anchor) { return fmtMonth.format(new Date(anchor + 'T00:00:00Z')); }
  function dayTitle(iso) { return fmtDayLong.format(new Date(iso + 'T00:00:00Z')); }
  function dayShort(iso) { return fmtDayShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, ''); }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }


  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  // ---------------------------------------------------------------------------
  // In-app notifications — the second channel beside the email the API sends.
  // No login: we track THIS browser's own offers in localStorage and surface the
  // same lifecycle events (published, date approaching J-7/3/1, retained) in the
  // bell. Idempotent by a stable per-event key.
  // ---------------------------------------------------------------------------
  var LS_NOTIF = 'nota.notifs.v1';
  var LS_MYOFFERS = 'nota.myoffers.v1';
  function notifLoad() { return lsLoad(LS_NOTIF) || []; }
  function notifSave(a) { lsSave(LS_NOTIF, a); }
  function myOffers() { return lsLoad(LS_MYOFFERS) || []; }
  function addMyOffer(bid) {
    var a = myOffers().filter(function (o) { return o.id !== bid.id; });
    a.push({ id: bid.id, dateISO: bid.dateISO, serviceId: bid.serviceId, montant: bid.montant });
    lsSave(LS_MYOFFERS, a.slice(-50));
  }
  // The live status of one of the client's own offers: retained by a notary
  // (approved), still open past its date (expired), or waiting (pending).
  function clientOfferStatus(o) {
    var pub = (state.monthBids || []).filter(function (b) { return b.id === o.id; })[0];
    if (pub && pub.status === D.STATUS.RETENUE) return 'approved';
    if (D.daysBetween(todayISO(), o.dateISO) < 0) return 'expired';
    return 'pending';
  }
  var OFFER_STATUS_LABEL = { approved: '✓ Approuvé', pending: 'En attente', expired: 'Expiré' };
  function svcName(id) { var s = D.serviceById(id); return s ? s.nom : id; }

  // --- Client profile --------------------------------------------------------
  // Created with sensible defaults on first read (all notifications on). Held on
  // this device; reused across the offer flow and the dossier.
  var LS_PROFILE = 'nota.profile.v1';
  var PROFILE_NOTIF_DEFAULTS = { published: true, reminders: true, retained: true };
  function profileGet() {
    var p = lsLoad(LS_PROFILE) || {};
    return {
      nom: p.nom || '', courriel: p.courriel || '', prefixe: p.prefixe || '',
      anonyme: p.anonyme !== false,
      notifs: Object.assign({}, PROFILE_NOTIF_DEFAULTS, p.notifs || {}),
    };
  }
  function profileSet(patch) {
    var cur = profileGet();
    var next = Object.assign({}, cur, patch || {});
    if (patch && patch.notifs) next.notifs = Object.assign({}, cur.notifs, patch.notifs);
    lsSave(LS_PROFILE, next);
    return next;
  }
  function notifAllowed(kind) { return profileGet().notifs[kind] !== false; }

  function addNotif(n) {
    // Respect the profile's notification preferences (a kind'd notif can be off).
    if (n.kind && !notifAllowed(n.kind)) return;
    var a = notifLoad();
    if (a.some(function (x) { return x.key === n.key; })) return; // idempotent
    a.unshift({ key: n.key, title: n.title, body: n.body || '', dateISO: n.dateISO || null, read: false });
    notifSave(a.slice(0, 40));
    renderNotifs();
  }
  function renderNotifs() {
    var list = $('notif-list'); if (!list) return;
    var a = notifLoad();
    var unread = a.filter(function (x) { return !x.read; }).length;
    var badge = $('notif-badge');
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.hidden = unread === 0; }
    var bell = $('notif-bell'); if (bell) bell.classList.toggle('has-unread', unread > 0);
    clear(list);
    if (!a.length) { list.appendChild(el('div', 'notif-empty', 'Aucune notification pour le moment.')); return; }
    a.forEach(function (n) {
      var item = el('div', 'notif-item' + (n.read ? '' : ' is-unread'));
      item.appendChild(el('div', 'notif-title', n.title));
      if (n.body) item.appendChild(el('div', 'notif-body', n.body));
      if (n.dateISO) {
        item.setAttribute('role', 'button'); item.tabIndex = 0;
        var go = function () { toggleNotifPanel(false); markAllRead(); openDay(n.dateISO); };
        item.addEventListener('click', go);
        item.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      list.appendChild(item);
    });
  }
  function markAllRead() { var a = notifLoad(); a.forEach(function (x) { x.read = true; }); notifSave(a); renderNotifs(); }
  function toggleNotifPanel(force) {
    var panel = $('notif-panel'), bell = $('notif-bell'); if (!panel) return;
    var open = force != null ? force : panel.hidden;
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { renderNotifs(); acctSync(); }
  }
  // Reflect the client's profile in the account menu header.
  function acctSync() {
    var p = profileGet();
    var name = $('acct-name'), email = $('acct-email');
    if (name) name.textContent = p.nom || 'Mon profil';
    if (email) email.textContent = p.courriel || 'Coordonnées, documents, préférences';
  }
  // Derive notifications from this browser's offers: local date-approaching, and
  // "retained" by matching each offer id against its month's public bids.
  async function computeNotifications() {
    var offers = myOffers(); if (!offers.length) { renderNotifs(); return; }
    offers.forEach(function (o) {
      var days = D.daysBetween(todayISO(), o.dateISO);
      if (days >= 0 && (days === 7 || days === 3 || days === 1 || days === 0)) {
        addNotif({
          key: 'approach:' + o.id + ':' + days,
          kind: 'reminders',
          title: days === 0 ? 'Votre signature est aujourd’hui' : 'Votre date approche (J-' + days + ')',
          body: dayTitle(o.dateISO) + ' · ' + svcName(o.serviceId), dateISO: o.dateISO,
        });
      }
    });
    var months = {}; offers.forEach(function (o) { months[monthKey(o.dateISO)] = true; });
    for (var m in months) {
      try {
        var bids = await store.listMonth(m);
        offers.forEach(function (o) {
          var mine = bids.filter(function (b) { return b.id === o.id; })[0];
          if (mine && mine.status === D.STATUS.RETENUE) {
            addNotif({
              key: 'retained:' + o.id,
              kind: 'retained',
              title: 'Un notaire a retenu votre demande 🎉',
              body: dayTitle(o.dateISO) + (mine.etude ? ' · ' + mine.etude : ''), dateISO: o.dateISO,
            });
          }
        });
      } catch (e) { /* offline — try again next load */ }
    }
    renderNotifs();
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
      if (f.prefixe) {
        if (f.prefixe === NO_FSA) { if (b.prefixe) return false; }
        else if ((b.prefixe || '') !== f.prefixe) return false;
      }
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
    var byDay = {};
    visible.forEach(function (b) { (byDay[b.dateISO] = byDay[b.dateISO] || []).push(b); });
    // The client's OWN offers, to badge their status on the calendar. Status is
    // read from the live public bid (unfiltered): retained -> approved; still
    // open on a past date -> expired; otherwise pending.
    var mineByDate = {};
    myOffers().forEach(function (o) { mineByDate[o.dateISO] = o; });
    function myOfferStatus(iso) {
      var mine = mineByDate[iso];
      return mine ? clientOfferStatus(mine) : null;
    }

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
      if (iso === today) { cell.classList.add('is-today'); cell.setAttribute('aria-current', 'date'); }
      if (iso === state.selectedDate) { cell.classList.add('is-selected'); cell.setAttribute('aria-selected', 'true'); }

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
          var topOffer = open.reduce(function (a, b) { return b.montant > a.montant ? b : a; }, open[0]);
          cell.appendChild(el('span', 'cal-top', D.money(topOffer.montant)));
          // Colour the cell by the headline offer's urgency tier (matches the
          // legend + agenda) — warm = urgent, cool = calm.
          if (topOffer.tier) cell.dataset.tier = topOffer.tier;
          // Info line: the headline offer's service + urgency tier, so a scanner
          // reads what act and how urgent without opening the day.
          var svcT = D.serviceById(topOffer.serviceId);
          var svcShort = svcT ? svcT.nom.split(' ')[0] : topOffer.serviceId;
          var tierNom = D.tierById(topOffer.tier || 'standard').nom;
          var info = el('div', 'cal-info');
          info.appendChild(el('span', 'cal-info-svc', svcShort));
          info.appendChild(el('span', 'cal-info-tier', tierNom));
          cell.appendChild(info);
          cell.setAttribute('aria-label', dayTitle(iso) + ', ' + n + ' offre' + plural + ', meilleure ' + D.money(topOffer.montant) + ', ' + svcShort + ', ' + tierNom);
        } else {
          // Everything taken: show what cleared, struck through — more useful to
          // the next bidder than an em-dash.
          var cleared = Math.max.apply(null, dayBids.map(function (b) { return b.montant; }));
          cell.appendChild(el('span', 'cal-top is-cleared', D.money(cleared)));
          cell.setAttribute('aria-label', dayTitle(iso) + ', ' + n + ' offre' + plural + ' retenue' + plural + ', ' + D.money(cleared) + ' obtenu');
        }

        // Status meter: a green segment for offers still open, a muted segment
        // for offers a notary has retained — so accepted vs. waiting reads at a glance.
        var retenue = dayBids.filter(function (b) { return b.status === D.STATUS.RETENUE; });
        if (retenue.length) cell.classList.add('has-retenue');
        if (!open.length) cell.classList.add('is-taken');
        var meter = el('div', 'cal-status');
        var oSeg = el('span', 'cal-status-open'); oSeg.style.flexGrow = String(open.length);
        var tSeg = el('span', 'cal-status-taken'); tSeg.style.flexGrow = String(retenue.length);
        meter.appendChild(oSeg); meter.appendChild(tSeg);
        cell.appendChild(meter);
      }

      // The client's own offer status on this day (approved / pending / expired).
      var mineSt = myOfferStatus(iso);
      if (mineSt) {
        cell.classList.add('has-mine');
        var badge = el('span', 'cal-mine', { approved: '✓ Approuvé', pending: 'En attente', expired: 'Expiré' }[mineSt]);
        badge.dataset.status = mineSt;
        badge.title = 'Votre offre — ' + { approved: 'approuvée par un notaire', pending: 'en attente d’un notaire', expired: 'expirée' }[mineSt];
        cell.appendChild(badge);
        // The badge is a child span, excluded from the button's accessible name;
        // fold its status into the cell's aria-label so it's not sight-only.
        cell.setAttribute('aria-label', (cell.getAttribute('aria-label') || dayTitle(iso)) +
          ', votre offre ' + { approved: 'approuvée', pending: 'en attente', expired: 'expirée' }[mineSt]);
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
    lg.appendChild(el('span', 'legend-label', 'Urgence'));
    D.TIERS.forEach(function (t) {
      var item = el('span', 'legend-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--tier-' + t.id + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(t.nom));
      lg.appendChild(item);
    });
    lg.appendChild(el('span', 'legend-label legend-label--sep', 'Statut'));
    // Status key (distinct class so the tier-count test still holds).
    [['ouverte', 'En attente'], ['retenue', 'Retenu']].forEach(function (s) {
      var item = el('span', 'legend-status-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--status-' + s[0] + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(s[1]));
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
      var empty = el('div', 'agenda-empty');
      empty.appendChild(el('p', 'agenda-empty-text', state.selectedDate
        ? 'Aucune offre le ' + dayTitle(state.selectedDate) + '.'
        : (filtersActive() ? 'Aucune offre pour ce filtre.' : 'Aucune offre ce mois-ci.')));
      var cta = el('button', 'btn btn-sm', filtersActive() ? 'Réinitialiser les filtres' : 'Réserver cette date');
      cta.type = 'button';
      cta.addEventListener('click', filtersActive() ? resetFilters : function () { $('cta-reserver').click(); });
      empty.appendChild(cta);
      ag.appendChild(empty);
      return;
    }

    // Group by day (agenda always reads chronologically within the current sort's day order)
    var order = [];
    var groups = {};
    visible.forEach(function (b) { if (!groups[b.dateISO]) { groups[b.dateISO] = []; order.push(b.dateISO); } groups[b.dateISO].push(b); });
    if (state.filters.sort.indexOf('date') === 0) order.sort(state.filters.sort === 'date-asc' ? undefined : function (a, b) { return b.localeCompare(a); });
    else order.sort();

    var PER_DAY = 8; // cap rows per day so a busy month never floods the DOM
    order.forEach(function (iso) {
      var group = el('div', 'agenda-group');
      group.appendChild(el('div', 'agenda-day', dayTitle(iso)));
      var dayBids = groups[iso].sort(function (a, b) { return b.montant - a.montant; });
      dayBids.slice(0, PER_DAY).forEach(function (b) { group.appendChild(bidRow(b)); });
      if (dayBids.length > PER_DAY) {
        var extra = dayBids.length - PER_DAY;
        var more = el('button', 'agenda-more', '+ ' + extra + ' autre' + (extra > 1 ? 's' : '') + ' offre' + (extra > 1 ? 's' : ''));
        more.type = 'button';
        more.addEventListener('click', function () { openDay(iso); });
        group.appendChild(more);
      }
      ag.appendChild(group);
    });
  }

  function bidRow(b, opts) {
    opts = opts || {};
    var retenue = b.status === D.STATUS.RETENUE;
    var row = el('div', 'bid-row' + (retenue ? ' is-retenue' : ' is-open'));
    row.appendChild(el('span', 'bid-amount', D.money(b.montant)));

    var meta = el('div', 'bid-meta');
    var who = el('div', 'bid-who');
    who.textContent = D.bidLabel(b);
    if (b.anonyme) { who.appendChild(el('span', 'tag-anon', 'anonyme')); }
    meta.appendChild(who);

    var svc = D.serviceById(b.serviceId);
    var rk = D.rankOf(b, state.monthBids);
    var sub = svc ? svc.nom : b.serviceId;
    if (rk.rang && rk.total > 1) sub += ' · ' + rk.rang + 'e sur ' + rk.total;
    meta.appendChild(el('div', 'bid-sub', sub));
    row.appendChild(meta);

    if (retenue) {
      // Accepted: name the retaining notary (étude) — long names truncate with a tooltip.
      var chip = el('span', 'status-chip', b.etude ? 'Retenu · ' + b.etude : 'Retenu');
      if (b.etude) chip.title = 'Retenu par ' + b.etude;
      row.appendChild(chip);
    } else {
      var pill = el('span', 'pill', D.tierById(b.tier ? b.tier : 'standard').nom);
      pill.dataset.tier = b.tier || 'standard';
      row.appendChild(pill);
      // "Take a bet": a notary retains this open offer. In the offline demo this
      // marks it retained locally; online it would route through the console.
      if (opts.actions) {
        var take = el('button', 'btn btn-sm bid-take', 'Retenir');
        take.type = 'button';
        take.setAttribute('aria-label', 'Retenir cette offre de ' + D.money(b.montant) + ' — ' + (D.serviceById(b.serviceId) || {}).nom);
        take.addEventListener('click', function (e) { e.stopPropagation(); takeBid(b); });
        row.appendChild(take);
      }
    }
    return row;
  }

  // One dispatch for the three carnet views: keep the shared toolbar summary
  // correct in EVERY view, then paint ONLY the active region.
  function renderActiveView() {
    var visible = applyFilters(state.monthBids);
    updateFilterSummary(visible.length, visible);
    if (state.view === 'liste') renderAgenda();
    else if (state.view === 'carte') renderCarte();
    else renderCalendar();
  }

  // Toggle the segmented tabs + their tabpanels, then render the active view.
  function setView(v) {
    if (VIEWS.indexOf(v) < 0) v = 'calendrier';
    state.view = v;
    VIEWS.forEach(function (name) {
      var on = name === v;
      var tab = $('tab-view-' + name);
      var panel = $('view-' + name);
      if (tab) { tab.classList.toggle('is-on', on); tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.tabIndex = on ? 0 : -1; }
      if (panel) panel.hidden = !on;
    });
    writeHash();
    renderActiveView();
  }

  // Carte — offers grouped by postal sector (FSA / 3-char b.prefixe) as a density
  // heatmap grid. No coordinates exist, so density IS the map. A card drills in.
  // Approximate schematic positions (viewBox x:0..100, y:0..64) for the
  // Québec-region FSAs — a recognisable spatial layout by sector, NOT accurate.
  var FSA_POS = {
    G1R: { x: 46, y: 44 }, G1K: { x: 55, y: 37 }, G1L: { x: 41, y: 39 }, G1M: { x: 38, y: 33 }, G1J: { x: 60, y: 43 },
    G1H: { x: 48, y: 29 }, G1G: { x: 55, y: 30 }, G1E: { x: 65, y: 40 }, G1C: { x: 70, y: 35 }, G1B: { x: 74, y: 39 },
    G1S: { x: 33, y: 46 }, G1T: { x: 29, y: 40 }, G1V: { x: 23, y: 48 }, G1W: { x: 18, y: 44 }, G1X: { x: 21, y: 38 },
    G1Y: { x: 27, y: 44 }, G1N: { x: 37, y: 43 }, G1P: { x: 30, y: 34 },
    G2A: { x: 43, y: 20 }, G2B: { x: 50, y: 16 }, G2C: { x: 57, y: 19 }, G2E: { x: 35, y: 22 }, G2G: { x: 62, y: 22 },
    G2J: { x: 41, y: 14 }, G2K: { x: 47, y: 12 }, G2L: { x: 53, y: 14 }, G2M: { x: 60, y: 14 }, G2N: { x: 65, y: 17 },
    G3A: { x: 82, y: 26 }, G3B: { x: 86, y: 31 }, G3C: { x: 88, y: 36 }, G3E: { x: 68, y: 26 }, G3G: { x: 73, y: 21 },
    G3J: { x: 78, y: 43 }, G3K: { x: 84, y: 40 }, G3S: { x: 78, y: 18 },
  };
  function svgEl(name, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Carte — offers plotted on a schematic map of Québec's postal sectors (FSA).
  // No coordinates exist in the data, so positions are approximate-by-sector;
  // a bubble's size + tint encode how much demand sits there. Click to drill in.
  function renderCarte() {
    var map = $('cal-map'); clear(map);
    var visible = applyFilters(state.monthBids);
    if (!visible.length) {
      var empty = el('div', 'agenda-empty');
      empty.appendChild(el('p', 'agenda-empty-text', filtersActive() ? 'Aucune offre pour ce filtre.' : 'Aucune offre ce mois-ci.'));
      var cta = el('button', 'btn btn-sm', filtersActive() ? 'Réinitialiser les filtres' : 'Réserver une date');
      cta.type = 'button';
      cta.addEventListener('click', filtersActive() ? resetFilters : function () { $('cta-reserver').click(); });
      empty.appendChild(cta); map.appendChild(empty); return;
    }
    var groups = {}, order = [];
    visible.forEach(function (b) { var k = b.prefixe || NO_FSA; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(b); });
    var max = order.reduce(function (m, k) { return Math.max(m, groups[k].length); }, 1);

    var svg = svgEl('svg', { 'class': 'fsa-svg', viewBox: '0 0 100 64', role: 'group', 'aria-label': 'Carte des secteurs postaux — touchez un secteur pour voir ses offres' });
    svg.appendChild(svgEl('rect', { 'class': 'fsa-land', x: 1, y: 1, width: 98, height: 62, rx: 4 }));
    svg.appendChild(svgEl('path', { 'class': 'fsa-water', d: 'M1 52 Q 26 47 52 53 T 99 49 L 99 63 L 1 63 Z' }));

    var unknown = 0;
    order.forEach(function (key) {
      var n = groups[key].length;
      var openN = groups[key].filter(function (b) { return b.status !== D.STATUS.RETENUE; }).length;
      var pos = FSA_POS[key];
      if (!pos) { pos = { x: 12 + (unknown * 16) % 76, y: 59 }; unknown++; }
      var frac = n / max;
      var r = (2 + frac * 2.8);
      var g = svgEl('g', { 'class': 'fsa-node' + (key === NO_FSA ? ' is-unset' : ''), tabindex: '0', role: 'button' });
      g.dataset.fsa = key;
      g.setAttribute('aria-label', (key === NO_FSA ? 'Secteur non précisé' : 'Secteur ' + key) + ', ' + n + ' offre' + (n > 1 ? 's' : '') + (openN ? ', ' + openN + ' ouverte' + (openN > 1 ? 's' : '') : '') + '. Voir la liste.');
      g.appendChild(svgEl('circle', { cx: pos.x, cy: pos.y, r: r.toFixed(1), 'fill-opacity': (0.34 + frac * 0.5).toFixed(2) }));
      var code = svgEl('text', { x: pos.x, y: (pos.y - r - 1).toFixed(1), 'text-anchor': 'middle', 'class': 'fsa-node-code' });
      code.textContent = key === NO_FSA ? 'Autres' : key;
      g.appendChild(code);
      var cnt = svgEl('text', { x: pos.x, y: (pos.y + 0.9).toFixed(1), 'text-anchor': 'middle', 'class': 'fsa-node-n' });
      cnt.textContent = n;
      g.appendChild(cnt);
      g.addEventListener('click', function () { selectFSA(this.dataset.fsa); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFSA(this.dataset.fsa); } });
      svg.appendChild(g);
    });
    map.appendChild(svg);
    map.appendChild(el('p', 'fsa-note', 'Secteurs postaux de la région de Québec (positions approximatives). Touchez un secteur pour voir ses offres.'));
  }

  // Drill into a sector: filter to its FSA and show the list view.
  function selectFSA(prefix) {
    state.filters.prefixe = prefix;
    state.selectedDate = null;
    setView('liste');
  }

  // Retain (take) an open offer. Offline-demo path: flip it to "retenue" in the
  // local store + in memory, then repaint the calendar, agenda and day view.
  function takeBid(b) {
    if (!b || b.status === D.STATUS.RETENUE) return;
    var etude = b.etude || 'Notaire (démo)';
    var all = ensureSeed();
    var it = all.filter(function (x) { return x.id === b.id; })[0];
    if (it) { it.status = D.STATUS.RETENUE; it.etude = etude; lsSave(LS_BIDS, all); }
    b.status = D.STATUS.RETENUE; b.etude = etude;
    var mb = state.monthBids.filter(function (x) { return x.id === b.id; })[0];
    if (mb) { mb.status = D.STATUS.RETENUE; mb.etude = etude; }
    renderActiveView();
    if (state.selectedDate) openDay(state.selectedDate);
    toast('Offre retenue — le dossier du client est débloqué.');
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
    renderActiveView();
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
    var takenN = shown.filter(function (b) { return b.status === D.STATUS.RETENUE; }).length;
    $('day-sub').textContent = shown.length
      ? shown.length + ' offre' + (shown.length > 1 ? 's' : '') + (takenN ? ' · ' + takenN + ' retenue' + (takenN > 1 ? 's' : '') : '') + ' · ' + when
      : 'Aucune offre · ' + when + ' · soyez le premier';

    var list = $('day-bids'); clear(list);
    var DAY_CAP = 40; // bound the DOM even if a day draws hundreds of offers
    shown.slice(0, DAY_CAP).forEach(function (b) { list.appendChild(bidRow(b, { actions: true })); });
    if (shown.length > DAY_CAP) {
      list.appendChild(el('div', 'day-bids-more', '+ ' + (shown.length - DAY_CAP) + ' autres · les ' + DAY_CAP + ' meilleures offres sont affichées'));
    }

    var open = shown.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    $('day-best').textContent = open.length
      ? D.money(Math.max.apply(null, open.map(function (b) { return b.montant; })))
      : '—';

    // --- Inline booking (relocated offer-form) — the clicked day IS the date ---
    $('o-date').value = iso; onOfferDateChange();
    var sel = $('o-service'), chips = $('o-service-chips');
    if (D.serviceById(state.filters.service)) {           // active carnet filter → 2-click path
      sel.value = state.filters.service;
      var pre = chips && chips.querySelector('[data-svc="' + state.filters.service + '"]');
      if (pre) setGroupActive(chips, pre);
    } else {                                              // clean 3-click path
      sel.selectedIndex = -1;                             // value '' WITHOUT a placeholder option (options.length stays 3)
      if (chips) chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
    }
    onOfferServiceChange();                               // amount/gauge + recommendedAmount pre-fill + validity
    // Prefill identity from the client's saved profile so nothing is re-entered.
    var prof = profileGet();
    if ($('o-courriel')) $('o-courriel').value = prof.courriel;
    if ($('o-prefix')) $('o-prefix').value = prof.prefixe;
    if ($('o-name')) $('o-name').value = prof.nom;
    commitAnon(prof.anonyme);
    var succ = $('offer-success'); if (succ) succ.hidden = true;
    var eb = $('offer-errors'); if (eb) { eb.hidden = true; clear(eb); }
    $('day-hint').textContent = open.length
      ? 'Proposez plus que ' + D.money(Math.max.apply(null, open.map(function (b) { return b.montant; }))) + ' pour passer devant.'
      : 'Aucune offre — fixez votre prix.';
    validateOfferUI();

    renderActiveView();
    var dlg = $('day-dialog');
    if (dlg.showModal && !dlg.open) dlg.showModal();
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
    else if (e.key === 'Home') { e.preventDefault(); state.focusDate = todayISO(); state.anchor = firstOfMonth(state.focusDate); reloadAndRender(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(state.focusDate); }
    else if (e.key === 'Escape') { e.preventDefault(); resetFilters(); }
  }
  function moveFocus(delta) {
    var next = D.addDays(state.focusDate, delta);
    var changedMonth = monthKey(next) !== monthKey(state.anchor);
    if (changedMonth) state.anchor = firstOfMonth(next);
    state.focusDate = next;
    function focusCell() { var c = document.querySelector('.cal-cell[data-date="' + next + '"]'); if (c) c.focus(); }
    // Crossing a month boundary needs fresh bids for the new month, not just a re-render.
    if (changedMonth) reloadAndRender().then(focusCell);
    else { refreshMonth(); focusCell(); }
  }
  function step(months) {
    state.anchor = addMonths(state.anchor, months);
    state.focusDate = state.anchor;
    reloadAndRender();
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
    if (h.has('fsa')) state.filters.prefixe = h.get('fsa');
    if (h.has('vue') && VIEWS.indexOf(h.get('vue')) >= 0) state.view = h.get('vue');
    if (h.has('jour') && D.isISODate(h.get('jour'))) { state.selectedDate = h.get('jour'); state.focusDate = h.get('jour'); state.anchor = firstOfMonth(h.get('jour')); }
  }
  function writeHash() {
    var h = new URLSearchParams();
    var f = state.filters;
    if (f.service) h.set('svc', f.service);
    if (f.statut) h.set('statut', f.statut);
    if (f.min != null) h.set('min', f.min);
    if (f.max != null) h.set('max', f.max);
    if (f.sort && f.sort !== 'montant-desc') h.set('tri', f.sort);
    if (f.prefixe) h.set('fsa', f.prefixe);
    if (state.view && state.view !== 'calendrier') h.set('vue', state.view);
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
  function afterFilterChange() { writeHash(); renderActiveView(); }
  function activeFilterCount() {
    var f = state.filters, n = 0;
    if (f.service) n++;
    if (f.statut) n++;
    if (f.min != null) n++;
    if (f.max != null) n++;
    if (f.prefixe) n++;
    if (f.sort && f.sort !== 'montant-desc') n++;
    return n;
  }
  function filtersActive() { return activeFilterCount() > 0; }
  function updateFilterSummary(count, visible) {
    var rc = $('result-count');
    if (rc) rc.textContent = count + ' offre' + (count === 1 ? '' : 's') + ' ce mois';
    // Next availability: the soonest upcoming date (>= today) with an offer still
    // open (not yet retained) among what's shown — a liveness cue for the market.
    var av = $('cal-avail');
    if (av) {
      var today = todayISO();
      var soon = (visible || []).reduce(function (best, b) {
        if (b.status === D.STATUS.RETENUE || b.dateISO < today) return best;
        return (best === null || b.dateISO < best) ? b.dateISO : best;
      }, null);
      if (soon) { av.textContent = 'Prochaine dispo · ' + dayShort(soon); av.hidden = false; }
      else { av.textContent = ''; av.hidden = true; }
    }
    var rb = $('filters-reset');
    if (rb) rb.hidden = !filtersActive();
    // Surface the active-filter count on the (collapsed) toggle so hidden filters stay visible.
    var n = activeFilterCount();
    var fc = $('filters-count');
    if (fc) { fc.textContent = String(n); fc.hidden = n === 0; }
    var ft = $('filters-toggle');
    if (ft) ft.classList.toggle('has-active', n > 0);
    var fa = $('fsa-active');
    if (fa) {
      if (state.filters.prefixe) {
        var lab = fa.querySelector('.fsa-active-label');
        if (lab) lab.textContent = state.filters.prefixe === NO_FSA ? 'Secteur non précisé' : 'Secteur ' + state.filters.prefixe;
        fa.hidden = false;
      } else { fa.hidden = true; }
    }
  }
  function resetFilters() {
    state.filters = { service: '', statut: '', min: null, max: null, sort: 'montant-desc', prefixe: '' };
    state.selectedDate = null;
    syncFilterChips(); writeHash();
    renderActiveView();
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
        o.value = s.id; o.textContent = s.nom + ' — à partir de ' + D.money(s.prixDepart);
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
  // Service chips inside the booking dialog (one per act; no "Tous"). Only sets
  // the hidden #o-service value — that select keeps its 3 tested options.
  function buildBookingChips() {
    var wrap = $('o-service-chips'); if (!wrap) return; clear(wrap);
    D.SERVICES.forEach(function (s) {
      var b = el('button', 'chip', s.nom.split(' ')[0]);
      b.type = 'button'; b.dataset.svc = s.id; b.setAttribute('aria-pressed', 'false');
      wrap.appendChild(b);
    });
  }

  // The dynamic floor for the current offer, from the client's pricing answers
  // (== the flat base when nothing is answered). Everything in the booking form
  // — slider bounds, the recommended pre-fill, the "× base" note — reads this.
  function currentBase() {
    var b = D.computeBasePrice(state.offer.serviceId, state.offer.pricing);
    if (b != null) return b;
    var svc = D.serviceById(state.offer.serviceId);
    return svc ? svc.prixDepart : 0;
  }

  // Render the service's pricing criteria INTO the booking flow, so answering
  // them (the same questions the notary needs) refines the price live — "the
  // document merged with the process". Optional: unanswered = base price, so
  // one-tap booking still works.
  // Build one pricing-criterion control (flag / choice / bracket). SHARED by the
  // booking flow and the Dossier profile page so the price questions look and
  // behave identically wherever they are answered. `onChange(value)` receives
  // the new answer; `idPrefix` namespaces input ids so both surfaces coexist.
  function buildCriterionRow(c, current, onChange, idPrefix) {
    var row = el('div', 'crit-row');
    if (c.type === 'flag') {
      var lab = el('label', 'crit-flag');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = idPrefix + c.id; cb.checked = !!current;
      cb.addEventListener('change', function () { onChange(cb.checked); });
      lab.appendChild(cb);
      var txt = el('span', 'crit-text');
      txt.appendChild(el('span', 'crit-label', c.label));
      if (c.aide) txt.appendChild(el('span', 'help', c.aide));
      lab.appendChild(txt);
      row.appendChild(lab);
    } else if (c.type === 'choice') {
      row.appendChild(el('span', 'crit-label', c.label));
      var grp = el('div', 'crit-choices');
      (c.options || []).forEach(function (opt) {
        var b = el('button', 'chip', opt.label);
        b.type = 'button';
        b.id = idPrefix + c.id + '__' + opt.id;
        var on = current === opt.id;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('is-on', on);
        b.addEventListener('click', function () {
          grp.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
          b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true');
          onChange(opt.id);
        });
        grp.appendChild(b);
      });
      row.appendChild(grp);
      if (c.aide) row.appendChild(el('span', 'help', c.aide));
    } else if (c.type === 'bracket') {
      var lbl = el('label', 'crit-label', c.label);
      lbl.setAttribute('for', idPrefix + c.id);
      row.appendChild(lbl);
      var inp = document.createElement('input');
      inp.type = 'number'; inp.id = idPrefix + c.id; inp.min = '0'; inp.step = '1000';
      inp.inputMode = 'numeric'; inp.placeholder = c.unit === '$' ? '350 000' : '';
      if (current != null) inp.value = current;
      inp.addEventListener('input', function () { onChange(inp.value === '' ? undefined : Number(inp.value)); });
      row.appendChild(inp);
      if (c.aide) row.appendChild(el('span', 'help', c.aide));
    }
    return row;
  }

  function renderOfferCriteria(serviceId) {
    var box = $('o-criteria');
    var step = $('o-criteria-step');
    if (!box) return;
    clear(box);
    var svc = D.serviceById(serviceId);
    var criteria = (svc && svc.pricing && svc.pricing.criteria) || [];
    if (step) step.hidden = criteria.length === 0;
    var mkRow = function (c) {
      return buildCriterionRow(c, state.offer.pricing[c.id], function (val) { setCriterion(c.id, val); }, 'crit-');
    };
    // Mandatory questions shown directly; optional "hardeners" behind an expander
    // so the happy path stays ~3 clicks.
    criteria.filter(function (c) { return c.required; }).forEach(function (c) { box.appendChild(mkRow(c)); });
    var optional = criteria.filter(function (c) { return !c.required; });
    if (optional.length) {
      var det = document.createElement('details'); det.className = 'disclosure crit-more';
      var sum = document.createElement('summary'); sum.textContent = 'Affiner (facultatif)'; det.appendChild(sum);
      var inner = el('div', 'o-criteria');
      optional.forEach(function (c) { inner.appendChild(mkRow(c)); });
      det.appendChild(inner);
      box.appendChild(det);
    }
    // Keep the base-note fresh across act switches (it lives outside #o-criteria).
    var bn = $('o-base-note');
    if (bn) bn.textContent = svc ? 'Prix de départ : ' + D.money(currentBase()) + '.' : '';
  }

  function setCriterion(id, value) {
    if (value === undefined || value === '' || value === false) delete state.offer.pricing[id];
    else state.offer.pricing[id] = value;
    // The pricing answers belong to the client's PROFILE (dossier) — the single
    // source of truth shared with the Dossier page.
    dossierSetPricing(state.offer.serviceId, id, value);
    onCriteriaChange();
  }

  // A criteria change re-derives the base: retune the slider bounds + the
  // pre-fill (only bumping the amount when it now falls below the new floor, so
  // a manual choice is preserved), refresh the note, and re-validate.
  function onCriteriaChange() {
    var svc = D.serviceById(state.offer.serviceId);
    if (!svc) return;
    var base = currentBase();
    var amt = $('o-amount');
    // Read the value BEFORE raising min — a range input clamps .value up to the
    // new min in real browsers, which would defeat the below-floor check.
    var prev = Number(amt.value);
    amt.min = base; amt.max = base * D.PREMIUM_CAP;
    if (prev < base) {
      var rec = D.recommendedAmount(svc.id, state.offer.dateISO, todayISO(), state.offer.pricing);
      amt.value = rec != null ? rec : base;
    }
    var bn = $('o-base-note');
    if (bn) bn.textContent = 'Prix de départ ajusté : ' + D.money(base) + '.';
    onAmountChange();
  }

  function onOfferServiceChange() {
    var svc = D.serviceById($('o-service').value);
    state.offer.serviceId = svc ? svc.id : '';
    // Seed pricing from the client's PROFILE (dossier) for this act, so answers
    // given on the Dossier page pre-fill and drive the offer floor here too.
    state.offer.pricing = svc ? Object.assign({}, dossierPricing(svc.id)) : {};
    $('o-service-help').textContent = svc ? svc.description : '';
    renderOfferCriteria(state.offer.serviceId);
    var amt = $('o-amount');
    if (svc) {
      var base = currentBase();
      amt.min = base; amt.max = base * D.PREMIUM_CAP; amt.step = 5;
      amt.disabled = false;
      // Pre-fill the recommended (mid-tier) offer so a client can book in one tap
      // instead of leaving the gauge at the floor ("peu susceptible d'être retenue").
      var rec = D.recommendedAmount(svc.id, state.offer.dateISO, todayISO(), state.offer.pricing);
      amt.value = rec != null ? rec : base;
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
      // Re-tune the pre-filled amount to this date's tier.
      var rec = D.recommendedAmount(state.offer.serviceId, date, todayISO(), state.offer.pricing);
      if (rec != null) $('o-amount').value = rec;
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
      var base = currentBase();
      var mult = amt / base;
      $('o-mult').textContent = mult.toFixed(2) + '× le prix de départ (' + D.money(base) + ')';
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
    var v = D.validateOffer({ serviceId: o.serviceId, dateISO: o.dateISO, montant: o.montant, courriel: courriel, pricing: o.pricing, todayISO: todayISO() });
    var s = $('offer-submit');
    // Editing after a publish resets the CTA out of its success/busy state.
    if (!s.getAttribute('aria-busy') && s.textContent.trim() !== 'Publier mon offre') {
      s.textContent = 'Publier mon offre';
      var succ = $('offer-success'); if (succ) succ.hidden = true;
    }
    s.disabled = !v.ok;
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
    var submit = $('offer-submit');
    if (submit.disabled) return; // also blocks Enter-to-submit on an invalid offer
    submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = 'Publication…';
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
    // The pricing criteria the client answered (part of the dossier); the API
    // recomputes the floor from these and stores them privately on the bid.
    if (o.pricing && Object.keys(o.pricing).length) payload.pricing = o.pricing;
    var res = await store.createBid(payload);
    var errBox = $('offer-errors');
    if (!res.ok) {
      clear(errBox); errBox.hidden = false;
      res.errors.forEach(function (er) { errBox.appendChild(el('li', null, er.message)); });
      submit.textContent = 'Publier mon offre'; submit.disabled = false; submit.removeAttribute('aria-busy');
      return;
    }
    errBox.hidden = true;
    submit.removeAttribute('aria-busy'); submit.textContent = 'Offre publiée ✓'; // stays disabled → no duplicate submit
    toast('Offre publiée : ' + D.money(payload.montant) + (store.online ? '' : ' (démo locale)'));
    buildCalendarLinks(res.bid);
    $('offer-success').hidden = false;
    // The dossier is what makes this lead sellable — show its real progress here
    // and give a one-tap path to finish it for THIS service.
    fillDossierNext(res.bid.serviceId);
    // Remember the client's coordinates in their profile for next time.
    profileSet({ courriel: payload.courriel, prefixe: payload.prefixe, nom: payload.nom || '', anonyme: payload.anonyme });
    // Track this offer + raise the in-app "published" notification (email is sent by the API).
    addMyOffer(res.bid);
    addNotif({
      key: 'published:' + res.bid.id,
      kind: 'published',
      title: 'Offre publiée',
      body: D.money(res.bid.montant) + ' · ' + dayTitle(res.bid.dateISO) + ' · ' + svcName(res.bid.serviceId),
      dateISO: res.bid.dateISO,
    });
    state.selectedDate = payload.dateISO;
    await refreshMonthData();
    renderActiveView();
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
    // RFC 5545: DTSTAMP is required (Outlook drops events without it); escape TEXT.
    var esc = function (s) { return String(s).replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n'); };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nota//FR-CA//',
      'BEGIN:VEVENT', 'UID:' + bid.id + '@nota', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + startCompact, 'DTEND;VALUE=DATE:' + endCompact,
      'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(details), 'END:VEVENT', 'END:VCALENDAR',
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
  // Profile (coordinates + notification settings)
  // ---------------------------------------------------------------------------
  // Distinct icon per profile section, so the bands are easy to tell apart.
  var IC_OFFERS = '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/>';
  var IC_COORD = '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>';
  var IC_NOTIF = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>';
  var IC_DOCS = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
  function profilHead(iconPaths, title) {
    var head = el('div', 'profil-card-head');
    var ic = el('span', 'profil-card-ic');
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths + '</svg>';
    head.appendChild(ic);
    head.appendChild(el('h2', 'profil-card-title', title));
    return head;
  }

  // A card listing the client's posted offers with their live status — their
  // consolidated "where do my requests stand?" view. When they have none, a
  // friendly first-time prompt with a CTA to the carnet.
  function buildMyOffersCard() {
    var offers = myOffers();
    var card = el('div', 'profil-card');
    card.appendChild(profilHead(IC_OFFERS, 'Mes offres'));
    if (!offers.length) {
      var empty = el('div', 'profil-empty');
      empty.appendChild(el('p', 'profil-empty-text', 'Vous n’avez pas encore publié d’offre. Choisissez une date au carnet et un notaire de Québec la retient.'));
      var cta = el('button', 'btn btn-primary btn-sm', 'Réserver votre première date →'); cta.type = 'button';
      cta.addEventListener('click', function () { toggleNotifPanel(false); setTab('carnet'); });
      empty.appendChild(cta);
      card.appendChild(empty);
      return card;
    }
    var list = el('div', 'my-offers-list');
    offers.slice().sort(function (a, b) { return String(b.dateISO).localeCompare(String(a.dateISO)); }).forEach(function (o) {
      var st = clientOfferStatus(o);
      var row = el('button', 'my-offer'); row.type = 'button'; row.dataset.status = st;
      var main = el('div', 'my-offer-main');
      main.appendChild(el('div', 'my-offer-svc', svcName(o.serviceId)));
      main.appendChild(el('div', 'my-offer-meta', dayTitle(o.dateISO) + ' · ' + D.money(o.montant)));
      row.appendChild(main);
      var badge = el('span', 'my-offer-badge', OFFER_STATUS_LABEL[st]); badge.dataset.status = st;
      row.appendChild(badge);
      row.addEventListener('click', function () { toggleNotifPanel(false); setTab('carnet'); openDay(o.dateISO); });
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function renderProfil() {
    var body = $('profil-body'); if (!body) return; clear(body);
    var p = profileGet();

    // Mes offres — a full-width band at the top; its offers lay out across the
    // width so the actionable "where do my requests stand" view leads.
    var oCard = buildMyOffersCard();
    if (oCard) body.appendChild(oCard);

    // Coordinates card — reused when publishing an offer. A full-width band;
    // the fields sit in a grid that fills the width (no empty right half).
    var idCard = el('div', 'profil-card');
    idCard.appendChild(profilHead(IC_COORD, 'Coordonnées'));
    idCard.appendChild(el('p', 'help', 'Réutilisées automatiquement quand vous publiez une offre.'));
    var idFields = el('div', 'profil-fields');
    [
      { key: 'nom', label: 'Nom (offre non anonyme)', ph: 'Prénom Nom', type: 'text' },
      { key: 'courriel', label: 'Courriel', ph: 'vous@exemple.ca', type: 'email' },
      { key: 'prefixe', label: '3 premiers caractères du code postal', ph: 'G1R', type: 'text' },
    ].forEach(function (f) {
      var row = el('div', 'form-row');
      var lab = el('label', 'lbl', f.label); lab.setAttribute('for', 'p-' + f.key); row.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = f.type; inp.id = 'p-' + f.key; inp.placeholder = f.ph; inp.value = p[f.key] || '';
      if (f.key === 'prefixe') { inp.maxLength = 3; inp.className = 'uppercase'; }
      inp.addEventListener('input', function () {
        var val = f.key === 'prefixe' ? inp.value.trim().toUpperCase().slice(0, 3) : inp.value.trim();
        var patch = {}; patch[f.key] = val; profileSet(patch);
      });
      row.appendChild(inp); idFields.appendChild(row);
    });
    idCard.appendChild(idFields);
    body.appendChild(idCard);

    // Notifications card — on by default, per-kind toggles gate addNotif().
    // The toggles sit in a grid so they fill the width instead of stacking thin.
    var nCard = el('div', 'profil-card');
    nCard.appendChild(profilHead(IC_NOTIF, 'Notifications'));
    nCard.appendChild(el('p', 'help', 'Par courriel et dans l’application. Activées par défaut.'));
    var nGrid = el('div', 'profil-switches');
    [
      { key: 'published', label: 'Confirmation de publication d’une offre' },
      { key: 'reminders', label: 'Rappels à l’approche de la date' },
      { key: 'retained', label: 'Avis quand un notaire retient votre offre' },
    ].forEach(function (t) {
      var row = el('div', 'switch-row');
      var lab = el('label', 'switch');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.setAttribute('role', 'switch');
      cb.id = 'p-notif-' + t.key;
      cb.checked = p.notifs[t.key] !== false;
      cb.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
      cb.setAttribute('aria-label', t.label);
      cb.addEventListener('change', function () {
        cb.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
        var np = {}; np[t.key] = cb.checked; profileSet({ notifs: np });
      });
      lab.appendChild(cb); lab.appendChild(el('span', 'track'));
      // Control first (left), label after — toggles line up in a clean column.
      var txt = el('div'); txt.appendChild(el('div', 'switch-title', t.label));
      row.appendChild(lab); row.appendChild(txt); nGrid.appendChild(row);
    });
    nCard.appendChild(nGrid);
    body.appendChild(nCard);

    // Documents card — the full document list per service, with upload / remove /
    // mark-validated. "One profile" = coordinates + notifications + documents.
    var dCard = el('div', 'profil-card profil-docs');
    dCard.appendChild(profilHead(IC_DOCS, 'Mes documents'));
    dCard.appendChild(el('p', 'help', 'Téléversez ce que le notaire demandera. Ajoutez, retirez ou marquez « validé ». Tout reste sur votre appareil jusqu’à ce qu’un notaire retienne votre demande.'));
    // Service picker as outline chips (not a native dropdown) — matches the
    // calendar, one click to switch, on-aesthetic.
    var dchips = el('div', 'chip-group profil-doc-chips');
    dchips.setAttribute('role', 'group'); dchips.setAttribute('aria-label', 'Acte pour lequel préparer les documents');
    D.SERVICES.forEach(function (s, i) {
      var c = el('button', 'chip' + (i === 0 ? ' is-on' : ''), s.nom.split(' ')[0]);
      c.type = 'button'; c.dataset.svc = s.id; c.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      dchips.appendChild(c);
    });
    dCard.appendChild(dchips);
    var dbox = el('div', 'profil-doc-list');
    dCard.appendChild(dbox);
    dchips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      dchips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true');
      renderProfilDocs(dbox, b.dataset.svc);
    });
    renderProfilDocs(dbox, D.SERVICES[0].id);
    body.appendChild(dCard);
  }

  // Render the per-service document checklist into `container`: each item can be
  // uploaded (or typed), removed, and marked validated. Persisted in the profile.
  function renderProfilDocs(container, sid) {
    clear(container);
    var svc = D.serviceById(sid); if (!svc) return;
    var saved = dossierFor(sid);
    var valid = dossierValidated(sid);
    var items = dossierItems(svc);
    var done = items.filter(function (it) { return saved[it.id]; }).length;
    var complete = items.length > 0 && done === items.length;
    // Progress header: a labelled bar so the client sees how ready their dossier
    // is at a glance, plus a clear "complete" and a no-documents-needed state.
    var prog = el('div', 'doc-progress');
    if (complete) prog.dataset.complete = 'true';
    var count = el('div', 'doc-count', items.length
      ? (complete ? '✓ Tout est prêt · ' + done + ' / ' + items.length : done + ' / ' + items.length + ' fournis')
      : 'Aucun document requis pour cet acte.');
    if (complete) count.dataset.complete = 'true';
    prog.appendChild(count);
    if (items.length) {
      var bar = el('div', 'doc-bar');
      var fill = el('span'); fill.style.width = Math.round(done / items.length * 100) + '%';
      bar.appendChild(fill);
      prog.appendChild(bar);
    }
    container.appendChild(prog);
    if (!items.length) return;
    items.forEach(function (it) {
      var provided = !!saved[it.id];
      var row = el('div', 'doc-row');
      row.dataset.done = provided ? 'true' : 'false';
      var top = el('div', 'doc-row-top');
      top.appendChild(el('span', 'doc-row-name', it.nom));
      if (provided) {
        var vlab = el('label', 'doc-valid');
        var vcb = document.createElement('input'); vcb.type = 'checkbox'; vcb.checked = !!valid[it.id];
        vcb.setAttribute('aria-label', 'Marquer « ' + it.nom + ' » comme validé');
        vcb.addEventListener('change', function () { dossierSetValidated(sid, it.id, vcb.checked); row.dataset.valid = vcb.checked ? 'true' : 'false'; });
        vlab.appendChild(vcb); vlab.appendChild(document.createTextNode(' Validé'));
        top.appendChild(vlab);
      }
      row.appendChild(top);
      if (it.aide) row.appendChild(el('div', 'help', it.aide));
      if (it.kind === 'doc') {
        var fl = el('label', 'file-field');
        var fi = document.createElement('input'); fi.type = 'file'; fi.className = 'file-native';
        var cta = el('span', 'file-cta', provided ? 'Remplacer le fichier' : 'Choisir un fichier');
        fi.addEventListener('change', function () {
          var name = this.files && this.files[0] ? this.files[0].name : '';
          dossierSet(sid, it.id, name);
          renderProfilDocs(container, sid);
        });
        fl.appendChild(fi); fl.appendChild(cta);
        row.appendChild(fl);
        if (provided) {
          var meta = el('div', 'doc-file');
          meta.appendChild(el('span', 'doc-file-name', '📎 ' + saved[it.id]));
          var rm = el('button', 'btn btn-sm', 'Retirer'); rm.type = 'button';
          rm.addEventListener('click', function () { dossierSet(sid, it.id, ''); dossierSetValidated(sid, it.id, false); renderProfilDocs(container, sid); });
          meta.appendChild(rm);
          row.appendChild(meta);
        }
      } else {
        var ti = document.createElement('input'); ti.type = 'text'; ti.value = saved[it.id] || ''; ti.placeholder = 'Votre réponse';
        ti.setAttribute('aria-label', it.nom);
        ti.addEventListener('input', function () { dossierSet(sid, it.id, this.value.trim()); });
        ti.addEventListener('blur', function () { renderProfilDocs(container, sid); }); // reveal the "validé" affordance once filled
        row.appendChild(ti);
      }
      container.appendChild(row);
    });
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
  // The price-determining answers live in the profile too, under a reserved
  // __pricing key (so they never collide with document/field ids and are ignored
  // by leadReadiness). This is the single source of truth the booking flow reads.
  function dossierPricing(sid) { var d = dossierFor(sid); return (d && d.__pricing) || {}; }
  function dossierSetPricing(sid, critId, val) {
    var d = dossierState(); d[sid] = d[sid] || {}; d[sid].__pricing = d[sid].__pricing || {};
    if (val === undefined || val === '' || val === false) delete d[sid].__pricing[critId];
    else d[sid].__pricing[critId] = val;
    lsSave(LS_DOSSIER, d);
  }
  // Per-document "validé" flag, stored in the profile (dossier) under __validated.
  function dossierValidated(sid) { var d = dossierFor(sid); return (d && d.__validated) || {}; }
  function dossierSetValidated(sid, id, on) {
    var d = dossierState(); d[sid] = d[sid] || {}; d[sid].__validated = d[sid].__validated || {};
    if (on) d[sid].__validated[id] = true; else delete d[sid].__validated[id];
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

    // Basic questions that DETERMINE THE PRICE — saved in the client's profile
    // and shared with the booking flow. Full-width card at the top of the dossier.
    var pcrit = (svc.pricing && svc.pricing.criteria) || [];
    if (pcrit.length) {
      var pcard = el('div', 'dossier-pricing');
      var pbody = el('div', 'dossier-body');
      pbody.appendChild(el('div', 'dossier-name', 'Questions qui déterminent le prix'));
      pbody.appendChild(el('div', 'help', 'Enregistrées dans votre profil. Elles ajustent le prix de départ de cet acte.'));
      var pbox = el('div', 'o-criteria');
      var pans = dossierPricing(svc.id);
      pcrit.forEach(function (c) {
        pbox.appendChild(buildCriterionRow(c, pans[c.id], function (val) {
          dossierSetPricing(svc.id, c.id, val);
          updateDossierPrice(svc);
        }, 'dcrit-'));
      });
      pbody.appendChild(pbox);
      var priceEl = el('div', 'dossier-price'); priceEl.id = 'dossier-price';
      pbody.appendChild(priceEl);
      pcard.appendChild(pbody);
      list.appendChild(pcard);
      updateDossierPrice(svc);
    }

    dossierItems(svc).forEach(function (it) {
      var row = el('div', 'dossier-item');

      var check = el('div', 'dossier-check', '✓');
      check.dataset.on = saved[it.id] ? 'true' : 'false';

      var body = el('div', 'dossier-body');
      body.appendChild(el('div', 'dossier-name', it.nom));
      body.appendChild(el('div', 'help', it.aide));

      var input;
      if (it.kind === 'doc') {
        var fileLbl = el('label', 'file-field');
        input = document.createElement('input'); input.type = 'file'; input.className = 'file-native';
        var fileCta = el('span', 'file-cta', saved[it.id] ? 'Remplacer le fichier' : 'Choisir un fichier');
        input.addEventListener('change', function () {
          var name = this.files && this.files[0] ? this.files[0].name : '';
          dossierSet(svc.id, it.id, name);
          check.dataset.on = name ? 'true' : 'false';
          row.dataset.done = name ? 'true' : 'false';
          fileCta.textContent = name ? 'Remplacer le fichier' : 'Choisir un fichier';
          var note = body.querySelector('.file-note');
          if (name) { if (!note) { note = el('div', 'file-note'); body.appendChild(note); } note.textContent = 'Sélectionné : ' + name + ' — reste sur votre appareil.'; }
          else if (note) { note.remove(); }
          updateDossierBar();
        });
        fileLbl.appendChild(input); fileLbl.appendChild(fileCta);
        body.appendChild(fileLbl);
        if (saved[it.id]) { var fn = el('div', 'file-note', 'Sélectionné : ' + saved[it.id] + ' — reste sur votre appareil.'); body.appendChild(fn); }
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

      row.appendChild(check); row.appendChild(body);
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

  // The base price the client's profile answers determine for this act.
  function updateDossierPrice(svc) {
    var node = $('dossier-price');
    if (!node) return;
    var base = D.computeBasePrice(svc.id, dossierPricing(svc.id));
    node.textContent = 'Prix de départ déterminé : ' + D.money(base) + '.';
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
    if (badge) {
      badge.hidden = false;
      badge.textContent = done + '/' + total;
      badge.dataset.complete = r.ready ? 'true' : 'false';
    }
  }

  // Post-publish bridge: fill the "Complétez votre dossier" step with the booked
  // service's real readiness and wire its CTA to open the dossier for it.
  function fillDossierNext(serviceId) {
    var svc = D.serviceById(serviceId); if (!svc) return;
    var r = D.leadReadiness(serviceId, dossierFor(serviceId));
    var badge = $('dossier-next-badge'); if (badge) badge.textContent = r.done + '/' + r.total;
    var fill = $('dossier-next-fill'); if (fill) fill.style.width = (r.total ? Math.round((r.done / r.total) * 100) : 0) + '%';
    var h = $('dossier-next-h'), sub = $('dossier-next-sub'), cta = $('dossier-next-cta');
    if (r.ready) {
      if (h) h.textContent = 'Dossier complet ✓';
      if (sub) sub.textContent = 'Votre demande est prête à être retenue immédiatement.';
      if (cta) cta.textContent = 'Revoir mon dossier';
    } else {
      if (h) h.textContent = 'Complétez votre dossier';
      if (sub) sub.textContent = 'Les demandes au dossier complet sont retenues en priorité par les notaires.';
      if (cta) cta.textContent = 'Compléter mon dossier';
    }
    if (cta) cta.onclick = function () { openDossier(serviceId); };
  }

  // Jump from a booked offer straight into its dossier: close the day dialog,
  // preselect the service, open the tab.
  function openDossier(serviceId) {
    var dlg = $('day-dialog'); if (dlg && dlg.open && dlg.close) dlg.close();
    if (serviceId && D.serviceById(serviceId)) $('d-service').value = serviceId;
    setTab('dossier');
  }

  // ---------------------------------------------------------------------------
  // Notary form
  // ---------------------------------------------------------------------------
  // "Get paid": connect a Stripe payout account, driven by the signed-in notary's
  // email (the sign-up + console are one door now). Reuses /notaries/connect.
  async function ncConnectPayout() {
    if (!nc.email) { toast('Connectez-vous d’abord à votre console.'); return; }
    var box = $('notary-connect-errors');
    var btn = $('notary-connect');
    if (box) box.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Redirection…'; }
    function fail(msg) {
      if (box) { clear(box); box.hidden = false; box.appendChild(el('li', null, msg)); }
      if (btn) { btn.disabled = false; btn.textContent = 'Connecter mon compte de paiement'; }
    }
    try {
      var r = await fetch(API_BASE + '/notaries/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: nc.email }),
      });
      var j = await r.json();
      if (r.ok && j.url) { window.location.href = j.url; return; }
      fail((j.errors && j.errors[0] && j.errors[0].message) || 'Connexion du compte indisponible pour le moment.');
    } catch (err) { fail('Hors ligne — réessayez.'); }
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
  function ncRetainedUpdate(email, id, patch) {
    var list = ncRetainedFor(email).map(function (e) {
      return e.id === id ? Object.assign({}, e, patch) : e;
    });
    ncRetainedSave(email, list);
  }

  // A notary marks a retained act completed with its final value → the API
  // charges Nota's commission (Stripe Connect application fee) and returns the
  // real commission in cents (never a client-side rate). Session bearer only.
  async function ncCompleteAct(id, actAmount, btn) {
    if (!nc.token) return;
    var amt = Number(actAmount);
    if (!(amt > 0)) { toast('Montant de l’acte invalide.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    function restore() { if (btn) { btn.disabled = false; btn.textContent = 'Marquer complété'; } }
    var r;
    try {
      r = await fetch(API_BASE + '/notary/acts/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify({ bidId: id, actAmount: amt }),
      });
    } catch (e) { toast('Action impossible (hors ligne).'); restore(); return; }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200 || !j.ok) {
      toast((j.errors && j.errors[0] && j.errors[0].message) || 'Impossible de compléter l’acte.');
      restore(); return;
    }
    ncRetainedUpdate(nc.email, id, { completed: true, actAmount: amt, commissionCents: j.commissionCents || 0 });
    ncRenderRetained();
    toast('Acte complété. Commission Nota : ' + D.money((j.commissionCents || 0) / 100) + '.');
  }

  // Build the webcal:// subscription URL from the API base. A relative '/api'
  // base is resolved against the current origin first, then the scheme swapped.
  // `token` must be the read-only FEED token — never the session token.
  function ncFeedUrl(token) {
    return toWebcal(apiBaseAbs() + '/notary/feed.ics?token=' + encodeURIComponent(token));
  }

  // Point the hero "add to your calendar" card at the PUBLIC carnet feed. One
  // click subscribes the whole carnet (all open dates, kept in sync) into the
  // visitor's Google / Outlook / Apple calendar; .ics covers everything else.
  function wireCarnetSubscribe() {
    var http = apiBaseAbs() + '/carnet/feed.ics';
    var webcal = toWebcal(http);
    var name = 'Nota — carnet Québec';
    function set(id, href) { var a = $(id); if (a) a.href = href; }
    set('sub-ics', http);
    set('sub-apple', webcal);
    set('sub-google', 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal));
    set('sub-outlook', 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(http) + '&name=' + encodeURIComponent(name));
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
    var loaded = await ncLoadBids();
    if (loaded) toast('Console ouverte pour ' + email + '.');
    return { ok: true };
  }

  async function ncLoadBids() {
    if (!nc.token) return false;
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids', {
        headers: { accept: 'application/json', authorization: 'Bearer ' + nc.token },
      });
    } catch (e) {
      // A failed load must NOT read as "no open requests" (blank region) — show
      // the error in-region and report failure so callers don't toast success.
      nc.open = []; ncRenderOpen();
      var empty = $('notary-open-empty');
      if (empty) { empty.textContent = 'Impossible de charger les demandes (hors ligne). Réessayez.'; empty.hidden = false; }
      return false;
    }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return false; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    nc.open = j.bids || [];
    ncRenderOpen();
    return true;
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
      // Full sync options for the notary's retained-signings feed (like the
      // public carnet card): Google / Outlook / Apple / iCal, all from the
      // read-only FEED token.
      if (nc.feedToken) {
        var http = apiBaseAbs() + '/notary/feed.ics?token=' + encodeURIComponent(nc.feedToken);
        var webcal = toWebcal(http);
        var name = 'Nota — signatures retenues';
        var set = function (id, href) { var a = $(id); if (a) a.href = href; };
        set('notary-webcal', http);
        set('notary-apple', webcal);
        set('notary-google', 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal));
        set('notary-outlook', 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(http) + '&name=' + encodeURIComponent(name));
      }
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
    if (b.complexity) meta.appendChild(ncComplexityPill(b.complexity));
    card.appendChild(meta);

    // The parameters that make this file easy or hard — so the notary knows if
    // the posted price fits a simple or a complex case before retaining it.
    if (b.complexity && b.complexity.factors && b.complexity.factors.length) {
      card.appendChild(el('div', 'nc-factors', 'Facteurs : ' + b.complexity.factors.join(' · ')));
    }

    var actions = el('div', 'nc-card-actions');
    var acc = el('button', 'btn btn-sm btn-primary nc-accept', 'Retenir'); acc.type = 'button';
    var dec = el('button', 'btn btn-sm nc-decline', 'Décliner'); dec.type = 'button';
    actions.appendChild(acc); actions.appendChild(dec);
    card.appendChild(actions);
    return card;
  }

  function ncComplexityPill(c) {
    var labels = { simple: 'Cas simple', standard: 'Standard', complexe: 'Cas complexe' };
    var pill = el('span', 'nc-complexity', labels[c.level] || c.level);
    pill.dataset.level = c.level;
    return pill;
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

  // The "mark act completed" block on each retained dossier card. Once done, it
  // shows a badge with the true commission the API charged.
  function ncCompleteBlock(entry) {
    var wrap = el('div', 'nc-complete');
    if (entry.completed) {
      var done = el('div', 'nc-complete-done');
      done.appendChild(el('span', 'nc-done-badge', 'Acte complété'));
      done.appendChild(el('span', 'nc-done-fee',
        'Valeur ' + D.money(entry.actAmount) + ' · commission Nota ' + D.money((entry.commissionCents || 0) / 100)));
      wrap.appendChild(done);
      return wrap;
    }
    wrap.appendChild(el('div', 'nc-complete-h', 'Acte signé ? Confirmez la valeur finale'));
    var row = el('div', 'nc-complete-row');
    var lbl = el('label', 'nc-complete-lbl'); // wraps input → implicit a11y, no id needed
    lbl.appendChild(el('span', 'nc-complete-cap', 'Valeur de l’acte'));
    var input = el('input', 'nc-actval');
    input.type = 'number'; input.min = '1'; input.step = '1'; input.setAttribute('inputmode', 'numeric');
    input.value = String(entry.montant != null ? entry.montant : '');
    lbl.appendChild(input);
    var btn = el('button', 'btn btn-sm btn-primary nc-complete-btn', 'Marquer complété');
    btn.type = 'button';
    row.appendChild(lbl); row.appendChild(btn);
    wrap.appendChild(row);
    wrap.appendChild(el('p', 'help', 'Nota prélève sa commission uniquement à cette étape, sur la valeur confirmée.'));
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
    card.appendChild(ncCompleteBlock(entry));
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

  // Explicit sign-out purges the cached retained client PII (courriel/dossier),
  // not just the tokens. NOT done in ncExpire — a transient 401 calls that too
  // and must not destroy the notary's only client-side copy.
  function ncSignOut() { try { localStorage.removeItem(LS_NC_RETAINED); } catch (e) {} ncExpire('Déconnecté.'); }

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
    ['carnet', 'dossier', 'notaires', 'profil', 'confidentialite', 'conditions', 'charte'].forEach(function (t) {
      var pane = $('pane-' + t);
      if (!pane) return;
      var active = t === tab;
      pane.classList.toggle('is-active', active);
      pane.hidden = !active;
    });
    if (tab === 'dossier') renderDossier();
    if (tab === 'profil') renderProfil();
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'auto' });
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
    var panel = $('carnet-panel');
    if (panel) panel.classList.add('is-loading');
    try {
      state.monthBids = await store.listMonth(monthKey(state.anchor));
    } finally {
      if (panel) panel.classList.remove('is-loading');
    }
  }
  function refreshMonth() { renderActiveView(); }
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

    // Notification bell
    $('notif-bell').addEventListener('click', function (e) { e.stopPropagation(); toggleNotifPanel(); });
    $('notif-clear').addEventListener('click', markAllRead);
    $('notif-panel').addEventListener('click', function (e) { e.stopPropagation(); });
    // Account-menu items → switch pane, then close the menu.
    $('acct-profil').addEventListener('click', function () { setTab('profil'); toggleNotifPanel(false); });
    $('acct-confid').addEventListener('click', function () { setTab('confidentialite'); toggleNotifPanel(false); });
    $('acct-conditions').addEventListener('click', function () { setTab('conditions'); toggleNotifPanel(false); });
    $('acct-charte').addEventListener('click', function () { setTab('charte'); toggleNotifPanel(false); });
    // Delegated in-content / footer links that jump to a tab-pane by name.
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('.goto-link[data-goto]');
      if (!g) return;
      e.preventDefault(); setTab(g.dataset.goto); toggleNotifPanel(false);
    });
    document.addEventListener('click', function () { toggleNotifPanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggleNotifPanel(false); });

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
    var vsw = $('view-switch');
    if (vsw) {
      vsw.addEventListener('click', function (e) { var b = e.target.closest('.seg-btn[data-view]'); if (!b) return; setView(b.dataset.view); b.focus(); });
      vsw.addEventListener('keydown', function (e) {
        var d = { ArrowLeft: -1, ArrowRight: 1 };
        if (!(e.key in d) && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        var i = VIEWS.indexOf(state.view); if (i < 0) i = 0;
        if (e.key === 'Home') i = 0; else if (e.key === 'End') i = VIEWS.length - 1; else i = (i + d[e.key] + VIEWS.length) % VIEWS.length;
        setView(VIEWS[i]); var t = $('tab-view-' + VIEWS[i]); if (t) t.focus();
      });
    }
    var fsaX = $('fsa-active');
    if (fsaX) fsaX.addEventListener('click', function () { state.filters.prefixe = ''; writeHash(); renderActiveView(); });

    // Filters stay collapsed until the customer opens them from the toolbar.
    $('filters-toggle').addEventListener('click', function () {
      var panel = $('filters');
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      this.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    // Expand the calendar to true full screen (Fullscreen API) rather than a
    // wider in-page mode. The button reflects state via fullscreenchange.
    $('cal-maximize').addEventListener('click', function () {
      var panel = $('carnet-panel'); if (!panel) return;
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      } else {
        (panel.requestFullscreen || panel.webkitRequestFullscreen || function () {}).call(panel);
      }
    });
    function onFullscreenChange() {
      var panel = $('carnet-panel');
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      var btn = $('cal-maximize');
      if (panel) panel.classList.toggle('is-fullscreen', on);
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var lbl = on ? 'Quitter le plein écran' : 'Plein écran';
        btn.setAttribute('aria-label', lbl); btn.setAttribute('title', lbl);
      }
      renderActiveView(); // reflow the active view to the new viewport
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    // Legal pages (Confidentialité / Conditions / Charte) are reached via the
    // account menu and the footer's .goto-link handler wired above.

    // Offer form
    $('o-service').addEventListener('change', onOfferServiceChange);
    // Service chips drive the hidden #o-service select (keeps its tested options).
    $('o-service-chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      setGroupActive(this, b);
      $('o-service').value = b.dataset.svc;
      onOfferServiceChange();
    });
    $('o-date').addEventListener('change', onOfferDateChange);
    $('o-date').addEventListener('input', onOfferDateChange);
    $('o-amount').addEventListener('input', onAmountChange);
    $('o-anon').addEventListener('change', onAnonToggle);
    $('o-prefix').addEventListener('input', validateOfferUI);
    $('o-courriel').addEventListener('input', validateOfferUI);
    $('offer-form').addEventListener('submit', onOfferSubmit);
    $('o-date').setAttribute('min', todayISO());

    // Day booking dialog
    $('day-close').addEventListener('click', function () { $('day-dialog').close(); });
    $('day-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('day-dialog').addEventListener('close', function () {
      var c = document.querySelector('.cal-cell[data-date="' + state.focusDate + '"]');
      if (c) c.focus();
    });

    // Reveal dialog
    $('reveal-confirm').addEventListener('click', function () { $('reveal-dialog').close(); commitAnon(false); });
    $('reveal-cancel').addEventListener('click', function () { $('reveal-dialog').close(); commitAnon(true); });
    $('reveal-dialog').addEventListener('cancel', function () { commitAnon(true); });

    // Dossier
    $('d-service').addEventListener('change', renderDossier);

    // Notary
    var ncPay = $('notary-connect'); if (ncPay) ncPay.addEventListener('click', ncConnectPayout);

    // Notary console
    var ncForm = $('notary-auth-form');
    if (ncForm) ncForm.addEventListener('submit', function (e) { e.preventDefault(); ncSignIn($('nc-email').value); });
    var ncOut = $('notary-signout'); if (ncOut) ncOut.addEventListener('click', ncSignOut);
    var ncRef = $('notary-refresh'); if (ncRef) ncRef.addEventListener('click', function () { ncLoadBids().then(function (ok) { if (ok) toast('Demandes rafraîchies.'); }); });
    var ncOpenList = $('notary-open-list');
    if (ncOpenList) ncOpenList.addEventListener('click', function (e) {
      var card = e.target.closest('.nc-card'); if (!card) return;
      var id = card.dataset.id;
      var b = nc.open.filter(function (x) { return x.id === id; })[0]; if (!b) return;
      if (e.target.closest('.nc-accept')) ncAccept(id, b.dateISO, b);
      else if (e.target.closest('.nc-decline')) ncDecline(id, b.dateISO);
    });

    var ncRetList = $('notary-retained-list');
    if (ncRetList) ncRetList.addEventListener('click', function (e) {
      var btn = e.target.closest('.nc-complete-btn'); if (!btn) return;
      var card = e.target.closest('.nc-card'); if (!card) return;
      var input = card.querySelector('.nc-actval');
      ncCompleteAct(card.dataset.id, input ? input.value : '', btn);
    });

    // Hero CTAs — orient the buyer immediately
    var ctaR = $('cta-reserver');
    if (ctaR) ctaR.addEventListener('click', function () {
      setTab('carnet', { scroll: false });
      openDay(state.selectedDate || state.focusDate || todayISO());
    });
    var ctaV = $('cta-voir');
    if (ctaV) ctaV.addEventListener('click', function () {
      var panel = $('carnet-panel');
      if (panel) panel.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    populateServiceSelects();
    buildServiceChips();
    buildBookingChips();
    readHash();
    syncFilterChips();
    // If a shared link pre-selects filters, reveal the (otherwise hidden) panel.
    if (filtersActive()) { $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true'); }
    renderLegend();
    wire();
    wireCarnetSubscribe();

    // Restore theme preference
    var savedTheme = lsLoad('nota.theme'); if (savedTheme) setTheme(savedTheme);

    // Initialize offer form
    onOfferServiceChange();
    if (state.selectedDate) { $('o-date').value = state.selectedDate; onOfferDateChange(); }

    // Paint the active view immediately (setView also applies the initial
    // tab/panel visibility, honouring a `vue=` deep link), then repaint on fetch.
    setView(state.view);
    await refreshMonthData();
    renderActiveView();

    // Restore a stored notary session (no fetch unless a token is present).
    ncRestore();

    // In-app notifications: render what's stored, then derive fresh events
    // (date-approaching / retained) from this browser's own offers.
    renderNotifs();
    computeNotifications();

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
    setView: setView,
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
      complete: ncCompleteAct,
      feedUrl: ncFeedUrl,
      retainedFor: ncRetainedFor,
    },
    _internals: { applyFilters: applyFilters, acceptance: acceptance, buildCalendarLinks: buildCalendarLinks },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
