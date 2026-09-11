'use strict';

/**
 * LA SALLE DE SIGNATURE — la couche qui persiste et qui observe (ADR 0047).
 *
 * Ce qui DÉCIDE est dans `@nota/domain` : les quatre portes, l'ordre des
 * étapes, les consentements, la chaîne d'empreintes. Rien de tout cela n'est
 * réécrit ici. Ce fichier fait les trois choses que le domaine ne peut pas
 * faire, parce qu'elles ont une horloge, une mémoire ou un réseau :
 *
 *   1. il OBSERVE la continuité — un pair qui cesse de donner signe de vie n'a
 *      rien envoyé qui dise « je suis parti » ; c'est le silence qu'il faut
 *      remarquer, et seul quelqu'un qui tient l'heure le peut ;
 *   2. il ACHEMINE la signalisation WebRTC — offre, réponse, candidats ICE —
 *      par sondage, faute de WebSocket dans cette infrastructure, et c'est
 *      suffisant : une poignée de messages pendant l'établissement, puis plus
 *      rien, le média étant pair à pair ;
 *   3. il ÉCRIT au procès-verbal, en refusant tout ce que le domaine refuse.
 *
 * Le média ne passe JAMAIS par ici. La signalisation est tout ce que le serveur
 * voit d'une séance, et elle ne sert à rien sans les clés DTLS des deux pairs.
 */

const crypto = require('node:crypto');
const domain = require('@nota/domain');
const { SALLE_SIGNAUX_MAX, SALLE_SIGNAL_VIE_MS } = require('./keys');
const { createSignaturePort, fournisseurConfigure } = require('./signature-port');

// Les seuls types de signalisation acceptés, et la taille au-delà de laquelle
// un corps n'est plus de la signalisation. Une offre SDP fait quelques
// kilo-octets ; cent kilo-octets, c'est quelqu'un qui essaie de se servir de
// la salle comme d'un tuyau (exigence A2).
const SIGNAL_TYPES = ['offre', 'reponse', 'candidat', 'fin'];
const SIGNAL_MAX = 16000;

// Un pair qui n'a pas sondé depuis ce délai n'est plus là, qu'il l'ait dit ou
// non. Deux fois la tolérance du domaine : un sondage manqué est normal, deux
// ne le sont pas.
const SILENCE_MS = domain.PRESENCE_TOLERANCE_MS * 2;

function isoDe(ms) { return new Date(ms).toISOString(); }

// --- Les serveurs ICE ---------------------------------------------------------
// STUN suffit à la majorité des réseaux domestiques. Un NAT symétrique exige un
// relais, et un relais exige des identifiants : jamais un mot de passe statique
// (quiconque lit le JavaScript de la page l'aurait), toujours la forme
// horodatée de coturn — l'utilisateur EST l'expiration, et le mot de passe est
// son HMAC. Un identifiant volé meurt donc tout seul (exigence A6).
function iceServers(env = process.env, { nowMs = Date.now, vieS = 3600 } = {}, sujet = 'nota') {
  const serveurs = [];
  const stun = String(env.NOTA_STUN_URLS ?? 'stun:stun.l.google.com:19302').trim();
  if (stun) serveurs.push({ urls: stun.split(/[,\s]+/).filter(Boolean) });

  const turn = String(env.NOTA_TURN_URL || '').trim();
  const secret = String(env.NOTA_TURN_SECRET || '').trim();
  if (turn && secret) {
    const expire = Math.floor(nowMs() / 1000) + Math.max(60, Math.min(86400, Number(vieS) || 3600));
    const username = expire + ':' + String(sujet).replace(/[^A-Za-z0-9_-]/g, '');
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    serveurs.push({ urls: turn.split(/[,\s]+/).filter(Boolean), username, credential });
  }
  return serveurs;
}

