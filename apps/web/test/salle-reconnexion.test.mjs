/**
 * ADR 0047 — REVENIR DANS LA SALLE.
 *
 * Le 2026-09-12, un client qui fermait sa page ne pouvait plus jamais rentrer :
 * la page du notaire posait son offre UNE fois (`S.offreFaite`, un verrou à
 * sens unique) et ne la refaisait pour rien au monde. Le client rouvrait la
 * salle, attendait une négociation qui n'aurait pas lieu, la porte de présence
 * restait fermée et « Reprendre la séance » était refusé indéfiniment.
 *
 * `e2e/salle-reconnexion.spec.js` le démontre dans deux vrais navigateurs, avec
 * une vraie négociation WebRTC — c'est la preuve. Ce fichier-ci tient les mêmes
 * règles là où elles sont bon marché : la relance, la connexion refaite, la
 * signalisation périmée qu'on n'écoute pas, la phrase que le notaire lit quand
 * c'est l'AUTRE qui est parti, et l'anglais de ce que la salle compose.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* déjà fermée */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const SALLE_SRC = readFileSync(fileURLToPath(new URL('../public/salle.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.parse('2026-09-12T14:00:00.000Z');
const BID = 'o1';
const DATE = '2026-09-30';

// --- Les doublures ----------------------------------------------------------
function piste(kind) {
  return { kind, enabled: true, muted: false, readyState: 'live', addEventListener() {}, stop() { this.readyState = 'ended'; } };
}
function fluxFactice() {
  const pistes = [piste('video'), piste('audio')];
  return { getTracks: () => pistes };
}

// Une RTCPeerConnection dont on peut provoquer l'état — c'est tout ce qui
// manque à jsdom pour jouer une coupure. Chaque instance a SA clé : une
// renégociation se reconnaît ici comme dans un vrai navigateur.
function connexionFactice(nees) {
  return class {
    constructor() {
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = 'new';
      this.__ajoutes = [];
      this.__fermee = false;
      this.__rang = nees.length;
      nees.push(this);
    }
    addTrack(t) { this.__ajoutes.push(t); }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 LOCALE-' + this.__rang + '\r\n' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 LOCALE-' + this.__rang + '\r\n' }); }
    setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
    setRemoteDescription(d) { this.remoteDescription = d; return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    close() { this.__fermee = true; this.connectionState = 'closed'; }
    __etat(s) { this.connectionState = s; if (this.onconnectionstatechange) this.onconnectionstatechange(); }
  };
}

function salleServeur(over = {}) {
  const portes = Object.assign({
    compte: { ouverte: true, raison: null, message: null },
    identite: { ouverte: true, raison: null, message: null },
    lien: { ouverte: false, raison: 'lien_non_confirme', message: 'Le notaire n’a pas encore confirmé que les deux chaînes concordent.' },
    presence: { ouverte: true, raison: null, message: null },
  }, over.portes || {});
  return Object.assign({
    id: 'S-' + BID, bidId: BID, dateISO: DATE, mode: 'strict', demonstration: true,
    statut: 'ouverte', etape: 'accueil', etapes: [],
    portes, fermees: Object.keys(portes).filter((k) => !portes[k].ouverte), toutesOuvertes: false,
    sas: 'K7M2-QP49',
    lien: { empreinteNotaire: null, empreinteClient: null, confirmeLe: null },
    identites: {}, consentements: { notaire: null, client: null },
    consentement: { requis: true, complet: false, manquants: [], retires: [] },
    enregistre: false,
    parties: {
      notaire: { authentifie: true, pistes: { video: true, audio: true } },
      client: { authentifie: true, pistes: { video: true, audio: true } },
    },
    presence: { coupeeA: null, repriseA: null },
    signature: null, scelle: null, pv: [], rev: 3,
  }, over, { portes });
}

// Une offre telle que le serveur la relaie : la charge est le SDP sérialisé.
const signalOffre = (n, empreinte) => ({
  n, type: 'offre', de: 'notaire',
  charge: JSON.stringify({ type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 ' + empreinte + '\r\n' }),
});

async function boot({ partie = 'notaire', salle } = {}) {
  const appels = [];
  let horloge = T0;
  const nees = [];
  let etatServeur = salle || salleServeur();
  let signaux = [];
  let prochainSondage = null;

  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const appel = { url: String(u), init: init || {} };
        appels.push(appel);
        const chemin = appel.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        const corps = chemin === '/api/salle'
          ? { salle: etatServeur, signaux: signaux.splice(0), curseur: 9 }
          : { salle: etatServeur, ice: [], n: appels.length };
        return Promise.resolve({ ok: true, status: 200, json: async () => corps });
      };
      window.crypto = webcrypto;
      window.scrollTo = () => {};
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(SALLE_SRC);

  const flux = fluxFactice();
  const deps = win.NotaSalle.__deps;
  deps.RTCPeerConnection = connexionFactice(nees);
  deps.getUserMedia = () => Promise.resolve(flux);
  deps.subtle = webcrypto.subtle;
  deps.now = () => horloge;
  // Le sondage de fond est capturé plutôt que joué : ce test décide QUAND la
  // salle sonde, sinon chaque attente serait indéterminée.
  deps.setTimeout = (fn) => { prochainSondage = fn; return 1; };
  deps.clearTimeout = () => {};

  win.Nota = { API_BASE: '/api' };
  win.NotaSalle.boot();
  await win.NotaSalle.ouvrir({ id: BID, dateISO: DATE, partie, token: 'jeton-' + partie });
  await wait(30);

  const corps = (a) => { try { return JSON.parse(a.init.body); } catch { return null; } };
  return {
    win, doc: win.document, appels, flux, nees, salle: win.NotaSalle,
    avancer(ms) { horloge += ms; },
    poser(nouvel) { etatServeur = nouvel; const v = win.NotaSalle.etat(); if (v) v.salle = nouvel; win.NotaSalle.rendre(); },
    deposer(...sigs) { signaux.push(...sigs); },
    async sonder() { const fn = prochainSondage; prochainSondage = null; if (fn) fn(); await wait(30); },
    offres: () => appels.filter((a) => { const c = corps(a); return c && c.type === 'offre'; }),
    reponses: () => appels.filter((a) => { const c = corps(a); return c && c.type === 'reponse'; }).map(corps),
    pistes: () => appels.filter((a) => a.url.includes('/salle/pistes')).map(corps),
  };
}

// ---------------------------------------------------------------------------
// D1 — le lien se refait
// ---------------------------------------------------------------------------

test('D1 · une offre restée sans lien est REFAITE : le verrou à sens unique est levé', async () => {
  const h = await boot({ partie: 'notaire' });
  assert.equal(h.offres().length, 1, 'l’ouverture offre une fois');
  const premiere = h.salle.etat().pc;

  // Le pair d'en face a fermé sa page : la connexion tombe.
  premiere.__etat('failed');
  await wait(10);

  // Trop tôt : une poignée de main en cours mérite qu'on l'attende.
  await h.salle.assurerLien();
  await wait(10);
  assert.equal(h.offres().length, 1, 'la relance ne part pas en rafale');

  // Passé le délai, l'offre repart — et sur une connexion NEUVE, parce qu'une
  // poignée de main morte ne se rattrape pas en lui renvoyant une offre.
  h.avancer(h.salle.RELANCE_LIEN_MS + 1);
  await h.salle.assurerLien();
  await wait(20);

  assert.equal(h.offres().length, 2, 'le notaire doit refaire son offre quand le lien ne tient pas');
  const seconde = h.salle.etat().pc;
  assert.notEqual(seconde, premiere, 'la seconde offre part d’une connexion neuve');
  assert.equal(premiere.__fermee, true, 'l’ancienne connexion est fermée, pas laissée à traîner');
  assert.equal(seconde.__ajoutes.length, 2, 'la caméra et le micro sont rebranchés sur la neuve');
});

test('D1 · le sondage suffit : personne n’a besoin de cliquer pour que le lien revienne', async () => {
  const h = await boot({ partie: 'notaire' });
  h.salle.etat().pc.__etat('failed');
  await wait(10);
  h.avancer(h.salle.RELANCE_LIEN_MS + 1);
  await h.sonder();
  assert.equal(h.offres().length, 2, 'la relance appartient au battement de la salle');
});

test('D1 · un lien établi n’est jamais refait — la relance n’est pas un tic', async () => {
  const h = await boot({ partie: 'notaire' });
  h.salle.etat().pc.__etat('connected');
  await wait(10);
  h.avancer(10 * h.salle.RELANCE_LIEN_MS);
  await h.salle.assurerLien();
  await wait(20);
  assert.equal(h.offres().length, 1, 'une connexion qui tient ne se renégocie pas toute seule');
});

test('D1 · une séance suspendue dément la connexion qui se croit encore bonne', async () => {
  // RTCPeerConnection reste « connected » une demi-minute après que le pair a
  // fermé sa page : la fraîcheur du consentement ICE expire lentement. Le
  // serveur, lui, a déjà suspendu la séance. Attendre l'aveu local ferait
  // regarder un écran noir à quelqu'un qui est déjà revenu.
  const h = await boot({ partie: 'notaire' });
  h.salle.etat().pc.__etat('connected');
  await wait(10);
  h.poser(salleServeur({
    statut: 'suspendue',
    portes: { presence: { ouverte: false, raison: 'pair_absent', message: 'Le client a quitté la séance ou a perdu sa connexion.' } },
  }));
  h.avancer(h.salle.RELANCE_LIEN_MS + 1);
  await h.salle.assurerLien();
  await wait(20);
  assert.equal(h.offres().length, 2, 'une séance suspendue avec un pair qui se dit vivant vaut « lien à refaire »');
});

test('D1 · une séance suspendue par NOTRE propre caméra ne fait pas refaire le lien', async () => {
  // Sinon le notaire qui a coupé sa caméra une minute renégocierait en boucle,
  // et le lien qu'il casse ainsi est celui qu'il essaie de sauver.
  const h = await boot({ partie: 'notaire' });
  h.salle.etat().pc.__etat('connected');
  h.flux.getTracks()[0].readyState = 'ended';
  await wait(10);
  h.poser(salleServeur({
    statut: 'suspendue',
    portes: { presence: { ouverte: false, raison: 'piste_video', message: 'La caméra du notaire n’envoie plus d’image.' } },
  }));
  h.avancer(h.salle.RELANCE_LIEN_MS + 1);
  await h.salle.assurerLien();
  await wait(20);
  assert.equal(h.offres().length, 1, 'refaire le lien ne rallume pas une caméra');
});

test('D1 · le lien refait redéclare les pistes — sans quoi la porte de présence ne rouvre jamais', async () => {
  const h = await boot({ partie: 'notaire' });
  const premiere = h.salle.etat().pc;
  const ouverture = h.pistes().slice(-1)[0];
  assert.deepEqual([ouverture.video, ouverture.audio], [true, true]);

  premiere.__etat('failed');
  await wait(10);
  const mortes = h.pistes().slice(-1)[0];
  assert.deepEqual([mortes.video, mortes.audio], [false, false], 'une connexion tombée ne transporte plus rien');

  h.avancer(h.salle.RELANCE_LIEN_MS + 1);
  await h.salle.assurerLien();
  await wait(20);
  const vives = h.pistes().slice(-1)[0];
  assert.deepEqual([vives.video, vives.audio], [true, true], 'le lien revenu doit être déclaré, sinon la reprise reste refusée');
});

// ---------------------------------------------------------------------------
// D1 — côté client : la signalisation d'une négociation morte ne compte plus
// ---------------------------------------------------------------------------

test('D1 · le client refait SA connexion quand l’offre porte d’autres clés', async () => {
  const h = await boot({ partie: 'client' });
  const premiere = h.salle.etat().pc;

  h.poser(salleServeur({ lien: { empreinteNotaire: 'N-1', empreinteClient: null, confirmeLe: null } }));
  h.deposer(signalOffre(1, 'N-1'));
  await h.sonder();
  assert.equal(h.reponses().length, 1, 'le client répond à l’offre courante');
  assert.equal(h.salle.etat().pc, premiere, 'la première offre n’exige aucune reconstruction');

  // Le notaire est reparti de zéro : son offre ne porte plus les mêmes clés.
  h.poser(salleServeur({ lien: { empreinteNotaire: 'N-2', empreinteClient: null, confirmeLe: null } }));
  h.deposer(signalOffre(2, 'N-2'));
  await h.sonder();
  assert.equal(h.reponses().length, 2, 'le client répond à la nouvelle négociation');
  assert.notEqual(h.salle.etat().pc, premiere, 'une négociation neuve prend une connexion neuve');
  assert.equal(premiere.__fermee, true, 'l’ancienne connexion est fermée');
});

test('D1 · une offre PÉRIMÉE qui traîne dans la file ne reçoit pas de réponse', async () => {
  // Rouvrir la salle repart d'un curseur vierge : la signalisation de la
  // séance précédente est encore là. Y répondre enverrait au notaire une
  // réponse qu'il ne peut plus appliquer — et les deux s'attendraient.
  const h = await boot({ partie: 'client' });
  h.poser(salleServeur({ lien: { empreinteNotaire: 'N-2', empreinteClient: null, confirmeLe: null } }));
  h.deposer(signalOffre(1, 'N-1-PERIMEE'));
  await h.sonder();
  assert.equal(h.reponses().length, 0, 'l’empreinte que le serveur détient dit quelle offre est courante');

  h.deposer(signalOffre(2, 'N-2'));
  await h.sonder();
  assert.equal(h.reponses().length, 1, 'et la courante, elle, obtient sa réponse');
});

// ---------------------------------------------------------------------------
// D2 — la porte de présence nomme ce qui s'est passé
// ---------------------------------------------------------------------------

const salleObservee = (over = {}) => ({
  id: 'S-1', bidId: BID, dateISO: DATE, mode: 'strict', statut: D.SALLE_STATUT.OUVERTE, etape: 'lecture',
  parties: {
    notaire: { authentifie: true, vuLe: T0, pistes: { video: true, audio: true } },
    client: { authentifie: true, vuLe: T0, pistes: { video: true, audio: true } },
  },
  identites: {}, lien: {}, consentements: {}, presence: { coupeeA: null, repriseA: null }, pv: [],
  ...over,
});

test('D2 · quand le CLIENT part, on ne dit pas au notaire que sa caméra a lâché', () => {
  // Ce que le navigateur du notaire déclare quand son lien tombe : ses propres
  // pistes mortes. C'est vrai du lien, pas de la caméra — et c'est le domaine
  // qui doit trancher, puisque c'est lui qui écrit la phrase.
  const nowMs = T0 + 25000; // le client s'est tu il y a 25 s
  const salle = salleObservee();
  salle.parties.notaire.pistes = { video: false, audio: false };
  salle.parties.notaire.vuLe = nowMs; // le notaire, lui, vient de sonder

  const porte = D.salleReadiness(salle, { nowMs }).portes.presence;
  assert.equal(porte.ouverte, false);
  assert.match(porte.message, /client/i, 'la porte doit nommer qui est parti : ' + porte.message);
  assert.ok(!/caméra du notaire|micro du notaire/i.test(porte.message),
    'la caméra du notaire n’y est pour rien : ' + porte.message);
});

test('D2 · une caméra vraiment coupée, elle, est toujours nommée', () => {
  // La correction ne doit pas avaler le cas d'origine : le client est là, il
  // sonde, et c'est bien sa caméra qui s'est éteinte.
  const salle = salleObservee();
  salle.parties.client.pistes = { video: false, audio: true };
  const porte = D.salleReadiness(salle, { nowMs: T0 + 1000 }).portes.presence;
  assert.equal(porte.raison, 'piste_video');
  assert.match(porte.message, /caméra du client/i);
});

test('D2 · deux navigateurs muets à la même seconde, c’est le lien, pas deux caméras', () => {
  const salle = salleObservee();
  salle.parties.notaire.pistes = { video: false, audio: false };
  salle.parties.client.pistes = { video: false, audio: false };
  const porte = D.salleReadiness(salle, { nowMs: T0 + 1000 }).portes.presence;
  assert.equal(porte.raison, 'lien_perdu');
  assert.match(porte.message, /lien vidéo/i);
});

test('D2 · une séance sans horodatage de présence garde l’ancien verdict', () => {
  // Les fixtures et les vieux enregistrements n'ont pas de `vuLe` : le silence
  // ne s'invente pas à partir de rien.
  const salle = salleObservee();
  delete salle.parties.client.vuLe;
  delete salle.parties.notaire.vuLe;
  salle.parties.client.pistes = { video: true, audio: false };
  const porte = D.salleReadiness(salle, { nowMs: T0 + 10 * 60000 }).portes.presence;
  assert.equal(porte.raison, 'piste_audio');
});

// ---------------------------------------------------------------------------
// D3 — la salle parle anglais, y compris le geste qui ouvre la porte du lien
// ---------------------------------------------------------------------------

test('D3 · tout ce que la salle compose a une entrée anglaise vivante', () => {
  I18N.force('en');
  const composees = [
    // Le geste anti-interception : il était la seule phrase française d'un
    // écran anglais, et c'est celui qui ouvre la porte du lien.
    'Les deux chaînes concordent',
    'Reprendre la séance',
    'Libérer la signature',
    'Sceller le procès-verbal',
    'Retirer mon accord',
    // Ce que le domaine répond quand la porte de présence est fermée.
    'Le client a quitté la séance ou a perdu sa connexion.',
    'Le notaire a quitté la séance ou a perdu sa connexion.',
    'Le lien vidéo entre les deux navigateurs est perdu. Aucune des deux parties ne reçoit plus l’autre.',
    'La caméra du client n’envoie plus d’image.',
    'Le lien est coupé depuis 45 s.',
    'L’identité n’est pas encore vérifiée pour : notaire, client.',
  ];
  for (const fr of composees) {
    const n = I18N.normalize(fr);
    assert.ok(I18N.covered(n), 'aucune entrée anglaise pour : ' + fr);
    const en = I18N.tEn(n);
    assert.notEqual(en, fr, 'identity — la phrase atteint un lecteur anglais en français : ' + fr);
    assert.ok(!/[àâçèéêëîïôùû]/i.test(en), 'du français est resté dans l’anglais : ' + en);
  }
});

test('D3 · les phrases enrôlées sont bien celles que le code produit', () => {
  // Une entrée de dictionnaire qui ne correspond à aucune phrase réelle protège
  // du vide. Celles-ci viennent du code, mot pour mot.
  assert.ok(SALLE_SRC.includes("'Les deux chaînes concordent'"),
    'salle.js ne compose plus « Les deux chaînes concordent » — relire l’entrée du dictionnaire');
  const absent = D.salleReadiness(salleObservee({
    parties: {
      notaire: { authentifie: true, vuLe: T0, pistes: { video: true, audio: true } },
      client: { authentifie: true, vuLe: T0 - 60000, pistes: { video: true, audio: true } },
    },
  }), { nowMs: T0 }).portes.presence;
  assert.ok(I18N.covered(I18N.normalize(absent.message)),
    'la phrase que le domaine produit vraiment n’a pas d’entrée : ' + absent.message);
});
