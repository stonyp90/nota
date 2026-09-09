'use strict';

const { requestLanguage } = require('./language');
const COOKIE = 'nota_oauth_binding';
const OAUTH_PATHS = Object.freeze({ providers: '/auth/oauth/providers', start: '/auth/oauth/{provider}/start', callback: '/auth/oauth/{provider}/callback', complete: '/auth/oauth/complete', requestLink: '/auth/oauth/link/request', verifyLink: '/auth/oauth/link/verify' });
function createOAuthRoutes({ oauth, repo, now, grant, notify, clientIp }) {
  const json = (statusCode, value) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: JSON.stringify(value) });
  const cookie = value => COOKIE + '=' + value + '; Max-Age=' + (value ? '1800' : '0') + oauth.cookieFlags;
  return async function route(request, path, method) {
    if (!path.startsWith('/auth/oauth/')) return null;
    request = { ...request, headers: Object.fromEntries(Object.entries(request.headers || {}).map(([k, v]) => [k.toLowerCase(), v])) };
    const binding = String(request.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    const callback = path.match(new RegExp('^' + OAUTH_PATHS.callback.replace('{provider}', '(google|microsoft|linkedin)') + '$'));
    try {
      if (path === OAUTH_PATHS.providers && method === 'GET') return json(200, { providers: oauth.providers() });
      // A form POST from another site must not start/link identities. Callbacks
      // are the only permitted cross-site entry, protected by state + cookie.
      if (method === 'POST') {
        const origin = request.headers?.origin;
        if ((origin && origin !== oauth.origin) || request.headers?.['sec-fetch-site'] === 'cross-site') return json(403, { errors: [{ code: 'oauth_origin_rejected' }] });
        if (!/^application\/json(?:;|$)/i.test(request.headers?.['content-type'] || '')) return json(415, { errors: [{ code: 'oauth_json_required' }] });
      }
      const count = await repo.incrNotaryRateCounter('oauth', clientIp(request) || 'unknown', 900, now());
      if (count > 60) return json(429, { errors: [{ code: 'trop_de_tentatives' }] });
      if (callback && method === 'GET') {
        const ticket = await oauth.callback(callback[1], request.query || {}, binding);
        return { statusCode: 303, headers: { location: oauth.origin + '/#oauth=' + ticket, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: '' };
      }
      let payload;
      try { payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}; } catch { return json(400, { errors: [{ code: 'json_invalide' }] }); }
      const start = path.match(new RegExp('^' + OAUTH_PATHS.start.replace('{provider}', '(google|microsoft|linkedin)') + '$'));
      if (start && method === 'POST') {
        const started = await oauth.start(start[1], payload.role, requestLanguage(request));
        const response = json(200, { url: started.url });
        response.headers['set-cookie'] = cookie(started.binding);
        return response;
      }
      if (path === OAUTH_PATHS.requestLink && method === 'POST') {
        const pending = await oauth.requestLink(payload.ticket, binding, payload.email);
        // Await delivery: a successful response must mean the notification
        // adapter accepted the request. Never echo a verification token here.
        await notify(pending);
        return json(200, { ok: true });
      }
      if ([OAUTH_PATHS.complete, OAUTH_PATHS.verifyLink].includes(path) && method === 'POST') {
        const result = path.endsWith('/complete') ? await oauth.complete(payload.ticket, binding) : await oauth.verifyLink(payload.ticket, binding);
        if (result.linkTicket) return json(200, { linkRequired: true, ticket: result.linkTicket, role: result.role });
        const response = await grant(result.email, result.role, request);
        response.headers = { ...response.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': cookie('') };
        const body = JSON.parse(response.body);
        response.body = JSON.stringify({ ...body, role: result.role });
        return response;
      }
      return json(404, { errors: [{ code: 'introuvable' }] });
    } catch (error) {
      const code = /^oauth_(unconfigured|invalid_state|invalid_role|invalid_email|consent_denied|provider_error|invalid_identity|link_conflict)$/.test(error.code || '') ? error.code : 'oauth_unavailable';
      if (callback && method === 'GET') return { statusCode: 303, headers: { location: oauth.origin + '/#oautherror=' + code, 'set-cookie': cookie(''), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: '' };
      return json(code === 'oauth_unconfigured' || code === 'oauth_unavailable' || code === 'oauth_provider_error' ? 503 : 400, { errors: [{ code }] });
    }
  };
}
module.exports = { createOAuthRoutes, OAUTH_PATHS };
