'use strict';

// L'accès à la console d'administration (rbac.js + admin.js + admin-handler.js),
// traversé en HTTP comme le fait la vraie Lambda admin. Rien n'est simulé : les
// permissions sont résolues par le VRAI `rbac.resolvePermissions`, la session
// est une vraie session serveur, et le lien magique est vraiment échangé. Seuls
// le postier et l'horloge sont des doublures, comme partout dans cette suite.
const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

const { adminIdForEmail } = require('../../apps/api/src/admin-auth.js');

// « GET /admin/audit?jour=2026-08-12 » → la requête normalisée qu'attend le
// handler. Le chemin reste encodé tel quel : c'est lui qui décode, et une
// adresse courriel voyage dans le chemin (région « usagers »).
function porte(spec) {
  const m = /^([A-Z]+)\s+(\S+)$/.exec(String(spec || '').trim());
  assert.ok(m, 'porte illisible : ' + spec);
  const [chemin, requete] = m[2].split('?');
  return {
    method: m[1],
    path: chemin,
    query: Object.fromEntries(new URLSearchParams(requete || '')),
  };
}

// Le registre des jetons ouverts pendant le scénario, par adresse.
function jetons(world) {
  if (!world.adminJetons) world.adminJetons = {};
  return world.adminJetons;
}

// L'ouverture de session COMPLÈTE, telle qu'un opérateur la vit : une demande
// de lien, puis l'échange de ce lien contre une session. Le lien n'est lisible
// que parce que le déploiement n'est pas la production (`devEcho`) ; en
// production il part par courriel et rien d'autre ne change.
async function ouvrirSession(world, email) {
  if (!world.adminAllowlist.includes(email)) {
    world.adminAllowlist.push(email);
    // La liste blanche est figée à la construction du use-case : la reconstruire
    // est le seul moyen honnête d'y inscrire une adresse. Tout l'état (comptes,
    // sessions, journal) vit dans le dépôt et traverse la reconstruction.
    world.buildAdminApp();
  }

  await world.requestAdmin({
    method: 'POST',
    path: '/admin/auth/request',
    headers: {},
    body: JSON.stringify({ email }),
    sourceIp: '198.51.100.7',
  });
  assert.equal(world.adminResponse.statusCode, 200, world.adminResponse.body);
  const lien = world.adminResponseJson.devLink;
  assert.ok(lien, "la demande de lien n'a rien rendu pour " + email);
  const lienJeton = decodeURIComponent(lien.split('token=')[1]);

  await world.requestAdmin({
    method: 'POST',
    path: '/admin/auth/verify',
    headers: {},
    body: JSON.stringify({ token: lienJeton }),
    sourceIp: '198.51.100.7',
  });
  assert.equal(world.adminResponse.statusCode, 200, world.adminResponse.body);
  const session = world.adminResponseJson.session;
  assert.ok(session, "l'échange n'a délivré aucun jeton de session");

  jetons(world)[email] = { session, lien: lienJeton };
  return session;
}

// --- Étant donné -------------------------------------------------------------

// Une adresse inscrite à la liste blanche et INCONNUE du dépôt : l'amorçage en
// fait l'administratrice principale, celle qui porte le joker.
Given('une administratrice principale {string}', async function (email) {
  await ouvrirSession(this, email);
});

// Un compte qui existe AVANT sa première connexion, sans rôle : ses seuls
// accès sont les clés qu'on lui a accordées, une par une. L'ouverture de
// session ne doit rien y ajouter.
Given('une opératrice {string} qui détient {string}', async function (email, cles) {
  const permissions = String(cles)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await this.repo.putAdmin({
    id: adminIdForEmail(email),
    email,
    role: null,
    disabled: false,
    permissions,
    createdAt: new Date(this.nowMs).toISOString(),
  });
  await ouvrirSession(this, email);
});

// --- Quand -------------------------------------------------------------------

