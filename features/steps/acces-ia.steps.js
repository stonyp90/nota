'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

const { createApp } = require('../../apps/api/src/handler.js');
const { createNotaryAIAccess, createNotaryAIBilling } = require('../../apps/api/src/ai-access.js');

// --- Le déploiement qui VEND l'IA -------------------------------------------
//
// La monétisation est une décision de déploiement, pas un défaut : sans
// `NOTA_AI_MONETIZATION_ENABLED`, chaque notaire garde l'ancien accès ouvert
// (`legacy_open`) et aucun quota n'existe. Le monde BDD construit son
// application sans ce drapeau — on la RECONSTRUIT donc ici, sur le même
// dépôt et la même horloge gelée, avec les trois pièces réelles du produit :
// le registre d'accès, la facturation IA et un port de modèle en mémoire.
// Rien du module sous test n'est simulé : seuls le réseau (Stripe) et le
// modèle de langage le sont.

function armerIA(world) {
  const env = {
    ...process.env,
    NOTA_OPERATOR_EMAIL: world.operatorEmail,
    NOTA_AI_MONETIZATION_ENABLED: 'true',
    NOTA_FINANCING_AI_ENABLED: 'true',
    // Le prix Stripe de la formule : sans lui, la porte de paiement répond
    // « prix_non_configure » — et c'est le comportement de la production tant
    // que l'opérateur n'a pas posé ses prix.
    NOTA_AI_PRICE_ESSENTIEL: 'price_ai_essentiel',
  };
  world.iaEnv = env;
  world.iaAccess = createNotaryAIAccess({ repo: world.repo, env, nowMs: () => world.nowMs });

  // Stripe, sans SDK ni réseau : chaque session de paiement demandée est
  // enregistrée pour qu'un scénario prouve ce qui a été demandé, et à qui.
  world.iaStripe = {
    sessions: [],
    async createNotaryAISubscription(args) {
      world.iaStripe.sessions.push({ kind: 'subscription', ...args });
      return { sessionId: 'cs_ai_sub_' + args.planId, url: world.baseUrl + '/checkout/ia/' + args.planId };
    },
    async createNotaryAIUsagePayment(args) {
      world.iaStripe.sessions.push({ kind: 'usage', ...args });
      return { sessionId: 'cs_ai_usage_' + args.planId, url: world.baseUrl + '/checkout/ia/unites' };
    },
  };
  world.iaBilling = createNotaryAIBilling({
    stripe: world.iaStripe, access: world.iaAccess, env, siteUrl: world.baseUrl,
  });

  // Le modèle, en mémoire. Il rend une extraction VALIDE au sens du domaine :
  // la preuve cite la page qu'on lui a donnée, sinon le domaine la rejette.
  world.iaPortAppels = 0;
  const port = {
    model: 'modele-en-memoire',
    async extract(input) {
      world.iaPortAppels += 1;
      const page = input.pages[0];
      return {
        extraction: {
          fields: [{
            fieldId: 'lender_name',
            value: 'Banque Exemple',
            evidence: [{ documentId: page.documentId, page: page.page, quote: page.text }],
          }],
        },
      };
    },
  };

  let seq = 0;
  world.app = createApp(world.repo, {
    now: () => world.today,
    nowMs: () => world.nowMs,
    newId: () => 'ia-' + ++seq,
    notifier: world.notifier,
    supportUrl: world.baseUrl,
    siteUrl: world.baseUrl,
    // La place de marché reste EXACTEMENT celle des autres scénarios : vendre
    // l'IA au notaire ne branche aucun paiement du côté du client.
    billingConfigured: false,
    env,
    aiAccess: world.iaAccess,
    aiBilling: world.iaBilling,
    financingAIPort: port,
  });
}

// --- Session notaire (même poignée de main que les autres suites) -----------

async function notarySession(world, email) {
  world.notaryTokens = world.notaryTokens || {};
  if (world.notaryTokens[email]) return world.notaryTokens[email];
  const req = await world.app.handle({ method: 'POST', path: '/notary/session/request', body: JSON.stringify({ email }) });
  assert.equal(req.statusCode, 200, 'demande de lien notaire: ' + req.body);
  const devToken = JSON.parse(req.body).devToken;
  assert.ok(devToken, 'le lien de connexion doit être renvoyé hors production: ' + req.body);
  const res = await world.app.handle({ method: 'POST', path: '/notary/session/verify', body: JSON.stringify({ token: devToken }) });
  assert.equal(res.statusCode, 200, 'ouverture de session notaire: ' + res.body);
  world.notaryTokens[email] = JSON.parse(res.body).token;
  return world.notaryTokens[email];
}

