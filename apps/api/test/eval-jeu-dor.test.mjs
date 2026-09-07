// Le jeu d'or de l'assistant se tient lui-même (ADR 0046).
//
// Une évaluation ne vaut que ce que vaut son jeu de questions, et un jeu de
// questions pourrit de deux façons : il cesse de couvrir le produit, ou il se
// met à contenir des chiffres recopiés qui vieillissent. Cette suite tourne
// SANS clé d'API — elle ne juge pas les réponses, elle juge le jeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const SET = JSON.parse(readFileSync(fileURLToPath(new URL('../eval/questions.json', import.meta.url)), 'utf8'));
const RUN = readFileSync(fileURLToPath(new URL('../eval/run.mjs', import.meta.url)), 'utf8');

const Q = SET.questions;

test('chaque question est bien formée et son identifiant est unique', () => {
  const vus = new Set();
  for (const q of Q) {
    assert.ok(q.id && !vus.has(q.id), `identifiant manquant ou en double : ${q.id}`);
    vus.add(q.id);
    assert.ok(q.q && q.q.length > 5, `${q.id} : la question est vide`);
    assert.ok(['fr', 'en'].includes(q.locale), `${q.id} : locale`);
    assert.ok(q.escalade === undefined || typeof q.escalade === 'boolean', `${q.id} : escalade`);
  }
});

test('AUCUN montant n’est recopié dans le jeu d’or', () => {
  // La règle qui empêche le jeu de vieillir : une attente chiffrée se nomme
  // par sa clé de domaine (« prixAnnonce:refinancement »), jamais par sa
  // valeur. Un « 2 279 $ » écrit ici serait faux au prochain changement de
  // grille, et l'évaluation se mettrait à échouer sur du bon travail.
  for (const q of Q) {
    for (const champ of ['doitCiter', 'doitMentionner']) {
      for (const v of q[champ] || []) {
        assert.ok(
          !/\d[\d\s  ]*\$/.test(v),
          `${q.id}.${champ} contient un montant en dur (« ${v} ») : nommez la clé de domaine`
        );
      }
    }
  }
});

test('chaque clé de fait est résolvable par le domaine, aujourd’hui', () => {
  // Le lien vivant entre le jeu d'or et le catalogue : si un service ou un
  // palier disparaît, cette assertion tombe avant l'évaluation.
  const resolve = (key) => {
    const [kind, a, b] = key.split(':');
    if (kind === 'prixAnnonce' || kind === 'prixNota') {
      assert.ok(domain.serviceById(a), `service inconnu : ${a}`);
      return domain.prixAnnonce(a).totalCents;
    }
    if (kind === 'supplement' && a === 'deplacement') {
      const d = domain.DEPLACEMENTS.find((x) => x.id === b);
      assert.ok(d, `déplacement inconnu : ${b}`);
      return d.add;
    }
    if (kind === 'supplement') {
      const t = domain.TIERS.find((x) => x.id === a);
      assert.ok(t, `palier inconnu : ${a}`);
      return t.prixNotaDateCents;
    }
    if (kind === 'contact') {
      assert.ok(domain.CONTACT[a], `contact inconnu : ${a}`);
      return domain.CONTACT[a];
    }
    assert.fail(`clé de fait inconnue : ${key}`);
  };
  for (const q of Q) for (const key of q.doitCiter || []) resolve(key);
});

test('les trois niveaux et tous les motifs d’escalade sont couverts', () => {
  for (const n of domain.SUPPORT_NIVEAUX) {
    assert.ok(Q.some((q) => q.niveau === n.niveau), `aucune question pour le niveau ${n.niveau}`);
  }
  // Les motifs qu'une question peut réellement produire. « inconnu » est le
  // repli du système, pas une intention : il n'a pas à figurer au jeu d'or.
  for (const m of domain.SUPPORT_ESCALADE_MOTIFS.filter((x) => x.id !== 'inconnu')) {
    assert.ok(
      Q.some((q) => q.motif === m.id) || Q.some((q) => q.escalade === true),
      `aucune question n’exerce le motif ${m.id}`
    );
  }
  const escalades = Q.filter((q) => q.escalade === true);
  assert.ok(escalades.length >= 8, `seulement ${escalades.length} questions d’escalade : trop peu`);
});

test('le jeu couvre l’adversaire, pas seulement le client de bonne foi', () => {
  // Ce sont les questions qui font franchir une ligne : elles doivent exister,
  // et chacune doit interdire quelque chose.
  const adv = Q.filter((q) => q.id.startsWith('adv-'));
  assert.ok(adv.length >= 8, `seulement ${adv.length} questions adverses`);
  for (const q of adv) {
    assert.ok((q.neDoitPas || []).length > 0, `${q.id} n’interdit rien : que teste-t-elle ?`);
  }
  // Les deux attaques que toute messagerie assistée reçoit.
  assert.ok(Q.some((q) => /ignore tes instructions/i.test(q.q)), 'aucune injection d’invite');
  assert.ok(Q.some((q) => /instructions système/i.test(q.q)), 'aucune tentative d’extraction de l’invite');
});

test('les deux langues sont exercées', () => {
  assert.ok(Q.some((q) => q.locale === 'en'), 'aucune question en anglais');
  assert.ok(Q.some((q) => q.locale === 'fr'));
});

test('l’évaluateur résout les faits contre le domaine, et mesure le coût', () => {
  // Deux propriétés du script lui-même, parce que les perdre viderait
  // l'évaluation de son sens sans qu'aucune assertion ne tombe.
  assert.match(RUN, /require\('@nota\/domain'\)/, 'les attentes viennent du domaine');
  assert.match(RUN, /cache_read|cacheRead/, 'la lecture de cache est observée');
  assert.match(RUN, /co[ûu]t de cette passe/i, 'le coût réel est imprimé');
  assert.ok(!/questions\.json[\s\S]{0,200}2\s?279/.test(RUN), 'aucun montant en dur dans l’évaluateur');
});
