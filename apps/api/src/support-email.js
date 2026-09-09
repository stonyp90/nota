'use strict';

// Email is an adapter to the existing support conversation, never an inbox
// or a second thread store. Only SES Lambda events may reach this adapter.
const crypto = require('node:crypto');
const domain = require('@nota/domain');

const MAX_RAW_BYTES = 256 * 1024;
const REPLY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const addressDomain = value => typeof value === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value) ? value.toLowerCase() : null;
const email = value => typeof value === 'string' && /^[\x21-\x7e]+$/.test(value.trim()) && domain.isEmail(value.trim()) ? value.trim().toLowerCase() : null;

function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) return null;
  // Domain separation prevents an email capability from being a login token.
  return crypto.createHmac('sha256', secret).update('nota/support-email/v1').digest();
}
function signature(key, local, sender, host) {
  return crypto.createHmac('sha256', key).update([local, sender, host].join('\0')).digest().subarray(0, 14).toString('base64url');
}

/** Mint an expiring, sender-bound Reply-To capability. No dev-key fallback. */
function supportReplyAddress({ threadId, role, sender, domain: host, secret, nowMs = Date.now(), ttlMs = REPLY_TTL_MS } = {}) {
  const key = signingKey(secret), recipient = email(sender), destination = addressDomain(host);
  if (!key || !recipient || !destination || !['operator', 'visitor'].includes(role) || typeof threadId !== 'string') return null;
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > REPLY_TTL_MS) return null;
  const compact = UUID.test(threadId) ? threadId.replace(/-/g, '') : threadId;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(compact)) return null;
  const kind = UUID.test(threadId) ? 'u' : 't';
  const expires = Math.floor((nowMs + ttlMs) / 1000).toString(36);
  const payload = `1${role === 'operator' ? 'o' : 'v'}${kind}.${compact}.${expires}`;
  const local = payload + '.' + signature(key, payload, recipient, destination);
  return local.length <= 64 && local.length + destination.length + 1 <= 254 ? local + '@' + destination : null;
}

function parseRoute(address, host) {
  if (typeof address !== 'string' || address.length > 254) return null;
  const [local, destination, extra] = address.split('@');
  if (extra || !host || String(destination).toLowerCase() !== host || local.length > 64) return null;
  const match = /^1([ov])([ut])\.([a-zA-Z0-9_-]{1,32})\.([a-z0-9]{1,7})\.([a-zA-Z0-9_-]{19})$/.exec(local);
  if (!match) return null;
  let threadId = match[3];
  if (match[2] === 'u') {
    if (!/^[a-f0-9]{32}$/.test(threadId)) return null;
    threadId = threadId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }
  const expiresAt = parseInt(match[4], 36) * 1000;
  if (!Number.isSafeInteger(expiresAt)) return null;
  return { threadId, role: match[1] === 'o' ? 'operator' : 'visitor', expiresAt, payload: local.slice(0, local.lastIndexOf('.')), tag: match[5] };
}

function verifyReplyAddress({ address, sender, domain: host, secret, nowMs = Date.now() } = {}) {
  const destination = addressDomain(host), key = signingKey(secret), participant = email(sender);
  const route = parseRoute(address, destination);
  if (!route || !key || !participant || !Number.isFinite(nowMs) || nowMs >= route.expiresAt) return null;
  const expected = signature(key, route.payload, participant, destination);
  if (!crypto.timingSafeEqual(Buffer.from(route.tag), Buffer.from(expected))) return null;
  return { threadId: route.threadId, role: route.role, expiresAt: route.expiresAt };
}

function stripQuotedReply(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line) || /^--\s*$/.test(line) || /^\s*-{2,}\s*(?:Original Message|Message d['’]origine|Message transf[eé]r[eé])\s*-{2,}\s*$/i.test(line)) break;
    // Common clients wrap the attribution over a few lines. Require the
    // final "wrote/a écrit" marker to avoid truncating ordinary prose.
    const attribution = lines.slice(i, i + 3).join(' ');
    if (/^\s*(?:On\s+.{1,500}\s+wrote:|Le\s+.{1,500}\s+a [eé]crit\s*:)/i.test(attribution)) break;
    if (/^\s*(?:Sent from my (?:iPhone|iPad|Android)|Envoy[eé] de mon (?:iPhone|iPad|Android)|Get Outlook for|Envoy[eé] (?:depuis|[àa] partir de) Outlook)/i.test(line)) break;
    if (/^\s*(?:From|De)\s*:/i.test(line) && /\b(?:Sent|Envoy[eé]|To|[ÀA]|Subject|Objet)\s*:/i.test(lines.slice(i + 1, i + 5).join('\n'))) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function automaticMessage(parsed, source) {
  if (!source || source === '<>') return true;
  const headers = parsed.headers;
  const values = name => [].concat(headers.get(name) || []).map(value => String(value).trim().toLowerCase());
  if (values('auto-submitted').some(value => value !== 'no')) return true;
  if (values('precedence').some(value => /^(?:bulk|junk|list|auto_reply)$/.test(value))) return true;
  // MailParser groups List-* headers into a structured `list` object.
  if (headers.has('list') || ['x-autoreply', 'x-autorespond', 'x-nota-support-automation'].some(name => headers.has(name))) return true;
  const contentType = headers.get('content-type');
  return contentType && contentType.value === 'multipart/report';
}

function sesTrusted(record) {
  if (!record || record.eventSource !== 'aws:ses' || !record.ses) return false;
  const { mail, receipt } = record.ses;
  const verdict = name => receipt && receipt[name] && receipt[name].status;
  return !!mail && /^[a-zA-Z0-9_-]{1,128}$/.test(mail.messageId || '') &&
    Array.isArray(receipt && receipt.recipients) &&
    verdict('spamVerdict') === 'PASS' && verdict('virusVerdict') === 'PASS' &&
    verdict('dmarcVerdict') === 'PASS' &&
    (verdict('dkimVerdict') === 'PASS' || verdict('spfVerdict') === 'PASS');
}

async function boundedRaw(body, contentLength) {
  if (Number(contentLength) > MAX_RAW_BYTES) { if (body && typeof body.destroy === 'function') body.destroy(); return null; }
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const raw = Buffer.from(body);
    return raw.length > 0 && raw.length <= MAX_RAW_BYTES ? raw : null;
  }
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_RAW_BYTES) { if (typeof body.destroy === 'function') body.destroy(); return null; }
    chunks.push(bytes);
  }
  return size ? Buffer.concat(chunks, size) : null;
}