const PRICING = {
  valeur_pret: 250000, succession: 'non', approbation_bancaire: 'obtenue',
  preteur: 'banque_nationale', deplacement: 'client_50',
};

async function publierRefinancement(world, montant, jours, courriel) {
  const dateISO = world.domain.addDays(world.today, jours);
  await world.request({
    method: 'POST',
    path: '/bids',
    body: JSON.stringify({ serviceId: 'refinancement', dateISO, montant, courriel, prefixe: 'G1R', pricing: { ...PRICING } }),
  });
  assert.equal(world.response.statusCode, 201, 'publication: ' + world.response.body);
  return world.responseJson;
}

// Une préparation par appel, et jamais deux fois la même : le texte des pages
// entre dans l'empreinte de la requête, et une empreinte déjà connue est
// REJOUÉE sans consommer d'unité. Un scénario qui l'ignorerait croirait avoir
// épuisé un quota qu'il n'a jamais entamé.
async function preparer(world, email) {
  const token = await notarySession(world, email);
  const acte = world.acteIA;
  assert.ok(acte, 'aucun acte retenu pour la préparation IA');
  world.iaPreparations = (world.iaPreparations || 0) + 1;
  await world.request({
    method: 'POST',
    path: '/notary/financing/preparation',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({
      id: acte.id, dateISO: acte.dateISO, processingAuthorized: true,
      pages: [{ documentId: 'offre', page: 1, text: 'Prêteur : Banque Exemple, dossier ' + world.iaPreparations + '.' }],
    }),
  });
}

async function lireAcces(world, email) {
  const token = await notarySession(world, email);
  await world.request({ method: 'GET', path: '/notary/ai-access', headers: { authorization: 'Bearer ' + token }, query: {} });
  assert.equal(world.response.statusCode, 200, 'accès IA: ' + world.response.body);
  world.iaVue = world.responseJson;
  return world.iaVue;
}

// --- Given ------------------------------------------------------------------

Given('l\'accès IA payant est activé sur ce déploiement', function () {
  armerIA(this);
});

Given('le notaire {string} a retenu une demande de refinancement', async function (email) {
  this.notaireIA = email;
  const publie = await publierRefinancement(this, 2400, 21, 'client-ia@exemple.ca');
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST',
    path: '/notary/bids/accept',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ id: publie.bid.id, dateISO: publie.bid.dateISO }),
  });
  assert.equal(this.response.statusCode, 200, 'rétention: ' + this.response.body);
  this.acteIA = publie.bid;
});

Given('un client publie une demande de refinancement à {int} $ dans {int} jours', async function (montant, jours) {
  const publie = await publierRefinancement(this, montant, jours, 'client@exemple.ca');
  this.demandeClient = publie.bid;
  this.clientToken = publie.clientToken;
});

// Ce que le client voit de sa demande : le carnet public de son mois, et sa
// propre vue de l'offre. Les deux sont figés ici, octet pour octet.
async function vueClient(world) {
  const mois = world.demandeClient.dateISO.slice(0, 7);
  await world.request({ method: 'GET', path: '/bids', query: { month: mois } });
  assert.equal(world.response.statusCode, 200, world.response.body);
  const carnet = JSON.stringify(world.responseJson.bids);
  await world.request({
    method: 'GET',
    path: '/client/bid',
    headers: { authorization: 'Bearer ' + world.clientToken },
    query: { id: world.demandeClient.id, dateISO: world.demandeClient.dateISO },
  });
  assert.equal(world.response.statusCode, 200, world.response.body);
  return { carnet, offre: JSON.stringify(world.responseJson.bid) };
}

Given('je note ce que le client voit de sa demande', async function () {
  this.vueClientAvant = await vueClient(this);
});

// --- When -------------------------------------------------------------------

When('le notaire {string} consulte son accès IA', async function (email) {
  await lireAcces(this, email);
});

When('le notaire {string} s\'inscrit à la bêta IA', async function (email) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/ai-beta/enroll',
    headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({}),
  });
  assert.equal(this.response.statusCode, 200, 'inscription bêta: ' + this.response.body);
  this.iaVue = this.responseJson.access;
});

When('le notaire {string} prépare le dossier avec l\'IA', async function (email) {
  await preparer(this, email);
});

When('le notaire {string} épuise ses essais de préparation', async function (email) {
  for (let i = 0; i < this.domain.NOTARY_AI_BETA_TRIAL_USES; i += 1) {
    await preparer(this, email);
    assert.equal(this.response.statusCode, 200, 'préparation ' + (i + 1) + ': ' + this.response.body);
  }
  await lireAcces(this, email);
});

