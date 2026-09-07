// La frontière de l'ADR 0045, tenue par des tests.
//
// Ce que ces tests protègent, dans l'ordre d'importance :
//
//   1. La vérification du courriel est un fait de NOTRE base. Un fournisseur
//      qui affirme `email_verified: true` ne doit JAMAIS suffire. C'est la
//      décision entière de l'ADR ; si un seul test devait survivre, c'est
//      celui-là.
//   2. Keycloak ne capte que le courriel. Ni nom, ni téléphone, ni rôle ne
//      doivent entrer dans notre base par ce chemin.
//   3. Le jeton d'identité est vérifié pour de vrai : signature, émetteur,
//      destinataire, expiration. Chacune de ces vérifications a son test
//      d'échec, parce qu'une vérification qu'on ne teste pas en échec est une
//      vérification dont on ne sait pas si elle vérifie.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import identity from '../src/identity-port.js';
import kc from '../src/keycloak-port.js';

const {
  claimsToLink,
  verificationDecision,
  newLinkRecord,
  touchRecord,
  markVerified,
  identityIdForEmail,
  identityPK,
  identityEmailPK,
} = identity;
const { createKeycloakPort, pkcePair } = kc;

// --- 1. La vérification vit dans notre base ----------------------------------

test('un courriel non prouvé chez nous n\'est PAS vérifié, même si Keycloak l\'affirme', () => {
  const record = newLinkRecord({ sub: 'kc-1', email: 'a@b.ca' }, '2026-09-06T10:00:00.000Z');
  const d = verificationDecision(record, { email_verified: true });
  assert.equal(d.verifie, false, 'le fournisseur ne décide pas');
  assert.equal(d.selonLeFournisseur, true, 'mais son affirmation est visible');
  assert.equal(d.divergence, true, 'et la divergence est nommée');
});

test('un courriel prouvé chez nous est vérifié, même si Keycloak dit le contraire', () => {
  let record = newLinkRecord({ sub: 'kc-2', email: 'a@b.ca' }, '2026-09-06T10:00:00.000Z');
  record = markVerified(record, '2026-09-06T11:00:00.000Z');
  const d = verificationDecision(record, { email_verified: false });
  assert.equal(d.verifie, true);
  assert.equal(d.verifieLe, '2026-09-06T11:00:00.000Z', 'la DATE est dans notre dossier (Loi 25)');
  assert.equal(d.divergence, false);
});

test('un compte fraîchement lié n\'a pas de date de vérification', () => {
  const record = newLinkRecord({ sub: 'kc-3', email: 'a@b.ca' }, '2026-09-06T10:00:00.000Z');
  assert.equal(record.courrielVerifieLe, undefined, 'lier n\'est pas prouver');
  assert.equal(verificationDecision(record, {}).verifie, false);
});

test('marquer vérifié est idempotent : la première date fait foi', () => {
  let record = newLinkRecord({ sub: 'kc-4', email: 'a@b.ca' }, '2026-09-06T10:00:00.000Z');
  record = markVerified(record, '2026-09-06T11:00:00.000Z');
  record = markVerified(record, '2026-09-07T09:00:00.000Z');
  assert.equal(record.courrielVerifieLe, '2026-09-06T11:00:00.000Z');
});

// --- 2. Keycloak ne capte que le courriel ------------------------------------

test('seuls le sujet et l\'adresse sont retenus des claims', () => {
  const link = claimsToLink({
    sub: 'kc-5',
    email: 'Alice@Example.CA',
    given_name: 'Alice',
    family_name: 'Tremblay',
    phone_number: '+15815550000',
    realm_access: { roles: ['notaire'] },
  });
  assert.deepEqual(Object.keys(link).sort(), ['email', 'sub']);
  assert.equal(link.email, 'alice@example.ca', 'l\'adresse est normalisée');
});

test('le dossier écrit ne porte ni nom, ni rôle, ni téléphone', () => {
  const link = claimsToLink({ sub: 'kc-6', email: 'a@b.ca', given_name: 'X', realm_access: { roles: ['admin'] } });
  const record = newLinkRecord(link, '2026-09-06T10:00:00.000Z');
  const keys = Object.keys(record).sort();
  assert.deepEqual(keys, ['creeLe', 'dernierAccesLe', 'email', 'identityId', 'sub']);
});

test('des claims sans sujet ou sans adresse ne lient rien', () => {
  assert.equal(claimsToLink({ email: 'a@b.ca' }), null);
  assert.equal(claimsToLink({ sub: 'kc-7' }), null);
  assert.equal(claimsToLink({ sub: 'kc-7', email: 'pas-une-adresse' }), null);
  assert.equal(claimsToLink(null), null);
});

test('l\'identifiant dérivé est stable, insensible à la casse, et ne contient pas l\'adresse', () => {
  const a = identityIdForEmail('Alice@Example.CA');
  const b = identityIdForEmail('  alice@example.ca ');
  assert.equal(a, b);
  assert.ok(!a.includes('alice'), 'un journal ne doit pas devenir un carnet d\'adresses');
  assert.ok(identityEmailPK('a@b.ca').startsWith('IDENTITYMAIL#'));
  assert.equal(identityPK('kc-8'), 'IDENTITY#kc-8');
});

