/* =============================================================================
   Nota admin console. Vanilla, zero runtime dependencies, strict-CSP safe:
   no inline scripts, no inline on* handlers, no inline style= that matters — all
   behavior is wired here via addEventListener, all styling is class-based.

   Security note: the session bearer lives ONLY in the module-scoped `session`
   variable below. It is NEVER written to localStorage/sessionStorage/cookies, so
   an XSS payload has nothing persistent to exfiltrate, and it is intentionally
   lost on reload (the operator re-authenticates via a fresh magic link).
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // API base — same-origin /api/admin in production. CloudFront serves
  // /api/admin/* to the admin API and strips ONLY the /api prefix, so a browser
  // request to /api/admin/auth/request reaches the API as /admin/auth/request
  // (the contract route). The '/admin' namespace therefore lives in the base:
  // every endpoint path below is written RELATIVE to it (e.g. '/auth/request',
  // '/me', '/metrics/overview'), never with a second '/admin'. For local dev,
  // set <meta name="nota-admin-api"> to a base that also ends in the API's
  // namespace, e.g. "http://localhost:8790/admin".
  // ---------------------------------------------------------------------------
  var apiMeta = document.querySelector('meta[name="nota-admin-api"]');
  var API_BASE = (apiMeta && apiMeta.content && apiMeta.content.trim()) || '/api/admin';

  // ---------------------------------------------------------------------------
  // In-memory session (see the security note above). Nothing here is persisted.
  // ---------------------------------------------------------------------------
  var session = null;     // bearer token
  var sessionExp = null;  // expiresAt (ISO) — drives the silent refresh timer
  var me = null;          // { email, role, permissions }
  var refreshTimer = null;

  // Overview view state.
  var RANGE_PRESETS = [7, 30, 90];
  var rangeDays = 30;      // default range: last 30 days
  var overviewBody = null; // metrics region node, so a preset change re-renders it alone
  var overviewGen = 0;     // monotonic fetch generation, so a stale response can't overwrite a newer one

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) { for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k])); }
    return e;
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3400);
  }

  // ---------------------------------------------------------------------------
  // Formatting (Québec fr-CA)
  // ---------------------------------------------------------------------------
  // Integer with a space thousands separator (matches @nota/domain money()).
  function num(v) {
    var n = Math.round(Number(v) || 0);
    var neg = n < 0; n = Math.abs(n);
    return (neg ? '−' : '') + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  // Cents → "1 234,56 $" (or "1 234 $" when whole), same look as domain money().
  function moneyCents(cents) {
    var n = Math.round(Number(cents) || 0);
    var neg = n < 0; n = Math.abs(n);
    var dollars = Math.floor(n / 100), rem = n % 100;
    var digits = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var frac = rem ? (',' + String(rem).padStart(2, '0')) : '';
    return (neg ? '−' : '') + digits + frac + ' $';
  }
  // 4.7 → « 4,7 » : un nombre à virgule décimale, sans zéro inutile (deux
  // décimales au plus, ce que servent les axes de la cote).
  function dec(v) {
    var n = Math.round((Number(v) || 0) * 100) / 100;
    return String(n).replace('.', ',');
  }
  // Retention rate → "42 %" / "42,5 %". Accepts a 0..1 fraction or a 0..100
  // percent (see the API assumption in the file header / task report).
  function formatRate(v) {
    var x = Number(v) || 0;
    if (x > 0 && x <= 1) x = x * 100;
    var r = Math.round(x * 10) / 10;
    return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',') + ' %';
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isoMinusDays(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] - n)).toISOString().slice(0, 10);
  }
  var fmtShort = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00Z');
    // Never let one malformed date from the API blank an entire chart.
    return isNaN(d.getTime()) ? String(iso) : fmtShort.format(d);
  }

  // ---------------------------------------------------------------------------
  // Theme toggle (preference persisted; this is NOT the session token)
  // ---------------------------------------------------------------------------
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || ''; }
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function toggleTheme() {
    var isDark = currentTheme() === 'dark' || (currentTheme() === '' && systemDark());
    var next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('nota.admin.theme', JSON.stringify(next)); } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------
  function setSession(token, expiresAt) {
    session = token || null;
    sessionExp = expiresAt || null;
    scheduleRefresh(sessionExp);
  }
  function clearSession() {
    session = null; sessionExp = null; me = null;
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    showUserbar(false);
  }
  function scheduleRefresh(expiresAt) {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (!expiresAt) return;
    var ms = new Date(expiresAt).getTime() - Date.now() - 60000; // refresh ~1 min early
    if (!isFinite(ms)) return;
    refreshTimer = setTimeout(doRefresh, Math.max(5000, ms));
  }
  async function doRefresh() {
    if (!session) return;
    var r = await call('POST', '/auth/refresh');
    if (r.status === 200 && r.json && r.json.ok && r.json.session) {
      setSession(r.json.session, r.json.expiresAt);
    }
    // A 401 is already handled inside call(): session cleared + routed to auth.
  }

  // ---------------------------------------------------------------------------
  // API call. Adds the bearer when present, parses JSON, and on a 401 for an
  // authenticated request drops the session and routes to the auth screen.
  // ---------------------------------------------------------------------------
  async function call(method, path, body) {
    var hadSession = !!session;
    var headers = { accept: 'application/json' };
    var hasBody = body !== undefined && body !== null;
    if (hasBody) headers['content-type'] = 'application/json';
    if (session) headers.authorization = 'Bearer ' + session;

    var res;
    try {
      res = await fetch(API_BASE + path, {
        method: method,
        headers: headers,
        body: hasBody ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, json: null, network: true };
    }
    var json = null;
    try { json = await res.json(); } catch (e) { json = null; }

    if (res.status === 401 && hadSession) {
      clearSession();
      toast('Session expirée. Reconnectez-vous.');
      history.replaceState(null, '', location.pathname);
      renderAuthRequest({});
    }
    return { ok: res.ok, status: res.status, json: json };
  }

  // ---------------------------------------------------------------------------
  // Top-bar userbar
  // ---------------------------------------------------------------------------
  function showUserbar(on) {
    var bar = $('admin-userbar'); if (bar) bar.hidden = !on;
  }
  var ROLE_LABELS = { super_admin: 'Administrateur principal', analyst: 'Analyste' };
  function renderUserbar() {
    if (!me) return;
    $('admin-user-email').textContent = me.email || '';
    var role = $('admin-user-role');
    role.textContent = ROLE_LABELS[me.role] || me.role || '';
    role.setAttribute('data-role', me.role || '');
    role.title = me.role === 'analyst' ? 'Lecture seule' : 'Accès complet';
    showUserbar(true);
  }

  // ---------------------------------------------------------------------------
  // Router  (#/ = Aperçu, #/auth = magic-link handler)
  // ---------------------------------------------------------------------------
  function router() {
    var hash = location.hash || '';
    if (hash.indexOf('#/auth') === 0) { handleAuthRoute(hash); return; }
    if (!session) { renderAuthRequest({}); return; }
    if (hash.indexOf('#/courriels') === 0) { renderCourriels(); return; }
    if (hash.indexOf('#/commission') === 0) { renderCommission(); return; }
    if (hash.indexOf('#/annulation') === 0) { renderAnnulation(); return; }
    if (hash.indexOf('#/notaires') === 0) { renderNotaires(); return; }
    if (hash.indexOf('#/audit') === 0) { renderAudit(); return; }
    renderOverview(); // '#/' and any unknown authed route land on the overview
  }
  function focusTitle() {
    var h = document.querySelector('.page-title, .auth-title');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  // ---------------------------------------------------------------------------
  // Auth — step (a): request a magic link
  // ---------------------------------------------------------------------------
  function renderAuthRequest(opts) {
    opts = opts || {};
    clearSession();
    var app = $('app'); clear(app);

    var screen = el('div', 'auth-screen');
    var card = el('div', 'auth-card view-enter');

    var logo = el('span', 'auth-logo');
    var img = el('img'); img.src = 'favicon.svg'; img.width = 40; img.height = 40; img.alt = '';
    logo.appendChild(img); card.appendChild(logo);

    card.appendChild(el('h1', 'auth-title', 'Console Nota'));
    card.appendChild(el('p', 'auth-lead', 'Accès réservé. Recevez un lien de connexion à usage unique par courriel.'));

    if (opts.error) {
      var eb = el('div', 'auth-error');
      eb.appendChild(el('strong', null, opts.error));
      card.appendChild(eb);
    }

    var form = el('form', 'auth-form'); form.noValidate = true;
    var field = el('div', 'field');
    var label = el('label', null, 'Courriel'); label.setAttribute('for', 'auth-email');
    var input = el('input', 'input');
    input.type = 'email'; input.id = 'auth-email';
    input.autocomplete = 'email'; input.inputMode = 'email';
    input.placeholder = 'vous@nota.ca'; input.required = true;
    field.appendChild(label); field.appendChild(input);

    var submit = el('button', 'btn btn-primary btn-lg btn-block', 'Recevoir le lien');
    submit.type = 'submit';

    var note = el('div'); note.hidden = true; // neutral confirmation / dev link region

    form.appendChild(field);
    form.appendChild(submit);
    form.appendChild(note);
    card.appendChild(form);

    card.appendChild(el('p', 'auth-fineprint',
      'Le lien expire après un court délai et ne peut servir qu’une fois. Aucune session n’est conservée après la fermeture de l’onglet.'));

    screen.appendChild(card);
    app.appendChild(screen);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        note.hidden = false; note.className = 'auth-error';
        clear(note); note.appendChild(el('strong', null, 'Courriel invalide.'));
        input.focus();
        return;
      }
      submitLinkRequest(email, submit, note);
    });

    input.focus();
  }

  async function submitLinkRequest(email, submit, note) {
    submit.disabled = true; submit.textContent = 'Envoi…';
    var r = await call('POST', '/auth/request', { email: email });
    submit.disabled = false; submit.textContent = 'Recevoir le lien';

    note.hidden = false; clear(note);
    if (r.network) {
      note.className = 'auth-error';
      note.appendChild(el('strong', null, 'Service indisponible. Réessayez dans un instant.'));
      return;
    }
    // Neutral by design — never reveal whether the address is authorized.
    note.className = 'auth-note';
    note.appendChild(document.createTextNode('Si cette adresse est autorisée, un lien vient d’être envoyé.'));

    // Dev convenience: the API returns devLink only in non-production.
    if (r.json && r.json.devLink) {
      var dev = el('div', 'auth-devlink');
      var a = el('a', null, 'Lien de développement →');
      a.href = r.json.devLink; a.rel = 'noopener';
      dev.appendChild(a);
      note.appendChild(dev);
    }
  }

  // ---------------------------------------------------------------------------
  // Auth — step (b): the magic link lands on #/auth?token=XYZ
  // ---------------------------------------------------------------------------
  function handleAuthRoute(hash) {
    var qi = hash.indexOf('?');
    var params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : '');
    var token = params.get('token');

    if (!token) {
      // Bare #/auth — nothing to verify.
      if (session) { history.replaceState(null, '', location.pathname); renderOverview(); }
      else renderAuthRequest({});
      return;
    }

    // Show a brief verifying state while we exchange the token.
    var app = $('app'); clear(app);
    var screen = el('div', 'auth-screen');
    var card = el('div', 'auth-card');
    card.appendChild(el('h1', 'auth-title', 'Vérification du lien…'));
    card.appendChild(el('p', 'auth-lead', 'Un instant pendant que nous validons votre accès.'));
    screen.appendChild(card); app.appendChild(screen);

    verifyToken(token).then(function (ok) {
      // Strip the token from the URL either way — a used/dead token must not linger.
      history.replaceState(null, '', location.pathname);
      if (ok) { renderOverview(); toast('Connexion réussie.'); }
      else { renderAuthRequest({ error: 'Lien invalide ou expiré.' }); }
    });
  }

  async function verifyToken(token) {
    var r = await call('POST', '/auth/verify', { token: token });
    if (r.status === 200 && r.json && r.json.ok && r.json.session) {
      setSession(r.json.session, r.json.expiresAt);
      // role also arrives here; me (with email) is fetched fresh by loadMe().
      if (r.json.role) me = { role: r.json.role, email: '' };
      return true;
    }
    return false;
  }

  async function loadMe() {
    var r = await call('GET', '/me');
    if (r.status === 200 && r.json) { me = r.json; return { ok: true }; }
    return { ok: false, status: r.status }; // a 401 is already re-routed by call()
  }

  // A recoverable full-screen error (used when a post-verify step fails and no
  // shell is mounted yet), so the operator is never stranded with no way forward.
  function renderFatal(message, retryFn) {
    var app = $('app'); clear(app);
    var screen = el('div', 'auth-screen');
    var card = el('div', 'auth-card');
    card.appendChild(el('h1', 'auth-title', 'Une erreur est survenue'));
    card.appendChild(el('p', 'auth-lead', message));
    var retry = el('button', 'btn btn-primary', 'Réessayer');
    retry.type = 'button';
    retry.addEventListener('click', function () { retryFn(); });
    card.appendChild(retry);
    var back = el('button', 'btn btn-sm', 'Se reconnecter');
    back.type = 'button';
    back.addEventListener('click', function () { clearSession(); renderAuthRequest({}); });
    card.appendChild(back);
    screen.appendChild(card); app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Auth — step (c): authenticated shell + logout
  // ---------------------------------------------------------------------------
  async function logout() {
    if (session) { try { await call('POST', '/auth/logout'); } catch (e) {} }
    clearSession();
    history.replaceState(null, '', location.pathname);
    renderAuthRequest({});
    toast('Déconnecté.');
  }

  function buildRail(active) {
    var rail = el('nav', 'admin-rail');
    rail.setAttribute('aria-label', 'Sections de la console');
    rail.appendChild(el('span', 'admin-rail-label', 'Console'));

    var overview = el('button', 'admin-rail-link');
    overview.type = 'button';
    overview.appendChild(iconGrid());
    overview.appendChild(document.createTextNode('Aperçu'));
    if (active === 'overview') overview.setAttribute('aria-current', 'page');
    overview.addEventListener('click', function () { go('#/'); });
    rail.appendChild(overview);

    // Courriels — the admin-editable email templates (ADR 0018).
    var mails = el('button', 'admin-rail-link');
    mails.type = 'button';
    mails.appendChild(iconMail());
    mails.appendChild(document.createTextNode('Courriels'));
    if (active === 'courriels') mails.setAttribute('aria-current', 'page');
    mails.addEventListener('click', function () { go('#/courriels'); });
    rail.appendChild(mails);

    // Commission — the rating-earned barème Nota decides (ADR 0021 §4).
    var comm = el('button', 'admin-rail-link');
    comm.type = 'button';
    comm.appendChild(iconPercent());
    comm.appendChild(document.createTextNode('Commission'));
    if (active === 'commission') comm.setAttribute('aria-current', 'page');
    comm.addEventListener('click', function () { go('#/commission'); });
    rail.appendChild(comm);

    // Annulation — the late-cancellation fee barème Nota decides (ADR 0023 §2).
    var annul = el('button', 'admin-rail-link');
    annul.type = 'button';
    annul.appendChild(iconCalendarX());
    annul.appendChild(document.createTextNode('Annulation'));
    if (active === 'annulation') annul.setAttribute('aria-current', 'page');
    annul.addEventListener('click', function () { go('#/annulation'); });
    rail.appendChild(annul);

    // Notaires — le tableau d'honneur des cotes (ADR 0028) — et Audit — le
    // journal append-only. Les deux exposent des données personnelles : la
    // porte est 'pii:read', donc l'administrateur principal. Pour un analyste
    // l'entrée reste VISIBLE mais fermée, comme les autres contrôles réservés :
    // la console garde sa forme et dit pourquoi, plutôt que d'escamoter une
    // section et de laisser croire qu'elle n'existe pas.
    var reserved = !canReadPii();
    rail.appendChild(railLink('Notaires', iconUsers(), 'notaires', '#/notaires', active, reserved));
    rail.appendChild(railLink('Audit', iconShield(), 'audit', '#/audit', active, reserved));

    // Phase-2 placeholder — visible but disabled, so the console reads as a
    // console without shipping a dead link.
    var soon = el('button', 'admin-rail-link', null);
    soon.type = 'button'; soon.disabled = true;
    soon.appendChild(iconDot());
    soon.appendChild(document.createTextNode('Offres'));
    soon.appendChild(el('span', 'admin-rail-soon', 'Bientôt'));
    rail.appendChild(soon);
    return rail;
  }

  // Une entrée de rail qui peut être fermée : désactivée et estampillée
  // « Réservé » quand la permission manque, active et routante sinon.
  function railLink(name, icon, key, hash, active, reserved) {
    var b = el('button', 'admin-rail-link');
    b.type = 'button';
    b.appendChild(icon);
    b.appendChild(document.createTextNode(name));
    if (reserved) {
      b.disabled = true;
      b.appendChild(el('span', 'admin-rail-soon', 'Réservé'));
      b.title = 'Réservé à l’administrateur principal.';
      return b;
    }
    if (active === key) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', function () { go(hash); });
    return b;
  }

  function mountAuthed(active, content) {
    var app = $('app'); clear(app);
    var shell = el('div', 'admin-shell');
    shell.appendChild(buildRail(active));
    shell.appendChild(content);
    app.appendChild(shell);
  }

  // ---------------------------------------------------------------------------
  // Overview page
  // ---------------------------------------------------------------------------
  async function renderOverview() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        // A 401 was already re-routed to the sign-in screen by call(); any other
        // failure (transient /me 500, network) must NOT strand the operator on
        // the "Vérification du lien…" card — show a recoverable error instead.
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderOverview);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');

    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Tableau de bord'));
    titleWrap.appendChild(el('h1', 'page-title', 'Aperçu'));
    titleWrap.appendChild(el('p', 'page-sub', 'Activité du marché notarial — offres, rétention et commissions.'));
    head.appendChild(titleWrap);
    head.appendChild(el('span', 'admin-spacer'));
    head.appendChild(buildRangeControl());
    content.appendChild(head);

    overviewBody = el('div');
    content.appendChild(overviewBody);

    mountAuthed('overview', content);
    focusTitle();
    await loadOverviewInto(overviewBody);
  }

  function buildRangeControl() {
    var wrap = el('div', 'range-control');
    var seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Période');
    var note = el('span', 'range-note');

    RANGE_PRESETS.forEach(function (d) {
      var b = el('button', 'seg-btn' + (d === rangeDays ? ' is-on' : ''), d + ' jours');
      b.type = 'button';
      b.setAttribute('aria-pressed', d === rangeDays ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (rangeDays === d) return;
        rangeDays = d;
        seg.querySelectorAll('.seg-btn').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        updateRangeNote(note);
        if (overviewBody) loadOverviewInto(overviewBody);
      });
      seg.appendChild(b);
    });
    updateRangeNote(note);
    wrap.appendChild(seg); wrap.appendChild(note);
    return wrap;
  }
  function updateRangeNote(note) {
    var to = todayISO(), from = isoMinusDays(to, rangeDays - 1);
    note.textContent = 'du ' + shortDate(from) + ' au ' + shortDate(to);
  }

  async function loadOverviewInto(container, opts) {
    opts = opts || {};
    // Sequence guard: rapidly switching range presets fires overlapping fetches;
    // stamp each with a generation and drop any response that a newer request
    // has superseded, so a slow earlier fetch can never overwrite the newer view.
    var gen = ++overviewGen;
    clear(container);
    container.appendChild(buildSkeletons());

    var to = todayISO(), from = isoMinusDays(to, rangeDays - 1);
    var r = await call('GET', '/metrics/overview?from=' + from + '&to=' + to);
    if (gen !== overviewGen) return; // superseded by a newer range selection
    if (r.status === 401) return; // handled by call()

    clear(container);
    if (!r.ok || !r.json) {
      container.appendChild(buildErrorBanner(function () { loadOverviewInto(container, { afterError: true }); }));
      return;
    }
    // Confirm recovery only after a prior failure — never on the initial load,
    // where a toast on every sign-in would just be noise.
    if (opts.afterError) toast('Données chargées.');
    var data = r.json;
    var view = el('div', 'view-enter');
    if (isEmptyOverview(data)) {
      view.appendChild(buildStatTiles(data, true)); // real zeros, muted
      view.appendChild(buildEmptyState());
    } else {
      view.appendChild(buildStatTiles(data, false));
      view.appendChild(buildCharts(data));
    }
    // Parrainages are all-time (ledger, not range series): shown in either
    // branch whenever the program has activity.
    var parr = buildParrainages(data.parrainages);
    if (parr) view.appendChild(parr);
    container.appendChild(view);
  }

  function isEmptyOverview(d) {
    var k = d.kpis || {}, g = d.gauge || {}, s = d.series || {};
    var kZero = !(k.offersPosted || k.offersRetained || k.actsCompleted || k.commissionCents || k.retentionRate);
    var gZero = !(g.open || g.retained || g.activeNotaries || g.onboardingNotaries);
    var perDay = (s.offersPerDay || []).some(function (p) { return (p.count || 0) > 0; });
    var byService = (s.byService || []).some(function (p) { return (p.offers || 0) > 0 || (p.retained || 0) > 0; });
    return kZero && gZero && !perDay && !byService;
  }

  // --- Stat tiles ------------------------------------------------------------
  function tile(k, v, sub, gauge) {
    var t = el('div', 'stat-tile' + (gauge ? ' is-gauge' : ''));
    t.appendChild(el('div', 'stat-k', k));
    t.appendChild(el('div', 'stat-v', v));
    if (sub) t.appendChild(el('div', 'stat-sub', sub));
    return t;
  }
  function buildStatTiles(d, muted) {
    var k = d.kpis || {}, g = d.gauge || {};
    var grid = el('div', 'stat-grid' + (muted ? ' is-muted' : ''));

    var retainedSub = 'sur ' + num(k.offersPosted || 0) + ' publiées';
    grid.appendChild(tile('Offres publiées', num(k.offersPosted || 0), 'sur la période', false));
    grid.appendChild(tile('Taux de rétention', formatRate(k.retentionRate || 0),
      num(k.offersRetained || 0) + ' retenues ' + retainedSub, false));
    grid.appendChild(tile('Actes complétés', num(k.actsCompleted || 0), 'sur la période', false));
    grid.appendChild(tile('Commission perçue', moneyCents(k.commissionCents || 0), 'sur la période', false));

    grid.appendChild(tile('Offres ouvertes', num(g.open || 0), 'en ce moment', true));
    grid.appendChild(tile('Notaires actifs', num(g.activeNotaries || 0), 'sur la plateforme', true));
    grid.appendChild(tile('Notaires en intégration', num(g.onboardingNotaries || 0), 'en intégration', true));
    return grid;
  }

  // --- Charts ----------------------------------------------------------------
  function buildCharts(d) {
    var s = d.series || {};
    var grid = el('div', 'chart-grid');

    // Line chart card — offres par jour.
    var lineCard = el('div', 'chart-card');
    var lh = el('div', 'chart-card-head');
    var lht = el('div');
    lht.appendChild(el('div', 'chart-card-title', 'Offres par jour'));
    lht.appendChild(el('div', 'chart-card-sub', 'Nombre d’offres publiées chaque jour de la période.'));
    lh.appendChild(lht);
    lineCard.appendChild(lh);
    var lScroll = el('div', 'chart-scroll');
    lScroll.appendChild(buildLineChart(s.offersPerDay || []));
    lineCard.appendChild(lScroll);
    grid.appendChild(lineCard);

    // Bar chart card — offres vs retenues par service.
    var barCard = el('div', 'chart-card');
    var bh = el('div', 'chart-card-head');
    var bht = el('div');
    bht.appendChild(el('div', 'chart-card-title', 'Par service'));
    bht.appendChild(el('div', 'chart-card-sub', 'Offres publiées et part retenue, par type d’acte.'));
    bh.appendChild(bht);
    bh.appendChild(buildLegend());
    barCard.appendChild(bh);
    barCard.appendChild(buildBarChart(s.byService || []));
    grid.appendChild(barCard);

    return grid;
  }

  // --- Parrainages ------------------------------------------------------------
  // The partner-referral ledger (ADR 0011): one row per code, both reward
  // tracks. All-time (derived from the records, not the range) — so it renders
  // even when the selected period is empty. Returns null when there is nothing
  // to show: an empty program is not information the overview needs.
  function buildParrainages(section) {
    // The API sends { client, notaire, codes: [...] } — the two flat reward
    // amounts (domain data, echoed so this app never hardcodes them) and one
    // row per code. A bare array is tolerated for older payloads.
    var rows = section && Array.isArray(section.codes) ? section.codes : Array.isArray(section) ? section : [];
    if (!rows.length) return null;
    var card = el('div', 'chart-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Parrainages'));
    var sub = section && section.client && section.notaire
      ? 'Récompenses des partenaires référents — ' + moneyCents(section.client * 100) + ' à la rétention (client), ' + moneyCents(section.notaire * 100) + ' au premier acte (notaire).'
      : 'Récompenses des partenaires référents — dû à la rétention (clients) et au premier acte (notaires).';
    ht.appendChild(el('div', 'chart-card-sub', sub));
    head.appendChild(ht);
    card.appendChild(head);

    var scroll = el('div', 'chart-scroll');
    var table = el('table', 'ptable');
    var thead = el('thead');
    var hr = el('tr');
    ['Code', 'Partenaire', 'Demandes', 'Retenues', 'Complétés', 'Notaires', 'Actifs', 'Dû'].forEach(function (h, i) {
      var th = el('th', i >= 2 ? 'is-num' : null, h);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'ptable-code', r.code || '—'));
      // Registered partners carry their category label + courriel from the
      // registry join; an unregistered code still earns, shown bare.
      var who = el('td');
      who.appendChild(el('div', null, r.typeNom || 'Non inscrit'));
      if (r.courriel) who.appendChild(el('div', 'ptable-sub', r.courriel));
      tr.appendChild(who);
      tr.appendChild(el('td', 'is-num', num(r.demandes || 0)));
      tr.appendChild(el('td', 'is-num', num(r.retenues || 0)));
      // Information only (the reward is earned at retention, ADR 0011) — but
      // the operator paying out by hand wants to see completion at a glance.
      tr.appendChild(el('td', 'is-num', num(r.completes || 0)));
      tr.appendChild(el('td', 'is-num', num(r.notaires || 0)));
      tr.appendChild(el('td', 'is-num', num(r.notairesActifs || 0)));
      tr.appendChild(el('td', 'is-num ptable-du', moneyCents((r.du || 0) * 100)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);
    return card;
  }

  function buildLegend() {
    var lg = el('div', 'chart-legend');
    [['is-offers', 'Publiées'], ['is-retained', 'Retenues']].forEach(function (p) {
      var item = el('span', 'legend-item');
      item.appendChild(el('span', 'legend-swatch ' + p[0]));
      item.appendChild(document.createTextNode(p[1]));
      lg.appendChild(item);
    });
    return lg;
  }

  function niceCeil(v) {
    if (v <= 5) return 5;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / mag;
    var nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * mag;
  }

  function buildLineChart(pts) {
    pts = pts || [];
    var W = 680, H = 240, padL = 38, padR = 14, padT = 16, padB = 28;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var maxV = Math.max.apply(null, pts.map(function (p) { return p.count || 0; }).concat([1]));
    // Force an EVEN top so the middle gridline (top/2) is always an integer count
    // — otherwise niceCeil(<=5)=5 draws the midline at 2.5 but labels it "3".
    var top = niceCeil(maxV);
    if (top % 2) top += 1;
    var n = pts.length;
    function x(i) { return padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW); }
    function y(v) { return padT + innerH - (v / top) * innerH; }

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg',
      role: 'img', 'aria-label': 'Graphique linéaire des offres publiées par jour.',
      preserveAspectRatio: 'xMidYMid meet',
    });
    var title = svgEl('title'); title.textContent = 'Offres publiées par jour'; svg.appendChild(title);

    // Horizontal gridlines + y ticks at 0, top/2, top.
    [0, top / 2, top].forEach(function (v) {
      var gy = y(v);
      svg.appendChild(svgEl('line', { class: 'chart-gridline', x1: padL, y1: gy, x2: W - padR, y2: gy }));
      var t = svgEl('text', { class: 'chart-tick', x: padL - 6, y: gy + 3.5, 'text-anchor': 'end' });
      t.textContent = String(Math.round(v));
      svg.appendChild(t);
    });

    if (n) {
      var linePts = pts.map(function (p, i) { return x(i) + ',' + y(p.count || 0); }).join(' ');
      var areaPts = padL + ',' + y(0) + ' ' + linePts + ' ' + x(n - 1) + ',' + y(0);
      svg.appendChild(svgEl('polygon', { class: 'chart-area', points: areaPts }));
      svg.appendChild(svgEl('polyline', { class: 'chart-line', points: linePts }));
      if (n <= 31) pts.forEach(function (p, i) {
        svg.appendChild(svgEl('circle', { class: 'chart-dot', cx: x(i), cy: y(p.count || 0), r: 2.6 }));
      });

      var first = svgEl('text', { class: 'chart-label', x: padL, y: H - 8, 'text-anchor': 'start' });
      first.textContent = shortDate(pts[0].date); svg.appendChild(first);
      if (n > 1) {
        var last = svgEl('text', { class: 'chart-label', x: W - padR, y: H - 8, 'text-anchor': 'end' });
        last.textContent = shortDate(pts[n - 1].date); svg.appendChild(last);
      }
    }
    return svg;
  }

  function buildBarChart(rows) {
    rows = rows || [];
    var n = rows.length;
    var W = 680, padL = 4, padR = 4, padT = 6;
    var rowH = 50, barH = 12;
    var H = padT + Math.max(1, n) * rowH;
    var innerW = W - padL - padR;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.offers || 0; }).concat([1]));

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg',
      role: 'img', 'aria-label': 'Diagramme à barres des offres publiées et retenues par service.',
      preserveAspectRatio: 'xMidYMid meet',
    });
    var title = svgEl('title'); title.textContent = 'Offres et rétention par service'; svg.appendChild(title);

    rows.forEach(function (r, i) {
      var y0 = padT + i * rowH;
      var nom = r.nom || r.serviceId || 'Service';
      var offers = r.offers || 0, retained = r.retained || 0;

      var name = svgEl('text', { class: 'bar-row-name', x: padL, y: y0 + 14 });
      name.textContent = nom; svg.appendChild(name);

      var val = svgEl('text', { class: 'bar-row-value', x: W - padR, y: y0 + 14, 'text-anchor': 'end' });
      val.textContent = num(offers) + ' publiées · ' + num(retained) + ' retenues';
      svg.appendChild(val);

      var barY = y0 + 24;
      svg.appendChild(svgEl('rect', { class: 'bar-track', x: padL, y: barY, width: innerW, height: barH, rx: 3 }));
      var offW = Math.max(0, (offers / maxV) * innerW);
      svg.appendChild(svgEl('rect', { class: 'bar-offers', x: padL, y: barY, width: offW, height: barH, rx: 3 }));
      var retW = Math.max(0, (retained / maxV) * innerW);
      svg.appendChild(svgEl('rect', { class: 'bar-retained', x: padL, y: barY, width: retW, height: barH, rx: 3 }));
    });
    return svg;
  }

  // ---------------------------------------------------------------------------
  // Courriels page — admin-editable email templates (ADR 0018 §3).
  // GET /notifications/templates lists the registry merged with the stored
  // overrides; PUT/DELETE per key edit them. Writing needs the
  // 'notifications:write' permission (super_admin) — an analyst sees the same
  // rows read-only, with no save controls. Subjects only: bodies stay code.
  // ---------------------------------------------------------------------------
  var AUDIENCE_ORDER = ['client', 'notaire', 'partenaire', 'operateur', 'admin'];
  var AUDIENCE_LABELS = {
    client: 'Clients',
    notaire: 'Notaires',
    partenaire: 'Partenaires',
    operateur: 'Opérateur',
    admin: 'Console admin',
  };
  var courrielsBody = null;

  function isEnglish() {
    try { return !!(window.NotaI18N && window.NotaI18N.lang && window.NotaI18N.lang() === 'en'); }
    catch (e) { return false; }
  }
  function canWriteNotifications() {
    return !!(me && me.permissions && me.permissions.indexOf('notifications:write') >= 0);
  }

  async function renderCourriels() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderCourriels);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Notifications'));
    titleWrap.appendChild(el('h1', 'page-title', 'Courriels'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Sujets et activation des modèles de courriels. Les corps restent gérés par le code.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    courrielsBody = el('div');
    content.appendChild(courrielsBody);

    mountAuthed('courriels', content);
    focusTitle();
    await loadTemplatesInto(courrielsBody);
  }

  async function loadTemplatesInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 4; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/notifications/templates');
    if (r.status === 401) return; // handled by call()
    clear(container);
    if (!r.ok || !r.json || !Array.isArray(r.json.templates)) {
      container.appendChild(buildErrorBanner(function () { loadTemplatesInto(container); }));
      return;
    }

    var view = el('div', 'view-enter');
    if (!canWriteNotifications()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(' — la modification des modèles est réservée à l’administrateur principal.'));
      view.appendChild(note);
    }
    var byAudience = {};
    r.json.templates.forEach(function (t) {
      (byAudience[t.audience] = byAudience[t.audience] || []).push(t);
    });
    AUDIENCE_ORDER.forEach(function (aud) {
      var rows = byAudience[aud];
      if (rows && rows.length) view.appendChild(buildTemplateGroup(aud, rows, container));
    });
    container.appendChild(view);
  }

  function buildTemplateGroup(audience, templates, container) {
    var card = el('div', 'chart-card tpl-group');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', AUDIENCE_LABELS[audience] || audience));
    ht.appendChild(el('div', 'chart-card-sub', templates.length + ' modèles'));
    head.appendChild(ht);
    card.appendChild(head);
    templates.forEach(function (t) { card.appendChild(buildTemplateRow(t, container)); });
    return card;
  }

  function overrideBadges(t) {
    var wrap = el('span', 'tpl-badges');
    var o = t.override;
    if (o && o.enabled === false) wrap.appendChild(el('span', 'tpl-badge is-off', 'Désactivé'));
    if (o && (o.subjectFr || o.subjectEn)) wrap.appendChild(el('span', 'tpl-badge is-custom', 'Modifié'));
    return wrap;
  }

  function buildTemplateRow(t, container) {
    var en = isEnglish();
    var row = el('div', 'tpl-row');

    var head = el('div', 'tpl-row-head');
    var info = el('div', 'tpl-info');
    var labelLine = el('div', 'tpl-label-line');
    // The label is picked per current language from the API's bilingual pair;
    // data-i18n-skip keeps the DOM translator from re-walking API content.
    var label = el('span', 'tpl-label', en ? t.labelEn : t.labelFr);
    label.setAttribute('data-i18n-skip', '');
    labelLine.appendChild(label);
    labelLine.appendChild(overrideBadges(t));
    info.appendChild(labelLine);

    // Default (or overridden) subject per language, always both.
    var subj = el('div', 'tpl-subjects');
    [['FR', t.defaultSubjectFr, t.override && t.override.subjectFr],
     ['EN', t.defaultSubjectEn, t.override && t.override.subjectEn]].forEach(function (p) {
      var line = el('div', 'tpl-subject');
      line.appendChild(el('span', 'tpl-subject-lang', p[0]));
      var val = el('span', p[2] ? 'tpl-subject-val is-overridden' : 'tpl-subject-val', p[2] || p[1]);
      val.setAttribute('data-i18n-skip', '');
      line.appendChild(val);
      subj.appendChild(line);
    });
    info.appendChild(subj);
    head.appendChild(info);

    var edit = el('button', 'btn btn-sm tpl-edit', canWriteNotifications() ? 'Modifier' : 'Détails');
    edit.type = 'button';
    edit.setAttribute('aria-expanded', 'false');
    head.appendChild(edit);
    row.appendChild(head);

    var editor = null;
    edit.addEventListener('click', function () {
      if (editor) {
        var open = editor.hidden;
        editor.hidden = !open;
        edit.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      editor = buildTemplateEditor(t, container);
      row.appendChild(editor);
      edit.setAttribute('aria-expanded', 'true');
    });
    return row;
  }

  function buildTemplateEditor(t, container) {
    var writable = canWriteNotifications();
    var box = el('div', 'tpl-editor');

    // Kill-switch toggle.
    var toggleWrap = el('label', 'tpl-toggle');
    var toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = !(t.override && t.override.enabled === false);
    toggle.disabled = !writable;
    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(el('span', null, 'Envoi activé'));
    box.appendChild(toggleWrap);

    // Bilingual subject inputs — both-or-neither (enforced by the API too).
    var fields = el('div', 'tpl-fields');
    function subjectField(labelText, defaultSubject, current) {
      var field = el('div', 'field');
      var lab = el('label', null, labelText);
      var input = el('input', 'input');
      input.type = 'text';
      input.maxLength = 200;
      input.placeholder = defaultSubject;
      input.setAttribute('data-i18n-skip', '');
      input.value = current || '';
      input.disabled = !writable;
      field.appendChild(lab);
      field.appendChild(input);
      fields.appendChild(field);
      return input;
    }
    var frInput = subjectField('Sujet (FR)', t.defaultSubjectFr, t.override && t.override.subjectFr);
    var enInput = subjectField('Sujet (EN)', t.defaultSubjectEn, t.override && t.override.subjectEn);
    box.appendChild(fields);

    // The allowed {{token}} vocabulary for THIS template, as hint chips.
    var hints = el('div', 'tpl-chips');
    if (t.placeholders && t.placeholders.length) {
      hints.appendChild(el('span', 'tpl-chips-label', 'Jetons permis'));
      t.placeholders.forEach(function (p) {
        var chip = el('span', 'tpl-chip', '{{' + p + '}}');
        chip.setAttribute('data-i18n-skip', '');
        hints.appendChild(chip);
      });
    } else {
      hints.appendChild(el('span', 'tpl-chips-label', 'Aucun jeton pour ce modèle.'));
    }
    box.appendChild(hints);

    box.appendChild(el('p', 'tpl-note',
      'Videz les deux sujets pour revenir aux sujets par défaut. Le corps du courriel n’est pas modifiable.'));

    var error = el('div', 'tpl-error');
    error.hidden = true;
    box.appendChild(error);

    if (!writable) return box;

    var actions = el('div', 'tpl-actions');
    var save = el('button', 'btn btn-sm btn-primary', 'Enregistrer');
    save.type = 'button';
    actions.appendChild(save);
    if (t.override) {
      var reset = el('button', 'btn btn-sm', 'Réinitialiser');
      reset.type = 'button';
      actions.appendChild(reset);
      reset.addEventListener('click', function () {
        submitTemplate('DELETE', t.key, null, [save, reset], error, container, 'Modèle réinitialisé.');
      });
    }
    box.appendChild(actions);

    save.addEventListener('click', function () {
      var body = {
        enabled: toggle.checked,
        subjectFr: frInput.value.trim(),
        subjectEn: enInput.value.trim(),
      };
      submitTemplate('PUT', t.key, body, [save], error, container, 'Modèle enregistré.');
    });
    return box;
  }

  async function submitTemplate(method, key, body, buttons, error, container, okMsg) {
    buttons.forEach(function (b) { b.disabled = true; });
    var r = await call(method, '/notifications/templates/' + encodeURIComponent(key), body === null ? undefined : body);
    buttons.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) return; // handled by call()
    if (!r.ok) {
      error.hidden = false;
      clear(error);
      var msg = r.json && r.json.errors && r.json.errors[0] && r.json.errors[0].message;
      error.appendChild(el('strong', null, msg || 'Impossible d’enregistrer le modèle.'));
      return;
    }
    toast(okMsg);
    await loadTemplatesInto(container);
  }

  // ---------------------------------------------------------------------------
  // Commission — le barème du partage (ADR 0021 §4, réécrit par l'ADR 0028).
  // GET /commission renvoie { defaut, override, effectif } ; PUT enregistre un
  // barème COMPLET ; DELETE rend la facturation aux défauts du déploiement.
  // Écrire exige la permission 'settings:write' (super_admin) — l'analyste lit
  // le barème en vigueur sans formulaire (l'API le réimpose côté serveur).
  //
  // Depuis l'ADR 0028 un palier est `{ cote, taux }` : UNE mesure, la cote sur
  // 100 du notaire, décide la part de Nota. L'écran parle donc toujours des
  // DEUX moitiés — ce que Nota garde et ce que le NOTAIRE garde (1 − taux),
  // parce que c'est cette moitié-là qui se négocie.
  //
  // Les taux voyagent en FRACTIONS (0,10 = 10 %) ; le formulaire parle en
  // pourcentage (« 12 » = 12 %) et convertit à l'enregistrement. Le serveur
  // reste l'autorité (le 422 s'affiche dans la région d'erreur en ligne), mais
  // l'écran refuse d'expédier une évidence : validateBareme() rejoue mot pour
  // mot les règles de commission-config.js avant le premier octet réseau.
  // ---------------------------------------------------------------------------
  var commissionBody = null;
  var MAX_PALIERS = 10;

  // Le même arrondi que la facturation (billing.js roundRate) : quatre
  // décimales, pour que « 12 % » saisi ici et le taux appliqué là-bas soient
  // le même nombre, jamais deux flottants voisins.
  function roundRate(x) { return Math.round(x * 10000) / 10000; }
  // La part qui reste au notaire — énoncée, jamais laissée à recalculer.
  function partNotaire(taux) { return roundRate(1 - taux); }
  // Un taux de palier tel que la facturation l'appliquerait : borné par le
  // plancher et par le taux de base. Un barème d'environnement mal réglé ne
  // doit pas s'afficher plus cher que le taux de base — le mérite ne déplace
  // la ligne que vers le notaire.
  function borneTaux(taux, bareme) {
    return Math.min(Number(bareme.taux) || 0, Math.max(Number(bareme.plancher) || 0, roundRate(Number(taux) || 0)));
  }
  // Le taux qu'une cote vaut sous un barème — copie fidèle de commissionWith()
  // (apps/api/src/billing.js) : le MEILLEUR palier atteint s'applique, borné.
  function tauxPourCote(cote, bareme) {
    var taux = Number(bareme.taux) || 0;
    (bareme.paliers || []).forEach(function (p) {
      if (cote >= p.cote && Number(p.taux) < taux) taux = Number(p.taux);
    });
    return borneTaux(taux, bareme);
  }
  // Le palier effectivement atteint par une cote (le plus haut), ou null.
  function palierPourCote(cote, bareme) {
    var best = null;
    (bareme.paliers || []).forEach(function (p) {
      if (cote >= p.cote && (!best || p.cote > best.cote)) best = p;
    });
    return best;
  }

  // La porte des données personnelles : le bottin des notaires et le journal
  // d'audit. 'pii:read' n'est donné qu'à l'administrateur principal.
  function canReadPii() {
    return !!(me && me.permissions && me.permissions.indexOf('pii:read') >= 0);
  }

  function canWriteSettings() {
    return !!(me && me.permissions && me.permissions.indexOf('settings:write') >= 0);
  }

  // « 12 » or « 12,5 » (percent, comma or point) → 0.125 fraction.
  function pctToFrac(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!s) return NaN;
    var n = Number(s);
    return isFinite(n) ? Math.round(n * 10000) / 1000000 : NaN;
  }
  // 0.125 fraction → « 12,5 » (percent, decimal comma) for seeding inputs.
  function fracToPct(f) {
    var p = Math.round((Number(f) || 0) * 1000000) / 10000;
    return String(p).replace('.', ',');
  }
  function pctLabel(f) { return fracToPct(f) + ' %'; }
  // « 60 » / « 60,5 » (virgule décimale acceptée à la saisie) → un nombre.
  function decToNum(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!s) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  // updatedAt ISO → a quiet locale-neutral « 2026-08-27 12:00 ».
  function baremeDate(iso) {
    if (!iso) return '—';
    var s = String(iso);
    return s.slice(0, 10) + (s.length > 16 ? ' ' + s.slice(11, 16) : '');
  }

  async function renderCommission() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderCommission);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Facturation'));
    titleWrap.appendChild(el('h1', 'page-title', 'Commission'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Barème décidé par Nota — la cote sur 100 du notaire décide le partage.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    commissionBody = el('div');
    content.appendChild(commissionBody);

    mountAuthed('commission', content);
    focusTitle();
    await loadCommissionInto(commissionBody);
  }

  async function loadCommissionInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/commission');
    if (r.status === 401) return; // handled by call()
    clear(container);
    if (!r.ok || !r.json || !r.json.effectif) {
      container.appendChild(buildErrorBanner(function () { loadCommissionInto(container); }));
      return;
    }

    var view = el('div', 'view-enter');
    if (!canWriteSettings()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(' — la modification du barème est réservée à l’administrateur principal.'));
      view.appendChild(note);
    }
    view.appendChild(buildBaremeView(r.json));
    // Le simulateur est une LECTURE : l'analyste y a droit comme le
    // propriétaire, puisqu'il ne fait que rejouer le barème en vigueur.
    view.appendChild(buildBaremeSim(r.json.effectif));
    if (canWriteSettings()) view.appendChild(buildBaremeForm(r.json, container));
    container.appendChild(view);
  }

  // --- Read view: what billing prices with right now -------------------------
  function buildBaremeView(data) {
    var eff = data.effectif;
    var wrap = el('div');

    var grid = el('div', 'stat-grid');
    grid.appendChild(tile('Taux de base', pctLabel(eff.taux), 'la part de Nota sans historique', false));
    grid.appendChild(tile('Plancher', pctLabel(eff.plancher), 'jamais franchi, quelle que soit la cote', false));
    // Le sommet du barème, énoncé : c'est le chiffre que le notaire retient.
    grid.appendChild(tile('Au mieux, le notaire garde', pctLabel(partNotaire(tauxPourCote(100, eff))),
      'à la cote la plus haute du barème', false));
    grid.appendChild(tile('Paliers', num((eff.paliers || []).length), 'de cote qui abaissent la part de Nota', false));
    wrap.appendChild(grid);

    var card = el('div', 'chart-card tpl-group bareme-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Barème en vigueur'));
    // Quietly say WHICH barème rules: the stored override (with its date) or
    // the deployment defaults.
    var src = data.override
      ? 'Barème décidé par Nota — modifié le ' + baremeDate(data.override.updatedAt) + '.'
      : 'Valeurs par défaut du déploiement — aucun barème enregistré.';
    ht.appendChild(el('div', 'chart-card-sub', src));
    head.appendChild(ht);
    card.appendChild(head);

    var paliers = eff.paliers || [];
    if (!paliers.length) {
      card.appendChild(el('p', 'tpl-note', 'Aucun palier — le taux de base s’applique toujours.'));
    } else {
      var scroll = el('div', 'chart-scroll');
      var table = el('table', 'ptable');
      var thead = el('thead');
      var hr = el('tr');
      ['Cote atteinte', 'Part de Nota', 'Le notaire garde'].forEach(function (h, i) {
        hr.appendChild(el('th', i >= 1 ? 'is-num' : null, h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody');
      paliers.forEach(function (p) {
        var taux = borneTaux(p.taux, eff);
        var tr = el('tr');
        tr.appendChild(el('td', 'ptable-code', num(p.cote)));
        tr.appendChild(el('td', 'is-num', pctLabel(taux)));
        // La moitié qui se négocie porte l'accent.
        tr.appendChild(el('td', 'is-num ptable-du', pctLabel(partNotaire(taux))));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      card.appendChild(scroll);
      // Sous le premier palier, c'est le taux de base qui parle — dit ici pour
      // que le tableau n'ait pas besoin d'une ligne « départ » silencieuse.
      var foot = el('p', 'tpl-note');
      foot.appendChild(document.createTextNode(
        'Sous le premier palier, le taux de base s’applique — le notaire garde '));
      foot.appendChild(el('span', null, pctLabel(partNotaire(Number(eff.taux) || 0))));
      foot.appendChild(document.createTextNode('.'));
      card.appendChild(foot);
    }
    wrap.appendChild(card);
    return wrap;
  }

  // --- Simulateur : une cote, le partage qu'elle vaut ------------------------
  // Le barème est un document ; le simulateur en est la lecture. Il rejoue
  // exactement tauxPourCote() — la copie fidèle de la facturation — pour que
  // « et à 78, ça donne quoi ? » se réponde ici, pas dans un tableur.
  function buildBaremeSim(eff) {
    var card = el('div', 'chart-card bareme-sim');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Simulateur'));
    ht.appendChild(el('div', 'chart-card-sub', 'Une cote, et le partage qu’elle vaut sous le barème en vigueur.'));
    head.appendChild(ht);
    card.appendChild(head);

    var field = el('div', 'field bareme-sim-field');
    field.appendChild(el('label', null, 'Cote du notaire (0 à 100)'));
    var input = el('input', 'input bareme-sim-input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('data-i18n-skip', '');
    input.value = '75';
    field.appendChild(input);
    card.appendChild(field);

    var out = el('div', 'bareme-sim-out');
    function fig(k, cls) {
      var f = el('div', 'bareme-sim-fig');
      f.appendChild(el('div', 'bareme-sim-k', k));
      var v = el('div', 'bareme-sim-v ' + cls, '—');
      f.appendChild(v);
      out.appendChild(f);
      return v;
    }
    var vNota = fig('Nota garde', 'bareme-sim-nota');
    var vNotaire = fig('Le notaire garde', 'bareme-sim-notaire');
    card.appendChild(out);

    var note = el('p', 'tpl-note bareme-sim-note');
    card.appendChild(note);

    function refresh() {
      clear(note);
      var cote = decToNum(input.value);
      if (!isFinite(cote) || cote < 0 || cote > 100) {
        vNota.textContent = '—';
        vNotaire.textContent = '—';
        note.appendChild(document.createTextNode('Entrez une cote de 0 à 100.'));
        return;
      }
      var taux = tauxPourCote(cote, eff);
      vNota.textContent = pctLabel(taux);
      vNotaire.textContent = pctLabel(partNotaire(taux));
      var p = palierPourCote(cote, eff);
      if (!p) {
        note.appendChild(document.createTextNode('Aucun palier atteint — le taux de base s’applique.'));
      } else {
        note.appendChild(document.createTextNode('Palier atteint : cote '));
        note.appendChild(el('span', null, num(p.cote)));
      }
    }
    input.addEventListener('input', refresh);
    refresh();
    return card;
  }

  // --- Edit form (super_admin only) ------------------------------------------
  function buildBaremeForm(data, container) {
    var eff = data.effectif;
    var card = el('div', 'chart-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Modifier le barème'));
    ht.appendChild(el('div', 'chart-card-sub', 'Les valeurs sont saisies en pourcentage — « 12 » signifie 12 %.'));
    head.appendChild(ht);
    card.appendChild(head);

    function fld(labelText, value) {
      var field = el('div', 'field');
      field.appendChild(el('label', null, labelText));
      var input = el('input', 'input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.setAttribute('data-i18n-skip', '');
      input.value = value;
      field.appendChild(input);
      return { field: field, input: input };
    }

    var form = el('form', 'bareme-form');
    form.noValidate = true;

    var top = el('div', 'tpl-fields');
    var taux = fld('Taux de base (%)', fracToPct(eff.taux));
    var plancher = fld('Plancher (%)', fracToPct(eff.plancher));
    top.appendChild(taux.field);
    top.appendChild(plancher.field);
    form.appendChild(top);

    // Editable tier rows, capped at MAX_PALIERS (mirrors the API's ceiling).
    var listWrap = el('div', 'bareme-paliers');
    listWrap.appendChild(el('div', 'bareme-paliers-label', 'Paliers de cote'));
    var rowsBox = el('div', 'bareme-rows');
    listWrap.appendChild(rowsBox);
    var addBtn = el('button', 'btn btn-sm', 'Ajouter un palier');
    addBtn.type = 'button';
    listWrap.appendChild(addBtn);
    form.appendChild(listWrap);

    function syncAdd() { addBtn.disabled = rowsBox.children.length >= MAX_PALIERS; }
    function addRow(p) {
      if (rowsBox.children.length >= MAX_PALIERS) return;
      var row = el('div', 'bareme-palier bareme-palier-cote');
      row.appendChild(fld('Cote atteinte', p ? String(p.cote) : '').field);
      var taux = fld('Part de Nota (%)', p ? fracToPct(p.taux) : '');
      row.appendChild(taux.field);
      // L'autre moitié, en direct : c'est elle qui se négocie avec le notaire.
      var part = el('div', 'bareme-part');
      part.appendChild(el('div', 'bareme-part-k', 'Le notaire garde'));
      var partV = el('div', 'bareme-part-v', '—');
      part.appendChild(partV);
      row.appendChild(part);
      function syncPart() {
        var f = pctToFrac(taux.input.value);
        partV.textContent = isFinite(f) ? pctLabel(partNotaire(f)) : '—';
      }
      taux.input.addEventListener('input', syncPart);
      syncPart();
      var rm = el('button', 'btn btn-sm bareme-remove', 'Retirer');
      rm.type = 'button';
      rm.addEventListener('click', function () { rowsBox.removeChild(row); syncAdd(); });
      row.appendChild(rm);
      rowsBox.appendChild(row);
      syncAdd();
    }
    (eff.paliers || []).forEach(function (p) { addRow(p); });
    syncAdd();
    addBtn.addEventListener('click', function () { addRow(null); });

    var error = el('div', 'tpl-error');
    error.hidden = true;
    form.appendChild(error);

    var actions = el('div', 'tpl-actions');
    var save = el('button', 'btn btn-sm btn-primary', 'Enregistrer le barème');
    save.type = 'submit';
    actions.appendChild(save);
    form.appendChild(actions);
    card.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        taux: pctToFrac(taux.input.value),
        plancher: pctToFrac(plancher.input.value),
        paliers: [].map.call(rowsBox.children, function (row) {
          var ins = row.querySelectorAll('input');
          return {
            cote: decToNum(ins[0].value), // l'entier 1–100 est revalidé plus bas, puis par l'API
            taux: pctToFrac(ins[1].value),
          };
        }),
      };
      // Le serveur reste l'autorité, mais une évidence ne part pas sur le fil.
      var errs = validateBareme(body);
      if (errs.length) { showErrorLines(error, errs); return; }
      submitBareme('PUT', body, [save], error, container, 'Barème enregistré.');
    });

    // The reset is offered only when an override is actually stored (same
    // idiom as the Courriels Réinitialiser), behind an in-page confirm step.
    if (data.override) card.appendChild(buildBaremeReset(error, container));
    return card;
  }

  function buildBaremeReset(error, container) {
    var wrap = el('div', 'bareme-reset');
    var open = el('button', 'btn btn-sm', 'Revenir aux valeurs par défaut');
    open.type = 'button';
    wrap.appendChild(open);

    var confirmBox = el('div', 'bareme-confirm');
    confirmBox.hidden = true;
    confirmBox.appendChild(el('p', 'bareme-confirm-text',
      'Le barème enregistré sera supprimé — les valeurs par défaut reprendront effet dès le prochain acte.'));
    var confirmActions = el('div', 'tpl-actions');
    var yes = el('button', 'btn btn-sm btn-danger', 'Confirmer la réinitialisation');
    yes.type = 'button';
    var no = el('button', 'btn btn-sm btn-ghost', 'Annuler');
    no.type = 'button';
    confirmActions.appendChild(yes);
    confirmActions.appendChild(no);
    confirmBox.appendChild(confirmActions);
    wrap.appendChild(confirmBox);

    open.addEventListener('click', function () { confirmBox.hidden = false; open.hidden = true; });
    no.addEventListener('click', function () { confirmBox.hidden = true; open.hidden = false; });
    yes.addEventListener('click', function () {
      submitBareme('DELETE', null, [yes, no], error, container, 'Barème réinitialisé.');
    });
    return wrap;
  }

  // Les mêmes règles, les mêmes mots que commission-config.js (validateSchedule)
  // — l'écran ne doit jamais refuser autre chose que ce que le serveur refuse,
  // ni le formuler autrement. Un 422 reste possible : c'est lui qui tranche.
  function validateBareme(body) {
    var errors = [];
    var taux = body.taux;
    if (!isFinite(taux) || !(taux > 0 && taux < 1)) {
      errors.push({ code: 'taux_invalide', message: 'Le taux de base doit être un nombre entre 0 et 1 (ex. 0,15 pour 15 %).' });
      taux = undefined;
    }
    var plancher = body.plancher;
    if (!isFinite(plancher) || plancher < 0 || (taux !== undefined && plancher > taux)) {
      errors.push({ code: 'plancher_invalide', message: 'Le plancher doit être un nombre entre 0 et le taux de base.' });
      plancher = undefined;
    }
    var paliers = body.paliers || [];
    if (paliers.length > MAX_PALIERS) {
      errors.push({ code: 'paliers_invalides', message: 'Les paliers doivent être une liste d’au plus ' + MAX_PALIERS + ' éléments.' });
      return errors;
    }
    var clean = [];
    paliers.forEach(function (p, i) {
      var cote = p.cote, t = p.taux;
      var bad =
        !isFinite(cote) || Math.floor(cote) !== cote || cote < 1 || cote > 100 ||
        !isFinite(t) || t < 0 || t >= 1 ||
        (plancher !== undefined && t < plancher) ||
        (taux !== undefined && t > taux);
      if (bad) {
        errors.push({ code: 'palier_invalide', message: 'Palier ' + (i + 1) + ' : il faut une cote entière de 1 à 100 et un taux entre le plancher et le taux de base.' });
      } else {
        clean.push({ cote: cote, taux: t });
      }
    });
    if (clean.length !== paliers.length) return errors;
    // Trié par cote, une cote ne se répète pas et le taux ne remonte jamais.
    clean.sort(function (a, b) { return a.cote - b.cote; });
    for (var i = 1; i < clean.length; i++) {
      if (clean[i].cote === clean[i - 1].cote) {
        errors.push({ code: 'paliers_invalides', message: 'Deux paliers ne peuvent pas viser la même cote (' + clean[i].cote + ').' });
        break;
      }
      if (clean[i].taux > clean[i - 1].taux) {
        errors.push({ code: 'paliers_invalides', message: 'Une cote plus haute ne peut jamais coûter plus cher au notaire.' });
        break;
      }
    }
    return errors;
  }

  // La région d'erreur en ligne, partagée par le refus local, le 422 du barème
  // et celui du journal d'audit : un message par ligne, jamais un JSON brut.
  function showErrorLines(error, errs) {
    error.hidden = false;
    clear(error);
    errs.forEach(function (er) {
      var line = el('div', 'tpl-error-line');
      line.appendChild(el('strong', null, er.message || er.code || 'Erreur.'));
      error.appendChild(line);
    });
  }

  async function submitBareme(method, body, buttons, error, container, okMsg) {
    buttons.forEach(function (b) { b.disabled = true; });
    var r = await call(method, '/commission', body === null ? undefined : body);
    buttons.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) return; // handled by call()
    if (!r.ok) {
      showErrorLines(error, (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'Impossible d’enregistrer le barème.' }]);
      return;
    }
    error.hidden = true; // un barème accepté ne laisse pas traîner l'ancien refus
    clear(error);
    toast(okMsg);
    await loadCommissionInto(container);
  }

  // ---------------------------------------------------------------------------
  // Annulation page — the late-cancellation fee barème (ADR 0023 §2).
  // GET /annulation returns { defaut, override, effectif }; PUT stores a FULL
  // replacement; DELETE returns the cancel route to the deployment defaults.
  // Writing needs the 'settings:write' permission (super_admin) — an analyst
  // sees the barème in force read-only, with no form (the API re-enforces
  // server-side). A palier: at most `maxJours` days left before the signing →
  // `taux` of the agreed montant retained; beyond the last palier the
  // cancellation is free, and an EMPTY barème is a valid override that makes
  // it free everywhere (the kill-switch is data). Rates travel as FRACTIONS
  // (0.30 = 30 %); the form speaks percent and converts on save, exactly like
  // the Commission page.
  // ---------------------------------------------------------------------------
  var annulationBody = null;

  // The rate a cancellation at `jours` days out would carry under `paliers`.
  function annulationRateAt(jours, paliers) {
    for (var i = 0; i < (paliers || []).length; i++) {
      if (jours <= paliers[i].maxJours) return paliers[i].taux;
    }
    return 0;
  }
  // « 0–3 jours » / « 4–14 jours » — the band a palier covers, self-explaining.
  function annulationBandLabel(p, prev) {
    var lo = prev === null ? 0 : prev + 1;
    return (lo === p.maxJours ? String(p.maxJours) : lo + '–' + p.maxJours) + (p.maxJours > 1 ? ' jours' : ' jour');
  }

  async function renderAnnulation() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderAnnulation);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Facturation'));
    titleWrap.appendChild(el('h1', 'page-title', 'Annulation'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Barème décidé par Nota — frais d’annulation tardive selon les jours restants avant la signature.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    annulationBody = el('div');
    content.appendChild(annulationBody);

    mountAuthed('annulation', content);
    focusTitle();
    await loadAnnulationInto(annulationBody);
  }

  async function loadAnnulationInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/annulation');
    if (r.status === 401) return; // handled by call()
    clear(container);
    if (!r.ok || !r.json || !r.json.effectif) {
      container.appendChild(buildErrorBanner(function () { loadAnnulationInto(container); }));
      return;
    }

    var view = el('div', 'view-enter');
    if (!canWriteSettings()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(' — la modification du barème est réservée à l’administrateur principal.'));
      view.appendChild(note);
    }
    view.appendChild(buildAnnulationView(r.json));
    if (canWriteSettings()) view.appendChild(buildAnnulationForm(r.json, container));
    container.appendChild(view);
  }

  // --- Read view: what the cancel route prices with right now ----------------
  function buildAnnulationView(data) {
    var eff = data.effectif;
    var paliers = eff.paliers || [];
    var wrap = el('div');

    var grid = el('div', 'stat-grid');
    grid.appendChild(tile('Dernière minute', pctLabel(annulationRateAt(0, paliers)), 'retenu la veille de la signature', false));
    grid.appendChild(tile('Paliers', num(paliers.length), 'de frais selon les jours restants', false));
    var freeFrom = paliers.length ? paliers[paliers.length - 1].maxJours + 1 : 0;
    grid.appendChild(tile('Gratuit dès', num(freeFrom) + (freeFrom > 1 ? ' jours' : ' jour'), 'avant la signature', false));
    wrap.appendChild(grid);

    var card = el('div', 'chart-card tpl-group bareme-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Barème en vigueur'));
    // Quietly say WHICH barème rules: the stored override (with its date) or
    // the deployment defaults.
    var src = data.override
      ? 'Barème décidé par Nota — modifié le ' + baremeDate(data.override.updatedAt) + '.'
      : 'Valeurs par défaut du déploiement — aucun barème enregistré.';
    ht.appendChild(el('div', 'chart-card-sub', src));
    head.appendChild(ht);
    card.appendChild(head);

    if (!paliers.length) {
      card.appendChild(el('p', 'tpl-note', 'Aucun palier — l’annulation est gratuite partout.'));
    } else {
      var scroll = el('div', 'chart-scroll');
      var table = el('table', 'ptable');
      var thead = el('thead');
      var hr = el('tr');
      ['Jours avant la signature', 'Taux retenu'].forEach(function (h, i) {
        hr.appendChild(el('th', i >= 1 ? 'is-num' : null, h));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody');
      var prev = null;
      paliers.forEach(function (p) {
        var tr = el('tr');
        tr.appendChild(el('td', 'ptable-code', annulationBandLabel(p, prev)));
        tr.appendChild(el('td', 'is-num ptable-du', pctLabel(p.taux)));
        tbody.appendChild(tr);
        prev = p.maxJours;
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      card.appendChild(scroll);
      card.appendChild(el('p', 'tpl-note', 'Au-delà du dernier palier, l’annulation est gratuite.'));
    }
    wrap.appendChild(card);
    return wrap;
  }

  // --- Edit form (super_admin only) ------------------------------------------
  function buildAnnulationForm(data, container) {
    var eff = data.effectif;
    var card = el('div', 'chart-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Modifier le barème'));
    ht.appendChild(el('div', 'chart-card-sub', 'Les taux sont saisis en pourcentage — « 30 » signifie 30 %. Un barème sans palier rend l’annulation gratuite partout.'));
    head.appendChild(ht);
    card.appendChild(head);

    function fld(labelText, value) {
      var field = el('div', 'field');
      field.appendChild(el('label', null, labelText));
      var input = el('input', 'input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.setAttribute('data-i18n-skip', '');
      input.value = value;
      field.appendChild(input);
      return { field: field, input: input };
    }

    var form = el('form', 'bareme-form');
    form.noValidate = true;

    // Editable tier rows, capped at MAX_PALIERS (mirrors the API's ceiling).
    var listWrap = el('div', 'bareme-paliers');
    listWrap.appendChild(el('div', 'bareme-paliers-label', 'Paliers de frais'));
    var rowsBox = el('div', 'bareme-rows');
    listWrap.appendChild(rowsBox);
    var addBtn = el('button', 'btn btn-sm', 'Ajouter un palier');
    addBtn.type = 'button';
    listWrap.appendChild(addBtn);
    form.appendChild(listWrap);

    function syncAdd() { addBtn.disabled = rowsBox.children.length >= MAX_PALIERS; }
    function addRow(p) {
      if (rowsBox.children.length >= MAX_PALIERS) return;
      var row = el('div', 'bareme-palier');
      row.appendChild(fld('Jours restants (max)', p ? String(p.maxJours) : '').field);
      row.appendChild(fld('Taux retenu (%)', p ? fracToPct(p.taux) : '').field);
      var rm = el('button', 'btn btn-sm bareme-remove', 'Retirer');
      rm.type = 'button';
      rm.addEventListener('click', function () { rowsBox.removeChild(row); syncAdd(); });
      row.appendChild(rm);
      rowsBox.appendChild(row);
      syncAdd();
    }
    (eff.paliers || []).forEach(function (p) { addRow(p); });
    syncAdd();
    addBtn.addEventListener('click', function () { addRow(null); });

    var error = el('div', 'tpl-error');
    error.hidden = true;
    form.appendChild(error);

    var actions = el('div', 'tpl-actions');
    var save = el('button', 'btn btn-sm btn-primary', 'Enregistrer le barème');
    save.type = 'submit';
    actions.appendChild(save);
    form.appendChild(actions);
    card.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        paliers: [].map.call(rowsBox.children, function (row) {
          var ins = row.querySelectorAll('input');
          return {
            maxJours: decToNum(ins[0].value), // the API enforces the integer ≥ 0
            taux: pctToFrac(ins[1].value),
          };
        }),
      };
      submitAnnulation('PUT', body, [save], error, container, 'Barème enregistré.');
    });

    // The reset is offered only when an override is actually stored (same
    // idiom as the Commission page), behind an in-page confirm step.
    if (data.override) card.appendChild(buildAnnulationReset(error, container));
    return card;
  }

  function buildAnnulationReset(error, container) {
    var wrap = el('div', 'bareme-reset');
    var open = el('button', 'btn btn-sm', 'Revenir aux valeurs par défaut');
    open.type = 'button';
    wrap.appendChild(open);

    var confirmBox = el('div', 'bareme-confirm');
    confirmBox.hidden = true;
    confirmBox.appendChild(el('p', 'bareme-confirm-text',
      'Le barème enregistré sera supprimé — les valeurs par défaut reprendront effet dès la prochaine annulation.'));
    var confirmActions = el('div', 'tpl-actions');
    var yes = el('button', 'btn btn-sm btn-danger', 'Confirmer la réinitialisation');
    yes.type = 'button';
    var no = el('button', 'btn btn-sm btn-ghost', 'Annuler');
    no.type = 'button';
    confirmActions.appendChild(yes);
    confirmActions.appendChild(no);
    confirmBox.appendChild(confirmActions);
    wrap.appendChild(confirmBox);

    open.addEventListener('click', function () { confirmBox.hidden = false; open.hidden = true; });
    no.addEventListener('click', function () { confirmBox.hidden = true; open.hidden = false; });
    yes.addEventListener('click', function () {
      submitAnnulation('DELETE', null, [yes, no], error, container, 'Barème réinitialisé.');
    });
    return wrap;
  }

  async function submitAnnulation(method, body, buttons, error, container, okMsg) {
    buttons.forEach(function (b) { b.disabled = true; });
    var r = await call(method, '/annulation', body === null ? undefined : body);
    buttons.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) return; // handled by call()
    if (!r.ok) {
      error.hidden = false;
      clear(error);
      var errs = (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'Impossible d’enregistrer le barème.' }];
      errs.forEach(function (er) {
        var line = el('div', 'tpl-error-line');
        line.appendChild(el('strong', null, er.message || er.code || 'Erreur.'));
        error.appendChild(line);
      });
      return;
    }
    toast(okMsg);
    await loadAnnulationInto(container);
  }

  // ---------------------------------------------------------------------------
  // Notaires — le tableau d'honneur (ADR 0028).
  //
  // GET /notaries renvoie { notaires: [...], bareme }, déjà trié par cote
  // décroissante. La porte est 'pii:read' (l'administrateur principal) : le
  // bottin porte des courriels et des montants nominatifs. L'analyste voit
  // l'entrée de rail fermée et, s'il force la route, la note « Accès réservé » —
  // aucun appel n'est tenté, et un 403 du serveur atterrit au même endroit.
  //
  // L'écran ne recalcule RIEN : la cote, ses quatre axes, le taux effectif et
  // la part viennent du serveur. Il les met en forme et rend chaque chiffre
  // recomposable à la main, parce qu'un notaire qui conteste sa cote a droit
  // au détail, pas à un score opaque.
  // ---------------------------------------------------------------------------
  var notairesBody = null;

  var STATUT_LABELS = {
    onboarding: 'En intégration',
    active: 'Actif',
    restricted: 'Restreint',
  };
  // Les libellés des chiffres derrière chaque axe — TOUS traduits (un libellé
  // resté en français au milieu d'une colonne anglaise se lit comme une fuite).
  // Une clé inconnue retombe sur son nom brut : le domaine peut ajouter une
  // mesure sans casser l'écran.
  var DETAIL_LABELS = {
    note: 'Note moyenne',
    avis: 'Avis reçus',
    notePonderee: 'Note pondérée',
    cible: 'Cible',
    actes: 'Actes complétés',
    // L'éventail du catalogue ne vaut plus de points (ADR 0028, complément) :
    // les deux lignes restent servies, le libellé dit qu'elles n'entrent pas
    // dans la note — se spécialiser ne coûte rien.
    servicesRendus: 'Services rendus (information)',
    catalogue: 'Services au catalogue (information)',
    // La disponibilité mesure le fait de RÉPONDRE, plus le taux d'acceptation :
    // proposer, accepter et décliner sont toutes des réponses ; seul le silence
    // coûte des points.
    reponses: 'Réponses données',
    cibleReponses: 'Réponses visées',
    repondu: 'Propositions et acceptations',
    declinees: 'Déclins (sans pénalité)',
    rayonKm: 'Rayon',
    urgences: 'Urgences en ligne',
    fiche: 'Fiche CNQ',
    secteur: 'Secteur postal',
    joursDepuisActivite: 'Jours depuis la dernière visite',
    joursMembre: 'Jours sur Nota',
  };
  // Les deux renversements déontologiques de l'ADR 0028, dits sur l'axe même :
  // un opérateur qui ouvre la cote devant un notaire doit pouvoir répondre à
  // « pourquoi mes refus me coûtent-ils ? » par « ils ne coûtent rien ».
  var AXE_NOTES = {
    services: 'Ces deux lignes sont affichées pour information : se spécialiser ne retire aucun point.',
    disponibilite: 'Répondre est ce qui compte — décliner EST une réponse. Seul le silence coûte des points.',
  };
  // La clé seule ne suffit pas toujours : `cible` vaut une NOTE visée sur l'axe
  // satisfaction (4,8 sur 5) et un VOLUME d'actes sur l'axe services (50). Le
  // libellé suit donc l'axe partout où le sens en dépend ; ailleurs, la table
  // commune parle.
  var DETAIL_LABELS_PAR_AXE = {
    satisfaction: { cible: 'Note visée' },
    services: { cible: 'Volume visé' },
  };
  function detailLabel(axeId, k) {
    var parAxe = DETAIL_LABELS_PAR_AXE[axeId];
    if (parAxe && parAxe[k]) return parAxe[k];
    return DETAIL_LABELS[k] || k;
  }

  // Un chiffre du détail, mis en français : un booléen se dit oui/non, un rayon
  // ses km, et toute clé `taux…` son % (la convention du dépôt — plus aucun axe
  // n'en sert depuis que le taux de réponse a disparu, mais la prochaine sera
  // formatée juste). Rien n'est inventé pour une valeur absente.
  function detailValue(k, v) {
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    if (typeof v === 'number') {
      if (/^taux/.test(k)) return dec(v) + ' %';
      if (/Km$/.test(k)) return num(v) + ' km';
      return dec(v);
    }
    return v == null ? '—' : String(v);
  }

  // La porte fermée, dite proprement — même registre que « Lecture seule ».
  function buildDenied() {
    var note = el('div', 'tpl-readonly-note admin-denied');
    note.appendChild(el('strong', null, 'Accès réservé'));
    note.appendChild(document.createTextNode(' — cette section est réservée à l’administrateur principal.'));
    return note;
  }

  async function renderNotaires() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderNotaires);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Réseau'));
    titleWrap.appendChild(el('h1', 'page-title', 'Notaires'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Tableau d’honneur — la cote sur 100 décide la part que chaque notaire garde.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    notairesBody = el('div');
    content.appendChild(notairesBody);

    mountAuthed('notaires', content);
    focusTitle();
    // La porte se ferme AVANT le réseau : on ne frappe pas à une porte connue
    // close, et l'analyste lit pourquoi plutôt qu'un 403 muet.
    if (!canReadPii()) { notairesBody.appendChild(buildDenied()); return; }
    await loadNotairesInto(notairesBody);
  }

  async function loadNotairesInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/notaries');
    if (r.status === 401) return; // handled by call()
    clear(container);
    // Un refus n'est pas une panne : les permissions du jeton et celles de /me
    // peuvent diverger, et l'écran doit encaisser ça sans bannière technique.
    if (r.status === 403) { container.appendChild(buildDenied()); return; }
    if (!r.ok || !r.json || !Array.isArray(r.json.notaires)) {
      container.appendChild(buildErrorBanner(function () { loadNotairesInto(container); }));
      return;
    }
    var view = el('div', 'view-enter');
    view.appendChild(buildNotairesView(r.json));
    container.appendChild(view);
  }

  function buildNotairesView(data) {
    var rows = data.notaires || [];
    var wrap = el('div');
    var card = el('div', 'chart-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Tableau d’honneur'));
    ht.appendChild(el('div', 'chart-card-sub', 'Trié par cote — la meilleure d’abord.'));
    head.appendChild(ht);
    card.appendChild(head);

    if (!rows.length) {
      card.appendChild(el('p', 'tpl-note', 'Aucun notaire inscrit pour le moment.'));
      wrap.appendChild(card);
      return wrap;
    }

    var scroll = el('div', 'chart-scroll');
    var table = el('table', 'ptable ntable');
    var thead = el('thead');
    var hr = el('tr');
    ['Étude', 'Statut', 'Cote', 'Le notaire garde', 'Actes', 'Note', 'Commission perçue', 'Dernière visite']
      .forEach(function (h, i) { hr.appendChild(el('th', i >= 2 ? 'is-num' : null, h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (n) { buildNotaireRow(n, tbody); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);

    // Le barème qui explique la colonne « Le notaire garde », rappelé sous le
    // tableau : sans lui, la colonne est un chiffre sans cause.
    var b = data.bareme;
    if (b && typeof b.taux === 'number') {
      card.appendChild(el('p', 'tpl-note',
        'Barème en vigueur : Nota garde de ' + pctLabel(b.taux) + ' à ' + pctLabel(tauxPourCote(100, b)) + ' selon la cote.'));
    }
    wrap.appendChild(card);
    return wrap;
  }

  function buildNotaireRow(n, tbody) {
    var tr = el('tr', 'nrow');

    // Étude + courriel, et le bouton qui déplie la cote.
    var who = el('td');
    var etude = el('div', 'nrow-etude', n.etude || '—');
    etude.setAttribute('data-i18n-skip', ''); // raison sociale : contenu d'API
    who.appendChild(etude);
    if (n.email) {
      var mail = el('div', 'ptable-sub', n.email);
      mail.setAttribute('data-i18n-skip', '');
      who.appendChild(mail);
    }
    var toggle = el('button', 'btn btn-sm nrow-toggle', 'Axes');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    who.appendChild(toggle);
    tr.appendChild(who);

    var st = el('td');
    st.appendChild(el('span', 'nstatut is-' + (n.statut || 'inconnu'),
      STATUT_LABELS[n.statut] || n.statut || '—'));
    tr.appendChild(st);

    tr.appendChild(el('td', 'is-num ptable-code', num(n.cote)));

    // La part du notaire telle que servie ; à défaut, déduite du taux. Jamais
    // un 0 % inventé quand la facturation n'a rien dit.
    var part = typeof n.part === 'number' ? n.part
      : (typeof n.tauxEffectif === 'number' ? partNotaire(n.tauxEffectif) : null);
    tr.appendChild(el('td', 'is-num ptable-du', part === null ? '—' : pctLabel(part)));

    tr.appendChild(el('td', 'is-num', num(n.actes || 0)));

    // Aucune fausse note : sans avis, la case le dit.
    var noteCell = el('td', 'is-num');
    if (typeof n.note === 'number' && (n.avis || 0) > 0) {
      noteCell.appendChild(el('div', 'nrow-note', dec(n.note)));
      noteCell.appendChild(el('div', 'ptable-sub', num(n.avis) + ' avis'));
    } else {
      noteCell.appendChild(el('span', 'ptable-sub', 'aucun avis'));
    }
    tr.appendChild(noteCell);

    tr.appendChild(el('td', 'is-num', moneyCents((n.commissionPercue || 0) * 100)));

    var vu = el('td', 'is-num');
    if (n.vuLe) {
      var d = el('span', null, String(n.vuLe).slice(0, 10));
      d.setAttribute('data-i18n-skip', '');
      vu.appendChild(d);
    } else {
      vu.appendChild(el('span', 'ptable-sub', 'jamais'));
    }
    tr.appendChild(vu);
    tbody.appendChild(tr);

    // Le dépli vit dans le tableau, juste sous sa ligne, et disparaît quand on
    // le referme : rien de caché qui traîne dans le DOM.
    var detail = null;
    toggle.addEventListener('click', function () {
      if (detail) {
        tbody.removeChild(detail);
        detail = null;
        toggle.setAttribute('aria-expanded', 'false');
        return;
      }
      detail = buildAxesRow(n);
      tbody.insertBefore(detail, tr.nextSibling);
      toggle.setAttribute('aria-expanded', 'true');
    });
  }

  function buildAxesRow(n) {
    var tr = el('tr', 'naxes-row');
    var td = el('td');
    td.colSpan = 8;
    var box = el('div', 'naxes');
    (n.axes || []).forEach(function (a) {
      var axe = el('div', 'naxe');
      // Le nom vient de l'API dans les deux langues : on choisit, le traducteur
      // DOM ne repasse pas derrière.
      var nom = el('div', 'naxe-nom', (isEnglish() && a.nomEn) ? a.nomEn : (a.nom || a.id || '—'));
      nom.setAttribute('data-i18n-skip', '');
      axe.appendChild(nom);
      axe.appendChild(el('div', 'naxe-points', dec(a.points) + ' sur ' + num(a.max)));
      var lines = el('div', 'naxe-lines');
      var detail = a.detail || {};
      Object.keys(detail).forEach(function (k) {
        var line = el('div', 'naxe-line');
        line.appendChild(el('span', 'naxe-k', detailLabel(a.id, k)));
        line.appendChild(el('span', 'naxe-v', detailValue(k, detail[k])));
        lines.appendChild(line);
      });
      axe.appendChild(lines);
      if (AXE_NOTES[a.id]) axe.appendChild(el('p', 'tpl-note naxe-note', AXE_NOTES[a.id]));
      box.appendChild(axe);
    });
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  // ---------------------------------------------------------------------------
  // Audit — le journal append-only, jour par jour (pièce SOC 2).
  //
  // GET /audit?jour=AAAA-MM-JJ renvoie { jour, entrees } du plus récent au plus
  // ancien ; 422 si le jour n'est pas une date ISO ; 403 pour l'analyste (même
  // porte 'pii:read' que le bottin : les entrées portent courriels et IP).
  //
  // La règle de l'écran : une entrée financière doit se lire SANS connaître le
  // JSON. Un acte réglé sort donc en une phrase — payé, taux, part de Nota,
  // part du notaire, cote — et les identifiants (bid, Stripe) restent à côté,
  // lisibles mais discrets. Les autres gestes montrent leur meta telle quelle :
  // là, le JSON EST l'information.
  // ---------------------------------------------------------------------------
  var auditBody = null;
  var auditJour = null;
  var auditGen = 0; // garde de séquence : un jour lent ne recouvre pas le suivant

  var AUDIT_LABELS = {
    acte_regle: 'Acte réglé',
    commission_schedule_updated: 'Barème de commission modifié',
    commission_schedule_reset: 'Barème de commission réinitialisé',
    cancellation_schedule_updated: 'Barème d’annulation modifié',
    cancellation_schedule_reset: 'Barème d’annulation réinitialisé',
    email_template_updated: 'Modèle de courriel modifié',
    email_template_reset: 'Modèle de courriel réinitialisé',
    login_requested: 'Lien de connexion demandé',
    login_requested_unknown: 'Lien demandé par une adresse inconnue',
    login_throttled: 'Connexion freinée',
    login_success: 'Connexion réussie',
    logout: 'Déconnexion',
    session_refreshed: 'Session prolongée',
  };

  async function renderAudit() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderAudit);
        return;
      }
    }
    renderUserbar();
    if (!auditJour) auditJour = todayISO();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Conformité'));
    titleWrap.appendChild(el('h1', 'page-title', 'Audit'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Journal append-only — chaque geste d’administration et chaque acte réglé, jour par jour.'));
    head.appendChild(titleWrap);
    head.appendChild(el('span', 'admin-spacer'));

    auditBody = el('div');
    // Le sélecteur vit dans l'en-tête, pas dans le corps rechargé : une date
    // refusée par le serveur doit rester corrigeable.
    if (canReadPii()) head.appendChild(buildAuditDayControl());
    content.appendChild(head);
    content.appendChild(auditBody);

    mountAuthed('audit', content);
    focusTitle();
    if (!canReadPii()) { auditBody.appendChild(buildDenied()); return; }
    await loadAuditInto(auditBody);
  }

  function buildAuditDayControl() {
    var wrap = el('div', 'range-control');
    var field = el('div', 'field audit-day-field');
    var label = el('label', null, 'Jour');
    label.setAttribute('for', 'audit-day');
    var input = el('input', 'input audit-day');
    input.type = 'date';
    input.id = 'audit-day';
    input.value = auditJour;
    input.setAttribute('value', auditJour); // survit aussi à une relecture du DOM
    input.max = todayISO(); // un journal n'a rien à dire du futur
    input.setAttribute('data-i18n-skip', '');
    input.addEventListener('change', function () {
      auditJour = input.value || todayISO();
      if (auditBody) loadAuditInto(auditBody);
    });
    field.appendChild(label);
    field.appendChild(input);
    wrap.appendChild(field);
    return wrap;
  }

  async function loadAuditInto(container) {
    var gen = ++auditGen;
    clear(container);
    var skel = el('div');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/audit?jour=' + encodeURIComponent(auditJour));
    if (gen !== auditGen) return; // un autre jour a été choigi entre-temps
    if (r.status === 401) return; // handled by call()
    clear(container);
    if (r.status === 403) { container.appendChild(buildDenied()); return; }
    // 422 : la date est illisible pour le serveur — c'est SA phrase qui
    // s'affiche, sous le sélecteur qui permet de la corriger.
    if (r.status === 422) {
      var box = el('div', 'tpl-error');
      showErrorLines(box, (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'Le jour demandé est illisible.' }]);
      container.appendChild(box);
      return;
    }
    if (!r.ok || !r.json || !Array.isArray(r.json.entrees)) {
      container.appendChild(buildErrorBanner(function () { loadAuditInto(container); }));
      return;
    }

    var view = el('div', 'view-enter');
    var entrees = r.json.entrees;
    if (!entrees.length) {
      view.appendChild(buildAuditEmpty());
    } else {
      var list = el('div', 'audit-list');
      entrees.forEach(function (e) { list.appendChild(buildAuditEntry(e)); });
      view.appendChild(list);
    }
    container.appendChild(view);
  }

  function buildAuditEmpty() {
    var e = el('div', 'empty-state');
    e.appendChild(el('div', 'empty-state-title', 'Aucune entrée pour ce jour.'));
    e.appendChild(el('div', 'empty-state-text',
      'Ni geste d’administration ni acte réglé n’a été journalisé à cette date.'));
    return e;
  }

  function buildAuditEntry(e) {
    var row = el('div', 'audit-entry');
    var head = el('div', 'audit-entry-head');
    var ts = el('span', 'audit-ts', String(e.ts || '').slice(11, 16) || '—:—');
    ts.setAttribute('data-i18n-skip', '');
    head.appendChild(ts);
    var action = el('span', 'audit-action', AUDIT_LABELS[e.action] || e.action || '—');
    if (!AUDIT_LABELS[e.action]) action.setAttribute('data-i18n-skip', ''); // code brut : pas à traduire
    head.appendChild(action);
    var who = el('span', 'audit-who');
    var qui = e.email || 'système';
    var quiEl = el('span', null, qui);
    if (e.email) quiEl.setAttribute('data-i18n-skip', '');
    who.appendChild(quiEl);
    if (e.ip) {
      var ip = el('span', 'audit-ip', e.ip);
      ip.setAttribute('data-i18n-skip', '');
      who.appendChild(ip);
    }
    head.appendChild(who);
    row.appendChild(head);

    var m = e.meta || {};
    if (e.action === 'acte_regle' && typeof m.montant === 'number'
        && typeof m.commission === 'number' && typeof m.net === 'number') {
      // LA divulgation : ce que le client a payé, ce que Nota a gardé, à quel
      // taux, ce qui reste au notaire, et la cote qui l'a décidé.
      row.appendChild(el('p', 'audit-money',
        moneyCents(m.montant * 100) + ' payés · ' + pctLabel(m.taux) + ' · ' +
        moneyCents(m.commission * 100) + ' à Nota · ' + moneyCents(m.net * 100) + ' au notaire · ' +
        'cote ' + num(m.cote)));
      var facts = el('div', 'audit-facts');
      facts.setAttribute('data-i18n-skip', ''); // identifiants et codes de service
      facts.textContent = [m.serviceId, m.dateISO, m.bidId, m.notaryId, m.chargeId, m.transferId]
        .filter(function (x) { return x; }).join(' · ');
      row.appendChild(facts);
    } else if (Object.keys(m).length) {
      // Les autres gestes : la meta telle quelle, une ligne par clé. Ici le
      // JSON EST la pièce — on ne prétend pas le raconter.
      var meta = el('div', 'audit-meta');
      Object.keys(m).forEach(function (k) {
        var line = el('div', 'audit-meta-line');
        line.appendChild(el('span', 'audit-meta-k', k));
        var v = el('span', 'audit-meta-v', typeof m[k] === 'string' ? m[k] : JSON.stringify(m[k]));
        v.setAttribute('data-i18n-skip', '');
        line.appendChild(v);
        meta.appendChild(line);
      });
      row.appendChild(meta);
    }
    return row;
  }

  // --- Loading / empty / error ----------------------------------------------
  function buildSkeletons() {
    var wrap = el('div');
    var grid = el('div', 'stat-grid');
    for (var i = 0; i < 7; i++) grid.appendChild(el('div', 'skeleton skeleton-tile'));
    wrap.appendChild(grid);
    var charts = el('div', 'chart-grid');
    charts.appendChild(el('div', 'skeleton skeleton-chart'));
    charts.appendChild(el('div', 'skeleton skeleton-chart'));
    wrap.appendChild(charts);
    return wrap;
  }

  function buildEmptyState() {
    var e = el('div', 'empty-state');
    var ic = svgEl('svg', { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      class: 'empty-state-icon', 'aria-hidden': 'true' });
    ic.appendChild(svgEl('path', { d: 'M3 3v18h18' }));
    ic.appendChild(svgEl('path', { d: 'M7 14l3-3 3 3 4-5' }));
    e.appendChild(ic);
    e.appendChild(el('div', 'empty-state-title', 'Aucune donnée pour cette période.'));
    e.appendChild(el('div', 'empty-state-text',
      'Aucune offre, rétention ou commission n’a été enregistrée sur l’intervalle sélectionné. Essayez une période plus large.'));
    return e;
  }

  function buildErrorBanner(retry) {
    var b = el('div', 'error-banner');
    var body = el('div', 'error-banner-body');
    body.appendChild(el('div', 'error-banner-title', 'Impossible de charger les données.'));
    body.appendChild(el('div', 'error-banner-text', 'Le service n’a pas répondu correctement. Vérifiez votre connexion, puis réessayez.'));
    b.appendChild(body);
    var btn = el('button', 'btn btn-sm', 'Réessayer');
    btn.type = 'button';
    btn.addEventListener('click', retry);
    b.appendChild(btn);
    return b;
  }

  // --- Small inline icons ----------------------------------------------------
  function iconGrid() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    [['3','3','7','7'], ['14','3','7','7'], ['14','14','7','7'], ['3','14','7','7']].forEach(function (r) {
      s.appendChild(svgEl('rect', { x: r[0], y: r[1], width: r[2], height: r[3], rx: 1 }));
    });
    return s;
  }
  function iconMail() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }));
    s.appendChild(svgEl('path', { d: 'M3 7l9 6 9-6' }));
    return s;
  }
  function iconPercent() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('line', { x1: 19, y1: 5, x2: 5, y2: 19 }));
    s.appendChild(svgEl('circle', { cx: 6.5, cy: 6.5, r: 2.5 }));
    s.appendChild(svgEl('circle', { cx: 17.5, cy: 17.5, r: 2.5 }));
    return s;
  }
  function iconCalendarX() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }));
    s.appendChild(svgEl('line', { x1: 8, y1: 3, x2: 8, y2: 7 }));
    s.appendChild(svgEl('line', { x1: 16, y1: 3, x2: 16, y2: 7 }));
    s.appendChild(svgEl('line', { x1: 9.5, y1: 12, x2: 14.5, y2: 17 }));
    s.appendChild(svgEl('line', { x1: 14.5, y1: 12, x2: 9.5, y2: 17 }));
    return s;
  }
  function iconUsers() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }));
    s.appendChild(svgEl('circle', { cx: 9, cy: 7, r: 3 }));
    s.appendChild(svgEl('path', { d: 'M17 4.5a3 3 0 0 1 0 5.8' }));
    s.appendChild(svgEl('path', { d: 'M22 20v-2a4 4 0 0 0-3-3.8' }));
    return s;
  }
  function iconShield() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M12 3l8 3v6c0 4.6-3.2 8.4-8 9.5-4.8-1.1-8-4.9-8-9.5V6l8-3z' }));
    s.appendChild(svgEl('path', { d: 'M9 12l2 2 4-4' }));
    return s;
  }
  function iconDot() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'aria-hidden': 'true' });
    s.appendChild(svgEl('circle', { cx: 12, cy: 12, r: 3.5 }));
    return s;
  }

  // ---------------------------------------------------------------------------
  // Navigation helper + boot
  // ---------------------------------------------------------------------------
  function go(hash) {
    if (location.hash === hash) router(); // same hash → no hashchange event; route manually
    else location.hash = hash;
  }

  function boot() {
    var toggle = $('admin-theme-toggle');
    if (toggle) toggle.addEventListener('click', toggleTheme);
    var out = $('admin-logout');
    if (out) out.addEventListener('click', logout);

    window.addEventListener('hashchange', router);
    router();
  }

  boot();
})();
