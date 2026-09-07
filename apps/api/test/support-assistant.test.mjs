// L'assistant de la messagerie, côté hexagone (ADR 0046).
//
// Ce fichier tient trois promesses, et chacune est une promesse faite au
// PROPRIÉTAIRE, pas au visiteur :
//
//   1. L'invite système est CONSTRUITE à partir de la fiche de faits vivante.
//      Aucun prix, aucun délai, aucune règle n'y est recopié à la main.
//   2. Tout ce qui n'est pas une réponse propre devient une ESCALADE. Panne
//      du modèle, corps illisible, refus, garde-fou du domaine : dans tous les
//      cas la question part à l'humain. Il n'existe aucun chemin où un
//      visiteur reste sans réponse ET sans que personne ne soit prévenu.
//   3. Le garde-fou du domaine s'applique APRÈS le modèle. Une réponse qui
//      conseille, qui nomme un taux ou qui publie une cote n'est pas
//      corrigée : elle est jetée, et l'humain reprend la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');
const { createFakeAssistant } = require('../src/assistant-port.js');
const { createSupportAssistant } = require('../src/support-assistant.js');

const OPERATOR = { nom: 'Anthony', courriel: 'anthony@nota.ca' };

function make(scenario, opts = {}) {
  return createSupportAssistant({
    port: scenario === null ? null : createFakeAssistant(scenario),
    operator: OPERATOR,
    ...opts,
  });
}

const BONNE = {
  repond: true, niveau: 2, motif: null,
  texte: 'Le prix affiché est le total : les honoraires du notaire et le service de Nota.',
};

// --- 1. L'invite système est calculée ----------------------------------------

test('l’invite porte le prix VIVANT de chaque service, jamais une copie', () => {
  const a = make(BONNE);
  const invite = a.systemPrompt();
  for (const svc of domain.SERVICES) {
    const total = domain.prixAnnonce(svc.id).totalCents;
    assert.ok(invite.includes(svc.nom), `${svc.id} est nommé`);
    assert.ok(invite.includes(String(total)), `le total ${total} de ${svc.id} est dans l’invite`);
  }
});

test('l’invite suit la grille de prix admin : la changer change l’invite', () => {
  const grille = domain.prixNotaGrille({
    services: Object.fromEntries(domain.SERVICES.map((s) => [s.id, s.prixNotaCents + 7000])),
  });
  const base = make(BONNE).systemPrompt();
  const bougee = make(BONNE, { grille }).systemPrompt();
  assert.notEqual(base, bougee, 'l’invite a bougé avec la grille');
  const svc = domain.SERVICES[0];
  assert.ok(bougee.includes(String(domain.prixAnnonce(svc.id, grille).totalCents)));
});

test('l’invite nomme les trois niveaux et chacun de leurs sujets', () => {
  const invite = make(BONNE).systemPrompt();
  for (const n of domain.SUPPORT_NIVEAUX) {
    assert.ok(invite.includes(n.nom), `le niveau ${n.niveau} est nommé`);
    for (const sujet of n.sujets) assert.ok(invite.includes(sujet), `sujet « ${sujet} »`);
  }
});

test('l’invite nomme chaque motif d’escalade avec son identifiant', () => {
  const invite = make(BONNE).systemPrompt();
  for (const m of domain.SUPPORT_ESCALADE_MOTIFS) {
    assert.ok(invite.includes(m.id), `le motif ${m.id} est offert au modèle`);
  }
});

test('l’invite porte la politique d’annulation de la COUCHE API, pas du domaine', () => {
  // Le barème vit dans la couche facturation (frontière déontologique de
  // l'ADR 0008). L'assistant doit quand même pouvoir répondre « qu’est-ce qui
  // se passe si j’annule ? » — donc l'invite le reçoit d'ici.
  const invite = make(BONNE, { policy: { annulationDelaiJours: 9 } }).systemPrompt();
  assert.ok(/annul/i.test(invite), 'l’annulation est couverte');
  assert.ok(invite.includes('9'), 'le délai de réclamation configuré est dans l’invite');
});

test('l’invite dit le nom de l’humain qui reprend la main', () => {
  const invite = make(BONNE).systemPrompt();
  assert.ok(invite.includes('Anthony'), 'le modèle sait à qui il passe le relais');
});

test('l’invite interdit explicitement ce que le domaine refusera de toute façon', () => {
  const invite = make(BONNE).systemPrompt();
  // Ceinture ET bretelles : on le dit au modèle, et on le vérifie après lui.
  assert.ok(/jamais/i.test(invite));
  assert.ok(/conseil/i.test(invite), 'l’interdiction de conseiller est écrite');
  assert.ok(/art\.\s*70|cote/i.test(invite), 'l’interdiction de publier une cote est écrite');
});

// --- 2. Le chemin nominal -----------------------------------------------------

test('une réponse propre revient en tant qu’« assistant », sans escalade', async () => {
  const a = make(BONNE);
  const out = await a.answer({ question: 'Le prix comprend quoi ?' });
  assert.equal(out.escalade, false);
  assert.equal(out.de, domain.SUPPORT_FROM.ASSISTANT);
  assert.equal(out.texte, BONNE.texte);
  assert.equal(out.niveau, 2);
});

test('la question et l’historique arrivent au port, avec l’invite construite', async () => {
  const port = createFakeAssistant(BONNE);
  const a = createSupportAssistant({ port, operator: OPERATOR });
  await a.answer({
    question: 'Et pour une date la semaine prochaine ?',
    historique: [{ de: 'visiteur', texte: 'Bonjour' }, { de: 'assistant', texte: 'Bonjour !' }],
    locale: 'en',
  });
  assert.equal(port.calls.length, 1);
  const call = port.calls[0];
  assert.equal(call.question, 'Et pour une date la semaine prochaine ?');
  assert.equal(call.historique.length, 2);
  assert.equal(call.locale, 'en');
  assert.ok(call.systeme.length > 500, 'l’invite est bien celle qu’on a construite');
});

