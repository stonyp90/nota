'use strict';

const crypto = require('node:crypto');
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPES = 'openid offline_access https://graph.microsoft.com/Calendars.ReadWrite';

// Tokens never leave this server-side port. Each encrypted value is bound to
// its purpose and owner, so copying ciphertext between records is rejected.
function createOutlook({ repo, env = process.env, fetch: send = global.fetch, now = Date.now }) {
  const clientId = env.NOTA_OUTLOOK_CLIENT_ID;
  const secret = env.NOTA_OUTLOOK_CLIENT_SECRET;
  const rawKey = env.NOTA_CALENDAR_ENCRYPTION_KEY || '';
  const redirect = env.NOTA_OUTLOOK_REDIRECT_URI;
  const enabled = !!(clientId && secret && /^[a-f0-9]{64}$/i.test(rawKey) && redirect && /^https:\/\//.test(redirect));
  const key = enabled ? Buffer.from(rawKey, 'hex') : null;
  function seal(value, purpose) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function open(value, purpose) {
    const bytes = Buffer.from(value, 'base64url');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
  }
  function error(code) { return Object.assign(new Error(code), { code }); }
  function ready() { if (!enabled) throw error('calendar_unconfigured'); }
  async function save(owner, previous, next) {
    const value = { ...next, revision: crypto.randomUUID() };
    if (!await repo.compareAndSetCalendar(owner, previous?.revision || null, value)) throw error('calendar_conflict');
    return value;
  }
  async function token(params) {
    const response = await send(`${AUTHORITY}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, redirect_uri: redirect, ...params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw error('calendar_provider_error');
    const value = await response.json();
    if (!value.access_token || !value.refresh_token || !String(value.scope || '').split(' ').some(s => s.toLowerCase().endsWith('calendars.readwrite'))) throw error('calendar_missing_scope');
    return value;
  }
  return {
    enabled,
    async status(owner) {
      if (!enabled) return { configured: false, connected: false };
      const record = await repo.getCalendar(owner);
      return { configured: true, connected: !!record?.credentials, account: record?.account || null };
    },
    async start(owner) {
      ready();
      const previous = await repo.getCalendar(owner);
      const verifier = crypto.randomBytes(32).toString('base64url');
      const nonce = crypto.randomBytes(32).toString('base64url');
      const expires = now() + 600000;
      await save(owner, previous, { ...previous, pending: { nonce, expires, verifier: seal(verifier, `pkce:${owner}`) } });
      const binding = crypto.randomBytes(32).toString('base64url');
      const state = seal({ owner, nonce, expires, binding }, 'oauth-state');
      const query = new URLSearchParams({ client_id: clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirect, scope: SCOPES, state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), prompt: 'select_account' });
      return { url: `${AUTHORITY}/authorize?${query}`, binding };
    },
    async finish(query, binding) {
      ready();
      let state;
      try { state = open(query.state, 'oauth-state'); } catch { throw error('calendar_invalid_state'); }
      if (!binding || state.binding !== binding || !state.owner || state.expires <= now()) throw error('calendar_invalid_state');
      const previous = await repo.getCalendar(state.owner);
      if (!previous?.pending || previous.pending.nonce !== state.nonce || previous.pending.expires <= now()) throw error('calendar_invalid_state');
      // Consume before provider I/O. A replay or simultaneous callback cannot
      // exchange the code twice or overwrite a disconnect/new connection.
      const claimed = await save(state.owner, previous, { ...previous, pending: null });
      if (query.error) throw error('calendar_consent_denied');
      if (!query.code || typeof query.code !== 'string') throw error('calendar_invalid_state');
      const credentials = await token({ grant_type: 'authorization_code', code: query.code, code_verifier: open(previous.pending.verifier, `pkce:${state.owner}`) });
      const response = await send('https://graph.microsoft.com/v1.0/me/calendar?$select=id,owner', { headers: { Authorization: `Bearer ${credentials.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw error('calendar_provider_error');
      const calendar = await response.json();
      if (!calendar.id) throw error('calendar_provider_error');
      await save(state.owner, claimed, { credentials: seal(credentials.refresh_token, `refresh:${state.owner}`), account: calendar.owner?.address || null, calendarId: calendar.id, connectedAt: new Date(now()).toISOString(), pending: null });
      return { connected: true };
    },
    async disconnect(owner) {
      ready();
      const previous = await repo.getCalendar(owner);
      await save(owner, previous, { pending: null });
      return { connected: false };
    },
  };
}
module.exports = { createOutlook };
