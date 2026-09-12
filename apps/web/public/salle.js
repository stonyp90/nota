/* =============================================================================
   LA SALLE DE SIGNATURE — ADR 0047. Zéro dépendance d'exécution.

   WebRTC, MediaRecorder et crypto.subtle sont des interfaces du navigateur : ce
   module n'apporte aucune bibliothèque. Il tient quatre choses, et rien de plus.

     1. LE LIEN. Une connexion directe entre les deux navigateurs quand elle
        est possible, chiffrée de bout en bout : Nota ne peut pas la lire. Quand
        elle ne l'est pas, un relais fourni par Nota (TURN, voir
        apps/api/src/salle.js) achemine les paquets — il les transporte sans
        pouvoir les ouvrir, les clés DTLS ne quittant pas les deux navigateurs.
        Ce module ne force aucun des deux chemins. Ce qui passe par l'API, c'est
        la signalisation, et elle ne sert à rien sans ces mêmes clés.
     2. LA CHAÎNE D'AUTHENTIFICATION. Dérivée des DEUX empreintes DTLS par le
        domaine, affichée en grand des deux côtés, lue à voix haute. Un
        intercepteur négocie deux sessions distinctes : il ne peut pas produire
        la même chaîne des deux côtés.
     3. LA CONDUITE. Le notaire fait avancer la cérémonie ; le texte qu'il a à
        dire vient du domaine, pas de cette maquette.
     4. L'ENREGISTREMENT, quand les deux parties l'ont accepté : chiffré DANS le
        navigateur, avec une clé qui ne quitte jamais l'appareil du notaire.

   Ce qui DÉCIDE est dans @nota/domain et revalidé par l'API. Cet écran ne fait
   qu'obéir et montrer — un bouton grisé ici n'est jamais la sécurité ; la
   sécurité est le refus du serveur derrière lui.

   Testabilité : tout ce qui touche au matériel passe par `deps`, remplaçable
   par `window.NotaSalle.__deps`. jsdom n'a ni caméra ni RTCPeerConnection, et
   une salle qu'on ne peut pas tester est une salle qu'on ne peut pas défendre.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotaSalle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var D = (typeof window !== 'undefined' && window.NotaDomain) || (typeof globalThis !== 'undefined' && globalThis.NotaDomain) || null;

  // Les cadences de sondage. Serré pendant l'établissement (chaque candidat ICE
  // qui traîne rallonge la connexion), lâche ensuite : une fois le lien monté,
  // il n'y a plus rien à signaler et le sondage ne sert qu'au battement de
  // présence.
  var SONDAGE_CONNEXION_MS = 800;
  var SONDAGE_ETABLI_MS = 3000;

  // Le délai au bout duquel une offre restée sans lien est REFAITE. Une offre
  // n'est pas un acquis : le pair d'en face peut avoir fermé sa page et rouvert
  // la salle, et il attend alors une offre que ce navigateur croit avoir déjà
  // faite. Assez long pour laisser le rassemblement ICE et la poignée DTLS
  // aboutir, assez court pour qu'une personne qui revient ne regarde pas un
  // écran noir en se demandant quoi faire.
  var RELANCE_LIEN_MS = 8000;

  var deps = {
    fetch: function () { return (typeof fetch === 'function' ? fetch.apply(null, arguments) : Promise.reject(new Error('no fetch'))); },
    RTCPeerConnection: typeof window !== 'undefined' ? window.RTCPeerConnection : null,
    MediaRecorder: typeof window !== 'undefined' ? window.MediaRecorder : null,
    getUserMedia: function (contraintes) {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) return Promise.reject(new Error('media_indisponible'));
      return navigator.mediaDevices.getUserMedia(contraintes);
    },
    subtle: (typeof crypto !== 'undefined' && crypto.subtle) || null,
    now: function () { return Date.now(); },
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    clearTimeout: function (t) { return clearTimeout(t); },
  };

  // L'état vivant d'UNE séance. Un seul écran, une seule séance : ouvrir la
  // deuxième ferme la première (`quitter`), sans quoi deux jeux de pistes
  // resteraient allumés et le battement de présence mentirait sur l'un d'eux.
  var S = null;

  function $(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
  function vider(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function el(tag, cls, texte) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texte != null) e.textContent = texte;
    return e;
  }

  // ---------------------------------------------------------------------------
  // L'API
  // ---------------------------------------------------------------------------
  function base() {
    if (typeof window !== 'undefined' && window.Nota && window.Nota.API_BASE) return window.Nota.API_BASE;
    return '/api';
  }

  function appel(chemin, options) {
    var o = options || {};
    var url = base() + chemin;
    // L'ADRESSE DE LA SÉANCE VOYAGE TOUJOURS. Une séance s'adresse par son
    // offre et sa date : sans les deux, l'API répond 400 et n'entre même pas
    // dans la salle. Elles partaient dans le corps des POST et nulle part
    // ailleurs, si bien que CHAQUE sondage échouait — en silence, puisqu'une
    // requête sans réponse utilisable est traitée ici comme un pair muet. Le
    // lien ne montait jamais, et rien ne le disait.
    var query = {};
    if (o.query) for (var k in o.query) if (Object.prototype.hasOwnProperty.call(o.query, k)) query[k] = o.query[k];
    if (!o.body) { query.id = S.id; query.dateISO = S.dateISO; }
    var qs = Object.keys(query)
      .filter(function (c) { return query[c] !== undefined && query[c] !== null; })
      .map(function (c) { return encodeURIComponent(c) + '=' + encodeURIComponent(query[c]); })
      .join('&');
    if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    var entetes = { accept: 'application/json', authorization: 'Bearer ' + S.jeton };
    if (o.body) entetes['content-type'] = 'application/json';
    return deps.fetch(url, {
      method: o.method || 'GET',
      headers: entetes,
      body: o.body ? JSON.stringify(Object.assign({ id: S.id, dateISO: S.dateISO }, o.body)) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, body: j };
      });
    }).catch(function () {
      // Une requête qui n'aboutit pas est un pair silencieux, pas une erreur à
      // afficher : le serveur le remarquera tout seul et suspendra la séance.
      return { ok: false, status: 0, body: {} };
    });
  }

  // ---------------------------------------------------------------------------
  // Le lien
  // ---------------------------------------------------------------------------

  // L'empreinte DTLS, lue dans le SDP local. C'est la moitié de la chaîne
  // d'authentification, et la seule chose de la négociation qui prouve à qui on
  // parle vraiment.
  function empreinteDe(sdp) {
    var m = /^a=fingerprint:sha-256 (.+)$/m.exec(String(sdp || ''));
    return m ? m[1].trim() : null;
  }

  function creerConnexion(ice) {
    var PC = deps.RTCPeerConnection;
    if (!PC) throw new Error('webrtc_indisponible');
    var pc = new PC({ iceServers: ice || [], bundlePolicy: 'max-bundle' });

    // UNE connexion à la fois parle pour la séance. Quand le lien est refait,
    // l'ancienne agonise encore quelques instants et continue d'émettre :
    // sans cette garde, son dernier râle (« closed », « failed ») écraserait
    // l'état de la neuve et la salle se croirait morte au moment même où elle
    // renaît.
    var courante = function () { return !!S && S.pc === pc; };

    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !courante()) return;
      appel('/salle/signal', { method: 'POST', body: { type: 'candidat', charge: JSON.stringify(ev.candidate) } });
    };
    pc.ontrack = function (ev) {
      if (!courante()) return;
      S.fluxDistant = ev.streams && ev.streams[0] ? ev.streams[0] : S.fluxDistant;
      var v = $('salle-video-distant');
      if (v && S.fluxDistant) { v.srcObject = S.fluxDistant; if (v.play) { try { v.play(); } catch (e) { /* autoplay refusé */ } } }
      rendre();
    };
    pc.onconnectionstatechange = function () {
      if (!courante()) return;
      S.connexion = pc.connectionState;
      // Une connexion qui tombe n'est pas un message : c'est un état. On le
      // remonte tout de suite plutôt que d'attendre que le silence le dise —
      // et une connexion qui REVIENT se remonte pareillement, sans quoi les
      // pistes resteraient déclarées mortes après le rétablissement et la
      // porte de présence ne se rouvrirait jamais. `envoyerPistes` ne parle
      // que si l'état a vraiment changé.
      envoyerPistes();
      rendre();
    };
    return pc;
  }

  // Refaire le lien, pour de bon. Une RTCPeerConnection dont la poignée de main
  // est morte ne se rattrape pas en lui renvoyant une offre : ses clés DTLS et
  // ses identifiants ICE sont ceux d'un pair qui n'est plus là. On en construit
  // une neuve — c'est le geste que la salle bêta d'à côté fait déjà
  // (`releasePeer`, puis une nouvelle négociation), avec le vocabulaire d'ici.
  function refaireConnexion() {
    var ancienne = S.pc;
    S.candidatsEnAttente = [];
    S.empreintePubliee = null;
    S.empreinteDistante = null;
    S.offreA = 0;
    S.offreN = 0;
    S.connexion = 'new';
    S.fluxDistant = null;
    S.pc = creerConnexion(S.ice);
    if (S.fluxLocal && S.fluxLocal.getTracks) {
      S.fluxLocal.getTracks().forEach(function (t) { S.pc.addTrack(t, S.fluxLocal); });
    }
    if (ancienne) { try { ancienne.close(); } catch (e) { /* déjà fermée */ } }
    var v = $('salle-video-distant');
    if (v) v.srcObject = null;
    // Le lien reparti de zéro vaut ce que vaut une séance qui s'ouvre : les
    // pistes redeviennent déclarables, et la porte de présence peut rouvrir.
    envoyerPistes();
    rendre();
    return S.pc;
  }

  // Le notaire offre, le client répond. Un rôle fixe évite la collision de deux
  // offres simultanées (« glare ») sans négociation parfaite : c'est le notaire
  // qui conduit la séance, il conduit aussi la négociation.
  function offrir() {
    if (S.partie !== 'notaire') return Promise.resolve();
    var pc = S.pc;
    // L'heure de la tentative, pas un verrou. `offreFaite` était un booléen à
    // sens unique : une fois posé, plus jamais d'offre, et un client qui
    // revenait attendait indéfiniment celle que le notaire ne referait pas.
    S.offreA = deps.now();
    return pc.createOffer()
      .then(function (offre) { return pc.setLocalDescription(offre); })
      // L'empreinte AVANT l'offre, et attendue : le pair d'en face se sert de
      // celle que le serveur détient pour reconnaître l'offre COURANTE. Postée
      // après, elle laisserait passer une offre périmée pour la bonne.
      .then(function () { return publierEmpreinte(); })
      .then(function () {
        // La séance a pu être quittée pendant la négociation : `S` n'existe
        // alors plus, et rien de ce qui suit n'a de destinataire.
        if (!S || S.pc !== pc) return null;
        return appel('/salle/signal', { method: 'POST', body: { type: 'offre', charge: JSON.stringify(pc.localDescription) } })
          .then(function (r) { if (r && r.ok && r.body && r.body.n) S.offreN = r.body.n; return r; });
      });
  }

  // Le lien tient-il, et sinon, depuis assez longtemps pour qu'on le refasse ?
  // Appelé à chaque sondage : c'est une vérification, pas un événement, parce
  // que ce qui casse un lien ne s'annonce pas.
  function assurerLien() {
    if (S.partie !== 'notaire' || !S.pc) return Promise.resolve();
    var enRoute = (S.connexion === 'connected' || S.connexion === 'connecting') && !lienDementi();
    if (enRoute) return Promise.resolve();
    if (!S.offreA) return offrir();
    if ((deps.now() - S.offreA) < RELANCE_LIEN_MS) return Promise.resolve();
    refaireConnexion();
    return offrir();
  }

  // Le SERVEUR voit ce que la connexion locale met une demi-minute à admettre.
  // RTCPeerConnection reste « connected » longtemps après que le pair a fermé
  // sa page — la fraîcheur du consentement ICE expire lentement — alors que la
  // séance, elle, est déjà suspendue. Quand la séance est suspendue, que NOS
  // pistes vivent et que l'autre déclare les siennes vivantes, ce n'est ni sa
  // caméra ni la nôtre : c'est le lien, et il est à refaire.
  function lienDementi() {
    var s = S && S.salle;
    if (!s || s.statut !== 'suspendue') return false;
    var mien = pistesVivantes();
    if (!mien.video || !mien.audio) return false;
    var autre = (s.parties && s.parties[S.partie === 'notaire' ? 'client' : 'notaire']) || {};
    var pistes = autre.pistes || {};
    return pistes.video === true && pistes.audio === true;
  }

  function repondre(offre) {
    // Une offre qui ne porte pas l'empreinte de celle à laquelle on a déjà
    // répondu est une NOUVELLE négociation : le pair a refait sa connexion,
    // avec d'autres clés. On refait la nôtre plutôt que de recoller sa poignée
    // de main neuve sur une connexion qui a fini de mourir.
    var empreinte = empreinteDe(offre && offre.sdp);
    if (S.empreinteDistante && empreinte && !memeEmpreinte(S.empreinteDistante, empreinte)) refaireConnexion();
    S.empreinteDistante = empreinte;
    var pc = S.pc;
    return pc.setRemoteDescription(offre)
      .then(viderCandidatsEnAttente)
      .then(function () { return pc.createAnswer(); })
      .then(function (reponse) { return pc.setLocalDescription(reponse); })
      .then(function () { return publierEmpreinte(); })
      .then(function () {
        if (!S || S.pc !== pc) return null;
        return appel('/salle/signal', { method: 'POST', body: { type: 'reponse', charge: JSON.stringify(pc.localDescription) } });
      });
  }

  function publierEmpreinte() {
    if (!S || !S.pc) return Promise.resolve();
    var e = empreinteDe(S.pc.localDescription && S.pc.localDescription.sdp);
    if (!e || e === S.empreintePubliee) return Promise.resolve();
    S.empreintePubliee = e;
    return appel('/salle/rejoindre', { method: 'POST', body: { empreinte: e } });
  }

  function memeEmpreinte(a, b) {
    return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
  }

  function recevoirSignal(signal) {
    var charge;
    try { charge = JSON.parse(signal.charge); } catch (e) { return Promise.resolve(); }
    if (signal.type === 'offre') {
      // Une offre PÉRIMÉE traîne dans la file quand on rouvre la salle : la
      // signalisation survit à la page qui l'attendait. Y répondre renverrait
      // une réponse que le notaire ne peut plus appliquer, et les deux
      // resteraient à s'attendre. L'empreinte que le serveur détient est celle
      // de la négociation courante — elle y est déposée avant l'offre — donc
      // une offre qui ne la porte pas n'est plus d'actualité.
      var attendue = S.salle && S.salle.lien && S.salle.lien.empreinteNotaire;
      var portee = empreinteDe(charge && charge.sdp);
      if (attendue && portee && !memeEmpreinte(attendue, portee)) return Promise.resolve();
      return repondre(charge).catch(function () {});
    }
    if (signal.type === 'reponse') {
      // Une réponse à une offre qu'on a déjà remplacée arrive après coup, dans
      // l'ordre où elle a été déposée : son rang la trahit.
      if (S.offreN && signal.n && signal.n < S.offreN) return Promise.resolve();
      return S.pc.setRemoteDescription(charge).then(viderCandidatsEnAttente).catch(function () {});
    }
    if (signal.type === 'candidat') {
      // Un candidat qui arrive avant la description distante casse
      // `addIceCandidate`. On les garde et on les rejoue une fois la
      // description posée — sinon les premiers candidats, souvent les
      // meilleurs, sont perdus.
      if (!S.pc.remoteDescription) { S.candidatsEnAttente.push(charge); return Promise.resolve(); }
      return S.pc.addIceCandidate(charge).catch(function () {});
    }
    return Promise.resolve();
  }

  function viderCandidatsEnAttente() {
    var attente = S.candidatsEnAttente.splice(0);
    return Promise.all(attente.map(function (c) { return S.pc.addIceCandidate(c).catch(function () {}); }));
  }

  // ---------------------------------------------------------------------------
  // Les pistes, et le battement de présence
  // ---------------------------------------------------------------------------
  // Ce que la caméra et le micro de CE navigateur font, et rien d'autre. La
  // question « le lien tient-il ? » est une autre question, et les confondre
  // est ce qui faisait dire au notaire que sa propre caméra avait lâché quand
  // c'était la page d'en face qui s'était fermée.
  function pistesVivantes() {
    var flux = S.fluxLocal;
    if (!flux || !flux.getTracks) return { video: false, audio: false };
    var vivante = function (kind) {
      return flux.getTracks().some(function (t) {
        return t.kind === kind && t.enabled !== false && t.muted !== true && t.readyState !== 'ended';
      });
    };
    return { video: vivante('video'), audio: vivante('audio') };
  }

  function etatPistes() {
    var p = pistesVivantes();
    // Une connexion tombée rend les pistes inutiles, quelle que soit la caméra :
    // le notaire ne voit plus rien. Ce que le serveur en conclut est à lui —
    // le domaine croise cette déclaration avec le silence de chaque pair avant
    // de nommer une cause.
    var lien = S.connexion !== 'failed' && S.connexion !== 'closed';
    return { video: lien && p.video, audio: lien && p.audio };
  }

  function envoyerPistes() {
    var p = etatPistes();
    if (S.dernieresPistes && S.dernieresPistes.video === p.video && S.dernieresPistes.audio === p.audio) return Promise.resolve();
    S.dernieresPistes = p;
    return appel('/salle/pistes', { method: 'POST', body: p }).then(function (r) {
      if (r.ok && r.body.salle) appliquer(r.body.salle);
    });
  }

  function sonder() {
    if (!S) return;
    appel('/salle', { query: { depuis: S.curseur } }).then(function (r) {
      if (!S) return;
      if (r.ok && r.body.salle) {
        appliquer(r.body.salle);
        S.curseur = r.body.curseur;
        var suite = Promise.resolve();
        (r.body.signaux || []).forEach(function (sig) { suite = suite.then(function () { return recevoirSignal(sig); }); });
        suite.then(function () {
          // Le notaire n'offre qu'une fois le client dans la salle : offrir
          // dans le vide fait expirer les candidats avant que personne n'écoute.
          // Et il REVÉRIFIE à chaque sondage, parce qu'un lien qui tombe ne
          // prévient pas et qu'un pair qui revient n'a rien d'autre à attendre.
          if (S && S.salle && S.salle.parties && S.salle.parties.client.authentifie && S.salle.parties.notaire.authentifie) assurerLien();
        });
      }
      planifier();
    });
  }

  function planifier() {
    if (!S) return;
    var etabli = S.connexion === 'connected';
    S.minuterie = deps.setTimeout(sonder, etabli ? SONDAGE_ETABLI_MS : SONDAGE_CONNEXION_MS);
  }

  // ---------------------------------------------------------------------------
  // L'enregistrement — chiffré dans le navigateur, clé jamais envoyée
  // ---------------------------------------------------------------------------
  // Ce que Nota ne détient pas, Nota ne peut pas remettre. La clé est produite
  // ici, elle reste ici, et le notaire la conserve avec l'enregistrement. Aucun
  // appel de ce module n'envoie la clé où que ce soit — c'est vérifié par un
  // test qui inspecte TOUT ce qui est passé par `fetch`.
  function nouvelleCle() {
    if (!deps.subtle) return Promise.reject(new Error('crypto_indisponible'));
    return deps.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  function chiffrer(cle, octets) {
    var iv = new Uint8Array(12);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(iv);
    return deps.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cle, octets).then(function (chiffre) {
      return { iv: iv, chiffre: new Uint8Array(chiffre) };
    });
  }

  function demarrerEnregistrement() {
    if (S.enregistreur || !deps.MediaRecorder || !S.fluxLocal) return Promise.resolve(false);
    return nouvelleCle().then(function (cle) {
      S.cleEnregistrement = cle;
      S.morceaux = [];
      var flux = S.fluxDistant && S.fluxDistant.getTracks ? S.fluxDistant : S.fluxLocal;
      var enr = new deps.MediaRecorder(flux);
      enr.ondataavailable = function (ev) {
        if (!ev.data || !ev.data.size) return;
        var lire = ev.data.arrayBuffer ? ev.data.arrayBuffer() : Promise.resolve(ev.data);
        lire.then(function (buf) { return chiffrer(S.cleEnregistrement, new Uint8Array(buf)); })
          .then(function (m) { S.morceaux.push(m); rendre(); })
          .catch(function () {});
      };
      S.enregistreur = enr;
      enr.start(2000);
      return true;
    }).catch(function () { return false; });
  }

  function arreterEnregistrement() {
    if (!S.enregistreur) return;
    try { S.enregistreur.stop(); } catch (e) { /* déjà arrêté */ }
    S.enregistreur = null;
  }

  // ---------------------------------------------------------------------------
  // Le rendu
  // ---------------------------------------------------------------------------
  function appliquer(salle) {
    S.salle = salle;
    rendre();
  }

  function etapeCourante() {
    if (!S.salle || !D) return null;
    return D.etapeById(S.salle.etape);
  }

  function rendre() {
    if (!S || typeof document === 'undefined') return;
    var hote = $('salle-plein');
    if (!hote) return;
    hote.hidden = false;
    var salle = S.salle;

    // Le bandeau bêta n'est pas conditionnel. Il est écrit dans le HTML et ce
    // rendu ne le touche jamais : rien ici ne peut le retirer (exigence G3).

    var titre = $('salle-etape-nom');
    var conduite = $('salle-etape-conduite');
    var constat = $('salle-etape-constat');
    var e = etapeCourante();
    if (titre) titre.textContent = e ? e.nom : '';
    if (conduite) conduite.textContent = e ? e.conduite : '';
    if (constat) constat.textContent = e ? e.constat : '';

    var sas = $('salle-sas');
    if (sas) {
      sas.textContent = (salle && salle.sas) || '————';
      sas.classList.toggle('is-confirme', !!(salle && salle.portes && salle.portes.lien.ouverte));
    }

    rendrePortes(salle);
    rendreStatut(salle);
    rendreActions(salle);

    var v = $('salle-video-local');
    if (v && S.fluxLocal && v.srcObject !== S.fluxLocal) v.srcObject = S.fluxLocal;
  }

  function rendrePortes(salle) {
    var hote = $('salle-portes');
    if (!hote || !D) return;
    vider(hote);
    D.SALLE_PORTES.forEach(function (id) {
      var p = (salle && salle.portes && salle.portes[id]) || { ouverte: false, message: null };
      var ligne = el('li', 'salle-porte' + (p.ouverte ? ' is-ouverte' : ''));
      ligne.dataset.porte = id;
      var etiquette = (D.SALLE_PORTE_LABELS[id] || {}).nom || id;
      var marque = el('span', 'salle-porte-marque', p.ouverte ? '✓' : '•');
      marque.setAttribute('aria-hidden', 'true');
      ligne.appendChild(marque);
      ligne.appendChild(el('span', 'salle-porte-nom', etiquette));
      // Une porte fermée DIT pourquoi. Une pastille rouge muette laisse le
      // notaire deviner, et il devine mal.
      if (!p.ouverte && p.message) ligne.appendChild(el('p', 'salle-porte-motif', p.message));
      ligne.setAttribute('aria-label', etiquette + ' : ' + (p.ouverte ? 'ouverte' : 'fermée' + (p.message ? ' — ' + p.message : '')));
      hote.appendChild(ligne);
    });
  }

  function rendreStatut(salle) {
    var hote = $('salle-statut');
    if (!hote) return;
    vider(hote);
    if (!salle) { hote.appendChild(el('p', 'salle-statut-ligne', 'Connexion en cours…')); return; }
    if (salle.statut === 'suspendue') {
      var s = el('p', 'salle-statut-ligne is-alerte', 'Séance suspendue — le lien a été interrompu. La signature est impossible tant qu’elle n’a pas repris.');
      hote.appendChild(s);
    }
    if (salle.enregistre) hote.appendChild(el('p', 'salle-statut-ligne is-enregistre', 'Enregistrement en cours, avec l’accord des deux parties.'));
    else if (salle.mode === 'strict') hote.appendChild(el('p', 'salle-statut-ligne', 'Aucun enregistrement. La preuve de la séance est le procès-verbal scellé.'));
    if (salle.signature && salle.signature.avis) hote.appendChild(el('p', 'salle-statut-ligne is-alerte', salle.signature.avis));
    if (salle.scelle) {
      hote.appendChild(el('p', 'salle-statut-ligne', 'Procès-verbal scellé. Empreinte :'));
      hote.appendChild(el('code', 'salle-empreinte', salle.scelle.empreinte));
    }
  }

  function bouton(cls, texte, fn) {
    var b = el('button', cls, texte);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function rendreActions(salle) {
    var hote = $('salle-actions');
    if (!hote || !D) return;
    vider(hote);
    if (!salle) return;

    // Le consentement se donne et se retire des deux côtés. C'est la seule
    // action que le client peut faire seul, et elle doit rester atteignable
    // pendant toute la séance — un accord qu'on ne peut plus retirer n'en est
    // pas un.
    var mien = salle.consentements && salle.consentements[S.partie];
    var enregistre = D.salleModeById(salle.mode) && D.salleModeById(salle.mode).enregistre;
    if (salle.consentement && salle.consentement.requis) {
      if (!mien || mien.retireLe) {
        hote.appendChild(bouton('salle-btn is-primaire', enregistre ? 'J’accepte l’enregistrement et le procès-verbal' : 'J’accepte le procès-verbal', function () {
          appel('/salle/consentement', { method: 'POST', body: { enregistrement: !!enregistre } }).then(function (r) { if (r.ok) appliquer(r.body.salle); });
        }));
      } else {
        hote.appendChild(bouton('salle-btn is-discret', 'Retirer mon accord', function () {
          appel('/salle/consentement', { method: 'POST', body: { retire: true } }).then(function (r) { if (r.ok) appliquer(r.body.salle); });
        }));
      }
    }

    if (S.partie !== 'notaire') return;

    // Le notaire conduit. Confirmer le lien, attester l'identité, avancer,
    // reprendre, sceller.
    if (salle.sas && !(salle.portes && salle.portes.lien.ouverte)) {
      hote.appendChild(bouton('salle-btn is-primaire', 'Les deux chaînes concordent', function () {
        appel('/salle/lien', { method: 'POST', body: { sas: salle.sas } }).then(function (r) { if (r.ok) appliquer(r.body.salle); });
      }));
    }

    if (salle.portes && !salle.portes.identite.ouverte) {
      D.SALLE_PARTIES.forEach(function (partie) {
        if (salle.identites && salle.identites[partie]) return;
        hote.appendChild(bouton('salle-btn', 'Attester l’identité — ' + (partie === 'notaire' ? 'notaire' : 'client'), function () {
          attesterIdentite(partie);
        }));
      });
    }

    if (salle.statut === 'suspendue') {
      hote.appendChild(bouton('salle-btn is-primaire', 'Reprendre la séance', function () {
        appel('/salle/etape', { method: 'POST', body: { reprendre: true } }).then(function (r) {
          if (r.ok) appliquer(r.body.salle); else afficherRefus(r.body);
        });
      }));
      return;
    }

    var suivante = etapeSuivante(salle.etape);
    if (suivante) {
      var libelle = suivante.id === 'signature' ? 'Libérer la signature' : 'Passer à « ' + suivante.nom + ' »';
      var b = bouton('salle-btn is-primaire', libelle, function () {
        appel('/salle/etape', { method: 'POST', body: { versEtape: suivante.id } }).then(function (r) {
          if (r.ok) { appliquer(r.body.salle); if (suivante.id === 'signature') arreterEnregistrement(); }
          else afficherRefus(r.body);
        });
      });
      // Grisé quand le serveur refusera : c'est une politesse, pas une
      // barrière. La barrière est le refus du serveur.
      if (suivante.id === 'signature' && !salle.toutesOuvertes) b.disabled = true;
      hote.appendChild(b);
    }

    var precedente = etapePrecedente(salle.etape);
    if (precedente) {
      hote.appendChild(bouton('salle-btn is-discret', 'Revenir à « ' + precedente.nom + ' »', function () {
        appel('/salle/etape', { method: 'POST', body: { versEtape: precedente.id } }).then(function (r) {
          if (r.ok) appliquer(r.body.salle); else afficherRefus(r.body);
        });
      }));
    }

    if (salle.etape === 'cloture' && !salle.scelle) {
      hote.appendChild(bouton('salle-btn is-primaire', 'Sceller le procès-verbal', function () {
        appel('/salle/sceau', { method: 'POST', body: {} }).then(function (r) {
          if (r.ok) appliquer(r.body.salle); else afficherRefus(r.body);
        });
      }));
    }
  }

  function etapeSuivante(id) {
    if (!D) return null;
    var ordre = D.etapeOrdre(id);
    return D.CEREMONIE_ETAPES.find(function (e) { return e.ordre === ordre + 1; }) || null;
  }
  function etapePrecedente(id) {
    if (!D) return null;
    var ordre = D.etapeOrdre(id);
    return D.CEREMONIE_ETAPES.find(function (e) { return e.ordre === ordre - 1; }) || null;
  }

  function afficherRefus(corps) {
    var hote = $('salle-refus');
    if (!hote) return;
    vider(hote);
    var erreurs = (corps && corps.errors) || [];
    // Le refus du serveur est recopié tel quel. Le reformuler ici ferait deux
    // vérités, et celle affichée serait la moins fiable.
    erreurs.forEach(function (e) { hote.appendChild(el('p', 'salle-refus-ligne', e.message)); });
    hote.hidden = erreurs.length === 0;
  }

  function attesterIdentite(partie) {
    if (!S.salle) return Promise.resolve();
    // En bêta, l'attestation est de DÉMONSTRATION et le dit. Le fournisseur de
    // vérification n'est pas choisi (ADR 0047, « ce que cette ADR ne décide
    // pas ») ; proposer ici un choix de méthodes réelles laisserait croire
    // qu'une vérification a eu lieu.
    return appel('/salle/identite', {
      method: 'POST',
      body: {
        partie: partie,
        attestation: {
          methode: 'demonstration',
          verifieeLe: new Date(deps.now()).toISOString(),
          verifieePar: 'notaire',
        },
      },
    }).then(function (r) {
      if (r.ok) appliquer(r.body.salle); else afficherRefus(r.body);
      return r;
    });
  }

  // ---------------------------------------------------------------------------
  // Ouvrir, quitter
  // ---------------------------------------------------------------------------
  function ouvrir(options) {
    var o = options || {};
    if (S) quitter();
    S = {
      id: o.id, dateISO: o.dateISO, partie: o.partie, jeton: o.token,
      mode: o.mode || 'strict', demonstration: o.demonstration !== false,
      salle: null, pc: null, fluxLocal: null, fluxDistant: null,
      curseur: 0, connexion: 'new', candidatsEnAttente: [],
      // L'heure de la dernière offre et son rang dans la signalisation, plus
      // l'empreinte du pair : de quoi refaire un lien, et reconnaître ce qui
      // appartient à la négociation courante.
      offreA: 0, offreN: 0, empreinteDistante: null,
      empreintePubliee: null, dernieresPistes: null, minuterie: null,
      enregistreur: null, cleEnregistrement: null, morceaux: [],
    };
    var hote = $('salle-plein');
    if (hote) { hote.hidden = false; if (typeof document !== 'undefined') document.body.classList.add('salle-ouverte'); }
    rendre();

    return appel('/salle/rejoindre', { method: 'POST', body: { mode: S.mode, demonstration: S.demonstration } })
      .then(function (r) {
        if (!r.ok) { afficherRefus(r.body); throw new Error('rejoindre'); }
        appliquer(r.body.salle);
        S.ice = r.body.ice || [];
        return deps.getUserMedia({ video: true, audio: true });
      })
      .then(function (flux) {
        S.fluxLocal = flux;
        S.pc = creerConnexion(S.ice);
        flux.getTracks().forEach(function (t) { S.pc.addTrack(t, flux); });
        // Une piste que le navigateur coupe (débranchement, permission retirée)
        // doit refermer la porte tout de suite, sans attendre le silence.
        flux.getTracks().forEach(function (t) {
          if (t.addEventListener) {
            t.addEventListener('ended', envoyerPistes);
            t.addEventListener('mute', envoyerPistes);
            t.addEventListener('unmute', envoyerPistes);
          }
        });
        return envoyerPistes();
      })
      .then(function () { sonder(); return S.salle; })
      .catch(function (e) {
        // Une caméra refusée n'est pas un plantage : c'est une porte qui reste
        // fermée, et la personne doit lire pourquoi.
        afficherRefus({ errors: [{ message: messageMateriel(e) }] });
        return null;
      });
  }

  function messageMateriel(e) {
    var nom = (e && (e.name || e.message)) || '';
    if (/NotAllowed|Permission/i.test(nom)) return 'Vous avez refusé l’accès à la caméra ou au micro. Le notaire doit vous voir et vous entendre : sans cela, la séance ne peut pas commencer.';
    if (/NotFound|Devices/i.test(nom)) return 'Aucune caméra ou aucun micro n’a été trouvé sur cet appareil.';
    if (/webrtc_indisponible/.test(nom)) return 'Ce navigateur ne sait pas établir de lien vidéo chiffré. Essayez un navigateur à jour.';
    if (/media_indisponible/.test(nom)) return 'La caméra n’est accessible que sur une connexion sécurisée (https).';
    return 'La séance n’a pas pu s’ouvrir. Vérifiez votre connexion et réessayez.';
  }

  function quitter() {
    if (!S) return;
    if (S.minuterie) deps.clearTimeout(S.minuterie);
    arreterEnregistrement();
    // Éteindre les pistes pour de bon. Une caméra qui reste allumée après la
    // séance est un manquement, pas une fuite de mémoire.
    if (S.fluxLocal && S.fluxLocal.getTracks) S.fluxLocal.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    if (S.pc) { try { S.pc.close(); } catch (e) {} }
    S = null;
    var hote = $('salle-plein');
    if (hote) hote.hidden = true;
    if (typeof document !== 'undefined') document.body.classList.remove('salle-ouverte');
  }

  // ---------------------------------------------------------------------------
  // Le branchement
  // ---------------------------------------------------------------------------
  function boot() {
    if (typeof document === 'undefined') return;
    var fermer = $('salle-fermer');
    if (fermer && !fermer.dataset.cable) {
      fermer.dataset.cable = '1';
      fermer.addEventListener('click', function () { quitter(); });
    }
    // L'enregistrement suit l'état que le SERVEUR calcule, jamais une case
    // cochée ici : les deux accords vivent là-bas.
    setInterval(function () {
      if (!S || !S.salle) return;
      if (S.partie !== 'notaire') return;
      if (S.salle.enregistre && !S.enregistreur) demarrerEnregistrement();
      if (!S.salle.enregistre && S.enregistreur) arreterEnregistrement();
    }, 1000);
  }

  return {
    boot: boot,
    ouvrir: ouvrir,
    quitter: quitter,
    rendre: rendre,
    etat: function () { return S; },
    // L'enregistrement s'allume et s'éteint sur ce que le SERVEUR calcule
    // (le battement de `boot`), jamais sur une case cochée ici. Les deux gestes
    // sont exposés parce qu'un test doit pouvoir les provoquer sans attendre
    // une seconde de vrai temps — et surtout pour vérifier ce qui sort du
    // chiffrement.
    demarrerEnregistrement: demarrerEnregistrement,
    arreterEnregistrement: arreterEnregistrement,
    empreinteDe: empreinteDe,
    etapeSuivante: etapeSuivante,
    etapePrecedente: etapePrecedente,
    // Le lien se refait tout seul, au sondage. Les deux gestes sont exposés
    // parce qu'un test doit pouvoir provoquer la relance sans attendre huit
    // secondes de vrai temps, et vérifier qu'une offre repart.
    assurerLien: function () { return S ? assurerLien() : Promise.resolve(); },
    refaireConnexion: function () { return S ? refaireConnexion() : null; },
    SONDAGE_CONNEXION_MS: SONDAGE_CONNEXION_MS,
    SONDAGE_ETABLI_MS: SONDAGE_ETABLI_MS,
    RELANCE_LIEN_MS: RELANCE_LIEN_MS,
    // Remplaçables par les tests : jsdom n'a ni caméra ni RTCPeerConnection.
    __deps: deps,
  };
});
