'use strict';

const crypto = require('node:crypto');
const { isEmail } = require('@nota/domain');
const PROVIDERS = Object.freeze({
  google: { issuer: 'https://accounts.google.com', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', pkce: true },
  microsoft: { issuer: 'https://login.microsoftonline.com/', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', pkce: true },
  linkedin: { issuer: 'https://www.linkedin.com/oauth', authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', jwks: 'https://www.linkedin.com/oauth/openid/jwks', pkce: false },
});
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const TTL = 10 * 60 * 1000;

// No provider token is persisted or returned. Identities are linked only after
// a separate mailbox proof, never by trusting a mutable provider email claim.
function createOAuth({ repo, env = process.env, fetch: send = global.fetch, now = Date.now, verifyIdentity } = {}) {
  const origin = String(env.NOTA_OAUTH_ORIGIN || '').replace(/\/$/, '');
  let validOrigin = false;
  try {
    const u = new URL(origin);
    validOrigin = u.origin === origin && (u.protocol === 'https:' || (env.NODE_ENV !== 'production' && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)));
  } catch {}
  const key = /^[a-f0-9]{64}$/i.test(env.NOTA_OAUTH_ENCRYPTION_KEY || '') ? Buffer.from(env.NOTA_OAUTH_ENCRYPTION_KEY, 'hex') : null;
  const configs = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => {
    const prefix = 'NOTA_OAUTH_' + id.toUpperCase();
    return [id, { ...p, clientId: env[prefix + '_CLIENT_ID'], secret: env[prefix + '_CLIENT_SECRET'], redirect: origin + '/api/auth/oauth/' + id + '/callback' }];
  }));
  const enabled = id => !!(validOrigin && key && configs[id]?.clientId && configs[id]?.secret);
  const get = id => enabled(id) ? configs[id] : fail('oauth_unconfigured');
  function seal(value, purpose) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function open(value, purpose) {
    try {
      const b = Buffer.from(value, 'base64url'), cipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(b.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]));
    } catch { fail('oauth_invalid_state'); }
  }
  const jwks = new Map();
  async function identity(id, p, token, nonce) {
    if (verifyIdentity) return verifyIdentity(id, token, nonce, p);
    const jose = await import('jose');
    let issuer = p.issuer, keyUrl = p.jwks;
    if (id === 'microsoft') {
      const untrusted = jose.decodeJwt(token);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(untrusted.tid || '')) fail('oauth_invalid_identity');
      issuer += untrusted.tid + '/v2.0';
      keyUrl = 'https://login.microsoftonline.com/' + untrusted.tid + '/discovery/v2.0/keys';
    }
    const cacheKey = id + ':' + issuer;
    if (!jwks.has(cacheKey)) {
      if (jwks.size >= 100) jwks.delete(jwks.keys().next().value);
      jwks.set(cacheKey, jose.createRemoteJWKSet(new URL(keyUrl), { timeoutDuration: 10000, [jose.customFetch]: async (url, options) => {
        const response = await send(url, { ...options, redirect: 'error' });
        if (id !== 'microsoft' || !response.ok) return response;
        const data = await response.json();
        // Microsoft tenant keys carry their own issuer restriction. A key for
        // one tenant must not validate a token claiming another tenant.
        data.keys = (data.keys || []).filter(k => typeof k.issuer === 'string' && k.issuer.replace('{tenantid}', issuer.split('/')[3]) === issuer);
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      } }));
    }
    const options = { audience: p.clientId, algorithms: ['RS256'], requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'], maxTokenAge: '10m', clockTolerance: 5, currentDate: new Date(now()) };
    options.issuer = issuer;
    const { payload } = await jose.jwtVerify(token, jwks.get(cacheKey), options);
    if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || (payload.azp && payload.azp !== p.clientId)) fail('oauth_invalid_identity');
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== p.clientId) fail('oauth_invalid_identity');
    if (id === 'microsoft' && (!/^[0-9a-f-]{36}$/i.test(payload.tid || '') || payload.iss !== p.issuer + payload.tid + '/v2.0')) fail('oauth_invalid_identity');
    return payload;
  }
  async function issue(purpose, binding, value) {
    const ticket = random(), expiresAt = now() + TTL;
    await repo.putOAuthTicket(hash(ticket), { purpose, binding: hash(binding), value: seal(value, purpose), expiresAt, ttl: Math.floor(expiresAt / 1000), consumed: false });
    return ticket;
  }
  async function consume(ticket, purpose, binding) {
    if (!key || !/^[\w-]{43}$/.test(ticket || '') || !/^[\w-]{43}$/.test(binding || '')) fail('oauth_invalid_state');
    const record = await repo.consumeOAuthTicket(hash(ticket), purpose, hash(binding), now());
    if (!record) fail('oauth_invalid_state');
    return open(record.value, purpose);
  }
  return {
    origin,
    cookieFlags: '; Path=/api/auth/oauth; HttpOnly; SameSite=Lax' + (origin.startsWith('https:') ? '; Secure' : ''),
    providers: () => Object.keys(PROVIDERS).map(id => ({ id, configured: enabled(id) })),
    async start(id, role, language) {
      const p = get(id);
      if (!['client', 'notary'].includes(role)) fail('oauth_invalid_role');
      const binding = random(), verifier = random(), nonce = random();
      const state = await issue('authorize:' + id, binding, { verifier, nonce, role, language: language === 'en' ? 'en' : 'fr' });
      const q = new URLSearchParams({ client_id: p.clientId, response_type: 'code', redirect_uri: p.redirect, scope: 'openid profile email', state, nonce });
      if (p.pkce) { q.set('code_challenge_method', 'S256'); q.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url')); }
      return { url: p.authorize + '?' + q, binding };
    },
    async callback(id, query, binding) {
      const p = get(id), saved = await consume(query.state, 'authorize:' + id, binding);
      if (query.error) fail('oauth_consent_denied');
      if (typeof query.code !== 'string' || !query.code || query.code.length > 4096) fail('oauth_invalid_state');
      const form = { grant_type: 'authorization_code', client_id: p.clientId, client_secret: p.secret, code: query.code, redirect_uri: p.redirect };
      if (p.pkce) form.code_verifier = saved.verifier;
      const response = await send(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) fail('oauth_provider_error');
      const tokens = await response.json();
      if (typeof tokens.id_token !== 'string') fail('oauth_invalid_identity');
      const claims = await identity(id, p, tokens.id_token, saved.nonce);
      if (query.iss && query.iss !== claims.iss) fail('oauth_invalid_identity');
      const subject = hash(JSON.stringify([id, p.clientId, claims.iss, claims.sub]));
      return issue('result', binding, { subject, provider: id, role: saved.role, language: saved.language });
    },
    async complete(ticket, binding) {
      const result = await consume(ticket, 'result', binding);
      const linked = await repo.getOAuthIdentity(result.subject);
      if (linked) return { ...result, email: linked.email };
      return { ...result, linkTicket: await issue('link-request', binding, result) };
    },
    async requestLink(ticket, binding, email) {
      email = String(email || '').trim().toLowerCase();
      if (!isEmail(email)) fail('oauth_invalid_email');
      const result = await consume(ticket, 'link-request', binding);
      const verification = await issue('link-verify', binding, { ...result, email });
      return { email, provider: result.provider, language: result.language, link: origin + '/#oauthverify=' + encodeURIComponent(verification), ttlMinutes: TTL / 60000 };
    },
    async verifyLink(ticket, binding) {
      const result = await consume(ticket, 'link-verify', binding);
      if (!await repo.putOAuthIdentity(result.subject, { email: result.email, provider: result.provider, createdAt: new Date(now()).toISOString() })) {
        const existing = await repo.getOAuthIdentity(result.subject);
        if (existing?.email !== result.email) fail('oauth_link_conflict');
      }
      return result;
    },
  };
}
module.exports = { createOAuth, PROVIDERS };
