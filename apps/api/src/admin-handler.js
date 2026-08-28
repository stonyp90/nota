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

  // Admin + analytics use-cases are injectable (tests pass fakes / fixed clocks).
  // In production they are built here from the environment.
  const admin =
    opts.admin ||
    createAdmin({
      repo,
      mailer: opts.mailer || null,
      newId,
      now: () => new Date(nowMs()).toISOString(),
      nowMs,
      config: {
        allowlist: (process.env.NOTA_ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),
        baseUrl: adminOrigin,
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
      return json(200, { templates: result.templates });
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

    // --- Commission barème (ADR 0021 §4) -------------------------------------
    // GET open to any authenticated admin; PUT/DELETE require 'settings:write'
    // — enforced in admin.js, which also audit-logs every change.
    if (route === '/admin/commission' && method === 'GET') {
      const result = await admin.getCommissionSchedule(bearer(request), { ip: clientIp(request) });
      if (!result.ok) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
      return json(200, { defaut: result.defaut, override: result.override, effectif: result.effectif });
    }

    if (route === '/admin/commission' && (method === 'PUT' || method === 'DELETE')) {
      let result;
      if (method === 'PUT') {
        let payload;
        try {
          payload = parseBody(request);
        } catch {
          return json(400, { errors: [{ code: 'json_invalide', message: 'Corps JSON invalide.' }] });
        }
        result = await admin.putCommissionSchedule(bearer(request), payload, { ip: clientIp(request) });
      } else {
        result = await admin.resetCommissionSchedule(bearer(request), { ip: clientIp(request) });
      }
      if (!result.ok) {
        if (result.status === 401) return json(401, { errors: [{ code: 'non_autorise', message: 'Session invalide ou expirée.' }] });
        return json(result.status, { errors: result.errors });
      }
      return json(200, method === 'PUT' ? { ok: true, override: result.override } : { ok: true });
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

    return json(404, { errors: [{ code: 'introuvable', message: 'Route inconnue.' }] });
  }

  return { handle };
}

module.exports = { createAdminApp };