When('le notaire {string} choisit la formule {string}', async function (email, planId) {
  const token = await notarySession(this, email);
  await this.request({
    method: 'POST', path: '/notary/ai/checkout',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ kind: 'subscription', planId }),
  });
});

// Stripe a encaissé : l'événement redescend par la facturation IA réelle, la
// même fonction que le webhook appelle en production.
When('Stripe confirme la formule {string} pour {string}', async function (planId, email) {
  const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');
  const result = await this.iaBilling.applyEvent({
    id: 'evt_ai_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_ai_sub_' + planId, metadata: { product: 'nota_ai_subscription', notaryId: notaryIdForEmail(email), planId } } },
  });
  assert.equal(result.handled, true, 'l’événement Stripe doit être appliqué');
});

// --- Then -------------------------------------------------------------------

Then('l\'accès IA est fermé, motif {string}', function (motif) {
  assert.equal(this.iaVue.enabled, false, JSON.stringify(this.iaVue));
  assert.equal(this.iaVue.reason, motif);
});

Then('l\'accès IA est ouvert, motif {string}', function (motif) {
  assert.equal(this.iaVue.enabled, true, JSON.stringify(this.iaVue));
  assert.equal(this.iaVue.reason, motif);
});

// Le code ET le message : la console affiche le message tel quel, il doit donc
// parler du quota, pas d'une inscription.
Then('le refus IA porte le motif {string} et son message', function (code) {
  const erreur = this.responseJson.errors && this.responseJson.errors[0];
  assert.ok(erreur, 'aucune erreur dans la réponse: ' + this.response.body);
  assert.equal(erreur.code, code, this.response.body);
  assert.equal(erreur.message, 'Votre quota de préparation IA est épuisé. Choisissez une formule ou achetez des unités.');
});

Then('aucun essai de bêta n\'est entamé', function () {
  assert.equal(this.iaVue.beta.enrolled, false);
  assert.equal(this.iaVue.beta.used, 0);
  assert.equal(this.iaVue.beta.remaining, 0, 'une bêta non réclamée ne donne aucun essai');
});

Then('le barème d\'accès annonce les formules du domaine', function () {
  assert.deepEqual(
    this.iaVue.plans.map((p) => p.id),
    this.domain.NOTARY_AI_PLANS.map((p) => p.id),
    'les formules affichées viennent du domaine, jamais du navigateur'
  );
});

Then('il reste {int} essai(s) de bêta', function (n) {
  assert.equal(this.iaVue.beta.remaining, n, JSON.stringify(this.iaVue.beta));
});

Then('le modèle n\'a été appelé que {int} fois', function (n) {
  assert.equal(this.iaPortAppels, n, 'un refus doit arriver AVANT le modèle, jamais après');
});

Then('ce nombre est celui que le domaine documente', function () {
  assert.equal(this.iaVue.beta.granted, this.domain.NOTARY_AI_BETA_TRIAL_USES);
  assert.equal(this.iaVue.beta.remaining, this.domain.NOTARY_AI_BETA_TRIAL_USES);
});

Then('le notaire est envoyé payer chez Stripe pour la formule {string}', function (planId) {
  assert.ok(this.responseJson.url, 'une adresse de paiement est rendue: ' + this.response.body);
  const session = this.iaStripe.sessions.find((s) => s.kind === 'subscription' && s.planId === planId);
  assert.ok(session, 'aucune session d’abonnement demandée: ' + JSON.stringify(this.iaStripe.sessions));
});

Then('la formule laisse {int} préparations incluses', async function (n) {
  await lireAcces(this, this.notaireIA);
  assert.equal(this.iaVue.subscription.remaining, n, JSON.stringify(this.iaVue.subscription));
});

Then('ce que le client voit de sa demande n\'a pas changé', async function () {
  const apres = await vueClient(this);
  assert.equal(apres.carnet, this.vueClientAvant.carnet, 'le carnet public a bougé');
  assert.equal(apres.offre, this.vueClientAvant.offre, 'la vue du client a bougé');
  this.vueClientApres = apres;
});

Then('aucune formule IA n\'apparaît dans ce que le client voit', function () {
  const vu = this.vueClientApres.carnet + this.vueClientApres.offre;
  for (const plan of this.domain.NOTARY_AI_PLANS) {
    assert.equal(vu.includes(plan.id), false, 'la formule ' + plan.id + ' ne regarde pas le client');
    assert.equal(vu.includes(String(plan.monthlyCents)), false, 'le prix d’une formule ne regarde pas le client');
  }
  for (const mot of ['aiAccess', 'monthlyCents', 'beta']) {
    assert.equal(vu.includes(mot), false, '« ' + mot + ' » ne regarde pas le client');
  }
});
