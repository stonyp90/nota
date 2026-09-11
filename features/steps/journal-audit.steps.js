'use strict';

/**
 * Les steps du JOURNAL D'AUDIT (ADR 0036).
 *
 * Le journal se relit ici par la même porte que l'adaptateur DynamoDB expose à
 * la console — `queryTxAuditByDay` — et JAMAIS par une entrée que le test
 * aurait écrite lui-même : ce qui est vérifié, c'est ce que le handler écrit
 * quand un notaire retient, quand un client publie, et quand un acte se règle.
 *
 * Trois promesses, trois familles d'assertions :
 *
 *   l'acteur  — `{ type, id }` sur un vocabulaire fermé, l'identifiant interne
 *               et rien d'autre : ni courriel, ni adresse d'origine.
 *   la borne  — sept ans CALENDAIRES depuis l'horodatage de l'entrée, posés
 *               par l'adaptateur de dépôt (la règle, elle, vit dans le domaine).
 *   l'alarme  — une écriture perdue n'échoue plus en silence ; elle émet la
 *               ligne JSON que le filtre de métrique CloudWatch compte, et
 *               l'argent passe quand même.
 *
 * Ce que ces scénarios NE prouvent PAS, faute de code à interroger : rien dans
 * le produit ne détecte une entrée RÉÉCRITE. L'append-only est tenu par le
 * `attribute_not_exists` de l'adaptateur DynamoDB et par un Deny IAM ; il
 * n'existe aucun chaînage d'empreintes, aucune vérification d'intégrité à la
 * relecture, et l'adaptateur mémoire n'a même pas la garde d'écriture unique.
 */

const assert = require('node:assert/strict');
const { Given, Then, After } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');

// Le vocabulaire fermé de l'ADR 0036. Un type hors de cette liste est un
// acteur que personne n'a décidé.
const TYPES = ['notaire', 'client', 'partenaire', 'systeme'];

async function journal(world) {
  const entrees = await world.repo.queryTxAuditByDay(world.today);
  assert.ok(entrees.length > 0, 'le journal du ' + world.today + ' est vide');
  return entrees;
}

async function trace(world, action) {
  const entrees = await journal(world);
  const trouvees = entrees.filter((e) => e.action === action);
  assert.equal(
    trouvees.length,
    1,
    'exactement une trace « ' + action + ' » attendue, obtenu ' + trouvees.length +
      ' (actions du jour: ' + JSON.stringify(entrees.map((e) => e.action)) + ')'
  );
  return trouvees[0];
}

// --- L'acteur ----------------------------------------------------------------

// Le notaire est nommé par l'identifiant dérivé de sa boîte — celui que porte
// son profil, donc joignable à son nom par une simple jointure. Pas son
// adresse : une adresse recopiée dans un registre gardé sept ans est une
// donnée personnelle de plus, et l'ADR l'exclut nommément.
Then('la trace {string} est signée par le notaire {string}', async function (action, email) {
  const e = await trace(this, action);
  assert.ok(e.acteur, 'la trace « ' + action + ' » ne porte aucun acteur: ' + JSON.stringify(e));
  assert.equal(e.acteur.type, 'notaire');
  assert.equal(e.acteur.id, notaryIdForEmail(email));
  assert.notEqual(e.acteur.id, email, 'le journal ne doit jamais nommer une personne par son adresse');
});

// Le client n'a pas de compte : son dossier EST son identité. L'acteur porte
// donc l'identifiant de l'offre, celui-là même que la trace décrit.
Then('la trace {string} est signée par le client, nommé par son dossier', async function (action) {
  const e = await trace(this, action);
  assert.ok(e.acteur, 'la trace « ' + action + ' » ne porte aucun acteur: ' + JSON.stringify(e));
  assert.equal(e.acteur.type, 'client');
  assert.ok(this.lastBidId, 'aucune offre publiée dans ce scénario');
  assert.equal(e.acteur.id, this.lastBidId);
});

// Le reproche exact de l'audit du 3 septembre 2026 : la piste savait QUOI,
// jamais QUI. Une seule entrée anonyme suffirait à le rétablir.
Then("aucune trace du jour n'est signée par « le système »", async function () {
  const entrees = await journal(this);
  for (const e of entrees) {
    assert.ok(e.acteur && TYPES.includes(e.acteur.type), 'acteur hors vocabulaire: ' + JSON.stringify(e));
    assert.notEqual(e.acteur.type, 'systeme', 'trace anonyme: ' + e.action + ' ' + JSON.stringify(e.acteur));
    assert.ok(e.acteur.id, 'acteur sans identifiant: ' + e.action);
  }
});

// La condition qui rend les sept ans défendables : ce journal-ci ne porte AUCUN
// renseignement personnel. `audit:read` l'ouvre sans `pii:read` — si une
// adresse y entrait, les deux bornes tomberaient d'un coup.
Then("aucune trace du jour ne porte d'adresse courriel ni d'adresse d'origine", async function () {
  const entrees = await journal(this);
  for (const e of entrees) {
    assert.equal(e.email, null, 'une adresse courriel a été consignée: ' + e.action);
    assert.equal(e.ip, null, 'une adresse d’origine a été consignée: ' + e.action);
    assert.equal(e.adminId, null, 'la porte publique n’a aucun administrateur: ' + e.action);
    const brut = JSON.stringify(e);
    assert.ok(!brut.includes('@exemple.ca'), 'une adresse courriel traîne dans la trace: ' + brut);
  }
});

// --- La borne de conservation ------------------------------------------------

