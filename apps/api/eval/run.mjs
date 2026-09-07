#!/usr/bin/env node
// Évaluation de l'assistant de la messagerie (ADR 0046).
//
// « Ça marche » et « on SAIT que ça marche » sont deux choses différentes, et
// la seconde est ce qui manquait. Ce script pose au VRAI modèle, à travers le
// VRAI hexagone, les questions du jeu d'or, et note trois choses vérifiables
// mécaniquement :
//
//   1. ESCALADE — a-t-il reconnu ce qu'il ne pouvait pas fonder ? Une escalade
//      manquée est une invention servie à un client : c'est la faute grave.
//   2. FAITS — le bon chiffre est-il là ? Les attentes sont RÉSOLUES contre
//      @nota/domain à l'exécution, jamais recopiées dans le jeu d'or, sinon
//      celui-ci vieillirait comme la base de connaissances qu'on a refusé
//      d'écrire.
//   3. LIGNES ROUGES — les motifs interdits n'apparaissent pas. Le garde-fou
//      du domaine en attrape déjà la plupart ; ceux du jeu d'or sont les
//      pièges de formulation qu'il ne voit pas.
//
// Aucune note subjective : rien ici ne dépend d'un juge. Un échec pointe une
// ligne précise, pas une impression.
//
//   ANTHROPIC_API_KEY=sk-ant-... node apps/api/eval/run.mjs
//   node apps/api/eval/run.mjs --only prix-refi,esc-dossier
//   node apps/api/eval/run.mjs --json rapport.json
//
// Le coût réel est mesuré et imprimé à la fin : une évaluation qu'on n'ose pas
// relancer n'est pas une évaluation.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createAnthropicAssistant } = require('../src/assistant-port.js');
const { createSupportAssistant } = require('../src/support-assistant.js');

const HERE = new URL('.', import.meta.url);
const SET = JSON.parse(readFileSync(fileURLToPath(new URL('questions.json', HERE)), 'utf8'));

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const only = (arg('--only') || '').split(',').filter(Boolean);
const jsonOut = arg('--json');

// --- Les faits attendus, RÉSOLUS contre le domaine ---------------------------
// C'est le cœur : le jeu d'or nomme une clé, le domaine donne la valeur du
// jour. Changer un prix change l'attente, pas le fichier.
function resolveFact(key) {
  const [kind, a, b] = key.split(':');
  if (kind === 'prixAnnonce') return domain.money(domain.prixAnnonce(a).totalCents / 100);
  if (kind === 'prixNota') return domain.money(domain.prixAnnonce(a).notaCents / 100);
  if (kind === 'supplement' && a === 'deplacement') {
    const d = domain.DEPLACEMENTS.find((x) => x.id === b);
    return d ? domain.money(d.add) : null;
  }
  if (kind === 'supplement') {
    const t = domain.TIERS.find((x) => x.id === a);
    return t ? domain.money(t.prixNotaDateCents / 100) : null;
  }
  if (kind === 'contact') return domain.CONTACT[a] || null;
  throw new Error('clé de fait inconnue : ' + key);
}

// Un montant peut s'écrire « 2 279 $ » avec une espace fine, une insécable ou
// rien du tout : on compare sur les chiffres, pas sur la typographie.
const digits = (s) => String(s).replace(/[^\d]/g, '');
function mentionsFact(texte, attendu) {
  if (!attendu) return false;
  if (/\d/.test(attendu)) return digits(texte).includes(digits(attendu));
  return texte.toLowerCase().includes(String(attendu).toLowerCase());
}

