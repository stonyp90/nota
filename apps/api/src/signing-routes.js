'use strict';

const crypto = require('node:crypto');
const D = require('@nota/domain');
const S = require('@nota/domain/signing');
const { SCOPES } = require('./notary-auth');

const MAX_SDP = 24000;
const MAX_EVENTS = 100;
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const SIGNING_BETA_PATHS = Object.freeze([
  '/signing-beta/capabilities', '/signing-beta/sessions',
  ...['commands', 'signal', 'heartbeat', 'evidence'].map(action => '/signing-beta/sessions/{sessionId}/' + action),
]);

function publicKey(value) {
  if (!value || value.kty !== 'EC' || value.crv !== 'P-256' || value.d !== undefined ||
      !/^[\w-]{43}$/.test(value.x || '') || !/^[\w-]{43}$/.test(value.y || '')) return null;
  const jwk = { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
  try { crypto.createPublicKey({ key: jwk, format: 'jwk' }); return jwk; } catch { return null; }
}
function verifyProof(jwk, message, signature) {
  if (typeof signature !== 'string' || !/^[\w-]{86}$/.test(signature)) return false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}

function createSigningRoutes({ repo, env = process.env, nowMs, newId, json, authenticate, clientIp, readTurnSecret }) {
  const enabled = () => env.NOTA_SIGNING_BETA_ENABLED === 'true';
  const urls = () => {
    const raw = String(env.NOTA_SIGNING_TURN_URLS || '');
    let values;
    try { values = raw.startsWith('[') ? JSON.parse(raw) : raw.split(','); } catch { return []; }
    return Array.isArray(values) ? values.filter(s => typeof s === 'string').map(s => s.trim()).filter(s => /^turns?:[a-z\d.-]+:\d+(\?transport=(udp|tcp))?$/i.test(s)) : [];
  };
  let turnSecretCache = null, turnSecretUntil = 0, ssm;
  async function turnSecret() {
    if (env.NOTA_SIGNING_TURN_SECRET) return env.NOTA_SIGNING_TURN_SECRET;
    if (turnSecretCache && nowMs() < turnSecretUntil) return turnSecretCache;
    const name = env.NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER;
    if (!name) return null;
    let value;
    if (readTurnSecret) value = await readTurnSecret(name);
    else {
      const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
      ssm ||= new SSMClient({ region: env.AWS_REGION || 'ca-central-1' });
      value = (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter?.Value;
    }
    if (typeof value !== 'string' || value.length < 32) throw new Error('TURN secret unavailable');
    turnSecretCache = value; turnSecretUntil = nowMs() + 5 * 60 * 1000;
    return value;
  }
  const capabilities = () => ({ enabled: enabled(), mode: 'rehearsal', legalSignatureAvailable: false,
    identityProofingAvailable: false, authentication: 'recent_email_verification', recordingAvailable: false,
    mediaEncryption: 'webrtc_dtls_srtp', protectsAgainstMaliciousWebPublisher: false,
    turnConfigured: urls().length > 0 && !!(env.NOTA_SIGNING_TURN_SECRET || env.NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER),
    sessionDurationMs: S.SESSION_MS, presenceFreshnessMs: S.PRESENCE_MS });
  const error = (status, code) => json(status, { errors: [{ code, message: {
    beta_desactivee: 'La séance de démonstration est désactivée.', non_autorise: 'Une connexion est requise.',
    reauth_required: 'Reconnectez-vous par courriel pour participer à cet exercice.', interdit: 'Accès refusé à cette séance.',
    introuvable: 'Séance introuvable.', etape_invalide: 'Cette étape n’est pas disponible.', session_terminee: 'Cette séance est terminée.',
    presence_requise: 'Les deux participants doivent être connectés à la vidéo.', conflit_revision: 'La séance a changé. Actualisez-la.',
    preuve_invalide: 'La preuve cryptographique est invalide.', requete_invalide: 'La requête est invalide.',
    trop_de_requetes: 'Trop de requêtes. Réessayez dans une minute.', indisponible: 'La séance est temporairement indisponible.',
  }[code] || 'La requête est invalide.' }] });

  async function throttle(scope, key, max) {
    const count = await repo.incrNotaryRateCounter('signing_beta_' + scope, HASH(key).slice(0, 32), 60, nowMs());
    return count > max;
  }
  async function iceServers(session, role) {
    if (!capabilities().turnConfigured || !S.live(session, nowMs()) || !session.admitted || !session.participants[role].joined) return [];
    const secret = await turnSecret();
    if (!secret) throw new Error('TURN unavailable');
    // Allocation refresh uses the original credentials. Keep them valid until
    // this bounded session ends; polling fresh credentials cannot renew a PC.
    const username = Math.floor(session.expiresAt / 1000) + ':' + session.id + ':' + role;
    return [{ urls: urls(), username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') }];
  }
  function view(session, role) {
    const active = S.live(session, nowMs());
    const out = {
      id: session.id, revision: session.revision, status: nowMs() >= session.expiresAt ? 'expired' : session.status,
      createdAt: session.createdAt, expiresAt: session.expiresAt, document: session.document,
      admitted: session.admitted, participants: clone(session.participants),
      events: clone(session.events),
      peerSignal: active ? session.signals[role === 'notary' ? 'client' : 'notary'] || null : null,
      challenge: active && session.status === 'released' && !session.participants[role].acknowledged ? session.challenges[role] || null : null,
    };
    return out;
  }
  async function response(session, role, status = 200) {
    return json(status, { role, session: session ? view(session, role) : null, capabilities: capabilities(), iceServers: session ? await iceServers(session, role) : [] });
  }
  function evidence(session) {
    return { format: 'nota-rehearsal-evidence-v1', legalSignatureAvailable: false, identityProofingAvailable: false,
      sessionId: session.id, status: session.status, createdAt: session.createdAt, expiresAt: session.expiresAt,
      document: session.document, authentication: 'recent_email_verification',
      participants: Object.fromEntries(Object.entries(session.participants).map(([role, p]) => [role, { name: p.name, publicKeyJwk: p.publicKeyJwk || null }])),
      acknowledgments: clone(session.acknowledgments), events: clone(session.events),
      verification: { algorithm: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256', signatureEncoding: 'base64url-ieee-p1363', documentEncoding: 'UTF-8' } };
  }
  function event(session, role, action) {
    if (session.events.length >= MAX_EVENTS) return false;
    session.events.push({ sequence: session.events.length + 1, role, action, at: new Date(nowMs()).toISOString() });
    return true;
  }
  async function save(session, previousRevision) {
    session.revision = previousRevision + 1;
    return repo.compareAndSetSigningSession(session.bidId, previousRevision, session);
  }
  return async function signingRoutes(request, route, method, query = {}) {
    if (!route.startsWith('/signing-beta/')) return null;
    try {
      if (route === '/signing-beta/capabilities' && method === 'GET') return json(200, capabilities());
      if (!enabled()) return error(503, 'beta_desactivee');
      const match = /^\/signing-beta\/sessions(?:\/([a-zA-Z0-9_-]{1,100})\/(commands|signal|heartbeat|evidence))?$/.exec(route);
      if (!match || !['GET', 'POST'].includes(method)) return error(404, 'introuvable');
      let body = {};
      try { body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {}; }
      catch { return error(400, 'requete_invalide'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 30000) return error(400, 'requete_invalide');
      const claims = authenticate(request);
      if (!claims || ![SCOPES.SESSION, SCOPES.CLIENT].includes(claims.scope)) return error(401, 'non_autorise');
      if (!Number.isFinite(claims.verifiedAt) || claims.verifiedAt > nowMs() || nowMs() - claims.verifiedAt >= S.AUTH_FRESH_MS) return error(401, 'reauth_required');
      if (await throttle('ip', String(clientIp(request) || 'unknown'), 180)) return error(429, 'trop_de_requetes');
      const role = claims.scope === SCOPES.SESSION ? 'notary' : 'client';
      const bidId = String((method === 'GET' ? query : body).bidId || '');
      const dateISO = String((method === 'GET' ? query : body).dateISO || '');
      if (!/^[\w-]{1,100}$/.test(bidId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return error(400, 'requete_invalide');
      const bid = await repo.get(bidId, dateISO, { consistentRead: true });
      if (!bid || bid.dateISO !== dateISO) return error(404, 'introuvable');
      if (bid.status !== D.STATUS.RETENUE || !bid.notaryId || (role === 'notary' ? claims.sub !== bid.notaryId : claims.sub !== bid.id)) return error(403, 'interdit');
      const notary = await repo.getNotary(bid.notaryId);
      if (!notary || !(notary.approuveLe || notary.status === 'active')) return error(403, 'interdit');
      const operation = match[2] || (method === 'GET' ? 'read' : 'create');
      const limit = operation === 'read' ? 60 : operation === 'heartbeat' ? 20 : operation === 'signal' ? 12 : 20;
      if (await throttle(operation, claims.sub + ':' + bidId, limit)) return error(429, 'trop_de_requetes');
      let session = await repo.getSigningSession(bidId);
      if (match[1] && (!session || session.id !== match[1])) return error(404, 'introuvable');
      if (session && session.notaryId !== bid.notaryId) return error(403, 'interdit');
      if (operation === 'read' && method === 'GET') return response(session, role);
      if (operation === 'create' && method === 'POST') {
        if (role !== 'notary') return error(403, 'interdit');
        if (session && S.live(session, nowMs())) return error(409, 'conflit_revision');
        const jwk = publicKey(body.publicKeyJwk);
        if (!jwk) return error(400, 'requete_invalide');
        const oldRevision = session ? session.revision : 0;
        session = { id: newId(), bidId, dateISO, notaryId: bid.notaryId, revision: oldRevision,
          createdAt: new Date(nowMs()).toISOString(), expiresAt: nowMs() + S.SESSION_MS, ttl: Math.floor((nowMs() + S.SESSION_MS) / 1000),
          status: 'waiting', admitted: false, document: { ...S.DOCUMENT, sha256: HASH(S.DOCUMENT.text) },
          participants: { notary: { name: String(notary.nom || notary.label || 'Notaire').slice(0, 120), joined: true, publicKeyJwk: jwk, connected: false, lastSeenAt: 0, acknowledged: false },
            client: { name: String(bid.nom || 'Client').slice(0, 120), joined: false, publicKeyJwk: null, connected: false, lastSeenAt: 0, acknowledged: false } },
          signals: {}, challenges: {}, acknowledgments: [], events: [] };
        event(session, role, 'created');
        if (!await save(session, oldRevision)) return error(409, 'conflit_revision');
        return response(session, role, 201);
      }
      if (operation === 'evidence' && method === 'GET') {
        const result = json(200, evidence(session));
        result.headers['content-disposition'] = 'attachment; filename="nota-rehearsal-' + session.id + '.json"';
        return result;
      }
      if (method !== 'POST' || !S.live(session, nowMs())) return error(409, 'session_terminee');
      if (operation === 'heartbeat') {
        if (typeof body.connected !== 'boolean') return error(400, 'requete_invalide');
        for (let attempt = 0; attempt < 4; attempt++) {
          if (!session || session.id !== match[1] || !S.live(session, nowMs())) return error(409, 'session_terminee');
          if (!session.participants[role].joined) return error(403, 'interdit');
          const revision = session.revision;
          session.participants[role].connected = body.connected;
          session.participants[role].lastSeenAt = nowMs();
          if (!body.connected && ['reviewed', 'released'].includes(session.status)) {
            session.status = 'paused'; session.challenges = {};
            session.participants.notary.acknowledged = false; session.participants.client.acknowledged = false;
            event(session, role, 'connection_lost');
          }
          if (await save(session, revision)) return response(session, role);
          session = await repo.getSigningSession(bidId);
        }
        return error(409, 'conflit_revision');
      }
      if (!Number.isInteger(body.revision) || body.revision !== session.revision) return error(409, 'conflit_revision');
      const previousRevision = session.revision;
      if (operation === 'signal') {
        if (!session.participants[role].joined || !session.admitted || !['admitted', 'paused'].includes(session.status)) return error(409, 'etape_invalide');
        if (body.type !== (role === 'notary' ? 'offer' : 'answer') || typeof body.sdp !== 'string' || Buffer.byteLength(body.sdp) > MAX_SDP || !body.sdp.startsWith('v=0') ||
            !/a=fingerprint:sha-256 [A-F\d:]{95}/i.test(body.sdp)) return error(400, 'requete_invalide');
        if (role === 'client' && !session.signals.notary) return error(409, 'etape_invalide');
        if (!verifyProof(session.participants[role].publicKeyJwk, S.signalMessage(session.id, role, body.type, HASH(body.sdp)), body.signature)) return error(422, 'preuve_invalide');
        if (role === 'notary') delete session.signals.client;
        session.signals[role] = { type: body.type, sdp: body.sdp, signature: body.signature, seq: previousRevision + 1 };
      } else if (operation === 'commands') {
        const action = body.action;
        if (['review', 'release', 'acknowledge'].includes(action) && (!session.signals.notary || !session.signals.client)) return error(409, 'presence_requise');
        const decision = S.decision(session, role, action, nowMs());
        if (!decision.ok) return error(409, decision.code);
        if (action === 'join') {
          const jwk = publicKey(body.publicKeyJwk);
          if (!jwk) return error(400, 'requete_invalide');
          session.participants.client = { ...session.participants.client, joined: true, publicKeyJwk: jwk };
        }
        if (action === 'admit') session.admitted = true;
        if (action === 'review' && body.observationConfirmed !== true) return error(400, 'requete_invalide');
        if (action === 'release') {
          for (const who of ['notary', 'client']) {
            const nonce = crypto.randomBytes(32).toString('base64url');
            session.challenges[who] = { nonce, message: S.proofMessage(session.id, session.document.sha256, who, nonce) };
          }
        }
        if (action === 'acknowledge') {
          const challenge = session.challenges[role];
          if (!challenge || typeof body.signature !== 'string' || !/^[\w-]{86}$/.test(body.signature)) return error(422, 'preuve_invalide');
          if (!verifyProof(session.participants[role].publicKeyJwk, challenge.message, body.signature)) return error(422, 'preuve_invalide');
          session.participants[role].acknowledged = true;
          session.acknowledgments.push({ role, message: challenge.message, signature: body.signature, at: new Date(nowMs()).toISOString() });
          delete session.challenges[role];
        }
        if (action === 'pause') {
          session.challenges = {};
          session.participants.notary.acknowledged = false; session.participants.client.acknowledged = false;
        }
        session.status = decision.status;
        if (['closed', 'complete'].includes(session.status)) { session.signals = {}; session.challenges = {}; }
        if (!event(session, role, action)) return error(409, 'session_terminee');
      } else return error(404, 'introuvable');
      // Re-check retained ownership immediately before persisting a command.
      const latestBid = await repo.get(bidId, dateISO, { consistentRead: true });
      if (!latestBid || latestBid.notaryId !== session.notaryId || latestBid.status !== D.STATUS.RETENUE) return error(403, 'interdit');
      if (!await save(session, previousRevision)) return error(409, 'conflit_revision');
      return response(session, role);
    } catch { return error(503, 'indisponible'); }
  };
}

module.exports = { createSigningRoutes, publicKey, SIGNING_BETA_PATHS };
