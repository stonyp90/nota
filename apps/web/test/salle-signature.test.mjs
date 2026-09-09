/**
 * ADR 0047 — LA SALLE DE SIGNATURE, à l'écran.
 *
 * jsdom n'a ni caméra, ni RTCPeerConnection, ni MediaRecorder. Le module les
 * prend donc par `__deps`, et ces tests les remplacent par des doublures qui
 * enregistrent ce qu'on leur demande. Ce n'est pas un contournement : c'est ce
 * qui permet de vérifier des choses qu'un vrai navigateur rendrait invisibles —
 * notamment que la clé d'enregistrement ne part JAMAIS sur le réseau.
 *
 * Ce que ce fichier défend, dans l'ordre des exigences
 * (docs/salle-signature-exigences-tenues.md) : C3, D4, F3, G3.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';

const openWindows = [];
after(() => { for (const w of openWindows) { try { w.close(); } catch { /* déjà fermée */ } } });

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const SALLE_SRC = readFileSync(fileURLToPath(new URL('../public/salle.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.parse('2026-09-09T14:00:00.000Z');
const BID = 'o1';
const DATE = '2026-09-30';

// --- Les doublures du matériel ---------------------------------------------
// Une piste dont on peut couper le courant : c'est tout ce dont la salle a
// besoin pour décider si le notaire voit et entend.
function piste(kind) {
  const ecouteurs = {};
  return {
    kind, enabled: true, muted: false, readyState: 'live',
    addEventListener(nom, fn) { (ecouteurs[nom] = ecouteurs[nom] || []).push(fn); },
    stop() { this.readyState = 'ended'; },
    // Ce que le navigateur fait quand la caméra est débranchée.
    __couper() { this.readyState = 'ended'; (ecouteurs.ended || []).forEach((fn) => fn()); },
  };
}

function fluxFactice() {
  const pistes = [piste('video'), piste('audio')];
  return { getTracks: () => pistes, __video: pistes[0], __audio: pistes[1] };
}

function connexionFactice() {
  return class {
    constructor() {
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = 'new';
      this.__ajoutes = [];
    }
    addTrack(t) { this.__ajoutes.push(t); }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD\r\n' });
    }
    createAnswer() {
      return Promise.resolve({ type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 11:22:33:44\r\n' });
    }
    setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
    setRemoteDescription(d) { this.remoteDescription = d; return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    close() { this.connectionState = 'closed'; }
  };
}

// Un MediaRecorder qui rend des octets qu'on reconnaîtra à l'œil nu si jamais
// ils sortaient en clair.
const CLAIR = 'CECI-EST-LA-SEANCE-EN-CLAIR';
function enregistreurFactice() {
  return class {
    constructor(flux) { this.flux = flux; this.state = 'inactive'; }
    start() {
      this.state = 'recording';
      setTimeout(() => {
        if (this.ondataavailable) {
          const octets = new TextEncoder().encode(CLAIR);
          this.ondataavailable({ data: { size: octets.length, arrayBuffer: () => Promise.resolve(octets.buffer) } });
        }
      }, 5);
    }
    stop() { this.state = 'inactive'; }
  };
}

// --- L'état que le serveur renvoie -----------------------------------------
function salleServeur(over = {}) {
  const D = over.__D;
  const portes = Object.assign({
    compte: { ouverte: true, raison: null, message: null },
    identite: { ouverte: false, raison: 'identite_manquante', message: 'L’identité n’est pas encore vérifiée pour : client.' },
    lien: { ouverte: false, raison: 'lien_non_confirme', message: 'Le notaire n’a pas encore confirmé que les deux chaînes concordent.' },
    presence: { ouverte: true, raison: null, message: null },
  }, over.portes || {});
  const fermees = Object.keys(portes).filter((k) => !portes[k].ouverte);
  return Object.assign({
    id: 'S-' + BID, bidId: BID, dateISO: DATE, mode: 'strict', demonstration: true,
    statut: 'ouverte', etape: 'accueil',
    etapes: D ? D.CEREMONIE_ETAPES : [],
    portes, fermees, toutesOuvertes: fermees.length === 0,
    sas: 'K7M2-QP49',
    lien: { empreinteNotaire: 'AA:BB:CC:DD', empreinteClient: '11:22:33:44', confirmeLe: null },
    identites: { notaire: null, client: null },
    consentements: { notaire: null, client: null },
    consentement: { requis: true, complet: false, manquants: ['notaire', 'client'], retires: [] },
    enregistre: false,
    parties: {
      notaire: { authentifie: true, pistes: { video: true, audio: true } },
      client: { authentifie: true, pistes: { video: true, audio: true } },
    },
    presence: { coupeeA: null, repriseA: null },
    signature: null, scelle: null, pv: [], rev: 3,
  }, over, { portes, fermees });
}

async function boot({ partie = 'notaire', salle, reponses = {} } = {}) {
  const appels = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const appel = { url: String(u), init: init || {} };
        appels.push(appel);
        const chemin = appel.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        const fait = reponses[chemin];
        const corps = typeof fait === 'function' ? fait(appel) : fait;
        const etat = corps === undefined ? { salle: courante() } : corps;
        // Un corps qui porte des `errors` est un REFUS : le rendre en 200
        // laisserait la salle appliquer un état absent, ce qu'aucun serveur ne
        // fait et ce qu'aucun test ne doit simuler.
        const refuse = !!(etat && etat.errors);
        return Promise.resolve({ ok: !refuse, status: refuse ? 422 : 200, json: async () => etat });
      };
      window.crypto = webcrypto;
      window.scrollTo = () => {};
    },
  });
  const win = dom.window;
  openWindows.push(win);
  win.eval(DOMAIN_SRC);
  win.eval(SALLE_SRC);

  const D = win.NotaDomain;
  let etatServeur = salle || salleServeur({ __D: D });
  const courante = () => etatServeur;

  const flux = fluxFactice();
  const deps = win.NotaSalle.__deps;
  deps.RTCPeerConnection = connexionFactice();
  deps.MediaRecorder = enregistreurFactice();
  deps.getUserMedia = () => Promise.resolve(flux);
  deps.subtle = webcrypto.subtle;
  deps.now = () => T0;
  // Le sondage est neutralisé : ces tests pilotent l'état à la main, et une
  // boucle de fond rendrait chaque attente indéterminée.
  deps.setTimeout = () => 0;
  deps.clearTimeout = () => {};

  win.Nota = { API_BASE: '/api' };
  win.NotaSalle.boot();
  await win.NotaSalle.ouvrir({ id: BID, dateISO: DATE, partie, token: 'jeton-' + partie });
  await wait(30);

  return {
    win, doc: win.document, D, appels, flux,
    salle: win.NotaSalle,
    // Poser un nouvel état SERVEUR : la salle vit de ce que le serveur lui
    // renvoie, donc on le remplace là où elle l'a rangé, puis on redessine.
    // Reconstruire la page à chaque état coûterait une seconde par assertion.
    poser(nouvel) {
      etatServeur = nouvel;
      const vivant = win.NotaSalle.etat();
      if (vivant) vivant.salle = nouvel;
      win.NotaSalle.rendre();
    },
    etatServeur: () => etatServeur,
  };
}

const $ = (doc, id) => doc.getElementById(id);
const boutons = (doc) => Array.from($(doc, 'salle-actions').querySelectorAll('button')).map((b) => b.textContent);
const clic = (doc, texte) => {
  const b = Array.from($(doc, 'salle-actions').querySelectorAll('button')).find((x) => x.textContent.includes(texte));
  assert.ok(b, 'bouton introuvable : ' + texte + ' (présents : ' + boutons(doc).join(' | ') + ')');
  b.click();
  return b;
};

// ---------------------------------------------------------------------------
// G3 — le bandeau bêta
// ---------------------------------------------------------------------------

test('G3 · le bandeau bêta est là, dit ce qu’il faut, et aucun rendu ne le retire', async () => {
  const { doc, salle, poser, D } = await boot();
  const bandeau = $(doc, 'salle-beta');
  assert.ok(bandeau, 'le bandeau doit exister dans le HTML, pas dans un rendu');
  assert.equal(bandeau.hidden, false);
  assert.match(bandeau.textContent, /Bêta/);
  assert.match(bandeau.textContent, /Aucun acte notarié n’est reçu/);
  assert.match(bandeau.textContent, /Chambre des notaires/);

  // Il survit à tout : un rendu, un changement d'état, la clôture.
  poser(salleServeur({ __D: D, etape: 'cloture', statut: 'scellee', scelle: { empreinte: 'a'.repeat(64), entrees: [] } }));
  salle.rendre();
  assert.equal($(doc, 'salle-beta').hidden, false);
  assert.match($(doc, 'salle-beta').textContent, /Bêta/);
});

test('F3 · aucune surface de la salle n’affirme une approbation de la Chambre', async () => {
  const { doc } = await boot();
  const texte = $(doc, 'salle-plein').textContent + ' ' + ($(doc, 'salle-annonce') || {}).textContent
    + ' ' + ($(doc, 'salle-annonce-notaire') || {}).textContent;
  // Ce qu'on ne doit jamais lire : une conformité, une approbation, une
  // certification que personne n'a délivrée.
  for (const mensonge of [/approuvée? par la Chambre/i, /conforme aux normes/i, /certifiée?/i, /homologuée?/i, /agréée? par la Chambre/i]) {
    assert.ok(!mensonge.test(texte), 'la salle affirme une approbation qui n’existe pas : ' + mensonge);
  }
  // Ce qu'on doit lire à la place : d'où vient la signature juridique.
  assert.match(texte, /flux admis par la Chambre des notaires/);
});

// ---------------------------------------------------------------------------
// Les portes, telles qu'on les voit
// ---------------------------------------------------------------------------

test('les quatre portes s’affichent, et une porte fermée DIT pourquoi', async () => {
  const { doc, D } = await boot();
  const lignes = Array.from($(doc, 'salle-portes').children);
  assert.equal(lignes.length, D.SALLE_PORTES.length);
  // Array.from côté test : `D.SALLE_PORTES` vient du realm jsdom, et
  // deepEqual compare aussi les prototypes.
  assert.deepEqual(lignes.map((l) => l.dataset.porte), Array.from(D.SALLE_PORTES));

  const identite = lignes.find((l) => l.dataset.porte === 'identite');
  assert.ok(!identite.classList.contains('is-ouverte'));
  // Le motif, pas une pastille muette : le notaire doit savoir quoi faire.
  assert.match(identite.querySelector('.salle-porte-motif').textContent, /identité n’est pas encore vérifiée/);
  // Et le nom vient du domaine, pas d'une chaîne recopiée dans la maquette.
  assert.equal(identite.querySelector('.salle-porte-nom').textContent, D.SALLE_PORTE_LABELS.identite.nom);

  const compte = lignes.find((l) => l.dataset.porte === 'compte');
  assert.ok(compte.classList.contains('is-ouverte'));
  assert.equal(compte.querySelector('.salle-porte-motif'), null, 'une porte ouverte n’a rien à expliquer');
});

test('la chaîne d’authentification s’affiche en grand et se marque quand elle est confirmée', async () => {
  const { doc, D, poser } = await boot();
  assert.equal($(doc, 'salle-sas').textContent, 'K7M2-QP49');
  assert.ok(!$(doc, 'salle-sas').classList.contains('is-confirme'));

  poser(salleServeur({ __D: D, portes: { lien: { ouverte: true, raison: null, message: null } } }));
  assert.ok($(doc, 'salle-sas').classList.contains('is-confirme'));
});

test('le texte de conduite vient du domaine, mot pour mot', async () => {
  const { doc, D, poser } = await boot();
  const accueil = D.etapeById('accueil');
  assert.equal($(doc, 'salle-etape-nom').textContent, accueil.nom);
  assert.equal($(doc, 'salle-etape-conduite').textContent, accueil.conduite);
  assert.equal($(doc, 'salle-etape-constat').textContent, accueil.constat);

  poser(salleServeur({ __D: D, etape: 'lecture' }));
  assert.equal($(doc, 'salle-etape-conduite').textContent, D.etapeById('lecture').conduite);
});

// ---------------------------------------------------------------------------
// Qui peut faire quoi
// ---------------------------------------------------------------------------

test('le client ne voit pas les commandes du notaire — et garde la seule qui est sienne', async () => {
  const { doc } = await boot({ partie: 'client' });
  const vus = boutons(doc).join(' | ');
  assert.ok(!/chaînes concordent/.test(vus), 'le client ne confirme pas le lien');
  assert.ok(!/Attester l’identité/.test(vus), 'le client n’atteste pas une identité');
  assert.ok(!/Passer à/.test(vus), 'le client ne conduit pas la cérémonie');
  // Le consentement, lui, est à lui : il doit pouvoir le donner ET le retirer.
  assert.ok(/J’accepte/.test(vus), 'le client doit pouvoir donner son accord');
});

test('le notaire conduit : confirmer le lien, attester, avancer', async () => {
  const { doc, appels } = await boot({ partie: 'notaire' });
  const vus = boutons(doc).join(' | ');
  assert.match(vus, /Les deux chaînes concordent/);
  assert.match(vus, /Attester l’identité/);
  assert.match(vus, /Passer à/);

  clic(doc, 'Les deux chaînes concordent');
  await wait(20);
  const post = appels.find((a) => a.url.includes('/salle/lien'));
  assert.ok(post, 'la confirmation passe par POST /salle/lien');
  // La chaîne envoyée est celle que le SERVEUR a calculée, jamais une saisie.
  assert.equal(JSON.parse(post.init.body).sas, 'K7M2-QP49');
  assert.match(String(post.init.headers.authorization), /jeton-notaire/);
});

test('le bouton de signature est grisé tant qu’une porte est fermée — sans jamais être la sécurité', async () => {
  const { doc, D, poser } = await boot();
  poser(salleServeur({ __D: D, etape: 'questions' }));
  const b = Array.from($(doc, 'salle-actions').querySelectorAll('button')).find((x) => /Libérer la signature/.test(x.textContent));
  assert.ok(b, 'le geste suivant après « Questions » est la signature');
  assert.equal(b.disabled, true, 'trois portes sont fermées');

  const ouvertes = {
    compte: { ouverte: true }, identite: { ouverte: true }, lien: { ouverte: true }, presence: { ouverte: true },
  };
  poser(salleServeur({ __D: D, etape: 'questions', portes: ouvertes }));
  const b2 = Array.from($(doc, 'salle-actions').querySelectorAll('button')).find((x) => /Libérer la signature/.test(x.textContent));
  assert.equal(b2.disabled, false);
});

test('un refus du serveur est recopié tel quel, jamais reformulé', async () => {
  const { doc, D, poser } = await boot({
    reponses: {
      '/api/salle/etape': { errors: [{ code: 'porte_fermee', message: 'La caméra du client n’envoie plus d’image.' }] },
    },
  });
  poser(salleServeur({ __D: D, etape: 'questions' }));
  // Le serveur refusera ; l'écran doit dire SA phrase, pas une paraphrase.
  const b = Array.from($(doc, 'salle-actions').querySelectorAll('button')).find((x) => /Libérer la signature/.test(x.textContent));
  b.disabled = false;
  b.click();
  await wait(20);
  const refus = $(doc, 'salle-refus');
  assert.equal(refus.hidden, false);
  assert.equal(refus.textContent.trim(), 'La caméra du client n’envoie plus d’image.');
});

// ---------------------------------------------------------------------------
// C3 — une piste qui meurt
// ---------------------------------------------------------------------------

test('C3 · une caméra débranchée est signalée tout de suite, pas au prochain sondage', async () => {
  const { appels, flux } = await boot();
  const avant = appels.filter((a) => a.url.includes('/salle/pistes')).length;

  flux.__video.__couper();
  await wait(20);

  const pistes = appels.filter((a) => a.url.includes('/salle/pistes'));
  assert.ok(pistes.length > avant, 'la coupure doit partir immédiatement');
  const dernier = JSON.parse(pistes[pistes.length - 1].init.body);
  assert.equal(dernier.video, false, 'la vidéo est morte');
  assert.equal(dernier.audio, true, 'le micro, lui, vit encore');
});

test('quitter éteint les pistes — une caméra ne reste pas allumée après la séance', async () => {
  const { salle, flux, doc } = await boot();
  assert.equal(flux.__video.readyState, 'live');
  salle.quitter();
  assert.equal(flux.__video.readyState, 'ended');
  assert.equal(flux.__audio.readyState, 'ended');
  assert.equal($(doc, 'salle-plein').hidden, true);
});

// ---------------------------------------------------------------------------
// D4 — l'enregistrement
// ---------------------------------------------------------------------------

test('D4 · l’enregistrement est chiffré dans le navigateur, et la clé ne part jamais', async () => {
  const { appels, salle, D, poser } = await boot();
  // Le serveur déclare l'enregistrement actif : c'est LUI qui tient les deux
  // accords, jamais une case cochée ici.
  poser(salleServeur({
    __D: D, mode: 'temoin', enregistre: true,
    consentements: {
      notaire: { donneLe: '2026-09-09T14:01:00.000Z', enregistrement: true, retireLe: null },
      client: { donneLe: '2026-09-09T14:01:05.000Z', enregistrement: true, retireLe: null },
    },
    consentement: { requis: true, complet: true, manquants: [], retires: [] },
  }));

  // C'est LE MODULE qui enregistre et qui chiffre — pas ce test. Le battement
  // de `boot()` l'allumerait au bout d'une seconde ; on provoque le même geste.
  const demarre = await salle.demarrerEnregistrement();
  assert.equal(demarre, true, 'l’enregistrement devrait démarrer');
  await wait(40);

  const etat = salle.etat();
  assert.ok(etat.morceaux.length > 0, 'aucun morceau n’a été produit');
  // Chaque morceau est un chiffré AES-GCM avec son propre vecteur : jamais les
  // octets bruts de la séance.
  for (const m of etat.morceaux) {
    assert.equal(m.iv.length, 12, 'un chiffré AES-GCM porte son vecteur');
    const brut = new TextDecoder().decode(m.chiffre);
    assert.ok(!brut.includes(CLAIR), 'les octets de la séance sortent en clair');
  }

  // Et ils se déchiffrent avec la clé que le module a gardée : le chiffrement
  // est réel, pas un brouillage qui perdrait la séance.
  const m0 = etat.morceaux[0];
  const rendu = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: m0.iv }, etat.cleEnregistrement, m0.chiffre);
  assert.equal(new TextDecoder().decode(new Uint8Array(rendu)), CLAIR);

  // LA vérification qui compte : rien de ce qui est passé par fetch ne porte
  // la séance ni la clé. Nota ne peut pas remettre ce qu'il ne détient pas.
  const exportee = new Uint8Array(await webcrypto.subtle.exportKey('raw', etat.cleEnregistrement));
  const hexCle = Array.from(exportee).map((b) => b.toString(16).padStart(2, '0')).join('');
  const b64Cle = Buffer.from(exportee).toString('base64');
  const tout = appels.map((a) => a.url + ' ' + String((a.init && a.init.body) || '')).join('\n');
  assert.ok(!tout.includes(CLAIR), 'la séance en clair a traversé le réseau');
  assert.ok(!tout.includes(hexCle), 'la clé d’enregistrement a traversé le réseau (hex)');
  assert.ok(!tout.includes(b64Cle), 'la clé d’enregistrement a traversé le réseau (base64)');

  // Un retrait d'accord arrête tout, à l'instant.
  salle.arreterEnregistrement();
  assert.equal(salle.etat().enregistreur, null);
});

