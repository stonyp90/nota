/**
 * ADR 0034 — LE PRIX DE NOTA EST UNE GRILLE PAR SERVICE, NON RÉGRESSIVE.
 *
 * L'ADR 0031 a sorti Nota des honoraires du notaire : deux lignes, jamais un
 * partage. Elle a laissé un prix UNIQUE — 400 $ — et un prix unique posé sur
 * un catalogue à deux services est régressif : il pèse 18,2 % d'un financement
 * à 1 800 $ et 9,4 % d'un acte à 4 000 $. Plus l'acte est petit, plus Nota
 * pèse.
 *
 * La grille corrige cela SANS toucher au mur de l'art. 29.1 du Code de
 * déontologie : le prix dépend du SERVICE et du DÉLAI — deux dimensions
 * publiées, connues du client avant qu'il n'offre — et de rien qui touche au
 * notaire. Ni sa cote, ni son historique, ni la valeur de l'acte.
 *
 * La garantie de date est une LIGNE PROPRE À NOTA : c'est ce que Nota vend.
 * Elle ne se confond pas avec le droit du notaire de tenir compte de l'urgence
 * dans SES honoraires (art. 49 4° C.déont.) — deux objets, deux lignes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../index.js');
const { SERVICES, TIERS, prixNota, prixNotaGrille, prixNotaFige } = domain;

test('le catalogue porte la grille : chaque service publie son prix de Nota', () => {
  assert.ok(SERVICES.length, 'le catalogue existe');
  for (const s of SERVICES) {
    assert.equal(typeof s.prixNotaCents, 'number', s.id + ' : un prix de Nota');
    assert.ok(Number.isInteger(s.prixNotaCents) && s.prixNotaCents > 0,
      s.id + ' : un entier de cents strictement positif');
  }
  // La décision du propriétaire du 2026-09-03, chiffrée.
  assert.equal(domain.serviceById('financement').prixNotaCents, 19900);
  assert.equal(domain.serviceById('refinancement').prixNotaCents, 24900);
});

test('chaque palier publie le prix de la garantie de date — le standard est gratuit', () => {
  for (const t of TIERS) {
    assert.equal(typeof t.prixNotaDateCents, 'number', t.id + ' : une ligne de garantie de date');
    assert.ok(Number.isInteger(t.prixNotaDateCents) && t.prixNotaDateCents >= 0, t.id);
  }
  assert.equal(domain.tierById('standard').prixNotaDateCents, 0,
    'un délai normal ne se paie pas : Nota ne garantit rien de plus que sa place');
  // La ligne monte avec la rareté de la date, jamais avec l'argent en jeu.
  let prev = -1;
  for (const t of TIERS) {
    assert.ok(t.prixNotaDateCents >= prev, t.id + ' : l’échelle ne redescend jamais');
    prev = t.prixNotaDateCents;
  }
});

test('prixNota() rend DEUX lignes et leur somme, pour un service et un palier', () => {
  const p = prixNota('refinancement', 'standard');
  assert.deepEqual(p, { serviceCents: 24900, dateCents: 0, totalCents: 24900 });

  const urgent = prixNota('refinancement', 'prioritaire');
  assert.equal(urgent.serviceCents, 24900);
  assert.equal(urgent.dateCents, domain.tierById('prioritaire').prixNotaDateCents);
  assert.equal(urgent.totalCents, urgent.serviceCents + urgent.dateCents,
    'le total est la somme des deux lignes — rien ne se perd, rien ne s’ajoute');
});

test('ART. 29.1 — le prix ne dépend ni du notaire, ni de la valeur de l’acte', () => {
  // Aucun argument ne porte un notaire, une cote ou un montant : la signature
  // elle-même rend l'infraction impossible.
  assert.equal(prixNota.length, 3, 'serviceId, tierId, grille — et rien d’autre');
  // Le même service au même palier rend toujours le même prix.
  const a = prixNota('financement', 'rapide');
  const b = prixNota('financement', 'rapide');
  assert.deepEqual(a, b);
});

test('non régressif : le service au plancher le plus bas porte le prix le plus bas', () => {
  const parPrixDepart = SERVICES.slice().sort((x, y) => x.prixDepart - y.prixDepart);
  let prev = -1;
  for (const s of parPrixDepart) {
    assert.ok(s.prixNotaCents >= prev,
      s.id + ' : un acte plus petit ne peut pas payer Nota plus cher qu’un plus gros');
    prev = s.prixNotaCents;
  }
  // Le taux de prise du petit acte ne dépasse pas celui du gros.
  const taux = (s) => s.prixNotaCents / (s.prixDepart * 100 + s.prixNotaCents);
  const petit = parPrixDepart[0];
  const gros = parPrixDepart[parPrixDepart.length - 1];
  assert.ok(taux(petit) <= taux(gros), 'le poids de Nota ne monte pas quand l’acte rétrécit');
});

test('un service ou un palier inconnu retombe sur la ligne la plus BASSE du catalogue', () => {
  // Nota ne peut pas facturer plus que ce qu'elle a publié pour un service
  // qu'elle ne sait pas nommer (art. 68 C.déont. — publicité incomplète).
  const plancher = Math.min(...SERVICES.map((s) => s.prixNotaCents));
  assert.equal(prixNota('testament', 'standard').serviceCents, plancher);
  assert.equal(prixNota('refinancement', 'inconnu').dateCents, 0);
  assert.equal(prixNota(null, null).totalCents, plancher);
});

// --- La grille administrable -------------------------------------------------

test('prixNotaGrille() sans source rend la grille du catalogue', () => {
  const g = prixNotaGrille();
  assert.equal(g.services.financement, 19900);
  assert.equal(g.services.refinancement, 24900);
  assert.equal(g.garantieDate.standard, 0);
  assert.equal(g.defaut, Math.min(...SERVICES.map((s) => s.prixNotaCents)));
  // Une grille normalisée est complète : chaque service, chaque palier.
  for (const s of SERVICES) assert.equal(typeof g.services[s.id], 'number');
  for (const t of TIERS) assert.equal(typeof g.garantieDate[t.id], 'number');
});

test('RÉTRO-COMPATIBILITÉ — une configuration à prix unique continue de valoir', () => {
  // C'est la forme stockée par l'ADR 0031 : { prixCents: 40000 }. Elle ne doit
  // pas cesser de fonctionner le jour du déploiement.
  const g = prixNotaGrille({ prixCents: 40000 });
  assert.equal(g.defaut, 40000);
  for (const s of SERVICES) {
    assert.equal(g.services[s.id], 40000, s.id + ' : le prix unique vaut pour tous');
  }
  for (const t of TIERS) {
    assert.equal(g.garantieDate[t.id], 0,
      t.id + ' : un prix unique ne portait aucune garantie de date — elle reste à zéro');
  }
  assert.equal(prixNota('financement', 'extreme', g).totalCents, 40000,
    'l’ancien contrat rend exactement l’ancien nombre');
});

test('une grille partielle complète ses trous avec le catalogue', () => {
  const g = prixNotaGrille({ services: { financement: 15000 }, garantieDate: { extreme: 90000 } });
  assert.equal(g.services.financement, 15000, 'la ligne décidée par l’opérateur');
  assert.equal(g.services.refinancement, 24900, 'les autres restent celles du catalogue');
  assert.equal(g.garantieDate.extreme, 90000);
  assert.equal(g.garantieDate.standard, 0);
});

test('une grille illisible ne fait pas tomber la tarification — elle se lit comme absente', () => {
  for (const source of [null, undefined, 0, 'oups', [], { services: 'non' }, { prixCents: -1 }, { prixCents: 0.5 }]) {
    const g = prixNotaGrille(source);
    assert.equal(g.services.financement, 19900, String(source) + ' : le catalogue reprend la main');
  }
  // Une seule ligne illisible ne condamne pas les autres.
  const g = prixNotaGrille({ services: { financement: 'oups', refinancement: 30000 } });
  assert.equal(g.services.financement, 19900);
  assert.equal(g.services.refinancement, 30000);
});

test('la grille rendue est une COPIE — personne ne peut muter le catalogue', () => {
  const g = prixNotaGrille();
  g.services.financement = 1;
  assert.equal(domain.serviceById('financement').prixNotaCents, 19900);
  assert.equal(prixNotaGrille().services.financement, 19900);
});

test('le taux de prise chiffré de l’ADR 0034 se vérifie sur le catalogue', () => {
  // financement standard : 1 800 $ d'honoraires + 199 $ = 9,95 %
  const fin = prixNota('financement', 'standard').totalCents;
  assert.equal(Math.round((fin / (180000 + fin)) * 10000) / 100, 9.95);
  // refinancement standard : 2 000 $ + 249 $ = 11,07 %
  const refi = prixNota('refinancement', 'standard').totalCents;
  assert.equal(Math.round((refi / (200000 + refi)) * 10000) / 100, 11.07);
  // Les deux sous les 13,6 % d'Airbnb, et sous les 16,7 % du prix unique.
  assert.ok(fin / (180000 + fin) < 0.136);
  assert.ok(refi / (200000 + refi) < 0.136);
  // Le prix unique de 400 $ pesait davantage sur les DEUX.
  assert.ok(40000 / (180000 + 40000) > fin / (180000 + fin));
  assert.ok(40000 / (200000 + 40000) > refi / (200000 + refi));
});

// ---------------------------------------------------------------------------
// Le devis FIGÉ — ce qu'une offre a AUTORISÉ, relu plutôt que recalculé
// ---------------------------------------------------------------------------

test('prixNotaFige relit les deux lignes autorisées, ou rien du tout', () => {
  assert.deepEqual(prixNotaFige({ prixNotaServiceCents: 24900, prixNotaDateCents: 5000 }), {
    serviceCents: 24900, dateCents: 5000, totalCents: 29900,
  });
  // Une seule ligne ne fait pas un devis : la moitié d'un total autorisé
  // vaudrait pire que rien, puisqu'elle passerait pour un total.
  assert.equal(prixNotaFige({ prixNotaServiceCents: 24900 }), null);
  assert.equal(prixNotaFige({ prixNotaDateCents: 5000 }), null);
  // Et rien de ce qui n'est pas un entier de cents ne se rejoue.
  for (const bad of [{ prixNotaServiceCents: 0.15, prixNotaDateCents: 0 },
    { prixNotaServiceCents: -1, prixNotaDateCents: 0 },
    { prixNotaServiceCents: 24900, prixNotaDateCents: 'oups' },
    null, undefined, 'nope', []]) {
    assert.equal(prixNotaFige(bad), null, JSON.stringify(bad));
  }
});

test('ART. 29.1 — un devis figé se relit sans notaire, comme la grille', () => {
  // Le même garde-fou d'arité que `prixNota` : il n'existe aucun argument par
  // lequel un notaire, ou sa cote, entrerait dans le prix — ni au devis, ni au
  // règlement, qui est le seul endroit où l'API en connaît un.
  assert.equal(prixNota.length, 3, 'prixNota(serviceId, tierId, grille) — et rien d’autre');
  assert.equal(prixNotaFige.length, 1, 'prixNotaFige(offre) — et rien d’autre');
});