When('{string} ouvre {string}', async function (email, spec) {
  const jeton = jetons(this)[email];
  assert.ok(jeton, 'aucune session ouverte pour ' + email);
  await this.requestAdmin({
    ...porte(spec),
    headers: { authorization: 'Bearer ' + jeton.session },
    sourceIp: '198.51.100.7',
  });
});

When('{string} envoie {string} avec le corps:', async function (email, spec, corps) {
  const jeton = jetons(this)[email];
  assert.ok(jeton, 'aucune session ouverte pour ' + email);
  await this.requestAdmin({
    ...porte(spec),
    headers: { authorization: 'Bearer ' + jeton.session },
    body: corps,
    sourceIp: '198.51.100.7',
  });
});

When('un inconnu ouvre {string}', async function (spec) {
  await this.requestAdmin({ ...porte(spec), headers: {}, sourceIp: '198.51.100.7' });
});

// L'horloge du World est lue à chaque appel : la session déjà ouverte voit
// vraiment le temps passer, sans que rien ne soit reconstruit.
When('{int} minutes s\'écoulent sans la moindre requête', function (minutes) {
  this.nowMs += minutes * 60 * 1000;
});

// Un seul caractère du CORPS du jeton — la signature reste celle de l'original,
// donc le HMAC ne recolle plus.
When('le jeton de session de {string} est retouché', function (email) {
  const jeton = jetons(this)[email];
  assert.ok(jeton, 'aucune session ouverte pour ' + email);
  const point = jeton.session.indexOf('.');
  const charge = jeton.session.slice(0, point);
  const signature = jeton.session.slice(point + 1);
  const retouche = charge.slice(0, -2) + (charge.endsWith('AA') ? 'BB' : 'AA');
  jeton.session = retouche + '.' + signature;
});

// La PORTÉE : le jeton du lien de courriel est bon pour UNE chose — l'échanger
// contre une session. Présenté à une porte protégée, il ne vaut rien, même
// signé, même frais.
When('{string} présente le jeton de son lien de courriel au lieu de sa session', function (email) {
  const jeton = jetons(this)[email];
  assert.ok(jeton, 'aucune session ouverte pour ' + email);
  jeton.session = jeton.lien;
});

// --- Alors -------------------------------------------------------------------

Then('la console répond avec le statut {int}', function (statut) {
  assert.equal(this.adminResponse.statusCode, statut, 'corps: ' + this.adminResponse.body);
});

Then('la console refuse avec le statut {int} et le code {string}', function (statut, code) {
  assert.equal(this.adminResponse.statusCode, statut, 'corps: ' + this.adminResponse.body);
  const codes = (this.adminResponseJson.errors || []).map((e) => e.code);
  assert.ok(codes.includes(code), `attendu ${code}, obtenu ${JSON.stringify(codes)}`);
});

// Un refus SILENCIEUX — une liste vide, un 200 sans rien — se lit comme « il n'y
// a rien à voir » au lieu de « vous n'avez pas le droit ». Le corps d'un refus
// ne porte donc QUE ses erreurs.
Then('le refus ne livre aucune donnée', function () {
  const corps = this.adminResponseJson;
  assert.deepEqual(
    Object.keys(corps),
    ['errors'],
    'un refus ne doit rien porter d’autre que ses erreurs : ' + this.adminResponse.body
  );
  assert.ok(Array.isArray(corps.errors) && corps.errors.length >= 1);
  for (const e of corps.errors) {
    assert.ok(e && e.code, 'chaque erreur porte un code');
    assert.ok(e.message, 'chaque erreur porte un message lisible');
  }
});

Then('la réponse de la console porte {string}', function (cle) {
  const corps = this.adminResponseJson;
  assert.ok(
    Object.prototype.hasOwnProperty.call(corps, cle),
    `la réponse devait porter « ${cle} » : ` + this.adminResponse.body
  );
});