// ---------------------------------------------------------------------------
// La signature et le scellé, tels qu'ils s'affichent
// ---------------------------------------------------------------------------

test('l’avis du fournisseur de démonstration est affiché, jamais avalé', async () => {
  const { doc, D, poser } = await boot();
  poser(salleServeur({
    __D: D, etape: 'signature',
    signature: {
      fournisseur: 'demonstration', reference: 'DEMO-ABC123-1', minute: null,
      signeeLe: '2026-09-09T14:20:00.000Z',
      avis: 'Signature de démonstration. Aucun acte notarié n’a été reçu et aucune minute n’a été créée.',
    },
  }));
  assert.match($(doc, 'salle-statut').textContent, /Signature de démonstration/);
  assert.match($(doc, 'salle-statut').textContent, /aucune minute n’a été créée/);
});

test('le scellé affiche son empreinte, en entier, pour être recopiée', async () => {
  const { doc, D, poser } = await boot();
  const empreinte = 'ab12cd34'.repeat(8);
  poser(salleServeur({ __D: D, etape: 'cloture', statut: 'scellee', scelle: { empreinte, entrees: [] } }));
  const code = $(doc, 'salle-statut').querySelector('.salle-empreinte');
  assert.ok(code, 'l’empreinte doit être affichée');
  assert.equal(code.textContent, empreinte, 'tronquée, elle ne prouve plus rien');
});

