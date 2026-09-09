/* =============================================================================
   LA SALLE DE SIGNATURE — ADR 0047. Zéro dépendance d'exécution.

   WebRTC, MediaRecorder et crypto.subtle sont des interfaces du navigateur : ce
   module n'apporte aucune bibliothèque. Il tient quatre choses, et rien de plus.

     1. LE LIEN. Une connexion pair à pair directe. Le média ne traverse aucun
        serveur de Nota — il n'y a pas de serveur média à traverser. Ce qui
        passe par l'API, c'est la signalisation, et elle ne sert à rien sans les
        clés DTLS des deux navigateurs.
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
    if (o.query) {
      var qs = Object.keys(o.query)
        .filter(function (k) { return o.query[k] !== undefined && o.query[k] !== null; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o.query[k]); })
        .join('&');
      if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    }
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

    pc.onicecandidate = function (ev) {
      if (!ev.candidate) return;
      appel('/salle/signal', { method: 'POST', body: { type: 'candidat', charge: JSON.stringify(ev.candidate) } });
    };
    pc.ontrack = function (ev) {
      S.fluxDistant = ev.streams && ev.streams[0] ? ev.streams[0] : S.fluxDistant;
      var v = $('salle-video-distant');
      if (v && S.fluxDistant) { v.srcObject = S.fluxDistant; if (v.play) { try { v.play(); } catch (e) { /* autoplay refusé */ } } }
      rendre();
    };
    pc.onconnectionstatechange = function () {
      S.connexion = pc.connectionState;
      // Une connexion qui tombe n'est pas un message : c'est un état. On le
      // remonte tout de suite plutôt que d'attendre que le silence le dise.
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') envoyerPistes();
      rendre();
    };
    return pc;
  }

  // Le notaire offre, le client répond. Un rôle fixe évite la collision de deux
  // offres simultanées (« glare ») sans négociation parfaite : c'est le notaire
  // qui conduit la séance, il conduit aussi la négociation.
  function offrir() {
    if (S.partie !== 'notaire' || S.offreFaite) return Promise.resolve();
    S.offreFaite = true;
    return S.pc.createOffer()
      .then(function (offre) { return S.pc.setLocalDescription(offre); })
      .then(function () {
        publierEmpreinte();
        return appel('/salle/signal', { method: 'POST', body: { type: 'offre', charge: JSON.stringify(S.pc.localDescription) } });
      });
  }

  function repondre(offre) {
    return S.pc.setRemoteDescription(offre)
      .then(function () { return S.pc.createAnswer(); })
      .then(function (reponse) { return S.pc.setLocalDescription(reponse); })
      .then(function () {
        publierEmpreinte();
        return appel('/salle/signal', { method: 'POST', body: { type: 'reponse', charge: JSON.stringify(S.pc.localDescription) } });
      });
  }

  function publierEmpreinte() {
    var e = empreinteDe(S.pc.localDescription && S.pc.localDescription.sdp);
    if (!e || e === S.empreintePubliee) return;
    S.empreintePubliee = e;
    appel('/salle/rejoindre', { method: 'POST', body: { empreinte: e } });
  }

  function recevoirSignal(signal) {
    var charge;
    try { charge = JSON.parse(signal.charge); } catch (e) { return Promise.resolve(); }
    if (signal.type === 'offre') return repondre(charge).catch(function () {});
    if (signal.type === 'reponse') {
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
  function etatPistes() {
    var flux = S.fluxLocal;
    if (!flux || !flux.getTracks) return { video: false, audio: false };
    var vivante = function (kind) {
      return flux.getTracks().some(function (t) {
        return t.kind === kind && t.enabled !== false && t.muted !== true && t.readyState !== 'ended';
      });
    };
    // Une connexion tombée rend les pistes inutiles, quelle que soit la caméra :
    // le notaire ne voit plus rien.
    var lien = S.connexion !== 'failed' && S.connexion !== 'closed';
    return { video: lien && vivante('video'), audio: lien && vivante('audio') };
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
          if (S && S.salle && S.salle.parties && S.salle.parties.client.authentifie && S.salle.parties.notaire.authentifie) offrir();
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
      curseur: 0, connexion: 'new', candidatsEnAttente: [], offreFaite: false,
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
    SONDAGE_CONNEXION_MS: SONDAGE_CONNEXION_MS,
    SONDAGE_ETABLI_MS: SONDAGE_ETABLI_MS,
    // Remplaçables par les tests : jsdom n'a ni caméra ni RTCPeerConnection.
    __deps: deps,
  };
});
