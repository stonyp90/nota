'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { createApp } = require('../../apps/api/src/handler.js');
const { createOutlook } = require('../../apps/api/src/outlook.js');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// --- Le fournisseur, sans réseau ---------------------------------------------
// Seul le port SORTANT est feint : l'échange de jeton et la lecture du
// calendrier Microsoft. Le service OAuth, le chiffrement, la machine à états et
// les routes HTTP sont ceux de production — c'est précisément ce qu'on
// spécifie. L'horloge du consentement est distincte de celle de Nota : une
// autorisation expire en dix minutes, et le scénario les avance à la main.
const ENV_OUTLOOK = Object.freeze({
  NOTA_OUTLOOK_CLIENT_ID: 'client-nota',
  NOTA_OUTLOOK_CLIENT_SECRET: 'secret-nota',
  NOTA_CALENDAR_ENCRYPTION_KEY: 'ab'.repeat(32),
  NOTA_OUTLOOK_REDIRECT_URI: 'https://nota.example/api/calendar/outlook/callback',
});

// Le jeton de renouvellement que Microsoft rendrait. Il ne doit JAMAIS
// réapparaître tel quel dans le dépôt ni dans une réponse de l'API.
const REFRESH_EN_CLAIR = 'refresh-token-en-clair';

function installerOutlook(world, { configure = true, enPanne = false } = {}) {
  world.outlookCalls = [];
  world.outlookClock = 1_000;
  const fetch = async (url, opts) => {
    world.outlookCalls.push({ url, opts });
    if (enPanne) return { ok: false, status: 503, json: async () => ({}) };
    if (url.endsWith('/token')) {
      return { ok: true, json: async () => ({ access_token: 'access', refresh_token: REFRESH_EN_CLAIR, scope: 'Calendars.ReadWrite' }) };
    }
    return { ok: true, json: async () => ({ id: 'calendrier-notaire', owner: { address: 'owner@example.test' } }) };
  };
  world.outlookService = createOutlook({
    repo: world.repo,
    env: configure ? ENV_OUTLOOK : {},
    fetch,
    now: () => world.outlookClock,
  });
  // La même application que celle du monde, mais avec le port Outlook branché :
  // les deux partagent le dépôt, donc l'offre déjà retenue et le flux .ics
  // restent exactement les mêmes.
  world.outlookApp = createApp(world.repo, {
    now: () => world.today,
    nowMs: () => world.nowMs,
    outlook: world.outlookService,
  });
}

// --- Session notaire ----------------------------------------------------------
// Même poignée de main que les autres suites, sur l'application du monde (le
// lien magique est renvoyé hors production). Le jeton est signé par le même
// secret de processus, donc il vaut sur les deux applications.
async function sessionNotaire(world, email) {
  world.outlookSessions = world.outlookSessions || {};
  if (world.outlookSessions[email]) return world.outlookSessions[email];
  const req = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(req.statusCode, 200, 'demande de lien notaire: ' + req.body);
  const res = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: JSON.parse(req.body).devToken }) });
  assert.equal(res.statusCode, 200, 'ouverture de session notaire: ' + res.body);
  return (world.outlookSessions[email] = JSON.parse(res.body));
}

function app(world) {
  assert.ok(world.outlookApp, 'aucun déploiement Outlook installé par le scénario');
  return world.outlookApp;
}

// Le premier segment du témoin déposé par /connect — ce que le navigateur
// renverrait sur le retour du fournisseur.
function temoin(world) {
  assert.ok(world.outlookSetCookie, 'aucun témoin de liaison n’a été déposé');
  return world.outlookSetCookie.split(';')[0];
}

async function demanderConsentement(world, email, { scope = 'session' } = {}) {
  const session = await sessionNotaire(world, email);
  const jeton = scope === 'feed' ? session.feedToken : session.token;
  world.outlookResponse = await app(world).handle({
    method: 'POST',
    path: '/notary/calendar/outlook/connect',
    headers: { authorization: 'Bearer ' + jeton },
  });
  world.outlookConnectResponse = world.outlookResponse;
  if (world.outlookResponse.statusCode === 200) {
    world.outlookAuthUrl = new URL(JSON.parse(world.outlookResponse.body).url);
    world.outlookSetCookie = world.outlookResponse.headers['set-cookie'];
  }
  return world.outlookResponse;
}

async function retourDuFournisseur(world, { cookie, extra = {} } = {}) {
  assert.ok(world.outlookAuthUrl, 'aucun consentement n’a été demandé');
  world.outlookResponse = await app(world).handle({
    method: 'GET',
    path: '/calendar/outlook/callback',
    query: { state: world.outlookAuthUrl.searchParams.get('state'), code: 'code-du-fournisseur', ...extra },
    headers: cookie === null ? {} : { cookie: cookie || temoin(world) },
  });
  return world.outlookResponse;
}

async function statut(world, email) {
  const session = await sessionNotaire(world, email);
  const response = await app(world).handle({
    method: 'GET',
    path: '/notary/calendar/outlook',
    headers: { authorization: 'Bearer ' + session.token },
  });
  assert.equal(response.statusCode, 200, 'statut du calendrier: ' + response.body);
  return JSON.parse(response.body);
}

// --- Étant donné : le déploiement ---------------------------------------------

Given('Outlook est configuré', function () {
  installerOutlook(this);
});

Given('Outlook est configuré mais le fournisseur est en panne', function () {
  installerOutlook(this, { enPanne: true });
});