function grade(q, out) {
  const fails = [];
  const texte = String(out.texte || '');
  const bas = texte.toLowerCase();

  if (typeof q.escalade === 'boolean' && out.escalade !== q.escalade) {
    fails.push(
      q.escalade
        ? 'aurait dû ESCALADER (aucune fiche ne fonde cette réponse) et a répondu'
        : 'a escaladé une question que la fiche fonde'
    );
  }
  if (q.motif && out.escalade && out.motif !== q.motif) {
    fails.push(`motif « ${out.motif} », attendu « ${q.motif} »`);
  }
  // Les faits ne sont exigés que d'une réponse : une escalade n'a pas à citer
  // un prix, elle a à passer la main.
  if (!out.escalade) {
    for (const key of q.doitCiter || []) {
      const attendu = resolveFact(key);
      if (!mentionsFact(texte, attendu)) fails.push(`ne cite pas ${key} (« ${attendu} »)`);
    }
    for (const mot of q.doitMentionner || []) {
      if (!bas.includes(String(mot).toLowerCase())) fails.push(`ne mentionne pas « ${mot} »`);
    }
  }
  for (const mot of q.neDoitPas || []) {
    if (bas.includes(String(mot).toLowerCase())) fails.push(`LIGNE ROUGE : contient « ${mot} »`);
  }
  // Le garde-fou du domaine s'est-il déclenché ? Ce n'est pas un échec en soi
  // (le système a bien fait son travail : la réponse a été jetée), mais c'est
  // une information qu'on veut voir — elle dit que l'invite dérive.
  const refus = out.refuse || null;
  return { ok: fails.length === 0, fails, refus };
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY || process.env.NOTA_ASSISTANT_API_KEY;
  if (!key) {
    console.error(
      'ANTHROPIC_API_KEY manquante.\n' +
        'L’évaluation interroge le vrai modèle — c’est tout son intérêt.\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...   puis relancez.'
    );
    process.exit(2);
  }
  const port = createAnthropicAssistant({ apiKey: key, timeoutMs: 30000 });
  const assistant = createSupportAssistant({
    port,
    operator: { nom: process.env.NOTA_OPERATOR_NAME || 'Anthony', courriel: null },
  });

  const questions = SET.questions.filter((q) => !only.length || only.includes(q.id));
  console.log(`\nAssistant de la messagerie — ${questions.length} questions\n`);

  const rows = [];
  let usageIn = 0;
  let usageOut = 0;
  let usageCache = 0;

  // En série, délibérément : l'invite système est identique d'une question à
  // l'autre, alors la première la met en cache et les suivantes la lisent. En
  // parallèle, elles paieraient toutes le plein tarif.
  for (const q of questions) {
    const t0 = Date.now();
    let out;
    try {
      out = await assistant.answer({ question: q.q, locale: q.locale });
    } catch (err) {
      out = { texte: '', escalade: true, motif: 'inconnu', usage: null, erreur: String(err.message || err) };
    }
    const ms = Date.now() - t0;
    const r = grade(q, out);
    if (out.usage) {
      usageIn += out.usage.in || 0;
      usageOut += out.usage.out || 0;
      usageCache += out.usage.cacheRead || 0;
    }
    rows.push({ id: q.id, ...r, escalade: out.escalade, motif: out.motif, ms, texte: out.texte });
    const mark = r.ok ? '  ok  ' : ' ÉCHEC';
    console.log(`${mark}  ${q.id.padEnd(24)} ${String(ms).padStart(5)} ms  ${out.escalade ? 'escalade' : 'réponse '}`);
    for (const f of r.fails) console.log(`        → ${f}`);
    if (r.refus) console.log(`        → garde-fou du domaine déclenché : ${r.refus.join(', ')}`);
  }

  const ok = rows.filter((r) => r.ok).length;
  const escManquees = rows.filter((r) => r.fails.some((f) => f.includes('ESCALADER'))).length;
  const lignesRouges = rows.filter((r) => r.fails.some((f) => f.startsWith('LIGNE ROUGE'))).length;

  // Tarifs Claude Opus 5, $/million de jetons. Les lectures de cache content
  // environ le dixième de l'entrée — c'est ce que la mise en cache de l'invite
  // système est censée acheter, et cette ligne est là pour le prouver.
  const PRIX = { in: 5, out: 25, cache: 0.5 };
  const cout = (usageIn * PRIX.in + usageOut * PRIX.out + usageCache * PRIX.cache) / 1e6;

  console.log(`\n${ok}/${rows.length} réussies`);
  if (escManquees) console.log(`⚠ ${escManquees} escalade(s) manquée(s) — le défaut le plus grave`);
  if (lignesRouges) console.log(`⚠ ${lignesRouges} ligne(s) rouge(s) franchie(s)`);
  console.log(
    `jetons : ${usageIn} entrée · ${usageOut} sortie · ${usageCache} lus en cache` +
      `\ncoût de cette passe : ${cout.toFixed(4)} $ US` +
      `\ncoût par question   : ${(cout / Math.max(1, rows.length)).toFixed(5)} $ US`
  );
  if (usageCache === 0 && rows.length > 1) {
    console.log('⚠ aucune lecture de cache : l’invite système n’est pas stable d’une question à l’autre.');
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), rows, cout }, null, 2));
    console.log(`\nrapport écrit : ${jsonOut}`);
  }
  process.exit(ok === rows.length ? 0 : 1);
}

main();
