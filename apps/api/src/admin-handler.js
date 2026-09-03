'use strict';

/**
 * The admin HTTP application, transport-agnostic — the admin.nota.ca sibling of
 * handler.js. `createAdminApp(repo, opts)` returns `handle(request)` over the
 * normalized `{ method, path, query, headers, body }` shape. It serves ONLY
 * `/admin/*`; anything else is a 404, so this Lambda can never be coaxed into
 * acting as the public API even if it were ever mis-routed.
 *
 * It shares the repo port with the public handler but is wired in its OWN Lambda
 * (apps/api/admin.js) whose IAM role is read-only on the customer table (plus
 * one item-scoped write door: the CONFIG#EMAIL partition holding the email
 * template overrides, ADR 0018 §6) and read/write on the separate nota-admin
 * table — the admin surface can never mutate customer data.
 */
const domain = require('@nota/domain');
const rbac = require('./rbac');
const { createAdmin } = require('./admin');
const { createAnalytics } = require('./analytics');

const MAX_BODY_BYTES = 32 * 1024;

function createAdminApp(repo, opts = {}) {
  // Same business-day clock as the public handler: "today" is the Québec civil
  // day, not the UTC day of the Lambda host (see domain.businessDay).
  const TIME_ZONE = opts.timeZone || process.env.NOTA_TIMEZONE || domain.BUSINESS_TIMEZONE;
  const now = opts.now || (() => domain.businessDay(null, TIME_ZONE));
  const nowMs = opts.nowMs || (() => Date.now());
  const newId = opts.newId || (() => require('node:crypto').randomUUID());

  // The exact origin the admin SPA is served from; also the CORS allow-origin.
  const adminOrigin = opts.adminBaseUrl || process.env.NOTA_ADMIN_BASE_URL || '';

  // Le port d'envoi des campagnes. Son unique implémentation est
  // `notifications.js` — celle qui honore déjà la liste de suppression et pose
  // l'en-tête de retrait RFC 8058. La console n'écrit PAS un second chemin
  // d'envoi : si le notifieur n'expose pas encore la porte `sendCampaign`, la
  // route d'envoi répond 503 et le dit, plutôt que d'improviser.
  function campaignNotifier() {
    if (opts.notifier !== undefined) return opts.notifier;
    if (!opts.mailer) return null;
    try {
      const { createNotifier } = require('./notifications');
      const n = createNotifier({
        repo,
        mailer: opts.mailer,
        baseUrl: process.env.NOTA_BASE_URL || '',
        apiBaseUrl: process.env.NOTA_API_BASE_URL || undefined,
        now: () => new Date(nowMs()).toISOString(),
      });
      return typeof n.sendCampaign === 'function' ? n : null;
    } catch {
      return null;
    }
  }

  // Admin + analytics use-cases are injectable (tests pass fakes / fixed clocks).
  // In production they are built here from the environment.
  const admin =
    opts.admin ||
    createAdmin({
      repo,
      mailer: opts.mailer || null,
      notifier: campaignNotifier(),
      newId,
      now: () => new Date(nowMs()).toISOString(),
      nowMs,
      config: {
        allowlist: (process.env.NOTA_ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),
        baseUrl: adminOrigin,
        // The public site — where an activated notary is told to sign in.
        siteUrl: opts.siteUrl || process.env.NOTA_BASE_URL || process.env.NOTA_SITE_URL || '',
        devEcho: process.env.NODE_ENV !== 'production',
      },
    });
  const analytics = opts.analytics || createAnalytics({ repo, now });

  function header(headers, name) {
    if (!headers) return '';
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return headers[k];
    return '';
  }
  function bearer(request) {
    const m = /^Bearer\s+(.+)$/i.exec(String(header(request.headers, 'authorization') || '').trim());
    return m ? m[1].trim() : '';
  }
  // The caller IP for rate-limiting + audit. MUST be a trusted value: prefer the
  // API Gateway-supplied sourceIp (unspoofable), else the RIGHTMOST X-Forwarded-For
  // hop (the one the trusted proxy appended). NEVER the leftmost token — that is
  // client-controlled and would let an attacker mint a fresh rate-limit key per
  // request and forge audit source IPs.
  function clientIp(request) {
    if (request.sourceIp) return String(request.sourceIp);
    const parts = String(header(request.headers, 'x-forwarded-for') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  // Headers on EVERY response: CORS locked to the admin origin, plus a hard
  // noindex. The CDN's response-headers policy also sets X-Robots-Tag, but the
  // API Gateway execute-api URL is reachable directly (no CloudFront, no WAF),
  // so the origin must refuse indexing on its own.
  function baseHeaders() {
    return {
      'access-control-allow-origin': adminOrigin || 'null',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'vary': 'origin',
      'x-robots-tag': 'noindex, nofollow',
    };
  }
  function json(statusCode, obj) {
    return {
      statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8', ...baseHeaders(), 'cache-control': 'no-store' },
      body: JSON.stringify(obj),
    };
  }
  function parseBody(request) {
    if (typeof request.body !== 'string') return request.body || {};
    return JSON.parse(request.body || '{}');
  }

  async function handle(request) {
    const method = (request.method || 'GET').toUpperCase();
    const route = (request.path || '/').replace(/^\/api(?=\/|$)/, '') || '/';
    const query = request.query || {};

    if (method === 'OPTIONS') return { statusCode: 204, headers: baseHeaders(), body: '' };

    // Hard boundary: this Lambda answers nothing outside /admin/*.
    if (!/^\/admin(\/|$)/.test(route)) {
      return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
    }

    if (typeof request.body === 'string' && Buffer.byteLength(request.body) > MAX_BODY_BYTES) {
      return json(413, { errors: [{ code: 'corps_trop_grand', message: 'Corps de requête trop volumineux.' }] });
    }

    // --- Auth (unauthenticated entry points) --------------------------------
    if (route === '/admin/auth/request' && method === 'POST') {
      let payload;
      try {
        payload = parseBody(request);
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const result = await admin.requestLogin({ email: payload.email, ip: clientIp(request) });
      if (result.throttled) {
        return json(429, { errors: [{ code: 'trop_de_demandes', message: 'Trop de demandes. Réessayez plus tard.' }] });
      }
      const body = { ok: true };
      if (result.devLink) body.devLink = result.devLink;
      return json(200, body);
    }

    if (route === '/admin/auth/verify' && method === 'POST') {
      let payload;
      try {
        payload = parseBody(request);
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const result = await admin.verifyMagic({ token: payload.token, ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: result.errors });
      return json(200, { ok: true, session: result.session, role: result.role, expiresAt: result.expiresAt });
    }

    // --- Session-gated -------------------------------------------------------
    if (route === '/admin/auth/refresh' && method === 'POST') {
      const result = await admin.refresh(bearer(request), { ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      return json(200, { ok: true, session: result.session, expiresAt: result.expiresAt });
    }

    if (route === '/admin/auth/logout' && method === 'POST') {
      await admin.logout(bearer(request), { ip: clientIp(request) });
      return json(200, { ok: true });
    }

    if (route === '/admin/me' && method === 'GET') {
      const info = await admin.me(bearer(request));
      if (!info) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      return json(200, info);
    }

    if (route === '/admin/metrics/overview' && method === 'GET') {
      const principal = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!principal) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      const data = await analytics.overview({ from: query.from, to: query.to });
      return json(200, data);
    }

    // --- Email templates (ADR 0018 §3) ---------------------------------------
    // GET is open to any authenticated admin (analysts see the state read-only);
    // PUT/DELETE require 'notifications:write' — enforced in admin.js, which
    // also audit-logs every change with its before/after.
    if (route === '/admin/notifications/templates' && method === 'GET') {
      const result = await admin.listEmailTemplates(bearer(request), { ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      // `limites` voyage avec le registre : la console pose ses `maxlength`
      // depuis le serveur plutôt que de recopier des bornes qui dériveraient.
      return json(200, { templates: result.templates, limites: result.limites });
    }

    // contract: /admin/notifications/templates/{key}
    const tplMatch = /^\/admin\/notifications\/templates\/([^/]+)$/.exec(route);
    if (tplMatch && (method === 'PUT' || method === 'DELETE')) {
      const key = decodeURIComponent(tplMatch[1]);
      let result;
      if (method === 'PUT') {
        let payload;
        try {
          payload = parseBody(request);
        } catch {
          return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
        }
        result = await admin.putEmailTemplate(bearer(request), key, payload, { ip: clientIp(request) });
      } else {
        result = await admin.resetEmailTemplate(bearer(request), key, { ip: clientIp(request) });
      }
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, method === 'PUT' ? { ok: true, override: result.override } : { ok: true, key: result.key });
    }

    // --- Le registre des notaires (2026-09-01) -------------------------------
    // Nominatif et financier : 'pii:read' (super_admin), enforced in admin.js.
    // C'est la contrepartie opérateur de la divulgation faite au notaire —
    // qui est là, quelle cote, quel taux, ce que Nota a encaissé.
    if (route === '/admin/notaries' && method === 'GET') {
      const result = await admin.listNotaries(bearer(request), { ip: clientIp(request) });
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, { notaires: result.notaires, bareme: result.bareme });
    }

    // --- Activer un notaire (2026-09-02) -------------------------------------
    // L'opérateur a vérifié le Tableau de l'Ordre : ce POST ouvre la console
    // (`approuveLe`). 'moderation:write', journalisé, idempotent — tout est
    // appliqué dans admin.js.
    // contract: /admin/notaries/{id}/activer
    const activerMatch = /^\/admin\/notaries\/([^/]+)\/activer$/.exec(route);
    if (activerMatch && method === 'POST') {
      const result = await admin.activateNotary(bearer(request), decodeURIComponent(activerMatch[1]), { ip: clientIp(request) });
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, { ok: true, deja: !!result.deja, notaire: result.notaire });
    }

    // --- Le journal d'audit, relu par jour -----------------------------------
    // Une piste que personne ne peut relire n'est pas une piste d'audit.
    // 'pii:read' également : les entrées portent des courriels et des montants.
    if (route === '/admin/audit' && method === 'GET') {
      const result = await admin.readAudit(bearer(request), query.jour, { ip: clientIp(request) });
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, { jour: result.jour, entrees: result.entrees });
    }

    // --- Le prix de Nota (ADR 0031 / 0034) -----------------------------------
    // Remplace la porte du barème de commission : Nota vend son service à son
    // propre prix — depuis l'ADR 0034 une grille par service, plus la garantie
    // de date — et non plus une part des honoraires du notaire. Lecture ouverte
    // à tout admin authentifié ; PUT/DELETE exigent 'settings:write' — appliqué
    // dans admin.js, qui journalise chaque changement avec son avant/après.
    if (route === '/admin/prix' && method === 'GET') {
      const result = await admin.getPrixNota(bearer(request), { ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      // `catalogue` : les lignes à éditer, avec leurs noms. La console admin
      // n'a pas le domaine — sans cet écho elle coderait le catalogue en dur.
      return json(200, {
        defaut: result.defaut, override: result.override,
        effectif: result.effectif, catalogue: result.catalogue,
      });
    }

    if (route === '/admin/prix' && (method === 'PUT' || method === 'DELETE')) {
      let result;
      if (method === 'PUT') {
        let payload;
        try {
          payload = parseBody(request);
        } catch {
          return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
        }
        result = await admin.putPrixNota(bearer(request), payload, { ip: clientIp(request) });
      } else {
        result = await admin.resetPrixNota(bearer(request), { ip: clientIp(request) });
      }
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, method === 'PUT' ? { ok: true, override: result.override } : { ok: true });
    }

    // --- RBAC : catalogue, groupes, accès ------------------------------------
    // Trois concepts découplés. La permission de LIRE est distincte de celle
    // d'ÉCRIRE, pour qu'on puisse ouvrir la consultation d'un annuaire sans
    // ouvrir le droit d'y toucher. Chaque écriture est journalisée avec son
    // état avant et après : accorder une capacité est une décision, pas un
    // réglage.
    if (route === '/admin/permissions' && method === 'GET') {
      const p = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!p) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      return json(200, admin.listPermissions());
    }

    if (route === '/admin/groups' && method === 'GET') {
      const p = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!p) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      if (!rbac.can(p.permissions, 'groups:read')) return json(403, { errors: [{ code: 'interdit', message: 'Lecture des groupes non autorisée.' }] });
      return json(200, await admin.listGroups());
    }

    // contract: /admin/groups/{id}
    const groupMatch = route.match(/^\/admin\/groups\/([^/]+)$/);
    if (groupMatch && (method === 'PUT' || method === 'DELETE')) {
      const p = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!p) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      if (!rbac.can(p.permissions, 'groups:write')) return json(403, { errors: [{ code: 'interdit', message: 'Modification des groupes non autorisée.' }] });
      const id = decodeURIComponent(groupMatch[1]);
      let result;
      if (method === 'PUT') {
        let payload;
        try {
          payload = parseBody(request);
        } catch {
          return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
        }
        result = await admin.putGroup(id, payload, { actor: p.email });
      } else {
        result = await admin.deleteGroup(id, { actor: p.email });
      }
      if (!result.ok) return json(result.errors.some((e) => e.code === 'groupe_introuvable') ? 404 : 422, { errors: result.errors });
      return json(200, method === 'PUT' ? { ok: true, groupe: result.groupe } : { ok: true });
    }

    if (route === '/admin/users' && method === 'GET') {
      const p = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!p) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      if (!rbac.can(p.permissions, 'users:read')) return json(403, { errors: [{ code: 'interdit', message: 'Lecture des utilisateurs non autorisée.' }] });
      return json(200, await admin.listUsers());
    }

    // contract: /admin/users/{email}
    const userMatch = route.match(/^\/admin\/users\/([^/]+)$/);
    if (userMatch && method === 'PUT') {
      const p = await admin.requireAdmin(bearer(request), { ip: clientIp(request) });
      if (!p) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      if (!rbac.can(p.permissions, 'users:write')) return json(403, { errors: [{ code: 'interdit', message: 'Attribution des accès non autorisée.' }] });
      let payload;
      try {
        payload = parseBody(request);
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const result = await admin.putUserAccess(decodeURIComponent(userMatch[1]), payload, { actor: p.email });
      if (!result.ok) {
        // 409 : la demande est bien formée, mais l'état du système la refuse —
        // retirer le dernier administrateur laisserait la console sans issue.
        if (result.code === 'dernier_administrateur') return json(409, { errors: result.errors });
        return json(result.errors.some((e) => e.code === 'utilisateur_inconnu') ? 404 : 422, { errors: result.errors });
      }
      return json(200, { ok: true, utilisateur: result.utilisateur });
    }

    // --- Cancellation-fee barème (ADR 0023 §2) -------------------------------
    // GET open to any authenticated admin; PUT/DELETE require 'settings:write'
    // — enforced in admin.js, which also audit-logs every change.
    if (route === '/admin/annulation' && method === 'GET') {
      const result = await admin.getCancellationSchedule(bearer(request), { ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      return json(200, { defaut: result.defaut, override: result.override, effectif: result.effectif });
    }

    if (route === '/admin/annulation' && (method === 'PUT' || method === 'DELETE')) {
      let result;
      if (method === 'PUT') {
        let payload;
        try {
          payload = parseBody(request);
        } catch {
          return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
        }
        result = await admin.putCancellationSchedule(bearer(request), payload, { ip: clientIp(request) });
      } else {
        result = await admin.resetCancellationSchedule(bearer(request), { ip: clientIp(request) });
      }
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, method === 'PUT' ? { ok: true, override: result.override } : { ok: true });
    }

    // --- Campagnes ciblées (segments.js) -------------------------------------
    // Trois portes, deux permissions. REGARDER une audience (le catalogue, la
    // prévisualisation) demande 'analytics:read' ; l'ENVOYER demande
    // 'campaigns:send' — une capacité à part entière, jamais un corollaire de
    // 'notifications:write'. Tout est appliqué dans admin.js par `rbac.can`,
    // pour que le joker « * » passe et que chaque envoi soit journalisé.
    //
    // Les garde-fous juridiques — base de consentement LCAP, plafond de
    // fréquence de l'art. 56 1°, refus d'un gabarit transactionnel comme
    // réclame — vivent dans segments.js et admin.js, PAS ici : une garde que
    // l'on contourne en appelant l'API autrement n'est pas une garde.
    if (route === '/admin/segments' && method === 'GET') {
      const result = await admin.listSegments(bearer(request), { ip: clientIp(request) });
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, { ok: true, segments: result.segments });
    }

    if ((route === '/admin/campaigns/preview' || route === '/admin/campaigns') && method === 'POST') {
      let payload;
      try {
        payload = parseBody(request);
      } catch {
        return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
      }
      const essai = route === '/admin/campaigns/preview';
      const result = essai
        ? await admin.previewCampaign(bearer(request), payload, { ip: clientIp(request) })
        : await admin.sendCampaign(bearer(request), payload, { ip: clientIp(request) });
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      if (essai) {
        return json(200, {
          ok: true,
          total: result.total,
          exclus: result.exclus,
          echantillon: result.echantillon,
          plafond: result.plafond,
          nature: result.nature,
          avertissements: result.avertissements,
        });
      }
      return json(200, { ok: true, envoyes: result.envoyes, exclus: result.exclus, campagneId: result.campagneId });
    }

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle };
}

module.exports = { createAdminApp };
