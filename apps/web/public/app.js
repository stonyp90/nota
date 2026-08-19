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
  var state = {
    anchor: firstOfMonth(todayISO()),
    monthBids: [],
    filters: { service: '', statut: '', min: null, max: null, sort: 'montant-desc' },
    selectedDate: null,
    focusDate: todayISO(),
    tab: 'carnet',
    view: 'calendrier',
    offer: { serviceId: '', dateISO: '', montant: 0, anonyme: true, pricing: {} },
  };

  // Carnet view ids (segmented switcher).
  var VIEWS = ['calendrier', 'liste'];

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
  // Mini icon buttons — the small round actions that sit on a component (an
  // offer row, a pulse row, a notary card). One primitive so every one of them
  // has the same size, hit area, tooltip and accessible name; the icon alone is
  // never the label (screen readers get the full sentence).
  // ---------------------------------------------------------------------------
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
    if (open) { renderNotifs(); renderAccountMenu(); }
  }
  // The account menu is one identity hub for BOTH roles. Priority: an active
  // notary session outranks a device-local client identity, which outranks the
  // anonymous visitor.
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
    authSetRole(role || 'client');
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
    toast('La connexion ' + provider + ' arrive bientôt — continuez avec votre courriel pour l’instant.');
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

  // "Forget me on this device": wipe the client's local identity + history. Guarded
  // by a plain confirm (no dedicated modal helper exists for this). After clearing,
  // every surface that reads the profile/offers is re-rendered.
  function clientSignOut() {
    var ok = true;
    try { ok = window.confirm('Se déconnecter effacera de cet appareil vos coordonnées, vos offres publiées, votre dossier et vos notifications. Continuer ?'); } catch (e) { ok = true; }
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
    var signinBtn = $('header-signin'); if (signinBtn) signinBtn.hidden = role !== 'anon';
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
    if (role === 'notary') {
      actions.appendChild(acctAction('dossiers', 'Mes demandes & dossiers', function () { toggleNotifPanel(false); setTab('notaires'); }));
      actions.appendChild(acctAction('signout', 'Se déconnecter', function () { ncSignOut(); renderAccountMenu(); toggleNotifPanel(false); }));
    } else if (role === 'client') {
      actions.appendChild(acctAction('profil', 'Mon profil', function () { toggleNotifPanel(false); setTab('profil'); }));
      actions.appendChild(acctAction('offers', 'Mes demandes', function () { toggleNotifPanel(false); setTab('profil'); }));
      actions.appendChild(acctAction('signout', 'Se déconnecter', clientSignOut));
    } else {
      // The identity head IS the "Se connecter / s’inscrire" trigger — don't repeat it.
      actions.appendChild(acctAction('publier', 'Publier une demande', openOfferFlow));
      actions.appendChild(acctAction('notaire', 'Espace notaire', function () { toggleNotifPanel(false); setTab('notaires'); }));
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
        var open = dayBids.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
        // Headline: the AVERAGE offer for the day (open offers when any remain,
        // otherwise what cleared) — the price a client should aim for.
        var pool = open.length ? open : dayBids;
        var avg = Math.round(pool.reduce(function (s, b) { return s + (Number(b.montant) || 0); }, 0) / pool.length);
        var avgEl = el('span', 'cal-avg' + (open.length ? '' : ' is-cleared'), D.money(avg));
        avgEl.dataset.compact = compactMoney(avg);
        cell.appendChild(avgEl);
        // Chance to obtain a notary on this date (lead-time based), shown as a %.
        var chance = D.obtainChance(iso, today);
        var chanceEl = el('span', 'cal-chance', chance + ' %');
        chanceEl.dataset.level = chance >= 80 ? 'high' : chance >= 55 ? 'mid' : 'low';
        chanceEl.title = chance + ' % de chances d’obtenir un notaire à cette date';
        if (open.length) { cell.classList.add('is-avail'); } else { cell.classList.add('is-taken'); }
        cell.appendChild(chanceEl);
        cell.setAttribute('aria-label', dayTitle(iso) + ' — prix moyen ' + D.money(avg) + ', ' + chance + ' % de chances d’obtenir un notaire');
      }

      // The client's own offer status on this day (approved / pending / expired).
      var mineSt = myOfferStatus(iso);
      if (mineSt) {
        cell.classList.add('has-mine');
        var badge = el('span', 'cal-mine', OFFER_STATUS_LABEL[mineSt]);
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

  // Compact a bid count so the badge pill never widens: 2000 -> "2k", 1250 -> "1.2k".
  // The aria-label always uses the real integer, so screen readers hear the exact count.
  function compactCount(n) {
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n);
  }
  // Compact a dollar amount for the tightest calendar cells (phones): 3285 -> "3,3k",
  // 715 -> "715". Swapped in only by the narrow container query; the full amount and
  // the day dialog keep the exact "1 320 $".
  function compactMoney(n) {
    n = Math.round(Number(n) || 0);
    if (n < 1000) return String(n);
    var k = n / 1000;
    return (k >= 10 ? String(Math.round(k)) : (Math.round(k * 10) / 10 + '').replace('.', ',')) + 'k';
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
    // Service key — decodes the per-service mix bar in each calendar cell.
    lg.appendChild(el('span', 'legend-label legend-label--sep', 'Service'));
    D.SERVICES.forEach(function (s) {
      var item = el('span', 'legend-status-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--svc-' + s.id + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(s.nom.split(' ')[0]));
      lg.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Hero pulse — the live market beside the hero copy
  // ---------------------------------------------------------------------------
  // The client's first question is "combien j'offre ?". Answer it with the
  // month's own numbers: the median amount proposed per act, its volume, and
  // how much of the carnet a notary has already taken. Aggregation is the
  // domain's (D.carnetPulse); this only formats and wires each row to the
  // service filter of the carnet below.
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function pulseRow(s, active, busiest) {
    var short = s.nom.split(' ')[0];
    var priced = s.median == null ? s.prixDepart : s.median;
    var row = el('button', 'pulse-row' + (active ? ' is-on' : ''));
    row.type = 'button';
    row.dataset.svc = s.id;
    row.setAttribute('aria-pressed', active ? 'true' : 'false');
    // The row's text is four fragments; name the WHOLE control once so a screen
    // reader announces the figure and what clicking it does, not "788 $ 10 offres".
    row.setAttribute('aria-label',
      short + ' — ' + (s.median == null ? 'à partir de ' : 'médiane ') + D.money(priced) + ', '
      + (s.total === 0 ? 'aucune offre ce mois' : plural(s.total, 'offre') + ' dont ' + plural(s.retenues, 'retenue')) + '. '
      + (active ? 'Retirer ce filtre.' : 'Filtrer le carnet sur ce service.'));

    var name = el('span', 'pulse-svc');
    var dot = el('span', 'pulse-dot');
    dot.style.background = 'var(--svc-' + s.id + ')';
    name.appendChild(dot);
    name.appendChild(document.createTextNode(short));
    row.appendChild(name);

    // Median when the month has offers, the service floor when it has none —
    // never an empty cell, and never a mean (one 9 000 $ urgence must not
    // masquerade as the going rate).
    var amount = el('span', 'pulse-amount', D.money(priced));
    if (s.median == null) amount.classList.add('is-floor');
    row.appendChild(amount);

    row.appendChild(el('span', 'pulse-meta',
      s.total === 0 ? 'aucune offre ce mois' : plural(s.total, 'offre') + ' · ' + s.retenues + ' retenue' + (s.retenues === 1 ? '' : 's')));
    row.appendChild(el('span', 'pulse-sub', s.median == null ? 'prix de départ' : 'médiane'));

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
    if (m) m.textContent = monthTitle(state.anchor);

    clear(rows);
    var busiest = p.services.reduce(function (m, s) { return Math.max(m, s.total); }, 0);
    p.services.forEach(function (s) {
      rows.appendChild(pulseRow(s, state.filters.service === s.id, busiest));
    });

    // Proof the marketplace clears — the one number the calendar itself cannot
    // show at a glance.
    var foot = $('pulse-foot');
    if (foot) {
      if (p.total === 0) {
        foot.textContent = 'Aucune demande ce mois-ci — proposez la vôtre : les notaires de Québec la verront.';
      } else if (p.retenues === 0) {
        foot.textContent = 'Aucune demande encore retenue ce mois — le carnet est grand ouvert.';
      } else {
        foot.textContent = p.retenues + ' des ' + plural(p.total, 'demande') + ' de ce mois '
          + (p.retenues === 1 ? 'a' : 'ont') + ' déjà été retenue' + (p.retenues === 1 ? '' : 's')
          + ' par un notaire (' + p.tauxRetenue + ' %).';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Agenda rendering
  // ---------------------------------------------------------------------------
  function renderAgenda() {
    var ag = $('agenda'); clear(ag);
    var visible = applyFilters(state.monthBids);

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

    // Row actions: keep this date, or pass it on. Both work on ANY offer (they
    // only use public data), so they are shown on open and retained rows alike.
    var acts = el('div', 'row-actions');
    var svcNom = D.serviceById(b.serviceId) ? D.serviceById(b.serviceId).nom : b.serviceId;
    var ics = miniBtn('agenda', 'Ajouter au calendrier : ' + svcNom + ', ' + dayTitle(b.dateISO));
    ics.href = calendarLinks(b).ics;
    ics.setAttribute('download', 'nota-' + b.dateISO + '.ics');
    acts.appendChild(ics);
    acts.appendChild(miniBtn('partager', 'Partager cette offre', function (e) { e.stopPropagation(); shareBid(b); }));
    row.appendChild(acts);
    return row;
  }

  // One dispatch for the three carnet views: keep the shared toolbar summary
  // correct in EVERY view, then paint ONLY the active region.
  function renderActiveView() {
    var visible = applyFilters(state.monthBids);
    updateFilterSummary(visible.length, visible);
    // The pulse reads the WHOLE month (not `visible`): it is the market
    // reference the filters are applied against, so filtering must not
    // rewrite it — only highlight the row that is active.
    renderPulse();
    if (state.view === 'liste') renderAgenda();
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
    var f = state.filters;
    var shown = all.filter(function (b) {
      if (f.service && b.serviceId !== f.service) return false;
      if (f.statut && b.status !== f.statut) return false;
      if (f.min != null && b.montant < f.min) return false;
      if (f.max != null && b.montant > f.max) return false;
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
    var INITIAL = 3;   // keep the modal compact: only the top 3, rest behind "voir plus"
    var DAY_CAP = 40;  // hard bound so a day with hundreds never floods the DOM
    var capped = shown.slice(0, DAY_CAP);
    capped.slice(0, INITIAL).forEach(function (b) { list.appendChild(bidRow(b)); });
    if (capped.length > INITIAL) {
      var rest = el('div', 'day-bids-rest'); rest.hidden = true;
      capped.slice(INITIAL).forEach(function (b) { rest.appendChild(bidRow(b)); });
      list.appendChild(rest);
      var n = capped.length - INITIAL;
      var toggle = el('button', 'btn btn-sm day-bids-toggle', 'Voir les ' + n + ' autres offres'); toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        var opening = rest.hidden;
        rest.hidden = !opening;
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
        toggle.textContent = opening ? 'Voir moins' : 'Voir les ' + n + ' autres offres';
      });
      list.appendChild(toggle);
      if (shown.length > DAY_CAP) {
        list.appendChild(el('div', 'day-bids-more', '+ ' + (shown.length - DAY_CAP) + ' autres — les ' + DAY_CAP + ' meilleures sont affichées'));
      }
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
  }
  function resetFilters() {
    state.filters = { service: '', statut: '', min: null, max: null, sort: 'montant-desc' };
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
  function bidShareUrl(b) {
    return location.origin + location.pathname + '#svc=' + encodeURIComponent(b.serviceId) + '&jour=' + b.dateISO;
  }

  // Share sheet where the platform has one, clipboard everywhere else. Both
  // paths end in visible feedback — a share that silently does nothing reads
  // as a broken button.
  function shareBid(b) {
    var svc = D.serviceById(b.serviceId);
    var url = bidShareUrl(b);
    var text = (svc ? svc.nom : b.serviceId) + ' · ' + dayTitle(b.dateISO) + ' · ' + D.money(b.montant);
    if (navigator.share) {
      navigator.share({ title: 'Nota — ' + text, text: text, url: url }).catch(function () { /* dismissed */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast('Lien copié'); },
        function () { toast('Copie impossible — ' + url); }
      );
      return;
    }
    toast(url);
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
    card.appendChild(el('p', 'help', 'L’historique de vos demandes publiées et leur statut — Approuvé, En attente ou Expiré.'));
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
      m.textContent = '✓ Prêt à être retenu par un notaire — votre identité sera vérifiée à la signature.';
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
    } catch (err) { onError && onError('Hors ligne — réessayez une fois en ligne.'); }
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
    var labels = { simple: 'Cas simple', standard: 'Standard', complexe: 'Cas complexe' };
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
    if (tab === 'notaires') renderNotaryOpportunity();
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
      state.monthBids = await store.listMonth(monthKey(state.anchor));
    } finally {
      if (panel) panel.classList.remove('is-loading');
    }
    renderNotaryOpportunity(); // keep the gate's live "money on the table" fresh
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
    var headerSignin = $('header-signin'); if (headerSignin) headerSignin.addEventListener('click', function () { openAuthModal('client'); });
    renderAccountMenu(); // set the initial header sign-in / avatar state on load
    // Click the backdrop (outside the body) to dismiss.
    var authDlg = $('auth-dialog');
    if (authDlg) authDlg.addEventListener('click', function (e) { if (e.target === authDlg) { try { authDlg.close(); } catch (er) {} } });

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
    if (p === 'ok') toast('Paiement autorisé — votre offre est en cours de publication.');
    else if (p === 'annule') toast('Paiement annulé — votre offre n’a pas été publiée.');
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
    // Unified account hub (client + notary) hooks for tests and integration.
    account: {
      role: accountRole,
      render: renderAccountMenu,
      signOut: clientSignOut,
      signIn: openClientSignIn,
    },
    _internals: { applyFilters: applyFilters, acceptance: acceptance, buildCalendarLinks: buildCalendarLinks },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
