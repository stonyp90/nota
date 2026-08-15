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
  var ROLE_LABELS = { super_admin: 'Super admin', analyst: 'Analyste' };
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
      if (ok) { renderOverview(); }
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

    // Phase-2 placeholders — visible but disabled, so the console reads as a
    // console without shipping dead links.
    ['Offres', 'Notaires'].forEach(function (name) {
      var b = el('button', 'admin-rail-link', null);
      b.type = 'button'; b.disabled = true;
      b.appendChild(iconDot());
      b.appendChild(document.createTextNode(name));
      b.appendChild(el('span', 'admin-rail-soon', 'Bientôt'));
      rail.appendChild(b);
    });
    return rail;
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

  async function loadOverviewInto(container) {
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
      container.appendChild(buildErrorBanner(function () { loadOverviewInto(container); }));
      return;
    }
    var data = r.json;
    var view = el('div', 'view-enter');
    if (isEmptyOverview(data)) {
      view.appendChild(buildStatTiles(data, true)); // real zeros, muted
      view.appendChild(buildEmptyState());
    } else {
      view.appendChild(buildStatTiles(data, false));
      view.appendChild(buildCharts(data));
    }
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
    grid.appendChild(tile('Notaires en intégration', num(g.onboardingNotaries || 0), 'onboarding', true));
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
