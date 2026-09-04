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
    if (hash.indexOf('#/campagnes') === 0) { renderCampagnes(); return; }
    if (hash.indexOf('#/prix') === 0) { renderPrix(); return; }
    if (hash.indexOf('#/acces') === 0) { renderAcces(); return; }
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

    // Campagnes — les envois ciblés (une personne, un groupe, un segment).
    // L'entrée reste ACTIVE sans « campaigns:send » : l'écran s'ouvre en
    // lecture seule et dit pourquoi l'envoi est fermé, comme partout ailleurs
    // dans la console.
    var camp = el('button', 'admin-rail-link');
    camp.type = 'button';
    camp.appendChild(iconSend());
    camp.appendChild(document.createTextNode('Campagnes'));
    if (active === 'campagnes') camp.setAttribute('aria-current', 'page');
    camp.addEventListener('click', function () { go('#/campagnes'); });
    rail.appendChild(camp);

    // Prix — le prix du service de Nota, un montant fixe (ADR 0031). Cette
    // entrée remplace « Commission » : Nota ne prélève plus une part des
    // honoraires du notaire, elle vend son service à son propre prix.
    var prix = el('button', 'admin-rail-link');
    prix.type = 'button';
    prix.appendChild(iconTag());
    prix.appendChild(document.createTextNode('Prix'));
    if (active === 'prix') prix.setAttribute('aria-current', 'page');
    prix.addEventListener('click', function () { go('#/prix'); });
    rail.appendChild(prix);

    // Accès — utilisateurs, groupes, permissions. Trois concepts découplés :
    // une permission est une capacité, un groupe en réunit, une personne reçoit
    // des groupes ET des permissions directes. Le rôle survit comme raccourci
    // de compatibilité, jamais comme la seule granularité offerte : on doit
    // pouvoir ouvrir une capacité sans promouvoir personne.
    var acces = el('button', 'admin-rail-link');
    acces.type = 'button';
    acces.appendChild(iconUsers());
    acces.appendChild(document.createTextNode('Accès'));
    if (active === 'acces') acces.setAttribute('aria-current', 'page');
    acces.addEventListener('click', function () { go('#/acces'); });
    rail.appendChild(acces);

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
  // rows read-only, with no save controls.
  //
  // La surcharge porte QUATRE paires bilingues — sujet, ligne d'aperçu, corps,
  // bouton — plus l'interrupteur d'envoi. Trois règles de l'API que cet écran
  // rend visibles AVANT l'enregistrement, plutôt que de les laisser découvrir
  // par un refus :
  //   • les bornes de longueur viennent du serveur (`limites`), jamais d'ici :
  //     une borne recopiée diverge le jour où l'API bouge la sienne ;
  //   • une paire est tout-ou-rien — le français sans l'anglais est refusé ;
  //   • un courriel TRANSACTIONNEL ne peut pas être éteint. Il annonce un fait
  //     que son destinataire doit connaître ; le couper serait une publicité
  //     « incomplète » au sens de l'art. 68 du Code de déontologie. L'écran
  //     grise l'interrupteur ET écrit pourquoi.
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
  // Les bornes SERVIES par l'API (`limites: { sujet, preheader, corps, cta }`).
  // Vide tant qu'aucune réponse ne les porte : un champ sans borne connue part
  // sans `maxlength` et c'est le serveur qui tranche — mieux qu'un nombre
  // inventé ici, qui mentirait le jour où l'API change le sien.
  var courrielsLimites = {};
  function limiteDe(code) {
    var n = Number(courrielsLimites && courrielsLimites[code]);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // Les quatre paires bilingues, dans l'ordre où l'écran les pose. `code` est
  // aussi la clé de la borne servie et le préfixe des codes d'erreur de l'API
  // (`sujet_bilingue`, `corps_trop_long`, …) : un seul mot relie le champ, sa
  // borne et son refus.
  var TPL_PAIRES = [
    { code: 'sujet', fr: 'subjectFr', en: 'subjectEn', libFr: 'Sujet (FR)', libEn: 'Sujet (EN)', multi: false },
    { code: 'preheader', fr: 'preheaderFr', en: 'preheaderEn', libFr: 'Ligne d’aperçu (FR)', libEn: 'Ligne d’aperçu (EN)', multi: false },
    { code: 'corps', fr: 'corpsFr', en: 'corpsEn', libFr: 'Corps (FR)', libEn: 'Corps (EN)', multi: true },
    { code: 'cta', fr: 'ctaFr', en: 'ctaEn', libFr: 'Bouton (FR)', libEn: 'Bouton (EN)', multi: false },
  ];
  // subjectFr → 'sujet' : par quel champ un refus nominatif entre.
  var TPL_CHAMP_PAIRE = {};
  TPL_PAIRES.forEach(function (p) { TPL_CHAMP_PAIRE[p.fr] = p.code; TPL_CHAMP_PAIRE[p.en] = p.code; });

  function isEnglish() {
    try { return !!(window.NotaI18N && window.NotaI18N.lang && window.NotaI18N.lang() === 'en'); }
    catch (e) { return false; }
  }
  function canWriteNotifications() {
    return can('notifications:write');
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
      'Sujet, ligne d’aperçu, corps et bouton de chaque modèle, dans les deux langues. Un courriel transactionnel ne peut pas être éteint.'));
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
    // Les bornes voyagent à la RACINE de la réponse, une seule fois pour tous
    // les gabarits. Absentes, on n'en invente pas.
    courrielsLimites = (r.json.limites && typeof r.json.limites === 'object') ? r.json.limites : {};

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

  // Éteint AU SENS DU SERVEUR. `actif` est le nom du produit, `enabled`
  // l'ancien, encore servi — mais surtout : un enregistrement qui couperait un
  // gabarit TRANSACTIONNEL est sans effet côté API (`isOverrideDisabled`
  // l'ignore). L'écran ne doit donc jamais estampiller « Désactivé » un
  // courriel qui part quand même : ce serait mentir sur l'état du système.
  function templateEteint(t) {
    if (!t || t.transactionnel === true) return false;
    var o = t.override;
    return !!o && (o.actif === false || o.enabled === false);
  }
  // Modifié dès qu'UNE des huit cases porte du texte — pas seulement le sujet.
  function overrideModifie(o) {
    if (!o) return false;
    for (var i = 0; i < TPL_PAIRES.length; i++) {
      if (o[TPL_PAIRES[i].fr] || o[TPL_PAIRES[i].en]) return true;
    }
    return false;
  }

  function overrideBadges(t) {
    var wrap = el('span', 'tpl-badges');
    // Se lit AVANT d'ouvrir l'éditeur : ce courriel-là ne s'éteint pas.
    if (t.transactionnel === true) {
      var tr = el('span', 'tpl-badge is-transactionnel', 'Transactionnel');
      tr.title = 'Annonce un fait à son destinataire : ne peut pas être désactivé.';
      wrap.appendChild(tr);
    }
    var o = t.override;
    if (templateEteint(t)) wrap.appendChild(el('span', 'tpl-badge is-off', 'Désactivé'));
    if (overrideModifie(o)) wrap.appendChild(el('span', 'tpl-badge is-custom', 'Modifié'));
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
    var transactionnel = t.transactionnel === true;
    var box = el('div', 'tpl-editor');
    // Une région d'erreur PAR paire, plus une pour l'interrupteur et une pour
    // ce qui ne vise aucun champ : un refus se lit sous le champ qu'il vise.
    var slots = {};
    function slot(cle, parent) {
      var s = el('div', 'tpl-error');
      s.hidden = true;
      s.setAttribute('data-erreur', cle);
      slots[cle] = s;
      parent.appendChild(s);
      return s;
    }

    // --- L'interrupteur d'envoi ------------------------------------------------
    var sw = el('div', 'tpl-switch');
    var toggleWrap = el('label', 'tpl-toggle');
    var toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = !templateEteint(t);
    // Art. 68 — la publicité incomplète. La porte est fermée ICI, pas au
    // moment de l'enregistrement : l'opérateur doit lire pourquoi avant
    // d'essayer, pas récolter un refus après coup.
    toggle.disabled = !writable || transactionnel;
    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(el('span', null, 'Envoi activé'));
    sw.appendChild(toggleWrap);
    // Trois états, pas deux : transactionnel, commercial, ou NON DÉCLARÉ. Un
    // serveur qui ne sert pas le drapeau ne rend pas ce courriel commercial —
    // et l'affirmer serait inventer un fait juridique. On laisse alors
    // l'interrupteur ouvert (ne pas fermer ce qu'on ne peut pas justifier) en
    // disant que la nature n'est pas connue.
    sw.appendChild(el('p', 'tpl-note tpl-nature',
      transactionnel
        ? 'Courriel transactionnel — il annonce à son destinataire un fait qu’il doit connaître : un accusé, un mouvement d’argent, un acte qui change de mains, un lien de connexion. L’éteindre laisserait la personne sans ce fait, ce qui est une publicité incomplète au sens de l’art. 68 du Code de déontologie. L’envoi ne peut donc pas être coupé ; la reformulation, elle, reste permise.'
        : (typeof t.transactionnel === 'boolean'
          ? 'Courriel commercial — relance, digest, invitation, reconquête. L’art. 56 1° du Code de déontologie tient l’autre bout : inciter quelqu’un de façon pressante ou répétée est dérogatoire, donc celui-ci doit pouvoir être coupé.'
          : 'Nature non déclarée par l’API pour ce modèle. L’interrupteur reste ouvert, mais vérifiez avant de couper : éteindre un courriel transactionnel serait une publicité incomplète au sens de l’art. 68 du Code de déontologie.')));
    slot('actif', sw);
    box.appendChild(sw);

    // --- Les quatre paires bilingues ------------------------------------------
    var champs = {};
    TPL_PAIRES.forEach(function (paire) {
      var bloc = el('div', 'tpl-pair');
      bloc.setAttribute('data-paire', paire.code);
      var fields = el('div', 'tpl-fields');
      [['fr', paire.libFr], ['en', paire.libEn]].forEach(function (cote) {
        fields.appendChild(buildTemplateChamp(t, paire, cote[0], cote[1], writable, champs));
      });
      bloc.appendChild(fields);
      slot(paire.code, bloc);
      box.appendChild(bloc);
    });

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
      'Un champ laissé vide garde le texte du gabarit. Les deux langues d’une même ligne vont ensemble : remplissez le français ET l’anglais, ou aucun des deux.'));

    slot('autre', box);

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
        submitTemplate('DELETE', t.key, null, [save, reset], slots, container, 'Modèle réinitialisé.');
      });
    }
    box.appendChild(actions);

    save.addEventListener('click', function () {
      var body = { actif: toggle.checked };
      TPL_PAIRES.forEach(function (paire) {
        body[paire.fr] = champs[paire.fr].value.trim();
        body[paire.en] = champs[paire.en].value.trim();
      });
      // Le serveur reste l'autorité ; ce qu'il refusera à coup sûr se dit
      // AVANT le voyage, avec ses mots à lui.
      var errs = validerModele(t, body);
      if (errs.length) { afficherErreursModele(slots, champs, errs); return; }
      submitTemplate('PUT', t.key, body, [save], slots, container, 'Modèle enregistré.');
    });
    return box;
  }

  // Un côté d'une paire : son libellé, son champ, et le compteur qui rend la
  // borne servie visible pendant la frappe.
  function buildTemplateChamp(t, paire, cote, libelle, writable, champs) {
    var nom = cote === 'fr' ? paire.fr : paire.en;
    var field = el('div', 'field');
    var id = 'tpl-' + t.key + '-' + nom;
    var lab = el('label', null, libelle);
    lab.setAttribute('for', id);
    field.appendChild(lab);

    var input = el(paire.multi ? 'textarea' : 'input', paire.multi ? 'input tpl-textarea' : 'input');
    input.id = id;
    input.name = nom;
    if (paire.multi) input.rows = 4; else input.type = 'text';
    // La borne vient du serveur — jamais d'un nombre écrit ici.
    var max = limiteDe(paire.code);
    if (max) input.maxLength = max;
    // Seul le sujet a un défaut servi : lui seul peut le montrer en filigrane.
    if (paire.code === 'sujet') input.placeholder = cote === 'fr' ? t.defaultSubjectFr : t.defaultSubjectEn;
    input.setAttribute('data-i18n-skip', '');
    var o = t.override || {};
    input.value = o[nom] || '';
    input.disabled = !writable;
    field.appendChild(input);
    champs[nom] = input;

    if (max) {
      var compteur = el('span', 'tpl-count');
      compteur.setAttribute('data-i18n-skip', '');
      var maj = function () { compteur.textContent = input.value.length + ' / ' + max; };
      input.addEventListener('input', maj);
      maj();
      field.appendChild(compteur);
    }
    return field;
  }

  // Ce que la console refuse elle-même, dans les mots exacts de l'API : un
  // gabarit transactionnel qu'on éteindrait (art. 68), et une paire à moitié
  // remplie. Les bornes, elles, sont déjà tenues par `maxlength` quand le
  // serveur les a servies ; sinon c'est lui qui tranche.
  function validerModele(t, body) {
    var errs = [];
    if (!body.actif && t.transactionnel === true) errs.push({ code: 'desactivation_interdite' });
    TPL_PAIRES.forEach(function (paire) {
      var fr = body[paire.fr];
      var en = body[paire.en];
      if ((fr && !en) || (!fr && en)) errs.push({ code: paire.code + '_bilingue' });
    });
    return errs;
  }

  // Par quel champ un refus entre. Les codes de paire le disent d'eux-mêmes ;
  // les refus nominatifs (jeton, HTML, partage) nomment leur champ en tête de
  // message — « subjectFr : … » — et c'est ce préfixe qui les ramène au bon
  // endroit. Le reste tombe dans la région commune, jamais dans la console.
  function tplPaireDeLErreur(err) {
    var code = String((err && err.code) || '');
    if (code === 'desactivation_interdite') return 'actif';
    for (var i = 0; i < TPL_PAIRES.length; i++) {
      var c = TPL_PAIRES[i].code;
      if (code === c + '_bilingue' || code === c + '_trop_long') return c;
    }
    var m = /^\s*([A-Za-z]+)\s*:/.exec(String((err && err.message) || ''));
    if (m && TPL_CHAMP_PAIRE[m[1]]) return TPL_CHAMP_PAIRE[m[1]];
    return 'autre';
  }

  function afficherErreursModele(slots, champs, errs) {
    Object.keys(slots).forEach(function (k) { slots[k].hidden = true; clear(slots[k]); });
    Object.keys(champs || {}).forEach(function (n) { champs[n].removeAttribute('aria-invalid'); });
    if (!errs || !errs.length) return;

    var par = {};
    errs.forEach(function (er) {
      var cle = tplPaireDeLErreur(er);
      if (!slots[cle]) cle = 'autre';
      (par[cle] = par[cle] || []).push(er);
    });
    Object.keys(par).forEach(function (cle) {
      showErrorLines(slots[cle], par[cle]);
      // Le champ lui-même porte la marque : l'œil va au champ, pas au bas du
      // formulaire.
      TPL_PAIRES.forEach(function (paire) {
        if (paire.code !== cle || !champs) return;
        [paire.fr, paire.en].forEach(function (n) {
          if (champs[n]) champs[n].setAttribute('aria-invalid', 'true');
        });
      });
    });
  }

  async function submitTemplate(method, key, body, buttons, slots, container, okMsg) {
    buttons.forEach(function (b) { b.disabled = true; });
    var r = await call(method, '/notifications/templates/' + encodeURIComponent(key), body === null ? undefined : body);
    buttons.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) return; // handled by call()
    if (!r.ok) {
      afficherErreursModele(slots, null, (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'Impossible d’enregistrer le modèle.' }]);
      return;
    }
    afficherErreursModele(slots, null, []); // un modèle accepté ne laisse pas traîner l'ancien refus
    toast(okMsg);
    await loadTemplatesInto(container);
  }

  // ---------------------------------------------------------------------------
  // Campagnes — à qui Nota écrit, et pourquoi celui-là.
  //
  // Trois cibles : une personne nommée, un groupe, ou un SEGMENT calculé dont
  // les seuils s'éditent dans les bornes servies par le serveur. L'écran ne
  // connaît aucun segment en dur : le catalogue vient de GET /segments, comme
  // le catalogue des permissions vient de GET /permissions.
  //
  // Deux textes commandent cet écran, et il doit les rendre LISIBLES plutôt que
  // de les appliquer en silence :
  //
  //   • LCAP (L.C. 2010, ch. 23, art. 6 et 10) — un message COMMERCIAL exige une
  //     base de consentement, l'identification de l'expéditeur et un mécanisme
  //     d'exclusion qui fonctionne. Une campagne commerciale n'est pas une
  //     notification transactionnelle : confirmer une offre qu'un client vient
  //     de déposer n'est pas une réclame ; relancer un notaire parti depuis
  //     quarante jours en est une. L'écran nomme donc la nature de ce qu'il
  //     s'apprête à envoyer, AVANT l'envoi.
  //
  //   • Art. 56 1° du Code de déontologie des notaires — est dérogatoire à la
  //     dignité de la profession le fait « d'inciter quelqu'un de façon
  //     pressante ou répétée à recourir à ses services professionnels ». Le
  //     plafond de fréquence et le décompte des exclus sont la réponse produit.
  //     Un opérateur qui ne voit pas ses exclusions ne sait pas ce qu'il a fait :
  //     les cinq exclusions sont donc rendues UNE PAR UNE, avec leur raison, y
  //     compris celles qui valent zéro.
  //
  // L'ordre compte et l'écran l'impose : cible → gabarit → APERÇU → envoi
  // derrière une confirmation en page qui répète le nombre. Changer un seul
  // paramètre périme l'aperçu et referme l'envoi ; un décompte qui ne
  // correspond plus à la cible est pire que pas de décompte.
  // ---------------------------------------------------------------------------
  var campagnesBody = null;
  var campEtat = null;
  var campNoeuds = null;

  function canSendCampaigns() { return can('campaigns:send'); }
  function canPreviewCampaigns() { return can('analytics:read'); }

  // Les trois formes de cible, dans l'ordre où l'écran les propose.
  var CAMP_CIBLES = [
    { type: 'segment', libelle: 'Un segment' },
    { type: 'group', libelle: 'Un groupe' },
    { type: 'user', libelle: 'Une personne' },
  ];
  // …mais l'écran les affiche du plus étroit au plus large : une personne, un
  // groupe, un segment. `CAMP_CIBLES` garde l'ordre de DÉFAUT (segment) ;
  // celui-ci est l'ordre de LECTURE.
  var CAMP_CIBLES_AFFICHAGE = ['user', 'group', 'segment'];
  var CAMP_CIBLE_LABEL = { user: 'Une personne', group: 'Un groupe', segment: 'Un segment' };

  // Les cinq exclusions, dans l'ordre où la résolution les applique, chacune
  // avec la RAISON qui la justifie. L'étiquette seule ne se vérifie pas ; la
  // raison, oui.
  var CAMP_EXCLUS = [
    { cle: 'sansCourriel', libelle: 'Sans adresse courriel',
      raison: 'Aucune adresse au dossier — il n’y a personne à joindre.' },
    { cle: 'doublons', libelle: 'Doublons',
      raison: 'La même adresse visée par plusieurs parties de l’audience, comptée une seule fois.' },
    { cle: 'desabonnes', libelle: 'Désabonnés',
      raison: 'Retrait demandé. La LCAP (art. 6) exige un mécanisme d’exclusion qui fonctionne.' },
    { cle: 'sansConsentement', libelle: 'Sans base de consentement',
      raison: 'Ni consentement exprès ni relation d’affaires en cours pour un message commercial (LCAP, art. 10).' },
    { cle: 'frequence', libelle: 'Plafond de fréquence',
      raison: 'Déjà joints dans la fenêtre. Art. 56 1° : ne pas inciter de façon pressante ou répétée.' },
  ];

  var CAMP_NATURE = {
    commercial: {
      libelle: 'Campagne commerciale',
      note: 'Message commercial au sens de la LCAP : il exige une base de consentement, l’identification de l’expéditeur et un lien de retrait. Ce n’est PAS une notification transactionnelle.',
    },
    transactionnel: {
      libelle: 'Notification transactionnelle',
      note: 'Avis de service : il annonce à son destinataire un fait qu’il doit connaître. Ni la base de consentement commerciale ni le plafond de fréquence ne s’y appliquent.',
    },
  };

  // --- Normalisation du catalogue --------------------------------------------
  // Le contrat HTTP sert des libellés à plat (`libelle` / `libelleEn`) et des
  // paramètres en TABLEAU ; le module segments.js, lui, décrit `libelle:
  // {fr,en}` et des paramètres en OBJET. Les deux formes sont lues ici, une
  // fois, plutôt que d'être devinées à dix endroits — et le jour où l'API se
  // fixe sur l'une, l'autre branche meurt sans que l'écran bouge.
  // « joursSilence » → « Jours silence ». Le contrat HTTP ne sert pas toujours
  // un libellé ; afficher le nom de champ nu ferait lire du code à l'opérateur.
  function humaniser(nom) {
    var s = String(nom || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(nom || '');
  }
  function normaliserParamSegment(nom, p) {
    var lib = p && p.libelle;
    var libFr = (lib && typeof lib === 'object') ? lib.fr : lib;
    var libEn = (lib && typeof lib === 'object') ? lib.en : (p && p.libelleEn);
    var borne = function (v) { var n = Number(v); return (v == null || v === '' || !isFinite(n)) ? null : n; };
    return {
      nom: String(nom),
      libelle: libFr || humaniser(nom),
      libelleEn: libEn || '',
      defaut: borne(p && p.defaut),
      min: borne(p && p.min),
      max: borne(p && p.max),
    };
  }
  function normaliserSegment(s) {
    var lib = s && s.libelle;
    var out = {
      id: String((s && s.id) || ''),
      libelle: (lib && typeof lib === 'object') ? (lib.fr || lib.en || s.id) : (lib || (s && s.id) || ''),
      libelleEn: (s && s.libelleEn) || (lib && typeof lib === 'object' ? lib.en : '') || '',
      vise: (s && s.vise) || '',
      audience: (s && s.audience) || '',
      nature: (s && s.nature) || '',
      params: [],
    };
    var p = s && s.params;
    if (Array.isArray(p)) {
      p.forEach(function (x) { out.params.push(normaliserParamSegment(x && x.nom, x)); });
    } else if (p && typeof p === 'object') {
      Object.keys(p).forEach(function (nom) { out.params.push(normaliserParamSegment(nom, p[nom])); });
    }
    return out;
  }
  function campLibelle(o) { return (isEnglish() && o.libelleEn) ? o.libelleEn : o.libelle; }

  // --- La page ----------------------------------------------------------------
  async function renderCampagnes() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderCampagnes);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Notifications'));
    titleWrap.appendChild(el('h1', 'page-title', 'Campagnes'));
    titleWrap.appendChild(el('p', 'page-sub',
      'À qui Nota écrit, et pourquoi celui-là. Prévisualisez toujours avant d’envoyer : le décompte et les exclusions sont ce qui rend l’envoi défendable.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    campagnesBody = el('div');
    content.appendChild(campagnesBody);
    mountAuthed('campagnes', content);
    focusTitle();
    await loadCampagnesInto(campagnesBody);
  }

  async function loadCampagnesInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var segs = await call('GET', '/segments');
    if (segs.status === 401) return; // handled by call()
    var groupes = await call('GET', '/groups');
    var gabarits = await call('GET', '/notifications/templates');
    clear(container);
    // Sans catalogue de segments il n'y a pas d'écran : le reste ne sert à rien.
    if (!segs.ok || !segs.json || !Array.isArray(segs.json.segments)) {
      container.appendChild(buildErrorBanner(function () { loadCampagnesInto(container); }));
      return;
    }

    campEtat = {
      segments: segs.json.segments.map(normaliserSegment),
      // Une porte fermée n'est pas une panne : sans « groups:read » la cible
      // « groupe » reste offerte, vide, et le dit.
      groupes: (groupes.ok && groupes.json && groupes.json.groupes) || [],
      gabarits: (gabarits.ok && gabarits.json && Array.isArray(gabarits.json.templates)) ? gabarits.json.templates : [],
      cible: 'segment',
      email: '',
      groupId: '',
      segmentId: '',
      templateKey: '',
      apercu: null,       // { signature, data }
      resultat: null,
    };
    if (campEtat.segments.length) campEtat.segmentId = campEtat.segments[0].id;
    if (campEtat.groupes.length) campEtat.groupId = campEtat.groupes[0].id;

    var view = el('div', 'view-enter');
    if (!canSendCampaigns()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(
        ' — l’envoi d’une campagne demande la permission « Envoyer une campagne ciblée ». La prévisualisation, elle, reste ouverte.'));
      view.appendChild(note);
    }
    view.appendChild(buildCampCadre());
    view.appendChild(buildCampForm(container));
    campNoeuds.sortie = el('div', 'camp-sortie');
    view.appendChild(campNoeuds.sortie);
    container.appendChild(view);
  }

  // Le cadre juridique, en tête et non en note de bas de page.
  function buildCampCadre() {
    var card = el('section', 'chart-card camp-cadre');
    card.appendChild(el('div', 'chart-card-title', 'Ce qu’un envoi engage'));
    card.appendChild(el('p', 'camp-cadre-texte',
      'LCAP (L.C. 2010, ch. 23, art. 6 et 10) — un message commercial exige une base de consentement, l’identification de l’expéditeur et un mécanisme d’exclusion qui fonctionne. Une campagne commerciale n’est pas une notification transactionnelle : l’aperçu dit laquelle des deux part.'));
    card.appendChild(el('p', 'camp-cadre-texte',
      'Art. 56 1° du Code de déontologie des notaires — est dérogatoire le fait d’inciter quelqu’un de façon pressante ou répétée à recourir à ses services. Le plafond de fréquence et le décompte des exclus sont la réponse ; c’est pourquoi ils sont affichés, exclusion par exclusion.'));
    return card;
  }

  // --- Le formulaire ----------------------------------------------------------
  function buildCampForm(container) {
    campNoeuds = { container: container };
    var card = el('section', 'chart-card camp-form');

    // (1) La cible
    var e1 = el('div', 'camp-etape');
    e1.appendChild(el('div', 'chart-card-title', '1 · La cible'));
    var seg = el('div', 'seg camp-cible');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Forme de la cible');
    CAMP_CIBLES_AFFICHAGE.forEach(function (type) {
      var b = el('button', 'seg-btn' + (type === campEtat.cible ? ' is-on' : ''), CAMP_CIBLE_LABEL[type]);
      b.type = 'button';
      b.setAttribute('aria-pressed', type === campEtat.cible ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (campEtat.cible === type) return;
        campEtat.cible = type;
        seg.querySelectorAll('.seg-btn').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        buildCampCiblePanneau();
        campPerimer();
      });
      seg.appendChild(b);
    });
    e1.appendChild(seg);
    campNoeuds.panneau = el('div', 'camp-cible-panneau');
    e1.appendChild(campNoeuds.panneau);
    card.appendChild(e1);

    // (2) Le gabarit
    var e2 = el('div', 'camp-etape');
    e2.appendChild(el('div', 'chart-card-title', '2 · Le gabarit'));
    var field = el('div', 'field');
    field.appendChild(el('label', null, 'Courriel à envoyer'));
    var select = el('select', 'input');
    select.name = 'templateKey';
    // Aucun gabarit pré-choisi : une campagne ne se déclenche pas sur un défaut.
    var vide = el('option', null, '— Choisissez un gabarit —');
    vide.value = '';
    select.appendChild(vide);
    var parAudience = {};
    campEtat.gabarits.forEach(function (t) { (parAudience[t.audience] = parAudience[t.audience] || []).push(t); });
    AUDIENCE_ORDER.forEach(function (aud) {
      var liste = parAudience[aud];
      if (!liste || !liste.length) return;
      var grp = el('optgroup');
      grp.label = AUDIENCE_LABELS[aud] || aud;
      liste.forEach(function (t) {
        var o = el('option', null, isEnglish() ? t.labelEn : t.labelFr);
        o.value = t.key;
        o.setAttribute('data-i18n-skip', '');
        grp.appendChild(o);
      });
      select.appendChild(grp);
    });
    select.addEventListener('change', function () {
      campEtat.templateKey = select.value;
      campNatureGabarit();
      campPerimer();
    });
    field.appendChild(select);
    e2.appendChild(field);
    campNoeuds.gabaritNature = el('p', 'tpl-note camp-gabarit-nature');
    e2.appendChild(campNoeuds.gabaritNature);
    card.appendChild(e2);

    // (3) Erreurs, actions, confirmation
    campNoeuds.erreur = el('div', 'tpl-error camp-erreur');
    campNoeuds.erreur.hidden = true;
    card.appendChild(campNoeuds.erreur);

    var actions = el('div', 'tpl-actions');
    campNoeuds.previsualiser = el('button', 'btn btn-sm btn-primary camp-previsualiser', 'Prévisualiser');
    campNoeuds.previsualiser.type = 'button';
    campNoeuds.previsualiser.disabled = !canPreviewCampaigns();
    campNoeuds.previsualiser.addEventListener('click', function () { previsualiserCampagne(); });
    actions.appendChild(campNoeuds.previsualiser);

    // Visible et fermé plutôt qu'escamoté : la console garde sa forme et dit
    // pourquoi la commande ne s'ouvre pas.
    campNoeuds.envoyer = el('button', 'btn btn-sm camp-envoyer', 'Envoyer la campagne');
    campNoeuds.envoyer.type = 'button';
    campNoeuds.envoyer.addEventListener('click', function () { campOuvrirConfirmation(); });
    actions.appendChild(campNoeuds.envoyer);
    card.appendChild(actions);

    campNoeuds.perime = el('p', 'tpl-note camp-perime');
    card.appendChild(campNoeuds.perime);
    if (!canPreviewCampaigns()) {
      card.appendChild(el('p', 'tpl-note',
        'La prévisualisation demande la permission « Lire les statistiques ».'));
    }

    campNoeuds.confirm = el('div', 'bareme-confirm camp-confirm');
    campNoeuds.confirm.hidden = true;
    campNoeuds.confirmTexte = el('p', 'bareme-confirm-text');
    campNoeuds.confirm.appendChild(campNoeuds.confirmTexte);
    var cActions = el('div', 'tpl-actions');
    var oui = el('button', 'btn btn-sm btn-primary camp-confirmer', 'Confirmer l’envoi');
    oui.type = 'button';
    var non = el('button', 'btn btn-sm btn-ghost camp-annuler', 'Annuler');
    non.type = 'button';
    oui.addEventListener('click', function () { envoyerCampagne(false); });
    non.addEventListener('click', function () { campNoeuds.confirm.hidden = true; });
    cActions.appendChild(oui);
    cActions.appendChild(non);
    campNoeuds.confirm.appendChild(cActions);
    card.appendChild(campNoeuds.confirm);

    buildCampCiblePanneau();
    campNatureGabarit();
    campMajEnvoi();
    return card;
  }

  // Le panneau de la cible courante — reconstruit à chaque changement de forme.
  function buildCampCiblePanneau() {
    var box = campNoeuds.panneau;
    clear(box);
    if (campEtat.cible === 'user') {
      var f = el('div', 'field');
      f.appendChild(el('label', null, 'Adresse courriel'));
      var input = el('input', 'input');
      input.type = 'email';
      input.name = 'cibleEmail';
      input.placeholder = 'personne@exemple.ca';
      input.value = campEtat.email;
      input.addEventListener('input', function () { campEtat.email = input.value; campPerimer(); });
      f.appendChild(input);
      box.appendChild(f);
      box.appendChild(el('p', 'tpl-note',
        'Un envoi nominatif reste un envoi : les mêmes exclusions s’appliquent, et l’aperçu les montre.'));
      return;
    }
    if (campEtat.cible === 'group') {
      var fg = el('div', 'field');
      fg.appendChild(el('label', null, 'Groupe'));
      if (!campEtat.groupes.length) {
        fg.appendChild(el('p', 'tpl-note', 'Aucun groupe lisible avec vos accès.'));
        box.appendChild(fg);
        return;
      }
      var sel = el('select', 'input');
      sel.name = 'cibleGroupe';
      campEtat.groupes.forEach(function (g) {
        var o = el('option', null, g.nom || g.id);
        o.value = g.id;
        o.setAttribute('data-i18n-skip', '');
        sel.appendChild(o);
      });
      sel.value = campEtat.groupId;
      sel.addEventListener('change', function () { campEtat.groupId = sel.value; campPerimer(); });
      fg.appendChild(sel);
      box.appendChild(fg);
      return;
    }

    // Segment : le choix, ce qu'il vise, et ses seuils dans leurs bornes.
    var fs = el('div', 'field');
    fs.appendChild(el('label', null, 'Segment'));
    if (!campEtat.segments.length) {
      fs.appendChild(el('p', 'tpl-note', 'Aucun segment au catalogue.'));
      box.appendChild(fs);
      return;
    }
    var ss = el('select', 'input');
    ss.name = 'cibleSegment';
    campEtat.segments.forEach(function (s) {
      var o = el('option', null, campLibelle(s));
      o.value = s.id;
      o.setAttribute('data-i18n-skip', '');
      ss.appendChild(o);
    });
    ss.value = campEtat.segmentId;
    ss.addEventListener('change', function () {
      campEtat.segmentId = ss.value;
      buildCampCiblePanneau();
      campPerimer();
    });
    fs.appendChild(ss);
    box.appendChild(fs);

    var seg = campSegmentCourant();
    if (!seg) return;
    // Ce que le segment vise, en toutes lettres : un seuil sans sa définition
    // est un nombre qu'on règle à l'aveugle.
    var vise = el('p', 'tpl-note camp-segment-vise', seg.vise);
    vise.setAttribute('data-i18n-skip', '');
    box.appendChild(vise);
    box.appendChild(el('p', 'tpl-note camp-segment-nature',
      (CAMP_NATURE[seg.nature] ? CAMP_NATURE[seg.nature].libelle : seg.nature)));

    if (!seg.params.length) return;
    var grille = el('div', 'tpl-fields camp-params');
    seg.params.forEach(function (p) {
      var f = el('div', 'field');
      var id = 'camp-param-' + p.nom;
      var lab = el('label', null, (isEnglish() && p.libelleEn) ? p.libelleEn : p.libelle);
      lab.setAttribute('for', id);
      lab.setAttribute('data-i18n-skip', '');
      f.appendChild(lab);
      var input = el('input', 'input');
      input.type = 'number';
      input.id = id;
      input.name = 'param-' + p.nom;
      // Les bornes viennent du catalogue servi, jamais d'ici.
      if (p.min != null) input.min = String(p.min);
      if (p.max != null) input.max = String(p.max);
      input.value = p.defaut == null ? '' : String(p.defaut);
      input.addEventListener('input', function () { campPerimer(); });
      f.appendChild(input);
      if (p.min != null && p.max != null) {
        var borne = el('span', 'tpl-count', p.min + ' – ' + p.max);
        borne.setAttribute('data-i18n-skip', '');
        f.appendChild(borne);
      }
      grille.appendChild(f);
    });
    box.appendChild(grille);
  }

  function campSegmentCourant() {
    for (var i = 0; i < campEtat.segments.length; i++) {
      if (campEtat.segments[i].id === campEtat.segmentId) return campEtat.segments[i];
    }
    return null;
  }
  function campGabaritCourant() {
    for (var i = 0; i < campEtat.gabarits.length; i++) {
      if (campEtat.gabarits[i].key === campEtat.templateKey) return campEtat.gabarits[i];
    }
    return null;
  }

  // La nature du GABARIT choisi, dite dès le choix — avant même l'aperçu.
  function campNatureGabarit() {
    var n = campNoeuds.gabaritNature;
    clear(n);
    var t = campGabaritCourant();
    if (!t) {
      n.textContent = 'Aucun gabarit choisi — une campagne ne part jamais sur un défaut.';
      return;
    }
    n.textContent = t.transactionnel === true
      ? 'Ce gabarit est transactionnel : il annonce un fait à son destinataire.'
      : (typeof t.transactionnel === 'boolean'
        ? 'Ce gabarit est commercial : la LCAP exige une base de consentement pour chaque destinataire.'
        // Non déclarée ≠ commerciale. On applique la règle la plus stricte en
        // le disant, plutôt que d'affirmer une qualification qu'on n'a pas.
        : 'Nature non déclarée par l’API pour ce gabarit — traitez-le comme commercial, la règle la plus stricte.');
  }

  // --- L'audience sur le fil ---------------------------------------------------
  function campParams() {
    var seg = campSegmentCourant();
    var out = {};
    if (!seg) return out;
    seg.params.forEach(function (p) {
      var input = document.querySelector('[name="param-' + p.nom + '"]');
      var brut = input ? input.value : (p.defaut == null ? '' : String(p.defaut));
      var n = Number(String(brut).trim().replace(',', '.'));
      out[p.nom] = isFinite(n) ? n : NaN;
    });
    return out;
  }
  function campAudience() {
    if (campEtat.cible === 'user') return { type: 'user', email: String(campEtat.email || '').trim() };
    if (campEtat.cible === 'group') return { type: 'group', groupId: campEtat.groupId };
    return { type: 'segment', segmentId: campEtat.segmentId, params: campParams() };
  }
  function campSignature() {
    try { return JSON.stringify([campAudience(), campEtat.templateKey]); }
    catch (e) { return 'x' + Date.now(); }
  }

  // Ce que la console refuse elle-même — les évidences, pas les règles du
  // serveur : lui seul sait qui est désabonné ou déjà joint.
  function validerCampagne() {
    var errs = [];
    var a = campAudience();
    if (a.type === 'user' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) {
      errs.push({ code: 'cible_sans_adresse' });
    }
    if (a.type === 'group' && !a.groupId) errs.push({ code: 'cible_sans_groupe' });
    if (a.type === 'segment') {
      if (!a.segmentId) errs.push({ code: 'cible_sans_segment' });
      var seg = campSegmentCourant();
      if (seg) {
        seg.params.forEach(function (p) {
          var v = a.params[p.nom];
          var hors = !isFinite(v)
            || (p.min != null && v < p.min)
            || (p.max != null && v > p.max);
          if (hors) {
            errs.push({
              code: 'parametre_hors_bornes',
              message: p.libelle + ' : ' + (p.min == null ? '?' : p.min) + ' – ' + (p.max == null ? '?' : p.max) + '.',
            });
          }
        });
      }
    }
    if (!campEtat.templateKey) errs.push({ code: 'gabarit_manquant' });
    return errs;
  }

  // --- Aperçu ------------------------------------------------------------------
  function campApercuValide() {
    return !!(campEtat.apercu && campEtat.apercu.signature === campSignature());
  }
  // Un aperçu qui ne correspond plus à la cible est pire que pas d'aperçu.
  function campPerimer() {
    campEtat.apercu = null;
    campEtat.resultat = null;
    if (campNoeuds.confirm) campNoeuds.confirm.hidden = true;
    if (campNoeuds.sortie) clear(campNoeuds.sortie);
    campMajEnvoi();
  }
  function campMajEnvoi() {
    var pret = campApercuValide() && canSendCampaigns();
    campNoeuds.envoyer.disabled = !pret;
    campNoeuds.envoyer.classList.toggle('btn-primary', pret);
    campNoeuds.perime.textContent = campApercuValide()
      ? (canSendCampaigns()
        ? 'Le décompte ci-dessous correspond à la cible actuelle. Changez un paramètre et il faudra prévisualiser de nouveau.'
        : 'Le décompte est à jour ; l’envoi demande la permission « Envoyer une campagne ciblée ».')
      : 'Prévisualisez d’abord : l’envoi ne s’ouvre qu’une fois le décompte affiché.';
  }

  async function previsualiserCampagne() {
    var errs = validerCampagne();
    if (errs.length) { showErrorLines(campNoeuds.erreur, errs); return; }
    campNoeuds.erreur.hidden = true;
    clear(campNoeuds.erreur);

    var signature = campSignature();
    var body = { audience: campAudience(), templateKey: campEtat.templateKey };
    campNoeuds.previsualiser.disabled = true;
    var r = await call('POST', '/campaigns/preview', body);
    campNoeuds.previsualiser.disabled = !canPreviewCampaigns();
    if (r.status === 401) return; // handled by call()
    if (!r.ok || !r.json) {
      showErrorLines(campNoeuds.erreur, (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'La prévisualisation n’a pas abouti.' }]);
      return;
    }
    campEtat.apercu = { signature: signature, data: r.json };
    campEtat.resultat = null;
    clear(campNoeuds.sortie);
    campNoeuds.sortie.appendChild(buildCampApercu(r.json));
    campMajEnvoi();
  }

  function buildCampApercu(d) {
    var card = el('section', 'chart-card camp-apercu view-enter');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Aperçu de l’envoi'));
    ht.appendChild(el('div', 'chart-card-sub', 'Rien n’est parti — c’est un décompte.'));
    head.appendChild(ht);
    card.appendChild(head);

    var exclus = d.exclus || {};
    var totalExclus = 0;
    CAMP_EXCLUS.forEach(function (x) { totalExclus += Number(exclus[x.cle]) || 0; });

    var grid = el('div', 'stat-grid');
    var t1 = tile('Destinataires retenus', num(d.total || 0), 'ce que l’envoi atteindrait', false);
    t1.classList.add('camp-total');
    grid.appendChild(t1);
    grid.appendChild(tile('Écartés', num(totalExclus), 'et pourquoi, ligne par ligne', false));
    card.appendChild(grid);

    // LA phrase : laquelle des deux natures part.
    var nat = CAMP_NATURE[d.nature] || null;
    // Le nom et l'explication sont DEUX nœuds : collés en une seule chaîne, le
    // tiret de tête empêcherait la phrase de correspondre au dictionnaire et
    // l'écran anglais mélangerait les deux langues sur la même ligne.
    var pn = el('p', 'camp-nature');
    pn.appendChild(el('strong', null, nat ? nat.libelle : 'Nature inconnue'));
    pn.appendChild(document.createTextNode(' — '));
    pn.appendChild(el('span', null, nat ? nat.note
      : 'Le serveur n’a pas qualifié cette campagne ; traitez-la comme commerciale.'));
    card.appendChild(pn);

    // Le plafond de fréquence : la borne, et si on la dépasse.
    var pl = d.plafond || {};
    var pp = el('p', 'tpl-note camp-plafond');
    pp.textContent = pl.depasse
      ? 'Plafond d’audience dépassé (' + num(pl.limite || 0) + ') — l’envoi demandera une confirmation explicite.'
      : 'Plafond d’audience : ' + num(pl.limite || 0) + ' destinataires. Cette audience tient dessous.';
    card.appendChild(pp);

    // Ce sur quoi l'envoi repose vraiment.
    if (Array.isArray(d.avertissements) && d.avertissements.length) {
      var av = el('div', 'tpl-readonly-note camp-avertissements');
      av.appendChild(el('strong', null, 'À savoir avant d’envoyer'));
      var ul = el('ul', 'camp-avert-list');
      d.avertissements.forEach(function (a) {
        var li = el('li', null, String(a));
        li.setAttribute('data-i18n-skip', '');
        ul.appendChild(li);
      });
      av.appendChild(ul);
      card.appendChild(av);
    }

    card.appendChild(buildCampExclus(exclus));

    // L'échantillon, masqué : reconnaissable, pas expédiable.
    var ech = el('div', 'camp-echantillon');
    ech.appendChild(el('div', 'chart-card-sub', 'Échantillon'));
    if (Array.isArray(d.echantillon) && d.echantillon.length) {
      var liste = el('ul', 'camp-echantillon-list');
      d.echantillon.forEach(function (e) {
        var li = el('li', null, String(e));
        li.setAttribute('data-i18n-skip', '');
        liste.appendChild(li);
      });
      ech.appendChild(liste);
      ech.appendChild(el('p', 'tpl-note', 'Adresses masquées : reconnaissables, pas expédiables.'));
    } else {
      ech.appendChild(el('p', 'tpl-note', 'Aucun destinataire à montrer.'));
    }
    card.appendChild(ech);
    return card;
  }

  // Les cinq exclusions, TOUTES rendues — celles à zéro comprises. Une
  // exclusion qu'on ne voit pas est une exclusion qu'on ne sait pas avoir faite.
  function buildCampExclus(exclus) {
    var wrap = el('div', 'chart-scroll camp-exclus-wrap');
    var table = el('table', 'ptable camp-exclus');
    var thead = el('thead');
    var htr = el('tr');
    [['Écartés', ''], ['Nombre', 'is-num'], ['Pourquoi', '']].forEach(function (h) {
      htr.appendChild(el('th', h[1], h[0]));
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    CAMP_EXCLUS.forEach(function (x) {
      var tr = el('tr');
      tr.setAttribute('data-exclu', x.cle);
      tr.appendChild(el('td', null, x.libelle));
      tr.appendChild(el('td', 'is-num', num(exclus[x.cle] || 0)));
      tr.appendChild(el('td', 'ptable-sub', x.raison));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // --- Envoi -------------------------------------------------------------------
  function campOuvrirConfirmation() {
    if (!campApercuValide() || !canSendCampaigns()) return;
    var total = num((campEtat.apercu.data && campEtat.apercu.data.total) || 0);
    var nat = CAMP_NATURE[campEtat.apercu.data && campEtat.apercu.data.nature];
    clear(campNoeuds.confirmTexte);
    // Le nombre est répété ICI, dans la phrase qu'on confirme — jamais laissé
    // à la mémoire de qui clique.
    campNoeuds.confirmTexte.appendChild(el('strong', null, 'Envoyer à ' + total + ' destinataires ?'));
    campNoeuds.confirmTexte.appendChild(el('span', 'camp-confirm-nature',
      nat ? nat.libelle : 'Nature inconnue'));
    campNoeuds.confirmTexte.appendChild(el('span', null,
      'L’envoi est immédiat et ne se rappelle pas.'));
    campNoeuds.confirm.hidden = false;
  }

  async function envoyerCampagne(confirme) {
    if (!campApercuValide() || !canSendCampaigns()) return;
    var body = { audience: campAudience(), templateKey: campEtat.templateKey };
    if (confirme) body.confirme = true;

    var boutons = [campNoeuds.envoyer, campNoeuds.previsualiser];
    boutons.forEach(function (b) { b.disabled = true; });
    var r = await call('POST', '/campaigns', body);
    // Rendre les boutons à leur état de DROIT, pas à « ouvert » : une requête
    // terminée ne doit pas déverrouiller une commande que la permission ferme.
    campNoeuds.previsualiser.disabled = !canPreviewCampaigns();
    campMajEnvoi();
    if (r.status === 401) return; // handled by call()

    if (!r.ok) {
      var errs = (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'L’envoi n’a pas abouti.' }];
      showErrorLines(campNoeuds.erreur, errs);
      // Un 409 « confirmation_requise » n'est pas une impasse : le serveur
      // demande un geste explicite, l'écran offre ce geste-là et rien d'autre.
      var besoin = errs.some(function (e) { return e && e.code === 'confirmation_requise'; });
      if (besoin && !confirme) {
        var forcer = el('button', 'btn btn-sm btn-danger camp-forcer', 'Confirmer et envoyer quand même');
        forcer.type = 'button';
        forcer.addEventListener('click', function () { envoyerCampagne(true); });
        campNoeuds.erreur.appendChild(forcer);
      }
      return;
    }

    campNoeuds.erreur.hidden = true;
    clear(campNoeuds.erreur);
    campNoeuds.confirm.hidden = true;
    campEtat.resultat = r.json;
    clear(campNoeuds.sortie);
    campNoeuds.sortie.appendChild(buildCampResultat(r.json));
    campEtat.apercu = null; // un envoi consomme son aperçu
    campMajEnvoi();
    toast('Campagne envoyée.');
  }

  function buildCampResultat(d) {
    var card = el('section', 'chart-card camp-resultat view-enter');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Campagne envoyée'));
    var id = el('div', 'chart-card-sub', 'Référence');
    var ref = el('span', null, ' ' + String(d.campagneId || '—'));
    ref.setAttribute('data-i18n-skip', '');
    id.appendChild(ref);
    ht.appendChild(id);
    head.appendChild(ht);
    card.appendChild(head);

    var grid = el('div', 'stat-grid');
    grid.appendChild(tile('Envoyés', num(d.envoyes || 0), 'destinataires joints', false));
    card.appendChild(grid);
    card.appendChild(buildCampExclus(d.exclus || {}));
    card.appendChild(el('p', 'tpl-note',
      'Prévisualisez de nouveau avant tout autre envoi : le décompte précédent a été consommé.'));
    return card;
  }

  // ---------------------------------------------------------------------------
  // Accès — utilisateurs, groupes, permissions.
  //
  // Le découplage est le sujet, pas un détail d'implémentation : une PERMISSION
  // est une capacité, un GROUPE en réunit, une PERSONNE reçoit des groupes ET
  // des permissions directes. Ses accès effectifs sont l'union des trois, et le
  // serveur les recalcule à chaque requête — retirer un groupe mord tout de
  // suite, y compris sur une session déjà ouverte.
  //
  // Deux règles que l'écran rend visibles plutôt que de les cacher :
  //   • le joker « accès complet » ne s'offre PAS sur un groupe. Un groupe qui
  //     porte « tout » se propagerait en silence à chaque nouveau membre ; il se
  //     donne nommément à une personne, et se lit sur sa ligne.
  //   • retirer le dernier accès complet est refusé par le serveur (409). Le
  //     message est rendu près du formulaire, en clair : une console
  //     d'administration sans personne pour l'ouvrir est une panne.
  //
  // Le catalogue des permissions vient du SERVEUR (GET /permissions). La console
  // n'en déclare aucune : une clé qu'elle inventerait serait refusée à
  // l'écriture, et une clé qu'elle oublierait deviendrait invisible.
  // ---------------------------------------------------------------------------
  var accesBody = null;
  var accesEtat = { catalogue: [], groupes: [], utilisateurs: [], edition: null };

  function canWriteUsers() { return can('users:write'); }
  function canWriteGroups() { return can('groups:write'); }

  async function renderAcces() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderAcces);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Console'));
    titleWrap.appendChild(el('h1', 'page-title', 'Accès'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Qui peut quoi. Une permission est une capacité, un groupe en réunit, une personne reçoit des groupes et des permissions directes.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    accesBody = el('div');
    content.appendChild(accesBody);
    mountAuthed('acces', content);
    focusTitle();
    await loadAccesInto(accesBody);
  }

  async function loadAccesInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var perms = await call('GET', '/permissions');
    if (perms.status === 401) return;
    var groupes = await call('GET', '/groups');
    var users = await call('GET', '/users');
    clear(container);
    if (!perms.ok || !perms.json) {
      container.appendChild(buildErrorBanner(function () { loadAccesInto(container); }));
      return;
    }
    accesEtat.catalogue = perms.json.permissions || [];
    // Une porte fermée n'est pas une panne : un compte sans « groups:read » voit
    // la section, vide, et la raison — la console garde sa forme.
    accesEtat.groupes = (groupes.ok && groupes.json && groupes.json.groupes) || [];
    accesEtat.utilisateurs = (users.ok && users.json && users.json.utilisateurs) || [];

    var view = el('div', 'view-enter');
    if (!canWriteUsers() && !canWriteGroups()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(
        ' — attribuer des accès demande la permission « Attribuer groupes et permissions ».'));
      view.appendChild(note);
    }
    view.appendChild(buildGroupesCard());
    view.appendChild(buildUsersCard());
    container.appendChild(view);
  }

  // Le libellé lisible d'une clé de permission. Sans entrée au catalogue on
  // affiche la clé : mieux vaut une clé brute qu'une capacité silencieuse.
  function permLabel(cle) {
    for (var i = 0; i < accesEtat.catalogue.length; i++) {
      if (accesEtat.catalogue[i].cle === cle) return accesEtat.catalogue[i].libelle;
    }
    return cle;
  }

  function buildGroupesCard() {
    var card = el('section', 'chart-card acces-groupes');
    card.appendChild(el('div', 'chart-card-title', 'Groupes'));
    card.appendChild(el('p', 'tpl-note',
      'Un groupe réunit des permissions et s’attribue à des personnes. Le supprimer retire ses permissions à tous ses membres, immédiatement.'));

    if (!accesEtat.groupes.length) {
      card.appendChild(el('p', 'tpl-note', 'Aucun groupe pour le moment.'));
    }
    accesEtat.groupes.forEach(function (g) {
      var row = el('div', 'acces-groupe');
      var h = el('div', 'acces-groupe-h');
      h.appendChild(el('strong', null, g.nom));
      h.appendChild(el('span', 'ptable-sub', ' · ' + g.id));
      row.appendChild(h);
      if (g.description) row.appendChild(el('p', 'ptable-sub', g.description));
      var ul = el('ul', 'acces-perm-list');
      (g.permissions || []).forEach(function (p) { ul.appendChild(el('li', null, permLabel(p))); });
      if (!(g.permissions || []).length) ul.appendChild(el('li', 'ptable-sub', 'Aucune permission'));
      row.appendChild(ul);
      if (canWriteGroups()) {
        var del = el('button', 'btn btn-sm acces-groupe-del', 'Supprimer');
        del.type = 'button';
        del.addEventListener('click', function () { supprimerGroupe(g.id); });
        row.appendChild(del);
      }
      card.appendChild(row);
    });

    if (canWriteGroups()) card.appendChild(buildGroupeForm());
    return card;
  }

  function buildGroupeForm() {
    var form = el('form', 'acces-groupe-form');
    form.appendChild(el('div', 'chart-card-sub', 'Nouveau groupe'));

    var idRow = el('div', 'field');
    idRow.appendChild(el('label', null, 'Identifiant'));
    var id = el('input', 'input');
    id.name = 'id'; id.type = 'text'; id.placeholder = 'soutien';
    idRow.appendChild(id);
    form.appendChild(idRow);

    var nomRow = el('div', 'field');
    nomRow.appendChild(el('label', null, 'Nom'));
    var nom = el('input', 'input');
    nom.name = 'nom'; nom.type = 'text'; nom.placeholder = 'Soutien';
    nomRow.appendChild(nom);
    form.appendChild(nomRow);

    var permsBox = el('fieldset', 'acces-perms');
    permsBox.appendChild(el('legend', null, 'Permissions'));
    accesEtat.catalogue.forEach(function (p) {
      // Le joker ne figure JAMAIS au catalogue offert sur un groupe.
      if (p.cle === '*') return;
      var line = el('label', 'check-line');
      var cb = el('input');
      cb.type = 'checkbox'; cb.value = p.cle;
      line.appendChild(cb);
      line.appendChild(document.createTextNode(' ' + p.libelle));
      permsBox.appendChild(line);
    });
    form.appendChild(permsBox);

    var err = el('ul', 'acces-erreur');
    err.hidden = true;
    form.appendChild(err);

    var submit = el('button', 'btn btn-primary', 'Créer le groupe');
    submit.type = 'submit';
    form.appendChild(submit);

    form.addEventListener('submit', async function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      clear(err); err.hidden = true;
      var permissions = [];
      permsBox.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        if (cb.checked) permissions.push(cb.value);
      });
      var r = await call('PUT', '/groups/' + encodeURIComponent(id.value.trim()), {
        nom: nom.value.trim(),
        permissions: permissions,
      });
      if (!r.ok) { montrerErreurs(err, r); return; }
      toast('Groupe enregistré.');
      await loadAccesInto(accesBody);
    });
    return form;
  }

  async function supprimerGroupe(id) {
    var r = await call('DELETE', '/groups/' + encodeURIComponent(id));
    if (!r.ok) { toast('Suppression impossible.'); return; }
    toast('Groupe supprimé.');
    await loadAccesInto(accesBody);
  }

  function buildUsersCard() {
    var card = el('section', 'chart-card acces-users');
    card.appendChild(el('div', 'chart-card-title', 'Utilisateurs'));
    card.appendChild(el('p', 'tpl-note',
      'Les comptes viennent de la liste blanche du déploiement — elle reste la porte extérieure. Ce qui se règle ici, c’est ce que chacun peut.'));

    accesEtat.utilisateurs.forEach(function (u) {
      var row = el('div', 'acces-user');
      row.dataset.email = u.email;
      var h = el('div', 'acces-user-h');
      var mail = el('strong', null, u.email);
      mail.setAttribute('data-i18n-skip', '');
      h.appendChild(mail);
      if (u.disabled) h.appendChild(el('span', 'nstatut is-suspendu', ' Désactivé'));
      row.appendChild(h);

      var resume = el('p', 'ptable-sub');
      if ((u.effectives || []).indexOf('*') >= 0) {
        resume.appendChild(document.createTextNode('Accès complet'));
      } else if (!(u.effectives || []).length) {
        resume.appendChild(document.createTextNode('Aucun accès'));
      } else {
        resume.appendChild(document.createTextNode(u.effectives.map(permLabel).join(' · ')));
      }
      row.appendChild(resume);

      if ((u.groupes || []).length) {
        var gl = el('p', 'ptable-sub');
        gl.appendChild(document.createTextNode('Groupes : ' + u.groupes.map(nomGroupe).join(', ')));
        row.appendChild(gl);
      }

      if (canWriteUsers()) {
        var edit = el('button', 'btn btn-sm acces-user-edit', 'Modifier');
        edit.type = 'button';
        edit.addEventListener('click', function () {
          accesEtat.edition = u.email;
          var existant = row.querySelector('.acces-user-form');
          if (existant) { existant.remove(); return; }
          row.appendChild(buildUserForm(u));
        });
        row.appendChild(edit);
      }
      card.appendChild(row);
    });
    return card;
  }

  function nomGroupe(id) {
    for (var i = 0; i < accesEtat.groupes.length; i++) {
      if (accesEtat.groupes[i].id === id) return accesEtat.groupes[i].nom;
    }
    return id;
  }

  function buildUserForm(u) {
    var form = el('form', 'acces-user-form');

    // L'accès complet se donne et se retire NOMMÉMENT, sur une personne.
    var jokerLine = el('label', 'check-line');
    var joker = el('input');
    joker.type = 'checkbox'; joker.name = 'complet';
    joker.checked = (u.permissions || []).indexOf('*') >= 0;
    jokerLine.appendChild(joker);
    jokerLine.appendChild(document.createTextNode(' Accès complet à la console'));
    form.appendChild(jokerLine);

    var gBox = el('fieldset', 'acces-user-groupes');
    gBox.appendChild(el('legend', null, 'Groupes'));
    accesEtat.groupes.forEach(function (g) {
      var line = el('label', 'check-line');
      var cb = el('input');
      cb.type = 'checkbox'; cb.value = g.id; cb.className = 'acces-user-groupe';
      cb.checked = (u.groupes || []).indexOf(g.id) >= 0;
      line.appendChild(cb);
      line.appendChild(document.createTextNode(' ' + g.nom));
      gBox.appendChild(line);
    });
    if (!accesEtat.groupes.length) gBox.appendChild(el('p', 'ptable-sub', 'Aucun groupe à attribuer.'));
    form.appendChild(gBox);

    var pBox = el('fieldset', 'acces-user-perms');
    pBox.appendChild(el('legend', null, 'Permissions directes'));
    accesEtat.catalogue.forEach(function (p) {
      var line = el('label', 'check-line');
      var cb = el('input');
      cb.type = 'checkbox'; cb.value = p.cle; cb.className = 'acces-user-perm';
      cb.checked = (u.permissions || []).indexOf(p.cle) >= 0;
      line.appendChild(cb);
      line.appendChild(document.createTextNode(' ' + p.libelle));
      pBox.appendChild(line);
    });
    form.appendChild(pBox);

    var err = el('ul', 'acces-erreur');
    err.hidden = true;
    form.appendChild(err);

    var save = el('button', 'btn btn-primary', 'Enregistrer');
    save.type = 'submit';
    form.appendChild(save);

    form.addEventListener('submit', async function (ev) {
      if (ev.preventDefault) ev.preventDefault();
      clear(err); err.hidden = true;
      var permissions = [];
      if (joker.checked) permissions.push('*');
      pBox.querySelectorAll('.acces-user-perm').forEach(function (cb) { if (cb.checked) permissions.push(cb.value); });
      var groupes = [];
      gBox.querySelectorAll('.acces-user-groupe').forEach(function (cb) { if (cb.checked) groupes.push(cb.value); });

      var r = await call('PUT', '/users/' + encodeURIComponent(u.email), { groupes: groupes, permissions: permissions });
      if (!r.ok) { montrerErreurs(err, r); return; }
      toast('Accès enregistrés.');
      await loadAccesInto(accesBody);
    });
    return form;
  }

  // Les messages du serveur, rendus près du formulaire. Un 409
  // « dernier_administrateur » n'est pas une panne : c'est une décision du
  // serveur qui doit se lire, sinon l'opérateur croit à un bogue.
  function montrerErreurs(box, r) {
    clear(box);
    var errs = (r.json && r.json.errors) || [{ message: 'Enregistrement impossible.' }];
    errs.forEach(function (e) { box.appendChild(el('li', null, e.message)); });
    box.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Prix — le prix du service de Nota (ADR 0031), devenu une GRILLE (ADR 0034).
  // GET /prix renvoie { defaut, override, effectif, catalogue } ; PUT enregistre
  // une grille ; DELETE rend la facturation au défaut du déploiement. Écrire
  // exige la permission 'settings:write' (super_admin) — l'analyste lit la
  // grille en vigueur sans formulaire (l'API le réimpose côté serveur).
  //
  // Cet écran remplace celui du barème de commission. Nota ne prélève plus une
  // part des honoraires : il n'y a donc plus deux moitiés à montrer, plus de
  // cote. Ce qui s'édite ici ne dépend que de DEUX dimensions publiées — le
  // service et le délai — et de rien qui touche au notaire : l'art. 29.1 du
  // Code de déontologie interdit au notaire toute convention mettant en péril
  // son indépendance et son désintéressement, et un prix qui bougerait selon la
  // cote que Nota lui attribue en serait une.
  //
  // La garantie de date a SA propre ligne, et ce n'est pas un détail
  // d'affichage : c'est ce que NOTA vend pour tenir une date. L'art. 49 4° du
  // même Code laisse au NOTAIRE le droit de tenir compte d'une « célérité
  // exceptionnelle » dans SES honoraires — deux objets, deux lignes, jamais un
  // seul nombre faisant les deux travaux.
  //
  // Les lignes à éditer viennent du `catalogue` servi par l'API : la console
  // n'a pas le domaine, et un service ajouté demain doit apparaître ici sans
  // qu'on touche à ce fichier.
  //
  // Les prix voyagent en CENTS (24900 = 249 $) ; le formulaire parle en dollars
  // et convertit à l'enregistrement. Le serveur reste l'autorité (le 422
  // s'affiche dans la région d'erreur en ligne), mais l'écran refuse d'expédier
  // une évidence : validatePrixForm() rejoue la règle de prix-nota-config.js
  // avant le premier octet réseau.
  // ---------------------------------------------------------------------------
  var prixBody = null;
  var MAX_PALIERS = 10;

  // La porte des données personnelles : le bottin des notaires et le journal
  // d'audit. 'pii:read' n'est donné qu'à l'administrateur principal.
  // Le MÊME test que le serveur : un compte qui porte le joker « * » peut tout,
  // et la console doit le refléter — sans quoi elle cacherait des commandes que
  // l'API accepterait, ce qui est la pire forme de désaccord entre les deux.
  function can(permission) {
    var list = (me && me.permissions) || [];
    return list.indexOf('*') >= 0 || list.indexOf(permission) >= 0;
  }
  function canReadPii() {
    return can('pii:read');
  }

  function canWriteSettings() {
    return can('settings:write');
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

  // Dollars saisis (« 400 », « 400,50 ») → un entier de cents, ou NaN. Le prix
  // se stocke en cents parce qu'un montant d'argent ne se garde jamais en
  // flottant ; l'écran, lui, parle la langue de l'opérateur.
  function dollarsToCents(v) {
    var s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.');
    if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 100);
  }
  // 40000 cents → « 400 » / « 400,50 », pour amorcer le champ.
  function centsToDollarsInput(cents) {
    var n = Math.round(Number(cents) || 0);
    var rem = n % 100;
    return String(Math.floor(n / 100)) + (rem ? (',' + String(rem).padStart(2, '0')) : '');
  }

  async function renderPrix() {
    if (!me || !me.email) {
      var loaded = await loadMe();
      if (!loaded.ok) {
        if (loaded.status !== 401) renderFatal('Impossible de charger votre profil.', renderPrix);
        return;
      }
    }
    renderUserbar();

    var content = el('div', 'admin-content');
    var head = el('div', 'page-head view-enter');
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', 'page-eyebrow', 'Facturation'));
    titleWrap.appendChild(el('h1', 'page-title', 'Prix'));
    titleWrap.appendChild(el('p', 'page-sub',
      'Le prix du service de Nota — une grille par service, la même pour tous les notaires.'));
    head.appendChild(titleWrap);
    content.appendChild(head);

    prixBody = el('div');
    content.appendChild(prixBody);

    mountAuthed('prix', content);
    focusTitle();
    await loadPrixInto(prixBody);
  }

  async function loadPrixInto(container) {
    clear(container);
    var skel = el('div', 'stat-grid');
    for (var i = 0; i < 3; i++) skel.appendChild(el('div', 'skeleton skeleton-tile'));
    container.appendChild(skel);

    var r = await call('GET', '/prix');
    if (r.status === 401) return; // handled by call()
    clear(container);
    // Le catalogue est aussi essentiel que la grille : sans lui l'écran n'a
    // aucune ligne à éditer, et un formulaire vide expédierait une grille vide.
    // Mieux vaut la bannière de reprise qu'un écran qui a l'air de fonctionner.
    if (!r.ok || !r.json || !r.json.effectif || !r.json.catalogue) {
      container.appendChild(buildErrorBanner(function () { loadPrixInto(container); }));
      return;
    }

    var view = el('div', 'view-enter');
    if (!canWriteSettings()) {
      var note = el('div', 'tpl-readonly-note');
      note.appendChild(el('strong', null, 'Lecture seule'));
      note.appendChild(document.createTextNode(' — la modification du prix est réservée à l’administrateur principal.'));
      view.appendChild(note);
    }
    view.appendChild(buildPrixView(r.json));
    if (canWriteSettings()) view.appendChild(buildPrixForm(r.json, container));
    container.appendChild(view);
  }

  // Le nom d'une ligne du catalogue, dans la langue de l'opérateur. Les noms
  // viennent de l'API : sans leur `nomEn`, la console anglaise étiquetterait
  // ses champs en français.
  function ligneNom(l) {
    return (isEnglish() && l.nomEn) ? l.nomEn : l.nom;
  }

  // Les cellules à montrer et à éditer, dans l'ordre du catalogue servi par
  // l'API. `min` est le plancher de chaque groupe : un service se vend, donc
  // au-dessus de zéro ; la garantie de date accepte zéro, parce que renoncer à
  // la facturer n'est pas donner un service — c'est ne pas en vendre un.
  function prixLignes(data) {
    var cat = data.catalogue || { services: [], garantieDate: [] };
    var out = [];
    (cat.services || []).forEach(function (s) {
      out.push({ id: s.id, nom: ligneNom(s), groupe: 'services', min: 1 });
    });
    (cat.garantieDate || []).forEach(function (t) {
      out.push({ id: t.id, nom: ligneNom(t), groupe: 'garantieDate', min: 0 });
    });
    return out;
  }

  function prixCellule(grille, ligne) {
    return ((grille && grille[ligne.groupe]) || {})[ligne.id];
  }

  var PRIX_GROUPES = [
    { cle: 'services', titre: 'Prix par service' },
    { cle: 'garantieDate', titre: 'Garantie de date Nota' },
  ];

  // La grille entière, cellule par cellule, le défaut à côté : c'est ce à quoi
  // une remise à zéro revient, et l'opérateur doit le voir avant de la demander.
  function buildPrixTable(data, lignes, groupe) {
    var table = el('table', 'prix-grille');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, 'Ligne'));
    hr.appendChild(el('th', null, 'Prix en vigueur'));
    hr.appendChild(el('th', null, 'Défaut du déploiement'));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    lignes.filter(function (l) { return l.groupe === groupe; }).forEach(function (l) {
      var tr = el('tr');
      var th = el('th', null, l.nom);
      th.setAttribute('data-i18n-skip', ''); // nom du catalogue : contenu d'API
      tr.appendChild(th);
      tr.appendChild(el('td', null, moneyCents(prixCellule(data.effectif, l))));
      tr.appendChild(el('td', null, moneyCents(prixCellule(data.defaut, l))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // --- Read view: what billing prices with right now -------------------------
  function buildPrixView(data) {
    var lignes = prixLignes(data);
    var wrap = el('div');

    // Une tuile par SERVICE : c'est la ligne que le client lira sur son devis.
    var grid = el('div', 'stat-grid');
    lignes.filter(function (l) { return l.groupe === 'services'; }).forEach(function (l) {
      var t = tile(l.nom, moneyCents(prixCellule(data.effectif, l)),
        'ajouté à chaque offre, encaissé à la signature', false);
      t.querySelector('.stat-k').setAttribute('data-i18n-skip', '');
      grid.appendChild(t);
    });
    wrap.appendChild(grid);

    var card = el('div', 'chart-card tpl-group bareme-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Prix en vigueur'));
    // Dire sans bruit LEQUEL des deux gouverne : le prix enregistré (avec sa
    // date) ou le défaut du déploiement.
    var src = data.override
      ? 'Prix décidé par Nota — modifié le ' + baremeDate(data.override.updatedAt) + '.'
      : 'Valeur par défaut du déploiement — aucun prix enregistré.';
    ht.appendChild(el('div', 'chart-card-sub', src));
    head.appendChild(ht);
    card.appendChild(head);

    PRIX_GROUPES.forEach(function (g) {
      card.appendChild(el('div', 'prix-groupe-titre', g.titre));
      card.appendChild(buildPrixTable(data, lignes, g.cle));
    });

    // Ce que l'opérateur doit avoir sous les yeux avant de changer ces nombres.
    var foot = el('p', 'tpl-note');
    foot.appendChild(document.createTextNode(
      'Le client autorise sa carte pour le montant offert au notaire PLUS ce prix. '
      + 'Le notaire reçoit ses honoraires en entier ; ce prix ne dépend ni de lui, '
      + 'ni de sa cote, ni de la valeur de l’acte.'));
    card.appendChild(foot);
    // La distinction qu'un opérateur pressé effacerait sans le vouloir.
    var foot2 = el('p', 'tpl-note');
    foot2.appendChild(document.createTextNode(
      'La garantie de date est ce que NOTA vend pour tenir une date rapprochée. '
      + 'Elle ne se confond pas avec le droit du notaire de tenir compte de '
      + 'l’urgence dans SES honoraires (art. 49 4° du Code de déontologie) : '
      + 'deux objets, deux lignes sur le devis du client.'));
    card.appendChild(foot2);
    wrap.appendChild(card);
    return wrap;
  }

  // --- Edit form (super_admin only) ------------------------------------------
  function buildPrixForm(data, container) {
    var lignes = prixLignes(data);
    var card = el('div', 'chart-card');
    var head = el('div', 'chart-card-head');
    var ht = el('div');
    ht.appendChild(el('div', 'chart-card-title', 'Modifier la grille'));
    ht.appendChild(el('div', 'chart-card-sub', 'Les montants sont saisis en dollars — « 249 » signifie 249,00 $.'));
    head.appendChild(ht);
    card.appendChild(head);

    var form = el('form', 'bareme-form');
    form.noValidate = true;

    // Une cellule par ligne du catalogue, repérée par son identifiant : le
    // catalogue peut grandir sans que rien ici ne bouge.
    var inputs = {};
    PRIX_GROUPES.forEach(function (g) {
      var duGroupe = lignes.filter(function (l) { return l.groupe === g.cle; });
      if (!duGroupe.length) return;
      form.appendChild(el('div', 'prix-groupe-titre', g.titre));
      var champs = el('div', 'tpl-fields');
      duGroupe.forEach(function (l) {
        var field = el('div', 'field');
        var lab = el('label', null, l.nom + ' ($)');
        lab.setAttribute('data-i18n-skip', ''); // nom du catalogue : contenu d'API
        field.appendChild(lab);
        var input = el('input', 'input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.setAttribute('data-i18n-skip', '');
        input.setAttribute('data-prix-cell', l.id);
        input.value = centsToDollarsInput(prixCellule(data.effectif, l));
        field.appendChild(input);
        champs.appendChild(field);
        inputs[l.id] = input;
      });
      form.appendChild(champs);
    });

    var error = el('div', 'tpl-error');
    error.hidden = true;
    form.appendChild(error);

    var actions = el('div', 'tpl-actions');
    var save = el('button', 'btn btn-sm btn-primary', 'Enregistrer la grille');
    save.type = 'submit';
    actions.appendChild(save);
    form.appendChild(actions);
    card.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // La grille part ENTIÈRE : le PUT remplace, il ne fusionne pas. Envoyer
      // les seules cellules touchées laisserait les autres à la merci du
      // défaut, et l'opérateur croirait avoir gardé ce qu'il voyait.
      var body = { services: {}, garantieDate: {} };
      lignes.forEach(function (l) { body[l.groupe][l.id] = dollarsToCents(inputs[l.id].value); });
      // Le serveur reste l'autorité, mais une évidence ne part pas sur le fil.
      var errs = validatePrixForm(body, lignes);
      if (errs.length) { showErrorLines(error, errs); return; }
      submitPrix('PUT', body, [save], error, container, 'Prix enregistré.');
    });

    // La réinitialisation n'est offerte que lorsqu'un prix est réellement
    // enregistré (même idiome que Courriels), derrière une confirmation.
    if (data.override) card.appendChild(buildPrixReset(error, container));
    return card;
  }

  function buildPrixReset(error, container) {
    var wrap = el('div', 'bareme-reset');
    var open = el('button', 'btn btn-sm', 'Revenir à la valeur par défaut');
    open.type = 'button';
    wrap.appendChild(open);

    var confirmBox = el('div', 'bareme-confirm');
    confirmBox.hidden = true;
    confirmBox.appendChild(el('p', 'bareme-confirm-text',
      'Le prix enregistré sera supprimé — la valeur par défaut reprendra effet dès la prochaine offre.'));
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
      submitPrix('DELETE', null, [yes, no], error, container, 'Prix réinitialisé.');
    });
    return wrap;
  }

  // La même règle, les mêmes mots que prix-nota-config.js (validatePrix) —
  // l'écran ne doit jamais refuser autre chose que ce que le serveur refuse,
  // ni le formuler autrement. Un 422 reste possible : c'est lui qui tranche.
  function validatePrixForm(body, lignes) {
    var mauvais = (lignes || []).some(function (l) {
      var c = (body[l.groupe] || {})[l.id];
      return !isFinite(c) || Math.floor(c) !== c || c < l.min;
    });
    if (mauvais) {
      return [{
        code: 'prix_invalide',
        message: 'Chaque cellule de la grille doit être un nombre entier de cents (ex. 24900 pour 249,00 $) — strictement positif pour un service, zéro accepté pour la garantie de date.',
      }];
    }
    return [];
  }

  // Les codes de refus de l'API, dits en clair — et TRADUISIBLES. Le message
  // du serveur est excellent, mais il n'existe qu'en français : le rendre seul
  // laisserait la console anglaise parler français au pire moment. La phrase
  // claire passe donc par le dictionnaire, et le mot du serveur reste dessous
  // pour le détail qu'une phrase générique ne peut pas deviner (quel jeton,
  // quelle borne). Un code sans entrée retombe sur le message du serveur.
  var ERREUR_CLAIRE = {
    jeton_inconnu: 'Jeton inconnu — ce modèle n’accepte que les jetons listés sous le formulaire.',
    html_interdit: 'HTML refusé — écrivez du texte : la mise en forme vient du gabarit.',
    partage_interdit: 'Partage d’honoraires — Nota ne prélève aucune part des honoraires du notaire, et un courriel ne peut pas l’affirmer (art. 32 du Code de déontologie).',
    desactivation_interdite: 'Courriel transactionnel — il annonce un fait que son destinataire doit connaître : l’envoi ne peut pas être coupé (art. 68 du Code de déontologie).',
    champ_inconnu: 'Champ inconnu — la console a envoyé un champ que le serveur ne connaît pas. Rechargez la page.',
    champ_invalide: 'Valeur invalide.',
    modele_inconnu: 'Modèle inconnu — la liste a peut-être changé. Rechargez la page.',
    sujet_trop_long: 'Sujet trop long.',
    preheader_trop_long: 'Ligne d’aperçu trop longue.',
    corps_trop_long: 'Corps trop long.',
    cta_trop_long: 'Libellé de bouton trop long.',
    sujet_bilingue: 'Sujet : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.',
    preheader_bilingue: 'Ligne d’aperçu : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.',
    corps_bilingue: 'Corps : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.',
    cta_bilingue: 'Bouton : les deux langues vont ensemble — remplissez le français ET l’anglais, ou aucun des deux.',
    confirmation_requise: 'Confirmation requise — l’audience dépasse le plafond. Confirmez pour envoyer quand même.',
    audience_invalide: 'Cible invalide — choisissez une personne, un groupe ou un segment.',
    segment_inconnu: 'Segment inconnu — la liste a peut-être changé. Rechargez la page.',
    parametre_inconnu: 'Paramètre inconnu pour ce segment.',
    parametre_hors_bornes: 'Paramètre hors des bornes permises.',
    cible_sans_adresse: 'Cible incomplète — écrivez l’adresse courriel de la personne visée.',
    cible_sans_groupe: 'Cible incomplète — choisissez le groupe visé.',
    cible_sans_segment: 'Cible incomplète — choisissez le segment visé.',
    gabarit_manquant: 'Aucun gabarit choisi — désignez le courriel à envoyer.',
  };

  // La région d'erreur en ligne, partagée par le refus local, le 422 du prix
  // et celui du journal d'audit : un message par ligne, jamais un JSON brut.
  function showErrorLines(error, errs) {
    error.hidden = false;
    clear(error);
    errs.forEach(function (er) {
      var line = el('div', 'tpl-error-line');
      var clair = er && ERREUR_CLAIRE[er.code];
      line.appendChild(el('strong', null, clair || er.message || er.code || 'Erreur.'));
      if (clair && er.message) {
        var detail = el('div', 'tpl-error-detail', er.message);
        detail.setAttribute('data-i18n-skip', ''); // texte du serveur, pas du dictionnaire
        line.appendChild(detail);
      }
      error.appendChild(line);
    });
  }

  async function submitPrix(method, body, buttons, error, container, okMsg) {
    buttons.forEach(function (b) { b.disabled = true; });
    var r = await call(method, '/prix', body === null ? undefined : body);
    buttons.forEach(function (b) { b.disabled = false; });
    if (r.status === 401) return; // handled by call()
    if (!r.ok) {
      showErrorLines(error, (r.json && r.json.errors && r.json.errors.length)
        ? r.json.errors
        : [{ message: 'Impossible d’enregistrer le prix.' }]);
      return;
    }
    error.hidden = true; // un prix accepté ne laisse pas traîner l'ancien refus
    clear(error);
    toast(okMsg);
    await loadPrixInto(container);
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
    ['Étude', 'Statut', 'Cote', 'Actes', 'Note', 'Facturé par Nota', 'Dernière visite']
      .forEach(function (h, i) { hr.appendChild(el('th', i >= 2 ? 'is-num' : null, h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (n) { buildNotaireRow(n, tbody); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);

    // ADR 0031 — il n'y a plus de barème à rappeler : le notaire garde 100 %
    // de ses honoraires. La colonne « Facturé par Nota » est ce que le CLIENT
    // a payé pour le service de la plateforme, jamais une retenue.
    card.appendChild(el('p', 'tpl-note',
      'Le notaire garde la totalité de ses honoraires. La colonne « Facturé par Nota » est ce que le client a payé pour le service de la plateforme.'));
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
    annulation_frais: 'Frais d’annulation retenus',
    prix_nota_updated: 'Prix de Nota modifié',
    prix_nota_reset: 'Prix de Nota réinitialisé',
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
    if (e.action === 'acte_regle' && typeof m.honoraires === 'number' && typeof m.prixNota === 'number') {
      // LA divulgation, en DEUX lignes (ADR 0031) : les honoraires qui vont au
      // notaire en entier, et le prix du service de Nota à côté. Rien ici ne
      // divise ni ne retranche : présenter le prix de Nota comme une part des
      // honoraires décrirait l'opération que l'art. 32 du Code de déontologie
      // interdit au notaire — et ce serait une pièce écrite par Nota elle-même.
      row.appendChild(el('p', 'audit-money',
        moneyCents(m.honoraires * 100) + ' au notaire · ' +
        moneyCents(m.prixNota * 100) + ' à Nota'));
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
  // Un envoi ciblé : la trajectoire d'un message qui part.
  function iconSend() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M21.5 2.5 11 13' }));
    s.appendChild(svgEl('path', { d: 'M21.5 2.5 15 21l-4-8-8-4z' }));
    return s;
  }
  // Une étiquette de prix : ce que Nota vend, à son propre prix (ADR 0031).
  function iconTag() {
    var s = svgEl('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8z' }));
    s.appendChild(svgEl('circle', { cx: 7.5, cy: 7.5, r: 1.5 }));
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