// --- 3. Tout le reste est une escalade ---------------------------------------

test('sans port configuré, chaque question escalade — le comportement d’avant', async () => {
  const a = make(null);
  assert.equal(a.enabled, false);
  const out = await a.answer({ question: 'Bonjour ?' });
  assert.equal(out.escalade, true);
  // Le fil reste MUET : rien n'a examiné la question, donc rien ne prétend
  // l'avoir fait. Écrire « celle-là mérite une vraie réponse » ici serait un
  // petit mensonge — et ajouterait une bulle à chaque fil d'un déploiement qui
  // n'a jamais demandé d'assistant.
  assert.equal(out.texte, null);
});

test('mais un assistant CONFIGURÉ qui escalade, lui, le dit au visiteur', async () => {
  const a = make({ repond: false, niveau: null, motif: 'plainte', texte: '' });
  const out = await a.answer({ question: '…' });
  assert.equal(out.escalade, true);
  assert.ok(out.texte.includes('Anthony'), 'le visiteur sait qui reprend');
  assert.equal(domain.validateSupportAnswer({ texte: out.texte }).ok, true, 'la phrase de repli passe le garde-fou');
  assert.ok(!/\$/.test(out.texte), 'et elle n’avance aucun chiffre');
});

test('une panne du modèle escalade au lieu de jeter', async () => {
  const a = make({ throw: 'timeout' });
  const out = await a.answer({ question: 'Bonjour ?' });
  assert.equal(out.escalade, true);
  assert.equal(out.motif, 'inconnu');
});

test('un refus du modèle escalade avec SON motif, s’il est connu du domaine', async () => {
  const a = make({ repond: false, niveau: null, motif: 'dossier_precis', texte: 'Je transmets ça à Anthony.' });
  const out = await a.answer({ question: 'Où en est mon dossier 4821 ?' });
  assert.equal(out.escalade, true);
  assert.equal(out.motif, 'dossier_precis');
  assert.equal(out.texte, 'Je transmets ça à Anthony.', 'la phrase de passage de relais est gardée');
});

test('un motif inventé par le modèle retombe sur « inconnu »', async () => {
  const a = make({ repond: false, niveau: null, motif: 'je_ne_sais_pas_trop', texte: 'Je transmets.' });
  const out = await a.answer({ question: '?' });
  assert.equal(out.escalade, true);
  assert.equal(out.motif, 'inconnu');
});

test('une escalade sans phrase reçoit quand même une phrase — jamais un blanc', async () => {
  const a = make({ repond: false, niveau: null, motif: 'plainte', texte: '   ' });
  const out = await a.answer({ question: 'Je suis mécontent.' });
  assert.equal(out.escalade, true);
  assert.ok(out.texte && out.texte.length > 10, 'le visiteur lit toujours quelque chose');
  assert.ok(out.texte.includes('Anthony'), 'et il sait qui reprend');
});

test('la phrase de relais est dans la langue du visiteur', async () => {
  const a = make({ repond: false, niveau: null, motif: 'plainte', texte: '' });
  const fr = await a.answer({ question: '…', locale: 'fr' });
  const en = await a.answer({ question: '…', locale: 'en' });
  assert.notEqual(fr.texte, en.texte);
  assert.ok(/Anthony/.test(en.texte));
});

// --- 4. Le garde-fou du domaine passe APRÈS le modèle ------------------------

test('une réponse qui conseille est JETÉE, pas corrigée — et elle escalade', async () => {
  const a = make({
    repond: true, niveau: 3, motif: null,
    texte: 'Vous devriez signer avant la fin du mois pour éviter des frais.',
  });
  const out = await a.answer({ question: 'Je fais quoi ?' });
  assert.equal(out.escalade, true);
  assert.equal(out.motif, 'conseil_juridique');
  assert.ok(!/vous devriez/i.test(out.texte || ''), 'le conseil ne sort jamais');
});

test('une réponse qui nomme un taux est jetée', async () => {
  const a = make({ repond: true, niveau: 3, motif: null, texte: 'Le taux d’annulation est de 30 %.' });
  const out = await a.answer({ question: 'Et si j’annule ?' });
  assert.equal(out.escalade, true);
  assert.ok(!/taux/i.test(out.texte || ''));
});

test('une réponse qui publie une cote nominative est jetée (art. 70)', async () => {
  const a = make({ repond: true, niveau: 2, motif: null, texte: 'Me Roy a une cote de 94 sur 100.' });
  const out = await a.answer({ question: 'Qui est votre meilleur notaire ?' });
  assert.equal(out.escalade, true);
  assert.ok(!/94/.test(out.texte || ''));
});

test('une réponse vide ne devient jamais une bulle vide', async () => {
  const a = make({ repond: true, niveau: 1, motif: null, texte: '' });
  const out = await a.answer({ question: 'Bonjour' });
  assert.equal(out.escalade, true);
  assert.ok(out.texte);
});

// --- 5. Le coût est observable ------------------------------------------------

test('l’usage du modèle remonte pour la piste de coût, jamais vers le visiteur', async () => {
  const a = make({ ...BONNE, usage: { in: 1200, out: 90, cacheRead: 1100 } });
  const out = await a.answer({ question: 'Le prix comprend quoi ?' });
  assert.deepEqual(out.usage, { in: 1200, out: 90, cacheRead: 1100 });
});