Then('chaque trace du jour expire le {string}', async function (echeanceISO) {
  const attendu = Math.floor(Date.parse(echeanceISO) / 1000);
  const entrees = await journal(this);
  for (const e of entrees) {
    assert.equal(typeof e.ttl, 'number', 'la trace « ' + e.action + ' » n’a aucune borne de conservation');
    assert.equal(e.ttl, attendu, 'échéance de « ' + e.action + ' »');
  }
});

// La borne se calcule sur l'horodatage de l'entrée ELLE-MÊME, pas sur l'instant
// de l'écriture ni sur le jour ouvrable : une reprise différée ne doit pas
// rallonger la conservation d'une preuve.
Then("cette échéance est comptée depuis l'horodatage de la trace elle-même", async function () {
  const entrees = await journal(this);
  for (const e of entrees) {
    assert.equal(e.ttl, this.domain.auditRetentionTtl(Date.parse(e.ts)), 'trace: ' + e.action);
  }
});

// Sept fois « même jour, année suivante » — et non 7 × 365 jours, qui perdrait
// les deux journées bissextiles de l'intervalle. Sur une borne de preuve,
// arrondir vers le bas est la seule erreur qui coûte cher.
Then('elle est calendaire : elle tombe deux jours après un compte de sept fois 365 jours', async function () {
  const entrees = await journal(this);
  assert.equal(this.domain.AUDIT_RETENTION_YEARS, 7, 'la politique de conservation nomme sept ans');
  for (const e of entrees) {
    const naif = Math.floor((Date.parse(e.ts) + this.domain.AUDIT_RETENTION_YEARS * 365 * 864e5) / 1000);
    assert.equal((e.ttl - naif) / 86400, 2, 'trace: ' + e.action);
    assert.ok(e.ttl > naif, 'une borne de preuve ne s’arrondit jamais vers le bas');
  }
});

// --- Le puits cassé ----------------------------------------------------------

// Casser l'écriture d'audit, et seulement elle : le dépôt continue de servir
// l'argent, le registre write-once et le relevé. C'est exactement la panne que
// le `catch` avalait en silence — DynamoDB throttlé sur la partition du jour.
Given("le puits d'audit tombe en panne", function () {
  this.audit = { lignes: [] };
  const consoleError = console.error;
  this.audit.restaurer = () => {
    console.error = consoleError;
  };
  console.error = (...args) => {
    this.audit.lignes.push(args.map((a) => String(a)).join(' '));
  };
  this.repo.appendTxAudit = async () => {
    throw new Error('DynamoDB: ProvisionedThroughputExceededException');
  };
});

// Le filet : même si un scénario échoue en plein milieu, la console du
// processus est rendue intacte au suivant.
After(function () {
  if (this.audit && this.audit.restaurer) this.audit.restaurer();
});

// La règle conservée : l'audit ne bloque JAMAIS l'argent. Le registre ACT#
// reste l'autorité comptable, et il a bien été écrit.
Then("l'acte est réglé malgré tout, et inscrit au registre", async function () {
  assert.ok(this.lastBid, 'aucune offre publiée dans ce scénario');
  const regle = await this.repo.getActCompletion(this.lastBid.id);
  assert.ok(regle, 'le registre ACT# est vide alors que la route a répondu 200');
  assert.equal(regle.actAmount, 2800);
});

// Ce que l'alarme compte. Le filtre de métrique CloudWatch cherche la
// SOUS-CHAÎNE « audit_write_failed » — un motif JSON n'apparierait rien, le
// runtime Node préfixant chaque console.error de son horodatage et de son
// identifiant de requête. La ligne doit donc être émise, et nommer l'action
// perdue : sans elle, l'opérateur sait qu'une trace manque sans savoir laquelle.
Then('une alerte {string} a été émise pour l\'action {string}', function (evenement, action) {
  assert.ok(this.audit, 'le puits d’audit n’a pas été mis en panne dans ce scénario');
  const lignes = this.audit.lignes.filter((l) => l.includes(evenement));
  assert.ok(lignes.length > 0, 'aucune alerte émise: ' + JSON.stringify(this.audit.lignes));
  const pour = lignes.map((l) => JSON.parse(l)).filter((o) => o.action === action);
  assert.equal(pour.length, 1, 'une alerte attendue pour « ' + action +' »: ' + JSON.stringify(lignes));
  this.audit.alerte = pour[0];
  assert.equal(this.audit.alerte.level, 'error', 'l’alarme ne compte que les lignes d’erreur');
});

// L'alerte dit qu'une preuve est perdue ; elle n'est pas cette preuve. Recopier
// la trace dans les journaux techniques — bornés à douze mois et lisibles sans
// `audit:read` — contournerait les deux règles que l'ADR pose.
Then("cette alerte nomme le type de l'acteur, sans jamais recopier la trace perdue", function () {
  const alerte = this.audit && this.audit.alerte;
  assert.ok(alerte, 'aucune alerte retenue par le step précédent');
  assert.ok(TYPES.includes(alerte.acteur), 'type d’acteur hors vocabulaire: ' + alerte.acteur);
  assert.equal(alerte.acteur, 'notaire');
  assert.ok(!('meta' in alerte), 'la trace perdue ne doit pas être recopiée dans les journaux techniques');
  assert.ok(!('id' in alerte), 'l’identifiant de l’acteur n’a pas à voyager dans une ligne technique');
  assert.ok(typeof alerte.ts === 'string' && alerte.ts.startsWith(this.today), 'l’alerte doit dater la trace perdue');
});
