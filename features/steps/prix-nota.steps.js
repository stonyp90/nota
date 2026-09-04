'use strict';

/**
 * Les steps du PRIX DE NOTA (ADR 0031).
 *
 * Jusqu'au 1er septembre 2026, Nota prélevait une part des honoraires du
 * notaire, et la cote sur 100 décidait de cette part. Quatre textes condamnent
 * cette mécanique ; le modèle a changé, et ces steps décrivent le nouveau :
 *
 *   honoraires — le montant offert par le client, qui va au notaire EN ENTIER
 *   prix Nota  — un montant fixe, le même pour tous, payé par le client À CÔTÉ
 *   total      — ce que la carte autorise, et la borne haute de la capture
 *
 * Rien ici ne divise, ne compare ni ne retranche : un scénario qui exprimerait
 * le prix de Nota en pourcentage des honoraires décrirait l'opération que
 * l'art. 32 du Code de déontologie interdit au notaire — et ce serait une
 * pièce écrite par Nota elle-même.
 */

const assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');
const { notaryIdForEmail } = require('../../apps/api/src/notary-auth.js');
const cote = require('../../apps/api/src/cote.js');

const cents = (dollars) => Math.round(Number(dollars) * 100);

function lastBid(world) {
  assert.ok(world.lastBid, 'aucune offre publiée dans ce scénario');
  return world.lastBid;
}

// Le blocage posé sur la carte pour CETTE offre. Il n'y en a qu'un par offre :
// la publication autorise, la signature capture.
function authorizationFor(world) {
  const bid = lastBid(world);
  const a = world.stripe.calls.authorizations.filter((x) => x.bidId === bid.id);
  assert.equal(a.length, 1, 'exactement un blocage attendu sur ' + bid.id + ': ' + JSON.stringify(world.stripe.calls.authorizations));
  return a[0];
}

// La capture-et-transfert de CETTE offre. Indexée par offre (et non par
// position) pour qu'un scénario puisse régler deux actes et comparer.
function transferFor(world, bidId) {
  const id = bidId || lastBid(world).id;
  const t = world.stripe.calls.transfers.filter((x) => x.bidId === id);
  assert.equal(t.length, 1, 'exactement une capture attendue sur ' + id + ': ' + JSON.stringify(world.stripe.calls.transfers));
  return t[0];
}

// --- Le devis, avant l'engagement -------------------------------------------

// ART. 68 du Code de déontologie — « aucune publicité fausse, trompeuse,
// INCOMPLÈTE ou susceptible d'induire en erreur ». Le carnet est la PREMIÈRE
// réponse que le navigateur reçoit : le tarif y voyage, donc le client connaît
// le prix de Nota avant même d'avoir composé une offre.
When('le carnet public du mois {string} est consulté', async function (month) {
  await this.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  this.carnet = this.responseJson;
});

// ADR 0034 — le prix est une GRILLE. Le carnet annonce donc un PLANCHER, dit
// comme tel, ET porte la grille entière : un plancher servi sans sa grille
// laisserait le client découvrir le vrai prix de SON service plus tard, et
// « incomplète » est précisément le mot de l'art. 68.
Then('le carnet annonce le prix du service de Nota, à partir de {int} $', function (plancher) {
  const t = this.carnet.tarif;
  assert.ok(t, 'le carnet ne porte aucun tarif: ' + JSON.stringify(Object.keys(this.carnet)));
  assert.equal(t.prixNotaMinCents, cents(plancher));
  // La grille voyage ENTIÈRE : un service ou un palier manquant, et le devis
  // du client se calculerait sur autre chose que ce que le carnet a annoncé.
  assert.ok(t.grille && t.grille.services && t.grille.garantieDate, 'le tarif ne porte aucune grille: ' + JSON.stringify(t));
  for (const s of this.domain.SERVICES) {
    assert.equal(typeof t.grille.services[s.id], 'number', 'la grille ne tarife pas « ' + s.id + ' »');
  }
  for (const p of this.domain.TIERS) {
    assert.equal(typeof t.grille.garantieDate[p.id], 'number', 'la grille ne tarife pas le palier « ' + p.id + ' »');
  }
  // Et le plancher annoncé EST la cellule la plus basse : un « à partir de »
  // qu'une cellule passerait par-dessous serait un prix d'appel trompeur.
  const cellules = this.domain.SERVICES.map((s) => this.domain.prixNota(s.id, 'standard', t.grille).totalCents);
  assert.equal(t.prixNotaMinCents, Math.min(...cellules), 'le plancher annoncé doit être la cellule la plus basse');
});