test('une séance suspendue le dit, et n’offre que la reprise', async () => {
  const { doc, D, poser } = await boot();
  poser(salleServeur({
    __D: D, statut: 'suspendue', etape: 'lecture',
    portes: { presence: { ouverte: false, raison: 'lien_coupe', message: 'Le lien est coupé depuis 45 s.' } },
  }));
  assert.match($(doc, 'salle-statut').textContent, /Séance suspendue/);
  assert.match($(doc, 'salle-statut').textContent, /signature est impossible/);
  const vus = boutons(doc).join(' | ');
  assert.match(vus, /Reprendre la séance/);
  assert.ok(!/Passer à/.test(vus), 'une séance suspendue n’avance pas');
});

// ---------------------------------------------------------------------------
// Le lien, côté navigateur
// ---------------------------------------------------------------------------

test('l’empreinte DTLS est lue dans le SDP local et publiée', async () => {
  const { salle, appels } = await boot({ partie: 'notaire' });
  assert.equal(salle.empreinteDe('v=0\r\na=fingerprint:sha-256 AA:BB:CC\r\nm=audio\r\n'), 'AA:BB:CC');
  assert.equal(salle.empreinteDe('v=0\r\nm=audio\r\n'), null, 'un SDP sans empreinte ne doit pas en inventer une');
  // Et le premier appel a bien rejoint la séance.
  assert.ok(appels.some((a) => a.url.includes('/salle/rejoindre')));
});