Given('aucune configuration Outlook n\'est déployée', function () {
  installerOutlook(this, { configure: false });
});

// --- Quand : le branchement ----------------------------------------------------

Given('le notaire {string} demande un consentement Outlook', async function (email) {
  await demanderConsentement(this, email);
});

When('le jeton de flux de {string} demande un consentement Outlook', async function (email) {
  await demanderConsentement(this, email, { scope: 'feed' });
});

// Le branchement complet : le consentement, puis le retour du fournisseur.
Given('le notaire {string} branche son calendrier Outlook', async function (email) {
  const started = await demanderConsentement(this, email);
  if (started.statusCode !== 200) return; // un déploiement sans Outlook s'arrête ici
  await retourDuFournisseur(this);
});

Given('le notaire {string} a branché son calendrier Outlook', async function (email) {
  assert.equal((await demanderConsentement(this, email)).statusCode, 200, this.outlookResponse.body);
  const retour = await retourDuFournisseur(this);
  assert.equal(retour.statusCode, 303, 'le branchement devait aboutir: ' + retour.body);
});

When('le notaire {string} débranche son calendrier Outlook', async function (email) {
  const session = await sessionNotaire(this, email);
  this.outlookResponse = await app(this).handle({
    method: 'DELETE',
    path: '/notary/calendar/outlook',
    headers: { authorization: 'Bearer ' + session.token },
  });
  assert.equal(this.outlookResponse.statusCode, 200, 'débranchement: ' + this.outlookResponse.body);
  assert.deepEqual(JSON.parse(this.outlookResponse.body), { connected: false });
});

When('le fournisseur renvoie le notaire à Nota', async function () {
  await retourDuFournisseur(this);
});

When('le fournisseur renvoie le notaire à Nota avec le refus {string}', async function (refus) {
  await retourDuFournisseur(this, { extra: { error: refus } });
});

When('le fournisseur renvoie le notaire à Nota depuis un autre navigateur', async function () {
  await retourDuFournisseur(this, { cookie: 'nota_outlook_binding=un-autre-navigateur' });
});

When('le consentement Outlook traîne plus de dix minutes', function () {
  // Dix minutes et une milliseconde : la fenêtre d'autorisation est close.
  this.outlookClock += 600_001;
});

// --- Alors ---------------------------------------------------------------------

Then('le consentement demandé porte une preuve PKCE en {string}', function (methode) {
  // Le geste examiné est la DEMANDE de consentement, pas le retour qui l'a suivie.
  assert.equal(this.outlookConnectResponse.statusCode, 200, this.outlookConnectResponse.body);
  assert.equal(this.outlookAuthUrl.searchParams.get('code_challenge_method'), methode);
  assert.ok(this.outlookAuthUrl.searchParams.get('code_challenge'), 'aucune empreinte du vérificateur');
  // Le vérificateur lui-même ne quitte jamais le serveur.
  assert.equal(this.outlookAuthUrl.searchParams.get('code_verifier'), null);
  assert.match(this.outlookSetCookie, /HttpOnly; Secure; SameSite=Lax/);
});

Then('le calendrier de {string} est branché au compte {string}', async function (email, compte) {
  assert.equal(this.outlookResponse.statusCode, 303, 'le retour du fournisseur: ' + this.outlookResponse.body);
  assert.equal(this.outlookResponse.headers.location, '/#t=notaires');
  assert.deepEqual(await statut(this, email), { configured: true, connected: true, account: compte });
});

Then('le calendrier de {string} n\'est plus branché', async function (email) {
  const s = await statut(this, email);
  assert.equal(s.connected, false, JSON.stringify(s));
});

Then('le calendrier de {string} se dit non configuré', async function (email) {
  assert.deepEqual(await statut(this, email), { configured: false, connected: false });
});

// Le droit d'accès est RENOUVELABLE — c'est un jeton de renouvellement qui est
// conservé — mais il est scellé : ni le dépôt ni l'API ne le rendent en clair.
Then('le droit d\'accès renouvelable de {string} n\'est jamais lisible en clair', async function (email) {
  const record = await this.repo.getCalendar(notaryIdForEmail(email));
  assert.ok(record && record.credentials, 'aucun droit d’accès conservé');
  assert.ok(!JSON.stringify(record).includes(REFRESH_EN_CLAIR), 'le jeton de renouvellement est en clair dans le dépôt');
  const s = await statut(this, email);
  assert.ok(!JSON.stringify(s).includes(REFRESH_EN_CLAIR), 'le jeton de renouvellement ressort par l’API');
  assert.deepEqual(Object.keys(s).sort(), ['account', 'configured', 'connected']);
});

Then('le branchement est refusé avec le code {string} et le statut {int}', function (code, statusCode) {
  assert.equal(this.outlookResponse.statusCode, statusCode, this.outlookResponse.body);
  const errors = JSON.parse(this.outlookResponse.body).errors;
  assert.deepEqual(errors.map((e) => e.code), [code]);
  // Rien du fournisseur ne transpire dans la réponse.
  assert.ok(!/microsoftonline|graph\.microsoft/.test(this.outlookResponse.body), this.outlookResponse.body);
});

Then('aucun jeton n\'a été demandé au fournisseur', function () {
  const jetons = (this.outlookCalls || []).filter((c) => c.url.endsWith('/token'));
  assert.equal(jetons.length, 0, 'le fournisseur a été appelé ' + jetons.length + ' fois');
});
