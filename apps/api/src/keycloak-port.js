'use strict';

/**
 * L'adaptateur Keycloak (ADR 0045).
 *
 * Il fait trois choses et rien d'autre : découvrir le royaume, échanger un code
 * d'autorisation contre un jeton d'identité, et VÉRIFIER ce jeton. Il ne décide
 * de rien — les décisions sont dans `identity-port.js`, qui est pur. C'est la
 * séparation ports/adaptateurs : ce fichier est remplaçable par n'importe quel
 * fournisseur OpenID sans qu'une ligne de décision bouge.
 *
 * ZÉRO DÉPENDANCE AJOUTÉE. La vérification RS256 se fait avec `node:crypto`
 * seul : `createPublicKey` sait lire un JWK depuis Node 16, et `crypto.verify`
 * sait vérifier une signature RSA. Ajouter une bibliothèque JWT pour trois
 * appels aurait mis un tiers de plus sur le chemin de l'authentification, ce
 * qui est exactement le genre de dépendance qu'on ne veut pas là.
 *
 * CE QU'IL NE FAIT PAS : il ne lit jamais `email_verified` pour en tirer une
 * conclusion. Il transporte les claims tels quels ; c'est `verificationDecision`
 * qui tranche, et elle ne regarde que notre base.
 */

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 5000;
// Les clés d'un royaume changent rarement ; les redemander à chaque connexion
// ferait de Keycloak un point de panne sur le chemin critique.
const JWKS_TTL_MS = 5 * 60 * 1000;

function b64urlToBuffer(s) {
  return Buffer.from(String(s), 'base64url');
}

function decodeSegment(segment) {
  try {
    return JSON.parse(b64urlToBuffer(segment).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Construit le vérificateur. `issuer` est l'URL COMPLÈTE du royaume, telle
 * qu'elle apparaît dans la claim `iss` du jeton — pas l'adresse interne du
 * conteneur. C'est une distinction qui a déjà coûté cher ailleurs dans cette
 * pile (voir NOTA_DOCS_PUBLIC_ENDPOINT) : ce que le navigateur atteint et ce
 * que le conteneur atteint ne sont pas la même chose, et c'est l'émetteur du
 * jeton qui fait foi.
 */
function createKeycloakPort(options = {}) {
  const issuer = String(options.issuer || process.env.NOTA_KEYCLOAK_ISSUER || '').replace(/\/+$/, '');
  const clientId = String(options.clientId || process.env.NOTA_KEYCLOAK_CLIENT_ID || 'nota-web');
  const fetchImpl = options.fetch || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  // Injectable pour les tests : une horloge et un cache explicites valent mieux
  // qu'un état de module qu'on ne peut pas remettre à zéro.
  const cache = options.cache || { jwks: null, fetchedAtMs: 0, config: null };

  /** Le port est-il configuré ? Sans émetteur, les routes doivent répondre 503, pas planter. */
  function isConfigured() {
    return !!issuer;
  }

  async function getJSON(url) {
    if (!fetchImpl) throw new Error('fetch indisponible dans ce runtime');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function discovery() {
    if (cache.config) return cache.config;
    cache.config = await getJSON(`${issuer}/.well-known/openid-configuration`);
    return cache.config;
  }

  async function jwks(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (cache.jwks && now - cache.fetchedAtMs < JWKS_TTL_MS) return cache.jwks;
    const conf = await discovery();
    const uri = conf && conf.jwks_uri;
    if (!uri) throw new Error('le royaume ne publie pas de jwks_uri');
    const set = await getJSON(uri);
    cache.jwks = Array.isArray(set && set.keys) ? set.keys : [];
    cache.fetchedAtMs = now;
    return cache.jwks;
  }

  /**
   * Vérifie un jeton d'identité et rend ses claims, ou `null`.
   *
   * Échoue FERMÉ sur tout : signature, émetteur, destinataire, expiration.
   * Aucune de ces vérifications n'est optionnelle — un jeton dont on ne
   * vérifierait pas l'`aud` serait rejouable depuis un autre client du même
   * royaume.
   */
  async function verifyIdToken(token, nowMs) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const header = decodeSegment(h);
    const claims = decodeSegment(p);
    if (!header || !claims) return null;
    if (header.alg !== 'RS256') return null; // pas de « alg: none », pas de HMAC déguisé

    const keys = await jwks(nowMs);
    const jwk = keys.find((k) => k.kid === header.kid && (k.alg === 'RS256' || !k.alg));
    if (!jwk) return null;

    let pub;
    try {
      pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      return null;
    }

    const signed = Buffer.from(`${h}.${p}`, 'utf8');
    const ok = crypto.verify('RSA-SHA256', signed, pub, b64urlToBuffer(s));
    if (!ok) return null;

    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (typeof claims.exp === 'number' && now >= claims.exp * 1000) return null;
    if (typeof claims.nbf === 'number' && now < claims.nbf * 1000) return null;
    if (String(claims.iss || '').replace(/\/+$/, '') !== issuer) return null;

    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(clientId)) return null;

    return claims;
  }

  /**
   * Échange le code d'autorisation contre les jetons. PKCE obligatoire : le
   * client est public, donc le code seul ne doit jamais suffire.
   */
  async function exchangeCode({ code, redirectUri, codeVerifier }) {
    const conf = await discovery();
    const endpoint = conf && conf.token_endpoint;
    if (!endpoint) throw new Error('le royaume ne publie pas de token_endpoint');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: String(code || ''),
      redirect_uri: String(redirectUri || ''),
      code_verifier: String(codeVerifier || ''),
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** L'URL vers laquelle envoyer le navigateur. `state` et `codeChallenge` viennent de l'appelant. */
  function authorizeUrl({ redirectUri, state, codeChallenge, loginHint }) {
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: String(redirectUri || ''),
      state: String(state || ''),
      code_challenge: String(codeChallenge || ''),
      code_challenge_method: 'S256',
    });
    if (loginHint) q.set('login_hint', String(loginHint));
    return `${issuer}/protocol/openid-connect/auth?${q}`;
  }

  return { isConfigured, issuer, clientId, verifyIdToken, exchangeCode, authorizeUrl, discovery };
}

/** PKCE : le vérificateur et son défi. Exporté pour que le web et les tests partagent le même calcul. */
function pkcePair(randomBytes = crypto.randomBytes) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

module.exports = { createKeycloakPort, pkcePair };