// Le prix EXACT d'un service à échéance normale — celui que la carte bloquera.
// L'annonce et la tarification lisent la même grille, par le même calcul.
Then('le carnet tarife {string} à {int} $ à échéance normale', function (serviceId, prix) {
  const t = this.carnet.tarif;
  assert.ok(t && t.grille, 'le carnet ne porte aucune grille');
  assert.equal(this.domain.prixNota(serviceId, 'standard', t.grille).totalCents, cents(prix));
});

// ART. 71 3° du Code de déontologie — quiconque annonce des honoraires doit
// « indiquer si les débours et les taxes sont ou non inclus ». Aujourd'hui ni
// l'un ni l'autre n'existe dans le produit : ni TPS/TVQ, ni droits de
// publication. Le tarif doit donc le DÉCLARER, plutôt que de laisser le client
// lire un « tout compris » qui n'en est pas un.
Then('le carnet déclare que ni les taxes ni les débours ne sont inclus', function () {
  const t = this.carnet.tarif;
  assert.ok(t, 'le carnet ne porte aucun tarif');
  assert.equal(t.taxesIncluses, false, 'le tarif doit dire que les taxes ne sont PAS incluses');
  assert.equal(t.deboursInclus, false, 'le tarif doit dire que les débours ne sont PAS inclus');
});

// --- Ce que la carte bloque, ce que la capture prend --------------------------

Then('la carte du client est bloquée pour {int} $', function (total) {
  assert.equal(authorizationFor(this).amountCents, cents(total));
});

Then('la capture porte {int} $', function (total) {
  assert.equal(transferFor(this).amountCents, cents(total));
});

// ART. 32.1 2° de la Loi sur le notariat — est présumée usurper les fonctions
// de notaire la personne qui « obtient d'un notaire qu'il abandonne une partie
// de ses honoraires et frais ». Le net viré au notaire doit donc être, au cent
// près, le montant qui lui a été offert.
Then('le notaire reçoit {int} $ — la totalité du montant offert', function (net) {
  const t = transferFor(this);
  assert.equal(t.amountCents - t.applicationFeeCents, cents(net));
});

Then('Nota ne garde que son prix : {int} $', function (prix) {
  assert.equal(transferFor(this).applicationFeeCents, cents(prix));
});

// La capture est PARTIELLE (`amount_to_capture`) : le blocage a été posé sur
// l'offre, le règlement est prix sur la valeur déclarée de l'acte, que le
// notaire peut fixer plus bas. Capturer le blocage entier tout en virant le
// net inférieur laisserait la différence chez Nota — et cette différence est
// une part des honoraires du notaire (art. 32.1 2° L.N., art. 32 C.déont.).
Then("l'écart de {int} $ entre le blocage et le règlement ne reste pas chez Nota", async function (ecart) {
  const bid = lastBid(this);
  const a = authorizationFor(this);
  const t = transferFor(this);
  assert.ok(t.amountCents < a.amountCents, 'la capture doit être PARTIELLE');
  assert.equal(a.amountCents - t.amountCents, cents(ecart), 'l’écart attendu entre le blocage et la capture');
  // L'écart n'est pas capturé DU TOUT : Stripe libère le reste du blocage de
  // lui-même. La preuve est dans le registre write-once — le total capturé est
  // exactement la somme des DEUX lignes du règlement, donc l'écart n'a atterri
  // ni dans les honoraires, ni chez Nota.
  const regle = await this.repo.getActCompletion(bid.id);
  assert.ok(regle, 'le registre ACT# doit témoigner du règlement');
  assert.equal(
    regle.honorairesCents + regle.prixNotaCents,
    t.amountCents,
    'la capture ne porte que les deux lignes du règlement'
  );
  assert.equal(t.applicationFeeCents, regle.prixNotaCents, 'Nota n’a pris que son prix');
});

