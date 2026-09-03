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
    // How many listMonth calls have fallen back to the fixtures. refreshMonthData
    // loads several months CONCURRENTLY (the rolling window crosses seams), and
    // `online` is last-writer-wins: if month A succeeds and month B falls back,
    // the flag ends up reflecting whichever settled last. A monotonic counter is
    // order-independent — any fallback in a batch marks the whole screen.
    demoLoads: 0,
    // Le tarif de Nota, tel que le carnet l'annonce (ADR 0031). Il reste NUL
    // tant qu'aucune réponse réelle ne l'a porté : hors ligne, le devis dit
    // qu'un prix s'ajoute sans jamais en inventer le montant. Un chiffre faux
    // serait pire que pas de chiffre — c'est exactement ce que l'art. 68 du
    // Code de déontologie nomme « trompeur ».
    tarif: null,
    async listMonth(month) {
      try {
        var r = await fetch(API_BASE + '/bids?month=' + encodeURIComponent(month), {
          headers: { accept: 'application/json' },
        });
        if (r.ok) {
          this.online = true;
          var j = await r.json();
          if (j.tarif && typeof j.tarif.prixNotaCents === 'number') this.tarif = j.tarif;
          return j.bids || [];
        }
      } catch (e) { /* offline */ }
      this.online = false;
      this.demoLoads++;
      return ensureSeed().filter(function (b) { return b.dateISO.slice(0, 7) === month; });
    },
    async createBid(payload) {
      var v = D.validateOffer({
        serviceId: payload.serviceId, dateISO: payload.dateISO,
        montant: payload.montant, pricing: payload.pricing, prefixe: payload.prefixe, todayISO: todayISO(),
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
          if (r.status === 201) return { ok: true, bid: j.bid, clientToken: j.clientToken || null, checkoutUrl: j.checkoutUrl || null, paymentStatus: j.paymentStatus || null };
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

  // The app's panes, in nav order. Shared by setTab (show/hide) and the URL
  // hash (`t` param) so every pane is deep-linkable and Back walks panes.
  // Only carnet / notaires / partenaires are header doors (ADR 0010 §2); the
  // rest are inner destinations reached from inside the panes.
  var PANES = ['carnet', 'dossier', 'notaires', 'partenaires', 'profil', 'confidentialite', 'conditions', 'charte'];

  var state = {
    anchor: firstOfMonth(todayISO()),
    // True when the month on screen came from the fixtures, not from the API.
    // Everything derived from monthBids is then invented and must say so.
    demo: false,
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
  var fmtWeekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
  function monthTitle(anchor) { return fmtMonth.format(new Date(anchor + 'T00:00:00Z')); }
  function dayTitle(iso) { return fmtDayLong.format(new Date(iso + 'T00:00:00Z')); }
  function dayShort(iso) { return fmtDayShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, ''); }
  function weekdayShort(iso) { return fmtWeekdayShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, ''); }
  function monthShort(iso) { return fmtMonthShort.format(new Date(iso + 'T00:00:00Z')).replace(/\.$/, ''); }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  // Display-only name of a tier: the domain's "Extrême" reads as a threat; on
  // screen it is simply the same-day notice. Pure mapping — the domain and its
  // ids are untouched.
  var TIER_DISPLAY = { extreme: 'Même jour' };
  function tierName(t) { return (t && TIER_DISPLAY[t.id]) || (t ? t.nom : ''); }
  // The act the carnet is currently about: the active service filter, else the
  // domain's default. It is what every indicative price on the grid is for.
  function carnetService() { return D.serviceById(state.filters.service) || D.serviceById(D.DEFAULT_SERVICE_ID) || D.SERVICES[0]; }
  // What an offer at this notice actually costs, in dollars: the tier's (tuned)
  // multiple applied to the act's starting price. Clients think in dollars,
  // not in multiples.
  function tierAmount(tierId, svc) {
    svc = svc || carnetService();
    var m = D.tierMultiplier(tierId, state.monthBids);
    return Math.round((svc && svc.prixDepart || 0) * (m || 1));
  }
  function tierFromLabel(tierId, svc) { return 'dès ' + D.money(tierAmount(tierId, svc)); }
  // ---------------------------------------------------------------------------
  // Demonstration data — declared, never disguised
  // ---------------------------------------------------------------------------
  // store.listMonth falls back to D.makeFixtures whenever the API is
  // unreachable or answers anything but 200. That capability is legitimate
  // (marketing, the intro film, offline development); presenting an invented
  // carnet EXACTLY like the real one is not — an outage would silently turn
  // the site into a fictional marketplace, medians and all.
  //
  // So: a persistent banner, plus a visible mark on every region that shows an
  // aggregate. Regions carry data-demo="true" so a figure added later inside
  // one is covered without anybody remembering to mark it. We declare, we do
  // not hide: nothing is blanked, nothing is blocked.
  var DEMO_REGIONS = [
    { region: 'carnet-pulse', slot: '.pulse-head' },   // médianes, volumes, retenues
    { region: 'carnet-panel', slot: '.cal-toolbar' },  // le compteur du carnet, et les prix par jour
    // The booking dialog. The worst of the lot: besides the figures it SHOWS
    // (offre à battre, aperçu du palier), D.recommendedAmount pre-fills the
    // amount from state.monthBids — a fictional calibration for a real
    // publication. Marked at the head, above every step of the form.
    { region: 'day-dialog', slot: '.day-head' },
    { region: 'onboarding-dialog', slot: '.onb-live-host' }, // « N demandes publiées ce mois-ci · N retenues »
    { region: 'notary-live', slot: '.nc-live-head' },        // le fil du notaire
  ];
  function demoMark() {
    var sp = el('span', 'demo-mark', 'démonstration');
    sp.setAttribute('title', 'Chiffres de démonstration : le carnet réel n’a pas pu être chargé.');
    return sp;
  }
  function renderDemoState() {
    var on = !!state.demo;
    var banner = $('demo-banner');
    if (banner) banner.hidden = !on;
    DEMO_REGIONS.forEach(function (d) {
      var region = $(d.region); if (!region) return;
      if (on) region.dataset.demo = 'true'; else delete region.dataset.demo;
      var slot = region.querySelector(d.slot) || region;
      var mark = slot.querySelector('.demo-mark');
      if (on && !mark) slot.appendChild(demoMark());
      else if (!on && mark) mark.parentNode.removeChild(mark);
    });
  }

  // The « Offre publiée » screen after an OFFLINE publish. createBid kept the
  // offer in localStorage only: nothing reached the carnet and no notary will
  // ever see it. The toast already whispers « (démo locale) »; the screen that
  // follows must say it outright rather than congratulate the client.
  function renderOfferSuccessOrigin() {
    var box = $('offer-success'); if (!box) return;
    var old = $('offer-success-demo');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var lead = $('offer-success-lead');
    var next = $('offer-success-next');
    if (store.online) {
      if (lead) {
        clear(lead);
        var okStrong = el('strong', null, 'Offre publiée.');
        lead.appendChild(okStrong);
        lead.appendChild(document.createTextNode(' Pendant l’attente, préparez vos documents.'));
      }
      if (next) { renderSentences(next, expectationLines(offerCourriel(), true)); next.hidden = false; }
      return;
    }
    // Nothing reached the carnet: no notary will see it, so nothing to expect.
    if (next) { clear(next); next.hidden = true; }
    if (lead) {
      clear(lead);
      lead.appendChild(el('strong', null, 'Enregistrée sur cet appareil seulement.'));
      lead.appendChild(document.createTextNode(' Pendant l’attente, préparez vos documents.'));
    }
    var note = el('p', 'demo-note', 'Rien n’a été publié. Le carnet réel est injoignable : cette offre n’existe que sur cet appareil, et aucun notaire ne la verra.');
    note.id = 'offer-success-demo';
    (box.querySelector('.offer-success-head') || box).appendChild(note);
  }
  function showOfferSuccess() {
    renderOfferSuccessOrigin();
    var box = $('offer-success'); if (box) box.hidden = false;
  }

  // What happens after a real publication, said honestly and without a delay
  // promise: who can see the demand, the one channel Nota will use, and that
  // withdrawing costs nothing until a notary retains it. Each sentence is its
  // own node so the i18n layer can match it (the courriel rides a rule).
  function expectationLines(courriel, visibleNow) {
    var out = [];
    if (visibleNow) out.push('Votre demande est maintenant visible des notaires inscrits.');
    out.push(courriel
      ? 'Nous vous écrivons à ' + courriel + ' dès qu’un notaire la retient.'
      : 'Nous vous écrivons dès qu’un notaire la retient.');
    out.push('Vous pouvez la retirer sans frais jusque-là.');
    return out;
  }
  function renderSentences(host, lines) {
    clear(host);
    lines.forEach(function (s, i) {
      if (i) host.appendChild(document.createTextNode(' '));
      host.appendChild(el('span', '', s));
    });
  }
  // The courriel the client entered on the form (their field), else the one
  // saved on this device — never a field of our own.
  function offerCourriel() {
    var f = $('o-courriel');
    var v = f && f.value ? String(f.value).trim() : '';
    if (D.isEmail(v)) return v;
    var p = profileGet();
    return D.isEmail(p.courriel || '') ? p.courriel : '';
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
    // A house with a key line: refinancing is a mortgage on a home. The
    // catalogue is the financing family (ADR 0010 §1) — a new sibling act
    // gets its glyph here, or falls back to the colour dot below.
    refinancement: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    // The sibling act (ADR 0010 §1 amended): a NEW loan on a home — the same
    // house silhouette, carrying a dollar mark instead of the door, so the
    // two acts read as family at a glance yet never as the same thing.
    financement: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10v10h14V10"/><path d="M14 12.5h-2.8a1.2 1.2 0 0 0 0 2.4h1.6a1.2 1.2 0 0 1 0 2.4H10M12 11.3v1.2M12 17.3v1.2"/>',
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
    joindre: '<path d="M4 4h16v12H7l-3 3z"/><path d="M8 9h8M8 12h5"/>',
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
  // `clientToken` is the bearer the API hands back on publish: it is what lets
  // THIS browser read the private side of its own offer (propositions,
  // document requests) and answer them. Never shown, never sent elsewhere.
  function addMyOffer(bid, clientToken) {
    var a = myOffers().filter(function (o) { return o.id !== bid.id; });
    var entry = { id: bid.id, dateISO: bid.dateISO, serviceId: bid.serviceId, montant: bid.montant };
    if (clientToken) entry.clientToken = clientToken;
    a.push(entry);
    lsSave(LS_MYOFFERS, a.slice(-50));
  }
  // Once we ever observe an offer retained, persist it on the myOffers entry so the
  // "Approuvé" status survives navigating away from that offer's month. `patch`
  // carries what the retention changed (the étude, a renegotiated amount).
  function markMyOfferRetained(id, patch) {
    var a = myOffers(); var changed = false;
    a.forEach(function (o) {
      if (o.id !== id) return;
      if (!o.retained) { o.retained = true; changed = true; }
      if (patch && patch.etude && o.etude !== patch.etude) { o.etude = patch.etude; changed = true; }
      if (patch && patch.montant && o.montant !== patch.montant) { o.montant = patch.montant; changed = true; }
    });
    if (changed) lsSave(LS_MYOFFERS, a);
  }
  // Once cancelled (here or observed from the API), the entry keeps saying so —
  // a withdrawn offer must never flip back to « ouverte » on this device.
  function markMyOfferCancelled(id) {
    var a = myOffers(); var changed = false;
    a.forEach(function (o) {
      if (o.id !== id || o.cancelled) return;
      o.cancelled = true; o.retained = false; changed = true;
    });
    if (changed) lsSave(LS_MYOFFERS, a);
  }
  // A notary released the act: the offer is back on the carnet, exactly as
  // posted. Undo what markMyOfferRetained persisted (never on a cancelled
  // offer — a withdrawn offer stays withdrawn on this device).
  function markMyOfferReleased(id) {
    var a = myOffers(); var changed = false;
    a.forEach(function (o) {
      if (o.id !== id || o.cancelled) return;
      if (o.retained) { o.retained = false; changed = true; }
      if (o.etude) { delete o.etude; changed = true; }
    });
    if (changed) lsSave(LS_MYOFFERS, a);
  }
  // The live offer (date not passed) this browser holds for an act, with the
  // token that lets it talk to the API about it — or null.
  function myLiveOfferFor(serviceId) {
    var today = todayISO();
    return myOffers().filter(function (o) {
      return o.serviceId === serviceId && o.clientToken && D.daysBetween(today, o.dateISO) >= 0;
    }).sort(function (a, b) { return String(a.dateISO).localeCompare(String(b.dateISO)); })[0] || null;
  }

  // --- What notaries sent back on an offer -----------------------------------
  // The last status fetched per offer (propositions, document requests,
  // readiness), cached so the bell can ring on what is NEW, and so "Mes offres"
  // paints instantly before the network answers.
  var LS_OFFERSTATUS = 'nota.offerstatus.v1';
  function offerStatusCache() { return lsLoad(LS_OFFERSTATUS) || {}; }
  function offerStatusGet(id) { return offerStatusCache()[id] || null; }
  function offerStatusSet(id, status) {
    var c = offerStatusCache();
    // `notaire` is the client's half of the mise en relation (ADR 0010 §4):
    // the retaining notary's étude + courriel, served by GET /client/bid once
    // the offer is retained. Cached so "Mes offres" shows whom to contact.
    // `annulation` is the ADR 0023 prevision: what cancelling TODAY would
    // keep from the deposit (taux, frais, joursAvant) — null when free.
    c[id] = { bid: status.bid || null, notaire: status.notaire || null, propositions: status.propositions || [], demandes: status.demandes || [], readiness: status.readiness || null, messages: status.messages || [], documents: status.documents || [], acte: status.acte || null, evaluation: status.evaluation || null, annulation: status.annulation || null, fetchedAt: Date.now() };
    lsSave(LS_OFFERSTATUS, c);
    return c[id];
  }
  // A deep link (ADR 0033 §2.7) can create a myOffers entry that knows only
  // {id, dateISO, clientToken}: the first GET /client/bid fills the rest.
  function patchMyOffer(id, patch) {
    var a = myOffers(); var changed = false;
    a.forEach(function (o) {
      if (o.id !== id) return;
      Object.keys(patch || {}).forEach(function (k) {
        if (patch[k] != null && o[k] !== patch[k]) { o[k] = patch[k]; changed = true; }
      });
    });
    if (changed) lsSave(LS_MYOFFERS, a);
  }

  // --- Unread on the client side (ADR 0033) ----------------------------------
  // `nota.seen.v1` = { [offerId]: createdAt of the newest notary message the
  // client has SEEN }. Unread = notary messages newer than that. Seen is set
  // when the thread scrolls into view, when the composer takes focus, when a
  // message is sent, and when the bell entry is followed to the band.
  var LS_SEEN = 'nota.seen.v1';
  function seenGet(id) { var s = lsLoad(LS_SEEN) || {}; return s[id] || ''; }
  function seenSet(id, iso) {
    if (!id || !iso) return;
    var s = lsLoad(LS_SEEN) || {};
    if (s[id] && String(s[id]) >= String(iso)) return;
    s[id] = iso;
    lsSave(LS_SEEN, s);
  }
  function unreadMessages(id, status) {
    var st = status || offerStatusGet(id);
    var seen = seenGet(id);
    return ((st && st.messages) || []).filter(function (m) {
      return m.de === 'notaire' && String(m.createdAt || '') > seen;
    });
  }
  function unreadCount(id, status) { return unreadMessages(id, status).length; }
  function unreadTotal() {
    return myOffers().reduce(function (n, o) { return n + unreadCount(o.id); }, 0);
  }
  // Mark every notary message of this offer seen, then repaint the badges
  // (the row's and the account door's) — never the whole pane.
  function markOfferSeen(id, status) {
    var st = status || offerStatusGet(id);
    var newest = '';
    ((st && st.messages) || []).forEach(function (m) {
      if (m.de === 'notaire' && String(m.createdAt || '') > newest) newest = String(m.createdAt);
    });
    if (newest) seenSet(id, newest);
    paintUnreadBadges();
  }
  function unreadLabel(n) { return n === 1 ? '1 nouveau message' : n + ' nouveaux messages'; }
  function paintUnreadBadges() {
    Array.prototype.forEach.call(document.querySelectorAll('.my-offer-unread[data-for]'), function (b) {
      var n = unreadCount(b.dataset.for);
      b.hidden = n === 0;
      b.textContent = n ? unreadLabel(n) : '';
    });
    var door = document.querySelector('#acct-actions .acct-badge');
    var total = unreadTotal();
    if (door) {
      if (total) door.textContent = total > 9 ? '9+' : String(total);
      else door.parentNode.removeChild(door);
    }
  }
  function clientHeaders(o, json) {
    var h = { accept: 'application/json', Authorization: 'Bearer ' + o.clientToken };
    if (json) h['content-type'] = 'application/json';
    return h;
  }
  // GET /client/bid for one tokened offer. Failures are silent (offline, token
  // gone): the cached status, if any, stays. Rings the bell once per new
  // proposition / document request id — addNotif dedupes by key.
  async function fetchOfferStatus(o) {
    if (!o || !o.clientToken) return null;
    try {
      var r = await fetch(API_BASE + '/client/bid?id=' + encodeURIComponent(o.id) + '&dateISO=' + encodeURIComponent(o.dateISO), { headers: clientHeaders(o) });
      if (!r.ok) return null;
      var j = await r.json();
      // The PREVIOUS snapshot, before this poll overwrites it: comparing the
      // two is how a notary's release is detected (retained → open again).
      var prev = offerStatusGet(o.id);
      var st = offerStatusSet(o.id, j || {});
      // An entry born from a deep link learns its act and amount here.
      if (st.bid && (!o.serviceId || o.montant == null)) {
        patchMyOffer(o.id, { serviceId: st.bid.serviceId, montant: st.bid.montant });
        if (!o.serviceId) o.serviceId = st.bid.serviceId;
        if (o.montant == null) o.montant = st.bid.montant;
      }
      if (st.bid && st.bid.status === D.STATUS.RETENUE) markMyOfferRetained(o.id, { etude: st.bid.etude, montant: st.bid.montant });
      if (st.bid && st.bid.status === D.STATUS.ANNULEE) markMyOfferCancelled(o.id);
      // Release (ADR 0012): the last snapshot showed the offer retained and it
      // is now OPEN again (a cancellation is not a release). Announce it, undo
      // the device's retained state, and retire the stale « retenu » entry so
      // the bell stops contradicting the carnet. The previous snapshot's
      // timestamp keys the event: one entry per release, never re-rung by the
      // next poll, yet a later release rings anew.
      if (prev && prev.bid && prev.bid.status === D.STATUS.RETENUE && st.bid && st.bid.status === D.STATUS.OUVERTE) {
        markMyOfferReleased(o.id);
        markNotifRead('retained:' + o.id);
        addNotif({
          key: 'released:' + o.id + ':' + (prev.fetchedAt || o.id), kind: 'released',
          title: 'Le notaire s’est désisté — votre demande est de retour au carnet',
          body: dayTitle(o.dateISO) + ' · ' + T(svcName(o.serviceId)), dateISO: o.dateISO,
        });
      }
      // Acte signé (ADR 0015): once the ledger settles the signing, invite the
      // client to evaluate — until the evaluation exists, then retire the invite.
      if (st.acte && st.acte.complete && !st.evaluation) {
        addNotif({
          key: 'acte:' + o.id, kind: 'acte',
          title: 'Acte signé — évaluez votre notaire',
          body: dayTitle(o.dateISO) + ' · ' + T(svcName(o.serviceId)), dateISO: null,
        });
      }
      if (st.evaluation) markNotifRead('acte:' + o.id);
      st.propositions.forEach(function (p) {
        if (p.status !== 'en_attente') return;
        addNotif({
          key: 'proposition:' + p.id, kind: 'proposition',
          title: 'Un notaire vous propose ' + D.money(p.montant) + ' pour votre ' + T(svcName(o.serviceId)).toLowerCase() + ' du ' + dayTitle(o.dateISO),
          body: 'Acceptez ou refusez dans Mes offres.', dateISO: null,
        });
      });
      st.demandes.forEach(function (d) {
        if (d.fournie) return;
        addNotif({
          key: 'documents:' + d.id, kind: 'documents',
          title: 'Le notaire demande des documents pour votre ' + T(svcName(o.serviceId)).toLowerCase() + ' du ' + dayTitle(o.dateISO),
          body: (d.documents || []).map(function (x) { return T(x.nom); }).join(', '), dateISO: null,
        });
      });
      // The retained-act conversation: ring once per notary message (addNotif
      // dedupes by key), pointing at Mes offres where the thread lives.
      (st.messages || []).forEach(function (m) {
        if (m.de !== 'notaire') return;
        // `offerId` makes the entry a door: it opens Mes offres on this band.
        addNotif({
          key: 'message:' + m.id, kind: 'message',
          title: 'Votre notaire vous a écrit',
          body: m.texte, dateISO: null, offerId: o.id,
        });
      });
      paintUnreadBadges();
      return st;
    } catch (e) { return null; }
  }
  // Send one client message into the retained-act thread. Returns
  // { ok, message } for the composer (which owns the busy state and the
  // inline error); on success the cache grows by the appended message, the
  // band repaints, and the thread is pulled fresh (the notary may have
  // written meanwhile).
  async function clientChatSend(o, texte) {
    texte = String(texte || '').trim();
    if (!texte) return { ok: false, message: 'Écrivez un message.' };
    var r;
    try {
      r = await fetch(API_BASE + '/client/bid/message', {
        method: 'POST', headers: clientHeaders(o, true),
        body: JSON.stringify({ id: o.id, dateISO: o.dateISO, texte: texte }),
      });
    } catch (e) { return { ok: false, message: 'Message impossible (hors ligne).' }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j.message) {
      return { ok: false, message: (j.errors && j.errors[0] && j.errors[0].message) || 'Message impossible.' };
    }
    var st = offerStatusGet(o.id) || {};
    offerStatusSet(o.id, Object.assign({}, st, { messages: (st.messages || []).concat([j.message]) }));
    // Writing back means the client has read what came before.
    markOfferSeen(o.id);
    repaintOfferBand(o, { focusComposer: true });
    fetchOfferStatus(o).then(function (fresh) { if (fresh) repaintOfferBand(o, { ifChanged: true }); });
    return { ok: true };
  }

  // --- The client thread: polling, repainting, the deep link --------------------
  // Repaint ONE offer's band from the cache (never the whole pane): the table
  // row stays, the composer's draft is carried over, and — when asked — only
  // a changed thread/status triggers the rebuild.
  var bandSignatures = {};
  function bandSignature(st) {
    if (!st) return '';
    var msgs = st.messages || [];
    var last = msgs[msgs.length - 1];
    return [st.bid && st.bid.status, msgs.length, last && last.id, (st.documents || []).length,
      (st.propositions || []).length, (st.demandes || []).length, st.acte && st.acte.complete, !!st.evaluation].join('|');
  }
  function repaintOfferBand(o, opts) {
    opts = opts || {};
    if (state.tab !== 'profil') return false;
    var fresh = myOffers().filter(function (x) { return x.id === o.id; })[0] || o;
    var st = offerStatusGet(o.id);
    var sig = bandSignature(st);
    if (opts.ifChanged && bandSignatures[o.id] === sig) return false;
    bandSignatures[o.id] = sig;
    var s = clientOfferStatus(fresh);
    var row = document.querySelector('#my-offers-live tr.my-offer[data-id="' + o.id + '"], #my-offers-past tr.my-offer[data-id="' + o.id + '"]');
    if (row) {
      row.dataset.status = s;
      var pill = row.querySelector('.my-offer-status');
      if (pill) { pill.textContent = offerStatusLabel(fresh, s); pill.dataset.status = s; }
      var m = row.querySelector('.c-montant'); if (m && fresh.montant != null) m.textContent = D.money(fresh.montant);
      var acte = row.querySelector('.c-acte'); if (acte && fresh.serviceId) acte.textContent = svcName(fresh.serviceId);
    }
    var cell = document.querySelector('.my-offer-detail[data-for="' + o.id + '"] .my-offer-detail-cell');
    if (!cell) return false;
    var oldInput = cell.querySelector('.chat-input');
    var draft = oldInput ? oldInput.value : '';
    var hadFocus = oldInput && document.activeElement === oldInput;
    fillMyOfferDetail(cell, fresh, s, st);
    var input = cell.querySelector('.chat-input');
    if (input && draft) { input.value = draft; input.dispatchEvent(new Event('input', { bubbles: true })); }
    if (input && (hadFocus || opts.focusComposer)) { try { input.focus({ preventScroll: true }); } catch (e) {} }
    paintUnreadBadges();
    return true;
  }

  // While Mes offres is on screen, the thread refreshes itself — every
  // CLIENT_POLL_MS (window.__NOTA_CLIENT_POLL_MS__ overrides, for tests).
  // The timer only EXISTS while the profil tab is shown in a visible, active
  // window (setTab, focus/blur and visibilitychange keep it in sync — a
  // background window polls nothing, and the `focus` handler above already
  // refreshes everything the moment the client comes back); a tick is
  // skipped while a field has focus, because a repaint under a typing hand
  // is how drafts get eaten.
  var CLIENT_POLL_MS = Number(window.__NOTA_CLIENT_POLL_MS__) > 0 ? Number(window.__NOTA_CLIENT_POLL_MS__) : 15000;
  var clientPollTimer = null;
  var clientPollBusy = false;
  function fieldHasFocus() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function clientPollWanted() {
    if (state.tab !== 'profil' || document.hidden) return false;
    return typeof document.hasFocus !== 'function' || document.hasFocus();
  }
  function clientPollTick() {
    if (!clientPollWanted() || fieldHasFocus() || clientPollBusy) return;
    var offers = myOffers().filter(offerNeedsStatusPoll);
    if (!offers.length) return;
    clientPollBusy = true;
    Promise.all(offers.map(function (o) {
      return fetchOfferStatus(o).then(function (st) { if (st) repaintOfferBand(o, { ifChanged: true }); });
    })).then(function () { clientPollBusy = false; }, function () { clientPollBusy = false; });
  }
  function clientPollStart() {
    if (clientPollTimer) return;
    clientPollTimer = setInterval(clientPollTick, CLIENT_POLL_MS);
  }
  function clientPollStop() {
    if (clientPollTimer) { clearInterval(clientPollTimer); clientPollTimer = null; }
  }
  function clientPollSync() { if (clientPollWanted()) clientPollStart(); else clientPollStop(); }
  window.addEventListener('focus', clientPollSync);
  window.addEventListener('blur', clientPollSync);
  document.addEventListener('visibilitychange', function () {
    clientPollSync();
    if (clientPollWanted()) clientPollTick();
  });

  // Bring one offer's band into view on Mes offres, flash it, and count its
  // messages as seen — the landing of the bell entry and of the deep link.
  function openOfferBand(id) {
    toggleNotifPanel(false);
    if (state.tab !== 'profil') setTab('profil', { focus: false });
    var band = document.querySelector('.my-offer-detail[data-for="' + id + '"]');
    if (!band) return false;
    if (band.scrollIntoView) { try { band.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    band.classList.remove('is-flash');
    void band.offsetWidth;
    band.classList.add('is-flash');
    setTimeout(function () { band.classList.remove('is-flash'); }, 2400);
    markOfferSeen(id);
    return true;
  }

  // The device-independent deep link (ADR 0033 §2.7): the email says
  // « Écrivez-lui dans votre espace Nota » and links
  // #offre=<id>&d=<dateISO>&cle=<token>. On this device — any device — the
  // entry is stored with its token, the pane opens on that band, the API
  // fills what the link did not carry (act, amount), and the token leaves the
  // URL before it can be shared or replayed from history.
  function consumeOfferLinkHash() {
    var params;
    try { params = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); } catch (e) { return false; }
    var id = params.get('offre'), d = params.get('d'), cle = params.get('cle');
    if (!id || !cle || !D.isISODate(d || '')) return false;
    params.delete('offre'); params.delete('d'); params.delete('cle');
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    var a = myOffers();
    var entry = a.filter(function (o) { return o.id === id; })[0];
    if (entry) { entry.dateISO = d; entry.clientToken = cle; }
    else { entry = { id: id, dateISO: d, clientToken: cle }; a.push(entry); }
    lsSave(LS_MYOFFERS, a.slice(-50));
    // setTab writes #t=profil — which is also what keeps the intro film and
    // the onboarding guide away from a destination link.
    setTab('profil', { focus: false });
    openOfferBand(id);
    fetchOfferStatus(entry).then(function (st) {
      if (!st) return;
      // The bid's courriel, when the API carries it, signs this device in as
      // the client (the bell and the account menu appear); otherwise the
      // device stays anonymous and still shows the band.
      var courriel = (st.bid && st.bid.courriel) || st.courriel || null;
      if (courriel && D.isEmail(courriel) && !profileGet().courriel) { profileSet({ courriel: courriel }); renderAccountMenu(); }
      if (state.tab === 'profil') { renderProfil(); openOfferBand(id); }
    });
    return true;
  }

  async function clientPropositionReply(o, propositionId, verb) {
    var r = await fetch(API_BASE + '/client/propositions/' + verb, {
      method: 'POST', headers: clientHeaders(o, true),
      body: JSON.stringify({ id: o.id, dateISO: o.dateISO, propositionId: propositionId }),
    });
    var j = {}; try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, body: j };
  }
  // Dossier push: once the client saves something for an act that has a live
  // tokened offer, the notary's "documents demandés" must flip to « fournie ».
  // Debounced so typing in a field is one request, fire-and-forget.
  var DOSSIER_PUSH_MS = 500;
  var dossierPushTimers = {};
  function scheduleDossierPush(serviceId) {
    var o = myLiveOfferFor(serviceId); if (!o) return;
    clearTimeout(dossierPushTimers[serviceId]);
    dossierPushTimers[serviceId] = setTimeout(function () {
      try {
        fetch(API_BASE + '/client/dossier', {
          method: 'POST', headers: clientHeaders(o, true),
          body: JSON.stringify({ id: o.id, dateISO: o.dateISO, dossier: dossierWire(serviceId) }),
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
          if (!j) return;
          var st = offerStatusGet(o.id) || {};
          offerStatusSet(o.id, { bid: st.bid, notaire: st.notaire, propositions: st.propositions, demandes: j.demandes || st.demandes, readiness: j.readiness || st.readiness });
          if (state.tab === 'profil') renderProfil();
        }).catch(function () {});
      } catch (e) { /* offline */ }
    }, DOSSIER_PUSH_MS);
  }
  // The live status of one of the client's own offers: retained by a notary
  // (approved), still open past its date (expired), or waiting (pending). The
  // retained flag is checked first so status is correct in ANY loaded month, not
  // only the anchor month whose bids happen to be in state.monthBids.
  function clientOfferStatus(o) {
    if (o.cancelled) return 'cancelled';
    if (o.retained) return 'approved';
    var pub = (state.monthBids || []).filter(function (b) { return b.id === o.id; })[0];
    if (pub && pub.status === D.STATUS.RETENUE) { markMyOfferRetained(o.id, { etude: pub.etude }); return 'approved'; }
    if (D.daysBetween(todayISO(), o.dateISO) < 0) return 'expired';
    return 'pending';
  }
  // Plain words, never a code: what the status means for the client right now.
  function offerStatusLabel(o, st) {
    if (st === 'cancelled') return 'Annulée';
    if (st === 'approved') return o.etude ? 'Retenue par ' + o.etude : 'Retenue par un notaire';
    if (st === 'expired') return 'Date passée';
    return 'Ouverte — en attente d’un notaire';
  }
  // The one line that says what happens next for this offer.
  function offerNextStep(o, st, status) {
    if (st === 'cancelled') {
      // ADR 0023 — a cancellation that kept a fee says so on its receipt line.
      var kept = status && status.bid && status.bid.annulation;
      if (kept && Number(kept.frais) > 0) {
        return 'Vous avez annulé cette offre. Des frais de ' + D.money(kept.frais) + ' (' + pctLabel(kept.taux)
          + ') ont été retenus sur votre caution et versés au notaire en dédommagement. Si vous changez d’avis, choisissez une nouvelle date au carnet.';
      }
      return 'Vous avez annulé cette offre. Si vous changez d’avis, choisissez une nouvelle date au carnet.';
    }
    if (st === 'expired') return 'Cette date est passée. Choisissez une nouvelle date au carnet.';
    // ADR 0033 — the whole truth of a retained act: the conversation is the
    // channel, and the notary keeps the right to withdraw (free for them,
    // counted on their file); the offer then returns to the carnet as posted.
    if (st === 'approved') return 'Convenez du lieu et de l’heure avec votre notaire dans la conversation ci-dessous, et ajoutez la date à votre agenda. Le notaire peut encore se désister : votre demande reviendrait alors au carnet, publiée telle quelle, et vous en seriez prévenu.';
    var pend = status && (status.propositions || []).filter(function (p) { return p.status === 'en_attente'; }).length;
    if (pend) return 'Un notaire vous propose un autre prix : acceptez ou refusez ci-dessous.';
    var dem = status && (status.demandes || []).filter(function (d) { return !d.fournie; }).length;
    if (dem) return 'Un notaire attend des documents : complétez votre dossier ci-dessous.';
    // An entry born from a deep link knows no act yet: the status is loading.
    if (!o.serviceId || !D.serviceById(o.serviceId)) return 'Chargement de votre demande…';
    // PRICE BEFORE DOCUMENTS (ADR 0010 §3): the demand is already sellable —
    // the only remaining gate is the sharing consent; the documents are
    // preparation for after the mise en relation, never a barrier.
    var r = D.leadReadiness(o.serviceId, dossierFor(o.serviceId));
    if (!r.ready) return 'Autorisez le partage de votre dossier depuis la page « Mon dossier » — il sera transmis dès qu’un notaire retient votre demande.';
    if (r.missing.length) return 'En attendant qu’un notaire la retienne, préparez vos documents — ils seront transmis après la mise en relation, rien ne bloque votre demande.';
    return 'Tout est prêt. Un notaire de Québec peut retenir votre demande à tout moment — vous serez prévenu ici.';
  }
  function svcName(id) { var s = D.serviceById(id); return s ? s.nom : id; }

  // « ★ 4,5 (12 avis) » — the public face of a notary's evaluations. fr-CA
  // decimal comma; the i18n rule flips it to the EN shape. Null rating → null:
  // no fake zero-star badge, ever.
  function ratingSpan(rating) {
    if (!rating || rating.note == null) return null;
    var txt = '★ ' + String(rating.note).replace('.', ',') + ' (' + rating.avis + ' avis)';
    var sp = el('span', 'rating-badge', txt);
    sp.setAttribute('aria-label', 'Note moyenne ' + String(rating.note).replace('.', ',') + ' sur 5, ' + rating.avis + ' avis');
    return sp;
  }

  // The fiche the notary DECLARED in the Chambre's directory (ADR 0016) — and
  // the badge has to say exactly that much, no more.
  //
  // Nota verifies nothing here: domain.validateNotaryProfile only checks the
  // SHAPE of the URL (https, cnq.org host). Nobody confirms the fiche exists,
  // belongs to this notary, or that they are in good standing. Since ADR 0030
  // stripped the reviews and the cote, this is one of only two signals a client
  // sees — so a « CNQ ✓ » would read as « Nota checked », which is precisely
  // the « renseignement faux ou trompeur » of art. 68. The check mark is gone;
  // the label names the declarer, and the tooltip disclaims the verification.
  // Two lengths, one warning. A dense proposition list (price, badge, act
  // count, delta on one row) gets the short label; the retained notary's own
  // line has the room for the full one. `complet` picks the label — and ONLY
  // the label: the title and the accessible name are identical in both cases,
  // because the shortcut must never shorten the disclaimer.
  var CNQ_DECLAREE = 'Fiche déclarée par le notaire dans l’annuaire de la Chambre des notaires du Québec. Nota ne vérifie pas cette déclaration.';
  function cnqBadge(complet) {
    var sp = el('span', 'cnq-badge', complet ? 'Fiche déclarée à la Chambre' : 'Fiche déclarée');
    sp.setAttribute('title', CNQ_DECLAREE);
    sp.setAttribute('aria-label', CNQ_DECLAREE);
    return sp;
  }

  // Where a client can check for themselves. Before retention the API serves
  // only a boolean — the fiche URL carries the notary's phone and contact does
  // not flow before retention (ADR 0016) — so Nota cannot hand over THE fiche.
  // It can hand over the Chambre's public directory, which is the real answer
  // to « says who? ». The address is the domain's, never a literal here.
  function cnqAnnuaireLink() {
    var a = el('a', 'help my-offer-cnq-annuaire', 'Vérifier un notaire dans l’annuaire de la Chambre des notaires du Québec ↗');
    a.href = D.CNQ.annuaire;
    a.target = '_blank';
    a.setAttribute('rel', 'noopener');
    return a;
  }

  // Affichage d'un pourcentage, fr-CA : 0,09 → « 9 % ». Ne sert plus qu'au
  // barème d'annulation (ADR 0023) — jamais à une part d'honoraires.
  function pctLabel(rate) {
    return String(Math.round(rate * 1000) / 10).replace('.', ',') + ' %';
  }

  // fr-CA decimal for the cote's figures: 35.6 → « 35,6 », 40 → « 40 ».
  function decLabel(n) { return String(Math.round(Number(n) * 10) / 10).replace('.', ','); }

  // « 37 actes signés via Nota » — a verifiable FACT about a named notary, and
  // the only kind of thing a client-facing view may say about one.
  //
  // Article 70 du Code de déontologie des notaires (N-3, r. 2): « Le notaire ne
  // peut, dans sa publicité, utiliser OU PERMETTRE QUE SOIT UTILISÉ un
  // témoignage d'appui ou de reconnaissance qui le concerne » — sans exception
  // pour les avis authentiques. A notary listed here would be "permitting the
  // use" of any evaluation Nota published about them, and a displayed score
  // turns a directory into a recommendation (NYSBA 1132 v. Avvo). So: no stars,
  // no average, no review count, no cote on ANY client surface. A count of acts
  // is not a testimonial — it is a fact the notary carried.
  //
  // Zero acts renders NOTHING: « 0 acte » beside a price reads as a demerit,
  // and a demerit is an appreciation by the back door.
  function actsFact(actes) {
    var n = Math.floor(Number(actes));
    if (!isFinite(n) || n <= 0) return null;
    return el('span', 'help my-offer-acts', n + (n === 1 ? ' acte signé via Nota' : ' actes signés via Nota'));
  }

  // --- Client profile --------------------------------------------------------
  // Created with sensible defaults on first read (all notifications on). Held on
  // this device; reused across the offer flow and the dossier.
  var LS_PROFILE = 'nota.profile.v1';
  // EVERY kind addNotif() can ring, with the label of its profile toggle — the
  // notifications card renders one switch per entry and the defaults derive
  // from this same list, so a new kind cannot ship without its toggle. All on
  // by default; a kind toggled off is silenced in notifAllowed().
  var PROFILE_NOTIF_KINDS = [
    { key: 'published', label: 'Confirmation de publication d’une offre' },
    { key: 'reminders', label: 'Rappels à l’approche de la date' },
    { key: 'retained', label: 'Avis quand un notaire retient votre offre' },
    { key: 'proposition', label: 'Propositions de prix des notaires' },
    { key: 'documents', label: 'Demandes de documents du notaire' },
    { key: 'message', label: 'Messages de votre notaire' },
    { key: 'cancelled', label: 'Confirmation d’annulation d’une offre' },
    { key: 'acte', label: 'Acte signé — invitation à évaluer' },
    { key: 'released', label: 'Avis si le notaire se désiste' },
  ];
  var PROFILE_NOTIF_DEFAULTS = {};
  PROFILE_NOTIF_KINDS.forEach(function (k) { PROFILE_NOTIF_DEFAULTS[k.key] = true; });
  function profileGet() {
    var p = lsLoad(LS_PROFILE) || {};
    return {
      nom: p.nom || '', courriel: p.courriel || '', prefixe: p.prefixe || '',
      // Private: only for the mise en relation with the retaining notary.
      telephone: p.telephone || '',
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
    a.unshift({ key: n.key, title: n.title, body: n.body || '', dateISO: n.dateISO || null, offerId: n.offerId || null, read: false });
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
  // Quietly retire one entry by key (read, not dismissed): the event it
  // announced has been superseded — the bell must stop contradicting reality.
  function markNotifRead(key) {
    var a = notifLoad(); var changed = false;
    a.forEach(function (x) { if (x.key === key && !x.read) { x.read = true; changed = true; } });
    if (changed) { notifSave(a); renderNotifs(); }
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
      // Two kinds of door: an offer's band on Mes offres (a message from the
      // notary), or that day on the carnet.
      if (n.offerId || n.dateISO) {
        item.setAttribute('role', 'button'); item.tabIndex = 0;
        var go = function () {
          toggleNotifPanel(false); markAllRead();
          if (n.offerId) openOfferBand(n.offerId); else openDay(n.dateISO);
        };
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
  // The rows a keyboard user can walk inside the account panel, in DOM order,
  // skipping disabled/hidden rows. No anon case: the panel lives inside the
  // account wrap, hidden whenever the visitor is signed out.
  function acctMenuItems() {
    var panel = $('notif-panel'); if (!panel) return [];
    return Array.prototype.filter.call(panel.querySelectorAll('button, .notif-item[role="button"]'), function (b) {
      if (b.disabled || b.hidden) return false;
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
    var title = $('auth-title');
    // The title matches the button that opened the door (traditional site
    // expectation); the CTA names the exact action so the click count is
    // honest: client = signed in on THIS click, notary = a link is coming.
    if (title) title.textContent = authMode === 'signin' ? 'Connexion' : 'Créer votre compte';
    if (authRole === 'notary') {
      if (fine) fine.textContent = 'Un lien sécurisé arrive par courriel — un clic et vous êtes dans l’espace notaire.';
      if (cont) cont.textContent = 'Recevoir mon lien de connexion →';
    } else {
      // The courriel DOES leave the device: the button below calls
      // clientWelcome(), which POSTs it to /client/welcome, and the API keeps
      // it in a SENT# record keyed on the address. So the copy states the
      // transmission, and narrows what stays local to what really does — file
      // CONTENTS. The dossier's answers and document filenames travel with an
      // offer (payload.dossier), so they are deliberately not promised here.
      if (fine) fine.textContent = 'Publiez une demande et suivez vos offres. Votre courriel est transmis à Nota pour le lien de suivi et les avis. Le contenu de vos documents, lui, ne quitte jamais cet appareil.';
      if (cont) cont.textContent = authMode === 'signin' ? 'Me connecter' : 'Créer mon compte';
    }
  }
  var authMode = 'signup';
  function openAuthModal(role, mode) {
    authMode = mode === 'signin' ? 'signin' : 'signup';
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
  function openClientSignIn() { openAuthModal('client', 'signin'); }

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
      ncSignIn(val); // passwordless request → verify (magic link); signup one click away
      return;
    }
    profileSet({ courriel: val });               // client identity is device-local
    clientWelcome(val);
    if (dlg && dlg.close) { try { dlg.close(); } catch (e) {} }
    renderAccountMenu();
    computeNotifications();
    toast('Bienvenue ! Vous êtes connecté comme ' + val + '.');
    setTab('profil', { focus: false });
  }

  // The one client-signup call, shared by the auth modal and the bid opt-in.
  // Fire-and-forget welcome email (conversion nudge). Idempotent server-side,
  // so re-signing in never re-sends; never blocks or breaks the UI on failure.
  function clientWelcome(courriel) {
    try {
      fetch(API_BASE + '/client/welcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courriel: courriel }),
      }).catch(function () {});
    } catch (e) {}
  }

  // Funnel beacon — one step of the conversion funnel, nothing else. The
  // catalogue is the domain's (D.FUNNEL_EVENTS): anything outside it is dropped
  // here before it reaches the wire. The body is the bare event id — no
  // identifier, no session, nothing stored on the device. sendBeacon survives
  // a page unload; the keepalive POST is the fallback. Never throws, never
  // blocks: a dead analytics endpoint must not cost the client a single frame.
  function track(eventId) {
    try {
      if (!D.isFunnelEvent(eventId)) return;
      var url = API_BASE + '/events';
      var body = JSON.stringify({ event: eventId });
      if (navigator && typeof navigator.sendBeacon === 'function') {
        if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
      }
      var p = fetch(url, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: body });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) { /* analytics never breaks the page */ }
  }
  // « formulaire » fires once per dialog opening, and only once the dialog has
  // finished its own programmatic set-up (armed at the end of openDay) — a
  // pre-fill dispatching a change event is not a client starting the form.
  var formArmed = false, formStarted = false;
  function noteFormStart() {
    if (!formArmed || formStarted) return;
    formStarted = true;
    track('formulaire');
  }
  // « notaire_porte » counts once per page load, however often the door is used.
  var notaryDoorSent = false;
  function noteNotaryDoor() {
    if (notaryDoorSent) return;
    notaryDoorSent = true;
    track('notaire_porte');
  }

  // The first date at the STANDARD tier — the advertised floor, no urgency
  // premium. Read off the domain's ladder (the smallest notice tierForDays
  // calls standard), never a literal day count: the day the ladder moves, the
  // default moves with it.
  function firstStandardDate() {
    var n = 0;
    while (D.tierForDays(n) !== 'standard' && n < 400) n++;
    return D.addDays(todayISO(), n);
  }

  // The offer flow entry point used elsewhere (hero CTA): the carnet with a day
  // open. With no day selected it opens the first standard date — opening TODAY
  // showed a first-time visitor the ×4 same-day price as their introduction.
  function openOfferFlow() {
    toggleNotifPanel(false);
    setTab('carnet', { scroll: false });
    openDay(state.selectedDate || firstStandardDate());
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
        { icon: 'prix', t: 'Proposez votre prix', d: 'plus la date est proche, plus il faut offrir.' },
        { icon: 'retenu', t: 'Un notaire vous retient', d: 'ou vous propose un prix — vous restez libre. Vous payez votre prix affiché à la signature, rien de plus.' },
      ],
    },
    notary: {
      title: 'Recevez des dossiers en 3 étapes',
      sub: 'Vous choisissez les demandes qui vous conviennent.',
      cta: 'Voir les demandes →',
      alt: 'Explorer les demandes d’abord',
      steps: [
        { icon: 'liste', t: 'Voyez les demandes ouvertes', d: 'à Québec, par date de signature.' },
        { icon: 'main', t: 'Retenez — ou négociez', d: 'proposez votre prix ou demandez des documents ; le dossier s’ouvre dès que vous retenez.' },
        { icon: 'acte', t: 'Complétez l’acte', d: 'vos honoraires vous sont virés en entier.' },
      ],
    },
  };

  // Build a flow's three steps into `list` — shared by the guide's VIEW 2 and
  // the standing #how-it-works cards, so the two can never drift apart.
  function onbStepsInto(list, flow) {
    if (!list) return;
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

  // Live proof on the role cards: what the carnet actually holds right now.
  // Real counts for the client, real money for the notary; hidden until the
  // month's data has landed, so the guide never shows a zero it cannot defend.
  function onbLiveLines() {
    var bids = state.monthBids || [];
    var cl = $('onb-live-client'), no = $('onb-live-notary');
    if (!bids.length) { if (cl) cl.hidden = true; if (no) no.hidden = true; return; }
    var open = bids.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    var taken = bids.length - open.length;
    if (cl) {
      cl.textContent = bids.length + ' demande' + (bids.length > 1 ? 's' : '') + ' publiée' + (bids.length > 1 ? 's' : '') + ' ce mois-ci · ' + taken + ' retenue' + (taken > 1 ? 's' : '');
      cl.hidden = false;
    }
    if (no) {
      var total = open.reduce(function (sum, b) { return sum + (Math.round(Number(b.montant)) || 0); }, 0);
      no.textContent = open.length + ' demande' + (open.length > 1 ? 's' : '') + ' ouverte' + (open.length > 1 ? 's' : '') + ' · ' + D.money(total) + ' à retenir';
      no.hidden = !open.length;
    }
  }

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
    onbStepsInto($('onb-steps'), flow);
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
    // A shared link is a destination: whoever follows #jour= or #t= was sent
    // somewhere specific — greeting them with a modal steals the destination.
    var h = String(location.hash || '');
    if (/[#&](t|jour)=/.test(h)) return;
    // A device that already published an offer was onboarded by reality; the
    // guide stays one click away in the footer and the account menu.
    if (myOffers().length) return;
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
    if (explore === true) { setTab(role === 'notary' ? 'notaires' : 'carnet'); return; }
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

  // The identity head reacts to the role: notary → their console, client →
  // their profile. No anon path: the panel lives inside the account wrap,
  // hidden whenever the visitor is signed out.
  function onAcctHeadClick() {
    toggleNotifPanel(false);
    setTab(accountRole() === 'notary' ? 'notaires' : 'profil');
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
    // The header's "?" guide icon is ALWAYS visible (owner's ask, 2026-08-26):
    // it is the one standing way back into the guide, so the account menu
    // carries no duplicate row and no role ever hides it.
    // The mobile drawer mirrors the header pair: auth buttons only while anonymous.
    var mnavAuth = $('mnav-auth'); if (mnavAuth) mnavAuth.hidden = role !== 'anon';
    // The account bell belongs to the SIGNED-IN state only (owner's ask,
    // 2026-08-28): an anonymous visitor never sees it — even one holding
    // offers published from this device. Their offers and dossier stay
    // reachable through the post-publish card and the #t= deep links; the
    // header shows the explicit login/signup pair instead. Everything below
    // paints the inside of the wrap, so the anon render stops here.
    var acctWrap = document.querySelector('.acct-wrap'); if (acctWrap) acctWrap.hidden = role === 'anon';
    if (role === 'anon') return;
    var p = profileGet();

    if (role === 'notary') {
      if (name) name.textContent = nc.email || 'Espace notaire';
      if (email) email.textContent = 'Vos demandes et vos dossiers retenus';
      if (roleTag) { roleTag.textContent = 'Espace notaire'; roleTag.hidden = false; }
    } else {
      if (name) name.textContent = p.nom || 'Mon compte';
      if (email) email.textContent = p.courriel;
      if (roleTag) { roleTag.textContent = 'Client'; roleTag.hidden = false; }
    }

    var actions = $('acct-actions'); if (!actions) return;
    clear(actions);
    // No guide row here: the header "?" icon is always visible (owner's ask,
    // 2026-08-26) and the footer link remains — a menu row would be a third
    // door to the same dialog.
    if (role === 'notary') {
      actions.appendChild(acctAction('dossiers', 'Mes demandes et dossiers', function () { toggleNotifPanel(false); setTab('notaires'); }));
      actions.appendChild(acctAction('signout', 'Se déconnecter', function () { ncSignOut(); renderAccountMenu(); toggleNotifPanel(false); }));
    } else {
      // Two DISTINCT rows: the profile (offers table + contact details) and the
      // dossier (document checklist). The dossier row is the pane's permanent
      // door — without it the only entry is the one-shot post-publish card.
      var profilDoor = acctAction('profil', 'Mon profil', function () { toggleNotifPanel(false); setTab('profil'); });
      // Unread notary messages (ADR 0033): the count rides the door to the
      // offers where the threads live.
      var unread = unreadTotal();
      if (unread) {
        var ub = el('span', 'acct-badge', unread > 9 ? '9+' : String(unread));
        ub.setAttribute('aria-label', unreadLabel(unread));
        profilDoor.appendChild(ub);
      }
      actions.appendChild(profilDoor);
      actions.appendChild(acctAction('dossiers', 'Mon dossier', function () { toggleNotifPanel(false); openDossier(myDossierServiceId()); }));
      actions.appendChild(acctAction('signout', 'Se déconnecter', clientSignOut));
    }
  }

  // The dossier opens on the act the client is actually preparing: the soonest
  // upcoming offer's service, else the most recent one (openDossier keeps the
  // current selection when this returns null).
  function myDossierServiceId() {
    var today = todayISO();
    var offers = myOffers().slice().sort(function (a, b) { return String(a.dateISO).localeCompare(String(b.dateISO)); });
    var up = offers.filter(function (o) { return D.daysBetween(today, o.dateISO) >= 0; });
    var pick = up[0] || offers[offers.length - 1];
    return pick ? pick.serviceId : null;
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
    // What notaries sent back (propositions, document requests) on the offers
    // this browser can read: in parallel, failures silent.
    await Promise.all(offers.filter(offerNeedsStatusPoll).map(fetchOfferStatus));
    renderNotifs();
  }
  // Which of this browser's offers are worth a GET /client/bid on this pass:
  // every live tokened offer — and, past the date, a retained act whose
  // evaluation is still pending, so « Acte signé » reaches the bell without
  // the client having to open Mes offres (the settlement lands AFTER the
  // signing day). Once the evaluation is on file, the polling stops.
  function offerNeedsStatusPoll(o) {
    if (!o || !o.clientToken) return false;
    if (D.daysBetween(todayISO(), o.dateISO) >= 0) return true;
    if (o.cancelled || !o.retained) return false;
    var st = offerStatusGet(o.id);
    return !(st && st.evaluation);
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
          var svcC = carnetService();
          var urg = el('span', 'cal-urgency', tierFromLabel(tier.id, svcC));
          urg.dataset.tier = tier.id;
          // Narrow cells swap to this compact figure (same data-compact pattern
          // as .cal-avg) — "dès 4 000 $" is ~66px and paints over the next day
          // on any cell under ~84px. The full amount stays in the DOM and in
          // the title below, so hover and screen readers keep the exact price.
          urg.dataset.compact = compactMoney(tierAmount(tier.id, svcC));
          urg.title = T(tierName(tier)) + '. À ce délai, une offre en ' + T(svcC.nom).toLowerCase()
            + ' se conclut autour de ' + D.money(tierAmount(tier.id, svcC)) + '.'
            // Tuned on state.monthBids: invented when the month is.
            + (state.demo ? ' Chiffre de démonstration.' : '');
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
      // Carried for the tooltip a calendar cell shows on hover, where there
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
      // The hover bubble is a real node rather than a ::after so it can carry
      // the act's icon next to its name. aria-hidden: screen readers get the
      // same words from the visually-hidden span below.
      if (!showName) {
        var tip = el('span', 'svc-tip');
        tip.setAttribute('aria-hidden', 'true');
        var head = el('span', 'svc-tip-head');
        var tipIc = svcIcon(svc.id, 16);
        if (tipIc) head.appendChild(tipIc);
        head.appendChild(el('span', 'svc-tip-name', T(svc.nom)));
        tip.appendChild(head);
        tip.appendChild(el('span', 'svc-tip-detail', T(detail)));
        item.appendChild(tip);
      }
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
    // dollar amount an offer for the carnet's act actually settles at.
    var svcL = carnetService();
    lg.appendChild(el('span', 'legend-label', 'Délai'));
    D.TIERS.forEach(function (t) {
      var item = el('span', 'legend-item');
      var dot = el('span', 'legend-dot'); dot.style.background = 'var(--tier-' + t.id + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(tierName(t) + ' '));
      var m = el('span', 'legend-mult', tierFromLabel(t.id, svcL));
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
    // One sentence naming the two figures a cell prints — nothing more. The
    // urgency lecture lives in the day dialog, at the decision point, not here.
    var note = el('span', 'legend-note');
    note.appendChild(el('strong', null, 'Dans chaque case'));
    note.appendChild(document.createTextNode(
      ' : la meilleure offre encore ouverte pour chaque acte, à la couleur ci-dessus, '
      + 'et le prix indicatif (« dès ») d’une offre à ce délai.'
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
    openDay(state.selectedDate || firstStandardDate());
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
    // An empty day states only the lead time here — "no offers / be the first"
    // is said ONCE, in #day-hint (renderDayBids writes it for the empty act).
    $('day-sub').textContent = all.length
      ? all.length + ' offre' + (all.length > 1 ? 's' : '') + (takenN ? ' · ' + takenN + ' retenue' + (takenN > 1 ? 's' : '') : '') + ' · ' + when
      : when.charAt(0).toUpperCase() + when.slice(1);

    // --- Inline booking (relocated offer-form) — the clicked day IS the date ---
    $('o-date').value = iso; onOfferDateChange();
    var pick = $('day-date'); if (pick) pick.value = iso;
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
    if ($('o-telephone')) $('o-telephone').value = prof.telephone;
    if ($('o-prefix')) $('o-prefix').value = prof.prefixe;
    if ($('o-name')) $('o-name').value = prof.nom;
    commitAnon(prof.anonyme);
    var succ = $('offer-success'); if (succ) succ.hidden = true;
    var eb = $('offer-errors'); if (eb) { eb.hidden = true; clear(eb); }
    renderDayBids(iso);
    // ONE sentence about lead time, said only here — the lead time itself is
    // already printed in #day-sub right above, so it is not repeated.
    //
    // It used to quote the domain's hand-written obtain-chance table as an
    // « … un notaire : 95 % » headline. That table has never been measured — not one
    // act has been completed on the platform — and it appeared exactly where
    // the client picks a date and a price. A percentage presented as an
    // observed probability when nothing has been observed is the worst kind of
    // claim, so it is gone. What replaces it is the MECHANISM, which is true
    // and checkable. No number, and no « élevées / faibles » scale either:
    // a qualitative ladder still mimics a measurement. The figure may come
    // back the day it is actually measured.
    var chanceEl = $('day-chance');
    if (chanceEl) chanceEl.textContent = 'Plus la date est éloignée, plus de notaires ont la latitude de s’organiser pour la prendre ; une date rapprochée en laisse moins.';
    validateOfferUI();

    renderActiveView();
    var dlg = $('day-dialog');
    var wasOpen = !!dlg.open;
    if (dlg.showModal && !dlg.open) dlg.showModal();
    // The criteria were rendered while the dialog was still closed — zero
    // geometry. Re-settle the tracks now that they are visible.
    settleSegTracks($('o-criteria'));
    // A dialog OPENING is one funnel step; a date moved inside it is not.
    if (!wasOpen) { formStarted = false; track('jour_ouvert'); }
    formArmed = true;
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
      // No open offer → no sub at all (the :empty rule hides it). Every act
      // is always bookable, so « libre » said nothing — only an amount is a
      // fact worth printing on the choice.
      subEl.textContent = best != null ? D.money(best) : '';
    });

    // Headline row: the one offer to beat for this act.
    if (matching.length) list.appendChild(bidRow(matching[0]));

    // Totals: what the client is actually up against on this date. Only real
    // numbers — "Aucune offre en X" is #day-hint's sentence, never repeated
    // here — and the all-acts segment only appears when it says something the
    // act segment does not. Nothing to count = no count line at all.
    var counts = [];
    if (svc && matching.length) {
      counts.push(matching.length + ' offre' + (matching.length > 1 ? 's' : '') + ' en ' + T(svc.nom).toLowerCase());
    }
    if ((!svc || dayAll.length !== matching.length) && dayAll.length > 0) {
      counts.push(dayAll.length + ' offre' + (dayAll.length > 1 ? 's' : '') + ' ce jour, tous actes confondus');
    }
    var countEl = counts.length ? el('div', 'day-bids-count', counts.join(' · ')) : null;
    if (countEl) list.appendChild(countEl);

    // Everything not shown above, on demand — behind an INLINE door on the
    // totals line itself (owner, 2026-08-27: « compacter les sections »): the
    // count and its toggle share one row instead of stacking a full-width
    // button under the list.
    var others = dayAll.filter(function (b) { return b !== matching[0]; }).slice(0, DAY_CAP);
    if (others.length) {
      var rest = el('div', 'day-bids-rest'); rest.hidden = true;
      others.forEach(function (b) { rest.appendChild(bidRow(b)); });
      var label = others.length > 1
        ? 'Voir les ' + others.length + ' autres offres'
        : 'Voir l’autre offre';
      var toggle = el('button', 'day-bids-toggle', label); toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        var opening = rest.hidden;
        rest.hidden = !opening;
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
        toggle.textContent = opening ? 'Voir moins' : label;
      });
      (countEl || list).appendChild(toggle);
      list.appendChild(rest);
    }

    // Headline figure + the bar to clear, both scoped to the selected act. The
    // label names that act — the amount means nothing without it. No open
    // offer → no market line at all: every date is bookable by definition, so
    // a « Libre » badge carried no information; the hint below owns the empty
    // state, and the price itself is the lever (offer more, be retained first).
    var open = rawMatching.filter(function (b) { return b.status !== D.STATUS.RETENUE; });
    var top = open.length ? Math.max.apply(null, open.map(function (b) { return b.montant; })) : null;
    var bestK = $('day-best-k');
    if (bestK) bestK.textContent = svc ? 'Ce que d’autres offrent ce jour-là · ' + svc.nomCourt : 'Ce que d’autres offrent ce jour-là';
    var bestV = $('day-best');
    var marketLine = bestV.closest('.day-market-line');
    if (marketLine) marketLine.hidden = top == null;
    bestV.textContent = top != null ? D.money(top) : '';
    if (top != null) { bestV.classList.remove('pulse'); void bestV.offsetWidth; bestV.classList.add('pulse'); }
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
          + ' — fixez votre prix.'
        : 'Aucune offre en ' + name + ' pour cette date. Soyez le premier — fixez votre prix.';
    }
    updateBeatUI();
  }

  // The card's bottom line is LIVE: it compares the slider to the act's best
  // open offer and, while the offer trails, gives a one-tap way over the bar.
  // "Offrir autant" matches what others already offer that day — a reference
  // point, not an auction: a notary can retain several clients on one day.
  function beatAmount() {
    var amt = $('o-amount');
    if (state.dayTop == null || !amt || amt.disabled) return null;
    var target = state.dayTop;
    var max = Number(amt.max), min = Number(amt.min);
    if (Number.isFinite(max) && target > max) return null;
    if (Number.isFinite(min) && target < min) return null;
    return target;
  }
  function updateBeatUI() {
    var btn = $('day-beat'), hint = $('day-hint');
    if (!btn || !hint) return;
    if (state.dayTop == null) { btn.hidden = true; return; }  // renderDayBids wrote the free-slot hint
    // Static on purpose: the aria-live card announces only the arrival at the
    // reference. While the offer trails, the headline above and the one-tap
    // button already carry the number — a sentence restating it was noise.
    var level = Number($('o-amount').value) >= state.dayTop;
    var t = beatAmount();
    // Trailing with a reachable bar: silence (the headline and the button
    // carry the number). Trailing with the bar OUT of this act's own range —
    // another dossier's surcharges can push its total past the ceiling —
    // there is nothing to tap, so say why instead of going silent.
    hint.textContent = level
      ? 'Votre offre est au niveau de ce que d’autres offrent ce jour-là.'
      : (t == null ? 'Cette référence dépasse votre plage pour cet acte.' : '');
    hint.classList.toggle('is-ahead', level);
    btn.hidden = level || t == null;
    if (!btn.hidden) btn.textContent = 'Offrir autant · ' + D.money(t);
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
    if (h.has('t') && PANES.indexOf(h.get('t')) >= 0) state.tab = h.get('t');
  }
  function writeHash(opts) {
    var h = new URLSearchParams();
    var f = state.filters;
    if (f.service) h.set('svc', f.service);
    if (f.statut) h.set('statut', f.statut);
    if (f.min != null) h.set('min', f.min);
    if (f.max != null) h.set('max', f.max);
    if (f.sort && f.sort !== 'montant-desc') h.set('tri', f.sort);
    if (state.selectedDate) h.set('jour', state.selectedDate);
    // The default pane keeps a clean URL; every other pane is addressable.
    if (state.tab && state.tab !== 'carnet') h.set('t', state.tab);
    var s = h.toString();
    var url = s ? '#' + s : location.pathname;
    // Pane changes push (the Back button walks panes); filter tweaks replace.
    if (opts && opts.push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
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
    buildDossierChips();
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

  // Same component in the Dossier: chips drive the hidden #d-service select.
  // renderDossier() re-syncs the pressed chip, so every code path that sets the
  // select's value (deep links, openDossier) lights the right chip for free.
  function buildDossierChips() {
    var wrap = $('d-service-chips'); if (!wrap) return; clear(wrap);
    D.SERVICES.forEach(function (s) {
      var b = el('button', 'chip chip-svc');
      b.type = 'button'; b.dataset.svc = s.id; b.setAttribute('aria-pressed', 'false');
      var main = el('span', 'chip-svc-main');
      var ic = svcIcon(s.id); if (ic) main.appendChild(ic);
      main.appendChild(document.createTextNode(s.nomCourt));
      b.appendChild(main);
      wrap.appendChild(b);
    });
  }
  function syncDossierChips(serviceId) {
    var wrap = $('d-service-chips'); if (!wrap) return;
    var b = wrap.querySelector('[data-svc="' + serviceId + '"]');
    if (b) setGroupActive(wrap, b);
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
  // The flat dollar effect of an answer, shown ON the answer ("+400 $" /
  // "−150 $") so the price impact is visible where the choice is made — no
  // separate price note. Returned as a SEPARATE span appended AFTER the label's
  // text node: i18n exact-matches whole text nodes, so the label text must
  // never be concatenated with the badge. Data-driven from the criterion's
  // `add` (domain criterionAdd semantics); brackets carry no badge.
  function critAddBadge(add) {
    add = Number(add) || 0;
    if (!add) return null;
    return el('span', 'crit-add', (add > 0 ? '+' : '−') + D.money(Math.abs(add)));
  }

  // ---------------------------------------------------------------------------
  // Nota select — a brand-styled dropdown drawn over a native <select>. The OS
  // paints the native popup (macOS Chrome follows the OS appearance, not the
  // page's color-scheme), so a dark Nota page could open a white system menu.
  // The native control STAYS in the DOM as the single source of truth: forms,
  // tests and i18n keep talking to it. Picking an option writes sel.value and
  // fires a bubbling change; a programmatic sel.value write (the contact
  // prefill) repaints the button label through the intercepted setter.
  // Skipped for the visually-hidden a11y mirrors — they never open a popup.
  // ---------------------------------------------------------------------------
  function enhanceSelect(sel) {
    if (!sel || sel.dataset.enhanced || sel.classList.contains('visually-hidden') ||
        sel.getAttribute('aria-hidden') === 'true') return sel;
    sel.dataset.enhanced = 'true';

    var wrap = el('div', 'nselect');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('nselect-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    var btn = el('button', 'nselect-btn');
    btn.type = 'button';
    if (sel.id) btn.id = sel.id + '__btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var val = el('span', 'nselect-value');
    btn.appendChild(val);
    wrap.appendChild(btn);

    var list = el('ul', 'nselect-list');
    list.setAttribute('role', 'listbox');
    if (sel.id) list.id = sel.id + '__list';
    list.hidden = true;
    wrap.appendChild(list);

    // The field label follows the visible control, so clicking it focuses the
    // button. getRootNode: the criterion rows are built detached, the label is
    // a sibling in the same not-yet-inserted tree.
    var root = sel.getRootNode ? sel.getRootNode() : document;
    var lab = sel.id && root.querySelector ? root.querySelector('label[for="' + sel.id + '"]') : null;
    if (lab && btn.id) lab.setAttribute('for', btn.id);

    function paintLabel() {
      var o = sel.options[sel.selectedIndex];
      val.textContent = o ? o.textContent : '';
      val.classList.toggle('is-placeholder', !o || o.value === '');
    }
    // Contract: a programmatic value write is followed by a bubbling change
    // event (the contact prefill does; tests already do) — that is the one
    // signal the label listens to. No property interception: jsdom's element
    // proxies silently drop instance accessors.
    sel.addEventListener('change', paintLabel);

    var active = -1;
    function paintActive() {
      var items = list.children;
      for (var i = 0; i < items.length; i++) items[i].classList.toggle('is-active', i === active);
      var on = items[active];
      if (on) {
        btn.setAttribute('aria-activedescendant', on.id || '');
        // Scroll ONLY the list, never the page: scrollIntoView would also
        // scroll every scrollable ancestor (the booking dialog), so opening
        // the dropdown made the whole sheet jump (owner, 2026-08-28: « do not
        // move while dropdown »). The list is the one thing allowed to move.
        if (on.offsetTop < list.scrollTop) {
          list.scrollTop = on.offsetTop;
        } else if (on.offsetTop + on.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = on.offsetTop + on.offsetHeight - list.clientHeight;
        }
      }
    }
    // Rebuilt on every open, so option edits and i18n passes are always current.
    function buildList() {
      clear(list);
      Array.prototype.forEach.call(sel.options, function (opt, i) {
        var li = el('li', 'nselect-opt', opt.textContent);
        li.setAttribute('role', 'option');
        if (list.id) li.id = list.id + '_' + i;
        li.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
        li.addEventListener('click', function () { commit(i); });
        list.appendChild(li);
      });
    }
    function openList() {
      buildList();
      list.hidden = false;
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      active = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
      paintActive();
    }
    function closeList() {
      list.hidden = true;
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    }
    function commit(i) {
      var opt = sel.options[i];
      if (!opt) return;
      sel.value = opt.value; // through the intercepted setter → label repaints
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      closeList();
      btn.focus();
    }

    btn.addEventListener('click', function () { if (list.hidden) openList(); else closeList(); });
    // Type-ahead, the way a native select behaves: typed letters jump the
    // active option to the next match (accent-folded — « Desjardins » answers
    // to "de"). Earns its keep on the 18-lender catalogue.
    var typeBuf = '', typeAt = 0;
    function typeAhead(ch) {
      var now = Date.now();
      if (now - typeAt > 800) typeBuf = '';
      typeAt = now;
      typeBuf += ch.toLowerCase();
      var fold = function (s) {
        s = String(s).toLowerCase();
        return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
      };
      var n = sel.options.length;
      // A repeated single letter cycles the matches ("d", "d", …).
      var from = typeBuf.length === 1 ? active + 1 : active;
      for (var i = 0; i < n; i++) {
        var idx = ((from + i) % n + n) % n;
        if (fold(sel.options[idx].textContent).indexOf(fold(typeBuf)) === 0) {
          active = idx; paintActive(); return;
        }
      }
    }
    btn.addEventListener('keydown', function (e) {
      var k = e.key;
      if (list.hidden) {
        if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); openList(); }
        else if (k.length === 1 && k !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openList(); typeAhead(k); }
        return;
      }
      if (k === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, sel.options.length - 1); paintActive(); }
      else if (k === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paintActive(); }
      else if (k === 'Home') { e.preventDefault(); active = 0; paintActive(); }
      else if (k === 'End') { e.preventDefault(); active = sel.options.length - 1; paintActive(); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); commit(active); }
      else if (k === 'Escape') { e.preventDefault(); closeList(); }
      else if (k === 'Tab') { closeList(); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeAhead(k); }
    });
    document.addEventListener('click', function (e) {
      if (!list.hidden && !wrap.contains(e.target)) closeList();
    });

    paintLabel();
    return sel;
  }
  // Every visible select on the static page (the hidden mirrors are skipped by
  // the guard above). Dynamically built selects call enhanceSelect themselves.
  function enhanceSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('select:not(.visually-hidden)'), enhanceSelect);
  }

  // A segmented track that cannot fit its options on one line stops being a
  // track: a ragged 2+1 wrap reads as two different controls, with the orphan
  // option shouting on its own full-width line. Once the options would wrap,
  // the bar restacks as full-width rows — answer left, price right — a quiet
  // menu of priced answers. Measured, not counted: the same 3-option bar fits
  // one line on a phone's full width but not in the dialog's two columns, and
  // the answer changes with the interface language. The qui row keeps its
  // designed 2-up + full-width urgence shape. jsdom has no layout (offsetTop
  // stays 0), so tests keep seeing the flat track.
  function settleSegTracks(scope) {
    var run = function () {
      var segs = (scope || document).querySelectorAll('.crit-row .seg');
      Array.prototype.forEach.call(segs, function (seg) {
        if (seg.classList.contains('crit-dep-qui')) return;
        seg.classList.remove('seg-stack');
        var btns = seg.querySelectorAll('.seg-btn');
        // Rects, not offsets: the dialog is position:fixed, where offsetParent
        // is null and offsetTop lies. Zero-size = not laid out (closed dialog,
        // folded expander, jsdom) — leave the flat track alone.
        if (btns.length < 3 || seg.hidden) return;
        var first = btns[0].getBoundingClientRect();
        var last = btns[btns.length - 1].getBoundingClientRect();
        if (!first.height || !last.height) return;
        if (last.top > first.top + 1) seg.classList.add('seg-stack');
      });
    };
    // Callers fire after the rows are in the live DOM, so measure right away
    // (getBoundingClientRect forces layout even in a hidden tab, where rAF
    // never runs). One rAF re-pass catches late shifts — a web font landing,
    // the dialog finishing its open.
    run();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  }

  // `other` (optional) wires a select criterion's free-text companion (domain
  // `c.autre` — « Autre prêteur » + name): { value, onChange } for the
  // companion field, revealed only while the opening option is chosen.
  function buildCriterionRow(c, current, onChange, idPrefix, other) {
    var row = el('div', 'crit-row');
    // The row knows its criterion, so the missing-answer pass and the hint's
    // jump links can find it without re-deriving ids from the controls.
    row.dataset.crit = c.id;
    if (c.type === 'flag') {
      var lab = el('label', 'crit-flag');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = idPrefix + c.id; cb.checked = !!current;
      cb.addEventListener('change', function () { onChange(cb.checked); });
      lab.appendChild(cb);
      var txt = el('span', 'crit-text');
      var flagLbl = el('span', 'crit-label', c.label);
      var flagAdd = critAddBadge(c.add);
      if (flagAdd) flagLbl.appendChild(flagAdd);
      txt.appendChild(flagLbl);
      if (c.aide) txt.appendChild(el('span', 'help', c.aide));
      lab.appendChild(txt);
      row.appendChild(lab);
    } else if (c.type === 'choice' && c.id === D.DEPLACEMENT_CRITERION_ID) {
      // The déplacement band splits into TWO CHIP ROWS — who travels, then
      // the radius for that direction — so all six bands read at a glance
      // with no menu to open. A visually-hidden native select stays the
      // source of truth (the o-service pattern): every write — chip click,
      // test, dossier sync — sets sel.value and dispatches `change`.
      row.appendChild(el('span', 'crit-label', c.label));
      var dsel = document.createElement('select');
      dsel.id = idPrefix + c.id; dsel.className = 'visually-hidden';
      dsel.tabIndex = -1; dsel.setAttribute('aria-hidden', 'true');
      var dph = document.createElement('option');
      dph.value = ''; dph.textContent = 'Choisir…';
      dsel.appendChild(dph);
      D.DEPLACEMENTS.forEach(function (d) {
        var o = document.createElement('option');
        o.value = d.id; o.textContent = d.nom;
        dsel.appendChild(o);
      });
      if (current != null) dsel.value = current;
      row.appendChild(dsel);

      // Two compact SEGMENTED BARS (the header-toggle register), left to
      // right: where it signs, then the radius. No wall of stacked pills.
      var depRows = el('div', 'crit-dep');
      var quiRow = el('div', 'seg crit-dep-qui');
      quiRow.setAttribute('role', 'group');
      var kmRow = el('div', 'seg crit-dep-km');
      kmRow.setAttribute('role', 'group');
      depRows.appendChild(quiRow); depRows.appendChild(kmRow);
      row.appendChild(depRows);

      var depCommit = function (id) {
        dsel.value = id;
        dsel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      var bandsOf = function (quiId) {
        return D.DEPLACEMENTS.filter(function (d) { return d.qui === quiId; });
      };
      // Who travels: an urgence direction carries its single band's price on
      // the chip itself; the others price on the radius row below.
      D.DEPLACEMENT_QUI.forEach(function (q) {
        var b = el('button', 'seg-btn', q.nom);
        b.type = 'button'; b.id = idPrefix + c.id + '__qui_' + q.id;
        if (q.urgence) {
          var uAdd = critAddBadge((bandsOf(q.id)[0] || {}).add);
          if (uAdd) b.appendChild(uAdd);
        }
        b.addEventListener('click', function () {
          var cur = D.deplacementById(dsel.value);
          if (cur && cur.qui === q.id) return;
          // Land on the direction's cheapest band; the radius row refines.
          var first = bandsOf(q.id).slice().sort(function (a, z) { return a.add - z.add; })[0];
          if (first) depCommit(first.id);
        });
        quiRow.appendChild(b);
      });
      var paintDep = function () {
        var cur = D.deplacementById(dsel.value);
        var quiId = cur ? cur.qui : null;
        quiRow.querySelectorAll('.seg-btn').forEach(function (x, i) {
          var on = !!quiId && D.DEPLACEMENT_QUI[i].id === quiId;
          x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        clear(kmRow);
        var q = D.DEPLACEMENT_QUI.find(function (x) { return x.id === quiId; });
        kmRow.hidden = !q || q.urgence;
        if (kmRow.hidden) return;
        bandsOf(quiId).forEach(function (d) {
          var b = el('button', 'seg-btn', d.nomCourt);
          var add = critAddBadge(d.add);
          if (add) b.appendChild(add);
          b.type = 'button'; b.id = idPrefix + c.id + '__' + d.id;
          var on = dsel.value === d.id;
          b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.addEventListener('click', function () { depCommit(d.id); });
          kmRow.appendChild(b);
        });
      };
      dsel.addEventListener('change', function () {
        paintDep();
        settleSegTracks(row);
        onChange(dsel.value === '' ? undefined : dsel.value);
      });
      paintDep();
      if (c.aide) row.appendChild(el('span', 'help', c.aide));
    } else if (c.type === 'choice' && c.ui === 'select') {
      // A long option list (the lender catalogue) renders as a <select> — the
      // domain marks it `ui: 'select'`; chips would be a wall. The dollar
      // effect rides in the option text ("Tangerine (+100 $)") since a select
      // cannot carry the .crit-add badge.
      var selLbl = el('label', 'crit-label', c.label);
      selLbl.setAttribute('for', idPrefix + c.id);
      row.appendChild(selLbl);
      var sel = document.createElement('select');
      sel.id = idPrefix + c.id; sel.className = 'crit-select';
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = 'Choisir…';
      sel.appendChild(ph);
      (c.options || []).forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.id;
        var add = Number(opt.add) || 0;
        o.textContent = add ? opt.label + ' (+' + D.money(add) + ')' : opt.label;
        sel.appendChild(o);
      });
      if (current != null) sel.value = current;
      sel.addEventListener('change', function () { onChange(sel.value === '' ? undefined : sel.value); });
      row.appendChild(sel);
      enhanceSelect(sel);
      if (c.aide) row.appendChild(el('span', 'help', c.aide));
      // The free-text companion (« Autre prêteur » → « Nom du prêteur ») —
      // the client ADDS their lender by name when it is not in the catalogue.
      if (c.autre) {
        var obox = el('div', 'crit-other');
        var olbl = el('label', 'crit-label', c.autre.label);
        olbl.setAttribute('for', idPrefix + c.autre.champ);
        obox.appendChild(olbl);
        var oinp = document.createElement('input');
        oinp.type = 'text'; oinp.id = idPrefix + c.autre.champ; oinp.maxLength = 80;
        if (other && other.value != null) oinp.value = other.value;
        oinp.addEventListener('input', function () {
          if (other) other.onChange(oinp.value === '' ? undefined : oinp.value);
        });
        obox.appendChild(oinp);
        if (c.autre.aide) obox.appendChild(el('span', 'help', c.autre.aide));
        var syncOther = function () { obox.hidden = sel.value !== c.autre.option; };
        syncOther();
        sel.addEventListener('change', syncOther);
        row.appendChild(obox);
      }
    } else if (c.type === 'choice') {
      // Answers ride the SAME segmented-track register as the déplacement
      // bars — one selection language for the whole question block.
      row.appendChild(el('span', 'crit-label', c.label));
      var grp = el('div', 'seg crit-choices');
      grp.setAttribute('role', 'group');
      (c.options || []).forEach(function (opt) {
        var b = el('button', 'seg-btn', opt.label);
        var optAdd = critAddBadge(opt.add);
        if (optAdd) b.appendChild(optAdd);
        b.type = 'button';
        b.id = idPrefix + c.id + '__' + opt.id;
        var on = current === opt.id;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('is-on', on);
        b.addEventListener('click', function () {
          grp.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
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
      if (c.unit === '$') {
        // The unit rides beside the figure, like the offer's amount box.
        var uw = el('span', 'crit-unit-wrap');
        uw.appendChild(inp);
        uw.appendChild(el('span', 'crit-unit', '$'));
        row.appendChild(uw);
      } else {
        row.appendChild(inp);
      }
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
      return buildCriterionRow(c, state.offer.pricing[c.id], function (val) { setCriterion(c.id, val); }, 'crit-',
        c.autre ? { value: state.offer.pricing[c.autre.champ], onChange: function (val) { setCriterion(c.autre.champ, val); } } : null);
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
      // The folded rows only get real geometry once the expander opens.
      det.addEventListener('toggle', function () { settleSegTracks(det); });
    }
    settleSegTracks(box);
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
  // a manual choice is preserved), then re-validate — the adjusted floor is
  // visible live in #o-amount-min, no separate note needed.
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
    refreshTierPreview();
    // When an answer moves the offer, the figure changed OFF where the click
    // happened — one quiet pulse on the amount so the shift is seen, only for
    // criteria-driven moves (a hand on the slider needs no echo).
    var disp = $('o-amount-display');
    var before = disp ? disp.textContent : '';
    onAmountChange();
    if (disp && disp.textContent !== before) {
      disp.classList.remove('flash');
      void disp.offsetWidth;
      disp.classList.add('flash');
    }
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
    // Conversion defaults (domain `defaut`): the dominant zero-cost answer
    // arrives pre-declared, so the client only touches what genuinely varies.
    // A dossier answer always wins; the write goes through the dossier so the
    // Dossier page shows the same declared answer.
    if (svc) {
      ((svc.pricing && svc.pricing.criteria) || []).forEach(function (c) {
        if (c.defaut != null && state.offer.pricing[c.id] == null) {
          state.offer.pricing[c.id] = c.defaut;
          dossierSetPricing(svc.id, c.id, c.defaut);
        }
      });
    }
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
    refreshTierPreview();
    onAmountChange();
  }

  // The tier preview's dollar band is a function of BOTH the date (the tier)
  // and the current act's dynamic base (the client's answers included). It must
  // refresh whenever either input moves — a date-only refresh kept quoting the
  // previous act's floor after a switch to another act or a new answer.
  function refreshTierPreview() {
    var tp = $('tier-preview');
    if (!tp) return;
    var date = state.offer.dateISO;
    if (D.isISODate(date)) {
      var days = D.daysBetween(todayISO(), date);
      var t = D.tierById(D.tierForDays(Math.max(0, days)));
      tp.hidden = false;
      var pill = $('tp-pill'); pill.textContent = tierName(t); pill.dataset.tier = t.id;
      var when = days <= 0 ? 'aujourd’hui' : ('dans ' + days + ' jour' + (days > 1 ? 's' : ''));
      // A dollar range, for THIS act at THIS notice — never a multiple. The
      // standard tier is a single point (1×–1×): quote ONE figure, because
      // « entre 2 150 $ et 2 150 $ » reads as a bug on the most common date.
      var baseTp = currentBase();
      var lowTp = D.money(Math.round(baseTp * t.apercuMin));
      var highTp = D.money(Math.round(baseTp * t.apercuMax));
      $('tp-text').textContent = 'Signature ' + when + ' · à ce délai, les offres se concluent ' +
        (lowTp === highTp ? 'autour de ' + lowTp : 'entre ' + lowTp + ' et ' + highTp) + '.';
    } else { tp.hidden = true; }
  }

  function onOfferDateChange() {
    var date = $('o-date').value;
    state.offer.dateISO = date;
    refreshTierPreview();
    if (D.isISODate(date)) {
      // Re-tune the pre-filled amount to this date's tier.
      var rec = D.recommendedAmount(state.offer.serviceId, date, todayISO(), state.offer.pricing, state.monthBids);
      if (rec != null) $('o-amount').value = rec;
    }
    onAmountChange();
  }

  // The slider and the number box are one control: typing a figure moves the
  // slider (clamped to its bounds), dragging updates the figure.
  function onAmountInputTyped() {
    var num = $('o-amount-input'), amt = $('o-amount');
    if (!num || !amt || amt.disabled) return;
    var v = Number(num.value);
    if (!Number.isFinite(v)) return;
    var min = Number(amt.min), max = Number(amt.max);
    amt.value = Math.min(max, Math.max(min, v));
    onAmountChange();
  }
  function syncAmountBounds(svc) {
    var amt = $('o-amount');
    var minEl = $('o-amount-min'), maxEl = $('o-amount-max'), num = $('o-amount-input');
    if (minEl) minEl.textContent = svc ? D.money(Number(amt.min)) : '—';
    if (maxEl) maxEl.textContent = svc ? D.money(Number(amt.max)) : '—';
    if (num) {
      num.disabled = !svc;
      num.min = amt.min; num.max = amt.max; num.step = amt.step;
      if (document.activeElement !== num) num.value = svc ? String(Number(amt.value)) : '';
    }
  }

  function onAmountChange() {
    var svc = D.serviceById(state.offer.serviceId);
    var amt = Number($('o-amount').value);
    state.offer.montant = amt;
    $('o-amount-display').textContent = svc ? D.money(amt) : '—';
    syncAmountBounds(svc);

    if (svc && amt) {
      // Screen readers otherwise announce the raw slider number (e.g. "2000");
      // aria-valuetext gives the formatted amount ("2 000 $").
      $('o-amount').setAttribute('aria-valuetext', D.money(amt));
      var mult = amt / currentBase();
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
      $('gauge-fill').style.width = '0%';
      $('gauge-label').textContent = 'Choisissez une date et un montant.';
    }
    renderDevis();
    updateBeatUI();
    validateOfferUI();
  }

  /**
   * LE DEVIS — ce que le client paiera vraiment, avant qu'il ne s'engage.
   *
   * L'autorisation portée à la carte est le TOTAL de deux lignes : les
   * honoraires offerts au notaire, qui lui reviennent en entier, et le prix du
   * service de Nota (ADR 0031). Tant que la seconde n'était affichée nulle
   * part, le client la découvrait sur la page de paiement — l'art. 68 du Code
   * de déontologie interdit la publicité « incomplète », et une omission au
   * moment du paiement en est le cas d'école.
   *
   * Deux lignes, jamais un partage : Nota ne prélève rien sur les honoraires
   * du notaire (art. 32 C.déont., art. 32.1 2° L.N.). La formulation compte
   * autant que le chiffre.
   *
   * La note finale existe parce que l'art. 71 3° oblige quiconque annonce des
   * honoraires à indiquer si les débours et les taxes sont ou non inclus. Elle
   * est écrite depuis les drapeaux du serveur, pas depuis une opinion : le jour
   * où les taxes seront calculées, la phrase changera d'elle-même.
   */
  // Nota's service price in dollars, from the tarif the API served — null
  // while unknown (offline, fixtures): the copy then says a fixed price is
  // added without ever inventing the amount (art. 68 C.déont.).
  function prixNotaDollars() {
    var t = store.tarif;
    return t && typeof t.prixNotaCents === 'number' ? Math.round(t.prixNotaCents) / 100 : null;
  }

  // The hero's price line — the two-line truth of ADR 0031, at the exact
  // moment of conversion: the notary keeps the whole offer, and Nota's own
  // service is paid at signing. Quotes the served price; never a literal.
  function renderHeroPrice() {
    var line = $('hero-price-line'); if (!line) return;
    var prix = prixNotaDollars();
    line.textContent = prix != null
      ? 'Le notaire reçoit 100 % de votre offre ; le service Nota, ' + D.money(prix) + ', se paie seulement à la signature.'
      : 'Le notaire reçoit 100 % de votre offre ; le service Nota, à prix fixe, se paie seulement à la signature.';
  }

  function renderDevis() {
    var box = $('offer-devis');
    if (!box) return;
    var svc = D.serviceById(state.offer.serviceId);
    var honoraires = Number(state.offer.montant) || 0;
    if (!svc || !honoraires) { box.hidden = true; return; }
    box.hidden = false;

    var tarif = store.tarif;
    var prix = prixNotaDollars();
    $('devis-hon').textContent = D.money(honoraires);
    $('devis-nota').textContent = prix != null ? D.money(prix) : '—';
    $('devis-total').textContent = prix != null ? D.money(honoraires + prix) : '—';

    // Chaque phrase est son PROPRE noeud de texte : la couche i18n traduit par
    // correspondance exacte, et une phrase concaténée avec ses voisines ne se
    // retrouverait dans aucun dictionnaire.
    var note = [];
    if (prix == null) {
      // Hors ligne, le carnet vient des fixtures : le montant du service de
      // Nota est inconnu, et le taire vaut mieux que l'inventer.
      note.push('Le prix du service de Nota s’ajoute à ce montant ; il vous est confirmé avant tout paiement.');
    }
    if (!tarif || !tarif.taxesIncluses) note.push('Taxes en sus.');
    if (!tarif || !tarif.deboursInclus) note.push('Débours en sus (droits de publication, RDPRM).');
    var box2 = $('devis-note');
    box2.textContent = '';
    note.forEach(function (phrase, i) {
      if (i) box2.appendChild(document.createTextNode(' '));
      box2.appendChild(el('span', '', phrase));
    });
  }

  function acceptance(mult, tierId) {
    var t = D.tierById(tierId) || D.tierById('standard');
    var top = t.apercuMax * 1.25;
    var pct = Math.max(4, Math.min(100, ((mult - 1) / (top - 1)) * 100));
    var label;
    // Three plain states a client can act on, not a market lecture.
    if (mult < t.apercuMin) label = 'Trop bas : peu de chances';
    else if (mult <= t.apercuMax) label = 'Dans la norme';
    else label = 'Généreux : retenue vite';
    return { pct: pct, label: label };
  }

  function validateOfferUI() {
    var o = state.offer;
    var courriel = ($('o-courriel') && $('o-courriel').value || '').trim();
    // The account opt-in follows its courriel: inert without a valid one, and a
    // cleared field also clears the opt-in — a bid can never sign up blindly.
    var acct = $('o-account');
    if (acct) {
      acct.disabled = !D.isEmail(courriel);
      if (acct.disabled) acct.checked = false;
    }
    // Raw field value: validateOffer owns the normalization (domain rule).
    var v = D.validateOffer({ serviceId: o.serviceId, dateISO: o.dateISO, montant: o.montant, courriel: courriel, prefixe: $('o-prefix') && $('o-prefix').value, pricing: o.pricing, todayISO: todayISO() });
    // ADR 0033 — the mise en relation is complete: the retaining notary must
    // be able to name, write to and call the client. The name and the courriel
    // are required HERE (the API keeps `courriel` optional for older callers);
    // the téléphone is recommended, but a malformed one is refused.
    var nomDue = !(($('o-name') && $('o-name').value) || '').trim();
    var courrielDue = !courriel || !D.isEmail(courriel);
    var telV = D.validateTelephone(($('o-telephone') && $('o-telephone').value) || '');
    var s = $('offer-submit');
    // Editing after a publish resets the CTA out of its success/busy state.
    if (!s.getAttribute('aria-busy') && s.textContent.trim() !== 'Publier mon offre') {
      s.textContent = 'Publier mon offre';
      var succ = $('offer-success'); if (succ) succ.hidden = true;
    }
    s.disabled = !v.ok || nomDue || courrielDue || !telV.ok;
    // A dead button must say why. The notary's required questions are the one
    // thing a client can fix from inside the form — name them, right here,
    // each name a door that jumps back to its question.
    var hint = $('offer-hint');
    if (hint) {
      var svc = D.serviceById(o.serviceId);
      // T() each label: the line is composed at runtime, so the i18n DOM pass
      // can only translate its prefix — the labels must arrive already in the
      // interface language.
      var missing = (v.errors || []).filter(function (e) { return e.code === 'parametre_requis'; }).map(function (e) {
        // A param is either a criterion or a criterion's free-text companion
        // (« Autre prêteur » → « Nom du prêteur »).
        var c = svc && svc.pricing && (svc.pricing.criteria || []).filter(function (x) { return x.id === e.param || (x.autre && x.autre.champ === e.param); })[0];
        if (!c) return { critId: e.param, label: e.param };
        return { critId: c.id, label: T(c.id === e.param ? c.label : c.autre.label) };
      });
      // The REQUIRED postal sector joins the same hint: one line names
      // everything still blocking the publish, and each entry carries its own
      // door — a focus callback — so the loop stays free of special cases.
      var due = missing.map(function (m) {
        return { label: m.label, focus: function () { focusCriterionRow(m.critId); } };
      });
      var prefixeDue = (v.errors || []).some(function (e) { return e.code === 'prefixe_requis' || e.code === 'prefixe_invalide'; });
      if (prefixeDue) due.push({ label: T('Secteur postal'), focus: focusPrefixField });
      // The identity the notary needs (ADR 0033), each with its own door.
      if (nomDue) due.push({ label: T('Votre nom'), focus: focusIdentityField('o-name') });
      if (courrielDue) due.push({ label: T('Votre courriel'), focus: focusIdentityField('o-courriel') });
      if (!telV.ok) due.push({ label: T('Votre téléphone'), focus: focusIdentityField('o-telephone') });
      hint.hidden = !due.length;
      clear(hint);
      if (due.length) {
        // « Répondez à » while the notary's questions are open; once only the
        // identity or the sector is left, the plain « Il manque ».
        hint.appendChild(document.createTextNode(missing.length ? 'Répondez à : ' : 'Il manque : '));
        due.forEach(function (m, i) {
          if (i) hint.appendChild(document.createTextNode(' · '));
          var b = el('button', 'offer-hint-link', m.label);
          b.type = 'button';
          b.addEventListener('click', m.focus);
          hint.appendChild(b);
        });
      }
      // The same list, marked WHERE the questions live: a quiet dot on each
      // awaited answer, and a live tally on the step header — so step 2 says
      // on its own how far the offer is from publishable.
      var awaited = {};
      missing.forEach(function (m) { awaited[m.critId] = true; });
      Array.prototype.forEach.call(document.querySelectorAll('#o-criteria .crit-row[data-crit]'), function (row) {
        row.classList.toggle('crit-missing', !!awaited[row.dataset.crit]);
      });
      var count = $('o-criteria-count');
      if (count) {
        var n = missing.length;
        count.hidden = !svc;
        count.dataset.state = n ? 'due' : 'done';
        count.textContent = n === 0 ? '✓ complet' : n === 1 ? '1 réponse attendue' : n + ' réponses attendues';
      }
    }
    return v;
  }

  // Jump from the hint's door to the question itself: unfold its expander if
  // it hides there, bring the row into view, hand focus to its first control,
  // and flash the row once so the eye lands on the right line.
  function focusCriterionRow(critId) {
    var row = document.querySelector('#o-criteria .crit-row[data-crit="' + critId + '"]');
    if (!row) return;
    var det = row.closest('details');
    if (det) det.open = true;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var target = row.querySelector('input:not(.visually-hidden), .nselect-btn, .seg-btn');
    if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
    row.classList.remove('crit-attn');
    void row.offsetWidth; // restart the animation on a repeated click
    row.classList.add('crit-attn');
  }

  // The hint's door to the REQUIRED postal sector: bring the field into view,
  // hand it focus, and let its own preview line explain the format.
  function focusPrefixField() {
    var inp = $('o-prefix'); if (!inp) return;
    if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
  }

  // The postal prefix is the one piece of location a bid publishes — REQUIRED
  // (domain: prefixe_requis), since it anchors the déplacement band to a real
  // sector. The field normalizes as you type (domain-owned format) and
  // previews the exact public string; while incomplete, the submit gate and
  // its hint carry the requirement, so the preview stays calm.
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
    // ADR 0033 — the switch governs the PUBLIC carnet only. The name row
    // stays visible either way: it is what the retaining notary receives.
    $('anon-help').textContent = anon
      ? 'Affichée comme « Client · secteur postal ». Votre nom reste transmis au notaire qui vous retient.'
      : 'Votre nom sera visible publiquement sur le carnet.';
  }

  // The téléphone is recommended, never required — but a number that cannot
  // be dialled is worse than none (the notary would call into the void). The
  // domain owns the rule; the field shows its verdict under itself, and the
  // submit gate (validateOfferUI) refuses an invalid one.
  function onTelephoneInput() {
    var inp = $('o-telephone'); var prev = $('o-telephone-preview');
    if (inp && prev) {
      var v = D.validateTelephone(inp.value);
      clear(prev);
      if (!v.ok) { prev.dataset.state = 'warn'; prev.textContent = v.error.message; }
      else if (v.value) { prev.dataset.state = 'ok'; prev.textContent = 'Le notaire qui vous retient pourra vous appeler.'; }
      else prev.removeAttribute('data-state');
    }
    validateOfferUI();
  }
  // The hint's doors to the identity fields: bring the field into view and
  // hand it focus, exactly like the postal sector's door.
  function focusIdentityField(id) {
    return function () {
      var inp = $(id); if (!inp) return;
      if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
    };
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
      // ADR 0033 — ALWAYS sent: anonymity governs the public carnet (the API
      // withholds the name there); the retaining notary receives it.
      nom: ($('o-name').value || '').trim(),
      prefixe: ($('o-prefix').value || '').trim().toUpperCase().slice(0, 3),
      // Private: notifications, and the mise en relation. Never on the carnet.
      courriel: ($('o-courriel').value || '').trim(),
      // Private too (ADR 0010 §4): handed only to the notary who retains the
      // demand, for the mise en relation. Never on the public carnet.
      telephone: ($('o-telephone') && $('o-telephone').value || '').trim(),
    };
    // Private referral attribution (ADR 0011): the visible « Code de
    // référence » field is the single source — pre-filled from a captured
    // ?ref=CODE link, typed from a spoken referral otherwise. An empty field
    // is an explicit "no code"; an invalid one is dropped, never blocking.
    // Stored privately by the API on the bid; never rendered anywhere public.
    var refInp = $('o-parrain');
    var typedRef = refInp ? refInp.value.trim() : '';
    var parrain = refInp
      ? (D.isReferralCode(typedRef) ? D.normalizeReferralCode(typedRef) : null)
      : referralCode();
    if (parrain) { payload.parrain = parrain; flagSet(LS_REF, parrain); }
    // Attach the structured dossier snapshot the client assembled for THIS
    // service (field values + document filenames + consent), so an accepting
    // notary sees real data. Stored privately by the API; never in publicBid().
    // The files themselves are not sent here — only the values already saved.
    var snapshot = dossierWire(o.serviceId);
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
    // The discreet account opt-in (checked + valid courriel only): the same
    // passwordless signup as the auth modal, riding along with the publish.
    var wantsAccount = !!($('o-account') && $('o-account').checked) && D.isEmail(payload.courriel);
    if (res.checkoutUrl) {
      submit.removeAttribute('aria-busy'); submit.textContent = 'Redirection vers le paiement…';
      profileSet({ courriel: payload.courriel, telephone: payload.telephone, prefixe: payload.prefixe, nom: payload.nom || '', anonyme: payload.anonyme });
      if (wantsAccount) clientWelcome(payload.courriel);
      addMyOffer(res.bid, res.clientToken);
      renderAccountMenu(); // an offer with a courriel signs the client in on this device
      window.location.href = res.checkoutUrl;
      return;
    }
    submit.removeAttribute('aria-busy'); submit.textContent = 'Offre publiée ✓'; // stays disabled → no duplicate submit
    toast('Offre publiée : ' + D.money(payload.montant) + (store.online ? '' : ' (démo locale)'));
    buildCalendarLinks(res.bid);
    showOfferSuccess(); // states, when offline, that nothing was actually published
    // The dossier is what makes this lead sellable — show its real progress here
    // and give a one-tap path to finish it for THIS service.
    fillDossierNext(res.bid.serviceId);
    // Remember the client's coordinates in their profile for next time — an offer
    // that carries an email implicitly signs the client in on this device.
    profileSet({ courriel: payload.courriel, telephone: payload.telephone, prefixe: payload.prefixe, nom: payload.nom || '', anonyme: payload.anonyme });
    if (wantsAccount) clientWelcome(payload.courriel);
    // Track this offer BEFORE repainting the menu: with a courriel the device
    // is now signed in as a client and the account bell appears.
    addMyOffer(res.bid, res.clientToken);
    renderAccountMenu();
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
  var IC_PARR = '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>';
  function profilHead(iconPaths, title, sub) {
    var head = el('div', 'profil-card-head');
    var ic = el('span', 'profil-card-ic');
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths + '</svg>';
    head.appendChild(ic);
    head.appendChild(el('h2', 'profil-card-title', title));
    // The section's one-line caption rides the head row instead of costing its
    // own line under it — it wraps below the title only when the width runs
    // out. It keeps the .help voice (and stays findable as the card's help).
    if (sub) head.appendChild(el('p', 'profil-card-sub help', sub));
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
      tr.appendChild(el('td', 'c-acte', r.o.serviceId ? svcName(r.o.serviceId) : 'Votre demande'));

      // The date is a door: it opens that day on the carnet (the offer in its
      // market, and the form to post another one).
      var dcell = el('td', 'c-date');
      var dayBtn = el('button', 'my-offer-day link-btn', dayShort(r.o.dateISO));
      dayBtn.type = 'button';
      dayBtn.setAttribute('aria-label', 'Voir le ' + dayTitle(r.o.dateISO) + ' au carnet');
      dayBtn.addEventListener('click', function () { toggleNotifPanel(false); setTab('carnet'); openDay(r.o.dateISO); });
      dcell.appendChild(dayBtn);
      dcell.appendChild(el('span', 'my-offer-rel', relativeDay(r.o.dateISO)));
      tr.appendChild(dcell);

      // An entry born from a deep link may not know its amount yet.
      tr.appendChild(el('td', 'c-montant', r.o.montant != null ? D.money(r.o.montant) : '—'));

      var scell = el('td', 'c-statut');
      var pill = el('span', 'my-offer-status', offerStatusLabel(r.o, r.st));
      pill.dataset.status = r.st;
      scell.appendChild(pill);
      // Unread notary messages (ADR 0033), beside the status; a door to the
      // band, cleared once the thread is seen.
      var un = unreadCount(r.o.id);
      var ub = el('button', 'my-offer-unread', un ? unreadLabel(un) : '');
      ub.type = 'button'; ub.dataset.for = r.o.id; ub.hidden = un === 0;
      ub.addEventListener('click', function () { openOfferBand(r.o.id); });
      scell.appendChild(ub);
      tr.appendChild(scell);
      body.appendChild(tr);

      // Under the row: what happens next, the agenda link, and whatever a
      // notary sent back (a proposition to answer, documents to provide).
      var dtr = el('tr', 'my-offer-detail');
      dtr.dataset.for = r.o.id;
      var dtd = el('td', 'my-offer-detail-cell'); dtd.colSpan = 4;
      dtr.appendChild(dtd);
      body.appendChild(dtr);
      fillMyOfferDetail(dtd, r.o, r.st, offerStatusGet(r.o.id));
    });
    table.appendChild(body);
    return table;
  }

  // Paint (or repaint, once the API answered) the detail band of one offer.
  // A map pin for the étude's address — drawn here so the shared MINI_ICONS
  // table stays untouched by this band.
  function pinIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>';
    return svg;
  }

  // The « Votre notaire » card (ADR 0033): everything the client needs to
  // reach and find the notary who retained them — name and étude, a tel:
  // link, the étude's address as a maps search, mailto, the Chambre fiche
  // (ADR 0016), the acts count. Facts only, never an appreciation of the
  // notary (art. 70 — ADR 0030): no star, no average, no cote.
  function notaireCard(noti) {
    var card = el('div', 'my-offer-contact');
    card.appendChild(el('div', 'my-offer-contact-h', 'Votre notaire'));
    var name = el('div', 'my-offer-contact-name');
    var nom = String(noti.nom || '').trim(), etude = String(noti.etude || '').trim();
    if (nom) name.appendChild(el('strong', null, nom));
    if (etude && etude !== nom) {
      if (nom) name.appendChild(document.createTextNode(' · '));
      name.appendChild(el(nom ? 'span' : 'strong', 'my-offer-contact-etude', etude));
    }
    if (!nom && !etude) name.appendChild(el('strong', null, 'Votre notaire'));
    // The roll of the Chambre, and the acts they have carried on Nota.
    if (noti.cnq || noti.lienCNQ) { name.appendChild(document.createTextNode(' ')); name.appendChild(cnqBadge(true)); }
    var nactes = actsFact(noti.actes);
    if (nactes) { name.appendChild(document.createTextNode(' ')); name.appendChild(nactes); }
    card.appendChild(name);
    var rows = el('div', 'my-offer-contact-rows');
    var tel = D.telHref(noti.telephone);
    if (tel) {
      var call = el('a', 'my-offer-contact-row my-offer-contact-tel');
      call.href = tel;
      call.title = 'Appeler ' + String(noti.telephone).trim();
      call.appendChild(miniIcon('telephone'));
      call.appendChild(el('span', null, String(noti.telephone).trim()));
      rows.appendChild(call);
    }
    if (noti.courriel) {
      var mail = el('a', 'my-offer-contact-row my-offer-contact-mail');
      mail.href = 'mailto:' + noti.courriel;
      mail.title = 'Écrire à ' + noti.courriel;
      mail.appendChild(miniIcon('courriel'));
      mail.appendChild(el('span', null, noti.courriel));
      rows.appendChild(mail);
    }
    if (noti.adresse) {
      var adresse = String(noti.adresse).trim();
      var addr = el('a', 'my-offer-contact-row my-offer-contact-addr');
      addr.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse);
      addr.target = '_blank'; addr.setAttribute('rel', 'noopener');
      addr.title = 'Ouvrir l’adresse dans Google Maps';
      addr.appendChild(pinIcon());
      addr.appendChild(el('span', null, adresse + ' ↗'));
      rows.appendChild(addr);
    }
    // Labelled as the ACT of verifying, not as a decoration: Nota confirmed
    // nothing — the Chambre's own page is the authority.
    if (noti.lienCNQ) {
      var fiche = el('a', 'my-offer-contact-row cnq-link', 'Vérifier sa fiche à la Chambre ↗');
      fiche.href = noti.lienCNQ;
      fiche.target = '_blank';
      fiche.setAttribute('rel', 'noopener');
      fiche.setAttribute('title', 'Ouvre la fiche déclarée par ce notaire dans l’annuaire de la Chambre des notaires du Québec.');
      rows.appendChild(fiche);
    }
    if (rows.childNodes.length) card.appendChild(rows);
    return card;
  }

  function fillMyOfferDetail(cell, o, st, status) {
    clear(cell);
    // Is any notary named in this band? The « says who? » line is owed exactly
    // when one is — and exactly once, however many propositions there are.
    var named = false;
    var noti = status && status.notaire;
    var next = el('div', 'my-offer-next');
    next.appendChild(el('span', 'my-offer-next-k', 'Prochaine étape'));
    next.appendChild(el('span', 'my-offer-next-v', offerNextStep(o, st, status)));
    // Mise en relation, complete (ADR 0033): a RETAINED offer leads with the
    // notary the client can now call, write to and find — the card FIRST,
    // then the next step, then the conversation.
    if (st === 'approved' && noti && (noti.nom || noti.etude || noti.courriel || noti.telephone)) {
      named = true;
      cell.appendChild(notaireCard(noti));
    }
    cell.appendChild(next);
    // The act is signed and settled (ADR 0015): the client's last gesture is
    // the evaluation — five stars, an optional word. One per act; once sent,
    // the block shows what was said and thanks them.
    if (st === 'approved' && status && status.acte && status.acte.complete) {
      cell.appendChild(evaluationBlock(o, status));
    }
    // The retained-act conversation: once a notary holds the act, the two
    // parties talk here — instructions, dates, the details that decide whether
    // the file holds. Refreshed on focus/tab switches and after every send.
    if (st === 'approved' && o.clientToken) {
      var chat = el('div', 'my-offer-chat chat'); chat.dataset.id = o.id;
      chat.appendChild(el('div', 'my-offer-chat-h', 'Messages avec votre notaire'));
      chat.appendChild(chatThread((status && status.messages) || [], 'client'));
      // The shared composer (ADR 0033); focusing it means the thread is read.
      var composer = chatComposer({
        placeholder: 'Écrire à votre notaire…', ariaLabel: 'Écrire à votre notaire', sendClass: 'client-chat-send',
        onSend: function (texte) { return clientChatSend(o, texte); },
        onFocus: function () { markOfferSeen(o.id); },
      });
      chat.appendChild(composer.el);
      // Seen the moment the thread is actually on screen, where the browser
      // can tell (jsdom cannot — the composer's focus and the bell entry remain).
      if (typeof window.IntersectionObserver === 'function') {
        try {
          var thread = chat.querySelector('.chat-thread');
          var io = new window.IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting && !document.hidden) { markOfferSeen(o.id); io.disconnect(); }
            });
          }, { threshold: 0.5 });
          if (thread) io.observe(thread);
        } catch (e) { /* no observer, no harm */ }
      }
      // Les documents, sous le fil : ce que l'un envoie, l'autre le lit au même
      // endroit. Un document n'est pas un événement de second rang qu'on
      // découvrirait en rouvrant la page.
      chat.appendChild(documentsBlock({
        id: o.id,
        dateISO: o.dateISO,
        routes: { depot: '/client/bid/documents', confirme: '/client/bid/documents/confirme', lecture: '/client/bid/documents' },
        appel: async function (method, route, body) {
          var r;
          try {
            r = await fetch(API_BASE + route, {
              method: method,
              headers: body
                ? { 'content-type': 'application/json', authorization: 'Bearer ' + o.clientToken }
                : { authorization: 'Bearer ' + o.clientToken },
              body: body ? JSON.stringify(body) : undefined,
            });
          } catch (e) { return { ok: false, message: 'Hors ligne.' }; }
          var j = {}; try { j = await r.json(); } catch (e) {}
          if (!r.ok) return { ok: false, message: (j.errors && j.errors[0] && j.errors[0].message) || 'Action impossible.' };
          return { ok: true, json: j };
        },
      }, (status && status.documents) || [], function () {
        // Relire l'état de l'offre : le document doit apparaître dans le fil, du
        // même mouvement qu'un message envoyé.
        fetchOfferStatus(o).then(function () { repaintOfferBand(o); });
      }));
      cell.appendChild(chat);
    }

    var acts = el('div', 'my-offer-actions');
    // (An entry born from a deep link has no act to put on an agenda until
    // the API answers.)
    if (st !== 'expired' && st !== 'cancelled' && o.serviceId && o.montant != null) {
      var links = calendarLinks(o);
      var cal = el('a', 'btn btn-sm my-offer-agenda', 'Agenda');
      cal.href = links.gcal; cal.target = '_blank'; cal.rel = 'noopener';
      cal.title = 'Ajouter la date à Google Agenda';
      acts.appendChild(cal);
      var ics = el('a', 'btn btn-sm my-offer-ics', '.ics');
      ics.href = links.ics; ics.setAttribute('download', 'offre-nota.ics');
      ics.title = 'Télécharger le fichier .ics (Outlook, Apple)';
      acts.appendChild(ics);
    }
    if (st === 'pending') {
      var dos = el('button', 'btn btn-sm', 'Mon dossier'); dos.type = 'button';
      dos.addEventListener('click', function () { toggleNotifPanel(false); openDossier(o.serviceId); });
      acts.appendChild(dos);
    }
    // Withdrawal — open or retained alike ("annuler une offre déjà acceptée"
    // is precisely the case that must not dead-end). The confirm dialog says
    // what it means; a token is required to talk to the API about it.
    if ((st === 'pending' || st === 'approved') && o.clientToken) {
      var cnl = el('button', 'btn btn-sm btn-offer-cancel', 'Annuler cette offre'); cnl.type = 'button';
      cnl.addEventListener('click', function () { toggleNotifPanel(false); openCancelDialog(o, st); });
      acts.appendChild(cnl);
    }
    // The human door, prefilled with this offer's context.
    var aide = el('button', 'link-btn my-offer-help', 'Besoin d’aide ?'); aide.type = 'button';
    aide.addEventListener('click', function () { toggleNotifPanel(false); openContactDialog({ offer: o }); });
    acts.appendChild(aide);
    if (acts.childNodes.length) cell.appendChild(acts);
    if (!status) return;

    status.propositions.forEach(function (p) {
      var block = el('div', 'my-offer-prop');
      block.dataset.propId = p.id;
      block.dataset.status = p.status;
      named = true;
      var head = el('div', 'my-offer-prop-text');
      var delta = Number(p.delta != null ? p.delta : (p.montant - o.montant));
      head.appendChild(el('strong', null, 'Un notaire' + (p.etude ? ' (' + p.etude + ')' : '') + ' vous propose ' + D.money(p.montant)));
      // The two facts a client may weigh a stranger's price with — membership
      // of the Chambre, and acts carried on Nota. Nothing evaluative (art. 70).
      if (p.cnq) { head.appendChild(document.createTextNode(' ')); head.appendChild(cnqBadge()); }
      var pactes = actsFact(p.actes);
      if (pactes) { head.appendChild(document.createTextNode(' ')); head.appendChild(pactes); }
      head.appendChild(document.createTextNode(' (' + (delta >= 0 ? '+' : '−') + D.money(Math.abs(delta)) + ')'));
      block.appendChild(head);
      if (p.message) block.appendChild(el('p', 'my-offer-prop-msg', p.message));
      if (p.status === 'en_attente' && st !== 'expired' && st !== 'cancelled') {
        var row = el('div', 'my-offer-prop-actions');
        var ok = el('button', 'btn btn-primary btn-sm btn-prop-accept', 'Accepter ' + D.money(p.montant)); ok.type = 'button';
        var no = el('button', 'btn btn-sm btn-prop-decline', 'Refuser'); no.type = 'button';
        ok.addEventListener('click', function () { answerProposition(o, p, 'accept', block); });
        no.addEventListener('click', function () { answerProposition(o, p, 'decline', block); });
        row.appendChild(ok); row.appendChild(no);
        block.appendChild(row);
      } else {
        block.appendChild(el('div', 'my-offer-prop-state', p.status === 'acceptee' ? '✓ Acceptée' : p.status === 'refusee' ? 'Refusée' : 'Close'));
      }
      cell.appendChild(block);
    });

    status.demandes.forEach(function (d) {
      var block = el('div', 'my-offer-demande');
      block.dataset.demandeId = d.id;
      block.dataset.fournie = d.fournie ? 'true' : 'false';
      var names = (d.documents || []).map(function (x) { return T(x.nom); }).join(', ');
      var head = el('div', 'my-offer-prop-text');
      head.appendChild(el('strong', null, 'Le notaire demande : '));
      head.appendChild(document.createTextNode(names));
      block.appendChild(head);
      if (d.message) block.appendChild(el('p', 'my-offer-prop-msg', d.message));
      if (d.fournie) {
        block.appendChild(el('div', 'my-offer-prop-state is-done', '✓ Transmis'));
      } else {
        var row = el('div', 'my-offer-prop-actions');
        var go = el('button', 'btn btn-primary btn-sm btn-demande-dossier', 'Compléter mon dossier'); go.type = 'button';
        go.addEventListener('click', function () { toggleNotifPanel(false); openDossier(o.serviceId); });
        row.appendChild(go);
        block.appendChild(row);
      }
      cell.appendChild(block);
    });

    // Said once, at the foot of the band: what Nota shows about a notary is a
    // declaration and a count, and the Chambre is where it can be checked.
    if (named) cell.appendChild(cnqAnnuaireLink());
  }

  // The evaluation block under a signed act: five star buttons (radio-like,
  // aria-pressed), an optional comment, one submit. Already evaluated → a
  // read-only echo of the note. POSTs /client/evaluation with the bid token.
  function evaluationBlock(o, status) {
    var box = el('div', 'my-offer-eval');
    if (status.evaluation) {
      var done = el('div', 'my-offer-eval-done');
      done.appendChild(el('strong', null, 'Votre évaluation : ' + '★'.repeat(status.evaluation.note) + '☆'.repeat(5 - status.evaluation.note)));
      done.appendChild(el('span', 'help', ' Merci — elle aide les prochains clients.'));
      box.appendChild(done);
      return box;
    }
    box.appendChild(el('strong', 'my-offer-eval-t', 'Acte signé — évaluez votre notaire'));
    var stars = el('div', 'eval-stars');
    stars.setAttribute('role', 'group');
    stars.setAttribute('aria-label', 'Note de 1 à 5');
    var picked = 0;
    var btns = [];
    function paint() {
      btns.forEach(function (b, i) {
        b.textContent = i < picked ? '★' : '☆';
        b.setAttribute('aria-pressed', i < picked ? 'true' : 'false');
      });
      submit.disabled = picked === 0;
    }
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = el('button', 'eval-star', '☆');
        b.type = 'button';
        b.setAttribute('aria-label', n + ' étoile' + (n > 1 ? 's' : ''));
        b.addEventListener('click', function () { picked = n; paint(); });
        btns.push(b); stars.appendChild(b);
      })(i);
    }
    box.appendChild(stars);
    var comment = el('textarea', 'eval-comment');
    comment.rows = 2; comment.maxLength = D.EVALUATION_COMMENT_MAX;
    comment.placeholder = 'Un mot sur votre expérience (optionnel)';
    box.appendChild(comment);
    var submit = el('button', 'btn btn-primary btn-sm eval-submit', 'Envoyer mon évaluation');
    submit.type = 'button'; submit.disabled = true;
    submit.addEventListener('click', function () {
      submit.disabled = true; submit.setAttribute('aria-busy', 'true');
      fetch(API_BASE + '/client/evaluation', {
        method: 'POST', headers: clientHeaders(o, true),
        body: JSON.stringify({ id: o.id, dateISO: o.dateISO, note: picked, commentaire: comment.value }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (j) {
        var st2 = offerStatusGet(o.id) || {};
        st2.evaluation = j.evaluation;
        offerStatusSet(o.id, st2);
        toast('Merci ! Votre évaluation est enregistrée.');
        if (state.tab === 'profil') renderProfil();
      }).catch(function () {
        submit.disabled = false; submit.removeAttribute('aria-busy');
        toast('Impossible d’enregistrer l’évaluation. Réessayez.');
      });
    });
    box.appendChild(submit);
    paint();
    return box;
  }

  // Accept / decline a notary's proposition. Accepting retains the offer at
  // the proposed amount — the client's entry is updated so every surface
  // (table, bell, account menu) agrees at once.
  async function answerProposition(o, p, verb, block) {
    var btns = block.querySelectorAll('button');
    btns.forEach(function (b) { b.disabled = true; });
    var res;
    try { res = await clientPropositionReply(o, p.id, verb); } catch (e) { res = { ok: false, status: 0, body: {} }; }
    if (!res.ok) {
      btns.forEach(function (b) { b.disabled = false; });
      var code = res.body && res.body.errors && res.body.errors[0] && res.body.errors[0].code;
      toast(code === 'deja_retenue' ? 'Votre demande est déjà retenue par un autre notaire.'
        : code === 'proposition_close' ? 'Cette proposition n’est plus ouverte.'
        : res.status === 0 ? 'Hors ligne. Réessayez une fois en ligne.' : 'Erreur serveur. Réessayez.');
      if (code === 'deja_retenue' || code === 'proposition_close') fetchOfferStatus(o).then(function () { if (state.tab === 'profil') renderProfil(); });
      return;
    }
    var st = offerStatusGet(o.id) || { propositions: [], demandes: [] };
    st.propositions = (st.propositions || []).map(function (x) {
      if (x.id === p.id) return Object.assign({}, x, { status: verb === 'accept' ? 'acceptee' : 'refusee' });
      return x;
    });
    if (verb === 'accept') {
      var bid = res.body.bid || {};
      st.bid = Object.assign({}, st.bid || {}, bid, { status: D.STATUS.RETENUE });
      markMyOfferRetained(o.id, { etude: bid.etude || p.etude, montant: Number(bid.montant) || p.montant });
      addNotif({
        key: 'retained:' + o.id, kind: 'retained',
        title: 'Un notaire a retenu votre demande 🎉',
        body: dayTitle(o.dateISO) + ' · ' + D.money(Number(bid.montant) || p.montant) + (p.etude ? ' · ' + p.etude : ''), dateISO: o.dateISO,
      });
      toast('Votre demande est retenue à ' + D.money(Number(bid.montant) || p.montant));
    } else {
      toast('Proposition refusée. Votre offre reste ouverte à ' + D.money(o.montant) + '.');
    }
    offerStatusSet(o.id, st);
    renderProfil();
    renderAccountMenu();
  }

  // --- Cancel an offer (open or retained) ------------------------------------
  // The confirm dialog carries the consequence: an open offer just leaves the
  // carnet; a retained one unwinds the mise en relation and the notary is told.
  var cancelTarget = null;
  async function openCancelDialog(o, st) {
    cancelTarget = o;
    // ADR 0023 / ADR 0033 — the fee prevision rides on GET /client/bid, and
    // it moves with the calendar: the cached forecast may be a day old, so
    // the dialog re-asks the server BEFORE it opens (a failure keeps the
    // cache). The disclosure belongs HERE, before the client confirms.
    var status = (await fetchOfferStatus(o)) || offerStatusGet(o.id);
    if (cancelTarget !== o) return; // the client moved on while we asked
    var noti = status && status.notaire;
    var who = (noti && (noti.nom || noti.etude)) || o.etude || 'un notaire';
    $('cancel-text').textContent = st === 'approved'
      ? 'Cette offre a été retenue par ' + who + '. L’annuler libère le rendez-vous et le notaire en sera avisé par courriel.'
      : 'Votre offre sera retirée du carnet. Plus aucun notaire ne pourra la retenir.';
    var prev = status && status.annulation;
    var feeEl = $('cancel-fee');
    if (feeEl) {
      if (prev && Number(prev.frais) > 0) {
        feeEl.hidden = false;
        // The fee compensates the NOTARY for the day they reserved — Nota
        // keeps none of it (art. 32.1 L.N.). Said in the same breath as the
        // amount, so the client knows where their money goes.
        feeEl.textContent = 'Annuler maintenant retient des frais de ' + D.money(prev.frais)
          + ' (' + pctLabel(prev.taux) + ' du montant convenu) sur votre caution. Ils sont versés au notaire en dédommagement de la journée réservée. Le reste vous est libéré immédiatement.';
      } else {
        feeEl.hidden = true;
        feeEl.textContent = '';
      }
    }
    var dlg = $('cancel-dialog');
    if (dlg && dlg.showModal) { try { dlg.showModal(); } catch (e) {} }
  }
  async function confirmCancelOffer() {
    var o = cancelTarget; if (!o) return;
    var btn = $('cancel-confirm');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    var res;
    try {
      var r = await fetch(API_BASE + '/client/bid/cancel', {
        method: 'POST', headers: clientHeaders(o, true),
        body: JSON.stringify({ id: o.id, dateISO: o.dateISO }),
      });
      var j = {}; try { j = await r.json(); } catch (e2) {}
      res = { ok: r.ok, status: r.status, body: j };
    } catch (e) { res = { ok: false, status: 0, body: {} }; }
    btn.disabled = false; btn.removeAttribute('aria-busy');
    if (!res.ok) {
      // ADR 0023 — a settled act can no longer be cancelled: the ledger has
      // spoken. Close the dialog and refresh so the entry shows its real state.
      var code = res.body && res.body.errors && res.body.errors[0] && res.body.errors[0].code;
      if (code === 'acte_complete') {
        $('cancel-dialog').close();
        cancelTarget = null;
        toast('Cet acte est signé et réglé — il ne peut plus être annulé.');
        fetchOfferStatus(o).then(function () { if (state.tab === 'profil') renderProfil(); }).catch(function () {});
        return;
      }
      toast(res.status === 0 ? 'Hors ligne. Réessayez une fois en ligne.' : 'Erreur serveur. Réessayez.');
      return;
    }
    $('cancel-dialog').close();
    cancelTarget = null;
    markMyOfferCancelled(o.id);
    // ADR 0023 — what was ACTUALLY kept rides back on the cancelled bid
    // (taux, frais, joursAvant, chargeId), null when the cancel was free.
    var kept = res.body && res.body.bid && res.body.bid.annulation;
    var keptLine = kept && Number(kept.frais) > 0
      ? 'Des frais de ' + D.money(kept.frais) + ' (' + pctLabel(kept.taux) + ') ont été retenus sur votre caution et versés au notaire en dédommagement.'
      : null;
    var st = offerStatusGet(o.id);
    if (st && st.bid) {
      st.bid.status = D.STATUS.ANNULEE;
      st.bid.annulation = kept || null;
      st.annulation = null; // the prevision no longer applies
      offerStatusSet(o.id, st);
    }
    addNotif({
      key: 'cancelled:' + o.id, kind: 'cancelled',
      title: 'Votre offre du ' + dayTitle(o.dateISO) + ' est annulée',
      body: keptLine || 'Elle a été retirée du carnet.', dateISO: null,
    });
    toast(keptLine ? 'Offre annulée. ' + keptLine : 'Offre annulée. Elle a été retirée du carnet.');
    reloadAndRender().catch(function () {}); // the carnet must stop showing it
    renderProfil();
    renderAccountMenu();
  }

  // --- Nous joindre (contact) ------------------------------------------------
  // One dialog, three doors (footer, drawer, per-offer « Besoin d'aide ? »).
  // The domain validates inline exactly like the offer form; the API is
  // authoritative. `context.offer` ties the message to an offer for triage.
  var contactBidId = null;
  function openContactDialog(context) {
    var o = context && context.offer;
    contactBidId = o ? o.id : null;
    var p = profileGet();
    if (!$('ct-nom').value) $('ct-nom').value = p.nom || '';
    if (!$('ct-courriel').value) $('ct-courriel').value = p.courriel || (o && o.courriel) || '';
    // The subject follows the door: offer-scoped help from an offer, the
    // default otherwise — a previous visit's choice must not linger. The
    // change event keeps the enhanced Nota select's label in sync.
    $('ct-sujet').value = o ? 'Aide avec une offre' : 'Question générale';
    $('ct-sujet').dispatchEvent(new Event('change', { bubbles: true }));
    var ctx = $('ct-context');
    ctx.hidden = !o;
    ctx.textContent = o ? 'À propos de votre ' + T(svcName(o.serviceId)).toLowerCase() + ' du ' + dayTitle(o.dateISO) + '.' : '';
    // The quick line: the same human, without the form.
    var quick = $('ct-quick');
    clear(quick);
    if (D.CONTACT && D.CONTACT.courriel) {
      quick.appendChild(document.createTextNode('Ou écrivez-nous directement : '));
      var a = el('a', null, D.CONTACT.courriel);
      a.href = 'mailto:' + D.CONTACT.courriel;
      quick.appendChild(a);
    }
    $('contact-form').hidden = false;
    $('contact-success').hidden = true;
    var eb = $('ct-errors'); eb.hidden = true; clear(eb);
    var dlg = $('contact-dialog');
    if (dlg && dlg.showModal) { try { dlg.showModal(); } catch (e) {} }
    try { $('ct-message').focus(); } catch (e2) {}
  }
  async function submitContact(e) {
    e.preventDefault();
    var input = {
      nom: $('ct-nom').value, courriel: $('ct-courriel').value,
      sujet: $('ct-sujet').value, message: $('ct-message').value,
    };
    var eb = $('ct-errors');
    var v = D.validateContactMessage(input);
    if (!v.ok) {
      clear(eb); eb.hidden = false;
      v.errors.forEach(function (er) { eb.appendChild(el('li', null, er.message)); });
      return;
    }
    eb.hidden = true;
    var btn = $('ct-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    var ok = false;
    try {
      var r = await fetch(API_BASE + '/contact', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, input, contactBidId ? { bidId: contactBidId } : {})),
      });
      ok = r.ok;
    } catch (e2) { ok = false; }
    btn.disabled = false; btn.removeAttribute('aria-busy');
    if (!ok) { toast('Impossible d’envoyer pour le moment. Réessayez, ou écrivez-nous par courriel.'); return; }
    profileSet({ nom: v.nom || profileGet().nom, courriel: v.courriel });
    $('contact-form').hidden = true;
    $('contact-success').hidden = false;
    $('ct-message').value = '';
  }

  // Fetch the live status of every tokened live offer, in parallel, and repaint
  // only the detail band of each row that answered — the table itself stays put.
  function refreshMyOffersStatus(offers) {
    var today = todayISO();
    offers.forEach(function (o) {
      if (!o.clientToken || D.daysBetween(today, o.dateISO) < 0) return;
      fetchOfferStatus(o).then(function (st) { if (st) repaintOfferBand(o); });
    });
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

  // One line, both amounts — always the DOMAIN's figures (D.REFERRAL via
  // D.money), the same ones the Partenaires pane advertises. Never hardcoded.
  function referralRewardLine() {
    return D.money(D.REFERRAL.client) + ' par client référé retenu, '
      + D.money(D.REFERRAL.notaire) + ' au premier acte d’un notaire référé.';
  }

  // Parrainage card — the partner's claimed code, resurfaced. The claim is
  // made on the Partenaires pane; once made, the code and its share link live
  // here so closing the tab never loses them. Rewards are announced by
  // courriel (ADR 0011) — deliberately no earnings dashboard.
  function buildReferralCard() {
    var card = el('div', 'profil-card');
    var rec = partnerGet();
    // Partner state: the reward amounts become the head's caption; the empty
    // state keeps its own pitch line beside the CTA.
    card.appendChild(profilHead(IC_PARR, 'Parrainage', rec ? referralRewardLine() : null));
    if (!rec) {
      // Not a partner yet: the pitch (domain amounts) and the door to the form.
      var empty = el('div', 'profil-empty');
      var copy = el('div', 'profil-empty-copy');
      copy.appendChild(el('p', 'profil-empty-text', 'Référez des clients ou des notaires et soyez récompensé.'));
      copy.appendChild(el('p', 'help', referralRewardLine()));
      empty.appendChild(copy);
      var cta = el('button', 'btn btn-primary btn-sm', 'Devenir partenaire'); cta.type = 'button';
      cta.addEventListener('click', function () { toggleNotifPanel(false); setTab('partenaires'); });
      empty.appendChild(cta);
      card.appendChild(empty);
      return card;
    }
    card.appendChild(el('p', 'help', 'Les récompenses vous parviennent par courriel — rien à surveiller ici.'));
    var codeRow = el('div', 'parr-code-row');
    codeRow.appendChild(el('span', 'parr-code-lbl', 'Votre code'));
    codeRow.appendChild(el('strong', 'parr-code', rec.code));
    card.appendChild(codeRow);
    var linkRow = el('div', 'partner-link-row');
    var link = el('code', null, partnerShareLink(rec.code));
    linkRow.appendChild(link);
    var copy = el('button', 'btn btn-sm', 'Copier le lien'); copy.type = 'button';
    copy.addEventListener('click', function () { copyLinkText(link.textContent); });
    linkRow.appendChild(copy);
    // Same affordance as the Partenaires success box: native share where the
    // platform has a sheet — the button only exists when navigator.share does.
    if (typeof navigator.share === 'function') {
      var share = el('button', 'btn btn-sm', 'Partager'); share.type = 'button';
      share.addEventListener('click', function () { shareLinkNative(link.textContent); });
      linkRow.appendChild(share);
    }
    card.appendChild(linkRow);
    return card;
  }

  function renderProfil() {
    var body = $('profil-body'); if (!body) return; clear(body);
    var p = profileGet();

    // Back from Checkout: the same expectation line the success screen
    // shows, standing at the top of « Mes offres » for the session.
    if (state.checkoutNotice) {
      var notice = el('div', 'checkout-notice');
      notice.id = 'checkout-notice';
      notice.setAttribute('role', 'status');
      renderSentences(notice, state.checkoutNotice);
      body.appendChild(notice);
    }

    // Mes offres — a full-width band at the top; its offers lay out across the
    // width so the actionable "where do my requests stand" view leads.
    var oCard = buildMyOffersCard();
    if (oCard) body.appendChild(oCard);
    // Then ask the API what notaries sent back, and repaint each band as it lands.
    refreshMyOffersStatus(myOffers());

    // Coordinates card — reused when publishing an offer. A full-width band;
    // the fields sit in a grid that fills the width (no empty right half).
    var idCard = el('div', 'profil-card');
    idCard.appendChild(profilHead(IC_COORD, 'Coordonnées', 'Réutilisées automatiquement quand vous publiez une offre.'));
    var idFields = el('div', 'profil-fields');
    [
      { key: 'nom', label: 'Nom (transmis au notaire qui vous retient)', ph: 'Prénom Nom', type: 'text' },
      { key: 'courriel', label: 'Courriel', ph: 'vous@exemple.ca', type: 'email' },
      { key: 'telephone', label: 'Téléphone (transmis au notaire qui vous retient)', ph: '(418) 000-0000', type: 'tel' },
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
    // Honest copy: these switches govern ONLY the in-app bell — the emails the
    // API sends are transactional, managed by each email's unsubscribe link.
    nCard.appendChild(profilHead(IC_NOTIF, 'Notifications', 'Ces réglages contrôlent la cloche dans l’application ; les courriels sont gérés par le lien de désabonnement de chaque courriel.'));
    var nGrid = el('div', 'profil-switches');
    PROFILE_NOTIF_KINDS.forEach(function (t) {
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
    dCard.appendChild(profilHead(IC_DOCS, 'Mes documents', 'Téléversez ce que le notaire demandera. Ajoutez, retirez ou marquez « validé ». Tout reste sur votre appareil jusqu’à ce qu’un notaire retienne votre demande.'));
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

    // Parrainage — the referral program's place in the profile, closing the page.
    body.appendChild(buildReferralCard());
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
      if (it.kind === 'doc' && saved[it.id] === D.DOSSIER_TRANSMIS) {
        // "Transmis autrement" (ADR 0010 §4): already with the notary through
        // another channel — a distinct state, with an undo, no file picker.
        var tmeta = el('div', 'doc-file doc-transmis');
        tmeta.appendChild(el('span', 'doc-transmis-lbl', '✓ Transmis par un autre canal'));
        var trm = el('button', 'btn btn-sm btn-ghost', 'Annuler'); trm.type = 'button';
        trm.addEventListener('click', function () { dossierSet(sid, it.id, ''); dossierSetValidated(sid, it.id, false); renderProfilDocs(container, sid); });
        tmeta.appendChild(trm);
        row.appendChild(tmeta);
      } else if (it.kind === 'doc') {
        var fl = el('label', 'file-field');
        var fi = document.createElement('input'); fi.type = 'file'; fi.className = 'file-native';
        fi.accept = D.DOSSIER_FILE.accept;
        var cta = el('span', 'file-cta', provided ? 'Remplacer le fichier' : 'Choisir un fichier');
        var ferr = el('div', 'file-error'); ferr.hidden = true; ferr.setAttribute('role', 'status');
        // Same intake door as the dossier pane: picked or dropped, through the
        // domain gate; a refusal shows in place and saves NOTHING.
        var takeFile = function (f) {
          if (!f) return; // cancelled dialog — the picked document stays
          var v = D.validateDossierFile(f);
          if (!v.ok) { ferr.textContent = v.message; ferr.hidden = false; return; }
          dossierSet(sid, it.id, v.name);
          renderProfilDocs(container, sid);
        };
        fi.addEventListener('change', function () {
          var f = this.files && this.files[0];
          this.value = '';
          takeFile(f);
        });
        fl.appendChild(fi); fl.appendChild(cta);
        var facts = el('div', 'doc-actions');
        facts.appendChild(fl);
        var reuse = !provided && dossierReusable(sid, it.id);
        if (reuse) {
          var rb = el('button', 'btn btn-sm btn-ghost doc-reuse-btn', 'Réutiliser : ' + reuse.value); rb.type = 'button';
          rb.addEventListener('click', function () { dossierSet(sid, it.id, reuse.value); renderProfilDocs(container, sid); });
          facts.appendChild(rb);
        }
        if (!provided) {
          var already = el('button', 'btn btn-sm btn-ghost doc-transmis-btn', 'Déjà transmis au notaire'); already.type = 'button';
          already.addEventListener('click', function () { dossierSet(sid, it.id, D.DOSSIER_TRANSMIS); renderProfilDocs(container, sid); });
          facts.appendChild(already);
        }
        row.appendChild(facts);
        row.appendChild(ferr);
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.dataset.drop = 'true'; });
        row.addEventListener('dragleave', function () { delete row.dataset.drop; });
        row.addEventListener('drop', function (e) {
          e.preventDefault(); delete row.dataset.drop;
          takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
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
    scheduleDossierPush(sid);
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
    scheduleDossierPush(sid);
  }
  // Per-document "validé" flag, stored in the profile (dossier) under __validated.
  function dossierValidated(sid) { var d = dossierFor(sid); return (d && d.__validated) || {}; }
  function dossierSetValidated(sid, id, on) {
    var d = dossierState(); d[sid] = d[sid] || {}; d[sid].__validated = d[sid].__validated || {};
    if (on) d[sid].__validated[id] = true; else delete d[sid].__validated[id];
    lsSave(LS_DOSSIER, d);
    scheduleDossierPush(sid);
  }
  function dossierItems(svc) {
    var items = [];
    svc.documents.forEach(function (x) { items.push({ kind: 'doc', id: x.id, nom: x.nom, aide: x.aide }); });
    svc.champs.forEach(function (x) { items.push({ kind: 'field', id: x.id, nom: x.label, aide: x.aide }); });
    return items;
  }
  // The same document, already provided for ANOTHER act (both financing acts
  // share ids like piece_identite) — surfaced so the client never hunts for a
  // file twice. The DOSSIER_TRANSMIS sentinel is a per-notary declaration and
  // is never carried over.
  function dossierReusable(sid, itemId) {
    var found = null;
    D.SERVICES.forEach(function (s) {
      if (s.id === sid || found) return;
      var v = dossierFor(s.id)[itemId];
      if (v && v !== D.DOSSIER_TRANSMIS) found = { from: s.id, value: v };
    });
    return found;
  }
  // What goes ON THE WIRE for a service: the saved dossier minus __validated —
  // the profile's local « validé » ticks are UI state, never the notary's
  // business (the API drops them too; not sending them is the privacy line).
  function dossierWire(sid) {
    var d = Object.assign({}, dossierFor(sid));
    delete d.__validated;
    return d;
  }

  function renderDossier() {
    var svc = D.serviceById($('d-service').value) || D.SERVICES[0];
    $('d-service').value = svc.id;
    syncDossierChips(svc.id);
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
        }, 'dcrit-', c.autre ? { value: pans[c.autre.champ], onChange: function (val) {
          dossierSetPricing(svc.id, c.autre.champ, val);
          updateDossierPrice(svc);
        } } : null));
      });
      pbody.appendChild(pbox);
      var priceEl = el('div', 'dossier-price'); priceEl.id = 'dossier-price';
      pbody.appendChild(priceEl);
      pcard.appendChild(pbody);
      list.appendChild(pcard);
      updateDossierPrice(svc);
      settleSegTracks(pbox);
    }

    // Consent to share the dossier with the retained notary (Law 25). With the
    // price questions above, it is the WHOLE gate (ADR 0010 §3): required
    // answers + consent make the demand sellable; the notary verifies identity
    // at signing. It therefore sits right under the questions, before the
    // document checklist that no longer gates anything.
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
    // The gate status lives WHERE the gate completes: answers + consent are
    // the whole gate (ADR 0010 §3), so the "what's left" line sits right here,
    // not in a progress block about documents.
    var mline = el('div', 'dossier-missing'); mline.id = 'dossier-missing';
    cbody.appendChild(mline);
    crow.appendChild(ccheck); crow.appendChild(cbody);
    list.appendChild(crow);

    // The documents are PREPARATION, not a gate (ADR 0010 §3): they flow after
    // the mise en relation — through Nota's dossier, or through the notary's
    // own channel ("transmis autrement", ADR 0010 §4).
    var prep = el('div', 'dossier-prep-h');
    var prow = el('div', 'row-between');
    prow.appendChild(el('strong', null, 'À préparer — après la mise en relation'));
    // The 0/N count and bar sit ON the checklist they measure — a progress
    // block above the price questions read as a gate, which it never is.
    var pcount = el('strong', 'dossier-prep-count', '0 / 0'); pcount.id = 'dossier-count';
    prow.appendChild(pcount);
    prep.appendChild(prow);
    var pbar = el('div', 'dossier-bar');
    var pfill = el('span'); pfill.id = 'dossier-fill';
    pbar.appendChild(pfill);
    prep.appendChild(pbar);
    prep.appendChild(el('div', 'help', 'Rien ici ne bloque votre demande. Chaque pièce peut être téléversée, ou marquée déjà transmise au notaire par un autre canal.'));
    list.appendChild(prep);

    // The checklist packs into a card grid — several small pieces per row,
    // not one full-width line each. The consent and pricing cards above keep
    // their own full-width shape.
    var grid = el('div', 'dossier-grid');
    list.appendChild(grid);

    dossierItems(svc).forEach(function (it) {
      var row = el('div', 'dossier-item dossier-row');
      row.dataset.done = saved[it.id] ? 'true' : 'false';

      var check = el('div', 'dossier-check', '✓');
      check.dataset.on = saved[it.id] ? 'true' : 'false';

      var body = el('div', 'dossier-body');
      body.appendChild(el('div', 'dossier-name', it.nom));
      body.appendChild(el('div', 'help', it.aide));

      var input;
      if (it.kind === 'doc') {
        // "Transmis autrement" (ADR 0010 §4): the item was already handed to
        // the notary through their own channel. Stored as the item's VALUE
        // (D.DOSSIER_TRANSMIS), so leadReadiness counts it as provided; the
        // rendered state says so, distinctly, and offers an undo.
        if (saved[it.id] === D.DOSSIER_TRANSMIS) {
          var tstate = el('div', 'doc-transmis');
          tstate.appendChild(el('span', 'doc-transmis-lbl', '✓ Transmis par un autre canal'));
          var undo = el('button', 'btn btn-sm btn-ghost', 'Annuler'); undo.type = 'button';
          undo.addEventListener('click', function () {
            dossierSet(svc.id, it.id, '');
            renderDossier();
          });
          tstate.appendChild(undo);
          body.appendChild(tstate);
          row.appendChild(check); row.appendChild(body);
          grid.appendChild(row);
          return;
        }
        var fileLbl = el('label', 'file-field');
        input = document.createElement('input'); input.type = 'file'; input.className = 'file-native';
        // Only what a notary can open — and on a phone, « prendre une photo ».
        input.accept = D.DOSSIER_FILE.accept;
        var fileCta = el('span', 'file-cta', saved[it.id] ? 'Remplacer le fichier' : 'Choisir un fichier');
        var ferr = el('div', 'file-error'); ferr.hidden = true; ferr.setAttribute('role', 'status');
        // The ONE intake door for this row: picked or dropped, the file goes
        // through the domain gate; a refusal shows in place and saves NOTHING.
        var takeFile = function (f) {
          if (!f) return; // cancelled dialog — the picked document stays
          var v = D.validateDossierFile(f);
          if (!v.ok) { ferr.textContent = v.message; ferr.hidden = false; return; }
          dossierSet(svc.id, it.id, v.name);
          renderDossier();
        };
        input.addEventListener('change', function () {
          var f = this.files && this.files[0];
          this.value = ''; // re-picking the same file must fire change again
          takeFile(f);
        });
        fileLbl.appendChild(input); fileLbl.appendChild(fileCta);
        var docActions = el('div', 'doc-actions');
        docActions.appendChild(fileLbl);
        // The same document, already picked for the OTHER act — one click
        // instead of finding the file again. Sentinels are per-notary
        // declarations, never offered.
        var reuse = !saved[it.id] && dossierReusable(svc.id, it.id);
        if (reuse) {
          var rb = el('button', 'btn btn-sm btn-ghost doc-reuse-btn', 'Réutiliser : ' + reuse.value); rb.type = 'button';
          rb.addEventListener('click', function () {
            dossierSet(svc.id, it.id, reuse.value);
            renderDossier();
          });
          docActions.appendChild(rb);
        }
        // The other channel, beside the upload — never instead of it. Once a
        // file IS picked the row's second action is Retirer; offering the
        // sentinel too would be three verbs for one line.
        if (!saved[it.id]) {
          var already = el('button', 'btn btn-sm btn-ghost doc-transmis-btn', 'Déjà transmis au notaire'); already.type = 'button';
          already.addEventListener('click', function () {
            dossierSet(svc.id, it.id, D.DOSSIER_TRANSMIS);
            renderDossier();
          });
          docActions.appendChild(already);
        }
        body.appendChild(docActions);
        if (saved[it.id]) {
          var meta = el('div', 'doc-file');
          meta.appendChild(el('span', 'doc-file-name', '📎 ' + saved[it.id]));
          var rm = el('button', 'btn btn-sm btn-ghost', 'Retirer'); rm.type = 'button';
          rm.addEventListener('click', function () {
            dossierSet(svc.id, it.id, '');
            renderDossier();
          });
          meta.appendChild(rm);
          body.appendChild(meta);
          body.appendChild(el('div', 'file-note', 'Reste sur votre appareil jusqu’à la mise en relation.'));
        } else {
          // Desktop affordance only — CSS hides it on touch/small screens. It
          // rides the actions row instead of costing the card its own line.
          docActions.appendChild(el('span', 'file-note file-hint', 'ou glissez-le ici'));
        }
        body.appendChild(ferr);
        // The whole row is the drop target — pick or drop, same gate.
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.dataset.drop = 'true'; });
        row.addEventListener('dragleave', function () { delete row.dataset.drop; });
        row.addEventListener('drop', function (e) {
          e.preventDefault(); delete row.dataset.drop;
          takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
      } else {
        input = document.createElement('input'); input.type = 'text';
        input.value = saved[it.id] || '';
        input.placeholder = 'Votre réponse';
        input.addEventListener('input', function () {
          dossierSet(svc.id, it.id, this.value.trim());
          check.dataset.on = this.value.trim() ? 'true' : 'false';
          row.dataset.done = this.value.trim() ? 'true' : 'false';
          updateDossierBar();
        });
        body.appendChild(input);
      }
      // Dynamically generated inputs carry no <label>, so name them explicitly.
      if (input) input.setAttribute('aria-label', it.nom);

      row.appendChild(check); row.appendChild(body);
      grid.appendChild(row);
    });

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
    // Count, bar and gate line are all built by renderDossier() — guard for
    // a call landing before the pane has ever rendered.
    var cnt = $('dossier-count'); if (cnt) cnt.textContent = done + ' / ' + total;
    var fill = $('dossier-fill'); if (fill) fill.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';

    // PRICE BEFORE DOCUMENTS (ADR 0010 §3): the readiness line reports the
    // GATE — required pricing answers + sharing consent. The document count
    // above is preparation progress and never blocks anything.
    var m = $('dossier-missing');
    if (!m) return;
    if (r.ready) {
      m.textContent = '✓ Prête à être retenue : questions de prix répondues, partage consenti. Les documents se préparent après la mise en relation.';
      m.dataset.ready = 'true';
    } else {
      var parts = [];
      // T() each label — the joined line is composed at runtime, so the
      // i18n DOM pass can only translate its prefix.
      if (r.requis.length) parts.push('questions de prix à répondre : ' + r.requis.map(function (x) { return T(x); }).join(', '));
      if (!r.consent) parts.push('consentement de partage requis');
      m.textContent = parts.join(' · ') + '.';
      m.dataset.ready = 'false';
    }
  }

  // Post-publish bridge: the demand is already sellable (required answers +
  // consent gated the publish, ADR 0010 §3) — this card is the DOCUMENT
  // preparation progress for after the mise en relation, never a barrier.
  function fillDossierNext(serviceId) {
    var svc = D.serviceById(serviceId); if (!svc) return;
    var r = D.leadReadiness(serviceId, dossierFor(serviceId));
    var badge = $('dossier-next-badge'); if (badge) badge.textContent = r.done + '/' + r.total;
    var fill = $('dossier-next-fill'); if (fill) fill.style.width = (r.total ? Math.round((r.done / r.total) * 100) : 0) + '%';
    var h = $('dossier-next-h'), sub = $('dossier-next-sub'), cta = $('dossier-next-cta');
    if (r.total && r.done === r.total) {
      if (h) h.textContent = 'Documents prêts ✓';
      if (sub) sub.textContent = 'Tout est prêt pour la mise en relation.';
      if (cta) cta.textContent = 'Revoir mon dossier';
    } else {
      if (h) h.textContent = 'Préparez vos documents';
      if (sub) sub.textContent = 'À transmettre après la mise en relation — rien ne bloque votre demande.';
      if (cta) cta.textContent = 'Préparer mon dossier';
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
    // Referral attribution (ADR 0011): a NOTARY can be referred too. The
    // signup prompt's « Code de référence » field is the source when it is
    // on the page (pre-filled from a captured ?ref link, editable by hand);
    // the captured link code is the fallback for paths without the field.
    // The API stores it privately on the notary; never displayed anywhere.
    var body = { email: email };
    var refField = $('nc-signup-parrain');
    var typedRef = refField ? refField.value.trim() : '';
    var parrain = refField
      ? (D.isReferralCode(typedRef) ? D.normalizeReferralCode(typedRef) : null)
      : referralCode();
    if (parrain) body.parrain = parrain;
    try {
      var r = await fetch(API_BASE + '/notaries/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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

  // The gate is a two-step branch behind ONE "Continuer" action: the email step
  // (everyone starts there) or the signup step (a NEW notary's welcome). Exactly
  // one is visible at a time — the swap is what keeps a first visit from reading
  // as a failed login.
  function ncShowGateStep(which) {
    var email = $('notary-gate-step-email'); if (email) email.hidden = which !== 'email';
    var sent = $('notary-gate-step-sent'); if (sent) sent.hidden = which !== 'sent';
    var signup = $('notary-signup-prompt'); if (signup) signup.hidden = which !== 'signup';
  }

  // "Check your inbox" — shown after a link request in production (no dev echo).
  // Enumeration-safe: it says nothing about whether the address is a notary.
  function ncShowSentStep(email) {
    ncSetErrors([]);
    var who = $('notary-sent-email'); if (who) who.textContent = email;
    ncShowGateStep('sent');
    var box = $('notary-gate-step-sent');
    if (box) { try { box.focus({ preventScroll: true }); } catch (e) { try { box.focus(); } catch (e2) {} } }
  }

  // A valid email with no active subscription isn't an error — it's a NEW notary.
  // Swap in the welcome/free-signup step (which is what opens the console).
  function ncShowSignup(email) {
    ncSetErrors([]);
    nc.pendingSignupEmail = email;
    var who = $('notary-signup-email'); if (who) who.textContent = email;
    var errs = $('notary-signup-errors'); if (errs) errs.hidden = true;
    var btn = $('notary-signup-btn'); if (btn) { btn.disabled = false; btn.textContent = 'Créer mon compte gratuit →'; }
    // Pre-fill the referral field from a captured ?ref link — transparent
    // attribution, exactly like the booking form's field.
    var refField = $('nc-signup-parrain');
    if (refField && !refField.value) { var rc = referralCode(); if (rc) refField.value = rc; }
    ncShowGateStep('signup');
    var prompt = $('notary-signup-prompt');
    if (prompt) {
      if (prompt.scrollIntoView) { try { prompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} }
      try { prompt.focus({ preventScroll: true }); } catch (e) { try { prompt.focus(); } catch (e2) {} }
    }
  }

  // Back out of the signup branch ("use another email"): the address stays in
  // the field so a typo costs one edit, not a retype.
  function ncShowEmailStep() {
    ncShowGateStep('email');
    var inp = $('nc-email');
    if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { try { inp.focus(); } catch (e2) {} } }
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
  // Feed disclosure level (ADR 0019): 'compact' folds every open card to its
  // decision row; 'detail' unfolds the whole feed. Remembered per device.
  var LS_NC_VIEW = 'nota.notary.view.v1';
  // Unread (ADR 0033): per retained act, the createdAt of the last CLIENT
  // message this device has seen — `{ [bidId]: iso }`. Unread = client
  // messages newer than that. Per device, like a read receipt nobody sends.
  var LS_NC_SEEN = 'nota.nc.seen.v1';

  // token   -> SESSION scope, sent in the Authorization header (never a URL).
  // feedToken -> FEED scope (read-only), the only token placed in the webcal URL.
  // filter -> client-side view state over `open` (service chip + complete-file
  // toggle); it never changes what the API returned, only what is drawn.
  // openDetails: ids the notary unfolded by hand in the compact view — kept
  // across re-renders (refresh, filter) so a studied card never snaps shut.
  // conditions -> what retaining commits the notary to (ADR 0033): paiement à
  // la signature, the client's Nota price beside, the cancellation barème
  // (compensation to the notary), the free-but-counted withdrawal. API data.
  // fenetre -> the months the server's `retained` list covers, so the console
  // can prune a local entry the server stopped returning (a cancelled act).
  // deepAct -> the act a « #notaires&acte=<id> » link points at, until the
  // card is on screen.
  var nc = { token: null, feedToken: null, email: null, open: [], filter: { service: 'all', readyOnly: false, day: null }, openDetails: {}, rating: null, profil: { lienCNQ: null }, tarif: null, cote: null, conditions: null, fenetre: null, deepAct: null, manquantsServeur: null };

  // Pending declines: id -> { timer, dateISO }. A decline collapses the card
  // into an undo line first and only POSTs once the window closes (or a test
  // flushes it) — a mis-tap must never cost a notary a lead.
  var NC_DECLINE_UNDO_MS = 6000;
  var ncPendingDeclines = {};

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
  // Merge the server's view of this notary's retentions (incl. those won on a
  // proposition) into the local store, keyed by id. Local-only progress
  // (completed act, commission) is kept; server fields win on overlap.
  function ncRetainedMerge(email, entries) {
    if (!email || !Array.isArray(entries)) return;
    var local = ncRetainedFor(email);
    entries.forEach(function (r) {
      if (!r || !r.id) return;
      var have = local.filter(function (e) { return e.id === r.id; })[0];
      if (have) ncRetainedUpdate(email, r.id, r);
      else ncRetainedAdd(email, r);
    });
  }
  // The server is the only one who knows an act was cancelled: it simply
  // stops returning it. `fenetre` says which months the answer covered, so a
  // local entry from one of those months that the answer lacks is gone for
  // good (ADR 0033). Entries outside the window are left alone — the server
  // said nothing about them. Returns the pruned entries (for the one toast).
  function ncRetainedPrune(email, entries, fenetre) {
    if (!email || !Array.isArray(entries) || !Array.isArray(fenetre) || !fenetre.length) return [];
    var keep = {}; entries.forEach(function (r) { if (r && r.id) keep[r.id] = true; });
    var gone = [];
    var list = ncRetainedFor(email).filter(function (e) {
      var month = String(e.dateISO || '').slice(0, 7);
      if (fenetre.indexOf(month) < 0 || keep[e.id]) return true;
      gone.push(e); return false;
    });
    if (gone.length) ncRetainedSave(email, list);
    return gone;
  }

  // --- Unread (ADR 0033) -----------------------------------------------------
  function ncSeenAll() { return lsLoad(LS_NC_SEEN) || {}; }
  // The newest client message on an entry — null when the client never wrote.
  function ncLastClientAt(entry) {
    var last = null;
    (entry && entry.messages || []).forEach(function (m) {
      if (m && m.de === 'client' && m.createdAt && (!last || m.createdAt > last)) last = m.createdAt;
    });
    return last;
  }
  function ncUnreadCount(entry) {
    var seen = ncSeenAll()[entry.id] || '';
    return (entry.messages || []).filter(function (m) { return m && m.de === 'client' && m.createdAt && m.createdAt > seen; }).length;
  }
  // Mark the thread read up to its last client message and repaint the two
  // badges IN PLACE — never a full re-render: this fires from a focused
  // composer, and a re-render would take the focus (and the draft) away.
  function ncMarkSeen(entry) {
    var last = ncLastClientAt(entry); if (!last) return;
    var all = ncSeenAll();
    if (all[entry.id] === last) return;
    all[entry.id] = last; lsSave(LS_NC_SEEN, all);
    var card = document.querySelector('#notary-retained-list .nc-card[data-id="' + entry.id + '"]');
    if (card) { card.querySelectorAll('.nc-unread').forEach(function (b) { b.parentNode.removeChild(b); }); delete card.dataset.unread; }
    ncRenderRetainedHead();
  }
  function ncUnreadBadge(n) {
    var b = el('span', 'nc-unread');
    b.appendChild(el('span', 'nc-unread-n', String(n)));
    b.appendChild(document.createTextNode(' '));
    b.appendChild(el('span', null, n > 1 ? 'nouveaux' : 'nouveau'));
    return b;
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
    // The server echoes the SETTLED value — on a duplicate submit that is the
    // ledger's original figure, never the retried one.
    ncRetainedUpdate(nc.email, id, { completed: true, actAmount: j.actAmount != null ? j.actAmount : amt, commissionCents: j.commissionCents || 0 });
    ncRenderRetained();
    toast('Acte complété. Vos honoraires : ' + D.money(j.honorairesCents != null ? j.honorairesCents / 100 : (j.actAmount != null ? j.actAmount : amt)) + ', virés en entier.');
  }

  // Build the webcal:// subscription URL from the API base. A relative '/api'
  // base is resolved against the current origin first, then the scheme swapped.
  // `token` must be the read-only FEED token — never the session token.
  function ncFeedUrl(token) {
    return toWebcal(apiBaseAbs() + '/notary/feed.ics?token=' + encodeURIComponent(token));
  }

  // Point the notaires landing's "add to your calendar" card at the PUBLIC
  // carnet feed. One click subscribes the whole carnet (all open dates, kept
  // in sync) into a Google / Outlook / Apple calendar; .ics covers the rest.
  function wireCarnetSubscribe() {
    var http = apiBaseAbs() + '/carnet/feed.ics';
    var webcal = toWebcal(http);
    var name = T('Nota — carnet Québec');
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
    ncPollStop(); // the live feed dies with the session
    nc.token = null; nc.feedToken = null; nc.email = null; nc.open = [];
    nc.rating = null; nc.profil = { lienCNQ: null, rayonKm: 0, urgences: false }; nc.tarif = null;
    nc.cote = null; nc.conditions = null; nc.fenetre = null; nc.manquantsServeur = null;
    ncCloseRetainSheet(); // a sheet about a session that ended
    ncRenderProfil(); // the form must never keep another notary's fiche
    ncRenderProfilBanner();
    ncRenderCote();   // another notary must never inherit this one's cote
    // The evaluations cache dies with the session: fold the panel, empty the
    // list — the next sign-in re-fetches ITS OWN history on first open.
    ncEvalsFor = null;
    var evDetails = $('notary-evals'); if (evDetails) evDetails.open = false;
    var evList = $('nc-evals-list'); if (evList) clear(evList);
    // Same rule for the act-by-act statement: the money history of a session
    // never survives it.
    ncActsFor = null;
    var acDetails = $('notary-actes'); if (acDetails) { acDetails.open = false; acDetails.hidden = false; }
    var acList = $('nc-actes-list'); if (acList) clear(acList);
    try {
      localStorage.removeItem(LS_NC_TOKEN);
      localStorage.removeItem(LS_NC_FEED_TOKEN);
      localStorage.removeItem(LS_NC_EMAIL);
    } catch (e) {}
    ncRenderAuthState();
    renderAccountMenu(); // session gone → menu falls back to client/anonymous
    if (msg) toast(msg);
  }

  // Step 1 of passwordless sign-in: request a single-use magic link. The API is
  // ENUMERATION-SAFE — an active notary, an inactive one and a stranger all get
  // the same generic ok, so this never tells us whether the address is a notary.
  // Outside production the API echoes the challenge token (devToken), so the
  // handshake completes with no mailbox (local dev + the web test stubs); in
  // production the notary opens the emailed link, which boots into ncVerifyMagic.
  async function ncSignIn(email) {
    email = (email || '').trim();
    ncShowGateStep('email'); // every attempt starts from the email step
    var r;
    try {
      r = await fetch(API_BASE + '/notary/session/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
    } catch (e) { ncSetErrors(['Console indisponible hors ligne. Réessayez une fois en ligne.']); return { ok: false }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 422) {
      ncSetErrors((j.errors || [{ message: 'Entrez un courriel valide.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    if (r.status !== 200) {
      ncSetErrors((j.errors || [{ message: 'Connexion refusée.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    ncSetErrors([]);
    // Dev/test path: the echoed token lets us finish the handshake in place, so
    // Nota.notary.signIn stays a one-call end-to-end sign-in offline.
    if (j.devToken) return ncVerifyMagic(j.devToken, email);
    // Production path: the link is in the notary's inbox. Confirm and wait.
    ncShowSentStep(email);
    return { ok: true, pending: true };
  }

  // Step 2: redeem a challenge token (from the dev echo or the emailed link) for
  // a real session. `emailHint` is the address the request used; the API also
  // returns the notary's own email on the authenticated response, which the
  // boot-from-link path (no hint) relies on to key the retained store.
  async function ncVerifyMagic(token, emailHint) {
    var r;
    try {
      r = await fetch(API_BASE + '/notary/session/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token }),
      });
    } catch (e) { ncSetErrors(['Console indisponible hors ligne. Réessayez une fois en ligne.']); return { ok: false }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      ncShowGateStep('email');
      ncSetErrors((j.errors || [{ message: 'Lien invalide ou expiré. Redemandez un lien.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    ncSetErrors([]);
    var email = j.email || emailHint || nc.email;
    nc.token = j.token; nc.feedToken = j.feedToken || null; nc.email = email;
    lsSave(LS_NC_TOKEN, j.token); lsSave(LS_NC_FEED_TOKEN, nc.feedToken); lsSave(LS_NC_EMAIL, email);
    ncRenderAuthState();
    renderAccountMenu(); // the account menu now reflects the notary session
    var loaded = await ncLoadBids();
    if (loaded) toast('Console ouverte pour ' + email + '.');
    return { ok: true };
  }

  // A magic link opens the site with the challenge token in the URL hash. Consume
  // it once on boot: strip it from the URL (so a refresh / shared copy can never
  // replay it, and it never lingers in history), land on the notary tab, verify.
  function ncConsumeMagicHash() {
    var params;
    try { params = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); } catch (e) { return false; }
    var token = params.get('nauth');
    if (!token) return false;
    params.delete('nauth');
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    setTab('notaires', { focus: false });
    ncShowGateStep('email');
    ncVerifyMagic(token, null);
    return true;
  }

  // The console refreshes ITSELF (owner, 2026-08-27): a signed-in notary
  // watches a live feed, not a Rafraîchir button. The poll lives exactly as
  // long as the session — ncLoadBids arms it, ncExpire kills it — so a jsdom
  // test run can drain its timers. It sleeps while the tab is hidden and
  // never fires mid-gesture (a focused field, an armed Retenir confirm, an
  // open inline form or menu): ncLoadBids re-renders the profile form too,
  // and a poll must never clobber what a hand started.
  var NC_POLL_MS = Number(window.__NOTA_POLL_MS__) || 30000;
  // A focused conversation composer pauses the poll too — but not forever: a
  // live back-and-forth must not stall because the notary keeps the cursor in
  // the box. Past this grace the feed refreshes anyway; ncRenderRetained
  // carries the draft and the focus across the re-render.
  var NC_POLL_FOCUSED_MS = Number(window.__NOTA_POLL_FOCUSED_MS__) || 60000;
  var ncPollTimer = null, ncPollBusy = false, ncLastLoadAt = 0;
  function ncPollStop() { if (ncPollTimer) { clearInterval(ncPollTimer); ncPollTimer = null; } }
  function ncPollStart() {
    if (ncPollTimer) return;
    ncPollTimer = setInterval(function () {
      if (!nc.token) { ncPollStop(); return; }
      if (document.hidden || ncPollBusy) return;
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
        var inComposer = ae.classList && ae.classList.contains('chat-input') && ae.closest && ae.closest('#notary-retained-list');
        if (!inComposer || Date.now() - ncLastLoadAt < NC_POLL_FOCUSED_MS) return;
      }
      // Mid-gesture surfaces: an armed confirm, an inline form, an open menu or
      // panel, and the Retenir sheet (ADR 0033) — a re-render under an open
      // sheet would swap the card the sheet is about.
      if (document.querySelector('#notary-console .nc-card[data-confirm="1"], #notary-console form.nc-inline, #notary-console details[open], #nc-retenir-dialog[open]')) return;
      ncPollBusy = true;
      ncLoadBids().then(function () { ncPollBusy = false; }, function () { ncPollBusy = false; });
    }, NC_POLL_MS);
  }

  async function ncLoadBids() {
    if (!nc.token) return false;
    ncPollStart();
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
    // Anything else that is not a success must NOT be read as one. Without this,
    // a 500 parsed to {} and blanked the console — no open demands, no rating,
    // no cote, no commission — while returning true, so callers toasted success.
    if (!r.ok) {
      nc.open = []; ncRenderOpen();
      var errEmpty = $('notary-open-empty');
      if (errEmpty) { errEmpty.textContent = 'Impossible de charger les demandes. Réessayez.'; errEmpty.hidden = false; }
      return false;
    }
    var j = {}; try { j = await r.json(); } catch (e) {}
    ncLastLoadAt = Date.now();
    nc.open = j.bids || [];
    nc.rating = j.rating || null; // the notary's own public average
    nc.profil = j.profil || { lienCNQ: null, rayonKm: 0, urgences: false };
    nc.tarif = j.tarif || null;           // ADR 0031 : le prix que le CLIENT paie à Nota
    nc.cote = j.cote || null;             // ADR 0028: always there, barème or not
    nc.conditions = j.conditions || null; // ADR 0033: what retaining commits to
    nc.fenetre = Array.isArray(j.fenetre) ? j.fenetre : null;
    nc.manquantsServeur = null;           // a fresh profile supersedes an old 403
    ncRenderProfil();
    ncRenderProfilBanner();
    ncRenderPrefs();
    ncRenderEarnings(); // the money tiles
    ncRenderCote();     // …and, right under them, what decides the share
    ncRenderOpen();
    // The server's retained list: merge what it returns, then drop what it
    // stopped returning inside its window — the client cancelled (ADR 0033).
    var gone = ncRetainedPrune(nc.email, j.retained || [], nc.fenetre);
    if (j.retained && j.retained.length) ncRetainedMerge(nc.email, j.retained);
    if (gone.length || (j.retained && j.retained.length)) ncRenderRetained();
    if (gone.length) ncToastCancelled(gone);
    ncConsumeDeepAct();
    return true;
  }
  // One toast for a prune pass, however many acts it dropped.
  function ncToastCancelled(gone) {
    var dates = gone.map(function (e) { return String(e.dateISO || ''); }).sort();
    var msg = T('Le client a annulé la demande du') + ' ' + dayTitle(dates[0]) + '.';
    if (gone.length > 1) msg += ' (+' + (gone.length - 1) + ')';
    toast(msg);
  }

  // One POST helper for the per-bid notary actions (propose / documents):
  // same bearer pattern as accept, same 401 → expire, same offline toast.
  // Returns { status, json } or null when the call never reached the API.
  async function ncPost(path, body) {
    if (!nc.token) return null;
    var r;
    try {
      r = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify(body),
      });
    } catch (e) { toast('Action impossible (hors ligne).'); return null; }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return null; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    return { status: r.status, json: j };
  }

  function ncFindOpen(id) { return nc.open.filter(function (b) { return b.id === id; })[0] || null; }

  // Suggest a higher price. The domain validates first (the form already did,
  // inline); the API stays authoritative and its 422 errors are surfaced.
  async function ncPropose(id, dateISO, montant, message) {
    var b = ncFindOpen(id);
    var v = D.validateCounterOffer({ bid: b, montant: montant, todayISO: todayISO() });
    if (!v.ok) return { ok: false, errors: v.errors };
    var body = { id: id, dateISO: dateISO, montant: v.montant };
    if (message) body.message = message;
    var res = await ncPost('/notary/bids/propose', body);
    if (!res) return { ok: false, errors: [] };
    if (res.status === 409) { toast('Cette offre a déjà été retenue par un autre notaire.'); ncDropOpen(id); ncRenderOpen(); return { ok: false, errors: [] }; }
    // The server is authoritative on the contact gate (ADR 0033): its 403
    // lands exactly where the client-side gate does — in the profile.
    if (res.status === 403 && ncProfilRefusal(res.json)) { ncProfilGate(res.json); return { ok: false, errors: [] }; }
    if (res.status !== 200) return { ok: false, errors: (res.json.errors || [{ message: 'Échec de l’envoi de la proposition.' }]) };
    if (b) b.proposition = res.json.proposition || { montant: v.montant, status: 'en_attente' };
    ncRenderOpen();
    toast('Proposition envoyée au client.');
    return { ok: true, proposition: res.json.proposition };
  }

  // Ask the client for documents / intake fields. Works on an open demand and
  // on a retained file (the entry then lives in the retained store).
  async function ncRequestDocuments(id, dateISO, documents, message) {
    var b = ncFindOpen(id);
    var ret = nc.email ? ncRetainedFor(nc.email).filter(function (e) { return e.id === id; })[0] : null;
    var serviceId = (b || ret || {}).serviceId;
    var v = D.validateDocumentRequest({ serviceId: serviceId, documents: documents, message: message });
    if (!v.ok) return { ok: false, errors: v.errors };
    var body = { id: id, dateISO: dateISO, documents: v.documents.map(function (d) { return d.id; }) };
    if (v.message) body.message = v.message;
    var res = await ncPost('/notary/bids/documents', body);
    if (!res) return { ok: false, errors: [] };
    if (res.status === 409 && b) { toast('Cette offre a déjà été retenue par un autre notaire.'); ncDropOpen(id); ncRenderOpen(); return { ok: false, errors: [] }; }
    if (res.status !== 200) return { ok: false, errors: (res.json.errors || [{ message: 'Échec de l’envoi de la demande.' }]) };
    var demande = res.json.demande || { documents: v.documents, fournie: false };
    if (b) { b.demande = demande; ncRenderOpen(); }
    if (ret) { ncRetainedUpdate(nc.email, id, { demande: demande }); ncRenderRetained(); }
    toast('Demande de documents envoyée au client.');
    return { ok: true, demande: demande };
  }

  // Decline with an undo window: the card collapses now, the POST waits.
  function ncDeclineLater(id, dateISO) {
    if (ncPendingDeclines[id]) return;
    ncPendingDeclines[id] = { dateISO: dateISO, timer: setTimeout(function () { ncFlushDecline(id); }, NC_DECLINE_UNDO_MS) };
    ncRenderOpen();
  }
  function ncCancelDecline(id) {
    var p = ncPendingDeclines[id]; if (!p) return;
    clearTimeout(p.timer); delete ncPendingDeclines[id];
    ncRenderOpen();
  }
  async function ncFlushDecline(id) {
    var p = ncPendingDeclines[id]; if (!p) return;
    clearTimeout(p.timer); delete ncPendingDeclines[id];
    await ncDecline(id, p.dateISO);
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
    // The contact gate (ADR 0033): the server refuses until nom / téléphone /
    // adresse are on the profile — open the form, say what is missing.
    if (r.status === 403 && ncProfilRefusal(j)) { ncProfilGate(j); return; }
    if (r.status !== 200) { toast('Impossible de retenir cette demande.'); return; }
    // The mise en relation is complete (ADR 0033): the API releases the
    // client's contact block at accept — keep it, along with everything the
    // open card knew (lender, déplacement, distance) so the retained card can
    // lead with « Votre client » without waiting for the next feed load.
    var entry = {
      id: j.id, dateISO: dateISO, serviceId: bidMeta.serviceId, montant: bidMeta.montant,
      tier: bidMeta.tier, prefixe: bidMeta.prefixe || null,
      courriel: j.courriel || (j.client && j.client.courriel) || null, dossier: j.dossier || null,
      client: j.client || null,
      preteur: bidMeta.preteur || null, deplacement: bidMeta.deplacement || null,
      distanceKm: bidMeta.distanceKm != null ? bidMeta.distanceKm : null,
      complexity: bidMeta.complexity || null,
      messages: [], documents: [], annulation: j.annulation || null, completed: false,
    };
    // PAID AT SIGNING (ADR 0015): accepting retains — no money moves here.
    // The settlement (capture + net transfer, or the commission fallback)
    // happens when the notary confirms the signed act (« Acte signé »), and
    // « Vos revenus » counts it at that moment.
    ncRetainedAdd(nc.email, entry);
    ncDropOpen(id);
    ncRenderOpen(); ncRenderRetained(); ncRenderEarnings();
    toast('Demande retenue. Dossier du client débloqué — le règlement se fait à la signature.');
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
    if (r.status !== 200) { toast('Impossible de décliner la demande.'); return; }
    ncDropOpen(id);
    ncRenderOpen();
    toast('Demande déclinée.');
  }

  function ncDropOpen(id) { nc.open = nc.open.filter(function (b) { return b.id !== id; }); }

  // Public teaser of the live inventory on the signed-out landing: the month's
  // real open demands, soonest first, each card a button into the sign-in gate.
  // Capped — the full list is the payoff of signing in; overflow collapses into
  // one "+N autres" card. Hidden signed-in (the console's open list takes over)
  // and when the month has nothing open (no data → no empty section).
  // The teaser is a 12-tile block (owner's call, 2026-08-26: at 8 the left
  // column stopped a row short of the gate+agenda column and left a hole):
  // with overflow, 11 demands + the "+N autres" card in the LAST slot — the
  // lead-in sits bottom right of a full grid, never on an orphan row. A month
  // with 12 or fewer open demands shows them all.
  var NC_LIVE_MAX = 12;
  function ncFocusGate() {
    // Land on whichever gate step is showing: the signup CTA mid-branch,
    // otherwise the email field.
    var signup = $('notary-signup-prompt');
    var inp = (signup && !signup.hidden) ? ($('notary-signup-btn') || signup) : $('nc-email');
    if (!inp) return;
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
    var grid = $('notary-live-grid'); clear(grid);
    var shown = open.length > NC_LIVE_MAX ? NC_LIVE_MAX - 1 : open.length;
    open.slice(0, shown).forEach(function (b) { grid.appendChild(ncLiveCard(b)); });
    var extra = open.length - shown;
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

  // Which onboarding view is on screen:
  //   • 'role'    (role choice)  — NO vignette: one question, two cards;
  //   • 'client'  (client steps) — ONE bid played out (the bid vignette);
  //   • 'notaire' (notary steps) — the week board paying out + agenda providers.
  function onbView() {
    var dlg = $('onboarding-dialog'), steps = $('onb-view-steps');
    if (!dlg || !steps || steps.hidden) return 'role';
    return dlg.getAttribute('data-role') === 'notary' ? 'notaire' : 'client';
  }

  var weekVigOnb = makeWeekVignette({
    box: 'ob-week', board: 'ob-week-board', total: 'ob-week-total',
    // Only the notary steps show the board: open demands only, no ✓ flavour.
    retenues: function () { return false; },
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
    onbLiveLines(); // the role cards' live proof follows the same data
    var view = onbView();
    if (view === 'role') {
      // The role choice is ONE question — no vignette competes with the two
      // cards; their live-proof lines already carry the market.
      weekVigOnb.stop(); bidVigOnb.stop();
      var wk0 = $('ob-week'); if (wk0) wk0.hidden = true;
      var bid0 = $('ob-bid'); if (bid0) bid0.hidden = true;
      return;
    }
    var mobileSteps = view === 'notaire' && onbMobileMq && onbMobileMq.matches;
    if (view === 'client' || mobileSteps) {
      // The steps trade the board for one bid played out in full.
      weekVigOnb.stop();
      var wk = $('ob-week'); if (wk) wk.hidden = true;
      bidVigOnb.restart();
      return;
    }
    // Notary steps (wide screens): the week paying out + agenda providers.
    bidVigOnb.stop();
    var bid = $('ob-bid'); if (bid) bid.hidden = true;
    retrigger($('ob-week-providers'), 'is-live'); // the agenda marks file in
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

  // --- Alert preferences (ADR 0033 §7) ---------------------------------------
  // At what PACE Nota mails this notary about new matching demands, and
  // whether only the urgent ones: SERVER data, saved through POST
  // /notary/profile (`alertes`) and rendered from profil.alertes — the
  // notifier honours exactly what the console shows. What stays LOCAL is the
  // lender roster: it filters THIS console's feed (ncFilteredOpen), nothing
  // else reads it. No SMS switch anywhere: nothing sends texts.
  var LS_NC_PREFS = 'nota.notary.prefs.v1';
  var ncPrefsSavedT = null;
  var NC_PACES = ['instant', 'daily', 'weekly', 'off'];
  function ncDefaultPrefs() {
    // Every catalogued lender starts ACCEPTED: refusing is the notary's explicit
    // choice ("je ne ferme pas avec ce prêteur"), never a default.
    var lend = {}; D.LENDERS.forEach(function (l) { lend[l.id] = true; });
    return { lenders: lend };
  }
  function ncPrefsGet(email) {
    var d = ncDefaultPrefs();
    var stored = (lsLoad(LS_NC_PREFS) || {})[email] || {};
    return { lenders: Object.assign(d.lenders, stored.lenders || {}) };
  }
  function ncPrefsSavedNote() {
    var saved = $('notary-prefs-saved');
    if (saved) { saved.hidden = false; clearTimeout(ncPrefsSavedT); ncPrefsSavedT = setTimeout(function () { saved.hidden = true; }, 2200); }
  }
  function ncPrefsSave(email, prefs) {
    var all = lsLoad(LS_NC_PREFS) || {}; all[email] = { lenders: prefs.lenders }; lsSave(LS_NC_PREFS, all);
    ncPrefsSavedNote();
  }
  function ncPrefsPatch(patch) { if (nc.email) ncPrefsSave(nc.email, Object.assign(ncPrefsGet(nc.email), patch)); }
  // The server's view, normalized: an unknown pace reads as the daily digest.
  function ncAlertes() {
    var a = (nc.profil && nc.profil.alertes) || {};
    return { pace: NC_PACES.indexOf(a.pace) >= 0 ? a.pace : 'daily', urgentOnly: a.urgentOnly === true };
  }
  async function ncSaveAlertes(patch) {
    if (!nc.token) return;
    var alertes = Object.assign(ncAlertes(), patch || {});
    var res = await ncPost('/notary/profile', ncProfilBody({ alertes: alertes }));
    if (!res) { ncRenderPrefs(); return; }
    if (res.status !== 200) {
      toast((res.json.errors && res.json.errors[0] && res.json.errors[0].message) || 'Échec de l’enregistrement des préférences.');
      ncRenderPrefs(); return;
    }
    nc.profil = res.json.profil || Object.assign({}, nc.profil, { alertes: alertes });
    ncRenderPrefs();
    ncPrefsSavedNote();
  }
  function ncRenderPrefs() {
    if (!nc.email) return;
    var a = ncAlertes();
    var urg = $('pref-urgent'); if (urg) urg.checked = a.urgentOnly;
    document.querySelectorAll('#pref-pace .seg-btn').forEach(function (b) {
      var on = b.dataset.pace === a.pace; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var p = ncPrefsGet(nc.email);
    // The lender roster — the refusal axis: a notary only closes with the
    // institutions they know, so unchecking a lender HIDES its demands from
    // their feed (ncFilteredOpen). Virtual lenders are tagged so the extra
    // coordination is visible where the choice is made.
    var lendWrap = $('pref-lenders');
    if (lendWrap && !lendWrap.children.length) {
      D.LENDERS.forEach(function (l) {
        var c = el('button', 'chip chip-lender', l.nom);
        c.type = 'button'; c.dataset.lender = l.id;
        if (l.virtuel) c.appendChild(el('span', 'chip-lender-virt', 'virtuel'));
        lendWrap.appendChild(c);
      });
    }
    if (lendWrap) lendWrap.querySelectorAll('.chip').forEach(function (c) {
      var on = p.lenders[c.dataset.lender] !== false;
      c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Does this notary work with the bid's lender? A bid that predates the lender
  // question (preteur null) always passes — refusal needs a named lender.
  function ncLenderAccepted(b) {
    if (!b || !b.preteur || !nc.email) return true;
    return ncPrefsGet(nc.email).lenders[b.preteur.id] !== false;
  }

  function ncRenderAuthState() {
    var authed = !!nc.token;
    // A signed-in notary's app IS the console: the body class lets the chrome
    // drop the client doors (Carnet, Partenaires) so nothing competes with
    // the agenda. Signing out restores the full menu.
    document.body.classList.toggle('is-notary-session', authed);
    var form = $('notary-auth-form'); var view = $('notary-authed');
    if (form) form.hidden = authed;
    if (view) view.hidden = !authed;
    if (!authed) ncShowGateStep('email'); // never resurface a stale signup branch
    renderNotaryLive(); // the teaser follows the gate: shown signed-out, gone signed-in
    if (authed) {
      // Identity (courriel + Se déconnecter) lives in the header account menu
      // only — the console itself opens straight on the agenda.
      ncRenderPrefs(); // alert preferences for this notary
      ncRenderProfilBanner(); // the contact gate, said over the feed (ADR 0033)
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

  // `ready` is the domain's leadReadiness gate (required pricing answers +
  // sharing consent, ADR 0010 §3) — the demand's dossier will be handed over
  // the moment it is retained. Documents are preparation, not readiness.
  function ncReadyBadge(ready) {
    var b = el('span', 'nc-ready', T(ready ? 'Dossier prêt' : 'Dossier en préparation'));
    b.dataset.ready = ready ? 'true' : 'false';
    return b;
  }
  function ncTierPill(tier) {
    var t = D.tierById(tier || 'standard') || D.tierById('standard');
    var pill = el('span', 'pill', t.nom); pill.dataset.tier = t.id || 'standard';
    return pill;
  }
  // The lender behind the demand — the decide-before-retaining signal a notary
  // reads first (do I close with them?), with the virtual (branchless) flag.
  function ncLenderPill(preteur) {
    if (!preteur) return null;
    var pill = el('span', 'nc-lender', preteur.nom);
    if (preteur.virtuel) pill.appendChild(el('span', 'nc-lender-virt', 'Virtuel'));
    pill.title = 'Prêteur hypothécaire';
    return pill;
  }
  // Who travels for the in-person signature (ADR 0017) — the perimeter signal
  // read beside the lender before retaining. The urgency band is the outlier
  // (100 % online) and only ever reaches notaries who opted in, so it gets its
  // own accent. Six fixed compositions — each has its i18n entry.
  function ncDeplacementPill(dep) {
    if (!dep) return null;
    var txt = dep.urgence ? 'Urgence · 100 % en ligne'
      : (dep.qui === 'notaire' ? 'Chez le client' : 'À l’étude') + ' · ' +
        (dep.km < 25 ? 'moins de ' + dep.km + ' km' : '≤ ' + dep.km + ' km');
    var pill = el('span', 'nc-deplacement', txt);
    if (dep.urgence) pill.dataset.urgence = 'true';
    pill.title = 'Déplacement pour la signature';
    return pill;
  }

  // The quiet facts line under the signal pills: who lends, who travels for
  // the signature, the file code — context to read, not badges to compare.
  // The signals (tier / complexity / readiness) stay pills; these don't.
  function ncFactsRow(b) {
    var row = el('div', 'nc-card-facts');
    if (b.dateISO && b.showDate) row.appendChild(el('span', 'nc-date', dayTitle(b.dateISO)));
    var lender = ncLenderPill(b.preteur);
    if (lender) row.appendChild(lender);
    var dep = ncDeplacementPill(b.deplacement);
    if (dep) row.appendChild(dep);
    if (b.prefixe) row.appendChild(el('span', 'nc-prefixe', b.prefixe));
    // ≈ km between the demand's sector and the étude's (ADR 0025) — only when
    // the API could measure it. Approximate by design, so the sign says so.
    if (b.distanceKm != null) {
      var dist = el('span', 'nc-distance', '≈ ' + b.distanceKm + ' km');
      dist.title = 'Distance approximative de votre étude';
      row.appendChild(dist);
    }
    return row.childNodes.length ? row : null;
  }

  // The device's disclosure level for the open feed (ADR 0019).
  function ncViewGet() { return flagGet(LS_NC_VIEW) === 'detail' ? 'detail' : 'compact'; }
  function ncViewSet(v) { flagSet(LS_NC_VIEW, v === 'detail' ? 'detail' : 'compact'); }

  // Progressive disclosure (ADR 0019): the card's always-visible half is the
  // DECISION ROW — act, amount, signal pills, facts line, anything already in
  // flight, and Retenir. Everything verbose (facteurs prose, the propose /
  // documents / agenda toolbar, Décliner) folds into .nc-card-body behind a
  // « Détails » toggle; « Tout afficher » (the seg over the feed) unfolds all.
  function ncOpenCard(b) {
    var svc = D.serviceById(b.serviceId);
    var card = el('div', 'nc-card'); card.dataset.id = b.id; card.dataset.date = b.dateISO;

    // The date rides the card (ADR 0020): the feed is one chronological grid,
    // so each card says its own signing day. Today keeps the brand accent —
    // it's the day a notary can still fill.
    var when = el('div', 'nc-card-when');
    if (b.dateISO === todayISO()) when.dataset.today = 'true';
    when.appendChild(el('span', 'nc-when-date', dayShort(b.dateISO)));
    when.appendChild(el('span', 'nc-when-rel', relativeDay(b.dateISO)));
    card.appendChild(when);

    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', svc ? svc.nom : b.serviceId));
    head.appendChild(el('div', 'nc-card-amount', D.money(b.montant)));
    card.appendChild(head);

    // Signals first — the retain-or-not read.
    var meta = el('div', 'nc-card-meta');
    meta.appendChild(ncTierPill(b.tier));
    if (b.complexity) meta.appendChild(ncComplexityPill(b.complexity));
    meta.appendChild(ncReadyBadge(b.ready));
    card.appendChild(meta);
    var facts = ncFactsRow(b);
    if (facts) card.appendChild(facts);

    // What the notary already did on this demand: a proposition in flight and
    // / or a documents request — so the card tells the whole story at a glance.
    var status = ncStatusRow(b);
    if (status) card.appendChild(status);

    // A declined card collapses into one undo line until the window closes.
    if (ncPendingDeclines[b.id]) {
      card.classList.add('is-declining');
      var undoRow = el('div', 'nc-undo-row');
      undoRow.appendChild(el('span', 'nc-undo-lbl', 'Déclinée'));
      var undo = el('button', 'btn btn-sm nc-undo', 'Annuler'); undo.type = 'button';
      undoRow.appendChild(undo);
      card.appendChild(undoRow);
      return card;
    }

    var detailView = ncViewGet() === 'detail';
    var unfolded = detailView || !!nc.openDetails[b.id];
    var body = el('div', 'nc-card-body'); body.id = 'nc-body-' + b.id;
    body.hidden = !unfolded;
    card.classList.toggle('is-open', unfolded);

    // The parameters that make this file easy or hard — so the notary knows if
    // the posted price fits a simple or a complex case before retaining it.
    if (b.complexity && b.complexity.factors && b.complexity.factors.length) {
      // Each factor is a composed domain string ("label : option") — translate
      // it whole (the dictionary carries every composition) so an English boot
      // never shows a French factor; the "Facteurs :" prefix is the DOM
      // layer's pattern. The lender and déplacement factors are skipped: the
      // facts line above already states both — repeating them in prose was
      // the card's longest noise.
      var factors = b.complexity.factors.filter(function (f) {
        if (b.preteur && /^Prêteur hypothécaire :/.test(f)) return false;
        if (b.deplacement && /^Déplacement pour la signature :/.test(f)) return false;
        return true;
      });
      if (factors.length) body.appendChild(el('div', 'nc-factors', 'Facteurs : ' + factors.map(T).join(' · ')));
    }

    // Quiet toolbar (make-more-money / de-risk, then the agenda menu) — folded
    // with the prose: it belongs to the studied read, not the scan.
    var more = el('div', 'nc-card-more');
    if (!b.proposition || b.proposition.status === 'refusee') {
      var prop = el('button', 'btn btn-sm nc-propose-btn', 'Proposer un prix'); prop.type = 'button';
      prop.setAttribute('aria-expanded', 'false');
      more.appendChild(prop);
    }
    var docs = el('button', 'btn btn-sm nc-docs-btn', 'Demander des documents'); docs.type = 'button';
    docs.setAttribute('aria-expanded', 'false');
    more.appendChild(docs);
    more.appendChild(ncAgendaMenu(b));
    body.appendChild(more);
    card.appendChild(body);

    var actions = el('div', 'nc-card-actions');
    // Retenir is THE action of the pane — full-size primary; everything else
    // stays small so the confirm reads first. The click opens the confirm
    // SHEET (ncOpenRetainSheet, ADR 0033); the sheet's primary accepts.
    var acc = el('button', 'btn btn-primary nc-accept', 'Retenir'); acc.type = 'button';
    var dec = el('button', 'btn btn-sm nc-decline', 'Décliner'); dec.type = 'button';
    actions.appendChild(acc); actions.appendChild(dec);
    // The per-card disclosure — pointless when the seg already unfolds all.
    if (!detailView) {
      var tog = el('button', 'btn btn-sm btn-ghost nc-toggle', unfolded ? 'Réduire' : 'Détails'); tog.type = 'button';
      tog.setAttribute('aria-expanded', unfolded ? 'true' : 'false');
      tog.setAttribute('aria-controls', body.id);
      actions.appendChild(tog);
    }
    card.appendChild(actions);
    return card;
  }

  // Flip one card's disclosure in place (no re-render: an open inline form or
  // an armed confirm must survive the fold of a sibling block).
  function ncToggleCard(card) {
    var id = card.dataset.id;
    var body = card.querySelector('.nc-card-body'); if (!body) return;
    var open = body.hidden; // folded → open it
    body.hidden = !open;
    card.classList.toggle('is-open', open);
    if (open) nc.openDetails[id] = true; else delete nc.openDetails[id];
    var tog = card.querySelector('.nc-toggle');
    if (tog) { tog.textContent = T(open ? 'Réduire' : 'Détails'); tog.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  }

  // Pills for what already happened on a demand (proposition / documents).
  function ncStatusRow(b) {
    var row = el('div', 'nc-status');
    var p = b.proposition;
    if (p) {
      var labels = { en_attente: 'en attente', acceptee: 'acceptée', refusee: 'refusée' };
      var pill = el('span', 'nc-pill nc-prop-pill'); pill.dataset.status = p.status || 'en_attente';
      pill.appendChild(el('span', null, 'Proposition envoyée'));
      pill.appendChild(document.createTextNode(' · '));
      pill.appendChild(el('span', 'nc-pill-amt', D.money(p.montant)));
      pill.appendChild(document.createTextNode(' · '));
      pill.appendChild(el('span', null, labels[p.status] || labels.en_attente));
      row.appendChild(pill);
    }
    var d = b.demande;
    if (d) {
      var n = (d.documents || []).length;
      var dp = el('span', 'nc-pill nc-docs-pill'); dp.dataset.fournie = d.fournie ? 'true' : 'false';
      dp.appendChild(el('span', null, d.fournie ? 'Documents fournis' : 'Documents demandés'));
      dp.appendChild(document.createTextNode(' · '));
      dp.appendChild(el('span', 'nc-pill-n', String(n)));
      if (d.createdAt) {
        dp.appendChild(document.createTextNode(' · '));
        dp.appendChild(el('span', null, 'le ' + dayShort(String(d.createdAt).slice(0, 10)).replace(/^\S+\s/, '')));
      }
      row.appendChild(dp);
    }
    return row.childNodes.length ? row : null;
  }

  // "Agenda ▾" — the same three deeplinks the client gets (Google / Outlook /
  // .ics) for this one signing day; a <details> menu, no JS.
  function ncAgendaMenu(b) {
    var links = calendarLinks(b);
    var d = el('details', 'nc-agenda');
    var sum = el('summary', 'btn btn-sm nc-agenda-sum', 'Agenda');
    d.appendChild(sum);
    var menu = el('div', 'nc-agenda-menu');
    function item(label, href, download) {
      var a = el('a', 'nc-agenda-item', label); a.href = href;
      if (download) a.setAttribute('download', download);
      else { a.target = '_blank'; a.rel = 'noopener'; }
      menu.appendChild(a);
    }
    item('Google', links.gcal);
    item('Outlook', links.outlook);
    item('.ics', links.ics, 'nota-' + b.dateISO + '.ics');
    d.appendChild(menu);
    return d;
  }

  // --- The contact gate (ADR 0033) -------------------------------------------
  // A client must be able to call and find the notary who retains them, so
  // nom / téléphone / adresse are required to retain or propose. The domain
  // holds the rule (notaryContactMissing); the API enforces it (403
  // profil_incomplet); the console says it over the feed and turns every
  // Retenir / Proposer into a door to the form until it is filled.
  function ncProfilRefusal(j) { return !!(j && j.errors && j.errors[0] && j.errors[0].code === 'profil_incomplet'); }
  // What the profile lacks: what the server last said (it wins until the next
  // feed load refreshes the profile), else the domain's own reading.
  function ncProfilManquants() {
    if (Array.isArray(nc.manquantsServeur) && nc.manquantsServeur.length) return nc.manquantsServeur;
    return D.notaryContactMissing(nc.profil || {});
  }
  function ncProfilIncomplet() { return ncProfilManquants().length > 0; }
  function ncProfilGate(j) {
    var e = j && j.errors && j.errors[0];
    if (e && Array.isArray(e.manquants) && e.manquants.length) nc.manquantsServeur = e.manquants;
    ncCloseRetainSheet(); // a modal would trap the focus the door needs
    ncRenderProfilBanner();
    ncOpenProfilDoor();
    toast((e && e.message) || 'Complétez votre profil (nom, téléphone, adresse de l’étude) avant de retenir une demande.');
  }
  // Open the profile panel on the first missing field.
  function ncOpenProfilDoor() {
    var panel = $('notary-profil'); if (!panel) return;
    panel.open = true;
    var missing = ncProfilManquants();
    var first = (missing.length && $('nc-' + missing[0].id)) || $('nc-nom');
    if (!first) return;
    if (first.scrollIntoView) { try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    try { first.focus({ preventScroll: true }); } catch (e) { try { first.focus(); } catch (e2) {} }
  }
  function ncRenderProfilBanner() {
    var box = $('nc-profil-banner'); if (!box) return;
    var missing = nc.token ? ncProfilManquants() : [];
    box.hidden = !missing.length;
    var list = $('nc-profil-manquants');
    if (list) { clear(list); missing.forEach(function (m) { list.appendChild(el('li', null, m.label || m.id)); }); }
  }

  // --- Retenir: the confirm sheet (ADR 0033) ---------------------------------
  // One <dialog> on the shared popup shell, filled from the card and from
  // `conditions` (GET /notary/bids) — the whole engagement read back before
  // the POST: fee paid in full at signing, the client's separate Nota price,
  // déplacement / secteur / distance, lender, dossier readiness, the
  // cancellation barème on THIS montant (compensation to the notary), the
  // free-but-counted withdrawal, and what each party receives. Money never
  // comes from the console's own arithmetic beyond taux × montant: a missing
  // barème hides its section rather than guessing one.
  var ncSheetBid = null;
  function ncSetText(id, text) { var e = $(id); if (!e) return null; clear(e); if (text != null) e.appendChild(document.createTextNode(String(text))); return e; }
  function ncPct(taux) { return Math.round(Number(taux) * 100) + ' %'; }
  function ncOpenRetainSheet(b) {
    var dlg = $('nc-retenir-dialog'); if (!dlg || !b) return;
    ncSheetBid = b;
    var svc = D.serviceById(b.serviceId);
    ncSetText('nc-retenir-svc', svc ? svc.nom : b.serviceId);
    ncSetText('nc-retenir-date', dayTitle(b.dateISO) + ' · ' + relativeDay(b.dateISO));
    ncSetText('nc-retenir-fee', D.money(b.montant));
    ncSetText('nc-retenir-go-amt', D.money(b.montant));
    // The client's Nota price: `conditions.tarifNota` (ADR 0033) or the feed's
    // `tarif` (ADR 0031) — the same object. Absent → said in words, no figure.
    var tarif = (nc.conditions && nc.conditions.tarifNota) || nc.tarif;
    var nota = ncSetText('nc-retenir-nota', null);
    if (nota) {
      if (tarif && typeof tarif.prixNotaCents === 'number') nota.appendChild(document.createTextNode(D.money(Math.round(tarif.prixNotaCents) / 100)));
      else nota.appendChild(el('span', 'nc-retenir-sub', 'un montant fixe, le même pour tous'));
    }
    // Déplacement · secteur · distance — the same facts as the card, in the
    // same words (each its own node so the dictionary can translate them).
    var dep = ncSetText('nc-retenir-dep', null);
    if (dep) {
      var parts = [];
      var dp = ncDeplacementPill(b.deplacement); if (dp) parts.push(dp);
      if (b.prefixe) parts.push(el('span', 'nc-prefixe', b.prefixe));
      if (b.distanceKm != null) parts.push(el('span', 'nc-distance', '≈ ' + b.distanceKm + ' km'));
      if (!parts.length) parts.push(el('span', 'nc-retenir-sub', 'Non précisé'));
      parts.forEach(function (p, i) { if (i) dep.appendChild(document.createTextNode(' · ')); dep.appendChild(p); });
    }
    var lender = ncSetText('nc-retenir-lender', null);
    if (lender) {
      var lp = ncLenderPill(b.preteur);
      lender.appendChild(lp || el('span', 'nc-retenir-sub', 'Non précisé'));
    }
    var dossier = ncSetText('nc-retenir-dossier', null);
    if (dossier) {
      dossier.appendChild(ncReadyBadge(b.ready));
      var missing = (b.missing || []).map(String).filter(Boolean);
      if (missing.length) {
        dossier.appendChild(document.createTextNode(' '));
        var miss = el('span', 'nc-retenir-missing');
        miss.appendChild(el('span', null, 'Il manque :'));
        miss.appendChild(document.createTextNode(' '));
        missing.forEach(function (m, i) { if (i) miss.appendChild(document.createTextNode(', ')); miss.appendChild(el('span', null, m)); });
        dossier.appendChild(miss);
      }
    }
    // The barème, computed on THIS montant. Bands come sorted by maxJours;
    // beyond the last one the cancellation is free.
    var sec = $('nc-retenir-annulation');
    var ul = $('nc-retenir-bareme');
    var paliers = nc.conditions && nc.conditions.annulation && Array.isArray(nc.conditions.annulation.paliers)
      ? nc.conditions.annulation.paliers.filter(function (p) { return p && p.maxJours != null && p.taux != null; }) : [];
    if (sec) sec.hidden = !paliers.length;
    if (ul) {
      clear(ul);
      paliers.sort(function (x, y) { return Number(x.maxJours) - Number(y.maxJours); });
      var from = 0;
      var band = function (days, rate, amount, free) {
        var li = el('li', 'nc-bareme-row' + (free ? ' nc-bareme-free' : ''));
        li.appendChild(el('span', 'nc-bareme-days', days));
        li.appendChild(document.createTextNode(' '));
        li.appendChild(el('span', null, 'jours avant la signature'));
        li.appendChild(document.createTextNode(' : '));
        li.appendChild(el('span', 'nc-bareme-rate', rate));
        if (amount != null) { li.appendChild(document.createTextNode(' · '));
          li.appendChild(el('span', 'nc-bareme-amt', amount)); }
        ul.appendChild(li);
      };
      paliers.forEach(function (p) {
        var max = Number(p.maxJours);
        band(from === max ? String(max) : from + '–' + max, ncPct(p.taux), D.money(Math.round(Number(b.montant) * Number(p.taux))), false);
        from = max + 1;
      });
      if (paliers.length) band(from + '+', 'gratuit', null, true);
    }
    if (dlg.showModal && !dlg.open) { try { dlg.showModal(); } catch (e) { dlg.open = true; } }
    else dlg.open = true;
    var go = $('nc-retenir-go');
    if (go) { go.disabled = false; try { go.focus({ preventScroll: true }); } catch (e) {} }
  }
  function ncCloseRetainSheet() {
    var dlg = $('nc-retenir-dialog'); if (!dlg) return;
    ncSheetBid = null;
    if (dlg.open) { try { dlg.close(); } catch (e) { dlg.open = false; } }
  }
  async function ncConfirmRetainSheet() {
    var b = ncSheetBid; if (!b) return;
    var go = $('nc-retenir-go'); if (go) go.disabled = true;
    try { await ncAccept(b.id, b.dateISO, b); }
    finally { if (go) go.disabled = false; ncCloseRetainSheet(); }
  }

  // « Marquer complété » writes the WRITE-ONCE act ledger — the same two-step
  // register as Retenir: the first click arms a confirm that reads the value
  // back, the second settles. The domain bounds the value against the retained
  // offer before anything is armed (a typo dies here, not in the ledger).
  function ncArmComplete(card) {
    var btn = card.querySelector('.nc-complete-btn');
    if (!btn || card.dataset.confirm === '1') return;
    var input = card.querySelector('.nc-actval');
    var v = D.validateActValue({
      actAmount: input ? input.value : null,
      retainedMontant: input && input.dataset.ref ? Number(input.dataset.ref) : null,
    });
    if (!v.ok) { toast(v.errors[0].message); return; }
    card.dataset.confirm = '1';
    clear(btn);
    btn.appendChild(el('span', null, 'Confirmer'));
    btn.appendChild(document.createTextNode(' · '));
    btn.appendChild(el('span', 'nc-complete-amt', D.money(v.actAmount)));
    var cancel = el('button', 'btn btn-sm btn-ghost nc-complete-cancel', 'Annuler'); cancel.type = 'button';
    btn.insertAdjacentElement('afterend', cancel);
    try { btn.focus({ preventScroll: true }); } catch (e) {}
  }
  function ncDisarmComplete(card) {
    if (!card || card.dataset.confirm !== '1') return;
    delete card.dataset.confirm;
    var btn = card.querySelector('.nc-complete-btn'); if (btn) btn.textContent = 'Marquer complété';
    var cancel = card.querySelector('.nc-complete-cancel'); if (cancel) cancel.parentNode.removeChild(cancel);
  }

  function ncFormErrors(form, errors) {
    var box = form.querySelector('.nc-form-errors'); if (!box) return;
    clear(box);
    var list = errors || [];
    box.hidden = !list.length;
    list.forEach(function (e) { box.appendChild(el('li', null, e.message || String(e))); });
  }

  // Toggle an inline form under the card; one open form per card at a time.
  function ncToggleForm(card, btn, cls, build) {
    var existing = card.querySelector('form.' + cls);
    card.querySelectorAll('form.nc-inline').forEach(function (f) { f.parentNode.removeChild(f); });
    card.querySelectorAll('.nc-card-more [aria-expanded]').forEach(function (x) { x.setAttribute('aria-expanded', 'false'); });
    if (existing) return;
    var form = build();
    form.classList.add('nc-inline');
    card.appendChild(form);
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var first = form.querySelector('input, textarea');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }

  function ncProposeForm(b) {
    var form = el('form', 'nc-propose'); form.noValidate = true;
    form.appendChild(el('div', 'nc-form-h', 'Proposer un prix au client'));
    var row = el('div', 'nc-form-row');
    var lbl = el('label', 'nc-form-lbl');
    lbl.appendChild(el('span', 'nc-form-cap', 'Votre prix'));
    var amt = el('input', 'nc-propose-amt'); amt.type = 'number'; amt.name = 'montant'; amt.step = '1';
    amt.min = String((Math.round(Number(b.montant)) || 0) + 1); amt.setAttribute('inputmode', 'numeric');
    amt.value = String(D.suggestedCounterOffer(b));
    lbl.appendChild(amt); row.appendChild(lbl);
    var delta = el('span', 'nc-propose-delta'); row.appendChild(delta);
    form.appendChild(row);
    var msg = el('textarea', 'nc-form-msg'); msg.name = 'message'; msg.maxLength = 500; msg.rows = 2;
    msg.placeholder = 'Message au client (facultatif)';
    form.appendChild(msg);
    var errs = el('ul', 'errors nc-form-errors'); errs.hidden = true; errs.setAttribute('role', 'alert'); form.appendChild(errs);
    var foot = el('div', 'nc-form-foot');
    var send = el('button', 'btn btn-sm btn-primary nc-propose-send', 'Envoyer la proposition'); send.type = 'submit';
    var cancel = el('button', 'btn btn-sm btn-ghost nc-form-cancel', 'Annuler'); cancel.type = 'button';
    foot.appendChild(send); foot.appendChild(cancel); form.appendChild(foot);

    function validate() {
      var v = D.validateCounterOffer({ bid: b, montant: amt.value, todayISO: todayISO() });
      ncFormErrors(form, v.errors);
      delta.textContent = v.ok && v.delta > 0 ? '+' + D.money(v.delta) : '';
      return v;
    }
    amt.addEventListener('input', validate);
    cancel.addEventListener('click', function () { form.parentNode.removeChild(form); });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = validate(); if (!v.ok) return;
      send.disabled = true;
      var res = await ncPropose(b.id, b.dateISO, v.montant, msg.value.trim());
      send.disabled = false;
      if (!res.ok && res.errors.length) ncFormErrors(form, res.errors);
    });
    validate();
    return form;
  }

  function ncDocsForm(b) {
    var form = el('form', 'nc-docs'); form.noValidate = true;
    form.appendChild(el('div', 'nc-form-h', 'Demander des documents au client'));
    var missing = (b.missing || []).map(String);
    var list = el('div', 'nc-docs-list');
    D.requestableItems(b.serviceId).forEach(function (it) {
      var lbl = el('label', 'nc-docs-item');
      var cb = el('input'); cb.type = 'checkbox'; cb.name = 'documents'; cb.value = it.id;
      var isMissing = missing.indexOf(it.nom) >= 0 || missing.indexOf(it.id) >= 0;
      cb.checked = isMissing;
      lbl.appendChild(cb);
      lbl.appendChild(el('span', 'nc-docs-name', it.nom));
      if (isMissing) lbl.appendChild(el('span', 'nc-missing', 'manquant'));
      list.appendChild(lbl);
    });
    form.appendChild(list);
    var msg = el('textarea', 'nc-form-msg'); msg.name = 'message'; msg.maxLength = 500; msg.rows = 2;
    msg.placeholder = 'Message au client (facultatif)';
    form.appendChild(msg);
    var errs = el('ul', 'errors nc-form-errors'); errs.hidden = true; errs.setAttribute('role', 'alert'); form.appendChild(errs);
    var foot = el('div', 'nc-form-foot');
    var send = el('button', 'btn btn-sm btn-primary nc-docs-send', 'Envoyer la demande'); send.type = 'submit';
    var cancel = el('button', 'btn btn-sm btn-ghost nc-form-cancel', 'Annuler'); cancel.type = 'button';
    foot.appendChild(send); foot.appendChild(cancel); form.appendChild(foot);
    cancel.addEventListener('click', function () { form.parentNode.removeChild(form); });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var ids = [].slice.call(form.querySelectorAll('input[name="documents"]:checked')).map(function (x) { return x.value; });
      var v = D.validateDocumentRequest({ serviceId: b.serviceId, documents: ids, message: msg.value });
      ncFormErrors(form, v.errors); if (!v.ok) return;
      send.disabled = true;
      var res = await ncRequestDocuments(b.id, b.dateISO, ids, msg.value.trim());
      send.disabled = false;
      if (!res.ok && res.errors.length) ncFormErrors(form, res.errors);
    });
    return form;
  }

  function ncComplexityPill(c) {
    var labels = { simple: 'Cas simple', standard: 'Cas standard', complexe: 'Cas complexe' };
    var pill = el('span', 'nc-complexity', labels[c.level] || c.level);
    pill.dataset.level = c.level;
    return pill;
  }

  // Filter chips over the open agenda: Tous + one per act (only acts with an
  // open demand, counts included) + "complete file only". State in nc.filter.
  function ncRenderFilter() {
    var wrap = $('notary-open-filter'); if (!wrap) return; clear(wrap);
    var f = nc.filter;
    if (!nc.open.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    function chip(label, svcId, on, extra) {
      var c = el('button', 'chip sm' + (on ? ' is-on' : '') + (extra ? ' ' + extra : ''));
      c.type = 'button'; c.dataset.svc = svcId; c.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (typeof label === 'string') c.textContent = label; else label.forEach(function (n) { c.appendChild(n); });
      wrap.appendChild(c); return c;
    }
    chip('Tous', 'all', f.service === 'all');
    D.SERVICES.forEach(function (s) {
      var n = nc.open.filter(function (b) { return b.serviceId === s.id; }).length;
      if (!n) return;
      var parts = []; var ic = svcIcon(s.id, 12); if (ic) parts.push(ic);
      parts.push(el('span', 'chip-svc-main', s.nomCourt)); parts.push(el('span', 'chip-svc-sub', String(n)));
      chip(parts, s.id, f.service === s.id, 'chip-svc').dataset.svc = s.id;
    });
    var ready = el('button', 'chip sm nc-chip-ready' + (f.readyOnly ? ' is-on' : '')); ready.type = 'button';
    ready.textContent = 'Dossier prêt seulement'; ready.setAttribute('aria-pressed', f.readyOnly ? 'true' : 'false');
    wrap.appendChild(ready);
  }
  function ncFilteredOpen() {
    var f = nc.filter;
    return nc.open.filter(function (b) {
      if (f.service !== 'all' && b.serviceId !== f.service) return false;
      if (f.readyOnly && !b.ready) return false;
      // The lender roster (préférences) is a standing refusal: demands from a
      // lender this notary unchecked never reach their working surface.
      if (!ncLenderAccepted(b)) return false;
      return true;
    });
  }

  // The open list is the notary's AGENDA: one section per signing day (soonest
  // first — a notary competes on time), one group per act inside it, best
  // offer leading. Each day header carries the money on the table that day.
  function ncRenderOpen() {
    var list = $('notary-open-list'); if (!list) return; clear(list);
    var empty = $('notary-open-empty');
    var head = $('notary-open-h');
    ncRenderFilter();
    var all = nc.open;
    // The disclosure seg follows the filter: pointless over an empty feed,
    // pressed state mirrors the remembered device choice.
    var seg = $('notary-open-view');
    if (seg) {
      seg.hidden = !all.length;
      var view = ncViewGet();
      seg.querySelectorAll('.seg-btn').forEach(function (x) {
        var on = x.dataset.view === view;
        x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    if (head) {
      clear(head);
      head.appendChild(el('span', null, 'Demandes ouvertes'));
      if (all.length) {
        var inPlay = all.reduce(function (s, b) { return s + (Math.round(Number(b.montant)) || 0); }, 0);
        head.appendChild(document.createTextNode(' · '));
        head.appendChild(el('span', 'nc-h-n', String(all.length)));
        head.appendChild(document.createTextNode(' · '));
        head.appendChild(el('span', 'nc-h-sum'));
        head.lastChild.appendChild(el('span', 'nc-h-amt', D.money(inPlay)));
        head.lastChild.appendChild(document.createTextNode(' '));
        head.lastChild.appendChild(el('span', null, 'en jeu'));
      }
    }
    if (!all.length) { if (empty) { empty.textContent = 'Aucune demande ouverte pour l’instant.'; empty.hidden = false; } return; }
    var days = D.agendaByDate(ncFilteredOpen());
    if (!days.length) { if (empty) { empty.textContent = 'Aucune demande ne correspond à ce filtre.'; empty.hidden = false; } return; }
    if (empty) empty.hidden = true;
    // The date is an attribute of the demand, not a layout axis (ADR 0020):
    // the day strip sums each signing day (and filters on click); the cards
    // pack ONE responsive grid chronologically, each carrying its own date.
    if (nc.filter.day && !days.some(function (d) { return d.dateISO === nc.filter.day; })) nc.filter.day = null;
    list.appendChild(ncDayStrip(days));
    var grid = el('div', 'nc-grid nc-agenda-grid');
    days.forEach(function (day) {
      if (nc.filter.day && day.dateISO !== nc.filter.day) return;
      day.services.forEach(function (s) {
        s.bids.forEach(function (b) { grid.appendChild(ncOpenCard(b)); });
      });
    });
    list.appendChild(grid);
  }

  // The day rail: one mini calendar cell per signing day — weekday over the
  // day number, the day's money under it, the count as a corner badge. One
  // finger/wheel-scrollable row at every width: a dozen days must never wall
  // the first demand below the fold (owner, 2026-08-27). Each cell is a
  // toggle: press to keep only that day, press again for all; while a day is
  // held the rest of the rail dims.
  function ncDayStrip(days) {
    var strip = el('div', 'nc-days');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Filtrer par jour');
    strip.classList.toggle('has-day', !!nc.filter.day);
    days.forEach(function (day) {
      var tile = el('button', 'nc-daytile'); tile.type = 'button'; tile.dataset.date = day.dateISO;
      var on = nc.filter.day === day.dateISO;
      tile.classList.toggle('is-on', on);
      tile.setAttribute('aria-pressed', on ? 'true' : 'false');
      // The visible cell is terse; the accessible name says the whole line.
      tile.setAttribute('aria-label',
        dayTitle(day.dateISO) + ' (' + relativeDay(day.dateISO) + ') — ' +
        day.count + ' ' + (day.count > 1 ? 'demandes' : 'demande') + ' · ' + D.money(day.total));
      // Today is the day a notary can still fill — its marker gets the accent.
      if (day.dateISO === todayISO()) tile.dataset.today = 'true';
      var cal = el('span', 'nc-daytile-cal');
      cal.appendChild(el('span', 'nc-daytile-wd', weekdayShort(day.dateISO)));
      cal.appendChild(el('span', 'nc-daytile-num', String(Number(day.dateISO.slice(8, 10)))));
      cal.appendChild(el('span', 'nc-daytile-mo', monthShort(day.dateISO)));
      tile.appendChild(cal);
      tile.appendChild(el('span', 'nc-daytile-sum nc-day-total', D.money(day.total)));
      var badge = el('span', 'nc-day-badge'); badge.setAttribute('aria-hidden', 'true');
      badge.appendChild(el('span', 'nc-day-count', String(day.count)));
      tile.appendChild(badge);
      strip.appendChild(tile);
    });
    return strip;
  }

  function ncDossierBlock(entry) {
    var wrap = el('div', 'nc-dossier');
    wrap.appendChild(el('div', 'nc-dossier-h', 'Dossier du client'));
    var svc = D.serviceById(entry.serviceId);
    var rows = el('dl', 'nc-kv');
    function kv(k, v) { rows.appendChild(el('dt', null, k)); rows.appendChild(el('dd', null, v)); }
    // The client's contact block lives at the top of the card (ncClientBlock,
    // ADR 0033) — this block is the FILE: answers, documents, consent.
    var d = entry.dossier || {};
    if (svc) {
      svc.champs.forEach(function (c) { if (d[c.id]) kv(c.label, String(d[c.id])); });
      svc.documents.forEach(function (doc) {
        if (!d[doc.id]) return;
        // A client can satisfy an item outside Nota (the notary's own portal,
        // courriel) — show that state in words, never the raw token.
        kv(doc.nom, d[doc.id] === D.DOSSIER_TRANSMIS
          ? 'Transmis par un autre canal'
          : String(d[doc.id]) + ' · transmis à la signature');
      });
    }
    kv('Consentement de partage', d.__consent ? 'Oui' : 'Non');
    wrap.appendChild(rows);
    return wrap;
  }

  // The "mark act completed" block on each retained dossier card. Once done, it
  // montre les deux lignes que l'API a réellement inscrites au registre.
  function ncCompleteBlock(entry) {
    var wrap = el('div', 'nc-complete');
    if (entry.completed) {
      var done = el('div', 'nc-complete-done');
      done.appendChild(el('span', 'nc-done-badge', 'Acte complété'));
      done.appendChild(el('span', 'nc-done-fee',
        'Vos honoraires ' + D.money(entry.actAmount) + ' · service Nota payé par le client ' + D.money((entry.commissionCents || 0) / 100)));
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
    // The retained offer rides on the field so the armed confirm can bound the
    // value (domain rule) before anything reaches the write-once ledger.
    if (entry.montant != null) input.dataset.ref = String(entry.montant);
    // The field arrives prefilled: focus selects it whole, so typing REPLACES
    // the figure — never appends to it (4600 → 46004600 was one keystroke away).
    input.addEventListener('focus', function () { try { input.select(); } catch (e) {} });
    // Editing the value disarms a pending confirm — the armed figure is stale.
    input.addEventListener('input', function () { ncDisarmComplete(input.closest('.nc-card')); });
    lbl.appendChild(input);
    var btn = el('button', 'btn btn-sm btn-primary nc-complete-btn', 'Marquer complété');
    btn.type = 'button';
    row.appendChild(lbl); row.appendChild(btn);
    wrap.appendChild(row);
    wrap.appendChild(el('p', 'help', 'À cette étape, vos honoraires vous sont virés en entier. Nota facture son service au client, séparément.'));
    return wrap;
  }
  // A small stroked glyph (currentColor) for the contact links.
  function ncGlyph(paths, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size || 14)); svg.setAttribute('height', String(size || 14));
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }
  var NC_GLYPH_PHONE = ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6.3 6.3l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z'];
  var NC_GLYPH_MAIL = ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'm2 7 10 7 10-7'];

  // « Votre client » (ADR 0033) — the mise en relation is complete: the
  // client's name, a tel: link (the phone is there to be dialled), a mailto,
  // then the facts that frame the signing — secteur, déplacement, distance,
  // prêteur. First thing on the card: the conversation starts with knowing
  // who is on the other side.
  function ncClientBlock(entry) {
    var wrap = el('div', 'nc-client');
    wrap.appendChild(el('div', 'nc-dossier-h', 'Votre client'));
    var client = entry.client || {};
    var courriel = client.courriel || entry.courriel || null;
    var tel = client.telephone || null;
    if (client.nom) wrap.appendChild(el('div', 'nc-client-nom', client.nom));
    var links = el('div', 'nc-client-links');
    if (tel) {
      var a = el('a', 'nc-client-tel'); a.href = D.telHref(tel) || ('tel:' + tel);
      a.appendChild(ncGlyph(NC_GLYPH_PHONE, 14)); a.appendChild(el('span', null, tel));
      links.appendChild(a);
    }
    if (courriel) {
      var m = el('a', 'nc-client-mail'); m.href = 'mailto:' + courriel;
      m.appendChild(ncGlyph(NC_GLYPH_MAIL, 14)); m.appendChild(el('span', null, courriel));
      links.appendChild(m);
    }
    if (!tel && !courriel) links.appendChild(el('span', 'help', 'Coordonnées en attente de la prochaine mise à jour.'));
    wrap.appendChild(links);
    var facts = ncFactsRow({ preteur: entry.preteur, deplacement: entry.deplacement, prefixe: entry.prefixe, distanceKm: entry.distanceKm });
    if (facts) { facts.classList.add('nc-client-facts'); wrap.appendChild(facts); }
    return wrap;
  }

  function ncRetainedCard(entry) {
    var svc = D.serviceById(entry.serviceId);
    var card = el('div', 'nc-card is-retained'); card.dataset.id = entry.id; card.dataset.date = entry.dateISO || '';
    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', svc ? svc.nom : entry.serviceId));
    // Unread client messages (ADR 0033): the badge rides the head, beside
    // the act's name — the first thing a scan reads.
    var unread = ncUnreadCount(entry);
    if (unread) { head.appendChild(ncUnreadBadge(unread)); card.dataset.unread = String(unread); }
    head.appendChild(el('div', 'nc-card-amount', D.money(entry.montant)));
    card.appendChild(head);
    var meta = el('div', 'nc-card-meta');
    meta.appendChild(ncTierPill(entry.tier));
    meta.appendChild(el('span', 'pill pill-retenue', 'Retenue'));
    if (entry.viaProposition) meta.appendChild(el('span', 'nc-pill nc-via-prop', 'Prix accepté sur proposition'));
    if (entry.completed) meta.appendChild(el('span', 'nc-done-badge', 'Acte complété'));
    card.appendChild(meta);
    // Retained cards live in a flat list (no day sections), so the signing
    // date leads; the lender / déplacement facts moved under « Votre client ».
    var facts = ncFactsRow({ dateISO: entry.dateISO, showDate: true });
    if (facts) card.appendChild(facts);
    var status = ncStatusRow({ demande: entry.demande });
    if (status) card.appendChild(status);
    // Who the client is, then the conversation, then the file (ADR 0033).
    card.appendChild(ncClientBlock(entry));
    card.appendChild(ncChatBlock(entry));
    card.appendChild(ncDossierBlock(entry));
    // A retaining notary may still ask for what the dossier lacks, and block
    // the day in their own agenda.
    var more = el('div', 'nc-card-more');
    var docs = el('button', 'btn btn-sm nc-docs-btn', 'Demander des documents'); docs.type = 'button';
    docs.setAttribute('aria-expanded', 'false');
    more.appendChild(docs);
    more.appendChild(ncAgendaMenu(entry));
    card.appendChild(more);
    card.appendChild(ncCompleteBlock(entry));
    // Withdrawing stays possible until the act completes: a surfaced detail
    // (prêteur inhabituel, conflit) can still make the file impossible.
    if (!entry.completed) card.appendChild(ncReleaseBlock(entry));
    return card;
  }

  // --- The retained-act conversation (client ↔ notaire) ----------------------
  // Rendered from the entry's server-merged `messages`; refreshed by every
  // ncLoadBids (sign-in, tab switch, window focus, the poll, after a send).
  // Shared by both sides (ADR 0033): the thread, its timestamps and the
  // composer are ONE construction — client and notary read the same thing.
  //
  // « 3 sept. · 14:32 » — the day from dayShort, the LOCAL time of day when
  // the stamp carries one (a date-only stamp keeps just the day).
  function whenLabel(iso) {
    var s = String(iso || '');
    if (!s) return '';
    var day = dayShort(s.slice(0, 10));
    if (s.length <= 10) return day;
    var d = new Date(s);
    if (isNaN(d.getTime())) return day;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return day + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function chatThread(messages, mineRole) {
    var box = el('div', 'chat-thread');
    var list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      box.appendChild(el('p', 'chat-empty', 'Aucun message pour l’instant. Écrivez le premier.'));
      return box;
    }
    list.forEach(function (m) {
      var row = el('div', 'chat-msg');
      row.dataset.de = m.de;
      row.classList.toggle('is-mine', m.de === mineRole);
      var bubble = el('div', 'chat-bubble', m.texte);
      row.appendChild(bubble);
      var when = whenLabel(m.createdAt);
      if (when) row.appendChild(el('span', 'chat-when', when));
      box.appendChild(row);
    });
    // The newest message is what the reader came for: once the thread is in
    // the document (the caller appends it after this returns), rest at the end.
    setTimeout(function () { try { box.scrollTop = box.scrollHeight; } catch (e) {} }, 0);
    return box;
  }

  // The write box: an auto-growing textarea, Enter sends (Shift+Enter breaks
  // the line), a « N / max » counter from CHAT_COUNT_FROM, a busy state that
  // says « Envoi… », and an inline error (never only a toast). `onSend(texte)`
  // returns (a promise of) `{ ok, message }` or a boolean; a refusal shows the
  // message and keeps the draft. Returns { el, input, button, setBusy, setError }.
  var CHAT_COUNT_FROM = 400;
  function chatComposer(opts) {
    opts = opts || {};
    var max = Number(opts.maxLength) > 0 ? Number(opts.maxLength) : (D.CHAT_MESSAGE_MAX || 500);
    var wrap = el('div', 'chat-write');
    var row = el('div', 'chat-row chat-composer');
    var input = el('textarea', 'chat-input');
    input.rows = 1; input.maxLength = max;
    input.placeholder = opts.placeholder || 'Écrire un message…';
    input.setAttribute('aria-label', opts.ariaLabel || opts.placeholder || 'Écrire un message');
    var button = el('button', 'btn btn-sm btn-primary chat-send' + (opts.sendClass ? ' ' + opts.sendClass : ''), 'Envoyer');
    button.type = 'button';
    row.appendChild(input); row.appendChild(button);
    wrap.appendChild(row);
    var meta = el('div', 'chat-meta');
    var err = el('p', 'chat-error'); err.hidden = true; err.setAttribute('role', 'alert');
    var count = el('span', 'chat-count'); count.hidden = true; count.setAttribute('aria-live', 'polite');
    meta.appendChild(err); meta.appendChild(count);
    wrap.appendChild(meta);
    var busy = false;
    function grow() {
      input.style.height = 'auto';
      var h = input.scrollHeight;
      if (h) input.style.height = Math.min(h, 160) + 'px';
    }
    function tally() {
      var n = input.value.length;
      count.hidden = n < CHAT_COUNT_FROM;
      count.textContent = count.hidden ? '' : n + ' / ' + max;
    }
    function setError(msg) {
      if (!msg) { err.hidden = true; err.textContent = ''; return; }
      err.hidden = false; err.textContent = msg;
    }
    function setBusy(b) {
      busy = !!b;
      button.disabled = busy;
      button.textContent = busy ? 'Envoi…' : 'Envoyer';
      if (busy) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
    }
    async function send() {
      if (busy) return;
      var texte = input.value.trim();
      if (!texte) { setError('Écrivez un message.'); try { input.focus(); } catch (e) {} return; }
      setError(null);
      setBusy(true);
      var res;
      try { res = await opts.onSend(texte, api); } catch (e) { res = { ok: false, message: 'Message impossible.' }; }
      setBusy(false);
      if (res === false || (res && res.ok === false)) { setError((res && res.message) || 'Message impossible.'); return; }
      input.value = ''; grow(); tally();
    }
    input.addEventListener('input', function () { grow(); tally(); setError(null); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    if (opts.onFocus) input.addEventListener('focus', opts.onFocus);
    button.addEventListener('click', send);
    var api = { el: wrap, input: input, button: button, setBusy: setBusy, setError: setError, send: send };
    return api;
  }

  // --- Les documents de la conversation (ADR 0032) ---------------------------
  //
  // UN seul chemin pour les deux parties : le client et le notaire font
  // exactement la même chose, et deux implémentations divergeraient le jour où
  // l'une des deux gagne un garde-fou.
  //
  // Le fichier ne passe JAMAIS par l'API. Le navigateur demande une
  // autorisation, téléverse directement vers le stockage, puis dit au serveur
  // de CONSTATER le dépôt. Tant que ce constat n'a pas eu lieu, l'autre partie
  // ne voit rien : une pièce annoncée n'est pas une pièce reçue.
  //
  // Le refus de format ou de taille est LOCAL, avant tout téléversement — faire
  // échouer 15 Mo après coup est la pire réponse possible.
  async function envoyerDocument(ctx, file, onEtat) {
    var v = D.validateDossierFile(file);
    if (!v.ok) { onEtat({ erreur: v.message }); return null; }

    onEtat({ etape: 'autorisation' });
    var ouverture = await ctx.appel('POST', ctx.routes.depot, {
      id: ctx.id, dateISO: ctx.dateISO, nom: v.name, taille: file.size, type: file.type,
    });
    if (!ouverture.ok) { onEtat({ erreur: ouverture.message }); return null; }

    onEtat({ etape: 'televersement' });
    try {
      var mise = await fetch(ouverture.json.depot.url, {
        method: ouverture.json.depot.methode || 'PUT',
        headers: ouverture.json.depot.entetes || {},
        body: file,
      });
      if (!mise.ok) throw new Error('depot');
    } catch (e) {
      // Le document reste « en attente » côté serveur et n'apparaît nulle part.
      onEtat({ erreur: 'Le téléversement a échoué. Réessayez.' });
      return null;
    }

    onEtat({ etape: 'confirmation' });
    var conf = await ctx.appel('POST', ctx.routes.confirme, {
      id: ctx.id, dateISO: ctx.dateISO, documentId: ouverture.json.document.id,
    });
    if (!conf.ok) { onEtat({ erreur: conf.message }); return null; }
    onEtat({ etape: 'fini', document: conf.json.document });
    return conf.json.document;
  }

  // La lecture : le serveur décide, puis émet une autorisation brève. Le lien
  // n'est jamais gardé en mémoire ni mis en signet — il expire en deux minutes.
  async function ouvrirDocument(ctx, documentId) {
    var r = await ctx.appel('GET', ctx.routes.lecture
      + '?id=' + encodeURIComponent(ctx.id)
      + '&dateISO=' + encodeURIComponent(ctx.dateISO)
      + '&documentId=' + encodeURIComponent(documentId));
    if (!r.ok) { toast(r.message || 'Document indisponible.'); return; }
    window.open(r.json.lecture.url, '_blank', 'noopener');
  }

  // La liste des documents d'une conversation, et le bouton qui en ajoute un.
  // Le même rendu des deux côtés : ce que l'un envoie, l'autre le lit au même
  // endroit, sous la même forme.
  function documentsBlock(ctx, documents, onAjout) {
    var box = el('div', 'chat-docs');
    var liste = el('ul', 'chat-doc-list');
    (documents || []).forEach(function (d) {
      var li = el('li', 'chat-doc');
      li.dataset.doc = d.id;
      var b = el('button', 'chat-doc-open', d.nom);
      b.type = 'button';
      b.addEventListener('click', function () { ouvrirDocument(ctx, d.id); });
      li.appendChild(b);
      li.appendChild(el('span', 'chat-doc-meta',
        d.de === 'client' ? 'Envoyé par le client' : 'Envoyé par le notaire'));
      liste.appendChild(li);
    });
    if (!(documents || []).length) {
      liste.appendChild(el('li', 'chat-doc-vide', 'Aucun document échangé.'));
    }
    box.appendChild(liste);

    var etat = el('p', 'chat-doc-etat');
    etat.setAttribute('aria-live', 'polite');
    var input = el('input', 'chat-doc-input');
    input.type = 'file';
    input.accept = D.DOSSIER_FILE.accept;
    var bouton = el('button', 'btn btn-sm chat-doc-add', 'Joindre un document');
    bouton.type = 'button';
    bouton.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      bouton.disabled = true;
      var doc = await envoyerDocument(ctx, file, function (e) {
        if (e.erreur) { etat.textContent = e.erreur; etat.dataset.etat = 'erreur'; return; }
        etat.dataset.etat = e.etape;
        etat.textContent = e.etape === 'autorisation' ? 'Préparation…'
          : e.etape === 'televersement' ? 'Envoi en cours…'
          : e.etape === 'confirmation' ? 'Vérification…' : 'Document envoyé.';
      });
      bouton.disabled = false;
      input.value = '';
      if (doc && onAjout) onAjout(doc);
    });
    box.appendChild(bouton);
    box.appendChild(input);
    box.appendChild(etat);
    return box;
  }

  // Le contexte de document du NOTAIRE : ses routes et son jeton de session.
  function ncDocCtx(entry) {
    return {
      id: entry.id,
      dateISO: entry.dateISO,
      routes: { depot: '/notary/bids/documents/depot', confirme: '/notary/bids/documents/confirme', lecture: '/notary/bids/documents' },
      appel: async function (method, route, body) {
        var r;
        try {
          r = await fetch(API_BASE + route, {
            method: method,
            headers: body
              ? { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token }
              : { authorization: 'Bearer ' + nc.token },
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (e) { return { ok: false, message: 'Hors ligne.' }; }
        if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return { ok: false, message: 'Session expirée.' }; }
        var j = {}; try { j = await r.json(); } catch (e) {}
        if (!r.ok) return { ok: false, message: (j.errors && j.errors[0] && j.errors[0].message) || 'Action impossible.' };
        return { ok: true, json: j };
      },
    };
  }

  // --- The notary-side thread and composer (ADR 0033) ------------------------
  // The client side owns the SHARED helpers (`chatThread`, `whenLabel`,
  // `chatComposer`); this side uses them when they exist and falls back to
  // its own construction otherwise, so the two halves ship independently.
  // Nothing here redefines a shared name.
  var NC_CHAT_MAX = D.CHAT_MESSAGE_MAX || 500;
  var NC_CHAT_COUNT_FROM = 400;
  var ncFmtWhenDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
  // « 3 sept. · 14:32 » — the day in the locale, the time in the notary's own
  // clock (a message is stamped when it was written, not on a signing day).
  function ncWhenLabel(iso) {
    if (typeof whenLabel === 'function') return whenLabel(iso);
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '').slice(0, 10);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return ncFmtWhenDay.format(d) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function ncChatThread(entry) {
    var thread = chatThread(entry.messages, 'notaire');
    // Until the shared thread stamps the time itself, do it here: one row per
    // message, in order — the same order chatThread walks.
    if (typeof whenLabel !== 'function') {
      var list = Array.isArray(entry.messages) ? entry.messages : [];
      thread.querySelectorAll('.chat-msg').forEach(function (row, i) {
        var m = list[i]; if (!m || !m.createdAt) return;
        var w = row.querySelector('.chat-when');
        if (w) w.textContent = ncWhenLabel(m.createdAt);
      });
    }
    return thread;
  }
  // The composer: one-line box that grows with the text, Enter sends
  // (Shift+Enter breaks), a « N / 500 » counter from 400, « Envoi… » while the
  // POST is out, the refusal inline. Returns { root, input, button,
  // setSending, setError, clear } — the surface ncChatSend drives.
  function ncChatComposerLocal(opts) {
    var wrap = el('div', 'nc-composer');
    var row = el('div', 'chat-row');
    var main = el('div', 'nc-composer-main');
    var input = el('textarea', 'chat-input');
    input.rows = 1; input.maxLength = NC_CHAT_MAX;
    input.placeholder = opts.placeholder;
    input.setAttribute('aria-label', opts.ariaLabel || opts.placeholder);
    var count = el('span', 'nc-chat-count'); count.hidden = true; count.setAttribute('aria-live', 'polite');
    var send = el('button', 'btn btn-sm btn-primary nc-chat-send', 'Envoyer'); send.type = 'button';
    var err = el('p', 'nc-chat-err'); err.hidden = true; err.setAttribute('role', 'alert');
    function grow() {
      input.style.height = 'auto';
      var h = input.scrollHeight;
      if (h) input.style.height = Math.min(h, 180) + 'px';
      var n = input.value.length;
      count.hidden = n < NC_CHAT_COUNT_FROM;
      count.textContent = n + ' / ' + NC_CHAT_MAX;
    }
    var api = {
      root: wrap, input: input, button: send,
      setSending: function (on) { send.disabled = !!on; send.textContent = on ? 'Envoi…' : 'Envoyer'; input.readOnly = !!on; },
      setError: function (msg) { err.hidden = !msg; err.textContent = msg || ''; },
      clear: function () { input.value = ''; grow(); },
    };
    input.addEventListener('input', function () { grow(); if (!err.hidden) api.setError(null); });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      if (!send.disabled) send.click();
    });
    if (opts.onFocus) input.addEventListener('focus', opts.onFocus);
    send.addEventListener('click', function () { if (!send.disabled) opts.onSend(input.value, api); });
    main.appendChild(input); main.appendChild(count);
    row.appendChild(main); row.appendChild(send);
    wrap.appendChild(row); wrap.appendChild(err);
    return api;
  }
  // The SHARED composer when the client side shipped it (`chatComposer`: it
  // owns busy / error / clear from what `onSend(texte, api)` returns —
  // `{ ok, message }`), tagged with the send class this console's delegation
  // and tests know (.nc-chat-send). Otherwise the local one above.
  function ncComposer(opts) {
    if (typeof chatComposer !== 'function') return ncChatComposerLocal(opts);
    var c = chatComposer({
      placeholder: opts.placeholder, ariaLabel: opts.ariaLabel, sendClass: 'nc-chat-send',
      onFocus: opts.onFocus,
      // `shared`: the composer drives its own state; ncChatSend only clears
      // the box before the repaint (so the draft carry-over never restores a
      // message that just went out) and returns the verdict.
      onSend: function (texte, api) {
        return opts.onSend(texte, { shared: true, clear: function () { if (api && api.input) api.input.value = ''; } });
      },
    });
    var root = c && c.nodeType === 1 ? c : (c && (c.el || c.root || c.element)) || null;
    if (!root) return ncChatComposerLocal(opts);
    var input = (c.input && c.input.nodeType === 1) ? c.input : root.querySelector('textarea');
    var button = (c.button && c.button.nodeType === 1) ? c.button : root.querySelector('button');
    if (input) input.classList.add('chat-input');
    if (button) button.classList.add('nc-chat-send');
    return { root: root, input: input, button: button };
  }

  function ncChatBlock(entry) {
    var wrap = el('div', 'nc-chat chat'); wrap.dataset.id = entry.id;
    wrap.appendChild(el('div', 'nc-dossier-h', 'Conversation avec le client'));
    var thread = ncChatThread(entry);
    wrap.appendChild(thread);
    // Read when the thread is actually looked at: on screen, or the composer taken.
    ncObserveThread(thread, entry);
    wrap.appendChild(documentsBlock(ncDocCtx(entry), entry.documents, function (doc) {
      ncRetainedUpdate(nc.email, entry.id, { documents: (entry.documents || []).concat([doc]) });
      ncRenderRetained();
    }));
    var composer = ncComposer({
      placeholder: 'Écrire au client…', ariaLabel: 'Écrire au client',
      onFocus: function () { ncMarkSeen(entry); },
      onSend: function (texte, ui) { ncChatSend(entry, texte, ui); },
    });
    wrap.appendChild(composer.root);
    return wrap;
  }
  // Scrolling a thread into view marks it read (ADR 0033) — where the
  // platform can tell; a jsdom or an old engine simply waits for the composer.
  function ncObserveThread(thread, entry) {
    if (typeof IntersectionObserver !== 'function' || !ncUnreadCount(entry)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) {
        if (!x.isIntersecting || x.intersectionRatio < 0.6) return;
        io.disconnect(); ncMarkSeen(entry);
      });
    }, { threshold: [0.6] });
    io.observe(thread);
  }

  // `ui` is the composer surface: the local one ({ setSending, setError,
  // clear }) is driven from here; the shared one ({ shared: true, clear })
  // drives itself from the returned `{ ok, message }`. A bare button (the old
  // call shape) still works — it is disabled while sending.
  async function ncChatSend(entry, texte, ui) {
    if (!nc.token) return { ok: false, message: 'Session expirée.' };
    if (ui && ui.nodeType === 1) { var btn = ui; ui = { setSending: function (on) { btn.disabled = !!on; } }; }
    ui = ui || {};
    var shared = ui.shared === true;
    var setSending = !shared && typeof ui.setSending === 'function' ? ui.setSending : function () {};
    var setError = !shared && typeof ui.setError === 'function' ? ui.setError : (shared ? function () {} : function (m) { if (m) toast(m); });
    var fail = function (message) { setSending(false); setError(message); return { ok: false, message: message }; };
    texte = String(texte || '').trim();
    if (!texte) return fail('Écrivez un message.');
    setError(null); setSending(true);
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify({ id: entry.id, dateISO: entry.dateISO, texte: texte }),
      });
    } catch (e) { return fail('Message impossible (hors ligne).'); }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return { ok: false, message: 'Session expirée.' }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200 || !j.message) return fail((j.errors && j.errors[0] && j.errors[0].message) || 'Message impossible.');
    setSending(false);
    if (typeof ui.clear === 'function') ui.clear();
    var messages = (entry.messages || []).concat([j.message]);
    ncRetainedUpdate(nc.email, entry.id, { messages: messages });
    ncMarkSeen(Object.assign({}, entry, { messages: messages })); // answering reads the thread
    ncRenderRetained();
    // Pull the thread fresh (the client may have written meanwhile).
    ncLoadBids();
    return { ok: true, message: j.message };
  }

  // --- The withdrawal (désistement) ------------------------------------------
  // Armed like a decline: the first click opens an inline confirm with an
  // optional reason; only "Confirmer le désistement" posts. The act returns to
  // the open market untouched and this console stops seeing it.
  function ncReleaseBlock(entry) {
    var wrap = el('div', 'nc-release'); wrap.dataset.id = entry.id;
    var open = el('button', 'link-btn nc-release-open', 'Un détail rend ce dossier impossible ? Me désister');
    open.type = 'button'; open.setAttribute('aria-expanded', 'false');
    wrap.appendChild(open);
    var form = el('div', 'nc-release-form'); form.hidden = true;
    form.appendChild(el('p', 'help', 'L’acte retourne au carnet tel que publié (même date, même montant) et le client est prévenu. Vous ne verrez plus cette demande.'));
    // ADR 0033: withdrawing costs nothing, but it is counted on the file.
    form.appendChild(el('p', 'help nc-release-terms', 'Se désister est gratuit, mais compté à votre dossier. Le client garde sa date et son offre.'));
    var motif = el('textarea', 'nc-release-motif');
    motif.rows = 2; motif.maxLength = 500;
    motif.placeholder = 'Motif (facultatif — transmis à l’équipe Nota, jamais publié)';
    motif.setAttribute('aria-label', 'Motif du désistement');
    form.appendChild(motif);
    var acts = el('div', 'nc-release-actions');
    var go = el('button', 'btn btn-sm btn-danger nc-release-confirm', 'Confirmer le désistement'); go.type = 'button';
    var no = el('button', 'btn btn-sm nc-release-cancel', 'Garder l’acte'); no.type = 'button';
    acts.appendChild(go); acts.appendChild(no);
    form.appendChild(acts);
    wrap.appendChild(form);
    return wrap;
  }

  async function ncRelease(entry, message, btn) {
    if (!nc.token) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    var r;
    try {
      r = await fetch(API_BASE + '/notary/bids/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + nc.token },
        body: JSON.stringify({ id: entry.id, dateISO: entry.dateISO, message: String(message || '').trim() || undefined }),
      });
    } catch (e) {
      toast('Désistement impossible (hors ligne).');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmer le désistement'; }
      return;
    }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      toast((j.errors && j.errors[0] && j.errors[0].message) || 'Désistement impossible.');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmer le désistement'; }
      return;
    }
    // Gone from this console: local retained entry dropped, feed reloaded
    // (the decline marker keeps the demand out of it server-side).
    ncRetainedSave(nc.email, ncRetainedFor(nc.email).filter(function (e) { return e.id !== entry.id; }));
    ncRenderRetained();
    ncLoadBids();
    toast('Acte remis au carnet. Le client est prévenu.');
  }

  // « Dossiers retenus · N » + the unread count (ADR 0033).
  function ncRenderRetainedHead() {
    var head = $('notary-retained-h'); if (!head) return;
    clear(head);
    head.appendChild(el('span', null, 'Dossiers retenus'));
    var items = nc.email ? ncRetainedFor(nc.email) : [];
    if (!items.length) return;
    head.appendChild(document.createTextNode(' · '));
    head.appendChild(el('span', 'nc-h-n', String(items.length)));
    var unread = items.reduce(function (s, e) { return s + ncUnreadCount(e); }, 0);
    if (unread) { head.appendChild(document.createTextNode(' ')); head.appendChild(ncUnreadBadge(unread)); }
  }

  function ncRenderRetained() {
    var list = $('notary-retained-list'); if (!list) return;
    // A repaint can land mid-sentence (the poll, a document, a sent message):
    // carry every draft — and the focus — across it, so the notary never
    // loses a word to a refresh (ADR 0033).
    var drafts = {};
    list.querySelectorAll('.nc-card').forEach(function (card) {
      var ta = card.querySelector('.chat-input'); if (!ta) return;
      var focused = document.activeElement === ta;
      if (ta.value || focused) drafts[card.dataset.id] = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, focused: focused };
    });
    clear(list);
    var empty = $('notary-retained-empty');
    var items = nc.email ? ncRetainedFor(nc.email) : [];
    ncRenderEarnings();
    ncRenderRetainedHead();
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    // Unread first (someone is waiting), then soonest signing first.
    items.slice().sort(function (a, b) {
      var ua = ncUnreadCount(a) > 0 ? 0 : 1, ub = ncUnreadCount(b) > 0 ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return String(a.dateISO || '').localeCompare(String(b.dateISO || ''));
    }).forEach(function (e) { list.appendChild(ncRetainedCard(e)); });
    Object.keys(drafts).forEach(function (id) {
      var card = list.querySelector('.nc-card[data-id="' + id + '"]'); if (!card) return;
      var ta = card.querySelector('.chat-input'); if (!ta) return;
      var d = drafts[id];
      if (d.value) { ta.value = d.value; ta.dispatchEvent(new Event('input', { bubbles: true })); }
      if (d.focused) {
        try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (e2) {} }
        try { ta.setSelectionRange(d.start, d.end); } catch (e) {}
      }
    });
    ncConsumeDeepAct();
  }

  // --- « #notaires&acte=<id> » (ADR 0033) --------------------------------------
  // Every act email lands here. The tab opens at boot; the card is found once
  // a feed load has painted it — in the open feed (a new-demand alert) or
  // among the retained files — then scrolled to and flashed. The parameter is
  // consumed from the URL on the spot, like a magic link.
  function ncConsumeActHash() {
    var params;
    try { params = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); } catch (e) { return false; }
    var id = params.get('acte');
    if (!id) return false;
    nc.deepAct = id;
    params.delete('acte'); params.delete('notaires');
    if (!params.has('t')) params.set('t', 'notaires');
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    state.tab = 'notaires';
    return true;
  }
  function ncConsumeDeepAct() {
    var id = nc.deepAct; if (!id) return;
    var card = document.querySelector('#notary-retained-list .nc-card[data-id="' + id + '"], #notary-open-list .nc-card[data-id="' + id + '"]');
    if (!card) return; // not painted yet — the next render tries again
    nc.deepAct = null;
    if (state.tab !== 'notaires') setTab('notaires', { scroll: false, focus: false });
    if (card.scrollIntoView) { try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    retrigger(card, 'is-flash');
    card.addEventListener('animationend', function () { card.classList.remove('is-flash'); }, { once: true });
  }

  // Le cumul des revenus du notaire (ADR 0031) : ses HONORAIRES, entiers.
  // Rien n'est soustrait — le prix de Nota est une ligne du client, payée à
  // côté, jamais une retenue sur les honoraires (art. 32.1 2° L.N., art. 32
  // C.déont.). `prixNota` est donc reporté comme un FAIT sur le dossier, pas
  // comme un terme d'une soustraction.
  function ncEarnings(email) {
    var items = email ? ncRetainedFor(email) : [];
    var e = { done: 0, honoraires: 0, prixNota: 0, pending: 0, pendingVal: 0 };
    items.forEach(function (it) {
      if (it.completed) {
        e.done++;
        e.honoraires += Number(it.actAmount) || 0;
        e.prixNota += (Number(it.commissionCents) || 0) / 100;
      } else {
        e.pending++;
        e.pendingVal += Number(it.montant) || 0;
      }
    });
    return e;
  }
  function ncRenderEarnings() {
    var box = $('notary-earnings'); if (!box) return; clear(box);
    var e = ncEarnings(nc.email);
    // The notary's own evaluation average — clients see it on every
    // proposition, so the console shows the same number, first.
    var own = ratingSpan(nc.rating);
    if (own) {
      var rrow = el('div', 'nc-own-rating');
      rrow.appendChild(own);
      rrow.appendChild(el('span', 'help', ' Votre note, telle que les clients la voient.'));
      box.appendChild(rrow);
    }
    function tile(k, v, cls) {
      var t = el('div', 'nc-stat' + (cls ? ' ' + cls : ''));
      t.appendChild(el('div', 'nc-stat-v', v));
      t.appendChild(el('div', 'nc-stat-k', k));
      return t;
    }
    // The tile grid only exists once there is money to show: a wall of zero
    // tiles under the open demands would compete with the working surface —
    // the confirmable bids — for nothing.
    if (e.done) {
      var grid = el('div', 'nc-stats');
      // Ce que le notaire GARDE se lit en premier — et c'est tout ce qu'il a
      // gagné : il n'y a pas de seconde moitié à réconcilier.
      grid.appendChild(tile('Vos honoraires', D.money(e.honoraires), 'nc-stat-net'));
      grid.appendChild(tile('Actes complétés', String(e.done)));
      box.appendChild(grid);
      // Ce que le CLIENT a payé à Nota, dit comme un fait et nommé comme tel.
      // Le notaire a le droit de le savoir — il répond de ce que la plateforme
      // facture en son nom — mais ce n'est pas une ligne de SON compte.
      box.appendChild(el('p', 'help', 'Vos clients ont payé ' + D.money(e.prixNota) + ' à Nota pour le service de la plateforme, en plus de vos honoraires. Rien n’a été retranché de ce qui vous revient.'));
    }
    if (e.pending) {
      box.appendChild(el('p', 'help', e.pending + ' dossier' + (e.pending > 1 ? 's' : '') + ' à compléter · valeur estimée ' + D.money(e.pendingVal) + '. Vos honoraires vous sont virés à la signature, en entier.'));
    } else if (!e.done) {
      box.appendChild(el('p', 'help', 'Vos honoraires s’afficheront ici dès votre premier acte complété.'));
    }
  }

  // --- « Votre cote » (ADR 0028) ---------------------------------------------
  // The one measure that decides the split, published entirely: the number on
  // 100, the money sentence it earns, the four axes WITH their figures (a
  // notary must be able to redo the total by hand), the next rung and the
  // points still missing, and the whole barème as a public scale.
  //
  // `nc.cote` existe toujours ; la cote ne décide plus d'un dollar (ADR 0031) et
  // then not a single rate is invented.

  // One axis `detail` → the short figures that produced its points. Each
  // fragment is its own text node so the i18n rules can translate them one by
  // one instead of matching a whole composed sentence.
  function ncCoteFigures(id, d) {
    d = d || {};
    var f = [];
    if (id === 'satisfaction') {
      // « Aucun avis » already says the count — no « 0 avis » after it.
      f.push(d.note == null ? 'Aucun avis' : 'Note ' + decLabel(d.note) + ' sur 5');
      if (d.avis > 0) f.push(d.avis + (d.avis === 1 ? ' avis' : ' avis'));
      f.push('Note pondérée ' + decLabel(d.notePonderee) + ' sur 5');
      f.push('Cible ' + decLabel(d.cible) + ' sur 5');
    } else if (id === 'services') {
      // Only the VOLUME earns points here. The catalogue coverage is served by
      // the domain and shown as information — but the line has to say, in
      // words, that breadth is out of the score: the Code tells a notary to
      // refuse a mandate beyond their knowledge, so specializing must not read
      // as a deficit (ADR 0028, « deux sanctions déontologiquement à l'envers »).
      var actes = d.actes || 0;
      f.push(actes + (actes <= 1 ? ' acte porté' : ' actes portés'));
      f.push('Cible ' + (d.cible || 0) + ' actes');
      var rendus = d.servicesRendus || 0;
      f.push(rendus + (rendus <= 1 ? ' service rendu sur ' : ' services rendus sur ') + (d.catalogue || 0));
      f.push('Se spécialiser ne coûte rien : l’éventail n’entre pas dans la cote.');
    } else if (id === 'disponibilite') {
      // What earns the points is HAVING ANSWERED — proposing, accepting and
      // declining are all answers, and only silence costs. The count leads,
      // the honest breakdown follows, and the rule is spelled out so a notary
      // reads it BEFORE their first decline, not after losing a rung to it.
      var rep = d.reponses || 0;
      var cible = d.cibleReponses || 0;
      f.push(rep === 0
        ? 'Aucune réponse donnée sur ' + cible + ' visées'
        : rep + (rep === 1 ? ' réponse donnée sur ' : ' réponses données sur ') + cible + ' visées');
      if (d.repondu > 0) f.push(d.repondu + (d.repondu === 1 ? ' proposition ou acceptation' : ' propositions ou acceptations'));
      if (d.declinees > 0) f.push(d.declinees + (d.declinees === 1 ? ' déclin' : ' déclins'));
      f.push('Décliner compte comme une réponse ; seul le silence coûte des points.');
      f.push('Rayon ' + (d.rayonKm || 0) + ' km');
      f.push(d.urgences ? 'Urgences en ligne : oui' : 'Urgences en ligne : non');
    } else if (id === 'presence') {
      f.push(d.fiche ? 'Fiche CNQ : oui' : 'Fiche CNQ : non');
      f.push(d.secteur ? 'Secteur postal : oui' : 'Secteur postal : non');
      // Day zero reads in words: « Activité il y a 0 jours » is a riddle.
      var depuis = d.joursDepuisActivite || 0;
      f.push(depuis === 0 ? 'Activité aujourd’hui' : 'Activité il y a ' + depuis + (depuis === 1 ? ' jour' : ' jours'));
      var membre = d.joursMembre || 0;
      f.push(membre === 0 ? 'Membre depuis aujourd’hui' : 'Membre depuis ' + membre + (membre === 1 ? ' jour' : ' jours'));
    }
    return f;
  }

  function ncRenderCote() {
    var box = $('notary-cote'); if (!box) return; clear(box);
    var score = nc.cote;
    if (!score || !score.axes || !score.axes.length) return; // signed out, or nothing to publish yet

    // Le nombre, en grand, sur 100 — et RIEN qui le rattache à l'argent.
    var head = el('div', 'nc-cote-head');
    var n = el('div', 'nc-cote-n');
    n.appendChild(el('span', 'nc-cote-v', String(score.cote)));
    n.appendChild(el('span', 'nc-cote-max', ' / 100'));
    n.setAttribute('aria-label', 'Cote ' + score.cote + ' sur 100');
    head.appendChild(n);
    // ADR 0031 — la cote ne décide plus d'un dollar, et la console ne doit même
    // pas le suggérer. L'art. 29.1 du Code de déontologie interdit au notaire
    // « aucune convention ayant pour effet de mettre en péril l'indépendance,
    // le désintéressement, l'objectivité et l'intégrité requis pour l'exercice
    // de la profession » : un revenu indexé sur une note attribuée par une
    // entreprise privée en est une, et l'AFFICHER suffit à la rendre opposable.
    head.appendChild(el('p', 'help nc-cote-note',
      'Vos honoraires vous reviennent en entier, quelle que soit votre cote. Cette mesure sert au service — jamais à ce que vous gagnez.'));
    box.appendChild(head);

    // The four axes: name, points against the max, a quiet bar, and the
    // figures behind them. Names and maxima come from the payload — the UI
    // never re-declares the pondération.
    var axes = el('div', 'nc-cote-axes');
    score.axes.forEach(function (a) {
      var row = el('div', 'nc-cote-axe');
      row.dataset.axe = a.id;
      var h = el('div', 'nc-cote-axe-h');
      h.appendChild(el('span', 'nc-cote-axe-nom', a.nom));
      h.appendChild(el('span', 'nc-cote-axe-pts', decLabel(a.points) + ' / ' + decLabel(a.max)));
      row.appendChild(h);
      var bar = el('div', 'nc-cote-bar');
      var fill = el('span', 'nc-cote-bar-fill');
      fill.style.width = (a.max > 0 ? Math.round((a.points / a.max) * 100) : 0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      var det = el('div', 'nc-cote-detail');
      ncCoteFigures(a.id, a.detail).forEach(function (t) { det.appendChild(el('span', 'nc-cote-f', t)); });
      row.appendChild(det);
      axes.appendChild(row);
    });
    box.appendChild(axes);
  }

  // --- Notary evaluations (ADR 0021) -----------------------------------------
  // The notary's own track record: every client evaluation — note, comment,
  // act, date — anonymized (the EVAL# ledger never carries the client's name
  // or courriel, and neither does this panel). The list is fetched on the
  // panel's FIRST open only, then cached for the session; ncExpire drops the
  // cache so the next session (or notary) always reads its own history.
  var ncEvalsFor = null; // email the list was loaded for; null = not loaded
  function ncEvalStars(note) {
    var n = Math.max(1, Math.min(5, Math.round(Number(note) || 1)));
    var sp = el('span', 'nc-eval-stars');
    var full = ''; var empty = '';
    for (var i = 0; i < 5; i++) { if (i < n) full += '★'; else empty += '☆'; }
    sp.textContent = full + empty;
    sp.setAttribute('aria-label', 'Note ' + n + ' sur 5');
    return sp;
  }
  // The per-service record (ADR 0028, GET /notary/evaluations → services):
  // ONE line per catalogue service — the acts actually carried and what the
  // clients said about them. A service without a single review says so in
  // words; the domain never invents an average, and neither does this.
  function ncRenderServices(box, services) {
    if (!services || !services.length) return;
    var wrap = el('div', 'nc-svc');
    wrap.appendChild(el('div', 'nc-svc-h', 'Ce que vous portez, service par service'));
    services.forEach(function (s) {
      var row = el('div', 'nc-svc-row');
      row.dataset.service = s.serviceId;
      row.appendChild(el('span', 'nc-svc-nom', s.nom));
      var actes = Number(s.actes) || 0;
      row.appendChild(el('span', 'nc-svc-actes', actes + (actes > 1 ? ' actes' : ' acte')));
      var badge = ratingSpan({ note: s.note, avis: s.avis });
      if (badge) row.appendChild(badge);
      else row.appendChild(el('span', 'nc-svc-none', 'pas encore d’avis'));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  function ncRenderEvals(rating, evaluations, services) {
    var box = $('nc-evals-list'); if (!box) return; clear(box);
    if (!evaluations || !evaluations.length) {
      box.appendChild(el('p', 'help', 'Vos évaluations s’afficheront ici après vos premiers actes signés.'));
      ncRenderServices(box, services);
      return;
    }
    // The aggregate first — the same badge clients see on every proposition —
    // then the individual evaluations it is made of, newest first (API order).
    var head = el('div', 'nc-evals-own');
    var own = ratingSpan(rating);
    if (own) head.appendChild(own);
    head.appendChild(el('span', 'help', ' Vos évaluations, telles que les clients les ont laissées.'));
    box.appendChild(head);
    evaluations.forEach(function (ev) {
      if (!ev || !(Number(ev.note) >= 1)) return;
      var row = el('div', 'nc-eval');
      var line = el('div', 'nc-eval-head');
      line.appendChild(ncEvalStars(ev.note));
      if (ev.serviceId) line.appendChild(el('span', 'nc-eval-svc', svcName(ev.serviceId)));
      if (ev.dateISO) line.appendChild(el('span', 'nc-eval-date', dayTitle(ev.dateISO)));
      row.appendChild(line);
      if (ev.commentaire) row.appendChild(el('p', 'nc-eval-comment', ev.commentaire));
      box.appendChild(row);
    });
    ncRenderServices(box, services);
  }
  async function ncLoadEvals() {
    if (!nc.token) return;
    if (ncEvalsFor === nc.email) return; // cached for this session
    var box = $('nc-evals-list'); if (!box) return;
    var r;
    try {
      r = await fetch(API_BASE + '/notary/evaluations', {
        headers: { accept: 'application/json', authorization: 'Bearer ' + nc.token },
      });
    } catch (e) {
      // A failed load must read as an error, never as "no evaluations yet".
      clear(box);
      box.appendChild(el('p', 'help', 'Impossible de charger vos évaluations (hors ligne). Réessayez.'));
      return;
    }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      clear(box);
      box.appendChild(el('p', 'help', 'Impossible de charger vos évaluations. Réessayez.'));
      return;
    }
    ncEvalsFor = nc.email;
    ncRenderEvals(j.rating || null, j.evaluations || [], j.services || null);
  }

  // --- Le relevé, acte par acte (ADR 0031 : les deux lignes, jamais un taux) --
  // Nothing aggregated only: ONE line per settled act — what the client paid,
  // at which rate, what Nota kept and the net — then the totals. Fetched from
  // GET /notary/acts on the panel's FIRST open, cached for the session like
  // the evaluations. The door may not be deployed everywhere yet, so a 404
  // retires the whole panel instead of promising a statement Nota cannot show.
  var ncActsFor = null; // email the statement was loaded for; null = not loaded
  function ncRenderActs(payload) {
    var box = $('nc-actes-list'); if (!box) return; clear(box);
    var actes = (payload && payload.actes) || [];
    if (!actes.length) {
      box.appendChild(el('p', 'help', 'Votre relevé s’ouvrira ici dès votre premier acte réglé.'));
      return;
    }
    var table = el('table', 'nc-actes-table');
    var head = el('tr');
    // ADR 0031 — plus de colonne « Taux ». Le relevé porte les deux lignes de
    // l'acte : les honoraires du notaire, entiers, et le prix que le CLIENT a
    // payé à Nota. Une colonne de pourcentage décrirait un partage que
    // l'art. 32 du Code de déontologie interdit au notaire.
    ['Date', 'Acte', 'Vos honoraires', 'Payé à Nota par le client'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
    var body = el('tbody');
    var duLignes = 0; // lines settled off the platform — the fee is still owed
    actes.forEach(function (a) {
      var row = el('tr', 'nc-acte-row');
      row.dataset.bid = a.bidId || '';
      // ADR 0029: « payé » means the money actually moved (capture + virement).
      // Anything else is a debt, and the row says which it is — a state the
      // eye reads and a hook a style can key on.
      var paye = a.paye !== false;
      var du = Number(a.du) || 0;
      row.dataset.paye = paye ? 'true' : 'false';
      row.appendChild(el('td', 'nc-acte-date', a.dateISO ? dayTitle(a.dateISO) : '—'));
      var svc = el('td', 'nc-acte-svc');
      svc.appendChild(el('span', 'nc-acte-nom', a.service || svcName(a.serviceId)));
      if (!paye && du > 0) {
        // No new shape and no new colour: the truth in words, in the console's
        // existing quiet register.
        duLignes++;
        // A div, not a span: the cell is `white-space: nowrap`, so the marker
        // has to stack UNDER the act's name instead of stretching the row.
        svc.appendChild(el('div', 'help nc-acte-etat', 'Réglé hors plateforme — ' + D.money(du) + ' de service Nota à percevoir'));
      }
      row.appendChild(svc);
      row.appendChild(el('td', 'nc-acte-num nc-acte-net', D.money(a.honoraires != null ? a.honoraires : a.montant)));
      row.appendChild(el('td', 'nc-acte-num', D.money(a.prixNota != null ? a.prixNota : 0)));
      body.appendChild(row);
    });
    table.appendChild(body);
    var t = (payload && payload.totaux) || {};
    var foot = el('tfoot');
    var total = el('tr', 'nc-acte-total');
    total.appendChild(el('th', null, 'Total'));
    var n = Number(t.actes) || 0;
    total.appendChild(el('td', null, n + (n > 1 ? ' actes' : ' acte')));
    total.appendChild(el('td', 'nc-acte-num nc-acte-net', D.money(t.honoraires != null ? t.honoraires : (t.montant || 0))));
    total.appendChild(el('td', 'nc-acte-num', D.money(t.prixNota || 0)));
    foot.appendChild(total);
    // What is still owed, beside the other totals and never mixed into them:
    // « perçu » means Nota has the money. It only exists when there IS a debt.
    var duTotal = Number(t.du) || 0;
    if (duTotal > 0) {
      var due = el('tr', 'nc-acte-total nc-acte-du');
      due.dataset.total = 'du';
      var label = el('th', null, 'Service Nota à percevoir');
      label.colSpan = 3;
      due.appendChild(label);
      due.appendChild(el('td', 'nc-acte-num', D.money(duTotal)));
      foot.appendChild(due);
    }
    table.appendChild(foot);
    box.appendChild(table);
    box.appendChild(el('p', 'help', 'Vos honoraires vous reviennent en entier. Le prix du service de Nota est payé par le client, en plus — il n’est jamais retranché de ce qui vous est dû.'));
    // Said once, under the table: what an unpaid line actually means. ADR 0029
    // leaves recovery OPEN — nothing in the product can collect this yet — so
    // this sentence states the fact and promises no mechanism, no deadline and
    // no way to pay that does not exist.
    if (duLignes > 0) {
      box.appendChild(el('p', 'help nc-acte-du-note',
        duLignes > 1
          ? 'Sur ces actes, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.'
          : 'Sur cet acte, le client vous a payé directement à la signature : Nota n’a rien encaissé, et le prix de son service reste à percevoir.'));
    }
  }
  async function ncLoadActs() {
    if (!nc.token) return;
    if (ncActsFor === nc.email) return; // cached for this session
    var box = $('nc-actes-list'); if (!box) return;
    var panel = $('notary-actes');
    var r;
    try {
      r = await fetch(API_BASE + '/notary/acts', {
        headers: { accept: 'application/json', authorization: 'Bearer ' + nc.token },
      });
    } catch (e) {
      // Offline is an error, never « you have settled nothing ».
      clear(box);
      box.appendChild(el('p', 'help', 'Impossible de charger votre relevé (hors ligne). Réessayez.'));
      return;
    }
    if (r.status === 401) { ncExpire('Session expirée. Reconnectez-vous.'); return; }
    if (r.status === 404) {
      // The door is not there: retire the panel rather than show an empty
      // promise of disclosure. The next session tries again from scratch.
      ncActsFor = nc.email;
      clear(box);
      if (panel) { panel.open = false; panel.hidden = true; }
      return;
    }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status !== 200) {
      clear(box);
      box.appendChild(el('p', 'help', 'Impossible de charger votre relevé. Réessayez.'));
      return;
    }
    ncActsFor = nc.email;
    ncRenderActs(j);
  }

  // --- Notary public profile (ADR 0016) --------------------------------------
  // One field: the official fiche at the Chambre des notaires. The domain is
  // the gatekeeper (cnq.org, https) — the API re-validates, of course.
  // Every profile POST carries the WHOLE profile: the API replaces what it
  // stores, so a partial body (the alertes alone) would blank the rest.
  function ncProfilBody(over) {
    var p = nc.profil || {};
    var a = ncAlertes();
    var body = {
      nom: p.nom || '', etude: p.etude || '', telephone: p.telephone || '', adresse: p.adresse || '',
      lienCNQ: p.lienCNQ || '', rayonKm: p.rayonKm || 0, urgences: p.urgences === true, prefixe: p.prefixe || '',
      alertes: { pace: a.pace, urgentOnly: a.urgentOnly },
    };
    return Object.assign(body, over || {});
  }
  // Inline, as the notary types: the domain's phone rule, under the field.
  function ncCheckTelephone() {
    var inp = $('nc-telephone'), err = $('nc-telephone-err');
    if (!inp || !err) return true;
    var v = D.validateTelephone(inp.value);
    err.hidden = v.ok; err.textContent = v.ok ? '' : v.error.message;
    inp.setAttribute('aria-invalid', v.ok ? 'false' : 'true');
    return v.ok;
  }
  function ncRenderProfil() {
    var inp = $('nc-cnq'); if (!inp) return;
    var p = nc.profil || {};
    // The identity the client receives (ADR 0033).
    var fill = function (id, v) { var e = $(id); if (e) e.value = v == null ? '' : String(v); };
    fill('nc-nom', p.nom); fill('nc-etude', p.etude); fill('nc-telephone', p.telephone); fill('nc-adresse', p.adresse);
    var telErr = $('nc-telephone-err'); if (telErr) { telErr.hidden = true; telErr.textContent = ''; }
    inp.value = p.lienCNQ || '';
    // Travel radius + online-urgency opt-in (ADR 0017). The radius options ARE
    // the domain's NOTARY_RADII — filled here, never re-declared in the HTML;
    // the nselect rebuilds its list from the native options on every open.
    var sel = $('nc-rayon');
    if (sel) {
      if (!sel.options.length) {
        D.NOTARY_RADII.forEach(function (r) {
          var o = document.createElement('option');
          o.value = String(r);
          o.textContent = r === 0 ? 'Je ne me déplace pas' : 'Jusqu’à ' + r + ' km';
          sel.appendChild(o);
        });
      }
      sel.value = String((nc.profil && nc.profil.rayonKm) || 0);
      sel.dispatchEvent(new Event('change', { bubbles: true })); // repaint the nselect label
    }
    var urg = $('nc-urgences');
    if (urg) urg.checked = !!(nc.profil && nc.profil.urgences);
    // ADR 0025: the étude's sector — what turns the feed's declarative travel
    // rules into measured distances.
    var pre = $('nc-prefixe');
    if (pre) pre.value = (nc.profil && nc.profil.prefixe) || '';
  }
  async function ncSaveProfil() {
    var inp = $('nc-cnq'); if (!inp) return;
    var sel = $('nc-rayon');
    var urg = $('nc-urgences');
    var errBox = $('nc-profil-errors');
    var saved = $('nc-profil-saved');
    if (saved) saved.hidden = true;
    var pre = $('nc-prefixe');
    var field = function (id) { var e = $(id); return e ? e.value : ''; };
    var v = D.validateNotaryProfile({
      nom: field('nc-nom'), etude: field('nc-etude'), telephone: field('nc-telephone'), adresse: field('nc-adresse'),
      lienCNQ: inp.value,
      rayonKm: sel ? sel.value : 0,
      urgences: !!(urg && urg.checked),
      prefixe: pre ? pre.value : '',
    });
    ncCheckTelephone();
    if (!v.ok) {
      if (errBox) { clear(errBox); errBox.hidden = false; v.errors.forEach(function (x) { errBox.appendChild(el('li', null, x.message)); }); }
      return;
    }
    var res = await ncPost('/notary/profile', ncProfilBody({
      nom: v.nom || '', etude: v.etude || '', telephone: v.telephone || '', adresse: v.adresse || '',
      lienCNQ: v.lienCNQ || '', rayonKm: v.rayonKm, urgences: v.urgences, prefixe: v.prefixe || '',
    }));
    if (!res) return;
    if (res.status !== 200) {
      if (errBox) { clear(errBox); errBox.hidden = false; (res.json.errors || [{ message: 'Échec de l’enregistrement du profil.' }]).forEach(function (x) { errBox.appendChild(el('li', null, x.message)); }); }
      return;
    }
    nc.profil = res.json.profil || Object.assign({}, nc.profil, {
      nom: v.nom, etude: v.etude, telephone: v.telephone, adresse: v.adresse,
      lienCNQ: v.lienCNQ, rayonKm: v.rayonKm, urgences: v.urgences, prefixe: v.prefixe,
    });
    nc.manquantsServeur = null; // the saved profile is the truth now
    ncRenderProfilBanner();
    if (errBox) { clear(errBox); errBox.hidden = true; }
    if (saved) saved.hidden = false;
    toast('Profil enregistré.');
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
      // A restored notary session lands on its console unless the URL already
      // says where to go — the agenda is the app for a signed-in notary.
      if (!new URLSearchParams(location.hash.slice(1)).has('t')) setTab('notaires', { scroll: false });
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
    var prev = state.tab;
    state.tab = tab;
    syncNavTabs(tab);
    PANES.forEach(function (t) {
      var pane = $('pane-' + t);
      if (!pane) return;
      var active = t === tab;
      pane.classList.toggle('is-active', active);
      pane.hidden = !active;
    });
    if (tab === 'dossier') renderDossier();
    if (tab === 'profil') renderProfil();
    if (tab === 'notaires') { renderNotaryLive(); noteNotaryDoor(); }
    // The client thread refreshes itself only while Mes offres is on screen.
    clientPollSync();
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'auto' });
    // Move focus into the new pane's heading so keyboard/SR users are never dropped
    // to <body> when a menu/link navigates and its container is hidden. The
    // focus-visible ring only shows for keyboard users, so mouse clicks are unaffected.
    if (opts.focus !== false) {
      var activePane = $('pane-' + tab);
      var h = activePane && activePane.querySelector('h1');
      if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    }
    // Each pane change is a history entry (deep-linkable, Back walks panes
    // instead of leaving the site). fromHistory guards the popstate round-trip.
    if (tab !== prev && !opts.fromHistory) writeHash({ push: true });
  }

  // Every modal the page can hold; closed together when history moves.
  function closeOpenDialogs() {
    ['day-dialog', 'auth-dialog', 'reveal-dialog', 'onboarding-dialog', 'cancel-dialog', 'contact-dialog', 'nc-retenir-dialog'].forEach(function (id) {
      var d = $(id);
      if (d && d.open) { try { d.close(); } catch (e) { d.open = false; } }
    });
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
    // The form first — a human answers it — then the raw address for whoever
    // prefers their own mail client.
    var form = miniBtn('joindre', 'Nous joindre', function () { openContactDialog(); });
    host.appendChild(form);
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
    syncThemeSwitches();
  }
  // Both theme switches (header pill + drawer preference row) mirror the one
  // source of truth, html[data-theme] — checked means dark. CSS positions the
  // knob from the same attribute, so this only has to keep AT in the loop.
  function syncThemeSwitches() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    ['theme-toggle', 'mnav-theme'].forEach(function (id) {
      var el = $(id);
      if (el) el.setAttribute('aria-checked', dark ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Data refresh
  // ---------------------------------------------------------------------------
  async function refreshMonthData() {
    var panel = $('carnet-panel');
    if (panel) panel.classList.add('is-loading');
    try {
      // The rolling window crosses month seams, so it needs EVERY month it
      // spans — a 6-week window starting late in a month reaches into month+2
      // (e.g. Mon Aug 24 → Oct 4 spans Aug, Sep AND Oct); loading only the
      // anchor and end months silently dropped the middle one. A plain month
      // view loads just itself, as before.
      var months = [monthKey(state.anchor)];
      var win = calWindow();
      for (var wm = win ? firstOfMonth(win.start) : null; wm && wm <= win.end; wm = addMonths(wm, 1)) {
        if (months.indexOf(monthKey(wm)) < 0) months.push(monthKey(wm));
      }
      // Count fallbacks ACROSS the whole batch: `store.online` alone would let a
      // month that failed be masked by another that succeeded later.
      var demoBefore = store.demoLoads;
      var lists = await Promise.all(months.map(function (m) { return store.listMonth(m); }));
      state.monthBids = Array.prototype.concat.apply([], lists);
      // One invented month is enough: everything drawn from monthBids is mixed.
      state.demo = store.demoLoads > demoBefore;
    } finally {
      if (panel) panel.classList.remove('is-loading');
    }
    renderDemoState(); // before anything reads monthBids: no bare invented figure
    renderNotaryLive(); // the landing's open-demand teaser
    renderOnbWeekAnim(); // and the welcome dialog's live week board, if open
    renderLegend(); // the legend's multipliers are tuned on the freshly loaded month
    renderHeroPrice(); // the hero quotes the tarif the same response carried
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
    // The menu is three flat doors (ADR 0010 §2) — no submenu layer to wire.
    // The former submenu destinations live inside the panes: publishing is
    // the hero CTA, the agenda band sits in the notary pane. The guide is the
    // standalone "?" bubble, always visible but never inside a menu (owner's
    // asks, 2026-08-26 + 2026-08-27); the footer link is the in-page fallback.
    var navGuide = $('guide-fab');
    if (navGuide) navGuide.addEventListener('click', function () { onbOpen(); });

    // Partenaires (ADR 0011): type chips (single-select), live normalized
    // code preview, and the claim POST.
    var pType = $('partner-type');
    if (pType) pType.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      partnerState.type = b.dataset.type;
      setGroupActive(pType, b);
      partnerValidateUI();
    });
    // Conversion: the courriel SUGGESTS the code (its local part, normalized),
    // so the happy path never invents one. The suggestion is remembered in
    // data-auto and only ever replaces itself — a hand-typed code wins, and
    // typing in the code field retires the suggestion for good.
    var pCode = $('partner-code'); if (pCode) pCode.addEventListener('input', function () {
      delete pCode.dataset.auto;
      partnerValidateUI();
    });
    var pMail = $('partner-courriel'); if (pMail) pMail.addEventListener('input', function () {
      if (pCode && (pCode.value === '' || pCode.value === pCode.dataset.auto)) {
        var local = (pMail.value.split('@')[0] || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
        if (D.isReferralCode(local)) {
          pCode.value = local; pCode.dataset.auto = local;
        } else if (pCode.dataset.auto) {
          pCode.value = ''; delete pCode.dataset.auto;
        }
      }
      partnerValidateUI();
    });
    var pForm = $('partner-form'); if (pForm) pForm.addEventListener('submit', onPartnerSubmit);
    var pCopy = $('partner-copy'); if (pCopy) pCopy.addEventListener('click', partnerCopyLink);
    var pShare = $('partner-share'); if (pShare) pShare.addEventListener('click', partnerShareClick);
    // The hero's CTA travels to the claim form — it never submits anything.
    // The two reward cards take the same trip: on this pane every surface
    // that sells the program lands the visitor in the form, courriel focused
    // (three-click rule). The cards stay plain stats to the keyboard and the
    // screen reader — the CTA is the accessible door.
    var goPartnerClaim = function () {
      var panel = document.querySelector('.pr-form-panel');
      if (panel && panel.scrollIntoView) { try { panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} }
      var inp = $('partner-courriel');
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
    };
    var pHero = $('pr-hero-cta');
    if (pHero) pHero.addEventListener('click', goPartnerClaim);
    ['pr-card-client', 'pr-card-notaire'].forEach(function (id) {
      var card = $(id);
      if (card) card.addEventListener('click', goPartnerClaim);
    });

    $('theme-toggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
    // First paint: the switches were authored checked (dark); a saved light
    // theme was applied to <html> before boot, so align aria-checked with it.
    syncThemeSwitches();

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
      // Focus follows the panel in — on the PANEL itself, not its first row:
      // focusing « Carnet » painted a selection-sized ring on it before the
      // user chose anything. Tab reaches the rows; Esc and the ✕ still close.
      // Focus returns to the burger on the way out.
      if (open) {
        // The drawer mirrors the header's current door.
        mnav.querySelectorAll('.mnav-link[data-tab]').forEach(function (b) {
          var on = b.dataset.tab === state.tab;
          b.classList.toggle('is-on', on);
          if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        try { mnav.focus(); } catch (e) {}
      } else if (mnav.contains(document.activeElement)) { try { navBurger.focus(); } catch (e) {} }
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
      // The legal fold's chevron: expand described sub-rows in place.
      // Expanding never closes the drawer.
      mnav.querySelectorAll('[aria-controls^="msub-"]').forEach(function (t) {
        t.addEventListener('click', function () {
          var sub = $(t.getAttribute('aria-controls'));
          if (!sub) return;
          var open = sub.hidden;
          sub.hidden = !open;
          t.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
      $('mnav-theme').addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        setTheme(cur === 'dark' ? 'light' : 'dark');
      });
      var mLogin = $('mnav-login'); if (mLogin) mLogin.addEventListener('click', function () { openAuthModal(null, 'signin'); });
      var mSignup = $('mnav-signup'); if (mSignup) mSignup.addEventListener('click', function () { openAuthModal(null, 'signup'); });
      // Any committed choice closes the drawer (links navigate via their own
      // handlers; the auth buttons open a modal above the page). Expand rows
      // and chevrons are not choices — they must keep the drawer open.
      mnav.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.mnav-link:not(.mnav-expandrow), .mnav-subitem, .mnav-auth .btn')) setMobileNav(false);
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

    // Sign-in / sign-up modal: role toggle + the passwordless courriel path.
    document.querySelectorAll('#auth-role .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { authSetRole(b.dataset.role); });
    });
    var authForm = $('auth-email-form'); if (authForm) authForm.addEventListener('submit', authSubmitEmail);
    // Social doors: OAuth is not wired yet, so a click surfaces the coming-soon
    // line INSIDE the modal (a toast would paint under the <dialog> top layer)
    // and hands focus to the courriel field, the one live door. T() at compose
    // time: the sentence is assembled at runtime, per provider.
    // ONE door for both header buttons (owner, 2026-08-28: « comme un site
    // traditionnel, en trois clics ») — same modal, honest title per button.
    // The pedagogical guide stays on the header « ? » and the footer link.
    var hLogin = $('header-login'); if (hLogin) hLogin.addEventListener('click', function () { openAuthModal(null, 'signin'); });
    var hSignup = $('header-signup'); if (hSignup) hSignup.addEventListener('click', function () { openAuthModal(null, 'signup'); });
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
    // Back/forward re-applies the pane recorded in that history entry's hash
    // (setTab pushes one entry per pane change). fromHistory stops the
    // round-trip from pushing again.
    window.addEventListener('popstate', function () {
      var h = new URLSearchParams(location.hash.replace(/^#/, ''));
      var t = h.get('t') || 'carnet';
      if (PANES.indexOf(t) < 0) t = 'carnet';
      closeOpenDialogs();
      if (t !== state.tab) setTab(t, { fromHistory: true });
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
    var amtNum = $('o-amount-input');
    if (amtNum) { amtNum.addEventListener('input', onAmountInputTyped); amtNum.addEventListener('change', onAmountInputTyped); }
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
    $('o-name').addEventListener('input', validateOfferUI);
    $('o-telephone').addEventListener('input', onTelephoneInput);
    var refField = $('o-parrain'); if (refField) refField.addEventListener('input', onRefCodeInput);
    $('offer-form').addEventListener('submit', onOfferSubmit);
    $('o-date').setAttribute('min', todayISO());
    // The first touch of the form — a typed value, a changed select, an
    // answer chip — is one funnel step per dialog opening.
    $('offer-form').addEventListener('input', noteFormStart);
    $('offer-form').addEventListener('change', noteFormStart);
    $('offer-form').addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.chip, .seg-btn')) noteFormStart();
    });
    // The header date picker re-opens the chosen day in place; a past or
    // malformed date snaps back to the day on screen.
    var dayPick = $('day-date');
    if (dayPick) {
      dayPick.setAttribute('min', todayISO());
      dayPick.addEventListener('change', function () {
        var iso = this.value;
        if (!D.isISODate(iso) || iso < todayISO()) { this.value = state.selectedDate || ''; return; }
        if (iso === state.selectedDate) return;
        openDay(iso);
      });
    }

    // Day booking dialog
    $('day-close').addEventListener('click', function () { $('day-dialog').close(); });
    $('day-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('day-dialog').addEventListener('close', function () {
      var c = document.querySelector('.cal-cell[data-date="' + state.focusDate + '"]');
      if (c) c.focus();
    });

    // Reveal dialog. Every way out that is not the explicit confirm — the
    // Rester anonyme button, the shared ✕, Esc — must land on the safe choice,
    // so the decision lives in one close handler keyed on returnValue.
    $('reveal-confirm').addEventListener('click', function () { $('reveal-dialog').close('confirm'); });
    $('reveal-cancel').addEventListener('click', function () { $('reveal-dialog').close(); });
    $('reveal-dialog').addEventListener('close', function () {
      commitAnon(this.returnValue !== 'confirm');
      this.returnValue = '';
    });

    // Cancel-offer dialog: the ✕ and « Garder mon offre » both just close;
    // only the explicit confirm withdraws.
    $('cancel-keep').addEventListener('click', function () { $('cancel-dialog').close(); });
    $('cancel-confirm').addEventListener('click', confirmCancelOffer);
    $('cancel-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('cancel-dialog').addEventListener('close', function () { cancelTarget = null; });

    // Nous joindre dialog.
    $('contact-form').addEventListener('submit', submitContact);
    $('ct-done').addEventListener('click', function () { $('contact-dialog').close(); });
    $('contact-dialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('mnav-contact').addEventListener('click', function () { setMobileNav(false); openContactDialog(); });

    // Dossier
    $('d-service').addEventListener('change', renderDossier);
    // Dossier act chips drive the hidden select — same pattern as the booking form.
    var dChips = $('d-service-chips');
    if (dChips) dChips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      $('d-service').value = b.dataset.svc;
      renderDossier(); // re-syncs the pressed chip itself
    });

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
        ncSignup.disabled = false; ncSignup.textContent = 'Créer mon compte gratuit →';
        var box = $('notary-signup-errors');
        if (box) { clear(box); box.hidden = false; box.appendChild(el('li', null, msg)); }
      });
    });
    // The branch's exit: back to the email step, address kept.
    var ncBack = $('notary-signup-back');
    if (ncBack) ncBack.addEventListener('click', ncShowEmailStep);
    // "First time? Create a free account": the signup branch is user-initiated
    // now that the request is enumeration-safe (the server never routes here).
    var ncSignupLink = $('notary-signup-link');
    if (ncSignupLink) ncSignupLink.addEventListener('click', function () {
      ncShowSignup(($('nc-email') && $('nc-email').value.trim()) || '');
    });
    // "Use another email" from the check-your-inbox step returns to step 1.
    var ncSentBack = $('notary-sent-back');
    if (ncSentBack) ncSentBack.addEventListener('click', ncShowEmailStep);
    // Sign-out is the account menu's job (renderAccountMenu) — the console
    // carries no duplicate button.
    var ncProfilForm = $('nc-profil-form');
    if (ncProfilForm) ncProfilForm.addEventListener('submit', function (e) { e.preventDefault(); ncSaveProfil(); });

    // « Vos évaluations » (ADR 0021): history, not the working surface — the
    // list is fetched on the panel's FIRST open and costs nothing until asked.
    var ncEvalsBox = $('notary-evals');
    if (ncEvalsBox) ncEvalsBox.addEventListener('toggle', function () { if (ncEvalsBox.open) ncLoadEvals(); });

    // « Votre relevé d’actes » — same register, same first-open fetch: the
    // full commission disclosure costs nothing until the notary asks for it.
    var ncActsBox = $('notary-actes');
    if (ncActsBox) ncActsBox.addEventListener('toggle', function () { if (ncActsBox.open) ncLoadActs(); });

    // Alert preferences (ADR 0033 §7) — every control saves to the SERVER on
    // change, through the profile; the seg repaints optimistically.
    if ($('pref-urgent')) $('pref-urgent').addEventListener('change', function () { ncSaveAlertes({ urgentOnly: this.checked }); });
    var ncPace = $('pref-pace');
    if (ncPace) ncPace.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      ncPace.querySelectorAll('.seg-btn').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      ncSaveAlertes({ pace: b.dataset.pace });
    });
    // The contact gate's door (ADR 0033), and the phone rule as it is typed.
    if ($('nc-profil-door')) $('nc-profil-door').addEventListener('click', ncOpenProfilDoor);
    if ($('nc-telephone')) $('nc-telephone').addEventListener('input', ncCheckTelephone);
    // The Retenir sheet: its two buttons, and Escape (the native dialog
    // handles it too; the listener covers engines that do not).
    var ncSheet = $('nc-retenir-dialog');
    if (ncSheet) {
      if ($('nc-retenir-later')) $('nc-retenir-later').addEventListener('click', ncCloseRetainSheet);
      if ($('nc-retenir-go')) $('nc-retenir-go').addEventListener('click', ncConfirmRetainSheet);
      ncSheet.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); ncCloseRetainSheet(); } });
      ncSheet.addEventListener('close', function () { ncSheetBid = null; });
    }
    var ncFilter = $('notary-open-filter');
    if (ncFilter) ncFilter.addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      if (c.classList.contains('nc-chip-ready')) nc.filter.readyOnly = !nc.filter.readyOnly;
      else nc.filter.service = c.dataset.svc || 'all';
      ncRenderOpen();
    });
    // Disclosure seg (ADR 0019): « L’essentiel » ↔ « Tout afficher ». The
    // choice is per device; folding back to essential drops the hand-opened
    // cards too — the seg means "show me this level", not "mostly".
    var ncView = $('notary-open-view');
    if (ncView) ncView.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      ncViewSet(b.dataset.view);
      if (b.dataset.view !== 'detail') nc.openDetails = {};
      ncRenderOpen();
    });
    var ncOpenList = $('notary-open-list');
    if (ncOpenList) {
      ncOpenList.addEventListener('click', function (e) {
        // A day tile toggles its day filter (ADR 0020) — before the card
        // delegation, since the strip lives inside the same list container.
        var tile = e.target.closest('.nc-daytile');
        if (tile) {
          nc.filter.day = nc.filter.day === tile.dataset.date ? null : tile.dataset.date;
          ncRenderOpen();
          return;
        }
        var card = e.target.closest('.nc-card'); if (!card) return;
        var id = card.dataset.id;
        var b = ncFindOpen(id); if (!b) return;
        // Retenir / Proposer go through the contact gate first (ADR 0033):
        // an incomplete profile opens the form instead of the action.
        if (e.target.closest('.nc-accept')) {
          if (ncProfilIncomplet()) ncProfilGate(null); else ncOpenRetainSheet(b);
        }
        else if (e.target.closest('.nc-decline')) ncDeclineLater(id, b.dateISO);
        else if (e.target.closest('.nc-undo')) ncCancelDecline(id);
        else if (e.target.closest('.nc-propose-btn')) {
          if (ncProfilIncomplet()) ncProfilGate(null);
          else ncToggleForm(card, e.target.closest('.nc-propose-btn'), 'nc-propose', function () { return ncProposeForm(b); });
        }
        else if (e.target.closest('.nc-docs-btn')) ncToggleForm(card, e.target.closest('.nc-docs-btn'), 'nc-docs', function () { return ncDocsForm(b); });
        else if (e.target.closest('.nc-toggle')) ncToggleCard(card);
        // The whole decision row is the disclosure target (ADR 0019) — any
        // click that isn't a control folds/unfolds the card.
        else if (!e.target.closest('button, a, input, textarea, select, label, form, details')) ncToggleCard(card);
      });
    }

    var ncRetList = $('notary-retained-list');
    if (ncRetList) {
      ncRetList.addEventListener('click', function (e) {
        var card = e.target.closest('.nc-card'); if (!card) return;
        var entryOf = function () {
          return ncRetainedFor(nc.email).filter(function (x) { return x.id === card.dataset.id; })[0];
        };
        var docsBtn = e.target.closest('.nc-docs-btn');
        if (docsBtn) {
          var entry = entryOf();
          if (entry) ncToggleForm(card, docsBtn, 'nc-docs', function () { return ncDocsForm(entry); });
          return;
        }
        // The conversation's send button is bound by its composer (ncChatBlock).
        if (e.target.closest('.nc-chat-send')) return;
        // The withdrawal: open/close the inline confirm, then post it.
        var relOpen = e.target.closest('.nc-release-open');
        if (relOpen) {
          var f = card.querySelector('.nc-release-form');
          if (f) { f.hidden = !f.hidden; relOpen.setAttribute('aria-expanded', f.hidden ? 'false' : 'true'); }
          return;
        }
        if (e.target.closest('.nc-release-cancel')) {
          var f2 = card.querySelector('.nc-release-form');
          var o2 = card.querySelector('.nc-release-open');
          if (f2) f2.hidden = true;
          if (o2) o2.setAttribute('aria-expanded', 'false');
          return;
        }
        var relGo = e.target.closest('.nc-release-confirm');
        if (relGo) {
          var entry3 = entryOf();
          var motif = card.querySelector('.nc-release-motif');
          if (entry3) ncRelease(entry3, motif ? motif.value : '', relGo);
          return;
        }
        if (e.target.closest('.nc-complete-cancel')) { ncDisarmComplete(card); return; }
        var btn = e.target.closest('.nc-complete-btn'); if (!btn) return;
        if (card.dataset.confirm === '1') {
          delete card.dataset.confirm;
          var cancel3 = card.querySelector('.nc-complete-cancel');
          if (cancel3) cancel3.parentNode.removeChild(cancel3);
          var input2 = card.querySelector('.nc-actval');
          ncCompleteAct(card.dataset.id, card.dataset.date, input2 ? input2.value : '', btn);
        } else {
          ncArmComplete(card);
        }
      });
      // Enter (without Shift) in a chat box sends, like every messenger. The
      // composer handles it itself (and prevents the default); this is the
      // fallback for a composer that does not — defaultPrevented tells them apart.
      ncRetList.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return;
        var input = e.target.closest('.chat-input'); if (!input) return;
        e.preventDefault();
        var chat = input.closest('.nc-chat');
        var send = chat && chat.querySelector('.nc-chat-send');
        if (send && !send.disabled) send.click();
      });
    }
    // Lender roster chips (préférences): toggling one immediately re-filters
    // the open feed — an unchecked lender's demands disappear from the surface.
    var ncLend = $('pref-lenders');
    if (ncLend) ncLend.addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      var on = !c.classList.contains('is-on');
      c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
      var lenders = ncPrefsGet(nc.email).lenders; lenders[c.dataset.lender] = on;
      ncPrefsPatch({ lenders: lenders });
      ncRenderOpen();
    });

    // Hero CTAs — orient the buyer immediately
    var ctaR = $('cta-reserver');
    if (ctaR) ctaR.addEventListener('click', openOfferFlow);
    var ctaV = $('cta-voir');
    if (ctaV) ctaV.addEventListener('click', function () {
      var panel = $('carnet-panel');
      if (panel) panel.scrollIntoView({ behavior: 'auto', block: 'center' });
    });

    // A width change can make a flat segmented track wrap (or a stacked one
    // fit again) — re-measure, debounced past the resize stream.
    var segSettleT = null;
    window.addEventListener('resize', function () {
      clearTimeout(segSettleT);
      segSettleT = setTimeout(function () { settleSegTracks(document); }, 150);
    });

    // Returning to the tab re-pulls the notary feed and the client's offer
    // statuses — the moments a person actually looks.
    window.addEventListener('focus', function () {
      if (nc.token) ncLoadBids();
      Promise.resolve(computeNotifications()).then(function () {
        if (state.tab === 'profil') renderProfil();
      }).catch(function () {});
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  // After the client authorizes (or cancels) their card on Stripe's hosted
  // Checkout, Stripe redirects back with ?paiement=ok|annule. Surface a short
  // status and strip the param so a reload is clean. Publication itself is
  // confirmed server-side by the authorization webhook, so this is informational.
  // --- Partner referral capture (ADR 0011) -----------------------------------
  // A partner (agent immobilier, courtier hypothécaire) shares ?ref=CODE.
  // Capture it once, normalized, on this device; onOfferSubmit attaches it
  // PRIVATELY as `parrain` when the client posts their demand. The code is
  // never displayed anywhere, and the param is stripped from the URL right
  // after capture (same replaceState pattern as ?paiement below) so later
  // navigation and shares never carry it.
  var LS_REF = 'nota.ref.v1';
  function referralCode() {
    var v = flagGet(LS_REF);
    return v && D.isReferralCode(v) ? D.normalizeReferralCode(v) : null;
  }
  function handleReferralParam() {
    var q = new URLSearchParams(location.search);
    var ref = q.get('ref');
    if (ref == null) return;
    // An invalid code is ignored (nothing stored) — the param is cleaned
    // either way so a mistyped link never lingers in the address bar.
    if (D.isReferralCode(ref)) flagSet(LS_REF, D.normalizeReferralCode(ref));
    q.delete('ref');
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  // The booking form's « Code de référence » field (industry pattern: one
  // optional field at the transaction, pre-filled by the link, editable by
  // hand). Pre-filling makes the attribution TRANSPARENT — the client sees
  // and controls what rides on their offer.
  function refPrefillOfferField() {
    var inp = $('o-parrain');
    var code = referralCode();
    if (inp && code && !inp.value) inp.value = code;
  }
  // Soft validation only: a recognizable code confirms normalized, anything
  // else warns without ever disabling the CTA — a bad referral code must
  // never cost a booking.
  function onRefCodeInput() {
    var inp = $('o-parrain'), prev = $('o-parrain-preview');
    if (!inp || !prev) return;
    var raw = inp.value.trim();
    clear(prev);
    if (!raw) { prev.removeAttribute('data-state'); return; }
    if (D.isReferralCode(raw)) { prev.dataset.state = 'ok'; prev.textContent = 'Code appliqué : ' + D.normalizeReferralCode(raw); }
    else { prev.dataset.state = 'warn'; prev.textContent = 'Code non reconnu — vérifiez-le avec la personne qui vous a référé. Votre offre part quand même.'; }
  }

  // --- Partenaires pane (ADR 0011) -------------------------------------------
  // The program's front door: the two reward tracks and the self-serve claim
  // form. Everything variable reads the DOMAIN — the flat rewards
  // (D.REFERRAL.client / D.REFERRAL.notaire) and the partner categories
  // (D.REFERRAL.partners) are data there, never hardcoded here; every amount
  // is rendered with D.money like every other figure in the app.
  var partnerState = { type: '' };

  // The partner's OWN claimed record — the outbound side of the program
  // (LS_REF above is the inbound code: who referred THIS device). Persisted on
  // a successful claim so the profile's Parrainage card can resurface the code
  // and link after the tab closes. A convenience copy only — the API stays the
  // source of truth, and rewards travel by courriel (ADR 0011).
  var LS_PARTNER = 'nota.partner.v1';
  function partnerGet() {
    var p = lsLoad(LS_PARTNER);
    return p && p.code && D.isReferralCode(p.code) ? p : null;
  }
  function partnerSet(rec) { lsSave(LS_PARTNER, rec); }

  function partnerShareLink(code) { return location.origin + '/?ref=' + code; }

  // ===== Ambient mark drift — the Nota logo, twenty times, adrift. =====
  // Born on the intro gate (2026-08-27), then promoted the same day to ONE
  // fixed site-wide layer behind all content (the hero's own clipped copy
  // « cut rough » at the band's edges). The builder deals each copy its own
  // place, size, drift and tempo, and a negative delay starts every one
  // mid-flight so the scene is alive from the first frame. Decorative only:
  // aria-hidden, pointer-blind. The mark is verbatim the chooser's logo.
  var DRIFT_MARK_SVG =
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
    '<rect width="64" height="64" rx="12" fill="#2c5f34"/>' +
    '<g fill="#ffffff">' +
    '<rect x="16" y="15" width="7.5" height="34" rx="2.5"/>' +
    '<rect x="40.5" y="15" width="7.5" height="34" rx="2.5"/>' +
    '<polygon points="16,15 24,15 48,49 40,49"/>' +
    '</g>' +
    '<circle cx="48" cy="16" r="8" fill="#50b848" stroke="#2c5f34" stroke-width="3"/>' +
    '</svg>';
  // A full die (owner: « they must look as a full dice ») — six logo faces
  // around one body; CSS folds them into a cube and tumbles the whole thing.
  var DRIFT_DIE_HTML = (function () {
    var faces = '';
    for (var f = 0; f < 6; f++) faces += DRIFT_MARK_SVG;
    return '<span class="cube">' + faces + '</span>';
  })();
  function driftBuild(host, id, variant) {
    if (!host || $(id)) return;
    var bg = document.createElement('div');
    bg.id = id;
    bg.className = 'mark-drift' + (variant ? ' ' + variant : '');
    bg.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 20; i++) {
      var m = document.createElement('i');
      // A jittered 5×4 grid spreads the twenty marks evenly — no clumps, no
      // bare corners — while the jitter keeps the lattice invisible.
      var col = i % 5, row = (i / 5) | 0;
      m.style.setProperty('--x', (col * 20 + 2 + Math.random() * 16).toFixed(1) + '%');
      m.style.setProperty('--y', (row * 25 + 2 + Math.random() * 21).toFixed(1) + '%');
      // One depth draw drives the whole parallax: near marks are bigger,
      // sharper, a touch bolder and wander farther; far ones shrink, soften
      // behind a light blur and barely stir.
      var t = Math.random();
      var amp = 40 + t * 120;
      m.style.setProperty('--s', (22 + t * 58).toFixed(0) + 'px');
      m.style.setProperty('--o', (0.04 + t * 0.05).toFixed(3));
      m.style.setProperty('--blur', ((1 - t) * 1.6).toFixed(1) + 'px');
      m.style.setProperty('--d', (14 + Math.random() * 14).toFixed(1) + 's');
      m.style.setProperty('--dl', (-Math.random() * 28).toFixed(1) + 's');
      // Two waypoints per loop (mark-wander) make the path a wander, not a
      // shuttle — out, across, and home, never retracing itself.
      m.style.setProperty('--dx1', ((Math.random() * 2 - 1) * amp).toFixed(0) + 'px');
      m.style.setProperty('--dy1', ((Math.random() * 2 - 1) * amp).toFixed(0) + 'px');
      m.style.setProperty('--dx2', ((Math.random() * 2 - 1) * amp).toFixed(0) + 'px');
      m.style.setProperty('--dy2', ((Math.random() * 2 - 1) * amp).toFixed(0) + 'px');
      // The tumble (owner: « like dice »): one full, even turn around a
      // random 3D axis — every mark flips and rolls its own way, half
      // clockwise, half counter. The X floor keeps the axis honest so no
      // mark degenerates into a flat 2D spin.
      m.style.setProperty('--ax', (0.4 + Math.random() * 0.6).toFixed(2));
      m.style.setProperty('--ay', (Math.random() * 2 - 1).toFixed(2));
      m.style.setProperty('--az', (Math.random() * 2 - 1).toFixed(2));
      m.style.setProperty('--sd', (4 + Math.random() * 5).toFixed(1) + 's');
      m.style.setProperty('--spin', (Math.random() < 0.5 ? -360 : 360) + 'deg');
      m.innerHTML = DRIFT_DIE_HTML;
      bg.appendChild(m);
    }
    host.insertBefore(bg, host.firstChild);
  }

  function renderPartnerPane() {
    // Two tracks, two flat amounts — both DOMAIN data (D.REFERRAL.client /
    // D.REFERRAL.notaire), formatted like every other figure in the app.
    var amtClient = $('pr-amount-client');
    if (amtClient) amtClient.textContent = D.money(D.REFERRAL.client);
    var amtNotaire = $('pr-amount-notaire');
    if (amtNotaire) amtNotaire.textContent = D.money(D.REFERRAL.notaire);
    // One chip per partner category, from the domain.
    var wrap = $('partner-type');
    if (wrap && !wrap.children.length) {
      D.REFERRAL.partners.forEach(function (p) {
        var b = el('button', 'chip', p.nom);
        b.type = 'button'; b.dataset.type = p.id; b.setAttribute('aria-pressed', 'false');
        wrap.appendChild(b);
      });
    }
    // A RETURNING partner lands on their code, never a blank claim form: the
    // confirmed record (nota.partner.v1) reopens the share box, retitles the
    // panel, and pre-fills the form — so editing any field re-arms the normal
    // claim flow (partnerValidateUI) for a variant.
    var rec = partnerGet();
    if (rec) {
      var title = $('partner-form-title');
      if (title) title.textContent = 'Votre code partenaire';
      // The hero CTA stops promising a claim the partner already made.
      var heroCta = $('pr-hero-cta');
      if (heroCta) heroCta.textContent = 'Voir mon code →';
      partnerState.type = rec.type || partnerState.type;
      var onChip = wrap ? wrap.querySelector('.chip[data-type="' + partnerState.type + '"]') : null;
      if (onChip) setGroupActive(wrap, onChip);
      var mailInp = $('partner-courriel');
      if (mailInp && rec.courriel) mailInp.value = rec.courriel;
      var codeInp = $('partner-code');
      if (codeInp) codeInp.value = rec.code;
      partnerClaimConfirmed(rec, rec);
    }
    // The TOS clause carries the same two amounts — filled here so the legal
    // pane can never drift from the domain's figures.
    var tos = $('tos-partenaires');
    if (tos) {
      tos.textContent = 'Un professionnel qui réfère reçoit une récompense fixe de Nota : '
        + D.money(D.REFERRAL.client) + ' quand la demande d’un client référé est retenue, et '
        + D.money(D.REFERRAL.notaire) + ', une seule fois, quand un notaire référé retient son premier acte. '
        + 'Payée par Nota à même ses propres fonds, elle ne change jamais le prix du client ni les honoraires du notaire. '
        + 'Le professionnel encadré (OACIQ notamment) demeure responsable de divulguer cette récompense à son client lorsque son code de déontologie l’exige.';
    }
  }

  // The claim form validates live: a chosen type, a valid courriel, and a
  // code the domain accepts. The preview normalizes as the partner types —
  // "eve-roy" previews as the EVEROY link it will actually be.
  function partnerValidateUI() {
    var codeInp = $('partner-code'), mailInp = $('partner-courriel'), submit = $('partner-submit'), prev = $('partner-code-preview');
    if (!codeInp || !submit) return;
    var raw = codeInp.value.trim();
    var norm = D.normalizeReferralCode(raw);
    var okCode = D.isReferralCode(raw);
    if (prev) {
      clear(prev);
      if (!raw) { prev.removeAttribute('data-state'); }
      else if (okCode) { prev.dataset.state = 'ok'; prev.textContent = 'Votre lien : ' + partnerShareLink(norm); }
      else { prev.dataset.state = 'warn'; prev.textContent = 'Code invalide — entre 4 et 12 lettres ou chiffres.'; }
    }
    var mailOk = !!(mailInp && D.isEmail(mailInp.value.trim()));
    // Editing after a claim resets the CTA out of its success/pending state.
    // The state rides data-state, never the label — the English layer rewrites
    // labels in place, so a text comparison would misfire in English mode.
    if (!submit.getAttribute('aria-busy') && submit.dataset.state) {
      delete submit.dataset.state;
      submit.textContent = 'Réclamer mon code →';
      var succ = $('partner-success'); if (succ) succ.hidden = true;
      var pend0 = $('partner-pending'); if (pend0) pend0.hidden = true;
    }
    submit.disabled = !(partnerState.type && mailOk && okCode);
  }

  // Claiming a code is EMAIL-VERIFIED (ADR 0011 fraud-hardening): a claim only
  // PENDS until the emailed confirmation link is opened, so a code can never be
  // squatted by someone who does not control the address. Step 1 posts the
  // claim; step 2 (partnerVerify, from the dev echo here or the emailed
  // `#pauth=` link) confirms it and reveals the shareable link. Only a CONFIRMED
  // claim persists nota.partner.v1 and surfaces the profile Parrainage card.
  async function onPartnerSubmit(e) {
    e.preventDefault();
    var submit = $('partner-submit');
    if (!submit || submit.disabled) return;
    var errs = $('partner-errors');
    var code = D.normalizeReferralCode($('partner-code').value);
    var courriel = $('partner-courriel').value.trim();
    var type = partnerState.type;
    submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = 'Réclamation…';
    var r = null;
    try {
      r = await fetch(API_BASE + '/partenaires', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: type, courriel: courriel, code: code }),
      });
    } catch (err) { partnerFail(['Hors ligne. Réessayez une fois en ligne.']); return; }
    var j = {}; try { j = await r.json(); } catch (err) {}
    // 429 = throttled; 409/422 = typed errors; anything else non-200 = failure.
    if (r.status === 429) { partnerFail(['Trop de tentatives. Réessayez dans quelques minutes.']); return; }
    if (r.status !== 200) {
      // The API's typed errors carry their own French messages; the one worth
      // a friendlier phrasing here is the taken code.
      var known = { code_deja_pris: 'Ce code est déjà pris — essayez une variante.' };
      var list = (j.errors && j.errors.length) ? j.errors : [{ message: 'Inscription impossible pour le moment. Réessayez.' }];
      partnerFail(list.map(function (x) { return known[x.code] || x.message || 'Erreur serveur. Réessayez.'; }));
      return;
    }
    if (errs) errs.hidden = true;
    var hint = { code: code, type: type, courriel: courriel };
    // The owner re-requesting an ALREADY-confirmed code short-circuits: the API
    // answers with the confirmed record, so it is an immediate success.
    if (j.confirmed && j.partenaire) { partnerClaimConfirmed(j.partenaire, hint); return; }
    // Dev/test path: the echoed token lets us finish verification in place, so
    // the claim completes offline (local dev + the web test stubs).
    if (j.devToken) { await partnerVerify(j.devToken, hint); return; }
    // Production path: the confirmation link is in the partner's inbox.
    submit.removeAttribute('aria-busy'); submit.dataset.state = 'sent';
    submit.textContent = 'Lien envoyé ✓'; // stays disabled
    var box0 = $('partner-success'); if (box0) box0.hidden = true;
    var pend = $('partner-pending'); if (pend) pend.hidden = false;
  }

  // Step 2 — redeem a claim challenge token (from the dev echo or the emailed
  // `#pauth=` link) for a CONFIRMED partner. `hint` carries the values the
  // request used, so the boot-from-link path (no hint) still resolves from the
  // API's own record.
  async function partnerVerify(token, hint) {
    var r;
    try {
      r = await fetch(API_BASE + '/partenaires/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token }),
      });
    } catch (e) { partnerFail(['Hors ligne. Réessayez une fois en ligne.']); return { ok: false }; }
    var j = {}; try { j = await r.json(); } catch (e) {}
    // 201 = confirmed; 200 = the owner's idempotent re-confirm — both succeed.
    if (r.status !== 201 && r.status !== 200) {
      partnerFail((j.errors || [{ message: 'Lien invalide ou expiré. Redemandez un lien.' }]).map(function (x) { return x.message; }));
      return { ok: false };
    }
    partnerClaimConfirmed(j.partenaire || {}, hint || {});
    return { ok: true };
  }

  // A confirmed claim: reveal the shareable link, persist the record on this
  // device (what the API has on file wins over the resubmitted values), and
  // refresh the profile's Parrainage card.
  function partnerClaimConfirmed(saved, hint) {
    hint = hint || {};
    var submit = $('partner-submit');
    if (submit) { submit.removeAttribute('aria-busy'); submit.dataset.state = 'claimed'; submit.textContent = 'Code réclamé ✓'; submit.disabled = true; }
    var errs = $('partner-errors'); if (errs) errs.hidden = true;
    var pend = $('partner-pending'); if (pend) pend.hidden = true;
    var box = $('partner-success'); if (box) box.hidden = false;
    var code = saved.code || hint.code;
    var link = $('partner-link'); if (link) link.textContent = partnerShareLink(code);
    // Native share only where the platform has a sheet — everywhere else the
    // copy button stands alone, exactly as before.
    var share = $('partner-share'); if (share) share.hidden = typeof navigator.share !== 'function';
    partnerSet({
      code: code,
      type: saved.type || hint.type || partnerState.type,
      courriel: saved.courriel || hint.courriel,
      createdAt: saved.createdAt || new Date().toISOString(),
    });
    if (state.tab === 'profil') renderProfil();
  }

  // Shared failure rendering for both the claim request and the verify step:
  // surface the messages, clear the pending state, and re-arm the CTA.
  function partnerFail(msgs) {
    var errs = $('partner-errors');
    if (errs) { clear(errs); errs.hidden = false; msgs.forEach(function (m) { errs.appendChild(el('li', null, m)); }); }
    var pend = $('partner-pending'); if (pend) pend.hidden = true;
    var submit = $('partner-submit');
    if (submit) { submit.removeAttribute('aria-busy'); delete submit.dataset.state; submit.textContent = 'Réclamer mon code →'; }
    partnerValidateUI();
  }

  // A confirmation link opens the site with the claim token in the URL hash.
  // Consume it once on boot: strip it from the URL (so a refresh / shared copy
  // can never replay it, and it never lingers in history), land on the
  // Partenaires pane, verify. Mirrors ncConsumeMagicHash for the notary link.
  function partnerConsumeClaimHash() {
    var params;
    try { params = new URLSearchParams(String(location.hash || '').replace(/^#/, '')); } catch (e) { return false; }
    var token = params.get('pauth');
    if (!token) return false;
    params.delete('pauth');
    var rest = params.toString();
    try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) {}
    setTab('partenaires', { focus: false });
    partnerVerify(token, null);
    return true;
  }

  // Clipboard with visible feedback either way — shared by the Partenaires
  // pane's copy button and the profile's Parrainage card.
  function copyLinkText(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { toast('Lien copié.'); },
          function () { toast('Copie impossible — sélectionnez le lien.'); }
        );
        return;
      }
    } catch (e) {}
    toast('Copie impossible — sélectionnez le lien.');
  }

  function partnerCopyLink() {
    var link = $('partner-link');
    copyLinkText(link ? link.textContent : '');
  }

  // Native share where the platform has a sheet (phones): the agent hands the
  // link over in the very conversation where the referral is happening. A
  // dismissed sheet is a choice, not an error — nothing to toast. Shared by
  // the Partenaires success box and the profile's Parrainage card.
  function shareLinkNative(text) {
    if (!text || typeof navigator.share !== 'function') return;
    try { navigator.share({ title: 'Nota', url: text }).catch(function () {}); } catch (e) {}
  }

  function partnerShareClick() {
    var link = $('partner-link');
    shareLinkNative(link ? link.textContent : '');
  }

  function handleCheckoutReturn() {
    var q = new URLSearchParams(location.search);
    var p = q.get('paiement');
    if (!p) return;
    // A successful return lands on « Mes offres » — the offer, its status and
    // its next step — not on the carnet with a toast that fades.
    if (p === 'ok') {
      track('paiement_ok');
      toast('Paiement autorisé. Votre offre est en cours de publication.');
      state.checkoutNotice = ['Paiement autorisé. Votre offre est en cours de publication.']
        .concat(expectationLines(offerCourriel(), false));
      state.tab = 'profil';
    } else if (p === 'annule') {
      track('paiement_annule');
      toast('Paiement annulé. Votre offre n’a pas été publiée.');
    }
    q.delete('paiement');
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }


  // ===== Intro gate — the arrival pitch films (clients / notaires). =====
  // Greets EVERY arrival until the visitor explicitly waves it away (skip,
  // « Entrer sur le site » or Escape set nota.introSeen; merely watching a
  // film to its end does not). Never over a deep link, never under
  // prefers-reduced-motion; ?intro=1 forces it back for review. The chosen
  // film routes to its pane when it ends or is skipped.
  var LS_INTRO = 'nota.introSeen';
  var igTimer = null;
  function igShouldShow() {
    if (/[?&]intro=1/.test(location.search)) return true;
    if (flagGet(LS_INTRO)) return false;
    if (location.hash && location.hash.length > 1) return false;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
  }
  function igPlay(film) {
    var stage = $('ig-stage-' + film);
    var other = $(film === 'client' ? 'ig-stage-notaire' : 'ig-stage-client');
    $('ig-chooser').hidden = true;
    $('ig-frame').hidden = false;
    other.hidden = true;
    stage.hidden = false;
    stage.classList.remove('run');
    void stage.offsetWidth; /* restart the CSS timeline */
    stage.classList.add('run');
    var tab = film === 'client' ? 'carnet' : 'notaires';
    $('ig-skip').dataset.tab = tab;
    clearTimeout(igTimer);
    igTimer = setTimeout(function () { igDismiss(tab, false); }, film === 'client' ? 20600 : 21600);
  }
  function igDismiss(tab, explicit) {
    clearTimeout(igTimer);
    var gate = $('intro-gate');
    if (!gate || gate.hidden) return;
    if (explicit !== false) flagSet(LS_INTRO, '1');
    gate.classList.add('ig-out');
    setTimeout(function () { gate.hidden = true; gate.classList.remove('ig-out'); }, 320);
    document.body.classList.remove('ig-open');
    if (tab) setTab(tab, { scroll: false });
  }
  function igMaybeShow() {
    var gate = $('intro-gate');
    if (!gate || !igShouldShow()) return false;
    $('ig-door-client').addEventListener('click', function () { igPlay('client'); });
    $('ig-door-notaire').addEventListener('click', function () { igPlay('notaire'); });
    $('ig-enter').addEventListener('click', function () { igDismiss(null, true); });
    $('ig-skip').addEventListener('click', function () { igDismiss($('ig-skip').dataset.tab || null, true); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !gate.hidden) igDismiss(null, true); });
    driftBuild(gate, 'ig-bg');
    gate.hidden = false;
    document.body.classList.add('ig-open');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Live support chat (ADR 0026 · ADR 0033 §5)
  // ---------------------------------------------------------------------------
  // A floating chat button; the first message mints a thread on the API and its
  // signed token lives on this device. While the panel is open, the thread is
  // polled every 8 s so the operator's reply lands live; closed, a thread keeps
  // a slow 30 s watch for a day so the FAB can light its unread dot. The
  // operator answers through the emailed link (#reponse=<token>), which opens
  // the reply dialog below; the visitor's own emailed copy links to
  // #messagerie, which opens the panel itself. Every class here is `sup-*`:
  // the retained-act `.chat-*` rules once reached in and dropped the visitor's
  // bubbles on the wrong side.
  var LS_SUPPORT = 'nota.support.v1';           // { threadId, token, lastAt, seenAt }
  var LS_SUPPORT_OPEN = 'nota.support.open.v1'; // '1' while the panel was left open
  var CHAT_POLL_MS = 8000;
  var CHAT_IDLE_POLL_MS = 30000;
  var CHAT_IDLE_MAX_MS = 24 * 60 * 60 * 1000;
  // The counter shows only near the cap — this many characters before it.
  var CHAT_COUNT_MARGIN = 200;
  var CHAT_FAB_LABEL = 'Messagerie — posez votre question';
  var CHAT_EMPTY_TEXT = 'On vous répond en général en quelques minutes pendant les heures d’ouverture.';
  var chatPollTimer = null, chatPollMs = 0;
  var chatReplyTimer = null, chatReplyMs = 0;
  var chatSending = false;

  function chatSession() { return lsLoad(LS_SUPPORT) || null; }
  function chatSessionPatch(patch) {
    var s = chatSession() || {};
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    lsSave(LS_SUPPORT, s);
    return s;
  }
  function chatForget() { try { localStorage.removeItem(LS_SUPPORT); } catch (e) {} }
  function chatApi(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; }); });
  }

  // --- Time ------------------------------------------------------------------
  function chatTs(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }
  // Is `a` newer than `b`? Unparsable stamps degrade to a lexical compare.
  function chatNewer(a, b) {
    if (!a) return false;
    if (!b) return true;
    var ta = chatTs(a), tb = chatTs(b);
    return ta != null && tb != null ? ta > tb : String(a) > String(b);
  }
  var fmtChatDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
  // « 14:32 » today, « 3 sept. · 14:32 » otherwise — local time, both languages.
  function chatWhen(iso) {
    var t = chatTs(iso); if (t == null) return '';
    var d = new Date(t), now = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hm : fmtChatDay.format(d) + ' · ' + hm;
  }

  // --- The log: diffed, never rebuilt -----------------------------------------
  function chatLabelFor(de, me) {
    if (de === D.SUPPORT_FROM.NOTA) return 'Nota';
    return me === D.SUPPORT_FROM.VISITEUR ? 'Vous' : 'Visiteur';
  }
  function chatMsgKey(m) { return m.id || (m.de + '|' + m.createdAt + '|' + m.texte); }
  function chatBubble(m, me) {
    var row = el('div', 'sup-msg' + (m.de === me ? ' is-mine' : ''));
    row.dataset.de = m.de;
    row.dataset.id = chatMsgKey(m);
    row.appendChild(el('div', 'sup-bubble', m.texte));
    var meta = el('div', 'sup-meta');
    meta.appendChild(el('span', 'sup-who', chatLabelFor(m.de, me)));
    var when = el('time', 'sup-when', chatWhen(m.createdAt));
    if (m.createdAt) when.setAttribute('datetime', m.createdAt);
    meta.appendChild(when);
    row.appendChild(meta);
    return row;
  }
  // Known ids keep their nodes (and the reader's scroll); new ones append; the
  // view follows only when the reader was already at the bottom. `me` is the
  // side that reads as « mine »: the visitor in the widget, Nota in the
  // operator's reply box.
  function chatRenderMessages(log, messages, me) {
    if (!log) return;
    me = me || D.SUPPORT_FROM.VISITEUR;
    var empty = log.querySelector('.sup-empty');
    if (!messages.length) {
      if (!empty && !log.querySelector('.sup-msg')) log.appendChild(el('div', 'sup-empty', CHAT_EMPTY_TEXT));
      return;
    }
    if (empty) empty.parentNode.removeChild(empty);
    var known = {};
    var rows = log.querySelectorAll('.sup-msg');
    for (var i = 0; i < rows.length; i++) known[rows[i].dataset.id] = true;
    var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
    var added = false;
    messages.forEach(function (m) {
      var k = chatMsgKey(m);
      if (known[k]) return;
      known[k] = true; added = true;
      log.appendChild(chatBubble(m, me));
    });
    if (added && atBottom) log.scrollTop = log.scrollHeight;
  }

  // --- Unread ----------------------------------------------------------------
  function chatUnreadCount(messages, seenAt) {
    var n = 0;
    messages.forEach(function (m) { if (m.de === D.SUPPORT_FROM.NOTA && chatNewer(m.createdAt, seenAt)) n++; });
    return n;
  }
  function chatSetUnread(n) {
    var fab = $('chat-fab'), dot = $('chat-fab-dot');
    if (!fab) return;
    if (dot) dot.hidden = !(n > 0);
    if (n > 0) {
      fab.dataset.unread = String(n);
      fab.setAttribute('aria-label', 'Messagerie — ' + (n === 1 ? '1 nouvelle réponse' : n + ' nouvelles réponses'));
    } else {
      delete fab.dataset.unread;
      fab.setAttribute('aria-label', CHAT_FAB_LABEL);
    }
  }
  function chatLastAt(messages) {
    var last = messages.length ? messages[messages.length - 1] : null;
    return (last && last.createdAt) || null;
  }

  // --- Polling: one clock, three cadences --------------------------------------
  // Live while open; a slow watch while closed with a thread that spoke in the
  // last 24 h (so a late answer still lights the dot); off otherwise.
  function chatSchedule() {
    var panel = $('chat-panel');
    var open = panel && !panel.hidden;
    var s = chatSession();
    var ms = 0;
    if (s && s.token) {
      if (open) ms = CHAT_POLL_MS;
      else {
        var last = chatTs(s.lastAt);
        if (last == null || Date.now() - last < CHAT_IDLE_MAX_MS) ms = CHAT_IDLE_POLL_MS;
      }
    }
    if (ms === chatPollMs && !!chatPollTimer === !!ms) return;
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
    chatPollMs = ms;
    if (ms) chatPollTimer = setInterval(chatRefresh, ms);
  }
  // The server forgot the thread (stale token, expired, purged): say so in
  // place — the bubbles stay, the next message starts fresh.
  function chatEnded() {
    chatForget();
    chatSetUnread(0);
    var ended = $('chat-ended'); if (ended) ended.hidden = false;
    chatSchedule();
  }
  async function chatRefresh() {
    var s = chatSession();
    if (!s || !s.token) { chatSchedule(); return; }
    var res = await chatApi('/support/thread', { token: s.token }).catch(function () { return null; });
    if (!res) return;
    if (res.status === 401 || res.status === 404) { chatEnded(); return; }
    if (res.status !== 200) return;
    var messages = res.json.messages || [];
    var panel = $('chat-panel');
    var open = panel && !panel.hidden;
    chatRenderMessages($('chat-log'), messages, D.SUPPORT_FROM.VISITEUR);
    var lastAt = chatLastAt(messages);
    var patch = {};
    if (lastAt) patch.lastAt = lastAt;
    if (open) { if (lastAt) patch.seenAt = lastAt; chatSetUnread(0); }
    else chatSetUnread(chatUnreadCount(messages, s.seenAt));
    if (Object.keys(patch).length) chatSessionPatch(patch);
    chatSchedule();
  }

  function chatToggle(open, opts) {
    opts = opts || {};
    var panel = $('chat-panel'), fab = $('chat-fab');
    if (!panel || !fab) return;
    var show = open != null ? open : panel.hidden;
    panel.hidden = !show;
    fab.setAttribute('aria-expanded', show ? 'true' : 'false');
    flagSet(LS_SUPPORT_OPEN, show ? '1' : '0');
    if (show) {
      // Opening reads everything that is there.
      var s = chatSession();
      if (s && s.lastAt) chatSessionPatch({ seenAt: s.lastAt });
      chatSetUnread(0);
      var log = $('chat-log');
      if (log && !log.querySelector('.sup-msg')) chatRenderMessages(log, [], D.SUPPORT_FROM.VISITEUR);
      chatRefresh();
      if (!opts.noFocus) { var inp = $('chat-text'); if (inp) { try { inp.focus(); } catch (e) {} } }
    } else {
      // Closing hands focus back to the door it came from.
      try { fab.focus(); } catch (e) {}
    }
    chatSchedule();
  }

  // --- Composer ------------------------------------------------------------------
  function chatAutoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    if (ta.scrollHeight) ta.style.height = ta.scrollHeight + 'px';
  }
  function chatCount() {
    var ta = $('chat-text'), c = $('chat-count');
    if (!ta || !c) return;
    var n = ta.value.length, max = D.SUPPORT_MESSAGE_MAX;
    var show = n >= max - CHAT_COUNT_MARGIN;
    c.hidden = !show;
    c.textContent = show ? n + ' / ' + max : '';
  }
  function chatSendingState(on) {
    chatSending = on;
    var send = $('chat-send'); if (!send) return;
    send.disabled = on;
    send.textContent = on ? 'Envoi…' : 'Envoyer';
  }
  async function chatSend() {
    if (chatSending) return;
    var text = $('chat-text'), err = $('chat-error'), courrielInp = $('chat-courriel');
    var texte = (text && text.value || '').trim();
    var courriel = (courrielInp && courrielInp.value || '').trim();
    // The domain is the gate — mirror it inline before any network call.
    var v = D.validateSupportMessage({ texte: texte, courriel: courriel });
    if (err) err.hidden = true;
    if (!v.ok) {
      if (err) { err.textContent = v.errors[0].message; err.hidden = false; }
      return;
    }
    chatSendingState(true);
    var s = chatSession();
    var body = { texte: v.texte };
    if (v.courriel) body.courriel = v.courriel;
    var res = await chatApi('/support/messages', { method: 'POST', token: s && s.token, body: body }).catch(function () { return null; });
    // A dead token never loses the message: forget it and mint a fresh thread.
    if (res && (res.status === 401 || res.status === 404) && s) {
      chatForget(); s = null;
      res = await chatApi('/support/messages', { method: 'POST', body: body }).catch(function () { return null; });
    }
    chatSendingState(false);
    if (!res || res.status !== 201) {
      if (err) {
        err.textContent = res && res.json && res.json.errors && res.json.errors[0]
          ? res.json.errors[0].message
          : 'La messagerie est momentanément indisponible. Réessayez, ou écrivez-nous par le formulaire « Nous joindre ».';
        err.hidden = false;
      }
      return;
    }
    var fresh = !(s && s.token);
    var log = $('chat-log');
    // A new thread starts a clean log: the bubbles above belonged to a
    // conversation that ended.
    if (fresh && log) clear(log);
    var ended = $('chat-ended'); if (ended) ended.hidden = true;
    var m = res.json.message;
    chatSessionPatch({
      threadId: res.json.threadId, token: res.json.token,
      lastAt: (m && m.createdAt) || null, seenAt: (m && m.createdAt) || null,
    });
    if (text) { text.value = ''; chatAutoGrow(text); chatCount(); }
    // The echo lands before the poll does.
    if (m && log) chatRenderMessages(log, [m], D.SUPPORT_FROM.VISITEUR);
    chatRefresh();
  }
  function onChatSubmit(e) { e.preventDefault(); chatSend(); }

  // --- The operator's reply box, opened by the emailed #reponse= link --------
  function chatReplyRender(json) {
    chatRenderMessages($('chat-reply-log'), json.messages || [], D.SUPPORT_FROM.NOTA);
    // The visitor's courriel, only when the API returns it.
    var line = $('chat-reply-courriel'), link = $('chat-reply-courriel-link');
    var mail = json.courriel || null;
    if (line) line.hidden = !mail;
    if (link && mail) { link.textContent = mail; link.href = 'mailto:' + mail; }
  }
  function chatReplySchedule(on) {
    if (chatReplyTimer) { clearInterval(chatReplyTimer); chatReplyTimer = null; }
    chatReplyMs = on ? CHAT_POLL_MS : 0;
    if (on) chatReplyTimer = setInterval(chatRefreshReply, CHAT_POLL_MS);
  }
  async function chatRefreshReply() {
    var dlg = $('chat-reply-dialog');
    if (!dlg || !dlg.open || !dlg.dataset.token) { chatReplySchedule(false); return; }
    var res = await chatApi('/support/thread', { token: dlg.dataset.token }).catch(function () { return null; });
    if (res && res.status === 200) chatReplyRender(res.json);
  }
  async function chatOpenReply(opToken) {
    var dlg = $('chat-reply-dialog'); if (!dlg) return;
    var res = await chatApi('/support/thread', { token: opToken }).catch(function () { return null; });
    if (!res || res.status !== 200) { toast('Lien de réponse invalide ou expiré.'); return; }
    var log = $('chat-reply-log'); if (log) clear(log);
    dlg.dataset.token = opToken;
    chatReplyRender(res.json);
    var sent = $('chat-reply-sent'); if (sent) sent.hidden = true;
    var form = $('chat-reply-form'); if (form) form.hidden = false;
    try { dlg.showModal(); } catch (e) { dlg.open = true; }
    // The box polls too: the visitor may write back while the operator reads.
    chatReplySchedule(true);
  }
  function chatCloseReply() {
    var d = $('chat-reply-dialog'); if (!d) return;
    try { d.close(); } catch (e) { d.open = false; }
    chatReplySchedule(false);
  }
  async function onChatReplySubmit(e) {
    e.preventDefault();
    var dlg = $('chat-reply-dialog'), text = $('chat-reply-text'), err = $('chat-reply-error');
    var texte = (text && text.value || '').trim();
    var v = D.validateSupportMessage({ texte: texte });
    if (err) err.hidden = true;
    if (!v.ok) { if (err) { err.textContent = v.errors[0].message; err.hidden = false; } return; }
    var res = await chatApi('/support/reply', { method: 'POST', token: dlg && dlg.dataset.token, body: { texte: v.texte } }).catch(function () { return null; });
    if (!res || res.status !== 200) {
      if (err) { err.textContent = 'Envoi impossible — le lien est peut-être expiré.'; err.hidden = false; }
      return;
    }
    if (text) text.value = '';
    if (res.json.message) chatRenderMessages($('chat-reply-log'), [res.json.message], D.SUPPORT_FROM.NOTA);
    await chatRefreshReply();
    var sent = $('chat-reply-sent'); if (sent) sent.hidden = false;
  }

  function supportBoot() {
    var fab = $('chat-fab'); if (!fab) return;
    var text = $('chat-text'), rText = $('chat-reply-text');
    // The hard cap is the domain's, never a literal in the markup.
    if (text) text.setAttribute('maxlength', String(D.SUPPORT_MESSAGE_MAX));
    if (rText) rText.setAttribute('maxlength', String(D.SUPPORT_MESSAGE_MAX));
    fab.addEventListener('click', function () { chatToggle(); });
    var close = $('chat-close'); if (close) close.addEventListener('click', function () { chatToggle(false); });
    var panel = $('chat-panel');
    if (panel) panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); chatToggle(false); } });
    if (text) {
      // Enter sends; Shift+Enter breaks a line.
      text.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSend(); }
      });
      text.addEventListener('input', function () { chatAutoGrow(text); chatCount(); });
    }
    var form = $('chat-form'); if (form) form.addEventListener('submit', onChatSubmit);
    var rForm = $('chat-reply-form'); if (rForm) rForm.addEventListener('submit', onChatReplySubmit);
    if (rText) rText.addEventListener('input', function () { var sent = $('chat-reply-sent'); if (sent) sent.hidden = true; });
    var rClose = $('chat-reply-close'); if (rClose) rClose.addEventListener('click', chatCloseReply);
    var rDlg = $('chat-reply-dialog'); if (rDlg) rDlg.addEventListener('close', function () { chatReplySchedule(false); });
    // The emailed links: consume the hash so a token never lingers in the
    // address bar (same pattern as #nauth=/#pauth=). `#reponse=` is the
    // operator's door, `#messagerie` the visitor's.
    var h = location.hash || '';
    var m = /(^|[#&])reponse=([^&]+)/.exec(h);
    var msg = /(^|[#&])messagerie(?=$|&)/.test(h);
    if (m || msg) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    if (m) chatOpenReply(decodeURIComponent(m[2]));
    if (msg) chatToggle(true);
    else if (flagGet(LS_SUPPORT_OPEN) === '1') chatToggle(true, { noFocus: true });
    else chatSchedule(); // a closed panel with a fresh thread keeps its slow watch
  }

  async function boot() {
    // The ambient scene first: one fixed layer of drifting marks behind ALL
    // content, alive before the first pane paints.
    driftBuild(document.body, 'site-bg', 'mark-drift--site');
    populateServiceSelects();
    buildServiceChips();
    buildBookingChips();
    readHash();
    // « #notaires&acte=<id> » (ADR 0033): the act emails' door into the console.
    ncConsumeActHash();
    handleReferralParam();
    refPrefillOfferField();
    handleCheckoutReturn();
    syncFilterChips();
    // If a shared link pre-selects filters, reveal the (otherwise hidden) panel.
    if (filtersActive()) { $('filters').hidden = false; $('filters-toggle').setAttribute('aria-expanded', 'true'); }
    renderLegend();
    renderContact();
    renderPartnerPane(); // rewards, type chips and the TOS amounts — domain data
    wire();
    wireCarnetSubscribe();
    enhanceSelects();
    supportBoot();

    // Restore theme preference
    var savedTheme = lsLoad('nota.theme'); if (savedTheme) setTheme(savedTheme);

    // Initialize offer form
    onOfferServiceChange();
    if (state.selectedDate) { $('o-date').value = state.selectedDate; onOfferDateChange(); }

    // Paint immediately from cache, then repaint when the month's data lands.
    renderActiveView();
    await refreshMonthData();
    renderActiveView();
    // A #jour= link is a link to a DAY: reopen it, exactly as the sender saw it.
    if (state.selectedDate && state.tab === 'carnet') openDay(state.selectedDate);

    // Restore a stored notary session (no fetch unless a token is present).
    ncRestore();
    // A magic link (#nauth=…) takes over: consume it and open the console.
    ncConsumeMagicHash();
    // A partner confirmation link (#pauth=…) confirms an email-verified code:
    // consume it, open the Partenaires pane, and reveal the shareable link.
    partnerConsumeClaimHash();
    // A client act link (#offre=…&d=…&cle=…, ADR 0033 §2.7): store the
    // token, open Mes offres on that band, and clean the URL.
    consumeOfferLinkHash();

    // In-app notifications: render what's stored, then derive fresh events
    // (date-approaching / retained) from this browser's own offers.
    renderNotifs();
    computeNotifications();

    // scroll:false so loading on a phone never scrolls past the calendar.
    setTab(state.tab, { scroll: false });

    // First arrival: the intro films own the first paint; the onboarding
    // guide yields whenever the gate is shown (it will greet a later visit).
    if (!igMaybeShow()) maybeShowOnboarding();

    // The funnel's first step: this page load. Once, after boot, whatever the
    // intro film or the guide do next.
    track('visite');

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
    refreshMonthData: refreshMonthData,
    // The success screen, revealed through the helper that declares an offline
    // "publication" for what it is.
    showOfferSuccess: showOfferSuccess,
    dossierState: dossierState,
    // Notary console hooks for tests and future integration.
    notary: {
      state: nc,
      signIn: ncSignIn,
      verifyMagic: ncVerifyMagic,
      signOut: ncSignOut,
      loadBids: ncLoadBids,
      accept: ncAccept,
      decline: ncDecline,
      declineLater: ncDeclineLater,
      cancelDecline: ncCancelDecline,
      flushDecline: ncFlushDecline,
      propose: ncPropose,
      requestDocuments: ncRequestDocuments,
      complete: ncCompleteAct,
      feedUrl: ncFeedUrl,
      retainedFor: ncRetainedFor,
      renderOpen: ncRenderOpen,
      loadEvals: ncLoadEvals,
      loadActs: ncLoadActs,
      chatSend: ncChatSend,
      release: ncRelease,
      prefsGet: ncPrefsGet,
      // ADR 0033: the contact gate, the confirm sheet, unread, prune.
      openRetain: ncOpenRetainSheet,
      closeRetain: ncCloseRetainSheet,
      profilManquants: ncProfilManquants,
      unread: ncUnreadCount,
      markSeen: ncMarkSeen,
      prune: ncRetainedPrune,
      whenLabel: ncWhenLabel,
    },
    // Live support chat (ADR 0026) hooks for tests.
    support: {
      toggle: chatToggle,
      refresh: chatRefresh,
      openReply: chatOpenReply,
      refreshReply: chatRefreshReply,
      pollMs: function () { return chatPollMs; },
      replyPollMs: function () { return chatReplyMs; },
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
    intro: {
      show: igMaybeShow,
      play: igPlay,
      dismiss: igDismiss,
      reset: function () { flagClear(LS_INTRO); },
    },
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
    // The retained-act conversation (ADR 0033): the helpers both sides share,
    // and the client-side doors, for tests.
    chat: { whenLabel: whenLabel, thread: chatThread, composer: chatComposer },
    client: { openOfferBand: openOfferBand, pollTick: clientPollTick, markSeen: markOfferSeen, unread: unreadCount },
    _internals: { applyFilters: applyFilters, acceptance: acceptance, buildCalendarLinks: buildCalendarLinks },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