test('une caméra refusée explique pourquoi la séance ne peut pas commencer', async () => {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ salle: salleServeur({}), ice: [] }) });
      window.crypto = webcrypto;
      window.scrollTo = () => {};
    },
  });
  openWindows.push(dom.window);
  dom.window.eval(DOMAIN_SRC);
  dom.window.eval(SALLE_SRC);
  const deps = dom.window.NotaSalle.__deps;
  deps.RTCPeerConnection = connexionFactice();
  deps.setTimeout = () => 0;
  const refus = new Error('Permission denied');
  refus.name = 'NotAllowedError';
  deps.getUserMedia = () => Promise.reject(refus);
  dom.window.Nota = { API_BASE: '/api' };

  await dom.window.NotaSalle.ouvrir({ id: BID, dateISO: DATE, partie: 'client', token: 'jeton' });
  await wait(20);
  const refusBox = dom.window.document.getElementById('salle-refus');
  assert.equal(refusBox.hidden, false);
  assert.match(refusBox.textContent, /caméra ou au micro/);
  assert.match(refusBox.textContent, /doit vous voir et vous entendre/);
});

// ---------------------------------------------------------------------------
// L'adresse de la séance
// ---------------------------------------------------------------------------

test('toute requête de la salle porte son adresse — l’offre ET sa date', async () => {
  // Une séance s'adresse par son offre et sa date : l'API répond 400 sans les
  // deux, et n'entre même pas dans la salle. Elles ne partaient que dans le
  // CORPS, donc les POST les avaient et les LECTURES non : chaque sondage
  // échouait, en silence — une requête sans réponse utilisable est traitée ici
  // comme un pair muet — et le lien ne montait jamais. Rien dans jsdom ne le
  // montrait, parce que la doublure de `fetch` répondait sans regarder l'URL.
  const h = await boot({ partie: 'notaire' });
  const appels = h.appels.filter((a) => a.url.includes('/salle'));
  assert.ok(appels.length >= 3, 'ouvrir doit rejoindre, déclarer ses pistes et sonder');

  for (const a of appels) {
    const url = new URL(a.url, 'https://nota.example');
    const corps = a.init.body ? JSON.parse(a.init.body) : null;
    const adresse = corps
      ? { id: corps.id, dateISO: corps.dateISO }
      : { id: url.searchParams.get('id'), dateISO: url.searchParams.get('dateISO') };
    assert.deepEqual(adresse, { id: BID, dateISO: DATE }, 'sans adresse : ' + a.url);
  }

  // Et il y a bien une LECTURE parmi elles : c'est la famille qui les oubliait.
  assert.ok(appels.some((a) => !a.init.body), 'le sondage est une lecture, pas un envoi');
});
