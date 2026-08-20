/* =============================================================================
   Nota web app. Vanilla, zero runtime dependencies.
   Business rules come from window.NotaDomain (@nota/domain) — never duplicated.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.NotaDomain;
  if (!D) { console.error('NotaDomain missing'); return; }

  // English side of the few user-facing strings the i18n DOM observer cannot
  // reach: confirm(), data-* attributes rendered by CSS content, and calendar
  // link payloads. Everything else stays canonical French — see i18n.js.
  var T = function (s) { return window.NotaI18N ? window.NotaI18N.t(s) : s; };

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

  // LOCAL calendar date (Québec), not the UTC slice — otherwise every evening in
  // UTC-4/-5 "today" would roll to tomorrow, mis-marking is-today and blocking the
  // current local day. Display formatters keep timeZone:'UTC' on the ISO date.
  var todayISO = function () { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  // ---------------------------------------------------------------------------
  // store shim. Interface: listMonth(month) -> [bid]; createBid(payload) -> res.
  // Backing is the API when reachable, else localStorage seeded with domain
  // fixtures so the carnet is populated offline. Replacing the backing must not
  // change this interface — apps/web depends only on these two methods.
  // ---------------------------------------------------------------------------
  var LS_BIDS = 'nota.bids.v1';
  var LS_BIDS_SIG = 'nota.bids.sig.v1';

  function lsLoad(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  // Scalar flags (plain strings, not JSON) with an in-memory fallback. A
  // locked-down browser (Safari private mode) throws on write, and a guide that
  // cannot remember it was dismissed would re-greet on every navigation — the
  // fallback at least holds the decision for the session.
  var memFlags = {};
  function flagGet(k) {
    try { var v = localStorage.getItem(k); if (v != null) return v; } catch (e) {}
    return Object.prototype.hasOwnProperty.call(memFlags, k) ? memFlags[k] : null;
  }
  function flagSet(k, v) {
    memFlags[k] = String(v);
    try { localStorage.setItem(k, String(v)); } catch (e) {}
  }
  function flagClear(k) {
    delete memFlags[k];
    try { localStorage.removeItem(k); } catch (e) {}
  }
  function ensureSeed() {
    var a = lsLoad(LS_BIDS);
    var sig = D.seedSignature();
    // A seed from an older pricing model would put medians below today's
    // floors — rebuild the demo data whenever the pricing shape changes.
    if (!a || flagGet(LS_BIDS_SIG) !== sig) { a = D.makeFixtures(todayISO()); lsSave(LS_BIDS, a); flagSet(LS_BIDS_SIG, sig); }
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
          if (r.status === 201) return { ok: true, bid: j.bid, checkoutUrl: j.checkoutUrl || null, paymentStatus: j.paymentStatus || null };
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
  // Resting state of the carnet filters. The carnet opens on what is still
  // WINNABLE — a client comes to see what others offered and what it takes to be
  // retained, not to be told upfront how much was already taken. Retained offers
  // stay one click away under "Retenues".
  // This is also what activeFilterCount() compares against: a default is not a
  // choice the client made, so it must not light the badge or spring the panel.
  var FILTER_DEFAULTS = { service: '', statut: 'ouverte', min: null, max: null, sort: 'montant-desc' };

  var state = {
    anchor: firstOfMonth(todayISO()),
    monthBids: [],
    filters: Object.assign({}, FILTER_DEFAULTS),
    selectedDate: null,
    focusDate: todayISO(),
    tab: 'carnet',
    offer: { serviceId: '', dateISO: '', montant: 0, anonyme: true, pricing: {} },
  };

  // Carnet view ids (segmented switcher).
  // Order matters: the FIRST entry is the fallback for an unknown view, and the
  // switcher renders in this order. The list leads.

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
  // Dates follow the interface language (NotaI18N); French remains the default.
  var LOCALE = (window.NotaI18N && window.NotaI18N.locale()) || 'fr-CA';
  var fmtMonth = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  var fmtMonthOnly = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' });
  var fmtMonthShort = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' });
  var fmtDayLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  var fmtDayShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function monthTitle(anchor) { return fmtMonth.format(new Date(anchor + 'T00:00:00Z')); }
  function dayTitle(iso) { return fmtDayLong.format(new Date(iso + 'T00:00:00Z')); }
  function dayShort(iso) { return fmtDayShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, ''); }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  // "3×" / "1,4×" — decimal comma in French, point in English; no pointless ",0".
  function multLabel(m) {
    var s = (Math.round(m * 10) / 10).toFixed(1).replace(/,?\.0$/, '');
    return (LOCALE === 'fr-CA' ? s.replace('.', ',') : s) + '×';
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------------------
  // Mini icon buttons — the small round actions that sit on a component (an
  // offer row, a pulse row, a notary card). One primitive so every one of them
  // has the same size, hit area, tooltip and accessible name; the icon alone is
  // never the label (screen readers get the full sentence).
  // ---------------------------------------------------------------------------
  // One glyph per act, so a service is recognised before its name is read. Keyed
  // by the domain's service ids; adding an act without a glyph falls back to the
  // colour dot rather than rendering nothing.
  var SVC_ICONS = {
    // A signed sheet: a will and a protection mandate are written and signed.
    testament: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M8 8h6M8 12h4"/><path d="M19.5 11.5 21 13l-5 5-2 .5.5-2z"/>',
    // A stamped seal: a power of attorney is authority delegated under seal.
    procuration: '<circle cx="12" cy="9" r="4.5"/><path d="M9.2 12.8 8 21l4-2 4 2-1.2-8.2"/>',
    // A house with a key line: refinancing is a mortgage on a home.
    refinancement: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  };
  function svcIcon(id, size) {
    if (!SVC_ICONS[id]) return null;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var px = String(size || 14);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', px); svg.setAttribute('height', px);
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'svc-ic');
    svg.innerHTML = SVC_ICONS[id];
    return svg;
  }

  var MINI_ICONS = {
    agenda: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 13v4M10 15h4"/>',
    partager: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    reserver: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    telephone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    courriel: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  };

  function miniIcon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = MINI_ICONS[name] || '';
    return svg;
  }

  // `onClick` omitted → an <a> (href set by the caller), so a download or a
  // tel:/mailto: link keeps its native behaviour instead of being faked.
  function miniBtn(name, label, onClick) {
    var b = el(onClick ? 'button' : 'a', 'mini-btn mini-' + name);
    if (onClick) { b.type = 'button'; b.addEventListener('click', onClick); }
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(miniIcon(name));
    return b;
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
  // Once we ever observe an offer retained, persist it on the myOffers entry so the
  // "Approuvé" status survives navigating away from that offer's month.
  function markMyOfferRetained(id) {
    var a = myOffers(); var changed = false;
    a.forEach(function (o) { if (o.id === id && !o.retained) { o.retained = true; changed = true; } });
    if (changed) lsSave(LS_MYOFFERS, a);
  }
  // The live status of one of the client's own offers: retained by a notary
  // (approved), still open past its date (expired), or waiting (pending). The
  // retained flag is checked first so status is correct in ANY loaded month, not
  // only the anchor month whose bids happen to be in state.monthBids.
  function clientOfferStatus(o) {
    if (o.retained) return 'approved';
    var pub = (state.monthBids || []).filter(function (b) { return b.id === o.id; })[0];
    if (pub && pub.status === D.STATUS.RETENUE) { markMyOfferRetained(o.id); return 'approved'; }
    if (D.daysBetween(todayISO(), o.dateISO) < 0) return 'expired';
    return 'pending';
  }
  var OFFER_STATUS_LABEL = { approved: '✓ Approuvée', pending: 'En attente', expired: 'Expirée' };
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
  // Dismissing keeps the entry (flagged) rather than deleting it: notifications
  // are derived idempotently by `key`, so a deleted one would only come back on
  // the next derive pass.
  function dismissNotif(key) {
    var a = notifLoad();
    a.forEach(function (x) { if (x.key === key) { x.dismissed = true; x.read = true; } });
    notifSave(a);
    renderNotifs();
  }
  function renderNotifs() {
    var list = $('notif-list'); if (!list) return;
    var a = notifLoad().filter(function (x) { return !x.dismissed; });
    var unread = a.filter(function (x) { return !x.read; }).length;
    var badge = $('notif-badge');
    // Notifications are personal — an anonymous visitor sees none (no badge, no list).
    var isAnon = accountRole() === 'anon';
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.hidden = isAnon || unread === 0; }
    var bell = $('notif-bell'); if (bell) bell.classList.toggle('has-unread', !isAnon && unread > 0);
    clear(list);
    if (!a.length) { list.appendChild(el('div', 'notif-empty', 'Aucune notification pour le moment.')); return; }
    a.forEach(function (n) {
      var item = el('div', 'notif-item' + (n.read ? '' : ' is-unread'));
      item.appendChild(el('div', 'notif-title', n.title));
      if (n.body) item.appendChild(el('div', 'notif-body', n.body));
      // Per-item dismiss: a small ✕ that never triggers the row's own action.
      var x = el('button', 'notif-x', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Ignorer cette notification');
      x.title = 'Ignorer';
      x.addEventListener('click', function (e) { e.stopPropagation(); dismissNotif(n.key); });
      item.appendChild(x);
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
    if (open) {
      renderNotifs(); renderAccountMenu();
      // Menu-button contract: opening hands focus to the first row, so a
      // keyboard user is IN the menu they just opened, not still on the trigger.
      var first = acctMenuItems()[0];
      if (first) { try { first.focus(); } catch (e) {} }
    }
  }
  // The rows a keyboard user can walk inside the account panel, in DOM order.
  // Skips disabled/hidden rows and, for an anonymous visitor, the notifications
  // block that the CSS hides (jsdom sees no computed styles, so check the state).
  function acctMenuItems() {
    var panel = $('notif-panel'); if (!panel) return [];
    var anon = panel.dataset.role === 'anon';
    var notifs = $('acct-notifs');
    return Array.prototype.filter.call(panel.querySelectorAll('button, .notif-item[role="button"]'), function (b) {
      if (b.disabled || b.hidden) return false;
      if (anon && notifs && notifs.contains(b)) return false;
      var n = b.parentElement;
      while (n && n !== panel) { if (n.hidden) return false; n = n.parentElement; }
      return true;
    });
  }
  // The account menu is one identity hub for BOTH roles. Priority: an active
  // notary session outranks a device-local client identity, which outranks the
  // anonymous visitor.
  // What the visitor SAID they are, remembered across visits. Distinct from
  // accountRole() below, which is derived from a real session — this is only a
  // preference, used to open the right door (auth modal, onboarding guide).
  var LS_ROLE = 'nota.role.v1';
  function roleGet() { var r = flagGet(LS_ROLE); return r === 'notary' || r === 'client' ? r : ''; }
  function roleSet(role) { if (role === 'notary' || role === 'client') flagSet(LS_ROLE, role); }

  function accountRole() {
    if (nc && nc.token) return 'notary';
    if (profileGet().courriel) return 'client';
    return 'anon';
  }

  // Small inline icon for an account-menu action row (18px, currentColor).
  var ACCT_ICONS = {
    profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    offers: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/>',
    dossiers: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    notaire: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    publier: '<path d="M12 5v14M5 12h14"/>',
    signin: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/>',
    signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    guide: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  };
  function acctIcon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ACCT_ICONS[name] || '';
    return svg;
  }
  function acctAction(icon, label, onClick) {
    var b = el('button', 'acct-item acct-action'); b.type = 'button';
    b.appendChild(acctIcon(icon));
    b.appendChild(el('span', 'acct-item-title', label));
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Sign-in / sign-up modal (one door for client AND notary) --------------
  // A role toggle + social options (OAuth not wired yet) + a passwordless courriel
  // path. Client → device-local identity; notary → the existing /notary/session.
  var authRole = 'client';
  function authSetRole(role) {
    authRole = role === 'notary' ? 'notary' : 'client';
    document.querySelectorAll('#auth-role .seg-btn').forEach(function (b) {
      var on = b.dataset.role === authRole;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var fine = $('auth-fine'), cont = $('auth-continue');
    if (authRole === 'notary') {
      if (fine) fine.textContent = 'Accédez aux demandes ouvertes à Québec. Sans mot de passe.';
      if (cont) cont.textContent = 'Accéder à l’espace notaire →';
    } else {
      if (fine) fine.textContent = 'Publiez une demande et suivez vos offres. Vos renseignements restent sur cet appareil.';
      if (cont) cont.textContent = 'Continuer →';
    }
  }
  function openAuthModal(role) {
    authSetRole(role || roleGet() || 'client'); // honour what they told the guide
    var errs = $('auth-errors'); if (errs) errs.hidden = true;
    var em = $('auth-email'); if (em) em.value = profileGet().courriel || '';
    var dlg = $('auth-dialog');
    toggleNotifPanel(false);
    if (dlg && dlg.showModal) {
      try { dlg.showModal(); } catch (e) { /* already open */ }
      setTimeout(function () { try { (em || dlg).focus(); } catch (e) {} }, 30);
    } else { // jsdom / no <dialog> support: fall back to the profile identity path
      setTab('profil', { focus: false });
      var f = $('p-courriel'); if (f) { try { f.focus(); } catch (e) {} }
    }
  }
  // Kept as the anonymous "sign in" entry point (name referenced elsewhere).
  function openClientSignIn() { openAuthModal('client'); }

  function authSocial(provider) {
    // Real OAuth (Google/Facebook/LinkedIn) needs provider apps + a backend; not
    // wired yet. Surface the option honestly and steer to the courriel path.
    toast('La connexion ' + provider + ' arrive bientôt. Continuez avec votre courriel pour l’instant.');
    var em = $('auth-email'); if (em) { try { em.focus(); } catch (e) {} }
  }
  function authSubmitEmail(e) {
    if (e && e.preventDefault) e.preventDefault();
    var em = $('auth-email'), errs = $('auth-errors');
    var val = em ? em.value.trim() : '';
    if (!val || !D.isEmail(val)) {
      if (errs) { clear(errs); errs.hidden = false; errs.appendChild(el('li', null, 'Entrez un courriel valide.')); }
      return;
    }
    if (errs) errs.hidden = true;
    var dlg = $('auth-dialog');
    if (authRole === 'notary') {
      if (dlg && dlg.close) { try { dlg.close(); } catch (e) {} }
      setTab('notaires', { focus: false });
      var ncEmail = $('nc-email'); if (ncEmail) ncEmail.value = val;
      ncSignIn(val); // existing /notary/session flow (offers free signup when new)
      return;
    }
    profileSet({ courriel: val });               // client identity is device-local
    // Fire-and-forget welcome email (conversion nudge). Idempotent server-side,
    // so re-signing in never re-sends; never blocks or breaks the UI on failure.
    try {
      fetch(API_BASE + '/client/welcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courriel: val }),
      }).catch(function () {});
    } catch (e) {}
    if (dlg && dlg.close) { try { dlg.close(); } catch (e) {} }
    renderAccountMenu();
    computeNotifications();
    toast('Bienvenue ! Vous êtes connecté comme ' + val + '.');
    setTab('profil', { focus: false });
  }

  // The offer flow entry point used elsewhere (hero CTA): the carnet with a day open.
  function openOfferFlow() {
    toggleNotifPanel(false);
    setTab('carnet', { scroll: false });
    openDay(state.selectedDate || state.focusDate || todayISO());
  }

  // ---------------------------------------------------------------------------
  // First-visit onboarding guide
  // ---------------------------------------------------------------------------
  // A tiny two-view <dialog>: pick a role, read a 3-step explanation, then land
  // in the real flow. Auto-shows once (gated by LS_ONBOARDED); re-openable from
  // the footer. Copy lives here (data-driven) so nothing is baked into markup.
  var LS_ONBOARDED = 'nota.onboarded.v1';
  var LS_ONB_DISMISS = 'nota.onboarded.dismissed.v1';
  // Escape / backdrop / ✕ are ambiguous — a mis-click should not burn the guide
  // forever. Count those dismissals and grant one more showing before we stop
  // asking; an explicit "Passer" or a completed CTA ends it immediately.
  var ONB_MAX_DISMISSALS = 2;
  var ONB_ICONS = {
    calendrier: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    prix: '<path d="M20 12V7a2 2 0 0 0-2-2h-5L3 15l6 6 10-9z"/><circle cx="15.5" cy="8.5" r="1.2"/>',
    retenu: '<path d="M20 6 9 17l-5-5"/>',
    liste: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    main: '<path d="M18 11V6a1.5 1.5 0 0 0-3 0M15 11V4.5a1.5 1.5 0 0 0-3 0V11M12 11V6a1.5 1.5 0 0 0-3 0v8"/><path d="M9 14 7.4 12.4A1.6 1.6 0 0 0 5 14.7l3 3.3a5 5 0 0 0 4 2h1a5 5 0 0 0 5-5v-4"/>',
    acte: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  };
  // Steps + CTA per role. The buyer publishes; the notary browses open demands.
  var ONB_FLOWS = {
    client: {
      title: 'Trouvez votre notaire en 3 étapes',
      // The model, said right: the CLIENT posts the offer; a notary retains
      // it. Nobody bids back at the client.
      sub: 'Vous publiez votre demande ; un notaire de Québec la retient.',
      cta: 'Publier ma demande →',
      alt: 'Explorer le carnet d’abord',
      steps: [
        { icon: 'calendrier', t: 'Choisissez votre date', d: 'sur le calendrier public.' },
        { icon: 'prix', t: 'Proposez votre prix', d: 'plus l’échéance est proche, plus votre offre pèse.' },
        { icon: 'retenu', t: 'Un notaire vous retient', d: 'payé à la signature, gratuit pour vous.' },
      ],
    },
    notary: {
      title: 'Recevez des dossiers en 3 étapes',
      sub: 'Vous choisissez les demandes qui vous conviennent.',
      cta: 'Voir les demandes →',
      alt: 'Explorer le carnet d’abord',
      steps: [
        { icon: 'liste', t: 'Voyez les demandes ouvertes', d: 'à Québec, triées par date.' },
        { icon: 'main', t: 'Retenez celle qui vous convient', d: 'le dossier du client s’ouvre.' },
        { icon: 'acte', t: 'Complétez l’acte', d: 'commission seulement sur ce qui se conclut.' },
      ],
    },
  };

  function onbIcon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17'); svg.setAttribute('height', '17');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ONB_ICONS[name] || '';
    return svg;
  }

  function onbSeen() { return !!flagGet(LS_ONBOARDED); }
  function onbMarkSeen() { flagSet(LS_ONBOARDED, '1'); }
  function onbDismissals() { return Number(flagGet(LS_ONB_DISMISS) || 0) || 0; }

  // The guide's funnel, counted locally: shown → role_client/role_notary →
  // completed/explored, plus skipped (Passer) and deferred (✕/Esc/backdrop).
  // Counters only — no PII, no network; local for the demo, a deployment
  // would drain them into its analytics. Read via Nota.onboarding.stats().
  var LS_ONB_STATS = 'nota.onb.stats.v1';
  function onbCount(key) {
    var s = lsLoad(LS_ONB_STATS) || {};
    s[key] = (Number(s[key]) || 0) + 1;
    lsSave(LS_ONB_STATS, s);
  }
  function onbStats() { return lsLoad(LS_ONB_STATS) || {}; }

  // One rule for "is the guide on screen", not two implementations of it.
  function onbDialogOpen() {
    var dlg = $('onboarding-dialog');
    return !!(dlg && dlg.open);
  }

  // VIEW 1 (role choice). Both views live in the DOM; we just show/hide.
  function onbShowRoleView() {
    // Drop the parked role and point the accessible name back at THIS view's
    // heading — the VIEW 2 heading is about to be hidden.
    var dlg = $('onboarding-dialog');
    if (dlg) { dlg.removeAttribute('data-role'); dlg.setAttribute('aria-labelledby', 'onb-title'); }
    var r = $('onb-view-role'), s = $('onb-view-steps');
    if (r) r.hidden = false;
    if (s) s.hidden = true;
    // "← Changer" hides the control that held focus; put it on the first role
    // card so a keyboard/SR user is never dropped to <body>. Only when the
    // dialog is actually open — this also runs while preparing to open it.
    if (dlg && dlg.open) {
      var first = r && r.querySelector('.onb-choice');
      if (first) { try { first.focus(); } catch (e) {} }
    }
    renderOnbWeekAnim(); // (re)start the live board when this view is on screen
  }

  // VIEW 2 (steps) for the chosen role — swaps the title/sub, rebuilds the step
  // list, and sets the CTA label. The picked role is parked on the dialog so the
  // CTA knows where to route.
  function onbShowStepsView(role) {
    var flow = ONB_FLOWS[role]; if (!flow) return;
    roleSet(role); // remember it beyond this modal — the auth modal reads it back
    var dlg = $('onboarding-dialog');
    if (dlg) { dlg.setAttribute('data-role', role); dlg.setAttribute('aria-labelledby', 'onb-steps-title'); }
    var title = $('onb-steps-title'); if (title) title.textContent = flow.title;
    var sub = $('onb-steps-sub'); if (sub) sub.textContent = flow.sub;
    var list = $('onb-steps');
    if (list) {
      clear(list);
      flow.steps.forEach(function (st, i) {
        var li = el('li', 'onb-step');
        li.appendChild(el('span', 'onb-step-n', String(i + 1)));
        var body = el('div', 'onb-step-body');
        body.appendChild(el('div', 'onb-step-t', st.t));
        body.appendChild(el('div', 'onb-step-d', st.d));
        li.appendChild(body);
        var ic = el('span', 'onb-step-ic'); ic.setAttribute('aria-hidden', 'true');
        ic.appendChild(onbIcon(st.icon));
        li.appendChild(ic);
        list.appendChild(li);
      });
    }
    var cta = $('onb-cta'); if (cta) cta.textContent = flow.cta;
    var alt = $('onb-alt'); if (alt) alt.textContent = flow.alt;
    var r = $('onb-view-role'), s = $('onb-view-steps');
    if (r) r.hidden = true;
    if (s) s.hidden = false;
    renderOnbWeekAnim(); // reflavour the live board for the chosen role
    // Focus follows the view, or a keyboard/SR user is left on a hidden control.
    if (cta) { try { cta.focus(); } catch (e) {} }
  }

  // Open the guide (first visit and the footer link). A visitor who already
  // told us their side resumes at THEIR steps — "← Changer" still leads back;
  // everyone else starts at the choice. Same jsdom-safe showModal guard as
  // the auth modal.
  function onbOpen() {
    onbCount('shown');
    var known = roleGet();
    if (known && ONB_FLOWS[known]) onbShowStepsView(known);
    else onbShowRoleView();
    toggleNotifPanel(false);
    var dlg = $('onboarding-dialog');
    if (dlg && dlg.showModal) { try { dlg.showModal(); } catch (e) { /* already open */ } }
    renderOnbWeekAnim(); // the dialog is open now — the live board can start
    // showModal autofocuses the ✕ (first tabbable). Put initial focus where
    // the shown view wants it — the pre-open focus calls no-op on a closed
    // dialog, so this is the one that actually lands.
    setTimeout(function () {
      if (!dlg || !dlg.open) return;
      var role = $('onb-view-role');
      var target = role && !role.hidden ? role.querySelector('.onb-choice') : $('onb-cta');
      if (target) { try { target.focus(); } catch (e) {} }
    }, 30);
  }

  // Auto-show once per browser. After boot, gated by LS_ONBOARDED.
  function maybeShowOnboarding() {
    if (onbSeen()) return;                                 // already decided
    if (accountRole() !== 'anon') return;                  // signed in: nothing to explain
    if (onbDismissals() >= ONB_MAX_DISMISSALS) return;     // asked enough; stop nagging
    onbOpen();
  }

  // The CTA: remember we're done, close, and route into the REAL component —
  // client reuses the hero reserve path, notary jumps to the notaries tab.
  function onbComplete(explore) {
    var dlg = $('onboarding-dialog');
    // roleGet() is the source of truth (onbShowStepsView persisted it); the
    // parked data-role only backstops storage-less browsers.
    var role = roleGet() || (dlg ? dlg.getAttribute('data-role') : '');
    onbCount(explore === true ? 'explored' : 'completed');
    onbMarkSeen();
    if (dlg && dlg.close) { try { dlg.close(); } catch (e) {} }
    // "Explorer le carnet d'abord": land on the marketplace itself. The primary
    // CTA chains straight into the offer modal, which is the right default but a
    // jarring modal-to-modal jump for anyone who just wants to look around.
    if (explore === true) { setTab('carnet'); return; }
    if (role === 'notary') {
      setTab('notaires');
    } else {
      var heroCta = $('cta-reserver');
      if (heroCta) heroCta.click(); // reuse the exact hero reserve flow
      else openOfferFlow();
    }
  }

  // Wired to the dialog's `close` event, i.e. the ambiguous exits (✕ / Escape /
  // backdrop). Counts the dismissal rather than flagging the guide as seen, so a
  // mis-click still leaves ONB_MAX_DISMISSALS - 1 chances. No-ops once an
  // explicit decision (CTA / Passer) has already flagged it.
  function onbDefer() {
    if (onbSeen()) return;
    onbCount('deferred');
    flagSet(LS_ONB_DISMISS, String(onbDismissals() + 1));
  }

  // "Passer" is a decision, not an accident, so it flags the guide as seen right
  // away — unlike the ambiguous exits, which go through onbDefer(). Flagging here
  // rather than on `close` also keeps this working under jsdom, whose close()
  // shim dispatches no close event.
  function onbDismiss() {
    onbCount('skipped');
    onbMarkSeen();
    var dlg = $('onboarding-dialog');
    if (dlg && dlg.close) { try { dlg.close(); } catch (e) {} }
  }

  // "Forget me on this device": wipe the client's local identity + history. Guarded
  // by a plain confirm (no dedicated modal helper exists for this). After clearing,
  // every surface that reads the profile/offers is re-rendered.
  function clientSignOut() {
    var ok = true;
    try { ok = window.confirm(T('Se déconnecter effacera de cet appareil vos coordonnées, vos offres publiées, votre dossier et vos notifications. Continuer ?')); } catch (e) { ok = true; }
    if (!ok) return;
    try {
      localStorage.removeItem(LS_PROFILE);
      localStorage.removeItem(LS_MYOFFERS);
      localStorage.removeItem(LS_DOSSIER);
      localStorage.removeItem(LS_NOTIF);
    } catch (e) {}
    toggleNotifPanel(false);
    renderAccountMenu();
    if (state.tab === 'profil') renderProfil();
    renderActiveView(); // repaint the carnet's "my offers" status markers
    renderNotifs();
    toast('Vous êtes déconnecté.');
  }

  // The identity head reacts to the role: notary → their console, client → their
  // profile, anonymous → the sign-in (email) field.
  function onAcctHeadClick() {
    var role = accountRole();
    if (role === 'notary') { toggleNotifPanel(false); setTab('notaires'); return; }
    if (role === 'client') { toggleNotifPanel(false); setTab('profil'); return; }
    openClientSignIn();
  }

  // Role-aware account menu: the ONE place a client or a notary signs in, sees who
  // they are, reaches their history, and signs out. Notifications + legal links
  // stay in every state.
  function renderAccountMenu() {
    var role = accountRole();
    var name = $('acct-name'), email = $('acct-email'), roleTag = $('acct-role');
    var panel = $('notif-panel'); if (panel) panel.dataset.role = role;
    // Best practice: logged-out shows explicit login/signup; the avatar/account
    // menu is for the signed-in state only.
    var headerAuth = $('header-auth'); if (headerAuth) headerAuth.hidden = role !== 'anon';
    // The mobile drawer mirrors the header pair: auth buttons only while anonymous.
    var mnavAuth = $('mnav-auth'); if (mnavAuth) mnavAuth.hidden = role !== 'anon';
    var acctWrap = document.querySelector('.acct-wrap'); if (acctWrap) acctWrap.hidden = role === 'anon';
    // Agenda sync is a NOTARY tool: it subscribes a working calendar to the
    // carnet feed. A client books a date, they do not follow the whole month, so
    // showing them four calendar buttons and a mailing form is noise on the one
    // screen where the calendar itself should be the whole point.
    var syncCard = document.querySelector('.carnet-sub');
    if (syncCard) syncCard.hidden = role !== 'notary';
    // Calendar-sync of the whole carnet shows on the landing too: a prospecting
    // notary can subscribe before ever creating an account (the feed is public).
    var p = profileGet();

    if (role === 'notary') {
      if (name) name.textContent = nc.email || 'Espace notaire';
      if (email) email.textContent = 'Vos demandes et vos dossiers retenus';
      if (roleTag) { roleTag.textContent = 'Espace notaire'; roleTag.hidden = false; }
    } else if (role === 'client') {
      if (name) name.textContent = p.nom || 'Mon compte';
      if (email) email.textContent = p.courriel;
      if (roleTag) { roleTag.textContent = 'Client'; roleTag.hidden = false; }
    } else {
      if (name) name.textContent = 'Se connecter / s’inscrire';
      if (email) email.textContent = 'Publiez une demande, ou ouvrez l’espace notaire';
      if (roleTag) { roleTag.hidden = true; roleTag.textContent = ''; }
    }

    var actions = $('acct-actions'); if (!actions) return;
    clear(actions);
    // The guide auto-shows once and then never again; a footer link is not a
    // discoverable way back, so every account state carries an explicit row.
    function onbAcctRow() {
      return acctAction('guide', 'Comment ça marche', function () { toggleNotifPanel(false); onbOpen(); });
    }
    if (role === 'notary') {
      actions.appendChild(acctAction('dossiers', 'Mes demandes et dossiers', function () { toggleNotifPanel(false); setTab('notaires'); }));
      actions.appendChild(onbAcctRow());
      actions.appendChild(acctAction('signout', 'Se déconnecter', function () { ncSignOut(); renderAccountMenu(); toggleNotifPanel(false); }));
    } else if (role === 'client') {
      actions.appendChild(acctAction('profil', 'Mon profil', function () { toggleNotifPanel(false); setTab('profil'); }));
      actions.appendChild(acctAction('offers', 'Mes offres', function () { toggleNotifPanel(false); setTab('profil'); }));
      actions.appendChild(onbAcctRow());
      actions.appendChild(acctAction('signout', 'Se déconnecter', clientSignOut));
    } else {
      // The identity head IS the "Se connecter / s’inscrire" trigger — don't repeat it.
      actions.appendChild(acctAction('publier', 'Publier une offre', openOfferFlow));
      actions.appendChild(acctAction('notaire', 'Espace notaire', function () { toggleNotifPanel(false); setTab('notaires'); }));
      actions.appendChild(onbAcctRow());
    }
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
  // Monday-first weekday abbreviations from the locale (anchored on a known
  // Monday, 2024-01-01), dot-stripped and lowercased like the fr-CA originals.
  var DOW = (function () {
    var f = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
    return [0, 1, 2, 3, 4, 5, 6].map(function (i) {
      return f.format(new Date(Date.UTC(2024, 0, 1 + i))).replace(/\.$/, '').toLowerCase();
    });
  })();

  // The calendar's visible span. Anchored on the CURRENT month it is a rolling
  // six-week window opening on Monday of today's week — the booking-industry
  // shape (Airbnb, Booking, Calendly all open on "today onward"): late in the
  // month, a whole-month grid is a page of dead days with every bookable date
  // hidden behind a "next" click. Anchored on any other month it returns null
  // and the plain whole month renders instead.
  function calWindow() {
    var today = todayISO();
    if (monthKey(state.anchor) !== monthKey(today)) return null;
    var start = D.addDays(today, -mondayIndex(today));
    return { start: start, end: D.addDays(start, 41) };
  }
  // "août – septembre 2026" — the window's span, the year printed once when shared.
  function windowTitle(win) {
    var from = firstOfMonth(state.anchor), to = firstOfMonth(win.end);
    if (monthKey(from) === monthKey(to)) return monthTitle(from);
    if (from.slice(0, 4) === to.slice(0, 4)) {
      return fmtMonthOnly.format(new Date(from + 'T00:00:00Z')) + ' – ' + monthTitle(to);
    }
    return monthTitle(from) + ' – ' + monthTitle(to);
  }

  function renderCalendar() {
    var win = calWindow();
    $('cal-title').textContent = win ? windowTitle(win) : monthTitle(state.anchor);
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

    var today = todayISO();

    // Each week is its own role="row" of exactly 7 cells, so the surrounding
    // role="grid" stays well-formed however the window is shaped.
    var week = null;
    function openRow() {
      week = el('div', 'cal-row'); week.setAttribute('role', 'row'); grid.appendChild(week);
    }
    // Whole-month view only: the cells that pad the first and last weeks carry
    // the REAL adjacent-month dates rather than being empty, which is what
    // every calendar does — the seam stays legible, and "lundi" in the last row
    // means the same thing it means in the first. They are muted, out of the
    // tab order, and carry no prices — only the viewed months' offers are
    // loaded, so a figure here would be a claim we cannot make. A future one is
    // clickable and moves the calendar to its own month, where the offers ARE
    // loaded (and the current month arrives as its rolling window).
    function outCell(iso) {
      if (!week) return;
      var b = el('div', 'cal-cell is-out');
      b.setAttribute('role', 'gridcell');
      b.dataset.date = iso;
      b.tabIndex = -1;
      b.setAttribute('aria-label', dayTitle(iso));
      var n = el('span', 'cal-daynum', String(Number(iso.slice(8, 10))));
      n.dataset.dow = DOW[mondayIndex(iso)];
      b.appendChild(n);
      if (iso < today) {
        b.setAttribute('aria-disabled', 'true');
      } else {
        b.classList.add('is-nav');
        b.addEventListener('click', function () {
          state.anchor = firstOfMonth(iso);
          state.focusDate = iso;
          reloadAndRender().then(function () { openDay(iso); });
        });
      }
      week.appendChild(b);
    }
    function liveCell(iso) {
      var cell = el('div', 'cal-cell');
      cell.setAttribute('role', 'gridcell');
      cell.dataset.date = iso;
      cell.tabIndex = iso === state.focusDate ? 0 : -1;
      cell.setAttribute('aria-label', dayTitle(iso));
      if (iso === today) { cell.classList.add('is-today'); cell.setAttribute('aria-current', 'date'); }
      if (iso === state.selectedDate) { cell.classList.add('is-selected'); cell.setAttribute('aria-selected', 'true'); }
      // Past dates can't be booked: keep the cell (so the grid never loses a row)
      // but blank it out — muted, no offers, not interactive.
      var isPast = iso < today;
      if (isPast) { cell.classList.add('is-past'); cell.setAttribute('aria-disabled', 'true'); cell.tabIndex = -1; }

      // The 7-column grid reflows to 3 on a phone, where a weekday HEADER can no
      // longer sit above its column. There the cell carries its own weekday.
      var dayEl = el('span', 'cal-daynum', String(Number(iso.slice(8, 10))));
      dayEl.dataset.dow = DOW[mondayIndex(iso)];
      // The rolling window holds a month seam INSIDE the grid: the 1st names
      // its month beside the number, the way every booking calendar labels it.
      if (win && iso.slice(8, 10) === '01') {
        dayEl.dataset.month = fmtMonthShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, '');
      }
      cell.appendChild(dayEl);

      // Cells stay essential: count + the single headline figure. All the
      // detail lives in the day modal (click / Enter). The aria-label carries
      // the same summary sighted users read from the badge and figure.
      var dayBids = isPast ? [] : (byDay[iso] || []);
      if (dayBids.length) {
        cell.classList.add('has-bids');
        var open = dayBids.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
        // Headline: the AVERAGE offer for the day (open offers when any remain,
        // otherwise what cleared) — the price a client should aim for.
        var pool = open.length ? open : dayBids;
        var avg = Math.round(pool.reduce(function (s, b) { return s + (Number(b.montant) || 0); }, 0) / pool.length);
        if (open.length) { cell.classList.add('is-avail'); } else { cell.classList.add('is-taken'); }
        // What is being offered, per act. Nothing here needs explaining.
        var bids = serviceBids('cal-svc-bids', dayBids, false);  // dot only: a cell has no room
        if (bids) cell.appendChild(bids);
        else {
          // Every offer on this day is already retained: show what cleared.
          var avgEl = el('span', 'cal-avg is-cleared', D.money(avg));
          avgEl.dataset.compact = compactMoney(avg);
          cell.appendChild(avgEl);
        }

        // The tier of the soonest-to-clear offer drives the left urgency strip
        // (CSS reads data-tier) and the detail line revealed on hover.
        var topBid = pool.slice().sort(function (a, b) { return b.montant - a.montant; })[0];
        var topTier = D.tierById(topBid && topBid.tier ? topBid.tier : 'standard');
        // Urgency is a pure function of the date, and the grid already shows the
        // date — so a tier marker on every cell restates what the reader can
        // see, in a fifth and sixth colour competing with the act colours. Say
        // it in words, and only where it changes the decision: the near dates a
        // notary has to clear their week for.

        // Expanding is only offered when it reveals something the collapsed cell
        // does not already say: how deep the competition is, and the number to
        // beat. Everything else (act, urgency) is carried by the legend and the
        // left urgency strip, so it would just be noise.
        var more = el('div', 'cal-more');
        more.appendChild(el('span', 'cal-more-n', plural(dayBids.length, 'offre')));
        if (open.length) {
          var lead = Math.max.apply(null, open.map(function (b) { return b.montant; }));
          more.appendChild(el('span', 'cal-more-beat', 'à battre : ' + D.money(lead)));
        } else if (topBid && topBid.etude) {
          more.appendChild(el('span', 'cal-more-beat', 'retenue — ' + topBid.etude));
        }
        cell.appendChild(more);
        cell.appendChild(expandChevron(cell, dayTitle(iso)));
        cell.setAttribute('aria-label', dayTitle(iso) + ' — ' + plural(dayBids.length, 'offre')
          + ', meilleure offre ' + D.money(Math.max.apply(null, pool.map(function (b) { return b.montant; }))));
      }

      // What this date costs, whether or not anyone has offered on it yet: the
      // tier is a pure function of the notice, so an empty day has a price too,
      // and that is precisely the day a client is deciding about.
      if (!isPast) {
        var tier = D.tierById(D.tierForDays(D.daysBetween(today, iso)));
        if (tier) {
          cell.dataset.tier = tier.id;
          // Tuned on the month's history (retained offers), not the static
          // ladder — the badge quotes what this market actually pays.
          var mult = D.tierMultiplier(tier.id, state.monthBids);
          var urg = el('span', 'cal-urgency', multLabel(mult));
          urg.dataset.tier = tier.id;
          urg.title = tier.nom + '. À ce délai, une offre se conclut autour de '
            + multLabel(mult) + ' le prix de départ.';
          cell.appendChild(urg);
        }
      }

      if (!isPast) cell.addEventListener('click', function () { openDay(this.dataset.date); });
      if (week) week.appendChild(cell);
    }

    // The sequence of cells. Rolling window: 42 consecutive live days from
    // Monday of today's week — the seam to next month is crossed with real,
    // priced cells (refreshMonthData loads both months), and the few days of
    // dead history are just the start of today's week, not half a month.
    // Whole-month view: every day of the month, its first and last weeks
    // padded with muted adjacent-month dates so each row keeps 7 columns.
    var seq = [];
    if (win) {
      for (var d = win.start; d <= win.end; d = D.addDays(d, 1)) seq.push({ iso: d, out: false });
    } else {
      var lead = mondayIndex(state.anchor);
      var prevAnchor = addMonths(state.anchor, -1);
      var prevDim = daysInMonth(prevAnchor);
      for (var i = 0; i < lead; i++) {
        seq.push({ iso: prevAnchor.slice(0, 8) + String(prevDim - lead + 1 + i).padStart(2, '0'), out: true });
      }
      var dim = daysInMonth(state.anchor);
      for (var day = 1; day <= dim; day++) {
        seq.push({ iso: state.anchor.slice(0, 8) + String(day).padStart(2, '0'), out: false });
      }
      var nextAnchor = addMonths(state.anchor, 1);
      for (var nd = 1; seq.length % 7 !== 0; nd++) {
        seq.push({ iso: nextAnchor.slice(0, 8) + String(nd).padStart(2, '0'), out: true });
      }
    }
    seq.forEach(function (item, idx) {
      if (idx % 7 === 0) openRow();
      if (item.out) outCell(item.iso); else liveCell(item.iso);
    });
  }

  // Compact a bid count so the badge pill never widens: 2000 -> "2k", 1250 -> "1.2k".
  // The aria-label always uses the real integer, so screen readers hear the exact count.

  // Expand control shared by the calendar cell and the list card. Detail is
  // COLLAPSED by default — the resting surface stays simple — and this is the
  // affordance that opens it. A real button, so it works on touch and by
  // keyboard; hover reveals nothing, which is the point.
  function expandChevron(target, what) {
    var b = el('button', 'cell-chevron'); b.type = 'button';
    b.tabIndex = -1;   // reached through the grid, not through Tab (APG grid pattern)
    var label = 'Afficher le détail' + (what ? ' — ' + what : '');
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-expanded', 'false');
    b.title = label;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="m6 9 6 6 6-6"/>';
    b.appendChild(svg);
    b.addEventListener('click', function (e) {
      e.stopPropagation();               // never books the day; it only opens detail
      var open = !target.classList.contains('is-expanded');
      target.classList.toggle('is-expanded', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      var next = (open ? 'Masquer le détail' : 'Afficher le détail') + (what ? ' — ' + what : '');
      b.setAttribute('aria-label', next); b.title = next;
    });
    return b;
  }
  // fr-CA sets a no-break space before the sign, exactly as money() does.
  var PCT = '\u00A0%';
  // The best OPEN offer per act on a day, colour-keyed to the Service legend.
  // Collapsed cells show the amount alone; expanded ones add the act's name.
  function serviceBids(cls, dayBids, showName) {
    var best = {};
    dayBids.forEach(function (b) {
      if (b.status === D.STATUS.RETENUE) return;         // only what is still winnable
      var cur = best[b.serviceId];
      if (!cur) best[b.serviceId] = { amount: b.montant, n: 1 };
      else { cur.n += 1; if (b.montant > cur.amount) cur.amount = b.montant; }
    });
    var wrap = el('div', cls);
    D.SERVICES.forEach(function (svc) {
      var entry = best[svc.id];
      if (!entry) return;
      var amount = entry.amount;
      var item = el('span', 'svc-bid');
      item.style.color = 'var(--svc-' + svc.id + ')';
      // Carried for the CSS tooltip a calendar cell shows on hover, where there
      // is no room to print the name.
      item.dataset.name = T(svc.nom);
      // The bubble's second line says what the cell cannot: how deep the
      // competition runs and where the act's price STARTS, so the printed
      // figure reads as high or low at a glance.
      var detail = plural(entry.n, 'offre') + (entry.n < 2 ? ' ouverte' : ' ouvertes');
      if (svc.prixDepart) {
        detail += ' · départ ' + D.money(svc.prixDepart);
        var pct = Math.round((amount / svc.prixDepart - 1) * 100);
        if (pct > 0) detail += ' · +' + pct + PCT;
      }
      item.dataset.detail = T(detail);
      var ic = svcIcon(svc.id, 12);
      if (ic) item.appendChild(ic);
      else {
        var dot = el('span', 'svc-bid-dot');
        dot.style.background = 'var(--svc-' + svc.id + ')';
        item.appendChild(dot);
      }
      // A cell shows the dot alone — the colour is decoded by the legend, and
      // hovering names the act with its depth and starting price. A list card
      // has the room, so it prints the name. Either way the words are in the
      // DOM for screen readers, which have no hover and cannot see a colour —
      // they hear exactly what a hovering reader sees.
      item.appendChild(el('span', showName ? 'svc-bid-name' : 'visually-hidden',
        showName ? T(svc.nom) : T(svc.nom) + ' — ' + T(detail)));
      var amt = el('span', 'svc-bid-amount', D.money(amount));
      amt.dataset.compact = compactMoney(amount);
      item.appendChild(amt);
      wrap.appendChild(item);
    });
    return wrap.childNodes.length ? wrap : null;
  }


  // Compact a dollar amount for the tightest calendar cells (phones): 3285 -> "3,3k",
  // 715 -> "715". Swapped in only by the narrow container query; the full amount and
  // the day dialog keep the exact "1 320 $".
  function compactMoney(n) {
    n = Math.round(Number(n) || 0);
    if (n < 1000) return String(n);
    var k = n / 1000;
    var s = k >= 10 ? String(Math.round(k)) : String(Math.round(k * 10) / 10);
    return (LOCALE === 'fr-CA' ? s.replace('.', ',') : s) + 'k';
  }

  function renderLegend() {
    var lg = $('legend'); clear(lg);
    // The key that turns a colour on a cell into a price: each tier with the
    // multiple of the starting price an offer actually settles at.
    lg.appendChild(el('span', 'legend-label', 'Délai'));
    D.TIERS.forEach(function (t) {
      var item = el('span', 'legend-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--tier-' + t.id + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(t.nom + ' '));
      var m = el('span', 'legend-mult', multLabel(D.tierMultiplier(t.id, state.monthBids)));
      m.style.color = 'var(--tier-' + t.id + ')';
      item.appendChild(m);
      lg.appendChild(item);
    });
    // Service key — decodes the per-service mix bar in each calendar cell.
    lg.appendChild(el('span', 'legend-label legend-label--sep', 'Service'));
    D.SERVICES.forEach(function (s) {
      var item = el('span', 'legend-status-item');
      var ic = svcIcon(s.id, 13);
      if (ic) { ic.style.color = 'var(--svc-' + s.id + ')'; item.appendChild(ic); }
      else {
        var dot = el('span', 'legend-dot'); dot.style.background = 'var(--svc-' + s.id + ')';
        item.appendChild(dot);
      }
      item.appendChild(document.createTextNode(s.nom));
      lg.appendChild(item);
    });
    // The two figures printed in every cell were never named anywhere: the % had
    // only a title tooltip, which never appears on a touch device. Spell both out,
    // and say what drives the % — it is a lead-time estimate, not a live count of
    // this date's offers, and reading it as the latter would mislead. The bounds
    // come from the domain so they cannot drift from OBTAIN_CHANCE.
    var note = el('span', 'legend-note');
    note.appendChild(el('strong', null, 'Dans chaque case'));
    note.appendChild(document.createTextNode(
      ' : la meilleure offre encore ouverte pour chaque acte, à la couleur ci-dessus, '
      + 'et le multiple du prix de départ qu’il faut compter à ce délai. '
      + 'Plus la date est proche, plus ce multiple monte.'
    ));
    lg.appendChild(note);
  }

  // ---------------------------------------------------------------------------
  // Hero pulse — the live market beside the hero copy
  // ---------------------------------------------------------------------------
  // The client's first question is "combien j'offre ?". Answer it with the
  // month's own numbers: the median amount proposed per act, its volume, and
  // how much of the carnet a notary has already taken. Aggregation is the
  // domain's (D.carnetPulse); this only formats and wires each row to the
  // service filter of the carnet below.
  // French keeps the singular at 0 as well as 1 ("0 demande"), unlike English.
  function plural(n, word) { return n + ' ' + word + (n < 2 ? '' : 's'); }

  function pulseRow(s, active, busiest) {
    var short = s.nom.split(' ')[0];
    var priced = s.median == null ? s.prixDepart : s.median;
    var row = el('button', 'pulse-row' + (active ? ' is-on' : ''));
    row.type = 'button';
    row.dataset.svc = s.id;
    row.setAttribute('aria-pressed', active ? 'true' : 'false');
    // The row is several fragments; name the WHOLE control once so a screen
    // reader announces the figures and what clicking it does, not "788 $ 10 offres".
    row.setAttribute('aria-label',
      short + ' — à partir de ' + D.money(s.prixDepart)
      + (s.median == null ? ', aucune offre ce mois' : ', médiane des offres ' + D.money(s.median)) + '. '
      + (active ? 'Retirer ce filtre.' : 'Afficher le carnet pour cet acte.'));

    var name = el('span', 'pulse-svc');
    var ic = svcIcon(s.id, 15);
    if (ic) { ic.style.color = 'var(--svc-' + s.id + ')'; name.appendChild(ic); }
    else {
      var dot = el('span', 'pulse-dot');
      dot.style.background = 'var(--svc-' + s.id + ')';
      name.appendChild(dot);
    }
    name.appendChild(document.createTextNode(short));
    row.appendChild(name);

    // Two figures, because they answer two different questions. The floor is
    // what the server will accept at all, and it is stable. The median is what
    // other clients are actually offering this month, and it is what a notary
    // is choosing between. Never a mean: one 9 000 $ urgence must not
    // masquerade as the going rate.
    var figs = el('span', 'pulse-figs');

    var dep = el('span', 'pulse-fig');
    dep.appendChild(el('span', 'pulse-fig-k', 'à partir de'));
    dep.appendChild(el('span', 'pulse-fig-v', D.money(s.prixDepart)));
    figs.appendChild(dep);

    var med = el('span', 'pulse-fig');
    med.appendChild(el('span', 'pulse-fig-k', 'médiane'));
    var medV = el('span', 'pulse-fig-v', s.median == null ? '—' : D.money(s.median));
    if (s.median == null) medV.classList.add('is-empty');
    med.appendChild(medV);
    figs.appendChild(med);

    row.appendChild(figs);

    row.appendChild(el('span', 'pulse-meta',
      s.total === 0 ? 'aucune offre ce mois' : plural(s.total, 'offre') + ' · ' + s.retenues + ' retenue' + (s.retenues === 1 ? '' : 's')));

    // Volume bar: this service's share of the busiest one, in its own hue. It
    // carries the row structure now that the separators are gone, and adds the
    // one thing the numbers alone don't show — which act drives the month.
    var bar = el('span', 'pulse-bar');
    var fill = el('span');
    fill.style.width = (busiest > 0 ? Math.round((s.total / busiest) * 100) : 0) + '%';
    fill.style.background = 'var(--svc-' + s.id + ')';
    bar.appendChild(fill);
    row.appendChild(bar);

    // The row filters; the button beside it books. They are SIBLINGS — a button
    // cannot legally nest inside a button, and the two actions are different.
    var item = el('div', 'pulse-item');
    item.appendChild(row);
    item.appendChild(miniBtn('reserver', 'Réserver un ' + short.toLowerCase(), function () { bookService(s.id); }));
    return item;
  }

  // Quick book from the pulse: preselect the act, then open the same booking
  // dialog the hero CTA opens, on the day the client is already looking at.
  function bookService(serviceId) {
    state.filters.service = serviceId;
    syncFilterChips();
    writeHash();
    setTab('carnet', { scroll: false });
    openDay(state.selectedDate || state.focusDate || todayISO());
  }

  function renderPulse() {
    var rows = $('pulse-rows');
    if (!rows) return;
    var p = D.carnetPulse(state.monthBids, todayISO());

    var m = $('pulse-month');
    if (m) {
      // The pulse reads the same span the calendar shows, so its label must too.
      var win = calWindow();
      m.textContent = win ? windowTitle(win) : monthTitle(state.anchor);
    }

    clear(rows);
    var busiest = p.services.reduce(function (m, s) { return Math.max(m, s.total); }, 0);
    p.services.forEach(function (s) {
      rows.appendChild(pulseRow(s, state.filters.service === s.id, busiest));
    });
  }


  function bidRow(b) {
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
    }

    return row;
  }

  // Repaint the carnet: the shared toolbar summary, the market reference, then
  // the grid itself.
  function renderActiveView() {
    var visible = applyFilters(state.monthBids);
    updateFilterSummary(visible.length, visible);
    // The pulse reads the WHOLE month (not `visible`): it is the market
    // reference the filters are applied against, so filtering must not
    // rewrite it — only highlight the row that is active.
    renderPulse();
    renderCalendar();
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
  async function openDay(iso) {
    // A day in a different month (opened from a reminder/retenue notification or a
    // "Mes offres" row) needs that month's bids loaded first — otherwise the dialog
    // shows an empty day and the calendar stays on the wrong month behind it.
    if (monthKey(iso) !== monthKey(state.anchor)) {
      state.anchor = firstOfMonth(iso);
      await reloadAndRender();
    }
    state.focusDate = iso;
    state.selectedDate = iso;
    var all = state.monthBids.filter(function (b) { return b.dateISO === iso; });

    $('day-title').textContent = dayTitle(iso);
    var days = D.daysBetween(todayISO(), iso);
    var when = days < 0 ? 'passé' : days === 0 ? 'aujourd’hui' : 'dans ' + days + ' jour' + (days > 1 ? 's' : '');
    var takenN = all.filter(function (b) { return b.status === D.STATUS.RETENUE; }).length;
    $('day-sub').textContent = all.length
      ? all.length + ' offre' + (all.length > 1 ? 's' : '') + (takenN ? ' · ' + takenN + ' retenue' + (takenN > 1 ? 's' : '') : '') + ' · ' + when
      : 'Aucune offre · ' + when + ' · soyez le premier';

    // --- Inline booking (relocated offer-form) — the clicked day IS the date ---
    $('o-date').value = iso; onOfferDateChange();
    var sel = $('o-service'), chips = $('o-service-chips');
    // An active carnet filter wins; otherwise fall back to the domain's default
    // act, so the form opens ready to book instead of on an empty choice.
    var preselect = D.serviceById(state.filters.service) ? state.filters.service : D.DEFAULT_SERVICE_ID;
    sel.value = preselect;
    var pre = chips && chips.querySelector('[data-svc="' + preselect + '"]');
    if (pre) setGroupActive(chips, pre);
    onOfferServiceChange();                               // amount/gauge + recommendedAmount pre-fill + validity
    // Prefill identity from the client's saved profile so nothing is re-entered.
    var prof = profileGet();
    if ($('o-courriel')) $('o-courriel').value = prof.courriel;
    if ($('o-prefix')) $('o-prefix').value = prof.prefixe;
    if ($('o-name')) $('o-name').value = prof.nom;
    commitAnon(prof.anonyme);
    var succ = $('offer-success'); if (succ) succ.hidden = true;
    var eb = $('offer-errors'); if (eb) { eb.hidden = true; clear(eb); }
    renderDayBids(iso);
    // Name the calendar's % again where the date is actually chosen, with this
    // date's own lead time — the cell shows the number, this says what it means.
    var chanceEl = $('day-chance');
    if (chanceEl) {
      var dLeft = D.daysBetween(todayISO(), iso);
      var when = dLeft <= 0 ? 'aujourd’hui' : dLeft === 1 ? 'demain' : 'dans ' + dLeft + ' jours';
      chanceEl.textContent = 'Chances d’obtenir un notaire : ' + D.obtainChance(iso, todayISO())
        + PCT + '. La date est ' + when + ', et plus elle approche, plus un notaire a de mal à s’y libérer.';
    }
    validateOfferUI();

    renderActiveView();
    var dlg = $('day-dialog');
    if (dlg.showModal && !dlg.open) dlg.showModal();
  }


  // The day dialog answers one question: what do I have to beat for the act I am
  // booking? So it leads with the single best offer for the SELECTED act, states
  // the day's totals, and folds everything else behind a toggle. Re-run whenever
  // the act changes — the headline, the hint and the list all depend on it.
  var DAY_CAP = 40;  // hard bound so a day with hundreds never floods the DOM

  function renderDayBids(iso) {
    var list = $('day-bids'); if (!list) return;
    clear(list);
    var f = state.filters;
    var dayAll = state.monthBids.filter(function (b) {
      if (b.dateISO !== iso) return false;
      if (f.statut && b.status !== f.statut) return false;
      if (f.min != null && b.montant < f.min) return false;
      if (f.max != null && b.montant > f.max) return false;
      return true;
    }).sort(function (a, b) { return b.montant - a.montant; });

    var svc = D.serviceById($('o-service') ? $('o-service').value : '');
    var matching = svc ? dayAll.filter(function (b) { return b.serviceId === svc.id; }) : dayAll;

    // Competitive facts (the bar to clear, per act and for the headline) come
    // from the RAW day pool: an open offer exists whether or not the carnet's
    // statut/montant filters keep it out of the visible list.
    var dayRaw = state.monthBids.filter(function (b) { return b.dateISO === iso; });
    var rawMatching = svc ? dayRaw.filter(function (b) { return b.serviceId === svc.id; }) : dayRaw;

    // Each act chip carries its own bar to clear (open offers only) — the
    // amount changes with the act, so it belongs on the choice itself.
    var chipWrap = $('o-service-chips');
    if (chipWrap) D.SERVICES.forEach(function (s) {
      var subEl = chipWrap.querySelector('[data-svc="' + s.id + '"] .chip-svc-sub');
      if (!subEl) return;
      var best = null;
      dayRaw.forEach(function (b) {
        if (b.serviceId === s.id && b.status !== D.STATUS.RETENUE && (best == null || b.montant > best)) best = b.montant;
      });
      subEl.textContent = best != null ? D.money(best) : 'libre';
      subEl.classList.toggle('is-free', best == null);
    });

    // Headline row: the one offer to beat for this act.
    if (matching.length) list.appendChild(bidRow(matching[0]));

    // Totals: what the client is actually up against on this date.
    var counts = [];
    if (svc) {
      counts.push(matching.length
        ? matching.length + ' offre' + (matching.length > 1 ? 's' : '') + ' en ' + T(svc.nom).toLowerCase()
        : 'Aucune offre en ' + T(svc.nom).toLowerCase());
    }
    counts.push(dayAll.length + ' offre' + (dayAll.length > 1 ? 's' : '') + ' ce jour, tous actes confondus');
    list.appendChild(el('div', 'day-bids-count', counts.join(' · ')));

    // Everything not shown above, on demand.
    var others = dayAll.filter(function (b) { return b !== matching[0]; }).slice(0, DAY_CAP);
    if (others.length) {
      var rest = el('div', 'day-bids-rest'); rest.hidden = true;
      others.forEach(function (b) { rest.appendChild(bidRow(b)); });
      list.appendChild(rest);
      var label = 'Voir les ' + others.length + ' autre' + (others.length > 1 ? 's' : '') + ' offre' + (others.length > 1 ? 's' : '');
      var toggle = el('button', 'btn btn-sm day-bids-toggle', label); toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        var opening = rest.hidden;
        rest.hidden = !opening;
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
        toggle.textContent = opening ? 'Voir moins' : label;
      });
      list.appendChild(toggle);
    }

    // Headline figure + the bar to clear, both scoped to the selected act. The
    // label names that act — the amount means nothing without it. No open offer
    // reads « Libre »: an opportunity, not a missing number.
    var open = rawMatching.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    var top = open.length ? Math.max.apply(null, open.map(function (b) { return b.montant; })) : null;
    var bestK = $('day-best-k');
    if (bestK) bestK.textContent = svc ? 'Meilleure offre ouverte · ' + svc.nomCourt : 'Meilleure offre ouverte';
    var bestV = $('day-best');
    bestV.textContent = top != null ? D.money(top) : 'Libre';
    bestV.classList.toggle('is-free', top == null);
    bestV.classList.remove('pulse'); void bestV.offsetWidth; bestV.classList.add('pulse');
    state.dayTop = top;
    if (top == null) {
      var name = svc ? T(svc.nom).toLowerCase() : 'cet acte';
      var hint = $('day-hint');
      hint.classList.remove('is-ahead');
      // Two different reasons to be free, two different messages: a retained
      // offer is not an empty day.
      var takenN = rawMatching.length;
      hint.textContent = takenN
        ? (takenN > 1 ? 'Les offres en ' + name + ' sont déjà retenues' : 'L’offre en ' + name + ' est déjà retenue')
          + ' — la place est libre, fixez votre prix.'
        : 'Aucune offre en ' + name + ' pour cette date. Soyez le premier — fixez votre prix.';
    }
    updateBeatUI();
  }

  // The card's bottom line is LIVE: it compares the slider to the act's best
  // open offer and, while the offer trails, gives a one-tap way over the bar.
  function beatAmount() {
    var amt = $('o-amount');
    if (state.dayTop == null || !amt || amt.disabled) return null;
    var target = state.dayTop + (Number(amt.step) || 5);
    var max = Number(amt.max);
    return Number.isFinite(max) && target > max ? null : target;
  }
  function updateBeatUI() {
    var btn = $('day-beat'), hint = $('day-hint');
    if (!btn || !hint) return;
    if (state.dayTop == null) { btn.hidden = true; return; }  // renderDayBids wrote the free-slot hint
    // Both strings are static on purpose: the aria-live card announces only
    // when the offer crosses the bar, not on every slider step.
    var ahead = Number($('o-amount').value) > state.dayTop;
    hint.textContent = ahead
      ? 'Votre offre passe devant.'
      : 'Proposez plus que ' + D.money(state.dayTop) + ' pour passer devant.';
    hint.classList.toggle('is-ahead', ahead);
    var t = beatAmount();
    btn.hidden = ahead || t == null;
    if (!btn.hidden) btn.textContent = 'Passer devant · ' + D.money(t);
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation (roving tabindex on the grid)
  // ---------------------------------------------------------------------------
  function onGridKey(e) {
    if (e.target && e.target.closest && e.target.closest('.cell-chevron')) return;
    var cols = gridCols();
    var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(map[e.key]);
    } else if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'Home') { e.preventDefault(); state.focusDate = todayISO(); state.anchor = firstOfMonth(state.focusDate); reloadAndRender(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (state.focusDate >= todayISO()) openDay(state.focusDate);
    }
    else if (e.key === 'Escape') { e.preventDefault(); resetFilters(); }
  }
  // How many columns the grid ACTUALLY renders. The month grid is 7 wide, but it
  // reflows to fewer on a phone, so "one row up" is not always seven days.
  function gridCols() {
    var g = $('cal-grid');
    if (!g) return 7;
    var t = getComputedStyle(g).gridTemplateColumns;
    if (!t || t === 'none') return 7;
    var n = t.trim().split(/\s+/).length;
    return n > 0 ? n : 7;
  }

  function moveFocus(delta) {
    var next = D.addDays(state.focusDate, delta);
    var win = calWindow();
    // The rolling window has no cells before its first row — dead history is
    // not worth arrowing into, so the focus simply stops at the window's edge.
    if (win && next < win.start) return;
    // A date already rendered (in the window, or in the viewed month) only
    // moves the roving focus; anything outside re-anchors the calendar there.
    var visible = win ? next <= win.end : monthKey(next) === monthKey(state.anchor);
    if (!visible) state.anchor = firstOfMonth(next);
    state.focusDate = next;
    function focusCell() { var c = document.querySelector('.cal-cell[data-date="' + next + '"]'); if (c) c.focus(); }
    // Leaving the rendered span needs fresh bids, not just a re-render.
    if (!visible) reloadAndRender().then(focusCell);
    else { refreshMonth(); focusCell(); }
  }
  function step(months) {
    state.anchor = addMonths(state.anchor, months);
    // Stepping back onto the current month lands on the rolling window, whose
    // first bookable day is today — the 1st may not be rendered at all.
    state.focusDate = calWindow() ? todayISO() : state.anchor;
    reloadAndRender();
  }

  // ---------------------------------------------------------------------------
  // Filters UI <-> URL hash
  // ---------------------------------------------------------------------------
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var SORTS = ['montant-desc', 'date-asc', 'date-desc'];
    if (h.has('svc')) {
      var svc = h.get('svc');
      state.filters.service = (svc === '' || D.serviceById(svc)) ? svc : FILTER_DEFAULTS.service;
    }
    if (h.has('statut')) {
      var st = h.get('statut');
      var known = st === '' || st === D.STATUS.OUVERTE || st === D.STATUS.RETENUE;
      state.filters.statut = known ? st : FILTER_DEFAULTS.statut;
    }
    if (h.has('min')) state.filters.min = num(h.get('min'));
    if (h.has('max')) state.filters.max = num(h.get('max'));
    if (h.has('tri') && SORTS.indexOf(h.get('tri')) >= 0) state.filters.sort = h.get('tri');
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
    if (f.service !== FILTER_DEFAULTS.service) n++;
    if (f.statut !== FILTER_DEFAULTS.statut) n++;
    if (f.min !== FILTER_DEFAULTS.min) n++;
    if (f.max !== FILTER_DEFAULTS.max) n++;
    if (f.sort !== FILTER_DEFAULTS.sort) n++;
    return n;
  }
  function filtersActive() { return activeFilterCount() > 0; }
  function updateFilterSummary(count, visible) {
    var rc = $('result-count');
    // plural() carries the French rule (singular at 0 as well as 1); this line
    // had the English one and rendered "0 offres".
    // The rolling window spans two months, so "ce mois" would miscount there.
    if (rc) rc.textContent = plural(count, 'offre') + (calWindow() ? ' au carnet' : ' ce mois');
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
  }
  function resetFilters() {
    state.filters = Object.assign({}, FILTER_DEFAULTS);
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

  // The carnet opens showing EVERY act, so a first visit shows the whole market
  // and each cell prices the acts actually on that day. Narrowing to one act is
  // one click away, and makes every price on screen directly comparable.
  function buildServiceChips() {
    var wrap = $('chips-service'); if (!wrap) return; clear(wrap);
    var all = el('button', 'chip' + (state.filters.service ? '' : ' is-on'), 'Tous les actes');
    all.type = 'button'; all.dataset.svc = '';
    all.setAttribute('aria-pressed', state.filters.service ? 'false' : 'true');
    wrap.appendChild(all);
    D.SERVICES.forEach(function (s) {
      var on = state.filters.service === s.id;
      var b = el('button', 'chip chip-svc' + (on ? ' is-on' : ''));
      b.type = 'button'; b.dataset.svc = s.id; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var ic = svcIcon(s.id); if (ic) b.appendChild(ic);
      b.appendChild(document.createTextNode(s.nomCourt));
      wrap.appendChild(b);
    });
  }
  // Service chips inside the booking dialog (one per act; no "Tous"). Only sets
  // the hidden #o-service value — that select keeps its 3 tested options.
  function buildBookingChips() {
    var wrap = $('o-service-chips'); if (!wrap) return; clear(wrap);
    D.SERVICES.forEach(function (s) {
      var b = el('button', 'chip chip-svc');
      b.type = 'button'; b.dataset.svc = s.id; b.setAttribute('aria-pressed', 'false');
      var main = el('span', 'chip-svc-main');
      var ic = svcIcon(s.id); if (ic) main.appendChild(ic);
      main.appendChild(document.createTextNode(s.nomCourt));
      b.appendChild(main);
      // Each act's own offre à battre for the date being booked — filled by
      // renderDayBids, so the trade-off between acts shows at the choice itself.
      b.appendChild(el('span', 'chip-svc-sub'));
      wrap.appendChild(b);
    });
  }

  // The dynamic floor for the current offer, from the client's pricing answers
  // (== the flat base when nothing is answered). Everything in the booking form
  // — slider bounds, the recommended pre-fill, the "× base" note — reads this.
  function currentBase() {
    // Nota quotes 1.5× the market rate (notaPrice); the whole booking form —
    // slider bounds, the recommended pre-fill, the "prix de départ" — reads this.
    var b = D.notaPrice(state.offer.serviceId, state.offer.pricing);
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
      var rec = D.recommendedAmount(svc.id, state.offer.dateISO, todayISO(), state.offer.pricing, state.monthBids);
      amt.value = rec != null ? rec : base;
    }
    var bn = $('o-base-note');
    if (bn) bn.textContent = 'Prix de départ ajusté : ' + D.money(base) + '.';
    onAmountChange();
  }

  // Shown in the format hints. Taken from a real fixture prefix so the example is
  // always a genuine Quebec sector.
  var PREFIX_EXAMPLE = (D.makeFixtures(todayISO()).find(function (b) { return b.prefixe; }) || {}).prefixe || 'G1R';

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
      var rec = D.recommendedAmount(svc.id, state.offer.dateISO, todayISO(), state.offer.pricing, state.monthBids);
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
      var rec = D.recommendedAmount(state.offer.serviceId, date, todayISO(), state.offer.pricing, state.monthBids);
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
    updateBeatUI();
    validateOfferUI();
  }

  function acceptance(mult, tierId) {
    var t = D.tierById(tierId) || D.tierById('standard');
    var top = t.apercuMax * 1.25;
    var pct = Math.max(4, Math.min(100, ((mult - 1) / (top - 1)) * 100));
    var label;
    if (mult < t.apercuMin) label = 'Sous la fourchette du marché, peu susceptible d’être retenue.';
    else if (mult <= t.apercuMax) label = 'Dans la fourchette qui se conclut à ce délai.';
    else label = 'Offre généreuse, susceptible d’être retenue rapidement.';
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

  // The postal prefix is the one piece of location a bid publishes, so the field
  // normalizes as you type (domain-owned format) and previews the exact public
  // string. An incomplete entry is not an error — the field is optional — so it
  // is flagged only once three characters are in.
  function onPrefixInput() {
    var inp = $('o-prefix'); if (!inp) return;
    var norm = D.normalizePostalPrefix(inp.value);
    if (inp.value !== norm) inp.value = norm;
    var prev = $('prefix-preview');
    if (prev) {
      clear(prev);
      if (!norm) {
        prev.removeAttribute('data-state');
      } else if (D.isQuebecPostalPrefix(norm)) {
        prev.dataset.state = 'ok';
        prev.textContent = 'Votre offre s’affichera « Client · ' + norm + ' ».';
      } else if (norm.length < 3) {
        prev.dataset.state = 'pending';
        prev.textContent = 'Encore ' + (3 - norm.length) + ' caractère' + (3 - norm.length > 1 ? 's' : '') + ' — format « ' + PREFIX_EXAMPLE + ' ».';
      } else if (D.isPostalPrefix(norm)) {
        prev.dataset.state = 'warn';
        prev.textContent = '« ' + norm + ' » n’est pas un secteur du Québec. Nota dessert Québec pour l’instant.';
      } else {
        prev.dataset.state = 'warn';
        prev.textContent = 'Format attendu : une lettre, un chiffre, une lettre, comme « ' + PREFIX_EXAMPLE + ' ».';
      }
    }
    validateOfferUI();
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
    // Pay-on-accept: when the API returns a Checkout URL, the offer is PENDING
    // until the client authorizes their card. Remember it locally, then hand off
    // to Stripe's hosted page — the offer only reaches the carnet once the
    // authorization webhook confirms, and a notary is paid the instant they accept.
    if (res.checkoutUrl) {
      submit.removeAttribute('aria-busy'); submit.textContent = 'Redirection vers le paiement…';
      profileSet({ courriel: payload.courriel, prefixe: payload.prefixe, nom: payload.nom || '', anonyme: payload.anonyme });
      renderAccountMenu(); // an offer that carries an email signs the client in
      addMyOffer(res.bid);
      window.location.href = res.checkoutUrl;
      return;
    }
    submit.removeAttribute('aria-busy'); submit.textContent = 'Offre publiée ✓'; // stays disabled → no duplicate submit
    toast('Offre publiée : ' + D.money(payload.montant) + (store.online ? '' : ' (démo locale)'));
    buildCalendarLinks(res.bid);
    $('offer-success').hidden = false;
    // The dossier is what makes this lead sellable — show its real progress here
    // and give a one-tap path to finish it for THIS service.
    fillDossierNext(res.bid.serviceId);
    // Remember the client's coordinates in their profile for next time — an offer
    // that carries an email implicitly signs the client in on this device.
    profileSet({ courriel: payload.courriel, prefixe: payload.prefixe, nom: payload.nom || '', anonyme: payload.anonyme });
    renderAccountMenu();
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
  // One builder, two consumers: the post-booking confirmation (which fills the
  // three links in the dialog) and the per-row agenda button.
  function calendarLinks(bid) {
    var svc = D.serviceById(bid.serviceId);
    var title = T('Signature notariée') + ' — ' + (svc ? T(svc.nom) : bid.serviceId);
    var startCompact = bid.dateISO.replace(/-/g, '');
    var endCompact = D.addDays(bid.dateISO, 1).replace(/-/g, '');
    var details = T('Offre publiée sur Nota : ' + D.money(bid.montant) + '.');
    // RFC 5545: DTSTAMP is required (Outlook drops events without it); escape TEXT.
    var esc = function (s) { return String(s).replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n'); };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nota//FR-CA//',
      'BEGIN:VEVENT', 'UID:' + bid.id + '@nota', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + startCompact, 'DTEND;VALUE=DATE:' + endCompact,
      'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(details), 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    return {
      title: title,
      ics: 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics),
      gcal: 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        '&text=' + encodeURIComponent(title) +
        '&dates=' + startCompact + '/' + endCompact +
        '&details=' + encodeURIComponent(details),
      outlook: 'https://outlook.live.com/calendar/0/deeplink/compose?subject=' +
        encodeURIComponent(title) + '&body=' + encodeURIComponent(details) +
        '&startdt=' + bid.dateISO + '&enddt=' + D.addDays(bid.dateISO, 1) + '&allday=true',
    };
  }

  function buildCalendarLinks(bid) {
    var links = calendarLinks(bid);
    $('ics-link').href = links.ics;
    $('gcal-link').href = links.gcal;
    $('outlook-link').href = links.outlook;
  }

  // A deep link straight to this offer's day in the carnet, filtered to its act.

  // Share sheet where the platform has one, clipboard everywhere else. Both
  // paths end in visible feedback — a share that silently does nothing reads
  // as a broken button.

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
  // Mes offres: four facts and one action per offer, in columns. Full-width
  // bands wasted ~1500px of horizontal space per row and made seven offers an
  // 800px wall; a table puts the dates and the amounts on a single axis so the
  // eye can run down them, and a row costs ~48px instead of ~80.
  function buildMyOffersCard() {
    var offers = myOffers();
    var card = el('div', 'profil-card');
    card.appendChild(profilHead(IC_OFFERS, 'Mes offres'));
    if (!offers.length) {
      var empty = el('div', 'profil-empty');
      empty.appendChild(el('p', 'profil-empty-text', 'Vous n’avez pas encore publié d’offre. Choisissez une date au carnet et un notaire de Québec la retient.'));
      var cta = el('button', 'btn btn-primary btn-sm', 'Réserver ma première date'); cta.type = 'button';
      cta.addEventListener('click', function () { toggleNotifPanel(false); setTab('carnet'); });
      empty.appendChild(cta);
      card.appendChild(empty);
      return card;
    }

    var today = todayISO();
    var rows = offers.map(function (o) {
      return { o: o, st: clientOfferStatus(o), past: D.daysBetween(today, o.dateISO) < 0 };
    });
    // Soonest first for what is still live: the client's question is temporal.
    var live = rows.filter(function (r) { return !r.past; })
      .sort(function (a, b) { return String(a.o.dateISO).localeCompare(String(b.o.dateISO)); });
    // Dead rows never dilute the live list; most recent first behind a summary.
    var gone = rows.filter(function (r) { return r.past; })
      .sort(function (a, b) { return String(b.o.dateISO).localeCompare(String(a.o.dateISO)); });

    if (live.length) card.appendChild(myOffersTable(live, 'live'));
    else card.appendChild(el('p', 'help', 'Aucune offre à venir.'));

    if (gone.length) {
      var det = el('details', 'my-offers-past');
      var sum = el('summary', 'my-offers-past-sum', plural(gone.length, 'offre') + ' passée' + (gone.length < 2 ? '' : 's'));
      det.appendChild(sum);
      det.appendChild(myOffersTable(gone, 'past'));
      card.appendChild(det);
    }
    return card;
  }

  function myOffersTable(rows, which) {
    var table = el('table', 'my-offers');
    var head = el('thead');
    var hr = el('tr');
    [['Acte', 'c-acte'], ['Date', 'c-date'], ['Montant', 'c-montant'], ['Statut', 'c-statut']].forEach(function (c) {
      var th = el('th', c[1], c[0]); th.scope = 'col'; hr.appendChild(th);
    });
    head.appendChild(hr); table.appendChild(head);

    var body = el('tbody');
    body.id = 'my-offers-' + which;
    rows.forEach(function (r) {
      var tr = el('tr', 'my-offer');
      tr.dataset.status = r.st;
      tr.dataset.id = r.o.id;
      tr.appendChild(el('td', 'c-acte', svcName(r.o.serviceId)));

      var dcell = el('td', 'c-date');
      dcell.appendChild(el('span', 'my-offer-day', dayShort(r.o.dateISO)));
      dcell.appendChild(el('span', 'my-offer-rel', relativeDay(r.o.dateISO)));
      tr.appendChild(dcell);

      tr.appendChild(el('td', 'c-montant', D.money(r.o.montant)));

      var scell = el('td', 'c-statut');
      var pill = el('span', 'my-offer-status', OFFER_STATUS_LABEL[r.st]);
      pill.dataset.status = r.st;
      scell.appendChild(pill);
      tr.appendChild(scell);
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  // "dans 3 jours" / "demain" / "il y a 5 jours" — the same vocabulary the day
  // dialog already uses, so a date reads the same way everywhere.
  function relativeDay(iso) {
    var d = D.daysBetween(todayISO(), iso);
    if (d === 0) return 'aujourd’hui';
    if (d === 1) return 'demain';
    if (d === -1) return 'hier';
    return d > 0 ? 'dans ' + plural(d, 'jour') : 'il y a ' + plural(-d, 'jour');
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
      { key: 'prefixe', label: 'Code postal', ph: 'G1R', type: 'text' },
    ].forEach(function (f) {
      var row = el('div', 'form-row');
      var lab = el('label', 'lbl', f.label); lab.setAttribute('for', 'p-' + f.key); row.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = f.type; inp.id = 'p-' + f.key; inp.placeholder = f.ph; inp.value = p[f.key] || '';
      if (f.key === 'prefixe') { inp.maxLength = 3; inp.className = 'uppercase'; }
      inp.addEventListener('input', function () {
        var val = f.key === 'prefixe' ? inp.value.trim().toUpperCase().slice(0, 3) : inp.value.trim();
        var patch = {}; patch[f.key] = val; profileSet(patch);
        // A saved email is what makes the client "signed in" — keep the account
        // menu (and its role tag) in sync as they type it.
        if (f.key === 'courriel') renderAccountMenu();
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
    if (!items.length) { container.appendChild(prog); return; }
    // The checklist is the tallest thing in the profile by a wide margin: six
    // rows of name + guidance + file picker ran 905px on a phone, over half the
    // page, almost all of it an empty state. Collapse it behind its own progress
    // line, the same bargain the calendar cell strikes with its chevron. Open
    // only while the client is part-way through, which is the one state where
    // the remaining rows are what they came to see.
    var det = el('details', 'doc-disclose');
    det.open = done > 0 && !complete;
    var sum = document.createElement('summary');
    sum.className = 'doc-summary';
    sum.appendChild(prog);
    det.appendChild(sum);
    var rows = el('div', 'doc-rows');
    det.appendChild(rows);
    container.appendChild(det);
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
      rows.appendChild(row);
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
          if (name) { if (!note) { note = el('div', 'file-note'); body.appendChild(note); } note.textContent = 'Sélectionné : ' + name + '. Reste sur votre appareil.'; }
          else if (note) { note.remove(); }
          updateDossierBar();
        });
        fileLbl.appendChild(input); fileLbl.appendChild(fileCta);
        body.appendChild(fileLbl);
        if (saved[it.id]) { var fn = el('div', 'file-note', 'Sélectionné : ' + saved[it.id] + '. Reste sur votre appareil.'); body.appendChild(fn); }
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

  // The Nota price (1.5× market) the client's profile answers determine for this act.
  function updateDossierPrice(svc) {
    var node = $('dossier-price');
    if (!node) return;
    var base = D.notaPrice(svc.id, dossierPricing(svc.id));
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
      m.textContent = '✓ Prêt à être retenu par un notaire. Votre identité sera vérifiée à la signature.';
      m.dataset.ready = 'true';
    } else {
      var parts = [];
      if (r.missing.length) parts.push('à compléter : ' + r.missing.join(', '));
      if (!r.consent) parts.push('consentement de partage requis');
      m.textContent = parts.join(' · ') + '.';
      m.dataset.ready = 'false';
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
  // Free notary signup = Stripe Connect onboarding. Shared by the auth-gate signup
  // prompt (a new notary, from ncSignIn) and the in-console "connect payment"
  // button. Redirects to Stripe's hosted onboarding; on failure calls onError(msg).
  async function ncStartOnboard(email, onError) {
    email = (email || '').trim();
    if (!email) { onError && onError('Un courriel est requis.'); return false; }
    try {
      var r = await fetch(API_BASE + '/notaries/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      var j = {}; try { j = await r.json(); } catch (e) {}
      if (r.ok && j.url) { window.location.href = j.url; return true; }
      onError && onError((j.errors && j.errors[0] && j.errors[0].message) || 'Inscription indisponible pour le moment.');
    } catch (err) { onError && onError('Hors ligne. Réessayez une fois en ligne.'); }
    return false;
  }

  async function ncConnectPayout() {
    if (!nc.email) { toast('Connectez-vous d’abord à votre console.'); return; }
    var box = $('notary-connect-errors');
    var btn = $('notary-connect');
    if (box) box.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Redirection…'; }
    await ncStartOnboard(nc.email, function (msg) {
      if (box) { clear(box); box.hidden = false; box.appendChild(el('li', null, msg)); }
      if (btn) { btn.disabled = false; btn.textContent = 'Connecter mon compte de paiement'; }
    });
  }

  // A valid email with no active subscription isn't an error — it's a NEW notary.
  // Offer free signup (which is what opens the console) instead of a dead end.
  function ncShowSignup(email) {
    ncSetErrors([]);
    nc.pendingSignupEmail = email;
    var who = $('notary-signup-email'); if (who) who.textContent = email;
    var errs = $('notary-signup-errors'); if (errs) errs.hidden = true;
    var btn = $('notary-signup-btn'); if (btn) { btn.disabled = false; btn.textContent = 'M’inscrire gratuitement →'; }
    var prompt = $('notary-signup-prompt'); if (prompt) { prompt.hidden = false; prompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
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
  async function ncCompleteAct(id, dateISO, actAmount, btn) {
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
        body: JSON.stringify({ bidId: id, dateISO: dateISO, actAmount: amt }),
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

  // Point every "add to your calendar" card at the PUBLIC carnet feed. One
  // click subscribes the whole carnet (all open dates, kept in sync) into the
  // visitor's Google / Outlook / Apple calendar; .ics covers everything else.
  // Two cards share the feed: the notaires landing (sub-*) and the client
  // carnet (csub-*).
  function wireCarnetSubscribe() {
    var http = apiBaseAbs() + '/carnet/feed.ics';
    var webcal = toWebcal(http);
    var name = T('Nota — carnet Québec');
    var google = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
    var outlook = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(http) + '&name=' + encodeURIComponent(name);
    function set(id, href) { var a = $(id); if (a) a.href = href; }
    ['sub', 'csub'].forEach(function (p) {
      set(p + '-ics', http);
      set(p + '-apple', webcal);
      set(p + '-google', google);
      set(p + '-outlook', outlook);
    });
  }

  // Email subscription beside the calendar card — the same public carnet,
  // delivered by courriel when a new date opens. Stored locally for the demo;
  // a deployment would register the address with the API's notifier instead.
  var LS_CARNET_MAIL = 'nota.carnet.mail.v1';
  function renderCarnetMail() {
    var form = $('carnet-mail-form'), done = $('carnet-mail-done');
    if (!form || !done) return;
    var email = flagGet(LS_CARNET_MAIL);
    form.hidden = !!email;
    done.hidden = !email;
    var addr = $('carnet-mail-addr');
    if (addr) addr.textContent = email ? 'Abonné : ' + email : '';
  }
  function carnetMailSubscribe() {
    var input = $('carnet-mail-input');
    var val = input ? input.value.trim() : '';
    if (!val || !D.isEmail(val)) { toast('Courriel invalide.'); return; }
    flagSet(LS_CARNET_MAIL, val); // local for the demo; a deployment would register this with the API's notifier
    toast('Abonné — vous recevrez les nouvelles dates.');
    renderCarnetMail();
  }
  function carnetMailUnsubscribe() {
    flagClear(LS_CARNET_MAIL);
    var input = $('carnet-mail-input'); if (input) input.value = '';
    toast('Désabonné.');
    renderCarnetMail();
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
    renderAccountMenu(); // session gone → menu falls back to client/anonymous
    if (msg) toast(msg);
  }

  async function ncSignIn(email) {
    email = (email || '').trim();
    var signup = $('notary-signup-prompt'); if (signup) signup.hidden = true; // reset on each attempt
    var r;
    try {
      r = await fetch(API_BASE + '/notary/session', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
    } catch (e) { ncSetErrors(['Console indisponible hors ligne. Réessayez une fois en ligne.']); return { ok: false }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      // Not a registered/active notary → this email just needs to sign up (free).
      // Offer onboarding right here instead of a dead-end "abonnement requis".
      if (r.status === 403 && j.errors && j.errors[0] && j.errors[0].code === 'abonnement_requis') {
        ncShowSignup(email);
        return { ok: false, signup: true };
      }
      ncSetErrors((j.errors || [{ message: 'Connexion refusée.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    ncSetErrors([]);
    nc.token = j.token; nc.feedToken = j.feedToken || null; nc.email = email;
    lsSave(LS_NC_TOKEN, j.token); lsSave(LS_NC_FEED_TOKEN, nc.feedToken); lsSave(LS_NC_EMAIL, email);
    ncRenderAuthState();
    renderAccountMenu(); // the account menu now reflects the notary session
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
    if (r.status === 404) { toast('Offre introuvable, elle a peut-être expiré.'); ncDropOpen(id); ncRenderOpen(); return; }
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

  // Live "money on the table" for the sign-in gate — real open demands + total value
  // this month (state.monthBids already holds only live, card-authorized offers), so a
  // prospective notary sees the payoff BEFORE committing to Stripe onboarding.
  function renderNotaryOpportunity() {
    var box = $('notary-opportunity'); if (!box) return;
    var open = (state.monthBids || []).filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    if (!open.length) { box.hidden = true; return; }
    var total = open.reduce(function (s, b) { return s + (Number(b.montant) || 0); }, 0);
    $('notary-opp-count').textContent = String(open.length);
    $('notary-opp-total').textContent = D.money(total);
    box.hidden = false;
  }

  // Public teaser of the live inventory on the signed-out landing: the month's
  // real open demands, soonest first, each card a button into the sign-in gate.
  // Capped — the full list is the payoff of signing in; overflow collapses into
  // one "+N autres" card. Hidden signed-in (the console's open list takes over)
  // and when the month has nothing open (no data → no empty section).
  // 8 + the "+N autres" overflow card = 9 = three clean rows of three at the
  // desktop card width; every narrower grid just wraps.
  var NC_LIVE_MAX = 8;
  function ncFocusGate() {
    var inp = $('nc-email'); if (!inp) return;
    if (inp.scrollIntoView) { try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
  }
  function ncLiveCard(b) {
    var svc = D.serviceById(b.serviceId);
    var tier = D.tierById(b.tier || 'standard') || D.tierById('standard');
    var card = el('button', 'nc-live-card');
    card.type = 'button';
    card.setAttribute('aria-label', 'Se connecter pour retenir : ' + (svc ? svc.nom : b.serviceId) +
      ', ' + dayShort(b.dateISO) + ', ' + D.money(b.montant));
    var top = el('div', 'nc-live-top');
    var s = el('span', 'nc-live-svc');
    // The act's colour token paints the glyph (currentColor); the name stays ink.
    s.style.color = 'var(--svc-' + b.serviceId + ')';
    var ic = svcIcon(b.serviceId, 15); if (ic) s.appendChild(ic);
    s.appendChild(el('span', 'nc-live-svc-name', svc ? svc.nomCourt : b.serviceId));
    top.appendChild(s);
    var pill = el('span', 'pill', tier.nom);
    pill.dataset.tier = tier.id;
    top.appendChild(pill);
    card.appendChild(top);
    card.appendChild(el('div', 'nc-live-amt', D.money(b.montant)));
    card.appendChild(el('div', 'nc-live-meta', dayShort(b.dateISO) + ' · ' + D.bidLabel(b)));
    card.addEventListener('click', ncFocusGate);
    return card;
  }
  function renderNotaryLive() {
    var box = $('notary-live'); if (!box) return;
    var gate = $('notary-auth-form');
    var open = (state.monthBids || [])
      .filter(function (b) { return b.status !== D.STATUS.RETENUE; })
      .slice()
      .sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0; });
    if (!open.length || !gate || gate.hidden) { box.hidden = true; return; }
    var sub = $('notary-live-sub');
    if (sub) {
      var total = open.reduce(function (s, b) { return s + (Number(b.montant) || 0); }, 0);
      sub.textContent = open.length + ' demande' + (open.length > 1 ? 's' : '') +
        ' ce mois-ci · ' + D.money(total) + ' à retenir';
    }
    var grid = $('notary-live-grid'); clear(grid);
    open.slice(0, NC_LIVE_MAX).forEach(function (b) { grid.appendChild(ncLiveCard(b)); });
    var extra = open.length - NC_LIVE_MAX;
    if (extra > 0) {
      var more = el('button', 'nc-live-card nc-live-more');
      more.type = 'button';
      more.appendChild(el('strong', null, '+' + extra + ' autre' + (extra > 1 ? 's' : '') + ' demande' + (extra > 1 ? 's' : '')));
      more.appendChild(el('span', 'nc-live-meta', 'Inscrivez-vous pour tout voir'));
      more.addEventListener('click', ncFocusGate);
      grid.appendChild(more);
    }
    box.hidden = false;
  }

  // --- Week vignette (onboarding dialog) ---------------------------------------
  // The marketplace played out with market data: real demands (D.weekAgenda over
  // state.monthBids) drop onto a Mon–Fri board one by one while the money counts
  // up; the board then clears and replays the NEXT batch (the domain rotates
  // through the pool via `offset`). One board under both onboarding views, two
  // flavours by role:
  //   • carnet (role choice + client steps) — open AND retained demands;
  //     retained ones flip to a ✓ once the board settles: the market clearing;
  //   • notaire (notary steps) — open demands only: a week paying out.
  // Self-stopping: every step re-checks the board is still on screen (dialog
  // open, page visible) — a closed dialog kills offsetParent, parking the loop.
  var fmtWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
  // Labels come from the locale, anchored on a known Monday (2024-01-01).
  var WEEK_DAY_LABELS = [0, 1, 2, 3, 4].map(function (i) {
    return fmtWeekday.format(new Date(Date.UTC(2024, 0, 1 + i))).replace(/\.$/, '');
  });

  // Restart a CSS animation class even when it is already applied — the reflow
  // between remove and add is what lets the same beat replay.
  function retrigger(elm, cls) {
    if (!elm) return;
    elm.classList.remove(cls); void elm.offsetWidth; elm.classList.add(cls);
  }

  // Float the just-landed amount up off the counter ("+680 $" … gone). One
  // reusable element per counter, re-armed on every landing.
  function weekDeltaPop(totalId, amount) {
    var out = $(totalId); if (!out || !out.parentElement) return;
    var d = out.parentElement.querySelector('.nc-week-delta');
    if (!d) { d = el('span', 'nc-week-delta'); out.parentElement.insertBefore(d, out); }
    d.textContent = '+' + D.money(amount);
    retrigger(d, 'is-live');
  }

  function makeWeekVignette(cfg) {
    var v = { timers: [], raf: null, offset: 0, cycling: false };

    function stop() {
      v.timers.forEach(clearTimeout); v.timers = [];
      if (v.raf) cancelAnimationFrame(v.raf); v.raf = null;
      v.cycling = false;
    }
    function later(fn, ms) { v.timers.push(setTimeout(fn, ms)); }
    function onScreen() {
      var box = $(cfg.box);
      return !!(box && !box.hidden && box.offsetParent && !document.hidden);
    }
    function batchNow() {
      var ret = typeof cfg.retenues === 'function' ? cfg.retenues() : cfg.retenues;
      return D.weekAgenda(state.monthBids, todayISO(), { offset: v.offset, retenues: ret });
    }

    // Count the total up smoothly — money() formats every frame so the vignette
    // never shows a number the rest of the app would not. A tracked timer
    // guarantees the FINAL figure even where rAF is suspended (throttled or
    // battery-saver tabs): the frames are decoration, the number is not.
    function tween(from, to) {
      var out = $(cfg.total); if (!out) return;
      if (v.raf) cancelAnimationFrame(v.raf);
      var t0 = performance.now(), dur = 550;
      function frame(t) {
        var k = Math.min(1, (t - t0) / dur);
        k = 1 - Math.pow(1 - k, 3);
        out.textContent = D.money(Math.round(from + (to - from) * k));
        v.raf = k < 1 ? requestAnimationFrame(frame) : null;
      }
      v.raf = requestAnimationFrame(frame);
      later(function () { out.textContent = D.money(to); }, dur + 100);
    }

    // Build the board for one batch: five labelled columns, a chip per demand in
    // its true weekday, ghost slots padding every column to the same height. The
    // service is said the way the carnet says it — a coloured dot, never a border.
    function build(batch) {
      var board = $(cfg.board); clear(board);
      var cols = WEEK_DAY_LABELS.map(function (lbl) {
        var col = el('div', 'nc-week-col');
        col.appendChild(el('span', 'nc-week-day', lbl));
        board.appendChild(col);
        return col;
      });
      var chips = batch.items.map(function (it, i) {
        var chip = el('div', 'nc-week-chip');
        chip.style.color = 'var(--svc-' + it.serviceId + ')';
        // A slight, index-derived lean on entry (see .nc-week-chip --tilt) so
        // consecutive drops don't read as one stamped pattern. Deterministic —
        // never Math.random, which would unsettle snapshots.
        chip.style.setProperty('--tilt', (((i % 3) - 1) * 2.5) + 'deg');
        chip.title = it.nomCourt + ' · ' + D.money(it.montant) + ' · ' + dayShort(it.dateISO) +
          (it.retenue ? ' · retenue par ' + (it.etude || 'un notaire') : '');
        var top = el('span', 'nc-week-chip-top');
        // The act's own glyph when it has one (it inherits the chip's --svc-*
        // colour via currentColor); the colour dot otherwise.
        top.appendChild(svcIcon(it.serviceId, 12) || el('span', 'nc-week-chip-dot'));
        top.appendChild(el('span', 'nc-week-chip-name', it.nomCourt));
        chip.appendChild(top);
        var amt = el('span', 'nc-week-chip-amt', D.money(it.montant));
        // The modal's five columns swap to the calendar's compact form
        // (data-compact) — the exact amount stays in the DOM and the tooltip.
        amt.dataset.compact = compactMoney(it.montant);
        chip.appendChild(amt);
        if (it.retenue) chip.appendChild(el('span', 'nc-week-chip-check', '✓'));
        cols[it.day].appendChild(chip);
        return chip;
      });
      cols.forEach(function (col) {
        while (col.children.length < 3) col.appendChild(el('div', 'nc-week-slot'));
      });
      return chips;
    }

    function cycle() {
      if (!onScreen()) { stop(); return; }
      var batch = batchNow();
      if (!batch.items.length) { stop(); $(cfg.box).hidden = true; return; }
      v.offset = (v.offset + batch.items.length) % Math.max(1, batch.poolSize);
      var chips = build(batch);
      $(cfg.board).classList.remove('is-out');
      $(cfg.total).textContent = D.money(0);
      var landed = 0;
      chips.forEach(function (chip, i) {
        later(function () {
          if (!onScreen()) { stop(); return; }
          chip.classList.add('is-in');
          var from = landed; landed += batch.items[i].montant;
          tween(from, landed);
          // Three beats per landing: the counter pops, the amount floats off
          // it, and the receiving day lights up.
          retrigger($(cfg.total), 'is-tick');
          weekDeltaPop(cfg.total, batch.items[i].montant);
          retrigger(chip.parentElement && chip.parentElement.querySelector('.nc-week-day'), 'is-hit');
          // The cycle's tail anchors on the LAST landing, never on wall-clock
          // arithmetic from cycle start: background-tab timer clamping can
          // stretch the landings, and the flip must not fire before the final
          // chip is in.
          if (i === chips.length - 1) {
            later(function () {
              // Taken demands flip to their ✓ one by one — the clearing told
              // as a sequence, not a switch.
              var nth = 0;
              chips.forEach(function (c, j) {
                if (!batch.items[j].retenue) return;
                later(function () { c.classList.add('is-taken'); }, nth * 220);
                nth++;
              });
            }, 700);
            later(function () { $(cfg.board).classList.add('is-out'); }, 3800);
            later(cycle, 4300);
          }
        }, 500 + i * 650);
      });
    }

    function render() {
      var box = $(cfg.box); if (!box) return;
      var batch = batchNow();
      if ((cfg.enabled && !cfg.enabled()) || !batch.items.length) { stop(); box.hidden = true; return; }
      box.hidden = false;
      // Reduced motion: the filled board, its true total, no loop.
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        stop();
        build(batch).forEach(function (chip, i) {
          chip.classList.add('is-in');
          if (batch.items[i].retenue) chip.classList.add('is-taken');
        });
        $(cfg.total).textContent = D.money(batch.total);
        return;
      }
      if (v.cycling) return; // a loop already drives the board
      v.cycling = true;
      cycle();
    }

    return { render: render, restart: function () { stop(); render(); }, stop: stop };
  }

  // Which onboarding view is on screen — each gets its own animation:
  //   • 'role'    (role choice)  — the week board, carnet flavour, act glyphs;
  //   • 'client'  (client steps) — ONE bid played out (the bid vignette);
  //   • 'notaire' (notary steps) — the week board paying out + agenda providers.
  function onbView() {
    var dlg = $('onboarding-dialog'), steps = $('onb-view-steps');
    if (!dlg || !steps || steps.hidden) return 'role';
    return dlg.getAttribute('data-role') === 'notary' ? 'notaire' : 'client';
  }

  var weekVigOnb = makeWeekVignette({
    box: 'ob-week', board: 'ob-week-board', total: 'ob-week-total',
    retenues: function () { return onbView() !== 'notaire'; },
    enabled: onbDialogOpen,
  });

  // --- Bid vignette (client onboarding step) -----------------------------------
  // One real demand from the carnet played out end to end: the price climbs
  // from the act's starting price to the offered amount, the demand lands au
  // carnet, then a notaire retains it (or the city sees it). Cycles through
  // the month's bids, retained ones first — the happy ending leads. Same
  // lifecycle discipline as the board: every step re-checks the vignette is
  // still on screen, and closing the dialog parks the loop.
  var bidVigOnb = (function () {
    var v = { timers: [], raf: null, idx: 0, cycling: false };

    function stop() {
      v.timers.forEach(clearTimeout); v.timers = [];
      if (v.raf) cancelAnimationFrame(v.raf); v.raf = null;
      v.cycling = false;
    }
    function later(fn, ms) { v.timers.push(setTimeout(fn, ms)); }
    function onScreen() {
      var box = $('ob-bid');
      return !!(box && !box.hidden && box.offsetParent && !document.hidden);
    }
    function pool() {
      var valid = (state.monthBids || []).filter(function (b) {
        return !!(b && b.dateISO && D.serviceById(b.serviceId));
      });
      var retained = valid.filter(function (b) { return b.status === D.STATUS.RETENUE; });
      var open = valid.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
      // The client leads with the happy ending (demands DO get taken); the
      // notary leads with what is still takeable.
      return onbView() === 'notaire' ? open.concat(retained) : retained.concat(open);
    }
    // The amount climbs from the act's starting price to the offer — money()
    // formats every frame so the vignette never shows a foreign number.
    function tweenAmt(from, to) {
      var out = $('ob-bid-amt'); if (!out) return;
      if (v.raf) cancelAnimationFrame(v.raf);
      var t0 = performance.now(), dur = 900;
      function frame(t) {
        var k = Math.min(1, (t - t0) / dur);
        k = 1 - Math.pow(1 - k, 3);
        out.textContent = D.money(Math.round(from + (to - from) * k));
        if (k < 1) { v.raf = requestAnimationFrame(frame); }
        else { v.raf = null; retrigger(out, 'is-tick'); } // settle with a pop
      }
      v.raf = requestAnimationFrame(frame);
      // The final figure is guaranteed by a tracked timer even where rAF is
      // suspended — the frames are decoration, the number is not.
      later(function () { out.textContent = D.money(to); }, dur + 100);
    }
    // The card (glyph, act, signing date) and the closing stamp for one bid.
    function fill(b) {
      var svc = D.serviceById(b.serviceId);
      var icBox = $('ob-bid-ic');
      if (icBox) {
        clear(icBox);
        icBox.style.color = 'var(--svc-' + svc.id + ')';
        var ic = svcIcon(svc.id, 18); if (ic) icBox.appendChild(ic);
      }
      var name = $('ob-bid-name'); if (name) name.textContent = svc.nom;
      var date = $('ob-bid-date'); if (date) date.textContent = dayTitle(b.dateISO);
      // The same story reads from either side: the head and the open-bid
      // outcome speak to whoever is being onboarded.
      var notaire = onbView() === 'notaire';
      var kick = $('ob-bid-kicker');
      if (kick) kick.textContent = notaire ? 'Des demandes réelles — retenues en un clic' : 'Vous proposez — un notaire retient';
      var fin = $('ob-bid-stamp-fin');
      if (fin) {
        clear(fin);
        if (b.status === D.STATUS.RETENUE) {
          fin.appendChild(el('span', 'nc-week-check-key', '✓'));
          fin.appendChild(document.createTextNode(' Retenue par ' + (b.etude || 'un notaire')));
        } else {
          fin.textContent = notaire ? 'Ouverte — à retenir en un clic' : 'Ouverte — les notaires de Québec la voient';
        }
      }
      return svc;
    }
    function cycle() {
      if (!onScreen()) { stop(); return; }
      var list = pool();
      if (!list.length) { stop(); var b0 = $('ob-bid'); if (b0) b0.hidden = true; return; }
      var b = list[v.idx % list.length];
      v.idx = (v.idx + 1) % list.length;
      var svc = fill(b);
      var scene = $('ob-bid-scene'), pub = $('ob-bid-stamp-pub'), fin = $('ob-bid-stamp-fin');
      var card = document.querySelector('#ob-bid .ob-bid-card');
      if (scene) scene.classList.remove('is-out');
      if (pub) pub.classList.remove('is-on');
      if (fin) fin.classList.remove('is-on');
      if (card) card.classList.remove('is-pub');
      retrigger(scene, 'is-live'); // the fresh card settles in
      var amt = $('ob-bid-amt'); if (amt) amt.textContent = D.money(svc.prixDepart || 0);
      later(function () {
        if (!onScreen()) { stop(); return; }
        tweenAmt(svc.prixDepart || 0, Number(b.montant) || 0);
      }, 400);
      later(function () {
        if (!onScreen()) { stop(); return; }
        if (pub) pub.classList.add('is-on');
        if (card) retrigger(card, 'is-pub'); // the card rings as it lands au carnet
      }, 1300);
      later(function () {
        if (!onScreen()) { stop(); return; }
        if (fin) fin.classList.add('is-on');
      }, 2600);
      later(function () { if (scene) scene.classList.add('is-out'); }, 4700);
      later(cycle, 5200);
    }
    function render() {
      var box = $('ob-bid'); if (!box) return;
      var list = pool();
      if (!onbDialogOpen() || !list.length) { stop(); box.hidden = true; return; }
      box.hidden = false;
      // Reduced motion: one completed story — final amount, both stamps.
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        stop();
        var b = list[v.idx % list.length];
        fill(b);
        var amt = $('ob-bid-amt'); if (amt) amt.textContent = D.money(Number(b.montant) || 0);
        var scene = $('ob-bid-scene'); if (scene) scene.classList.remove('is-out');
        var pub = $('ob-bid-stamp-pub'); if (pub) pub.classList.add('is-on');
        var fin = $('ob-bid-stamp-fin'); if (fin) fin.classList.add('is-on');
        return;
      }
      if (v.cycling) return; // a loop already drives the vignette
      v.cycling = true;
      cycle();
    }

    return { render: render, restart: function () { stop(); render(); }, stop: stop };
  })();

  // On a phone the steps view already fills the screen: the five-column board
  // under it is too much. Both STEPS views focus on the single-bid story there;
  // the board stays for the role choice and for wide screens.
  var onbMobileMq = window.matchMedia ? window.matchMedia('(max-width: 680px)') : null;
  function renderOnbWeekAnim() {
    var view = onbView();
    var mobileSteps = view === 'notaire' && onbMobileMq && onbMobileMq.matches;
    if (view === 'client' || mobileSteps) {
      // The steps trade the board for one bid played out in full.
      weekVigOnb.stop();
      var wk = $('ob-week'); if (wk) wk.hidden = true;
      bidVigOnb.restart();
      return;
    }
    bidVigOnb.stop();
    var bid = $('ob-bid'); if (bid) bid.hidden = true;
    // The head, key line and providers row follow the flavour before the
    // board (re)starts.
    var notaire = view === 'notaire';
    var kick = $('ob-week-kicker'); if (kick) kick.textContent = notaire ? 'Une semaine sur Nota' : 'Cette semaine à Québec';
    var mode = $('ob-week-mode'); if (mode) mode.textContent = notaire ? 'à la signature' : 'en jeu';
    var noteC = $('ob-week-note-carnet'); if (noteC) noteC.hidden = notaire;
    var noteN = $('ob-week-note-notaire'); if (noteN) noteN.hidden = !notaire;
    var prov = $('ob-week-providers');
    if (prov) {
      prov.hidden = !notaire;
      if (notaire) retrigger(prov, 'is-live'); // the agenda marks file in
    }
    weekVigOnb.restart();
  }

  // The loop parks itself when the page is hidden; wake it on return — but
  // only when the dialog is actually open: for everyone else this would just
  // rewrite text inside a closed dialog for nothing.
  document.addEventListener('visibilitychange', function () {
    var dlg = $('onboarding-dialog');
    if (!document.hidden && dlg && dlg.open) renderOnbWeekAnim();
  });
  // Crossing the phone breakpoint swaps which vignette a steps view carries.
  if (onbMobileMq) {
    var onbMqChange = function () { renderOnbWeekAnim(); };
    if (onbMobileMq.addEventListener) onbMobileMq.addEventListener('change', onbMqChange);
    else if (onbMobileMq.addListener) onbMobileMq.addListener(onbMqChange);
  }

  // --- Lead-delivery preferences ---------------------------------------------
  // How (in-app / email / SMS) and at what PACE Nota alerts this notary about new
  // matching demands, plus which acts + urgency they care about. Stored per email
  // (local for the demo; a deployment would sync these to the API so the server's
  // notifier + an SMS adapter respect them).
  var LS_NC_PREFS = 'nota.notary.prefs.v1';
  var ncPrefsSavedT = null;
  function ncDefaultPrefs() {
    var svc = {}; D.SERVICES.forEach(function (s) { svc[s.id] = true; });
    return { email: true, sms: false, phone: '', pace: 'instant', urgent: false, services: svc };
  }
  function ncPrefsGet(email) {
    var d = ncDefaultPrefs();
    var stored = (lsLoad(LS_NC_PREFS) || {})[email] || {};
    return Object.assign(d, stored, { services: Object.assign(d.services, stored.services || {}) });
  }
  function ncPrefsSave(email, prefs) {
    var all = lsLoad(LS_NC_PREFS) || {}; all[email] = prefs; lsSave(LS_NC_PREFS, all);
    var saved = $('notary-prefs-saved');
    if (saved) { saved.hidden = false; clearTimeout(ncPrefsSavedT); ncPrefsSavedT = setTimeout(function () { saved.hidden = true; }, 2200); }
  }
  function ncPrefsPatch(patch) { if (nc.email) ncPrefsSave(nc.email, Object.assign(ncPrefsGet(nc.email), patch)); }
  function ncRenderPrefs() {
    if (!nc.email) return;
    var p = ncPrefsGet(nc.email);
    var chk = function (id, on) { var e = $(id); if (e) e.checked = !!on; };
    chk('pref-ch-email', p.email); chk('pref-ch-sms', p.sms); chk('pref-urgent', p.urgent);
    if ($('pref-phone')) $('pref-phone').value = p.phone || '';
    if ($('pref-phone-row')) $('pref-phone-row').hidden = !p.sms;
    document.querySelectorAll('#pref-pace .seg-btn').forEach(function (b) {
      var on = b.dataset.pace === p.pace; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var svcWrap = $('pref-svc');
    if (svcWrap && !svcWrap.children.length) {
      D.SERVICES.forEach(function (s) {
        var c = el('button', 'chip', s.nom.split(' ')[0]); c.type = 'button'; c.dataset.svc = s.id;
        svcWrap.appendChild(c);
      });
    }
    if (svcWrap) svcWrap.querySelectorAll('.chip').forEach(function (c) {
      var on = p.services[c.dataset.svc] !== false; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function ncRenderAuthState() {
    var authed = !!nc.token;
    var form = $('notary-auth-form'); var view = $('notary-authed');
    if (form) form.hidden = authed;
    if (view) view.hidden = !authed;
    renderNotaryLive(); // the teaser follows the gate: shown signed-out, gone signed-in
    if (authed) {
      var lbl = $('notary-email-label'); if (lbl) lbl.textContent = nc.email || '';
      ncRenderPrefs(); // lead-delivery preferences for this notary
      // The webcal URL carries ONLY the read-only feed token, never the session
      // token — a leaked calendar URL must not authorize accept/dossier.
      // Full sync options for the notary's retained-signings feed (like the
      // public carnet card): Google / Outlook / Apple / iCal, all from the
      // read-only FEED token.
      if (nc.feedToken) {
        var http = apiBaseAbs() + '/notary/feed.ics?token=' + encodeURIComponent(nc.feedToken);
        var webcal = toWebcal(http);
        var name = T('Nota — signatures retenues');
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
    // Block the date before deciding: the signing day, straight into the
    // notary's own agenda, without retaining the demande first.
    var hold = miniBtn('agenda', 'Bloquer cette date dans mon agenda');
    hold.href = calendarLinks(b).ics;
    hold.setAttribute('download', 'nota-' + b.dateISO + '.ics');
    actions.appendChild(hold);
    card.appendChild(actions);
    return card;
  }

  function ncComplexityPill(c) {
    var labels = { simple: 'Cas simple', standard: 'Cas standard', complexe: 'Cas complexe' };
    var pill = el('span', 'nc-complexity', labels[c.level] || c.level);
    pill.dataset.level = c.level;
    return pill;
  }

  function ncRenderOpen() {
    var list = $('notary-open-list'); if (!list) return; clear(list);
    var empty = $('notary-open-empty');
    var head = $('notary-open-h');
    // Soonest signature date first — a notary competes on TIME, so the nearest
    // deadlines (the offers about to be grabbed) lead. Count in the heading.
    var open = nc.open.slice().sort(function (a, b) {
      return a.dateISO.localeCompare(b.dateISO) || (b.montant || 0) - (a.montant || 0);
    });
    if (head) head.textContent = open.length ? 'Demandes ouvertes · ' + open.length : 'Demandes ouvertes';
    if (!open.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    open.forEach(function (b) { list.appendChild(ncOpenCard(b)); });
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
    var card = el('div', 'nc-card is-retained'); card.dataset.id = entry.id; card.dataset.date = entry.dateISO || '';
    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', svc ? svc.nom : entry.serviceId));
    head.appendChild(el('div', 'nc-card-amount', D.money(entry.montant)));
    card.appendChild(head);
    var meta = el('div', 'nc-card-meta');
    meta.appendChild(el('span', 'nc-date', dayTitle(entry.dateISO)));
    if (entry.prefixe) meta.appendChild(el('span', 'nc-prefixe', entry.prefixe));
    meta.appendChild(ncTierPill(entry.tier));
    meta.appendChild(el('span', 'pill pill-retenue', 'Retenue'));
    card.appendChild(meta);
    card.appendChild(ncDossierBlock(entry));
    card.appendChild(ncCompleteBlock(entry));
    return card;
  }

  function ncRenderRetained() {
    var list = $('notary-retained-list'); if (!list) return; clear(list);
    var empty = $('notary-retained-empty');
    var items = nc.email ? ncRetainedFor(nc.email) : [];
    ncRenderEarnings();
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    items.slice().sort(function (a, b) { return a.dateISO.localeCompare(b.dateISO); })
      .forEach(function (e) { list.appendChild(ncRetainedCard(e)); });
  }

  // Earnings roll-up so the notary sees exactly what they realised, what Nota
  // took as commission (the real server-charged fee), and their net — plus what
  // is still in progress. All figures come from the completed retained acts.
  function ncEarnings(email) {
    var items = email ? ncRetainedFor(email) : [];
    var e = { done: 0, realized: 0, commission: 0, net: 0, pending: 0, pendingVal: 0 };
    items.forEach(function (it) {
      if (it.completed) {
        e.done++;
        e.realized += Number(it.actAmount) || 0;
        e.commission += (Number(it.commissionCents) || 0) / 100;
      } else {
        e.pending++;
        e.pendingVal += Number(it.montant) || 0;
      }
    });
    e.net = e.realized - e.commission;
    return e;
  }
  function ncRenderEarnings() {
    var box = $('notary-earnings'); if (!box) return; clear(box);
    var e = ncEarnings(nc.email);
    function tile(k, v, cls) {
      var t = el('div', 'nc-stat' + (cls ? ' ' + cls : ''));
      t.appendChild(el('div', 'nc-stat-v', v));
      t.appendChild(el('div', 'nc-stat-k', k));
      return t;
    }
    var grid = el('div', 'nc-stats');
    grid.appendChild(tile('Actes complétés', String(e.done)));
    grid.appendChild(tile('Valeur réalisée', D.money(e.realized)));
    grid.appendChild(tile('Commission Nota', D.money(e.commission)));
    grid.appendChild(tile('Net à vous', D.money(e.net), 'nc-stat-net'));
    box.appendChild(grid);
    if (e.pending) {
      box.appendChild(el('p', 'help', e.pending + ' dossier' + (e.pending > 1 ? 's' : '') + ' à compléter · valeur estimée ' + D.money(e.pendingVal) + '. La commission n’est prélevée qu’à la signature, sur la valeur confirmée.'));
    } else if (!e.done) {
      box.appendChild(el('p', 'help', 'Vos revenus et la commission Nota s’afficheront ici dès votre premier acte complété.'));
    }
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
      // Pre-fill the email for a notary returning from Stripe onboarding (or a
      // repeat visit), so they finish sign-in in one click. Never a token.
      var inp = $('nc-email');
      if (inp && !inp.value && typeof em === 'string' && em) inp.value = em;
    }
    renderAccountMenu(); // reflect any restored session (or its absence) at boot
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  // ARIA tabs pattern: one header tab in the Tab order (roving tabindex), the
  // rest reached with arrow keys. Panes without a header tab (profil, legal)
  // keep the first tab reachable so the tablist never becomes a dead end.
  function syncNavTabs(tab) {
    var tabs = document.querySelectorAll('.nav-tab');
    var anySelected = false;
    tabs.forEach(function (b) {
      var sel = b.dataset.tab === tab;
      if (sel) anySelected = true;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
    });
    if (!anySelected && tabs.length) tabs[0].tabIndex = 0;
    // The drawer's section links track the same selection (no tablist ARIA —
    // they are plain nav links; aria-current says which page they're on).
    document.querySelectorAll('.mnav-link[data-tab]').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  function setTab(tab, opts) {
    opts = opts || {};
    state.tab = tab;
    syncNavTabs(tab);
    ['carnet', 'dossier', 'notaires', 'profil', 'confidentialite', 'conditions', 'charte'].forEach(function (t) {
      var pane = $('pane-' + t);
      if (!pane) return;
      var active = t === tab;
      pane.classList.toggle('is-active', active);
      pane.hidden = !active;
    });
    if (tab === 'dossier') renderDossier();
    if (tab === 'profil') renderProfil();
    if (tab === 'notaires') { renderNotaryOpportunity(); renderNotaryLive(); }
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'auto' });
    // Move focus into the new pane's heading so keyboard/SR users are never dropped
    // to <body> when a menu/link navigates and its container is hidden. The
    // focus-visible ring only shows for keyboard users, so mouse clicks are unaffected.
    if (opts.focus !== false) {
      var activePane = $('pane-' + tab);
      var h = activePane && activePane.querySelector('h1');
      if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    }
  }

  // ---------------------------------------------------------------------------
  // Contact actions — one email button, and a call button ONLY when a real line
  // exists (D.CONTACT.telephone). Both read the domain, so the address lives in
  // exactly one place across web and email.
  // ---------------------------------------------------------------------------
  function renderContact() {
    var host = $('footer-contact');
    if (!host) return;
    clear(host);
    var c = D.CONTACT || {};
    if (c.courriel) {
      var mail = miniBtn('courriel', 'Écrire à ' + c.courriel);
      mail.href = 'mailto:' + c.courriel;
      host.appendChild(mail);
    }
    var tel = D.telHref(c.telephone);
    if (tel) {
      var call = miniBtn('telephone', 'Appeler ' + c.telephone);
      call.href = tel;
      host.appendChild(call);
    }
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
      // The rolling window crosses the month seam, so it needs BOTH months it
      // spans — otherwise next month's first days would render as empty when
      // they carry offers. A plain month view loads just itself, as before.
      var months = [monthKey(state.anchor)];
      var win = calWindow();
      if (win && months.indexOf(monthKey(win.end)) < 0) months.push(monthKey(win.end));
      var lists = await Promise.all(months.map(function (m) { return store.listMonth(m); }));
      state.monthBids = Array.prototype.concat.apply([], lists);
    } finally {
      if (panel) panel.classList.remove('is-loading');
    }
    renderNotaryOpportunity(); // keep the gate's live "money on the table" fresh
    renderNotaryLive(); // and the landing's open-demand teaser
    renderOnbWeekAnim(); // and the welcome dialog's live week board, if open
    renderLegend(); // the legend's multipliers are tuned on the freshly loaded month
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
    syncNavTabs(state.tab); // roving tabindex from the very first paint
    // Horizontal tablist keyboard: Left/Right move and activate (automatic
    // activation — two tabs, both cheap to render), Home/End jump.
    var tablist = document.querySelector('.nav-tabs');
    if (tablist) tablist.addEventListener('keydown', function (e) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('.nav-tab'));
      if (!tabs.length) return;
      var i = tabs.indexOf(document.activeElement);
      var next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1 + tabs.length) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      setTab(next.dataset.tab, { focus: false });
      try { next.focus(); } catch (er) {}
    });
    $('theme-toggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Mobile nav drawer (hamburger). Same actions as the header — setTab, the
    // auth modal, the theme switch — behind phone chrome. The goto-link legal
    // rows are handled by the delegated document listener below; the drawer
    // only has to close itself after any choice.
    var mnav = $('mobile-nav'), mnavScrim = $('mnav-scrim'), navBurger = $('nav-burger');
    function setMobileNav(open) {
      if (!mnav || !mnavScrim || !navBurger) return;
      mnav.classList.toggle('is-open', open);
      mnavScrim.classList.toggle('is-open', open);
      navBurger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.documentElement.classList.toggle('nav-open', open);
      // Focus follows the panel in, and returns to the burger on the way out.
      if (open) { var first = mnav.querySelector('.mnav-link'); if (first) try { first.focus(); } catch (e) {} }
      else if (mnav.contains(document.activeElement)) { try { navBurger.focus(); } catch (e) {} }
    }
    if (mnav && mnavScrim && navBurger) {
      navBurger.addEventListener('click', function () { setMobileNav(!mnav.classList.contains('is-open')); });
      $('mnav-close').addEventListener('click', function () { setMobileNav(false); });
      mnavScrim.addEventListener('click', function () { setMobileNav(false); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && mnav.classList.contains('is-open')) setMobileNav(false);
      });
      mnav.querySelectorAll('.mnav-link[data-tab]').forEach(function (b) {
        b.addEventListener('click', function () { setTab(this.dataset.tab); });
      });
      $('mnav-theme').addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        setTheme(cur === 'dark' ? 'light' : 'dark');
      });
      var mLogin = $('mnav-login'); if (mLogin) mLogin.addEventListener('click', function () { openAuthModal(); });
      var mSignup = $('mnav-signup'); if (mSignup) mSignup.addEventListener('click', function () { openAuthModal(); });
      // Any committed choice closes the drawer (links navigate via their own
      // handlers; the auth buttons open a modal above the page).
      mnav.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.mnav-link, .mnav-auth .btn')) setMobileNav(false);
      });
    }

    // Footer base line: the year comes from the clock, not the markup.
    var fy = $('footer-year'); if (fy) fy.textContent = String(new Date().getFullYear());

    // Notification bell
    $('notif-bell').addEventListener('click', function (e) { e.stopPropagation(); toggleNotifPanel(); });
    $('notif-clear').addEventListener('click', markAllRead);
    $('notif-panel').addEventListener('click', function (e) { e.stopPropagation(); });
    // Up/Down walk the panel's rows (wrapping), Home/End jump — the menu half
    // of the menu-button contract the account panel signs up for.
    $('notif-panel').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      var items = acctMenuItems(); if (!items.length) return;
      var i = items.indexOf(document.activeElement);
      var next;
      if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      else if (i < 0) next = e.key === 'ArrowDown' ? items[0] : items[items.length - 1];
      else next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      e.preventDefault();
      try { next.focus(); } catch (er) {}
    });
    // A menu must not linger once focus has moved on (e.g. Tab past its end).
    document.addEventListener('focusin', function (e) {
      var panel = $('notif-panel');
      if (!panel || panel.hidden) return;
      var wrap = document.querySelector('.acct-wrap');
      if (wrap && e.target instanceof Element && !wrap.contains(e.target)) toggleNotifPanel(false);
    });
    // Account-menu items → switch pane, then close the menu. The identity head
    // routes by role (notary console / client profile / anonymous sign-in).
    $('acct-profil').addEventListener('click', onAcctHeadClick);
    $('acct-confid').addEventListener('click', function () { setTab('confidentialite'); toggleNotifPanel(false); });
    $('acct-conditions').addEventListener('click', function () { setTab('conditions'); toggleNotifPanel(false); });
    $('acct-charte').addEventListener('click', function () { setTab('charte'); toggleNotifPanel(false); });

    // Sign-in / sign-up modal: role toggle, social options, courriel path.
    document.querySelectorAll('#auth-role .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { authSetRole(b.dataset.role); });
    });
    document.querySelectorAll('.auth-oauth').forEach(function (b) {
      b.addEventListener('click', function () { authSocial(b.dataset.provider); });
    });
    var authForm = $('auth-email-form'); if (authForm) authForm.addEventListener('submit', authSubmitEmail);
    var hLogin = $('header-login'); if (hLogin) hLogin.addEventListener('click', function () { openAuthModal(); });
    var hSignup = $('header-signup'); if (hSignup) hSignup.addEventListener('click', function () { openAuthModal(); });
    renderAccountMenu(); // set the initial logged-out (auth buttons) / signed-in (avatar) state
    // Click the backdrop (outside the body) to dismiss.
    var authDlg = $('auth-dialog');
    if (authDlg) authDlg.addEventListener('click', function (e) { if (e.target === authDlg) { try { authDlg.close(); } catch (er) {} } });

    // Onboarding guide: role choice → steps, back, skip, CTA, dismissals.
    document.querySelectorAll('#onb-view-role .onb-choice').forEach(function (b) {
      b.addEventListener('click', function () {
        var role = b.getAttribute('data-role');
        onbCount('role_' + role); // counted on the CLICK, not on view render —
        // the resume path also renders the steps view without a new choice.
        onbShowStepsView(role);
      });
    });
    // Arrow keys move between the role cards — standard grouped-choice
    // keyboard behaviour; Enter/Space already activate them as buttons.
    var onbChoices = document.querySelector('#onb-view-role .onb-choices');
    if (onbChoices) {
      onbChoices.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) return;
        var btns = Array.prototype.slice.call(onbChoices.querySelectorAll('.onb-choice'));
        var i = btns.indexOf(document.activeElement);
        if (i === -1) return;
        e.preventDefault();
        var back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        var next = btns[(i + (back ? btns.length - 1 : 1)) % btns.length];
        if (next) { try { next.focus(); } catch (er) {} }
      });
    }
    var onbBack = $('onb-back'); if (onbBack) onbBack.addEventListener('click', onbShowRoleView);
    var onbSkip = $('onb-skip'); if (onbSkip) onbSkip.addEventListener('click', onbDismiss);
    // Guard the arg: a click event object is truthy and would read as "explore".
    var onbCta = $('onb-cta'); if (onbCta) onbCta.addEventListener('click', function () { onbComplete(false); });
    var onbAlt = $('onb-alt'); if (onbAlt) onbAlt.addEventListener('click', function () { onbComplete(true); });
    var onbDlg = $('onboarding-dialog');
    if (onbDlg) {
      // Backdrop click dismisses. `close` covers the ambiguous exits (✕ /
      // Escape / backdrop) — those defer rather than flag, so a mis-click is
      // recoverable; "Passer" and the CTAs flag the guide themselves.
      onbDlg.addEventListener('click', function (e) { if (e.target === onbDlg) { try { onbDlg.close(); } catch (er) {} } });
      onbDlg.addEventListener('close', function () {
        // Deterministic teardown: don't leave queued vignette timers firing
        // against a closed dialog until the next onScreen() check parks them.
        weekVigOnb.stop(); bidVigOnb.stop();
        onbDefer();
      });
    }
    var onbLink = $('footer-guide');
    if (onbLink) onbLink.addEventListener('click', function (e) { e.preventDefault(); onbOpen(); });

    // Delegated in-content / footer links that jump to a tab-pane by name.
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('.goto-link[data-goto]');
      if (!g) return;
      e.preventDefault(); setTab(g.dataset.goto); toggleNotifPanel(false);
    });
    document.addEventListener('click', function () { toggleNotifPanel(false); });
    // Escape closes the account menu AND hands focus back to its trigger —
    // dismissing must never drop a keyboard user onto <body>.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var panel = $('notif-panel');
      if (!panel || panel.hidden) return;
      toggleNotifPanel(false);
      var bell = $('notif-bell'); if (bell) { try { bell.focus(); } catch (er) {} }
    });

    // Calendar
    $('cal-prev').addEventListener('click', function () { step(-1); });
    $('cal-next').addEventListener('click', function () { step(1); });
    $('cal-today').addEventListener('click', function () { state.anchor = firstOfMonth(todayISO()); state.focusDate = todayISO(); reloadAndRender(); });
    $('cal-grid').addEventListener('keydown', onGridKey);

    // Filters — chip + segmented groups, single-select each
    $('chips-service').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; setGroupActive(this, b); state.filters.service = b.dataset.svc; afterFilterChange(); });
    // Hero pulse rows are a second entry point into the same service filter:
    // click the act you came for, the carnet below narrows to it; click again
    // to clear. The chip group stays in sync so there is one source of truth.
    var pulse = $('pulse-rows');
    if (pulse) {
      pulse.addEventListener('click', function (e) {
        var row = e.target.closest('.pulse-row');
        if (!row) return;
        state.filters.service = state.filters.service === row.dataset.svc ? '' : row.dataset.svc;
        syncFilterChips();
        afterFilterChange();
      });
    }
    $('chips-montant').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; setGroupActive(this, b); state.filters.min = b.dataset.min ? Number(b.dataset.min) : null; afterFilterChange(); });
    $('seg-statut').addEventListener('click', function (e) { var b = e.target.closest('.seg-btn'); if (!b) return; setGroupActive(this, b); state.filters.statut = b.dataset.statut; afterFilterChange(); });
    $('seg-sort').addEventListener('click', function (e) { var b = e.target.closest('.seg-btn'); if (!b) return; setGroupActive(this, b); state.filters.sort = b.dataset.sort; afterFilterChange(); });
    $('filters-reset').addEventListener('click', resetFilters);
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
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      var btn = $('cal-maximize');
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
      if (state.selectedDate) renderDayBids(state.selectedDate); // list follows the act
    });
    $('o-date').addEventListener('change', onOfferDateChange);
    $('o-date').addEventListener('input', onOfferDateChange);
    $('o-amount').addEventListener('input', onAmountChange);
    // One tap over the bar: jump the slider just past the act's best open offer.
    $('day-beat').addEventListener('click', function () {
      var t = beatAmount(); if (t == null) return;
      $('o-amount').value = t;
      onAmountChange();
      var disp = $('o-amount-display');
      if (disp) { disp.classList.remove('flash'); void disp.offsetWidth; disp.classList.add('flash'); }
    });
    $('o-anon').addEventListener('change', onAnonToggle);
    $('o-prefix').addEventListener('input', onPrefixInput);
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
    // Same door: a new notary's signup CTA starts the free Stripe onboarding.
    var ncSignup = $('notary-signup-btn');
    if (ncSignup) ncSignup.addEventListener('click', function () {
      var email = nc.pendingSignupEmail || ($('nc-email') && $('nc-email').value.trim());
      try { if (email) lsSave(LS_NC_EMAIL, email); } catch (e) {} // remember for the return from Stripe
      ncSignup.disabled = true; ncSignup.textContent = 'Redirection vers l’inscription…';
      ncStartOnboard(email, function (msg) {
        ncSignup.disabled = false; ncSignup.textContent = 'M’inscrire gratuitement →';
        var box = $('notary-signup-errors');
        if (box) { clear(box); box.hidden = false; box.appendChild(el('li', null, msg)); }
      });
    });
    var ncOut = $('notary-signout'); if (ncOut) ncOut.addEventListener('click', ncSignOut);
    var ncRef = $('notary-refresh'); if (ncRef) ncRef.addEventListener('click', function () { ncLoadBids().then(function (ok) { if (ok) toast('Demandes rafraîchies.'); }); });

    // Lead-delivery preferences — every control saves on change (per notary).
    if ($('pref-ch-email')) $('pref-ch-email').addEventListener('change', function () { ncPrefsPatch({ email: this.checked }); });
    if ($('pref-ch-sms')) $('pref-ch-sms').addEventListener('change', function () { ncPrefsPatch({ sms: this.checked }); if ($('pref-phone-row')) $('pref-phone-row').hidden = !this.checked; });
    if ($('pref-phone')) $('pref-phone').addEventListener('change', function () { ncPrefsPatch({ phone: this.value.trim() }); });
    if ($('pref-urgent')) $('pref-urgent').addEventListener('change', function () { ncPrefsPatch({ urgent: this.checked }); });
    var ncPace = $('pref-pace');
    if (ncPace) ncPace.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      ncPace.querySelectorAll('.seg-btn').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      ncPrefsPatch({ pace: b.dataset.pace });
    });
    var ncSvc = $('pref-svc');
    if (ncSvc) ncSvc.addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      var on = !c.classList.contains('is-on'); c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
      var svc = ncPrefsGet(nc.email).services; svc[c.dataset.svc] = on; ncPrefsPatch({ services: svc });
    });
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
      ncCompleteAct(card.dataset.id, card.dataset.date, input ? input.value : '', btn);
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
  // After the client authorizes (or cancels) their card on Stripe's hosted
  // Checkout, Stripe redirects back with ?paiement=ok|annule. Surface a short
  // status and strip the param so a reload is clean. Publication itself is
  // confirmed server-side by the authorization webhook, so this is informational.
  function handleCheckoutReturn() {
    var q = new URLSearchParams(location.search);
    var p = q.get('paiement');
    if (!p) return;
    if (p === 'ok') toast('Paiement autorisé. Votre offre est en cours de publication.');
    else if (p === 'annule') toast('Paiement annulé. Votre offre n’a pas été publiée.');
    q.delete('paiement');
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  async function boot() {
    populateServiceSelects();
    buildServiceChips();
    buildBookingChips();
    readHash();
    handleCheckoutReturn();
    syncFilterChips();
    // If a shared link pre-selects filters, reveal the (otherwise hidden) panel.
    if (filtersActive()) { $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true'); }
    renderLegend();
    renderContact();
    wire();
    wireCarnetSubscribe();
    renderCarnetMail();
    var cmForm = $('carnet-mail-form');
    if (cmForm) cmForm.addEventListener('submit', function (e) { e.preventDefault(); carnetMailSubscribe(); });
    var cmOff = $('carnet-mail-off');
    if (cmOff) cmOff.addEventListener('click', carnetMailUnsubscribe);

    // Restore theme preference
    var savedTheme = lsLoad('nota.theme'); if (savedTheme) setTheme(savedTheme);

    // Initialize offer form
    onOfferServiceChange();
    if (state.selectedDate) { $('o-date').value = state.selectedDate; onOfferDateChange(); }

    // Paint immediately from cache, then repaint when the month's data lands.
    renderActiveView();
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

    // First visit only: greet with the tiny onboarding guide (VIEW 1).
    maybeShowOnboarding();

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
      complete: ncCompleteAct,
      feedUrl: ncFeedUrl,
      retainedFor: ncRetainedFor,
    },
    // Unified account hub (client + notary) hooks for tests and integration.
    account: {
      role: accountRole,
      render: renderAccountMenu,
      signOut: clientSignOut,
      signIn: openClientSignIn,
    },
    // First-visit onboarding guide: open() shows VIEW 1, reset() clears the flag
    // (both the persisted and the in-session copy), seen() reports the flag.
    onboarding: {
      open: onbOpen,
      role: roleGet,
      seen: onbSeen,
      stats: onbStats,
      reset: function () {
        flagClear(LS_ONBOARDED); flagClear(LS_ONB_DISMISS); flagClear(LS_ROLE);
        try { localStorage.removeItem(LS_ONB_STATS); } catch (e) {}
      },
    },
    _internals: { applyFilters: applyFilters, acceptance: acceptance, buildCalendarLinks: buildCalendarLinks },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