Then('le lien de courriel de {string} a été échangé contre un jeton de session', function (email) {
  const jeton = jetons(this)[email];
  assert.ok(jeton && jeton.session, 'aucune session délivrée pour ' + email);
  assert.notEqual(jeton.session, jeton.lien, 'la session n’est pas le jeton du lien');
  assert.match(jeton.session, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'un jeton signé, en deux parties');
});

Then('la console reconnaît {string}', function (email) {
  assert.equal(this.adminResponseJson.email, email);
});

// --- Un refus laisse une trace (ADR 0036, amendement du 2026-09-11) ----------
// Le journal se relit par la porte du dépôt que la console elle-même utilise,
// comme dans journal-audit.steps.js — jamais par une entrée écrite par le test.

const { createHash } = require('node:crypto');

async function tracesRefus(world, action) {
  const entrees = await world.repo.queryAuditByDay(world.today);
  return entrees.filter((e) => e.action === action);
}

// Signée comme tout geste de la console : l'identifiant interne ET le courriel
// de l'opératrice — ce sont des employés nommés (règle antérieure à l'ADR,
// inchangée), et l'IP d'origine de la requête.
Then("le journal porte une seule trace {string}, signée par l'opératrice {string}", async function (action, email) {
  const traces = await tracesRefus(this, action);
  assert.equal(traces.length, 1, 'exactement une trace « ' + action + ' », obtenu ' + JSON.stringify(traces));
  const [t] = traces;
  assert.equal(t.adminId, adminIdForEmail(email), 'la trace nomme l’opératrice refusée');
  assert.equal(t.email, email);
  assert.equal(t.ip, '198.51.100.7', 'l’origine de la requête refusée est consignée');
  assert.equal(typeof t.ttl, 'number', 'la trace expire comme les autres (sept ans)');
  this.derniereTraceRefus = t;
});

Then('cette trace nomme la porte {string} et la permission manquante {string}', function (porte, permission) {
  const t = this.derniereTraceRefus;
  assert.ok(t, 'aucune trace de refus retenue par le step précédent');
  assert.equal(t.meta && t.meta.porte, porte);
  assert.equal(t.meta && t.meta.permission, permission);
});

// Une trace de refus qui recopierait le dossier — ou l'adresse — deviendrait
// elle-même la fuite qu'elle est censée rendre reprochable. Le sujet est nommé
// par la même empreinte que « dossier_usager_consulte », et rien d'autre.
Then("cette trace nomme le sujet par son empreinte, jamais par l'adresse {string}", function (adresse) {
  const t = this.derniereTraceRefus;
  assert.ok(t, 'aucune trace de refus retenue par le step précédent');
  const empreinte = createHash('sha256').update(adresse.toLowerCase()).digest('hex').slice(0, 16);
  assert.equal(t.meta.sujet, empreinte, 'même empreinte que la consultation réussie');
  const brut = JSON.stringify(t).toLowerCase();
  assert.ok(!brut.includes(adresse.toLowerCase()), 'l’adresse du sujet traîne dans la trace : ' + brut);
  assert.ok(!brut.includes(adresse.split('@')[0].toLowerCase()), 'la partie locale de l’adresse traîne dans la trace');
  assert.deepEqual(Object.keys(t.meta).sort(), ['permission', 'porte', 'sujet'], 'ni offres, ni paiements, ni consentements');
});

Then("les traces {string} du jour nomment, dans l'ordre, les portes {string}", async function (action, portes) {
  const traces = await tracesRefus(this, action);
  assert.deepEqual(traces.map((t) => t.meta && t.meta.porte), portes.split(',').map((s) => s.trim()));
});

Then("les traces {string} du jour nomment, dans l'ordre, les permissions {string}", async function (action, permissions) {
  const traces = await tracesRefus(this, action);
  assert.deepEqual(traces.map((t) => t.meta && t.meta.permission), permissions.split(',').map((s) => s.trim()));
});

Then('le journal du jour ne porte aucune trace {string}', async function (action) {
  const traces = await tracesRefus(this, action);
  assert.deepEqual(traces, []);
});