// --- La vue publique d'une séance ---------------------------------------------
// Ce que chaque côté a le droit de voir. L'empreinte DTLS de l'autre est
// nécessaire (c'est elle qui fait la chaîne d'authentification), le procès-
// verbal complet ne l'est pas tant que la séance n'est pas scellée.
function vueSalle(salle, { nowMs }) {
  const readiness = domain.salleReadiness(salle, { nowMs });
  const consentement = domain.consentementEtat(salle);
  return {
    id: salle.id,
    bidId: salle.bidId,
    dateISO: salle.dateISO,
    mode: salle.mode,
    demonstration: salle.demonstration === true,
    statut: salle.statut,
    etape: salle.etape,
    etapes: domain.CEREMONIE_ETAPES,
    portes: readiness.portes,
    fermees: readiness.fermees,
    toutesOuvertes: readiness.toutesOuvertes,
    sas: readiness.sas,
    lien: {
      empreinteNotaire: salle.lien.empreinteNotaire || null,
      empreinteClient: salle.lien.empreinteClient || null,
      confirmeLe: salle.lien.confirmeLe || null,
    },
    identites: salle.identites,
    consentements: salle.consentements,
    consentement,
    enregistre: domain.enregistrementActif(salle),
    parties: {
      notaire: { authentifie: !!(salle.parties.notaire && salle.parties.notaire.authentifie), pistes: salle.parties.notaire.pistes },
      client: { authentifie: !!(salle.parties.client && salle.parties.client.authentifie), pistes: salle.parties.client.pistes },
    },
    presence: salle.presence,
    signature: salle.signature || null,
    scelle: salle.scelle || null,
    pv: salle.pv || [],
    rev: salle.rev || 0,
  };
}