/**
 * `getObject(messageId)` retrieves ONLY the configured SES bucket/prefix.
 * `conversations` is the same service used by admin and browser replies.
 * Rejected messages never send a bounce/auto-reply. Operational failures
 * throw a scrubbed error so Lambda retries and its failure queue captures it.
 */
function createSupportEmailReceiver({ repo, conversations, getObject, env = process.env, nowMs = Date.now } = {}) {
  if (!repo || !conversations || typeof getObject !== 'function') throw new Error('Support email receiver requires its adapters.');
  const host = addressDomain(env.NOTA_SUPPORT_EMAIL_DOMAIN);
  const operators = new Set(String(env.NOTA_SUPPORT_OPERATOR_EMAILS || env.NOTA_OPERATOR_EMAIL || '').split(',').map(email).filter(Boolean));

  async function receive(record) {
    const reject = reason => ({ accepted: false, reason });
    if (!host || !signingKey(env.NOTA_NOTARY_SECRET)) return reject('disabled');
    if (!sesTrusted(record)) return reject('ses_verdict');
    const { mail, receipt } = record.ses;
    const routes = [...new Set(receipt.recipients.filter(address => parseRoute(address, host)))];
    if (routes.length !== 1) return reject('recipient');
    let object;
    try { object = await getObject(mail.messageId); } catch { throw new Error('Support email storage unavailable.'); }
    let raw;
    try { raw = await boundedRaw(object && object.Body, object && object.ContentLength); } catch { throw new Error('Support email storage unavailable.'); }
    if (!raw) return reject('message_size');
    let parsed;
    try {
      const { simpleParser } = require('mailparser');
      parsed = await simpleParser(raw, { skipImageLinks: true, skipTextLinks: true, skipTextToHtml: true, keepDeliveryStatus: true, maxHtmlLengthToParse: MAX_RAW_BYTES });
    } catch { return reject('mime'); }
    if (automaticMessage(parsed, mail.source)) return reject('automatic');
    // Multiple From/Sender headers are ambiguous and cannot confer a role.
    const fromHeaders = parsed.headerLines.filter(header => header.key === 'from');
    const senders = parsed.from && parsed.from.value;
    if (fromHeaders.length !== 1 || !Array.isArray(senders) || senders.length !== 1 || !email(senders[0].address)) return reject('sender');
    const sender = email(senders[0].address);
    const signed = verifyReplyAddress({ address: routes[0], sender, domain: host, secret: env.NOTA_NOTARY_SECRET, nowMs: nowMs() });
    if (!signed) return reject('capability');
    let thread;
    try { thread = await repo.getSupportThread(signed.threadId); } catch { throw new Error('Support email conversation unavailable.'); }
    if (!thread) return reject('thread_missing');
    if (signed.role === 'operator' ? !operators.has(sender) : email(thread.courriel) !== sender) return reject('participant');
    const texte = stripQuotedReply(parsed.text);
    const valid = domain.validateSupportMessage({ texte });
    if (!valid.ok) return reject('message_text');
    const ids = parsed.headerLines.filter(header => header.key === 'message-id');
    if (ids.length > 1) return reject('message_id');
    const messageId = typeof parsed.messageId === 'string' && /^<[^\s<>]{1,500}>$/.test(parsed.messageId)
      ? parsed.messageId : 'ses:' + mail.messageId;
    const id = 'email-' + crypto.createHash('sha256').update([signed.threadId, signed.role, sender, messageId].join('\0')).digest('hex');
    let result;
    try {
      result = await conversations[signed.role === 'operator' ? 'reply' : 'appendVisitor']({ threadId: signed.threadId, texte: valid.texte, messageId: id, author: sender, ...(signed.role === 'visitor' ? { expectedEmail: sender } : {}) });
    } catch { throw new Error('Support email conversation unavailable.'); }
    if (!result.ok) {
      if (result.status >= 500 || result.status === 409) throw new Error('Support email conversation unavailable.');
      return reject('conversation');
    }
    if (result.notification && result.notification.ok === false) throw new Error('Support email notification unavailable.');
    // Attachments are never persisted, opened, echoed, or sent to the model.
    return { accepted: true, duplicate: !!result.duplicate, attachmentsIgnored: (parsed.attachments || []).length };
  }

  return { receive, async handle(event) {
    if (!event || !Array.isArray(event.Records) || event.Records.length < 1 || event.Records.length > 10) return { accepted: false, reason: 'event' };
    const results = [];
    for (const record of event.Records) results.push(await receive(record));
    return { results };
  } };
}

module.exports = { supportReplyAddress, verifyReplyAddress, stripQuotedReply, createSupportEmailReceiver, MAX_RAW_BYTES, REPLY_TTL_MS };