test('toucher un dossier ne touche jamais la vérification', () => {
  let record = newLinkRecord({ sub: 'kc-9', email: 'a@b.ca' }, '2026-09-06T10:00:00.000Z');
  record = markVerified(record, '2026-09-06T11:00:00.000Z');
  const touched = touchRecord(record, { sub: 'kc-9', email: 'a@b.ca' }, '2026-09-08T08:00:00.000Z');
  assert.equal(touched.courrielVerifieLe, '2026-09-06T11:00:00.000Z');
  assert.equal(touched.dernierAccesLe, '2026-09-08T08:00:00.000Z');
  assert.equal(touched.creeLe, '2026-09-06T10:00:00.000Z');
});

// --- 3. Le jeton est vraiment vérifié ----------------------------------------

const ISSUER = 'http://localhost:8081/realms/nota';
const CLIENT = 'nota-web';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function makeToken(claims, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) {
  const h = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  if (alg === 'none') return `${h}.${p}.`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}

function portWithJwks(keys = [JWK]) {
  const fetchImpl = async (url) => {
    if (String(url).includes('.well-known')) {
      return { ok: true, json: async () => ({ jwks_uri: `${ISSUER}/jwks`, token_endpoint: `${ISSUER}/token` }) };
    }
    return { ok: true, json: async () => ({ keys }) };
  };
  return createKeycloakPort({ issuer: ISSUER, clientId: CLIENT, fetch: fetchImpl, cache: {} });
}

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const soon = Math.floor(NOW / 1000) + 300;

test('un jeton bien signé, bien adressé et non expiré passe', async () => {
  const port = portWithJwks();
  const claims = await port.verifyIdToken(
    makeToken({ sub: 'kc-10', email: 'a@b.ca', iss: ISSUER, aud: CLIENT, exp: soon }),
    NOW
  );
  assert.equal(claims.sub, 'kc-10');
  assert.equal(claims.email, 'a@b.ca');
});

test('une signature invalide est refusée', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: ISSUER, aud: CLIENT, exp: soon }, { key: other }),
    NOW
  );
  assert.equal(out, null);
});

test('« alg: none » est refusé', async () => {
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: ISSUER, aud: CLIENT, exp: soon }, { alg: 'none' }),
    NOW
  );
  assert.equal(out, null);
});

test('un autre émetteur est refusé', async () => {
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: 'http://mechant/realms/nota', aud: CLIENT, exp: soon }),
    NOW
  );
  assert.equal(out, null);
});

test('un jeton destiné à un AUTRE client du même royaume est refusé', async () => {
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: ISSUER, aud: 'un-autre-client', exp: soon }),
    NOW
  );
  assert.equal(out, null, 'sinon le jeton serait rejouable depuis un autre client');
});

test('un jeton expiré est refusé', async () => {
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: ISSUER, aud: CLIENT, exp: Math.floor(NOW / 1000) - 1 }),
    NOW
  );
  assert.equal(out, null);
});

test('une clé inconnue (kid absent du jeu) est refusée', async () => {
  const port = portWithJwks();
  const out = await port.verifyIdToken(
    makeToken({ sub: 'x', email: 'a@b.ca', iss: ISSUER, aud: CLIENT, exp: soon }, { kid: 'inconnu' }),
    NOW
  );
  assert.equal(out, null);
});

test('un jeton malformé ne fait pas lever', async () => {
  const port = portWithJwks();
  for (const bad of [null, '', 'a.b', 'a.b.c.d', 'pas-un-jeton']) {
    assert.equal(await port.verifyIdToken(bad, NOW), null);
  }
});

// --- 4. La pile tolère l'absence du fournisseur ------------------------------

test('sans émetteur configuré, le port se déclare non configuré au lieu de planter', () => {
  const port = createKeycloakPort({ issuer: '', fetch: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(port.isConfigured(), false);
});

test('avec un émetteur, le port est configuré et sait bâtir l\'URL d\'autorisation', () => {
  const port = portWithJwks();
  assert.equal(port.isConfigured(), true);
  const url = port.authorizeUrl({
    redirectUri: 'http://localhost:4173/auth',
    state: 'st',
    codeChallenge: 'ch',
    loginHint: 'a@b.ca',
  });
  assert.ok(url.startsWith(`${ISSUER}/protocol/openid-connect/auth?`));
  assert.ok(url.includes('code_challenge_method=S256'), 'PKCE obligatoire : le client est public');
  assert.ok(url.includes('scope=openid+email'), 'on ne demande que le courriel');
  assert.ok(url.includes('login_hint=a%40b.ca'));
});

test('PKCE : le défi est bien le SHA-256 du vérificateur', () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual(verifier, challenge);
});