function createSalleService({ repo, now = () => new Date().toISOString().slice(0, 10), nowMs = () => Date.now(), env = process.env, appendAudit = async () => {}, signature, readTurnSecret } = {}) {
  const port = signature || createSignaturePort(env);
  const fournisseur = fournisseurConfigure(env);
  const turnSecret = require('./turn-secret').createTurnSecretReader({ env, nowMs, readTurnSecret });

  // --- Écriture concurrente ---------------------------------------------------
  // Deux pairs poussent des candidats ICE sur le même item pendant
  // l'établissement. Sans garde de révision, l'un écrase l'autre et le candidat
  // perdu ne produit AUCUNE erreur — seulement une connexion qui ne monte
  // jamais. On relit et on rejoue, plutôt que de risquer ça.
  // Le nombre d'essais n'est pas décoratif : le rassemblement ICE produit une
  // dizaine de candidats par pair, en rafale, et les deux pairs le font en même
  // temps. Trop peu d'essais, et le perdant de la course reçoit une erreur là
  // où il aurait suffi de relire. On cède la main entre deux tentatives pour
  // que la concurrente en cours puisse finir plutôt que de rejouer contre elle.
  async function muter(bidId, mutation, essais = 16) {
    for (let i = 0; i < essais; i++) {
      const salle = await repo.getSalle(bidId);
      if (!salle) return { error: 'salle_introuvable' };
      const resultat = await mutation(salle);
      if (resultat && resultat.error) return resultat;
      try {
        const ecrite = await repo.putSalle(salle, { ifRev: salle.rev || 0 });
        return { salle: ecrite, ...(resultat || {}) };
      } catch (e) {
        if (e && e.name === 'ConditionalCheckFailedException' && i < essais - 1) {
          await new Promise((r) => setTimeout(r, i));
          continue;
        }
        throw e;
      }
    }
    return { error: 'salle_conflit' };
  }

  // --- Le procès-verbal -------------------------------------------------------
  // Une seule porte d'écriture, et elle passe par le validateur du domaine :
  // ce qui n'a pas sa place au procès-verbal n'y entre pas, d'où qu'on appelle.
  function noter(salle, fait, par, detail) {
    const v = domain.validateEntreePv({ fait, par, a: isoDe(nowMs()), detail: detail || {} });
    if (!v.ok) return false;
    salle.pv = Array.isArray(salle.pv) ? salle.pv : [];
    salle.pv.push(v.entree);
    return true;
  }

  // Les portes qui s'ouvrent et se referment sont des FAITS. Sans ceci, le
  // procès-verbal dirait que la signature a été libérée sans dire ce qui
  // l'autorisait à l'être.
  function noterPortes(salle, avant) {
    const apres = domain.salleReadiness(salle, { nowMs: nowMs() }).portes;
    for (const porte of domain.SALLE_PORTES) {
      const etait = avant[porte].ouverte, est = apres[porte].ouverte;
      if (etait === est) continue;
      noter(salle, est ? 'porte_ouverte' : 'porte_fermee', 'systeme', { porte });
    }
  }

  // --- L'observation de la continuité -----------------------------------------
  // Le silence d'un pair est l'information. Personne n'envoie « je suis parti ».
  function observerPresence(salle) {
    const t = nowMs();
    salle.presence = salle.presence || { coupeeA: null, repriseA: null };

    // L'observation ne commence que quand il y a quelque chose à observer : les
    // deux parties présentes, et chacune ayant dit une fois l'état de ses
    // pistes. Avant cela, la porte de présence est fermée — le domaine le dit
    // déjà — mais rien n'est INSCRIT au procès-verbal. Sans cette garde, chaque
    // séance s'ouvrirait sur une coupure et une reprise fantômes, entre le
    // moment où le premier pair arrive et celui où le second allume sa caméra.
    const observable = domain.SALLE_PARTIES.every((p) => {
      const partie = salle.parties[p];
      return partie && partie.authentifie === true && Number.isFinite(partie.pistesVuesLe);
    });
    if (!observable) return salle;

    // Le silence : l'instant de la coupure est le DERNIER SIGNE DE VIE, pas
    // celui où on s'en aperçoit. Dater la coupure de sa découverte ferait
    // repartir la tolérance à zéro à chaque sondage, et une séance dont le
    // client est parti depuis dix minutes ne se suspendrait jamais.
    let depuis = null;
    const retenir = (ms) => { depuis = depuis === null ? ms : Math.min(depuis, ms); };
    for (const p of domain.SALLE_PARTIES) {
      const partie = salle.parties[p];
      const vuLe = partie.vuLe;
      if (Number.isFinite(vuLe) && (t - vuLe) > SILENCE_MS) retenir(vuLe);
      // Une piste morte, elle, est déclarée : on sait à quel instant.
      const pistes = partie.pistes || {};
      if (pistes.video !== true || pistes.audio !== true) retenir(partie.pistesVuesLe);
    }
    const coupe = depuis !== null;

    // Une coupure EN COURS occupe le seul emplacement d'état. Si elle a déjà
    // été reprise, une nouvelle coupure doit en ouvrir une nouvelle — sinon la
    // DEUXIÈME déconnexion d'une séance ne suspendrait jamais rien.
    const enCours = Number.isFinite(salle.presence.coupeeA) && !Number.isFinite(salle.presence.repriseA);
    if (coupe && !enCours) {
      salle.presence = { coupeeA: depuis, repriseA: null };
      noter(salle, 'lien_coupe', 'systeme', {});
    } else if (!coupe && enCours) {
      const coupureMs = t - salle.presence.coupeeA;
      salle.presence = { coupeeA: salle.presence.coupeeA, repriseA: t };
      noter(salle, 'lien_repris', 'systeme', { coupureMs });
    }

    // La suspension est une décision du domaine, prise sur l'état qu'on vient
    // d'observer. L'API ne choisit pas le seuil ; elle applique le verdict.
    if (domain.doitSuspendre(salle, t)) {
      salle.statut = domain.SALLE_STATUT.SUSPENDUE;
      noter(salle, 'salle_suspendue', 'systeme', {});
    }
    return salle;
  }

  // --- La signalisation --------------------------------------------------------
  // Un anneau borné, purgé par l'âge : au-delà de l'établissement, ces messages
  // ne servent plus à rien, et les garder ne ferait qu'entretenir un journal de
  // qui a parlé à qui.
  function purgerSignaux(salle) {
    const t = nowMs();
    const vivants = (Array.isArray(salle.signaux) ? salle.signaux : []).filter((s) => (t - s.ms) < SALLE_SIGNAL_VIE_MS);
    salle.signaux = vivants.slice(-SALLE_SIGNAUX_MAX);
    return salle;
  }

  return {
    fournisseur,
    iceServers: async (sujet) => {
      // Production already provisions a Canadian relay for /signature.html.
      // Reuse its SSM reference and bounded credentials for the second room.
      if (env.NOTA_SIGNING_TURN_URLS) {
        const raw = env.NOTA_SIGNING_TURN_URLS;
        const urls = raw.startsWith('[') ? JSON.parse(raw) : raw.split(',');
        const secret = await turnSecret();
        if (!Array.isArray(urls) || !urls.length || !secret) throw new Error('TURN unavailable');
        return iceServers({ ...env, NOTA_STUN_URLS: '', NOTA_TURN_URL: urls.join(','), NOTA_TURN_SECRET: secret }, { nowMs, vieS: 1800 }, sujet);
      }
      return iceServers(env, { nowMs }, sujet);
    },
    vueSalle: (salle) => vueSalle(salle, { nowMs: nowMs() }),

    /**
     * Rejoindre. Crée la séance au premier arrivant (le domaine vérifie que
     * l'acte est retenu), inscrit la partie comme authentifiée, et enregistre
     * son empreinte DTLS — celle dont la chaîne d'authentification est dérivée.
     */
    async rejoindre(bid, { partie, empreinte, mode, demonstration }) {
      if (!domain.SALLE_PARTIES.includes(partie)) return { error: 'partie_inconnue' };
      let salle = await repo.getSalle(bid.id);
      if (!salle) {
        const v = domain.validateSalleOuverture(bid, { mode, demonstration });
        if (!v.ok) return { errors: v.errors };
        salle = { ...v.salle, id: 'S-' + String(bid.id), signaux: [], rev: 0 };
        salle.statut = domain.SALLE_STATUT.OUVERTE;
        noter(salle, 'salle_ouverte', 'systeme', { mode: salle.mode });
        if (salle.demonstration) noter(salle, 'mention_demonstration', 'systeme', {});
        await repo.putSalle(salle, { ifRev: 0 });
      }
      return muter(bid.id, (s) => {
        const avant = domain.salleReadiness(s, { nowMs: nowMs() }).portes;
        s.parties[partie] = {
          ...(s.parties[partie] || {}),
          authentifie: true,
          vuLe: nowMs(),
          pistes: (s.parties[partie] && s.parties[partie].pistes) || { video: false, audio: false },
        };
        if (empreinte) {
          const cle = partie === 'notaire' ? 'empreinteNotaire' : 'empreinteClient';
          // Une empreinte qui change est une renégociation : la confirmation
          // précédente ne vaut plus, et le domaine le verra par `confirmePour`.
          s.lien = { ...s.lien, [cle]: String(empreinte).slice(0, 400) };
        }
        noterPortes(s, avant);
        return {};
      });
    },

    /** L'état, plus les signaux qui attendent CE pair depuis son curseur. */
    async etat(bidId, { partie, depuis }) {
      return muter(bidId, (s) => {
        if (s.parties[partie]) s.parties[partie].vuLe = nowMs();
        observerPresence(s);
        purgerSignaux(s);
        return {};
      }).then((r) => {
        if (r.error) return r;
        const curseur = Number(depuis) || 0;
        const pour = r.salle.signaux.filter((s) => s.pour === partie && s.n > curseur);
        return {
          salle: vueSalle(r.salle, { nowMs: nowMs() }),
          signaux: pour.map((s) => ({ n: s.n, type: s.type, de: s.de, charge: s.charge })),
          curseur: r.salle.signaux.length ? r.salle.signaux[r.salle.signaux.length - 1].n : curseur,
        };
      });
    },

    /** Déposer un message de signalisation pour l'autre pair. */
    async signaler(bidId, { de, type, charge }) {
      if (!domain.SALLE_PARTIES.includes(de)) return { error: 'partie_inconnue' };
      if (!SIGNAL_TYPES.includes(type)) return { error: 'signal_inconnu' };
      const texte = typeof charge === 'string' ? charge : JSON.stringify(charge == null ? null : charge);
      if (texte.length > SIGNAL_MAX) return { error: 'signal_trop_gros' };
      return muter(bidId, (s) => {
        purgerSignaux(s);
        const n = (s.signaux.length ? s.signaux[s.signaux.length - 1].n : 0) + 1;
        s.signaux.push({ n, ms: nowMs(), de, pour: de === 'notaire' ? 'client' : 'notaire', type, charge: texte });
        if (s.parties[de]) s.parties[de].vuLe = nowMs();
        return { n };
      });
    },

    /** L'état des pistes, tel que le navigateur le voit. */
    async pistes(bidId, { partie, video, audio }) {
      return muter(bidId, (s) => {
        const avant = domain.salleReadiness(s, { nowMs: nowMs() }).portes;
        s.parties[partie] = {
          ...(s.parties[partie] || {}),
          vuLe: nowMs(), pistesVuesLe: nowMs(),
          pistes: { video: video === true, audio: audio === true },
        };
        observerPresence(s);
        noterPortes(s, avant);
        return {};
      });
    },

    /**
     * Le notaire confirme que les deux chaînes concordent. La confirmation
     * porte LA chaîne confirmée : si le lien est renégocié ensuite, le domaine
     * voit que la confirmation ne porte plus sur le lien courant.
     */
    async confirmerLien(bidId, { sas }) {
      return muter(bidId, (s) => {
        const readiness = domain.salleReadiness(s, { nowMs: nowMs() });
        if (!readiness.sas) return { error: 'lien_inconnu' };
        if (String(sas || '').toUpperCase() !== readiness.sas) return { error: 'sas_discordant' };
        const avant = readiness.portes;
        s.lien = { ...s.lien, confirmeLe: isoDe(nowMs()), confirmePour: readiness.sas };
        noter(s, 'lien_confirme', 'notaire', { sas: readiness.sas });
        noterPortes(s, avant);
        return {};
      });
    },

    /** Le notaire inscrit une attestation d'identité. */
    async attesterIdentite(bidId, { partie, attestation }) {
      if (!domain.SALLE_PARTIES.includes(partie)) return { error: 'partie_inconnue' };
      const v = domain.validateAttestationIdentite(attestation);
      if (!v.ok) return { errors: v.errors };
      return muter(bidId, (s) => {
        const avant = domain.salleReadiness(s, { nowMs: nowMs() }).portes;
        s.identites = { ...s.identites, [partie]: v.attestation };
        // L'attestation est un FAIT de la séance, et le procès-verbal le disait
        // seulement en creux, par la porte qui s'ouvrait. Il nomme désormais la
        // partie vérifiée et la MÉTHODE — jamais la pièce, jamais son numéro.
        noter(s, 'identite_attestee', 'notaire', { partie, methode: v.attestation.methode });
        noterPortes(s, avant);
        return {};
      });
    },

    /** Un consentement donné, ou retiré. Les deux sont des faits. */
    async consentir(bidId, { partie, enregistrement, retire }) {
      if (!domain.SALLE_PARTIES.includes(partie)) return { error: 'partie_inconnue' };
      return muter(bidId, (s) => {
        const enregistraitAvant = domain.enregistrementActif(s);
        if (retire) {
          const courant = s.consentements[partie];
          if (!courant) return { error: 'consentement_absent' };
          s.consentements = { ...s.consentements, [partie]: { ...courant, retireLe: isoDe(nowMs()) } };
          noter(s, 'consentement_retire', partie, { partie });
        } else {
          s.consentements = {
            ...s.consentements,
            [partie]: { donneLe: isoDe(nowMs()), enregistrement: enregistrement === true, retireLe: null },
          };
          noter(s, 'consentement_donne', partie, { partie });
        }
        const enregistreApres = domain.enregistrementActif(s);
        if (enregistraitAvant !== enregistreApres) {
          noter(s, enregistreApres ? 'enregistrement_demarre' : 'enregistrement_arrete', 'systeme', { mode: s.mode });
        }
        return {};
      });
    },

    /**
     * Avancer (ou revenir). Le domaine décide ; on ne fait qu'appliquer et
     * consigner. Une séance suspendue reprend ICI, et repart de l'étape en
     * cours — jamais plus loin (exigence C2).
     */
    async avancer(bidId, { versEtape, reprendre }) {
      return muter(bidId, async (s) => {
        if (reprendre) {
          if (s.statut !== domain.SALLE_STATUT.SUSPENDUE) return { error: 'salle_non_suspendue' };
          const readiness = domain.salleReadiness(s, { nowMs: nowMs() });
          if (!readiness.portes.presence.ouverte) return { error: 'presence_absente', message: readiness.portes.presence.message };
          s.statut = domain.SALLE_STATUT.OUVERTE;
          noter(s, 'salle_reprise', 'notaire', { etape: s.etape });
          return {};
        }
        const v = domain.peutAvancer(s, versEtape, { nowMs: nowMs(), fournisseur });
        if (!v.ok) return { errors: v.errors };

        // L'étape `signature` sort par le port, et seulement si le domaine l'a
        // permis. La référence revient dans la séance ; la minute, elle, n'est
        // jamais fabriquée ici.
        if (v.etape === 'signature' && !v.retour) {
          const scelle = domain.scellerProcesVerbal(s, { a: isoDe(nowMs()) });
          const recu = await port.liberer({ salle: s, scelle });
          s.signature = {
            fournisseur: recu.fournisseur, reference: recu.reference,
            minute: recu.minute || null, signeeLe: recu.signeeLe, avis: recu.avis || null,
          };
          noter(s, 'signature_liberee', 'notaire', { fournisseur: recu.fournisseur, reference: recu.reference });
        }
        s.etape = v.etape;
        noter(s, v.retour ? 'etape_reprise' : 'etape_franchie', 'notaire', { etape: v.etape });
        return { retour: v.retour };
      });
    },

    /**
     * Sceller. La chaîne se ferme, l'empreinte est publiée, et la MÊME
     * empreinte part dans la piste d'audit inaltérable : deux copies
     * indépendantes de la même vérité (exigence E3).
     */
    async sceller(bidId, { notaryId }) {
      const r = await muter(bidId, (s) => {
        if (s.statut === domain.SALLE_STATUT.SCELLEE) return { error: 'deja_scellee' };
        if (domain.etapeOrdre(s.etape) < domain.etapeOrdre('signature')) return { error: 'signature_absente' };
        noter(s, 'salle_scellee', 'notaire', {});
        const scelle = domain.scellerProcesVerbal(s, { a: isoDe(nowMs()) });
        s.scelle = scelle;
        s.statut = domain.SALLE_STATUT.SCELLEE;
        return { scelle };
      });
      if (r.error || r.errors) return r;
      await appendAudit('salle_scellee', {
        bidId: String(bidId),
        salleId: r.salle.id,
        empreinte: r.scelle.empreinte,
        entrees: r.scelle.entrees.length,
        mode: r.salle.mode,
        demonstration: r.salle.demonstration === true,
        fournisseur: (r.salle.signature && r.salle.signature.fournisseur) || null,
      }, notaryId);
      return r;
    },
  };
}

module.exports = {
  createSalleService,
  iceServers,
  vueSalle,
  SIGNAL_TYPES,
  SIGNAL_MAX,
  SILENCE_MS,
};