// --- ART. 29.1 : le même prix, quelle que soit la cote ------------------------

// « Le notaire ne peut conclure aucune convention ayant pour effet de mettre en
// péril l'indépendance, le désintéressement, l'objectivité et l'intégrité
// requis pour l'exercice de la profession de notaire. » Un revenu indexé sur
// une note attribuée par une entreprise privée est exactement une telle
// convention. Deux actes identiques réglés par deux notaires opposés doivent
// donc coûter le même prix, au cent près.
Then('les deux règlements coûtent exactement le même prix au client', function () {
  const t = this.stripe.calls.transfers;
  assert.equal(t.length, 2, 'deux règlements attendus: ' + JSON.stringify(t));
  assert.equal(t[0].amountCents, t[1].amountCents, 'le client paie le même total');
  assert.equal(t[0].applicationFeeCents, t[1].applicationFeeCents, 'Nota garde le même prix');
  assert.equal(
    t[0].amountCents - t[0].applicationFeeCents,
    t[1].amountCents - t[1].applicationFeeCents,
    'et chaque notaire reçoit le même net'
  );
});

Then('la cote de {string} dépasse celle de {string} d\'au moins {int} points', async function (fort, faible, ecart) {
  const at = Date.parse(this.today + 'T00:00:00.000Z');
  const coteDe = async (email) => {
    const p = await this.repo.getNotary(notaryIdForEmail(email));
    assert.ok(p, 'notaire inconnu: ' + email);
    return cote.coteFor(p, at).cote;
  };
  const a = await coteDe(fort);
  const b = await coteDe(faible);
  assert.ok(a - b >= ecart, 'les deux cotes doivent être aux antipodes: ' + a + ' vs ' + b);
});

// --- Aucune ligne d'argent ne porte de taux ni de cote ------------------------

// Les clés qu'un modèle de partage laisserait derrière lui. Une seule qui
// reparaît dans une pièce d'argent — relevé, audit, vue client, console —
// et la pièce redécrit un partage d'honoraires.
const CLES_DE_PARTAGE = ['taux', 'tauxEffectif', 'tauxRetenu', 'part', 'paliers', 'plancher', 'prochain', 'cote', 'coteRetenue', 'commission'];

function sansPartage(objet, ou) {
  const brut = JSON.stringify(objet);
  for (const cle of CLES_DE_PARTAGE) {
    assert.equal(
      new RegExp('"' + cle + '"\\s*:').test(brut),
      false,
      ou + ' ne doit porter aucun « ' + cle + ' » : ' + brut
    );
  }
}

Then('aucune ligne du relevé ne porte de taux ni de cote', function () {
  assert.ok(this.releve && this.releve.actes.length, 'relevé vide — rien à vérifier');
  sansPartage(this.releve, 'le relevé du notaire');
});

Then('la ligne du relevé montre {int} $ d\'honoraires et {int} $ pour Nota', function (honoraires, prixNota) {
  const l = this.releve.actes[0];
  assert.equal(l.honoraires, honoraires);
  assert.equal(l.prixNota, prixNota);
  assert.equal(l.net, honoraires, 'le net du notaire EST ses honoraires : rien n’en est retranché');
});

Then("l'entrée d'audit {string} porte {int} $ d'honoraires et {int} $ pour Nota", async function (action, honoraires, prixNota) {
  const entries = await this.repo.queryAuditByDay(this.today);
  const e = entries.find((x) => x.action === action);
  assert.ok(e, 'aucune entrée d’audit « ' + action + ' » : ' + JSON.stringify(entries.map((x) => x.action)));
  assert.equal(e.meta.honoraires, honoraires);
  assert.equal(e.meta.prixNota, prixNota);
  // C'est la pièce qu'un syndic lirait : elle ne doit contenir aucun taux ni
  // aucune cote, sans quoi elle décrit une rémunération indexée sur une note.
  sansPartage(e.meta, 'la piste d’audit');
  this.audit = e;
});

// --- La console du notaire ----------------------------------------------------

Then('sa console ne porte aucun barème : ni taux, ni part, ni palier', function () {
  assert.equal(this.console.commission, undefined, 'la console ne doit plus recevoir de barème');
  sansPartage(this.console.tarif, 'le tarif annoncé au notaire');
  sansPartage(this.console.retained, 'les actes retenus de la console');
});

// ADR 0034 — la console nomme le SERVICE, parce que le prix en dépend. Ce que
// le notaire lit reste une ligne du CLIENT : la grille ne comporte aucune
// dimension qui le concerne, et `sansPartage` ci-dessus le vérifie.
Then('sa console annonce le prix que le CLIENT paie à Nota pour {string} : {int} $', function (serviceId, prix) {
  const t = this.console.tarif;
  assert.ok(t && t.grille, 'la console ne porte aucune grille de prix');
  assert.equal(this.domain.prixNota(serviceId, 'standard', t.grille).totalCents, cents(prix));
});

// --- La vue du client ---------------------------------------------------------

Then('le client voit son acte réglé en deux lignes : {int} $ et {int} $, soit {int} $', function (honoraires, prixNota, total) {
  const acte = this.responseJson.acte;
  assert.ok(acte && acte.complete, 'l’acte doit être réglé: ' + JSON.stringify(acte));
  assert.equal(acte.honoraires, honoraires);
  assert.equal(acte.prixNota, prixNota);
  assert.equal(acte.total, total);
  assert.equal(acte.honoraires + acte.prixNota, acte.total, 'les deux lignes s’additionnent — rien ne se perd');
  sansPartage(acte, 'l’acte tel que le client le voit');
});

// --- ART. 37 : le carnet ne révèle pas qui a été retenu ------------------------

// « Le notaire ne doit pas, à moins que la nature du cas ne l'exige, révéler
// qu'une personne a fait appel à ses services. » Le carnet est PUBLIC et sans
// authentification : y nommer l'étude à côté du secteur postal, du montant et
// de la date, c'est révéler exactement cela. La nature du cas n'exige rien de
// tel — le signal de marché est « cette date est prise ».
Then('le carnet du mois {string} ne nomme aucune étude', async function (month) {
  await this.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  const brut = JSON.stringify(this.responseJson.bids);
  for (const cle of ['etude', 'notaryId', 'notaire']) {
    assert.equal(new RegExp('"' + cle + '"\\s*:').test(brut), false, 'le carnet public divulgue « ' + cle + ' » : ' + brut);
  }
  // Et pas davantage sous une autre clé : le NOM de l'étude qui a retenu cette
  // offre ne doit apparaître nulle part dans la réponse publique.
  const bid = lastBid(this);
  const stored = await this.repo.get(bid.id, bid.dateISO);
  if (stored && stored.etude) {
    assert.equal(brut.includes(stored.etude), false, 'le nom de l’étude apparaît dans le carnet public: ' + brut);
  }
  this.carnet = this.responseJson;
});

Then('le carnet du mois {string} dit seulement que la date est prise', async function (month) {
  await this.request({ method: 'GET', path: '/bids', query: { month } });
  assert.equal(this.response.statusCode, 200, this.response.body);
  const bid = this.responseJson.bids.find((b) => b.id === lastBid(this).id);
  assert.ok(bid, 'l’offre retenue doit rester visible sur le carnet: ' + this.response.body);
  assert.equal(bid.status, this.domain.STATUS.RETENUE, 'le statut EST le signal de marché');
});

Then("le client, lui, voit l'étude {string} qui a retenu son offre", function (etude) {
  const n = this.responseJson.notaire;
  assert.ok(n, 'le client doit savoir qui l’a retenu: ' + this.response.body);
  assert.equal(n.etude, etude);
  // Ce qui descend vers le client reste FACTUEL (ADR 0030, art. 70) : jamais
  // une note, une moyenne ou une cote.
  sansPartage(n, 'le notaire tel que le client le voit');
});
